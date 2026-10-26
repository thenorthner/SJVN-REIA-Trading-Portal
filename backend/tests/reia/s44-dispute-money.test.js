import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Found by the browser audit of Dispute Management (16-Oct-2026) on the QA copy:
// a seller's claim cut what SJVN paid it, an accepted credit was counted twice
// on the buyer's statement, one REIA user granted credits alone, the desk closed
// a resolution before the party could answer, and a dispute waiting on the
// buyer's reply was escalated for SJVN's delay.

let reia, finance, buyer, seller, buyerCo, sellerCo, psa, ppa;
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);
const get = (path, who) => request(app).get(path).set(auth(who));
const inv = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');
  buyerCo = makeEntity('BUYER');
  sellerCo = makeEntity('SELLER');
  buyer = signToken(makeUser('BUYER', { linked_entity_id: buyerCo.id }));
  seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
  psa = makeContract({ contract_type: 'PSA', buyer_id: buyerCo.id, seller_id: sellerCo.id });
  ppa = makeContract({ contract_type: 'PPA', buyer_id: buyerCo.id, seller_id: sellerCo.id });
});

const bill = (contract, over = {}) => {
  const b = makeInvoice({
    contract_id: contract.id, status: 'SENT', total_amount: 60000, energy_charges: 58600, trading_margin: 1400,
    direction: contract.contract_type === 'PPA' ? 'SELLER_TO_SJVN' : 'SJVN_TO_BUYER', ...over,
  });
  db.prepare(`UPDATE invoices SET issued_at = datetime('now'), due_date = date('now', '+45 days') WHERE id = ?`).run(b.id);
  return inv(b.id);
};
const raise = (who, b, amount, over = {}) => post('/api/disputes', who, {
  invoice_id: b.id, reason_code: 'ENERGY_DATA_MISMATCH', charge_line: 'energy_charges', disputed_amount: amount, issue_description: 'QA meter gap', ...over,
});
// Phase B.2: the REIA approver decides a dispute.
const resolve = (d, body, who = tokenFor('REIA_APPROVER')) => post(`/api/disputes/${d.id}/resolve`, who, { resolution_notes: 'checked against the REA', ...body });

describe('S44 A seller disputes to be paid more', () => {
  it('holds nothing back from what SJVN owes it, and an accepted claim is a debit note SJVN pays', async () => {
    const b = bill(ppa, { total_amount: 77100, energy_charges: 77100, trading_margin: 0, status: 'APPROVED' });
    const d = (await raise(seller, b, 3000)).body;
    expect(inv(b.id)).toMatchObject({ disputed_amount: 0, status: 'APPROVED' });
    const r = await resolve(d, { outcome: 'FULL_CREDIT' });
    expect(r.status).toBe(200);
    expect(inv(b.id).total_amount, 'the seller was paid less for a claim SJVN accepted').toBe(77100);
    const note = db.prepare('SELECT * FROM debit_credit_notes WHERE invoice_id = ?').get(b.id);
    expect(note).toMatchObject({ note_type: 'DEBIT', status: 'DRAFT', amount: 3000 });
    expect((await post(`/api/notes/${note.id}/approve`, finance)).status).toBe(200);
    const supp = db.prepare(`SELECT * FROM invoices WHERE invoice_type = 'SUPPLEMENTARY' AND parent_invoice_id = ?`).get(b.id);
    expect(supp).toMatchObject({ direction: 'SELLER_TO_SJVN', total_amount: 3000 });
  });
});

describe('S44 A buyer\'s accepted claim', () => {
  it('is one credit note, approved by someone else, and the bill as issued stays', async () => {
    const b = bill(psa);
    const d = (await raise(buyer, b, 10000)).body;
    expect(inv(b.id)).toMatchObject({ status: 'DISPUTED', disputed_amount: 10000 });
    const approver = tokenFor('REIA_APPROVER');
    await resolve(d, { outcome: 'PARTIAL_CREDIT', accepted_amount: 6000 }, approver);
    // Held while the note waits, so the buyer is not asked for money agreed off.
    expect(inv(b.id)).toMatchObject({ total_amount: 60000, disputed_amount: 6000 });
    expect(db.prepare('SELECT COUNT(*) c FROM invoices WHERE total_amount < 0').get().c, 'a negative credit bill was booked on top').toBe(0);
    const note = db.prepare('SELECT id FROM debit_credit_notes WHERE invoice_id = ?').get(b.id);
    expect((await post(`/api/notes/${note.id}/approve`, approver)).status, 'the resolver approved their own credit').toBe(403);
    expect((await post(`/api/notes/${note.id}/approve`, finance)).status).toBe(200);
    expect((await get(`/api/invoices/${b.id}`, reia)).body.balance_due).toBe(54000);
  });

  it('goes back to review when the credit is not approved', async () => {
    const b = bill(psa);
    const d = (await raise(buyer, b, 10000)).body;
    await resolve(d, { outcome: 'FULL_CREDIT' });
    const note = db.prepare('SELECT id FROM debit_credit_notes WHERE invoice_id = ?').get(b.id);
    expect((await post(`/api/notes/${note.id}/reject`, finance, { reason: 'Not supported by the REA' })).status).toBe(200);
    expect(db.prepare('SELECT status, resolution_note_id FROM disputes WHERE id = ?').get(d.id)).toEqual({ status: 'UNDER_REVIEW', resolution_note_id: null });
    expect(inv(b.id)).toMatchObject({ status: 'DISPUTED', disputed_amount: 10000 });
  });
});

