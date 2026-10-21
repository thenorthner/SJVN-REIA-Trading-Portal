import { Router } from 'express';
import multer from 'multer';
import { unreadablePdf, UNREADABLE_PDF_MESSAGE } from '../services/fileChecks.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide, SELLER_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, nextSeriesNo } from '../util.js';
import { notifyCounterparty, notifyDesk } from '../paymentSecurityEngine.js';
import { dispatch } from '../services/notificationService.js';
import {
  REASON_CODES,
  CHARGE_LINES,
  OPEN_STATUSES,
  SLA_ACK_DAYS,
  SLA_RESOLVE_DAYS,
  SLA_LONG_PENDING_DAYS,
  addDaysIso,
  invoiceChargeBreakdown,
  payableNow,
  genDisputeNo,
  ALLOWED_TRANSITIONS,
  CHARGE_LABELS,
  daysBetween,
} from '../disputesConstants.js';
import { getParamNumber } from '../mastersService.js';
import { invoicePresentedTo, billPresentedOn, authoredBy, isPresented } from '../services/counterpartyScope.js';
import { invoiceBalance } from '../services/invoiceLps.js';
import { asOfFrom } from '../services/clock.js';
import { raiseRootCauseTask } from '../services/deskTasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Overridable so a test run or the browser suite files its evidence beside its
// throwaway database instead of among the real disputes' documents.
const uploadDir = process.env.SJVN_DISPUTE_DOC_DIR || path.join(__dirname, '../../uploads/disputes');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });
const EVIDENCE_TYPES = ['.pdf', '.png', '.jpg', '.jpeg', '.xlsx', '.xls', '.csv', '.doc', '.docx', '.txt', '.eml', '.msg'];

const router = Router();
router.use(requireAuth);

/**
 * Tell the company that raised a dispute — and only it. These went to a role, so
 * every buyer heard how a seller's dispute ended, with the invoice number.
 */
function tellRaiser(dispute, type, message) {
  const inv = db.prepare('SELECT contract_id FROM invoices WHERE id = ?').get(dispute.invoice_id);
  if (inv && ['SELLER', 'BUYER'].includes(dispute.raised_by_role)) notifyCounterparty(inv.contract_id, dispute.raised_by_role, type, message);
}


const REIA_ROLES = ROLE_GROUPS.REIA_ALL;
const REIA_WRITE = ROLE_GROUPS.REIA_WRITE;

function isReia(user) {
  return REIA_ROLES.includes(user.role);
}

function recordEvent(disputeId, user, eventType, fromStatus, toStatus, details) {
  db.prepare(`
    INSERT INTO dispute_events (id, dispute_id, actor_id, actor_name, event_type, from_status, to_status, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId('DEV'),
    disputeId,
    user?.id ?? null,
    user?.name ?? 'system',
    eventType,
    fromStatus ?? null,
    toStatus ?? null,
    details ? JSON.stringify(details) : null
  );
}

function parseDocs(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function enrichDispute(row, { includeInternal = false } = {}) {
  if (!row) return row;
  const docs = parseDocs(row.supporting_docs);
  const ageingDays = Math.floor((Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24));
  return {
    ...row,
    supporting_docs: docs,
    raised_by: row.raised_by_role,
    ageing_days: ageingDays,
    sla_breached: !!row.sla_breached_at,
    long_pending: ageingDays >= SLA_LONG_PENDING_DAYS,
  };
}

function canAccessDispute(user, dispute) {
  if (isReia(user) || user.role === 'SJVN_ADMIN') return true;
  const inv = db.prepare(`
    SELECT i.*, c.seller_id, c.buyer_id FROM invoices i
    JOIN contracts c ON c.id = i.contract_id WHERE i.id = ?
  `).get(dispute.invoice_id);
  if (!inv) return false;
  const side = counterpartySide(user);
  if (side === 'SELLER') return inv.seller_id === user.linked_entity_id;
  if (side === 'BUYER') return inv.buyer_id === user.linked_entity_id;
  return false;
}

function scopedListSql(user) {
  let sql = `
    SELECT d.*, i.invoice_no, i.total_amount as invoice_total, i.disputed_amount as invoice_disputed,
           i.billing_period, i.direction, i.contract_id, c.contract_no, c.seller_id, c.buyer_id,
           es.name as seller_name, eb.name as buyer_name
    FROM disputes d
    JOIN invoices i ON i.id = d.invoice_id
    JOIN contracts c ON c.id = i.contract_id
    LEFT JOIN entities es ON es.id = c.seller_id
    LEFT JOIN entities eb ON eb.id = c.buyer_id
    WHERE 1=1
  `;
  const params = [];
  const side = counterpartySide(user);
  if (side === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(user.linked_entity_id);
  } else if (side === 'BUYER') {
    sql += ' AND c.buyer_id = ?';
    params.push(user.linked_entity_id);
  }
  return { sql, params };
}

function openDisputeAmountOnCharge(invoiceId, chargeLine, excludeId = null) {
  let sql = `
    SELECT COALESCE(SUM(disputed_amount), 0) s FROM disputes
    WHERE invoice_id = ? AND charge_line = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
  `;
  const params = [invoiceId, chargeLine, ...OPEN_STATUSES];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  return db.prepare(sql).get(...params).s;
}

/**
 * Keep a bill's disputed amount and status in step with the disputes open on it.
 *
 * While anything on it is in dispute the bill reads DISPUTED and that amount is
 * held out of what is payable. When the last dispute closes it goes back to
 * where it stands on the facts — and that used to be SENT, always: a bill that
 * was part-paid before the dispute came back as though nothing had been paid on
 * it, a paid one as unpaid, and one approved but never emailed as sent. The
 * status it had going in is kept, and what has been settled since decides the
 * rest.
 */
function setInvoiceOpenDispute(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) return;
  // Money is held back only where the party disputing is the one paying — a
  // buyer on SJVN's bill. On a seller's bill SJVN pays, and the seller disputes
  // to be paid more: holding its claim back from what SJVN owes paid it less
  // for complaining. An accepted credit waiting for its note to be approved
  // stays held, so the buyer is not asked for money already agreed off.
  const openSum = inv.direction === 'SELLER_TO_SJVN' ? 0 : db.prepare(`
    SELECT COALESCE(SUM(disputed_amount), 0) s FROM disputes
    WHERE invoice_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
  `).get(invoiceId, ...OPEN_STATUSES).s + db.prepare(`
    SELECT COALESCE(SUM(d.credit_amount), 0) s FROM disputes d JOIN debit_credit_notes n ON n.id = d.resolution_note_id
    WHERE d.invoice_id = ? AND n.status = 'DRAFT'
  `).get(invoiceId).s
    // An amount the buyer has taken to a forum stays held until the forum
    // decides (decided 17-Oct-2026); surcharge on it runs from the original
    // due date if the award goes SJVN's way, as the bill's LPS is worked out
    // afresh once nothing is held.
    + db.prepare(`
    SELECT COALESCE(SUM(contested_amount), 0) s FROM disputes
    WHERE invoice_id = ? AND resolution_response = 'CONTESTED' AND status != 'CLOSED'
      AND escalation_outcome IS NULL
  `).get(invoiceId).s;

  if (openSum > 0) {
    db.prepare(`
      UPDATE invoices SET disputed_amount = ?, status = 'DISPUTED',
        status_before_dispute = CASE WHEN status = 'DISPUTED' THEN status_before_dispute ELSE status END,
        updated_at = datetime('now') WHERE id = ?
    `).run(openSum, invoiceId);
    return;
  }

  let next = inv.status;
  if (inv.status === 'DISPUTED') {
    const before = inv.status_before_dispute || 'SENT';
    const cleared = { ...inv, disputed_amount: 0 };
    const paid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id = ?').get(invoiceId).s;
    const payable = payableNow(cleared).payable_now;
    if (paid > 0 && paid >= payable - 0.005) next = 'PAID';
    else if (paid > 0) next = 'PARTIALLY_PAID';
    else next = ['APPROVED', 'SENT'].includes(before) ? before : (inv.issued_at ? 'SENT' : 'APPROVED');
  }
  db.prepare(`UPDATE invoices SET disputed_amount = 0, status = ?, status_before_dispute = NULL, updated_at = datetime('now') WHERE id = ?`)
    .run(next, invoiceId);
}

export function runSlaEscalations() {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const candidates = db.prepare(`
    SELECT * FROM disputes
    WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})
      AND sla_breached_at IS NULL
      -- SJVN's clock stands still while it waits on the party's reply; it was
      -- escalating disputes for SJVN's delay while the buyer had not answered.
      AND status != 'INFO_REQUESTED'
      AND (
        (status = 'RAISED' AND sla_ack_due IS NOT NULL AND sla_ack_due < ?)
        OR (sla_resolve_due IS NOT NULL AND sla_resolve_due < ?)
      )
  `).all(...OPEN_STATUSES, now, now);

  let count = 0;
  for (const d of candidates) {
    const from = d.status;
    db.prepare(`
      UPDATE disputes SET status = 'ESCALATED', sla_breached_at = ?, escalated_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(now, now, d.id);
    recordEvent(d.id, { name: 'system' }, 'SLA_BREACH', from, 'ESCALATED', { sla_ack_due: d.sla_ack_due, sla_resolve_due: d.sla_resolve_due });
    dispatch({
      event: 'DISPUTE_SLA_BREACHED', role: 'MANAGEMENT',
      subject: `Dispute SLA breached — ${d.dispute_no}`,
      message: `SJVN: SLA breached on dispute ${d.dispute_no} - escalated.`,
    }).catch((err) => console.error('[NOTIFY] DISPUTE_SLA_BREACHED failed', err.message));
    if (d.assigned_to) {
      dispatch({
        event: 'DISPUTE_SLA_BREACHED', userId: d.assigned_to,
        subject: `Dispute SLA breached — ${d.dispute_no}`,
        message: `SJVN: SLA breached on dispute ${d.dispute_no} assigned to you.`,
      }).catch((err) => console.error('[NOTIFY] DISPUTE_SLA_BREACHED (assignee) failed', err.message));
    }
    count += 1;
  }

  // Approaching resolve SLA (within 2 days)
  const approaching = db.prepare(`
    SELECT * FROM disputes
    WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})
      AND sla_resolve_due IS NOT NULL
      AND status != 'INFO_REQUESTED'
      AND sla_resolve_due > ?
      AND sla_resolve_due <= datetime(?, '+2 days')
  `).all(...OPEN_STATUSES, now, now);

  for (const d of approaching) {
    if (d.assigned_to) {
      pushNotification({
        userId: d.assigned_to,
        type: 'DISPUTE_SLA_APPROACHING',
        message: `Resolve SLA approaching for ${d.dispute_no} (due ${d.sla_resolve_due})`,
      });
    } else {
      notifyDesk('DISPUTE_SLA_APPROACHING', `Resolve SLA approaching for ${d.dispute_no} (due ${d.sla_resolve_due})`);
    }
  }

  const deemed = closeDeemedAccepted();
  const hearings = remindHearings();
  return { escalated: count, deemed_accepted: deemed.closed, hearing_reminders: hearings.sent };
}

