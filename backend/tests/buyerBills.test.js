import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia, auditFor } from './helpers/reia.js';

// A buyer says it has paid; the bill moves only when Finance finds the money.

let gen, discom, other, psa, admin, maker, checker, outsider, finance, reia, mgmt;
const as = (u) => auth(signToken(u));
const get = (u, p = '') => request(app).get(`/api/buyer-bills${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/buyer-bills${p}`).set(as(u)).send(body);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const bill = (extra = {}) => makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', invoice_no: `S/${Math.random().toString(36).slice(2, 7)}`, billing_period: '2026-08', total_amount: 1000000, energy_charges: 1000000, due_date: day(15), ...extra });
const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const payments = (id) => db.prepare('SELECT * FROM payments WHERE invoice_id = ?').all(id);
const tell = (u, inv, extra = {}) => post(u, '/intimations', { invoice_id: inv.id, amount: 980000, tds_amount: 20000, tds_section: '194Q', payment_date: day(-1), mode: 'RTGS', reference: 'SBINR52026100400123', ...extra });

beforeEach(() => {
  resetReia();
  gen = makeEntity('SELLER', { name: 'Generator' });
  discom = makeEntity('BUYER', { name: 'North Discom' });
  other = makeEntity('BUYER', { name: 'South Discom' });
  psa = makeContract({ contract_type: 'PSA', seller_id: gen.id, buyer_id: discom.id });
  admin = makeUser('BUYER', { name: 'Dev Admin', linked_entity_id: discom.id });
  maker = makeUser('BUYER_L1', { name: 'Mala Maker', linked_entity_id: discom.id });
  checker = makeUser('BUYER_L2', { name: 'Chetan Checker', linked_entity_id: discom.id });
  outsider = makeUser('BUYER', { name: 'Omar Other', linked_entity_id: other.id });
  finance = makeUser('FINANCE_USER', { name: 'Farid Finance' });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  mgmt = makeUser('MANAGEMENT', { name: 'Meera Mgmt' });
});

