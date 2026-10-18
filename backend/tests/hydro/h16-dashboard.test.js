import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { seedNjhpsAllocations } from '../../src/services/hydroStationBill.js';

// Hydro QA run 16 (18-Oct-2026): the dashboard reports the books, not typed-in figures.

const TABLES = ['hydro_ledger_clearings', 'hydro_ledger_docs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills'];
let desk, contract;
beforeEach(() => {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  seedNjhpsAllocations();
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  desk = tokenFor('COMMERCIAL_ADMIN');
});
afterAll(() => { for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run(); });

const dash = (token = desk) => request(app).get('/api/hydro-billing/dashboard').set(auth(token));

describe('The Hydro dashboard', () => {
  it('shows nothing invented on an empty book', async () => {
    const r = await dash();
    expect(r.status).toBe(200);
    expect(r.body.stations.map((s) => s.id)).not.toContain('CON-STPP-BUXAR');
    expect(Object.values(r.body.pipeline).every((n) => n === 0)).toBe(true);
    expect(r.body.kpis.cumulativeBilledCr).toBe(0);
    expect(r.body.kpis.realizationPct).toBeNull();
    expect(r.body.kpis.avgPafmPct).toBeNull();
    expect(r.body.stations.find((s) => s.id === contract.id).pafm_achieved).toBeNull();
    expect(r.body.beneficiaryBreakup.every((b) => b.billed_cr === 0)).toBe(true);
  });

  it('reports an issued bill from the bill and the ledger', async () => {
    const maker = makeUser('COMMERCIAL_ADMIN');
    const hod = makeUser('COMMERCIAL_ADMIN');
    const b = await request(app).post('/api/hydro-billing').set(auth(signToken(maker))).send({
      contract_id: contract.id, billing_month: '2026-06', ex_bus_scheduled_kwh: 731158750,
      free_power_kwh: 87739035, pafm_percent: 95.5, beta_value: 0,
    });
    await request(app).post(`/api/hydro-billing/${b.body.id}/send-for-approval`).set(auth(signToken(maker))).send({ next_approver_id: hod.id, final_approver_id: hod.id, comments: 'go' });
    await request(app).post(`/api/hydro-billing/${b.body.id}/approve`).set(auth(signToken(hod))).send({ action: 'APPROVE', comments: 'ok' });
    await request(app).post(`/api/hydro-billing/${b.body.id}/issue`).set(auth(desk)).send({ due_date: '2026-07-31' });

    const r = await dash();
    const june = r.body.monthlyBillingTrend.find((m) => m.month_key === '2026-06');
    const charged = db.prepare(`SELECT SUM(amount) s FROM hydro_ledger_docs WHERE doc_type = 'PB'`).get().s;
    expect(june.total_billed).toBeCloseTo(charged / 1e7, 2);
    expect(june.njhps_billed).toBeCloseTo(charged / 1e7, 2);
    expect(r.body.pafmTrend.find((m) => m.period === 'Jun 2026').njhps).toBe(95.5);
    expect(r.body.stations.find((s) => s.id === contract.id).pafm_achieved).toBe(95.5);
    expect(r.body.pipeline.issued).toBe(1);
    // Past its due date and unpaid: overdue on the account.
    expect(r.body.beneficiaryBreakup.some((x) => x.status === 'Overdue')).toBe(true);
  });

  it('shows a desk its own stations', async () => {
    const r = await dash(tokenFor('THERMAL_USER'));
    expect(r.body.stations.every((s) => s.project_type === 'Thermal')).toBe(true);
  });

  it('lets the Hydro desk read its stations\' REA', async () => {
    const r = await request(app).get('/api/energy-records/analytics?vertical=HYDRO').set(auth(desk));
    expect(r.status).toBe(200);
  });
});
