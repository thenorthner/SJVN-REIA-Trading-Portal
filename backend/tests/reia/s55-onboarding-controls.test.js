import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, resetReia } from '../helpers/reia.js';
import PDFDocument from 'pdfkit';

// K3 (17-Oct-2026): a change of account is verified after a confirmed call-back.
const callBack = (entityId) => db.prepare(`INSERT INTO bank_change_callbacks (id, entity_id, change_requested_at, contact_name, phone, called_at, confirmed, officer_name)
  SELECT 'BCB-' || abs(random()), id, pending_bank_requested_at, 'Known contact', '9999999999', datetime('now'), 1, 'QA' FROM entities WHERE id = ?`).run(entityId);

// Found by the browser audit of stakeholder onboarding (17-Oct-2026): a seller
// marked its own mandatory clearance "not applicable", which counts as cleared;
// a seller created a company with all eight clearances VERIFIED; evidence
// edited on a verified clearance left it verified; the Hydro desk approved a
// REIA-only developer; and a seller's typed bank account went live on the desk's
// click with the bank proof NOT_STARTED.

let reia, reiaAdmin, hydro, ent, seller;
const items = () => db.prepare('SELECT * FROM entity_regulatory_approvals WHERE entity_id = ?').all(ent.id);
const item = (code) => db.prepare('SELECT * FROM entity_regulatory_approvals WHERE entity_id = ? AND approval_code = ?').get(ent.id, code);
const putItem = (code, body, who = reia) => request(app).put(`/api/entities/${ent.id}/regulatory-approvals/${item(code).id}`).set(auth(who)).send(body);
// Phase B.2: clearing a company is the checker's.
// The maker records a clearance's evidence; the checker decides on it as recorded.
const submit = (code, evidence) => putItem(code, { status: 'SUBMITTED', ...evidence });
const approve = (body, who = reiaAdmin) => request(app).post(`/api/entities/${ent.id}/approve`).set(auth(who)).send({ decision: 'APPROVED', ...body });

beforeEach(async () => {
  resetReia();
  db.prepare('DELETE FROM entity_regulatory_approvals').run();
  reia = tokenFor('REIA_USER');
  reiaAdmin = tokenFor('REIA_ADMIN');
  hydro = tokenFor('COMMERCIAL');
  ent = makeEntity('SELLER', { name: 'QA SunPower Green Energy', status: 'PENDING' });
  db.prepare(`UPDATE entities SET verticals = 'REIA', account_no = '98765432109', ifsc_code = 'SBIN0001234', bank_name = 'SBI' WHERE id = ?`).run(ent.id);
  seller = signToken(makeUser('SELLER', { linked_entity_id: ent.id }));
  // The checklist is seeded on the first approval attempt (the checker's, Phase B.2).
  await approve({}, reiaAdmin);
});