/**
 * D2: a resolution the party has let stand. Once dispute_response_days have
 * passed since SJVN resolved a dispute and the party has neither accepted nor
 * contested it, the resolution is deemed accepted and the dispute closes —
 * unless a note the resolution asked for still waits for approval.
 */
/** D5: remind the desk 7 days and 1 day before a forum hearing, once each. */
export function remindHearings() {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  let sent = 0;
  for (const d of db.prepare(`SELECT * FROM disputes WHERE next_hearing IS NOT NULL AND status <> 'CLOSED' AND next_hearing >= ?`).all(t)) {
    const left = Math.floor((Date.parse(`${d.next_hearing}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 86400000);
    const step = left <= 1 ? 1 : left <= 7 ? 7 : null;
    if (!step) continue;
    const tag = `HEARING_REMINDER_${step}_${d.next_hearing}`;
    if (db.prepare('SELECT 1 FROM dispute_events WHERE dispute_id = ? AND event_type = ?').get(d.id, tag)) continue;
    notifyDesk('DISPUTE', `${d.dispute_no}${d.forum_case_no ? ` (${d.forum_case_no})` : ''}: hearing on ${d.next_hearing} — ${left} day${left === 1 ? '' : 's'} away.`);
    recordEvent(d.id, { name: 'system' }, tag, d.status, d.status, null);
    sent += 1;
  }
  return { sent };
}

export function closeDeemedAccepted(now = new Date()) {
  const days = getParamNumber('dispute_response_days', 15);
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const due = db.prepare(`
    SELECT d.* FROM disputes d
    WHERE d.status IN ('RESOLVED_ACCEPTED', 'RESOLVED_REJECTED') AND d.resolution_response IS NULL
      AND d.resolved_at IS NOT NULL AND REPLACE(substr(d.resolved_at, 1, 19), 'T', ' ') < ?
      AND NOT EXISTS (SELECT 1 FROM debit_credit_notes n WHERE n.id = d.resolution_note_id AND n.status = 'DRAFT')
  `).all(cutoff);
  for (const d of due) {
    const by = `Deemed accepted — no answer within ${days} days`;
    db.prepare(`
      UPDATE disputes SET status = 'CLOSED', resolution_response = 'ACCEPTED', resolution_response_by = ?, resolution_response_at = datetime('now'),
        resolution_response_note = ?, updated_at = datetime('now') WHERE id = ? AND resolution_response IS NULL
    `).run(by, `The ${String(d.raised_by_role).toLowerCase()} neither accepted nor contested the resolution of ${String(d.resolved_at).slice(0, 10)} within ${days} days.`, d.id);
    setInvoiceOpenDispute(d.invoice_id);
    recordEvent(d.id, { name: 'system' }, 'DEEMED_ACCEPTED', d.status, 'CLOSED', { window_days: days });
    if (d.raised_by_user_id) {
      pushNotification({ userId: d.raised_by_user_id, type: 'DISPUTE', message: `${d.dispute_no}: SJVN's resolution is deemed accepted — it was not answered within ${days} days — and the dispute is closed.` });
    }
    notifyDesk('DISPUTE', `${d.dispute_no}: resolution deemed accepted after ${days} days without an answer; closed.`);
  }
  return { closed: due.length };
}

/**
 * Restart SJVN's clock when the party's reply comes in: the resolve date moves
 * on by however long it stood waiting.
 */
function resumeClock(disputeId) {
  db.prepare(`
    UPDATE disputes SET
      sla_resolve_due = CASE WHEN sla_resolve_due IS NULL THEN NULL
        ELSE datetime(sla_resolve_due, printf('+%d seconds', CAST((julianday('now') - julianday(info_requested_at)) * 86400 AS INTEGER))) END,
      info_requested_at = NULL
    WHERE id = ? AND info_requested_at IS NOT NULL
  `).run(disputeId);
}

/**
 * The note an accepted claim becomes, in favour of whoever raised it.
 *
 * Resolution used to rewrite the bill that had been issued (its total cut by
 * the credit) and book an APPROVED credit bill for the same amount on top, so
 * the buyer's statement counted the credit twice; and on a seller's bill the
 * credit cut what SJVN owed the seller for a claim SJVN had just accepted. One
 * REIA user could grant any amount. Now an accepted buyer claim is a CREDIT
 * note against the bill, an accepted seller claim a DEBIT note (a supplementary
 * SJVN pays), each a DRAFT that someone other than the resolver approves. The
 * bill as issued stays the bill as issued.
 */
export function raiseResolutionNote(dispute, invoice, amount, interest, user, why) {
  const noteType = invoice.direction === 'SELLER_TO_SJVN' ? 'DEBIT' : 'CREDIT';
  const total = Math.round(((Number(amount) || 0) + (Number(interest) || 0)) * 100) / 100;
  if (noteType === 'CREDIT') {
    const live = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) s FROM debit_credit_notes
      WHERE invoice_id = ? AND note_type = 'CREDIT' AND status IN ('DRAFT', 'ISSUED', 'SETTLED') AND model = 'V2'
    `).get(invoice.id).s;
    if (total + live > (Number(invoice.total_amount) || 0) + 0.005) {
      throw Object.assign(new Error(`Credits on ${invoice.invoice_no} would come to ₹${(total + live).toLocaleString('en-IN')}, more than the bill's ₹${Number(invoice.total_amount).toLocaleString('en-IN')}.`), { status: 400 });
    }
  }
  const id = newId('DCN');
  const reason = `Dispute ${dispute.dispute_no} — ${why}: ₹${Number(amount).toLocaleString('en-IN')} accepted${interest ? ` + ₹${Number(interest).toLocaleString('en-IN')} interest / surcharge` : ''}`;
  db.prepare(`
    INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month,
      reason_code, amount, taxable_amount, tax_amount, tax_label, reason, status, model, created_by, created_by_id)
    VALUES (?, ?, ?, ?, ?, ?, 'OTHER', ?, ?, 0, NULL, ?, 'DRAFT', 'V2', ?, ?)
  `).run(id, `DRAFT-${id}`, noteType, invoice.id, invoice.contract_id, invoice.billing_period, total, total, reason, user.name, user.id || null);
  db.prepare(`UPDATE disputes SET resolution_note_id = ?, updated_at = datetime('now') WHERE id = ?`).run(id, dispute.id);
  pushNotification({ role: 'FINANCE_USER', type: 'DC_NOTE_FOR_APPROVAL', message: `${noteType === 'DEBIT' ? 'Debit' : 'Credit'} note of Rs.${total.toLocaleString('en-IN')} for dispute ${dispute.dispute_no} (${invoice.invoice_no}) awaits approval` });
  return { id, note_type: noteType, amount: total };
}

