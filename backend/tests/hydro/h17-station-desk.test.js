import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeContract } from '../helpers/reia.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { INSERT_BILL, emptyBillBlocks } from '../../src/services/hydroClaims.js';
import { monthCloseBoard, advancesRegister, generationPerformance } from '../../src/services/stationDesk.js';
import { ppaRegister, reaRegister, regulationRegister, regulatedInMonth } from '../../src/services/stationRegisters.js';

// Parity with REIA (18-Oct-2026): the desk-wide views and registers the
// station desks were missing.

const tag = () => Math.random().toString(36).slice(2, 8);
let station;

function bill(overrides = {}) {
  const row = {
    ...emptyBillBlocks(station),
    id: newId('HSB'), bill_no: `HB/T17/${tag()}`, contract_id: station.id, station_name: 'T17 HEP',
    billing_month: '2026-06', financial_year: '2026-2027', bill_kind: 'PROVISIONAL',
    rea_reference: 'Provisional REA', revision_reason: null,
    a1_afc: 1.2e9, a6_ex_bus_saleable_design_energy_mwh: 3650000, a8_days_in_month: 30, a9_days_in_year: 365,
    a11_napaf_pct: 87, c1_pafm_pct: 87, c2_capacity_charge: 5e7, c5_total_capacity_charge: 5e7,
    e1_ex_bus_scheduled_kwh: 300000000, e3_saleable_scheduled_kwh: 264000000, total_charges: 9e7,
    prepared_by: 'maker', created_by: null,
    ...overrides,
  };
  db.prepare(INSERT_BILL).run(row);
  if (overrides.status) db.prepare('UPDATE hydro_station_bills SET status = ?, approval_status = ? WHERE id = ?').run(overrides.status, overrides.approval_status || 'APPROVED', row.id);
  return row;
}
const rowOf = (list) => list.find((r) => r.contract_id === station.id);

beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/T17-${tag()}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'T17 STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
});

describe('Month-close board', () => {
  it('walks a station from not billed through draft to issued', () => {
    expect(rowOf(monthCloseBoard('HYDRO', '2026-06').rows).stage).toBe('NOT_BILLED');
    const b = bill();
    const draft = monthCloseBoard('HYDRO', '2026-06');
    expect(rowOf(draft.rows).stage).toBe('DRAFT');
    expect(draft.checklist.items.find((i) => i.key === 'unissued').refs).toContain(b.bill_no);
    db.prepare(`UPDATE hydro_station_bills SET status = 'ISSUED', approval_status = 'APPROVED' WHERE id = ?`).run(b.id);
    const issued = monthCloseBoard('HYDRO', '2026-06');
    expect(rowOf(issued.rows).stage).toBe('ISSUED');
    expect(issued.checklist.items.find((i) => i.key === 'despatch').refs).toContain(b.bill_no);
  });

  it('prefers the final bill over the provisional', () => {
    bill();
    bill({ bill_kind: 'FINAL', total_charges: 8e7 });
    expect(rowOf(monthCloseBoard('HYDRO', '2026-06').rows).bill.bill_kind).toBe('FINAL');
  });

  it('refuses a malformed month', () => {
    expect(() => monthCloseBoard('HYDRO', 'June')).toThrow(/YYYY-MM/);
  });
});

describe('Advances register', () => {
  it('lists an unapplied receipt and says it can be applied when a bill is open beside it', () => {
    insertDoc({ doc_no: `PMT/T17/${tag()}`, contract_id: station.id, beneficiary_name: 'T17 STATE', doc_type: 'PMT', amount: 5000, doc_date: '2026-09-01' });
    let r = advancesRegister('HYDRO', { asOf: '2026-10-18' }).rows.find((x) => x.contract_id === station.id);
    expect(r.unapplied).toBe(5000);
    expect(r.can_apply).toBe(false);
    expect(r.age_days).toBe(47);
    insertDoc({ doc_no: `PB/T17/${tag()}`, contract_id: station.id, beneficiary_name: 'T17 STATE', doc_type: 'PB', amount: 3000, doc_date: '2026-10-01', due_date: '2026-11-15' });
    r = advancesRegister('HYDRO', { asOf: '2026-10-18' }).rows.find((x) => x.contract_id === station.id);
    expect(r.can_apply).toBe(true);
  });
});

