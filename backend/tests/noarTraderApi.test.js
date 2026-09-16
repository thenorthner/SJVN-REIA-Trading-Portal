/**
 * NOAR Trader API: the bilateral application pull, against a real socket.
 *
 * What matters here is not that the mapping compiles but that the request NOAR
 * actually receives is the one its guide specifies — key in the query string,
 * secret as the bearer token, dates as DD/MM/YYYY — and that what comes back is
 * reconciled against the desk's own record rather than overwriting it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';
import {
  syncBilateralApplications,
  parseNoarDate,
  toNoarDate,
  splitRange,
  getNoarTraderConfig,
} from '../src/services/noarTraderService.js';

const ENV_KEYS = ['NOAR_API_ENABLED', 'NOAR_API_KEY', 'NOAR_API_SECRET', 'NOAR_API_BASE_URL', 'NOAR_TRADER_NAME', 'NOAR_API_ENV'];
const APP_NO = 'SJVN010926WR001';
const APPROVAL_NO = 'WR/2026/1201/D';

let received = [];
let respondWith = null;
let server;
let origin;
let trader;
let viewer;
let TX;

/** One application in the shape section 3.1.1 of the guide documents. */
function application(overrides = {}) {
  return {
    Id: 11434,
    ApplicationNo: APP_NO,
    ApplicantId: '86b6945f-6dac-47d0-a7f2-c40736c33bc9',
    ApplicantName: 'SJVN LIMITED',
    SellerId: '8f4a5aed-cd86-4c5a-ba56-e760c5c1baf6',
    BuyerId: 'eb87f5eb-a4f4-4fbc-9bce-3e72ec0ef4f2',
    BuyerStateId: 10,
    SellerStateId: 2,
    SellerName: 'SJVN LIMITED',
    BuyerName: 'BSES YAMUNA POWER LIMITED',
    FromDate: '09/09/2026',
    ToDate: '09/09/2026',
    PrimaryRouteId: 21,
    PrimaryRouteName: 'SR-WR-NR',
    AlternateRouteId: 0,
    AlternateRouteName: '',
    ReTypeId: 0,
    CreatedOn: '2026-09-08T08:39:07.411619',
    RevisionNo: 0,
    AppliedMWH: 1488,
    ApprovedMWH: 1488,
    ScheduledMWH: 1488,
    BidStatus: 0,
    CongestionStatus: 30,
    ApprovalNo: APPROVAL_NO,
    IsAlternateRouteEnabled: 0,
    Status: 50,
    PaymentStatus: 0,
    ApplicationApprovedSummary: [{ Id: 141547, FromDate: 20260909, ToDate: 20260909, FromBlock: 1, ToBlock: 96, Mw: 62, Mwh: 1488, ApplicationId: 0 }],
    ApplicationAppliedSummary: [{ Id: 412671, FromDate: 20260909, ToDate: 20260909, FromBlock: 1, ToBlock: 96, Mw: 62, Mwh: 1488, ApplicationId: 0, RevisionNo: 0 }],
    ...overrides,
  };
}

const okBody = (apps) => ({
  ResponseBody: apps,
  Code: 'NOAR-200',
  Message: 'Get SLDC Application dashboardView has been executed successfully',
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ url: req.url, method: req.method, headers: { ...req.headers }, body: body ? JSON.parse(body) : null });
      if (respondWith) return respondWith(req, res, body);
      const isRejected = body ? JSON.parse(body).isRejected : false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(okBody(isRejected ? [] : [application()])));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received = [];
  respondWith = null;
  db.prepare('DELETE FROM noar_api_applications').run();
  db.prepare('DELETE FROM noar_approval_entries WHERE application_no = ?').run(APP_NO);
  trader = tokenFor('TRADING_USER');
  viewer = tokenFor('MANAGEMENT');

  TX = newId('BLT');
  db.prepare(`INSERT INTO bilateral_transactions
    (id, counterparty, transaction_type, oa_type, start_date, end_date, quantum_mw, tariff_per_unit,
     noar_application_no, noar_status)
    VALUES (?, 'BSES YAMUNA POWER LIMITED', 'SALE', 'STOA', '2026-09-09', '2026-09-09', 62, 4.2, ?, 'SUBMITTED')`)
    .run(TX, APP_NO);

  process.env.NOAR_API_ENABLED = 'true';
  process.env.NOAR_API_KEY = 'test-key-529ec';
  process.env.NOAR_API_SECRET = 'test-secret-jwt';
  process.env.NOAR_TRADER_NAME = 'SJVN LIMITED';
  process.env.NOAR_API_BASE_URL = origin;
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  // Pulled applications point at the transaction, so they go first or the
  // delete fails on the foreign key and the fixture leaks into the next test.
  db.prepare('DELETE FROM noar_api_applications').run();
  db.prepare('DELETE FROM bilateral_transactions WHERE id = ?').run(TX);
});

