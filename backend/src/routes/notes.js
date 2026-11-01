/**
 * REIA debit and credit notes.
 *
 * A note is a document of its own. It is raised as a DRAFT and does nothing
 * until someone other than its maker approves it; only then does it touch money:
 *
 *   DEBIT   the counterparty owes more. On approval it becomes its own
 *           SUPPLEMENTARY invoice, numbered as the note, with its own due date,
 *           payments and late payment surcharge. The invoice it refers to is
 *           not rewritten — the bill as issued stays the bill as issued.
 *   CREDIT  the counterparty owes less. On approval it is applied against the
 *           invoice as a deduction (not as cash, so collections are not
 *           inflated), up to what is still open on it. Anything left over stays
 *           on the note as available credit, to be applied to another open bill
 *           of the same contract.
 *
 * Notes raised before this (model LEGACY) were folded into the invoice's total
 * at once; they keep behaving that way, including on cancel.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { noteFromException } from '../services/noteEngine.js';
import { requireAuth, requireRole, ROLE_GROUPS, SELLER_ROLES, BUYER_ROLES, counterpartySide } from '../middleware/auth.js';
import { contractVisibleTo } from '../services/counterpartyScope.js';
import { newId, logAudit, pushNotification, nextSeriesNo, computeDueDate } from '../util.js';
import { payableNow } from '../disputesConstants.js';
import { notifyCounterparty } from '../paymentSecurityEngine.js';
import { onResolutionNoteDecided, setInvoiceOpenDispute } from './disputes.js';
import { trueUpPosition, raiseTrueUp } from '../services/cufTrueUp.js';
import {
  newDoc, header, sectionTitle, table, notes as footNotes, pageNumbers, M, CONTENT_W, INK, MUTED,
} from '../scripts/reportPdfKit.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.FINANCE])];
// Phase B.2: the maker (or Finance) drafts and applies a note; the checker (or
// Finance) approves, rejects or cancels it. Named FINANCE_USER rather than the
// FINANCE group, which also holds the REIA maker.
const MAKE = [...new Set([...ROLE_GROUPS.REIA_MAKE, 'FINANCE_USER'])];
const CHECK = [...new Set([...ROLE_GROUPS.REIA_CHECK, 'FINANCE_USER'])];

const REASONS = ['REVISED_REA', 'CHANGE_IN_LAW', 'TRANSMISSION_CHARGES', 'LPS', 'COMPENSATION_EVENT',
  'LIQUIDATED_DAMAGES', 'SCHEDULE_SHORTFALL_PURCHASE', 'SCHEDULE_EXCESS_RETURN', 'OTHER'];
const REASON_LABEL = {
  REVISED_REA: 'Revised / amended REA',
  CHANGE_IN_LAW: 'Change in Law',
  TRANSMISSION_CHARGES: 'Transmission / wheeling charges',
  LPS: 'Late Payment Surcharge',
  COMPENSATION_EVENT: 'Compensation event',
  LIQUIDATED_DAMAGES: 'Liquidated damages',
  SCHEDULE_SHORTFALL_PURCHASE: 'Schedule shortfall purchase',
  SCHEDULE_EXCESS_RETURN: 'Schedule excess return',
  OTHER: 'Other',
};
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
// The desk's calendar day (IST): a note approved after midnight here was dated yesterday.
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
// A note adjusts a bill once it has been issued; before that the bill itself is corrected.
const ADJUSTABLE = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'DISPUTED'];
// A YYYY-MM-DD that is a day on the calendar (31 February is not).
const isRealDate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

/**
 * Why a credit note may not take back the tax it carries, or null. CGST Act
 * s.34: no more than the bill charged, less tax already credited on it; and
 * not after 30 November following the end of the financial year of the
 * supply — past that it can credit the value alone.
 */
