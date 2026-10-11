import { Router } from 'express';
import multer from 'multer';
import { unreadablePdf, UNREADABLE_PDF_MESSAGE } from '../services/fileChecks.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide, SELLER_ROLES, BUYER_ROLES } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo } from '../util.js';
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
  const openSum = db.prepare(`
    SELECT COALESCE(SUM(disputed_amount), 0) s FROM disputes
    WHERE invoice_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
  `).get(invoiceId, ...OPEN_STATUSES).s;

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

  return { escalated: count };
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
router.post('/sla/check', requireRole(...REIA_WRITE, 'MANAGEMENT'), (req, res) => {
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
  });
});

// ---------- create ----------
router.post('/', requireRole(...SELLER_ROLES, ...BUYER_ROLES, ...REIA_WRITE), (req, res) => {
  const {
    invoice_id,
    reason_code,
    charge_line,
    issue_description,
    disputed_amount,
    raised_by,
    raised_by_role,
  } = req.body;

  if (!invoice_id || !reason_code || !charge_line || disputed_amount == null) {
    return res.status(400).json({ error: 'invoice_id, reason_code, charge_line and disputed_amount are required' });
  }
  if (!REASON_CODES.includes(reason_code)) {
    return res.status(400).json({ error: 'Invalid reason_code' });
  }
  if (!CHARGE_LINES.includes(charge_line)) {
    return res.status(400).json({ error: 'Invalid charge_line' });
  }
  if (reason_code === 'OTHER' && !(issue_description && String(issue_description).trim())) {
    return res.status(400).json({ error: 'Description is mandatory when reason is OTHER' });
  }

  const invoice = db.prepare(`
    SELECT i.*, c.seller_id, c.buyer_id FROM invoices i
    JOIN contracts c ON c.id = i.contract_id WHERE i.id = ?
  `).get(invoice_id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  // A credit note is the answer to a dispute, not a bill to raise one on.
  if (Number(invoice.total_amount) <= 0 || db.prepare('SELECT 1 FROM disputes WHERE supplementary_invoice_id = ?').get(invoice.id)) {
    return res.status(400).json({ error: `${invoice.invoice_no} is a credit note. A dispute is raised on the bill it was credited against.` });
  }
  // The same claim sent twice in the same moment — a second click — is one claim.
  const twin = db.prepare(`
    SELECT dispute_no FROM disputes WHERE invoice_id = ? AND charge_line = ? AND disputed_amount = ? AND raised_by_user_id = ?
      AND status NOT IN ('CLOSED') AND created_at >= datetime('now', '-30 seconds')
  `).get(invoice.id, charge_line, Number(disputed_amount), req.user.id);
  if (twin) return res.status(409).json({ error: `${twin.dispute_no} was raised a moment ago for the same amount on this bill. It has not been raised again.` });

  // Every seller or buyer user, company admin or not. Naming only SELLER and
  // BUYER here would let their L1–L3 users past the dispute window below.
  const raisedByCounterparty = counterpartySide(req.user) !== null;

  // You cannot dispute a bill you were never given. SJVN's own drafts and bills
  // still in approval were open to being disputed by the counterparty, which
  // also started the clock below on a bill that had not been presented.
  if (raisedByCounterparty && !invoicePresentedTo(req.user, invoice)) {
    // A seller's own bill that SJVN has not approved yet is no secret to the
    // seller, and "Invoice not found" on a bill it was looking at told it
    // nothing. There is just nothing of SJVN's on it to dispute yet.
    if (authoredBy(req.user, invoice) && invoice.seller_id === req.user.linked_entity_id) {
      return res.status(400).json({
        error: `${invoice.invoice_no} is still ${invoice.status.replace(/_/g, ' ')} — SJVN has not approved or paid it yet, so there is nothing to dispute. A dispute can be raised once SJVN has approved the bill.`,
        invoice_status: invoice.status,
      });
    }
    return res.status(404).json({ error: 'Invoice not found' });
  }
  if (invoice.status === 'CANCELLED') {
    return res.status(400).json({ error: 'This bill has been cancelled — there is nothing left to dispute.' });
  }
  // The desk may raise one on a counterparty's behalf, but on a bill that has
  // been presented. Raised on a draft it turned the draft DISPUTED, and closing
  // it then left a bill nobody had approved standing as SENT.
  if (!raisedByCounterparty && !isPresented(invoice)) {
    return res.status(400).json({
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
  if (raisedByCounterparty && daysSinceBill > windowDays) {
    return res.status(400).json({ error: `This bill is now conclusive — the ${windowDays}-day dispute window (from ${String(presentedOn).split('T')[0]}) has passed.` });
  }

  // A dispute belongs to the party the bill is with: the seller on its own
  // invoice to SJVN, the buyer on SJVN's bill to it. The caller used to name the
  // side freely, so the desk's form — which defaults to Buyer — could file a
  // "buyer" dispute on a seller's invoice, which neither side could then answer.
  const userSide = counterpartySide(req.user);
  const billSide = invoice.direction === 'SELLER_TO_SJVN' ? 'SELLER' : 'BUYER';
  const named = raised_by_role || raised_by;
  if (userSide && userSide !== billSide) {
    return res.status(403).json({ error: `This bill is between SJVN and the ${billSide.toLowerCase()}; only the ${billSide.toLowerCase()} can dispute it.` });
  }
  if (!userSide && ['BUYER', 'SELLER'].includes(named) && named !== billSide) {
    return res.status(400).json({ error: `${invoice.invoice_no} is the ${billSide.toLowerCase()}'s bill, so a dispute on it is raised for the ${billSide.toLowerCase()}.` });
  }
  const role = billSide;

  if (userSide === 'SELLER' && invoice.seller_id !== req.user.linked_entity_id) {
    return res.status(403).json({ error: 'Cannot dispute another seller\'s invoice' });
  }
  if (userSide === 'BUYER' && invoice.buyer_id !== req.user.linked_entity_id) {
    return res.status(403).json({ error: 'Cannot dispute another buyer\'s invoice' });
  }

  const amount = Number(disputed_amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'disputed_amount must be positive' });

  const chargeValue = Math.abs(invoice[charge_line] || 0);
  const alreadyOpen = openDisputeAmountOnCharge(invoice_id, charge_line);
  const remaining = chargeValue - alreadyOpen;
  if (amount > remaining + 0.01) {
    // In the words the form uses for the line, not the column it is stored in.
    const line = CHARGE_LABELS[charge_line] || charge_line;
    return res.status(400).json({
      error: `Disputed amount ₹${amount.toLocaleString('en-IN')} exceeds remaining disputable on ${line} (₹${Math.max(0, remaining).toLocaleString('en-IN')})`,
    });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const id = newId('DIS');
  const disputeNo = genDisputeNo();
  // The time SJVN has, from the contract; held as parameters so they can follow it.
  const slaAckDue = addDaysIso(now, getParamNumber('dispute_sla_ack_days', SLA_ACK_DAYS));
  const slaResolveDue = addDaysIso(now, getParamNumber('dispute_sla_resolve_days', SLA_RESOLVE_DAYS));

  // Auto-acknowledge immediately for submitter confidence
  const ackStatus = 'ACKNOWLEDGED';

  db.prepare(`
    INSERT INTO disputes (
      id, dispute_no, invoice_id, raised_by_role, raised_by_user_id, reason_code, charge_line,
      issue_description, disputed_amount, status, acknowledged_at, acknowledged_by,
      sla_ack_due, sla_resolve_due, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, disputeNo, invoice_id, role, req.user.id, reason_code, charge_line,
    issue_description || '', amount, ackStatus, now, 'system',
    slaAckDue, slaResolveDue, now, now
  );

  setInvoiceOpenDispute(invoice_id);

  recordEvent(id, req.user, 'RAISED', null, 'RAISED', { reason_code, charge_line, amount });
  recordEvent(id, { name: 'system' }, 'ACKNOWLEDGED', 'RAISED', 'ACKNOWLEDGED', { auto: true });

  logAudit({ req: typeof req !== "undefined" ? req : null,
    user: req.user,
    action: 'DISPUTE_RAISED',
    module: 'REIA',
    entityType: 'dispute',
    entityId: id,
    details: { dispute_no: disputeNo, invoice_id, reason_code, charge_line, amount },
  });

  notifyDesk('DISPUTE', `New dispute ${disputeNo} raised by ${req.user.name} on invoice ${invoice.invoice_no} (₹${amount.toLocaleString('en-IN')})`);
  pushNotification({
    userId: req.user.id,
    type: 'DISPUTE_ACKNOWLEDGED',
    message: `Dispute ${disputeNo} received and acknowledged. Tracking ID: ${disputeNo}`,
  });

  res.status(201).json(enrichDispute(db.prepare('SELECT * FROM disputes WHERE id = ?').get(id)));
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

  const from = dispute.status;
  db.prepare(`UPDATE disputes SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(toStatus, dispute.id);

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

  const resolvableFrom = ['UNDER_REVIEW', 'ESCALATED', 'ACKNOWLEDGED', 'INFO_REQUESTED'];
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
  let suppId = null;
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

  if (credit > 0) {
    // Adjust parent invoice total and optionally add resolution LPS
    // The total comes down by the credit. Anything added on resolution sits in
    // the surcharge column alone — it was added to the total as well, so the
    // bill asked for it twice.
    afterTotal = Math.max(0, beforeTotal - credit);
    db.prepare(`
      UPDATE invoices SET total_amount = ?, lps = lps + ?, other_adjustments = other_adjustments - ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(afterTotal, lpsRes, credit, invoice.id);

    // Auto supplementary (credit) invoice
    suppId = newId('INV');
    const suppNo = genInvoiceNo('SUPP');
    db.prepare(`
      INSERT INTO invoices (
        id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
        tariff_per_unit, energy_charges, transmission_charges, rebate, lps, penalty, trading_margin, taxes,
        other_adjustments, total_amount, disputed_amount, due_date, status, parent_invoice_id, created_by,
        invoice_breakdown_json
      ) VALUES (?, ?, ?, 'SUPPLEMENTARY', ?, ?, 0, 0, 0, 0, 0, ?, 0, 0, 0, ?, ?, 0, date('now'), 'APPROVED', ?, ?, ?)
    `).run(
      suppId,
      suppNo,
      invoice.contract_id,
      invoice.direction,
      invoice.billing_period,
      lpsRes,
      -credit,
      -credit + lpsRes,
      invoice.id,
      req.user.name,
      // What the credit is made of. Every bill SJVN raises carries its lines —
      // it is also how a bill on a PPA is told from the seller's own.
      JSON.stringify([
        { code: 'CR', label: `Credit on dispute ${dispute.dispute_no} against ${invoice.invoice_no}`, value: -credit },
        ...(lpsRes ? [{ code: 'LPS', label: 'Late payment surcharge on resolution', value: lpsRes }] : []),
        { code: 'TOTAL', label: 'Supplementary (credit) total', value: -credit + lpsRes },
      ])
    );

    tellRaiser(dispute, 'SUPPLEMENTARY_INVOICE', `Credit note ${suppNo} raised for dispute ${dispute.dispute_no} (credit ₹${credit.toLocaleString('en-IN')})`);
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
    beforeTotal, credit > 0 ? afterTotal : beforeTotal, suppId,
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
    details: { outcome, accepted, credit, supplementary_invoice_id: suppId },
  });

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

// Backward-compat status alias
router.post('/:id/status', requireRole(...REIA_WRITE), (req, res) => {
  const map = {
    SUBMITTED: 'ACKNOWLEDGED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    CLOSED: 'CLOSED',
  };
  const mapped = map[req.body.status] || req.body.status;
  if (req.body.status === 'RESOLVED' || mapped === 'RESOLVED') {
    return res.status(400).json({ error: 'Use /resolve for resolution' });
  }
  const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
  const allowed = ALLOWED_TRANSITIONS[dispute.status] || [];
  if (!allowed.includes(mapped)) {
    return res.status(400).json({ error: `Cannot transition from ${dispute.status} to ${mapped}` });
  }
  const from = dispute.status;
  db.prepare(`UPDATE disputes SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(mapped, dispute.id);
  recordEvent(dispute.id, req.user, 'STATUS_CHANGE', from, mapped, null);
  res.json(enrichDispute(db.prepare('SELECT * FROM disputes WHERE id = ?').get(dispute.id)));
});

export default router;
export { canAccessDispute, recordEvent, setInvoiceOpenDispute, uploadDir as disputeUploadDir };