describe('Generation performance', () => {
  it('flags a month below NAPAF and prices what it cost', () => {
    bill({ c1_pafm_pct: 80, c2_capacity_charge: 4e7 });
    const s = generationPerformance('HYDRO', '2026-2027').stations.find((x) => x.contract_id === station.id);
    const june = s.months.find((m) => m.month === '2026-06');
    expect(june.below_napaf).toBe(true);
    expect(june.capacity_at_napaf).toBe(4.35e7);
    expect(june.capacity_shortfall).toBe(3.5e6);
    expect(s.summary.months_below_napaf).toBe(1);
  });
});

describe('Beneficiary PPA register', () => {
  const desk = () => tokenFor('COMMERCIAL_ADMIN');

  it('shows a billed beneficiary with no PPA, then on file once recorded', async () => {
    const before = ppaRegister('HYDRO', { asOf: '2026-10-18' }).stations.find((s) => s.contract_id === station.id).rows[0];
    expect(before.ppa_standing).toBe('MISSING');
    const r = await request(app).post('/api/hydro-desk/ppas').set(auth(desk())).send({
      contract_id: station.id, beneficiary_name: 'T17 STATE', ppa_ref: 'PPA-1', valid_from: '2010-04-01', lc_months_required: 1,
    });
    expect(r.status).toBe(201);
    const after = ppaRegister('HYDRO', { asOf: '2026-10-18' }).stations.find((s) => s.contract_id === station.id).rows[0];
    expect(after.ppa_standing).toBe('ON_FILE');
  });

  it('refuses a beneficiary the station does not supply, and an overlapping PPA', async () => {
    const stranger = await request(app).post('/api/hydro-desk/ppas').set(auth(desk())).send({
      contract_id: station.id, beneficiary_name: 'NOBODY', ppa_ref: 'X', valid_from: '2020-01-01',
    });
    expect(stranger.status).toBe(400);
    await request(app).post('/api/hydro-desk/ppas').set(auth(desk())).send({ contract_id: station.id, beneficiary_name: 'T17 STATE', ppa_ref: 'A', valid_from: '2020-01-01' });
    const twice = await request(app).post('/api/hydro-desk/ppas').set(auth(desk())).send({ contract_id: station.id, beneficiary_name: 'T17 STATE', ppa_ref: 'B', valid_from: '2025-01-01' });
    expect(twice.status).toBe(409);
  });

  it('marks a PPA ending within 180 days as expiring', async () => {
    await request(app).post('/api/hydro-desk/ppas').set(auth(desk())).send({ contract_id: station.id, beneficiary_name: 'T17 STATE', ppa_ref: 'E', valid_from: '2000-01-01', valid_to: '2027-01-31' });
    const row = ppaRegister('HYDRO', { asOf: '2026-10-18' }).stations.find((s) => s.contract_id === station.id).rows[0];
    expect(row.ppa_standing).toBe('EXPIRING');
  });

  it('keeps the thermal desk off a hydro station', async () => {
    const r = await request(app).post('/api/hydro-desk/ppas').set(auth(tokenFor('THERMAL_ADMIN'))).send({ contract_id: station.id, beneficiary_name: 'T17 STATE', ppa_ref: 'T', valid_from: '2020-01-01' });
    expect(r.status).toBe(403);
  });
});

describe('Regulatory desk', () => {
  const desk = () => tokenFor('COMMERCIAL_ADMIN');

  it('needs the order reference before an order is issued, then flags it until it reaches the bills', async () => {
    const add = await request(app).post('/api/hydro-desk/regulatory').set(auth(desk())).send({
      contract_id: station.id, item_type: 'TRUE_UP', title: `True-up ${tag()}`, filed_on: '2026-05-01', status: 'FILED', tariff_impact: true,
    });
    expect(add.status).toBe(201);
    const noRef = await request(app).patch(`/api/hydro-desk/regulatory/${add.body.id}`).set(auth(desk())).send({ status: 'ORDER_ISSUED', order_date: '2026-10-01' });
    expect(noRef.status).toBe(400);
    const issued = await request(app).patch(`/api/hydro-desk/regulatory/${add.body.id}`).set(auth(desk())).send({ status: 'ORDER_ISSUED', order_date: '2026-10-01', order_ref: 'Petition 1/TT/2026' });
    expect(issued.status).toBe(200);
    expect(issued.body.to_implement).toBe(true);
    const done = await request(app).patch(`/api/hydro-desk/regulatory/${add.body.id}`).set(auth(desk())).send({ implemented_on: '2026-10-10' });
    expect(done.body.to_implement).toBe(false);
  });

  it('marks only a fee as paid', async () => {
    const r = await request(app).post('/api/hydro-desk/regulatory').set(auth(desk())).send({ item_type: 'FILING', title: 'Return', status: 'PAID', amount: 10 });
    expect(r.status).toBe(400);
  });
});