describe('S55 Who clears a clearance', () => {
  it('lets a company submit its evidence but not waive or decide a clearance', async () => {
    expect((await putItem('ENV_CLEARANCE', { status: 'NOT_APPLICABLE', notes: 'not needed for us' }, seller)).status).toBe(403);
    expect((await putItem('ENV_CLEARANCE', { status: 'VERIFIED', reference_no: 'X' }, seller)).status).toBe(403);
    const sub = await putItem('ENV_CLEARANCE', { status: 'SUBMITTED', reference_no: 'EC/2026/77' }, seller);
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(item('ENV_CLEARANCE').status).toBe('SUBMITTED');
  });

  it('needs a reason to waive a mandatory clearance, and something to verify one against', async () => {
    expect((await putItem('ENV_CLEARANCE', { status: 'NOT_APPLICABLE', notes: 'n/a' }, reiaAdmin)).status).toBe(400);
    expect((await putItem('ENV_CLEARANCE', { status: 'NOT_APPLICABLE', notes: 'Rooftop project below the EC threshold' }, reiaAdmin)).status).toBe(200);
    expect((await putItem('GENERATION_LICENSE', { status: 'VERIFIED' }, reiaAdmin)).body.error).toMatch(/attach the scanned document or record its reference/);
    await submit('GENERATION_LICENSE', { reference_no: 'CEA/REG/101', valid_until: '2020-01-01' });
    expect((await putItem('GENERATION_LICENSE', { status: 'VERIFIED' }, reiaAdmin)).body.error).toMatch(/lapsed/);
    await submit('GENERATION_LICENSE', { valid_until: '' });
    expect((await putItem('GENERATION_LICENSE', { status: 'VERIFIED' }, reiaAdmin)).status).toBe(200);
  });

  it('sends a verified clearance back for checking when its evidence changes', async () => {
    await submit('GENERATION_LICENSE', { reference_no: 'CEA/REG/101' });
    await putItem('GENERATION_LICENSE', { status: 'VERIFIED' }, reiaAdmin);
    expect((await putItem('GENERATION_LICENSE', { valid_until: '2099-12-31' }, seller)).status, 'the company edited a verified clearance').toBe(403);
    const r = await putItem('GENERATION_LICENSE', { valid_until: '2030-03-31' });
    expect(r.body.item.status).toBe('SUBMITTED');
    const again = await putItem('GENERATION_LICENSE', { status: 'VERIFIED' }, reiaAdmin);
    expect(again.body.item).toMatchObject({ status: 'VERIFIED', valid_until: '2030-03-31' });
  });

  it('does not let a company create itself pre-verified', async () => {
    const r = await request(app).post('/api/entities').set(auth(seller)).send({
      entity_type: 'SELLER', name: 'QA Self Verified Ltd', category: 'RE Generator', pan_no: 'QATST9999Q', gst_no: '02QATST9999Q1Z5', capacity_mw: 10,
      regulatory_checklist_init: ['COMPANY_REGISTRATION', 'GENERATION_LICENSE', 'BANK_ACCOUNT_PROOF'].map((c) => ({ approval_code: c, status: 'VERIFIED' })),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const statuses = db.prepare('SELECT DISTINCT status FROM entity_regulatory_approvals WHERE entity_id = ?').all(r.body.id).map((x) => x.status);
    expect(statuses).toEqual(['NOT_STARTED']);
  });
});

describe('S55 Whose desk decides', () => {
  it('keeps the Hydro desk off a REIA-only developer, and direct admission to administrators', async () => {
    const h = await approve({}, hydro);
    expect(h.status).toBe(403);
    expect(h.body.error).toMatch(/REIA stakeholder; your desk acts on Hydro Billing stakeholders only/);
    expect((await approve({ admin_direct_admit: true }, reia)).status).toBe(403);
    // Not before the company's registration and bank proof are verified on
    // their own documents (17-Oct-2026).
    const early = await approve({ admin_direct_admit: true }, tokenFor('SJVN_ADMIN'));
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/Direct admission still needs/);
    verifyCore();
    expect((await approve({ admin_direct_admit: true }, tokenFor('SJVN_ADMIN'))).status).toBe(200);
  });

  it('does not take a direct admission as a check of the bank account', async () => {
    db.prepare(`UPDATE entities SET is_penny_drop_verified = 0 WHERE id = ?`).run(ent.id);
    await approve({ admin_direct_admit: true }, tokenFor('SJVN_ADMIN'));
    verifyCore();
    await approve({ admin_direct_admit: true }, tokenFor('SJVN_ADMIN'));
    expect(db.prepare('SELECT status, is_penny_drop_verified FROM entities WHERE id = ?').get(ent.id)).toMatchObject({ status: 'APPROVED', is_penny_drop_verified: 0 });
  });
});

// The checklist is seeded by the first approval attempt.
function verifyCore() {
  db.prepare(`UPDATE entity_regulatory_approvals SET status = 'VERIFIED', verified_by = 'QA', verified_at = datetime('now')
    WHERE entity_id = ? AND approval_code IN ('COMPANY_REGISTRATION', 'BANK_ACCOUNT_PROOF')`).run(ent.id);
}

describe('S55 A new bank account goes live on proof of it', () => {
  const stage = () => request(app).put(`/api/entities/${ent.id}`).set(auth(seller)).send({ account_no: '99990000111122', ifsc_code: 'HDFC0000001', bank_name: 'QA Other Bank' });
  const account = () => db.prepare('SELECT account_no, pending_bank_json FROM entities WHERE id = ?').get(ent.id);

  it('refuses while the bank proof is not verified', async () => {
    await stage();
    callBack(ent.id);
    const r = await request(app).post(`/api/entities/${ent.id}/verify-bank`).set(auth(tokenFor('REIA_CHECKER'))).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Verify the bank proof/);
    expect(account().account_no).toBe('98765432109');
  });

  it('refuses a proof verified before the change was asked for', async () => {
    await submit('BANK_ACCOUNT_PROOF', { reference_no: 'CHQ-OLD' });
    await putItem('BANK_ACCOUNT_PROOF', { status: 'VERIFIED' }, reiaAdmin);
    db.prepare(`UPDATE entity_regulatory_approvals SET verified_at = '2026-01-01T00:00:00.000Z' WHERE entity_id = ? AND approval_code = 'BANK_ACCOUNT_PROOF'`).run(ent.id);
    await stage();
    callBack(ent.id);
    const r = await request(app).post(`/api/entities/${ent.id}/verify-bank`).set(auth(tokenFor('REIA_CHECKER'))).send({});
    expect(r.body.error).toMatch(/proves the old account/);
  });

  it('goes live once the new proof is verified, by someone other than who asked', async () => {
    await stage();
    await new Promise((r) => setTimeout(r, 1100));
    await submit('BANK_ACCOUNT_PROOF', { reference_no: 'CHQ-NEW' });
    await putItem('BANK_ACCOUNT_PROOF', { status: 'VERIFIED' }, reiaAdmin);
    callBack(ent.id);
    const r = await request(app).post(`/api/entities/${ent.id}/verify-bank`).set(auth(reiaAdmin)).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(account()).toMatchObject({ account_no: '99990000111122', pending_bank_json: null });
  });
});

