import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { makeUser, auth } from './helpers/reia.js';
import {
  POWERS, ROLE_BASES, routesOf, defaultHolding, holding, forgetOverrides, forgetCustomRoles, newRoleProblems, needsOf,
} from '../src/services/rolePowers.js';

// Roles an administrator makes on Role Powers: a name, the role it works like,
// and a combination of powers held to the platform's rules. Once made it is a
// role like any other — assignable, enforced on the API, and on the record.

let admin, it1, auditor, checker;
const as = (u) => auth(signToken(u));
const make = (u, body) => request(app).post('/api/role-powers/roles').set(as(u)).send(body);
const check = (u, body) => request(app).post('/api/role-powers/roles/check').set(as(u)).send(body);
const call = (u, method, path) => request(app)[method.toLowerCase()](path.replace(/:[A-Za-z]+/g, 'X')).set(as(u)).send({});
const refusedByRole = (res) => res.status === 403 && (res.body?.code === 'POWER_WITHDRAWN' || /not authori[sz]ed/i.test(res.body?.error || ''));
const REASON = 'Office order 31/2026: a bill checker for the solar portfolio';
const shown = POWERS.map((p) => p.key);
/** What a base role holds now, as the matrix would tick it. */
const ticksOf = (base) => shown.filter((k) => holding(k, base) !== 'none');
const officer = (code) => makeUser(code, { name: `Officer of ${code}` });

const clear = () => {
  // Officers given a made role by an earlier test would otherwise still hold its code.
  db.prepare("UPDATE users SET is_active = 0 WHERE role GLOB 'CUSTOM_*'").run();
  db.prepare('DELETE FROM role_power_overrides').run();
  db.prepare('DELETE FROM custom_roles').run();
  forgetOverrides();
  forgetCustomRoles();
};

beforeEach(() => {
  clear();
  admin = makeUser('SJVN_ADMIN', { name: 'Anil Admin' });
  it1 = makeUser('IT_SUPER_ADMIN', { name: 'Isha IT' });
  auditor = makeUser('COMPLIANCE_AUDITOR', { name: 'Ravi Audit' });
  checker = makeUser('REIA_CHECKER', { name: 'Meera Checker' });
});

// A bill checker: works like the REIA Checker, but checks bills alone.
const BILL_CHECKER = () => ({
  label: 'Solar Bill Checker', description: 'Approves the first level of solar bills and nothing else on the desk.',
  base: 'REIA_CHECKER', powers: ['reia.view', 'reia.invoice.check'], reason: REASON, reference: 'OO-31/2026',
});

