/**
 * Trading-side debit and credit notes.
 *
 * These exist because the obligation report and the weekly payment report do
 * not agree. When a promised schedule cannot be met from own generation, the
 * shortfall is bought on the exchange and the broker raises a manual invoice
 * for it; that amount lands in the obligation report and never reaches the
 * weekly payment report. A note carries the difference so the two reconcile.
 *
 * DEBIT  = more payable  (shortfall bought, usually dearer than the sale rate)
 * CREDIT = less payable  (delivered short later, or an excess returned)
 *
 * The amount is always stored positive; direction lives in note_type. That
 * matches the REIA notes already in the platform, so a report summing both
 * ledgers does not have to know two sign conventions.
 *
 * A note is raised as a DRAFT and does nothing until someone other than its
 * maker approves it. On approval it is numbered in its own financial-year
 * series (TDN/2026-27/00001, TCN/…) and posted to the client's ledger — a
 * debit note as a debit, a credit note as a credit — so what a note says is
 * owed is actually carried on the account. Cancelling an issued note posts the
 * reversing entry rather than rubbing the old one out.
 *
 * Notes raised before this (model LEGACY) were issued at once and never reached
 * the ledger; they are left as they are.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, nextSeriesNo } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const WRITE = [...new Set([...ROLE_GROUPS.TRADING_WRITE, ...ROLE_GROUPS.FINANCE])];

const REASONS = [
  'SCHEDULE_SHORTFALL_PURCHASE',
  'SCHEDULE_EXCESS_RETURN',
  'BROKER_MANUAL_INVOICE',
  'OBLIGATION_PAYMENT_MISMATCH',
  'RATE_REVISION',
  'EXCHANGE_FEE_ADJUSTMENT',
  'DSM_ADJUSTMENT',
  'OTHER',
];

/** Signed effect on the settlement position. */
const signed = (type, amount) => (type === 'DEBIT' ? 1 : -1) * (Number(amount) || 0);
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** April-start financial year of a date, as "2026-27". */
function fyOf(isoDate) {
  const [y, m] = String(isoDate).slice(0, 7).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Post a note to the client's ledger. A debit note debits the account (the
 * client owes more), a credit note credits it. The running balance continues
 * the client's last entry, the way an invoice or a payment does.
 */
function postToLedger(note, { debit, credit, description }) {
  const id = newId('LED');
  db.prepare(`
    INSERT INTO client_ledgers (id, client_id, transaction_type, reference_id, credit, debit, running_balance, description, timestamp)
    VALUES (?, ?, ?, ?, ?, ?,
      COALESCE((SELECT running_balance FROM client_ledgers WHERE client_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1), 0) + ? - ?,
      ?, datetime('now'))
  `).run(id, note.client_id, note.note_type === 'DEBIT' ? 'DEBIT_NOTE' : 'CREDIT_NOTE', note.id,
    money(credit), money(debit), note.client_id, money(debit), money(credit), description);
  return id;
}

const withClient = (row) => {
  if (!row) return row;
  row.client_name = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(row.client_id)?.name || null;
  // A draft, a rejected note and a cancelled one move nothing.
  row.signed_amount = ['CANCELLED', 'REJECTED', 'DRAFT'].includes(row.status) ? 0 : signed(row.note_type, row.amount);
  row.on_ledger = !!row.ledger_entry_id;
  return row;
};