describe('REA register', () => {
  it('flags a bill whose energy no longer agrees with the REA on file', () => {
    bill();
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-06', 'PROVISIONAL', 'REA', 300500, 'VALIDATED')`).run(newId('ED'), station.id);
    const june = reaRegister('HYDRO', '2026-2027', { asOf: '2026-10-18' }).stations.find((s) => s.contract_id === station.id).rows.find((r) => r.month === '2026-06');
    expect(june.flags.map((f) => f.code)).toContain('MISMATCH');
  });

  it('agrees when the bill matches the REA', () => {
    bill();
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-06', 'PROVISIONAL', 'REA', 300000, 'VALIDATED')`).run(newId('ED'), station.id);
    const june = reaRegister('HYDRO', '2026-2027', { asOf: '2026-10-18' }).stations.find((s) => s.contract_id === station.id).rows.find((r) => r.month === '2026-06');
    expect(june.flags.map((f) => f.code)).not.toContain('MISMATCH');
    expect(june.flags.map((f) => f.code)).toContain('FINAL_AWAITED');
  });
});

describe('Regulation of power supply', () => {
  const desk = () => tokenFor('COMMERCIAL_ADMIN');
  const overdueBill = () => insertDoc({ doc_no: `PB/T17R/${tag()}`, contract_id: station.id, beneficiary_name: 'T17 STATE', doc_type: 'PB', amount: 200000, doc_date: '2026-06-01', due_date: '2026-07-01' });
  const notice = (body = {}) => request(app).post('/api/hydro-desk/power-regulation').set(auth(desk())).send({
    contract_id: station.id, beneficiary_name: 'T17 STATE', notice_ref: `N-${tag()}`, notice_date: '2026-10-01', ...body,
  });

  it('refuses notice to a beneficiary that is not in default', async () => {
    const r = await notice();
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not in default/);
  });

  it('lists a beneficiary overdue past the trigger as a candidate', () => {
    overdueBill();
    const reg = regulationRegister('HYDRO', { asOf: '2026-10-18' });
    const c = reg.candidates.find((x) => x.contract_id === station.id);
    expect(c.ground).toBe('OVERDUE');
    expect(c.days_overdue).toBe(109);
  });

  it('runs notice → regulate → restore, holding regulation to the notice period', async () => {
    overdueBill();
    const n = await notice();
    expect(n.status).toBe(201);
    expect(n.body.earliest_regulation_date).toBe('2026-10-16');
    const twice = await notice();
    expect(twice.status).toBe(409);
    const early = await request(app).post(`/api/hydro-desk/power-regulation/${n.body.id}/move`).set(auth(desk()))
      .send({ action: 'REGULATE', regulate_from: '2026-10-10', regulation_pct: 50, rldc_intimation_ref: 'NRLDC/1' });
    expect(early.status).toBe(400);
    const noRldc = await request(app).post(`/api/hydro-desk/power-regulation/${n.body.id}/move`).set(auth(desk()))
      .send({ action: 'REGULATE', regulate_from: '2026-10-16', regulation_pct: 50 });
    expect(noRldc.status).toBe(400);
    const reg = await request(app).post(`/api/hydro-desk/power-regulation/${n.body.id}/move`).set(auth(desk()))
      .send({ action: 'REGULATE', regulate_from: '2026-10-16', regulation_pct: 50, rldc_intimation_ref: 'NRLDC/1' });
    expect(reg.body.status).toBe('REGULATING');
    expect(regulatedInMonth(station.id, '2026-10').map((c) => c.beneficiary_name)).toContain('T17 STATE');
    expect(regulatedInMonth(station.id, '2026-09')).toHaveLength(0);
    const restored = await request(app).post(`/api/hydro-desk/power-regulation/${n.body.id}/move`).set(auth(desk()))
      .send({ action: 'RESTORE', on_date: '2026-10-18', reason: 'Payment plan agreed' });
    expect(restored.body.status).toBe('RESTORED');
  });
});

