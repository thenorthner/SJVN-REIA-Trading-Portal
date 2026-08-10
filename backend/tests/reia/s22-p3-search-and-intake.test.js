import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';

let reia;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); });

describe('S22 Contract search answers what it was asked', () => {
  // `q` matched contract_no alone, so searching by seller — the obvious way to
  // find a generator's contracts — returned nothing. capacity_min and
  // capacity_max were dropped on the floor, so a search narrowed to a band came
  // back with everything and looked like it had worked.
  let windco, solarco;
  beforeEach(() => {
    windco = makeEntity('SELLER', { name: 'Jaisalmer WindCo' });
    solarco = makeEntity('SELLER', { name: 'Bhuj SolarCo' });
    makeContract({ contract_no: 'PPA-WIND-A', seller_id: windco.id, capacity_mw: 25, status: 'ACTIVE', tenure_end: '2031-03-31' });
    makeContract({ contract_no: 'PPA-WIND-B', seller_id: windco.id, capacity_mw: 5, status: 'ACTIVE', tenure_end: '2031-03-31' });
    makeContract({ contract_no: 'PPA-SOLAR-A', seller_id: solarco.id, capacity_mw: 100, status: 'ACTIVE', tenure_end: '2031-03-31' });
  });
  const search = (qs) => request(app).get(`/api/contracts?${qs}`).set(auth(reia));

  it('finds a seller by name', async () => {
    const r = await search('q=Jaisalmer');
    expect(r.status).toBe(200);
    expect(r.body.map((c) => c.contract_no).sort(), 'searching by seller name found nothing')
      .toEqual(['PPA-WIND-A', 'PPA-WIND-B']);
  });

  it('still finds a contract by its number', async () => {
    const r = await search('q=SOLAR-A');
    expect(r.body.map((c) => c.contract_no)).toEqual(['PPA-SOLAR-A']);
  });

  it('narrows to a capacity band', async () => {
    const r = await search('capacity_min=10&capacity_max=50');
    expect(r.body.map((c) => c.contract_no), 'the capacity band was ignored').toEqual(['PPA-WIND-A']);
  });

  it('applies a lower bound on its own', async () => {
    const r = await search('capacity_min=20');
    expect(r.body.map((c) => c.contract_no).sort()).toEqual(['PPA-SOLAR-A', 'PPA-WIND-A']);
  });

  it('finds what expires in the next 30 days, from the dates', async () => {
    const soon = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
    makeContract({ contract_no: 'PPA-ENDING', seller_id: windco.id, capacity_mw: 8, status: 'ACTIVE', tenure_end: soon });
    const r = await search('expiring_within_days=30');
    expect(r.body.map((c) => c.contract_no), 'asked of the dates, not of a status something else must set')
      .toEqual(['PPA-ENDING']);
  });

  it('leaves an already-ended contract out of the expiring list', async () => {
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    makeContract({ contract_no: 'PPA-DONE', seller_id: windco.id, capacity_mw: 8, status: 'TERMINATED', tenure_end: soon });
    const r = await search('expiring_within_days=30');
    expect(r.body.map((c) => c.contract_no)).not.toContain('PPA-DONE');
  });

  it('says so rather than returning everything for a filter it does not know', async () => {
    const r = await search('capacity_between=10,50');
    expect(r.status, 'an unknown filter returned the whole list and looked like a result').toBe(400);
    expect(r.body.supported_filters).toContain('capacity_min');
  });

  it('refuses a capacity that is not a number', async () => {
    expect((await search('capacity_min=big')).status).toBe(400);
  });
});

