import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { makeUser, auth } from './helpers/reia.js';

// Self-service password change from the profile menu. The same endpoint serves
// every portal, so the roles are exercised together rather than one by one.

const OLD = 'OldPass123';

// Sign-in looks the email up lowercased, so the fixture's own address must be
// lowercase for the login half of each assertion to find the row.
let seq = 0;

function userWithPassword(role) {
  const user = makeUser(role, { email: `pwuser${++seq}@test.in` });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(OLD, 10), user.id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
}

const change = (token, body) =>
  request(app).post('/api/auth/change-password').set(auth(token)).send(body);

const login = (email, password) =>
  request(app).post('/api/auth/login').send({ email, password });

describe('change password', () => {
  let admin, token;

  beforeEach(() => {
    admin = userWithPassword('SJVN_ADMIN');
    token = signToken(admin);
  });

  it('requires a token', async () => {
    const res = await request(app).post('/api/auth/change-password')
      .send({ current_password: OLD, new_password: 'NewPass123' });
    expect(res.status).toBe(401);
  });

  it('replaces the password, and the new one is the one that signs in', async () => {
    const res = await change(token, { current_password: OLD, new_password: 'NewPass123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    expect((await login(admin.email, OLD)).status).toBe(401);
    expect((await login(admin.email, 'NewPass123')).status).toBe(200);
  });

  it('refuses a wrong current password and leaves the old one working', async () => {
    const res = await change(token, { current_password: 'notIt123', new_password: 'NewPass123' });
    expect(res.status).toBe(401);
    expect((await login(admin.email, OLD)).status).toBe(200);
  });

  it('refuses a weak or unchanged new password', async () => {
    expect((await change(token, { current_password: OLD, new_password: 'short1' })).status).toBe(400);
    expect((await change(token, { current_password: OLD, new_password: 'nodigitshere' })).status).toBe(400);
    expect((await change(token, { current_password: OLD, new_password: OLD })).status).toBe(400);
    expect((await change(token, { current_password: OLD })).status).toBe(400);
    expect((await login(admin.email, OLD)).status).toBe(200);
  });

  it('works the same for a seller, a buyer and a trading user', async () => {
    for (const role of ['SELLER', 'SELLER_L1', 'BUYER', 'TRADING_USER', 'FINANCE_USER', 'TRADING_CLIENT']) {
      const u = userWithPassword(role);
      const res = await change(signToken(u), { current_password: OLD, new_password: 'RolePass123' });
      expect(res.status, role).toBe(200);
      expect((await login(u.email, 'RolePass123')).status, role).toBe(200);
    }
  });

  it('records the change, and the failure, on the audit trail', async () => {
    await change(token, { current_password: 'wrong123', new_password: 'NewPass123' });
    await change(token, { current_password: OLD, new_password: 'NewPass123' });
    const actions = db.prepare(
      "SELECT action FROM audit_logs WHERE entity_id = ? AND action LIKE 'PASSWORD%'"
    ).all(admin.id).map((r) => r.action);
    expect(actions).toContain('PASSWORD_CHANGE_FAILED');
    expect(actions).toContain('PASSWORD_CHANGED');
  });
});