describe('S44 The desk and the party\'s answer', () => {
  it('cannot close a resolution before the party answers or its window passes', async () => {
    const b = bill(psa);
    const d = (await raise(buyer, b, 5000)).body;
    await resolve(d, { outcome: 'REJECTED' });
    expect((await post(`/api/disputes/${d.id}/transition`, tokenFor('REIA_CHECKER'), { status: 'CLOSED' })).status).toBe(400);
    await post(`/api/dispute-extras/${d.id}/respond`, buyer, { response: 'ACCEPT' });
    expect(db.prepare('SELECT status FROM disputes WHERE id = ?').get(d.id).status).toBe('CLOSED');
  });

  it('asks for information in words, and stops its clock while it waits', async () => {
    const b = bill(psa);
    const d = (await raise(buyer, b, 5000)).body;
    expect((await post(`/api/disputes/${d.id}/transition`, tokenFor('REIA_CHECKER'), { status: 'INFO_REQUESTED' })).status).toBe(400);
    expect((await post(`/api/disputes/${d.id}/transition`, tokenFor('REIA_CHECKER'), { status: 'INFO_REQUESTED', note: 'Send the June telemetry log' })).status).toBe(200);
    // The resolve date passes while the buyer has not answered: no escalation.
    db.prepare(`UPDATE disputes SET sla_resolve_due = datetime('now', '-1 day'), info_requested_at = datetime('now', '-3 days') WHERE id = ?`).run(d.id);
    await get('/api/disputes', reia);
    expect(db.prepare('SELECT status FROM disputes WHERE id = ?').get(d.id).status).toBe('INFO_REQUESTED');
    // The reply restarts it with the three days it stood still added on.
    await post(`/api/disputes/${d.id}/comments`, buyer, { body: 'Log attached' });
    const after = db.prepare(`SELECT status, info_requested_at, julianday(sla_resolve_due) - julianday('now') AS days_left FROM disputes WHERE id = ?`).get(d.id);
    expect(after.status).toBe('UNDER_REVIEW');
    expect(after.info_requested_at).toBeNull();
    expect(after.days_left).toBeCloseTo(2, 1);
  });
});

describe('S44 Linked disputes and evidence', () => {
  it('raises all the linked disputes or none', async () => {
    const a = bill(psa);
    const b = bill(psa, { total_amount: 40000, energy_charges: 39000, trading_margin: 1000 });
    const body = { reason_code: 'TARIFF_RATE_ERROR', charge_line: 'trading_margin', issue_description: 'margin', group_title: 'Margin probe' };
    const bad = await post('/api/disputes/batch', buyer, { ...body, items: [{ invoice_id: a.id, disputed_amount: 2000 }, { invoice_id: b.id, disputed_amount: 500 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/none of the disputes was raised/);
    expect(db.prepare('SELECT COUNT(*) c FROM disputes').get().c).toBe(0);
    const ok = await post('/api/disputes/batch', buyer, { ...body, items: [{ invoice_id: a.id, disputed_amount: 1000 }, { invoice_id: b.id, disputed_amount: 500 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.group_ref).toMatch(/^DSG\/\d{4}\/\d{4}$/);
    expect(db.prepare('SELECT COUNT(DISTINCT group_ref) g, COUNT(*) c FROM disputes').get()).toEqual({ g: 1, c: 2 });
  });

  it('files documents only, and nothing on a closed dispute', async () => {
    const b = bill(psa);
    const d = (await raise(buyer, b, 5000)).body;
    const exe = await request(app).post(`/api/disputes/${d.id}/evidence`).set(auth(buyer)).attach('file', Buffer.from('MZ'), 'tool.exe');
    expect(exe.status).toBe(400);
    await post(`/api/dispute-extras/${d.id}/withdraw`, buyer, { note: 'Raised on the wrong bill' });
    const late = await request(app).post(`/api/disputes/${d.id}/evidence`).set(auth(buyer)).attach('file', Buffer.from('a,b\n1,2'), 'log.csv');
    expect(late.status).toBe(400);
    expect((await post(`/api/disputes/${d.id}/comments`, buyer, { body: 'one more thing' })).status).toBe(400);
  });
});

describe('S44 What a forum awards', () => {
  it('becomes a note for the amount awarded', async () => {
    const b = bill(psa);
    const d = (await raise(buyer, b, 5000)).body;
    await resolve(d, { outcome: 'REJECTED' });
    await post(`/api/dispute-extras/${d.id}/respond`, buyer, { response: 'ESCALATE', forum: 'CERC', note: 'Clause 6.2 misread' });
    expect((await post(`/api/dispute-extras/${d.id}/conclude`, tokenFor('REIA_APPROVER'), { note: 'CERC order allowed the claim', awarded_amount: 9000 })).status).toBe(400);
    expect((await post(`/api/dispute-extras/${d.id}/conclude`, tokenFor('REIA_APPROVER'), { note: 'CERC order allowed the claim', awarded_amount: 5000 })).status).toBe(200);
    expect(db.prepare('SELECT note_type, amount, status FROM debit_credit_notes WHERE invoice_id = ?').get(b.id)).toEqual({ note_type: 'CREDIT', amount: 5000, status: 'DRAFT' });
  });
});
