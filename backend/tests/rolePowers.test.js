import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { makeUser, auth } from './helpers/reia.js';
import {
  POWERS, POWER_ROLES, routesOf, unmatchedSelectors, defaultHolding, changeBlock, applyChange, forgetOverrides,
} from '../src/services/rolePowers.js';

// Role powers: the matrix reads who holds what from the routes' own gates, an
// administrator's change is enforced on the API at once, the platform's rules
// bound what may be changed, and every change is on the record.

let it1, admin, auditor, maker, checker, approver, finance, trader;
const as = (u) => auth(signToken(u));
const matrix = (u) => request(app).get('/api/role-powers').set(as(u));
const change = (u, body) => request(app).post('/api/role-powers/change').set(as(u)).send(body);
const reset = (u, body) => request(app).post('/api/role-powers/reset').set(as(u)).send(body);
const REASON = 'Office order 12/2026: Finance stops reading the REIA desk';
const holders = (key) => POWER_ROLES.filter((r) => defaultHolding(key, r) === 'all');
const clear = () => { db.prepare('DELETE FROM role_power_overrides').run(); forgetOverrides(); };
const call = (u, method, path) => request(app)[method.toLowerCase()](path.replace(/:[A-Za-z]+/g, 'X')).set(as(u)).send({});

beforeEach(() => {
  clear();
  it1 = makeUser('IT_SUPER_ADMIN', { name: 'Isha IT' });
  admin = makeUser('SJVN_ADMIN', { name: 'Anil Admin' });
  auditor = makeUser('COMPLIANCE_AUDITOR', { name: 'Ravi Audit' });
  maker = makeUser('REIA_MAKER', { name: 'Rahul Maker' });
  checker = makeUser('REIA_CHECKER', { name: 'Meera Checker' });
  approver = makeUser('REIA_APPROVER', { name: 'Vikram HOD' });
  finance = makeUser('FINANCE_USER', { name: 'Vikas Finance' });
  trader = makeUser('TRADING_USER', { name: 'Shreya Trader' });
});

describe('the catalogue', () => {
  it('names only routes that exist', () => {
    expect(unmatchedSelectors()).toEqual([]);
    for (const p of POWERS) expect(routesOf(p.key).length, p.key).toBeGreaterThan(0);
  });

  it('puts no action in two powers', () => {
    const shared = POWERS.flatMap((p) => routesOf(p.key)).filter((r) => r.powers.length > 1).map((r) => `${r.method} ${r.path}: ${r.powers}`);
    expect([...new Set(shared)]).toEqual([]);
  });

  it('reads every power that changes data from a gate, or names who decides', () => {
    const ungated = POWERS.filter((p) => p.kind !== 'view' && !p.holders)
      .flatMap((p) => routesOf(p.key).filter((r) => !r.roles).map((r) => `${p.key}: ${r.method} ${r.path}`));
    expect(ungated).toEqual([]);
  });

  it('reads who holds a power from the code', () => {
    expect(holders('reia.invoice.prepare')).toEqual(['REIA_MAKER']);
    expect(holders('reia.invoice.check')).toEqual(['REIA_CHECKER']);
    expect(holders('reia.disputes.decide').sort()).toEqual(['MANAGEMENT', 'REIA_APPROVER']);
    expect(holders('fin.payments.confirm')).toEqual(['FINANCE_USER']);
    expect(holders('admin.users')).toEqual(['IT_SUPER_ADMIN', 'SJVN_ADMIN']);
    expect(holders('audit.trail').sort()).toEqual(['COMPLIANCE_AUDITOR', 'SJVN_ADMIN']);
  });

  it('leaves no power with nobody to use it', () => {
    expect(POWERS.filter((p) => !holders(p.key).length && !POWER_ROLES.some((r) => defaultHolding(p.key, r) === 'some')).map((p) => p.key)).toEqual([]);
  });
});

describe('the matrix', () => {
  it('is the administrators\' to change and the auditor\'s to read', async () => {
    const m = (await matrix(admin)).body;
    expect(m.can_edit).toBe(true);
    const prep = m.powers.find((p) => p.key === 'reia.invoice.prepare');
    expect(prep.cells.REIA_MAKER).toMatchObject({ state: 'all', default: 'all', changed: false });
    expect(prep.cells.REIA_CHECKER.state).toBe('none');
    // The checker cannot be given the maker's work, and the screen says why.
    expect(prep.cells.REIA_CHECKER.give).toMatchObject({ ok: false });
    expect(prep.cells.REIA_CHECKER.give.why).toMatch(/apart/);
    // Nobody changes their own role, or the IT Super Administrator's.
    expect(m.powers.find((p) => p.key === 'reia.view').cells.SJVN_ADMIN.take.ok).toBe(false);
    expect(m.powers.find((p) => p.key === 'reia.view').cells.IT_SUPER_ADMIN.take.ok).toBe(false);

    const a = await matrix(auditor);
    expect(a.status).toBe(200);
    expect(a.body.can_edit).toBe(false);
    expect((await change(auditor, { power: 'reia.view', role: 'FINANCE_USER', give: false, reason: REASON })).status).toBe(403);
    expect((await matrix(maker)).status).toBe(403);
  });
});

