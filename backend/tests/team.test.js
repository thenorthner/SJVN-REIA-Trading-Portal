import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, resetReia, auditFor } from './helpers/reia.js';

// A company's own users: who may add, re-level, reset and switch off whom, and
// that switching someone off actually ends what they can do.

let alpha, beta, admin, approver, checker, maker, outsider;
const as = (u) => auth(signToken(u));
const get = (u, p = '') => request(app).get(`/api/team${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/team${p}`).set(as(u)).send(body);
const patch = (u, id, body) => request(app).patch(`/api/team/${id}`).set(as(u)).send(body);
const row = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

beforeEach(() => {
  resetReia();
  db.prepare(`DELETE FROM users WHERE email LIKE '%@test.in' OR email LIKE '%@alpha.in'`).run();
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  admin = makeUser('SELLER', { name: 'Asha Admin', linked_entity_id: alpha.id });
  approver = makeUser('SELLER_L3', { name: 'Arjun Approver', linked_entity_id: alpha.id });
  checker = makeUser('SELLER_L2', { name: 'Chitra Checker', linked_entity_id: alpha.id });
  maker = makeUser('SELLER_L1', { name: 'Mohan Maker', email: 'mohan@alpha.in', linked_entity_id: alpha.id });
  outsider = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: beta.id });
});

describe('the team', () => {
  it('lists the company\'s own people with what the caller may do to each', async () => {
    const t = (await get(admin)).body;
    expect(t.members.map((m) => m.name)).toEqual(['Asha Admin', 'Arjun Approver', 'Chitra Checker', 'Mohan Maker']);
    expect(t.totals).toMatchObject({ active: 4, makers: 1, checkers: 1, approvers: 1, never_signed_in: 4 });
    expect(t.can_manage).toBe(true);
    expect(t.assignable_roles.map((r) => r.value)).toEqual(['SELLER_L3', 'SELLER_L2', 'SELLER_L1']);
    const me = t.members.find((m) => m.is_me);
    expect(me).toMatchObject({ is_owner: true, can: { edit: true, role: false, deactivate: false, reset_password: false } });
    expect(t.members.find((m) => m.id === maker.id).can).toMatchObject({ edit: true, role: true, deactivate: true, reset_password: true });

    // An approver manages makers and checkers, not other approvers or the admin.
    const a = (await get(approver)).body;
    expect(a.assignable_roles.map((r) => r.value)).toEqual(['SELLER_L2', 'SELLER_L1']);
    expect(a.members.find((m) => m.id === admin.id).can.deactivate).toBe(false);
    // A maker sees the team and manages nobody.
    const m = (await get(maker)).body;
    expect(m.can_manage).toBe(false);
    expect(m.members.every((x) => !x.can.deactivate)).toBe(true);
    expect((await get(outsider)).body.members.map((x) => x.name)).toEqual(['Bina Beta']);
  });

  it('says when maker-checker cannot work', async () => {
    db.prepare('UPDATE users SET is_active = 0 WHERE id IN (?, ?)').run(checker.id, approver.id);
    expect((await get(admin)).body.health[0].text).toMatch(/maker but no checker/);
    expect((await get(outsider)).body.health[0].text).toMatch(/Only the Company Admin/);
  });
});