/** What happens to a dispute when the note its resolution asked for is decided. */
export function onResolutionNoteDecided(noteId, decision, user, detail = {}) {
  const d = db.prepare('SELECT * FROM disputes WHERE resolution_note_id = ?').get(noteId);
  if (!d) return;
  if (decision === 'ISSUED') {
    recordEvent(d.id, user, 'NOTE_ISSUED', d.status, d.status, detail);
  } else {
    // The credit was not approved, so there is no resolution: back to review.
    db.prepare(`
      UPDATE disputes SET status = 'UNDER_REVIEW', resolution_outcome = NULL, accepted_amount = 0, credit_amount = 0,
        resolution_note_id = NULL, resolution_response = NULL, resolution_response_by = NULL, resolution_response_at = NULL,
        resolved_at = NULL, resolved_by = NULL, updated_at = datetime('now') WHERE id = ?
    `).run(d.id);
    recordEvent(d.id, user, 'RESOLUTION_NOT_APPROVED', d.status, 'UNDER_REVIEW', detail);
    notifyDesk('DISPUTE', `${d.dispute_no}: the note for its resolution was not approved (${detail.reason || ''}) — it is back under review`);
  }
  setInvoiceOpenDispute(d.invoice_id);
}

// ---------- meta / constants ----------
router.get('/meta', (_req, res) => {
  res.json({
    reason_codes: REASON_CODES,
    charge_lines: CHARGE_LINES,
    open_statuses: OPEN_STATUSES,
    sla: { acknowledge_days: SLA_ACK_DAYS, resolve_days: SLA_RESOLVE_DAYS, long_pending_days: SLA_LONG_PENDING_DAYS },
  });
});

// ---------- stats dashboard ----------
router.get('/stats', requireRole(...REIA_ROLES), (_req, res) => {
  runSlaEscalations();

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(disputed_amount),0) as amount
    FROM disputes GROUP BY status
  `).all();

  const byReason = db.prepare(`
    SELECT reason_code, COUNT(*) as count, COALESCE(SUM(disputed_amount),0) as amount
    FROM disputes GROUP BY reason_code ORDER BY count DESC
  `).all();

  const byEntity = db.prepare(`
    SELECT COALESCE(es.name, eb.name, 'Unknown') as entity_name,
           COALESCE(es.id, eb.id) as entity_id,
           d.raised_by_role,
           COUNT(*) as count,
           COALESCE(SUM(d.disputed_amount),0) as amount
    FROM disputes d
    JOIN invoices i ON i.id = d.invoice_id
    JOIN contracts c ON c.id = i.contract_id
    LEFT JOIN entities es ON es.id = c.seller_id AND d.raised_by_role = 'SELLER'
    LEFT JOIN entities eb ON eb.id = c.buyer_id AND d.raised_by_role = 'BUYER'
    GROUP BY entity_id, entity_name, d.raised_by_role
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const openRows = db.prepare(`
    SELECT created_at, disputed_amount, status, sla_breached_at FROM disputes
    WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})
  `).all(...OPEN_STATUSES);

  const aging = { '0_7': 0, '8_15': 0, '16_30': 0, '30_plus': 0, amounts: { '0_7': 0, '8_15': 0, '16_30': 0, '30_plus': 0 } };
  let financialExposure = 0;
  let slaBreached = 0;
  let longPending = 0;
  for (const r of openRows) {
    const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
    financialExposure += r.disputed_amount || 0;
    if (r.sla_breached_at || r.status === 'ESCALATED') slaBreached += 1;
    if (days >= SLA_LONG_PENDING_DAYS) longPending += 1;
    let bucket = '30_plus';
    if (days <= 7) bucket = '0_7';
    else if (days <= 15) bucket = '8_15';
    else if (days <= 30) bucket = '16_30';
    aging[bucket] += 1;
    aging.amounts[bucket] += r.disputed_amount || 0;
  }

  const trend = db.prepare(`
    SELECT substr(created_at, 1, 7) as month, COUNT(*) as count, COALESCE(SUM(disputed_amount),0) as amount
    FROM disputes
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
  `).all().reverse();

  const openCount = openRows.length;
  const resolvedCount = db.prepare(`
    SELECT COUNT(*) c FROM disputes WHERE status IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED','CLOSED')
  `).get().c;

  res.json({
    by_status: byStatus,
    by_reason: byReason,
    by_entity: byEntity,
    aging,
    trend,
    financial_exposure: financialExposure,
    sla_breached: slaBreached,
    long_pending: longPending,
    open_count: openCount,
    resolved_count: resolvedCount,
  });
});

