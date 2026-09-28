#!/usr/bin/env node
/**
 * NOAR (and optionally WBES) capture tool — run this ON the whitelisted server.
 *
 *   node noar-probe.mjs [fromdate] [todate]
 *
 * NOAR is reached through a Grid India gateway that answers the IP whitelisted
 * for SJVN (the test server's public address, 49.50.97.173). A developer machine
 * is not that address, so this file is deliberately standalone — the same shape
 * as tools/pxil-probe/pxil-probe.mjs, for the same reason:
 *
 *   - no npm dependencies, no repo checkout, no node_modules
 *   - never opens the platform database, never runs a migration
 *   - writes nothing except the capture file
 *
 * WHAT IT ANSWERS
 *   1. Whether the server's IP gets through at all, and what a refusal looks
 *      like (a gateway 403 reads nothing like NOAR's own 401).
 *   2. Which host this key belongs to. The pair carries no environment marker,
 *      so both are tried: PRODUCTION external.noar.in and TEST devdr.noar.in:84.
 *   3. Whether the one-month range limit in the guide is enforced, and how.
 *   4. The undocumented Status / BidStatus / CongestionStatus / PaymentStatus
 *      codes. The platform deliberately does not act on them because PwC has
 *      not published the enumeration; a capture of real applications lets us ask
 *      with evidence — "what does Status 4 mean on application X" beats "please
 *      send the list".
 *
 * CREDENTIALS ARE NEVER RECORDED. NOAR takes the key in the query string, so no
 * URL is written to the capture either — only the path and the non-secret body.
 * An 8-hex SHA-256 fingerprint of each credential goes in instead, which is
 * enough to tell one key from another without carrying it.
 *
 * The capture holds SJVN's real open-access applications. It is internal: send
 * it to the project, not onward to NOAR or PwC. What goes to them is whatever
 * question the capture raises.
 *
 * Usage
 *   node noar-probe.mjs                        last 31 days, both hosts
 *   node noar-probe.mjs 2026-08-01 2026-08-31  an explicit range
 *   --env=<path>          read the NOAR_ and WBES_ values from this .env
 *                         (default: ./backend/.env, then ./.env)
 *   --key=<key>           NOAR API key   (else NOAR_API_KEY)
 *   --secret=<secret>     NOAR API secret (else NOAR_API_SECRET)
 *   --host=production|test|both            default both
 *   --base=<url>          probe this host instead (a mock, or a moved gateway)
 *   --wbes-base=<url>     WBES base or full endpoint URL (else WBES_BASE_URL)
 *   --wbes-key=<key>      else WBES_API_KEY
 *   --wbes-user=<name>    else WBES_USERNAME
 *                         (the acronym is not a flag: the tool tries the
 *                          candidates and the gateway decides)
 *   --out=<path>          where to write the capture
 *   --no-ip               skip the outbound-IP echo (one call to ifconfig.me)
 *   --timeout=<ms>        per-request timeout, default 60000
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';

const NOAR_HOSTS = {
  production: 'https://external.noar.in',
  test: 'https://devdr.noar.in:84',
};
const REPORT_PATH = '/api/external-services-api/Report/ApplicantBilateralApplicationData';
const WBES_PREFIX = '/reports/1.0/WebAccessAPI';

/**
 * Grid India hand out the full endpoint URL, query string and all. Cut it back
 * to the origin and prefix so the tool can build either endpoint from it.
 */
const wbesBase = (value) => String(value || '').trim().split(/[?#]/)[0].replace(/\/reports\/.*$/i, '').replace(/\/+$/, '');

/**
 * Acronym candidates, in the order worth trying.
 *
 * Asked for SJVN's registered utility acronym, Grid India answered "SJVN
 * Limited" — the entity's name, where every acronym in the guide is a token
 * (BIHAR_STATE, BSPHCL, NEA_Bihar). The username they issued is `usr_SJVNL` and
 * ISET's block-wise report calls the trader SJVNL, so SJVNL is the better bet.
 * An empty list is tried too: the guide shows `"UtilAcronymList": []` as a valid
 * form, which ought to mean "whatever this credential is scoped to" — and if it
 * does, it is the right thing to configure, because it cannot go stale.
 *
 * Whichever returns data wins. Guessing is the one thing not on offer: a wrong
 * acronym answers with an empty list, which reads exactly like a day on which
 * nothing was scheduled.
 */
const WBES_ACRONYM_CANDIDATES = [['SJVNL'], ['SJVN Limited'], ['SJVN'], []];

/* ------------------------------------------------------------------- args */

const argv = process.argv.slice(2);
const flag = (name, fallback = '') => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const positional = argv.filter((a) => !a.startsWith('--'));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));

