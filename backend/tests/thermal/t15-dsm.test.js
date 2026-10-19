import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { makeUser, makeContract, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// Thermal QA run 15 (19-Oct-2026): a thermal station's week, settled by ERPC, can be billed.

let desk; let station;
const post = (url, body) => request(app).post(url).set(auth(desk)).send(body);
const week = (x = {}) => ({ contract_id: station.id, period_month: '2026-09', week_no: 24, scheduled_mwh: 168000, actual_mwh: 167500, ...x });
beforeAll(() => {
  desk = signToken(makeUser('THERMAL_ADMIN'));
  station = makeContract({ project_type: 'Thermal', contract_type: 'PPA', capacity_mw: 1320 });
});

describe('A thermal DSM week', () => {
  it('is billed from the ERPC statement entered by hand, and a revision bills the difference', async () => {
    expect((await post('/api/deviation', week({ statement_ref: 'short', statement_amount: 100 }))).status).toBe(400);
    const r = await post('/api/deviation', week({ statement_ref: 'ERPC DSA WK-24 2026-27 R0, issued 2026-09-30', statement_amount: -1250000 }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.is_estimate).toBe(false);
    const d = await post(`/api/deviation/${r.body.id}/dispatch`, {});
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const inv = db.prepare('SELECT invoice_breakdown_json j, total_amount FROM invoices WHERE id = (SELECT invoice_id FROM deviation_settlements WHERE id = ?)').get(r.body.id);
    expect(inv.total_amount).toBe(1250000);
    expect(inv.j).toMatch(/ERPC deviation pool/);
    expect(inv.j).not.toMatch(/NRPC/);
    // Mark the first bill presented, then the revision bills only the difference.
    db.prepare(`UPDATE invoices SET status = 'APPROVED' WHERE id = (SELECT invoice_id FROM deviation_settlements WHERE id = ?)`).run(r.body.id);
    const rev = await post('/api/deviation', week({ entry_type: 'REVISED', statement_ref: 'ERPC DSA WK-24 2026-27 R1, issued 2026-10-10', statement_amount: -1500000 }));
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    await post(`/api/deviation/${rev.body.id}/dispatch`, {});
    const second = db.prepare('SELECT total_amount FROM invoices WHERE id = (SELECT invoice_id FROM deviation_settlements WHERE id = ?)').get(rev.body.id);
    expect(second.total_amount).toBe(250000);
  });

  it('cannot carry figure edits once it is a statement row', async () => {
    const r = await post('/api/deviation', week({ week_no: 25, statement_ref: 'ERPC DSA WK-25 2026-27 R0, issued 2026-10-07', statement_amount: 500000 }));
    const e = await request(app).put(`/api/deviation/${r.body.id}`).set(auth(desk)).send({ actual_mwh: 1 });
    expect(e.status).toBe(400);
  });
});
