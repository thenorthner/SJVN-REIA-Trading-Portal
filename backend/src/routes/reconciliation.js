import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, invalidDecision } from '../util.js';
import { notifyCounterparty } from '../paymentSecurityEngine.js';
import { raiseDispute } from './disputes.js';
import {
  buildContractReconItems,
  buildTradingReconItems,
  buildStatement,
  genReconNo,
  TOLERANCE_QTY_PCT,
  TOLERANCE_AMOUNT,
} from '../reconciliationEngine.js';
import { OPEN_RECON_STATUSES, summariseItems } from '../reconciliationConstants.js';
import { lastCompleteMonth } from '../services/energyRules.js';
import { clientScope, mayUseClient } from '../services/tradingClientScope.js';
import { OPEN_STATUSES as OPEN_DISPUTE_STATUSES, REASON_CODES, CHARGE_LINES } from '../disputesConstants.js';

const router = Router();
router.use(requireAuth);

const REIA_ROLES = ROLE_GROUPS.REIA_ALL;
const REIA_WRITE = ROLE_GROUPS.REIA_WRITE;

function isReia(user) {
  return REIA_ROLES.includes(user.role) || user.role === 'SJVN_ADMIN';
}

/**
 * Tell the party on the other side of a statement. These went to a role, so
 * every seller on the platform heard that some other seller's statement was
 * awaiting its signature.
 */
