import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { beforeEach } from 'vitest';

// Point the database at a throwaway file, unique per worker, before any test
// imports src/db/index.js — that module opens its connection at import time.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sjvn-test-'));
process.env.SJVN_DB_PATH = path.join(dir, `platform-${process.env.VITEST_WORKER_ID || '0'}.db`);
// Files a test uploads land beside its database, not in backend/uploads.
process.env.SJVN_REC_DOC_DIR = path.join(dir, 'rec-lots');
process.env.SJVN_DISPUTE_DOC_DIR = path.join(dir, 'dispute-evidence');
process.env.JWT_SECRET = 'test-secret';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';

// The worker exits with the file still open; removing the directory here keeps
// temp space from filling up across runs.
process.on('exit', () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── The intermittent failure (PT #22), and the probe that found it ──────────
//
// About one full run in fifteen, with several suites running at once, a test got
// a response that did not belong to its request: a 404 for a row that was in its
// own database. The cause, proven on 16 Sep 2026:
//
// supertest opens a server per request with listen(0), which listens on every
// interface, IPv6 included, and then dials it at 127.0.0.1. The kernel can give
// that server a port that another process already holds on 127.0.0.1 alone — the
// IEX and NOAR mock servers in iexWire and noarTraderApi listen exactly so — and
// macOS delivers a 127.0.0.1 connection to the more specific loopback bind. The
// request then reaches the other process's mock, which answers 404. Holding 4,000
// loopback servers in one process, 1,198 of 20,000 such requests from another
// were answered by the wrong process. The organic failure carried the same
// signature: a 404 from a server that was not this platform.
//
// The fix: dial the server at [::1] when it listens on IPv6 as well. A server
// bound to 127.0.0.1 cannot receive a [::1] connection, so a port shared that way
// is harmless — in the same 20,000 requests, none reached the wrong process. A
// host without IPv6 listens on 0.0.0.0 and keeps dialling 127.0.0.1.
const require = createRequire(import.meta.url);
const SupertestTest = require('supertest/lib/test.js');
const originalServerAddress = SupertestTest.prototype.serverAddress;
SupertestTest.prototype.serverAddress = function serverAddressOnIpv6Loopback(app, reqPath) {
  const url = originalServerAddress.call(this, app, reqPath);
  const addr = typeof app.address === 'function' ? app.address() : null;
  return addr && addr.family === 'IPv6' && addr.address === '::'
    ? url.replace('://127.0.0.1:', '://[::1]:')
    : url;
};

// Kept as a tripwire. Each response says which process served it; a response from
// anywhere else is reported at once, and a failing test prints the requests it
// made, so anything like this again leaves evidence instead of a bare assertion.
const recent = [];
const PROBE_LOG = process.env.SJVN_FLAKE_PROBE_LOG || path.join(os.tmpdir(), 'sjvn-flake-probe.log');
const originalAssert = SupertestTest.prototype.assert;
SupertestTest.prototype.assert = function assertWithProbe(resError, res, fn) {
  const servedBy = res?.headers?.['x-served-by-pid'];
  let body = '';
  try { body = JSON.stringify(res?.body ?? res?.text ?? '').slice(0, 300); } catch { body = '[unserialisable]'; }
  const entry = { method: this.method, url: this.url, status: res?.status ?? null, servedBy: servedBy ?? null, error: resError?.code || null, body };
  recent.push(entry);
  if (recent.length > 25) recent.shift();
  if (servedBy && servedBy !== String(process.pid)) {
    const line = `[flake-probe] CROSS-PROCESS RESPONSE: ${this.method} ${this.url} answered by pid ${servedBy}, asked by pid ${process.pid} (status ${entry.status}) ${body}`;
    console.error(line);
    // Vitest shows a passing test's output only when it fails, and a stray
    // response can land in a test that still passes — so it is also kept here.
    try { fs.appendFileSync(PROBE_LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ }
  }
  return originalAssert.call(this, resError, res, fn);
};

beforeEach(({ task, onTestFailed }) => {
  recent.length = 0;
  onTestFailed(() => {
    const lines = recent.map((r) => `  ${r.method} ${r.url} → ${r.status}${r.error ? ` (${r.error})` : ''} served by pid ${r.servedBy} ${r.body}`);
    console.error(`[flake-probe] "${task.name}" failed in pid ${process.pid}; its last ${recent.length} request(s):\n${lines.join('\n')}`);
  });
});
