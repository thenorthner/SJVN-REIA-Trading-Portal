import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { addDaysIso } from '../../src/disputesConstants.js';

// Rules of the dispute desk that reading it for its first end-to-end test turned
// up: where a bill goes back to when its dispute closes, whose dispute a bill's
// can be, and who may move one on.

let reia, finance, management, sellerCo, buyerCo, contract, seller, buyer;

const get = (path, who) => request(app).get(path).set(auth(who));
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);
const statusOf = (inv) => db.prepare('SELECT status, disputed_amount, status_before_dispute FROM invoices WHERE id = ?').get(inv.id);
const pay = (inv, amount) => db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, deduction) VALUES (?, ?, ?, date('now'), 0)`).run(newId('PAY'), inv.id, amount);
const raise = (inv, who = reia, over = {}) => post('/api/disputes', who, {
  invoice_id: inv.id, reason_code: 'ENERGY_DATA_MISMATCH', charge_line: 'energy_charges', disputed_amount: 50000, issue_description: 'metering gap', ...over,
});
const resolve = (dispute, body) => post(`/api/disputes/${dispute.id}/resolve`, reia, { resolution_notes: 'checked against the REA', ...body });

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');
  management = tokenFor('MANAGEMENT');
  sellerCo = makeEntity('SELLER');
  buyerCo = makeEntity('BUYER');
  contract = makeContract({ seller_id: sellerCo.id, buyer_id: buyerCo.id });
  seller = tokenFor('SELLER', { linked_entity_id: sellerCo.id });
  buyer = tokenFor('BUYER', { linked_entity_id: buyerCo.id });
});

describe('Where a bill stands once its dispute is over', () => {
  // It went to SENT, always: a part-paid bill came back as though nothing had
  // been paid on it, a paid one as unpaid, one never emailed as sent.
  const bill = (status, over = {}) => makeInvoice({ contract_id: contract.id, status, total_amount: 400000, energy_charges: 400000, ...over });

  it('goes back to part-paid when it was part-paid', async () => {
    const inv = bill('PARTIALLY_PAID');
    pay(inv, 100000);
    const d = await raise(inv);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(statusOf(inv)).toMatchObject({ status: 'DISPUTED', disputed_amount: 50000, status_before_dispute: 'PARTIALLY_PAID' });

    expect((await resolve(d.body, { outcome: 'REJECTED' })).status).toBe(200);
    expect(statusOf(inv)).toMatchObject({ status: 'PARTIALLY_PAID', disputed_amount: 0, status_before_dispute: null });
  });

  it('goes back to approved when it had never been sent', async () => {
    const inv = bill('APPROVED');
    const d = await raise(inv);
    await resolve(d.body, { outcome: 'REJECTED' });
    expect(statusOf(inv).status).toBe('APPROVED');
  });

  it('stays paid when a paid bill is disputed and the claim is rejected', async () => {
    const inv = bill('PAID');
    pay(inv, 400000);
    const d = await raise(inv);
    expect(statusOf(inv).status).toBe('DISPUTED');
    await resolve(d.body, { outcome: 'REJECTED' });
    expect(statusOf(inv).status).toBe('PAID');
  });

  it('is settled by a credit that brings the bill down to what was paid', async () => {
    const inv = bill('PARTIALLY_PAID');
    pay(inv, 350000);
    const d = await raise(inv);
    await resolve(d.body, { outcome: 'FULL_CREDIT' });
    // Still held while the credit note waits; settled once someone else approves it.
    expect(statusOf(inv).status).toBe('DISPUTED');
    const note = db.prepare('SELECT id FROM debit_credit_notes WHERE invoice_id = ?').get(inv.id);
    expect((await post(`/api/notes/${note.id}/approve`, reia)).status, 'the resolver approved their own credit').toBe(403);
    expect((await post(`/api/notes/${note.id}/approve`, finance)).status).toBe(200);
    expect(db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(inv.id).total_amount, 'the bill as issued was rewritten').toBe(400000);
    expect(statusOf(inv).status).toBe('PAID');
  });

  it('waits for the last open dispute before it moves', async () => {
    const inv = bill('SENT');
    const first = await raise(inv);
    const second = await raise(inv, reia, { disputed_amount: 20000, charge_line: 'energy_charges' });
    expect(statusOf(inv)).toMatchObject({ status: 'DISPUTED', disputed_amount: 70000, status_before_dispute: 'SENT' });
    await resolve(first.body, { outcome: 'REJECTED' });
    expect(statusOf(inv)).toMatchObject({ status: 'DISPUTED', disputed_amount: 20000 });
    await resolve(second.body, { outcome: 'REJECTED' });
    expect(statusOf(inv).status).toBe('SENT');
  });

  it('shows what is left on the bill beside the dispute', async () => {
    const inv = bill('PARTIALLY_PAID', { due_date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10) });
    pay(inv, 100000);
    const d = await raise(inv);
    const got = await get(`/api/disputes/${d.body.id}`, reia);
    // 4,00,000 less 50,000 held in dispute less 1,00,000 paid.
    expect(got.body.invoice.balance_due).toBe(250000);
  });
});

describe('Whose dispute it is', () => {
  it('is the party the bill is with, whatever the form says', async () => {
    // The desk's form defaults to Buyer. Filed on a seller's invoice that made
    // a dispute neither side could answer.
    const sellers = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED' });
    const wrong = await raise(sellers, reia, { raised_by_role: 'BUYER' });
    expect(wrong.status, 'a buyer dispute was filed on a seller invoice').toBe(400);
    expect(wrong.body.error).toMatch(/seller's bill/);

    const right = await raise(sellers, reia);            // no side named
    expect(right.status).toBe(201);
    expect(right.body.raised_by_role).toBe('SELLER');
  });

  it("is not a seller's to raise on SJVN's bill to the buyer, nor the reverse", async () => {
    const buyers = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT' });
    const sellers = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-05' });
    expect((await raise(buyers, seller, { raised_by_role: 'SELLER' })).status).toBe(403);
    expect((await raise(sellers, buyer, { raised_by_role: 'BUYER' })).status).toBe(403);
    // A counterparty cannot file as the other side either.
    const spoof = await raise(sellers, seller, { raised_by_role: 'BUYER' });
    expect(spoof.status).toBe(201);
    expect(spoof.body.raised_by_role).toBe('SELLER');
  });

  it('is not raised by the desk on a bill that has not been approved', async () => {
    const draft = makeInvoice({ contract_id: contract.id, status: 'DRAFT' });
    const r = await raise(draft);
    expect(r.status, 'a dispute was raised on a draft').toBe(400);
    expect(r.body.error).toMatch(/still DRAFT/);
    expect(statusOf(draft).status).toBe('DRAFT');
  });
});

describe('Who may move a dispute on', () => {
  let dispute;
  beforeEach(async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 400000, energy_charges: 400000 });
    dispute = (await raise(inv, buyer)).body;
  });
  const move = (who, status, note) => post(`/api/disputes/${dispute.id}/transition`, who, { status, note });

  it('is the REIA desk, not every SJVN role that can read it', async () => {
    // Finance and Management read disputes; calling this directly they could
    // ask for information or close one.
    expect((await move(finance, 'INFO_REQUESTED', 'x')).status).toBe(403);
    expect((await move(management, 'UNDER_REVIEW')).status).toBe(403);
    expect((await move(reia, 'UNDER_REVIEW')).status).toBe(200);
    expect((await move(reia, 'INFO_REQUESTED', 'please send the JMR')).status).toBe(200);
  });

  it('lets the submitter answer a request for information, and nothing else', async () => {
    await move(reia, 'INFO_REQUESTED', 'please send the JMR');
    expect((await move(seller, 'UNDER_REVIEW')).status, 'the other party moved it').toBe(403);
    expect((await move(buyer, 'ESCALATED')).status).toBe(403);
    expect((await move(buyer, 'UNDER_REVIEW')).status).toBe(200);
    expect((await move(buyer, 'INFO_REQUESTED')).status).toBe(403);
  });

  it('leaves closing a resolved dispute to the desk', async () => {
    await resolve(dispute, { outcome: 'REJECTED' });
    expect((await move(buyer, 'CLOSED')).status).toBe(403);
    expect((await move(finance, 'CLOSED')).status).toBe(403);
    // Not before the party has had its chance to accept or contest.
    const early = await move(reia, 'CLOSED');
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/15 days to accept or contest/);
    db.prepare(`UPDATE disputes SET resolved_at = datetime('now', '-16 days') WHERE id = ?`).run(dispute.id);
    expect((await move(reia, 'CLOSED')).status).toBe(200);
  });
});

describe('What the first end-to-end run found', () => {
  const sent = (over = {}) => makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 400000, energy_charges: 400000, ...over });

  it('tells the company that raised a dispute how it ended, and no other company', async () => {
    const buyerUser = makeUser('BUYER', { linked_entity_id: buyerCo.id });
    const sellerUser = makeUser('SELLER', { linked_entity_id: sellerCo.id });
    const d = await raise(sent(), signToken(buyerUser));
    await resolve(d.body, { outcome: 'FULL_CREDIT' });
    const told = (u) => db.prepare('SELECT message FROM notifications WHERE user_id = ?').all(u.id).map((n) => n.message).join(' ');
    expect(told(buyerUser)).toMatch(/resolved: full credit/);
    expect(told(sellerUser), "a seller was told how a buyer's dispute ended").not.toContain(d.body.dispute_no);
    expect(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE role IN ('SELLER','BUYER')`).get().c).toBe(0);
    // And the desk hears of a new dispute, whichever of its roles is on duty.
    expect(db.prepare(`SELECT COUNT(*) c FROM notifications WHERE role = 'REIA_CHECKER' AND message LIKE 'New dispute%'`).get().c).toBe(1);
  });

  it('raises one dispute for one claim, and none on a credit note', async () => {
    const inv = sent();
    expect((await raise(inv, buyer)).status).toBe(201);
    const again = await raise(inv, buyer);
    expect(again.status, 'a second click raised the dispute twice').toBe(409);
    expect(db.prepare('SELECT COUNT(*) c FROM disputes WHERE invoice_id = ?').get(inv.id).c).toBe(1);

    // The answer to it is a credit note, not a bill — there is no negative bill to dispute.
    const d = db.prepare('SELECT * FROM disputes WHERE invoice_id = ?').get(inv.id);
    await resolve(d, { outcome: 'FULL_CREDIT' });
    expect(db.prepare(`SELECT COUNT(*) c FROM invoices WHERE total_amount < 0`).get().c).toBe(0);
    expect(db.prepare('SELECT resolution_note_id FROM disputes WHERE id = ?').get(d.id).resolution_note_id).toBeTruthy();
  });

  it('counts interest added on resolution once, and suggests none on a bill nobody has paid', async () => {
    const inv = sent();
    const d = await raise(inv);
    expect((await get(`/api/disputes/${d.body.id}`, reia)).body.refund_interest_guidance.amount, 'interest was offered on an unpaid bill').toBe(0);
    await resolve(d.body, { outcome: 'FULL_CREDIT', lps_on_resolution: 7 });
    // The credit and the interest on it are one note, counted once.
    const note = db.prepare('SELECT id, amount FROM debit_credit_notes WHERE invoice_id = ?').get(inv.id);
    expect(note.amount).toBe(50007);
    expect(db.prepare('SELECT total_amount, lps FROM invoices WHERE id = ?').get(inv.id)).toMatchObject({ total_amount: 400000, lps: 0 });
    expect((await get(`/api/invoices/${inv.id}`, reia)).body.balance_due).toBe(350000);
    await post(`/api/notes/${note.id}/approve`, finance);
    expect((await get(`/api/invoices/${inv.id}`, reia)).body.balance_due, 'the rupees added on resolution were counted twice').toBe(349993);
  });

  it('counts fifteen days from the moment a dispute was raised, whatever clock the server keeps', () => {
    expect(addDaysIso('2026-10-07 13:24:57', 15)).toBe('2026-10-22 13:24:57');
  });
});
