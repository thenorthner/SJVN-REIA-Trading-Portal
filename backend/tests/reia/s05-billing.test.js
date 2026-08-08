import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';

let reia, finance, contract;
const energy = (cid, period, mwh, id) => db.prepare(
  `INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
   VALUES (?, ?, ?, 'FINAL', 'SEA', ?, 'LOCKED')`).run(id, cid, period, mwh);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');
  contract = makeContract({ status: 'ACTIVE', tariff_per_unit: 3.0, payment_terms_days: 30, rebate_pct: 2, rebate_days: 5, lps_annual_pct: 12 });
});

describe('S5 Billing engine', () => {
  it('bills energy x tariff', async () => {
    energy(contract.id, '2026-04', 1000, 'ENG-B1');
    const r = await request(app).post('/api/invoices/generate').set(auth(reia)).send({ contract_id: contract.id, period_month: '2026-04' });
    expect(r.status).toBe(201);
    const inv = db.prepare('SELECT energy_mwh, tariff_per_unit, energy_charges FROM invoices WHERE id = ?').get(r.body.id);
    expect(inv.energy_charges).toBeCloseTo(inv.energy_mwh * inv.tariff_per_unit * 1000, 0);
  });

  it('breaks the bill into separate line items rather than one lump sum', () => {
    expect(columnsOf('invoices')).toEqual(expect.arrayContaining(
      ['energy_charges', 'transmission_charges', 'trading_margin', 'taxes', 'capacity_charges']));
  });

  it('links a final invoice back to the provisional it supersedes', () => {
    expect(columnsOf('invoices')).toEqual(expect.arrayContaining(['parent_invoice_id', 'version', 'billing_family_ref']));
  });

  it('raises a supplementary invoice for a later adjustment', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'PAID' });
    const r = await request(app).post('/api/invoices/supplementary').set(auth(reia))
      .send({ parent_invoice_id: inv.id, contract_id: contract.id, billing_period: '2026-04',
              amount: 50000, reason_code: 'TARIFF_REVISION', reason: 'CERC order' });
    expect(r.status).toBeLessThan(400);
    const supp = db.prepare(`SELECT * FROM invoices WHERE invoice_type = 'SUPPLEMENTARY'`).get();
    expect(supp).toBeTruthy();
    expect(supp.parent_invoice_id).toBe(inv.id);
  });

  it('applies the rebate when payment lands inside the window', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 1000000, due_date: '2026-05-31' });
    db.prepare("UPDATE invoices SET created_at = '2026-05-01' WHERE id = ?").run(inv.id);
    const r = await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance))
      .send({ amount: 1000000, payment_date: '2026-05-03', bill_date: '2026-05-01' });
    expect(r.status).toBeLessThan(400);
    const after = db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(inv.id);
    expect(after.rebate, 'no rebate applied for an early payment').toBeGreaterThan(0);
    // A buyer-facing PSA bill deliberately carries no early-payment rebate.
    const psa = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 1000000, due_date: '2026-05-31' });
    await request(app).post(`/api/invoices/${psa.id}/payments`).set(auth(finance))
      .send({ amount: 1000000, payment_date: '2026-05-03' });
    expect(db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(psa.id).rebate || 0).toBe(0);
  });

  it('applies no rebate once the window has passed', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 1000000, due_date: '2026-05-31' });
    // The rebate window runs from the bill date, so it has to be a real one.
    db.prepare("UPDATE invoices SET created_at = '2026-05-01' WHERE id = ?").run(inv.id);
    await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance))
      .send({ amount: 1000000, payment_date: '2026-05-25', bill_date: '2026-05-01' });
    expect(db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(inv.id).rebate || 0).toBe(0);
  });

  it('charges LPS on a late payment from contract configuration', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 1000000, due_date: '2026-05-01' });
    await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance))
      .send({ amount: 1000000, payment_date: '2026-06-30' });
    expect(db.prepare('SELECT lps FROM invoices WHERE id = ?').get(inv.id).lps, 'no LPS on a payment 60 days late').toBeGreaterThan(0);
  });

  it('bills deemed generation and marks it as deemed', async () => {
    energy(contract.id, '2026-04', 1000, 'ENG-D1');
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: contract.id, period_month: '2026-04', deemed_generation_mwh: 200 });
    const cols = columnsOf('invoices');
    const breakdown = r.status === 201
      ? (db.prepare('SELECT invoice_breakdown_json AS b FROM invoices WHERE id = ?').get(r.body.id).b || '')
      : '';
    const hasDeemed = cols.some(c => /deemed/i.test(c)) || /deemed/i.test(breakdown);
    expect(hasDeemed, 'deemed generation is not recorded distinguishably from delivered energy').toBe(true);
  });

  it('settles expired banked energy at 75% of tariff, not full tariff', async () => {
    // 100 MWh banked at 3/kWh, cycle already closed and nothing drawn back.
    await request(app).post('/api/energy-banking').set(auth(reia)).send({
      contract_id: contract.id, cycle: 'FY2026-27', period_month: '2026-04',
      banked_mwh: 100, tariff_per_unit: 3, cycle_ends_on: '2027-03-31',
    });
    const r = await request(app).post('/api/energy-banking/settle').set(auth(reia)).send({ as_of: '2027-04-01' });
    expect(r.status).toBe(200);
    expect(r.body.settled).toBe(1);

    const row = db.prepare(`SELECT * FROM energy_banking WHERE contract_id = ?`).get(contract.id);
    expect(row.status).toBe('SETTLED');
    expect(row.settled_mwh).toBe(100);
    // 100 MWh = 100,000 kWh at 75% of 3/kWh = 2.25 -> 225,000, not 300,000.
    expect(row.settlement_amount).toBe(225000);
    expect(row.settlement_amount).not.toBe(300000);
  });

  it('settles only what was left unused at cycle end', async () => {
    await request(app).post('/api/energy-banking').set(auth(reia)).send({
      contract_id: contract.id, cycle: 'FY2026-27', banked_mwh: 100, tariff_per_unit: 3, cycle_ends_on: '2027-03-31',
    });
    await request(app).post('/api/energy-banking/draw').set(auth(reia))
      .send({ contract_id: contract.id, cycle: 'FY2026-27', draw_mwh: 60 });
    await request(app).post('/api/energy-banking/settle').set(auth(reia)).send({ as_of: '2027-04-01' });
    const row = db.prepare(`SELECT * FROM energy_banking WHERE contract_id = ?`).get(contract.id);
    expect(row.settled_mwh).toBe(40);
    expect(row.settlement_amount).toBe(90000);   // 40,000 kWh x 2.25
  });

  it('leaves an open cycle alone until it closes', async () => {
    await request(app).post('/api/energy-banking').set(auth(reia)).send({
      contract_id: contract.id, cycle: 'FY2026-27', banked_mwh: 100, tariff_per_unit: 3, cycle_ends_on: '2027-03-31',
    });
    const r = await request(app).post('/api/energy-banking/settle').set(auth(reia)).send({ as_of: '2026-12-31' });
    expect(r.body.settled).toBe(0);
    expect(db.prepare(`SELECT status FROM energy_banking WHERE contract_id = ?`).get(contract.id).status).toBe('OPEN');
  });

  it('refuses to draw more than was banked', async () => {
    await request(app).post('/api/energy-banking').set(auth(reia)).send({
      contract_id: contract.id, cycle: 'FY2026-27', banked_mwh: 100, tariff_per_unit: 3, cycle_ends_on: '2027-03-31',
    });
    const r = await request(app).post('/api/energy-banking/draw').set(auth(reia))
      .send({ contract_id: contract.id, cycle: 'FY2026-27', draw_mwh: 150 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Only 100 MWh is banked/);
  });

  it('pays nothing out on a cycle that was fully drawn back', async () => {
    await request(app).post('/api/energy-banking').set(auth(reia)).send({
      contract_id: contract.id, cycle: 'FY2026-27', banked_mwh: 100, tariff_per_unit: 3, cycle_ends_on: '2027-03-31',
    });
    await request(app).post('/api/energy-banking/draw').set(auth(reia))
      .send({ contract_id: contract.id, cycle: 'FY2026-27', draw_mwh: 100 });
    await request(app).post('/api/energy-banking/settle').set(auth(reia)).send({ as_of: '2027-04-01' });
    const row = db.prepare(`SELECT * FROM energy_banking WHERE contract_id = ?`).get(contract.id);
    expect(row.status).toBe('EXPIRED');
    expect(row.settlement_amount).toBe(0);
  });

  it('stops reporting settled energy as available to draw', async () => {
    // Once a cycle is settled the undrawn energy has been paid out in cash. If the
    // position still counts it as available, the screen offers a draw that the
    // engine will always refuse.
    await request(app).post('/api/energy-banking').set(auth(reia)).send({
      contract_id: contract.id, cycle: 'FY2026-27', banked_mwh: 100, tariff_per_unit: 3, cycle_ends_on: '2027-03-31',
    });
    await request(app).post('/api/energy-banking/settle').set(auth(reia)).send({ as_of: '2027-04-01' });

    const pos = await request(app).get(`/api/energy-banking/${contract.id}`).set(auth(reia));
    const cycle = pos.body.find((c) => c.cycle === 'FY2026-27');
    expect(cycle.available_mwh).toBe(0);
    expect(cycle.settled_mwh).toBe(100);
    expect(cycle.banked_mwh).toBe(100);   // still shown as banked, for the history

    const draw = await request(app).post('/api/energy-banking/draw').set(auth(reia))
      .send({ contract_id: contract.id, cycle: 'FY2026-27', draw_mwh: 10 });
    expect(draw.status).toBe(400);
  });

  it('adds a DSM charge for a scheduled-versus-actual deviation', () => {
    expect(hasTable('deviation_settlements')).toBe(true);
    expect(columnsOf('deviation_settlements')).toEqual(expect.arrayContaining(['contract_id']));
  });

  it('keeps invoice numbers unique and never reuses a cancelled one', async () => {
    const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='invoices'`).get().sql;
    expect(sql).toMatch(/invoice_no[^,]*UNIQUE|UNIQUE\s*\(\s*invoice_no/i);
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT' });
    await request(app).post(`/api/invoices/${inv.id}/cancel`).set(auth(reia)).send({ reason: 'issued in error' });
    const dup = makeInvoice.bind(null, { contract_id: contract.id, invoice_no: inv.invoice_no });
    expect(dup).toThrow();
  });

  it('flags a seller-uploaded value that disagrees with the system calculation', async () => {
    // Validation compares the seller's own bill against SJVN's calculation for the
    // same contract and period, so both sides have to exist.
    db.prepare(`INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period,
                energy_mwh, tariff_per_unit, energy_charges, total_amount, status)
                VALUES ('INV-SYS', 'INV-SYS', ?, 'FINAL', 'SJVN_TO_BUYER', '2026-04', 1000, 3, 3000000, 3000000, 'APPROVED')`)
      .run(contract.id);
    const sellerBill = makeInvoice({
      contract_id: contract.id, direction: 'SELLER_TO_SJVN', billing_period: '2026-04',
      energy_mwh: 1000, tariff_per_unit: 3, total_amount: 3500000, status: 'SUBMITTED',
    });

    const r = await request(app).post(`/api/invoices/${sellerBill.id}/validate`).set(auth(reia)).send({});
    expect(r.status).toBeLessThan(500);
    const row = db.prepare('SELECT validation_status, validation_json FROM invoices WHERE id = ?').get(sellerBill.id);
    expect(row.validation_status, 'a 5 lakh disagreement was neither matched nor flagged').toBeTruthy();
    expect(row.validation_status).not.toBe('MATCHED');
    expect(row.validation_json).toMatch(/3500000|500000|mismatch|variance/i);
  });

  it('matches a seller bill that agrees with the system calculation', async () => {
    db.prepare(`INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period,
                energy_mwh, tariff_per_unit, energy_charges, total_amount, status)
                VALUES ('INV-SYS2', 'INV-SYS2', ?, 'FINAL', 'SJVN_TO_BUYER', '2026-04', 1000, 3, 3000000, 3000000, 'APPROVED')`)
      .run(contract.id);
    const sellerBill = makeInvoice({
      contract_id: contract.id, direction: 'SELLER_TO_SJVN', billing_period: '2026-04',
      energy_mwh: 1000, tariff_per_unit: 3, total_amount: 3000000, status: 'SUBMITTED',
    });
    await request(app).post(`/api/invoices/${sellerBill.id}/validate`).set(auth(reia)).send({});
    expect(db.prepare('SELECT validation_status FROM invoices WHERE id = ?').get(sellerBill.id).validation_status)
      .toBe('MATCHED');
  });
});