const fromDate = positional[0] || daysAgo(31);
const toDate = positional[1] || iso(new Date());
for (const d of [fromDate, toDate]) {
  if (!ISO.test(d)) {
    console.error(`Dates must be YYYY-MM-DD; got "${d}".`);
    process.exit(2);
  }
}

const timeoutMs = Number(flag('timeout', '60000')) || 60000;

/* -------------------------------------------------------------------- env */

/**
 * Read a .env without a dependency, and say where it looked.
 *
 * The deployed bundle on the server has no git checkout and no node_modules, so
 * dotenv is not available there. Paths are relative to the folder the tool is
 * run from, which is how the PXIL probe already works: cd to the deploy folder
 * and the deployed .env is found with nothing pasted on the command line.
 */
function loadEnvFile() {
  const candidates = flag('env') ? [flag('env')] : [join('backend', '.env'), '.env'];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const values = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      values[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return { path, values, checked: candidates };
  }
  return { path: null, values: {}, checked: candidates };
}

const env = loadEnvFile();
const fromEnv = (key) => process.env[key] || env.values[key] || '';

const noarKey = flag('key') || fromEnv('NOAR_API_KEY');
const noarSecret = flag('secret') || fromEnv('NOAR_API_SECRET');

if (!noarKey || !noarSecret) {
  console.error('No NOAR credentials found.');
  console.error(`  .env looked for: ${env.checked.join(', ')}`);
  console.error(`  .env used:       ${env.path || 'none found'}`);
  console.error(`  NOAR_API_KEY:    ${noarKey ? 'present' : 'missing'}`);
  console.error(`  NOAR_API_SECRET: ${noarSecret ? 'present' : 'missing'}`);
  console.error('Pass --key= and --secret=, or point --env= at a file that has them.');
  process.exit(2);
}

const fingerprint = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 8);

/**
 * The claims inside the secret, read without verifying the signature — NOAR is
 * the verifier, not us. Worth recording because they say which login the pair
 * belongs to and when it lapses, and because a key that was regenerated on the
 * portal shows up here as a newer `iat` than the one we were given.
 */
function tokenClaims(secret) {
  const parts = String(secret).split('.');
  if (parts.length !== 3) return { readable: false };
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const details = (() => { try { return JSON.parse(p.UserDetails); } catch { return {}; } })();
    const groupsid = p['http://schemas.microsoft.com/ws/2008/06/identity/claims/groupsid'];
    return {
      readable: true,
      issuer: p.iss ?? null,
      audience: p.aud ?? null,
      issued_at: p.iat ? new Date(p.iat * 1000).toISOString() : null,
      expires_at: p.exp ? new Date(p.exp * 1000).toISOString() : null,
      expired: p.exp ? p.exp * 1000 <= Date.now() : null,
      login_username: details.Username ?? null,
      role: details.Role ?? null,
      // Proof the pair belongs together: NOAR puts the API key in this claim.
      key_matches_secret: groupsid ? groupsid === noarKey : null,
    };
  } catch {
    return { readable: false };
  }
}

/* ------------------------------------------------------------------ calls */

const capture = {
  tool: 'noar-probe',
  version: 1,
  run_at: new Date().toISOString(),
  host: hostname(),
  range: { from: fromDate, to: toDate },
  env_file: env.path,
  credentials: {
    noar_key_fp: fingerprint(noarKey),
    noar_secret_fp: fingerprint(noarSecret),
    noar_token: tokenClaims(noarSecret),
  },
  outbound_ip: null,
  calls: [],
};