function creditTaxRefusal(inv, tax, issuedOn, excludeId = null) {
  if (!(tax > 0)) return null;
  const already = db.prepare(`
    SELECT COALESCE(SUM(tax_amount), 0) s FROM debit_credit_notes
    WHERE invoice_id = ? AND note_type = 'CREDIT' AND status IN ('DRAFT','ISSUED','SETTLED') AND model = 'V2' AND id IS NOT ?
  `).get(inv.id, excludeId).s;
  const charged = Number(inv.taxes) || 0;
  if (tax + already > charged + 0.005) {
    return `${inv.invoice_no} charged tax of Rs.${charged.toLocaleString('en-IN')}${already ? ` and Rs.${already.toLocaleString('en-IN')} of it is already credited` : ''}: a credit note can take back at most Rs.${money(Math.max(0, charged - already)).toLocaleString('en-IN')} of tax.`;
  }
  const period = /^\d{4}-\d{2}$/.test(String(inv.billing_period || '')) ? inv.billing_period : null;
  if (period) {
    const [y, m] = period.split('-').map(Number);
    const fyEnd = m >= 4 ? y + 1 : y;
    const lastDay = `${fyEnd}-11-30`;
    if (issuedOn > lastDay) {
      return `${inv.invoice_no} is for ${period}, in FY ${fyEnd - 1}-${String(fyEnd % 100).padStart(2, '0')}; tax on that supply could be credited until 30 November ${fyEnd} (CGST Act s.34(2)). Raise the credit for the value alone, without tax.`;
    }
  }
  return null;
}
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** April-start financial year of a date, as "2026-27". */
function fyOf(isoDate) {
  const [y, m] = String(isoDate).slice(0, 7).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

function paidOn(invoiceId) {
  return db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(invoiceId).s;
}

/** What is still open on an invoice: payable (net of rebate, with LPS) less everything paid or credited. */
function openOn(inv) {
  return money(Math.max(0, payableNow(inv).payable_now - paidOn(inv.id)));
}

/**
 * Re-read whether a bill is paid once a note has moved it. A debit note on a
 * PAID bill (LEGACY) leaves money owing again; a credit can finish a bill that
 * was part-paid, and cancelling one can reopen it. Only the paid/part-paid
 * states move — a bill in dispute or not yet sent keeps its own status.
 */
function resettle(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) return;
  const paid = paidOn(invoiceId);
  const payable = payableNow(inv).payable_now;
  if (['PAID', 'PARTIALLY_PAID'].includes(inv.status)) {
    const next = paid >= payable - 0.005 ? 'PAID' : (paid > 0 ? 'PARTIALLY_PAID' : 'SENT');
    if (next !== inv.status) db.prepare(`UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(next, invoiceId);
  } else if (['SENT', 'APPROVED'].includes(inv.status) && paid > 0) {
    const next = paid >= payable - 0.005 ? 'PAID' : 'PARTIALLY_PAID';
    db.prepare(`UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(next, invoiceId);
  }
}

// LEGACY only: the note was folded into the invoice itself.
const signedDelta = (type, amount) => (type === 'DEBIT' ? 1 : -1) * (Number(amount) || 0);
function applyLegacyToInvoice(invoiceId, delta) {
  db.prepare(`UPDATE invoices SET other_adjustments = COALESCE(other_adjustments,0) + ?, total_amount = COALESCE(total_amount,0) + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(delta, delta, invoiceId);
  resettle(invoiceId);
}

/** Credit applied from a note to an invoice, as deduction rows on the payments ledger. */
function creditRows(note) {
  return db.prepare(`
    SELECT p.*, i.invoice_no FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.mode = 'CREDIT_NOTE' AND p.reference = ?
  `).all(note.note_no);
}

function applyCredit(note, inv, onDate, amount) {
  const take = money(Math.min(amount, openOn(inv)));
  if (take <= 0.005) return 0;
  db.prepare(`
    INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction, remarks)
    VALUES (?, ?, 0, ?, 'CREDIT_NOTE', ?, ?, ?)
  `).run(newId('PAY'), inv.id, onDate, note.note_no, take, `Credit note ${note.note_no}`);
  db.prepare(`UPDATE debit_credit_notes SET applied_amount = applied_amount + ?, updated_at = datetime('now') WHERE id = ?`).run(take, note.id);
  resettle(inv.id);
  return take;
}

/** A note as a screen reads it: what it is against, what it became, what is left. */
function present(n) {
  if (!n) return n;
  const inv = db.prepare('SELECT invoice_no, direction, status FROM invoices WHERE id = ?').get(n.invoice_id);
  const supp = n.supp_invoice_id
    ? db.prepare('SELECT id, invoice_no, status, total_amount, due_date FROM invoices WHERE id = ?').get(n.supp_invoice_id)
    : null;
  const suppPaid = supp ? paidOn(supp.id) : 0;
  let effective = n.status;
  if (n.model === 'V2' && n.status === 'ISSUED') {
    if (n.note_type === 'DEBIT' && supp?.status === 'PAID') effective = 'SETTLED';
    if (n.note_type === 'CREDIT' && money(n.amount - n.applied_amount) <= 0.005) effective = 'SETTLED';
  }
  return {
    ...n,
    invoice_no: inv?.invoice_no || null,
    direction: inv?.direction || null,
    effective_status: effective,
    supplementary_invoice: supp ? { ...supp, paid: suppPaid } : null,
    unapplied_credit: n.note_type === 'CREDIT' && n.model === 'V2' && n.status === 'ISSUED' ? money(n.amount - n.applied_amount) : 0,
    credit_applications: n.note_type === 'CREDIT' && n.model === 'V2'
      ? creditRows(n).map((p) => ({ invoice_no: p.invoice_no, amount: p.deduction, date: p.payment_date }))
      : [],
    reason_label: REASON_LABEL[n.reason_code] || n.reason_code,
  };
}

const getNote = (id) => db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(id);

router.get('/', requireRole(...READ), (req, res) => {
  const { invoice_id, contract_id, note_type, status } = req.query;
  let sql = 'SELECT * FROM debit_credit_notes WHERE 1=1';
  const params = [];
  if (invoice_id) { sql += ' AND invoice_id = ?'; params.push(invoice_id); }
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (note_type) { sql += ' AND note_type = ?'; params.push(note_type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(present));
});

/**
 * D3: Finance's approval queue — every draft note, with what it is for. A
 * note a dispute asked for carries the dispute, its evidence and the
 * resolver's reasoning beside the Approve button, so Finance decides on the
 * record rather than on the amount alone.
 */
router.get('/approval-queue', requireRole(...READ), (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, i.invoice_no, i.direction, i.billing_period, c.contract_no,
      CASE WHEN i.direction = 'SJVN_TO_BUYER' THEN b.name ELSE s.name END AS counterparty
    FROM debit_credit_notes n
    JOIN invoices i ON i.id = n.invoice_id
    LEFT JOIN contracts c ON c.id = COALESCE(n.contract_id, i.contract_id)
    LEFT JOIN entities s ON s.id = c.seller_id LEFT JOIN entities b ON b.id = c.buyer_id
    WHERE n.status = 'DRAFT' AND n.model = 'V2'
    ORDER BY n.created_at
  `).all();
  const docs = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };
  const sourceOf = (n, d) => (d ? 'DISPUTE' : n.source_kind ? n.source_kind
    : /^Reconciliation /.test(n.reason || '') ? 'RECON_EXCEPTION'
      : /^CUF true-up/.test(n.reason || '') ? 'CUF_SHORTFALL'
        : /^Power diversion /.test(n.reason || '') ? 'DIVERSION' : 'DESK');
  res.json(rows.map((n) => {
    const d = db.prepare('SELECT * FROM disputes WHERE resolution_note_id = ?').get(n.id);
    return {
      ...present(n),
      invoice_no: n.invoice_no, contract_no: n.contract_no, counterparty: n.counterparty, billing_period: n.billing_period,
      source: sourceOf(n, d),
      age_days: Math.floor((Date.now() - Date.parse(`${String(n.created_at).replace(' ', 'T')}Z`)) / 86400000),
      can_approve: !((n.created_by_id && n.created_by_id === req.user.id) || (!n.created_by_id && n.created_by === req.user.name)),
      dispute: d ? {
        id: d.id, dispute_no: d.dispute_no, reason_code: d.reason_code, charge_line: d.charge_line,
        issue_description: d.issue_description, disputed_amount: d.disputed_amount, raised_by_role: d.raised_by_role,
        outcome: d.resolution_outcome, accepted_amount: d.accepted_amount, resolution_notes: d.resolution_notes,
        resolved_by: d.resolved_by, resolved_at: d.resolved_at,
        evidence: docs(d.supporting_docs).map((f) => ({ name: f.original_name || f.filename, url: `/api/disputes/${d.id}/evidence/${encodeURIComponent(f.filename)}`, uploaded_by: f.uploaded_by, note: f.note })),
      } : null,
    };
  }));
});