// ── List ─────────────────────────────────────────────────────────────────
router.get('/', requireRole(...READ), (req, res) => {
  const { client_id, billing_period, note_type, status, reason_code, trading_invoice_id, view_bill_invoice_id } = req.query;
  let sql = 'SELECT * FROM trading_debit_credit_notes WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  if (billing_period) { sql += ' AND billing_period = ?'; params.push(billing_period); }
  if (note_type) { sql += ' AND note_type = ?'; params.push(note_type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (reason_code) { sql += ' AND reason_code = ?'; params.push(reason_code); }
  if (trading_invoice_id) { sql += ' AND trading_invoice_id = ?'; params.push(trading_invoice_id); }
  if (view_bill_invoice_id) { sql += ' AND view_bill_invoice_id = ?'; params.push(view_bill_invoice_id); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withClient));
});

router.get('/reference', requireRole(...READ), (_req, res) => {
  res.json({
    reason_codes: REASONS,
    note_types: ['DEBIT', 'CREDIT'],
    statuses: ['ISSUED', 'SETTLED', 'CANCELLED'],
  });
});

/**
 * Net position per period — the number that closes the gap between what the
 * obligation report says and what the weekly payment report paid.
 */
router.get('/summary', requireRole(...READ), (req, res) => {
  const { client_id, billing_period } = req.query;
  // Only issued notes have moved anything; drafts, rejected and cancelled ones have not.
  const where = ["status IN ('ISSUED','SETTLED')"];
  const params = [];
  if (client_id) { where.push('client_id = ?'); params.push(client_id); }
  if (billing_period) { where.push('billing_period = ?'); params.push(billing_period); }
  const w = `WHERE ${where.join(' AND ')}`;

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN note_type = 'DEBIT'  THEN amount ELSE 0 END), 0) AS total_debit,
      COALESCE(SUM(CASE WHEN note_type = 'CREDIT' THEN amount ELSE 0 END), 0) AS total_credit,
      COUNT(*) AS note_count,
      (SELECT COUNT(*) FROM trading_debit_credit_notes WHERE status = 'DRAFT') AS awaiting_approval
    FROM trading_debit_credit_notes ${w}
  `).get(...params);

  const byPeriod = db.prepare(`
    SELECT billing_period,
      COALESCE(SUM(CASE WHEN note_type = 'DEBIT'  THEN amount ELSE 0 END), 0) AS debit,
      COALESCE(SUM(CASE WHEN note_type = 'CREDIT' THEN amount ELSE 0 END), 0) AS credit
    FROM trading_debit_credit_notes ${w}
    GROUP BY billing_period ORDER BY billing_period DESC
  `).all(...params).map((r) => ({ ...r, net: Math.round((r.debit - r.credit) * 100) / 100 }));

  res.json({
    ...totals,
    net_payable: Math.round((totals.total_debit - totals.total_credit) * 100) / 100,
    by_period: byPeriod,
  });
});

// ── Raise ────────────────────────────────────────────────────────────────
router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body || {};
  let resolvedClientId = b.client_id || null;

  if (!resolvedClientId && b.view_bill_invoice_id) {
    const linked = db.prepare(`
      SELECT v.id, v.client_name, v.bilateral_id, v.exchange_contract_id,
             bt.client_id AS bilateral_client_id, ec.client_id AS exchange_client_id
      FROM view_bill_invoices v
      LEFT JOIN bilateral_transactions bt ON bt.id = v.bilateral_id
      LEFT JOIN exchange_contracts ec ON ec.id = v.exchange_contract_id
      WHERE v.id = ?
    `).get(b.view_bill_invoice_id);
    resolvedClientId = linked?.bilateral_client_id || linked?.exchange_client_id || null;
    if (!resolvedClientId && linked?.client_name) {
      resolvedClientId = db.prepare(`
        SELECT id FROM trading_clients
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND status = 'ACTIVE'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(linked.client_name)?.id || null;
    }
  }

  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(resolvedClientId);
  if (!client) return res.status(404).json({ error: 'Trading client not found' });

  const noteType = b.note_type === 'CREDIT' ? 'CREDIT' : b.note_type === 'DEBIT' ? 'DEBIT' : null;
  if (!noteType) return res.status(400).json({ error: "note_type must be 'DEBIT' or 'CREDIT'" });

  if (!String(b.billing_period || '').trim()) {
    return res.status(400).json({ error: 'billing_period is required' });
  }

  const reason = REASONS.includes(b.reason_code) ? b.reason_code : 'OTHER';

  // The sign lives in note_type, so a signed amount here would double up. Take
  // the magnitude and let the caller's note_type decide the direction. A note
  // carries the value and the tax on it; `amount` alone still works, as a
  // tax-free note.
  const taxable = Math.abs(Number(b.taxable_amount ?? b.amount) || 0);
  const tax = Math.abs(Number(b.tax_amount || 0));
  if (taxable <= 0) return res.status(400).json({ error: 'amount must be greater than zero' });
  if (!Number.isFinite(tax)) return res.status(400).json({ error: 'tax_amount must be a number' });
  const amount = money(taxable + tax);

  if (b.trading_invoice_id) {
    const inv = db.prepare('SELECT id FROM trading_invoices WHERE id = ?').get(b.trading_invoice_id);
    if (!inv) return res.status(404).json({ error: 'Linked trading invoice not found' });
  }
  if (b.view_bill_invoice_id) {
    const inv = db.prepare('SELECT id, client_name, supply_from_date FROM view_bill_invoices WHERE id = ?').get(b.view_bill_invoice_id);
    if (!inv) return res.status(404).json({ error: 'Linked View Bills invoice not found' });
  }
  if (!b.trading_invoice_id && !b.view_bill_invoice_id) {
    return res.status(400).json({ error: 'Link the note to a trading invoice or a View Bills invoice' });
  }

  const id = newId('TDN');
  // Numbered when it is issued; a draft carries a placeholder so the register
  // never shows a number for something that has not been approved.
  const noteNo = `DRAFT-${id}`;

  db.prepare(`
    INSERT INTO trading_debit_credit_notes (
      id, note_no, note_type, client_id, trading_invoice_id, view_bill_invoice_id, billing_period, delivery_date,
      reason_code, quantum_mwh, rate_per_unit, amount, taxable_amount, tax_amount, tax_label,
      broker_reference, reason, status, model, created_by, created_by_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'V2', ?, ?)
  `).run(
    id, noteNo, noteType, client.id, b.trading_invoice_id || null, b.view_bill_invoice_id || null,
    String(b.billing_period).trim(), b.delivery_date || null, reason,
    b.quantum_mwh != null ? Number(b.quantum_mwh) : null,
    b.rate_per_unit != null ? Number(b.rate_per_unit) : null,
    amount, money(taxable), money(tax), b.tax_label || null,
    b.broker_reference || null, b.reason || null, req.user.name || req.user.id, req.user.id,
  );

  secureLogAudit(req, {
    action: noteType === 'DEBIT' ? 'DRAFT_TRADING_DEBIT_NOTE' : 'DRAFT_TRADING_CREDIT_NOTE',
    module: 'TRADING', entityType: 'trading_debit_credit_note', entityId: id,
    afterValue: {
      note_no: noteNo, client: client.name, billing_period: b.billing_period,
      reason_code: reason, amount, signed_amount: signed(noteType, amount),
    },
    reason: b.reason || null,
  });

  res.status(201).json(withClient(db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(id)));
});

