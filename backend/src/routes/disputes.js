import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT d.*, i.invoice_no, i.total_amount as invoice_total, i.contract_id
    FROM disputes d JOIN invoices i ON i.id = d.invoice_id WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  sql += ' ORDER BY d.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// K. Dispute Management - Invoice Review and Dispute Initiation
router.post('/', requireRole('SELLER', 'BUYER', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { invoice_id, raised_by, issue_description, disputed_amount, supporting_docs } = req.body;
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice_id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const id = newId('DIS');
  db.prepare(`
    INSERT INTO disputes (id, invoice_id, raised_by, issue_description, disputed_amount, supporting_docs, status)
    VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED')
  `).run(id, invoice_id, raised_by, issue_description, disputed_amount, supporting_docs ? JSON.stringify(supporting_docs) : null);

  db.prepare(`UPDATE invoices SET status = 'DISPUTED', disputed_amount = disputed_amount + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(disputed_amount, invoice_id);

  logAudit({ user: req.user, action: 'DISPUTE_RAISED', module: 'REIA', entityType: 'dispute', entityId: id, details: req.body });
  pushNotification({ role: 'REIA_USER', type: 'DISPUTE', message: `New dispute raised on invoice ${invoice.invoice_no}` });
  res.status(201).json(db.prepare('SELECT * FROM disputes WHERE id = ?').get(id));
});

router.post('/:id/status', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { status } = req.body; // UNDER_REVIEW | RESOLVED | CLOSED
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  db.prepare(`UPDATE disputes SET status = ? WHERE id = ?`).run(status, dispute.id);
  logAudit({ user: req.user, action: `DISPUTE_${status}`, module: 'REIA', entityType: 'dispute', entityId: dispute.id });
  res.json(db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id));
});

// Resolve dispute - adjusts invoice, optionally applies LPS on recoveries
router.post('/:id/resolve', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { resolution_notes, revised_amount, lps_on_resolution } = req.body;
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  db.prepare(`
    UPDATE disputes SET status = 'RESOLVED', resolution_notes = ?, lps_on_resolution = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(resolution_notes ?? null, lps_on_resolution || 0, dispute.id);

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(dispute.invoice_id);
  const newDisputedAmount = Math.max(0, invoice.disputed_amount - dispute.disputed_amount);
  const newTotal = revised_amount != null ? revised_amount : invoice.total_amount;
  db.prepare(`
    UPDATE invoices SET disputed_amount = ?, total_amount = ?, lps = lps + ?, status = 'APPROVED', updated_at = datetime('now')
    WHERE id = ?
  `).run(newDisputedAmount, newTotal, lps_on_resolution || 0, invoice.id);

  logAudit({ user: req.user, action: 'DISPUTE_RESOLVED', module: 'REIA', entityType: 'dispute', entityId: dispute.id, details: req.body });
  res.json(db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id));
});

export default router;
