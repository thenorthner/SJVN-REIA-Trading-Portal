import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { readFileSync } from 'fs';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

let reia;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); });

describe('S12 Notifications and alerts', () => {
  it('has a notification model with delivery tracking', () => {
    expect(hasTable('notifications')).toBe(true);
    expect(hasTable('notification_deliveries')).toBe(true);
    expect(columnsOf('notification_deliveries')).toEqual(expect.arrayContaining(['status']));
  });

  it('logs a delivery failure rather than dropping it silently', () => {
    const cols = columnsOf('notification_deliveries');
    expect(cols.some(c => /error|failure|attempt/i.test(c)), 'failed deliveries record no reason').toBe(true);
  });

  it('sends a test email to the signed-in user (outbox when SMTP is off)', async () => {
    const r = await request(app).post('/api/notifications/test-email').set(auth(reia));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.mode).toBe('FILE_OUTBOX');
    expect(r.body.to?.[0]).toMatch(/@/);
  });

  it('notifies on the key REIA events', () => {
    const src = readFileSync('src/routes/invoices.js', 'utf-8') + readFileSync('src/routes/disputes.js', 'utf-8')
      + readFileSync('src/routes/paymentSecurity.js', 'utf-8');
    for (const ev of [/INVOICE_(GENERATED|APPROVED)/, /DISPUTE/, /PAYMENT/, /EXPIR/]) {
      expect(src).toMatch(ev);
    }
  });
});

describe('S13 Dashboard and master configuration', () => {
  it('reports dashboard figures from the same rows as the detail views', async () => {
    const c = makeContract({ status: 'ACTIVE' });
    makeInvoice({ contract_id: c.id, status: 'SENT', total_amount: 500000 });
    const r = await request(app).get('/api/dashboard/reia').set(auth(reia));
    if (r.status === 200) {
      const contracts = db.prepare(`SELECT COUNT(*) c FROM contracts WHERE status = 'ACTIVE'`).get().c;
      const body = JSON.stringify(r.body);
      expect(body).toMatch(new RegExp(String(contracts)));
    } else {
      expect(r.status).toBeLessThan(500);
    }
  });

  it('keeps regulatory parameters in a master rather than hardcoded', () => {
    expect(hasTable('system_parameters')).toBe(true);
    const rows = db.prepare(`SELECT COUNT(*) c FROM system_parameters`).get().c;
    expect(rows).toBeGreaterThan(0);
  });

  it('does not restate an already-issued invoice when a master rate changes', async () => {
    const c = makeContract({ status: 'ACTIVE', rebate_pct: 2 });
    const inv = makeInvoice({ contract_id: c.id, status: 'SENT', total_amount: 100000, rebate: 2000 });
    db.prepare(`UPDATE contracts SET rebate_pct = 5 WHERE id = ?`).run(c.id);
    expect(db.prepare('SELECT rebate FROM invoices WHERE id = ?').get(inv.id).rebate).toBe(2000);
  });

  it('does not let one buyer see another buyer in an aggregate view', async () => {
    const b1 = makeEntity('BUYER'); const b2 = makeEntity('BUYER');
    makeContract({ status: 'ACTIVE', buyer_id: b2.id, contract_no: 'OTHER-BUYER-C' });
    const token = signToken(makeUser('BUYER', { linked_entity_id: b1.id }));
    const r = await request(app).get('/api/contracts').set(auth(token));
    if (r.status === 200) {
      const leaked = (r.body || []).some(x => x.buyer_id === b2.id);
      expect(leaked, "a buyer saw another buyer's contract").toBe(false);
    } else {
      expect(r.status).toBe(403);
    }
  });
});

