#!/usr/bin/env node
/**
 * PXIL capture tool — run this ON the whitelisted server.
 *
 *   node pxil-probe.mjs [fromdate] [todate]
 *
 * PXIL filters by source IP, separately per environment. Only the SJVN server
 * PXIL whitelisted (public IP 49.50.97.173) can reach these APIs at all; from
 * anywhere else every endpoint answers 403 with the IP it saw. So this file is
 * deliberately standalone:
 *
 *   - no npm dependencies, no repo checkout, no node_modules
 *   - never opens the platform database, never runs a migration
 *   - GETs only, nothing written anywhere except the capture file
 *
 * Copy this one file to the server, run it, and send back the capture it
 * writes. The analysis then happens off the server:
 *
 *   node backend/scripts/pxilAnalyse.js pxil-capture-<timestamp>.json
 *
 * which answers Q2, Q4, Q6, Q7 and Q9 from the recorded bodies. Capturing once
 * and analysing many times matters here because a server session has to be
 * arranged, while a corrected analysis should not have to be.
 *
 * PXIL RATIONS CALLS. On 5 Oct 2026, after about sixty requests in the day,
 * production answered every report with HTTP 429 "Request limit exceeded.
 * Please wait for 68472 seconds" — nineteen hours. So this tool is frugal by
 * default and stops dead at the first 429:
 *
 *   - one call per report, with the auth style PXIL documents for it (6 calls)
 *   - never more than --budget calls in a run (default 20)
 *   - nothing is retried, and nothing more is sent once PXIL says to wait
 *
 * PXIL also refuses a range it finds too large — "Data limit exceeded: Rows
 * are greater than or equal to 50,000" on the billing reports (188 days was
 * refused, 60 answered), more than 31 days on Member DOR. Each report is
 * therefore asked only for the end of the range, in a window PXIL accepts.
 * --scan walks further back, one window per report at a time, until rows turn
 * up or the budget runs out.
 *
 * The token is never printed and never written to the capture: under query auth
 * a URL contains the credential, so no URL is recorded either — only the path
 * and the non-secret parameters. A fingerprint (first 8 hex of its SHA-256) is
 * recorded instead, which is enough to tell staging's token from production's
 * without carrying either.
 *
 * The capture holds real trade data and the server's hostname. It is internal:
 * send it to the project, not to PXIL. What goes to PXIL is the rendered
 * report, which carries no credential.
 *
 * Usage
 *   node pxil-probe.mjs                          last 45 days, production
 *   node pxil-probe.mjs 2026-08-01 2026-09-22    an explicit range
 *   --base=<url>        override the environment (default production)
 *   --token=<token>     supply the token directly (else PXIL_API_TOKEN, else .env)
 *   --env=<path>        read PXIL_* from this .env file
 *   --portfolio=<id>    restrict to one portfolio
 *   --out=<path>        where to write the capture
 *   --no-ip             skip the outbound-IP echo (one call to ifconfig.me)
 *   --timeout=<ms>      per-request timeout, default 30000
 *   --budget=<n>        most calls to PXIL in this run, default 20
 *   --scan[=a,b]        walk back through the range looking for rows — every
 *                       ranged report, or only the ones named (e.g. tam-gtam)
 *   --both-auth         try header and query auth on every report (doubles the calls)
 *   --control           also call a path that does not exist (one call)
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const PRODUCTION = 'https://dashboard.pxil.in';

/**
 * The six Phase 1 endpoints. `ranged` endpoints take fromdate/todate; the
 * reverse auction L1 summary is a live snapshot and takes none.
 *
 * `documented` is the auth style PXIL's reply specifies, not a preference:
 * Member DOR and Reverse Auction are still Version 1 and take the token only
 * as APITokenNo in the query string (a Bearer header gets 400 "API Token is
 * mandatory"). Only that style is tried unless --both-auth asks for both.
 *
 * `maxDays` is the widest range asked for in one call. For Member DOR it is
 * PXIL's own rule (400 beyond 31 days). For the billing reports it is what
 * PXIL has been seen to answer: 60 days went through, 188 came back "Data
 * limit exceeded".
 *
 * backend/tests/pxilProbeReport.test.js pins this list against the backend's
 * own buildEndpoints(), so the two copies cannot drift apart unnoticed.
 */
