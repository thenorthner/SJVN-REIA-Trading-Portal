import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from './helpers/reia.js';
import { invalidateParamCache } from '../src/mastersService.js';
import { invoiceLpsAsOf } from '../src/services/invoiceLps.js';

// A debit or credit note is a document of its own: raised as a draft, issued
// only when a second person approves it, carrying its own tax, and never
// rewriting the bill it refers to. A debit note becomes its own supplementary
// invoice; a credit note is set against the bill as a deduction, not as cash.

let maker, checker, contract;
const setMode = (v) => {
  db.prepare("UPDATE system_parameters SET param_value = ? WHERE param_key = 'lps_day_count_mode'").run(v);
  invalidateParamCache();
};
beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM debit_credit_notes').run();
  maker = tokenFor('REIA_USER');
  checker = tokenFor('FINANCE_USER');
  contract = makeContract({ status: 'ACTIVE' });
  setMode('CALENDAR');
});
afterEach(() => setMode('WORKING_DAYS'));

const post = (url, body, who = maker) => request(app).post(url).set(auth(who)).send(body);
const get = (url, who = maker) => request(app).get(url).set(auth(who));
const pay = (id, amount, date) => post(`/api/invoices/${id}/payments`, { amount, payment_date: date, mode: 'NEFT', reference: 'T' });
const inv = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const cashOn = (id) => db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(id).s;
const bill = (o = {}) => makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-06-30', ...o });
const raise = (invoiceId, o = {}) => post('/api/notes', {
  invoice_id: invoiceId, note_type: 'DEBIT', taxable_amount: 10000, reason_code: 'REVISED_REA', reason: 'Final REA true-up', ...o,
});
const approve = (id, o = {}, who = checker) => post(`/api/notes/${id}/approve`, { issued_date: '2026-09-01', ...o }, who);

describe('raising a note', () => {
  it('starts as a draft that moves no money', async () => {
    const b = bill();
    const r = await raise(b.id);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.note_no).toMatch(/^DRAFT-/);
    expect(inv(b.id).total_amount).toBe(100000);
    expect((await get('/api/notes/summary')).body.total_debit).toBe(0);
    expect((await get('/api/notes/summary')).body.awaiting_approval).toBe(1);
  });

  it('carries its tax, and insists on a reason', async () => {
    const b = bill();
    const r = await raise(b.id, { taxable_amount: 10000, tax_amount: 1800, tax_label: 'IGST 18%' });
    expect(r.body.amount).toBe(11800);
    expect(r.body.tax_amount).toBe(1800);
    expect((await raise(b.id, { reason: '' })).status).toBe(400);
  });

  it('is refused against a draft or cancelled bill', async () => {
    expect((await raise(bill({ status: 'DRAFT' }).id)).status).toBe(400);
    expect((await raise(bill({ status: 'CANCELLED' }).id)).status).toBe(400);
  });

  it('refuses credit notes that together exceed the bill', async () => {
    const b = bill();
    expect((await raise(b.id, { note_type: 'CREDIT', taxable_amount: 60000 })).status).toBe(201);
    const r = await raise(b.id, { note_type: 'CREDIT', taxable_amount: 50000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/more than the bill/);
  });
});

