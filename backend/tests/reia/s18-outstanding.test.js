import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { receivablesOutstanding, payablesOutstanding, overdueCount } from '../../src/services/outstanding.js';

// Receivables and payables were SUM(total_amount) over invoices not marked PAID
// or CANCELLED. A part-paid bill is neither, so it counted at full face value no
// matter how much had been collected against it — and PARTIALLY_PAID is set the
// moment a short payment lands, so the overstatement grew exactly as money came
// in. On the live database payables read 3.72 crore above what was actually owed.

let reia, contract;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  contract = makeContract({ status: 'ACTIVE' });
});

const pay = (invId, amount, date = '2026-05-01') =>
  request(app).post(`/api/invoices/${invId}/payments`).set(auth(reia))
    .send({ amount, payment_date: date, mode: 'NEFT', reference: 'T' });

describe('S18 Outstanding is what is still owed, not what was billed', () => {
  it('drops a part payment out of receivables', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    expect(receivablesOutstanding()).toBe(100000);
    await pay(inv.id, 60000);
    expect(receivablesOutstanding(), 'a 60,000 payment left the full 100,000 sitting in receivables').toBe(40000);
  });

  it('drops a part payment out of payables', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 100000 });
    await pay(inv.id, 25000);
    // Paying a seller bill early also earns the 1.5% rebate, so what is still
    // owed is the bill less the rebate less the payment — which is the point:
    // the figure tracks the invoice rather than restating its face value.
    const { rebate } = db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(inv.id);
    expect(rebate, 'expected the early-payment rebate to have been applied').toBe(1500);
    expect(payablesOutstanding()).toBe(100000 - rebate - 25000);
  });

  it('counts a fully settled bill as nothing outstanding', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    await pay(inv.id, 100000);
    expect(receivablesOutstanding()).toBe(0);
  });

  it('keeps an untouched bill at its full value', () => {
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    expect(receivablesOutstanding()).toBe(100000);
  });

  it('ignores cancelled bills entirely', () => {
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'CANCELLED', total_amount: 100000 });
    expect(receivablesOutstanding()).toBe(0);
  });

  it('carries the surcharge and the rebate the invoice screen shows', () => {
    // The dashboard and the bill must not disagree about one invoice.
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    db.prepare('UPDATE invoices SET lps = 5000, rebate = 2000 WHERE id = ?').run(inv.id);
    expect(receivablesOutstanding()).toBe(100000 - 2000 + 5000);
  });

  it('holds back the disputed portion', () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'DISPUTED', total_amount: 100000 });
    db.prepare('UPDATE invoices SET disputed_amount = 15000 WHERE id = ?').run(inv.id);
    expect(receivablesOutstanding(), 'a disputed amount was counted as collectible').toBe(85000);
  });

  it('lets a credit note reduce the total rather than adding to it', () => {
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: -20000 });
    expect(receivablesOutstanding()).toBe(80000);
  });

  it('stops counting a past-due bill as overdue once its balance is cleared', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    db.prepare(`UPDATE invoices SET due_date = date('now','-10 days') WHERE id = ?`).run(inv.id);
    expect(overdueCount()).toBe(1);
    await pay(inv.id, 100000);
    expect(overdueCount(), 'a bill paid in full was still being counted overdue').toBe(0);
  });

  it('reports the same figure through the dashboard endpoint', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    await pay(inv.id, 60000);
    const r = await request(app).get('/api/dashboard/reia').set(auth(reia));
    expect(r.status).toBe(200);
    expect(r.body.kpis.receivables, 'the endpoint and the service disagree').toBe(receivablesOutstanding());
    expect(r.body.kpis.receivables).toBe(40000);
  });
});
