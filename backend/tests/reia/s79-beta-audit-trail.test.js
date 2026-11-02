import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// The flag is read when the modules load, so it is set before the imports.
vi.hoisted(() => { process.env.REIA_BETA = '1'; });

const { app } = await import('../../src/server.js');
const { default: db } = await import('../../src/db/index.js');
const { secureLogAudit } = await import('../../src/auditEngine.js');
const { tokenFor, auth } = await import('../helpers/reia.js');

// The Audit Trail is in the REIA beta. The response scrubber took the other
// desks' rows off a page, but the total, the cards, the People view and the CSV
// were counted beside it, so "Showing 2 of 6" told a tester there was more.
// The beta now leaves them out of the query every view shares.

const REIA = { id: 'USR-S79-REIA', name: 'S79 Maker', role: 'REIA_MAKER' };
const HYDRO = { id: 'USR-S79-COM', name: 'S79 Commercial', role: 'COMMERCIAL' };

function write(user, entry) {
  secureLogAudit({ user, traceId: 'TRC-S79', ip: '10.0.0.1' }, entry);
}

beforeEach(() => {
  db.prepare('DELETE FROM audit_logs').run();
  write(REIA, { action: 'CREATE', module: 'REIA', entityType: 'invoice', entityId: 'INV-S79' });
  write(REIA, { action: 'APPROVAL_APPROVED', module: 'REIA', entityType: 'invoice', entityId: 'INV-S79' });
  write(HYDRO, { action: 'CREATE', module: 'REIA', entityType: 'invoice', entityId: 'INV-S79-B' });
  write(REIA, { action: 'HYDRO_STATION_BILL_CREATED', module: 'REIA', entityType: 'bill', entityId: 'HB-1' });
  write(REIA, { action: 'UPDATE', module: 'THERMAL', entityType: 'station', entityId: 'TS-1' });
  write(REIA, { action: 'SUBMIT_BID', module: 'TRADING', entityType: 'bid', entityId: 'BID-1' });
});

const auditor = () => tokenFor('COMPLIANCE_AUDITOR');
const get = (path, q = {}) => request(app).get(`/api/audit-logs${path}`).query(q).set(auth(auditor()));

describe('S79 the audit trail in the REIA beta', () => {
  it('counts the REIA desk alone, in the list and its total', async () => {
    const r = await get('');
    expect(r.body.rows.map((x) => x.action).sort()).toEqual(['APPROVAL_APPROVED', 'CREATE']);
    expect(r.body.total).toBe(2);
  });

  it('keeps the cards, the dropdowns and the People view to the same rows', async () => {
    expect((await get('/summary')).body).toMatchObject({ total: 2, users: 1 });
    const f = (await get('/facets')).body;
    expect(f.modules).toEqual([{ module: 'REIA', n: 2 }]);
    expect(f.roles).toEqual([{ user_role: 'REIA_MAKER', n: 2 }]);
    expect(f.activities.reduce((s, a) => s + a.n, 0)).toBe(2);
    const people = (await get('/people')).body.people;
    expect(people.map((p) => p.user_id)).toEqual([REIA.id]);
    expect(people[0].n).toBe(2);
  });

  it('exports the same two rows', async () => {
    const r = await get('/export.csv');
    expect(r.headers['x-export-rows']).toBe('2');
    expect(r.text).not.toMatch(/HYDRO|THERMAL|TRADING|COMMERCIAL/);
  });
});
