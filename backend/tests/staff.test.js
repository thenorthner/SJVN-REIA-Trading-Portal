import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, resetReia, auditFor } from './helpers/reia.js';

// SJVN's own users: who may add, re-role, reset and switch off whom, and that
// the platform is never left without an administrator.

let it1, admin, reiaAdmin, reiaUser, finance, trader, seller;
const as = (u) => auth(signToken(u));
const get = (u, p = '') => request(app).get(`/api/staff${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/staff${p}`).set(as(u)).send(body);
const patch = (u, id, body) => request(app).patch(`/api/staff/${id}`).set(as(u)).send(body);
const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

beforeEach(() => {
  resetReia();
  // Only the users this test makes: the register counts administrators.
  db.prepare('DELETE FROM users').run();
  it1 = makeUser('IT_SUPER_ADMIN', { name: 'Isha IT' });
  admin = makeUser('SJVN_ADMIN', { name: 'Anil Admin' });
  reiaAdmin = makeUser('REIA_ADMIN', { name: 'Rekha REIA-Admin' });
  reiaUser = makeUser('REIA_USER', { name: 'Ravi REIA', email: 'ravi@sjvn.test' });
  finance = makeUser('FINANCE_USER', { name: 'Farid Finance' });
  trader = makeUser('TRADING_USER', { name: 'Tara Trader' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: makeEntity('SELLER').id });
});

describe('the register', () => {
  it('shows an administrator everyone at SJVN, a desk administrator its own desk, and nobody else anything', async () => {
    const all = (await get(admin)).body;
    expect(all.members.map((m) => m.name)).toEqual(['Isha IT', 'Anil Admin', 'Rekha REIA-Admin', 'Ravi REIA', 'Farid Finance', 'Tara Trader']);
    expect(all.members.some((m) => m.name === 'Arun Alpha')).toBe(false);
    expect(all.totals).toMatchObject({ active: 6, admins: 2 });
    // An SJVN administrator does not manage the IT administrators, or itself.
    expect(all.members.find((m) => m.id === it1.id).can).toMatchObject({ edit: false, deactivate: false, reset_password: false });
    expect(all.members.find((m) => m.id === admin.id).can).toMatchObject({ edit: true, role: false, deactivate: false });
    expect(all.members.find((m) => m.id === finance.id).can).toMatchObject({ edit: true, role: true, deactivate: true, reset_password: true });
    expect(all.assignable_roles.map((r) => r.value)).not.toContain('IT_SUPER_ADMIN');

    const desk = (await get(reiaAdmin)).body;
    expect(desk.members.map((m) => m.name)).toEqual(['Rekha REIA-Admin', 'Ravi REIA']);
    expect(desk.assignable_roles.map((r) => r.value)).toEqual(['REIA_USER']);
    for (const u of [reiaUser, finance, seller]) expect((await get(u)).status).toBe(403);
  });

  it('warns when one administrator is all there is', async () => {
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(it1.id);
    expect((await get(admin)).body.health[0].text).toMatch(/only active administrator/);
  });
});

