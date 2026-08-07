import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, pushNotification, genApplicationNo, seedApplicationCounters } from '../util.js';
import { dispatch } from '../services/notificationService.js';
import { syncSchedulesForDate, getWbesConfig } from '../services/wbesService.js';
import { secureLogAudit } from '../auditEngine.js';
import { generateLoiPdf } from '../scripts/tradingReportsPdf.js';
import { getParam, getParamNumber } from '../mastersService.js';
import { generateNoarApprovalReportPdf } from '../scripts/noarApprovalReportPdf.js';
import { sendMail } from '../services/mailService.js';

const router = Router();

// Continue the ledger's NOAR application register (last filed was WR2850).
seedApplicationCounters();
router.use(requireAuth);

// NOAR open-access lifecycle, in the order the PT workflow walks it.
const NOAR_STATUSES = ['NOT_INITIATED', 'FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED'];
const OA_TYPES = ['STOA', 'MTOA', 'LTOA'];
// The linear happy path. REJECTED sits outside it — it is reached from
// SUBMITTED and leaves by going back to SUBMITTED.
const NOAR_FLOW_ORDER = ['NOT_INITIATED', 'FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED'];

/** SQLite stores UTC as 'YYYY-MM-DD HH:MM:SS'; JS would otherwise read it as local time. */
const parseUtc = (s) => (s ? new Date(`${String(s).replace(' ', 'T')}Z`) : null);
const hoursBetween = (from, to) => {
  const a = parseUtc(from); const b = parseUtc(to);
  if (!a || !b) return null;
  return Math.round(((b - a) / 36e5) * 10) / 10;
};

/**
 * Transition history for one transaction, with the time spent in each status.
 *
 * Transactions that moved before this tracking existed have no rows here. That
 * is reported as has_history:false rather than guessed at — a fabricated
 * transition time would understate or overstate approval turnaround.
 */
function buildNoarTimeline(tx) {
  const rows = db.prepare(
    'SELECT * FROM noar_status_timeline WHERE transaction_id = ? ORDER BY changed_at ASC, rowid ASC'
  ).all(tx.id);

  const entries = rows.map((r, i) => ({
    ...r,
    changed_by_name: r.changed_by
      ? db.prepare('SELECT name FROM users WHERE id = ?').get(r.changed_by)?.name || r.changed_by
      : null,
    // Time the transaction sat in status_from before this move.
    hours_in_previous_status: i === 0 ? null : hoursBetween(rows[i - 1].changed_at, r.changed_at),
  }));

  const last = rows[rows.length - 1];
  const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const at = (status) => [...rows].reverse().find((r) => r.status_to === status)?.changed_at || null;

  return {
    transaction_id: tx.id,
    current_status: tx.noar_status,
    noar_contract_no: tx.noar_contract_no,
    has_history: rows.length > 0,
    tracking_started_at: rows[0]?.changed_at || null,
    hours_in_current_status: last ? hoursBetween(last.changed_at, nowIso) : null,
    // Derived milestones — used for approval turnaround reporting.
    format_d_prepared_at: at('FORMAT_D_PREPARED'),
    contract_created_at: at('CONTRACT_CREATED'),
    submitted_at: at('SUBMITTED'),
    approved_at: at('APPROVED'),
    rejected_at: at('REJECTED'),
    resubmit_count: tx.noar_resubmit_count || 0,
    // Submission -> approval is the part Grid India controls.
    approval_turnaround_hours: hoursBetween(at('SUBMITTED'), at('APPROVED')),
    entries,
  };
}

const DEFAULT_SLA_DAYS = { STOA: 7, MTOA: 15, LTOA: 30 };

/** SLA target in days for an open-access term, from configurable master data. */
function slaDaysFor(oaType) {
  const map = getParam('noar_sla_days', null);
  const n = Number(map && typeof map === 'object' ? map[oaType] : undefined);
  return Number.isFinite(n) && n > 0 ? n : (DEFAULT_SLA_DAYS[oaType] ?? DEFAULT_SLA_DAYS.STOA);
}

/**
 * How the NOAR approval is tracking against its target.
 *
 * The clock runs from submission to approval — the stretch Grid India controls.
 * Anything not yet submitted has no SLA to measure, which is reported as
 * NOT_APPLICABLE rather than as a passing result.
 *
 *   NOT_APPLICABLE  not submitted yet
 *   ON_TRACK        pending, inside the warning threshold
 *   AT_RISK         pending, past the warning fraction of the target
 *   BREACHED        pending, past the target
 *   MET             approved within the target
 *   MISSED          approved, but it took longer than the target
 */
