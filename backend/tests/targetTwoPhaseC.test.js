import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeContract, makeInvoice, makeEntity, resetReia } from './helpers/reia.js';
import { coverage, alertUncoveredProjects } from '../src/services/projectScope.js';

// Target #2, Phase C: a REIA officer works on ALL projects (the default) or on
// SELECTED ones; other projects' records are refused and kept out of lists;
// every live project keeps a maker, a checker and an approver who can act.

const get = (url, u) => request(app).get(url).set(auth(signToken(u)));
const post = (url, u, body = {}) => request(app).post(url).set(auth(signToken(u))).send(body);
const put = (url, u, body = {}) => request(app).put(url).set(auth(signToken(u))).send(body);
const listOf = (body) => (Array.isArray(body) ? body : body.rows || body.data || body.invoices || body.contracts || []);

let admin, maker, bikaner, omkareshwar, invB, invO;
beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM user_project_assignments').run();
  db.prepare("UPDATE users SET project_scope = 'ALL'").run();
  admin = makeUser('SJVN_ADMIN', { name: 'PC Admin' });
  maker = makeUser('REIA_MAKER', { name: 'PC Maker' });
  bikaner = makeContract({ contract_no: `PPA/PC/BIKANER-${Math.random().toString(36).slice(2, 7)}`, status: 'ACTIVE' });
  omkareshwar = makeContract({ contract_no: `PPA/PC/OMKAR-${Math.random().toString(36).slice(2, 7)}`, status: 'ACTIVE' });
  invB = makeInvoice({ contract_id: bikaner.id, status: 'DRAFT' });
  invO = makeInvoice({ contract_id: omkareshwar.id, status: 'DRAFT' });
});

const select = (u, ids) => put(`/api/project-scope/users/${u.id}`, admin, { scope: 'SELECTED', contract_ids: ids });

describe('ALL is the default and changes nothing', () => {
  it('an unassigned maker sees every project', async () => {
    const ids = listOf((await get('/api/contracts', maker)).body).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([bikaner.id, omkareshwar.id]));
    expect((await get(`/api/contracts/${omkareshwar.id}`, maker)).status).toBe(200);
  });
});

