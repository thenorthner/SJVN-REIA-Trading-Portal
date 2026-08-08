import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeEntity, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';

let reia, contract;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); contract = makeContract({ status: 'ACTIVE' }); });

const mkLc = (over = {}) => request(app).post('/api/payment-security').set(auth(reia)).send({
  contract_id: contract.id, mechanism_type: 'LC', limit_amount: 1000000,
  issuing_bank: 'SBI', validity_start: '2026-04-01', validity_end: '2027-03-31', ...over,
});

describe('S8 Payment security', () => {
  it('records an LC with bank, validity and amount', async () => {
    const r = await mkLc();
    expect(r.status).toBeLessThan(400);
    const row = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(r.body.id);
    expect(row.limit_amount).toBe(1000000);
    expect(row.issuing_bank).toBe('SBI');
  });

  it('reduces the available limit as it is drawn against', async () => {
    const r = await mkLc();
    await request(app).post(`/api/payment-security/${r.body.id}/utilize`).set(auth(reia)).send({ amount: 250000, reason: 'default' });
    const row = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(r.body.id);
    const available = row.available_amount ?? (row.limit_amount - (row.utilized_amount || 0));
    expect(available).toBe(750000);
  });

  it('raises expiry alerts on a threshold cascade', async () => {
    await mkLc({ validity_end: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
    const r = await request(app).post('/api/payment-security/alerts/run').set(auth(reia)).send({});
    expect(r.status).toBeLessThan(400);
    expect(db.prepare('SELECT COUNT(*) c FROM security_alerts').get().c, 'no expiry alert raised for an LC 10 days out').toBeGreaterThan(0);
  });

  it('draws the buyer LC before touching a pooled fund', async () => {
    const lc = await mkLc({ limit_amount: 100000 });
    const pool = await request(app).post('/api/payment-security').set(auth(reia)).send({
      contract_id: contract.id, mechanism_type: 'CORPUS_FUND', limit_amount: 5000000,
      issuing_bank: 'Pool', validity_start: '2026-04-01', validity_end: '2027-03-31',
    });

    const r = await request(app).post('/api/payment-security/invocations').set(auth(reia))
      .send({ contract_id: contract.id, amount: 300000, side: 'BUYER' });
    expect(r.status).toBe(201);

    // The buyer's own LC is exhausted first; only the excess reaches the pool.
    const lcRow = db.prepare('SELECT utilized_amount FROM payment_security WHERE id = ?').get(lc.body.id);
    const poolRow = db.prepare('SELECT utilized_amount FROM payment_security WHERE id = ?').get(pool.body.id);
    expect(lcRow.utilized_amount, 'the dedicated LC was not exhausted first').toBe(100000);
    expect(poolRow.utilized_amount, 'the pooled fund did not absorb only the excess').toBe(200000);
  });

  it('does not reach for a seller guarantee to cover a buyer default', async () => {
    await request(app).post('/api/payment-security').set(auth(reia)).send({
      contract_id: contract.id, mechanism_type: 'BANK_GUARANTEE', limit_amount: 5000000,
      issuing_bank: 'SBI', validity_start: '2026-04-01', validity_end: '2027-03-31',
    });
    const bg = db.prepare(`SELECT id FROM payment_security WHERE mechanism_type = 'BANK_GUARANTEE'`).get();

    const r = await request(app).post('/api/payment-security/invocations').set(auth(reia))
      .send({ contract_id: contract.id, amount: 100000, side: 'BUYER' });
    expect(r.status).toBeLessThan(500);
    // A guarantee answers for the seller's performance, not the buyer's payment.
    expect(db.prepare('SELECT utilized_amount FROM payment_security WHERE id = ?').get(bg.id).utilized_amount)
      .toBe(0);
  });

  it('reports the shortfall when security does not cover the default', async () => {
    await mkLc({ limit_amount: 50000 });
    const r = await request(app).post('/api/payment-security/invocations').set(auth(reia))
      .send({ contract_id: contract.id, amount: 200000, side: 'BUYER' });
    expect(r.status).toBe(201);
    const letter = JSON.parse(r.body.demand_letter_json || '{}');
    expect(letter.shortfall_uncovered, 'an uncovered default reported no shortfall').toBe(150000);
  });

  it('computes a coverage ratio and flags it below 1', async () => {
    await mkLc({ limit_amount: 100000 });
    const r = await request(app).get(`/api/payment-security/adequacy/${contract.id}`).set(auth(reia));
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    expect(body, 'adequacy response carries no coverage ratio').toMatch(/coverage|ratio/i);
  });

  it('keeps seller-side BG separate from buyer-side LC in invocation logic', () => {
    const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='payment_security'`).get().sql;
    expect(sql).toMatch(/BANK_GUARANTEE|BG/);
    expect(sql).toMatch(/LC/);
    expect(hasTable('security_invocations')).toBe(true);
  });

  it('refuses release while dues or disputes are open', async () => {
    const lc = await mkLc();
    db.prepare(`INSERT INTO security_releases (id, payment_security_id, contract_id, requested_by, status)
                VALUES ('REL-1', ?, ?, 'u', 'PENDING')`).run(lc.body.id, contract.id);
    // An unsettled invoice on the same contract is enough to block release.
    db.prepare(`INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period,
                energy_mwh, tariff_per_unit, energy_charges, total_amount, status)
                VALUES ('INV-OPEN', 'INV-OPEN', ?, 'FINAL', 'SJVN_TO_BUYER', '2026-04', 100, 3, 300000, 300000, 'SENT')`)
      .run(contract.id);
    db.prepare(`UPDATE security_releases SET checklist_no_dues = 1, checklist_no_disputes = 1 WHERE id = 'REL-1'`).run();
    const r = await request(app).post('/api/payment-security/releases/REL-1/act').set(auth(reia)).send({ decision: 'APPROVED' });
    const released = db.prepare('SELECT status FROM security_releases WHERE id = ?').get('REL-1').status;
    expect(r.status, 'security released while an invoice was still unsettled').toBe(400);
    expect(released).toBe('PENDING');
  });
});

describe('S8 Counterparty read scoping', () => {
  // The list endpoints always scoped by the caller's own entity, but the detail
  // routes did not: an id in the URL was enough for any counterparty login to
  // read another party's invoice, contract or entity record. These pin the rule
  // on both sides — an outsider is refused, the actual party is not.
  let ourContract, ourInvoice, buyerToken, outsiderToken, outsider;

  beforeEach(() => {
    ourContract = makeContract({ status: 'ACTIVE' });
    // A bill the counterparty has actually been issued — a draft is not theirs
    // to read, which the presentation tests below cover separately.
    ourInvoice = makeInvoice({ contract_id: ourContract.id, status: 'SENT' });
    buyerToken = tokenFor('BUYER', { linked_entity_id: ourContract.buyer_id });
    outsider = makeEntity('BUYER');
    outsiderToken = tokenFor('BUYER', { linked_entity_id: outsider.id });
  });

  it('hides an invoice from a buyer who is not party to it', async () => {
    const r = await request(app).get(`/api/invoices/${ourInvoice.id}`).set(auth(outsiderToken));
    expect(r.status, "an unrelated buyer read another party's invoice").toBe(404);
    expect(JSON.stringify(r.body)).not.toMatch(/total_amount/);
  });

  it('hides a contract from a buyer who is not party to it', async () => {
    const r = await request(app).get(`/api/contracts/${ourContract.id}`).set(auth(outsiderToken));
    expect(r.status, "an unrelated buyer read another party's contract and tariff").toBe(404);
  });

  it("hides another party's entity record, PAN and bank details", async () => {
    const r = await request(app).get(`/api/entities/${ourContract.seller_id}`).set(auth(outsiderToken));
    expect(r.status, "an unrelated buyer read another party's entity record").toBe(404);
  });

  it('returns only its own row from the entity register', async () => {
    const r = await request(app).get('/api/entities').set(auth(outsiderToken));
    expect(r.status).toBe(200);
    expect(r.body.map((e) => e.id), 'entity register leaked other parties').toEqual([outsider.id]);
  });

  it('still lets the actual party read its own invoice, contract and entity', async () => {
    const inv = await request(app).get(`/api/invoices/${ourInvoice.id}`).set(auth(buyerToken));
    const con = await request(app).get(`/api/contracts/${ourContract.id}`).set(auth(buyerToken));
    const ent = await request(app).get(`/api/entities/${ourContract.buyer_id}`).set(auth(buyerToken));
    expect(inv.status, 'scoping locked the real counterparty out of its own invoice').toBe(200);
    expect(con.status).toBe(200);
    expect(ent.status).toBe(200);
  });

  it('leaves internal SJVN roles unrestricted', async () => {
    const r = await request(app).get(`/api/invoices/${ourInvoice.id}`).set(auth(reia));
    expect(r.status).toBe(200);
  });
});

describe('S8 A bill is not the counterparty’s until it is issued', () => {
  // The send route has always refused to distribute a bill short of APPROVED,
  // but the counterparty could read it directly and raise a dispute on it —
  // against a draft SJVN had not finished, and which had never been sent.
  let contractRow, draft, sent, buyerToken;

  beforeEach(() => {
    contractRow = makeContract({ status: 'ACTIVE' });
    draft = makeInvoice({ contract_id: contractRow.id, status: 'DRAFT' });
    sent = makeInvoice({ contract_id: contractRow.id, status: 'SENT' });
    buyerToken = tokenFor('BUYER', { linked_entity_id: contractRow.buyer_id });
  });

  it('hides a draft bill from the counterparty it is addressed to', async () => {
    const r = await request(app).get(`/api/invoices/${draft.id}`).set(auth(buyerToken));
    expect(r.status, 'a buyer read a bill SJVN had not finished approving').toBe(404);
  });

  it('keeps drafts out of the counterparty invoice list', async () => {
    const r = await request(app).get('/api/invoices').set(auth(buyerToken));
    expect(r.status).toBe(200);
    expect(r.body.map((i) => i.id)).not.toContain(draft.id);
    expect(r.body.map((i) => i.id), 'an issued bill went missing from the list').toContain(sent.id);
  });

  it('refuses a dispute raised against an unissued bill', async () => {
    const r = await request(app).post('/api/disputes').set(auth(buyerToken)).send({
      invoice_id: draft.id, reason_code: 'ENERGY_DATA_MISMATCH',
      charge_line: 'energy_charges', disputed_amount: 1000,
    });
    expect(r.status, 'a buyer disputed a bill that was never issued').toBe(404);
    expect(db.prepare('SELECT COUNT(*) c FROM disputes WHERE invoice_id = ?').get(draft.id).c).toBe(0);
  });

  it('still lets the counterparty dispute a bill it was issued', async () => {
    const r = await request(app).post('/api/disputes').set(auth(buyerToken)).send({
      invoice_id: sent.id, reason_code: 'ENERGY_DATA_MISMATCH',
      charge_line: 'energy_charges', disputed_amount: 1000,
    });
    expect(r.status, 'the presentation gate blocked a legitimate dispute').toBe(201);
  });

  it('refuses a dispute on a cancelled bill', async () => {
    const cancelled = makeInvoice({ contract_id: contractRow.id, status: 'CANCELLED' });
    const r = await request(app).post('/api/disputes').set(auth(buyerToken)).send({
      invoice_id: cancelled.id, reason_code: 'ENERGY_DATA_MISMATCH',
      charge_line: 'energy_charges', disputed_amount: 1000,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cancelled/i);
  });

  it('runs the dispute window from issue, not from when the row was created', async () => {
    // A bill created three weeks ago but only issued today. Measured from
    // creation the window is long gone before the buyer has seen the bill.
    const old = makeInvoice({ contract_id: contractRow.id, status: 'SENT' });
    db.prepare(`UPDATE invoices SET created_at = datetime('now','-21 days'), issued_at = datetime('now') WHERE id = ?`).run(old.id);

    const r = await request(app).post('/api/disputes').set(auth(buyerToken)).send({
      invoice_id: old.id, reason_code: 'ENERGY_DATA_MISMATCH',
      charge_line: 'energy_charges', disputed_amount: 1000,
    });
    expect(r.status, 'the window was spent while the bill sat in draft').toBe(201);
  });

  it('still closes the window 15 days after the bill was issued', async () => {
    const stale = makeInvoice({ contract_id: contractRow.id, status: 'SENT' });
    db.prepare(`UPDATE invoices SET created_at = datetime('now','-40 days'), issued_at = datetime('now','-30 days') WHERE id = ?`).run(stale.id);

    const r = await request(app).post('/api/disputes').set(auth(buyerToken)).send({
      invoice_id: stale.id, reason_code: 'ENERGY_DATA_MISMATCH',
      charge_line: 'energy_charges', disputed_amount: 1000,
    });
    expect(r.status, 'a bill issued 30 days ago was still disputable').toBe(400);
    expect(r.body.error).toMatch(/conclusive/i);
  });
});
