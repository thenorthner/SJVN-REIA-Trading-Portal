import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from './helpers/reia.js';
import { invalidateParamCache } from '../src/mastersService.js';
import { invoiceLpsAsOf } from '../src/services/invoiceLps.js';

// Two ways an invoice's money came out wrong, each pinned to the figure it
// should have been:
//   1. a late part payment lost the surcharge the paid part earned while late;
//   2. a token payment inside the rebate window bought rebate on the whole bill;
// Day counts are calendar days here so the arithmetic can be checked by hand.

let reia, contract;
const setMode = (v) => {
  db.prepare("UPDATE system_parameters SET param_value = ? WHERE param_key = 'lps_day_count_mode'").run(v);
  invalidateParamCache();
};
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  contract = makeContract({ status: 'ACTIVE' });
  setMode('CALENDAR');
});
afterEach(() => setMode('WORKING_DAYS'));

const pay = (id, amount, date) => request(app).post(`/api/invoices/${id}/payments`).set(auth(reia))
  .send({ amount, payment_date: date, mode: 'NEFT', reference: 'T' });
const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const perDay = (amount, pct) => (amount * pct) / 100 / 365;

describe('late payment surcharge follows the days each rupee was late', () => {
  it('charges a split late payment for both parts, not just the last', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-01-01' });
    await pay(inv.id, 50000, '2026-01-31'); // half, 30 days late
    await pay(inv.id, 50000, '2026-03-02'); // the rest, 60 days late
    // 30 days at 15% on 1,00,000, then 30 more at 15.5% on the 50,000 still out.
    // The old figure was 1,253: the second half from the due date, alone.
    const expected = Math.round(perDay(100000, 15) * 30 + perDay(50000, 15.5) * 30);
    expect(row(inv.id).lps).toBe(expected);
    expect(row(inv.id).status).toBe('PARTIALLY_PAID'); // the surcharge is still owed
  });

  it('shows the same figure on the invoice screen as the payment rolled on', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-01-01' });
    await pay(inv.id, 50000, '2026-01-31');
    expect(invoiceLpsAsOf(row(inv.id), new Date('2026-03-02')).lps)
      .toBe(Math.round(perDay(100000, 15) * 30 + perDay(50000, 15.5) * 30));
  });

  it('charges nothing on a bill paid on its due date', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-01-01' });
    await pay(inv.id, 100000, '2026-01-01');
    expect(row(inv.id).lps || 0).toBe(0);
    expect(row(inv.id).status).toBe('PAID');
  });
});

describe('early-payment rebate is earned per payment', () => {
  it('gives a token early payment rebate on its own share only', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 100000, issued_at: '2026-05-01', due_date: '2026-06-15' });
    await pay(inv.id, 100, '2026-05-02'); // inside five days
    expect(row(inv.id).rebate).toBe(Math.round(100 / 0.985 * 0.015));
    await pay(inv.id, 99000, '2026-07-10'); // well after thirty days: earns nothing
    expect(row(inv.id).rebate).toBe(Math.round(100 / 0.985 * 0.015));
  });

  it('settles the whole bill for 98.5% when all of it is paid within five days', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 100000, issued_at: '2026-05-01', due_date: '2026-06-15' });
    await pay(inv.id, 98500, '2026-05-03');
    expect(row(inv.id).rebate).toBe(1500);
    expect(row(inv.id).status).toBe('PAID');
  });

  it('adds the 1% tier for a later part to the 1.5% already earned', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 100000, issued_at: '2026-05-01', due_date: '2026-06-15' });
    await pay(inv.id, 49250, '2026-05-03'); // settles 50,000 at 1.5%
    await pay(inv.id, 49500, '2026-05-20'); // settles the other 50,000 at 1%
    expect(row(inv.id).rebate).toBe(750 + 500);
    expect(row(inv.id).status).toBe('PAID');
  });
});

// Debit and credit notes have their own suite: debitCreditNotesV2.test.js.