describe('an intimation', () => {
  it('leaves the bill untouched until Finance confirms it, then records the payment with its TDS', async () => {
    const inv = bill();
    expect((await tell(admin, inv, { amount: 0 })).body.error).toMatch(/amount that reached/);
    expect((await tell(admin, inv, { tds_section: '' })).body.error).toMatch(/which section/);
    expect((await tell(admin, inv, { other_deduction: 500 })).body.error).toMatch(/what the other deduction is for/);
    expect((await tell(admin, inv, { payment_date: day(2) })).body.error).toMatch(/future/);
    expect((await tell(admin, inv, { reference: 'x' })).body.error).toMatch(/UTR/);
    expect((await tell(outsider, inv)).status).toBe(404);
    expect((await tell(finance, inv)).status).toBe(403);

    const r = await tell(admin, inv);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'SUBMITTED', gross_settled: 1000000, with: 'SJVN Finance', exceeds_balance: 0 });
    expect(payments(inv.id)).toEqual([]);
    expect(row(inv.id).status).toBe('SENT');
    expect((await tell(admin, inv)).status).toBe(409); // the same UTR on the same bill

    const mine = (await get(admin)).body;
    expect(mine.bills[0]).toMatchObject({ left: 1000000, pending_intimation: { amount: 1000000, with_finance: 1 } });
    expect(mine.totals).toMatchObject({ to_pay: 1000000, with_finance: 1000000, with_finance_count: 1 });

    // Only Finance decides.
    expect((await post(admin, `/intimations/${r.body.id}/confirm`, {})).status).toBe(403);
    expect((await post(mgmt, `/intimations/${r.body.id}/confirm`, {})).status).toBe(403);
    const desk = (await get(finance, '/intimations?status=SUBMITTED')).body;
    expect(desk.intimations[0]).toMatchObject({ buyer_name: 'North Discom', left_on_bill: 1000000, prepared_by_name: 'Dev Admin' });
    expect(desk.can_confirm).toBe(true);

    expect((await post(finance, `/intimations/${r.body.id}/confirm`, { payment_date: day(0) })).body.error).toMatch(/why the value date differs/);
    const ok = await post(finance, `/intimations/${r.body.id}/confirm`, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ status: 'CONFIRMED', decided_by_name: 'Farid Finance', confirmed_date: day(-1) });
    expect(payments(inv.id)).toHaveLength(1);
    expect(payments(inv.id)[0]).toMatchObject({ id: ok.body.payment_id, amount: 980000, deduction: 20000, tds_amount: 20000, tds_section: '194Q', reference: 'SBINR52026100400123', payment_date: day(-1) });
    expect(row(inv.id).status).toBe('PAID');
    expect((await post(finance, `/intimations/${r.body.id}/confirm`, {})).body.error).toMatch(/already been confirmed/);
    expect(auditFor(r.body.id).map((a) => a.action)).toEqual(expect.arrayContaining(['PAYMENT_INTIMATED', 'PAYMENT_INTIMATION_CONFIRMED']));
    expect(db.prepare('SELECT message FROM notifications WHERE user_id = ? ORDER BY rowid DESC').get(admin.id).message).toMatch(/confirmed your payment/);
    expect((await get(admin)).body.bills[0]).toMatchObject({ left: 0, status: 'PAID', pending_intimation: null });
  });

  it('goes through the company\'s checker when a maker prepares it', async () => {
    const inv = bill();
    const r = await tell(maker, inv, { amount: 400000, tds_amount: 0, tds_section: null });
    expect(r.body).toMatchObject({ status: 'PENDING_CHECKER', with: 'Your checker' });
    // SJVN does not see it yet, and cannot confirm it.
    expect((await get(finance, '/intimations')).body.intimations).toEqual([]);
    expect((await post(finance, `/intimations/${r.body.id}/confirm`, {})).body.error).toMatch(/checker has not yet/);
    expect((await post(maker, `/intimations/${r.body.id}/approve`, {})).status).toBe(403);
    expect((await post(outsider, `/intimations/${r.body.id}/approve`, {})).status).toBe(404);
    const passed = await post(checker, `/intimations/${r.body.id}/approve`, {});
    expect(passed.body).toMatchObject({ status: 'SUBMITTED', approved_by_name: 'Chetan Checker' });

    const done = await post(reia, `/intimations/${r.body.id}/confirm`, { payment_date: day(0), note: 'Credited a day later per bank statement' });
    expect(done.body).toMatchObject({ status: 'CONFIRMED', confirmed_date: day(0) });
    expect(row(inv.id).status).toBe('PARTIALLY_PAID');
    expect((await get(admin)).body.bills[0].left).toBe(600000);
  });

  it('can be refused by Finance or withdrawn by the buyer, and either way the bill stands', async () => {
    const inv = bill();
    const a = await tell(admin, inv);
    expect((await post(finance, `/intimations/${a.body.id}/reject`, {})).body.error).toMatch(/Say why/);
    const no = await post(finance, `/intimations/${a.body.id}/reject`, { note: 'No such credit in the bank statement' });
    expect(no.body).toMatchObject({ status: 'REJECTED', decision_note: 'No such credit in the bank statement' });
    expect(db.prepare('SELECT message FROM notifications WHERE user_id = ? ORDER BY rowid DESC').get(admin.id).message).toMatch(/could not confirm/);

    // The same UTR can be sent again once the first is closed.
    const b = await tell(maker, inv);
    expect(b.status).toBe(201);
    expect((await post(finance, `/intimations/${b.body.id}/withdraw`, {})).status).toBe(403);
    expect((await post(maker, `/intimations/${b.body.id}/withdraw`, { note: 'Wrong bill' })).body.status).toBe('WITHDRAWN');
    expect(payments(inv.id)).toEqual([]);
    expect(row(inv.id).status).toBe('SENT');
    expect((await get(admin)).body.totals.with_finance_count).toBe(0);
  });

  it('flags one that is for more than the bill has left, and refuses one on a settled bill', async () => {
    const inv = bill();
    const over = await tell(admin, inv, { amount: 1500000 });
    expect(over.body.exceeds_balance).toBe(1);
    const paid = bill({ status: 'PAID' });
    expect((await tell(admin, paid)).body.error).toMatch(/already settled/);
    const draft = bill({ status: 'DRAFT' });
    expect((await tell(admin, draft)).status).toBe(404);
  });
});