describe('adding a member', () => {
  it('issues a one-time password the member must change, and holds to the rules', async () => {
    expect((await post(maker, '', { name: 'X Y', email: 'x@alpha.in', role: 'SELLER_L1' })).status).toBe(403);
    expect((await post(admin, '', { name: 'X Y', email: 'not-an-email', role: 'SELLER_L1' })).body.error).toMatch(/valid email/);
    expect((await post(admin, '', { name: 'X Y', email: 'x@alpha.in', role: 'BUYER_L1' })).body.error).toMatch(/access level/);
    expect((await post(admin, '', { name: 'X Y', email: 'x@alpha.in', role: 'SELLER' })).body.error).toMatch(/access level/);
    expect((await post(approver, '', { name: 'X Y', email: 'x@alpha.in', role: 'SELLER_L3' })).status).toBe(403);
    expect((await post(admin, '', { name: 'X Y', email: 'x@alpha.in', role: 'SELLER_L1', password: 'short' })).body.error).toMatch(/at least 8/);
    expect((await post(admin, '', { name: 'X Y', email: maker.email, role: 'SELLER_L1' })).status).toBe(409);

    const r = await post(admin, '', { name: 'Neha New', email: 'Neha@Alpha.in', role: 'SELLER_L2', phone: '+91 98765 43210', designation: 'Accounts Officer' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.generated).toBe(true);
    expect(r.body.temporary_password).toMatch(/^[A-Za-z]{4}-\d{4}-[A-Za-z]{4}$/);
    const made = row(r.body.id);
    expect(made).toMatchObject({ email: 'neha@alpha.in', role: 'SELLER_L2', linked_entity_id: alpha.id, must_change_password: 1, created_by: admin.id, designation: 'Accounts Officer' });
    expect(bcrypt.compareSync(r.body.temporary_password, made.password_hash)).toBe(true);
    expect(auditFor(made.id)[0].action).toBe('TEAM_MEMBER_ADDED');

    // The new member signs in, is told to change the password, and the flag clears when they do.
    const login = await request(app).post('/api/auth/login').send({ email: 'neha@alpha.in', password: r.body.temporary_password });
    expect(login.body.user.must_change_password).toBe(true);
    const changed = await request(app).post('/api/auth/change-password').set(auth(login.body.token)).send({ current_password: r.body.temporary_password, new_password: 'MyOwn-pass-77' });
    expect(changed.status).toBe(200);
    expect(row(made.id).must_change_password).toBe(0);
    expect((await get(admin)).body.members.find((m) => m.id === made.id)).toMatchObject({ never_signed_in: false, logins_30d: 1, created_by_name: 'Asha Admin' });
  });

  it('stops at the seat limit', async () => {
    const { invalidateParamCache } = await import('../src/mastersService.js');
    db.prepare(`UPDATE system_parameters SET param_value = '4' WHERE param_key = 'counterparty_max_team_members'`).run();
    invalidateParamCache();
    const r = await post(admin, '', { name: 'One More', email: 'more@alpha.in', role: 'SELLER_L1' });
    expect(r.body.error).toMatch(/most allowed \(4\)/);
    db.prepare(`UPDATE system_parameters SET param_value = '15' WHERE param_key = 'counterparty_max_team_members'`).run();
    invalidateParamCache();
  });
});

describe('changing a member', () => {
  it('lets a member fix their own details but not their own level, and ends sessions on a change of level', async () => {
    expect((await patch(maker, maker.id, { phone: '9876543210', designation: 'Billing Executive' })).status).toBe(200);
    expect(row(maker.id)).toMatchObject({ phone: '9876543210', designation: 'Billing Executive' });
    expect((await patch(maker, maker.id, { role: 'SELLER_L2' })).status).toBe(403);
    expect((await patch(maker, checker.id, { name: 'Someone Else' })).status).toBe(403);
    expect((await patch(admin, maker.id, { phone: 'abc' })).body.error).toMatch(/valid phone/);
    expect((await patch(admin, maker.id, {})).body.error).toMatch(/Nothing was changed/);
    expect((await patch(approver, checker.id, { role: 'SELLER_L3' })).status).toBe(403);
    expect((await patch(outsider, maker.id, { name: 'Hijack' })).status).toBe(404);

    const makerToken = signToken(maker);
    expect((await request(app).get('/api/team').set(auth(makerToken))).status).toBe(200);
    db.prepare('UPDATE users SET sessions_revoked_at = NULL WHERE id = ?').run(maker.id);
    await new Promise((r) => setTimeout(r, 1100));
    const up = await patch(admin, maker.id, { role: 'SELLER_L2' });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(row(maker.id).role).toBe('SELLER_L2');
    // The old token still says maker; it is refused, and a fresh sign-in carries the new level.
    const stale = await request(app).get('/api/team').set(auth(makerToken));
    expect(stale.status).toBe(401);
    expect(stale.body.error).toMatch(/sign in again/);
    expect(auditFor(maker.id)[0]).toMatchObject({ action: 'TEAM_ROLE_CHANGED' });
    const hist = (await get(admin, '/history')).body;
    expect(hist[0]).toMatchObject({ what: 'Access level changed', member_name: 'Mohan Maker', by: 'Asha Admin', detail: 'Level 1 — Maker → Level 2 — Checker' });
  });
});

describe('switching an account off', () => {
  it('needs a reason, spares the admin and oneself, and ends the member\'s access at once', async () => {
    expect((await post(admin, `/${admin.id}/deactivate`, { reason: 'x' })).body.error).toMatch(/your own account/);
    expect((await post(approver, `/${admin.id}/deactivate`, { reason: 'x' })).body.error).toMatch(/Company Admin account/);
    expect((await post(approver, `/${approver.id}/deactivate`, { reason: 'x' })).status).toBe(400);
    expect((await post(maker, `/${checker.id}/deactivate`, { reason: 'x' })).status).toBe(403);
    expect((await post(admin, `/${maker.id}/deactivate`, {})).body.error).toMatch(/Say why/);

    const token = signToken(maker);
    const off = await post(admin, `/${maker.id}/deactivate`, { reason: 'Left the company' });
    expect(off.status).toBe(200);
    expect(off.body.members.find((m) => m.id === maker.id)).toMatchObject({ is_active: false, deactivation_reason: 'Left the company', deactivated_by_name: 'Asha Admin', can: { reactivate: true, deactivate: false } });
    expect(off.body.totals).toMatchObject({ active: 3, inactive: 1, makers: 0 });
    const refused = await request(app).get('/api/team').set(auth(token));
    expect(refused.status).toBe(401);
    expect(refused.body.error).toMatch(/deactivated/);

    expect((await post(admin, `/${maker.id}/reset-password`, {})).body.error).toMatch(/Switch the account on/);
    expect((await post(admin, `/${maker.id}/reactivate`, {})).status).toBe(200);
    expect(row(maker.id)).toMatchObject({ is_active: 1, deactivation_reason: null });
  });

  it('holds the same line on the older status route', async () => {
    const put = (u, id, v) => request(app).put(`/api/users/${id}/status`).set(as(u)).send({ is_active: v });
    expect((await put(admin, admin.id, 0)).status).toBe(400);
    expect((await put(approver, admin.id, 0)).status).toBe(400);
    expect((await put(admin, maker.id, 0)).status).toBe(200);
    expect((await request(app).get('/api/team').set(as(maker))).status).toBe(401);
  });
});

describe('a forgotten password', () => {
  it('is reset by whoever manages the member, never by the member\'s peers', async () => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync('Old-pass-11', 4), maker.id);
    expect((await post(checker, `/${maker.id}/reset-password`, {})).status).toBe(403);
    expect((await post(admin, `/${admin.id}/reset-password`, {})).body.error).toMatch(/profile menu/);
    expect((await post(approver, `/${admin.id}/reset-password`, {})).status).toBe(403);
    const r = await post(approver, `/${maker.id}/reset-password`, {});
    expect(r.status).toBe(200);
    expect(row(maker.id).must_change_password).toBe(1);
    expect((await request(app).post('/api/auth/login').send({ email: maker.email, password: 'Old-pass-11' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: maker.email, password: r.body.temporary_password })).status).toBe(200);
    expect(auditFor(maker.id).map((a) => a.action)).toContain('TEAM_PASSWORD_RESET');
  });
});

