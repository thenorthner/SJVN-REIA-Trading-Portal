import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.FINANCE])];

// Signed effect of a note on the linked invoice: DEBIT increases, CREDIT reduces.
const signedDelta = (type, amount) => (type === 'DEBIT' ? 1 : -1) * (Number(amount) || 0);

function applyToInvoice(invoiceId, delta) {
  db.prepare(`UPDATE invoices SET other_adjustments = COALESCE(other_adjustments,0) + ?, total_amount = COALESCE(total_amount,0) + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(delta, delta, invoiceId);
}

router.get('/', requireRole(...READ), (req, res) => {
  const { invoice_id, contract_id, note_type, status } = req.query;
  let sql = 'SELECT * FROM debit_credit_notes WHERE 1=1';
  const params = [];
  if (invoice_id) { sql += ' AND invoice_id = ?'; params.push(invoice_id); }
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (note_type) { sql += ' AND note_type = ?'; params.push(note_type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/summary', requireRole(...READ), (req, res) => {
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN note_type='DEBIT' AND status!='CANCELLED' THEN amount ELSE 0 END),0) total_debit,
    COALESCE(SUM(CASE WHEN note_type='CREDIT' AND status!='CANCELLED' THEN amount ELSE 0 END),0) total_credit,
    COUNT(*) total_notes FROM debit_credit_notes`).get();
  res.json({ ...row, net: Math.round(row.total_debit - row.total_credit) });
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(b.invoice_id);
  if (!inv) return res.status(404).json({ error: 'Linked invoice not found' });
  if (inv.status === 'CANCELLED') return res.status(400).json({ error: 'Cannot raise a note against a cancelled invoice' });
  const note_type = b.note_type === 'CREDIT' ? 'CREDIT' : b.note_type === 'DEBIT' ? 'DEBIT' : null;
  if (!note_type) return res.status(400).json({ error: 'note_type must be DEBIT or CREDIT' });
  const amount = Math.abs(Number(b.amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'A positive amount is required' });
  const REASONS = ['REVISED_REA', 'CHANGE_IN_LAW', 'TRANSMISSION_CHARGES', 'LPS', 'COMPENSATION_EVENT', 'LIQUIDATED_DAMAGES', 'OTHER'];
  const reason_code = REASONS.includes(b.reason_code) ? b.reason_code : 'REVISED_REA';

  const id = newId('DCN');
  const seq = (db.prepare('SELECT COUNT(*) c FROM debit_credit_notes').get().c || 0) + 1;
  const note_no = `${note_type === 'DEBIT' ? 'DN' : 'CN'}/${inv.billing_period || 'NA'}/${String(seq).padStart(4, '0')}`;
  const issued_date = b.issued_date || new Date().toISOString().split('T')[0];

  const run = db.transaction(() => {
    db.prepare(`
      INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month,
        reason_code, amount, reason, status, issued_date, created_by)
      VALUES (@id, @note_no, @note_type, @invoice_id, @contract_id, @period_month,
        @reason_code, @amount, @reason, 'ISSUED', @issued_date, @created_by)
    `).run({
      id, note_no, note_type, invoice_id: inv.id, contract_id: inv.contract_id,
      period_month: inv.billing_period, reason_code, amount, reason: b.reason || null,
      issued_date, created_by: req.user.name,
    });
    applyToInvoice(inv.id, signedDelta(note_type, amount));
  });
  run();

  logAudit({ req, user: req.user, action: 'ISSUE_NOTE', module: 'REIA', entityType: 'debit_credit_note', entityId: id, details: { note_no, note_type, amount, reason_code } });
  const role = inv.direction === 'SELLER_TO_SJVN' ? 'SELLER' : 'BUYER';
  pushNotification({ role, type: 'DC_NOTE_ISSUED', message: `${note_type === 'DEBIT' ? 'Debit' : 'Credit'} Note ${note_no} of Rs.${amount.toLocaleString('en-IN')} issued against ${inv.invoice_no}` });
  res.status(201).json(db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(id));
});

router.post('/:id/cancel', requireRole(...WRITE), (req, res) => {
  const note = db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.status === 'CANCELLED') return res.status(400).json({ error: 'Note is already cancelled' });
  const run = db.transaction(() => {
    // Reverse the effect it applied when issued.
    applyToInvoice(note.invoice_id, -signedDelta(note.note_type, note.amount));
    db.prepare("UPDATE debit_credit_notes SET status='CANCELLED', updated_at=datetime('now') WHERE id=?").run(note.id);
  });
  run();
  logAudit({ req, user: req.user, action: 'CANCEL_NOTE', module: 'REIA', entityType: 'debit_credit_note', entityId: note.id });
  res.json(db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(note.id));
});

export default router;