describe('Thermal generation performance', () => {
  it('works PLF off the scheduled energy grossed up by the normative aux, and coal on the norms', async () => {
    const plant = makeContract({ project_type: 'Thermal', capacity_mw: 100, contract_no: `PPA/SJVN/T17TH-${tag()}` });
    const inputs = {
      tariff: { gross_heat_rate: 2300, aux_pct: 6, sfc_ml_per_kwh: 0.5, cv_secondary_kcal_per_ml: 10, order_ref: 'CERC/T' },
      fuel: { gcv_kcal_per_kg: 3885, cvpf_kcal_per_kg: 3800, coal_rs_per_tonne: 4000, oil_rs_per_kl: 60000 },
    };
    const row = {
      ...emptyBillBlocks(plant), id: newId('HSB'), bill_no: `TB/T17/${tag()}`, contract_id: plant.id, station_name: 'T17 TPS',
      billing_month: '2026-06', financial_year: '2026-2027', bill_kind: 'PROVISIONAL', rea_reference: null, revision_reason: null,
      a1_afc: 5e9, a3_aux_pct: 6, a8_days_in_month: 30, a9_days_in_year: 365, a11_napaf_pct: 85, a12_ecr: 2.5,
      c1_pafm_pct: 90, c2_capacity_charge: 1e8, c5_total_capacity_charge: 1e8,
      e1_ex_bus_scheduled_kwh: 54144000, e3_saleable_scheduled_kwh: 54144000, ee1_energy_charge: 135360000, total_charges: 235360000,
      prepared_by: 'maker', created_by: null,
    };
    db.prepare(INSERT_BILL).run(row);
    db.prepare('UPDATE hydro_station_bills SET thermal_inputs_json = ? WHERE id = ?').run(JSON.stringify(inputs), row.id);

    const s = generationPerformance('THERMAL', '2026-2027').stations.find((x) => x.contract_id === plant.id);
    const june = s.months.find((m) => m.month === '2026-06');
    expect(june.plf_pct).toBe(80);
    expect(june.norm_ghr).toBe(2300);
    // (2300 − 0.5 × 10) / 3800 × 100 / 94
    expect(june.coal_kg_per_kwh).toBeCloseTo(0.6425, 4);
    expect(s.thermal.plf_ytd_pct).toBe(80);
    expect(s.thermal.months_above_plf_norm).toBe(0);

    const r = await request(app).get('/api/hydro-desk/generation-performance?fy=2026-2027').set(auth(tokenFor('THERMAL_ADMIN')));
    expect(r.body.stations.map((x) => x.contract_id)).toContain(plant.id);
    expect(r.body.stations.map((x) => x.contract_id)).not.toContain(station.id);
  });
});

describe('Thermal dashboard', () => {
  it('reads a thermal station\'s AFC from its own tariff and returns the desk\'s open work', async () => {
    const plant = makeContract({ project_type: 'Thermal', capacity_mw: 660, contract_no: `PPA/SJVN/T17D-${tag()}` });
    const fy = (() => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${y + 1}`; })();
    db.prepare(`INSERT INTO thermal_station_tariffs (id, contract_id, financial_year, annual_afc, napaf_percent, gross_heat_rate, aux_pct)
      VALUES (?, ?, ?, 13000000000, 85, 2250, 6.5)`).run(newId('TST'), plant.id, fy);
    const r = await request(app).get('/api/hydro-billing/dashboard').set(auth(tokenFor('THERMAL_ADMIN')));
    expect(r.status).toBe(200);
    const st = r.body.stations.find((s) => s.id === plant.id);
    expect(st.annual_afc).toBe(13000000000);
    expect(st.afc_source).toBe(`Tariff ${fy}`);
    expect(st.napaf_percent).toBe(85);
    expect(r.body.stations.map((s) => s.id)).not.toContain(station.id);
    expect(r.body.desk.month_close).toBeTruthy();
    expect(r.body.desk.ageing).toHaveProperty('d90_plus');
  });
});