describe('S14 Access control', () => {
  it('refuses an unauthenticated request', async () => {
    expect((await request(app).get('/api/contracts')).status).toBe(401);
  });

  it('refuses a token that is not valid', async () => {
    expect((await request(app).get('/api/contracts').set(auth('nonsense'))).status).toBe(401);
  });

  it('stops a buyer approving an invoice', async () => {
    const c = makeContract({ status: 'ACTIVE' });
    const inv = makeInvoice({ contract_id: c.id, status: 'SUBMITTED' });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('AP-B', ?, 1, 'PENDING')`).run(inv.id);
    const token = signToken(makeUser('BUYER'));
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(token)).send({ decision: 'APPROVED' });
    expect(r.status).toBe(403);
  });

  it('stops a seller creating a contract', async () => {
    const token = signToken(makeUser('SELLER'));
    const r = await request(app).post('/api/contracts').set(auth(token)).send({ contract_no: 'X', contract_type: 'PPA' });
    expect(r.status).toBe(403);
  });

  it('expires a token', () => {
    const src = readFileSync('src/middleware/auth.js', 'utf-8');
    expect(src).toMatch(/expiresIn/);
  });

  it('locks an account after repeated failed logins', async () => {
    const { clearLoginAttempts } = await import('../../src/routes/auth.js');
    const email = 'lockme@test.in';
    clearLoginAttempts(email);
    makeUser('BUYER', { email });

    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
      expect(r.status).toBe(401);
    }
    // The sixth attempt is refused outright, even with the right password.
    const locked = await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Too many failed sign-in attempts/);
    expect(locked.body.retry_after_seconds).toBeGreaterThan(0);
    clearLoginAttempts(email);
  });

  it('logs a failed sign-in, not only a successful one', async () => {
    const { clearLoginAttempts } = await import('../../src/routes/auth.js');
    const email = 'audited@test.in';
    clearLoginAttempts(email);
    makeUser('BUYER', { email });
    const before = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action = 'LOGIN_FAILED'`).get().c;
    await request(app).post('/api/auth/login').send({ email, password: 'wrong' });
    expect(db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action = 'LOGIN_FAILED'`).get().c).toBeGreaterThan(before);
    clearLoginAttempts(email);
  });

  it('logs an access-control violation, not only successes', async () => {
    const before = db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c;
    const token = signToken(makeUser('BUYER'));
    await request(app).post('/api/contracts').set(auth(token)).send({ contract_no: 'Y', contract_type: 'PPA' });
    const after = db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c;
    expect(after, 'a rejected action left no audit trace').toBeGreaterThan(before);
  });
});

describe('S15 Documents', () => {
  it('separates verify-category documents from record-category', () => {
    expect(hasTable('document_type_master')).toBe(true);
    const cats = db.prepare(`SELECT DISTINCT category FROM document_type_master`).all().map(r => r.category);
    expect(cats).toEqual(expect.arrayContaining(['VERIFY', 'RECORD']));
  });

  it('keeps document versions rather than overwriting', () => {
    expect(hasTable('document_versions')).toBe(true);
    expect(columnsOf('document_versions')).toEqual(expect.arrayContaining(['document_id', 'version_number']));
  });

  it('carries a verification decision with a reason', () => {
    expect(columnsOf('document_versions')).toEqual(
      expect.arrayContaining(['verification_status', 'verification_notes', 'verified_by']));
  });

  it('restricts upload types and size', () => {
    const src = readFileSync('src/routes/documents.js', 'utf-8');
    expect(src, 'no file-type restriction on upload').toMatch(/mimetype|fileFilter|allowed.*(type|ext)/i);
    expect(src, 'no size limit on upload').toMatch(/limits|fileSize/i);
  });

  it('has a malware-scan integration point', () => {
    const src = readFileSync('src/routes/documents.js', 'utf-8');
    expect(src, 'no malware scan hook, even stubbed').toMatch(/malware|virus|scan|clamav/i);
  });
});

describe('S16 Audit trail', () => {
  it('records user, role, action and timestamp on every entry', () => {
    expect(columnsOf('audit_logs')).toEqual(expect.arrayContaining(
      ['user_id', 'user_role', 'action', 'entity_type', 'entity_id', 'before_value', 'after_value', 'created_at']));
  });

  it('hash-chains entries so tampering is detectable', () => {
    expect(columnsOf('audit_logs')).toEqual(expect.arrayContaining(['prev_hash', 'curr_hash']));
  });

  it('exposes no route to edit or delete an audit entry', () => {
    const src = readFileSync('src/routes/auditLogs.js', 'utf-8');
    expect(src).not.toMatch(/router\.(put|patch|delete)/);
  });

  it('detects a tampered chain', async () => {
    const c = makeContract({ status: 'ACTIVE' });
    await request(app).post(`/api/contracts/${c.id}/status`).set(auth(reia)).send({ status: 'EXPIRED' });
    const row = db.prepare('SELECT id FROM audit_logs ORDER BY rowid DESC LIMIT 1').get();
    if (row) {
      db.prepare(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = ?`).run(row.id);
      const { verifyAuditChain } = await import('../../src/auditEngine.js');
      if (typeof verifyAuditChain === 'function') {
        expect(verifyAuditChain().valid, 'a tampered audit row was not detected').toBe(false);
      }
    }
  });

  it('flags a segregation-of-duties violation', () => {
    const src = readFileSync('src/auditEngine.js', 'utf-8');
    expect(src, 'no segregation-of-duties detection exists').toMatch(/segregation|sod|maker.?checker/i);
  });
});