function buildNoarSla(tx, timeline) {
  const targetDays = slaDaysFor(tx.oa_type);
  const base = { oa_type: tx.oa_type, target_days: targetDays, resubmit_count: tx.noar_resubmit_count || 0 };
  const days = (from, to) => Math.round((hoursBetween(from, to) / 24) * 10) / 10;

  // The current status decides which branch applies, not merely which
  // timestamps exist — after a resubmission the timeline still holds the
  // earlier rejection, which is history rather than the live position.
  if (!timeline.submitted_at || !['SUBMITTED', 'APPROVED', 'REJECTED'].includes(tx.noar_status)) {
    return { ...base, state: 'NOT_APPLICABLE', elapsed_days: null, days_remaining: null, is_open: false };
  }

  if (tx.noar_status === 'APPROVED') {
    const elapsed = days(timeline.submitted_at, timeline.approved_at);
    return {
      ...base, state: elapsed > targetDays ? 'MISSED' : 'MET', elapsed_days: elapsed,
      days_remaining: null, is_open: false, submitted_at: timeline.submitted_at, approved_at: timeline.approved_at,
    };
  }

  // Rejected: the wait ended, and resubmitting is now on SJVN rather than on
  // Grid India, so the approval clock stops instead of running up a breach.
  if (tx.noar_status === 'REJECTED') {
    return {
      ...base, state: 'REJECTED', elapsed_days: days(timeline.submitted_at, timeline.rejected_at),
      days_remaining: null, is_open: false,
      submitted_at: timeline.submitted_at, rejected_at: timeline.rejected_at,
      rejection_category: tx.noar_rejection_category, rejection_reason: tx.noar_rejection_reason,
    };
  }

  const warnFraction = getParamNumber('noar_sla_warning_fraction', 0.7);
  const elapsedDays = days(timeline.submitted_at, new Date().toISOString().slice(0, 19).replace('T', ' '));
  return {
    ...base,
    state: elapsedDays > targetDays ? 'BREACHED' : (elapsedDays >= targetDays * warnFraction ? 'AT_RISK' : 'ON_TRACK'),
    elapsed_days: elapsedDays,
    days_remaining: Math.round((targetDays - elapsedDays) * 10) / 10,
    is_open: true,
    submitted_at: timeline.submitted_at,
  };
}

const withDetails = (tx) => {
  if (!tx) return tx;
  const client = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(tx.client_id);
  tx.client_name = client?.name;
  tx.noar_timeline = buildNoarTimeline(tx);
  tx.noar_sla = buildNoarSla(tx, tx.noar_timeline);
  
  tx.schedules = db.prepare('SELECT * FROM bilateral_schedules WHERE transaction_id = ? ORDER BY schedule_date DESC, time_block ASC').all(tx.id);
  
  tx.schedules.forEach(sched => {
    sched.approvals = db.prepare('SELECT * FROM bilateral_approvals WHERE schedule_id = ?').all(sched.id);
  });
  
  return tx;
};

// List bilateral transactions
router.get('/', (req, res) => {
  const { status, oa_type } = req.query;
  let sql = 'SELECT * FROM bilateral_transactions WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (oa_type) { sql += ' AND oa_type = ?'; params.push(oa_type); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withDetails));
});

// Portfolio view of open-access approval performance. Shared by the API, the
// PDF report and the weekly digest so all three quote the same figures.
function noarSlaSummary() {
  const rows = db.prepare('SELECT * FROM bilateral_transactions').all();
  const counts = { NOT_APPLICABLE: 0, ON_TRACK: 0, AT_RISK: 0, BREACHED: 0, MET: 0, MISSED: 0, REJECTED: 0 };
  const attention = [];
  let closedTotalDays = 0; let closedCount = 0;

  for (const tx of rows) {
    const sla = buildNoarSla(tx, buildNoarTimeline(tx));
    counts[sla.state] += 1;
    if (sla.state === 'MET' || sla.state === 'MISSED') { closedTotalDays += sla.elapsed_days; closedCount += 1; }
    // Rejected applications are on the desk to fix and resubmit, so they belong
    // on the same worklist as the ones running late.
    if (['AT_RISK', 'BREACHED', 'REJECTED'].includes(sla.state)) {
      attention.push({
        id: tx.id,
        counterparty: tx.counterparty,
        noar_contract_no: tx.noar_contract_no,
        oa_type: tx.oa_type,
        state: sla.state,
        elapsed_days: sla.elapsed_days,
        target_days: sla.target_days,
        days_remaining: sla.days_remaining,
        rejection_reason: sla.rejection_reason,
      });
    }
  }
  attention.sort((a, b) => b.elapsed_days - a.elapsed_days);

  const decided = counts.MET + counts.MISSED;
  return {
    counts,
    pending_total: counts.ON_TRACK + counts.AT_RISK + counts.BREACHED,
    // Share of *decided* approvals that landed within target — pending ones
    // have no outcome yet and would otherwise flatter the number.
    on_time_rate_pct: decided ? Math.round((counts.MET / decided) * 1000) / 10 : null,
    avg_approval_days: closedCount ? Math.round((closedTotalDays / closedCount) * 10) / 10 : null,
    targets: getParam('noar_sla_days', DEFAULT_SLA_DAYS),
    warning_fraction: getParamNumber('noar_sla_warning_fraction', 0.7),
    needs_attention: attention,
  };
}

