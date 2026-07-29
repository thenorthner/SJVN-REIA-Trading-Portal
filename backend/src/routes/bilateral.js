import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

// NOAR open-access lifecycle, in the order the PT workflow walks it.
const NOAR_STATUSES = ['NOT_INITIATED', 'FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED'];

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
    // Submission -> approval is the part Grid India controls.
    approval_turnaround_hours: hoursBetween(at('SUBMITTED'), at('APPROVED')),
    entries,
  };
}

const withDetails = (tx) => {
  if (!tx) return tx;
  const client = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(tx.client_id);
  tx.client_name = client?.name;
  tx.noar_timeline = buildNoarTimeline(tx);
  
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
  
  db.prepare(`
    INSERT INTO bilateral_transactions (
      id, client_id, counterparty, loi_contract_ref, oa_type, is_standing_clearance, 
      quantum_mw, tariff_per_unit, open_access_status, 
      wheeling_charges, transmission_charges, loss_injection_state, loss_inter_state, loss_drawee_state, 
      start_date, end_date, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(
    id, b.client_id, b.counterparty, b.loi_contract_ref, b.oa_type || 'STOA', b.is_standing_clearance ? 1 : 0,
    b.quantum_mw, b.tariff_per_unit, b.wheeling_charges || 0, b.transmission_charges || 0,
    b.loss_injection_state || 0, b.loss_inter_state || 0, b.loss_drawee_state || 0,
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

  // Record the transition before the row changes, so status_from is the real
  // previous value. A no-op save (same status) is not a transition.
  const isTransition = noar_status !== tx.noar_status;
  const write = db.transaction(() => {
    db.prepare('UPDATE bilateral_transactions SET noar_contract_no = ?, noar_status = ? WHERE id = ?')
      .run(contractNo, noar_status, tx.id);
    if (isTransition) {
      db.prepare(`
        INSERT INTO noar_status_timeline (id, transaction_id, status_from, status_to, noar_contract_no, changed_by, note)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(newId('NTL'), tx.id, tx.noar_status, noar_status, contractNo || null, req.user.id, req.body.note || null);
    }
  });
  write();

  secureLogAudit(req, { action: 'NOAR_UPDATE', module: 'TRADING', entityType: 'bilateral_transaction', entityId: tx.id, details: { from: tx.noar_status, to: noar_status, noar_contract_no: contractNo } });
  res.json(withDetails(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(tx.id)));
});

// Full transition history for one transaction.
router.get('/:id/noar-timeline', (req, res) => {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  res.json(buildNoarTimeline(tx));
});

export default router;
