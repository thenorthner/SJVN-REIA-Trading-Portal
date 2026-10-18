import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { makeUser, makeEntity, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// Thermal QA run 3 (18-Oct-2026): arrear and supplementary bills on a coal station.

let maker; let checker; let checkerUser; let station; let sep;
const post = (url, body, t = maker) => request(app).post(url).set(auth(t)).send(body);
const tariff = (afc) => post('/api/thermal/tariffs', {
  contract_id: station.id, financial_year: '2026-2027', annual_afc: afc, napaf_percent: 85,
  gross_heat_rate: 2250, aux_pct: 6.5, sfc_ml_per_kwh: 0.5, cv_secondary_kcal_per_ml: 10,
}, checker);

beforeAll(async () => {
  maker = signToken(makeUser('THERMAL_USER'));
  checkerUser = makeUser('THERMAL_ADMIN');
  checker = signToken(checkerUser);
  const genco = makeEntity('SELLER', { name: 'T03 Genco' });
  db.prepare(`UPDATE entities SET verticals = 'THERMAL', status = 'APPROVED' WHERE id = ?`).run(genco.id);
  station = (await post('/api/thermal/stations', {
    seller_id: genco.id, contract_no: `PPA/T03/${genco.id}`, capacity_mw: 1320, tenure_start: '2026-04-01', tenure_end: '2051-03-31',
  }, checker)).body;
  await tariff(25000000000);
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from, is_active)
    VALUES (?, ?, 'BIHAR', 100, '2026-04-01', 1)`).run(`HBA-T03-${station.id}`, station.id);
  sep = (await post('/api/hydro-billing', {
    contract_id: station.id, billing_month: '2026-09', ex_bus_scheduled_kwh: 750000000, pafm_percent: 85,
    gcv_kcal_per_kg: 3685, coal_rs_per_tonne: 4500,
  })).body;
  await post(`/api/hydro-billing/${sep.id}/send-for-approval`, { next_approver_id: checkerUser.id, final_approver_id: checkerUser.id, comments: 'go' });
  await post(`/api/hydro-billing/${sep.id}/approve`, { action: 'APPROVE', comments: 'ok' }, checker);
  await post(`/api/hydro-billing/${sep.id}/issue`, {});
});

describe('A thermal arrear', () => {
  it('carries the AFC of the thermal tariff it was worked on', async () => {
    await tariff(26000000000);
    const a = await post('/api/hydro-billing/arrears', { contract_id: station.id, from_month: '2026-09', to_month: '2026-09', reason: 'CERC truing-up order' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.total_differential).toBeCloseTo(1000000000 * 30 / 365, 1);
    const bill = await request(app).get(`/api/hydro-billing/${a.body.id}`).set(auth(maker));
    expect(bill.body.a1_afc).toBe(26000000000);
    await post(`/api/hydro-billing/${a.body.id}/cancel`, { reason: 'test done' });
  });

  it('leaves out a month it cannot work again, and says so', async () => {
    const held = db.prepare('SELECT thermal_inputs_json j FROM hydro_station_bills WHERE id = ?').get(sep.id).j;
    db.prepare('UPDATE hydro_station_bills SET thermal_inputs_json = NULL WHERE id = ?').run(sep.id);
    const r = await post('/api/hydro-billing/arrears/preview', { contract_id: station.id, from_month: '2026-07', to_month: '2026-09' });
    db.prepare('UPDATE hydro_station_bills SET thermal_inputs_json = ? WHERE id = ?').run(held, sep.id);
    expect(r.status).toBe(200);
    expect(r.body.skipped.find((s) => s.month === '2026-09').reason).toMatch(/cannot be worked again/);
  });
});

describe('A thermal supplementary', () => {
  it('offers a coal station its own reasons and not β', async () => {
    const r = await request(app).get(`/api/hydro-billing/supplementary/reasons?contract_id=${station.id}`).set(auth(maker));
    const codes = r.body.map((x) => x.value);
    expect(codes).toContain('PART_LOAD_COMPENSATION');
    expect(codes).not.toContain('BETA_INCENTIVE');
    const beta = await post('/api/hydro-billing/supplementary', { contract_id: station.id, billing_month: '2026-09', amount: 500000, reason: 'BETA_INCENTIVE', particulars: 'beta' });
    expect(beta.status).toBe(400);
  });
});
