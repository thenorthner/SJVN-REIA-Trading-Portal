import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

// A seller's account with SJVN: every bill, payment, deduction and note as a
// line with a running balance; what is still owed and how late; the advice for
// one payment; and the quarterly TDS certificates.

let finance, reia, seller, otherSeller, alpha, beta, contract;
const as = (u) => auth(signToken(u));
const get = (u, p) => request(app).get(`/api/ledger${p}`).set(as(u));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

function bill(no, total, { created = '2026-05-05', due = day(20), status = 'APPROVED', period = '2026-04' } = {}) {
  const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status, invoice_no: no, total_amount: total, billing_period: period, due_date: due });
  db.prepare('UPDATE invoices SET created_at = ? WHERE id = ?').run(`${created} 10:00:00`, inv.id);
  return inv;
}
function pay(inv, amount, on, extra = {}) {
  const id = `PAY-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction, tds_amount, deduction_note, rebate_amount, release_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OWN_FUND')`)
    .run(id, inv.id, amount, on, extra.mode || 'RELEASE:OWN_FUND', extra.reference || 'UTR1', extra.deduction || 0, extra.tds ?? null, extra.note ?? null, extra.rebate ?? null);
  return id;
}

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM tds_certificates').run();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar', pan_no: 'ABCDE1234F' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  contract = makeContract({ seller_id: alpha.id });
  db.prepare(`UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?`).run(alpha.id);
  finance = makeUser('FINANCE_USER', { name: 'Farhan Finance' });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
});

describe('the statement', () => {
  it('runs a balance through bills, payments, tax held back, rebate and a credit note', async () => {
    const a = bill('A/1', 1000000, { created: '2026-05-05' });
    bill('A/DRAFT', 999, { status: 'DRAFT' });
    pay(a, 880000, '2026-05-20', { deduction: 20000, tds: 1000, note: 'Liquidated damages', rebate: 15000, reference: 'UTR-77' });
    db.prepare('UPDATE invoices SET rebate = 15000 WHERE id = ?').run(a.id);
    pay(a, 0, '2026-05-25', { mode: 'CREDIT_NOTE', reference: 'CN/1', deduction: 5000 });
    const b = bill('A/2', 500000, { created: '2026-06-05' });

    const s = (await get(seller, '/statement')).body;
    expect(s.entries.map((e) => [e.type, e.debit, e.credit, e.balance])).toEqual([
      ['INVOICE', 1000000, 0, 1000000],
      ['PAYMENT', 0, 880000, 120000],
      ['TDS', 0, 1000, 119000],
      ['DEDUCTION', 0, 19000, 100000],
      ['REBATE', 0, 15000, 85000],
      ['CREDIT_NOTE', 0, 5000, 80000],
      ['INVOICE', 500000, 0, 580000],
    ]);
    expect(s.entries[3].particulars).toMatch(/Liquidated damages/);
    expect(s).toMatchObject({ opening_balance: 0, closing_balance: 580000 });
    expect(s.totals).toMatchObject({ billed: 1500000, received: 880000, tds: 1000, deductions: 19000, rebate: 15000, credit_notes: 5000 });
    // The closing balance is what the open bills add up to.
    expect(s.outstanding_total).toBe(580000);
    expect(b.id).toBeTruthy();
  });

  it('brings a balance forward for a stretch of dates, and is the seller’s own', async () => {
    const a = bill('A/1', 1000000, { created: '2026-05-05' });
    pay(a, 400000, '2026-05-20');
    bill('A/2', 500000, { created: '2026-06-05' });
    const s = (await get(seller, '/statement?from=2026-06-01&to=2026-06-30')).body;
    expect(s).toMatchObject({ opening_balance: 600000, closing_balance: 1100000 });
    expect(s.entries.map((e) => e.ref)).toEqual(['A/2']);

    expect((await get(otherSeller, '/statement')).body.entries).toEqual([]);
    expect((await get(reia, '/statement')).status).toBe(400);
    expect((await get(reia, `/statement?entity_id=${alpha.id}`)).body.closing_balance).toBe(1100000);
    expect((await get(seller, `/statement?entity_id=${beta.id}`)).body.seller.name).toBe('Alpha Solar');
    // A buyer has a ledger of its own now; one linked to no company has nothing to read.
    expect((await get(makeUser('BUYER', { name: 'B' }), '/statement')).status).toBe(404);
    expect((await get(seller, '/statement?from=nope')).status).toBe(400);
  });

  it('comes as a workbook and as a PDF', async () => {
    const a = bill('A/1', 1000000);
    pay(a, 400000, '2026-05-20');
    const x = await get(seller, '/statement.xlsx').buffer().parse(binary);
    expect(x.status).toBe(200);
    const wb = XLSX.read(x.body);
    expect(wb.SheetNames).toEqual(['Statement', 'Outstanding & ageing']);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Statement, { header: 1 });
    expect(rows.at(-1)).toEqual(expect.arrayContaining(['Closing balance — receivable from SJVN', 600000]));
    const p = await get(seller, '/statement.pdf').buffer().parse(binary);
    expect(p.status).toBe(200);
    expect(p.body.slice(0, 4).toString()).toBe('%PDF');
  });
});