describe('dates', () => {
  it('sends DD/MM/YYYY and reads back every shape NOAR returns', () => {
    expect(toNoarDate('2026-09-09')).toBe('09/09/2026');
    expect(parseNoarDate('09/08/2022')).toBe('2022-08-09');
    expect(parseNoarDate(20260909)).toBe('2026-09-09');
    expect(parseNoarDate('2022-08-08T08:39:07.411619')).toBe('2022-08-08');
    // Nothing is guessed from an unrecognised value.
    expect(parseNoarDate('next Tuesday')).toBeNull();
    expect(parseNoarDate('')).toBeNull();
  });

  it('chunks a range longer than a month into month-sized windows', () => {
    const windows = splitRange('2026-01-01', '2026-03-15');
    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual({ fromDate: '2026-01-01', toDate: '2026-01-31' });
    expect(windows.at(-1).toDate).toBe('2026-03-15');
    // Windows abut without overlapping — an overlap would double-count applications.
    expect(windows[1].fromDate).toBe('2026-02-01');
  });
});

describe('the request NOAR receives', () => {
  it('carries the key in the query string and the secret as the bearer token', async () => {
    await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });

    expect(received).toHaveLength(1);
    const req = received[0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/external-services-api/Report/ApplicantBilateralApplicationData?TP_CLIENT_KEY=test-key-529ec');
    expect(req.headers.authorization).toBe('Bearer test-secret-jwt');
    expect(req.headers.name).toBe('SJVN LIMITED');
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.body).toEqual({ FromDate: '01/09/2026', ToDate: '30/09/2026', isRejected: false });
  });

  it('asks for rejected applications in a second pass, because NOAR only returns them when asked', async () => {
    await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30' });
    expect(received.map((r) => r.body.isRejected)).toEqual([false, true]);
  });
});

describe('what comes back', () => {
  it('lands the application against the transaction it belongs to', async () => {
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    expect(r.ok).toBe(true);
    expect(r.applications_received).toBe(1);
    expect(r.matched).toBe(1);

    const row = db.prepare('SELECT * FROM noar_api_applications WHERE application_no = ?').get(APP_NO);
    expect(row).toMatchObject({
      approval_no: APPROVAL_NO,
      transaction_id: TX,
      applied_mwh: 1488,
      approved_mwh: 1488,
      from_date: '2026-09-09',
      to_date: '2026-09-09',
      primary_route: 'SR-WR-NR',
    });
    // The block summaries survive the round trip with their dates converted.
    expect(JSON.parse(row.applied_summary_json)[0]).toMatchObject({ from_block: 1, to_block: 96, mw: 62, from_date: '2026-09-09' });
    // Undocumented code, stored as received rather than translated into a status.
    expect(row.status_code).toBe(50);
  });

  it('re-syncing the same application updates the row instead of duplicating it', async () => {
    await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    respondWith = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(okBody([application({ ApprovedMWH: 1200, ScheduledMWH: 1200 })])));
    };
    const second = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });

    expect(second.rows_created).toBe(0);
    expect(second.rows_updated).toBe(1);
    const rows = db.prepare('SELECT * FROM noar_api_applications WHERE application_no = ?').all(APP_NO);
    expect(rows).toHaveLength(1);
    expect(rows[0].approved_mwh).toBe(1200);
  });

  it('keeps a new revision as its own row — NOAR supersedes rather than edits', async () => {
    await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    respondWith = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(okBody([application({ RevisionNo: 1, ApprovedMWH: 960 })])));
    };
    await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });

    const rows = db.prepare('SELECT revision_no, approved_mwh FROM noar_api_applications WHERE application_no = ? ORDER BY revision_no').all(APP_NO);
    expect(rows).toEqual([
      { revision_no: 0, approved_mwh: 1488 },
      { revision_no: 1, approved_mwh: 960 },
    ]);
  });

  it('writes the approval into the NOAR Approvals register', async () => {
    await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    const entry = db.prepare('SELECT * FROM noar_approval_entries WHERE application_no = ?').get(APP_NO);
    expect(entry).toMatchObject({
      approval_no: APPROVAL_NO,
      applicant_name: 'SJVN LIMITED',
      applied_capacity_mwh: 1488,
      approved_capacity_mwh: 1488,
    });
    // No approval date is published on this report, and none is invented.
    expect(entry.approval_date).toBe('');
  });
});

