import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { invalidateParamCache } from '../../src/mastersService.js';
import { invoiceLpsAsOf, lpsTermsFor } from '../../src/services/invoiceLps.js';
import { rebateRateOn } from '../../src/routes/invoices.js';
import { newId } from '../../src/util.js';

// A contract or a law that changes part-way (1-Nov-2026). An amendment is a new
// version of the contract that applies from its effective date once approved;
// the version before it stays the agreement for everything earlier. So a month
// is billed on the version in force for it, once, whichever version is picked;
// a revision from mid-month prices each part of the month on its own terms; a
// revision reaching back over months already billed is recovered by an arrear
// worked out from those bills; and terms already on a bill are not rewritten.
// On the law's side: the LPS base rate is the one applicable on 1 April of the
// financial year (LPS Rules 2022 r.2(1)(b)), and a Change in Law claim starts
// from the date the law took effect.

const maker = () => tokenFor('REIA_MAKER');
const checker = () => tokenFor('REIA_CHECKER');
const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const contractRow = (id) => db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
const lines = (inv) => JSON.parse(inv.invoice_breakdown_json || '[]');

function lockEnergy(contractId, period, mwh) {
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
    VALUES (?, ?, ?, 'FINAL', 'SEA', ?, 'LOCKED')
  `).run(newId('ENG'), contractId, period, mwh);
}

/** One block a day carrying the day's energy — enough to say how the month split. */
function dailyBlocks(contractId, period, mwhOnDay) {
  const [y, m] = period.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d += 1) {
    const date = `${period}-${String(d).padStart(2, '0')}`;
    db.prepare(`INSERT INTO energy_blocks (id, contract_id, period_month, block_date, block_no, actual_mwh) VALUES (?, ?, ?, ?, 1, ?)`)
      .run(newId('EBK'), contractId, period, date, mwhOnDay(d));
  }
}

const amend = (c, body) => request(app).post(`/api/contracts/${c.id}/amend`).set(auth(maker())).send({ amendment_reason: 'CERC order', ...body });

async function amendAndActivate(c, body) {
  const r = await amend(c, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES (?, ?, 'CONTRACT', 'RECORD', 'Amendment')`)
    .run(newId('DOC'), r.body.id);
  const on = await request(app).post(`/api/contracts/${r.body.id}/status`).set(auth(checker())).send({ status: 'ACTIVE' });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  return contractRow(r.body.id);
}

const generate = (contractId, period_month) => request(app).post('/api/invoices/generate').set(auth(maker()))
  .send({ contract_id: contractId, period_month });

/** A bill raised and presented: what a later revision has to reach back over. */
async function billedAndSent(contractId, period) {
  const r = await generate(contractId, period);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  db.prepare(`UPDATE invoices SET status = 'SENT', issued_at = ? WHERE id = ?`).run(`${period}-28 10:00:00`, r.body.id);
  return row(r.body.id);
}

const arrear = (body) => request(app).post('/api/invoices/arrear').set(auth(maker()))
  .send({ basis: 'TARIFF_REVISION', reason: 'Tariff revised by CERC order', ...body });

let ppa;
beforeEach(() => {
  resetReia();
  ppa = makeContract({ status: 'ACTIVE', contract_type: 'PPA', project_type: 'SOLAR', tariff_per_unit: 3.0, tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
});

describe('an amendment\'s effective date', () => {
  it('has to be a day on the calendar', async () => {
    for (const effective_from of ['2026-02-31', '2026-13-01', '2026-06-00', '2026-6-1']) {
      const r = await amend(ppa, { tariff_per_unit: 3.4, effective_from });
      expect(r.status, effective_from).toBe(400);
    }
  });
});

describe('which version a month is billed on', () => {
  let v2;
  beforeEach(async () => {
    v2 = await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-08-01' });
    for (const p of ['2026-07', '2026-08']) lockEnergy(ppa.id, p, 1000);
  });

  it('bills a month before the amendment on the old terms, whichever version is picked', async () => {
    const r = await generate(v2.id, '2026-07');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ contract_id: ppa.id, tariff_per_unit: 3.0, energy_charges: 3000000 });
  });

  it('bills a month after it on the revised terms, whichever version is picked', async () => {
    const r = await generate(ppa.id, '2026-08');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ contract_id: v2.id, tariff_per_unit: 3.4, energy_charges: 3400000 });
  });

  it('bills a month once across the versions', async () => {
    expect((await generate(v2.id, '2026-08')).status).toBe(201);
    const twice = await generate(ppa.id, '2026-08');
    expect(twice.status).toBe(409);
    expect(twice.body.existing_invoice_no).toBeTruthy();
  });

  it('reads the month\'s energy whichever version it was recorded against', async () => {
    lockEnergy(ppa.id, '2026-09', 1200); // recorded on the old version after the switch
    const r = await generate(v2.id, '2026-09');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ contract_id: v2.id, energy_mwh: 1200, energy_charges: 4080000 });
  });
});

