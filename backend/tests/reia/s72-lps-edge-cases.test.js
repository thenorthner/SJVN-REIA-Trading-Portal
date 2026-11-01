import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, makeEntity, resetReia } from '../helpers/reia.js';
import { invalidateParamCache } from '../../src/mastersService.js';
import { accruedLpsTimeline } from '../../src/disputesConstants.js';
import { invoiceLpsAsOf, invoiceBalance } from '../../src/services/invoiceLps.js';
import { lpsBillPreview, raiseLpsBills } from '../../src/services/lpsBills.js';
import { newId } from '../../src/util.js';

// Late payment surcharge at its edges (31-Oct-2026), against the Electricity
// (Late Payment Surcharge and Related Matters) Rules, 2022:
//   r.2(1)(h)  surcharge at the base rate for the first month of default, then
//              +0.5% for each further month, never more than 3% above base;
//   r.5        a payment goes to surcharge first, oldest bill first;
// and the PSA: no surcharge on the disputed part while the dispute is open, and
// from the original due date on whatever the payer turns out to owe.
//
// Expected figures are worked out here, day by day, not read back from the
// engine. Days are calendar days (lps_day_count_mode CALENDAR), base 15% p.a.,
// step 0.5%, cap 3% — the seeded masters.

const BASE = 15;
const rateOnDay = (d) => BASE + Math.min(0.5 * Math.floor((d - 1) / 30), 3);
/** Surcharge on a constant `amount` left unpaid for `days` days past the due date. */
const stepped = (amount, days) => {
  let s = 0;
  for (let d = 1; d <= days; d += 1) s += (amount * rateOnDay(d)) / 100 / 365;
  return s;
};
const TERMS = { annualPct: BASE, monthlyStepPct: 0.5, stepCapPct: 3 };
const at = (inv, asOf, extra = {}) => accruedLpsTimeline(inv, { ...TERMS, asOf, ...extra });

const setParam = (key, value) => {
  db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(value, key);
  invalidateParamCache();
};
const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const finance = () => tokenFor('FINANCE_USER');
const pay = (id, amount, date) => request(app).post(`/api/invoices/${id}/payments`).set(auth(finance()))
  .send({ amount, payment_date: date, mode: 'NEFT', reference: 'T' });

let contract;
beforeEach(() => {
  resetReia();
  setParam('lps_day_count_mode', 'CALENDAR');
  contract = makeContract({ status: 'ACTIVE', contract_type: 'PSA' });
});
afterEach(() => setParam('lps_day_count_mode', 'CALENDAR'));

const buyerBill = (over = {}) => makeInvoice({
  contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000,
  energy_charges: 100000, due_date: '2026-06-01', issued_at: '2026-05-02 10:00:00', ...over,
});

describe('LPS: the rate for each day late (LPS Rules 2022 r.2(1)(h))', () => {
  const bill = { total_amount: 100000, due_date: '2026-06-01' };

  it('charges nothing before or on the due date', () => {
    expect(at(bill, '2026-05-20').lps).toBe(0);
    expect(at(bill, '2026-06-01').lps).toBe(0);
  });

  it('charges one day at the base rate the day after', () => {
    expect(at(bill, '2026-06-02')).toMatchObject({ days_overdue: 1, lps: Math.round(stepped(100000, 1)) });
  });

  it('holds the base rate for 30 days and adds 0.5% from day 31', () => {
    expect(at(bill, '2026-07-01')).toMatchObject({ days_overdue: 30, lps: Math.round(stepped(100000, 30)), effective_pct: 15 });
    expect(at(bill, '2026-07-02')).toMatchObject({ days_overdue: 31, lps: Math.round(stepped(100000, 31)), effective_pct: 15.5 });
  });

  it('stops rising at 3% above the base rate, from the seventh month on', () => {
    // Day 181 is the first at +3%; day 300 is still +3%, not +4.5%.
    const r = at(bill, '2027-03-28'); // 300 days after 1 Jun 2026
    expect(r.days_overdue).toBe(300);
    expect(r.effective_pct).toBe(18);
    expect(r.lps).toBe(Math.round(stepped(100000, 300)));
  });

  it('leaves the disputed part out of the base', () => {
    expect(at({ ...bill, disputed_amount: 40000 }, '2026-07-01').lps).toBe(Math.round(stepped(60000, 30)));
  });

  it('charges nothing on a bill with no due date, or one fully disputed', () => {
    expect(at({ total_amount: 100000 }, '2026-09-01').lps).toBe(0);
    expect(at({ ...bill, disputed_amount: 100000 }, '2026-09-01').lps).toBe(0);
  });

  it('charges nothing inside the grace days, and every day from the due date once they pass', () => {
    expect(at(bill, '2026-06-06', { graceDays: 5 }).lps).toBe(0);
    expect(at(bill, '2026-06-07', { graceDays: 5 }).lps).toBe(Math.round(stepped(100000, 6)));
  });

  it('stops on the day the bill is paid off: that day is charged, none after', () => {
    const r = at(bill, '2026-09-09', { payments: [{ amount: 100000, date: '2026-06-11' }] });
    expect(r.days_overdue).toBe(10);
    expect(r.lps).toBe(Math.round(stepped(100000, 10)));
  });

  it('starts a debit note folded into the bill on its own due date, at the rate the default has reached', () => {
    // 1,00,000 for 30 days at 15%; then 1,10,000 for 10 days at 15.5%.
    const r = at({ total_amount: 110000, due_date: '2026-06-01' }, '2026-07-11', { notes: [{ amount: 10000, due_date: '2026-07-01' }] });
    expect(r.lps).toBe(Math.round((100000 * 15 * 30) / 36500 + (110000 * 15.5 * 10) / 36500));
  });

  it('rounds to whole rupees', () => {
    expect(Number.isInteger(at(bill, '2026-06-17').lps)).toBe(true);
  });
});

