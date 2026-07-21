import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

const BOARD_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const BOARD_WRITE = ROLE_GROUPS.REIA_WRITE; // who can post/remove broadcasts

/** Safe single-row query — returns {} if the table is missing on this DB. */
function safeGet(sql, ...params) {
  try { return db.prepare(sql).get(...params) || {}; } catch { return {}; }
}
function safeAll(sql, ...params) {
  try { return db.prepare(sql).all(...params) || []; } catch { return []; }
}

/** Builds the live alert feed from every operational module. */
function computeAlerts() {
  const alerts = [];
  const add = (a) => { if (a && a.count > 0) alerts.push({ id: a.key, ...a }); };

  // 1. Overdue payments (past due, still unpaid)
  const overdue = safeGet(`
    SELECT COUNT(*) count, COALESCE(SUM(total_amount),0) amount
    FROM invoices
    WHERE status IN ('SENT','APPROVED','PARTIALLY_PAID','DISPUTED')
      AND due_date IS NOT NULL AND date(due_date) < date('now')
  `);
  add({
    key: 'overdue-payments', category: 'Overdue Payment', severity: 'CRITICAL',
    title: 'Overdue payments',
    detail: `${overdue.count} invoice(s) past due · ₹${Number(overdue.amount || 0).toLocaleString('en-IN')} outstanding`,
    count: overdue.count || 0, link: '/reia/invoices',
  });

  // 2. Payment due dates (falling due in the next 7 days)
  const dueSoon = safeGet(`
    SELECT COUNT(*) count, COALESCE(SUM(total_amount),0) amount
    FROM invoices
    WHERE status IN ('SENT','APPROVED','PARTIALLY_PAID')
      AND due_date IS NOT NULL
      AND date(due_date) BETWEEN date('now') AND date('now','+7 day')
  `);
  add({
    key: 'due-soon', category: 'Payment Due', severity: 'WARNING',
    title: 'Payments due this week',
    detail: `${dueSoon.count} invoice(s) due within 7 days · ₹${Number(dueSoon.amount || 0).toLocaleString('en-IN')}`,
    count: dueSoon.count || 0, link: '/reia/invoices',
  });

  // 3. Invoice approvals pending
  const approvals = safeGet(`
    SELECT COUNT(*) count FROM invoices
    WHERE status IN ('SUBMITTED','UNDER_APPROVAL','PENDING_L2')
  `);
  add({
    key: 'invoice-approvals', category: 'Invoice Approval', severity: 'WARNING',
    title: 'Invoices awaiting approval',
    detail: `${approvals.count} invoice(s) pending in the approval workflow`,
    count: approvals.count || 0, link: '/reia/invoices',
  });

  // 4. LC / security expiring soon
  const expiring = safeGet(`
    SELECT COUNT(*) count FROM payment_security
    WHERE status = 'ACTIVE' AND validity_end IS NOT NULL
      AND date(validity_end) BETWEEN date('now') AND date('now','+30 day')
  `);
  add({
    key: 'security-expiring', category: 'LC Expiry', severity: 'WARNING',
    title: 'Security instruments expiring',
    detail: `${expiring.count} LC / BG expiring within 30 days — renewal needed`,
    count: expiring.count || 0, link: '/reia/payment-security',
  });

  // 4b. Security shortfall (cover below requirement)
  const shortfall = safeGet(`
    SELECT COUNT(*) count, COALESCE(SUM(required_amount - available_amount),0) gap
    FROM payment_security
    WHERE status = 'ACTIVE' AND required_amount > 0 AND available_amount < required_amount
  `);
  add({
    key: 'security-shortfall', category: 'Security Shortfall', severity: 'CRITICAL',
    title: 'Payment security shortfall',
    detail: `${shortfall.count} contract(s) under-secured · ₹${Number(shortfall.gap || 0).toLocaleString('en-IN')} gap`,
    count: shortfall.count || 0, link: '/reia/payment-security',
  });

  // 5. Security mechanism breach (invocation triggered)
  const breach = safeGet(`
    SELECT COUNT(*) count FROM security_invocations
    WHERE status IN ('ELIGIBLE','NOTICE_ISSUED')
  `);
  add({
    key: 'security-breach', category: 'Security Breach', severity: 'CRITICAL',
    title: 'Security mechanism breach',
    detail: `${breach.count} invocation(s) triggered on defaulting contracts`,
    count: breach.count || 0, link: '/reia/payment-security',
  });

  // 6. Pending claims (invocation claimed, awaiting funds)
  const claims = safeGet(`
    SELECT COUNT(*) count, COALESCE(SUM(amount),0) amount FROM security_invocations
    WHERE status = 'CLAIMED'
  `);
  add({
    key: 'pending-claims', category: 'Pending Claims', severity: 'WARNING',
    title: 'Claims awaiting funds',
    detail: `${claims.count} claim(s) filed · ₹${Number(claims.amount || 0).toLocaleString('en-IN')} to be received`,
    count: claims.count || 0, link: '/reia/payment-security',
  });

  // 7. Delayed settlements (reconciliations stuck awaiting sign-off)
  const delayed = safeGet(`
    SELECT COUNT(*) count FROM reconciliations
    WHERE status IN ('PENDING_SIGN_OFF','IN_PROGRESS')
      AND date(updated_at) < date('now','-7 day')
  `);
  add({
    key: 'delayed-settlements', category: 'Delayed Settlement', severity: 'WARNING',
    title: 'Delayed settlements',
    detail: `${delayed.count} reconciliation(s) awaiting sign-off for over 7 days`,
    count: delayed.count || 0, link: '/reia/reconciliation',
  });

  // 8. Reconciliation exceptions
  const reconEx = safeGet(`
    SELECT COUNT(*) count FROM reconciliations
    WHERE status IN ('NEEDS_REVIEW','DISPUTED')
  `);
  add({
    key: 'recon-exceptions', category: 'Reconciliation Exception', severity: 'CRITICAL',
    title: 'Reconciliation exceptions',
    detail: `${reconEx.count} reconciliation(s) with unmatched figures needing review`,
    count: reconEx.count || 0, link: '/reia/reconciliation',
  });

  // 9. Disputes — open / escalated
  const escalated = safeGet(`SELECT COUNT(*) count FROM disputes WHERE status = 'ESCALATED'`);
  add({
    key: 'disputes-escalated', category: 'Dispute', severity: 'CRITICAL',
    title: 'Escalated disputes',
    detail: `${escalated.count} dispute(s) escalated — SLA breach risk`,
    count: escalated.count || 0, link: '/reia/disputes',
  });
  const openDisputes = safeGet(`
    SELECT COUNT(*) count FROM disputes
    WHERE status IN ('RAISED','ACKNOWLEDGED','UNDER_REVIEW','INFO_REQUESTED')
  `);
  add({
    key: 'disputes-open', category: 'Dispute', severity: 'WARNING',
    title: 'Open disputes',
    detail: `${openDisputes.count} dispute(s) awaiting resolution`,
    count: openDisputes.count || 0, link: '/reia/disputes',
  });
  const resolved = safeGet(`
    SELECT COUNT(*) count FROM disputes
    WHERE status IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED','CLOSED')
      AND resolved_at IS NOT NULL AND date(resolved_at) >= date('now','-7 day')
  `);
  add({
    key: 'disputes-resolved', category: 'Dispute', severity: 'INFO',
    title: 'Recently resolved disputes',
    detail: `${resolved.count} dispute(s) resolved in the last 7 days`,
    count: resolved.count || 0, link: '/reia/disputes',
  });

  const order = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return alerts;
}