function tellCounterparty(recon, type, message) {
  if (recon.counterparty_role === 'TRADING_CLIENT' || !recon.contract_id) {
    pushNotification({ role: 'TRADING_USER', type, message });
    return;
  }
  notifyCounterparty(recon.contract_id, recon.counterparty_role === 'SELLER' ? 'SELLER' : 'BUYER', type, message);
}
const words = (status) => String(status || '').toLowerCase().replace(/_/g, ' ');
const fail = (status, message) => Object.assign(new Error(message), { status });

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
    // A client sees its own statements only. Any client login used to open —
    // and sign — every other client's (found 19-Oct-2026).
    if (user.role === 'TRADING_CLIENT') return mayUseClient(user, recon.trading_client_id);
    return user.role === 'TRADING_USER' || user.role === 'SJVN_ADMIN';
  }
  if (!recon.contract_id) return false;
  const c = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(recon.contract_id);
  if (!c) return false;
  const side = counterpartySide(user);
  if (side === 'SELLER') return c.seller_id === user.linked_entity_id;
  if (side === 'BUYER') return c.buyer_id === user.linked_entity_id;
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

  // One open statement for a period. A second run used to add another beside
  // it — both open, both signable — and the hourly sweep, which only looked for
  // a FINAL one, did exactly that to every provisional period, once an hour.
  if (existing && !reopenedFromId) {
    throw fail(409, `${existing.recon_no} is already open for ${period}. Open it and use "Regenerate statement" to refresh its figures, or finish it first.`);
  }
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

  logAudit({ req: typeof req !== "undefined" ? req : null,
    user,
    action: 'RECONCILIATION_RUN',
    module: 'REIA',
    entityType: 'reconciliation',
    entityId: id,
    details: { recon_no: reconNo, triggerType, period, scope },
  });

  pushNotification({
    role: 'REIA_MAKER',
    type: 'RECONCILIATION',
    message: `Reconciliation ${reconNo} (${period}) — ${built.metrics.auto_match_pct}% auto-matched, ${built.metrics.items_exception} exception(s)`,
  });

  if (built.status === 'PENDING_SIGN_OFF') {
    tellCounterparty({ contract_id: contractId, counterparty_role: built.counterpartyRole }, 'RECON_SIGN_OFF',
      `Reconciliation statement ${reconNo} for ${period} is ready for your sign-off.`);
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
      SELECT id FROM reconciliations WHERE contract_id = ? AND period = ? AND period_type = 'MONTHLY'
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
  if (priorProv && !['CLOSED', 'AGREED'].includes(priorProv.status)) {
    db.prepare(`UPDATE reconciliations SET status = 'CLOSED', closed_at = datetime('now'),
      discrepancy_notes = TRIM(COALESCE(discrepancy_notes, '') || ' [Provisional — replaced by the statement on final energy]'), updated_at = datetime('now') WHERE id = ?`).run(priorProv.id);
    recordEvent(priorProv.id, user, 'CLOSED', { via: 'final_data' });
  }
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

  const side = counterpartySide(req.user);
  if (side === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (side === 'BUYER') {
    sql += ' AND c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (!isReia(req.user) && req.user.role !== 'COMPLIANCE_AUDITOR') {
    // Anyone else used to fall through and was handed every statement.
    if (!ROLE_GROUPS.TRADING_ALL.includes(req.user.role) && req.user.role !== 'TRADING_CLIENT') return res.status(403).json({ error: 'Not authorized' });
    sql += ` AND r.scope = 'TRADING_CLIENT'`;
    const own = clientScope(req.user, 'r.trading_client_id');
    if (own.restricted) { sql += own.sql; params.push(...own.params); }
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
  if (!period) return res.status(400).json({ error: 'Choose the period to reconcile' });
  const shape = { MONTHLY: /^\d{4}-(0[1-9]|1[0-2])$/, QUARTERLY: /^\d{4}-Q[1-4]$/, ANNUAL: /^\d{4}(-\d{2})?$/ }[period_type];
  if (!shape) return res.status(400).json({ error: 'Period type must be MONTHLY, QUARTERLY or ANNUAL' });
  if (!shape.test(String(period))) {
    return res.status(400).json({ error: `A ${period_type.toLowerCase()} period is written ${period_type === 'MONTHLY' ? 'YYYY-MM, e.g. 2026-09' : period_type === 'QUARTERLY' ? 'YYYY-Qn, e.g. 2026-Q2' : 'as the financial year, e.g. 2026-27'}` });
  }

  // A month is reconciled once it is over; one still running (or ahead) has
  // nothing settled to agree on.
  if (period_type === 'MONTHLY' && String(period) > lastCompleteMonth()) {
    return res.status(400).json({ error: `${period} has not ended yet. The latest month that can be reconciled is ${lastCompleteMonth()}.` });
  }
  const runScope = scope || (trading_client_id ? 'TRADING_CLIENT' : 'REIA_CONTRACT');
  if (runScope === 'REIA_CONTRACT' && !contract_id) {
    return res.status(400).json({ error: 'Choose the contract to reconcile' });
  }
  if (runScope === 'TRADING_CLIENT' && !trading_client_id) {
    return res.status(400).json({ error: 'Choose the trading client to reconcile' });
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
    res.status(err.status || 400).json({ error: err.message || 'Run failed', ...(err.missing ? { missing: err.missing } : {}) });
  }
});

router.post('/run-scheduled', requireRole(...REIA_WRITE, ...ROLE_GROUPS.REIA_APPROVE), (_req, res) => {
  res.json(runScheduledReconciliations());
});

// ---- reopen act (before /:id) ----
router.post('/reopen-requests/:id/act', requireRole('FINANCE_USER', ...REIA_WRITE), (req, res) => {
  const { decision } = req.body; // APPROVED | REJECTED
  const badDecision = invalidDecision(decision);
  if (badDecision) return res.status(400).json({ error: badDecision });
  const rr = db.prepare('SELECT * FROM recon_reopen_requests WHERE id = ?').get(req.params.id);
  if (!rr) return res.status(404).json({ error: 'Request not found' });
  if (rr.status !== 'PENDING') return res.status(400).json({ error: `This reopen request has already been ${words(rr.status)}` });
  // Reopening a signed statement undoes both signatures' effect; the person who
  // asked for it does not also grant it.
  if (rr.requested_by && rr.requested_by === req.user.id) {
    return res.status(403).json({ error: 'You asked for this reopen, so someone else has to decide it.' });
  }

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
  tellCounterparty(parent, 'RECON_REOPENED', `${parent.recon_no} for ${parent.period} has been reopened as ${fresh.recon_no}.`);

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
  if (!String(reason || '').trim()) return res.status(400).json({ error: 'Say why the variance is being accepted' });
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  if (['CLOSED', 'AGREED', 'DISPUTED'].includes(recon.status)) return res.status(400).json({ error: `${recon.recon_no} is ${words(recon.status)} — its lines can no longer be changed` });
  const item = db.prepare('SELECT * FROM recon_items WHERE id = ? AND reconciliation_id = ?').get(item_id, recon.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!['EXCEPTION', 'CARRIED'].includes(item.match_status)) return res.status(400).json({ error: 'Only a line that did not match can be overridden' });

  db.prepare(`UPDATE recon_items SET match_status = 'OVERRIDDEN', override_reason = ? WHERE id = ?`)
    .run(reason, item.id);

  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(recon.id);
  const summary = summariseItems(items);
  const status = summary.exceptions > 0 ? 'NEEDS_REVIEW' : 'PENDING_SIGN_OFF';

  db.prepare(`
    UPDATE reconciliations SET status = ?, items_exception = ?, items_auto_matched = ?,
      auto_match_pct = ?, unreconciled_amount = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, summary.exceptions, summary.matched, summary.auto_match_pct,
    summary.unreconciled_amount, recon.id);

  recordEvent(recon.id, req.user, 'OVERRIDE', { item_id, reason });
  // With the last line explained the statement is ready for the other side —
  // which heard about it only when sign-off was asked for by the button.
  if (status === 'PENDING_SIGN_OFF' && recon.status !== 'PENDING_SIGN_OFF') {
    tellCounterparty(recon, 'RECON_SIGN_OFF', `Reconciliation statement ${recon.recon_no} for ${recon.period} is ready for your sign-off.`);
  }
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'RECON_OVERRIDE', module: 'REIA', entityType: 'reconciliation', entityId: recon.id, details: { item_id, reason } });

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
  if (item.dispute_id) return res.status(409).json({ error: 'A dispute has already been raised from this line' });

  let invoiceId = item.invoice_id;
  if (!invoiceId && recon.contract_id) {
    // A dispute is raised on a bill that has been presented — the first one
    // found for the month could be a draft or a cancelled bill.
    const inv = db.prepare(`SELECT id FROM invoices WHERE contract_id = ? AND billing_period = ?
      AND status IN ('APPROVED','SENT','PARTIALLY_PAID','DISPUTED','PAID') ORDER BY CASE invoice_type WHEN 'FINAL' THEN 0 ELSE 1 END, created_at LIMIT 1`)
      .get(recon.contract_id, recon.period);
    invoiceId = inv?.id;
  }
  if (!invoiceId) return res.status(400).json({ error: `No approved bill for ${recon.period} on this contract to raise the dispute on. Approve the bill first, or override the line with the reason.` });

  // Through the same door as any dispute (decided 17-Oct-2026): the charge
  // line's cap, the presented-bill rule and the dispute window all apply, and
  // the record says the SJVN officer raised it, from which statement.
  const amount = Math.abs(item.variance) || Math.abs(item.billed_value || 0) || 1;
  const rc = REASON_CODES.includes(reason_code) ? reason_code : 'OTHER';
  const cl = CHARGE_LINES.includes(charge_line) ? charge_line : 'other_adjustments';
  let dispute;
  try {
    dispute = raiseDispute(req.user, {
      invoice_id: invoiceId, reason_code: rc, charge_line: cl, disputed_amount: Math.round(amount * 100) / 100,
      issue_description: `Raised by SJVN (${req.user.name}) from reconciliation ${recon.recon_no}: ${issue_description || item.label}`,
      enforce_window: true,
    }, req);
  } catch (err) {
    if (err.status) return res.status(err.status).json(err.payload || { error: err.message });
    throw err;
  }
  const disputeId = dispute.id;
  db.prepare(`UPDATE recon_items SET dispute_id = ? WHERE id = ?`).run(disputeId, item.id);
  recordEvent(recon.id, req.user, 'DISPUTE_LINKED', { dispute_id: disputeId, item_id });

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
  if (recon.status !== 'NEEDS_REVIEW') return res.status(400).json({ error: `${recon.recon_no} is ${words(recon.status)} — sign-off is asked for on a statement still under review` });

  db.prepare(`UPDATE reconciliations SET status = 'PENDING_SIGN_OFF', updated_at = datetime('now') WHERE id = ?`).run(recon.id);
  recordEvent(recon.id, req.user, 'REQUEST_SIGNOFF', null);
  tellCounterparty(recon, 'RECON_SIGN_OFF', `Reconciliation statement ${recon.recon_no} for ${recon.period} is awaiting your sign-off.`);
  res.json(db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id));
});

// ---- acknowledge / disagree ----
router.post('/:id/acknowledge', (req, res) => {
  const { decision, note, remarks } = req.body; // AGREE | DISAGREE
  const badDecision = invalidDecision(decision, ['AGREE', 'DISAGREE']);
  if (badDecision) return res.status(400).json({ error: badDecision });
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRecon(req.user, recon)) return res.status(403).json({ error: 'Not authorized' });
  if (!['PENDING_SIGN_OFF', 'AUTO_MATCHED', 'AGREED', 'NEEDS_REVIEW'].includes(recon.status) && recon.status !== 'PENDING_SIGN_OFF') {
    if (!['PENDING_SIGN_OFF', 'AUTO_MATCHED', 'NEEDS_REVIEW'].includes(recon.status)) {
      return res.status(400).json({ error: `Cannot acknowledge in status ${recon.status}` });
    }
  }

  // Agreeing is done through /recon-signoff/:id/sign, which holds the rules
  // (SJVN signs only with every line explained, the counterparty only after
  // SJVN's review) and records what was signed. This older door skipped them:
  // SJVN signed a statement with two lines unexplained and it closed.
  if (decision === 'AGREE') {
    return res.status(400).json({ error: 'Sign the statement from its sign-off panel (/api/recon-signoff/:id/sign).' });
  }
  if (decision === 'DISAGREE' && !String(note || remarks || '').trim()) return res.status(400).json({ error: 'Say what is not agreed' });
  if (decision === 'DISAGREE' && isReia(req.user) && !REIA_WRITE.includes(req.user.role)) return res.status(403).json({ error: 'Only the REIA desk disagrees with a statement for SJVN' });
  const finalNote = note || remarks || 'Digitally acknowledged and verified';

  if (decision === 'DISAGREE') {
    db.prepare(`UPDATE reconciliations SET status = 'DISPUTED', discrepancy_notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(finalNote, recon.id);
    recordEvent(recon.id, req.user, 'DISAGREE', { note: finalNote, user_role: req.user.role, user_name: req.user.name });
    logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'RECON_DISAGREE', module: 'REIA', entityType: 'reconciliation', entityId: recon.id, details: { recon_no: recon.recon_no, note: finalNote } });
    for (const role of REIA_WRITE) pushNotification({ role, type: 'RECON_DISPUTED', message: `${recon.recon_no} disputed by ${req.user.name}: ${finalNote}` });
    if (isReia(req.user)) tellCounterparty(recon, 'RECON_DISPUTED', `SJVN does not agree with reconciliation statement ${recon.recon_no} for ${recon.period}: ${finalNote}`);
    const updated = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
    return res.json({ success: true, decision: 'DISAGREE', message: `Disagreement recorded for ${recon.recon_no}`, reconciliation: updated });
  }

  const isSjvn = isReia(req.user);
  // A side signs a statement once. Signing again used to overwrite who had signed and when.
  if (isSjvn ? recon.sjvn_ack_at : recon.counterparty_ack_at) {
    return res.status(400).json({ error: `This statement was already signed for ${isSjvn ? 'SJVN' : 'your company'} by ${isSjvn ? recon.sjvn_ack_by : recon.counterparty_ack_by}` });
  }
  if (isSjvn) {
    db.prepare(`UPDATE reconciliations SET sjvn_ack_at = datetime('now'), sjvn_ack_by = ?, discrepancy_notes = COALESCE(?, discrepancy_notes), updated_at = datetime('now') WHERE id = ?`)
      .run(req.user.name, remarks ? `SJVN Note: ${remarks}` : null, recon.id);
  } else {
    // Compared by side rather than by exact role: a company's L1-L3 users are
    // that counterparty too, and matching 'BUYER' against 'BUYER_L2' refused
    // every sub-user the sign-off their own screen offers them. A statement
    // with no side recorded falls back to canAccessRecon above, which has
    // already established that this company is a party to the contract.
    const side = counterpartySide(req.user);
    const okRole =
      (side !== null && (recon.counterparty_role == null || side === recon.counterparty_role)) ||
      // The trading desk does not sign for the client (decided 19-Oct-2026).
      (recon.counterparty_role === 'TRADING_CLIENT' && req.user.role === 'TRADING_CLIENT');
    // Nobody at SJVN signs for the counterparty. (The SJVN Administrator was
    // exempted here; it never reached this branch because it signs as SJVN
    // above, but an exemption that lets SJVN sign the other side's statement
    // must not exist to come alive when roles are re-cut — Target #2.)
    if (!okRole) {
      return res.status(403).json({ error: 'Only counterparty can acknowledge on this side' });
    }
    if (side === 'BUYER' && (req.user.role === 'BUYER_L1' || req.user.role.endsWith('_L1'))) {
      return res.status(403).json({ error: 'Maker (Level 1) cannot execute final legal sign-off on balance reconciliation. Designated Checker (Level 2/3) or Company Admin authorization required.' });
    }
    db.prepare(`UPDATE reconciliations SET counterparty_ack_at = datetime('now'), counterparty_ack_by = ?, discrepancy_notes = COALESCE(?, discrepancy_notes), updated_at = datetime('now') WHERE id = ?`)
      .run(req.user.name, remarks ? `Counterparty Note: ${remarks}` : null, recon.id);
  }

  recordEvent(recon.id, req.user, 'ACKNOWLEDGE', { side: isSjvn ? 'SJVN' : 'COUNTERPARTY', actor: req.user.name, role: req.user.role, remarks });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'RECON_ACKNOWLEDGE', module: 'REIA', entityType: 'reconciliation', entityId: recon.id, details: { recon_no: recon.recon_no, side: isSjvn ? 'SJVN' : 'COUNTERPARTY', remarks } });

  let fresh = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
  let dualSigned = false;
  // Both have signed. While an exception the counterparty raised is still open,
  // the statement is agreed but not finished.
  const openExceptions = db.prepare(`SELECT COUNT(*) c FROM recon_exceptions WHERE reconciliation_id = ? AND status = 'OPEN'`).get(recon.id).c;
  if (fresh.sjvn_ack_at && fresh.counterparty_ack_at && openExceptions) {
    db.prepare(`UPDATE reconciliations SET status = 'AGREED', updated_at = datetime('now') WHERE id = ?`).run(recon.id);
    dualSigned = true;
  } else if (fresh.sjvn_ack_at && fresh.counterparty_ack_at) {
    db.prepare(`UPDATE reconciliations SET status = 'CLOSED', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(recon.id);
    recordEvent(recon.id, req.user, 'CLOSED', { via: 'dual_ack' });
    dualSigned = true;
  } else if (fresh.status === 'AUTO_MATCHED' || fresh.status === 'PENDING_SIGN_OFF') {
    db.prepare(`UPDATE reconciliations SET status = 'PENDING_SIGN_OFF', updated_at = datetime('now') WHERE id = ?`).run(recon.id);
  }

  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(recon.id);
  const updated = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
  const statement = saveStatement(updated, items, req.user);
  res.json({
    success: true,
    decision: 'AGREE',
    side: isSjvn ? 'SJVN' : 'COUNTERPARTY',
    dual_signed: dualSigned,
    message: dualSigned 
      ? `Reconciliation ${recon.recon_no} is now Dual Signed-Off & CLOSED!`
      : `Acknowledged by ${isSjvn ? 'SJVN Desk' : 'Counterparty'}. Awaiting other party sign-off.`,
    reconciliation: updated,
    statement
  });
});

// ---- reopen request ----
router.post('/:id/reopen-request', (req, res) => {
  const { reason } = req.body;
  if (!String(reason || '').trim()) return res.status(400).json({ error: 'Say why the period should be reopened' });
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  if (!canAccessRecon(req.user, recon)) return res.status(403).json({ error: 'Not authorized' });
  if (!['CLOSED', 'AGREED'].includes(recon.status)) {
    return res.status(400).json({ error: 'Only closed/agreed periods can be reopened' });
  }
  if (db.prepare(`SELECT 1 FROM recon_reopen_requests WHERE reconciliation_id = ? AND status = 'PENDING'`).get(recon.id)) {
    return res.status(409).json({ error: `A reopen request on ${recon.recon_no} is already awaiting a decision` });
  }

  const id = newId('RRQ');
  db.prepare(`
    INSERT INTO recon_reopen_requests (id, reconciliation_id, requested_by, requested_by_name, reason, status)
    VALUES (?, ?, ?, ?, ?, 'PENDING')
  `).run(id, recon.id, req.user.id, req.user.name, reason);
  recordEvent(recon.id, req.user, 'REOPEN_REQUESTED', { reason });
  for (const role of new Set([...REIA_WRITE, 'FINANCE_USER'])) pushNotification({ role, type: 'RECON_REOPEN', message: `${req.user.name} has asked for ${recon.recon_no} (${recon.period}) to be reopened: ${reason}` });
  res.status(201).json(db.prepare('SELECT * FROM recon_reopen_requests WHERE id = ?').get(id));
});

// ---- regenerate statement ----
// Withdraw a statement that should never have been made: unsigned, and for a
// period that still has nothing to reconcile. The scheduler made one for every
// active contract each month — ten for September 2026 with no energy and no
// bill, each sent to its counterparty as "ready for your sign-off" (reia-15).
// The statement table has no cancelled state, so it is removed, with its full
// record kept in the audit log and the counterparty told.
router.post('/:id/withdraw', requireRole(...REIA_WRITE), (req, res) => {
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 10) return res.status(400).json({ error: 'Say why the statement is withdrawn (at least 10 characters).' });
  if (recon.scope === 'TRADING_CLIENT' || !recon.contract_id) return res.status(400).json({ error: 'Only a contract statement can be withdrawn here.' });
  if (recon.sjvn_ack_at || recon.counterparty_ack_at || ['CLOSED', 'AGREED'].includes(recon.status)) {
    return res.status(400).json({ error: `${recon.recon_no} has been signed, so it stands. Ask for the period to be reopened instead.` });
  }
  if (db.prepare('SELECT 1 FROM recon_items WHERE reconciliation_id = ? AND dispute_id IS NOT NULL').get(recon.id)
    || db.prepare('SELECT 1 FROM recon_reopen_requests WHERE reconciliation_id = ?').get(recon.id)) {
    return res.status(400).json({ error: `${recon.recon_no} has a dispute or a reopen request on it, so it stands.` });
  }
  try {
    buildContractReconItems({ contractId: recon.contract_id, period: recon.period, periodType: recon.period_type });
    return res.status(400).json({ error: `${recon.period} now has energy or a bill to reconcile on this contract — regenerate ${recon.recon_no} instead of withdrawing it.` });
  } catch (err) {
    if (err.reason !== 'NOT_READY' && !/Nothing to reconcile/.test(err.message || '')) return res.status(err.status || 500).json({ error: err.message });
  }
  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(recon.id);
  db.transaction(() => {
    for (const t of ['recon_events', 'recon_statements', 'recon_exceptions', 'recon_items']) {
      db.prepare(`DELETE FROM ${t} WHERE reconciliation_id = ?`).run(recon.id);
    }
    db.prepare('DELETE FROM reconciliations WHERE id = ?').run(recon.id);
  })();
  logAudit({
    req, user: req.user, action: 'RECON_WITHDRAWN', module: 'REIA', entityType: 'reconciliation', entityId: recon.id, reason,
    beforeValue: { ...recon, items: items.length },
  });
  if (recon.contract_id) {
    const c = db.prepare('SELECT contract_type FROM contracts WHERE id = ?').get(recon.contract_id);
    notifyCounterparty(recon.contract_id, c?.contract_type === 'PSA' ? 'BUYER' : 'SELLER', 'RECON_WITHDRAWN',
      `Reconciliation ${recon.recon_no} for ${recon.period} was withdrawn: there was nothing to reconcile for that month. No sign-off is needed.`);
  }
  res.json({ withdrawn: recon.recon_no, period: recon.period });
});

router.post('/:id/regenerate-statement', requireRole(...REIA_WRITE, 'TRADING_USER', ...ROLE_GROUPS.REIA_APPROVE), (req, res) => {
  const recon = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!recon) return res.status(404).json({ error: 'Not found' });
  // Its figures are what the two signatures are on — unless the other side has
  // rejected the statement outright. A disputed statement SJVN had already
  // signed could then be neither regenerated, overridden nor reopened: it sat
  // there for good. Regenerating it starts the review again, with the
  // signatures on the rejected figures set aside (they stay in the events).
  const disputed = recon.status === 'DISPUTED';
  if (!disputed && (['CLOSED', 'AGREED'].includes(recon.status) || recon.sjvn_ack_at || recon.counterparty_ack_at)) {
    return res.status(400).json({ error: `${recon.recon_no} has been signed, so its figures stand. To change them, ask for the period to be reopened.` });
  }
  if (disputed && (recon.sjvn_ack_at || recon.counterparty_ack_at)) {
    recordEvent(recon.id, req.user, 'SIGNATURES_SET_ASIDE', { sjvn: recon.sjvn_ack_by || null, counterparty: recon.counterparty_ack_by || null, reason: 'statement disputed; regenerated for review' });
    db.prepare(`UPDATE reconciliations SET sjvn_ack_at = NULL, sjvn_ack_by = NULL, sjvn_sign_json = NULL, counterparty_ack_at = NULL, counterparty_ack_by = NULL, counterparty_sign_json = NULL WHERE id = ?`).run(recon.id);
  }

  try {
    let built;
    if (recon.scope === 'TRADING_CLIENT') {
      built = buildTradingReconItems({ tradingClientId: recon.trading_client_id, period: recon.period });
    } else {
      let sapOverride = null;
      try {
        if (recon.sap_override) sapOverride = typeof recon.sap_override === 'string' ? JSON.parse(recon.sap_override) : recon.sap_override;
      } catch (_) {}
      built = buildContractReconItems({ 
        contractId: recon.contract_id, 
        period: recon.period, 
        periodType: recon.period_type, 
        sapOverride 
      });
    }

    if (built && Array.isArray(built.items) && built.items.length > 0) {
      // Find items that were manually overridden or linked to active disputes
      const preservedItems = db.prepare(`
        SELECT * FROM recon_items 
        WHERE reconciliation_id = ? AND (match_status = 'OVERRIDDEN' OR dispute_id IS NOT NULL)
      `).all(recon.id);
      // An override accepted a particular variance. If the figures behind the
      // line have moved, the override no longer speaks to them: the line comes
      // back as calculated, to be looked at again.
      const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;
      const fresh = new Map(built.items.map((i) => [i.label, i]));
      const stale = preservedItems.filter((p) => p.match_status === 'OVERRIDDEN' && !p.dispute_id && fresh.has(p.label)
        && !(same(p.metered_value, fresh.get(p.label).metered_value) && same(p.billed_value, fresh.get(p.label).billed_value) && same(p.paid_value, fresh.get(p.label).paid_value)));
      for (const p of stale) {
        db.prepare('DELETE FROM recon_items WHERE id = ?').run(p.id);
        const f = fresh.get(p.label);
        f.notes = `${f.notes ? `${f.notes} · ` : ''}Earlier override ("${p.override_reason}") dropped — the figures changed`;
      }
      const preservedLabels = new Set(preservedItems.filter((p) => !stale.includes(p)).map(i => i.label));

      // Remove old non-preserved items
      db.prepare(`
        DELETE FROM recon_items 
        WHERE reconciliation_id = ? AND match_status != 'OVERRIDDEN' AND dispute_id IS NULL
      `).run(recon.id);

      // Insert new calculated items that aren't already overridden
      const itemsToInsert = built.items.filter(i => !preservedLabels.has(i.label));
      insertItems(recon.id, itemsToInsert);
    }
  } catch (recalcErr) {
    // "Nothing to reconcile" and the like are answers, not hiccups to log and
    // carry on past with the old figures.
    if (recalcErr.status) return res.status(recalcErr.status).json({ error: recalcErr.message });
    console.warn('[Recon] Recalculate items on regenerate:', recalcErr.message);
  }

  const items = db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ?').all(recon.id);
  const summary = summariseItems(items);
  const { exceptions, matched, auto_match_pct: autoMatchPct, unreconciled_amount: unrecon } = summary;
  const nextVer = (Number(recon.version) || 1) + 1;
  const newStatus = exceptions > 0 ? 'NEEDS_REVIEW' : (['AGREED', 'CLOSED'].includes(recon.status) ? recon.status : 'PENDING_SIGN_OFF');

  db.prepare(`
    UPDATE reconciliations 
    SET version = ?, items_total = ?, items_auto_matched = ?, items_exception = ?,
        auto_match_pct = ?, unreconciled_amount = ?, status = ?, updated_at = datetime('now') 
    WHERE id = ?
  `).run(nextVer, items.length, matched, exceptions, autoMatchPct, unrecon, newStatus, recon.id);

  const fresh = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(recon.id);
  const statement = saveStatement(fresh, items, req.user);
  recordEvent(recon.id, req.user, 'STATEMENT_REGENERATED', { 
    version: nextVer, 
    auto_match_pct: autoMatchPct,
    items_count: items.length,
    items_exception: exceptions 
  });
  logAudit({ 
    req: typeof req !== "undefined" ? req : null, 
    user: req.user, 
    action: 'RECON_STATEMENT_REGENERATED', 
    module: 'REIA', 
    entityType: 'reconciliation', 
    entityId: recon.id, 
    details: { recon_no: recon.recon_no, version: nextVer, auto_match_pct: autoMatchPct } 
  });

  res.json({
    success: true,
    version: nextVer,
    message: `Statement regenerated successfully to Version v${nextVer}`,
    reconciliation: { ...fresh, items, statement },
    statement
  });
});

export default router;
export { persistRun, canAccessRecon, isReia, recordEvent, saveStatement };
