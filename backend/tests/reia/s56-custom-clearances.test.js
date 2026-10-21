import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, resetReia } from '../helpers/reia.js';

// An administrator adds a compliance document beyond the built-in eight (18-Oct-2026).
let admin, desk, seller;
const add = (body, who = admin) => request(app).post('/api/entities/regulatory-catalog/custom').set(auth(who)).send(body);
const catalog = (type, who = admin) => request(app).get(`/api/entities/regulatory-catalog?entity_type=${type}`).set(auth(who));

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM entity_regulatory_approvals').run();
  db.prepare('DELETE FROM custom_clearance_types').run();
  db.prepare(`DELETE FROM document_type_master WHERE code LIKE 'CUSTOM_%'`).run();
  admin = tokenFor('REIA_ADMIN');
  desk = tokenFor('REIA_USER');
  seller = makeEntity('SELLER', { name: 'QA Solar One' });
});

describe('S56 Custom compliance documents', () => {
  it('only an administrator may add one', async () => {
    expect((await add({ label: 'Fire Safety NOC' }, desk)).status).toBe(403);
  });

  it('joins the checklist, the upload list and existing stakeholders, optional by default', async () => {
    const r = await add({ label: 'Fire Safety NOC', applies_to: 'SELLER', help: 'State fire dept' });
    expect(r.status).toBe(201);
    expect(r.body.is_mandatory).toBe(false);
    expect((await catalog('SELLER')).body.items.some((i) => i.code === 'CUSTOM_FIRE_SAFETY_NOC')).toBe(true);
    expect((await catalog('BUYER')).body.items.some((i) => i.code === 'CUSTOM_FIRE_SAFETY_NOC')).toBe(false);
    const row = db.prepare(`SELECT * FROM entity_regulatory_approvals WHERE entity_id = ? AND approval_code = 'CUSTOM_FIRE_SAFETY_NOC'`).get(seller.id);
    expect(row.status).toBe('NOT_STARTED');
    expect(row.is_mandatory).toBe(0);
    const dt = db.prepare(`SELECT * FROM document_type_master WHERE module_name = 'STAKEHOLDERS' AND code = 'CUSTOM_FIRE_SAFETY_NOC'`).get();
    expect(dt.is_active).toBe(1);
  });

  it('refuses a duplicate, however it is spelt, and a name too short', async () => {
    await add({ label: 'Fire Safety NOC' });
    expect((await add({ label: 'fire  safety noc' })).status).toBe(400);
    expect((await add({ label: 'Environmental Clearance' })).status).toBe(400);
    expect((await add({ label: 'ab' })).status).toBe(400);
  });

  it('retiring keeps filed evidence and drops untouched rows', async () => {
    const other = makeEntity('SELLER', { name: 'QA Solar Two' });
    await add({ label: 'Fire Safety NOC' });
    db.prepare(`UPDATE entity_regulatory_approvals SET status = 'SUBMITTED' WHERE entity_id = ? AND approval_code = 'CUSTOM_FIRE_SAFETY_NOC'`).run(other.id);
    expect((await request(app).patch('/api/entities/regulatory-catalog/custom/CUSTOM_FIRE_SAFETY_NOC').set(auth(admin)).send({ is_active: false })).status).toBe(200);
    const left = db.prepare(`SELECT entity_id FROM entity_regulatory_approvals WHERE approval_code = 'CUSTOM_FIRE_SAFETY_NOC'`).all();
    expect(left.map((x) => x.entity_id)).toEqual([other.id]);
    expect((await catalog('SELLER')).body.items.some((i) => i.code === 'CUSTOM_FIRE_SAFETY_NOC')).toBe(false);
    expect(db.prepare(`SELECT is_active FROM document_type_master WHERE code = 'CUSTOM_FIRE_SAFETY_NOC'`).get().is_active).toBe(0);
  });
});