describe('S22 The dashboard counts the stakeholders it is about', () => {
  const kpis = async () => (await request(app).get('/api/dashboard/reia').set(auth(reia))).body.kpis;

  // resetReia does not clear entities, so these assert on the change this test
  // makes rather than on a total that belongs to the whole file.
  it('counts approved sellers and buyers', async () => {
    const before = await kpis();
    makeEntity('SELLER'); makeEntity('SELLER'); makeEntity('BUYER');
    const after = await kpis();
    expect(after.activeSellers - before.activeSellers,
      'a dashboard about counterparties could not count them').toBe(2);
    expect(after.activeBuyers - before.activeBuyers).toBe(1);
  });

  it('counts counterparties waiting on approval', async () => {
    const before = await kpis();
    makeEntity('SELLER', { status: 'PENDING' });
    makeEntity('BUYER', { status: 'PENDING' });
    const after = await kpis();
    expect(after.pendingEntityApprovals - before.pendingEntityApprovals).toBe(2);
  });

  it('reports contract statuses, not only invoice statuses', async () => {
    makeContract({ status: 'ACTIVE' });
    makeContract({ status: 'TERMINATED' });
    const body = (await request(app).get('/api/dashboard/reia').set(auth(reia))).body;
    const byStatus = Object.fromEntries(body.contractsByStatus.map((r) => [r.status, r.c]));
    expect(byStatus.ACTIVE).toBe(1);
    expect(byStatus.TERMINATED).toBe(1);
  });

  it('lists the documents about to lapse', async () => {
    const e = makeEntity('SELLER');
    db.prepare(`INSERT INTO documents (id, entity_id, document_type, category, title, status, created_by)
                VALUES ('D-EXP', ?, 'GENERATION_LICENSE', 'VERIFY', 'Licence', 'ACTIVE', NULL)`).run(e.id);
    db.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_name, file_size_bytes, mime_type, verification_status, expiry_date, created_by)
                VALUES ('DV-EXP', 'D-EXP', 1, '/tmp/x', 'x.pdf', 10, 'application/pdf', 'VERIFIED', date('now','+20 days'), NULL)`).run();
    const body = (await request(app).get('/api/dashboard/reia').set(auth(reia))).body;
    expect(body.kpis.documentsExpiringSoon).toBe(1);
    expect(body.documentsExpiring[0].document_type).toBe('GENERATION_LICENSE');
    expect(body.documentsExpiring[0].days_remaining).toBeLessThanOrEqual(20);
  });
});

describe('S22 Onboarding asks for what each kind of counterparty has', () => {
  // Only name, type and category were required, so a generator could be
  // onboarded with no PAN, no GST and no stated capacity — and the record it
  // left could not be invoiced or checked for plausible output.
  const post = (body) => request(app).post('/api/entities').set(auth(reia)).send(body);
  const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

  const seller = (over = {}) => ({ entity_type: 'SELLER', category: 'IPP', name: `S ${uniq()}`,
    pan_no: `AAACS${uniq()}`, gst_no: `24AAACS${uniq()}1ZQ`, capacity_mw: 25, ...over });
  const buyer = (over = {}) => ({ entity_type: 'BUYER', category: 'DISCOM', name: `B ${uniq()}`,
    pan_no: `AAACD${uniq()}`, gst_no: `02AAACD${uniq()}1ZR`, contracted_capacity_mw: 200, ...over });

  it('accepts a complete seller', async () => {
    expect((await post(seller())).status).toBe(201);
  });

  it('accepts a complete buyer', async () => {
    expect((await post(buyer())).status).toBe(201);
  });

  it('refuses a seller with no generation capacity', async () => {
    const r = await post(seller({ capacity_mw: undefined }));
    expect(r.status).toBe(400);
    expect(r.body.missing_fields).toContain('capacity_mw');
  });

  it('refuses a buyer with no contracted capacity', async () => {
    const r = await post(buyer({ contracted_capacity_mw: undefined }));
    expect(r.status).toBe(400);
    expect(r.body.missing_fields).toContain('contracted_capacity_mw');
  });

  it('does not ask a buyer for generation capacity', async () => {
    const r = await post(buyer());
    expect(r.status, 'a DISCOM was asked what it generates').toBe(201);
  });

  it('does not ask a seller for contracted capacity', async () => {
    const r = await post(seller());
    expect(r.status).toBe(201);
  });

  it('refuses either side with no PAN or GST', async () => {
    expect((await post(seller({ pan_no: undefined }))).body.missing_fields).toContain('pan_no');
    expect((await post(buyer({ gst_no: undefined }))).body.missing_fields).toContain('gst_no');
  });

  it('reports everything missing at once', async () => {
    const r = await post({ entity_type: 'SELLER', category: 'IPP', name: 'Bare Co' });
    expect(r.body.missing_fields.sort(), 'one field at a time means submit, fix, submit, fix')
      .toEqual(['capacity_mw', 'gst_no', 'pan_no']);
  });
});

describe('S22 A signatory has somewhere to go', () => {
  // contact_type allowed COMMERCIAL, TECHNICAL, DISPUTE and EMERGENCY, so the
  // authorised signatory — the person who binds the counterparty, and the one
  // onboarding asks for by name — had nowhere to be recorded with an email.
  const post = (contacts) => request(app).post('/api/entities').set(auth(reia)).send({
    entity_type: 'SELLER', category: 'IPP', name: `Sig ${Math.random().toString(36).slice(2, 7)}`,
    pan_no: `AAACS${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    gst_no: `24AAACS${Math.random().toString(36).slice(2, 7).toUpperCase()}1ZQ`,
    capacity_mw: 10, contacts,
  });

  it('accepts an authorised signatory', async () => {
    const r = await post([{ contact_type: 'AUTHORIZED_SIGNATORY', name: 'A. Sharma', email: 'a@x.test', phone: '9999999999', is_primary: 1 }]);
    expect(r.status, 'the signatory onboarding asks for could not be recorded').toBe(201);
    expect(r.body.contacts[0].contact_type).toBe('AUTHORIZED_SIGNATORY');
  });

  it('refuses an unknown type with the list, not a 500', async () => {
    const r = await post([{ contact_type: 'CHIEF_VIBES', name: 'X', email: 'x@x.test' }]);
    expect(r.status, 'a bad contact type reached the CHECK constraint and came back a 500').toBe(400);
    expect(r.body.error).toMatch(/AUTHORIZED_SIGNATORY/);
  });

  it('still takes the types it always did', async () => {
    const r = await post([{ contact_type: 'TECHNICAL', name: 'T', email: 't@x.test' }]);
    expect(r.status).toBe(201);
  });
});