/** Applications whose approval has been decided, most recently decided first. */
function decidedApplications(limit = 40) {
  return db.prepare("SELECT * FROM bilateral_transactions WHERE noar_status IN ('APPROVED','REJECTED')").all()
    .map((tx) => {
      const timeline = buildNoarTimeline(tx);
      const sla = buildNoarSla(tx, timeline);
      return {
        id: tx.id,
        counterparty: tx.counterparty,
        noar_contract_no: tx.noar_contract_no,
        oa_type: tx.oa_type,
        state: sla.state,
        elapsed_days: sla.elapsed_days,
        submitted_at: timeline.submitted_at,
        decided_at: timeline.approved_at || timeline.rejected_at,
      };
    })
    .filter((r) => r.decided_at)
    .sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))
    .slice(0, limit);
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote when the value holds a delimiter, quote or newline; double inner quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// These three are declared ahead of '/:id' so their paths are not read as
// transaction ids — Express matches in declaration order.
router.get('/noar-sla', (_req, res) => res.json(noarSlaSummary()));

/** Every recorded transition, for audit and offline review. */
router.get('/noar-timeline.csv', (_req, res) => {
  const txs = db.prepare('SELECT * FROM bilateral_transactions ORDER BY created_at DESC').all();
  const lines = [[
    'transaction_id', 'client', 'counterparty', 'oa_type', 'noar_contract_no',
    'status_from', 'status_to', 'changed_at_utc', 'changed_by', 'hours_in_previous_status', 'note',
  ].join(',')];

  for (const tx of txs) {
    const client = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(tx.client_id)?.name;
    for (const e of buildNoarTimeline(tx).entries) {
      lines.push([
        tx.id, client, tx.counterparty, tx.oa_type, e.noar_contract_no,
        e.status_from, e.status_to, e.changed_at, e.changed_by_name,
        e.hours_in_previous_status, e.note,
      ].map(csvCell).join(','));
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="SJVN_NOAR_Timeline_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

router.get('/noar-approval-report.pdf', (_req, res) => {
  generateNoarApprovalReportPdf(noarSlaSummary(), decidedApplications(), res);
});

// Get single transaction
router.get('/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(withDetails(tx));
});

// Create new transaction
router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('BIL');

  // Validate before touching the DB, so a missing field is a 400 naming the
  // field rather than a 500 carrying a raw SQLite constraint message.
  const errors = [];
  if (!b.client_id) errors.push('client_id is required');
  else if (!db.prepare('SELECT 1 FROM trading_clients WHERE id = ?').get(b.client_id)) errors.push('client_id does not exist');
  if (!String(b.counterparty || '').trim()) errors.push('counterparty is required');
  const oaType = b.oa_type || 'STOA';
  if (!OA_TYPES.includes(oaType)) errors.push(`oa_type must be one of: ${OA_TYPES.join(', ')}`);
  const qty = Number(b.quantum_mw);
  if (!Number.isFinite(qty) || qty <= 0) errors.push('quantum_mw must be a positive number');

  // Resolve the purchase / sale / margin triangle. Callers may send any two and
  // let the third be derived; a legacy caller sends only tariff_per_unit, which
  // is treated as the sale rate (the rate billed to the buyer). The default
  // margin is the standard ISET ₹0.030/kWh.
  const DEFAULT_MARGIN = 0.03;
  let saleRate = b.sale_rate_per_unit != null ? Number(b.sale_rate_per_unit) : Number(b.tariff_per_unit);
  let purchaseRate = b.purchase_rate_per_unit != null ? Number(b.purchase_rate_per_unit) : null;
  let margin = b.trading_margin_per_unit != null ? Number(b.trading_margin_per_unit) : null;
  // If purchase and sale are both known, the margin follows from them.
  if (purchaseRate != null && margin == null && Number.isFinite(saleRate)) {
    margin = Number((saleRate - purchaseRate).toFixed(4));
  }
  if (margin == null) margin = DEFAULT_MARGIN;
  // Derive whichever leg is still missing from the other two.
  if (purchaseRate == null && Number.isFinite(saleRate)) {
    purchaseRate = Number((saleRate - margin).toFixed(4));
  }
  if ((saleRate == null || !Number.isFinite(saleRate)) && purchaseRate != null) {
    saleRate = Number((purchaseRate + margin).toFixed(4));
  }

  if (!Number.isFinite(saleRate) || saleRate < 0) errors.push('sale_rate_per_unit (or tariff_per_unit) must be a non-negative number');
  if (!Number.isFinite(purchaseRate) || purchaseRate < 0) errors.push('purchase_rate_per_unit must be a non-negative number');
  if (!Number.isFinite(margin) || margin < 0) errors.push('trading_margin_per_unit must be a non-negative number');
  // The core invariant: sale - purchase must equal the stated margin.
  if (Number.isFinite(saleRate) && Number.isFinite(purchaseRate) && Number.isFinite(margin)
      && Math.abs(saleRate - purchaseRate - margin) > 0.001) {
    errors.push(`sale_rate (${saleRate}) - purchase_rate (${purchaseRate}) must equal trading_margin (${margin})`);
  }
  if (!b.start_date) errors.push('start_date is required');
  if (!b.end_date) errors.push('end_date is required');
  if (b.start_date && b.end_date && b.end_date < b.start_date) errors.push('end_date cannot be before start_date');
  for (const leg of ['loss_injection_state', 'loss_inter_state', 'loss_drawee_state']) {
    const v = Number(b[leg] ?? 0);
    if (!Number.isFinite(v) || v < 0 || v > 100) errors.push(`${leg} must be a percentage between 0 and 100`);
  }
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  // File under a NOAR application number derived from the start date, unless the
  // caller supplied one (e.g. an application already filed on the portal).
  const region = String(b.noar_region || 'WR').toUpperCase();
  const applicationNo = b.noar_application_no || genApplicationNo(b.start_date, region);

  db.prepare(`
    INSERT INTO bilateral_transactions (
      id, client_id, counterparty, loi_contract_ref, oa_type, is_standing_clearance,
      quantum_mw, tariff_per_unit, purchase_rate_per_unit, sale_rate_per_unit, trading_margin_per_unit, open_access_status,
      noar_application_no, noar_region,
      wheeling_charges, transmission_charges, loss_injection_state, loss_inter_state, loss_drawee_state,
      start_date, end_date, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(
    id, b.client_id, String(b.counterparty).trim(), b.loi_contract_ref || null, oaType, b.is_standing_clearance ? 1 : 0,
    qty, saleRate, purchaseRate, saleRate, margin, applicationNo, region,
    Number(b.wheeling_charges) || 0, Number(b.transmission_charges) || 0,
    Number(b.loss_injection_state) || 0, Number(b.loss_inter_state) || 0, Number(b.loss_drawee_state) || 0,
    b.start_date, b.end_date
  );

  // A margin other than the standard ISET ₹0.03/kWh is a deliberate commercial
  // decision worth surfacing in the audit trail, not a silent field change.
  const marginOverride = Math.abs(margin - DEFAULT_MARGIN) > 0.0001;
  secureLogAudit(req, {
    action: 'CREATE_BILATERAL', module: 'TRADING', entityType: 'bilateral_tx', entityId: id,
    details: { ...b, purchase_rate_per_unit: purchaseRate, sale_rate_per_unit: saleRate, trading_margin_per_unit: margin, margin_override: marginOverride },
  });
  res.status(201).json(withDetails(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(id)));
});

// Create Schedule
router.post('/:id/schedules', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });

  const blocks = Array.isArray(req.body.blocks) ? req.body.blocks : [req.body];
  
  const insertSchedule = db.prepare(`
    INSERT INTO bilateral_schedules (id, transaction_id, schedule_date, time_block, approved_mw, status)
    VALUES (?, ?, ?, ?, ?, 'PENDING')
  `);
  
  const insertApproval = db.prepare(`INSERT INTO bilateral_approvals (id, schedule_id, node_type, status, acted_by, timestamp) VALUES (?, ?, ?, ?, ?, ?)`);
  const updateApproved = db.prepare(`UPDATE bilateral_schedules SET status = 'APPROVED' WHERE id = ?`);

  const createMany = db.transaction((blocksList) => {
    for (const b of blocksList) {
      const schedId = newId('SCH');
      insertSchedule.run(schedId, tx.id, b.schedule_date || req.body.schedule_date, b.time_block, b.approved_mw);
      
      const nodes = ['INJECTION_SLDC', 'RLDC', 'NLDC', 'DRAWEE_SLDC'];
      const initialStatus = tx.is_standing_clearance ? 'APPROVED' : 'PENDING';
      
      for (const node of nodes) {
        insertApproval.run(newId('BAP'), schedId, node, initialStatus, tx.is_standing_clearance ? 'SYSTEM_AUTO' : null, tx.is_standing_clearance ? new Date().toISOString() : null);
      }
      
      if (tx.is_standing_clearance) {
        updateApproved.run(schedId);
      }
    }
  });

  createMany(blocks);
  secureLogAudit(req, { action: 'CREATE_SCHEDULE', module: 'TRADING', entityType: 'bilateral_schedule', entityId: tx.id, details: { block_count: blocks.length } });
  res.status(201).json(withDetails(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(tx.id)));
});

// Update Hop Approval
router.post('/schedules/:id/approvals', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const { node_type, status } = req.body; // node_type: RLDC, status: APPROVED
  const sched = db.prepare('SELECT * FROM bilateral_schedules WHERE id = ?').get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'Not found' });

  db.prepare(`UPDATE bilateral_approvals SET status = ?, acted_by = ?, timestamp = ? WHERE schedule_id = ? AND node_type = ?`)
    .run(status, req.user.id, new Date().toISOString(), sched.id, node_type);

  // Check if all nodes approved
  const approvals = db.prepare('SELECT status FROM bilateral_approvals WHERE schedule_id = ?').all(sched.id);
  if (approvals.every(a => a.status === 'APPROVED')) {
    db.prepare(`UPDATE bilateral_schedules SET status = 'APPROVED' WHERE id = ?`).run(sched.id);
  } else if (approvals.some(a => a.status === 'REJECTED')) {
    db.prepare(`UPDATE bilateral_schedules SET status = 'CANCELLED' WHERE id = ?`).run(sched.id);
  }

  secureLogAudit(req, { action: 'NODE_APPROVAL', module: 'TRADING', entityType: 'bilateral_schedule', entityId: sched.id, details: { node_type, status }});
  
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(sched.transaction_id);
  res.json(withDetails(tx));
});

// Curtailment
router.post('/schedules/:id/curtail', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const { curtailed_mw } = req.body;
  const sched = db.prepare('SELECT * FROM bilateral_schedules WHERE id = ?').get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'Not found' });

  db.prepare(`UPDATE bilateral_schedules SET curtailed_mw = ?, status = 'CURTAILED' WHERE id = ?`).run(curtailed_mw, sched.id);

  secureLogAudit(req, { action: 'CURTAIL_SCHEDULE', module: 'TRADING', entityType: 'bilateral_schedule', entityId: sched.id, details: { curtailed_mw }});
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(sched.transaction_id);
  res.json(withDetails(tx));
});

// Record Actuals & DSM Penalty
router.post('/schedules/:id/actuals', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const { actual_mw } = req.body;
  const sched = db.prepare('SELECT * FROM bilateral_schedules WHERE id = ?').get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'Not found' });

  const effectiveApproved = sched.approved_mw - sched.curtailed_mw;
  const deviation = actual_mw - effectiveApproved;
  
  // Standard DSM logic (simplified for demo: Rs 60/MW for over/under injection)
  const dsm_penalty = Math.abs(deviation) * 60; 

  db.prepare(`UPDATE bilateral_schedules SET actual_mw = ?, deviation_mw = ?, dsm_penalty_amount = ? WHERE id = ?`).run(
    actual_mw, deviation, dsm_penalty, sched.id
  );

  secureLogAudit(req, { action: 'RECORD_ACTUALS', module: 'TRADING', entityType: 'bilateral_schedule', entityId: sched.id, details: { actual_mw, deviation, dsm_penalty }});
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(sched.transaction_id);
  res.json(withDetails(tx));
});

// Format-D: 15-minute block-wise schedule document (CSV) for a bilateral txn.
router.get('/:id/format-d', (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  const schedules = db.prepare('SELECT * FROM bilateral_schedules WHERE transaction_id = ? ORDER BY schedule_date ASC, time_block ASC').all(tx.id);

  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [];
  lines.push(`Format-D — Bilateral Open Access Schedule`);
  lines.push(`Transaction,${esc(tx.id)}`);
  lines.push(`Counterparty,${esc(tx.counterparty)}`);
  lines.push(`Quantum (MW),${tx.quantum_mw}`);
  lines.push(`Period,${esc(tx.start_date)} to ${esc(tx.end_date)}`);
  lines.push(`NOAR Contract,${esc(tx.noar_contract_no || '')}`);
  lines.push('');
  lines.push('Sr,Date,Time Block,Scheduled MW,Curtailed MW,Status');
  schedules.forEach((s, i) => {
    lines.push([i + 1, esc(s.schedule_date), esc(s.time_block), s.approved_mw, s.curtailed_mw || 0, esc(s.status)].join(','));
  });
  if (!schedules.length) lines.push(',,,No block schedules yet,,');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="Format_D_Bilateral_${tx.id}.csv"`);
  res.send(lines.join('\n'));
});

// Generate LoI (Letter of Intent) PDF
router.get('/:id/loi', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const tx = db.prepare(`
    SELECT bt.*, tc.name AS client_name, tc.standing_clearance_no, tc.noar_id AS client_noar_id,
           e.pan_no AS pan_number, e.gst_no AS gstin, e.address, e.signatory_name
    FROM bilateral_transactions bt
    LEFT JOIN trading_clients tc ON bt.client_id = tc.id
    LEFT JOIN entities e ON tc.entity_id = e.id
    WHERE bt.id = ?
  `).get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });

  secureLogAudit(req, { action: 'EXPORT_LOI', module: 'TRADING', entityType: 'bilateral_transaction', entityId: tx.id });
  generateLoiPdf(tx, { generatedBy: req.user?.name || 'Trading Officer' }, res);
});

