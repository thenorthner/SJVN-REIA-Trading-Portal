/**
 * Advances / unapplied receipts desk (decided 17-Oct-2026). See
 * services/advances.js. Finance applies an advance to a bill of the same
 * counterparty, or refunds it; everyone on the REIA side can read the ledger.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { listAdvances, advanceDetail, drawAdvance } from '../services/advances.js';
import { applyInvoicePayment } from './invoices.js';
import { invoiceBalance } from '../services/invoiceLps.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const send = (res, fn) => {
  try { return res.json(fn()); } catch (e) {
    if (!e.status) console.error('[ADVANCES]', e);
    return res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong' });
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });

router.get('/', requireRole(...READ), (req, res) => send(res, () => {
  const rows = listAdvances({ entityId: req.query.entity_id || null, status: req.query.status || null });
  const open = rows.filter((r) => r.status === 'OPEN');
  return { advances: rows, totals: { open_count: open.length, open_balance: Math.round(open.reduce((a, r) => a + r.balance, 0) * 100) / 100 } };
}));

router.get('/:id', requireRole(...READ), (req, res) => send(res, () => {
  const r = advanceDetail(req.params.id);
  if (!r) throw fail(404, 'Advance not found');
  // The bills it could go to: the same counterparty's open bills to SJVN's receivable side.
  const bills = db.prepare(`
    SELECT i.id, i.invoice_no, i.billing_period, i.total_amount, i.status FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE c.buyer_id = ? AND i.direction = 'SJVN_TO_BUYER' AND i.status IN ('SENT','PARTIALLY_PAID','DISPUTED')
    ORDER BY i.due_date
  `).all(r.entity_id);
  return { ...r, open_bills: bills };
}));

// POST /:id/apply { invoice_id, amount }
router.post('/:id/apply', requireRole(...ROLE_GROUPS.FINANCE_CONFIRM), (req, res) => send(res, () => {
  const r = advanceDetail(req.params.id);
  if (!r) throw fail(404, 'Advance not found');
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(String(req.body.invoice_id || ''));
  if (!inv) throw fail(404, 'Invoice not found');
  const buyer = db.prepare('SELECT buyer_id FROM contracts WHERE id = ?').get(inv.contract_id)?.buyer_id;
  if (inv.direction !== 'SJVN_TO_BUYER' || buyer !== r.entity_id) throw fail(400, `${inv.invoice_no} is not a bill of ${r.counterparty}, so this advance cannot settle it`);
  if (!['SENT', 'PARTIALLY_PAID', 'DISPUTED'].includes(inv.status)) throw fail(400, `${inv.invoice_no} is ${inv.status.toLowerCase().replace(/_/g, ' ')} — nothing is open on it`);
  const left = invoiceBalance(inv, new Date()).balance;
  const amount = req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : Math.min(r.balance, left);
  if (!(amount > 0)) throw fail(400, 'The amount must be positive');
  if (amount > left + 1) throw fail(400, `Only ₹${Math.round(left).toLocaleString('en-IN')} is open on ${inv.invoice_no}`);
  let after;
  db.transaction(() => {
    after = drawAdvance(r.id, amount, 'APPLIED', { invoiceId: inv.id, reference: r.receipt_no, user: req.user });
    applyInvoicePayment(inv, { amount, payment_date: today(), mode: 'ADVANCE', reference: r.receipt_no }, req);
  })();
  logAudit({ req, user: req.user, action: 'ADVANCE_APPLIED', module: 'REIA', entityType: 'unapplied_receipt', entityId: r.id, details: { invoice_no: inv.invoice_no, amount } });
  return { advance: advanceDetail(after.id), invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id) };
}));

// POST /:id/refund { amount?, reference, note }
router.post('/:id/refund', requireRole(...ROLE_GROUPS.FINANCE_CONFIRM), (req, res) => send(res, () => {
  const r = advanceDetail(req.params.id);
  if (!r) throw fail(404, 'Advance not found');
  const reference = String(req.body.reference || '').trim();
  const note = String(req.body.note || '').trim();
  if (reference.length < 4) throw fail(400, 'Enter the UTR of the refund');
  if (!note) throw fail(400, 'Say why the advance is refunded rather than applied');
  const amount = req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : r.balance;
  const after = drawAdvance(r.id, amount, 'REFUNDED', { reference, note, user: req.user });
  logAudit({ req, user: req.user, action: 'ADVANCE_REFUNDED', module: 'REIA', entityType: 'unapplied_receipt', entityId: r.id, details: { amount, reference, note } });
  return advanceDetail(after.id);
}));

export default router;
