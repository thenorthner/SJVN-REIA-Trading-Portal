import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';
import {
  buildContractReconItems,
  buildTradingReconItems,
  buildStatement,
  genReconNo,
  TOLERANCE_QTY_PCT,
  TOLERANCE_AMOUNT,
} from '../reconciliationEngine.js';
import { OPEN_RECON_STATUSES } from '../reconciliationConstants.js';
import { OPEN_STATUSES as OPEN_DISPUTE_STATUSES, genDisputeNo, REASON_CODES, CHARGE_LINES, addDaysIso, SLA_ACK_DAYS, SLA_RESOLVE_DAYS } from '../disputesConstants.js';

const router = Router();
router.use(requireAuth);

const REIA_ROLES = ROLE_GROUPS.REIA_ALL;
const REIA_WRITE = ROLE_GROUPS.REIA_WRITE;

function isReia(user) {
  return REIA_ROLES.includes(user.role) || user.role === 'SJVN_ADMIN';
}

function recordEvent(reconId, user, eventType, details) {
  db.prepare(`
    INSERT INTO recon_events (id, reconciliation_id, actor_id, actor_name, event_type, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId('REV'), reconId, user?.id ?? null, user?.name ?? 'system', eventType, details ? JSON.stringify(details) : null);
}

function insertItems(reconId, items) {
  const stmt = db.prepare(`
    INSERT INTO recon_items (
      id, reconciliation_id, item_type, label, metered_value, billed_value, paid_value,
      sap_reference_amount, variance, variance_pct, unit, match_status, pattern_flag,
      dispute_id, invoice_id, override_reason, notes
    ) VALUES (
      @id, @reconciliation_id, @item_type, @label, @metered_value, @billed_value, @paid_value,
      @sap_reference_amount, @variance, @variance_pct, @unit, @match_status, @pattern_flag,
      @dispute_id, @invoice_id, @override_reason, @notes
    )
  `);
  for (const it of items) {
    stmt.run({
      ...it,
      reconciliation_id: reconId,
      pattern_flag: it.pattern_flag ? 1 : 0,
      override_reason: it.override_reason ?? null,
    });
  }
}

function saveStatement(recon, items, user) {
  const statement = buildStatement(recon, items);
  const json = JSON.stringify(statement);
  db.prepare(`UPDATE reconciliations SET statement_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(json, recon.id);
  db.prepare(`
    INSERT INTO recon_statements (id, reconciliation_id, version, statement_json, generated_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(newId('RST'), recon.id, recon.version, json, user?.name ?? 'system');
  return statement;
}

function enrichListRow(r) {
  const ageingDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
  return { ...r, ageing_days: ageingDays };
}

function canAccessRecon(user, recon) {
  if (isReia(user)) return true;
  if (recon.scope === 'TRADING_CLIENT') {
    return user.role === 'TRADING_CLIENT' || user.role === 'TRADING_USER' || user.role === 'SJVN_ADMIN';
  }
  if (!recon.contract_id) return false;
  const c = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(recon.contract_id);
  if (!c) return false;
  if (user.role === 'SELLER') return c.seller_id === user.linked_entity_id;
  if (user.role === 'BUYER') return c.buyer_id === user.linked_entity_id;
  return false;
}

function persistRun({
  scope = 'REIA_CONTRACT',
  contractId = null,
  tradingClientId = null,
  periodType,
  period,
  triggerType = 'MANUAL',
  user,
  sapOverride = null,
  reopenedFromId = null,
  reopenReason = null,
  forceDataBasis = null,
}) {
  let built;
  if (scope === 'TRADING_CLIENT') {
    built = buildTradingReconItems({ tradingClientId, period });
  } else {
    built = buildContractReconItems({ contractId, period, periodType, sapOverride });
  }

  const dataBasis = forceDataBasis || built.dataBasis;
  const existing = db.prepare(`
    SELECT * FROM reconciliations
    WHERE scope = ? AND period = ? AND period_type = ? AND data_basis = ?
      AND COALESCE(contract_id,'') = COALESCE(?,'')
      AND COALESCE(trading_client_id,'') = COALESCE(?,'')
      AND status NOT IN ('CLOSED','AGREED')
    ORDER BY version DESC LIMIT 1
  `).get(scope, period, periodType, dataBasis, contractId, tradingClientId);

  const version = existing ? existing.version + 1 : 1;
  const id = newId('RCN');
  const reconNo = genReconNo();
  const status = reopenedFromId ? 'REOPENED' : built.status;

  db.prepare(`
    INSERT INTO reconciliations (
      id, recon_no, scope, contract_id, trading_client_id, period_type, period, data_basis,
      status, trigger_type, tolerance_qty_pct, tolerance_amount,
      energy_match, payment_match, performance_match,
      items_total, items_auto_matched, items_exception, auto_match_pct, unreconciled_amount,
      discrepancy_notes, version, counterparty_role, carried_from_id, reopened_from_id, reopen_reason, created_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    id, reconNo, scope, contractId, tradingClientId, periodType, period, dataBasis,
    status === 'REOPENED' && built.items_exception > 0 ? 'NEEDS_REVIEW' : (status === 'REOPENED' ? built.status : built.status),
    triggerType, TOLERANCE_QTY_PCT, TOLERANCE_AMOUNT,
    built.metrics.energy_match, built.metrics.payment_match, built.metrics.performance_match,
    built.metrics.items_total, built.metrics.items_auto_matched, built.metrics.items_exception,
    built.metrics.auto_match_pct, built.metrics.unreconciled_amount,
    built.items.filter((i) => i.match_status === 'EXCEPTION').map((i) => i.label).join('; ') || null,
    version, built.counterpartyRole, built.carriedFromId, reopenedFromId, reopenReason, user?.name ?? 'system'
  );

  // If we bumped version, close prior open twin as superseded note
  if (existing && !['CLOSED', 'AGREED'].includes(existing.status)) {
    db.prepare(`UPDATE reconciliations SET discrepancy_notes = COALESCE(discrepancy_notes,'') || ' [Superseded by ' || ? || ']', updated_at = datetime('now') WHERE id = ?`)
      .run(reconNo, existing.id);
  }

  insertItems(id, built.items);
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(id);
  saveStatement(recon, built.items, user);
  recordEvent(id, user, 'RUN', { trigger: triggerType, auto_match_pct: built.metrics.auto_match_pct, exceptions: built.metrics.items_exception });

  logAudit({
    user,
    action: 'RECONCILIATION_RUN',
    module: 'REIA',
    entityType: 'reconciliation',
    entityId: id,
    details: { recon_no: reconNo, triggerType, period, scope },
  });

  pushNotification({
    role: 'REIA_USER',
    type: 'RECONCILIATION',
    message: `Reconciliation ${reconNo} (${period}) — ${built.metrics.auto_match_pct}% auto-matched, ${built.metrics.items_exception} exception(s)`,
  });

  if (built.status === 'PENDING_SIGN_OFF') {
    pushNotification({
      role: built.counterpartyRole === 'TRADING_CLIENT' ? 'TRADING_USER' : built.counterpartyRole,
      type: 'RECON_SIGN_OFF',
      message: `Reconciliation statement ${reconNo} ready for joint acknowledgment`,
    });
  }

  return db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(id);
}

export function runScheduledReconciliations() {
  const now = new Date();
  // Demo: run for previous calendar month for all active contracts if missing
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const period = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const contracts = db.prepare(`SELECT id FROM contracts WHERE status = 'ACTIVE'`).all();
  let created = 0;
  for (const c of contracts) {
    const exists = db.prepare(`
      SELECT id FROM reconciliations WHERE contract_id = ? AND period = ? AND period_type = 'MONTHLY' AND data_basis = 'FINAL'
    `).get(c.id, period);
    if (exists) continue;
    try {
      persistRun({
        scope: 'REIA_CONTRACT',
        contractId: c.id,
        periodType: 'MONTHLY',
        period,
        triggerType: 'SCHEDULED',
        user: { name: 'scheduler' },
      });
      created += 1;
    } catch {
      // skip contracts without enough data
    }
  }
  return { created, period };
}

export function runFinalDataRecon(contractId, period, user) {
  const priorProv = db.prepare(`
    SELECT * FROM reconciliations
    WHERE contract_id = ? AND period = ? AND data_basis = 'PROVISIONAL'
    ORDER BY version DESC LIMIT 1
  `).get(contractId, period);
  return persistRun({
    scope: 'REIA_CONTRACT',
    contractId,
    periodType: 'MONTHLY',
    period,
    triggerType: 'FINAL_DATA',
    forceDataBasis: 'FINAL',
    user,
    reopenedFromId: priorProv?.id || null,
    reopenReason: priorProv ? `Final energy locked — re-recon from provisional ${priorProv.recon_no}` : null,
  });
}

// ---- meta ----
router.get('/meta', (_req, res) => {
  res.json({
    statuses: OPEN_RECON_STATUSES.concat(['AGREED', 'CLOSED']),
    tolerance: { qty_pct: TOLERANCE_QTY_PCT, amount: TOLERANCE_AMOUNT },
  });
});

// ---- stats ----
router.get('/stats', requireRole(...REIA_ROLES), (_req, res) => {
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as count, COALESCE(SUM(unreconciled_amount),0) as amount
    FROM reconciliations GROUP BY status
  `).all();

  const open = db.prepare(`
    SELECT * FROM reconciliations WHERE status IN (${OPEN_RECON_STATUSES.map(() => '?').join(',')})
  `).all(...OPEN_RECON_STATUSES);

  const aging = { '0_7': 0, '8_15': 0, '16_30': 0, '30_plus': 0 };
  let exposure = 0;
  for (const r of open) {
    exposure += r.unreconciled_amount || 0;
    const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (86400000));
    if (days <= 7) aging['0_7'] += 1;
    else if (days <= 15) aging['8_15'] += 1;
    else if (days <= 30) aging['16_30'] += 1;
    else aging['30_plus'] += 1;
  }

  const byEntity = db.prepare(`
    SELECT COALESCE(es.name, eb.name, tc.name, 'Unknown') as entity_name,
           COUNT(*) as count,
           SUM(CASE WHEN r.items_exception > 0 THEN 1 ELSE 0 END) as exceptions,
           COALESCE(SUM(r.unreconciled_amount),0) as amount
    FROM reconciliations r
    LEFT JOIN contracts c ON c.id = r.contract_id
    LEFT JOIN entities es ON es.id = c.seller_id
    LEFT JOIN entities eb ON eb.id = c.buyer_id
    LEFT JOIN trading_clients tc ON tc.id = r.trading_client_id
    GROUP BY entity_name
    ORDER BY exceptions DESC
    LIMIT 15
  `).all();

  const trend = db.prepare(`
    SELECT period, AVG(auto_match_pct) as auto_match_pct, COUNT(*) as runs,
           SUM(items_exception) as exceptions
    FROM reconciliations
    WHERE period_type = 'MONTHLY'
    GROUP BY period
    ORDER BY period DESC
    LIMIT 12
  `).all().reverse();

  const avgAuto = db.prepare(`SELECT AVG(auto_match_pct) a FROM reconciliations`).get().a || 0;
  const needsReview = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status = 'NEEDS_REVIEW'`).get().c;
  const disputed = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status = 'DISPUTED'`).get().c;
  const pendingSignoff = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status = 'PENDING_SIGN_OFF'`).get().c;
  const matched = db.prepare(`SELECT COUNT(*) c FROM reconciliations WHERE status IN ('AUTO_MATCHED','AGREED','CLOSED','PENDING_SIGN_OFF') AND items_exception = 0`).get().c;

  res.json({
    by_status: byStatus,
    by_entity: byEntity,
    aging,
    trend,
    financial_exposure: exposure,
    avg_auto_match_pct: Number(Number(avgAuto).toFixed(2)),
    needs_review: needsReview,
    disputed,
    pending_signoff: pendingSignoff,
    matched,
    open_count: open.length,
  });
});