export const ENDPOINT_SPECS = [
  { key: 'tam-gtam', path: 'tam-gtam', ranged: true, bodyKey: 'TAMGTAM', documented: 'header', maxDays: 60 },
  { key: 'slot-wise', path: 'slot-wise-quantity-and-charges', ranged: true, bodyKey: 'SlotWiseQuantityAndCharges', documented: 'header', maxDays: 60 },
  { key: 'format-d', path: 'format-d', ranged: true, bodyKey: 'Trades', documented: 'header', maxDays: 60 },
  { key: 'trade-margin', path: 'trade-margin', ranged: true, bodyKey: 'TradeMargin', documented: 'header', maxDays: 60 },
  { key: 'member-dor', path: 'member-dor', ranged: true, bodyKey: 'DOR', documented: 'query', maxDays: 31 },
  { key: 'reverse-auction', path: 'reverse-auction/l1-summary', ranged: false, bodyKey: null, documented: 'query' },
];

/**
 * A path that cannot exist. What PXIL answers here is what a wrong path looks
 * like — the only way to know that the billing reports' 404 "No data
 * available" means an empty range and not a missing endpoint.
 */
const CONTROL_PATH = 'sjvn-probe-no-such-report';

/* ------------------------------------------------------------- arguments */

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const name = a.slice(2);
    // `--no-ip` is a boolean; everything else may take the next token as its
    // value, which keeps Windows paths with spaces workable when quoted.
    if (name.startsWith('no-')) { flags[name] = true; continue; }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags[name] = next; i += 1; } else flags[name] = true;
  }
  return { flags, positional };
}

/**
 * Minimal .env reader: KEY=VALUE, '#' comments, optional quotes.
 *
 * Commented keys are reported separately rather than merely skipped. The
 * deployed .env is generated from .env.example, which ships every PXIL line
 * commented out — so "the key is there but commented" is the single likeliest
 * reason a run on the server finds no token, and the error message says so
 * instead of leaving someone to guess.
 */
