import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import PDFDocument from 'pdfkit';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { inspectSignature } from '../src/routes/invoiceCompliance.js';
import { invalidateParamCache } from '../src/mastersService.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, auditFor, resetReia } from './helpers/reia.js';

// What goes with a seller's invoice: the e-invoice reference and how it compares
// with the bill, the signed copy, an estimate of the tax deducted at source, and
// the hard copy's journey.

let reia, seller, otherSeller, alpha, beta, contract, inv;
const as = (u) => auth(signToken(u));
const get = (u, p) => request(app).get(`/api/invoice-compliance${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/invoice-compliance${p}`).set(as(u)).send(body);
const IRN = 'a'.repeat(64);
const qr = (data) => `h.${Buffer.from(JSON.stringify({ data: JSON.stringify(data), iss: 'NIC' })).toString('base64url')}.s`;
const setParam = (key, value) => { db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(String(value), key); invalidateParamCache(); };

beforeEach(() => {
  resetReia();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar', pan_no: 'ABCDE1234F', gst_no: '02ABCDE1234F1Z5' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  contract = makeContract({ seller_id: alpha.id });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
  inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', billing_period: '2026-06', total_amount: 3000000, invoice_no: 'AS/2026/06/001' });
});

describe('TDS estimate', () => {
  it('falls only on what is billed beyond the threshold in the financial year', async () => {
    // First bill of the year: ₹30 lakh, under the ₹50 lakh threshold.
    expect((await get(seller, `/${inv.id}`)).body.tds).toMatchObject({ financial_year: 'FY 2026-27', billed_before: 0, liable_amount: 0, tds_amount: 0, net_payable: 3000000 });

    // A second bill of ₹30 lakh takes the year to ₹60 lakh: ₹10 lakh is over, at 0.1%.
    const second = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', billing_period: '2026-07', total_amount: 3000000 });
    expect((await get(seller, `/${second.id}`)).body.tds).toMatchObject({ billed_before: 3000000, liable_amount: 1000000, tds_amount: 1000, net_payable: 2999000, rate_pct: 0.1, section: '194Q' });

    // Last March is another year; a draft and a cancelled bill are not purchases yet.
    makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'PAID', billing_period: '2026-03', total_amount: 9000000 });
    makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'DRAFT', billing_period: '2026-08', total_amount: 9000000 });
    const p = await get(seller, `/tds-preview?contract_id=${contract.id}&billing_period=2026-09&amount=1180000&taxes=180000`);
    expect(p.body).toMatchObject({ billed_before: 6000000, this_bill: 1000000, liable_amount: 1000000, tds_amount: 1000, net_payable: 1179000 });
  });

  it('uses the higher rate where the company has no PAN, and is the contract’s own to ask', async () => {
    const c2 = makeContract({ seller_id: beta.id });
    const p = await get(otherSeller, `/tds-preview?contract_id=${c2.id}&billing_period=2026-06&amount=6000000`);
    expect(p.body).toMatchObject({ has_pan: false, rate_pct: 5, liable_amount: 1000000, tds_amount: 50000 });
    expect((await get(otherSeller, `/tds-preview?contract_id=${contract.id}&billing_period=2026-06&amount=1`)).status).toBe(404);
  });
});

describe('e-invoice', () => {
  it('records the IRN and says how the QR compares with the bill', async () => {
    expect((await post(seller, `/${inv.id}/einvoice`, { irn: 'short' })).status).toBe(400);
    expect((await post(otherSeller, `/${inv.id}/einvoice`, { irn: IRN })).status).toBe(404);
    expect((await post(seller, `/${inv.id}/einvoice`, { irn: IRN, signed_qr: 'not-a-qr' })).status).toBe(400);

    const good = await post(seller, `/${inv.id}/einvoice`, {
      irn: IRN, ack_no: '112010036563310', ack_date: '2026-07-02',
      signed_qr: qr({ SellerGstin: '02ABCDE1234F1Z5', BuyerGstin: '02AAACS1234A1Z1', DocNo: 'AS/2026/06/001', TotInvVal: 3000000, Irn: IRN }),
    });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect(good.body.einvoice).toMatchObject({ irn: IRN, has_qr: true });
    expect(good.body.einvoice.checks.every((c) => c.ok)).toBe(true);
    expect((await get(seller, `/${inv.id}/einvoice/qr`)).body.data_url).toMatch(/^data:image\/png;base64,/);

    const bad = await post(seller, `/${inv.id}/einvoice`, { irn: IRN, signed_qr: qr({ SellerGstin: '09ZZZZZ9999Z1Z9', DocNo: 'OTHER/1', TotInvVal: 1, Irn: IRN }) });
    expect(bad.body.einvoice.checks.filter((c) => c.ok === false)).toHaveLength(3);
    expect(auditFor(inv.id).map((a) => a.action)).toContain('INVOICE_IRN_RECORDED');
  });

  it('will not take one IRN on two invoices, nor change it once the bill is approved', async () => {
    await post(seller, `/${inv.id}/einvoice`, { irn: IRN });
    const other = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', billing_period: '2026-07' });
    expect((await post(seller, `/${other.id}/einvoice`, { irn: IRN })).status).toBe(400);
    db.prepare(`UPDATE invoices SET status = 'APPROVED' WHERE id = ?`).run(inv.id);
    expect((await post(seller, `/${inv.id}/einvoice`, { irn: 'b'.repeat(64) })).status).toBe(400);
    expect((await request(app).delete(`/api/invoice-compliance/${inv.id}/einvoice`).set(as(seller))).status).toBe(400);
  });
});