async function timedFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const text = await resp.text();
    return {
      status: resp.status,
      content_type: resp.headers.get('content-type') || null,
      elapsed_ms: Date.now() - started,
      body: text,
    };
  } catch (err) {
    return {
      status: null,
      elapsed_ms: Date.now() - started,
      error: err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Record one call. A body that parses as JSON is stored parsed, so the analysis
 * can read fields instead of re-parsing; anything else (a gateway's HTML, an
 * empty 403) is stored as text, truncated, because that is evidence too.
 */
function record(label, target, requestBody, result) {
  const entry = {
    label,
    target,                      // host + path, never the query string
    request_body: requestBody,   // no credential lives in the body
    status: result.status,
    content_type: result.content_type ?? null,
    elapsed_ms: result.elapsed_ms,
  };
  if (result.error) entry.error = result.error;
  if (result.body != null) {
    try {
      entry.json = JSON.parse(result.body);
    } catch {
      entry.text = result.body.slice(0, 2000);
      entry.text_truncated = result.body.length > 2000;
    }
  }
  capture.calls.push(entry);
  const shape = entry.json ? 'JSON' : entry.text ? 'non-JSON' : 'no body';
  console.log(`  ${label.padEnd(34)} ${String(entry.status ?? 'ERR').padEnd(5)} ${String(entry.elapsed_ms).padStart(6)}ms  ${shape}${entry.error ? ` — ${entry.error}` : ''}`);
}

const toNoarDate = (isoDate) => {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};

async function probeNoar(hostKey) {
  const base = NOAR_HOSTS[hostKey];
  console.log(`\nNOAR — ${hostKey} (${base})`);
  // isRejected both ways: the guide does not say whether false means "approved
  // only" or "everything", and the difference decides whether a rejected
  // application can be reconciled at all.
  for (const isRejected of [false, true]) {
    const body = { FromDate: toNoarDate(fromDate), ToDate: toNoarDate(toDate), isRejected };
    const url = `${base}${REPORT_PATH}?TP_CLIENT_KEY=${encodeURIComponent(noarKey)}`;
    const result = await timedFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${noarSecret}`,
      },
      body: JSON.stringify(body),
    });
    record(`${hostKey} isRejected=${isRejected}`, `${base}${REPORT_PATH}`, body, result);
  }
  // One deliberately over-long range: the guide says a month is the maximum, and
  // the platform chunks on that assumption. Worth knowing whether NOAR refuses
  // it, truncates it silently, or does not care.
  const wide = { FromDate: toNoarDate(daysAgo(120)), ToDate: toNoarDate(toDate), isRejected: false };
  const wideResult = await timedFetch(`${base}${REPORT_PATH}?TP_CLIENT_KEY=${encodeURIComponent(noarKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${noarSecret}` },
    body: JSON.stringify(wide),
  });
  record(`${hostKey} 120-day range`, `${base}${REPORT_PATH}`, wide, wideResult);

  // A control: a deliberately wrong key, so a refusal can be told apart from
  // "the IP is blocked". Without it, one 403 looks like every other 403.
  const controlResult = await timedFetch(`${base}${REPORT_PATH}?TP_CLIENT_KEY=deliberately-invalid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer deliberately-invalid' },
    body: JSON.stringify({ FromDate: toNoarDate(fromDate), ToDate: toNoarDate(toDate), isRejected: false }),
  });
  record(`${hostKey} invalid-credential control`, `${base}${REPORT_PATH}`, { control: true }, controlResult);
}

async function probeWbes() {
  const base = wbesBase(flag('wbes-base') || fromEnv('WBES_BASE_URL'));
  const key = flag('wbes-key') || fromEnv('WBES_API_KEY');
  const user = flag('wbes-user') || fromEnv('WBES_USERNAME');
  if (!base) {
    console.log('\nWBES — skipped: no base URL.');
    capture.wbes_skipped = 'no base URL supplied';
    return;
  }
  if (!key || !user) {
    console.log(`\nWBES — skipped: ${!key ? 'no API key' : 'no username'}. The guide states the username must match the credential the key was issued against.`);
    capture.wbes_skipped = !key ? 'no API key' : 'no username';
    return;
  }
  console.log(`\nWBES — ${base}`);
  capture.credentials.wbes_key_fp = fingerprint(key);
  const day = daysAgo(2);
  const [y, m, d] = day.split('-');
  const wbesDate = `${d}-${m}-${y}`;

  const call = async (endpoint, body, { keyInQuery }) => {
    const url = `${base}${WBES_PREFIX}/${endpoint}${keyInQuery ? `?apikey=${encodeURIComponent(key)}` : ''}`;
    return timedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': key },
      body: JSON.stringify(body),
    });
  };

  // First the revision number: it takes only a date and a username, so whatever
  // it answers is about the URL, the key, the username and the whitelisting, and
  // cannot be muddied by the unconfirmed acronym. Both key styles, because Grid
  // India documented the query form while the guide also allows the header.
  for (const keyInQuery of [true, false]) {
    const body = { Date: wbesDate, UserName: user };
    const result = await call('GetLatestFullSchdRevNo', body, { keyInQuery });
    record(`wbes revision-no key-in-${keyInQuery ? 'query' : 'header'}`, `${base}${WBES_PREFIX}/GetLatestFullSchdRevNo`, body, result);
  }

  // Then the schedule itself, once per acronym candidate. WBES answers a bad
  // credential with WBES-4xx inside an HTTP 200, so the analysis reads
  // ResponseStatus.Code, not the status line.
  for (const candidate of WBES_ACRONYM_CANDIDATES) {
    const body = { Date: wbesDate, SchdRevNo: -1, UserName: user, UtilAcronymList: candidate };
    const result = await call('GetUtilityExternalSharedData', body, { keyInQuery: true });
    record(`wbes schedule acronym=${candidate.length ? candidate.join('+') : '(empty list)'}`, `${base}${WBES_PREFIX}/GetUtilityExternalSharedData`, body, result);
  }
  console.log('  (a candidate that answers WBES-200 with GroupWiseDataList rows is the acronym to configure)');
}

/* ------------------------------------------------------------------- main */

console.log(`NOAR probe — ${fromDate} to ${toDate}`);
console.log(`  key fingerprint    ${fingerprint(noarKey)}`);
console.log(`  secret fingerprint ${fingerprint(noarSecret)}`);
const claims = capture.credentials.noar_token;
if (claims.readable) {
  console.log(`  token              ${claims.login_username} / ${claims.role}, ${claims.issued_at?.slice(0, 10)} → ${claims.expires_at?.slice(0, 10)}${claims.expired ? ' (EXPIRED)' : ''}`);
  console.log(`  key in secret      ${claims.key_matches_secret === true ? 'matches — one pair' : claims.key_matches_secret === false ? 'DOES NOT MATCH the key given' : 'not stated'}`);
}
console.log(`  .env used          ${env.path || 'none (values from the environment or flags)'}`);

if (!has('no-ip')) {
  // The address NOAR actually sees, which is the thing Grid India whitelists.
  const ip = await timedFetch('https://ifconfig.me/ip', { method: 'GET' });
  capture.outbound_ip = (ip.body || '').trim() || null;
  console.log(`  outbound IP        ${capture.outbound_ip || `unknown (${ip.error || ip.status})`}`);
}

if (flag('base')) {
  NOAR_HOSTS.override = flag('base').replace(/\/$/, '');
  await probeNoar('override');
} else {
  const which = flag('host', 'both').toLowerCase();
  const hosts = which === 'both' ? ['production', 'test'] : [which];
  for (const h of hosts) {
    if (!NOAR_HOSTS[h]) {
      console.error(`Unknown --host=${h}. Use production, test or both.`);
      process.exit(2);
    }
    await probeNoar(h);
  }
}
await probeWbes();

const out = flag('out') || `noar-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify(capture, null, 2));
console.log(`\nWrote ${out} — ${capture.calls.length} call(s) recorded, no credential in it.`);
console.log('It holds real application data: send it to the project, not onward to NOAR or PwC.');
