import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Found by the audit of the counterparty ledgers and the Finance handover
// (17-Oct-2026): Sunrise's ledger and October's PURCHASE batch both counted
// SJVN's computed bill and the developer's own invoice for the same month
// (₹2.36 crore twice), and the ledger counted a bill still under approval; a
// batch was posted with no voucher, by the person who prepared it, and reversed
// with a reason of three spaces; and a bill raised after a month was booked
// could never be booked at all.

const MONTH = '2031-05';
let reia, reiaAdmin, sellerCo, seller, ppa, psa;
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const developerBill = (over = {}) => makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: MONTH, total_amount: 2000000, invoice_type: 'FINAL', invoice_breakdown_json: '', ...over });
const computedBill = (over = {}) => makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SENT', billing_period: MONTH, total_amount: 2000000, invoice_type: 'PROVISIONAL', invoice_breakdown_json: '[{"code":"E1"}]', ...over });
const saleBill = (over = {}) => makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: MONTH, total_amount: 3095000, ...over });

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM reia_fi_posting_lines').run();
  db.prepare('DELETE FROM reia_fi_postings').run();
  reia = tokenFor('REIA_USER');
  reiaAdmin = tokenFor('REIA_ADMIN');
  sellerCo = makeEntity('SELLER');
  seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
  ppa = makeContract({ contract_type: 'PPA', seller_id: sellerCo.id });
  psa = makeContract({ contract_type: 'PSA' });
});

describe('S56 A developer\'s month is owed once', () => {
  it('counts the developer\'s own accepted invoice, not that and SJVN\'s computed bill, nor a bill still in approval', async () => {
    computedBill();
    developerBill();
    developerBill({ billing_period: '2031-04', status: 'UNDER_APPROVAL' });
    const st = (await get(`/api/ledger/statement?entity_id=${sellerCo.id}`)).body;
    expect(st.entries.filter((e) => e.type === 'INVOICE')).toHaveLength(1);
    expect(st.closing_balance).toBe(2000000);
  });

  it('books it once as a purchase', async () => {
    computedBill();
    const own = developerBill();
    const docs = (await get(`/api/reia-fi/bookable?period_month=${MONTH}&category=PURCHASE`)).body.documents;
    expect(docs.map((d) => d.source_id)).toEqual([own.id]);
  });

  it('keeps a company to its own ledger whatever it asks for', async () => {
    developerBill();
    const other = makeEntity('BUYER');
    expect((await get(`/api/ledger/statement?entity_id=${other.id}`, seller)).body.seller.id).toBe(sellerCo.id);
  });
});

describe('S56 Booking the month', () => {
  it('books against Finance\'s voucher, by someone other than whoever prepared it', async () => {
    saleBill();
    const p = (await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' })).body;
    expect((await post(`/api/reia-fi/${p.id}/post`, reiaAdmin, {})).body.error).toMatch(/voucher number/);
    expect((await post(`/api/reia-fi/${p.id}/post`, reia, { fi_document_no: 'SAP-JV-1' })).status).toBe(403);
    expect((await post(`/api/reia-fi/${p.id}/post`, reiaAdmin, { fi_document_no: 'SAP-JV-1' })).body).toMatchObject({ status: 'POSTED', fi_document_no: 'SAP-JV-1' });
  });

  it('will not book a document that changed after the batch was prepared', async () => {
    const inv = saleBill();
    const p = (await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' })).body;
    db.prepare(`UPDATE invoices SET status = 'CANCELLED' WHERE id = ?`).run(inv.id);
    const r = await post(`/api/reia-fi/${p.id}/post`, reiaAdmin, { fi_document_no: 'SAP-JV-1' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(new RegExp(`Changed since this posting was prepared: ${inv.invoice_no.replace(/[/]/g, '\\/')}`));
  });

  it('books a bill raised after the month was posted in a further batch, never one twice', async () => {
    saleBill();
    const first = (await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' })).body;
    await post(`/api/reia-fi/${first.id}/post`, reiaAdmin, { fi_document_no: 'SAP-JV-1' });
    const late = saleBill({ invoice_type: 'SUPPLEMENTARY', total_amount: 50000 });
    const second = await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.lines.map((l) => l.source_id)).toEqual([late.id]);
    // While that one waits, no third.
    expect((await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' })).status).toBe(409);
  });

  it('withdraws an unbooked batch without a counter-entry, and wants a real reason', async () => {
    saleBill();
    const p = (await post('/api/reia-fi/prepare', reia, { period_month: MONTH, category: 'SALE' })).body;
    expect((await post(`/api/reia-fi/${p.id}/reverse`, reia, { reason: '   ' })).status).toBe(400);
    const r = await post(`/api/reia-fi/${p.id}/reverse`, reia, { reason: 'prepared before the PSPCL bill was sent' });
    expect(r.body).toMatchObject({ withdrawn: true });
    expect(db.prepare('SELECT COUNT(*) n FROM reia_fi_postings WHERE period_month = ?').get(MONTH).n).toBe(1);
  });
});