// ---------- list ----------
router.get('/', (req, res) => {
  runSlaEscalations();
  const { status, reason_code, assigned_to, sort = 'created_at', order = 'DESC', aging } = req.query;
  let { sql, params } = scopedListSql(req.user);

  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  if (reason_code) { sql += ' AND d.reason_code = ?'; params.push(reason_code); }
  if (assigned_to) { sql += ' AND d.assigned_to = ?'; params.push(assigned_to); }

  const sortCol = ['created_at', 'disputed_amount', 'status', 'sla_resolve_due'].includes(sort) ? sort : 'created_at';
  const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  sql += ` ORDER BY d.${sortCol} ${sortDir}`;

  let rows = db.prepare(sql).all(...params).map((r) => enrichDispute(r));

  if (aging) {
    rows = rows.filter((r) => {
      const d = r.ageing_days;
      if (aging === '0_7') return d <= 7;
      if (aging === '8_15') return d >= 8 && d <= 15;
      if (aging === '16_30') return d >= 16 && d <= 30;
      if (aging === '30_plus') return d > 30;
      if (aging === '60_plus') return d >= 60;
      return true;
    });
  }

  res.json(rows);
});

// ---------- SLA check (must be before /:id) ----------
// With an as_of in the future this answers "what breaches by then" without
// escalating anything — a projection must never be able to age a live dispute
// into escalation just by being asked about.
router.post('/sla/check', requireRole(...REIA_WRITE, ...ROLE_GROUPS.REIA_APPROVE), (req, res) => {
  let asOf;
  try { asOf = asOfFrom(req); } catch (err) { return res.status(err.status || 400).json({ error: err.message }); }

  if (asOf > new Date()) {
    const at = asOf.toISOString().slice(0, 19).replace('T', ' ');
    const due = db.prepare(`
      SELECT id, dispute_no, status, sla_ack_due, sla_resolve_due FROM disputes
      WHERE status IN (${OPEN_STATUSES.map(() => '?').join(',')})
        AND sla_breached_at IS NULL
        AND (
          (status = 'RAISED' AND sla_ack_due IS NOT NULL AND sla_ack_due < ?)
          OR (sla_resolve_due IS NOT NULL AND sla_resolve_due < ?)
        )
    `).all(...OPEN_STATUSES, at, at);
    return res.json({ projection: true, as_of: at, would_escalate: due.length, disputes: due });
  }

  res.json(runSlaEscalations());
});

// ---------- detail ----------
router.get('/:id', (req, res) => {
  runSlaEscalations();
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  if (!canAccessDispute(req.user, dispute)) return res.status(403).json({ error: 'Not authorized' });

  const invoice = db.prepare(`
    SELECT i.*, c.contract_no, c.seller_id, c.buyer_id, es.name as seller_name, eb.name as buyer_name
    FROM invoices i
    JOIN contracts c ON c.id = i.contract_id
    LEFT JOIN entities es ON es.id = c.seller_id
    LEFT JOIN entities eb ON eb.id = c.buyer_id
    WHERE i.id = ?
  `).get(dispute.invoice_id);

  let commentsSql = 'SELECT * FROM dispute_comments WHERE dispute_id = ?';
  if (!isReia(req.user)) commentsSql += ' AND is_internal = 0';
  commentsSql += ' ORDER BY created_at ASC';
  const comments = db.prepare(commentsSql).all(dispute.id);

  const events = db.prepare('SELECT * FROM dispute_events WHERE dispute_id = ? ORDER BY created_at ASC').all(dispute.id)
    .filter((e) => isReia(req.user) || e.event_type !== 'INTERNAL_COMMENT');
  const assignee = dispute.assigned_to
    ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(dispute.assigned_to)
    : null;
  const supp = dispute.supplementary_invoice_id
    ? db.prepare('SELECT id, invoice_no, total_amount, status, invoice_type FROM invoices WHERE id = ?').get(dispute.supplementary_invoice_id)
    : null;

  // PSA Art. 6.7.3: an accepted (over-billed) claim is refunded with interest at
  // the LPS rate. Suggest that interest on the disputed amount, from bill date to now.
  const lpsPct = getParamNumber('lps_annual_pct', 15);
  // Interest is on money that was paid and has to come back. On a bill nobody
  // has paid there is nothing to refund, and a day's interest was offered anyway.
  const firstPaid = db.prepare('SELECT MIN(payment_date) d FROM payments WHERE invoice_id = ?').get(invoice.id)?.d || null;
  const interestDays = firstPaid ? Math.max(0, daysBetween(new Date(firstPaid), new Date())) : 0;
  const refundInterest = Math.round((Number(dispute.disputed_amount) || 0) * (lpsPct / 100 / 365) * interestDays);

  res.json({
    ...enrichDispute(dispute),
    invoice: {
      ...invoice,
      charge_breakdown: invoiceChargeBreakdown(invoice),
      ...payableNow(invoice),
      // What is still owed on it — payable_now does not come down as money arrives.
      balance_due: invoiceBalance(invoice).balance,
    },
    refund_interest_guidance: { lps_annual_pct: lpsPct, days: interestDays, amount: refundInterest },
    comments,
    events,
    assignee,
    supplementary_invoice: supp,
    // The note an accepted claim became, and where it stands.
    resolution_note: dispute.resolution_note_id
      ? db.prepare('SELECT id, note_no, note_type, status, amount, applied_amount, approved_by FROM debit_credit_notes WHERE id = ?').get(dispute.resolution_note_id) || null
      : null,
    response_window_days: getParamNumber('dispute_response_days', 15),
  });
});

// ---------- create ----------
const refuse = (status, payload) => Object.assign(new Error(payload.error), { status, payload });

