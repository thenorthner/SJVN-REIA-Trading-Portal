import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, resetReia } from '../helpers/reia.js';

// Who may change the company's own record.
//
// The decision: a sub-user does not. An L1/L2/L3 login exists to do the day's
// work — raise a bill, answer a dispute, upload a reading — not to rename the
// company, restate its capacity, or move the bank account the payments go to.
// Only the company's primary login does that, and SJVN's own desk.
//
// The routes already read that way; nothing held them to it, and the list of
// roles on a route is one edit away from drifting. These are the assertions that
// notice.

const SUB_ROLES = ['SELLER_L1', 'SELLER_L2', 'SELLER_L3', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3'];

let seller, buyer, reia;

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER', { name: 'Test Solar Ltd' });
  buyer = makeEntity('BUYER', { name: 'Test Discom' });
});

const entityFor = (role) => (role.startsWith('SELLER') ? seller : buyer);
const put = (token, id, body) => request(app).put(`/api/entities/${id}`).set(auth(token)).send(body);

describe('S26 Only a company’s primary login edits its profile', () => {
  it('lets the primary login change its own company', async () => {
    const token = tokenFor('SELLER', { linked_entity_id: seller.id });
    const r = await put(token, seller.id, { corporate_phone: '011-22334455' });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT corporate_phone FROM entities WHERE id = ?').get(seller.id).corporate_phone)
      .toBe('011-22334455');
  });

  it.each(SUB_ROLES)('refuses %s the company profile', async (role) => {
    const entity = entityFor(role);
    const token = tokenFor(role, { linked_entity_id: entity.id });
    const before = db.prepare('SELECT name FROM entities WHERE id = ?').get(entity.id).name;

    const r = await put(token, entity.id, { name: 'Renamed By A Sub User' });
    expect(r.status, `${role} was allowed to edit the company profile`).toBe(403);
    expect(db.prepare('SELECT name FROM entities WHERE id = ?').get(entity.id).name).toBe(before);
  });

  it.each(SUB_ROLES)('refuses %s the paperwork that hangs off the profile', async (role) => {
    const entity = entityFor(role);
    const token = tokenFor(role, { linked_entity_id: entity.id });

    const approval = await request(app)
      .put(`/api/entities/${entity.id}/regulatory-approvals/APR-ANY`)
      .set(auth(token)).send({ status: 'VERIFIED' });
    expect(approval.status).toBe(403);

    // The logo and the signature go on every invoice the company issues.
    for (const path of ['logo', 'signature']) {
      const upload = await request(app).post(`/api/entities/${entity.id}/${path}`).set(auth(token));
      expect(upload.status, `${role} could replace the ${path}`).toBe(403);
    }
  });

  it('leaves the REIA desk able to edit either company', async () => {
    expect((await put(reia, seller.id, { credit_rating: 'AA' })).status).toBe(200);
    expect((await put(reia, buyer.id, { credit_rating: 'A' })).status).toBe(200);
  });

  it('still refuses a primary login another company, not merely its sub-users', async () => {
    const token = tokenFor('SELLER', { linked_entity_id: seller.id });
    const r = await put(token, buyer.id, { name: 'Renamed Somebody Else' });
    expect(r.status).toBe(404);
    expect(db.prepare('SELECT name FROM entities WHERE id = ?').get(buyer.id).name).toBe('Test Discom');
  });

  it('records who changed what, so an edit is answerable afterwards', async () => {
    const token = tokenFor('SELLER', { linked_entity_id: seller.id, name: 'Primary Seller' });
    await put(token, seller.id, { corporate_email: 'billing@testsolar.in' });
    const row = db.prepare(`
      SELECT field_changed, new_value, changed_by FROM entity_audit
      WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1
    `).get(seller.id);
    expect(row).toMatchObject({
      field_changed: 'corporate_email', new_value: 'billing@testsolar.in', changed_by: 'Primary Seller',
    });
  });
});
