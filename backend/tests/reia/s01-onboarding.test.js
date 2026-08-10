import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, columnsOf, resetReia } from '../helpers/reia.js';

let reia, seller;
let seq = 1000;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  // Onboarding now requires what a counterparty of this kind actually has to
  // bring: PAN and GST on both sides, plus generation capacity for a seller.
  // Unique per test, because resetReia does not clear entities and a repeated
  // PAN would now be refused as the duplicate it is.
  const n = String(seq++).padStart(4, '0');
  seller = { entity_type: 'SELLER', category: 'RE Generator', name: 'Sunrise Solar', capacity_mw: 50,
             pan_no: `AAACS${n}B`, gst_no: `24AAACS${n}B1ZQ` };
});

describe('S1 Stakeholder onboarding', () => {
  it('onboards a seller with generation and org detail', async () => {
    const r = await request(app).post('/api/entities').set(auth(reia)).send({
      ...seller, pan_no: 'AAACS1111A', gst_no: '24AAACS1111A1ZP', technology: 'Solar',
      address: 'Bhuj', contracted_capacity_mw: 50,
    });
    expect(r.status).toBe(201);
    expect(r.body.entity_type).toBe('SELLER');
    expect(r.body.capacity_mw).toBe(50);
  });

  it('onboards a buyer with contracted capacity, PSA tariff and supply criteria', async () => {
    const r = await request(app).post('/api/entities').set(auth(reia)).send({
      entity_type: 'BUYER', category: 'DISCOM', name: 'State DISCOM',
      contracted_capacity_mw: 80, psa_tariff: 3.25, supply_criteria: 'RTC',
      pan_no: 'AAACD3333C', gst_no: '02AAACD3333C1ZR',
    });
    expect(r.status).toBe(201);
    expect(r.body.psa_tariff).toBe(3.25);
    expect(r.body.supply_criteria).toBe('RTC');
  });

  it('rejects onboarding when a mandatory field is missing', async () => {
    const r = await request(app).post('/api/entities').set(auth(reia)).send({ entity_type: 'SELLER' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('starts a new entity as PENDING, not live', async () => {
    const r = await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'Pending Co' });
    expect(r.body.status).toBe('PENDING');
  });

  it('refuses approval while mandatory regulatory items are outstanding', async () => {
    const c = await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'Approve Me' });
    const a = await request(app).post(`/api/entities/${c.body.id}/approve`).set(auth(reia)).send({ decision: 'APPROVED' });
    expect(a.status).toBe(400);
    expect(a.body.error).toMatch(/regulatory|penny/i);
    expect(db.prepare('SELECT status FROM entities WHERE id = ?').get(c.body.id).status).toBe('PENDING');
  });

  it('goes live once the gating checks are satisfied', async () => {
    const c = await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'Clean Co' });
    const id = c.body.id;
    // Clear the two gates the route enforces.
    db.prepare(`UPDATE entity_regulatory_approvals SET status = 'VERIFIED' WHERE entity_id = ?`).run(id);
    db.prepare('UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?').run(id);
    const a = await request(app).post(`/api/entities/${id}/approve`).set(auth(reia)).send({ decision: 'APPROVED' });
    expect(a.status).toBe(200);
    expect(db.prepare('SELECT status FROM entities WHERE id = ?').get(id).status).toBe('APPROVED');
  });

  it('flags a duplicate PAN rather than silently creating a second entity', async () => {
    await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'First', pan_no: 'AAACS9999A', gst_no: '24AAACS9999A1ZA' });
    // A different GST, so it is the PAN clash being tested and not the GST one.
    const dup = await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'Second', pan_no: 'AAACS9999A', gst_no: '24AAACS8888B1ZB' });
    // Either refused, or accepted but surfaced as a duplicate — silently creating a twin is the failure.
    const duplicated = db.prepare('SELECT COUNT(*) c FROM entities WHERE pan_no = ?').get('AAACS9999A').c;
    expect(dup.status >= 400 || duplicated === 1).toBe(true);
  });

  it('records an audit trail for the onboarding decision', async () => {
    const c = await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'Audited Co' });
    await request(app).post(`/api/entities/${c.body.id}/approve`).set(auth(reia)).send({ decision: 'APPROVED' });
    const logs = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ?').all(c.body.id);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('captures old and new values on a profile change', async () => {
    const e = makeEntity('SELLER', { name: 'Before Name', pan_no: 'AAACB1234A' });
    await request(app).put(`/api/entities/${e.id}`).set(auth(reia)).send({ pan_no: 'AAACB5678B' });
    const trail = db.prepare('SELECT * FROM entity_audit WHERE entity_id = ? ORDER BY rowid DESC').all(e.id);
    const panChange = trail.find(t => t.field_changed === 'pan_no');
    expect(panChange, 'no entity_audit row for the changed field').toBeTruthy();
    expect(panChange.old_value).toBe('AAACB1234A');
    expect(panChange.new_value).toBe('AAACB5678B');
    expect(panChange.changed_by).toBeTruthy();
  });

  it('holds a profile edit pending until approved rather than applying it live', async () => {
    const e = makeEntity('SELLER', { name: 'Live Name', status: 'APPROVED' });
    await request(app).put(`/api/entities/${e.id}`).set(auth(reia)).send({ name: 'Edited Name' });
    const after = db.prepare('SELECT name, status FROM entities WHERE id = ?').get(e.id);
    // An approved entity's edits should queue for approval, not go live immediately.
    expect(after.status === 'PENDING' || after.name === 'Live Name').toBe(true);
  });

  it('routes a bank-detail change through a stricter path than a plain edit', async () => {
    const e = makeEntity('SELLER', { status: 'APPROVED' });
    await request(app).put(`/api/entities/${e.id}`).set(auth(reia)).send({ account_no: '99998888', ifsc_code: 'SBIN0001' });
    const row = db.prepare('SELECT account_no, is_penny_drop_verified FROM entities WHERE id = ?').get(e.id);
    // A changed bank account must not stay "verified" from the previous one.
    expect(row.is_penny_drop_verified).toBe(0);
  });

  it('keeps a dedicated entity audit trail', () => {
    expect(columnsOf('entity_audit')).toEqual(
      expect.arrayContaining(['entity_id', 'field_changed', 'old_value', 'new_value', 'changed_by']));
  });
});

