import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, auditFor } from './helpers/reia.js';

// Documents & KYC: a company reads and uploads only its own, the REIA desk
// reviews what has actually been submitted and never its own upload, and every
// step leaves a line in the audit trail.

let admin, reia, finance, seller, sellerL1, otherSeller, loose, alpha, beta;
const as = (u) => auth(signToken(u));

const pdf = (text) => new Promise((resolve) => {
  const doc = new PDFDocument();
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.fontSize(12).text(text);
  doc.end();
});

const upload = (u, fields, file, name = 'proof.pdf') => {
  let r = request(app).post('/api/documents/upload').set(as(u));
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  return r.attach('file', file, { filename: name, contentType: name.endsWith('.png') ? 'image/png' : 'application/pdf' });
};
const kyc = (entity, extra = {}) => ({ entity_id: entity.id, document_type: 'PAN_CARD', category: 'VERIFY', title: 'PAN card', ...extra });
const list = (u, q = '') => request(app).get(`/api/documents${q}`).set(as(u)).then((r) => r.body);

beforeEach(() => {
  db.prepare('DELETE FROM document_requests').run();
  db.prepare('DELETE FROM document_versions').run();
  db.prepare('DELETE FROM documents').run();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar', pan_no: 'ABCDE1234F', gst_no: '02ABCDE1234F1Z5' });
  beta = makeEntity('SELLER', { name: 'Beta Wind', pan_no: 'PQRSX9876K' });
  admin = makeUser('SJVN_ADMIN', { name: 'Asha Admin' });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  finance = makeUser('FINANCE_USER', { name: 'Farhan Finance' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
  sellerL1 = makeUser('SELLER_L1', { name: 'Anu Alpha', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
  loose = makeUser('SELLER', { name: 'Loose Login' });
});

describe('who may read a document', () => {
  it('keeps a company to its own, and a login with no company to nothing', async () => {
    const mine = await upload(seller, kyc(alpha), await pdf('Company PAN ABCDE1234F'));
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    // A contract document with no company on it — the case that used to leak.
    const contract = makeContract({ seller_id: beta.id });
    const rec = await upload(reia, { contract_id: contract.id, document_type: 'OTHER', category: 'RECORD', title: 'Note' }, await pdf('internal note for the contract file'));
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);

    expect((await list(seller)).map((d) => d.title)).toEqual(['PAN card']);
    expect((await list(otherSeller)).map((d) => d.title)).toEqual(['Note']);
    expect(await list(loose)).toEqual([]);
    expect((await list(reia)).length).toBe(2);

    const dl = (u, id) => request(app).get(`/api/documents/${id}/download`).set(as(u)).then((r) => r.status);
    expect(await dl(seller, mine.body.version_id)).toBe(200);
    expect(await dl(otherSeller, mine.body.version_id)).toBe(403);
    expect(await dl(loose, rec.body.version_id)).toBe(403);
    expect(await dl(loose, mine.body.version_id)).toBe(403);
    expect(await dl(otherSeller, rec.body.version_id)).toBe(200);
    expect(await dl(reia, mine.body.version_id)).toBe(200);
  });

  it('will not let a company add a version to another company’s document', async () => {
    const mine = await upload(seller, kyc(alpha), await pdf('Company PAN ABCDE1234F'));
    const sneak = await upload(otherSeller, { document_id: mine.body.document_id }, await pdf('a different file altogether'));
    expect(sneak.status).toBe(403);
    expect((await upload(otherSeller, kyc(alpha), await pdf('x'.repeat(40)))).status).toBe(403);
  });
});

describe('review', () => {
  const act = (u, id, what, body) => request(app).post(`/api/documents/${id}/${what}`).set(as(u)).send(body);

  it('is the REIA desk’s, on a submitted latest version, and leaves an audit trail', async () => {
    const up = await upload(seller, kyc(alpha), await pdf('Company PAN ABCDE1234F'));
    const id = up.body.version_id;
    expect((await act(finance, id, 'verify')).status).toBe(403);
    expect((await act(seller, id, 'verify')).status).toBe(403);
    expect((await act(reia, 'no-such-version', 'verify')).status).toBe(404);

    expect((await act(reia, id, 'verify')).status).toBe(200);
    expect((await act(admin, id, 'verify')).status).toBe(400);   // already verified
    expect((await list(seller))[0]).toMatchObject({ verification_status: 'VERIFIED', verified_by_name: 'Riya REIA' });
    expect(auditFor(id).map((a) => a.action)).toEqual(expect.arrayContaining(['DOCUMENT_UPLOADED', 'DOCUMENT_VERIFIED']));
  });

  it('refuses a draft, a superseded version and an expired document', async () => {
    const draft = await upload(sellerL1, kyc(alpha), await pdf('Company PAN ABCDE1234F'));
    expect((await act(reia, draft.body.version_id, 'verify')).status).toBe(400);

    const v1 = await upload(seller, kyc(alpha, { document_type: 'GST_CERT', title: 'GST' }), await pdf('GSTIN 02ABCDE1234F1Z5 first copy'));
    const v2 = await upload(seller, { document_id: v1.body.document_id }, await pdf('GSTIN 02ABCDE1234F1Z5 second copy'));
    expect(v2.status, JSON.stringify(v2.body)).toBe(200);
    expect((await act(reia, v1.body.version_id, 'verify')).status).toBe(400);

    const old = await upload(seller, kyc(alpha, { document_type: 'LICENCE', title: 'Licence', expiry_date: '2020-01-01' }), await pdf('Generation licence valid till 2020'));
    const r = await act(reia, old.body.version_id, 'verify');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/expired/);
  });

  it('sends a document back with a reason the company can read', async () => {
    const up = await upload(seller, kyc(alpha), await pdf('Company PAN ABCDE1234F'));
    expect((await act(reia, up.body.version_id, 'reject', {})).status).toBe(400);
    expect((await act(reia, up.body.version_id, 'reject', { reason_code: 'NOPE' })).status).toBe(400);
    const r = await act(reia, up.body.version_id, 'reject', { reason_code: 'NOT_LEGIBLE', reason: 'Image is blurry, upload a clear scan' });
    expect(r.status).toBe(200);
    expect((await list(seller))[0]).toMatchObject({
      verification_status: 'REJECTED', rejection_code: 'NOT_LEGIBLE', verification_notes: 'Image is blurry, upload a clear scan',
    });
    const bell = db.prepare(`SELECT message FROM notifications WHERE user_id = ? AND type = 'DOCUMENT_REVIEW'`).all(seller.id);
    expect(bell[0].message).toMatch(/blurry/);
  });

  it('will not take back the very file that was rejected', async () => {
    const file = await pdf('Company PAN ABCDE1234F');
    const up = await upload(seller, kyc(alpha), file);
    await act(reia, up.body.version_id, 'reject', { reason_code: 'WRONG_DOCUMENT' });
    const again = await upload(seller, { document_id: up.body.document_id }, file);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/same file that was rejected/);
    expect((await upload(seller, { document_id: up.body.document_id }, await pdf('A corrected copy, PAN ABCDE1234F'))).status).toBe(200);
  });
});

describe('what the file says', () => {
  it('reads the PAN and GSTIN and compares them with the company record', async () => {
    const good = await upload(seller, kyc(alpha), await pdf('Permanent Account Number ABCDE1234F  GSTIN 02ABCDE1234F1Z5'));
    expect(good.body.extracted).toMatchObject({ readable: true, gstin: ['02ABCDE1234F1Z5'] });
    expect(good.body.extracted.checks.every((c) => c.ok)).toBe(true);

    const bad = await upload(seller, kyc(alpha, { document_type: 'PAN_2', title: 'Other PAN' }), await pdf('Permanent Account Number ZZZZZ0000Z'));
    expect(bad.body.extracted.checks).toEqual([expect.objectContaining({ ok: false })]);
    expect((await list(reia, `?entity_id=${alpha.id}`)).find((d) => d.title === 'Other PAN').extracted.pan).toEqual(['ZZZZZ0000Z']);
  });

  it('says so when a file has no text to read, and flags the same file under two companies', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
    const a = await upload(seller, kyc(alpha), png, 'pan.png');
    expect(a.body.extracted).toMatchObject({ readable: false, pan: [] });
    const b = await upload(otherSeller, kyc(beta), png, 'pan.png');
    expect(b.body.extracted.checks[0]).toMatchObject({ ok: false });
    expect(b.body.extracted.checks[0].text).toMatch(/Alpha Solar/);
  });
});

