import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { makeUser, makeContract, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { approvalsQueue } from '../../src/services/stationDesk.js';

// Thermal QA run 5 (19-Oct-2026): the Thermal desk moves its own station's DSM pool bill.

let maker; let checker; let hydro; let station; let invoiceId;
beforeAll(async () => {
  maker = makeUser('THERMAL_USER'); checker = makeUser('THERMAL_ADMIN'); hydro = makeUser('COMMERCIAL_ADMIN');
  station = makeContract({ project_type: 'Thermal', contract_type: 'PPA', capacity_mw: 1320 });
  const row = await request(app).post('/api/deviation').set(auth(signToken(maker))).send({
    contract_id: station.id, period_month: '2026-09', week_no: 24, scheduled_mwh: 1000, actual_mwh: 990,
    statement_ref: 'ERPC DSA WK-24 2026-27 R0', statement_amount: -50000,
  });
  const d = await request(app).post(`/api/deviation/${row.body.id}/dispatch`).set(auth(signToken(maker))).send({});
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  invoiceId = approvalsQueue('THERMAL', maker).invoices.find((i) => i.total_amount === 50000)?.id;
});

describe('A thermal station invoice', () => {
  it('shows in the Thermal inbox and is moved by the Thermal desk, not the Hydro desk', async () => {
    expect(invoiceId).toBeTruthy();
    expect((await request(app).post(`/api/invoices/${invoiceId}/submit-for-approval`).set(auth(signToken(hydro))).send({})).status).toBe(403);
    expect((await request(app).post(`/api/invoices/${invoiceId}/submit-for-approval`).set(auth(signToken(maker))).send({})).status).toBe(200);
    expect((await request(app).post(`/api/invoices/${invoiceId}/approvals/1/act`).set(auth(signToken(maker))).send({ decision: 'APPROVED', comments: 'mine' })).status).toBe(403);
    const ok = await request(app).post(`/api/invoices/${invoiceId}/approvals/1/act`).set(auth(signToken(checker))).send({ decision: 'APPROVED', comments: 'checked' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
