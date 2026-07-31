import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { retryFailedDeliveries } from '../services/notificationService.js';

const router = Router();
router.use(requireAuth);

// L. Notification and Alert System
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? OR role = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.user.id, req.user.role);
  res.json(rows);
});

router.post('/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR role = ?').run(req.user.id, req.user.role);
  res.json({ ok: true });
});

// Email/SMS delivery monitoring — who did an alert actually reach, and did it
// succeed. Admin/auditor only, since it exposes recipient addresses.
const DELIVERY_READ = [...new Set([...ROLE_GROUPS.AUDITOR, 'MANAGEMENT'])];

router.get('/deliveries', requireRole(...DELIVERY_READ), (req, res) => {
  const { channel, status, event } = req.query;
  const where = ['1=1'];
  const params = [];
  if (channel) { where.push('channel = ?'); params.push(channel); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (event) { where.push('event = ?'); params.push(event); }
  const w = `WHERE ${where.join(' AND ')}`;

  const summary = db.prepare(`
    SELECT channel, status, COUNT(*) count FROM notification_deliveries ${w}
    GROUP BY channel, status
  `).all(...params);
  const recent = db.prepare(`
    SELECT id, event, channel, recipient_name, address, status, provider, attempts, error, created_at, sent_at
    FROM notification_deliveries ${w} ORDER BY rowid DESC LIMIT 100
  `).all(...params);

  res.json({ summary, recent });
});

// Manual trigger for the same retry the scheduler runs.
router.post('/deliveries/retry', requireRole(...DELIVERY_READ), async (req, res) => {
  res.json(await retryFailedDeliveries());
});

export default router;