describe('LPS on the bill as Finance records money against it', () => {
  it('keeps a bill part-paid while its surcharge is owed, and closes it once that is paid', async () => {
    const inv = buyerBill();
    expect((await pay(inv.id, 100000, '2026-07-01')).status).toBe(201);
    const lps = Math.round(stepped(100000, 30));
    expect(row(inv.id)).toMatchObject({ status: 'PARTIALLY_PAID', lps });
    expect(invoiceBalance(row(inv.id), new Date('2026-07-01')).balance).toBe(lps);
    expect((await pay(inv.id, lps, '2026-07-01')).status).toBe(201);
    expect(row(inv.id).status).toBe('PAID');
  });

  it('reads no surcharge on a draft or cancelled bill, however old its due date', () => {
    for (const status of ['DRAFT', 'CANCELLED']) {
      const inv = buyerBill({ status });
      expect(invoiceBalance(inv, new Date('2026-09-01')).lps_to_date).toBe(0);
    }
  });

  it('charges SJVN the surcharge on a developer\'s bill it pays late', () => {
    const ppa = makeContract({ status: 'ACTIVE', contract_type: 'PPA' });
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 100000, due_date: '2026-06-01' });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, 100000, '2026-07-01', 'NEFT')`).run(newId('PAY'), inv.id);
    expect(invoiceLpsAsOf(row(inv.id), new Date('2026-08-01')).lps).toBe(Math.round(stepped(100000, 30)));
  });
});

describe('no surcharge on surcharge', () => {
  it('lets the month\'s LPS bill earn none itself', () => {
    buyerBill({ due_date: '2026-08-01' });
    const { raised } = raiseLpsBills({ period: '2026-08', user: { name: 'maker', id: 'U1' } });
    expect(raised).toHaveLength(1);
    const lpsBill = { ...row(raised[0].invoice_id), status: 'SENT', due_date: '2026-09-01' };
    expect(invoiceLpsAsOf(lpsBill, new Date('2027-01-01')).lps).toBe(0);
  });

  it('lets a supplementary bill raised for LPS earn none either', async () => {
    const r = await request(app).post('/api/invoices/supplementary').set(auth(tokenFor('REIA_MAKER')))
      .send({ contract_id: contract.id, billing_period: '2026-05', amount: 5000, reason_code: 'LPS', reason: 'Surcharge for May 2026' });
    expect(r.status).toBe(201);
    db.prepare(`UPDATE invoices SET status = 'SENT', due_date = '2026-06-01' WHERE id = ?`).run(r.body.id);
    expect(invoiceLpsAsOf(row(r.body.id), new Date('2026-09-01')).lps).toBe(0);
  });

  it('lets a debit note raised for LPS earn none either', async () => {
    const parent = buyerBill();
    const dn = await request(app).post('/api/notes').set(auth(tokenFor('REIA_MAKER')))
      .send({ invoice_id: parent.id, note_type: 'DEBIT', reason_code: 'LPS', amount: 5000, reason: 'Surcharge on the May bill' });
    expect(dn.status).toBe(201);
    const ok = await request(app).post(`/api/notes/${dn.body.id}/approve`).set(auth(tokenFor('REIA_CHECKER'))).send({});
    expect(ok.status).toBe(200);
    const supp = row(ok.body.supp_invoice_id);
    expect(invoiceLpsAsOf({ ...supp, due_date: '2026-06-01' }, new Date('2026-09-01')).lps).toBe(0);
  });
});

describe('the month\'s LPS bills (PM5)', () => {
  it('bills each month only what it added, and does not bill a month twice', () => {
    const inv = buyerBill({ due_date: '2026-08-01' });
    const aug = raiseLpsBills({ period: '2026-08', user: { name: 'maker' } });
    expect(aug.raised[0].total).toBe(Math.round(stepped(100000, 30)));
    expect(raiseLpsBills({ period: '2026-08', user: { name: 'maker' } }).raised).toHaveLength(0);
    const sep = lpsBillPreview('2026-09');
    expect(sep.rows[0].lines[0]).toMatchObject({ invoice_id: inv.id, days_overdue: 60 });
    expect(sep.rows[0].total).toBe(Math.round(stepped(100000, 60)) - Math.round(stepped(100000, 30)));
  });

  it('leaves out a bill paid on its due date', async () => {
    const inv = buyerBill({ due_date: '2026-08-01' });
    await pay(inv.id, 100000, '2026-08-01');
    expect(lpsBillPreview('2026-08').rows).toHaveLength(0);
  });

  it('refuses a month that has not ended', () => {
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(() => lpsBillPreview(thisMonth)).toThrow(/has not ended/);
  });
});

describe('a buyer\'s lump receipt goes to surcharge first, oldest bill first (LPS Rules r.5)', () => {
  it('counts the surcharge to the day the money came, not to the day it is entered', async () => {
    const a = buyerBill({ due_date: '2026-06-01', billing_period: '2026-04' });
    const b = buyerBill({ due_date: '2026-07-01', billing_period: '2026-05' });
    const r = await request(app).post('/api/invoices/waterfall-payment').set(auth(finance()))
      .send({ buyer_id: contract.buyer_id, amount: 10000, payment_date: '2026-07-01', reference: 'UTR1' });
    expect(r.status).toBe(201);
    const lpsA = Math.round(stepped(100000, 30)); // A is 30 days late on 1 July; B is not late at all
    const byNo = Object.fromEntries(r.body.allocations.map((x) => [x.invoice_no, x]));
    expect(byNo[a.invoice_no]).toMatchObject({ to_lps: lpsA, to_principal: 10000 - lpsA });
    expect(byNo[b.invoice_no]).toBeUndefined();
  });
});

describe('disputes and surcharge', () => {
  const buyerUser = () => tokenFor('BUYER', { linked_entity_id: contract.buyer_id });
  const approver = () => tokenFor('REIA_APPROVER');

  // The bill is presented now, so the dispute window is open, and was due on
  // 1 June; the buyer paid the 80,000 it did not dispute on the due date.
  async function disputedBill() {
    const inv = buyerBill({ issued_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    const d = await request(app).post('/api/disputes').set(auth(buyerUser())).send({
      invoice_id: inv.id, reason_code: 'TARIFF_RATE_ERROR', charge_line: 'energy_charges', disputed_amount: 20000,
      description: 'Rate applied is above the PSA rate',
    });
    expect(d.status).toBe(201);
    expect(row(inv.id)).toMatchObject({ status: 'DISPUTED', disputed_amount: 20000 });
    expect((await pay(inv.id, 80000, '2026-06-01')).status).toBe(201);
    return { inv, dispute: d.body };
  }

  it('does not surcharge a buyer on the part it won', async () => {
    const { inv, dispute } = await disputedBill();
    const res = await request(app).post(`/api/disputes/${dispute.id}/resolve`).set(auth(approver()))
      .send({ outcome: 'FULL_CREDIT', resolution_notes: 'PSA rate confirmed lower' });
    expect(res.status).toBe(200);
    const noteId = db.prepare('SELECT resolution_note_id FROM disputes WHERE id = ?').get(dispute.id).resolution_note_id;
    const ok = await request(app).post(`/api/notes/${noteId}/approve`).set(auth(tokenFor('REIA_CHECKER'))).send({});
    expect(ok.status).toBe(200);
    const after = row(inv.id);
    expect(invoiceLpsAsOf(after, new Date()).lps).toBe(0);
    expect(after.status).toBe('PAID');
  });

  it('surcharges a buyer who lost on the disputed part from the original due date', async () => {
    const { inv, dispute } = await disputedBill();
    const res = await request(app).post(`/api/disputes/${dispute.id}/resolve`).set(auth(approver()))
      .send({ outcome: 'REJECTED', resolution_notes: 'Rate billed is the PSA rate' });
    expect(res.status).toBe(200);
    expect(row(inv.id).disputed_amount).toBe(0);
    expect((await pay(inv.id, 20000, '2026-09-01')).status).toBe(201);
    // 20,000 unpaid from 1 June to 1 September: 92 days.
    expect(row(inv.id).lps).toBe(Math.round(stepped(20000, 92)));
    expect(row(inv.id).status).toBe('PARTIALLY_PAID');
  });
});
