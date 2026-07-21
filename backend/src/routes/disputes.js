import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo } from '../util.js';
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
} from '../disputesConstants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../../uploads/disputes');
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

function setInvoiceOpenDispute(invoiceId) {
  const openSum = db.prepare(`
    SELECT COALESCE(SUM(disputed_amount), 0) s FROM disputes
    WHERE invoice_id = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
  `).get(invoiceId, ...OPEN_STATUSES).s;

  if (openSum > 0) {
    db.prepare(`UPDATE invoices SET disputed_amount = ?, status = 'DISPUTED', updated_at = datetime('now') WHERE id = ?`)
      .run(openSum, invoiceId);
  } else {
    db.prepare(`
      UPDATE invoices SET disputed_amount = 0,
        status = CASE WHEN status = 'DISPUTED' THEN 'SENT' ELSE status END,
        updated_at = datetime('now') WHERE id = ?
    `).run(invoiceId);
  }
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
    pushNotification({
      role: 'MANAGEMENT',
      type: 'DISPUTE_SLA_BREACHED',
      message: `SLA breached on dispute ${d.dispute_no} — escalated`,
    });
    if (d.assigned_to) {
      pushNotification({
        userId: d.assigned_to,
        type: 'DISPUTE_SLA_BREACHED',
        message: `SLA breached on dispute ${d.dispute_no}`,
      });
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
      pushNotification({
        role: 'REIA_USER',
        type: 'DISPUTE_SLA_APPROACHING',
        message: `Resolve SLA approaching for ${d.dispute_no} (due ${d.sla_resolve_due})`,
      });
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
router.post('/sla/check', requireRole(...REIA_WRITE, 'MANAGEMENT'), (_req, res) => {
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

  const events = db.prepare('SELECT * FROM dispute_events WHERE dispute_id = ? ORDER BY created_at ASC').all(dispute.id);
  const assignee = dispute.assigned_to
    ? db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(dispute.assigned_to)
    : null;
  const supp = dispute.supplementary_invoice_id
    ? db.prepare('SELECT id, invoice_no, total_amount, status, invoice_type FROM invoices WHERE id = ?').get(dispute.supplementary_invoice_id)
    : null;

  res.json({
    ...enrichDispute(dispute),
    invoice: {
      ...invoice,
      charge_breakdown: invoiceChargeBreakdown(invoice),
      ...payableNow(invoice),
    },
    comments,
    events,
    assignee,
    supplementary_invoice: supp,
  });
});

// ---------- create ----------
router.post('/', requireRole('SELLER', 'BUYER', ...REIA_WRITE), (req, res) => {
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

  const userSide = counterpartySide(req.user);
  const role = raised_by_role || raised_by || userSide;
  if (!role || !['BUYER', 'SELLER'].includes(role)) {
    return res.status(400).json({ error: 'raised_by_role must be BUYER or SELLER' });
  }

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
    return res.status(400).json({
      error: `Disputed amount ₹${amount} exceeds remaining disputable on ${charge_line} (₹${Math.max(0, remaining)})`,
    });
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const id = newId('DIS');
  const disputeNo = genDisputeNo();
  const slaAckDue = addDaysIso(now, SLA_ACK_DAYS);
  const slaResolveDue = addDaysIso(now, SLA_RESOLVE_DAYS);

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

  pushNotification({
    role: 'REIA_USER',
    type: 'DISPUTE',
    message: `New dispute ${disputeNo} raised on invoice ${invoice.invoice_no} (₹${amount.toLocaleString('en-IN')})`,
  });
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

  // Role gates
  if (['UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED', 'CLOSED'].includes(toStatus) && !isReia(req.user) && toStatus !== 'UNDER_REVIEW') {
    if (toStatus === 'CLOSED' && !REIA_WRITE.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only SJVN team can close disputes' });
    }
  }
  if (toStatus === 'UNDER_REVIEW' && dispute.status === 'INFO_REQUESTED') {
    // Submitter reply path — buyer/seller or REIA
    const isSubmitter = counterpartySide(req.user) === dispute.raised_by_role;
    if (!isSubmitter && !isReia(req.user)) {
      return res.status(403).json({ error: 'Only submitter or SJVN can return from Info Requested' });
    }
  } else if (['INFO_REQUESTED', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'ACKNOWLEDGED'].includes(toStatus)) {
    if (!isReia(req.user) && !(toStatus === 'UNDER_REVIEW' && dispute.status === 'INFO_REQUESTED')) {
      if (!REIA_WRITE.includes(req.user.role) && !isReia(req.user)) {
        // Buyer/Seller can only move INFO_REQUESTED -> UNDER_REVIEW
        if (!(dispute.status === 'INFO_REQUESTED' && toStatus === 'UNDER_REVIEW')) {
          return res.status(403).json({ error: 'Not authorized for this transition' });
        }
      }
    }
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
      pushNotification({
        role: dispute.raised_by_role,
        type: 'DISPUTE_INFO_REQUESTED',
        message: `Additional information requested on dispute ${dispute.dispute_no}`,
      });
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
    afterTotal = Math.max(0, beforeTotal - credit + lpsRes);
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
        other_adjustments, total_amount, disputed_amount, due_date, status, parent_invoice_id, created_by
      ) VALUES (?, ?, ?, 'SUPPLEMENTARY', ?, ?, 0, 0, 0, 0, 0, ?, 0, 0, 0, ?, ?, 0, date('now'), 'APPROVED', ?, ?)
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
      req.user.name
    );

    pushNotification({
      role: dispute.raised_by_role,
      type: 'SUPPLEMENTARY_INVOICE',
      message: `Supplementary invoice ${suppNo} generated for dispute ${dispute.dispute_no} (credit ₹${credit.toLocaleString('en-IN')})`,
    });
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

  pushNotification({
    role: dispute.raised_by_role,
    type: 'DISPUTE_RESOLVED',
    message: `Dispute ${dispute.dispute_no} resolved: ${outcome.replaceAll('_', ' ')}`,
  });
  const counterRole = dispute.raised_by_role === 'BUYER' ? 'SELLER' : 'BUYER';
  pushNotification({
    role: counterRole,
    type: 'DISPUTE_RESOLVED',
    message: `Dispute ${dispute.dispute_no} on invoice ${invoice.invoice_no} resolved: ${outcome.replaceAll('_', ' ')}`,
  });

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
  if (
    !internal &&
    dispute.status === 'INFO_REQUESTED' &&
    (req.user.role === dispute.raised_by_role || req.user.id === dispute.raised_by_user_id)
  ) {
    db.prepare(`UPDATE disputes SET status = 'UNDER_REVIEW', updated_at = datetime('now') WHERE id = ?`).run(dispute.id);
    recordEvent(dispute.id, req.user, 'STATUS_CHANGE', 'INFO_REQUESTED', 'UNDER_REVIEW', { via: 'comment_reply' });
    pushNotification({
      role: 'REIA_USER',
      type: 'DISPUTE',
      message: `Submitter replied on ${dispute.dispute_no} — back Under Review`,
    });
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
