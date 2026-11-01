import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, makeUser, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { invoiceBalance } from '../../src/services/invoiceLps.js';

// Debit and credit notes at their edges (1-Nov-2026). A note adjusts a bill
// already issued: a debit note becomes its own supplementary bill, a credit
// note is set against the bill (and what it cannot absorb against another of
// the contract's bills). The maker or Finance raises it, the checker or
// Finance — never the one who raised it — issues it. On GST, CGST Act s.34:
// a credit note reduces tax only up to the tax charged, and only until 30
// November after the financial year of the supply; past that it is a credit
// of value alone.

const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const noteRow = (id) => db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(id);
const maker = () => tokenFor('REIA_MAKER');
const checker = () => tokenFor('REIA_CHECKER');
const post = (path, token, body = {}) => request(app).post(path).set(auth(token)).send(body);
const raise = (body, token = maker()) => post('/api/notes', token, body);
const approve = (id, body = {}, token = checker()) => post(`/api/notes/${id}/approve`, token, body);
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

let psa;
let ppa;
beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM debit_credit_notes').run();
  psa = makeContract({ status: 'ACTIVE', contract_type: 'PSA' });
  ppa = makeContract({ status: 'ACTIVE', contract_type: 'PPA' });
});
const buyerBill = (over = {}) => makeInvoice({
  contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, energy_charges: 100000,
  billing_period: '2026-08', due_date: '2026-09-30', issued_at: '2026-09-01 10:00:00', ...over,
});
const sellerBill = (over = {}) => makeInvoice({
  contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 100000, energy_charges: 100000,
  billing_period: '2026-08', due_date: '2026-09-30', issued_at: '2026-09-01 10:00:00', ...over,
});
const credit = (inv, over = {}) => ({ invoice_id: inv.id, note_type: 'CREDIT', reason_code: 'REVISED_REA', amount: 10000, reason: 'Revised REA for August', ...over });
const debit = (inv, over = {}) => ({ ...credit(inv, over), note_type: 'DEBIT', ...over });

