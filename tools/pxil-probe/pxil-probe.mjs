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
 * as APITokenNo in the query string. Both styles are tried on every endpoint
 * regardless, so the day PXIL upgrades those two the capture shows it.
 *
 * backend/tests/pxilProbeReport.test.js pins this list against the backend's
 * own buildEndpoints(), so the two copies cannot drift apart unnoticed.
 */
export const ENDPOINT_SPECS = [
  { key: 'tam-gtam', path: 'tam-gtam', ranged: true, bodyKey: 'TAMGTAM', documented: 'header' },
  { key: 'tam-gtam-slot-wise', path: 'tam-gtam-slot-wise', ranged: true, bodyKey: 'TAMGTAM', documented: 'header' },
  { key: 'format-d', path: 'format-d', ranged: true, bodyKey: 'Trades', documented: 'header' },
  { key: 'trade-margin', path: 'trade-margin', ranged: true, bodyKey: 'TradeMargin', documented: 'header' },
  { key: 'member-dor', path: 'member-dor', ranged: true, bodyKey: 'DOR', documented: 'query' },
  { key: 'reverse-auction', path: 'reverse-auction/l1-summary', ranged: false, bodyKey: null, documented: 'query' },
];

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
    console.error('Production and staging have different tokens. Production is');
    console.error('https://dashboard.pxil.in; the token that has been in backend/.env is staging\'s.');
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

  const attempts = {};
  for (const spec of ENDPOINT_SPECS) {
    const params = spec.ranged ? ranged : {};
    attempts[spec.key] = {};
    for (const authStyle of ['header', 'query']) {
      process.stdout.write(`  ${spec.key} (${authStyle}) … `);
      const result = await probe({ ...cfg, path: spec.path, params, authStyle, timeoutMs });
      attempts[spec.key][authStyle] = result;
      const rows = result.json?.ResponseBody?.[spec.bodyKey];
      const shape = result.error ? result.error
        : result.ip_not_allowed ? `403 IP not whitelisted (saw ${result.ip_not_allowed})`
          : `HTTP ${result.status}${Array.isArray(rows) ? `, ${rows.length} row(s)` : ''}`;
      console.log(`${shape}  [${result.ms}ms]`);
    }
  }

  const capture = {
    tool: 'pxil-probe',
    version: 1,
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
