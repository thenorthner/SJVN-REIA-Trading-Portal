import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { secureLogAudit } from '../src/auditEngine.js';
import { tokenFor, auth } from './helpers/reia.js';

// The Audit Trail API: every view of the trail — page, counts, chart, CSV —
// answers for the same filtered set, and taking a copy of it is on record.

const ALICE = { id: 'USR-ALICE', name: 'Alice', role: 'REIA_USER' };
const BOB = { id: 'USR-BOB', name: 'Bob', role: 'TRADING_USER' };

let auditor, trader;

function write(user, entry, at) {
  secureLogAudit({ user, traceId: entry.trace || 'TRC-T', ip: '10.0.0.1' }, entry);
  // created_at is not part of the hashed payload, so dating a row keeps the chain valid.
  db.prepare('UPDATE audit_logs SET created_at = ? WHERE rowid = (SELECT MAX(rowid) FROM audit_logs)').run(at);
}

beforeEach(() => {
  db.prepare('DELETE FROM audit_logs').run();
  auditor = tokenFor('COMPLIANCE_AUDITOR');
  trader = tokenFor('TRADING_USER');
  write(ALICE, { action: 'CREATE', module: 'REIA', entityType: 'invoice', entityId: 'INV-1', details: { invoice_no: 'SJVN/2026/0001' } }, '2026-09-01 04:00:00');
  write(ALICE, { action: 'UPDATE', module: 'REIA', entityType: 'invoice', entityId: 'INV-1', beforeValue: { status: 'DRAFT' }, afterValue: { status: 'APPROVED' }, trace: 'TRC-REQ-9' }, '2026-09-01 20:00:00');
  write(BOB, { action: 'SUBMIT_BID', module: 'TRADING', entityType: 'bid', entityId: 'BID-7', reason: 'Gate closes at 10:00' }, '2026-09-02 06:00:00');
  write(BOB, { action: 'ACCESS_DENIED', module: 'AUTH', entityType: 'route', entityId: '/api/audit-logs' }, '2026-09-03 06:00:00');
  write(ALICE, { action: 'DATA_EXPORT', module: 'SYSTEM', details: { rows: 3 } }, '2026-09-03 07:00:00');
  write(ALICE, { action: 'EXPORT_PDF', module: 'REIA', details: { report: 'billing' } }, '2026-09-04 07:00:00');
  write(BOB, { action: 'UPDATE', module: 'TRADING', entityType: 'bid', entityId: 'BID-7', reason: '=SUM(A1)', details: { note: 'said "revise"' } }, '2026-09-04 08:00:00');
});

const get = (path, q = {}, who = auditor) => request(app).get(`/api/audit-logs${path}`).query(q).set(auth(who));
const count = async (q) => (await get('', q)).body.total;

describe('audit trail — listing', () => {
  it('pages newest first behind a cursor, with the total the filters match', async () => {
    const p1 = await get('', { limit: 3 });
    expect(p1.status).toBe(200);
    expect(p1.body.total).toBe(7);
    expect(p1.body.rows.map((r) => r.action)).toEqual(['UPDATE', 'EXPORT_PDF', 'DATA_EXPORT']);
    expect(p1.body.rows[0]._rowid).toBeUndefined();
    expect(p1.body.next_cursor).toBeTruthy();

    const p2 = await get('', { limit: 3, before: p1.body.next_cursor });
    expect(p2.body.rows.map((r) => r.action)).toEqual(['ACCESS_DENIED', 'SUBMIT_BID', 'UPDATE']);
    const p3 = await get('', { limit: 3, before: p2.body.next_cursor });
    expect(p3.body.rows.map((r) => r.action)).toEqual(['CREATE']);
    expect(p3.body.next_cursor).toBeNull();
  });

  it('filters by module, person, record, request and several actions at once', async () => {
    expect(await count({ module: 'REIA' })).toBe(3);
    expect(await count({ user_id: 'USR-BOB' })).toBe(3);
    expect(await count({ entity_id: 'INV-1' })).toBe(2);
    expect(await count({ entity_type: 'bid' })).toBe(2);
    expect(await count({ trace_id: 'TRC-REQ-9' })).toBe(1);
    expect(await count({ action: 'CREATE,SUBMIT_BID' })).toBe(2);
    expect(await count({ action_type: 'CREATE' })).toBe(1);
  });

  it('filters by date range', async () => {
    expect(await count({ from_date: '2026-09-02 00:00:00', to_date: '2026-09-03 23:59:59' })).toBe(3);
  });

  it('searches the whole trail for what an auditor would type', async () => {
    expect(await count({ q: 'gate closes' })).toBe(1);
    expect(await count({ q: 'SJVN/2026/0001' })).toBe(1);
    expect(await count({ q: 'bob' })).toBe(3);
    // A literal % is text, not a wildcard that matches every row.
    expect(await count({ q: '%' })).toBe(0);
  });

  it('offers named slices for data changes, security and exports', async () => {
    expect(await count({ category: 'changes' })).toBe(1);
    expect(await count({ category: 'security' })).toBe(1);
    expect(await count({ category: 'exports' })).toBe(2);
    expect((await get('', { category: 'nonsense' })).status).toBe(400);
  });
});