// ── Approve → issue ──────────────────────────────────────────────────────
router.post('/:id/approve', requireRole(...WRITE), (req, res) => {
  try {
    const note = db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(req.params.id);
    if (!note) throw httpError(404, 'Note not found');
    if (note.status !== 'DRAFT') throw httpError(400, `Only a draft can be approved; this one is ${note.status}`);
    if ((note.created_by_id && note.created_by_id === req.user.id) || (!note.created_by_id && note.created_by === req.user.name)) {
      throw httpError(403, 'The note must be approved by someone other than the person who raised it');
    }
    const issued = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.issued_date || '')) ? req.body.issued_date : new Date().toISOString().slice(0, 10);
    const prefix = note.note_type === 'DEBIT' ? 'TDN' : 'TCN';
    const noteNo = `${prefix}/${fyOf(issued)}/${String(nextSeriesNo(prefix, fyOf(issued))).padStart(5, '0')}`;

    db.transaction(() => {
      db.prepare(`
        UPDATE trading_debit_credit_notes SET note_no = ?, status = 'ISSUED', issued_date = ?,
          approved_by = ?, approved_by_id = ?, approved_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(noteNo, issued, req.user.name, req.user.id || null, note.id);
      const fresh = db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(note.id);
      const ledgerId = postToLedger(fresh, {
        debit: fresh.note_type === 'DEBIT' ? fresh.amount : 0,
        credit: fresh.note_type === 'CREDIT' ? fresh.amount : 0,
        description: `${fresh.note_type === 'DEBIT' ? 'Debit' : 'Credit'} note ${noteNo} — ${fresh.reason_code.replace(/_/g, ' ').toLowerCase()} (${fresh.billing_period})`,
      });
      db.prepare('UPDATE trading_debit_credit_notes SET ledger_entry_id = ? WHERE id = ?').run(ledgerId, note.id);
    })();

    secureLogAudit(req, {
      action: note.note_type === 'DEBIT' ? 'ISSUE_TRADING_DEBIT_NOTE' : 'ISSUE_TRADING_CREDIT_NOTE',
      module: 'TRADING', entityType: 'trading_debit_credit_note', entityId: note.id,
      beforeValue: { status: 'DRAFT' },
      afterValue: { status: 'ISSUED', note_no: noteNo, amount: note.amount, posted_to_ledger: true },
    });
    res.json(withClient(db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(note.id)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/reject', requireRole(...WRITE), (req, res) => {
  const note = db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.status !== 'DRAFT') return res.status(400).json({ error: `Only a draft can be rejected; this one is ${note.status}` });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Say why the note is rejected' });
  db.prepare(`
    UPDATE trading_debit_credit_notes SET status = 'REJECTED', rejected_reason = ?, approved_by = ?, approved_by_id = ?,
      approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).run(reason, req.user.name, req.user.id || null, note.id);
  secureLogAudit(req, {
    action: 'REJECT_TRADING_NOTE', module: 'TRADING', entityType: 'trading_debit_credit_note', entityId: note.id,
    beforeValue: { status: 'DRAFT' }, afterValue: { status: 'REJECTED' }, reason,
  });
  res.json(withClient(db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(note.id)));
});

// ── Settle ───────────────────────────────────────────────────────────────
router.post('/:id/settle', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Note not found' });
  if (row.status !== 'ISSUED') {
    return res.status(400).json({ error: `Only an issued note can be settled; this one is ${row.status}` });
  }

  db.prepare(`
    UPDATE trading_debit_credit_notes
    SET status = 'SETTLED', settled_date = COALESCE(?, date('now')), updated_at = datetime('now')
    WHERE id = ?
  `).run(req.body?.settled_date || null, row.id);

  secureLogAudit(req, {
    action: 'SETTLE_TRADING_NOTE', module: 'TRADING',
    entityType: 'trading_debit_credit_note', entityId: row.id,
    beforeValue: { status: row.status }, afterValue: { status: 'SETTLED' },
  });
  res.json(withClient(db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(row.id)));
});