router.get('/reference', requireRole(...READ), (_req, res) => {
  res.json({ reason_codes: REASONS.map((c) => ({ code: c, label: REASON_LABEL[c] })) });
});

// Only issued notes have moved money; drafts, rejected and cancelled ones have not.
router.get('/summary', requireRole(...READ), (req, res) => {
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN note_type='DEBIT' AND status IN ('ISSUED','SETTLED') THEN amount ELSE 0 END),0) total_debit,
    COALESCE(SUM(CASE WHEN note_type='CREDIT' AND status IN ('ISSUED','SETTLED') THEN amount ELSE 0 END),0) total_credit,
    COALESCE(SUM(CASE WHEN status='DRAFT' THEN 1 ELSE 0 END),0) awaiting_approval,
    COUNT(*) total_notes FROM debit_credit_notes`).get();
  res.json({ ...row, net: Math.round(row.total_debit - row.total_credit) });
});

// ── Raise (DRAFT) ────────────────────────────────────────────────────────────
router.post('/', requireRole(...MAKE), (req, res) => {
  const b = req.body || {};
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(b.invoice_id);
  if (!inv) return res.status(404).json({ error: 'Linked invoice not found' });
  if (inv.status === 'CANCELLED') return res.status(400).json({ error: 'Cannot raise a note against a cancelled invoice' });
  if (inv.status === 'DRAFT') return res.status(400).json({ error: 'The invoice is still a draft — correct the draft instead of raising a note' });
  // Only a bill already issued is adjusted by a note: one with the developer's
  // checker, or SJVN's approval, or sent back, is corrected itself (1-Nov-2026).
  if (!ADJUSTABLE.includes(inv.status)) {
    return res.status(400).json({ error: `${inv.invoice_no} is ${inv.status.replace(/_/g, ' ').toLowerCase()} — not yet issued, so it is corrected itself rather than by a note` });
  }
  const note_type = b.note_type === 'CREDIT' ? 'CREDIT' : b.note_type === 'DEBIT' ? 'DEBIT' : null;
  if (!note_type) return res.status(400).json({ error: 'note_type must be DEBIT or CREDIT' });

  // Taxable value plus the tax on it. `amount` alone is accepted as a
  // tax-free note, which is how the form sent it before.
  // A negative figure is refused, not turned round (1-Nov-2026): -5,000 went
  // out as a debit of 5,000. A credit is raised as a credit. So is a figure
  // that rounds to nothing.
  const rawTaxable = Number(b.taxable_amount ?? b.amount);
  const rawTax = Number(b.tax_amount || 0);
  if (!Number.isFinite(rawTaxable) || money(rawTaxable) <= 0) return res.status(400).json({ error: 'A positive taxable amount is required' });
  if (!Number.isFinite(rawTax) || rawTax < 0) return res.status(400).json({ error: 'tax_amount must be zero or more' });
  const taxable = money(rawTaxable);
  const tax = money(rawTax);
  const amount = money(taxable + tax);
  // A reason the desk does not know is refused, not filed as a revised REA: a
  // mistyped Change in Law went out as an REA revision (31-Oct-2026).
  if (b.reason_code != null && b.reason_code !== '' && !REASONS.includes(b.reason_code)) {
    return res.status(400).json({ error: `Unknown reason ${b.reason_code}; the reason is one of ${REASONS.join(', ')}` });
  }
  const reason_code = b.reason_code || 'REVISED_REA';
  if (!b.reason || String(b.reason).trim().length < 5) {
    return res.status(400).json({ error: 'Say what the note is for (at least a few words) — it is printed on the note' });
  }

  // The same note twice — a double click, or two people on one figure — is
  // refused while the first is live (1-Nov-2026).
  const twin = db.prepare(`
    SELECT note_no, status FROM debit_credit_notes
    WHERE invoice_id = ? AND note_type = ? AND amount = ? AND reason = ? AND status IN ('DRAFT', 'ISSUED') AND model = 'V2'
  `).get(inv.id, note_type, amount, String(b.reason).trim());
  if (twin) {
    return res.status(409).json({
      error: `This note is already raised against ${inv.invoice_no}${twin.status === 'ISSUED' ? ` as ${twin.note_no}` : ', awaiting approval'} — same type, amount and reason.`,
      existing_note_no: twin.note_no,
    });
  }

  if (note_type === 'CREDIT') {
    const taxRefusal = creditTaxRefusal(inv, tax, today());
    if (taxRefusal) return res.status(400).json({ error: taxRefusal });
    // Live credits on this bill, drafts included, cannot exceed what it billed.
    const live = db.prepare(`
      SELECT COALESCE(SUM(amount),0) s FROM debit_credit_notes
      WHERE invoice_id = ? AND note_type = 'CREDIT' AND status IN ('DRAFT','ISSUED','SETTLED') AND model = 'V2'
    `).get(inv.id).s;
    if (amount + live > (Number(inv.total_amount) || 0) + 0.005) {
      return res.status(400).json({
        error: `Credit notes on ${inv.invoice_no} would come to ${money(amount + live)}, more than the bill's total of ${inv.total_amount}`,
      });
    }
  }

  const id = newId('DCN');
  db.prepare(`
    INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month,
      reason_code, amount, taxable_amount, tax_amount, tax_label, reason, status, model, created_by, created_by_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 'V2', ?, ?)
  `).run(id, `DRAFT-${id}`, note_type, inv.id, inv.contract_id, inv.billing_period,
    reason_code, amount, money(taxable), money(tax), b.tax_label || null, String(b.reason).trim(),
    req.user.name, req.user.id || null);

  logAudit({ req, user: req.user, action: 'RAISE_NOTE_DRAFT', module: 'REIA', entityType: 'debit_credit_note', entityId: id, details: { note_type, amount, reason_code, invoice_no: inv.invoice_no } });
  pushNotification({ role: 'FINANCE_USER', type: 'DC_NOTE_FOR_APPROVAL', message: `${note_type === 'DEBIT' ? 'Debit' : 'Credit'} note of Rs.${amount.toLocaleString('en-IN')} against ${inv.invoice_no} awaits approval` });
  res.status(201).json(present(getNote(id)));
});

