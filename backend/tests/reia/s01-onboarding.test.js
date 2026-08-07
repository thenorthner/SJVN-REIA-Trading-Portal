import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, columnsOf, resetReia } from '../helpers/reia.js';

let reia, seller;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = { entity_type: 'SELLER', category: 'RE Generator', name: 'Sunrise Solar', capacity_mw: 50 };
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
    await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'First', pan_no: 'AAACS9999A' });
    const dup = await request(app).post('/api/entities').set(auth(reia)).send({ ...seller, name: 'Second', pan_no: 'AAACS9999A' });
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