describe('approval', () => {
  it('cannot be given by the person who raised the note', async () => {
    const n = (await raise(bill().id)).body;
    const r = await approve(n.id, {}, maker);
    expect(r.status).toBe(403);
    expect((await get(`/api/notes?invoice_id=${n.invoice_id}`)).body[0].status).toBe('DRAFT');
  });

  it('numbers the note in the financial year it is issued in', async () => {
    const n = (await raise(bill().id)).body;
    const r = await approve(n.id, { issued_date: '2026-09-01' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ISSUED');
    expect(r.body.note_no).toMatch(/^DN\/2026-27\/\d{5}$/);
    expect(r.body.approved_by).toBeTruthy();
  });

  it('can be refused, with a reason, and a refused note cannot then be issued', async () => {
    const n = (await raise(bill().id)).body;
    expect((await post(`/api/notes/${n.id}/reject`, {}, checker)).status).toBe(400);
    const r = await post(`/api/notes/${n.id}/reject`, { reason: 'Wrong month' }, checker);
    expect(r.body.status).toBe('REJECTED');
    expect((await approve(n.id)).status).toBe(400);
  });
});

describe('an issued debit note', () => {
  it('becomes its own supplementary bill and leaves the original as issued', async () => {
    const b = bill();
    await pay(b.id, 100000, '2026-06-30');
    expect(inv(b.id).status).toBe('PAID');

    const n = (await raise(b.id, { tax_amount: 1800 })).body;
    const issued = (await approve(n.id)).body;
    // The paid bill is untouched: same total, still paid.
    expect(inv(b.id).total_amount).toBe(100000);
    expect(inv(b.id).status).toBe('PAID');
    // The note's own bill, numbered as the note, payable to its own due date.
    const supp = inv(issued.supp_invoice_id);
    expect(supp.invoice_type).toBe('SUPPLEMENTARY');
    expect(supp.invoice_no).toBe(issued.note_no);
    expect(supp.parent_invoice_id).toBe(b.id);
    expect(supp.total_amount).toBe(11800);
    expect(supp.taxes).toBe(1800);
    expect(supp.status).toBe('SENT');
    expect(supp.due_date > '2026-09-01').toBe(true);
    expect(issued.due_date).toBe(supp.due_date);
  });

  it('earns surcharge from its own due date, not the old bill\'s', async () => {
    const b = bill();
    await pay(b.id, 100000, '2026-06-30');
    const issued = (await approve((await raise(b.id)).body.id)).body;
    const supp = inv(issued.supp_invoice_id);
    expect(invoiceLpsAsOf(supp, new Date(supp.due_date)).lps).toBe(0);
    const later = new Date(new Date(supp.due_date).getTime() + 30 * 86400000);
    expect(invoiceLpsAsOf(supp, later).lps).toBe(Math.round((10000 * 15) / 100 / 365 * 30));
    // And the original, paid on time, carries none.
    expect(invoiceLpsAsOf(inv(b.id), later).lps).toBe(0);
  });

  it('reads as settled once its own bill is paid', async () => {
    const issued = (await approve((await raise(bill().id)).body.id)).body;
    await pay(issued.supp_invoice_id, 10000, '2026-09-05');
    const listed = (await get(`/api/notes?invoice_id=${issued.invoice_id}`)).body[0];
    expect(listed.effective_status).toBe('SETTLED');
  });

  it('cannot be cancelled once money has come in against it', async () => {
    const issued = (await approve((await raise(bill().id)).body.id)).body;
    await pay(issued.supp_invoice_id, 5000, '2026-09-05');
    const r = await post(`/api/notes/${issued.id}/cancel`, { reason: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/credit note instead/);
  });

  it('withdraws its bill when cancelled before any payment', async () => {
    const issued = (await approve((await raise(bill().id)).body.id)).body;
    const r = await post(`/api/notes/${issued.id}/cancel`, { reason: 'raised in error' });
    expect(r.body.status).toBe('CANCELLED');
    expect(inv(issued.supp_invoice_id).status).toBe('CANCELLED');
  });
});

describe('an issued credit note', () => {
  it('finishes a part-paid bill as a deduction, not as cash received', async () => {
    const b = bill();
    await pay(b.id, 90000, '2026-06-30');
    const n = (await raise(b.id, { note_type: 'CREDIT', taxable_amount: 10000 })).body;
    const issued = (await approve(n.id)).body;
    expect(issued.applied_amount).toBe(10000);
    expect(issued.effective_status).toBe('SETTLED');
    expect(inv(b.id).status).toBe('PAID');
    expect(inv(b.id).total_amount).toBe(100000); // the bill as issued
    expect(cashOn(b.id)).toBe(90000); // collections are not inflated
  });

  it('keeps credit the bill cannot absorb, to set against another bill of the contract', async () => {
    const b = bill();
    await pay(b.id, 95000, '2026-06-30');
    const issued = (await approve((await raise(b.id, { note_type: 'CREDIT', taxable_amount: 20000 })).body.id)).body;
    expect(issued.applied_amount).toBe(5000);
    expect(issued.unapplied_credit).toBe(15000);

    const next = bill({ billing_period: '2026-05' });
    const r = await post(`/api/notes/${issued.id}/apply`, { invoice_id: next.id });
    expect(r.status).toBe(200);
    expect(r.body.unapplied_credit).toBe(0);
    expect(r.body.credit_applications.map((a) => a.amount)).toEqual([5000, 15000]);
    expect(inv(next.id).status).toBe('PARTIALLY_PAID');

    // Credit never crosses to another contract's bill.
    const again = (await approve((await raise(next.id, { note_type: 'CREDIT', taxable_amount: 1000 })).body.id)).body;
    expect(again.applied_amount).toBe(1000);
    const foreign = makeInvoice({ contract_id: makeContract({ status: 'ACTIVE' }).id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 50000 });
    const spare = (await approve((await raise(b.id, { note_type: 'CREDIT', taxable_amount: 1000 })).body.id)).body;
    expect(spare.unapplied_credit).toBe(1000); // b is already fully settled
    const r2 = await post(`/api/notes/${spare.id}/apply`, { invoice_id: foreign.id });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toMatch(/same contract/);
  });

  it('reopens the bill when cancelled', async () => {
    const b = bill();
    await pay(b.id, 90000, '2026-06-30');
    const issued = (await approve((await raise(b.id, { note_type: 'CREDIT', taxable_amount: 10000 })).body.id)).body;
    expect(inv(b.id).status).toBe('PAID');
    await post(`/api/notes/${issued.id}/cancel`, { reason: 'wrong bill' });
    expect(inv(b.id).status).toBe('PARTIALLY_PAID');
    expect(db.prepare("SELECT COUNT(*) c FROM payments WHERE mode = 'CREDIT_NOTE'").get().c).toBe(0);
  });
});

describe('the note as a document', () => {
  it('prints once issued, and not while a draft', async () => {
    const n = (await raise(bill().id)).body;
    expect((await get(`/api/notes/${n.id}/pdf`)).status).toBe(400);
    await approve(n.id);
    const r = await get(`/api/notes/${n.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/pdf/);
    expect(r.body.slice(0, 4).toString()).toBe('%PDF');
  });
});

describe('notes raised before V2', () => {
  it('still reverse what they folded into the bill when cancelled', async () => {
    const b = bill({ total_amount: 110000 }); // 100,000 + a 10,000 legacy debit note already folded in
    const id = newId('DCN');
    db.prepare(`
      INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, reason_code, amount, taxable_amount, status, model, issued_date, created_by)
      VALUES (?, 'DN/2026-04/0001', 'DEBIT', ?, ?, 'REVISED_REA', 10000, 10000, 'ISSUED', 'LEGACY', '2026-05-01', 'someone')
    `).run(id, b.id, contract.id);
    await post(`/api/notes/${id}/cancel`, { reason: 'x' });
    expect(inv(b.id).total_amount).toBe(100000);
  });
});
