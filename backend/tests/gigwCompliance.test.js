import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, makeUser, auth } from './helpers/reia.js';
import { matchCritical } from '../src/services/statutoryDeclaration.js';

// GIGW 3.0 / DPDP Act 2023 / CERT-In: the security headers, the public facts the
// policy pages read, consent receipts, the statutory declaration on critical
// submissions, data-principal requests, and sign-out / concurrent sign-in records.

describe('security headers', () => {
  it('sets CSP, HSTS, frame, sniffing and referrer headers, and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['content-security-policy']).toMatch(/script-src 'self'(;|$)/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.body.server_time_utc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('public site info', () => {
  it('is readable without signing in and names no officer that was not configured', async () => {
    const res = await request(app).get('/api/public/site-info');
    expect(res.status).toBe(200);
    expect(res.body.office_address).toMatch(/Shimla/);
    expect(res.body.contacts.wim).toEqual({});
    expect(res.body.session.idle_timeout_minutes).toBe(15);
    expect(res.body.declaration.version).toBe('SJVN-2026-V1');
    expect(res.body.declaration.endpoints.length).toBeGreaterThan(10);
    expect(res.body.server_time_ist).toMatch(/\+05:30$/);
  });

  it('shows an officer once the parameter is filled', async () => {
    db.prepare("UPDATE system_parameters SET param_value = 'GM (IT)' WHERE param_key = 'gigw_wim_designation'").run();
    const { invalidateParamCache } = await import('../src/mastersService.js');
    invalidateParamCache();
    const res = await request(app).get('/api/public/site-info');
    expect(res.body.contacts.wim).toEqual({ designation: 'GM (IT)' });
  });

  it('records a cookie choice, naming the user when signed in, and refuses an unknown choice', async () => {
    const user = makeUser('REIA_USER');
    const { signToken } = await import('../src/middleware/auth.js');
    const ok = await request(app).post('/api/public/consent').set(auth(signToken(user))).send({ purpose: 'COOKIES', choice: 'essential', version: 'v1' });
    expect(ok.status).toBe(201);
    const row = db.prepare('SELECT * FROM consent_records WHERE id = ?').get(ok.body.id);
    expect(row).toMatchObject({ user_id: user.id, choice: 'essential', purpose: 'COOKIES' });
    const bad = await request(app).post('/api/public/consent').send({ choice: 'everything' });
    expect(bad.status).toBe(400);
  });
});

describe('statutory declaration', () => {
  it('matches the critical submissions and nothing else', () => {
    expect(matchCritical('POST', '/api/bids/BID-1/submit')?.label).toMatch(/bid/i);
    expect(matchCritical('POST', '/api/invoices/INV-1/approvals/L2/act')).toBeTruthy();
    expect(matchCritical('POST', '/api/payment-security/releases/R-1/finance-signoff')).toBeTruthy();
    expect(matchCritical('GET', '/api/bids/BID-1/submit')).toBeNull();
    expect(matchCritical('POST', '/api/bids')).toBeNull();
    expect(matchCritical('POST', '/api/invoices/INV-1/payments')).toBeNull();
  });

  it('refuses a critical submission without the declaration and records one that has it', async () => {
    const token = tokenFor('TRADING_USER');
    const refused = await request(app).post('/api/bids/NO-SUCH-BID/submit').set(auth(token)).set('X-Statutory-Declaration', '').send({});
    expect(refused.status).toBe(428);
    expect(refused.body.code).toBe('DECLARATION_REQUIRED');

    const stale = await request(app).post('/api/bids/NO-SUCH-BID/submit').set(auth(token)).set('X-Statutory-Declaration', 'SJVN-2020-V0').send({});
    expect(stale.status).toBe(428);
    expect(stale.body.error).toMatch(/revised/);

    const before = db.prepare('SELECT COUNT(*) c FROM statutory_declarations').get().c;
    const declared = await request(app).post('/api/bids/NO-SUCH-BID/submit').set(auth(token))
      .set('X-Statutory-Declaration', 'SJVN-2026-V1').set('X-Declaration-Accepted-At', '2026-10-19T10:00:00.000Z').send({});
    expect(declared.status).not.toBe(428);
    const row = db.prepare('SELECT * FROM statutory_declarations ORDER BY rowid DESC LIMIT 1').get();
    expect(db.prepare('SELECT COUNT(*) c FROM statutory_declarations').get().c).toBe(before + 1);
    expect(row).toMatchObject({ method: 'POST', path: '/api/bids/NO-SUCH-BID/submit', version: 'SJVN-2026-V1', user_role: 'TRADING_USER', client_accepted_at: '2026-10-19T10:00:00.000Z' });
    expect(row.outcome_status).toBe(declared.status);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'STATUTORY_DECLARATION' AND entity_id = ?").get(row.id).c).toBe(1);
  });

  it('leaves an unauthenticated request to the route, which answers 401', async () => {
    const res = await request(app).post('/api/bids/X/submit').set('X-Statutory-Declaration', '').send({});
    expect(res.status).toBe(401);
  });
});

describe('data principal rights', () => {
  it('summarises the user’s own data and takes, numbers and closes a request', async () => {
    const user = makeUser('SELLER_L1', { name: 'Asha' });
    const { signToken } = await import('../src/middleware/auth.js');
    const token = signToken(user);

    const mine = await request(app).get('/api/privacy/my-data').set(auth(token));
    expect(mine.status).toBe(200);
    expect(mine.body.profile).toMatchObject({ name: 'Asha', role: 'SELLER_L1' });
    expect(mine.body.retention).toMatch(/8 years/);

    const short = await request(app).post('/api/privacy/requests').set(auth(token)).send({ request_type: 'CORRECTION', details: 'fix' });
    expect(short.status).toBe(400);
    const nom = await request(app).post('/api/privacy/requests').set(auth(token)).send({ request_type: 'NOMINATION', details: 'Nominating my colleague.', nominee_name: 'Ravi', nominee_contact: 'not-a-contact' });
    expect(nom.status).toBe(400);

    const made = await request(app).post('/api/privacy/requests').set(auth(token)).send({ request_type: 'CORRECTION', details: 'My mobile number is out of date.' });
    expect(made.status).toBe(201);
    expect(made.body.reference).toMatch(/^DPR\/\d{4}\/\d{5}$/);

    const seller = await request(app).get('/api/privacy/admin/requests').set(auth(token));
    expect(seller.status).toBe(403);

    const admin = tokenFor('SJVN_ADMIN');
    const noReason = await request(app).patch(`/api/privacy/admin/requests/${made.body.id}`).set(auth(admin)).send({ status: 'RESOLVED' });
    expect(noReason.status).toBe(400);
    const closed = await request(app).patch(`/api/privacy/admin/requests/${made.body.id}`).set(auth(admin)).send({ status: 'RESOLVED', response: 'Mobile number updated.' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'RESOLVED', response: 'Mobile number updated.' });
    expect(closed.body.closed_at).toBeTruthy();

    const list = await request(app).get('/api/privacy/requests').set(auth(token));
    expect(list.body.map((r) => r.status)).toEqual(['RESOLVED']);
  });
});

describe('sessions', () => {
  it('records sign-out and inactivity sign-out', async () => {
    const user = makeUser('REIA_USER');
    const { signToken } = await import('../src/middleware/auth.js');
    const token = signToken(user);
    await request(app).post('/api/auth/logout').set(auth(token)).send({ reason: 'IDLE_TIMEOUT' }).expect(200);
    await request(app).post('/api/auth/logout').set(auth(token)).send({}).expect(200);
    const actions = db.prepare("SELECT action FROM audit_logs WHERE user_id = ? AND module = 'AUTH' ORDER BY rowid").all(user.id).map((r) => r.action);
    expect(actions).toEqual(['SESSION_TIMEOUT', 'LOGOUT']);
  });

  it('warns when a sign-in arrives while another session from a different address is open', async () => {
    const hash = bcrypt.hashSync('Passw0rd!', 4);
    const user = makeUser('REIA_USER', { email: 'twin@test.in' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

    const first = await request(app).post('/api/auth/login').set('X-Forwarded-For', '10.1.1.1').send({ email: 'twin@test.in', password: 'Passw0rd!' });
    expect(first.status).toBe(200);
    expect(first.body.previous_login).toBeNull();

    const second = await request(app).post('/api/auth/login').set('X-Forwarded-For', '10.2.2.2').send({ email: 'twin@test.in', password: 'Passw0rd!' });
    expect(second.body.previous_login).toMatchObject({ ip: '10.1.1.1', concurrent: true });
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE user_id = ? AND action = 'CONCURRENT_LOGIN_ALERT'").get(user.id).c).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type = 'SECURITY'").get(user.id).c).toBe(1);

    await request(app).post('/api/auth/logout').set(auth(second.body.token)).send({}).expect(200);
    const third = await request(app).post('/api/auth/login').set('X-Forwarded-For', '10.3.3.3').send({ email: 'twin@test.in', password: 'Passw0rd!' });
    expect(third.body.previous_login.concurrent).toBe(false);
  });
});