// Bulk NOAR step for a selected set of transactions.
//
// Deliberately stricter than the single-transaction endpoint: a bulk move may
// only take the next step in the flow, resubmit a rejected application, or
// record a rejection. One mis-click here would otherwise mark a whole page of
// draft transactions as approved.
//
// CONTRACT_CREATED is excluded because every application gets its own NOAR
// contract number, which cannot come from a single shared field.
const BULK_TARGETS = ['FORMAT_D_PREPARED', 'SUBMITTED', 'APPROVED', 'REJECTED'];

router.post('/noar/bulk', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const to = String(req.body.to_status ?? '').trim();
  const dryRun = !!req.body.dry_run;

  if (!ids.length) return res.status(400).json({ error: 'Select at least one transaction' });
  if (!BULK_TARGETS.includes(to)) {
    return res.status(400).json({ error: `to_status must be one of: ${BULK_TARGETS.join(', ')}` });
  }
  const rejectionReason = String(req.body.rejection_reason ?? '').trim();
  if (to === 'REJECTED' && !rejectionReason) {
    return res.status(400).json({ error: 'rejection_reason is required when recording rejections' });
  }

  /** The one move this transaction is allowed to make towards `to`. */
  const check = (tx) => {
    if (!tx) return 'Transaction not found';
    if (tx.noar_status === to) return `Already ${to}`;
    if (to === 'REJECTED') {
      return tx.noar_status === 'SUBMITTED' ? null : `Only a SUBMITTED application can be rejected (is ${tx.noar_status})`;
    }
    if (tx.noar_status === 'REJECTED') {
      // REJECTED is off the linear path, so index arithmetic would name a
      // nonsense next step here.
      return to === 'SUBMITTED' ? null : 'A rejected application can only be resubmitted (SUBMITTED)';
    }
    if (tx.noar_status === 'APPROVED') return 'Already approved — no further step';
    const expected = NOAR_FLOW_ORDER[NOAR_FLOW_ORDER.indexOf(tx.noar_status) + 1];
    return expected === to ? null : `Next step from ${tx.noar_status} is ${expected}, not ${to}`;
  };

  const rows = ids.map((id) => db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(id));
  const results = rows.map((tx, i) => {
    const problem = check(tx);
    return {
      id: ids[i],
      counterparty: tx?.counterparty ?? null,
      from: tx?.noar_status ?? null,
      to,
      ok: !problem,
      reason: problem || undefined,
    };
  });
  const eligible = results.filter((r) => r.ok);

  // Skipping the ineligible rather than failing the whole batch: each
  // application is independent, and the preview says exactly what will move.
  if (!dryRun && eligible.length) {
    const apply = db.transaction(() => {
      for (const r of eligible) {
        const tx = rows[ids.indexOf(r.id)];
        const isResubmission = tx.noar_status === 'REJECTED' && to === 'SUBMITTED';
        db.prepare(`UPDATE bilateral_transactions
                    SET noar_status = ?, noar_sla_alerted_state = NULL,
                        noar_rejection_category = ?, noar_rejection_reason = ?,
                        noar_resubmit_count = noar_resubmit_count + ?
                    WHERE id = ?`)
          .run(
            to,
            to === 'REJECTED' ? (req.body.rejection_category || null) : null,
            to === 'REJECTED' ? rejectionReason : null,
            isResubmission ? 1 : 0,
            tx.id,
          );
        const note = to === 'REJECTED'
          ? [req.body.rejection_category, rejectionReason].filter(Boolean).join(' — ')
          : (req.body.note || null);
        db.prepare(`
          INSERT INTO noar_status_timeline (id, transaction_id, status_from, status_to, noar_contract_no, changed_by, note)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(newId('NTL'), tx.id, tx.noar_status, to, tx.noar_contract_no || null, req.user.id, note);
      }
    });
    apply();

    if (to === 'REJECTED') {
      dispatch({
        event: 'NOAR_REJECTED', role: 'MANAGEMENT',
        subject: 'NOAR applications rejected',
        message: `SJVN: ${eligible.length} NOAR application(s) rejected — ${rejectionReason}`,
      }).catch((err) => console.error('[NOTIFY] NOAR_REJECTED (bulk) failed', err.message));
    }
    secureLogAudit(req, { action: 'NOAR_BULK_UPDATE', module: 'TRADING', entityType: 'bilateral_transaction', entityId: eligible.map((r) => r.id).join(','), details: { to, applied: eligible.length, skipped: results.length - eligible.length } });
  }

  res.json({
    dry_run: dryRun,
    requested: results.length,
    will_apply: eligible.length,
    applied: dryRun ? 0 : eligible.length,
    skipped: results.length - eligible.length,
    results,
  });
});

// NOAR portal contract lifecycle update.
router.post('/:id/noar', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  if (req.body.noar_status !== undefined && !NOAR_STATUSES.includes(req.body.noar_status)) {
    return res.status(400).json({ error: `noar_status must be one of: ${NOAR_STATUSES.join(', ')}` });
  }
  const noar_status = req.body.noar_status ?? tx.noar_status;
  const contractNo = req.body.noar_contract_no ?? tx.noar_contract_no;
  const isTransition = noar_status !== tx.noar_status;

  // Only a submitted application can come back rejected, and a rejection is
  // only actionable if it says why.
  const rejectionReason = String(req.body.rejection_reason ?? '').trim();
  if (noar_status === 'REJECTED' && isTransition) {
    if (tx.noar_status !== 'SUBMITTED') {
      return res.status(400).json({ error: `Only a SUBMITTED application can be rejected (currently ${tx.noar_status})` });
    }
    if (!rejectionReason) return res.status(400).json({ error: 'rejection_reason is required when recording a rejection' });
  }
  const isResubmission = isTransition && tx.noar_status === 'REJECTED' && noar_status === 'SUBMITTED';

  // Record the transition before the row changes, so status_from is the real
  // previous value. A no-op save (same status) is not a transition.
  const write = db.transaction(() => {
    // Clearing the alerted state on a move means a re-submission is allowed to
    // warn again, and an approved one stops carrying a stale breach flag.
    // Rejection detail belongs to the current rejection only, so resubmitting
    // clears it rather than leaving a stale reason on a live application.
    db.prepare(`UPDATE bilateral_transactions
                SET noar_contract_no = ?, noar_status = ?,
                    noar_sla_alerted_state = CASE WHEN ? THEN NULL ELSE noar_sla_alerted_state END,
                    noar_rejection_category = ?, noar_rejection_reason = ?,
                    noar_resubmit_count = noar_resubmit_count + ?
                WHERE id = ?`)
      .run(
        contractNo, noar_status, isTransition ? 1 : 0,
        noar_status === 'REJECTED' ? (req.body.rejection_category || null) : null,
        noar_status === 'REJECTED' ? (rejectionReason || tx.noar_rejection_reason) : null,
        isResubmission ? 1 : 0,
        tx.id,
      );
    if (isTransition) {
      const note = noar_status === 'REJECTED'
        ? [req.body.rejection_category, rejectionReason].filter(Boolean).join(' — ')
        : (req.body.note || null);
      db.prepare(`
        INSERT INTO noar_status_timeline (id, transaction_id, status_from, status_to, noar_contract_no, changed_by, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newId('NTL'), tx.id, tx.noar_status, noar_status, contractNo || null, req.user.id, note);
    }
  });
  write();

  // Fire-and-forget so email/SMS latency never blocks the API response; the
  // delivery log still records the outcome.
  if (noar_status === 'REJECTED' && isTransition) {
    dispatch({
      event: 'NOAR_REJECTED', role: 'MANAGEMENT',
      subject: `NOAR application rejected — ${tx.counterparty}`,
      message: `SJVN: NOAR application rejected for ${tx.counterparty} (${contractNo || tx.id}) — ${rejectionReason}`,
    }).catch((err) => console.error('[NOTIFY] NOAR_REJECTED failed', err.message));
  } else if (noar_status === 'APPROVED' && isTransition) {
    dispatch({
      event: 'NOAR_APPROVED', role: 'TRADING_USER',
      subject: `NOAR approval received — ${tx.counterparty}`,
      message: `SJVN: NOAR open-access approved for ${tx.counterparty} (${contractNo || tx.id}). Schedules can now be punched.`,
    }).catch((err) => console.error('[NOTIFY] NOAR_APPROVED failed', err.message));
  }

  secureLogAudit(req, { action: 'NOAR_UPDATE', module: 'TRADING', entityType: 'bilateral_transaction', entityId: tx.id, details: { from: tx.noar_status, to: noar_status, noar_contract_no: contractNo, rejection_reason: rejectionReason || undefined, resubmission: isResubmission || undefined } });
  res.json(withDetails(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(tx.id)));
});

/**
 * Raise a notification when a pending approval first becomes AT_RISK or
 * BREACHED. The alerted state is stored so a long-pending application does not
 * re-notify on every sweep; a transaction that moves on resets it.
 */
export function runNoarSlaAlerts() {
  const rows = db.prepare("SELECT * FROM bilateral_transactions WHERE noar_status = 'SUBMITTED'").all();
  let sent = 0;
  for (const tx of rows) {
    const sla = buildNoarSla(tx, buildNoarTimeline(tx));
    const notable = sla.state === 'AT_RISK' || sla.state === 'BREACHED';
    if (!notable || tx.noar_sla_alerted_state === sla.state) continue;

    const ref = tx.noar_contract_no || tx.id;
    dispatch({
      event: sla.state === 'BREACHED' ? 'NOAR_SLA_BREACHED' : 'NOAR_SLA_AT_RISK',
      role: 'MANAGEMENT',
      subject: `NOAR approval ${sla.state === 'BREACHED' ? 'overdue' : 'at risk'} — ${tx.counterparty}`,
      message: sla.state === 'BREACHED'
        ? `SJVN: NOAR approval overdue for ${tx.counterparty} (${ref}) — ${sla.elapsed_days}d pending against a ${sla.target_days}d ${tx.oa_type} target`
        : `SJVN: NOAR approval at risk for ${tx.counterparty} (${ref}) — ${sla.elapsed_days}d of ${sla.target_days}d ${tx.oa_type} target elapsed`,
    }).catch((err) => console.error('[NOTIFY] NOAR_SLA failed', err.message));
    db.prepare('UPDATE bilateral_transactions SET noar_sla_alerted_state = ? WHERE id = ?').run(sla.state, tx.id);
    sent += 1;
  }
  return { sent };
}

// Manual trigger for the same sweep the scheduler runs.
// Pull approved 15-minute block schedules for a delivery date from the NOAR /
// State WBES platform into bilateral_schedules. Read-only against WBES; runs in
// stub mode until credentials are configured.
router.post('/wbes/sync', requireRole(...ROLE_GROUPS.TRADING_WRITE), async (req, res) => {
  const date = String(req.body?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
  }
  const revisionNo = Number.isFinite(Number(req.body?.revision_no)) ? Number(req.body.revision_no) : -1;
  const dryRun = !!req.body?.dry_run;
  try {
    const result = await syncSchedulesForDate(date, { revisionNo, dryRun });
    if (!result.ok) return res.status(502).json(result);
    if (!dryRun) {
      secureLogAudit(req, { action: 'WBES_SCHEDULE_SYNC', module: 'TRADING', entityType: 'bilateral_schedule', entityId: date, details: { mode: result.mode, matched: result.matched.length, unmatched: result.unmatched.length, blocks: result.blocks_written } });
    }
    res.json(result);
  } catch (err) {
    console.error('WBES sync error:', err);
    res.status(500).json({ error: err.message || 'WBES sync failed' });
  }
});

router.get('/wbes/status', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  const cfg = getWbesConfig();
  res.json({
    enabled: cfg.enabled,
    live: cfg.live,
    base_url_set: !!cfg.baseUrl,
    api_key_set: !!cfg.apiKey,
    username_set: !!cfg.userName,
    utility_acronym: cfg.utility || null,
    mode: cfg.live ? 'WBES' : 'STUB',
    note: cfg.live ? null : 'Running in stub mode — set wbes_enabled, wbes_api_key and wbes_base_url to pull live schedules.',
  });
});