// ── Year-end CUF true-up ─────────────────────────────────────────────────────
// CUF is assessed over the contract year; a finished year's shortfall is raised
// here as a DRAFT credit note and approved like any other note.
router.get('/cuf-true-up', requireRole(...READ), (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.query.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  try {
    res.json(trueUpPosition(contract, Number(req.query.contract_year)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// R4 / G3 / V4: one click from an accepted exception, a CUF shortfall or the
// verifier's damages to a draft note (services/noteEngine.js).
router.post('/from-exception', requireRole(...MAKE), (req, res) => {
  try {
    const b = req.body || {};
    const ref = b.ref || b.exception_id || b.invoice_id || (b.contract_id && b.contract_year ? `${b.contract_id}:${b.contract_year}` : null);
    const note = noteFromException({ kind: b.kind, ref, user: req.user, req });
    res.status(201).json(present(getNote(note.id)));
  } catch (err) {
    if (!err.status) console.error('[NOTES] from-exception', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong', ...(err.extra || {}) });
  }
});

router.post('/cuf-true-up', requireRole(...MAKE), (req, res) => {
  try {
    const note = noteFromException({ kind: 'CUF_SHORTFALL', ref: `${req.body?.contract_id}:${req.body?.contract_year}`, user: req.user, req });
    res.status(201).json(note.true_up);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, ...(err.extra || {}) });
  }
});

// ── Approve → issue ──────────────────────────────────────────────────────────
router.post('/:id/approve', requireRole(...CHECK), (req, res) => {
  try {
    const note = getNote(req.params.id);
    if (!note) throw httpError(404, 'Note not found');
    if (note.status !== 'DRAFT') throw httpError(400, `Only a draft can be approved — this note is ${note.status}`);
    if ((note.created_by_id && note.created_by_id === req.user.id) || (!note.created_by_id && note.created_by === req.user.name)) {
      throw httpError(403, 'The note must be approved by someone other than the person who raised it');
    }
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(note.invoice_id);
    if (!inv || inv.status === 'CANCELLED') throw httpError(400, 'The invoice this note refers to has been cancelled');
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(note.contract_id);

    // A real date, not after today and not before the bill it adjusts was
    // issued: 31 February was taken, and numbered (1-Nov-2026).
    const asked = req.body?.issued_date;
    const issued = asked == null || asked === '' ? today() : String(asked);
    if (!isRealDate(issued)) throw httpError(400, `${issued} is not a date`);
    if (issued > today()) throw httpError(400, `A note is issued on or before today (${today()}), not on ${issued}`);
    // Against the day the bill went out, where that is recorded; a bill's row
    // date is not its issue date (an imported or migrated bill's is the import).
    const billOn = String(inv.issued_at || '').slice(0, 10);
    if (billOn && issued < billOn) throw httpError(400, `${inv.invoice_no} was issued on ${billOn}; a note against it cannot be dated ${issued}`);
    if (note.note_type === 'CREDIT') {
      const taxRefusal = creditTaxRefusal(inv, Number(note.tax_amount) || 0, issued, note.id);
      if (taxRefusal) throw httpError(400, taxRefusal);
    }
    const prefix = note.note_type === 'DEBIT' ? 'DN' : 'CN';
    const fy = fyOf(issued);
    const noteNo = `${prefix}/${fy}/${String(nextSeriesNo(prefix, fy)).padStart(5, '0')}`;
    const dueDate = computeDueDate(issued, contract);

    let suppId = null;
    let applied = 0;
    db.transaction(() => {
      db.prepare(`
        UPDATE debit_credit_notes SET note_no = ?, status = 'ISSUED', issued_date = ?, due_date = ?,
          approved_by = ?, approved_by_id = ?, approved_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(noteNo, issued, note.note_type === 'DEBIT' ? dueDate : null, req.user.name, req.user.id || null, note.id);
      const issuedNote = getNote(note.id);

      if (note.note_type === 'DEBIT') {
        // Its own bill: numbered as the note, payable to its own due date.
        suppId = newId('INV');
        const breakdown = [
          { code: 'DN', label: `${REASON_LABEL[note.reason_code] || note.reason_code} — ${note.reason}`, value: note.taxable_amount },
          ...(note.tax_amount ? [{ code: 'TAX', label: note.tax_label || 'Tax on the note', value: note.tax_amount }] : []),
          { code: 'TOTAL', label: `Debit note ${noteNo} against ${inv.invoice_no}`, value: note.amount },
        ];
        db.prepare(`
          INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
            tariff_per_unit, energy_charges, taxes, other_adjustments, total_amount, invoice_breakdown_json,
            disputed_amount, due_date, status, parent_invoice_id, billing_family_ref, issued_at, created_by, created_by_id)
          VALUES (?, ?, ?, 'SUPPLEMENTARY', ?, ?, 0, 0, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `).run(suppId, noteNo, inv.contract_id, inv.direction, inv.billing_period,
          note.taxable_amount, note.tax_amount, note.amount, JSON.stringify(breakdown), dueDate,
          inv.direction === 'SJVN_TO_BUYER' ? 'SENT' : 'APPROVED',
          inv.id, inv.billing_family_ref || null, issued, req.user.name, req.user.id || null);
        db.prepare('UPDATE debit_credit_notes SET supp_invoice_id = ? WHERE id = ?').run(suppId, note.id);
      } else {
        // A credit agreed on a dispute was held off the bill while it waited for
        // approval; the hold is lifted first, or there is nothing open to set it against.
        let target = inv;
        if (db.prepare('SELECT 1 FROM disputes WHERE resolution_note_id = ?').get(note.id)) {
          setInvoiceOpenDispute(inv.id);
          target = db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
        }
        applied = applyCredit(issuedNote, target, issued, note.amount);
      }
    })();

    logAudit({ req, user: req.user, action: 'ISSUE_NOTE', module: 'REIA', entityType: 'debit_credit_note', entityId: note.id, details: { note_no: noteNo, note_type: note.note_type, amount: note.amount, supp_invoice_id: suppId, applied } });
    // A note that settles a dispute tells the dispute it has been issued.
    onResolutionNoteDecided(note.id, 'ISSUED', req.user, { note_no: noteNo });
    // To the bill's own company, not every buyer or seller on the platform.
    notifyCounterparty(inv.contract_id, inv.direction === 'SELLER_TO_SJVN' ? 'SELLER' : 'BUYER', 'DC_NOTE_ISSUED',
      `${note.note_type === 'DEBIT' ? 'Debit' : 'Credit'} Note ${noteNo} of Rs.${note.amount.toLocaleString('en-IN')} issued against ${inv.invoice_no}`);
    res.json(present(getNote(note.id)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/:id/reject', requireRole(...CHECK), (req, res) => {
  const note = getNote(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (note.status !== 'DRAFT') return res.status(400).json({ error: `Only a draft can be rejected — this note is ${note.status}` });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Say why the note is rejected' });
  db.prepare(`UPDATE debit_credit_notes SET status = 'REJECTED', rejected_reason = ?, approved_by = ?, approved_by_id = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(reason, req.user.name, req.user.id || null, note.id);
  logAudit({ req, user: req.user, action: 'REJECT_NOTE', module: 'REIA', entityType: 'debit_credit_note', entityId: note.id, details: { reason } });
  // Not approving the credit a dispute resolution asked for reopens that dispute.
  onResolutionNoteDecided(note.id, 'REJECTED', req.user, { reason });
  res.json(present(getNote(note.id)));
});

// ── Apply leftover credit to another open bill of the same contract ─────────
router.post('/:id/apply', requireRole(...MAKE), (req, res) => {
  try {
    const note = getNote(req.params.id);
    if (!note) throw httpError(404, 'Note not found');
    if (note.note_type !== 'CREDIT' || note.model !== 'V2' || note.status !== 'ISSUED') {
      throw httpError(400, 'Only an issued credit note has credit to apply');
    }
    const left = money(note.amount - note.applied_amount);
    if (left <= 0.005) throw httpError(400, `${note.note_no} has no credit left to apply`);
    const origin = db.prepare('SELECT * FROM invoices WHERE id = ?').get(note.invoice_id);
    const target = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.body?.invoice_id);
    if (!target) throw httpError(404, 'Invoice to apply the credit to was not found');
    if (target.contract_id !== note.contract_id || target.direction !== origin.direction) {
      throw httpError(400, 'Credit can only be applied to a bill of the same contract, in the same direction');
    }
    if (['DRAFT', 'CANCELLED'].includes(target.status)) throw httpError(400, `${target.invoice_no} is ${target.status}`);
    let applied = 0;
    db.transaction(() => { applied = applyCredit(note, target, today(), left); })();
    if (!applied) throw httpError(400, `${target.invoice_no} has nothing open to set the credit against`);
    logAudit({ req, user: req.user, action: 'APPLY_CREDIT_NOTE', module: 'REIA', entityType: 'debit_credit_note', entityId: note.id, details: { to: target.invoice_no, applied } });
    res.json(present(getNote(note.id)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Cancel ───────────────────────────────────────────────────────────────────
router.post('/:id/cancel', requireRole(...CHECK), (req, res) => {
  try {
    const note = getNote(req.params.id);
    if (!note) throw httpError(404, 'Note not found');
    if (['CANCELLED', 'REJECTED'].includes(note.status)) throw httpError(400, `Note is already ${note.status.toLowerCase()}`);
    const reason = String(req.body?.reason || '').trim() || null;
    // An issued note has gone out; taking it back is recorded with why (1-Nov-2026).
    if (note.status !== 'DRAFT' && !reason) throw httpError(400, 'Say why the note is cancelled — it was issued');

    db.transaction(() => {
      if (note.model === 'LEGACY') {
        // Reverse the effect it applied when issued.
        applyLegacyToInvoice(note.invoice_id, -signedDelta(note.note_type, note.amount));
      } else if (note.status !== 'DRAFT') {
        if (note.note_type === 'DEBIT' && note.supp_invoice_id) {
          const paid = paidOn(note.supp_invoice_id);
          if (paid > 0) throw httpError(400, `${note.note_no} has Rs.${paid} paid against it — raise a credit note instead of cancelling`);
          db.prepare(`UPDATE invoices SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).run(note.supp_invoice_id);
        }
        if (note.note_type === 'CREDIT') {
          const rows = creditRows(note);
          db.prepare(`DELETE FROM payments WHERE mode = 'CREDIT_NOTE' AND reference = ?`).run(note.note_no);
          for (const r of rows) resettle(r.invoice_id);
          db.prepare('UPDATE debit_credit_notes SET applied_amount = 0 WHERE id = ?').run(note.id);
        }
      }
      db.prepare("UPDATE debit_credit_notes SET status='CANCELLED', cancel_reason = ?, updated_at=datetime('now') WHERE id=?").run(reason, note.id);
    })();
    logAudit({ req, user: req.user, action: 'CANCEL_NOTE', module: 'REIA', entityType: 'debit_credit_note', entityId: note.id, details: { reason } });
    // A credit that settled a dispute, taken back, unsettles it: the dispute
    // goes back to review and its amount is held again, not demanded. It stayed
    // resolved while the bill asked for the money (1-Nov-2026).
    if (note.status !== 'DRAFT') onResolutionNoteDecided(note.id, 'CANCELLED', req.user, { reason });
    res.json(present(getNote(note.id)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── The note as a document ───────────────────────────────────────────────────
// The company a note was issued to may download it too (1-Nov-2026): it is
// their document for GST, and they had only the notification of it.
router.get('/:id/pdf', requireRole(...READ, ...SELLER_ROLES, ...BUYER_ROLES), (req, res) => {
  const n = present(getNote(req.params.id));
  if (!n) return res.status(404).json({ error: 'Note not found' });
  const side = counterpartySide(req.user);
  if (side) {
    const c = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(n.contract_id);
    const theirs = side === 'BUYER' ? n.direction === 'SJVN_TO_BUYER' : n.direction === 'SELLER_TO_SJVN';
    if (!theirs || !contractVisibleTo(req.user, c) || !['ISSUED', 'CANCELLED'].includes(n.status)) {
      return res.status(404).json({ error: 'Note not found' });
    }
  }
  if (n.status === 'DRAFT' || n.status === 'REJECTED') {
    return res.status(400).json({ error: 'Only an issued note has a document — this one is not issued' });
  }
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(n.invoice_id);
  const contract = db.prepare('SELECT contract_no, seller_id, buyer_id FROM contracts WHERE id = ?').get(n.contract_id);
  const partyId = inv?.direction === 'SELLER_TO_SJVN' ? contract?.seller_id : contract?.buyer_id;
  const party = partyId ? db.prepare('SELECT name, gst_no AS gstin FROM entities WHERE id = ?').get(partyId) : null;
  const title = n.note_type === 'DEBIT' ? 'Debit Note' : 'Credit Note';

  const doc = newDoc(res, `${title} ${n.note_no}`, `${n.note_no.replace(/\//g, '-')}.pdf`);
  header(doc, { vertical: 'REIA', title, subtitle: `${n.note_no}  ·  ${n.status === 'CANCELLED' ? 'CANCELLED' : `issued ${n.issued_date}`}` });
  let y = 90;
  doc.fillColor(INK).font('Helvetica').fontSize(9);
  const lines = [
    ['Against invoice', `${inv?.invoice_no || '—'} (${inv?.billing_period || '—'})`],
    ['Contract', contract?.contract_no || '—'],
    [inv?.direction === 'SELLER_TO_SJVN' ? 'Seller' : 'Buyer', `${party?.name || '—'}${party?.gstin ? `  ·  GSTIN ${party.gstin}` : ''}`],
    ['Reason', `${n.reason_label} — ${n.reason}`],
    ...(n.note_type === 'DEBIT' ? [['Payable by', n.due_date || '—']] : []),
    ['Approved by', `${n.approved_by || '—'}  (raised by ${n.created_by || '—'})`],
  ];
  for (const [k, v] of lines) {
    doc.fillColor(MUTED).text(k, M, y, { width: 120 });
    doc.fillColor(INK).text(v, M + 125, y, { width: CONTENT_W - 125 });
    y += 16;
  }
  y = sectionTitle(doc, y + 8, 'Amount');
  const ctx = { vertical: 'REIA', title, subtitle: n.note_no };
  const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  y = table(doc, y, [
    { label: 'Particulars', w: CONTENT_W - 140, value: (r) => r.label },
    { label: 'Rs', w: 140, align: 'right', value: (r) => r.value },
  ], [
    { label: 'Taxable value', value: fmt(n.taxable_amount ?? n.amount) },
    { label: n.tax_label || 'Tax', value: fmt(n.tax_amount) },
    { label: `Total ${n.note_type === 'DEBIT' ? 'payable' : 'credited'}`, value: fmt(n.amount) },
  ], ctx, { fontSize: 8.5, rowH: 18 });
  const tail = n.note_type === 'DEBIT'
    ? [`Billed as its own supplementary invoice ${n.supplementary_invoice?.invoice_no || n.note_no}; late payment surcharge runs from ${n.due_date || 'its due date'}.`]
    : [`Applied: Rs ${Number(n.applied_amount || 0).toLocaleString('en-IN')}${n.credit_applications.length ? ` (${n.credit_applications.map((a) => `${a.invoice_no} Rs ${a.amount}`).join(', ')})` : ''}. Unapplied: Rs ${n.unapplied_credit.toLocaleString('en-IN')}.`];
  footNotes(doc, y + 12, tail);
  pageNumbers(doc);
  doc.end();
});

export default router;