describe('activity and export', () => {
  it('shows a member\'s activity to those who manage the team, and the team as a sheet', async () => {
    await patch(maker, maker.id, { designation: 'Clerk' });
    const act = await get(admin, `/${maker.id}/activity`);
    expect(act.body[0]).toMatchObject({ what: 'Details corrected', module: 'TEAM' });
    expect((await get(checker, `/${maker.id}/activity`)).status).toBe(403);
    expect((await get(maker, `/${maker.id}/activity`)).status).toBe(200);
    const csv = await get(admin, '/export.csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toMatch(/"Mohan Maker",".*","","Clerk","Level 1 — Maker","Active"/);
  });
});

describe('SJVN\'s own admins', () => {
  it('open any company\'s team and can get its admin back in, which nobody inside the company can', async () => {
    const sjvn = makeUser('SJVN_ADMIN', { name: 'Sara SJVN' });
    const desk = makeUser('REIA_USER', { name: 'Riya REIA' });
    expect((await get(sjvn)).body.error).toMatch(/which company/);
    expect((await get(desk, `?entity_id=${alpha.id}`)).status).toBe(403);
    const list = await get(sjvn, '/companies');
    expect(list.body.find((c) => c.id === alpha.id)).toMatchObject({ name: 'Alpha Solar', active_users: 4 });
    expect((await get(desk, '/companies')).status).toBe(403);

    const t = (await get(sjvn, `?entity_id=${alpha.id}`)).body;
    expect(t.members).toHaveLength(4);
    const owner = t.members.find((m) => m.id === admin.id);
    expect(owner.can).toMatchObject({ edit: true, role: false, reset_password: true, deactivate: true });
    expect(t.assignable_roles.map((r) => r.value)).toEqual(['SELLER_L3', 'SELLER_L2', 'SELLER_L1']);

    const reset = await post(sjvn, `/${admin.id}/reset-password?entity_id=${alpha.id}`, {});
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(row(admin.id).must_change_password).toBe(1);
    expect((await patch(sjvn, `${admin.id}?entity_id=${alpha.id}`, { role: 'SELLER_L2' })).body.error).toMatch(/keeps its level/);
    const off = await post(sjvn, `/${admin.id}/deactivate?entity_id=${alpha.id}`, { reason: 'Signatory has left the company' });
    expect(off.status).toBe(200);
    expect(row(admin.id).is_active).toBe(0);
    // A member of another company is not reachable through this one's team.
    expect((await post(sjvn, `/${outsider.id}/reset-password?entity_id=${alpha.id}`, {})).status).toBe(404);
  });
});
