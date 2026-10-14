import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { seedNjhpsAllocations } from '../src/services/hydroStationBill.js';

// A station's Annual Fixed Charges are approved by CERC year by year and get
// revised after bills have gone out on the earlier figure. NJHPS was billed on
// 1461.5741 crore for 2026-27 (the June bill, Rs 1,574,926,027, is on it); the
// Commercial Department's figure in October 2026 is 1700.8363 crore, which
// makes the energy charge rate 1.479 instead of 1.271.

const COLS = ['annual_afc', 'annual_design_energy_mwh', 'normative_aux', 'free_energy_home_state',
  'napaf_percent', 'capacity_mw', 'capacity_charges_total', 'ecr_excess_rate'];
let snapshot;
let contract;
let reia;
let viewer;

// September 2026 as NRPC's provisional REA accounts it, with April–August carried.
const SEPTEMBER = {
  billing_month: '2026-09', ex_bus_scheduled_kwh: 877806250, free_power_kwh: 105336410,
  pafm_percent: 110, prior_scheduled_kwh: 3774151950, prior_free_kwh: 452897725,
};

function clean() {
  for (const t of ['hydro_station_tariffs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills', 'hydro_beneficiary_allocations']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
}

beforeAll(() => { snapshot = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get(); });
afterAll(() => {
  clean();
  db.prepare(`UPDATE contracts SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...COLS.map((c) => snapshot[c]), snapshot.id);
});

beforeEach(() => {
  clean();
  seedNjhpsAllocations();
  db.prepare(`
    UPDATE contracts SET annual_afc = 14615741000, annual_design_energy_mwh = 6612000, normative_aux = 1.2,
      free_energy_home_state = 12, napaf_percent = 87, capacity_mw = 1500, ecr_excess_rate = NULL
    WHERE contract_no = 'PPA/SJVN/NJHPS/001'
  `).run();
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  reia = tokenFor('COMMERCIAL_ADMIN');
  viewer = tokenFor('MANAGEMENT');
});

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));
const setYear = (body, token = reia) => post('/api/hydro-billing/tariffs', token, { contract_id: contract.id, financial_year: '2026-2027', ...body });

describe('a station\'s tariff for a financial year', () => {
  it('bills September 2026 on the revised AFC: rate 1.479, total Rs 202.62 crore', async () => {
    const before = await post('/api/hydro-billing/preview', viewer, { contract_id: contract.id, ...SEPTEMBER });
    expect(before.body.bill.a12_ecr).toBe(1.271);
    expect(before.body.bill.total_charges).toBe(1741247763.71);

    const set = await setYear({ annual_afc: 17008363000, ecr_excess_rate: 1.301, order_ref: 'Commercial Department, Oct 2026' });
    expect(set.status).toBe(200);

    const r = await post('/api/hydro-billing/preview', viewer, { contract_id: contract.id, ...SEPTEMBER });
    expect(r.body.bill).toMatchObject({
      a1_afc: 17008363000,
      a12_ecr: 1.479,
      a13_ecr_excess: 1.301,
      c5_total_capacity_charge: 883760004.72,
      ee1_energy_charge: 1142482893.36,
      total_charges: 2026242898.08,
    });
    const sum = r.body.lines.reduce((a, l) => a + l.total_charges, 0);
    expect(Math.round(sum * 100)).toBe(202624289808);
  });

  it('leaves another financial year on the contract\'s own figures', async () => {
    await setYear({ annual_afc: 17008363000 });
    db.prepare(`UPDATE hydro_beneficiary_allocations SET effective_from = '2025-04-01'`).run();
    const march = await post('/api/hydro-billing/preview', viewer, {
      contract_id: contract.id, ...SEPTEMBER, billing_month: '2026-03', prior_scheduled_kwh: 0, prior_free_kwh: 0,
    });
    expect(march.body.bill.financial_year).toBe('2025-2026');
    expect(march.body.bill.a1_afc).toBe(14615741000);
  });

  it('says which bills of the year were raised on the earlier figure', async () => {
    const june = await post('/api/hydro-billing', reia, {
      contract_id: contract.id, billing_month: '2026-06', ex_bus_scheduled_kwh: 731158750, free_power_kwh: 87739035,
      pafm_percent: 109.667, prior_scheduled_kwh: 714468750, prior_free_kwh: 85736250,
    });
    const set = await setYear({ annual_afc: 17008363000 });
    expect(set.body.bills_on_other_figures).toEqual([
      { bill_no: june.body.bill_no, billing_month: '2026-06', status: 'DRAFT', a1_afc: 14615741000 },
    ]);
    // The bill already raised is not restated by the change.
    const stored = await get(`/api/hydro-billing/${june.body.id}`, viewer);
    expect(stored.body.a1_afc).toBe(14615741000);
  });

  it('replaces the year\'s figure when set again, and lists the years on file', async () => {
    await setYear({ annual_afc: 15469579000 });
    await setYear({ annual_afc: 17008363000, order_ref: 'revised' });
    const list = await get(`/api/hydro-billing/tariffs?contract_id=${contract.id}`, viewer);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ financial_year: '2026-2027', annual_afc: 17008363000, order_ref: 'revised' });
  });

  it('refuses an AFC typed in crore, a malformed year, and a read-only role', async () => {
    expect((await setYear({ annual_afc: 1700.8363 })).body.error).toMatch(/rupees, not crore/);
    expect((await post('/api/hydro-billing/tariffs', reia, { contract_id: contract.id, financial_year: '2026-27', annual_afc: 17008363000 })).status).toBe(400);
    expect((await setYear({ annual_afc: 17008363000 }, viewer)).status).toBe(403);
  });
});

describe('plant availability', () => {
  it('is paid for up to 110% and no further', async () => {
    const at110 = await post('/api/hydro-billing/preview', viewer, { contract_id: contract.id, ...SEPTEMBER, pafm_percent: 110 });
    const at115 = await post('/api/hydro-billing/preview', viewer, { contract_id: contract.id, ...SEPTEMBER, pafm_percent: 115 });
    expect(at115.body.bill.c1_pafm_pct).toBe(110);
    expect(at115.body.bill.c2_capacity_charge).toBe(at110.body.bill.c2_capacity_charge);
  });
});