router.post('/noar-sla/check', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  res.json(runNoarSlaAlerts());
});

/**
 * Weekly digest of where open-access approvals stand.
 *
 * Recipients come from master data and there is no fallback list — mailing a
 * guessed address would be worse than not sending. With no SMTP host set,
 * mailService writes the message to backend/outbox/ instead.
 */
export async function sendNoarWeeklyDigest() {
  const raw = String(getParam('noar_sla_digest_recipients', '') || '').trim();
  const to = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { ok: false, skipped: 'No recipients configured (noar_sla_digest_recipients)' };

  const s = noarSlaSummary();
  const line = (a) => `  • ${a.counterparty} (${a.noar_contract_no || a.id}) — ${STATE_TEXT[a.state]}, ${a.elapsed_days}d of ${a.target_days}d target`
    + (a.rejection_reason ? `\n      reason: ${a.rejection_reason}` : '');

  const text = [
    'NOAR open-access approvals — weekly digest',
    '',
    `Pending approvals : ${s.pending_total}  (${s.counts.ON_TRACK} on track, ${s.counts.AT_RISK} at risk, ${s.counts.BREACHED} overdue)`,
    `Rejected, awaiting resubmission : ${s.counts.REJECTED}`,
    `On-time rate : ${s.on_time_rate_pct === null ? 'no decided approvals yet' : `${s.on_time_rate_pct}% of ${s.counts.MET + s.counts.MISSED} decided`}`,
    `Average approval time : ${s.avg_approval_days === null ? '—' : `${s.avg_approval_days} days`}`,
    `Targets : ${Object.entries(s.targets).map(([k, v]) => `${k} ${v}d`).join(', ')}`,
    '',
    s.needs_attention.length ? `Needs attention (${s.needs_attention.length}):` : 'Nothing overdue, at risk or rejected.',
    ...s.needs_attention.map(line),
    '',
    'Measured from submission to NLDC approval. Generated by the SJVN Energy Platform.',
  ].join('\n');

  const result = await sendMail({
    to,
    subject: `NOAR approvals — ${s.pending_total} pending, ${s.needs_attention.length} need attention`,
    text,
  });
  return { ...result, recipients: to.length, needs_attention: s.needs_attention.length };
}

const STATE_TEXT = {
  ON_TRACK: 'on track', AT_RISK: 'at risk', BREACHED: 'overdue', REJECTED: 'rejected',
  MET: 'met target', MISSED: 'missed target', NOT_APPLICABLE: 'not submitted',
};

// Manual trigger, so the digest can be checked without waiting for Monday.
router.post('/noar-sla/digest', requireRole(...ROLE_GROUPS.TRADING_WRITE), async (req, res) => {
  res.json(await sendNoarWeeklyDigest());
});

// Full transition history for one transaction.
router.get('/:id/noar-timeline', (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(buildNoarTimeline(tx));
});

export default router;