describe('making a role', () => {
  it('makes it from a base and a combination of powers, on the record', async () => {
    const r = await make(admin, BILL_CHECKER());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.code).toBe('CUSTOM_SOLAR_BILL_CHECKER');
    const col = r.body.roles.find((x) => x.role === r.body.code);
    expect(col).toMatchObject({ label: 'Solar Bill Checker', custom: true, base: 'REIA_CHECKER', users: 0, made_by: 'Anil Admin' });
    // It holds what it was made with; what the checker has beyond that is taken.
    const cell = (key) => r.body.powers.find((p) => p.key === key).cells[r.body.code];
    expect(cell('reia.invoice.check')).toMatchObject({ state: 'all', changed: false });
    expect(cell('reia.energy.check')).toMatchObject({ state: 'none', changed: true });
    const log = db.prepare("SELECT * FROM audit_logs WHERE action = 'ROLE_CREATED' ORDER BY rowid DESC LIMIT 1").get();
    expect(log).toMatchObject({ module: 'ROLE_POWERS', entity_id: 'CUSTOM_SOLAR_BILL_CHECKER', reason: REASON, user_name: 'Anil Admin' });
    expect(JSON.parse(log.after_value)).toMatchObject({ base: 'REIA_CHECKER', powers: ['reia.view', 'reia.invoice.check'] });
    expect(db.prepare("SELECT COUNT(*) n FROM notifications WHERE role = 'IT_SUPER_ADMIN' AND message LIKE '%Solar Bill Checker%'").get().n).toBe(1);
    const h = (await request(app).get('/api/role-powers/history').set(as(admin))).body;
    expect(h[0]).toMatchObject({ what: 'Role made', role: 'CUSTOM_SOLAR_BILL_CHECKER', reference: 'OO-31/2026' });
  });

  it('checks a combination without saving it', async () => {
    const r = await check(admin, { base: 'REIA_CHECKER', powers: ['reia.view', 'reia.invoice.check', 'reia.invoice.prepare'] });
    expect(r.status).toBe(200);
    expect(r.body.problems.map((p) => p.power)).toContain('reia.invoice.prepare');
    expect(db.prepare('SELECT COUNT(*) n FROM custom_roles').get().n).toBe(0);
  });

  it('keeps the platform\'s rules for every power beyond the base', async () => {
    const refused = async (body, re) => {
      const r = await make(admin, { ...BILL_CHECKER(), ...body });
      expect(r.status, JSON.stringify(body)).toBe(409);
      expect(r.body.error).toMatch(re);
    };
    // A checker-like role does not also prepare.
    await refused({ powers: ['reia.view', 'reia.invoice.check', 'reia.invoice.prepare'] }, /apart/);
    // Taking the checker's side away does not let a checker-like role prepare: its unlisted work is the checker's.
    await refused({ powers: ['reia.view', 'reia.invoice.prepare'] }, /works like REIA Checker/);
    // Governance stays with the administrators.
    await refused({ powers: ['reia.view', 'admin.masters'] }, /Governance/);
    // An auditor-like role reads; a management-like role does not enter data.
    await refused({ base: 'COMPLIANCE_AUDITOR', powers: ['audit.trail', 'reia.invoice.check'] }, /changes nothing/);
    await refused({ base: 'MANAGEMENT', powers: ['reia.view', 'reia.energy.prepare'] }, /does not enter data/);
    // A power is not given without the one its screens need.
    const financeTicks = ticksOf('FINANCE_USER').filter((k) => !['reia.view', 'reia.notes.prepare', 'reia.notes.check'].includes(k));
    await refused({ base: 'FINANCE_USER', powers: [...financeTicks, 'reia.invoice.check'] }, /needs "See the REIA desk"/);
    // Nothing at all is not a role.
    await refused({ powers: [] }, /at least one power/);
    expect(db.prepare('SELECT COUNT(*) n FROM custom_roles').get().n).toBe(0);
  });

  it('wants a proper name, purpose, base and reason', async () => {
    expect((await make(admin, { ...BILL_CHECKER(), label: 'X' })).status).toBe(400);
    expect((await make(admin, { ...BILL_CHECKER(), label: 'REIA Checker' })).status).toBe(409);
    expect((await make(admin, { ...BILL_CHECKER(), description: 'checks' })).status).toBe(400);
    expect((await make(admin, { ...BILL_CHECKER(), base: 'SJVN_ADMIN' })).status).toBe(400);
    expect((await make(admin, { ...BILL_CHECKER(), reason: 'because' })).status).toBe(400);
    expect((await make(admin, BILL_CHECKER())).status).toBe(200);
    expect((await make(admin, { ...BILL_CHECKER(), label: 'solar bill checker' })).status).toBe(409);
  });

  it('is for the administrators alone', async () => {
    expect((await make(auditor, BILL_CHECKER())).status).toBe(403);
    expect((await make(checker, BILL_CHECKER())).status).toBe(403);
    expect((await make(it1, BILL_CHECKER())).status).toBe(200);
  });
});