/**
 * Raise one dispute, or refuse with the reason. Shared by a single raise and by
 * a raise on several bills at once, which runs every one in one transaction.
 */
function raiseDispute(user, body, req) {
  const {
    invoice_id,
    reason_code,
    charge_line,
    issue_description,
    disputed_amount,
    raised_by,
    raised_by_role,
  } = body;

  if (!invoice_id || !reason_code || !charge_line || disputed_amount == null) {
    throw refuse(400, { error: 'invoice_id, reason_code, charge_line and disputed_amount are required' });
  }
  if (!REASON_CODES.includes(reason_code)) {
    throw refuse(400, { error: 'Invalid reason_code' });
  }
  if (!CHARGE_LINES.includes(charge_line)) {
    throw refuse(400, { error: 'Invalid charge_line' });
  }
  if (reason_code === 'OTHER' && !(issue_description && String(issue_description).trim())) {
    throw refuse(400, { error: 'Description is mandatory when reason is OTHER' });
  }

  const invoice = db.prepare(`
    SELECT i.*, c.seller_id, c.buyer_id FROM invoices i
    JOIN contracts c ON c.id = i.contract_id WHERE i.id = ?
  `).get(invoice_id);
  if (!invoice) throw refuse(404, { error: 'Invoice not found' });
  // A credit note is the answer to a dispute, not a bill to raise one on.
  if (Number(invoice.total_amount) <= 0 || db.prepare('SELECT 1 FROM disputes WHERE supplementary_invoice_id = ?').get(invoice.id)) {
    throw refuse(400, { error: `${invoice.invoice_no} is a credit note. A dispute is raised on the bill it was credited against.` });
  }
  // The same claim sent twice in the same moment — a second click — is one claim.
  const twin = db.prepare(`
    SELECT dispute_no FROM disputes WHERE invoice_id = ? AND charge_line = ? AND disputed_amount = ? AND raised_by_user_id = ?
      AND status NOT IN ('CLOSED') AND created_at >= datetime('now', '-30 seconds')
  `).get(invoice.id, charge_line, Number(disputed_amount), user.id);
  if (twin) throw refuse(409, { error: `${twin.dispute_no} was raised a moment ago for the same amount on this bill. It has not been raised again.` });

  // Every seller or buyer user, company admin or not. Naming only SELLER and
  // BUYER here would let their L1–L3 users past the dispute window below.
  const raisedByCounterparty = counterpartySide(user) !== null;

  // You cannot dispute a bill you were never given. SJVN's own drafts and bills
  // still in approval were open to being disputed by the counterparty, which
  // also started the clock below on a bill that had not been presented.
  if (raisedByCounterparty && !invoicePresentedTo(user, invoice)) {
    // A seller's own bill that SJVN has not approved yet is no secret to the
    // seller, and "Invoice not found" on a bill it was looking at told it
    // nothing. There is just nothing of SJVN's on it to dispute yet.
    if (authoredBy(user, invoice) && invoice.seller_id === user.linked_entity_id) {
      throw refuse(400, {
        error: `${invoice.invoice_no} is still ${invoice.status.replace(/_/g, ' ')} — SJVN has not approved or paid it yet, so there is nothing to dispute. A dispute can be raised once SJVN has approved the bill.`,
        invoice_status: invoice.status,
      });
    }
    throw refuse(404, { error: 'Invoice not found' });
  }
  if (invoice.status === 'CANCELLED') {
    throw refuse(400, { error: 'This bill has been cancelled — there is nothing left to dispute.' });
  }
  // The desk may raise one on a counterparty's behalf, but on a bill that has
  // been presented. Raised on a draft it turned the draft DISPUTED, and closing
  // it then left a bill nobody had approved standing as SENT.
  if (!raisedByCounterparty && !isPresented(invoice)) {
    throw refuse(400, {
      error: `${invoice.invoice_no} is still ${invoice.status.replace(/_/g, ' ')} — a dispute is raised on a bill once it has been approved.`,
      invoice_status: invoice.status,
    });
  }

  // PSA Art. 6.7.1: a bill not disputed within 15 days of presentation becomes
  // conclusive and binding. Measured from presentation — measuring from row
  // creation spent the counterparty's window while the bill sat in draft, and a
  // bill held three weeks internally arrived already conclusive. Internal REIA
  // users may still raise late on the counterparty's behalf.
  const windowDays = getParamNumber('dispute_window_days', 15);
  const presentedOn = billPresentedOn(invoice);
  const daysSinceBill = daysBetween(new Date(presentedOn), new Date());
  // A desk raising from a reconciliation line asks for the window too
  // (decided 17-Oct-2026): it is not a way round a bill that is conclusive.
  if ((raisedByCounterparty || body.enforce_window) && daysSinceBill > windowDays) {
    throw refuse(400, { error: `This bill is now conclusive — the ${windowDays}-day dispute window (from ${String(presentedOn).split('T')[0]}) has passed.` });
  }

  // A dispute belongs to the party the bill is with: the seller on its own
  // invoice to SJVN, the buyer on SJVN's bill to it. The caller used to name the
  // side freely, so the desk's form — which defaults to Buyer — could file a
  // "buyer" dispute on a seller's invoice, which neither side could then answer.
  const userSide = counterpartySide(user);
  const billSide = invoice.direction === 'SELLER_TO_SJVN' ? 'SELLER' : 'BUYER';
  const named = raised_by_role || raised_by;
  if (userSide && userSide !== billSide) {
    throw refuse(403, { error: `This bill is between SJVN and the ${billSide.toLowerCase()}; only the ${billSide.toLowerCase()} can dispute it.` });
  }
  if (!userSide && ['BUYER', 'SELLER'].includes(named) && named !== billSide) {
    throw refuse(400, { error: `${invoice.invoice_no} is the ${billSide.toLowerCase()}'s bill, so a dispute on it is raised for the ${billSide.toLowerCase()}.` });
  }
  const role = billSide;

  if (userSide === 'SELLER' && invoice.seller_id !== user.linked_entity_id) {
    throw refuse(403, { error: 'Cannot dispute another seller\'s invoice' });
  }
  if (userSide === 'BUYER' && invoice.buyer_id !== user.linked_entity_id) {
    throw refuse(403, { error: 'Cannot dispute another buyer\'s invoice' });
  }

  const amount = Number(disputed_amount);
  if (!(amount > 0)) throw refuse(400, { error: 'disputed_amount must be positive' });

  const chargeValue = Math.abs(invoice[charge_line] || 0);
  const alreadyOpen = openDisputeAmountOnCharge(invoice_id, charge_line);
  const remaining = chargeValue - alreadyOpen;
  if (amount > remaining + 0.01) {
    // In the words the form uses for the line, not the column it is stored in.
    const line = CHARGE_LABELS[charge_line] || charge_line;
    throw refuse(400, {
      error: `Disputed amount ₹${amount.toLocaleString('en-IN')} exceeds remaining disputable on ${line} (₹${Math.max(0, remaining).toLocaleString('en-IN')})`,
    });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const id = newId('DIS');
  const disputeNo = genDisputeNo();
  // The time SJVN has, from the contract; held as parameters so they can follow it.
  const slaAckDue = addDaysIso(now, getParamNumber('dispute_sla_ack_days', SLA_ACK_DAYS));
  const slaResolveDue = addDaysIso(now, getParamNumber('dispute_sla_resolve_days', SLA_RESOLVE_DAYS));

  // Acknowledgement is the desk's act (decided 17-Oct-2026), so the 2-day
  // acknowledge SLA runs against a person; the raiser is told it was received.
  const ackStatus = 'RAISED';

  db.prepare(`
    INSERT INTO disputes (
      id, dispute_no, invoice_id, raised_by_role, raised_by_user_id, reason_code, charge_line,
      issue_description, disputed_amount, status, acknowledged_at, acknowledged_by,
      sla_ack_due, sla_resolve_due, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, disputeNo, invoice_id, role, user.id, reason_code, charge_line,
    issue_description || '', amount, ackStatus, null, null,
    slaAckDue, slaResolveDue, now, now
  );

  setInvoiceOpenDispute(invoice_id);

  recordEvent(id, user, 'RAISED', null, 'RAISED', { reason_code, charge_line, amount });

  logAudit({ req: typeof req !== "undefined" ? req : null,
    user: user,
    action: 'DISPUTE_RAISED',
    module: 'REIA',
    entityType: 'dispute',
    entityId: id,
    details: { dispute_no: disputeNo, invoice_id, reason_code, charge_line, amount },
  });

  notifyDesk('DISPUTE', `New dispute ${disputeNo} raised by ${user.name} on invoice ${invoice.invoice_no} (₹${amount.toLocaleString('en-IN')})`);
  pushNotification({
    userId: user.id,
    type: 'DISPUTE_RECEIVED',
    message: `Dispute ${disputeNo} received. SJVN will acknowledge it within ${getParamNumber('dispute_sla_ack_days', SLA_ACK_DAYS)} days. Tracking ID: ${disputeNo}`,
  });

  return enrichDispute(db.prepare('SELECT * FROM disputes WHERE id = ?').get(id));
}

/**
 * The desk taking up a dispute it has not yet acknowledged acknowledges it:
 * whoever first acts on it is recorded as having done so, at that moment, so
 * the acknowledge SLA is measured on a person's act and never on "system".
 */
function acknowledgeByAction(dispute, user) {
  if (dispute.acknowledged_at) return;
  db.prepare(`UPDATE disputes SET acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ? AND acknowledged_at IS NULL`)
    .run(user?.name || null, dispute.id);
  recordEvent(dispute.id, user, 'ACKNOWLEDGED', 'RAISED', 'ACKNOWLEDGED', { by_action: true });
}

const sendRefusal = (res, err) => {
  if (err.status) return res.status(err.status).json(err.payload || { error: err.message });
  throw err;
};

router.post('/', requireRole(...SELLER_ROLES, ...BUYER_ROLES, ...REIA_WRITE), (req, res) => {
  try {
    res.status(201).json(raiseDispute(req.user, req.body, req));
  } catch (err) { sendRefusal(res, err); }
});

// Several bills disputed for one cause: every dispute is raised, and linked
// under one group reference, or none is. Raised one after another, a refusal
// on the second bill left the first raised and holding money, unlinked.
router.post('/batch', requireRole(...SELLER_ROLES, ...BUYER_ROLES, ...REIA_WRITE), (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const title = String(req.body?.group_title || '').trim().slice(0, 200);
  if (items.length < 2) return res.status(400).json({ error: 'Choose at least two bills for linked disputes' });
  if (items.length > 60) return res.status(400).json({ error: 'At most 60 bills in one group' });
  if (!title) return res.status(400).json({ error: 'Give the linked disputes a title — what they have in common' });
  if (new Set(items.map((i) => i.invoice_id)).size !== items.length) return res.status(400).json({ error: 'Each bill appears once in a group' });
  try {
    const made = db.transaction(() => {
      const rows = items.map((it, n) => {
        try { return raiseDispute(req.user, { ...req.body, ...it, items: undefined }, req); } catch (err) {
          if (!err.status) throw err;
          const inv = db.prepare('SELECT invoice_no FROM invoices WHERE id = ?').get(it.invoice_id);
          throw refuse(err.status, { error: `${inv?.invoice_no || `Bill ${n + 1}`}: ${err.payload?.error || err.message} — none of the disputes was raised.` });
        }
      });
      const year = new Date().getFullYear();
      const ref = `DSG/${year}/${String(nextSeriesNo('DSG', year)).padStart(4, '0')}`;
      for (const d of rows) {
        db.prepare(`UPDATE disputes SET group_ref = ?, group_title = ?, updated_at = datetime('now') WHERE id = ?`).run(ref, title, d.id);
        recordEvent(d.id, req.user, 'LINKED', d.status, d.status, { group_ref: ref, title });
      }
      return { group_ref: ref, disputes: rows.map((d) => ({ ...d, group_ref: ref, group_title: title })) };
    })();
    res.status(201).json(made);
  } catch (err) { sendRefusal(res, err); }
});

// ---------- transition ----------
router.post('/:id/transition', (req, res) => {
  const { status: toStatus, note } = req.body;
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  if (!canAccessDispute(req.user, dispute)) return res.status(403).json({ error: 'Not authorized' });

  const allowed = ALLOWED_TRANSITIONS[dispute.status] || [];
  if (!allowed.includes(toStatus)) {
    return res.status(400).json({ error: `Cannot transition from ${dispute.status} to ${toStatus}` });
  }

  // Moving a dispute on is the REIA desk's. The one move that is the
  // submitter's is answering a request for information, which returns it to
  // review. The checks here used to let any SJVN role through — Finance and
  // Management read disputes but could close one or ask for information by
  // calling this directly.
  const submitterReply = dispute.status === 'INFO_REQUESTED' && toStatus === 'UNDER_REVIEW'
    && counterpartySide(req.user) === dispute.raised_by_role;
  if (!submitterReply && !REIA_WRITE.includes(req.user.role)) {
    return res.status(403).json({
      error: toStatus === 'CLOSED' ? 'Only SJVN team can close disputes' : 'Only the REIA desk moves a dispute on',
    });
  }

  if (['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'].includes(toStatus)) {
    return res.status(400).json({ error: 'Use /resolve endpoint for resolution decisions' });
  }
  // A request for information says what is wanted. Sent blank, it went out as
  // a stock line in the officer's name.
  if (toStatus === 'INFO_REQUESTED' && String(note || '').trim().length < 10) {
    return res.status(400).json({ error: 'Say what information is needed (at least 10 characters) — it is what the party reads.' });
  }
  // A resolution is the party's to answer — accept it, or contest it. The desk
  // closing it first took that away. It may close once answered, or once the
  // party has let the answer window pass, and not while a note it asked for
  // still waits for approval.
  if (toStatus === 'CLOSED' && ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'].includes(dispute.status)) {
    const windowDays = getParamNumber('dispute_response_days', 15);
    const waited = dispute.resolved_at ? daysBetween(new Date(`${String(dispute.resolved_at).replace(' ', 'T')}Z`), new Date()) : 0;
    if (dispute.resolution_response === 'CONTESTED') {
      return res.status(400).json({ error: 'The party has contested the resolution. Record how the escalation ended instead.' });
    }
    if (!dispute.resolution_response && waited < windowDays) {
      return res.status(400).json({ error: `The ${String(dispute.raised_by_role).toLowerCase()} has ${windowDays} days to accept or contest the resolution (${Math.max(0, windowDays - waited)} left). It can be closed once they answer or the time has passed.` });
    }
    const pending = dispute.resolution_note_id && db.prepare(`SELECT note_type FROM debit_credit_notes WHERE id = ? AND status = 'DRAFT'`).get(dispute.resolution_note_id);
    if (pending) return res.status(400).json({ error: `The ${pending.note_type.toLowerCase()} note for this resolution still awaits approval.` });
  }

  const from = dispute.status;
  if (from === 'RAISED' && toStatus !== 'ACKNOWLEDGED') acknowledgeByAction(dispute, req.user);
  db.prepare(`UPDATE disputes SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(toStatus, dispute.id);
  if (from === 'INFO_REQUESTED') resumeClock(dispute.id);
  if (toStatus === 'INFO_REQUESTED') db.prepare(`UPDATE disputes SET info_requested_at = datetime('now') WHERE id = ?`).run(dispute.id);

  if (toStatus === 'ACKNOWLEDGED') {
    db.prepare(`UPDATE disputes SET acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ?`)
      .run(req.user.name, dispute.id);
    if (dispute.raised_by_user_id) {
      pushNotification({
        userId: dispute.raised_by_user_id,
        type: 'DISPUTE_ACKNOWLEDGED',
        message: `Dispute ${dispute.dispute_no} has been acknowledged`,
      });
    }
  }

  if (toStatus === 'INFO_REQUESTED') {
    if (dispute.raised_by_user_id) {
      pushNotification({
        userId: dispute.raised_by_user_id,
        type: 'DISPUTE_INFO_REQUESTED',
        message: `Additional information requested on dispute ${dispute.dispute_no}`,
      });
    } else {
      tellRaiser(dispute, 'DISPUTE_INFO_REQUESTED', `Additional information requested on dispute ${dispute.dispute_no}`);
    }
    if (note) {
      db.prepare(`
        INSERT INTO dispute_comments (id, dispute_id, user_id, user_name, role, body, is_internal)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(newId('DCM'), dispute.id, req.user.id, req.user.name, req.user.role, note);
    }
  }

  if (toStatus === 'CLOSED') {
    setInvoiceOpenDispute(dispute.invoice_id);
  }

  recordEvent(dispute.id, req.user, 'STATUS_CHANGE', from, toStatus, note ? { note } : null);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: `DISPUTE_${toStatus}`, module: 'REIA', entityType: 'dispute', entityId: dispute.id });

  res.json(enrichDispute(db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id)));
});

// ---------- resolve ----------
router.post('/:id/resolve', requireRole(...REIA_WRITE), (req, res) => {
  const {
    outcome, // FULL_CREDIT | PARTIAL_CREDIT | REJECTED
    accepted_amount,
    resolution_notes,
    lps_on_resolution,
  } = req.body;

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  const resolvableFrom = ['RAISED', 'UNDER_REVIEW', 'ESCALATED', 'ACKNOWLEDGED', 'INFO_REQUESTED'];
  if (dispute.status === 'RAISED') acknowledgeByAction(dispute, req.user);
  if (!resolvableFrom.includes(dispute.status)) {
    return res.status(400).json({ error: `Cannot resolve dispute in status ${dispute.status}` });
  }
  if (!['FULL_CREDIT', 'PARTIAL_CREDIT', 'REJECTED'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome must be FULL_CREDIT, PARTIAL_CREDIT, or REJECTED' });
  }
  if (!resolution_notes || !String(resolution_notes).trim()) {
    return res.status(400).json({ error: 'resolution_notes are required' });
  }

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(dispute.invoice_id);
  const beforeTotal = invoice.total_amount;
  let accepted = 0;
  let credit = 0;
  let afterTotal = beforeTotal;
  let newStatus = 'RESOLVED_REJECTED';
  const lpsRes = Number(lps_on_resolution) || 0;

  if (outcome === 'REJECTED') {
    accepted = 0;
    credit = 0;
    newStatus = 'RESOLVED_REJECTED';
  } else if (outcome === 'FULL_CREDIT') {
    accepted = dispute.disputed_amount;
    credit = dispute.disputed_amount;
    newStatus = 'RESOLVED_ACCEPTED';
    afterTotal = Math.max(0, beforeTotal - credit);
  } else {
    accepted = Number(accepted_amount);
    if (!(accepted > 0) || accepted > dispute.disputed_amount) {
      return res.status(400).json({ error: 'accepted_amount must be > 0 and ≤ disputed amount for PARTIAL_CREDIT' });
    }
    credit = accepted;
    newStatus = 'RESOLVED_ACCEPTED';
    afterTotal = Math.max(0, beforeTotal - credit);
  }

  let note = null;
  if (dispute.status === 'INFO_REQUESTED') resumeClock(dispute.id);
  if (credit > 0) {
    // In favour of whoever raised it: less for a buyer to pay, more for SJVN to
    // pay a seller. The bill as issued is not rewritten.
    afterTotal = invoice.direction === 'SELLER_TO_SJVN' ? beforeTotal + credit : Math.max(0, beforeTotal - credit);
    try {
      note = raiseResolutionNote(dispute, invoice, credit, lpsRes, req.user, outcome === 'FULL_CREDIT' ? 'accepted in full' : 'accepted in part');
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
    tellRaiser(dispute, 'DISPUTE_NOTE_RAISED', `Dispute ${dispute.dispute_no}: SJVN accepts ₹${credit.toLocaleString('en-IN')}. A ${note.note_type.toLowerCase()} note of ₹${note.amount.toLocaleString('en-IN')} is raised and goes out once approved.`);
  }

  db.prepare(`
    UPDATE disputes SET
      status = ?, resolution_outcome = ?, resolution_notes = ?,
      accepted_amount = ?, credit_amount = ?, lps_on_resolution = ?,
      before_total = ?, after_total = ?, supplementary_invoice_id = ?,
      resolved_at = datetime('now'), resolved_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    newStatus, outcome, resolution_notes,
    accepted, credit, lpsRes,
    beforeTotal, credit > 0 ? afterTotal : beforeTotal, null,
    req.user.name, dispute.id
  );

  setInvoiceOpenDispute(invoice.id);

  recordEvent(dispute.id, req.user, 'RESOLVED', dispute.status, newStatus, {
    outcome, accepted, credit, before_total: beforeTotal, after_total: credit > 0 ? afterTotal : beforeTotal, lps_on_resolution: lpsRes,
  });

  logAudit({ req: typeof req !== "undefined" ? req : null,
    user: req.user,
    action: 'DISPUTE_RESOLVED',
    module: 'REIA',
    entityType: 'dispute',
    entityId: dispute.id,
    details: { outcome, accepted, credit, note_id: note?.id || null, note_type: note?.note_type || null },
  });

  // D4: an accepted dispute's cause goes back to the desk that owns it.
  try { raiseRootCauseTask(dispute, invoice, { outcome, accepted, user: req.user }); } catch (err) { console.error('[DISPUTE] root-cause task', err.message); }

  // The other side of the desk is no party to this bill and is told nothing.
  tellRaiser(dispute, 'DISPUTE_RESOLVED', `Dispute ${dispute.dispute_no} on invoice ${invoice.invoice_no} resolved: ${outcome.replaceAll('_', ' ').toLowerCase()}. Accept it, or escalate, under My Disputes.`);

  res.json(enrichDispute(db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id)));
});

// ---------- comments ----------
router.post('/:id/comments', (req, res) => {
  const { body, is_internal } = req.body;
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'Comment body required' });

  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  if (!canAccessDispute(req.user, dispute)) return res.status(403).json({ error: 'Not authorized' });

  if (dispute.status === 'CLOSED' && !(is_internal && isReia(req.user))) {
    return res.status(400).json({ error: 'This dispute is closed — the thread is kept as it stood.' });
  }
  const internal = !!is_internal && isReia(req.user);
  if (is_internal && !isReia(req.user)) {
    return res.status(403).json({ error: 'Only SJVN team can post internal comments' });
  }

  const id = newId('DCM');
  db.prepare(`
    INSERT INTO dispute_comments (id, dispute_id, user_id, user_name, role, body, is_internal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, dispute.id, req.user.id, req.user.name, req.user.role, body.trim(), internal ? 1 : 0);

  recordEvent(dispute.id, req.user, internal ? 'INTERNAL_COMMENT' : 'COMMENT', dispute.status, dispute.status, null);

  // Public reply from submitter on INFO_REQUESTED moves back to Under Review
  // Anyone from the company that raised it, not only its admin login: a reply
  // from a team member (BUYER_L1, SELLER_L2 …) used to leave the dispute waiting.
  if (
    !internal &&
    dispute.status === 'INFO_REQUESTED' &&
    (counterpartySide(req.user) === dispute.raised_by_role || req.user.id === dispute.raised_by_user_id)
  ) {
    db.prepare(`UPDATE disputes SET status = 'UNDER_REVIEW', updated_at = datetime('now') WHERE id = ?`).run(dispute.id);
    resumeClock(dispute.id);
    recordEvent(dispute.id, req.user, 'STATUS_CHANGE', 'INFO_REQUESTED', 'UNDER_REVIEW', { via: 'comment_reply' });
    notifyDesk('DISPUTE', `${req.user.name} replied on ${dispute.dispute_no} — it is back under review`);
  }

  const comment = db.prepare('SELECT * FROM dispute_comments WHERE id = ?').get(id);
  res.status(201).json(comment);
});

// ---------- evidence upload ----------
router.post('/:id/evidence', upload.single('file'), (req, res) => {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  if (!canAccessDispute(req.user, dispute)) return res.status(403).json({ error: 'Not authorized' });
  if (!req.file) return res.status(400).json({ error: 'file required' });
  // Evidence is a document: a closed file takes no more, and a program or
  // script is not evidence of anything (it was filed and shipped in the dossier).
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  const refuseFile = (msg) => { try { fs.unlinkSync(req.file.path); } catch { /* gone */ } return res.status(400).json({ error: msg }); };
  if (dispute.status === 'CLOSED') return refuseFile('This dispute is closed — no more evidence can be filed on it.');
  if (!EVIDENCE_TYPES.includes(ext)) return refuseFile(`${req.file.originalname}: evidence is a document — ${EVIDENCE_TYPES.join(', ')}.`);
  // Evidence nobody can open is not evidence; it is turned away rather than filed.
  if (unreadablePdf(req.file.path)) {
    try { fs.unlinkSync(req.file.path); } catch { /* already gone */ }
    return res.status(400).json({ error: `${req.file.originalname} ${UNREADABLE_PDF_MESSAGE}` });
  }

  const docs = parseDocs(dispute.supporting_docs);
  const entry = {
    filename: req.file.filename,
    original_name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
    uploaded_by: req.user.name,
    uploaded_at: new Date().toISOString(),
    note: req.body?.note || null,
  };
  docs.push(entry);
  db.prepare(`UPDATE disputes SET supporting_docs = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(docs), dispute.id);
  recordEvent(dispute.id, req.user, 'EVIDENCE_UPLOADED', dispute.status, dispute.status, { filename: entry.filename });

  res.status(201).json({ supporting_docs: docs });
});

