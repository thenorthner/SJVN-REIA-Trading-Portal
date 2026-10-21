import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeContract, makeInvoice, resetReia } from './helpers/reia.js';
import { coverage } from '../src/services/projectScope.js';

// Target #2, Phase D: an additional charge lets one officer act in an absent
// officer's role, on their projects, for dated days, recorded as "X for Y";
// break-glass opens a role for a few hours only on two approvals, one of them
// Management's, and flags everything done under it.

const as = (u, acting) => {
  const h = auth(signToken(u));
  if (acting) h['X-Acting-As'] = acting;
  return h;
};
const post = (url, u, body = {}, acting) => request(app).post(url).set(as(u, acting)).send(body);
const get = (url, u, acting) => request(app).get(url).set(as(u, acting));
const ack = { security_ack: 'test fixture: cover is tracked on the security desk' };
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);

let admin, mgmt, maker, checker, contract;
beforeEach(() => {
  resetReia();
  for (const t of ['role_delegations', 'break_glass_grants', 'user_project_assignments']) db.prepare(`DELETE FROM ${t}`).run();
  admin = makeUser('SJVN_ADMIN', { name: 'PD Admin' });
  mgmt = makeUser('MANAGEMENT', { name: 'PD Management' });
  maker = makeUser('REIA_MAKER', { name: 'Ravi' });
  checker = makeUser('REIA_CHECKER', { name: 'Meera' });
  contract = makeContract({ status: 'ACTIVE' });
});

const giveCharge = (body = {}) => post('/api/delegations/', admin, {
  delegator_id: checker.id, delegate_id: maker.id, valid_from: istToday(), valid_to: plusDays(5),
  reason: 'Meera on earned leave, office order 12/2026', ...body,
});
const pendingL1 = () => {
  const inv = makeInvoice({ contract_id: contract.id, status: 'UNDER_APPROVAL', total_amount: 1000 });
  db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, 'PENDING')`).run(`PD-${inv.id}`, inv.id);
  return inv;
};

describe('additional charge', () => {
  it('lets the delegate sign as the checker, on record as "X for Y"', async () => {
    const d = await giveCharge();
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    const inv = pendingL1();
    // As himself, a maker does not sign level 1.
    expect((await post(`/api/invoices/${inv.id}/approvals/1/act`, maker, { decision: 'APPROVED', ...ack })).status).toBe(403);
    const r = await post(`/api/invoices/${inv.id}/approvals/1/act`, maker, { decision: 'APPROVED', ...ack }, `DLG:${d.body.id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const step = db.prepare('SELECT approver_name, approver_id FROM invoice_approvals WHERE invoice_id = ?').get(inv.id);
    expect(step).toEqual({ approver_name: 'Ravi for Meera', approver_id: maker.id });
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'ADDITIONAL_CHARGE_ACTION' AND entity_id = ?").get(d.body.id).c).toBeGreaterThan(0);
  });

  it('shows the officer what they can act as, and /me reports the acting role', async () => {
    const d = await giveCharge();
    const mine = (await get('/api/delegations/mine', maker)).body;
    expect(mine.options).toEqual([expect.objectContaining({ value: `DLG:${d.body.id}`, role: 'REIA_CHECKER', for_name: 'Meera' })]);
    const me = (await get('/api/auth/me', maker, `DLG:${d.body.id}`)).body.user;
    expect(me).toMatchObject({ role: 'REIA_CHECKER', real_role: 'REIA_MAKER', name: 'Ravi for Meera' });
    expect(me.acting).toMatchObject({ kind: 'DLG', for_name: 'Meera' });
  });

  it('is refused before it starts, after it is withdrawn, and to anyone else', async () => {
    const later = await giveCharge({ valid_from: plusDays(2), valid_to: plusDays(4) });
    const early = await get('/api/invoices', maker, `DLG:${later.body.id}`);
    expect(early.status).toBe(403);
    expect(early.body.code).toBe('ACTING_ENDED');

    const d = await giveCharge();
    expect((await get('/api/invoices', makeUser('REIA_MAKER'), `DLG:${d.body.id}`)).status).toBe(403);
    expect((await post(`/api/delegations/${d.body.id}/revoke`, admin)).status).toBe(200);
    expect((await get('/api/invoices', maker, `DLG:${d.body.id}`)).body.code).toBe('ACTING_ENDED');
  });

  it('is recorded only by an administrator, and only sensibly', async () => {
    expect((await post('/api/delegations/', checker, { delegator_id: checker.id, delegate_id: maker.id })).status).toBe(403);
    expect((await giveCharge({ delegate_id: checker.id })).body.error).toMatch(/own charge/);
    expect((await giveCharge({ delegate_id: admin.id })).body.error).toMatch(/administrator does not transact/);
    expect((await giveCharge({ delegator_id: admin.id })).body.error).toMatch(/not one that is handed over/);
    expect((await giveCharge({ valid_to: plusDays(200) })).body.error).toMatch(/at most 90 days/);
    expect((await giveCharge({ valid_from: plusDays(-10), valid_to: plusDays(-1) })).body.error).toMatch(/already be over/);
    expect((await giveCharge({ reason: 'x' })).body.error).toMatch(/Say why/);
  });

  it('works on the delegator\'s projects, not the delegate\'s', async () => {
    const other = makeContract({ status: 'ACTIVE' });
    // Meera works on `contract` only; Ravi, on everything.
    await request(app).put(`/api/project-scope/users/${checker.id}`).set(as(admin)).send({ scope: 'SELECTED', contract_ids: [contract.id] });
    const d = await giveCharge();
    expect((await get(`/api/contracts/${other.id}`, maker)).status).toBe(200);
    expect((await get(`/api/contracts/${other.id}`, maker, `DLG:${d.body.id}`)).status).toBe(403);
    expect((await get(`/api/contracts/${contract.id}`, maker, `DLG:${d.body.id}`)).status).toBe(200);
  });

  it('keeps a project covered while its only checker is away', async () => {
    db.prepare("UPDATE users SET is_active = 0 WHERE role IN ('REIA_MAKER','REIA_CHECKER','REIA_APPROVER') AND id NOT IN (?, ?)").run(maker.id, checker.id);
    await request(app).put(`/api/project-scope/users/${checker.id}`).set(as(admin)).send({ scope: 'SELECTED', contract_ids: [contract.id] });
    const other = makeContract({ status: 'ACTIVE' });
    const before = coverage().projects.find((p) => p.id === other.id);
    expect(before.missing).toContain('checker');
    // A charge naming the other project, which Meera does not hold, does not cover it.
    await giveCharge({ contract_ids: [other.id] });
    expect(coverage().projects.find((p) => p.id === other.id).missing).toContain('checker');
    // A charge on Meera's own project lists Ravi as covering it.
    await giveCharge();
    expect(coverage().projects.find((p) => p.id === contract.id).who.checker.map((u) => u.name)).toContain('Ravi for Meera');
  });
});

