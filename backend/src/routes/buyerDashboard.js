import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole('BUYER', 'SJVN_ADMIN'), (req, res) => {
  const entityId = req.user.linked_entity_id;
  if (!entityId) return res.status(400).json({ error: 'No linked entity found for this user' });
  
  // Get buyer's PSA contract IDs
  const contractIds = db.prepare("SELECT id FROM contracts WHERE buyer_id = ? AND status = 'ACTIVE'").all(entityId).map(r => r.id);
  
  if (contractIds.length === 0) {
    return res.json({
      active_contracts: 0, total_capacity_mw: 0,
      total_invoices: 0, pending_invoices: 0, paid_invoices: 0, overdue_invoices: 0,
      total_payable: 0, total_paid: 0, pending_amount: 0,
      open_disputes: 0, last_payment: null,
    });
  }
  
  const ph = contractIds.map(() => '?').join(',');
  
  // Contract stats (PSAs)
  const contractStats = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(capacity_mw), 0) as capacity FROM contracts WHERE buyer_id = ? AND status = 'ACTIVE'`).get(entityId);
  
  // Invoice stats (SJVN_TO_BUYER direction)
  // For buyers, SENT, PARTIALLY_PAID, OVERDUE are considered "pending" or needing action.
  const invStats = db.prepare(`SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status IN ('SENT', 'PARTIALLY_PAID') AND (due_date IS NULL OR due_date >= date('now')) THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) as paid,
    SUM(CASE WHEN status IN ('SENT','PARTIALLY_PAID') AND due_date < date('now') THEN 1 ELSE 0 END) as overdue,
    COALESCE(SUM(total_amount), 0) as total_payable
  FROM invoices WHERE contract_id IN (${ph}) AND direction = 'SJVN_TO_BUYER' AND status NOT IN ('DRAFT', 'CANCELLED')`).get(...contractIds);
  
  // Payment stats (payments made BY the buyer TO SJVN against these invoices)
  const payStats = db.prepare(`SELECT COALESCE(SUM(p.amount), 0) as total_paid FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.contract_id IN (${ph}) AND i.direction = 'SJVN_TO_BUYER'`).get(...contractIds);
  
  const lastPayment = db.prepare(`SELECT p.amount, p.payment_date, p.reference, p.mode FROM payments p JOIN invoices i ON p.invoice_id = i.id WHERE i.contract_id IN (${ph}) AND i.direction = 'SJVN_TO_BUYER' ORDER BY p.payment_date DESC LIMIT 1`).get(...contractIds) || null;
  
  // Disputes
  const disputes = db.prepare(`SELECT COUNT(*) as count FROM disputes d JOIN invoices i ON d.invoice_id = i.id WHERE i.contract_id IN (${ph}) AND d.status IN ('SUBMITTED','UNDER_REVIEW')`).get(...contractIds);
  
  res.json({
    active_contracts: contractStats.count,
    total_capacity_mw: contractStats.capacity,
    total_invoices: invStats.total,
    pending_invoices: invStats.pending,
    paid_invoices: invStats.paid,
    overdue_invoices: invStats.overdue,
    total_payable: invStats.total_payable,
    total_paid: payStats.total_paid,
    pending_amount: invStats.total_payable - payStats.total_paid,
    open_disputes: disputes.count,
    last_payment: lastPayment,
  });
});

export default router;