describe('the buyer\'s bills', () => {
  it('shows only what SJVN has presented, with what is left and how soon it is due', async () => {
    bill({ invoice_no: 'S/due', due_date: day(5) });
    bill({ invoice_no: 'S/late', due_date: day(-12) });
    bill({ invoice_no: 'S/draft', status: 'DRAFT' });
    const r = (await get(checker)).body;
    expect(r.bills.map((b) => b.invoice_no).sort()).toEqual(['S/due', 'S/late']);
    expect(r.totals).toMatchObject({ open_bills: 2, overdue_bills: 1, due_soon_bills: 1, unacknowledged: 2 });
    expect(r.bills.find((b) => b.invoice_no === 'S/late')).toMatchObject({ overdue: true, days_to_due: -12 });
    expect((await get(outsider)).body.bills).toEqual([]);
    expect((await get(finance)).status).toBe(400);
  });

  it('records the buyer\'s acknowledgement of receipt once', async () => {
    const inv = bill();
    expect((await post(outsider, `/${inv.id}/acknowledge`, {})).status).toBe(404);
    expect((await post(finance, `/${inv.id}/acknowledge`, {})).status).toBe(403);
    const r = await post(maker, `/${inv.id}/acknowledge`, {});
    expect(r.body).toMatchObject({ acknowledged_by: 'Mala Maker' });
    expect((await post(maker, `/${inv.id}/acknowledge`, {})).body.error).toMatch(/already been acknowledged/);
    expect((await get(admin)).body.bills[0].acknowledged_by).toBe('Mala Maker');
  });

  it('exports the list as a sheet', async () => {
    bill({ invoice_no: 'S/1' });
    const csv = await get(admin, '/export.csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toMatch(/"S\/1","C-/);
  });
});

describe('the buyer\'s ledger', () => {
  const ledger = (u, p) => request(app).get(`/api/ledger${p}`).set(as(u));
  it('reads the same account the other way round: billed by SJVN, paid by the buyer, tax held back', async () => {
    const inv = bill({ invoice_no: 'S/L1', due_date: day(-3) });
    bill({ invoice_no: 'S/L2', status: 'DRAFT' });
    const a = await tell(admin, inv, { amount: 588000, tds_amount: 12000 });
    await post(finance, `/intimations/${a.body.id}/confirm`, {});

    const st = (await ledger(admin, '/statement')).body;
    expect(st.party_side).toBe('BUYER');
    expect(st.seller.name).toBe('North Discom');
    expect(st.entries.map((e) => [e.type, e.debit, e.credit])).toEqual(expect.arrayContaining([['INVOICE', 1000000, 0], ['PAYMENT', 0, 588000], ['TDS', 0, 12000]]));
    expect(st.entries.find((e) => e.type === 'PAYMENT').particulars).toMatch(/Payment made/);
    expect(st.entries.some((e) => e.invoice_no === 'S/L2')).toBe(false);
    expect(st.outstanding[0]).toMatchObject({ invoice_no: 'S/L1', days_overdue: 3 });
    expect(st.outstanding_total).toBeGreaterThanOrEqual(400000);
    expect((await ledger(outsider, '/statement')).body.entries).toEqual([]);
    expect((await ledger(finance, `/statement?entity_id=${discom.id}`)).body.party_side).toBe('BUYER');
    expect((await ledger(finance, '/buyers')).body.map((b) => b.name)).toContain('North Discom');

    const pay = payments(inv.id)[0];
    expect((await ledger(admin, `/payments/${pay.id}`)).body).toMatchObject({ party_side: 'BUYER', net_paid: 588000, tds_amount: 12000, gross_settled: 600000 });
    expect((await ledger(outsider, `/payments/${pay.id}`)).status).toBe(404);
    const pdf = await ledger(admin, `/payments/${pay.id}/advice.pdf`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect(pdf.headers['content-disposition']).toMatch(/payment-receipt/);
  });

  it('has the buyer file the Form 16A for the tax it deducted', async () => {
    const inv = bill();
    const a = await tell(admin, inv);
    await post(finance, `/intimations/${a.body.id}/confirm`, {});
    db.prepare(`INSERT INTO documents (id, entity_id, document_type, category, title) VALUES ('D16', ?, 'FORM_16A', 'RECORD', 'Form 16A')`).run(discom.id);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type) VALUES ('V16B', 'D16', 1, '/nowhere', 'form16a.pdf', 10, 'application/pdf')`).run();
    const list = (await ledger(checker, '/tds-certificates')).body;
    expect(list).toMatchObject({ party_side: 'BUYER', can_file: true });
    expect(list.certificates[0]).toMatchObject({ awaited: true, tds_deducted: 20000 });
    expect((await ledger(maker, '/tds-certificates')).body.can_file).toBe(false);
    const q = list.certificates[0];
    const file = (u) => request(app).post('/api/ledger/tds-certificates').set(as(u)).send({ entity_id: discom.id, financial_year: q.financial_year, quarter: q.quarter, tds_amount: 20000, certificate_no: 'ABCDE12', version_id: 'V16B' });
    expect((await file(finance)).status).toBe(403);
    expect((await file(maker)).status).toBe(403);
    const done = await file(checker);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.certificates[0]).toMatchObject({ certificate_no: 'ABCDE12', tds_amount: 20000, file_name: 'form16a.pdf' });
    expect((await ledger(finance, `/tds-certificates?entity_id=${discom.id}`)).body).toMatchObject({ can_file: false, party_side: 'BUYER' });
  });
});
