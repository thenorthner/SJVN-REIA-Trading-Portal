import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser } from './helpers/reia.js';

describe('Notifications Read & Read-All API', () => {
  let admin, user;
  const tok = (u) => signToken(u);

  beforeEach(() => {
    db.prepare('DELETE FROM notifications').run();
    admin = makeUser('SJVN_ADMIN', { name: 'Admin User' });
    user = makeUser('TRADING_USER', { name: 'Trader One' });
  });

  it('marks all notifications read for the authenticated role and user', async () => {
    // Insert test notifications
    db.prepare(`
      INSERT INTO notifications (id, user_id, role, type, message, is_read)
      VALUES 
        ('NTF-TEST-1', ?, NULL, 'INFO', 'Test User Message', 0),
        ('NTF-TEST-2', NULL, 'SJVN_ADMIN', 'COMPLIANCE_ALERT', 'Test Admin Message', 0),
        ('NTF-TEST-3', 'OTHER-USER', 'OTHER-ROLE', 'INFO', 'Other Message', 0)
    `).run(admin.id);

    // Call read-all as admin
    const res = await request(app)
      .post('/api/notifications/read-all')
      .set(auth(tok(admin)))
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const n1 = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get('NTF-TEST-1');
    const n2 = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get('NTF-TEST-2');
    const n3 = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get('NTF-TEST-3');

    expect(n1.is_read).toBe(1);
    expect(n2.is_read).toBe(1);
    expect(n3.is_read).toBe(0); // Untouched
  });

  it('marks specific notification IDs as read when ids array is provided', async () => {
    db.prepare(`
      INSERT INTO notifications (id, user_id, role, type, message, is_read)
      VALUES 
        ('NTF-SPEC-1', 'DIFFERENT-USER', 'DIFFERENT-ROLE', 'ALERT', 'Specific Alert 1', 0),
        ('NTF-SPEC-2', 'DIFFERENT-USER', 'DIFFERENT-ROLE', 'ALERT', 'Specific Alert 2', 0),
        ('NTF-SPEC-3', 'DIFFERENT-USER', 'DIFFERENT-ROLE', 'ALERT', 'Specific Alert 3', 0)
    `).run();

    const res = await request(app)
      .post('/api/notifications/read-all')
      .set(auth(tok(admin)))
      .send({ ids: ['NTF-SPEC-1', 'NTF-SPEC-2'] });

    expect(res.status).toBe(200);

    const n1 = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get('NTF-SPEC-1');
    const n2 = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get('NTF-SPEC-2');
    const n3 = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get('NTF-SPEC-3');

    expect(n1.is_read).toBe(1);
    expect(n2.is_read).toBe(1);
    expect(n3.is_read).toBe(0); // Not in ids list
  });

  it('marks a single notification as read via :id/read', async () => {
    db.prepare(`
      INSERT INTO notifications (id, user_id, role, type, message, is_read)
      VALUES ('NTF-SINGLE-1', ?, 'SJVN_ADMIN', 'ALERT', 'Single Alert', 0)
    `).run(admin.id);

    const res = await request(app)
      .post('/api/notifications/NTF-SINGLE-1/read')
      .set(auth(tok(admin)))
      .send();

    expect(res.status).toBe(200);
    const n = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get('NTF-SINGLE-1');
    expect(n.is_read).toBe(1);
  });
});
