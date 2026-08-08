import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';

let finance, reia, contract;
beforeEach(() => { resetReia(); finance = tokenFor('FINANCE_USER'); reia = tokenFor('REIA_USER'); contract = makeContract({ status: 'ACTIVE' }); });

describe('S9 Settlement and financial tracking', () => {
  it('tracks a partial payment as partial with a balance still outstanding', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 1000000 });
    const r = await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance))
      .send({ amount: 400000, payment_date: '2026-05-10' });
    expect(r.status).toBeLessThan(400);
    const after = db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id);
    expect(after.status).toBe('PARTIALLY_PAID');
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
    expect(inv.total_amount - paid).toBe(600000);
  });

  it('marks an invoice paid once the balance clears', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 100000 });
    await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance)).send({ amount: 100000, payment_date: '2026-05-10' });
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('PAID');
  });

  it('keeps a running ledger of every movement', () => {
    expect(hasTable('payments')).toBe(true);
    expect(columnsOf('payments')).toEqual(expect.arrayContaining(['invoice_id', 'amount', 'payment_date']));
  });

  it('nets a payable against a receivable while keeping the gross visible', async () => {
    const r = await request(app).post('/api/reconciliation/run').set(auth(reia)).send({ contract_id: contract.id, period: '2026-04' });
    const netting = hasTable('invoice_mapping') || hasTable('debit_credit_notes');
    expect(netting, 'no set-off model exists to net payables against receivables').toBe(true);
    expect(r.status).toBeLessThan(500);
  });
});

describe('S9 Guards on the money paths', () => {
  let reia2, contract2;
  beforeEach(() => { reia2 = tokenFor('REIA_USER'); contract2 = makeContract({ status: 'ACTIVE', rebate_pct: 1.5, rebate_days: 5 }); });

  it('runs the rebate window from issue, not from when the row was created', async () => {
    // A bill held three weeks in draft reached the seller with its five-day
    // window already spent — the same basis error the dispute window had.
    const inv = makeInvoice({ contract_id: contract2.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 100000 });
    db.prepare(`UPDATE invoices SET created_at = datetime('now','-21 days'), issued_at = date('now'), due_date = date('now','+30 days') WHERE id = ?`).run(inv.id);

    const payDate = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);  // day 2 after issue
    const r = await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(reia2))
      .send({ amount: 100000, payment_date: payDate, mode: 'NEFT', reference: 'R' });
    expect(r.status).toBe(201);
    expect(db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(inv.id).rebate,
      'the rebate was lost to time the bill spent sitting in draft').toBe(1500);
  });

  it('still closes the rebate window five days after issue', async () => {
    const inv = makeInvoice({ contract_id: contract2.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 100000 });
    db.prepare(`UPDATE invoices SET issued_at = datetime('now','-20 days'), due_date = date('now','+10 days') WHERE id = ?`).run(inv.id);
    await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(reia2))
      .send({ amount: 100000, payment_date: new Date().toISOString().slice(0, 10), mode: 'NEFT', reference: 'R' });
    expect(db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(inv.id).rebate).toBe(0);
  });

  for (const status of ['DRAFT', 'UNDER_APPROVAL', 'SUBMITTED']) {
    it(`refuses a payment against a bill still in ${status}`, async () => {
      // It also charged surcharge on a draft, which the invoice reported as zero
      // because a DRAFT reads as settled — the record disagreed with itself.
      const inv = makeInvoice({ contract_id: contract2.id, status, total_amount: 100000 });
      const r = await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(reia2))
        .send({ amount: 100000, payment_date: '2026-09-15', mode: 'NEFT', reference: 'R' });
      expect(r.status, `a payment landed on a ${status} bill that was never issued`).toBe(400);
      expect(db.prepare('SELECT COUNT(*) c FROM payments WHERE invoice_id = ?').get(inv.id).c).toBe(0);
    });
  }

  it('still takes a payment on an issued bill', async () => {
    const inv = makeInvoice({ contract_id: contract2.id, status: 'SENT', total_amount: 100000 });
    const r = await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(reia2))
      .send({ amount: 100000, payment_date: '2026-09-15', mode: 'NEFT', reference: 'R' });
    expect(r.status, 'the guard blocked a legitimate receipt').toBe(201);
  });

  it('catches a DSM rate entered in rupees per kWh', async () => {
    // deviation_rate is ₹/MWh while every contract tariff is ₹/kWh. Entering
    // 2.00 for a ₹2/kWh rate billed ₹6 where ₹6,000 was meant.
    const r = await request(app).post('/api/deviation').set(auth(reia2)).send({
      contract_id: contract2.id, period_month: '2026-10', week_no: 1, week_date: '2026-10-07',
      entry_type: 'PRIMARY', scheduled_mwh: 50, actual_mwh: 53, deviation_rate: 2.0,
    });
    expect(r.status, 'a rate a thousand times too small was accepted').toBe(400);
    expect(r.body.likely_intended_per_mwh).toBe(2000);
    expect(r.body.error).toMatch(/MWh/);
  });

  it('accepts a real DSM rate', async () => {
    const r = await request(app).post('/api/deviation').set(auth(reia2)).send({
      contract_id: contract2.id, period_month: '2026-11', week_no: 2, week_date: '2026-11-10',
      entry_type: 'PRIMARY', scheduled_mwh: 50, actual_mwh: 53, deviation_rate: 2000,
    });
    expect(r.status).toBe(201);
    expect(r.body.deviation_amount, '3 MWh × ₹2,000/MWh').toBe(6000);
  });
});