// ── Cancel ───────────────────────────────────────────────────────────────
// Cancelled, never deleted: the note is the evidence for a settlement figure,
// and withdrawing it has to leave a trace of who withdrew it and why.
router.post('/:id/cancel', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Note not found' });
  if (row.status === 'SETTLED') {
    return res.status(400).json({ error: 'A settled note cannot be cancelled — raise an opposite note instead.' });
  }
  if (row.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled' });

  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A cancellation reason is required' });

  db.transaction(() => {
    // An issued note is on the client's ledger, and a ledger is not rubbed out:
    // the cancellation is posted as the opposite entry.
    if (row.ledger_entry_id) {
      postToLedger(row, {
        debit: row.note_type === 'CREDIT' ? row.amount : 0,
        credit: row.note_type === 'DEBIT' ? row.amount : 0,
        description: `Cancellation of ${row.note_type === 'DEBIT' ? 'debit' : 'credit'} note ${row.note_no}: ${reason}`,
      });
    }
    db.prepare(`
      UPDATE trading_debit_credit_notes
      SET status = 'CANCELLED', cancelled_reason = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reason, row.id);
  })();

  secureLogAudit(req, {
    action: 'CANCEL_TRADING_NOTE', module: 'TRADING',
    entityType: 'trading_debit_credit_note', entityId: row.id,
    beforeValue: { status: row.status }, afterValue: { status: 'CANCELLED' }, reason,
  });
  res.json(withClient(db.prepare('SELECT * FROM trading_debit_credit_notes WHERE id = ?').get(row.id)));
});

export default router;