describe('an amendment not yet approved', () => {
  it('changes nothing: the month is billed on the version in force', async () => {
    const r = await amend(ppa, { tariff_per_unit: 3.4, effective_from: '2026-08-01' });
    expect(r.body.status).toBe('PENDING_REGULATORY_APPROVAL');
    lockEnergy(ppa.id, '2026-08', 1000);
    const bill = await generate(r.body.id, '2026-08');
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body).toMatchObject({ contract_id: ppa.id, tariff_per_unit: 3.0 });
  });
});

describe('a revision from the middle of a month', () => {
  // August has 31 days: 1–16 on the old rate, 17–31 (15 days) on the new.
  it('prices each part of the month at its own rate, split by days', async () => {
    await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-08-17' });
    lockEnergy(ppa.id, '2026-08', 3100);
    const r = await generate(ppa.id, '2026-08');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // 1,600 MWh × ₹3.0 + 1,500 MWh × ₹3.4
    expect(r.body.energy_charges).toBe(4800000 + 5100000);
    const ts = lines(r.body).filter((l) => l.code === 'TS');
    expect(ts.map((l) => l.value)).toEqual([3.0, 3.4]);
    expect(ts[1].label).toMatch(/^17–31 Aug 2026/);
  });

  it('splits by the energy actually delivered when the month\'s 15-minute data is in', async () => {
    await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-08-17' });
    dailyBlocks(ppa.id, '2026-08', (d) => (d < 17 ? 50 : 150)); // 800 MWh before, 2,250 after
    lockEnergy(ppa.id, '2026-08', 3050);
    const r = await generate(ppa.id, '2026-08');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.energy_charges).toBe(800 * 3000 + 2250 * 3400);
  });

  it('keeps the trading margin whole on a PSA revised mid-month', async () => {
    const psa = makeContract({ status: 'ACTIVE', contract_type: 'PSA', project_type: 'SOLAR', tariff_per_unit: 3.07, tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`).run(newId('CAL'), ppa.id, psa.id);
    await amendAndActivate(psa, { tariff_per_unit: 3.47, effective_from: '2026-08-17' });
    lockEnergy(ppa.id, '2026-08', 3100);
    const r = await generate(psa.id, '2026-08');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.trading_margin).toBe(3100 * 70);
    // 1,600 MWh × ₹3.07 + 1,500 MWh × ₹3.47, the margin carved out of it
    expect(r.body.energy_charges + r.body.trading_margin).toBe(1600 * 3070 + 1500 * 3470);
  });
});

describe('a revision reaching back over months already billed', () => {
  beforeEach(() => { for (const p of ['2026-07', '2026-08']) lockEnergy(ppa.id, p, 1000); });

  it('does not let a billed month be billed again on the new version', async () => {
    const july = await billedAndSent(ppa.id, '2026-07');
    const v2 = await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-01' });
    const again = await generate(v2.id, '2026-07');
    expect(again.status).toBe(409);
    expect(again.body.existing_invoice_no).toBe(july.invoice_no);
  });

  it('works the arrear out from the bill: energy billed × the rise in rate', async () => {
    const july = await billedAndSent(ppa.id, '2026-07');
    const v2 = await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-01' });
    const r = await arrear({ contract_id: ppa.id, arrear_period: '2026-07' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ invoice_type: 'ARREAR', contract_id: v2.id, energy_charges: 400000, total_amount: 400000, parent_invoice_id: july.id });
    const arr = lines(r.body).find((l) => l.code === 'ARR');
    expect(arr).toMatchObject({ basis: 'TARIFF_REVISION', rate_from: 3.0, rate_to: 3.4 });
    expect(arr.label).toContain(july.invoice_no);
  });

  it('does not recover the same revision twice', async () => {
    await billedAndSent(ppa.id, '2026-07');
    await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-01' });
    expect((await arrear({ contract_id: ppa.id, arrear_period: '2026-07' })).status).toBe(201);
    const twice = await arrear({ contract_id: ppa.id, arrear_period: '2026-07', reason: 'worded differently' });
    expect(twice.status).toBe(400);
    expect(twice.body.error).toMatch(/nothing (left )?to recover|already/i);
  });

  it('recovers only the further difference on a second revision', async () => {
    await billedAndSent(ppa.id, '2026-07');
    const v2 = await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-01' });
    expect((await arrear({ contract_id: ppa.id, arrear_period: '2026-07' })).status).toBe(201);
    await amendAndActivate(v2, { tariff_per_unit: 3.6, effective_from: '2026-07-01' });
    const r = await arrear({ contract_id: ppa.id, arrear_period: '2026-07', reason: 'Second CERC order' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.energy_charges).toBe(200000);
  });

  it('recovers only the days a mid-month revision covers', async () => {
    db.prepare(`UPDATE energy_data SET energy_mwh = 3100 WHERE contract_id = ? AND period_month = '2026-07'`).run(ppa.id);
    await billedAndSent(ppa.id, '2026-07');
    await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-17' });
    const r = await arrear({ contract_id: ppa.id, arrear_period: '2026-07' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.energy_charges).toBe(1500 * 400); // 15 days × 100 MWh × ₹0.40
  });

  it('turns a revision downward into the credit it is, not an arrear', async () => {
    await billedAndSent(ppa.id, '2026-07');
    await amendAndActivate(ppa, { tariff_per_unit: 2.8, effective_from: '2026-07-01' });
    const r = await arrear({ contract_id: ppa.id, arrear_period: '2026-07' });
    expect(r.status).toBe(400);
    expect(r.body.credit_due).toBe(200000);
    expect(r.body.error).toMatch(/credit note/i);
  });

  it('finds nothing to recover on a month billed after the revision was in force', async () => {
    await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-08-01' });
    await billedAndSent(ppa.id, '2026-08');
    const r = await arrear({ contract_id: ppa.id, arrear_period: '2026-08' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing (left )?to recover/i);
  });

  it('needs a bill presented for the month to work from', async () => {
    await generate(ppa.id, '2026-07'); // a draft only
    await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-01' });
    const r = await arrear({ contract_id: ppa.id, arrear_period: '2026-07' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no bill/i);
  });
});

describe('provisional and final across a revision', () => {
  // Provisional energy for July, locked: what a provisional bill is raised on.
  const provisionalJuly = async () => {
    lockEnergy(ppa.id, '2026-07', 1000);
    db.prepare(`UPDATE energy_data SET data_type = 'PROVISIONAL' WHERE contract_id = ? AND period_month = '2026-07'`).run(ppa.id);
    const r = await request(app).post('/api/invoices/generate').set(auth(maker()))
      .send({ contract_id: ppa.id, period_month: '2026-07', invoice_type: 'PROVISIONAL' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    db.prepare(`UPDATE invoices SET status = 'SENT', issued_at = '2026-08-02 10:00:00' WHERE id = ?`).run(r.body.id);
    return row(r.body.id);
  };

  it('leaves a month with only a provisional bill to its final, not an arrear', async () => {
    await provisionalJuly();
    await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-01' });
    const r = await arrear({ contract_id: ppa.id, arrear_period: '2026-07' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only a provisional/i);
  });

  it('prices the final on the revised rate and nets what the provisional on the old version collected', async () => {
    const prov = await provisionalJuly();
    db.prepare(`UPDATE invoices SET status = 'PARTIALLY_PAID' WHERE id = ?`).run(prov.id);
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, 1000000, '2026-08-20', 'NEFT')`).run(newId('PAY'), prov.id);
    const v2 = await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-07-01' });
    lockEnergy(ppa.id, '2026-07', 1000); // the final figure
    const fin = await request(app).post('/api/invoices/generate').set(auth(maker()))
      .send({ contract_id: ppa.id, period_month: '2026-07', invoice_type: 'FINAL' });
    expect(fin.status, JSON.stringify(fin.body)).toBe(201);
    expect(fin.body).toMatchObject({ contract_id: v2.id, energy_charges: 3400000, other_adjustments: -1000000, parent_invoice_id: prov.id });
  });
});