// ---------- evidence download ----------
// Evidence is a party's own filing, so it is served through the same access
// check as the dispute rather than from the public /uploads directory. Only a
// file this dispute lists can be fetched, which also keeps the name from
// reaching outside the evidence folder.
router.get('/:id/evidence/:filename', (req, res) => {
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  if (!canAccessDispute(req.user, dispute)) return res.status(403).json({ error: 'Not authorized' });

  const entry = parseDocs(dispute.supporting_docs).find((d) => d.filename === req.params.filename);
  if (!entry) return res.status(404).json({ error: 'This dispute has no such evidence file' });
  const file = path.join(uploadDir, path.basename(entry.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'The evidence file is no longer on the server' });
  res.download(file, entry.original_name || entry.filename);
});

// ---------- assign / reassign ----------
router.post('/:id/assign', requireRole(...REIA_WRITE), (req, res) => {
  const { assigned_to } = req.body;
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  if (assigned_to) {
    const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(assigned_to);
    if (!user) return res.status(404).json({ error: 'Assignee user not found' });
  }

  db.prepare(`UPDATE disputes SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(assigned_to || null, dispute.id);

  if (dispute.status === 'ACKNOWLEDGED' || dispute.status === 'RAISED') {
    db.prepare(`UPDATE disputes SET status = 'UNDER_REVIEW', updated_at = datetime('now') WHERE id = ?`).run(dispute.id);
  }
  if (dispute.status === 'ESCALATED' && assigned_to) {
    db.prepare(`UPDATE disputes SET status = 'UNDER_REVIEW', updated_at = datetime('now') WHERE id = ?`).run(dispute.id);
  }

  recordEvent(dispute.id, req.user, 'ASSIGNED', dispute.status, db.prepare('SELECT status FROM disputes WHERE id = ?').get(dispute.id).status, {
    assigned_to,
  });

  if (assigned_to) {
    pushNotification({
      userId: assigned_to,
      type: 'DISPUTE_ASSIGNED',
      message: `Dispute ${dispute.dispute_no} assigned to you`,
    });
  }

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'DISPUTE_ASSIGNED', module: 'REIA', entityType: 'dispute', entityId: dispute.id, details: { assigned_to } });
  res.json(enrichDispute(db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id)));
});

export default router;
export { canAccessDispute, recordEvent, setInvoiceOpenDispute, raiseDispute, uploadDir as disputeUploadDir };