describe('taking a power away', () => {
  it('refuses the role every action of the power at once, says so, and keeps the record', async () => {
    expect((await call(finance, 'GET', '/api/invoices/readiness')).status).toBe(200);
    const r = await change(admin, { power: 'reia.view', role: 'FINANCE_USER', give: false, reason: REASON, reference: 'OO-12/2026' });
    expect(r.status).toBe(200);
    expect(r.body.powers.find((p) => p.key === 'reia.view').cells.FINANCE_USER).toMatchObject({ state: 'none', changed: true, reason: REASON, reference: 'OO-12/2026', by: 'Anil Admin' });

    const refused = await call(finance, 'GET', '/api/invoices/readiness');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('POWER_WITHDRAWN');
    // A list whose handler decides who reads it is refused as well.
    expect((await call(finance, 'GET', '/api/invoices/')).status).toBe(403);
    // Nobody else is touched, and Finance keeps its own powers.
    expect((await call(maker, 'GET', '/api/invoices/readiness')).status).toBe(200);
    expect((await call(finance, 'POST', '/api/advances/:id/apply')).status).not.toBe(403);

    const log = db.prepare("SELECT * FROM audit_logs WHERE module = 'ROLE_POWERS' ORDER BY rowid DESC LIMIT 1").get();
    expect(log).toMatchObject({ action: 'ROLE_POWER_TAKEN', entity_id: 'FINANCE_USER/reia.view', reason: REASON, user_name: 'Anil Admin' });
    expect(JSON.parse(log.before_value)).toEqual({ holding: 'some' });
    expect(JSON.parse(log.after_value)).toEqual({ holding: 'none' });
    expect(db.prepare("SELECT COUNT(*) n FROM notifications WHERE role = 'FINANCE_USER' AND type = 'ROLE_POWERS'").get().n).toBe(1);

    // The portal closes the desk's pages, but not a page Finance's own powers list.
    const me = (await request(app).get('/api/auth/me').set(as(finance))).body.user;
    const entry = (page) => me.pages.filter((p) => p.pages.includes(page));
    expect(entry('/reia/**')).toEqual([{ pages: expect.any(Array), held: false, given: false }]);
    expect(entry('/reia/payment-monitoring').some((p) => p.held)).toBe(true);
    // A role nobody changed keeps its menu as the code has it.
    expect((await request(app).get('/api/auth/me').set(as(maker))).body.user.pages).toBeNull();

    const h = (await request(app).get('/api/role-powers/history').set(as(auditor))).body;
    expect(h[0]).toMatchObject({ what: 'Taken away', power: 'reia.view', role: 'FINANCE_USER', reason: REASON, reference: 'OO-12/2026' });

    // Back to the platform default, on the record too.
    expect((await reset(it1, { power: 'reia.view', role: 'FINANCE_USER', reason: 'Order withdrawn; Finance reads the desk again' })).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM role_power_overrides').get().n).toBe(0);
    expect((await call(finance, 'GET', '/api/invoices/readiness')).status).toBe(200);
  });

  it('needs a reason, and never leaves a power with nobody to use it', async () => {
    expect((await change(admin, { power: 'reia.view', role: 'FINANCE_USER', give: false, reason: 'because' })).status).toBe(400);
    const last = await change(admin, { power: 'reia.invoice.prepare', role: 'REIA_MAKER', give: false, reason: REASON });
    expect(last.status).toBe(409);
    expect(last.body.error).toMatch(/No other role/);
    expect(db.prepare('SELECT COUNT(*) n FROM role_power_overrides').get().n).toBe(0);
  });
});

describe('giving a power', () => {
  it('lets the role through the power\'s gates at once', async () => {
    expect((await call(approver, 'POST', '/api/invoices/:id/release-to-generator')).status).toBe(403);
    expect((await change(admin, { power: 'fin.release', role: 'REIA_APPROVER', give: true, reason: 'HOD releases while Finance is short-staffed' })).status).toBe(200);
    expect((await call(approver, 'POST', '/api/invoices/:id/release-to-generator')).status).not.toBe(403);
    expect(db.prepare("SELECT action FROM audit_logs WHERE module = 'ROLE_POWERS' ORDER BY rowid DESC LIMIT 1").get().action).toBe('ROLE_POWER_GIVEN');
  });

  it('opens the screens that decide by role inside, too', async () => {
    expect((await call(trader, 'GET', '/api/energy-data/')).status).toBe(403);
    expect((await change(admin, { power: 'reia.view', role: 'TRADING_USER', give: true, reason: 'Trading desk reads REIA energy for scheduling' })).status).toBe(200);
    expect((await call(trader, 'GET', '/api/energy-data/')).status).toBe(200);
    expect((await call(trader, 'GET', '/api/payment-security/')).status).toBe(200);
    expect((await call(trader, 'GET', '/api/reconciliation/')).status).toBe(200);
  });

  it('keeps the platform\'s rules', async () => {
    const refused = async (u, body, re) => {
      const r = await change(u, { reason: REASON, ...body });
      expect(r.status, JSON.stringify(body)).toBe(409);
      expect(r.body.error).toMatch(re);
    };
    // Maker, checker and approver stay apart.
    await refused(admin, { power: 'reia.invoice.check', role: 'REIA_MAKER', give: true }, /apart/);
    await refused(admin, { power: 'reia.disputes.decide', role: 'REIA_CHECKER', give: true }, /apart/);
    // The administrators govern and do not transact.
    await refused(it1, { power: 'reia.invoice.prepare', role: 'SJVN_ADMIN', give: true }, /no part in transactions/);
    // The auditor reads and changes nothing; management does not enter data.
    await refused(admin, { power: 'reia.notes.check', role: 'COMPLIANCE_AUDITOR', give: true }, /changes nothing/);
    await refused(admin, { power: 'reia.energy.prepare', role: 'MANAGEMENT', give: true }, /does not enter data/);
    // Governance stays with the administrators.
    await refused(admin, { power: 'admin.masters', role: 'REIA_APPROVER', give: true }, /Governance/);
    // The desk that raises a bill does not confirm it was paid.
    await refused(admin, { power: 'reia.invoice.prepare', role: 'FINANCE_USER', give: true }, /apart|confirm it was paid/);
    // Nobody changes their own role, or a senior one; who changes powers is fixed.
    await refused(admin, { power: 'audit.trail', role: 'SJVN_ADMIN', give: false }, /own role/);
    await refused(admin, { power: 'admin.users', role: 'IT_SUPER_ADMIN', give: false }, /IT Super Administrator/);
    await refused(it1, { power: 'admin.powers', role: 'SJVN_ADMIN', give: false }, /fixed/);
    expect(db.prepare('SELECT COUNT(*) n FROM role_power_overrides').get().n).toBe(0);
  });
});

// Every change the rules allow does what the matrix says. Each route of a power
// is called with an empty body: a refusal by role is the only answer that
// would make the matrix untrue (a 400 or 404 is the handler doing its work).
// Sampled to four routes a power; ROLE_POWERS_FULL=1 calls every route.
// Routes that reach outside the platform (NRPC's site, SAP) are left out: a test does not fetch them.
const OUTSIDE = /\/(rea-trigger|rea-scan|sap-push|sap-check|sap\/health)$/;
const sample = (all) => {
  const routes = all.filter((r) => !OUTSIDE.test(r.path));
  return process.env.ROLE_POWERS_FULL ? routes : [...new Set([routes[0], routes[routes.length - 1], routes[Math.floor(routes.length / 2)], routes[1]].filter(Boolean))];
};
const refusedByRole = (res) => res.status === 403 && (res.body?.code === 'POWER_WITHDRAWN' || /not authori[sz]ed/i.test(res.body?.error || ''));

describe('every allowed change holds on the API', () => {
  for (const p of POWERS.filter((x) => !x.desk)) {
    it(`${p.key}: given or taken away, as the matrix says`, async () => {
      const wrong = [];
      for (const role of POWER_ROLES) {
        const give = !changeBlock('IT_SUPER_ADMIN', p.key, role, true);
        const take = !changeBlock('IT_SUPER_ADMIN', p.key, role, false) && defaultHolding(p.key, role) === 'all';
        if (!give && !take) continue;
        const u = makeUser(role);
        applyChange({ key: p.key, role, give, reason: 'sweep', by: null });
        for (const r of sample(routesOf(p.key))) {
          const res = await call(u, r.method, r.path);
          if (refusedByRole(res) === give) wrong.push(`${give ? 'given to' : 'taken from'} ${role}: ${r.method} ${r.path} → ${res.status}`);
        }
        clear();
      }
      expect(wrong).toEqual([]);
    });
  }
});