describe('a made role at work', () => {
  it('is given to an officer on SJVN Users and signs in as itself', async () => {
    const { code } = (await make(admin, BILL_CHECKER())).body;
    const team = (await request(app).get('/api/staff').set(as(admin))).body;
    expect(team.assignable_roles.find((r) => r.value === code)).toMatchObject({ label: 'Solar Bill Checker', desk: 'Roles made here' });
    const added = await request(app).post('/api/staff').set(as(admin)).send({ name: 'Sunita Rao', email: 'sunita.rao@sjvn.in', role: code });
    expect(added.status, JSON.stringify(added.body)).toBe(200);
    const sunita = db.prepare('SELECT * FROM users WHERE id = ?').get(added.body.id);
    const me = (await request(app).get('/api/auth/me').set(as(sunita))).body.user;
    expect(me).toMatchObject({ role: 'REIA_CHECKER', role_held: code, role_label: 'Solar Bill Checker', custom_role: code });
    expect(me.pages.find((p) => p.pages.includes('/reia/**'))).toMatchObject({ held: true });
  });

  it('does what it holds and nothing it was not given', async () => {
    const { code } = (await make(admin, BILL_CHECKER())).body;
    const sunita = officer(code);
    expect(refusedByRole(await call(sunita, 'POST', '/api/invoices/:id/approve-l2'))).toBe(false);
    expect(refusedByRole(await call(sunita, 'GET', '/api/invoices/'))).toBe(false);
    // The checker validates energy data; this role was made without it.
    const r = await call(sunita, 'POST', '/api/energy-data/:id/validate');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('POWER_WITHDRAWN');
    // A refusal is recorded against the role held, not the one it works like.
    expect(db.prepare("SELECT user_role FROM audit_logs WHERE action = 'ACCESS_DENIED' ORDER BY rowid DESC LIMIT 1").get().user_role).toBe(code);
  });

  it('runs a power beyond its base as the power\'s owner', async () => {
    // Finance, plus the first-level approval of bills — Finance's own notes left out, so it does not prepare and check.
    const ticks = ticksOf('FINANCE_USER').filter((k) => !['reia.notes.prepare', 'reia.notes.check'].includes(k));
    const r = await make(admin, {
      label: 'Finance Bill Approver', description: 'Finance officer who also approves bills at the first level.',
      base: 'FINANCE_USER', powers: [...ticks, 'reia.invoice.check'], reason: REASON,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const vikas = officer(r.body.code);
    expect(refusedByRole(await call(vikas, 'POST', '/api/invoices/:id/approve-l2'))).toBe(false);
    expect(refusedByRole(await call(vikas, 'POST', '/api/invoices/:id/payments'))).toBe(false);
    expect(refusedByRole(await call(vikas, 'POST', '/api/notes/:id/approve'))).toBe(true);
    const me = (await request(app).get('/api/auth/me').set(as(vikas))).body.user;
    const screen = me.screens.find((s) => s.power === 'reia.invoice.check');
    expect(screen).toMatchObject({ role: 'REIA_CHECKER', pages: expect.arrayContaining(['/reia/invoices']) });
    // The notes it was not given are not counted among its own screens.
    expect(screen.except).not.toContain('/reia/note-approvals');
    expect(screen.except).toContain('/reia/payment-monitoring');
  });

  it('reads what is sent to it and to the role it works like', async () => {
    const { code } = (await make(admin, BILL_CHECKER())).body;
    const sunita = officer(code);
    db.prepare("INSERT INTO notifications (id, role, type, message) VALUES ('N-MADE', ?, 'T', 'to the made role')").run(code);
    db.prepare("INSERT INTO notifications (id, role, type, message) VALUES ('N-BASE', 'REIA_CHECKER', 'T', 'to the checkers')").run();
    const ids = (await request(app).get('/api/notifications').set(as(sunita))).body.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['N-MADE', 'N-BASE']));
  });

  it('has its cells changed like any role\'s, within the same rules', async () => {
    const { code } = (await make(admin, BILL_CHECKER())).body;
    const change = (body) => request(app).post('/api/role-powers/change').set(as(admin)).send({ role: code, reason: REASON, ...body });
    expect((await change({ power: 'reia.notes.check', give: true })).status).toBe(200);
    expect(holding('reia.notes.check', code)).toBe('all');
    const r = await change({ power: 'reia.notes.prepare', give: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/apart/);
  });
});

describe('renaming and retiring', () => {
  it('renames on the record and keeps names apart', async () => {
    const { code } = (await make(admin, BILL_CHECKER())).body;
    const patch = (body) => request(app).patch(`/api/role-powers/roles/${code}`).set(as(admin)).send({ description: BILL_CHECKER().description, reason: REASON, ...body });
    expect((await patch({ label: 'REIA Maker' })).status).toBe(409);
    expect((await patch({ label: 'Solar Bill Checker' })).status).toBe(400);
    expect((await patch({ label: 'Solar and Wind Bill Checker' })).status).toBe(200);
    expect(db.prepare("SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1").get(code).action).toBe('ROLE_UPDATED');
  });

  it('retires a role only once nobody holds it, and keeps its record', async () => {
    const { code } = (await make(admin, BILL_CHECKER())).body;
    const sunita = officer(code);
    const retire = () => request(app).post(`/api/role-powers/roles/${code}/retire`).set(as(admin)).send({ reason: 'The solar portfolio moved to the REIA checkers' });
    const busy = await retire();
    expect(busy.status).toBe(409);
    expect(busy.body.error).toMatch(/1 active officer holds this role/);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(sunita.id);
    const done = await retire();
    expect(done.status).toBe(200);
    expect(done.body.roles.some((r) => r.role === code)).toBe(false);
    // Nobody is given it again, and its old holder is not switched back on with it.
    expect((await request(app).post('/api/staff').set(as(admin)).send({ name: 'Nikhil', email: 'nikhil@sjvn.in', role: code })).status).toBe(400);
    expect((await request(app).post(`/api/staff/${sunita.id}/reactivate`).set(as(admin))).status).toBe(400);
    // …but can be moved to another role, and switched on in that.
    expect((await request(app).patch(`/api/staff/${sunita.id}`).set(as(admin)).send({ role: 'REIA_CHECKER' })).status).toBe(200);
    expect((await request(app).post(`/api/staff/${sunita.id}/reactivate`).set(as(admin))).status).toBe(200);
    const h = (await request(app).get('/api/role-powers/history').set(as(admin))).body;
    expect(h.map((x) => x.what)).toEqual(expect.arrayContaining(['Role retired', 'Role made']));
  });
});

// For every power a made role may be given, from some base that lacks it: the
// officer gets through each of its actions; made without a power its base
// holds, the officer is refused each of them. Sampled to four routes a power;
// ROLE_POWERS_FULL=1 calls every route.
const OUTSIDE = /\/(rea-trigger|rea-scan|sap-push|sap-check|sap\/health)$/;
const sample = (all) => {
  const routes = all.filter((r) => !OUTSIDE.test(r.path));
  return process.env.ROLE_POWERS_FULL ? routes : [...new Set([routes[0], routes[routes.length - 1], routes[Math.floor(routes.length / 2)], routes[1]].filter(Boolean))];
};

describe('every combination holds on the API', () => {
  for (const p of POWERS.filter((x) => !x.desk && x.kind !== 'governance' && !x.holders)) {
    it(`${p.key}: given beyond a base, or left out of one`, async () => {
      const wrong = [];
      const tried = [];
      let n = 0;
      for (const base of ROLE_BASES) {
        const before = defaultHolding(p.key, base);
        if (before === 'some') continue;
        const ticks = ticksOf(base);
        const keys = before === 'none' ? [...new Set([...ticks, p.key, ...needsOf(p)])] : ticks.filter((k) => k !== p.key);
        if (newRoleProblems({ base, keys, shown }).length) continue;
        const r = await make(admin, { label: `Sweep ${p.key.replace(/\W/g, ' ')} ${n += 1}`, description: 'A role made by the sweep test.', base, powers: keys, reason: REASON });
        if (r.status !== 200) { wrong.push(`${base}: not made — ${r.body.error}`); continue; }
        const u = officer(r.body.code);
        const given = before === 'none';
        tried.push(`${given ? '+' : '-'}${base}`);
        for (const route of sample(routesOf(p.key))) {
          const res = await call(u, route.method, route.path);
          if (refusedByRole(res) === given) wrong.push(`${given ? 'given beyond' : 'left out of'} ${base}: ${route.method} ${route.path} → ${res.status} ${res.body?.error || ''}`);
        }
      }
      expect(wrong).toEqual([]);
      if (process.env.SWEEP_REPORT) console.log(`[sweep] ${p.key}: ${tried.join(' ') || 'no base can be given or lose it'}`);
    });
  }
});