// Scanning a paper in and verifying it are two people's work: the desk screen
// sent auto_verify on every intake, so whoever scanned a document verified it.
describe('S55 A scanned KYC paper is checked by someone else', () => {
  const pdf = (text) => new Promise((resolve) => {
    const doc = new PDFDocument(); const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(12).text(text); doc.end();
  });
  const intakeUser = () => makeUser('REIA_USER', { name: `Intake ${Math.random().toString(36).slice(2, 6)}` });
  const scan = async (user, extra = {}) => {
    let r = request(app).post('/api/documents/upload').set(auth(signToken(user)));
    for (const [k, v] of Object.entries({ entity_id: ent.id, document_type: 'GENERATION_LICENSE', category: 'VERIFY', title: 'CEA registration', auto_verify: 'true', ...extra })) r = r.field(k, v);
    return r.attach('file', await pdf(`CEA registration ${Math.random()}`), { filename: 'cea.pdf', contentType: 'application/pdf' });
  };
  const version = (id) => db.prepare('SELECT verification_status FROM document_versions WHERE id = ?').get(id).verification_status;

  it('keeps a desk officer\'s scan pending, and lets another officer — not the scanner — verify it', async () => {
    const officer = intakeUser();
    const up = await scan(officer);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(version(up.body.version_id)).toBe('PENDING');
    expect(item('GENERATION_LICENSE').status).not.toBe('VERIFIED');
    expect((await request(app).post(`/api/documents/${up.body.version_id}/verify`).set(auth(signToken(officer))).send({})).status).toBe(403);
    expect((await request(app).post(`/api/documents/${up.body.version_id}/verify`).set(auth(reiaAdmin)).send({})).status).toBe(200);
  });

  it('lets an administrator admit a current paper as verified, but never an expired one', async () => {
    const admin = makeUser('SJVN_ADMIN', { name: 'QA Admin' });
    expect(version((await scan(admin)).body.version_id)).toBe('VERIFIED');
    expect(version((await scan(admin, { document_type: 'COD_CERTIFICATE', title: 'COD', expiry_date: '2020-01-01' })).body.version_id)).toBe('PENDING');
  });
});