describe('adding and changing', () => {
  it('issues a one-time password, and keeps each administrator inside what it may grant', async () => {
    expect((await post(reiaAdmin, '', { name: 'New Trader', email: 'nt@sjvn.test', role: 'TRADING_USER' })).status).toBe(403);
    expect((await post(admin, '', { name: 'New IT', email: 'ni@sjvn.test', role: 'IT_SUPER_ADMIN' })).status).toBe(403);
    expect((await post(admin, '', { name: 'X Y', email: 'x@sjvn.test', role: 'SELLER' })).body.error).toMatch(/Choose a role/);
    expect((await post(admin, '', { name: 'X Y', email: 'RAVI@sjvn.test', role: 'REIA_USER' })).status).toBe(409);

    const r = await post(reiaAdmin, '', { name: 'Neha New', email: 'neha@sjvn.test', role: 'REIA_USER', designation: 'Sr. Manager (Commercial)' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const made = row(r.body.id);
    expect(made).toMatchObject({ role: 'REIA_USER', linked_entity_id: null, must_change_password: 1, created_by: reiaAdmin.id });
    expect(bcrypt.compareSync(r.body.temporary_password, made.password_hash)).toBe(true);
    expect((await request(app).post('/api/auth/login').send({ email: 'neha@sjvn.test', password: r.body.temporary_password })).body.user.must_change_password).toBe(true);

    // A move between desks ends the session, so the old role stops working at once.
    const token = signToken(reiaUser);
    db.prepare('UPDATE users SET sessions_revoked_at = NULL WHERE id = ?').run(reiaUser.id);
    await new Promise((res) => setTimeout(res, 1100));
    expect((await patch(reiaAdmin, reiaUser.id, { role: 'FINANCE_USER' })).status).toBe(403);
    expect((await patch(admin, reiaUser.id, { role: 'FINANCE_USER' })).status).toBe(200);
    expect(row(reiaUser.id).role).toBe('FINANCE_USER');
    expect((await request(app).get('/api/sjvn-desk').set(auth(token))).status).toBe(401);
    expect((await get(admin, '/history')).body[0]).toMatchObject({ what: 'Role changed', member_name: 'Ravi REIA', detail: 'REIA Desk → Finance', by: 'Anil Admin' });
    expect((await patch(admin, admin.id, { role: 'MANAGEMENT' })).status).toBe(403);
    expect((await patch(admin, admin.id, { designation: 'GM (IT)' })).status).toBe(200);
  });
});

describe('switching off and resetting', () => {
  it('needs a reason, ends access at once, and never leaves the platform without an administrator', async () => {
    expect((await post(admin, `/${admin.id}/deactivate`, { reason: 'x' })).body.error).toMatch(/your own account/);
    expect((await post(admin, `/${it1.id}/deactivate`, { reason: 'x' })).status).toBe(403);
    expect((await post(admin, `/${finance.id}/deactivate`, {})).body.error).toMatch(/Say why/);
    expect((await post(reiaAdmin, `/${finance.id}/deactivate`, { reason: 'x' })).status).toBe(404);

    const token = signToken(finance);
    expect((await post(admin, `/${finance.id}/deactivate`, { reason: 'Transferred to another station' })).status).toBe(200);
    expect(row(finance.id)).toMatchObject({ is_active: 0, deactivation_reason: 'Transferred to another station' });
    expect((await request(app).get('/api/sjvn-desk').set(auth(token))).status).toBe(401);
    expect((await get(admin)).body.health.some((h) => /Every Finance account is switched off/.test(h.text))).toBe(true);
    expect((await post(admin, `/${finance.id}/reactivate`, {})).status).toBe(200);

    // The IT administrator may switch off the SJVN administrator — but not when it would be the last one.
    expect((await post(it1, `/${admin.id}/deactivate`, { reason: 'Left SJVN' })).status).toBe(200);
    const second = makeUser('IT_SUPER_ADMIN', { name: 'Second IT' });
    expect((await post(second, `/${it1.id}/deactivate`, { reason: 'x' })).status).toBe(200);
    const third = makeUser('IT_SUPER_ADMIN', { name: 'Third IT' });
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(third.id);
    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(it1.id);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(second.id);
    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(third.id);
    // it1 and third are active; third switches off it1, leaving itself — allowed. Then nobody can switch off third but third, which is refused as self.
    expect((await post(third, `/${it1.id}/deactivate`, { reason: 'x' })).status).toBe(200);
    expect((await patch(third, third.id, { role: 'MANAGEMENT' })).status).toBe(403);
  });

  it('resets a password for whoever manages the user', async () => {
    expect((await post(reiaAdmin, `/${finance.id}/reset-password`, {})).status).toBe(404);
    expect((await post(admin, `/${admin.id}/reset-password`, {})).body.error).toMatch(/profile menu/);
    const r = await post(reiaAdmin, `/${reiaUser.id}/reset-password`, {});
    expect(r.status).toBe(200);
    expect(row(reiaUser.id).must_change_password).toBe(1);
    expect((await request(app).post('/api/auth/login').send({ email: 'ravi@sjvn.test', password: r.body.temporary_password })).status).toBe(200);
    expect(auditFor(reiaUser.id).map((a) => a.action)).toContain('STAFF_PASSWORD_RESET');
    expect((await get(admin, `/${reiaUser.id}/activity`)).body.some((a) => a.what === 'Signed in')).toBe(true);
    expect((await get(admin, '/export.csv')).text).toMatch(/"Ravi REIA",".*","","","REIA Desk","REIA","Active"/);
  });
});