describe('expiry, history, queue and report', () => {
  it('marks a dated document as expiring or expired', async () => {
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const up = await upload(seller, kyc(alpha, { expiry_date: soon }), await pdf('Company PAN ABCDE1234F'));
    await request(app).post(`/api/documents/${up.body.version_id}/verify`).set(as(reia));
    expect((await list(seller))[0]).toMatchObject({ expiry_state: 'EXPIRING', days_to_expiry: 10, effective_status: 'VERIFIED' });
    db.prepare(`UPDATE document_versions SET expiry_date = '2020-01-01'`).run();
    expect((await list(seller))[0]).toMatchObject({ expiry_state: 'EXPIRED', effective_status: 'EXPIRED' });
  });

  it('keeps every version, and shows the desk what is waiting', async () => {
    const v1 = await upload(seller, kyc(alpha), await pdf('Company PAN ABCDE1234F copy one'));
    await request(app).post(`/api/documents/${v1.body.version_id}/reject`).set(as(reia)).send({ reason_code: 'NOT_SIGNED' });
    await upload(seller, { document_id: v1.body.document_id }, await pdf('Company PAN ABCDE1234F copy two'));

    const h = await request(app).get(`/api/documents/history/${v1.body.document_id}`).set(as(seller));
    expect(h.body.versions.map((v) => [v.version_number, v.verification_status])).toEqual([[2, 'PENDING'], [1, 'REJECTED']]);
    expect((await request(app).get(`/api/documents/history/${v1.body.document_id}`).set(as(otherSeller))).status).toBe(404);

    const q = await request(app).get('/api/documents/queue').set(as(reia));
    expect(q.body.map((d) => [d.entity_name, d.version_number])).toEqual([['Alpha Solar', 2]]);
    expect((await request(app).get('/api/documents/queue').set(as(seller))).status).toBe(403);

    const report = await request(app).get('/api/documents/kyc-report').set(as(finance));
    expect(report.body.find((r) => r.entity_id === alpha.id)).toMatchObject({ documents: 1, pending: 1, verified: 0 });
    expect((await request(app).get('/api/documents/kyc-report').set(as(seller))).status).toBe(403);
  });

  it('hands over a company’s documents as one zip, to those who may read them', async () => {
    await upload(seller, kyc(alpha), await pdf('Company PAN ABCDE1234F'));
    const zip = await request(app).get(`/api/documents/zip?entity_id=${alpha.id}`).set(as(seller)).buffer().parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(zip.status).toBe(200);
    expect(zip.body.slice(0, 2).toString()).toBe('PK');
    expect(zip.body.includes(Buffer.from('index.csv'))).toBe(true);
    expect((await request(app).get(`/api/documents/zip?entity_id=${alpha.id}`).set(as(otherSeller))).status).toBe(404);
    expect((await request(app).get(`/api/documents/zip?entity_id=${alpha.id}&verified=1`).set(as(reia))).status).toBe(404);
  });
});

describe('asking for a document', () => {
  it('reaches the company, and closes when the document arrives', async () => {
    const ask = await request(app).post('/api/documents/requests').set(as(reia))
      .send({ entity_id: alpha.id, document_type: 'PAN_CARD', note: 'Need the latest', due_date: '2020-01-01' });
    expect(ask.status, JSON.stringify(ask.body)).toBe(201);
    expect((await request(app).post('/api/documents/requests').set(as(seller)).send({ entity_id: alpha.id, document_type: 'X' })).status).toBe(403);

    const mine = await request(app).get('/api/documents/requests').set(as(seller));
    expect(mine.body).toEqual([expect.objectContaining({ document_type: 'PAN_CARD', status: 'OPEN', overdue: true })]);
    expect((await request(app).get('/api/documents/requests').set(as(otherSeller))).body).toEqual([]);

    await upload(seller, kyc(alpha), await pdf('Company PAN ABCDE1234F'));
    expect((await request(app).get('/api/documents/requests').set(as(seller))).body[0].status).toBe('FULFILLED');
  });
});