function activeBroadcasts() {
  return safeAll(`
    SELECT * FROM broadcast_messages
    WHERE is_active = 1 AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, created_at DESC
  `);
}

// GET /alerts/board — combined broadcasts + live alerts + summary counts
router.get('/board', requireRole(...BOARD_READ), (req, res) => {
  const alerts = computeAlerts();
  const broadcasts = activeBroadcasts();
  const summary = {
    critical: alerts.filter((a) => a.severity === 'CRITICAL').length
      + broadcasts.filter((b) => b.severity === 'CRITICAL').length,
    warning: alerts.filter((a) => a.severity === 'WARNING').length
      + broadcasts.filter((b) => b.severity === 'WARNING').length,
    info: alerts.filter((a) => a.severity === 'INFO').length
      + broadcasts.filter((b) => b.severity === 'INFO').length,
    total_items: alerts.reduce((s, a) => s + a.count, 0),
  };
  res.json({ broadcasts, alerts, summary, generated_at: new Date().toISOString() });
});

// GET /alerts/broadcasts — manage list (includes inactive for admins)
router.get('/broadcasts', requireRole(...BOARD_READ), (req, res) => {
  const all = req.query.all === '1' && BOARD_WRITE.includes(req.user.role);
  res.json(all
    ? safeAll(`SELECT * FROM broadcast_messages ORDER BY created_at DESC LIMIT 100`)
    : activeBroadcasts());
});

// POST /alerts/broadcasts — admin flashes a message on the board
router.post('/broadcasts', requireRole(...BOARD_WRITE), (req, res) => {
  const { title, message, severity, audience, expires_at } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message are required' });
  const sev = ['INFO', 'WARNING', 'CRITICAL'].includes(severity) ? severity : 'INFO';
  const id = newId('BRD');
  db.prepare(`
    INSERT INTO broadcast_messages (id, title, message, severity, audience, expires_at, created_by, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, message, sev, audience || 'ALL', expires_at || null, req.user.id, req.user.name);
  logAudit({ req, user: req.user, action: 'CREATE', module: 'NOTIFICATION', entityType: 'broadcast', entityId: id, details: { title, severity: sev } });
  res.status(201).json(db.prepare('SELECT * FROM broadcast_messages WHERE id = ?').get(id));
});

// DELETE /alerts/broadcasts/:id — take a message off the board
router.delete('/broadcasts/:id', requireRole(...BOARD_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM broadcast_messages WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Broadcast not found' });
  db.prepare(`UPDATE broadcast_messages SET is_active = 0 WHERE id = ?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'DEACTIVATE', module: 'NOTIFICATION', entityType: 'broadcast', entityId: req.params.id });
  res.json({ ok: true });
});

export default router;
