import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth, makeContract, makeInvoice } from './helpers/reia.js';

// REIA's month-end handover to corporate Finance: sales to buyers, developers'
// bills SJVN accepted, and credit notes — each gathered, checked, booked, and
// reversed rather than edited when a booking is wrong.

const MONTH = '2031-05';
let reia, viewer, seller, contract;

function clear() {
  db.prepare('DELETE FROM reia_fi_posting_lines').run();
  db.prepare('DELETE FROM reia_fi_postings').run();
  db.prepare(`DELETE FROM debit_credit_notes WHERE period_month = ?`).run(MONTH);
  db.prepare(`DELETE FROM invoices WHERE billing_period = ?`).run(MONTH);
}

beforeEach(() => {
  clear();
  contract = makeContract();
  reia = tokenFor('REIA_USER');
  viewer = tokenFor('FINANCE_USER');
  seller = tokenFor('SELLER');
});
afterAll(clear);

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body || {});
const get = (url, token) => request(app).get(url).set(auth(token));

const sale = (o = {}) => makeInvoice({
  contract_id: contract.id, billing_period: MONTH, direction: 'SJVN_TO_BUYER', status: 'SENT',
  energy_charges: 3000000, trading_margin: 70000, nrldc_fees: 5000, transmission_charges: 20000,
  taxes: 0, total_amount: 3095000, ...o,
});

describe('what a month would post', () => {
  it('takes only sale bills that have gone to the buyer, and splits the margin and pass-through out', async () => {
    const sent = sale();
    sale({ status: 'DRAFT' });
    sale({ status: 'CANCELLED' });
    makeInvoice({ contract_id: contract.id, billing_period: MONTH, direction: 'SELLER_TO_SJVN', status: 'APPROVED' });

    const r = await get(`/api/reia-fi/bookable?period_month=${MONTH}&category=SALE`, viewer);
    expect(r.status).toBe(200);
    expect(r.body.documents.map((d) => d.doc_no)).toEqual([sent.invoice_no]);
    expect(r.body.totals).toMatchObject({
      docs_count: 1, energy_amount: 3000000, margin_amount: 70000,
      pass_through_amount: 25000, total_amount: 3095000,
    });
  });

  it('takes a developer bill once SJVN has accepted it, not while it is still submitted', async () => {
    const accepted = makeInvoice({ contract_id: contract.id, billing_period: MONTH, direction: 'SELLER_TO_SJVN', status: 'APPROVED' });
    makeInvoice({ contract_id: contract.id, billing_period: MONTH, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED' });
    const r = await get(`/api/reia-fi/bookable?period_month=${MONTH}&category=PURCHASE`, viewer);
    expect(r.body.documents.map((d) => d.doc_no)).toEqual([accepted.invoice_no]);
  });

  it('books an issued credit note as a negative, and leaves a draft one out', async () => {
    const inv = sale();
    const note = (status) => {
      const id = newId('DCN');
      db.prepare(`
        INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month,
          amount, taxable_amount, tax_amount, status, model)
        VALUES (?, ?, 'CREDIT', ?, ?, ?, 11800, 10000, 1800, ?, 'V2')
      `).run(id, `CN-${id}`, inv.id, contract.id, MONTH, status);
      return `CN-${id}`;
    };
    const issued = note('ISSUED');
    note('DRAFT');
    const r = await get(`/api/reia-fi/bookable?period_month=${MONTH}&category=CREDIT_NOTE`, viewer);
    expect(r.body.documents.map((d) => d.doc_no)).toEqual([issued]);
    expect(r.body.totals).toMatchObject({ energy_amount: -10000, tax_amount: -1800, total_amount: -11800 });
  });
});

describe('prepare, post, reverse', () => {
  it('books a month once, and frees it again when reversed', async () => {
    sale();
    const p = await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.posting_no).toMatch(/^FI\/REIA\/SALE\/203105\//);
    expect(p.body.lines).toHaveLength(1);

    // The same month cannot be prepared twice, and its bill is no longer waiting.
    const again = await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' });
    expect(again.status).toBe(409);
    const waiting = await get(`/api/reia-fi/bookable?period_month=${MONTH}&category=SALE`, viewer);
    expect(waiting.body.documents).toHaveLength(0);

    const booked = await post(`/api/reia-fi/${p.body.id}/post`, reia, { fi_document_no: 'VCH-1' });
    expect(booked.body).toMatchObject({ status: 'POSTED', fi_document_no: 'VCH-1' });
    const twice = await post(`/api/reia-fi/${p.body.id}/post`, reia, { fi_document_no: 'VCH-2' });
    expect(twice.status).toBe(409);

    const noReason = await post(`/api/reia-fi/${p.body.id}/reverse`, reia, {});
    expect(noReason.status).toBe(400);
    const rev = await post(`/api/reia-fi/${p.body.id}/reverse`, reia, { reason: 'wrong GL' });
    expect(rev.status).toBe(200);
    expect(rev.body.reversal_posting_no).toBe(`${p.body.posting_no}/REV`);

    const list = await get(`/api/reia-fi?period_month=${MONTH}`, viewer);
    const totals = list.body.postings.map((x) => x.total_amount).sort((a, b) => a - b);
    expect(totals).toEqual([-3095000, 3095000]);

    const free = await get(`/api/reia-fi/bookable?period_month=${MONTH}&category=SALE`, viewer);
    expect(free.body.documents).toHaveLength(1);
  });

  it('keeps a posting at what it booked, even if the bill changes afterwards', async () => {
    const inv = sale();
    const p = await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' });
    db.prepare('UPDATE invoices SET total_amount = 1 WHERE id = ?').run(inv.id);
    const r = await get(`/api/reia-fi/${p.body.id}`, viewer);
    expect(r.body.lines[0].total_amount).toBe(3095000);
  });

  it('will not prepare an empty month', async () => {
    const r = await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'PURCHASE' });
    expect(r.status).toBe(400);
  });
});

describe('who may do what', () => {
  it('lets Finance read but not book, and keeps counterparties out', async () => {
    sale();
    expect((await post('/api/reia-fi/prepare', viewer, { period_month: MONTH })).status).toBe(403);
    expect((await get(`/api/reia-fi/bookable?period_month=${MONTH}`, seller)).status).toBe(403);
  });
});