describe('ageing', () => {
  it('sorts what is still owed by how long it has been overdue', async () => {
    bill('NOT-DUE', 100, { due: day(10) });
    const late = bill('LATE-20', 300, { due: day(-20) });
    pay(late, 100, day(-5));
    bill('LATE-45', 400, { due: day(-45) });
    bill('LATE-200', 500, { due: day(-200) });
    const paid = bill('PAID', 700, { due: day(-70), status: 'PAID' });
    pay(paid, 700, day(-60));

    const s = (await get(seller, '/statement')).body;
    expect(Object.fromEntries(s.ageing.map((a) => [a.key, [a.invoices, a.amount]]))).toEqual({
      NOT_DUE: [1, 100], D1_30: [1, 200], D31_60: [1, 400], D61_90: [0, 0], D90: [1, 500],
    });
    expect(s).toMatchObject({ outstanding_total: 1200, overdue_total: 1100 });
    expect(s.outstanding[0]).toMatchObject({ invoice_no: 'LATE-200', days_overdue: 200 });
    expect(s.due_soon.map((o) => o.invoice_no)).toEqual(['NOT-DUE']);
  });
});

describe('a payment', () => {
  it('records tax and other deductions when it is released, and gives an advice', async () => {
    const inv = bill('A/1', 1000000);
    const release = (body) => request(app).post(`/api/invoices/${inv.id}/release-to-generator`).set(as(finance)).send({ source: 'OWN_FUND', payment_date: '2026-05-20', reference: 'UTR-9', ...body });
    expect((await release({ amount: 100, other_deduction: 50 })).status).toBe(400);   // a deduction needs a reason
    const r = await release({ amount: 900000, tds_amount: 1000, other_deduction: 4000, deduction_note: 'Meter testing charges' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const pid = db.prepare('SELECT id FROM payments WHERE invoice_id = ?').get(inv.id).id;
    const advice = (await get(seller, `/payments/${pid}`)).body;
    expect(advice).toMatchObject({
      invoice_no: 'A/1', gross_settled: 905000, tds_amount: 1000, tds_section: '194Q', other_deduction: 4000,
      deduction_note: 'Meter testing charges', net_paid: 900000, reference: 'UTR-9', breakup_known: true,
    });
    const pdf = await get(seller, `/payments/${pid}/advice.pdf`).buffer().parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await get(otherSeller, `/payments/${pid}`)).status).toBe(404);
  });
});

describe('TDS certificates', () => {
  const version = (id, entityId) => {
    db.prepare(`INSERT INTO documents (id, entity_id, document_type, category, title) VALUES (?, ?, 'FORM_16A', 'RECORD', 'Form 16A')`).run(`D-${id}`, entityId);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type) VALUES (?, ?, 1, '/nowhere', '16a.pdf', 10, 'application/pdf')`).run(id, `D-${id}`);
  };

  it('are filed by Finance for a quarter and read by the seller; a quarter with tax and no certificate shows as awaited', async () => {
    const inv = bill('A/1', 1000000);
    pay(inv, 900000, '2026-08-10', { deduction: 1000, tds: 1000 });
    expect((await get(seller, '/tds-certificates')).body.certificates).toEqual([
      expect.objectContaining({ financial_year: '2026-27', quarter: 'Q2', tds_deducted: 1000, awaited: true }),
    ]);

    version('V16', alpha.id);
    version('VB', beta.id);
    const file = (u, body) => request(app).post('/api/ledger/tds-certificates').set(as(u)).send({ entity_id: alpha.id, financial_year: '2026-27', quarter: 'Q2', tds_amount: 1000, version_id: 'V16', ...body });
    expect((await file(seller)).status).toBe(403);
    expect((await file(finance, { financial_year: '2026-28' })).status).toBe(400);
    expect((await file(finance, { version_id: 'VB' })).status).toBe(400);
    const ok = await file(finance, { certificate_no: 'ABCDEFG' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const mine = (await get(seller, '/tds-certificates')).body;
    expect(mine.can_file).toBe(false);
    expect(mine.certificates).toEqual([expect.objectContaining({ quarter: 'Q2', quarter_label: 'Jul–Sep', certificate_no: 'ABCDEFG', tds_amount: 1000, tds_deducted: 1000, file_name: '16a.pdf' })]);
    expect((await get(otherSeller, '/tds-certificates')).body.certificates).toEqual([]);
    // Filing again for the same quarter replaces it.
    await file(finance, { tds_amount: 1200 });
    expect((await get(seller, '/tds-certificates')).body.certificates).toHaveLength(1);
  });
});
