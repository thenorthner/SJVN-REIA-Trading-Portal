import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { retryFailedDeliveries } from '../services/notificationService.js';
import { sendMail, getMailConfig } from '../services/mailService.js';

const router = Router();
router.use(requireAuth);

const TEST_MAIL_ROLES = [...new Set([
  ...ROLE_GROUPS.REIA_ALL,
  ...ROLE_GROUPS.TRADING_ALL,
])];

// Demo / go-live check: drop a message into the configured SMTP inbox
// (Mailtrap sandbox, or live SMTP) addressed to the signed-in user.
router.post('/test-email', requireRole(...TEST_MAIL_ROLES), async (req, res) => {
  const to = req.user.email;
  if (!to) return res.status(400).json({ error: 'Signed-in user has no email address' });
  const cfg = getMailConfig();
  const sentAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const result = await sendMail({
    to,
    subject: 'SJVN REIA & Power Trading — test alert',
    text: [
      'This is a test email from the SJVN Energy Platform.',
      '',
      `Sent at: ${sentAt} IST`,
      `SMTP host: ${cfg.host || '(not configured)'}`,
      '',
      'If you are using Mailtrap, open Email Testing → My Inbox.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background: #003366; color: #fff; padding: 16px 20px;">
          <div style="font-size: 16px; font-weight: bold;">SJVN REIA & Power Trading Portal</div>
          <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Test email alert</div>
        </div>
        <div style="padding: 20px; color: #0f172a;">
          <p>This is a test email from the SJVN Energy Platform.</p>
          <p style="font-size: 13px; color: #64748b;">Sent at ${sentAt} IST<br/>SMTP host: ${cfg.host || '(not configured)'}</p>
          <p style="font-size: 12px; color: #64748b;">If you are using Mailtrap, open <strong>Email Testing → My Inbox</strong>.</p>
        </div>
      </div>
    `,
  });
  if (!result.ok) return res.status(502).json({ error: result.error || 'Email send failed', ...result });
  res.json(result);
});

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