describe('signed copy', () => {
  const file = (name, bytes) => { const p = path.join(os.tmpdir(), `${Date.now()}-${name}`); fs.writeFileSync(p, bytes); return p; };
  const plainPdf = () => new Promise((resolve) => {
    const d = new PDFDocument(); const c = [];
    d.on('data', (x) => c.push(x)); d.on('end', () => resolve(Buffer.concat(c))); d.text('Invoice'); d.end();
  });
  const version = (id, filePath) => {
    db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES (?, ?, 'SELLER_INVOICE_SIGNED', 'RECORD', 'Signed')`).run(`D-${id}`, contract.id);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type) VALUES (?, ?, 1, ?, 'signed.pdf', 10, 'application/pdf')`).run(id, `D-${id}`, filePath);
  };

  it('tells a signed PDF from an unsigned one, and reads what the signature says', async () => {
    const plain = await plainPdf();
    expect(inspectSignature(file('plain.pdf', plain))).toMatchObject({ is_pdf: true, signed: false });
    const signed = Buffer.concat([plain, Buffer.from('\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 100 200 300] /Name (ARUN KUMAR) /M (D:20260702113000+05\'30\') /Reason (Invoice) >>\n', 'latin1')]);
    expect(inspectSignature(file('signed.pdf', signed))).toMatchObject({ signed: true, signer: 'ARUN KUMAR', signed_on: '2026-07-02 11:30', reason: 'Invoice' });
    expect(inspectSignature(file('x.png', Buffer.from('not a pdf')))).toMatchObject({ is_pdf: false });

    version('VS', file('signed2.pdf', signed));
    version('VP', file('pic.png', Buffer.from('not a pdf')));
    expect((await post(seller, `/${inv.id}/signed-copy`, { version_id: 'VP' })).status).toBe(400);
    expect((await post(seller, `/${inv.id}/signed-copy`, { version_id: 'nope' })).status).toBe(400);
    const ok = await post(seller, `/${inv.id}/signed-copy`, { version_id: 'VS' });
    expect(ok.body.signed_copy).toMatchObject({ signed: true, signer: 'ARUN KUMAR', file_name: 'signed.pdf' });
  });

  it('holds up approval only where SJVN has made it mandatory', async () => {
    const approver = makeUser('REIA_ADMIN', { name: 'Ravi REIA' });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('AP1', ?, 1, 'PENDING')`).run(inv.id);
    db.prepare(`UPDATE invoices SET validation_status = 'MATCHED', status = 'UNDER_APPROVAL' WHERE id = ?`).run(inv.id);
    setParam('seller_invoice_requires_signed_copy', 1);
    try {
      const refused = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(as(approver)).send({ decision: 'APPROVED' });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toMatch(/digitally signed copy/);
      expect((await get(seller, `/${inv.id}`)).body.requirements.signed_copy).toBe(true);
    } finally {
      setParam('seller_invoice_requires_signed_copy', 0);
    }
    const ok = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(as(approver)).send({ decision: 'APPROVED' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe('hard copy', () => {
  it('is dispatched by the seller and received by SJVN, in that order', async () => {
    expect((await post(reia, `/${inv.id}/hardcopy/received`, {})).status).toBe(400);
    expect((await post(seller, `/${inv.id}/hardcopy`, { courier: 'Blue Dart' })).status).toBe(400);
    const sent = await post(seller, `/${inv.id}/hardcopy`, { courier: 'Blue Dart', docket_no: '7812-3456-90' });
    expect(sent.body.hardcopy).toMatchObject({ courier: 'Blue Dart', docket_no: '7812-3456-90', received_on: null });
    expect((await post(seller, `/${inv.id}/hardcopy/received`, {})).status).toBe(403);
    const got = await post(reia, `/${inv.id}/hardcopy/received`, { note: 'Inward no. 4471' });
    expect(got.body.hardcopy).toMatchObject({ received_by: 'Riya REIA', note: 'Inward no. 4471' });
    expect((await post(seller, `/${inv.id}/hardcopy`, { courier: 'DTDC', docket_no: 'X12345' })).status).toBe(400);

    const draft = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'DRAFT', billing_period: '2026-08' });
    expect((await post(seller, `/${draft.id}/hardcopy`, { courier: 'DTDC', docket_no: 'X12345' })).status).toBe(400);
  });
});