describe('S1 A counterparty can change its billing desk', () => {
  // Contacts could only be set when the entity was first created — no update
  // path touched them — so a counterparty that moved its billing desk could not
  // be corrected at all. The commercial contact is the address invoices are
  // sent to, which made it the one field the platform could not fix once wrong.
  let reia, ent;
  beforeEach(() => {
    reia = tokenFor('REIA_USER');
    ent = makeEntity('BUYER');
    // resetReia leaves entity_contacts alone, so the fixture id has to be its own.
    db.prepare(`INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary)
                VALUES (?, ?, 'COMMERCIAL', 'Old Desk', 'old@discom.test', '9999999999', 1)`)
      .run(`CNT-OLD-${ent.id}`, ent.id);
  });

  const put = (body) => request(app).put(`/api/entities/${ent.id}`).set(auth(reia)).send(body);
  const contacts = () => db.prepare('SELECT * FROM entity_contacts WHERE entity_id = ?').all(ent.id);

  it('replaces the contact set', async () => {
    const r = await put({ contacts: [{ contact_type: 'COMMERCIAL', name: 'New Desk', email: 'new@discom.test', phone: '8888888888', is_primary: 1 }] });
    expect(r.status).toBeLessThan(400);
    const c = contacts();
    expect(c, 'the old contact was left behind alongside the new one').toHaveLength(1);
    expect(c[0].email).toBe('new@discom.test');
  });

  it('leaves contacts alone when the payload does not mention them', async () => {
    await put({ credit_rating: 'AA' });
    expect(contacts()[0].email, 'an unrelated edit wiped the contacts').toBe('old@discom.test');
  });

  it('refuses a malformed address', async () => {
    // It would not fail here otherwise — it would fail later, as a bill that
    // was never delivered to a counterparty who is then late paying it.
    const r = await put({ contacts: [{ contact_type: 'COMMERCIAL', name: 'Desk', email: 'not-an-address' }] });
    expect(r.status).toBe(400);
    expect(contacts()[0].email, 'a bad address replaced a good one').toBe('old@discom.test');
  });

  it('refuses a contact with no name', async () => {
    const r = await put({ contacts: [{ contact_type: 'COMMERCIAL', email: 'new@discom.test' }] });
    expect(r.status, 'an unnamed contact reached the table and raised a constraint error').toBe(400);
  });

  it('records what the billing address was and what it became', async () => {
    await put({ contacts: [{ contact_type: 'COMMERCIAL', name: 'New Desk', email: 'new@discom.test' }] });
    const a = db.prepare(`SELECT * FROM entity_audit WHERE entity_id = ? AND field_changed = 'contacts'`).get(ent.id);
    expect(a, 'redirecting where invoices go left no trail').toBeTruthy();
    expect(a.old_value).toContain('old@discom.test');
    expect(a.new_value).toContain('new@discom.test');
  });

  it('sends an approved counterparty back for re-approval', async () => {
    // Redirecting where invoices are sent is not incidental detail, so it goes
    // through the same gate as a bank-account change.
    db.prepare(`UPDATE entities SET status = 'APPROVED' WHERE id = ?`).run(ent.id);
    await put({ contacts: [{ contact_type: 'COMMERCIAL', name: 'New Desk', email: 'new@discom.test' }] });
    expect(db.prepare('SELECT status FROM entities WHERE id = ?').get(ent.id).status).toBe('PENDING');
  });

  it('does not disturb an approved record when the contacts are unchanged', async () => {
    db.prepare(`UPDATE entities SET status = 'APPROVED' WHERE id = ?`).run(ent.id);
    await put({ contacts: [{ contact_type: 'COMMERCIAL', name: 'Old Desk', email: 'old@discom.test', phone: '9999999999', is_primary: 1 }] });
    expect(db.prepare('SELECT status FROM entities WHERE id = ?').get(ent.id).status,
      're-sending the same contacts knocked the record out of APPROVED').toBe('APPROVED');
  });
});
