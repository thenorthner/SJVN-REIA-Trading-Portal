import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';
import { runStakeholderAlerts } from '../../src/stakeholderEngine.js';

let reia;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); });

describe('S21 An amendment waits, and says when it applies', () => {
  // Amending built the new version and switched to it in the same breath: the
  // revised tariff was live the instant it was typed, nobody had approved it,
  // an effective_date passed in was silently dropped, and both versions were
  // billable at once because AMENDED bills too.
  let seller, c;
  beforeEach(() => {
    seller = makeEntity('SELLER');
    c = makeContract({ status: 'ACTIVE', seller_id: seller.id, tariff_per_unit: 3.0,
      tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
  });

  const amend = (body = {}) => request(app).post(`/api/contracts/${c.id}/amend`).set(auth(reia))
    .send({ tariff_per_unit: 3.4, effective_from: '2027-04-01', ...body });
  const statusOf = (id) => db.prepare('SELECT status FROM contracts WHERE id = ?').get(id).status;

  it('needs a date to apply from', async () => {
    const r = await amend({ effective_from: undefined });
    expect(r.status, 'an amendment with no effective date was accepted').toBe(400);
    expect(r.body.error).toMatch(/effective_from/);
  });

  it('refuses a date before the contract began', async () => {
    const r = await amend({ effective_from: '2025-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/before the contract began/i);
  });

  it('refuses a date after the contract ends', async () => {
    const r = await amend({ effective_from: '2032-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/after the contract ends/i);
  });

  it('records the date on the new version and on the amendment', async () => {
    const r = await amend();
    expect(r.body.amendment_effective_from).toBe('2027-04-01');
    const a = db.prepare('SELECT * FROM contract_amendments WHERE contract_id = ?').get(c.id);
    expect(a.effective_from).toBe('2027-04-01');
    expect(a.new_contract_id).toBe(r.body.id);
  });

  it('leaves the new version awaiting approval, not live', async () => {
    const r = await amend();
    expect(r.body.status, 'the revised terms went live with nobody approving them').toBe('PENDING_REGULATORY_APPROVAL');
  });

  it('keeps the original live until the amendment is approved', async () => {
    await amend();
    expect(statusOf(c.id), 'the contract in force was retired before its replacement was approved').toBe('ACTIVE');
  });

  it('retires the original only when the new version is activated', async () => {
    const r = await amend();
    await request(app).post(`/api/contracts/${r.body.id}/status`).set(auth(reia)).send({ status: 'ACTIVE' });
    expect(statusOf(r.body.id)).toBe('ACTIVE');
    expect(statusOf(c.id), 'the superseded version was left live alongside its replacement').toBe('AMENDED');
  });

  it('carries the PSA allocations onto the new version', async () => {
    const buyer = makeEntity('BUYER');
    const psa = makeContract({ contract_type: 'PSA', status: 'ACTIVE', seller_id: seller.id, buyer_id: buyer.id });
    await request(app).post(`/api/contracts/${c.id}/allocations`).set(auth(reia))
      .send({ psa_id: psa.id, allocation_percent: 100, effective_from: '2026-04-01' });

    const r = await amend();
    const onNew = db.prepare('SELECT * FROM contract_allocations WHERE ppa_id = ?').all(r.body.id);
    expect(onNew, 'every buyer was left drawing from the superseded PPA').toHaveLength(1);
    expect(onNew[0].psa_id).toBe(psa.id);
    expect(onNew[0].allocation_percent).toBe(100);
  });
});

describe('S21 A contract needs a counterparty that finished onboarding', () => {
  // Approval is the step that checks licences, registration and the bank
  // account. A contract could be raised against an entity that had passed none
  // of them, which left the whole checklist as paperwork nothing waited on.
  it('refuses a seller still pending approval', async () => {
    const s = makeEntity('SELLER', { status: 'PENDING' });
    const r = await request(app).post('/api/contracts').set(auth(reia)).send({
      contract_no: 'TEST-PENDING-SELLER', contract_type: 'PPA', seller_id: s.id,
      project_type: 'SOLAR', capacity_mw: 10, tariff_per_unit: 3, status: 'DRAFT',
    });
    expect(r.status, 'a contract was raised against a counterparty mid-onboarding').toBe(400);
    expect(r.body.entity_status).toBe('PENDING');
  });

  it('refuses a buyer still pending approval', async () => {
    const s = makeEntity('SELLER');
    const b = makeEntity('BUYER', { status: 'PENDING' });
    const r = await request(app).post('/api/contracts').set(auth(reia)).send({
      contract_no: 'TEST-PENDING-BUYER', contract_type: 'PSA', seller_id: s.id, buyer_id: b.id,
      project_type: 'SOLAR', capacity_mw: 10, tariff_per_unit: 3, status: 'DRAFT',
    });
    expect(r.status).toBe(400);
  });

  it('allows one where both sides are approved', async () => {
    const s = makeEntity('SELLER');
    const b = makeEntity('BUYER');
    const r = await request(app).post('/api/contracts').set(auth(reia)).send({
      contract_no: 'TEST-BOTH-APPROVED', contract_type: 'PSA', seller_id: s.id, buyer_id: b.id,
      project_type: 'SOLAR', capacity_mw: 10, tariff_per_unit: 3, status: 'DRAFT',
      tenure_start: '2026-04-01', tenure_end: '2031-03-31',
    });
    expect(r.status, 'the gate blocked a legitimate contract').toBe(201);
  });
});

describe('S21 Bulk upload takes the file it documents', () => {
  const row = (over = {}) => ({
    contract_no: `BULK-${Math.random().toString(36).slice(2, 8)}`, contract_type: 'PPA',
    project_type: 'SOLAR', capacity_mw: 10, tariff_per_unit: 3.1,
    tenure_start: '2026-04-01', tenure_end: '2031-03-31', ...over,
  });
  const upload = (rows) => request(app).post('/api/contracts/bulk-upload').set(auth(reia)).send({ rows });

  it('accepts a PPA row that omits buyer_id, since a PPA has no buyer', async () => {
    const s = makeEntity('SELLER');
    const r = await upload([row({ seller_id: s.id })]);
    expect(r.body.successful, `every PPA row failed: ${JSON.stringify(r.body.errors)}`).toBe(1);
  });

  it('loads rows as drafts rather than straight into a billable state', async () => {
    const s = makeEntity('SELLER');
    const r = await upload([row({ seller_id: s.id, contract_no: 'BULK-DRAFT-CHECK' })]);
    expect(r.body.successful).toBe(1);
    expect(db.prepare(`SELECT status FROM contracts WHERE contract_no = 'BULK-DRAFT-CHECK'`).get().status,
      'a spreadsheet put a contract straight into a billable state').toBe('DRAFT');
  });

  it('still commits the good rows and reports the bad one by number', async () => {
    const s = makeEntity('SELLER');
    const r = await upload([
      row({ seller_id: s.id, contract_no: 'BULK-A' }),
      row({ seller_id: s.id, contract_no: 'BULK-B', capacity_mw: null }),
      row({ seller_id: s.id, contract_no: 'BULK-C' }),
    ]);
    expect(r.body.successful).toBe(2);
    expect(r.body.failed).toBe(1);
    expect(r.body.errors[0].row).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) c FROM contracts WHERE contract_no IN ('BULK-A','BULK-C')`).get().c).toBe(2);
  });
});

describe('S21 Document expiry is watched where documents actually live', () => {
  // The sweep read entity_documents — a legacy table written only by an optional
  // array on entity creation and empty in practice — while every real upload
  // landed in documents/document_versions and was never watched at all.
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  const uploadedDoc = (expiry, { type = 'GENERATION_LICENSE' } = {}) => {
    const e = makeEntity('SELLER');
    const docId = `DOC-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`INSERT INTO documents (id, entity_id, document_type, category, title, status, created_by)
                VALUES (?, ?, ?, 'VERIFY', ?, 'ACTIVE', NULL)`).run(docId, e.id, type, type);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type, verification_status, expiry_date, created_by)
                VALUES (?, ?, 1, '/tmp/x', 'x.pdf', 1024, 'application/pdf', 'VERIFIED', ?, NULL)`).run(`DV-${docId}`, docId, expiry);
    return { entity: e, docId };
  };
  const alerts = (type) => db.prepare(`SELECT * FROM notifications WHERE type = ?`).all(type);

  it('warns about a licence expiring soon', () => {
    uploadedDoc(day(25));
    runStakeholderAlerts();
    const n = alerts('DOCUMENT_EXPIRING');
    expect(n.length, 'an uploaded licence 25 days from expiry raised nothing').toBeGreaterThan(0);
    expect(n[0].message).toMatch(/GENERATION_LICENSE/);
    expect(n[0].message, 'the notice does not say how urgent it is').toMatch(/30-day notice/);
  });

  it('gets more insistent as the date closes', () => {
    uploadedDoc(day(5));
    runStakeholderAlerts();
    expect(alerts('DOCUMENT_EXPIRING')[0].message).toMatch(/7-day notice/);
  });

  it('says so once it has actually expired', () => {
    uploadedDoc(day(-3));
    runStakeholderAlerts();
    expect(alerts('DOCUMENT_EXPIRED').length).toBe(1);
  });

  it('leaves a document with plenty of time alone', () => {
    uploadedDoc(day(200));
    runStakeholderAlerts();
    expect(alerts('DOCUMENT_EXPIRING')).toHaveLength(0);
  });

  it('watches only the current version of a document', () => {
    // A renewed licence supersedes the old one; the old expiry is history.
    const { docId } = uploadedDoc(day(-3));
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type, verification_status, expiry_date, created_by)
                VALUES (?, ?, 2, '/tmp/y', 'y.pdf', 1024, 'application/pdf', 'PENDING', ?, NULL)`).run(`DV2-${docId}`, docId, day(400));
    runStakeholderAlerts();
    expect(alerts('DOCUMENT_EXPIRED'), 'a superseded version was still being chased').toHaveLength(0);
  });

  it('does not repeat the same notice on the next hourly run', () => {
    uploadedDoc(day(25));
    runStakeholderAlerts();
    const first = alerts('DOCUMENT_EXPIRING').length;
    runStakeholderAlerts();
    expect(alerts('DOCUMENT_EXPIRING').length).toBe(first);
  });
});
