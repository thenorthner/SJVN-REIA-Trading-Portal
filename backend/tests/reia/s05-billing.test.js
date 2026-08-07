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
      .send({ parent_invoice_id: inv.id, contract_id: contract.id, amount: 50000, reason: 'Tariff revision' });
    expect(r.status).toBeLessThan(400);
  });

  it('applies the rebate when payment lands inside the window', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 1000000, due_date: '2026-05-31' });
    const r = await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance))
      .send({ amount: 1000000, payment_date: '2026-05-03', bill_date: '2026-05-01' });
    expect(r.status).toBeLessThan(400);
    const after = db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(inv.id);
    expect(after.rebate, 'no rebate applied for an early payment').toBeGreaterThan(0);
  });

  it('applies no rebate once the window has passed', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 1000000, due_date: '2026-05-31' });
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

  it('settles expired banked energy at 75% of tariff', () => {
    const banked = hasTable('energy_banking') || columnsOf('contracts').some(c => /bank/i.test(c));
    expect(banked, 'no banking model exists to settle unused banked energy at 75%').toBe(true);
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
    const inv = makeInvoice({ contract_id: contract.id, total_amount: 3000000 });
    const r = await request(app).post(`/api/invoices/${inv.id}/validate`).set(auth(reia))
      .send({ seller_claimed_amount: 3500000 });
    const row = db.prepare('SELECT validation_status, validation_json FROM invoices WHERE id = ?').get(inv.id);
    expect(row.validation_status, 'seller-claimed value was neither validated nor flagged').toBeTruthy();
    expect(r.status).toBeLessThan(500);
  });
});
