import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Payment monitoring, developer payments and outstanding ageing are one question
// asked three ways: who owes what, how late it is, and what the lateness has
// earned. This is the answer, per bill and per counterparty.

const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

let reia, buyer, seller, buyerContract, sellerContract;

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  buyer = makeEntity('BUYER', { name: 'Test Discom' });
  seller = makeEntity('SELLER', { name: 'Test Solar Ltd' });
  buyerContract = makeContract({ buyer_id: buyer.id, status: 'ACTIVE', lps_annual_pct: 15, lps_grace_days: 0 });
  sellerContract = makeContract({ seller_id: seller.id, status: 'ACTIVE', lps_annual_pct: 12, lps_grace_days: 0 });
});

const monitor = (side = 'RECEIVABLE') =>
  request(app).get(`/api/reports/payment-monitoring?side=${side}`).set(auth(reia));

describe('S28 Payment monitoring', () => {
  it('lists every open bill with how late it is and what is left on it', async () => {
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 500000, due_date: dayOffset(-40) });
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 200000, due_date: dayOffset(10) });

    const r = await monitor();
    expect(r.status).toBe(200);
    expect(r.body.bills).toHaveLength(2);
    const late = r.body.bills[0];
    expect(late.days_past_due).toBe(40);
    expect(late.outstanding).toBe(500000);
    expect(late.counterparty_name).toBe('Test Discom');
    // Not yet due is not overdue, and carries no surcharge.
    const notDue = r.body.bills.find((b) => b.outstanding === 200000);
    expect(notDue.days_past_due).toBeLessThan(0);
    expect(notDue.lps_accrued_unbilled).toBe(0);
  });

  it('rolls the same bills up per counterparty, worst first', async () => {
    const other = makeEntity('BUYER', { name: 'Another Discom' });
    const otherContract = makeContract({ buyer_id: other.id, status: 'ACTIVE' });
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 300000, due_date: dayOffset(-10) });
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 200000, due_date: dayOffset(-70) });
    makeInvoice({ contract_id: otherContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 900000, due_date: dayOffset(5) });

    const { body } = await monitor();
    expect(body.counterparties.map((c) => c.counterparty_name)).toEqual(['Another Discom', 'Test Discom']);
    const ours = body.counterparties.find((c) => c.counterparty_name === 'Test Discom');
    expect(ours).toMatchObject({ invoices: 2, outstanding: 500000, overdue_invoices: 2, overdue_amount: 500000 });
    expect(ours.oldest_days_past_due).toBe(70);
    // The one that is not yet due is outstanding but not overdue.
    const theirs = body.counterparties.find((c) => c.counterparty_name === 'Another Discom');
    expect(theirs).toMatchObject({ invoices: 1, outstanding: 900000, overdue_invoices: 0, overdue_amount: 0 });
  });

  it('separates surcharge already billed from surcharge earned since', async () => {
    const billed = makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: dayOffset(-5) });
    db.prepare('UPDATE invoices SET lps = 2000 WHERE id = ?').run(billed.id);
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 1000000, due_date: dayOffset(-100) });

    const { body } = await monitor();
    const withCharge = body.bills.find((b) => b.lps_charged === 2000);
    expect(withCharge).toBeTruthy();
    const longOverdue = body.bills.find((b) => b.total_amount === 1000000);
    expect(longOverdue.lps_charged).toBe(0);
    expect(longOverdue.lps_accrued_unbilled).toBeGreaterThan(0);
    // Counted in working days, which is how this platform charges it.
    expect(longOverdue.surcharge_days).toBeLessThan(longOverdue.days_past_due);
    expect(body.totals.lps_accrued_unbilled).toBe(
      body.bills.reduce((a, b) => a + b.lps_accrued_unbilled, 0),
    );
  });

  it('uses each contract’s own surcharge rate', async () => {
    makeInvoice({ contract_id: sellerContract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 1000000, due_date: dayOffset(-60) });
    const payable = await monitor('PAYABLE');
    const bill = payable.body.bills[0];
    expect(bill.lps_annual_pct).toBe(12);
    expect(bill.counterparty_name).toBe('Test Solar Ltd');
    // 12% a year on 10 lakh for ~43 working days is around 14,000 — the point is
    // that it follows the contract and not the 15% platform default.
    expect(bill.lps_accrued_unbilled).toBeGreaterThan(10000);
    expect(bill.lps_accrued_unbilled).toBeLessThan(20000);
  });

  it('carries the ageing table, adding up to the same outstanding', async () => {
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: dayOffset(20) });
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 200000, due_date: dayOffset(-15) });
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 400000, due_date: dayOffset(-120) });

    const { body } = await monitor();
    const total = body.ageing.reduce((a, b) => a + b.amount, 0);
    expect(total).toBe(body.totals.outstanding);
    expect(body.ageing.find((b) => b.bucket === 'DAYS_90_PLUS').amount).toBe(400000);
  });

  it('leaves out what has been collected, whatever the status says', async () => {
    const inv = makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: dayOffset(-30) });
    db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, ?, ?, ?)')
      .run(newId('PAY'), inv.id, 100000, dayOffset(-1), 'NEFT');
    const { body } = await monitor();
    expect(body.bills).toHaveLength(0);
    expect(body.totals.outstanding).toBe(0);
  });

  it('answers for the payable side separately', async () => {
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 500000, due_date: dayOffset(-5) });
    makeInvoice({ contract_id: sellerContract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 300000, due_date: dayOffset(-5) });

    const receivable = await monitor('RECEIVABLE');
    expect(receivable.body.bills.map((b) => b.counterparty_name)).toEqual(['Test Discom']);
    const payable = await monitor('PAYABLE');
    expect(payable.body.bills.map((b) => b.counterparty_name)).toEqual(['Test Solar Ltd']);
    expect(payable.body.totals.outstanding).toBe(300000);
  });

  it('refuses a side it does not have, rather than guessing', async () => {
    const r = await request(app).get('/api/reports/payment-monitoring?side=SIDEWAYS').set(auth(reia));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/RECEIVABLE or PAYABLE/);
  });

  it('is not a counterparty’s to read', async () => {
    const sellerUser = tokenFor('SELLER', { linked_entity_id: seller.id });
    expect((await request(app).get('/api/reports/payment-monitoring').set(auth(sellerUser))).status).toBe(403);
  });
});
