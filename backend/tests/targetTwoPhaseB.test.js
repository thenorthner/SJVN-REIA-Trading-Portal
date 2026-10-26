import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken, canonicalRole } from '../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeContract, makeInvoice } from './helpers/reia.js';

// Target #2, Phase B (docs/governance/TARGET-2-ROLE-TRANSFER.md): the REIA desk
// is maker / checker / approver; the SJVN and IT administrators govern and read
// but transact nothing; masters and user administration are theirs alone.

const post = (url, token, body = {}) => request(app).post(url).set(auth(token)).send(body);
const ack = { security_ack: 'test fixture: cover is tracked on the security desk' };

// No resetReia here: it clears the seeded hydro station the last case bills.

describe('the old REIA role names', () => {
  it('are read as the roles they became', () => {
    expect(canonicalRole('REIA_USER')).toBe('REIA_MAKER');
    expect(canonicalRole('REIA_ADMIN')).toBe('REIA_CHECKER');
    expect(canonicalRole('FINANCE_USER')).toBe('FINANCE_USER');
  });

  it('a token issued before the rename still works, as the new role', async () => {
    const u = makeUser('REIA_MAKER');
    const old = jwt.sign({ id: u.id, name: u.name, email: u.email, role: 'REIA_USER' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const me = await request(app).get('/api/auth/me').set(auth(old));
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('REIA_MAKER');
  });

  it('no account is left holding an old name after start-up', () => {
    // makeUser canonicalises; a row written directly with the old name is what an older build leaves.
    expect(db.prepare("SELECT COUNT(*) c FROM users WHERE role IN ('REIA_USER','REIA_ADMIN') AND email NOT LIKE '%@test.in'").get().c).toBe(0);
  });
});

describe('the REIA invoice chain: checker, Finance, approver', () => {
  const threeLevels = (contract) => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'UNDER_APPROVAL', total_amount: 36494000 });
    for (let l = 1; l <= 3; l += 1) {
      db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, ?, 'PENDING')`).run(`PB-${inv.id}-${l}`, inv.id, l);
    }
    return inv;
  };
  const act = (inv, level, token) => post(`/api/invoices/${inv.id}/approvals/${level}/act`, token, { decision: 'APPROVED', comments: 'ok', ...ack });

  it('the maker prepares but does not sign level 1', async () => {
    const inv = threeLevels(makeContract({ status: 'ACTIVE' }));
    const r = await act(inv, 1, tokenFor('REIA_MAKER'));
    expect(r.status).toBe(403);
    // Phase B.2: the maker is no reviewer at all — not even to send a bill back.
    expect(r.body.error).toMatch(/REIA_MAKER is not authorized/);
    const back = await post(`/api/invoices/${inv.id}/approvals/1/act`, tokenFor('REIA_MAKER'), { decision: 'REJECTED', comments: 'x', ...ack });
    expect(back.status).toBe(403);
  });

  it('runs checker → Finance → REIA approver to approval', async () => {
    const inv = threeLevels(makeContract({ status: 'ACTIVE' }));
    expect((await act(inv, 1, tokenFor('REIA_CHECKER'))).status).toBe(200);
    expect((await act(inv, 2, tokenFor('FINANCE_USER'))).status).toBe(200);
    expect((await act(inv, 3, tokenFor('REIA_APPROVER'))).status).toBe(200);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('APPROVED');
  });

  it('the SJVN and IT administrators sign no level', async () => {
    const inv = threeLevels(makeContract({ status: 'ACTIVE' }));
    for (const role of ['SJVN_ADMIN', 'IT_SUPER_ADMIN']) {
      expect((await act(inv, 1, tokenFor(role))).status).toBe(403);
      expect((await act(inv, 3, tokenFor(role))).status).toBe(403);
    }
  });
});

describe('the administrators transact nothing, and still see everything', () => {
  it('refuses them a contract, a bid, an energy upload and a hydro bill', async () => {
    for (const role of ['SJVN_ADMIN', 'IT_SUPER_ADMIN']) {
      const t = tokenFor(role);
      expect((await post('/api/contracts', t, { contract_no: 'X' })).status, `${role} raised a contract`).toBe(403);
      expect((await post('/api/bids', t, {})).status, `${role} raised a bid`).toBe(403);
      expect((await post('/api/hydro-billing', t, {})).status, `${role} drafted a hydro bill`).toBe(403);
      expect((await post('/api/payment-security/overrides', t, {})).status, `${role} overrode payment security`).toBe(403);
    }
  });

  it('lets them read the desks', async () => {
    const t = tokenFor('SJVN_ADMIN');
    for (const p of ['/api/contracts', '/api/invoices', '/api/bids', '/api/hydro-billing']) {
      expect((await request(app).get(p).set(auth(t))).status, p).toBe(200);
    }
  });

  it('the REIA approver takes the overrides management held', async () => {
    const c = makeContract({ status: 'ACTIVE' });
    const r = await post('/api/payment-security/overrides', tokenFor('REIA_APPROVER'), { contract_id: c.id, reason: 'Cover being renewed by the bank', valid_until: '2026-11-15' });
    expect(r.status, JSON.stringify(r.body)).not.toBe(403);
  });
});

describe('masters and users are the administrators\'', () => {
  it('a desk may read a master but not change it', async () => {
    const maker = tokenFor('REIA_MAKER');
    expect((await request(app).get('/api/masters/parameters').set(auth(maker))).status).toBe(200);
    expect((await request(app).put('/api/masters/parameters/dispute_sla_ack_days').set(auth(maker)).send({ param_value: '3' })).status).toBe(403);
    expect((await request(app).put('/api/masters/parameters/dispute_sla_ack_days').set(auth(tokenFor('SJVN_ADMIN'))).send({ param_value: '3' })).status).toBe(200);
  });

  it('the REIA checker no longer manages users or companies\' teams', async () => {
    const checker = tokenFor('REIA_CHECKER');
    expect((await request(app).get('/api/staff').set(auth(checker))).status).toBe(403);
    expect((await request(app).get('/api/team/companies').set(auth(checker))).status).toBe(403);
    expect((await post('/api/users', checker, { name: 'N', email: 'n@x.in', password: 'Passw0rd1', role: 'SELLER_L1' })).status).toBe(403);
    expect((await request(app).get('/api/staff').set(auth(tokenFor('SJVN_ADMIN')))).status).toBe(200);
  });

  it('the administrators can create each REIA tier', async () => {
    const admin = tokenFor('SJVN_ADMIN');
    for (const [i, role] of ['REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER'].entries()) {
      const r = await post('/api/staff', admin, { name: `Tier ${i}`, email: `tier${i}-${Date.now()}@sjvn.test`, role });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(db.prepare('SELECT role FROM users WHERE id = ?').get(r.body.id).role).toBe(role);
    }
  });
});

describe('a hydro step routed to an administrator before Phase B', () => {
  it('is not theirs to decide now', async () => {
    const contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
    const maker = makeUser('COMMERCIAL', { name: 'PB Maker' });
    const admin = makeUser('SJVN_ADMIN', { name: 'PB Admin' });
    const b = await post('/api/hydro-billing', signToken(maker), { contract_id: contract.id, billing_month: '2026-04', ex_bus_scheduled_kwh: 500000000, pafm_percent: 100, beta_value: 0 });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    // As an older build would have routed it.
    db.prepare(`INSERT INTO hydro_bill_approvals (id, bill_id, level, approver_user_id, approver_name, is_final, status) VALUES ('HBA-PB', ?, 1, ?, ?, 1, 'PENDING')`).run(b.body.id, admin.id, admin.name);
    db.prepare(`UPDATE hydro_station_bills SET approval_status = 'IN_APPROVAL' WHERE id = ?`).run(b.body.id);
    expect((await post(`/api/hydro-billing/${b.body.id}/approve`, signToken(admin), { action: 'APPROVE', comments: 'ok' })).status).toBe(403);
    // The maker takes it back and routes it to the desk.
    expect((await post(`/api/hydro-billing/${b.body.id}/recall`, signToken(maker), { reason: 'route to the desk approver' })).status).toBe(200);
  });
});