describe('break-glass', () => {
  const ask = (body = {}) => post('/api/delegations/break-glass', maker, { role: 'REIA_CHECKER', hours: 4, reason: 'Month-end bills due today; both checkers are on leave', ...body });

  it('opens only on two approvals, one of them Management\'s, and flags what is done under it', async () => {
    const g = (await ask()).body;
    expect(g.status).toBe('REQUESTED');
    expect((await get('/api/invoices', maker, `BG:${g.id}`)).body.code).toBe('ACTING_ENDED');

    expect((await post(`/api/delegations/break-glass/${g.id}/approve`, maker)).status).toBe(403); // own request
    expect((await post(`/api/delegations/break-glass/${g.id}/approve`, checker)).status).toBe(403); // not an approver
    expect((await post(`/api/delegations/break-glass/${g.id}/approve`, admin)).body.message).toMatch(/second approver/);
    expect((await post(`/api/delegations/break-glass/${g.id}/approve`, admin)).status).toBe(403); // same person twice
    const it2 = makeUser('IT_SUPER_ADMIN', { name: 'PD IT' });
    expect((await post(`/api/delegations/break-glass/${g.id}/approve`, it2)).body.error).toMatch(/must come from Management/);
    const open = await post(`/api/delegations/break-glass/${g.id}/approve`, mgmt);
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    expect(open.body.status).toBe('ACTIVE');

    const inv = pendingL1();
    const r = await post(`/api/invoices/${inv.id}/approvals/1/act`, maker, { decision: 'APPROVED', ...ack }, `BG:${g.id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(db.prepare('SELECT approver_name FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).approver_name).toBe('Ravi (break-glass)');
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'BREAK_GLASS_ACTION' AND entity_id = ?").get(g.id).c).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM notifications WHERE type = 'BREAK_GLASS' AND role = 'COMPLIANCE_AUDITOR'").get().c).toBe(1);
  });

  it('closes by itself when the time is up, and can be ended early', async () => {
    const g = (await ask()).body;
    await post(`/api/delegations/break-glass/${g.id}/approve`, admin);
    await post(`/api/delegations/break-glass/${g.id}/approve`, mgmt);
    db.prepare("UPDATE break_glass_grants SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(g.id);
    expect((await get('/api/invoices', maker, `BG:${g.id}`)).body.code).toBe('ACTING_ENDED');
    expect((await get('/api/delegations/break-glass', maker)).body.find((x) => x.id === g.id).status).toBe('EXPIRED');

    const g2 = (await ask({ role: 'REIA_APPROVER' })).body;
    await post(`/api/delegations/break-glass/${g2.id}/approve`, mgmt);
    await post(`/api/delegations/break-glass/${g2.id}/approve`, admin);
    expect((await post(`/api/delegations/break-glass/${g2.id}/revoke`, maker)).status).toBe(200);
    expect((await get('/api/invoices', maker, `BG:${g2.id}`)).body.code).toBe('ACTING_ENDED');
  });

  it('is never an administrator\'s role, nor for administrators, nor open-ended', async () => {
    expect((await ask({ role: 'SJVN_ADMIN' })).body.error).toMatch(/desk role/);
    expect((await ask({ hours: 200 })).body.error).toMatch(/between 1 and 72/);
    expect((await ask({ reason: 'urgent' })).body.error).toMatch(/at least 15/);
    expect((await post('/api/delegations/break-glass', admin, { role: 'REIA_CHECKER', hours: 2, reason: 'Administrator wants to approve a bill' })).status).toBe(403);
    expect((await ask({ role: 'REIA_MAKER' })).body.error).toMatch(/already hold/);
  });

  it('can be refused, with a reason', async () => {
    const g = (await ask()).body;
    expect((await post(`/api/delegations/break-glass/${g.id}/reject`, mgmt, { reason: 'x' })).status).toBe(400);
    const r = await post(`/api/delegations/break-glass/${g.id}/reject`, mgmt, { reason: 'A checker is reachable on phone' });
    expect(r.body.status).toBe('REJECTED');
    expect((await post(`/api/delegations/break-glass/${g.id}/approve`, admin)).status).toBe(400);
  });
});
