import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { makeUser, makeEntity, auth } from './helpers/reia.js';
import { signToken } from '../src/middleware/auth.js';
import { computeEcr } from '../src/services/thermalStationBill.js';
import { accountDisplay } from '../src/services/hydroLedger.js';

// A thermal station from set-up to a bill on the beneficiaries' accounts, and
// the shared desk features on it — kept apart from the hydro desk.

let maker; let checker; let checkerUser; let hydroDesk; let station;
const post = (url, token, body = {}) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

beforeAll(async () => {
  maker = signToken(makeUser('THERMAL_USER', { name: 'Thermal Maker' }));
  checkerUser = makeUser('THERMAL_ADMIN', { name: 'Thermal HoD' });
  checker = signToken(checkerUser);
  hydroDesk = signToken(makeUser('COMMERCIAL_ADMIN', { name: 'Hydro HoD' }));
  const genco = makeEntity('SELLER', { name: 'SJVN Thermal Pvt Ltd' });
  db.prepare(`UPDATE entities SET verticals = 'THERMAL' WHERE id = ?`).run(genco.id);

  const st = await post('/api/thermal/stations', checker, {
    seller_id: genco.id, contract_no: `PPA/THERMAL/${genco.id}`, capacity_mw: 1320,
    tenure_start: '2026-04-01', tenure_end: '2051-03-31', payment_terms_days: 45, lps_annual_pct: 15,
  });
  expect(st.status, JSON.stringify(st.body)).toBe(200);
  station = st.body;
  const t = await post('/api/thermal/tariffs', checker, {
    contract_id: station.id, financial_year: '2026-2027', annual_afc: 24500000000, napaf_percent: 85,
    gross_heat_rate: 2250, aux_pct: 6.25, sfc_ml_per_kwh: 0.5, cv_secondary_kcal_per_ml: 10, order_ref: 'CERC Petition 1/GT/2026',
  });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  for (const [name, pct] of [['BIHAR', 85], ['JHARKHAND', 15]]) {
    db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from, is_active)
      VALUES (?, ?, ?, ?, '2026-04-01', 1)`).run(`HBA-${name}-${station.id}`, station.id, name, pct);
  }
});

describe('Thermal energy charge rate', () => {
  it('follows the CERC formula', () => {
    // [(2250 − 0.5×10) × 4.5 / 3500 + 0.5 × 0.06] × 100 / 93.75
    const ecr = computeEcr({ ghr: 2250, auxPct: 6.25, sfc: 0.5, cvsf: 10, gcvKcalPerKg: 3500, coalRsPerTonne: 4500, oilRsPerKl: 60000 });
    expect(ecr).toBeCloseTo(((2245 * 4.5) / 3500 + 0.03) * 100 / 93.75, 4);
  });
});

describe('Thermal monthly bill', () => {
  let bill;
  it('computes capacity and energy charges and splits them on the allocation', async () => {
    const r = await post('/api/hydro-billing', maker, {
      contract_id: station.id, billing_month: '2026-04', bill_kind: 'PROVISIONAL',
      ex_bus_scheduled_kwh: 800000000, pafm_percent: 85, gcv_kcal_per_kg: 3500, coal_rs_per_tonne: 4500, oil_rs_per_kl: 60000,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    bill = r.body;
    expect(bill.c5_total_capacity_charge).toBeCloseTo(24500000000 * 30 / 365, 0);
    expect(bill.ee1_energy_charge).toBeCloseTo(bill.a12_ecr * 800000000, 0);
    expect(bill.lines.map((l) => l.beneficiary_name).sort()).toEqual(['BIHAR', 'JHARKHAND']);
    expect(bill.lines.reduce((a, l) => a + l.total_charges, 0)).toBeCloseTo(bill.total_charges, 1);
  });

  it('is approved on the thermal desk, issued to the ledger and printed', async () => {
    const approvers = await get('/api/hydro-billing/approvers', maker);
    expect(approvers.body.some((u) => u.id === checkerUser.id)).toBe(true);
    expect(approvers.body.every((u) => !['COMMERCIAL_ADMIN', 'COMMERCIAL'].includes(u.role))).toBe(true);
    await post(`/api/hydro-billing/${bill.id}/send-for-approval`, maker, { next_approver_id: checkerUser.id, final_approver_id: checkerUser.id, comments: 'for approval' });
    expect((await post(`/api/hydro-billing/${bill.id}/approve`, checker, { action: 'APPROVE', comments: 'ok' })).status).toBe(200);
    expect((await post(`/api/hydro-billing/${bill.id}/issue`, maker, { due_date: '2026-06-15' })).status).toBe(200);
    expect(accountDisplay(station.id, 'BIHAR').totals.outstanding).toBeGreaterThan(0);
    expect((await get(`/api/hydro-billing/${bill.id}/pdf`, maker)).status).toBe(200);
    expect((await get(`/api/hydro-billing/${bill.id}/beneficiary-bills/pdf`, maker)).status).toBe(200);
  });

  it('takes an arrear when the tariff is revised', async () => {
    await post('/api/thermal/tariffs', checker, {
      contract_id: station.id, financial_year: '2026-2027', annual_afc: 26000000000, napaf_percent: 85,
      gross_heat_rate: 2250, aux_pct: 6.25, sfc_ml_per_kwh: 0.5, cv_secondary_kcal_per_ml: 10,
    });
    const r = await post('/api/hydro-billing/arrears', maker, { contract_id: station.id, from_month: '2026-04', to_month: '2026-04', reason: 'CERC true-up order revising AFC for 2026-27' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.total_differential).toBeCloseTo(1500000000 * 30 / 365, 0);
  });

  it('runs the shared desk features on the station', async () => {
    const tds = await post('/api/hydro-desk/tds', maker, { contract_id: station.id, beneficiary_name: 'BIHAR', section: '194Q', tds_amount: 1000, deduction_date: '2026-07-01' });
    expect(tds.status, JSON.stringify(tds.body)).toBe(200);
    expect((await get(`/api/hydro-desk/security?contract_id=${station.id}`, maker)).status).toBe(200);
    expect((await get(`/api/hydro-billing/receivables?contract_id=${station.id}`, maker)).status).toBe(200);
  });
});

describe('The desks stay apart', () => {
  it('keeps the hydro desk off a thermal station, and the thermal desk off a hydro one', async () => {
    expect((await get(`/api/hydro-billing/receivables?contract_id=${station.id}`, hydroDesk)).status).toBe(403);
    const hydro = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
    expect((await get(`/api/hydro-billing/receivables?contract_id=${hydro.id}`, maker)).status).toBe(403);
    const list = await get('/api/hydro-billing/stations', maker);
    expect(list.body.map((s) => s.id)).toEqual([station.id]);
    const hydroList = await get('/api/hydro-billing/stations', hydroDesk);
    expect(hydroList.body.map((s) => s.id)).not.toContain(station.id);
  });
});