function readEnvFile(path) {
  const out = {};
  const commented = [];
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = line.replace(/^#+\s*/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m) commented.push(m[1]);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return { values: out, commented };
}

/**
 * Where the token comes from, in order: an explicit flag, the process
 * environment, then a .env beside the tool or under a sibling backend/ — which
 * is where the deployed app keeps its own.
 */
function resolveConfig(flags) {
  const candidates = flags.env
    ? [resolve(String(flags.env))]
    : ['.env', join('backend', '.env'), join('..', 'backend', '.env'), join('..', '.env')].map((p) => resolve(p));

  let fileEnv = {};
  let commented = [];
  let envPath = null;
  const searched = [];
  for (const p of candidates) {
    if (!existsSync(p)) { searched.push({ path: p, found: false }); continue; }
    try {
      const parsed = readEnvFile(p);
      fileEnv = parsed.values;
      commented = parsed.commented;
      envPath = p;
      searched.push({ path: p, found: true });
      break;
    } catch (err) {
      searched.push({ path: p, found: true, unreadable: err.message });
    }
  }
  if (flags.env && !envPath) throw new Error(`No .env at ${resolve(String(flags.env))}`);

  // The process environment wins over the file, so a one-off run can override
  // the deployed .env without editing it.
  const pick = (key) => process.env[key] || fileEnv[key] || '';
  const flag = (key) => (typeof flags[key] === 'string' ? flags[key] : '');

  return {
    token: flag('token') || pick('PXIL_API_TOKEN'),
    baseUrl: (flag('base') || pick('PXIL_BASE_URL') || PRODUCTION).replace(/\/$/, ''),
    portfolioId: flag('portfolio') || pick('PXIL_PORTFOLIO_ID'),
    envPath,
    searched,
    tokenCommentedOut: commented.includes('PXIL_API_TOKEN'),
  };
}

/** Default to a window whose days run past the 12th, so DD-MM can be proven. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 45 * 24 * 3600 * 1000);
  return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
}

const DAY_MS = 24 * 3600 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Calls to PXIL in one run unless --budget says otherwise. PXIL shut us out after about sixty in a day. */
const DEFAULT_BUDGET = 20;

/**
 * PXIL's request limit: HTTP 429 "Request limit exceeded. Please wait for N
 * seconds and try again." Returns N (null when PXIL does not say), or
 * undefined when the response is not a rate limit.
 */
function waitSeconds(result) {
  if (result?.status !== 429) return undefined;
  const m = String(result.json?.message || result.snippet || '').match(/wait for (\d+) seconds/i);
  return m ? Number(m[1]) : null;
}

/** PXIL's refusal of a range for its size — too many days, or too many rows. */
function rangeRefused(json) {
  const message = String(json?.message || '');
  return /cannot exceed \d+ days|data limit exceeded/i.test(message) ? message : null;
}

/** An answer that says "nothing here": a 200 with no rows, or PXIL's 404 "No data available". */
function answeredEmpty(result, bodyKey) {
  if (result.status === 404) return /no data/i.test(String(result.json?.message || ''));
  if (result.status !== 200) return false;
  const rows = result.json?.ResponseBody?.[bodyKey];
  return !Array.isArray(rows) || rows.length === 0;
}

/** `[from, to]` windows of at most `days` days covering the range, newest first. */
export function windowsNewestFirst(fromdate, todate, days) {
  const start = Date.parse(`${fromdate}T00:00:00Z`);
  const windows = [];
  for (let end = Date.parse(`${todate}T00:00:00Z`); end >= start; end -= days * DAY_MS) {
    windows.push([isoDay(Math.max(end - (days - 1) * DAY_MS, start)), isoDay(end)]);
  }
  return windows;
}

/** A range cut into two halves, the later half first. */
export function halveNewestFirst(fromdate, todate) {
  const start = Date.parse(`${fromdate}T00:00:00Z`);
  const days = Math.round((Date.parse(`${todate}T00:00:00Z`) - start) / DAY_MS) + 1;
  const mid = start + (Math.ceil(days / 2) - 1) * DAY_MS;
  return [[isoDay(mid + DAY_MS), todate], [fromdate, isoDay(mid)]];
}

/** The later of `fromdate` and the day that makes the range `maxDays` long, inclusive. */
export function clampFrom(fromdate, todate, maxDays) {
  const earliest = Date.parse(`${todate}T00:00:00Z`) - (maxDays - 1) * 24 * 3600 * 1000;
  if (!Number.isFinite(earliest)) return fromdate;
  const iso = new Date(earliest).toISOString().slice(0, 10);
  return iso > fromdate ? iso : fromdate;
}

/** PXIL's own words for a response, whichever of its envelopes they arrive in. */
function saidBy(json) {
  const said = json?.message ?? json?.ResponseStatus?.Message ?? json?.ResponseStatus?.StatusMessage;
  return said ? ` — ${String(said).slice(0, 90)}` : '';
}

/* ------------------------------------------------------------- requests */

/**
 * PXIL's 403 for a non-whitelisted caller carries the IP it saw. It is a 403
 * and not a 401, so it must never be read as a bad token — that misread is what
 * this field exists to prevent.
 */
function ipNotAllowed(status, text) {
  if (status !== 403) return null;
  try {
    const body = JSON.parse(text);
    if (/not allowed/i.test(String(body.message || ''))) return String(body.your_ip || 'unknown');
  } catch { /* an HTML 403 from a gateway, not PXIL's own JSON */ }
  return null;
}

/**
 * One GET. The return shape matches the backend's probeRequest() exactly, so a
 * capture replays through the same renderer a live run uses — minus `url`,
 * which under query auth would contain the token.
 */
async function probe({ baseUrl, token, path, params, authStyle, timeoutMs }) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const headers = { Accept: 'application/json' };
  if (authStyle === 'query') search.set('APITokenNo', token);
  else headers.Authorization = `Bearer ${token}`;

  const url = `${baseUrl}/PXILPublish/api/${path}/?${search.toString()}`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON — the snippet below says so */ }
    return {
      path,
      auth: authStyle,
      status: resp.status,
      ok: resp.ok,
      content_type: resp.headers.get('content-type'),
      ip_not_allowed: ipNotAllowed(resp.status, text),
      json,
      snippet: json ? null : text.slice(0, 200),
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      path,
      auth: authStyle,
      status: null,
      ok: false,
      error: err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look further back for rows, within the call budget.
 *
 * Each report's first call covered the end of the range. This walks the rest,
 * newest first, one window per report in turn so that a small budget is spread
 * across reports instead of spent on the first. A window PXIL refuses for size
 * is halved. A report stops being walked at its first window with rows, which
 * is kept whole (`sample`); otherwise its first empty answer is kept (`empty`)
 * so the analysis has a body to read. Windows never reached are listed in
 * `pending`, so "no rows" can never be read as covering more than was asked.
 */
async function walk(specs, { fromdate, todate, ranged, call }) {
  const scans = {};
  for (const spec of specs) {
    const before = isoDay(Date.parse(`${clampFrom(fromdate, todate, spec.maxDays)}T00:00:00Z`) - DAY_MS);
    scans[spec.key] = {
      style: spec.documented,
      windows: [],
      sample: null,
      empty: null,
      pending: before >= fromdate ? windowsNewestFirst(fromdate, before, spec.maxDays) : [],
    };
  }
  for (;;) {
    const open = specs.filter((spec) => !scans[spec.key].sample && scans[spec.key].pending.length);
    if (!open.length) break;
    for (const spec of open) {
      const s = scans[spec.key];
      const [from, to] = s.pending[0];
      const result = await call({
        label: `scan ${spec.key} ${from} → ${to}`, bodyKey: spec.bodyKey,
        path: spec.path, params: { ...ranged, fromdate: from, todate: to }, authStyle: spec.documented,
      });
      // Out of budget, or PXIL has told us to wait: the window stays pending.
      if (!result) return scans;
      s.pending.shift();
      const rows = result.json?.ResponseBody?.[spec.bodyKey];
      const count = Array.isArray(rows) ? rows.length : 0;
      const refused = !!rangeRefused(result.json);
      const empty = answeredEmpty(result, spec.bodyKey);
      s.windows.push({ fromdate: from, todate: to, status: result.status, rows: count, refused, empty, error: result.error || null });
      if (refused && from < to) s.pending.unshift(...halveNewestFirst(from, to));
      else if (count > 0) s.sample = { fromdate: from, todate: to, result };
      else if (empty && !s.empty) s.empty = { fromdate: from, todate: to, result };
    }
  }
  return scans;
}

/** What PXIL will see as our source address — the thing they whitelist. */
async function outboundIp(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 10000));
  try {
    const resp = await fetch('https://ifconfig.me/ip', { signal: controller.signal });
    return (await resp.text()).trim().slice(0, 64);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ main */

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`This tool needs Node 18 or newer for built-in fetch; this is ${process.versions.node}.`);
    process.exit(1);
  }

  let cfg;
  try { cfg = resolveConfig(flags); } catch (err) { console.error(err.message); process.exit(1); }

  if (!cfg.token) {
    console.error('No PXIL token found.');
    console.error('');
    console.error('Looked for an .env in:');
    for (const s of cfg.searched) {
      const note = !s.found ? 'not found'
        : s.unreadable ? `unreadable — ${s.unreadable}`
          : cfg.tokenCommentedOut ? 'found, but PXIL_API_TOKEN is commented out'
            : 'found, but it has no PXIL_API_TOKEN';
      console.error(`  ${s.path}  (${note})`);
    }
    console.error('');
    if (cfg.tokenCommentedOut) {
      console.error('That is the usual cause on this server: the deployed .env is generated from');
      console.error('.env.example, which ships the PXIL lines commented out.');
      console.error('');
    }
    console.error('Either pass the token on the command line:');
    console.error('  node pxil-probe.mjs 2026-08-01 2026-09-22 --base=https://dashboard.pxil.in --token=<token>');
    if (cfg.envPath) {
      console.error('');
      console.error(`or put it in ${cfg.envPath}:`);
      console.error('  PXIL_API_TOKEN=<token>');
    }
    console.error('');
    console.error('Production is https://dashboard.pxil.in. PXIL issued one token for both');
    console.error('environments on 5 Oct 2026; the one from 2 Sep no longer works.');
    process.exit(1);
  }

  const [fromdate, todate] = positional.length >= 2 ? positional.slice(0, 2) : defaultRange();
  const timeoutMs = Number(flags.timeout) > 0 ? Number(flags.timeout) : 30000;
  const fingerprint = createHash('sha256').update(cfg.token).digest('hex').slice(0, 8);

  const ranged = { fromdate, todate, reportType: 'JSON' };
  if (cfg.portfolioId) ranged.portfolioId = cfg.portfolioId;

  console.log('PXIL capture');
  console.log(`  environment  ${cfg.baseUrl}${cfg.baseUrl === PRODUCTION ? ' (production)' : ''}`);
  console.log(`  date range   ${fromdate} → ${todate}`);
  console.log(`  portfolio    ${cfg.portfolioId || '(not set — all portfolios)'}`);
  console.log(`  token        ${cfg.token.length} chars, fingerprint ${fingerprint} (not printed)`);
  console.log(`  token source ${typeof flags.token === 'string' ? '--token' : process.env.PXIL_API_TOKEN ? 'PXIL_API_TOKEN' : cfg.envPath}`);
  console.log(`  node         ${process.versions.node} on ${hostname()}`);
  console.log('');

  const ip = flags['no-ip'] ? null : await outboundIp(timeoutMs);
  if (ip) console.log(`Outbound IP   ${ip} — this is the address PXIL must have whitelisted.`);
  else if (!flags['no-ip']) console.log('Outbound IP   could not be determined (no outbound access to the echo service).');
  console.log('');

  const budget = Number(flags.budget) > 0 ? Math.floor(Number(flags.budget)) : DEFAULT_BUDGET;
  const state = { calls: 0, rateLimit: null, outOfBudget: false };

  /**
   * The only way a request leaves this tool. Returns null without calling once
   * the budget is spent or PXIL has said to wait — a 429 is never followed by
   * another request, because every one after it is refused and may count.
   */
  const call = async ({ label, bodyKey, ...request }) => {
    if (state.rateLimit) return null;
    if (state.calls >= budget) { state.outOfBudget = true; return null; }
    state.calls += 1;
    process.stdout.write(`  ${label} … `);
    const result = await probe({ ...cfg, timeoutMs, ...request });
    const rows = bodyKey ? result.json?.ResponseBody?.[bodyKey] : null;
    const shape = result.error ? result.error
      : result.ip_not_allowed ? `403 IP not whitelisted (saw ${result.ip_not_allowed})`
        : `HTTP ${result.status}${Array.isArray(rows) ? `, ${rows.length} row(s)` : ''}${saidBy(result.json)}`;
    console.log(`${shape}  [${result.ms}ms]`);
    const wait = waitSeconds(result);
    if (wait !== undefined) state.rateLimit = { seconds: wait, at: new Date().toISOString(), during: label };
    return result;
  };

  const styles = (spec) => (flags['both-auth'] ? ['header', 'query'] : [spec.documented]);
  const attempts = {};
  for (const spec of ENDPOINT_SPECS) {
    const params = !spec.ranged ? {} : { ...ranged, fromdate: clampFrom(fromdate, todate, spec.maxDays) };
    attempts[spec.key] = {};
    for (const authStyle of styles(spec)) {
      const window = params.fromdate && params.fromdate !== fromdate ? ` ${params.fromdate} → ${todate}` : '';
      const result = await call({ label: `${spec.key}${window} (${authStyle})`, bodyKey: spec.bodyKey, path: spec.path, params, authStyle });
      if (result) attempts[spec.key][authStyle] = result;
    }
  }

  // Only on request: walking back through a long range is what spends calls.
  let scans = {};
  if (flags.scan && !state.rateLimit) {
    const wanted = typeof flags.scan === 'string' ? flags.scan.split(',').map((k) => k.trim()) : null;
    const unknown = (wanted || []).filter((k) => !ENDPOINT_SPECS.some((spec) => spec.ranged && spec.key === k));
    if (unknown.length) console.log(`  (--scan: no ranged report called ${unknown.join(', ')} — ignored)`);
    // A report whose first call already has rows needs no walking.
    const specs = ENDPOINT_SPECS.filter((spec) => spec.ranged && (!wanted || wanted.includes(spec.key)))
      .filter((spec) => !(attempts[spec.key][spec.documented]?.json?.ResponseBody?.[spec.bodyKey]?.length > 0));
    console.log('');
    console.log(`Walking back through ${fromdate} → ${todate}, newest first (${budget - state.calls} call(s) left in the budget):`);
    scans = await walk(specs, { fromdate, todate, ranged, call });
    for (const spec of specs) {
      const s = scans[spec.key];
      const answered = s.windows.filter((w) => w.empty || w.rows).length;
      console.log(s.sample
        ? `  → ${spec.key}: rows found in ${s.sample.fromdate} → ${s.sample.todate}`
        : `  → ${spec.key}: no rows in the ${answered} window(s) PXIL answered${s.pending.length ? `; ${s.pending.length} not asked, back to ${s.pending[s.pending.length - 1][0]}` : ''}`);
    }
  }

  let control = null;
  if (flags.control) {
    control = await call({ label: 'control: a path that does not exist', path: CONTROL_PATH, params: ranged, authStyle: 'header' });
  }

  console.log('');
  console.log(`${state.calls} call(s) made to PXIL, budget ${budget}.`);
  if (state.rateLimit) {
    const { seconds } = state.rateLimit;
    console.log('');
    console.log('PXIL REFUSED WITH A REQUEST LIMIT (HTTP 429). Nothing more was sent.');
    console.log(seconds
      ? `It said to wait ${seconds} seconds — do not run this again before ${new Date(Date.now() + seconds * 1000).toString()}.`
      : 'It did not say for how long. Do not run this again today without asking PXIL.');
  } else if (state.outOfBudget) {
    console.log('The budget ran out before everything was asked. Raise --budget only if PXIL has confirmed the daily limit.');
  }

  const capture = {
    tool: 'pxil-probe',
    version: 2,
    captured_at: new Date().toISOString(),
    meta: {
      baseUrl: cfg.baseUrl,
      fromdate,
      todate,
      portfolioId: cfg.portfolioId,
      tokenLength: cfg.token.length,
      tokenFingerprint: fingerprint,
      outboundIp: ip,
      host: hostname(),
      node: process.versions.node,
      capturedAt: new Date().toISOString(),
    },
    attempts,
    controls: control ? { unknown_path: control } : null,
    scan: scans,
    calls: state.calls,
    budget,
    rate_limited: state.rateLimit,
  };

  // Belt and braces: if PXIL ever echoes the token back inside a body, it must
  // not survive into a file that gets emailed around.
  const serialised = JSON.stringify(capture, null, 2).split(cfg.token).join('<token-redacted>');

  const out = typeof flags.out === 'string'
    ? resolve(flags.out)
    : resolve(`pxil-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(out, serialised, 'utf8');

  console.log('');
  console.log(`Capture written to ${out}`);
  console.log(`  ${(serialised.length / 1024).toFixed(1)} KB, no token inside, nothing written to any database.`);
  console.log('');
  console.log('Send that file back, then render the report with:');
  console.log('  node backend/scripts/pxilAnalyse.js <capture.json>');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
