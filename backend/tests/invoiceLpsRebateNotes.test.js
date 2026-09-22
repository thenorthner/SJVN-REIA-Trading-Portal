import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from './helpers/reia.js';
import { invalidateParamCache } from '../src/mastersService.js';
import { invoiceLpsAsOf } from '../src/services/invoiceLps.js';

// Three ways an invoice's money came out wrong, each pinned to the figure it
// should have been:
//   1. a late part payment lost the surcharge the paid part earned while late;
//   2. a token payment inside the rebate window bought rebate on the whole bill;
//   3. a debit note was surcharged from the original bill's due date, and did
//      not reopen a bill that had been paid.
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

describe('debit and credit notes', () => {
  const note = (body) => request(app).post('/api/notes').set(auth(reia)).send(body);

  it('reopens a paid bill when a debit note adds to it', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-01-01' });
    await pay(inv.id, 100000, '2026-01-01');
    expect(row(inv.id).status).toBe('PAID');
    const r = await note({ invoice_id: inv.id, note_type: 'DEBIT', amount: 10000, reason_code: 'REVISED_REA', issued_date: '2026-03-01' });
    expect(r.status).toBe(201);
    expect(row(inv.id).status).toBe('PARTIALLY_PAID');
  });

  it('surcharges a debit note from its own due date, not the old bill\'s', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-01-01' });
    await pay(inv.id, 100000, '2026-01-01');
    await note({ invoice_id: inv.id, note_type: 'DEBIT', amount: 10000, reason_code: 'REVISED_REA', issued_date: '2026-03-01' });
    // The bill was paid on time and the note is not yet due on 15 March:
    // nothing is late. The old engine charged the 10,000 from 1 January.
    expect(invoiceLpsAsOf(row(inv.id), new Date('2026-03-15')).lps).toBe(0);
    expect(invoiceLpsAsOf(row(inv.id), new Date('2026-09-30')).lps).toBeGreaterThan(0);
  });

  it('finishes a part-paid bill when a credit note covers the rest', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-12-31' });
    await pay(inv.id, 90000, '2026-06-01');
    expect(row(inv.id).status).toBe('PARTIALLY_PAID');
    await note({ invoice_id: inv.id, note_type: 'CREDIT', amount: 10000, reason_code: 'REVISED_REA' });
    expect(row(inv.id).status).toBe('PAID');
  });

  it('refuses a credit note larger than the bill', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    const r = await note({ invoice_id: inv.id, note_type: 'CREDIT', amount: 150000, reason_code: 'REVISED_REA' });
    expect(r.status).toBe(400);
    expect(row(inv.id).total_amount).toBe(100000);
  });
});