describe('SELECTED projects', () => {
  it('lists only the assigned projects and their invoices', async () => {
    expect((await select(maker, [bikaner.id])).status).toBe(200);
    const contracts = listOf((await get('/api/contracts', maker)).body).map((c) => c.id);
    expect(contracts).toContain(bikaner.id);
    expect(contracts).not.toContain(omkareshwar.id);
    const invoices = listOf((await get('/api/invoices', maker)).body).map((i) => i.id);
    expect(invoices).toContain(invB.id);
    expect(invoices).not.toContain(invO.id);
  });

  it('refuses another project by its id, by a record of it, and by contract_id', async () => {
    await select(maker, [bikaner.id]);
    const byId = await get(`/api/contracts/${omkareshwar.id}`, maker);
    expect(byId.status).toBe(403);
    expect(byId.body.code).toBe('PROJECT_NOT_ASSIGNED');
    expect((await get(`/api/invoices/${invO.id}`, maker)).status).toBe(403);
    expect((await post(`/api/invoices/${invO.id}/submit-for-approval`, maker)).status).toBe(403);
    expect((await get(`/api/energy-data?contract_id=${omkareshwar.id}`, maker)).status).toBe(403);
    expect((await get(`/api/invoices/${invB.id}`, maker)).status).toBe(200);
  });

  it('gives a scoped officer the contract they raise', async () => {
    await select(maker, [bikaner.id]);
    const seller = makeEntity('SELLER');
    const r = await post('/api/contracts', maker, {
      contract_no: `PPA/PC/NEW-${Date.now()}`, contract_type: 'PPA', project_type: 'SOLAR', seller_id: seller.id,
      capacity_mw: 50, tariff_per_unit: 2.5, tenure_start: '2026-11-01', tenure_end: '2051-10-31',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(db.prepare('SELECT COUNT(*) c FROM user_project_assignments WHERE user_id = ? AND contract_id = ? AND revoked_at IS NULL').get(maker.id, r.body.id).c).toBe(1);
    expect((await get(`/api/contracts/${r.body.id}`, maker)).status).toBe(200);
  });

  it('does not touch Finance, Management or the administrators', async () => {
    await select(maker, [bikaner.id]);
    for (const role of ['FINANCE_USER', 'MANAGEMENT', 'SJVN_ADMIN']) {
      expect((await get(`/api/contracts/${omkareshwar.id}`, makeUser(role))).status, role).toBe(200);
    }
  });

  it('keeps the old assignments on record when they are taken away', async () => {
    await select(maker, [bikaner.id, omkareshwar.id]);
    await select(maker, [bikaner.id]);
    const rows = db.prepare('SELECT contract_id, revoked_at FROM user_project_assignments WHERE user_id = ?').all(maker.id);
    expect(rows.find((r) => r.contract_id === omkareshwar.id).revoked_at).toBeTruthy();
    await put(`/api/project-scope/users/${maker.id}`, admin, { scope: 'ALL' });
    expect((await get(`/api/contracts/${omkareshwar.id}`, maker)).status).toBe(200);
  });
});

describe('assigning', () => {
  it('is the administrators\' alone, and checks what it is given', async () => {
    const checker = makeUser('REIA_CHECKER');
    expect((await put(`/api/project-scope/users/${maker.id}`, checker, { scope: 'ALL' })).status).toBe(403);
    expect((await put(`/api/project-scope/users/${maker.id}`, makeUser('REIA_APPROVER'), { scope: 'ALL' })).status).toBe(403);
    expect((await select(maker, [])).body.error).toMatch(/at least one project/);
    expect((await select(maker, ['CON-NOPE'])).body.error).toMatch(/Not a live REIA project/);
    expect((await put(`/api/project-scope/users/${makeUser('FINANCE_USER').id}`, admin, { scope: 'ALL' })).status).toBe(404);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'PROJECT_SCOPE_CHANGED'").get().c).toBe(0);
    await select(maker, [bikaner.id]);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'PROJECT_SCOPE_CHANGED' AND entity_id = ?").get(maker.id).c).toBe(1);
  });

  it('tells the officer their own projects', async () => {
    await select(maker, [bikaner.id]);
    const me = (await get('/api/project-scope/me', maker)).body;
    expect(me).toMatchObject({ scope: 'SELECTED' });
    expect(me.projects.map((p) => p.id)).toEqual([bikaner.id]);
  });
});

describe('coverage — no project left with nobody to act', () => {
  const tiersFor = (contractId) => coverage().projects.find((p) => p.id === contractId);

  beforeEach(() => {
    // One officer per tier, so a single assignment decides cover.
    db.prepare("UPDATE users SET is_active = 0 WHERE role IN ('REIA_MAKER','REIA_CHECKER','REIA_APPROVER','MANAGEMENT') AND id <> ?").run(maker.id);
  });

  it('is full while everyone is on ALL', () => {
    makeUser('REIA_CHECKER'); makeUser('REIA_APPROVER');
    expect(tiersFor(omkareshwar.id).covered).toBe(true);
  });

  it('names the tier a project lost, says so when the change is made, and alerts the administrators', async () => {
    makeUser('REIA_CHECKER'); makeUser('REIA_APPROVER');
    const r = await select(maker, [bikaner.id]);
    expect(r.body.newly_uncovered.find((p) => p.id === omkareshwar.id).missing).toEqual(['maker']);
    expect(tiersFor(omkareshwar.id).missing).toEqual(['maker']);
    expect(tiersFor(bikaner.id).covered).toBe(true);

    db.prepare("DELETE FROM notifications WHERE type = 'PROJECT_COVERAGE'").run();
    expect(alertUncoveredProjects()).toBeGreaterThan(0);
    const roles = db.prepare("SELECT role FROM notifications WHERE type = 'PROJECT_COVERAGE'").all().map((n) => n.role);
    expect(roles).toEqual(expect.arrayContaining(['SJVN_ADMIN', 'IT_SUPER_ADMIN']));
    expect(alertUncoveredProjects(), 'the same alert twice in a day').toBe(0);

    await select(maker, [bikaner.id, omkareshwar.id]);
    expect(tiersFor(omkareshwar.id).covered).toBe(true);
  });

  it('counts Management as an approver on every project', () => {
    makeUser('REIA_CHECKER'); makeUser('MANAGEMENT');
    expect(tiersFor(bikaner.id).who.approver.map((u) => u.role)).toEqual(['MANAGEMENT']);
    expect(tiersFor(bikaner.id).covered).toBe(true);
  });

  it('leaves out hydro and thermal stations, which are not REIA projects', () => {
    const station = db.prepare("SELECT id FROM contracts WHERE project_type IN ('Hydro','Thermal') LIMIT 1").get();
    if (station) expect(coverage().projects.some((p) => p.id === station.id)).toBe(false);
  });
});