describe('audit trail — facets and summary', () => {
  it('lists what the dropdowns can offer, with counts', async () => {
    const r = await get('/facets');
    expect(r.status).toBe(200);
    expect(r.body.users).toEqual([
      { user_id: 'USR-ALICE', user_name: 'Alice', user_role: 'REIA_USER', n: 4 },
      { user_id: 'USR-BOB', user_name: 'Bob', user_role: 'TRADING_USER', n: 3 },
    ]);
    expect(r.body.actions.find((a) => a.action === 'UPDATE').n).toBe(2);
    expect(r.body.modules.find((m) => m.module === 'REIA').n).toBe(3);
    expect(r.body.entity_types.map((e) => e.entity_type).sort()).toEqual(['bid', 'invoice', 'route']);
  });

  it('summarises the filtered set', async () => {
    const r = await get('/summary');
    expect(r.body).toMatchObject({ total: 7, users: 2, security: 1, exports: 2, changes: 1 });
    const bob = await get('/summary', { user_id: 'USR-BOB' });
    expect(bob.body).toMatchObject({ total: 3, users: 1, security: 1, exports: 0, changes: 0 });
  });

  it("counts days in the viewer's timezone", async () => {
    // 20:00 UTC on the 1st is 01:30 IST on the 2nd.
    const ist = await get('/summary', { tz_offset: 330 });
    expect(ist.body.by_day).toEqual([
      { day: '2026-09-01', n: 1 }, { day: '2026-09-02', n: 2 },
      { day: '2026-09-03', n: 2 }, { day: '2026-09-04', n: 2 },
    ]);
    const utc = await get('/summary', { tz_offset: 0 });
    expect(utc.body.by_day.slice(0, 2)).toEqual([{ day: '2026-09-01', n: 2 }, { day: '2026-09-02', n: 1 }]);
  });
});

describe('audit trail — export', () => {
  it('exports the filtered events as CSV, neutralising formulas', async () => {
    const r = await get('/export.csv', { module: 'TRADING' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['x-export-rows']).toBe('2');
    const lines = r.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('created_at_utc,user_name,user_role,user_id,action,module,entity_type,entity_id,reason,before_value,after_value,details,trace_id,ip_address,audit_id,record_hash');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(",'=SUM(A1),");
    expect(lines[1]).toContain('"{""note"":""said \\""revise\\""""}"');
  });

  it('puts the export itself on record, without including it in the file', async () => {
    const r = await get('/export.csv', { module: 'TRADING' });
    expect(r.text).not.toContain('Audit trail exported');
    const row = db.prepare("SELECT * FROM audit_logs WHERE action = 'DATA_EXPORT' ORDER BY rowid DESC LIMIT 1").get();
    expect(row.reason).toBe('Audit trail exported to CSV.');
    expect(JSON.parse(row.details)).toMatchObject({ rows: 2, truncated: false, filters: { module: 'TRADING' } });
  });
});

describe('audit trail — integrity and access', () => {
  it('remembers the last full verification', async () => {
    expect((await get('/integrity')).body.last).toBeNull();
    const v = await request(app).post('/api/audit-logs/verify-integrity').set(auth(auditor));
    expect(v.body).toMatchObject({ isValid: true, checked: 7 });
    const last = (await get('/integrity')).body.last;
    expect(last).toMatchObject({ isValid: true, checked: 7, by: 'COMPLIANCE_AUDITOR user' });
    expect(last.at).toBeTruthy();
  });

  it('reads a named view as a view, not as a record id', async () => {
    expect((await get('/facets')).body.actions).toBeDefined();
    const id = db.prepare('SELECT id FROM audit_logs LIMIT 1').get().id;
    expect((await get(`/${id}`)).body.id).toBe(id);
  });

  it('keeps the trail and its export to auditors', async () => {
    expect((await get('', {}, trader)).status).toBe(403);
    expect((await get('/export.csv', {}, trader)).status).toBe(403);
    expect((await get('/summary', {}, trader)).status).toBe(403);
  });

  it('lets only SJVN staff record an export in the trail', async () => {
    const seller = tokenFor('SELLER');
    const asSeller = await request(app).post('/api/audit-logs/log-export').set(auth(seller)).send({ module: 'REIA', details: { rows: 1 } });
    expect(asSeller.status).toBe(403);

    const asDesk = await request(app).post('/api/audit-logs/log-export').set(auth(trader)).send({ module: 'TRADING', details: { rows: 1 } });
    expect(asDesk.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'DATA_EXPORT' AND module = 'TRADING'").get().n).toBe(1);
  });
});