describe('reconciliation', () => {
  it('reports the approval the desk has not recorded, and does not record it itself', async () => {
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    const kinds = r.differences[0].differences.map((d) => d.kind);
    expect(kinds).toContain('APPROVAL_NOT_RECORDED');
    expect(kinds).toContain('STATUS_BEHIND');

    // The transaction is untouched: an approval workflow is not moved by a
    // report pull, only by the desk acting on what it says.
    const tx = db.prepare('SELECT noar_status, noar_contract_no FROM bilateral_transactions WHERE id = ?').get(TX);
    expect(tx).toEqual({ noar_status: 'SUBMITTED', noar_contract_no: null });
  });

  it('flags an approval number that disagrees with the one on file', async () => {
    db.prepare("UPDATE bilateral_transactions SET noar_contract_no = 'WR/2026/9999/D', noar_status = 'APPROVED' WHERE id = ?").run(TX);
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    const diff = r.differences[0].differences.find((d) => d.kind === 'APPROVAL_NO_MISMATCH');
    expect(diff).toMatchObject({ noar: APPROVAL_NO, platform: 'WR/2026/9999/D' });
  });

  it('flags a quantum approved short of what was applied for', async () => {
    respondWith = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(okBody([application({ ApprovedMWH: 744 })])));
    };
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    expect(r.differences[0].differences.find((d) => d.kind === 'PARTIAL_APPROVAL')).toMatchObject({ noar: 744, platform: 1488 });
  });

  it('flags a rejection NOAR knows about and the platform does not', async () => {
    respondWith = (req, res, body) => {
      const isRejected = JSON.parse(body).isRejected;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(okBody(isRejected ? [application({ ApprovalNo: '', ApprovedMWH: 0, Status: 60 })] : [])));
    };
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30' });
    expect(r.differences[0].differences.map((d) => d.kind)).toContain('REJECTED_AT_NOAR');
  });

  it('reports an application NOAR holds that the platform has never filed', async () => {
    respondWith = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(okBody([application({ ApplicationNo: 'SJVN-UNKNOWN-001', ApprovalNo: 'WR/2026/7777/D' })])));
    };
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    expect(r.unmatched).toBe(1);
    expect(r.differences[0].differences[0].kind).toBe('NOT_ON_PLATFORM');
  });
});

describe('failures', () => {
  it('surfaces a NOAR error code instead of treating it as an empty month', async () => {
    respondWith = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ResponseBody: [], Code: 'NOAR-403', Message: 'Unauthorized access request' }));
    };
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('NOAR-403');
  });

  it('says so when the credentials or the IP whitelist are the likely cause', async () => {
    respondWith = (req, res) => {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
    };
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/whitelist/i);
  });

  it('refuses a backwards range before calling NOAR at all', async () => {
    const r = await syncBilateralApplications({ fromDate: '2026-09-30', toDate: '2026-09-01' });
    expect(r.ok).toBe(false);
    expect(received).toHaveLength(0);
  });
});