async function issued(body) {
  const r = await raise(body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const ok = await approve(r.body.id);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return ok.body;
}

describe('who does what with a note', () => {
  it('is raised by the maker or Finance, and no one else', async () => {
    const inv = buyerBill();
    expect((await raise(credit(inv, { amount: 1001 }), maker())).status).toBe(201);
    expect((await raise(credit(inv, { amount: 1002 }), tokenFor('FINANCE_USER'))).status).toBe(201);
    for (const role of ['REIA_CHECKER', 'REIA_APPROVER', 'SJVN_ADMIN', 'IT_SUPER_ADMIN', 'MANAGEMENT']) {
      expect((await raise(credit(inv, { amount: 1003 }), tokenFor(role))).status, role).toBe(403);
    }
    expect((await raise(credit(inv, { amount: 1004 }), tokenFor('BUYER', { linked_entity_id: psa.buyer_id }))).status).toBe(403);
  });

  it('is issued by the checker or Finance, never by whoever raised it', async () => {
    const inv = buyerBill();
    const byFinance = makeUser('FINANCE_USER');
    const r = await raise(credit(inv), signToken(byFinance));
    for (const role of ['REIA_MAKER', 'REIA_APPROVER', 'SJVN_ADMIN', 'MANAGEMENT']) {
      expect((await approve(r.body.id, {}, tokenFor(role))).status, role).toBe(403);
    }
    expect((await approve(r.body.id, {}, signToken(byFinance))).status).toBe(403);
    expect((await approve(r.body.id, {}, tokenFor('FINANCE_USER'))).status).toBe(200);
  });

  it('is not listed to a buyer or a seller', async () => {
    expect((await request(app).get('/api/notes').set(auth(tokenFor('BUYER', { linked_entity_id: psa.buyer_id })))).status).toBe(403);
    expect((await request(app).get('/api/notes').set(auth(tokenFor('SELLER', { linked_entity_id: ppa.seller_id })))).status).toBe(403);
  });
});

describe('what a note must say', () => {
  it('refuses a negative amount or tax instead of turning it positive', async () => {
    const inv = buyerBill({ taxes: 18000, total_amount: 118000 });
    for (const body of [debit(inv, { amount: -5000 }), debit(inv, { taxable_amount: -5000 }), debit(inv, { amount: 5000, tax_amount: -900 })]) {
      const r = await raise(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect(db.prepare('SELECT COUNT(*) c FROM debit_credit_notes').get().c).toBe(0);
  });

  it('refuses an amount that rounds to nothing, or one that is not a number', async () => {
    const inv = buyerBill();
    for (const amount of [0, 0.004, 'abc', 'Infinity', null]) {
      expect((await raise(debit(inv, { amount, taxable_amount: undefined }))).status, String(amount)).toBe(400);
    }
  });

  it('refuses a type that is neither debit nor credit', async () => {
    expect((await raise(debit(buyerBill(), { note_type: 'REFUND' }))).status).toBe(400);
  });

  it('adjusts only a bill already issued: not one still being drafted or approved', async () => {
    for (const status of ['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'REJECTED', 'CANCELLED']) {
      const r = await raise(debit(sellerBill({ status })));
      expect(r.status, status).toBe(400);
    }
    for (const status of ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'DISPUTED']) {
      expect((await raise(debit(buyerBill({ status })))).status, status).toBe(201);
    }
  });

  it('refuses the same note twice while the first is live, and takes it again once that is refused', async () => {
    const inv = buyerBill();
    const first = await raise(debit(inv));
    expect(first.status).toBe(201);
    const twice = await raise(debit(inv));
    expect(twice.status).toBe(409);
    expect((await raise(debit(inv, { reason: 'Revised REA for August, second revision' }))).status).toBe(201);
    expect((await post(`/api/notes/${first.body.id}/reject`, checker(), { reason: 'raised twice' })).status).toBe(200);
    expect((await raise(debit(inv))).status).toBe(201);
  });

  it('caps credit at the bill, counting drafts, and frees what a refused credit held', async () => {
    const inv = buyerBill();
    const a = await raise(credit(inv, { amount: 60000 }));
    expect((await raise(credit(inv, { amount: 40001, reason: 'Second credit for August' }))).status).toBe(400);
    await post(`/api/notes/${a.body.id}/reject`, checker(), { reason: 'wrong figure' });
    expect((await raise(credit(inv, { amount: 100000, reason: 'Second credit for August' }))).status).toBe(201);
  });

  it('credits no more tax than the bill charged, less tax already credited', async () => {
    const untaxed = buyerBill();
    expect((await raise(credit(untaxed, { taxable_amount: 1000, tax_amount: 180 }))).status).toBe(400);
    const taxed = buyerBill({ taxes: 1800, total_amount: 11800, energy_charges: 10000 });
    expect((await raise(credit(taxed, { taxable_amount: 5000, tax_amount: 900 }))).status).toBe(201);
    expect((await raise(credit(taxed, { taxable_amount: 5000, tax_amount: 901, reason: 'Second credit for August' }))).status).toBe(400);
    expect((await raise(credit(taxed, { taxable_amount: 5000, tax_amount: 900, reason: 'Second credit for August' }))).status).toBe(201);
  });

  it('lets a debit note charge tax on a bill that had none', async () => {
    expect((await raise(debit(buyerBill(), { taxable_amount: 1000, tax_amount: 180 }))).status).toBe(201);
  });

  it('credits no tax once the supply\'s GST window has closed (30 Nov after its year), but takes the value alone', async () => {
    // Supplied in May 2024 (FY 2024-25): tax could be credited until 30 Nov 2025.
    const old = buyerBill({ billing_period: '2024-05', taxes: 18000, total_amount: 118000, issued_at: '2024-06-01 10:00:00' });
    const r = await raise(credit(old, { taxable_amount: 10000, tax_amount: 1800 }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/30 November 2025/);
    expect((await raise(credit(old, { taxable_amount: 10000, tax_amount: 0 }))).status).toBe(201);
  });
});

describe('issuing a note', () => {
  it('takes a real issue date, not in the future and not before the bill itself', async () => {
    const inv = buyerBill();
    const r = await raise(debit(inv));
    const tomorrow = new Date(Date.now() + 5.5 * 3600 * 1000 + 86400000).toISOString().slice(0, 10);
    for (const issued_date of ['2026-02-31', '2026-13-01', tomorrow, '2026-08-31']) {
      const res = await approve(r.body.id, { issued_date });
      expect(res.status, issued_date).toBe(400);
    }
    expect(noteRow(r.body.id).status).toBe('DRAFT');
    expect((await approve(r.body.id, { issued_date: '2026-09-01' })).status).toBe(200);
  });

  it('numbers debit and credit notes in their own series, one after another', async () => {
    const inv = buyerBill();
    const d1 = await issued(debit(inv, { reason: 'Revised REA one' }));
    const c1 = await issued(credit(inv, { reason: 'Revised REA two' }));
    const d2 = await issued(debit(inv, { reason: 'Revised REA three' }));
    const fy = (no) => no.split('/')[1];
    expect(d1.note_no).toMatch(/^DN\/\d{4}-\d{2}\/\d{5}$/);
    expect(c1.note_no).toMatch(/^CN\//);
    expect(fy(d2.note_no)).toBe(fy(d1.note_no));
    expect(Number(d2.note_no.split('/')[2])).toBe(Number(d1.note_no.split('/')[2]) + 1);
    expect(d1.note_no.length).toBeLessThanOrEqual(16); // GST invoice rules: a serial of at most 16 characters
  });

  it('is issued once: a second approval is refused', async () => {
    const n = await issued(debit(buyerBill()));
    expect((await approve(n.id)).status).toBe(400);
  });

  it('is refused if the bill was cancelled after the note was raised', async () => {
    const inv = buyerBill();
    const r = await raise(debit(inv));
    db.prepare(`UPDATE invoices SET status = 'CANCELLED' WHERE id = ?`).run(inv.id);
    expect((await approve(r.body.id)).status).toBe(400);
  });

  it('bills a debit note on a buyer\'s bill as sent, and on a developer\'s bill as one SJVN owes', async () => {
    const onBuyer = await issued(debit(buyerBill()));
    expect(row(onBuyer.supp_invoice_id)).toMatchObject({ direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 10000 });
    const onSeller = await issued(debit(sellerBill()));
    expect(row(onSeller.supp_invoice_id)).toMatchObject({ direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 10000 });
  });

  it('takes a credit note on a developer\'s bill off what SJVN pays', async () => {
    const inv = sellerBill();
    await issued(credit(inv, { amount: 25000 }));
    expect(invoiceBalance(row(inv.id), new Date('2026-09-15')).balance).toBe(75000);
  });
});

describe('credit the bill cannot absorb', () => {
  it('is kept whole when the bill is already paid, and set against another bill of the contract', async () => {
    const paid = buyerBill({ status: 'PAID' });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES ('PAY-n1', ?, 100000, '2026-09-10', 'NEFT')`).run(paid.id);
    const n = await issued(credit(paid, { amount: 30000 }));
    expect(n).toMatchObject({ applied_amount: 0, unapplied_credit: 30000 });
    const next = buyerBill({ billing_period: '2026-09', total_amount: 20000, energy_charges: 20000 });
    const a = await post(`/api/notes/${n.id}/apply`, maker(), { invoice_id: next.id });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ applied_amount: 20000, unapplied_credit: 10000 });
    expect(row(next.id).status).toBe('PAID');
    // The 10,000 left goes only where something is open.
    expect((await post(`/api/notes/${n.id}/apply`, maker(), { invoice_id: next.id })).status).toBe(400);
  });

  it('goes only to a live bill of the same contract and direction', async () => {
    const paid = buyerBill({ status: 'PAID' });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES ('PAY-n2', ?, 100000, '2026-09-10', 'NEFT')`).run(paid.id);
    const n = await issued(credit(paid, { amount: 30000 }));
    const otherContract = makeInvoice({ contract_id: makeContract({ contract_type: 'PSA' }).id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 50000 });
    const otherDirection = makeInvoice({ contract_id: psa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 50000 });
    const draft = buyerBill({ status: 'DRAFT' });
    const cancelled = buyerBill({ status: 'CANCELLED' });
    for (const target of [otherContract, otherDirection, draft, cancelled]) {
      expect((await post(`/api/notes/${n.id}/apply`, maker(), { invoice_id: target.id })).status).toBe(400);
    }
    expect((await post(`/api/notes/${n.id}/apply`, maker(), { invoice_id: 'INV-nope' })).status).toBe(404);
    expect(noteRow(n.id).applied_amount).toBe(0);
  });

  it('is only an issued credit note\'s to apply', async () => {
    const inv = buyerBill();
    const draft = await raise(credit(inv));
    const dn = await issued(debit(inv));
    for (const id of [draft.body.id, dn.id]) {
      expect((await post(`/api/notes/${id}/apply`, maker(), { invoice_id: inv.id })).status).toBe(400);
    }
  });
});

describe('cancelling a note', () => {
  it('needs a reason once the note is issued', async () => {
    const n = await issued(credit(buyerBill()));
    expect((await post(`/api/notes/${n.id}/cancel`, checker(), {})).status).toBe(400);
    expect(noteRow(n.id).status).toBe('ISSUED');
    expect((await post(`/api/notes/${n.id}/cancel`, checker(), { reason: 'raised against the wrong bill' })).status).toBe(200);
  });

  it('takes credit back from every bill it was set against', async () => {
    const paid = buyerBill({ status: 'PAID' });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES ('PAY-n3', ?, 100000, '2026-09-10', 'NEFT')`).run(paid.id);
    const n = await issued(credit(paid, { amount: 30000 }));
    const a = buyerBill({ billing_period: '2026-09', total_amount: 20000, energy_charges: 20000 });
    const b = buyerBill({ billing_period: '2026-10', total_amount: 50000, energy_charges: 50000 });
    await post(`/api/notes/${n.id}/apply`, maker(), { invoice_id: a.id });
    await post(`/api/notes/${n.id}/apply`, maker(), { invoice_id: b.id });
    expect(row(a.id).status).toBe('PAID');
    expect(row(b.id).status).toBe('PARTIALLY_PAID');
    expect((await post(`/api/notes/${n.id}/cancel`, checker(), { reason: 'issued in error' })).status).toBe(200);
    expect(row(a.id).status).toBe('SENT');
    expect(row(b.id).status).toBe('SENT');
    expect(db.prepare(`SELECT COUNT(*) c FROM payments WHERE mode = 'CREDIT_NOTE'`).get().c).toBe(0);
  });

  it('is refused for a debit note whose bill has credit set against it', async () => {
    const dn = await issued(debit(buyerBill(), { amount: 20000 }));
    const supp = row(dn.supp_invoice_id);
    await issued(credit(supp, { amount: 5000, reason: 'Part of the debit withdrawn' }));
    expect((await post(`/api/notes/${dn.id}/cancel`, checker(), { reason: 'no longer due' })).status).toBe(400);
  });

  it('sends a dispute back to review when the credit that settled it is cancelled', async () => {
    const inv = buyerBill({ issued_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
    const d = await post('/api/disputes', tokenFor('BUYER', { linked_entity_id: psa.buyer_id }), {
      invoice_id: inv.id, reason_code: 'TARIFF_RATE_ERROR', charge_line: 'energy_charges', disputed_amount: 20000, description: 'Rate above the PSA rate',
    });
    expect(d.status).toBe(201);
    await post(`/api/disputes/${d.body.id}/resolve`, tokenFor('REIA_APPROVER'), { outcome: 'FULL_CREDIT', resolution_notes: 'PSA rate is lower' });
    const noteId = db.prepare('SELECT resolution_note_id FROM disputes WHERE id = ?').get(d.body.id).resolution_note_id;
    expect((await approve(noteId)).status).toBe(200);
    expect(row(inv.id).disputed_amount).toBe(0);

    expect((await post(`/api/notes/${noteId}/cancel`, checker(), { reason: 'resolution reopened on appeal' })).status).toBe(200);
    expect(db.prepare('SELECT status FROM disputes WHERE id = ?').get(d.body.id).status).toBe('UNDER_REVIEW');
    // The amount is held again, not demanded: what is owed is the 80,000 not in
    // dispute and the surcharge on that alone.
    expect(row(inv.id)).toMatchObject({ status: 'DISPUTED', disputed_amount: 20000 });
    const bal = invoiceBalance(row(inv.id), new Date());
    expect(bal.accrued.base).toBe(80000);
    expect(bal.balance).toBe(Math.round(80000 + bal.lps_to_date));
  });

  it('cannot be cancelled twice, nor a rejected one', async () => {
    const n = await issued(credit(buyerBill()));
    await post(`/api/notes/${n.id}/cancel`, checker(), { reason: 'error' });
    expect((await post(`/api/notes/${n.id}/cancel`, checker(), { reason: 'again' })).status).toBe(400);
  });
});

describe('notes in the totals', () => {
  it('count once issued, and drop out when cancelled', async () => {
    const inv = buyerBill();
    await raise(debit(inv, { amount: 7000, reason: 'Draft only' }));
    const d = await issued(debit(inv, { amount: 5000 }));
    await issued(credit(inv, { amount: 2000, reason: 'Revised REA, lower' }));
    let s = (await request(app).get('/api/notes/summary').set(auth(checker()))).body;
    expect(s).toMatchObject({ total_debit: 5000, total_credit: 2000, net: 3000, awaiting_approval: 1 });
    await post(`/api/notes/${d.id}/cancel`, checker(), { reason: 'issued in error' });
    s = (await request(app).get('/api/notes/summary').set(auth(checker()))).body;
    expect(s).toMatchObject({ total_debit: 0, total_credit: 2000, net: -2000 });
  });
});

describe('the note as a document', () => {
  it('can be downloaded by the buyer it was issued to, once issued, and by no other buyer', async () => {
    const inv = buyerBill();
    const draft = await raise(debit(inv, { reason: 'Draft, not yet issued' }));
    const n = await issued(credit(inv));
    const own = tokenFor('BUYER', { linked_entity_id: psa.buyer_id });
    const other = tokenFor('BUYER', { linked_entity_id: makeContract({ contract_type: 'PSA' }).buyer_id });
    const pdf = await request(app).get(`/api/notes/${n.id}/pdf`).set(auth(own));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect((await request(app).get(`/api/notes/${n.id}/pdf`).set(auth(other))).status).toBe(404);
    expect((await request(app).get(`/api/notes/${draft.body.id}/pdf`).set(auth(own))).status).toBe(404);
  });

  it('still prints once cancelled, marked so', async () => {
    const n = await issued(credit(buyerBill()));
    await post(`/api/notes/${n.id}/cancel`, checker(), { reason: 'issued in error' });
    expect((await request(app).get(`/api/notes/${n.id}/pdf`).set(auth(checker()))).status).toBe(200);
  });
});

describe('a note\'s issue date stays the desk\'s calendar day', () => {
  it('defaults to today in India', async () => {
    const n = await issued(debit(buyerBill()));
    expect(n.issued_date).toBe(istToday());
  });
});
