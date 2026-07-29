import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, pushNotification } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParam, getParamNumber } from '../mastersService.js';

const router = Router();
router.use(requireAuth);

// NOAR open-access lifecycle, in the order the PT workflow walks it.
const NOAR_STATUSES = ['NOT_INITIATED', 'FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED'];
const OA_TYPES = ['STOA', 'MTOA', 'LTOA'];

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

// Portfolio view of open-access approval performance.
// Declared before '/:id' so "noar-sla" is not swallowed as a transaction id.
router.get('/noar-sla', (req, res) => {
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
  res.json({
    counts,
    pending_total: counts.ON_TRACK + counts.AT_RISK + counts.BREACHED,
    // Share of *decided* approvals that landed within target — pending ones
    // have no outcome yet and would otherwise flatter the number.
    on_time_rate_pct: decided ? Math.round((counts.MET / decided) * 1000) / 10 : null,
    avg_approval_days: closedCount ? Math.round((closedTotalDays / closedCount) * 10) / 10 : null,
    targets: getParam('noar_sla_days', DEFAULT_SLA_DAYS),
    warning_fraction: getParamNumber('noar_sla_warning_fraction', 0.7),
    needs_attention: attention,
  });
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
  const tariff = Number(b.tariff_per_unit);
  if (!Number.isFinite(tariff) || tariff < 0) errors.push('tariff_per_unit must be a non-negative number');
  if (!b.start_date) errors.push('start_date is required');
  if (!b.end_date) errors.push('end_date is required');
  if (b.start_date && b.end_date && b.end_date < b.start_date) errors.push('end_date cannot be before start_date');
  for (const leg of ['loss_injection_state', 'loss_inter_state', 'loss_drawee_state']) {
    const v = Number(b[leg] ?? 0);
    if (!Number.isFinite(v) || v < 0 || v > 100) errors.push(`${leg} must be a percentage between 0 and 100`);
  }
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  db.prepare(`
    INSERT INTO bilateral_transactions (
      id, client_id, counterparty, loi_contract_ref, oa_type, is_standing_clearance, 
      quantum_mw, tariff_per_unit, open_access_status, 
      wheeling_charges, transmission_charges, loss_injection_state, loss_inter_state, loss_drawee_state, 
      start_date, end_date, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(
    id, b.client_id, String(b.counterparty).trim(), b.loi_contract_ref || null, oaType, b.is_standing_clearance ? 1 : 0,
    qty, tariff, Number(b.wheeling_charges) || 0, Number(b.transmission_charges) || 0,
    Number(b.loss_injection_state) || 0, Number(b.loss_inter_state) || 0, Number(b.loss_drawee_state) || 0,
    b.start_date, b.end_date
  );

  secureLogAudit(req, { action: 'CREATE_BILATERAL', module: 'TRADING', entityType: 'bilateral_tx', entityId: id, details: b });
  res.status(201).json(withDetails(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(id)));
});

// Create Schedule
router.post('/:id/schedules', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });

  const b = req.body;
  const schedId = newId('SCH');

  db.prepare(`
    INSERT INTO bilateral_schedules (id, transaction_id, schedule_date, time_block, approved_mw, status)
    VALUES (?, ?, ?, ?, ?, 'PENDING')
  `).run(schedId, tx.id, b.schedule_date, b.time_block, b.approved_mw);

  // Initialize multi-hop approvals based on standing clearance
  const nodes = ['INJECTION_SLDC', 'RLDC', 'NLDC', 'DRAWEE_SLDC'];
  const initialStatus = tx.is_standing_clearance ? 'APPROVED' : 'PENDING';
  
  const insertApproval = db.prepare(`INSERT INTO bilateral_approvals (id, schedule_id, node_type, status, acted_by, timestamp) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const node of nodes) {
    insertApproval.run(newId('BAP'), schedId, node, initialStatus, tx.is_standing_clearance ? 'SYSTEM_AUTO' : null, tx.is_standing_clearance ? new Date().toISOString() : null);
  }

  if (tx.is_standing_clearance) {
    db.prepare(`UPDATE bilateral_schedules SET status = 'APPROVED' WHERE id = ?`).run(schedId);
  }

  secureLogAudit(req, { action: 'CREATE_SCHEDULE', module: 'TRADING', entityType: 'bilateral_schedule', entityId: schedId, details: b });
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
  res.setHeader('Content-Disposition', `attachment; filename=FormatD_${tx.id}.csv`);
  res.send(lines.join('\n'));
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

  if (noar_status === 'REJECTED' && isTransition) {
    pushNotification({
      role: 'MANAGEMENT',
      type: 'NOAR_REJECTED',
      message: `NOAR application rejected for ${tx.counterparty} (${contractNo || tx.id}) — ${rejectionReason}`,
    });
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
    pushNotification({
      role: 'MANAGEMENT',
      type: sla.state === 'BREACHED' ? 'NOAR_SLA_BREACHED' : 'NOAR_SLA_AT_RISK',
      message: sla.state === 'BREACHED'
        ? `NOAR approval overdue for ${tx.counterparty} (${ref}) — ${sla.elapsed_days}d pending against a ${sla.target_days}d ${tx.oa_type} target`
        : `NOAR approval at risk for ${tx.counterparty} (${ref}) — ${sla.elapsed_days}d of ${sla.target_days}d ${tx.oa_type} target elapsed`,
    });
    db.prepare('UPDATE bilateral_transactions SET noar_sla_alerted_state = ? WHERE id = ?').run(sla.state, tx.id);
    sent += 1;
  }
  return { sent };
}

// Manual trigger for the same sweep the scheduler runs.
router.post('/noar-sla/check', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  res.json(runNoarSlaAlerts());
});

// Full transition history for one transaction.
router.get('/:id/noar-timeline', (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(buildNoarTimeline(tx));
});

export default router;