// ---- reopen request list (before /:id) ----
router.get('/reopen-requests', requireRole(...REIA_ROLES), (_req, res) => {
  const rows = db.prepare(`
    SELECT rr.*, r.recon_no, r.period, r.contract_id
    FROM recon_reopen_requests rr
    JOIN reconciliations r ON r.id = rr.reconciliation_id
    ORDER BY rr.created_at DESC
  `).all();
  res.json(rows);
});

// ---- list ----
router.get('/', (req, res) => {
  const { status, period_type, scope, data_basis, aging } = req.query;
  let sql = `
    SELECT r.*, c.contract_no, tc.name as trading_client_name,
           es.name as seller_name, eb.name as buyer_name
    FROM reconciliations r
    LEFT JOIN contracts c ON c.id = r.contract_id
    LEFT JOIN trading_clients tc ON tc.id = r.trading_client_id
    LEFT JOIN entities es ON es.id = c.seller_id
    LEFT JOIN entities eb ON eb.id = c.buyer_id
    WHERE 1=1
  `;
  const params = [];

  if (req.user.role === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role === 'BUYER') {
    sql += ' AND c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  }

  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  if (period_type) { sql += ' AND r.period_type = ?'; params.push(period_type); }
  if (scope) { sql += ' AND r.scope = ?'; params.push(scope); }
  if (data_basis) { sql += ' AND r.data_basis = ?'; params.push(data_basis); }
  sql += ' ORDER BY r.created_at DESC';

  let rows = db.prepare(sql).all(...params).map(enrichListRow);
  if (aging) {
    rows = rows.filter((r) => {
      const d = r.ageing_days;
      if (aging === '0_7') return d <= 7;
      if (aging === '8_15') return d >= 8 && d <= 15;
      if (aging === '16_30') return d >= 16 && d <= 30;
      if (aging === '30_plus') return d > 30;
      return true;
    });
  }
  res.json(rows);
});

// ---- run ----
router.post('/run', requireRole(...REIA_WRITE, 'TRADING_USER'), (req, res) => {
  const {
    contract_id, trading_client_id, period_type = 'MONTHLY', period,
    scope, sap_amount, tax_filed, sap_factor,
  } = req.body;
  if (!period) return res.status(400).json({ error: 'period required' });

  const runScope = scope || (trading_client_id ? 'TRADING_CLIENT' : 'REIA_CONTRACT');
  if (runScope === 'REIA_CONTRACT' && !contract_id) {
    return res.status(400).json({ error: 'contract_id required' });
  }
  if (runScope === 'TRADING_CLIENT' && !trading_client_id) {
    return res.status(400).json({ error: 'trading_client_id required' });
  }

  try {
    const row = persistRun({
      scope: runScope,
      contractId: contract_id || null,
      tradingClientId: trading_client_id || null,
      periodType: period_type,
      period,
      triggerType: 'MANUAL',
      user: req.user,
      sapOverride: { sap_amount, tax_filed, sap_factor },
    });
    const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(row.id);
    res.status(201).json({ ...row, items });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Run failed' });
  }
});

router.post('/run-scheduled', requireRole(...REIA_WRITE, 'MANAGEMENT'), (_req, res) => {
  res.json(runScheduledReconciliations());
});

// ---- reopen act (before /:id) ----
router.post('/reopen-requests/:id/act', requireRole('SJVN_ADMIN', 'FINANCE_USER', ...REIA_WRITE), (req, res) => {
  const { decision } = req.body; // APPROVED | REJECTED
  const rr = db.prepare('SELECT * FROM recon_reopen_requests WHERE id = ?').get(req.params.id);
  if (!rr) return res.status(404).json({ error: 'Request not found' });
  if (rr.status !== 'PENDING') return res.status(400).json({ error: 'Already acted' });

  if (decision === 'REJECTED') {
    db.prepare(`UPDATE recon_reopen_requests SET status = 'REJECTED', acted_by = ?, acted_at = datetime('now') WHERE id = ?`)
      .run(req.user.name, rr.id);
    recordEvent(rr.reconciliation_id, req.user, 'REOPEN_REJECTED', { request_id: rr.id });
    return res.json(db.prepare('SELECT * FROM recon_reopen_requests WHERE id = ?').get(rr.id));
  }

  const parent = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(rr.reconciliation_id);
  const fresh = persistRun({
    scope: parent.scope,
    contractId: parent.contract_id,
    tradingClientId: parent.trading_client_id,
    periodType: parent.period_type,
    period: parent.period,
    triggerType: 'REOPEN',
    user: req.user,
    reopenedFromId: parent.id,
    reopenReason: rr.reason,
    forceDataBasis: parent.data_basis,
  });

  db.prepare(`UPDATE recon_reopen_requests SET status = 'APPROVED', acted_by = ?, acted_at = datetime('now'), new_reconciliation_id = ? WHERE id = ?`)
    .run(req.user.name, fresh.id, rr.id);
  recordEvent(parent.id, req.user, 'REOPEN_APPROVED', { new_id: fresh.id });
  pushNotification({ role: parent.counterparty_role, type: 'RECON_REOPENED', message: `Period ${parent.period} reopened as ${fresh.recon_no}` });

  res.json({ request: db.prepare('SELECT * FROM recon_reopen_requests WHERE id = ?').get(rr.id), reconciliation: fresh });
});

// ---- detail ----
router.get('/:id', (req, res) => {
  const recon = db.prepare(`
    SELECT r.*, c.contract_no, tc.name as trading_client_name
    FROM reconciliations r
    LEFT JOIN contracts c ON c.id = r.contract_id
    LEFT JOIN trading_clients tc ON tc.id = r.trading_client_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRecon(req.user, recon)) return res.status(403).json({ error: 'Not authorized' });

  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ? ORDER BY created_at').all(recon.id);
  const events = db.prepare('SELECT * FROM recon_events WHERE reconciliation_id = ? ORDER BY created_at').all(recon.id);
  const statements = db.prepare('SELECT id, version, generated_by, created_at FROM recon_statements WHERE reconciliation_id = ? ORDER BY version DESC').all(recon.id);
  const reopenRequests = db.prepare('SELECT * FROM recon_reopen_requests WHERE reconciliation_id = ? ORDER BY created_at DESC').all(recon.id);

  const disputeIds = items.map((i) => i.dispute_id).filter(Boolean);
  let disputes = [];
  if (disputeIds.length) {
    const ph = disputeIds.map(() => '?').join(',');
    disputes = db.prepare(`SELECT * FROM disputes WHERE id IN (${ph})`).all(...disputeIds);
  }

  // Soft dispute summary for period
  let dispute_ref = null;
  if (recon.contract_id) {
    const rows = db.prepare(`
      SELECT d.id, d.dispute_no, d.status, d.disputed_amount, d.reason_code
      FROM disputes d JOIN invoices i ON i.id = d.invoice_id
      WHERE i.contract_id = ? AND i.billing_period = ?
    `).all(recon.contract_id, recon.period);
    dispute_ref = {
      disputes: rows,
      disputed_count: rows.length,
      pending_count: rows.filter((d) => OPEN_DISPUTE_STATUSES.includes(d.status)).length,
      pending_amount: rows.filter((d) => OPEN_DISPUTE_STATUSES.includes(d.status)).reduce((s, d) => s + d.disputed_amount, 0),
    };
  }

  res.json({
    ...enrichListRow(recon),
    items,
    events,
    statements,
    reopen_requests: reopenRequests,
    disputes,
    dispute_ref,
    statement: recon.statement_json ? JSON.parse(recon.statement_json) : null,
  });
});

router.get('/:id/statement', (req, res) => {
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRecon(req.user, recon)) return res.status(403).json({ error: 'Not authorized' });
  const version = req.query.version;
  if (version) {
    const snap = db.prepare('SELECT * FROM recon_statements WHERE reconciliation_id = ? AND version = ?').get(recon.id, Number(version));
    if (!snap) return res.status(404).json({ error: 'Statement version not found' });
    return res.json(JSON.parse(snap.statement_json));
  }
  res.json(recon.statement_json ? JSON.parse(recon.statement_json) : null);
});

// ---- override ----
router.post('/:id/override', requireRole(...REIA_WRITE), (req, res) => {
  const { item_id, reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason required' });
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  const item = db.prepare('SELECT * FROM recon_items WHERE id = ? AND reconciliation_id = ?').get(item_id, recon.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  db.prepare(`UPDATE recon_items SET match_status = 'OVERRIDDEN', override_reason = ? WHERE id = ?`)
    .run(reason, item.id);

  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(recon.id);
  const exceptions = items.filter((i) => ['EXCEPTION', 'CARRIED'].includes(i.match_status)).length;
  const matched = items.filter((i) => ['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'].includes(i.match_status)).length;
  const status = exceptions > 0 ? 'NEEDS_REVIEW' : 'PENDING_SIGN_OFF';
  const unrecon = items.filter((i) => ['EXCEPTION', 'CARRIED'].includes(i.match_status))
    .reduce((s, i) => s + Math.abs(i.variance || 0), 0);

  db.prepare(`
    UPDATE reconciliations SET status = ?, items_exception = ?, items_auto_matched = ?,
      auto_match_pct = ?, unreconciled_amount = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, exceptions, matched, Number(((matched / items.length) * 100).toFixed(2)), unrecon, recon.id);

  recordEvent(recon.id, req.user, 'OVERRIDE', { item_id, reason });
  logAudit({ user: req.user, action: 'RECON_OVERRIDE', module: 'REIA', entityType: 'reconciliation', entityId: recon.id, details: { item_id, reason } });

  const fresh = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
  saveStatement(fresh, items, req.user);
  res.json({ ...fresh, items });
});

// ---- raise dispute from exception ----
router.post('/:id/raise-dispute', requireRole(...REIA_WRITE), (req, res) => {
  const { item_id, reason_code = 'ENERGY_DATA_MISMATCH', charge_line = 'energy_charges', issue_description } = req.body;
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  const item = db.prepare('SELECT * FROM recon_items WHERE id = ? AND reconciliation_id = ?').get(item_id, recon.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!['EXCEPTION', 'CARRIED'].includes(item.match_status)) {
    return res.status(400).json({ error: 'Only exception/carried items can become disputes' });
  }

  let invoiceId = item.invoice_id;
  if (!invoiceId && recon.contract_id) {
    const inv = db.prepare(`SELECT id FROM invoices WHERE contract_id = ? AND billing_period = ? LIMIT 1`)
      .get(recon.contract_id, recon.period);
    invoiceId = inv?.id;
  }
  if (!invoiceId) return res.status(400).json({ error: 'No invoice to attach dispute' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(recon.contract_id);
  const role = contract?.contract_type === 'PPA' ? 'SELLER' : 'BUYER';
  const amount = Math.abs(item.variance) || Math.abs(item.billed_value || 0) || 1;
  const rc = REASON_CODES.includes(reason_code) ? reason_code : 'OTHER';
  const cl = CHARGE_LINES.includes(charge_line) ? charge_line : 'other_adjustments';

  const disputeId = newId('DIS');
  const disputeNo = genDisputeNo();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`
    INSERT INTO disputes (
      id, dispute_no, invoice_id, raised_by_role, raised_by_user_id, reason_code, charge_line,
      issue_description, disputed_amount, status, acknowledged_at, acknowledged_by,
      sla_ack_due, sla_resolve_due
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACKNOWLEDGED', ?, 'system', ?, ?)
  `).run(
    disputeId, disputeNo, invoiceId, role, req.user.id, rc, cl,
    issue_description || `Raised from reconciliation ${recon.recon_no}: ${item.label}`,
    amount, now, addDaysIso(now, SLA_ACK_DAYS), addDaysIso(now, SLA_RESOLVE_DAYS)
  );

  db.prepare(`UPDATE invoices SET disputed_amount = disputed_amount + ?, status = 'DISPUTED', updated_at = datetime('now') WHERE id = ?`)
    .run(amount, invoiceId);
  db.prepare(`UPDATE recon_items SET dispute_id = ? WHERE id = ?`).run(disputeId, item.id);
  recordEvent(recon.id, req.user, 'DISPUTE_LINKED', { dispute_id: disputeId, item_id });
  pushNotification({ role: 'REIA_USER', type: 'DISPUTE', message: `Dispute ${disputeNo} created from recon ${recon.recon_no}` });

  res.status(201).json(db.prepare('SELECT * FROM disputes WHERE id = ?').get(disputeId));
});

// ---- request sign-off ----
router.post('/:id/request-signoff', requireRole(...REIA_WRITE), (req, res) => {
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  const openExc = db.prepare(`
    SELECT COUNT(*) c FROM recon_items WHERE reconciliation_id = ? AND match_status IN ('EXCEPTION','CARRIED')
  `).get(recon.id).c;
  if (openExc > 0) return res.status(400).json({ error: 'Clear or override all exceptions before sign-off' });

  db.prepare(`UPDATE reconciliations SET status = 'PENDING_SIGN_OFF', updated_at = datetime('now') WHERE id = ?`).run(recon.id);
  recordEvent(recon.id, req.user, 'REQUEST_SIGNOFF', null);
  pushNotification({
    role: recon.counterparty_role === 'TRADING_CLIENT' ? 'TRADING_USER' : recon.counterparty_role,
    type: 'RECON_SIGN_OFF',
    message: `${recon.recon_no} awaiting your acknowledgment`,
  });
  res.json(db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id));
});

// ---- acknowledge / disagree ----
router.post('/:id/acknowledge', (req, res) => {
  const { decision, note } = req.body; // AGREE | DISAGREE
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRecon(req.user, recon)) return res.status(403).json({ error: 'Not authorized' });
  if (!['PENDING_SIGN_OFF', 'AUTO_MATCHED', 'AGREED'].includes(recon.status) && recon.status !== 'PENDING_SIGN_OFF') {
    if (!['PENDING_SIGN_OFF', 'AUTO_MATCHED'].includes(recon.status)) {
      return res.status(400).json({ error: `Cannot acknowledge in status ${recon.status}` });
    }
  }

  if (decision === 'DISAGREE') {
    db.prepare(`UPDATE reconciliations SET status = 'DISPUTED', discrepancy_notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(note || 'Counterparty disagreed with reconciliation statement', recon.id);
    recordEvent(recon.id, req.user, 'DISAGREE', { note });
    pushNotification({ role: 'REIA_USER', type: 'RECON_DISPUTED', message: `${recon.recon_no} disputed by ${req.user.name}` });
    return res.json(db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id));
  }

  const isSjvn = isReia(req.user);
  if (isSjvn) {
    db.prepare(`UPDATE reconciliations SET sjvn_ack_at = datetime('now'), sjvn_ack_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(req.user.name, recon.id);
  } else {
    const okRole =
      (req.user.role === recon.counterparty_role) ||
      (recon.counterparty_role === 'TRADING_CLIENT' && ['TRADING_CLIENT', 'TRADING_USER'].includes(req.user.role));
    if (!okRole && req.user.role !== 'SJVN_ADMIN') {
      return res.status(403).json({ error: 'Only counterparty can acknowledge on this side' });
    }
    db.prepare(`UPDATE reconciliations SET counterparty_ack_at = datetime('now'), counterparty_ack_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(req.user.name, recon.id);
  }

  recordEvent(recon.id, req.user, 'ACKNOWLEDGE', { side: isSjvn ? 'SJVN' : 'COUNTERPARTY' });

  const fresh = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
  if (fresh.sjvn_ack_at && fresh.counterparty_ack_at) {
    db.prepare(`UPDATE reconciliations SET status = 'AGREED', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(recon.id);
    // Auto-close shortly after agree
    db.prepare(`UPDATE reconciliations SET status = 'CLOSED' WHERE id = ?`).run(recon.id);
    recordEvent(recon.id, req.user, 'CLOSED', { via: 'dual_ack' });
  } else if (fresh.status === 'AUTO_MATCHED' || fresh.status === 'PENDING_SIGN_OFF') {
    db.prepare(`UPDATE reconciliations SET status = 'PENDING_SIGN_OFF', updated_at = datetime('now') WHERE id = ?`).run(recon.id);
  }

  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(recon.id);
  const updated = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
  saveStatement(updated, items, req.user);
  res.json(updated);
});

// ---- reopen request ----
router.post('/:id/reopen-request', (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason required' });
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRecon(req.user, recon)) return res.status(403).json({ error: 'Not authorized' });
  if (!['CLOSED', 'AGREED'].includes(recon.status)) {
    return res.status(400).json({ error: 'Only closed/agreed periods can be reopened' });
  }

  const id = newId('RRQ');
  db.prepare(`
    INSERT INTO recon_reopen_requests (id, reconciliation_id, requested_by, requested_by_name, reason, status)
    VALUES (?, ?, ?, ?, ?, 'PENDING')
  `).run(id, recon.id, req.user.id, req.user.name, reason);
  recordEvent(recon.id, req.user, 'REOPEN_REQUESTED', { reason });
  pushNotification({ role: 'FINANCE_USER', type: 'RECON_REOPEN', message: `Reopen requested for ${recon.recon_no}: ${reason}` });
  res.status(201).json(db.prepare('SELECT * FROM recon_reopen_requests WHERE id = ?').get(id));
});

// ---- regenerate statement ----
router.post('/:id/regenerate-statement', requireRole(...REIA_WRITE), (req, res) => {
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  const nextVer = recon.version + 1;
  db.prepare(`UPDATE reconciliations SET version = ?, updated_at = datetime('now') WHERE id = ?`).run(nextVer, recon.id);
  const fresh = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(recon.id);
  const statement = saveStatement(fresh, items, req.user);
  recordEvent(recon.id, req.user, 'STATEMENT_REGENERATED', { version: nextVer });
  res.json(statement);
});

// Backward-compat resolve
router.post('/:id/resolve', requireRole(...REIA_WRITE), (req, res) => {
  const { notes } = req.body;
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  const openExc = db.prepare(`
    SELECT COUNT(*) c FROM recon_items WHERE reconciliation_id = ? AND match_status IN ('EXCEPTION','CARRIED')
  `).get(recon.id).c;
  if (openExc > 0) {
    return res.status(400).json({ error: 'Override or dispute exceptions first, or use acknowledge flow' });
  }
  db.prepare(`
    UPDATE reconciliations SET status = 'CLOSED', closed_at = datetime('now'),
      discrepancy_notes = ?, sjvn_ack_at = COALESCE(sjvn_ack_at, datetime('now')),
      sjvn_ack_by = COALESCE(sjvn_ack_by, ?), updated_at = datetime('now')
    WHERE id = ?
  `).run(notes ?? recon.discrepancy_notes, req.user.name, recon.id);
  recordEvent(recon.id, req.user, 'RESOLVED_CLOSED', { notes });
  res.json(db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id));
});

export default router;
export { persistRun };