describe('versions that reach past each other', () => {
  it('bills a month on a later version dated further back than the one before it', async () => {
    const v2 = await amendAndActivate(ppa, { tariff_per_unit: 3.4, effective_from: '2026-08-01' });
    const v3 = await amendAndActivate(v2, { tariff_per_unit: 3.2, effective_from: '2026-07-01' });
    lockEnergy(ppa.id, '2026-07', 1000);
    lockEnergy(ppa.id, '2026-08', 1000);
    expect((await generate(ppa.id, '2026-07')).body).toMatchObject({ contract_id: v3.id, tariff_per_unit: 3.2 });
    expect((await generate(ppa.id, '2026-08')).body).toMatchObject({ contract_id: v3.id, tariff_per_unit: 3.2 });
  });
});

describe('a PSA fed by a PPA amended mid-month', () => {
  it('draws on the PPA whichever version its month\'s energy was recorded under', async () => {
    const psa = makeContract({ status: 'ACTIVE', contract_type: 'PSA', project_type: 'SOLAR', tariff_per_unit: 3.07, tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`).run(newId('CAL'), ppa.id, psa.id);
    const v2 = await amendAndActivate(ppa, { tariff_per_unit: 2.95, effective_from: '2026-08-17' });
    lockEnergy(ppa.id, '2026-08', 1000);
    lockEnergy(ppa.id, '2026-09', 1000); // after the switch, still entered on version 1
    const aug = await generate(psa.id, '2026-08');
    const sep = await generate(psa.id, '2026-09');
    expect(aug.status, JSON.stringify(aug.body)).toBe(201);
    expect(sep.status, JSON.stringify(sep.body)).toBe(201);
    expect(sep.body.energy_mwh).toBe(1000);
    expect(db.prepare('SELECT ppa_id FROM contract_allocations WHERE psa_id = ? AND effective_from = ?').get(psa.id, '2026-08-17').ppa_id).toBe(v2.id);
  });

  it('works a PSA\'s revision arrear on the rate alone, the margin untouched', async () => {
    const psa = makeContract({ status: 'ACTIVE', contract_type: 'PSA', project_type: 'SOLAR', tariff_per_unit: 3.07, tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`).run(newId('CAL'), ppa.id, psa.id);
    lockEnergy(ppa.id, '2026-07', 1000);
    await billedAndSent(psa.id, '2026-07');
    await amendAndActivate(psa, { tariff_per_unit: 3.47, effective_from: '2026-07-01' });
    const r = await arrear({ contract_id: psa.id, arrear_period: '2026-07' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.total_amount).toBe(400000);
  });
});

describe('an arrear\'s month', () => {
  it('has to be one the contract ran in, and one that has come', async () => {
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    for (const arrear_period of ['2026-03', '2031-04', nextMonth]) {
      const r = await request(app).post('/api/invoices/arrear').set(auth(maker()))
        .send({ contract_id: ppa.id, arrear_period, amount: 50000, reason: 'Missed transmission charges' });
      expect(r.status, arrear_period).toBe(400);
    }
  });
});

describe('terms on bills already raised', () => {
  it('stay as they were when an amendment changes payment, surcharge and rebate terms', async () => {
    const before = makeContract({ status: 'ACTIVE', contract_type: 'PPA', tariff_per_unit: 3.0, lps_annual_pct: 15, payment_terms_days: 30,
      rebate_pct: 1.5, rebate_days: 5, rebate_basis: 'BILL_DATE', tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
    const bill = makeInvoice({ contract_id: before.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 100000, energy_charges: 100000,
      billing_period: '2026-06', issued_at: '2026-07-01 05:00:00', due_date: '2026-07-31' });
    const v2 = await amendAndActivate(before, { lps_annual_pct: 18, payment_terms_days: 15, rebate_pct: 2, effective_from: '2026-08-01' });

    expect(row(bill.id).due_date).toBe('2026-07-31');
    expect(invoiceLpsAsOf(row(bill.id), new Date('2026-08-30')).lps).toBe(Math.round((100000 * 15) / 100 / 365 * 30));
    expect(rebateRateOn(row(bill.id), new Date('2026-07-03'))).toBeCloseTo(0.015, 10);
    expect(lpsTermsFor(v2.id).annualPct).toBe(18);
  });
});

describe('the surcharge base rate across financial years', () => {
  const setParam = (key, value) => {
    db.prepare(`
      INSERT INTO system_parameters (id, category, param_key, param_value, data_type, description)
      VALUES (?, 'REGULATORY', ?, ?, 'JSON', 'test') ON CONFLICT(param_key) DO UPDATE SET param_value = excluded.param_value
    `).run(newId('PRM'), key, value);
    invalidateParamCache();
  };
  let scheduleBefore;
  beforeEach(() => { scheduleBefore = db.prepare(`SELECT param_value FROM system_parameters WHERE param_key = 'lps_base_rate_schedule'`).get()?.param_value ?? '[]'; });
  afterEach(() => setParam('lps_base_rate_schedule', scheduleBefore));

  // Due 1 March 2027: 30 days of March in the first month of default, then 30
  // of April in the second (+0.5%), on a ₹1,00,000 bill.
  const lateBill = (over = {}) => makeInvoice({ contract_id: ppa.id, status: 'SENT', total_amount: 100000, due_date: '2027-03-01', ...over });
  const asOf = new Date('2027-04-30');

  it('charges each day at the rate for the year it falls in', () => {
    setParam('lps_base_rate_schedule', JSON.stringify([{ from: '2026-04-01', pct: 15 }, { from: '2027-04-01', pct: 14 }]));
    expect(invoiceLpsAsOf(lateBill(), asOf).lps).toBe(Math.round((100000 * (30 * 15 + 30 * 14.5)) / 100 / 365));
  });

  it('holds a rate recorded mid-year until the next 1 April', () => {
    setParam('lps_base_rate_schedule', JSON.stringify([{ from: '2026-04-01', pct: 15 }, { from: '2026-10-01', pct: 16 }]));
    // March 2027 is still FY 2026-27, on the 1 April 2026 rate; April 2027 takes 16.
    expect(invoiceLpsAsOf(lateBill(), asOf).lps).toBe(Math.round((100000 * (30 * 15 + 30 * 16.5)) / 100 / 365));
  });

  it('leaves a contract that sets its own surcharge rate on that rate', () => {
    setParam('lps_base_rate_schedule', JSON.stringify([{ from: '2026-04-01', pct: 15 }, { from: '2027-04-01', pct: 14 }]));
    const own = makeContract({ status: 'ACTIVE', contract_type: 'PPA', lps_annual_pct: 12 });
    expect(invoiceLpsAsOf(lateBill({ contract_id: own.id }), asOf).lps).toBe(Math.round((100000 * (30 * 12 + 30 * 12.5)) / 100 / 365));
  });

  it('takes only dated rows with a rate into the masters', async () => {
    const put = (param_value) => request(app).put('/api/masters/parameters/lps_base_rate_schedule').set(auth(tokenFor('SJVN_ADMIN'))).send({ param_value });
    for (const bad of ['not json', '{}', JSON.stringify([{ from: '2027-02-30', pct: 14 }]), JSON.stringify([{ from: '2027-04-01', pct: 0 }]),
      JSON.stringify([{ from: '2027-04-01', pct: 14 }, { from: '2027-04-01', pct: 15 }])]) {
      expect((await put(bad)).status, bad).toBe(400);
    }
    expect((await put(JSON.stringify([{ from: '2027-04-01', pct: 14.15 }]))).status).toBe(200);
  });

  it('falls back to the master rate where the schedule says nothing', () => {
    setParam('lps_base_rate_schedule', '[]');
    expect(invoiceLpsAsOf(lateBill(), asOf).lps).toBe(Math.round((100000 * (30 * 15 + 30 * 15.5)) / 100 / 365));
  });
});

describe('a Change in Law claim and the date the law took effect', () => {
  const claim = (over = {}) => request(app).post('/api/invoices/supplementary').set(auth(maker())).send({
    contract_id: ppa.id, billing_period: '2026-06', amount: 250000, reason_code: 'CHANGE_IN_LAW',
    reason: 'Safeguard duty on modules', law_effective_from: '2026-06-10', ...over,
  });

  it('has to say when the law took effect, as a real date', async () => {
    for (const law_effective_from of [undefined, '', '2026-06-31', '10-06-2026']) {
      expect((await claim({ law_effective_from })).status, String(law_effective_from)).toBe(400);
    }
  });

  it('cannot claim a month that ended before the law took effect', async () => {
    expect((await claim({ billing_period: '2026-05' })).status).toBe(400);
    expect((await claim({ billing_period: '2026-06' })).status).toBe(201); // the month it took effect in
  });

  it('cannot date the law after the month it claims for', async () => {
    expect((await claim({ law_effective_from: '2026-07-01' })).status).toBe(400);
  });

  it('records the date on the bill', async () => {
    const r = await claim();
    expect(lines(r.body).find((l) => l.code === 'SUPP')).toMatchObject({ reason_code: 'CHANGE_IN_LAW', law_effective_from: '2026-06-10' });
  });

  it('asks no date of a claim for another reason', async () => {
    expect((await claim({ reason_code: 'REVISED_REA', law_effective_from: undefined })).status).toBe(201);
  });
});