describe('stub mode', () => {
  it('runs against a sample and says that is what it did, with no credentials', async () => {
    delete process.env.NOAR_API_ENABLED;
    delete process.env.NOAR_API_KEY;
    delete process.env.NOAR_API_SECRET;
    const r = await syncBilateralApplications({ fromDate: '2026-09-01', toDate: '2026-09-30', includeRejected: false });

    expect(received).toHaveLength(0);
    expect(r.mode).toBe('STUB');
    expect(r.note).toMatch(/not configured/);
    // The sample is keyed off a real transaction, so the matching path is exercised.
    expect(r.matched).toBe(1);
    expect(db.prepare('SELECT source_env FROM noar_api_applications WHERE application_no = ?').get(APP_NO).source_env).toBe('STUB');
  });

  it('defaults to the test host until PRODUCTION is chosen', () => {
    delete process.env.NOAR_API_BASE_URL;
    expect(getNoarTraderConfig().baseUrl).toBe('https://devdr.noar.in:84');
    process.env.NOAR_API_ENV = 'PRODUCTION';
    expect(getNoarTraderConfig().baseUrl).toBe('https://external.noar.in');
  });
});

describe('API', () => {
  const post = (path, body, who = trader) => request(app).post(path).set(auth(who)).send(body);
  const get = (path, who = viewer) => request(app).get(path).set(auth(who));

  it('syncs, lists and reconciles over HTTP', async () => {
    const sync = await post('/api/noar-api/sync', { from_date: '2026-09-01', to_date: '2026-09-30', include_rejected: false });
    expect(sync.status).toBe(200);
    expect(sync.body.applications_received).toBe(1);

    const list = await get('/api/noar-api/applications');
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ application_no: APP_NO, transaction_id: TX, is_rejected: false });
    expect(list.body[0].applied_summary[0].mwh).toBe(1488);

    const one = await get(`/api/noar-api/applications/${APP_NO}`);
    expect(one.status).toBe(200);
    expect(one.body.transaction.id).toBe(TX);
    expect(one.body.differences.map((d) => d.kind)).toContain('APPROVAL_NOT_RECORDED');

    const recon = await get('/api/noar-api/reconciliation');
    expect(recon.body.applications_with_differences).toBe(1);
    expect(recon.body.by_kind.STATUS_BEHIND).toBe(1);
  });

  it('drops a difference once the desk records the approval, without another pull', async () => {
    await post('/api/noar-api/sync', { from_date: '2026-09-01', to_date: '2026-09-30', include_rejected: false });
    db.prepare("UPDATE bilateral_transactions SET noar_contract_no = ?, noar_status = 'APPROVED' WHERE id = ?").run(APPROVAL_NO, TX);

    const recon = await get('/api/noar-api/reconciliation');
    expect(recon.body.applications_with_differences).toBe(0);
    expect(received).toHaveLength(1);
  });

  it('keeps a dry run out of the database', async () => {
    const r = await post('/api/noar-api/sync', { from_date: '2026-09-01', to_date: '2026-09-30', include_rejected: false, dry_run: true });
    expect(r.body.applications_received).toBe(1);
    expect(db.prepare('SELECT COUNT(*) c FROM noar_api_applications').get().c).toBe(0);
  });

  it('rejects a missing date range and refuses a read-only role the sync', async () => {
    expect((await post('/api/noar-api/sync', { from_date: '2026-09-01' })).status).toBe(400);
    expect((await post('/api/noar-api/sync', { from_date: '2026-09-01', to_date: '2026-09-30' }, viewer)).status).toBe(403);
  });

  it('reports configuration without ever returning the secret', async () => {
    const r = await get('/api/noar-api/status');
    expect(r.body).toMatchObject({ live: true, api_key_set: true, api_secret_set: true, trader_name: 'SJVN LIMITED' });
    expect(JSON.stringify(r.body)).not.toContain('test-secret-jwt');
    expect(JSON.stringify(r.body)).not.toContain('test-key-529ec');
  });
});
