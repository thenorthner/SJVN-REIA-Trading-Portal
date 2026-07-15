import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';
import {
  computeCoverage,
  checkAdequacy,
  checkPortfolioAdequacy,
  evaluateInvocationEligibility,
  invokeWaterfall,
  runAlertCascade,
  syncRequirementsFromContract,
  createInstrumentsFromRequirements,
  syncInstrumentAvailable,
  recordSecurityEvent,
  genInstrumentNo,
  refreshAvailable,
} from '../paymentSecurityEngine.js';
import { ACTIVE_STATUSES, WATERFALL_DEFAULTS } from '../paymentSecurityConstants.js';

export {
  computeCoverage,
  checkAdequacy,
  checkPortfolioAdequacy,
  evaluateInvocationEligibility,
  invokeWaterfall,
  runAlertCascade,
  syncRequirementsFromContract,
  createInstrumentsFromRequirements,
};

const router = Router();
router.use(requireAuth);

const REIA_WRITE = ROLE_GROUPS.REIA_WRITE;
const REIA_ALL = ROLE_GROUPS.REIA_ALL;

function isReia(user) {
  return REIA_ALL.includes(user.role) || user.role === 'SJVN_ADMIN';
}

function canAccessInstrument(user, ps) {
  if (isReia(user)) return true;
  const c = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(ps.contract_id);
  if (!c) return false;
  if (user.role === 'SELLER') return c.seller_id === user.linked_entity_id;
  if (user.role === 'BUYER') return c.buyer_id === user.linked_entity_id;
  return false;
}

function enrich(ps) {
  if (!ps) return ps;
  const available = refreshAvailable(ps);
  const coverage = computeCoverage(ps.contract_id);
  const daysToExpiry = ps.validity_end
    ? Math.ceil((new Date(ps.validity_end).getTime() - Date.now()) / 86400000)
    : null;
  return {
    ...ps,
    amount: ps.limit_amount,
    available_amount: available,
    coverage_ratio: coverage.coverage_ratio,
    shortfall: coverage.shortfall,
    days_to_expiry: daysToExpiry,
  };
}

router.get('/meta', (_req, res) => {
  res.json({
    active_statuses: ACTIVE_STATUSES,
    waterfall_defaults: WATERFALL_DEFAULTS,
    alert_cascade_days: [60, 30, 15, 7, 0],
  });
});

router.get('/stats', requireRole(...REIA_ALL), (_req, res) => {
  const instruments = db.prepare(`SELECT * FROM payment_security`).all();
  const active = instruments.filter((i) => ACTIVE_STATUSES.includes(i.status));
  const totalSecurity = active.reduce((s, i) => s + refreshAvailable(i), 0);

  const psas = db.prepare(`SELECT id, contract_no, buyer_id FROM contracts WHERE contract_type = 'PSA' AND status = 'ACTIVE'`).all();
  const byEntity = [];
  let shortfallCount = 0;
  let ratioSum = 0;
  for (const c of psas) {
    const cov = computeCoverage(c.id);
    const buyer = db.prepare('SELECT name FROM entities WHERE id = ?').get(c.buyer_id);
    byEntity.push({
      contract_id: c.id,
      contract_no: c.contract_no,
      entity_name: buyer?.name || 'Unknown',
      ...cov,
    });
    if (!cov.adequate) shortfallCount += 1;
    ratioSum += cov.coverage_ratio;
  }

  const expiring = {};
  for (const d of [30, 60, 90]) {
    expiring[d] = db.prepare(`
      SELECT COUNT(*) c FROM payment_security
      WHERE status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
        AND validity_end IS NOT NULL
        AND julianday(validity_end) - julianday('now') BETWEEN 0 AND ?
    `).get(d).c;
  }

  const invocations = db.prepare(`
    SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM security_invocations
  `).get();

  res.json({
    total_security_value: Math.round(totalSecurity),
    instrument_count: active.length,
    shortfall_count: shortfallCount,
    avg_coverage_ratio: psas.length ? Number((ratioSum / psas.length).toFixed(3)) : 0,
    expiring,
    invocation_ytd_count: invocations.c,
    invocation_ytd_amount: invocations.s,
    weak_entities: byEntity.filter((e) => !e.adequate).sort((a, b) => a.coverage_ratio - b.coverage_ratio),
    entity_coverage: byEntity,
  });
});

router.get('/expiring', (req, res) => {
  const days = Number(req.query.days || 30);
  let sql = `
    SELECT ps.*, c.contract_no FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id
    WHERE ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')
      AND ps.validity_end IS NOT NULL
      AND julianday(ps.validity_end) - julianday('now') <= ?
  `;
  const params = [days];
  if (req.user.role === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role === 'BUYER') {
    sql += ' AND c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  }
  sql += ' ORDER BY ps.validity_end ASC';
  res.json(db.prepare(sql).all(...params).map(enrich));
});

router.get('/adequacy/:contractId', (req, res) => {
  res.json(checkAdequacy({ contractId: req.params.contractId }));
});

router.get('/reopen-requests', (_req, res) => res.json([])); // compat placeholder

router.get('/releases', requireRole(...REIA_ALL), (_req, res) => {
  res.json(db.prepare(`
    SELECT sr.*, ps.instrument_no, c.contract_no
    FROM security_releases sr
    JOIN payment_security ps ON ps.id = sr.payment_security_id
    JOIN contracts c ON c.id = sr.contract_id
    ORDER BY sr.created_at DESC
  `).all());
});

router.get('/overrides', requireRole(...REIA_ALL), (_req, res) => {
  res.json(db.prepare(`
    SELECT o.*, c.contract_no FROM security_adequacy_overrides o
    JOIN contracts c ON c.id = o.contract_id
    ORDER BY o.created_at DESC
  `).all());
});

router.get('/requirements/:contractId', (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.contractId);
  if (!c) return res.status(404).json({ error: 'Contract not found' });
  if (!isReia(req.user)) {
    if (req.user.role === 'SELLER' && c.seller_id !== req.user.linked_entity_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (req.user.role === 'BUYER' && c.buyer_id !== req.user.linked_entity_id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
  }
  res.json(db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(req.params.contractId));
});

router.get('/invocations', requireRole(...REIA_ALL), (req, res) => {
  const { contract_id, status } = req.query;
  let sql = `SELECT si.*, c.contract_no FROM security_invocations si JOIN contracts c ON c.id = si.contract_id WHERE 1=1`;
  const params = [];
  if (contract_id) { sql += ' AND si.contract_id = ?'; params.push(contract_id); }
  if (status) { sql += ' AND si.status = ?'; params.push(status); }
  sql += ' ORDER BY si.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/', (req, res) => {
  const { contract_id, status, mechanism_type, bg_subtype, expiring_days } = req.query;
  let sql = `
    SELECT ps.*, c.contract_no, c.contract_type, c.seller_id, c.buyer_id
    FROM payment_security ps JOIN contracts c ON c.id = ps.contract_id WHERE 1=1
  `;
  const params = [];
  if (req.user.role === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role === 'BUYER') {
    sql += ' AND c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  }
  if (contract_id) { sql += ' AND ps.contract_id = ?'; params.push(contract_id); }
  if (status) { sql += ' AND ps.status = ?'; params.push(status); }
  if (mechanism_type) { sql += ' AND ps.mechanism_type = ?'; params.push(mechanism_type); }
  if (bg_subtype) { sql += ' AND ps.bg_subtype = ?'; params.push(bg_subtype); }
  if (expiring_days) {
    sql += ` AND ps.validity_end IS NOT NULL AND julianday(ps.validity_end) - julianday('now') <= ? AND ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')`;
    params.push(Number(expiring_days));
  }
  sql += ' ORDER BY ps.validity_end ASC';
  res.json(db.prepare(sql).all(...params).map(enrich));
});

router.get('/:id', (req, res) => {
  const ps = db.prepare(`
    SELECT ps.*, c.contract_no, c.contract_type FROM payment_security ps
    JOIN contracts c ON c.id = ps.contract_id WHERE ps.id = ?
  `).get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (!canAccessInstrument(req.user, ps)) return res.status(403).json({ error: 'Not authorized' });

  const events = db.prepare('SELECT * FROM security_events WHERE payment_security_id = ? ORDER BY created_at').all(ps.id);
  const invocations = db.prepare('SELECT * FROM security_invocations WHERE payment_security_id = ? OR contract_id = ? ORDER BY created_at DESC').all(ps.id, ps.contract_id);
  const alerts = db.prepare('SELECT * FROM security_alerts WHERE payment_security_id = ? ORDER BY created_at DESC LIMIT 20').all(ps.id);
  const releases = db.prepare('SELECT * FROM security_releases WHERE payment_security_id = ? ORDER BY created_at DESC').all(ps.id);
  const requirements = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(ps.contract_id);
  const coverage = computeCoverage(ps.contract_id);
  const eligibility = evaluateInvocationEligibility(ps.contract_id);

  res.json({
    ...enrich(ps),
    events,
    invocations,
    alerts,
    releases,
    requirements,
    coverage,
    invocation_eligibility: eligibility,
  });
});

router.post('/', requireRole(...REIA_WRITE), (req, res) => {
  const b = req.body;
  if (!b.contract_id || !b.mechanism_type || b.limit_amount == null && b.amount == null) {
    return res.status(400).json({ error: 'contract_id, mechanism_type, limit_amount required' });
  }
  const limit = Number(b.limit_amount ?? b.amount);
  const id = newId('PSC');
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  const entityId = b.entity_id || (c?.contract_type === 'PSA' ? c.buyer_id : c?.seller_id);
  const priority = b.waterfall_priority ?? WATERFALL_DEFAULTS[b.mechanism_type] ?? 100;
  const isRevolving = b.is_revolving != null ? (b.is_revolving ? 1 : 0) : (b.mechanism_type === 'LC' ? 1 : 0);
  const required = b.required_amount ?? computeCoverage(b.contract_id).required_amount;

  db.prepare(`
    INSERT INTO payment_security (
      id, instrument_no, contract_id, entity_id, mechanism_type, bg_subtype, is_revolving,
      limit_amount, utilized_amount, available_amount, required_amount, waterfall_priority,
      issuing_bank, beneficiary, validity_start, validity_end, status, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
  `).run(
    id,
    b.instrument_no || genInstrumentNo(b.mechanism_type === 'BANK_GUARANTEE' ? (b.bg_subtype || 'BG') : b.mechanism_type),
    b.contract_id,
    entityId,
    b.mechanism_type,
    b.bg_subtype || null,
    isRevolving,
    limit,
    limit,
    required,
    priority,
    b.issuing_bank || null,
    b.beneficiary || 'SJVN Limited',
    b.validity_start || null,
    b.validity_end || null,
    b.remarks || null
  );

  recordSecurityEvent({ instrumentId: id, contractId: b.contract_id, user: req.user, eventType: 'CREATE', details: b });
  logAudit({ user: req.user, action: 'CREATE', module: 'REIA', entityType: 'payment_security', entityId: id, details: b });
  res.status(201).json(enrich(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id)));
});

router.post('/from-contract/:contractId', requireRole(...REIA_WRITE), (req, res) => {
  syncRequirementsFromContract(req.params.contractId);
  const created = createInstrumentsFromRequirements(req.params.contractId, req.user);
  res.status(201).json({ created: created.map(enrich), requirements: db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(req.params.contractId) });
});

router.post('/alerts/run', requireRole(...REIA_WRITE, 'MANAGEMENT'), (_req, res) => {
  res.json(runAlertCascade());
});

router.post('/overrides', requireRole(...REIA_WRITE, 'MANAGEMENT', 'SJVN_ADMIN'), (req, res) => {
  const { contract_id, reason, valid_until } = req.body;
  if (!contract_id || !reason) return res.status(400).json({ error: 'contract_id and reason required' });
  const id = newId('SOV');
  db.prepare(`
    INSERT INTO security_adequacy_overrides (id, contract_id, reason, approved_by, valid_until)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, contract_id, reason, req.user.name, valid_until || null);
  recordSecurityEvent({ contractId: contract_id, user: req.user, eventType: 'ADEQUACY_OVERRIDE', details: { reason, valid_until } });
  logAudit({ user: req.user, action: 'SECURITY_OVERRIDE', module: 'REIA', entityType: 'contract', entityId: contract_id, details: req.body });
  pushNotification({ role: 'MANAGEMENT', type: 'SECURITY_OVERRIDE', message: `Adequacy override on ${contract_id}: ${reason}` });
  res.status(201).json(db.prepare('SELECT * FROM security_adequacy_overrides WHERE id = ?').get(id));
});

router.post('/invocations', requireRole(...REIA_WRITE), (req, res) => {
  const { contract_id, amount, invoice_ids } = req.body;
  if (!contract_id) return res.status(400).json({ error: 'contract_id required' });
  const elig = evaluateInvocationEligibility(contract_id);
  const amt = amount != null ? Number(amount) : elig.amount;
  if (!(amt > 0)) return res.status(400).json({ error: 'No eligible overdue amount to invoke' });
  const inv = invokeWaterfall(contract_id, amt, invoice_ids || elig.overdue_invoices, req.user);
  logAudit({ user: req.user, action: 'INVOKE_WATERFALL', module: 'REIA', entityType: 'security_invocation', entityId: inv.id, details: { amount: amt } });
  res.status(201).json(inv);
});

router.post('/invocations/:id/transition', requireRole(...REIA_WRITE), (req, res) => {
  const { status, notes } = req.body;
  const allowed = ['NOTICE_ISSUED', 'CLAIMED', 'FUNDS_RECEIVED', 'REJECTED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const inv = db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });

  db.prepare(`UPDATE security_invocations SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?`)
    .run(status, notes ?? null, inv.id);

  if (status === 'FUNDS_RECEIVED') {
    pushNotification({
      role: 'BUYER',
      type: 'SECURITY_REPLENISH_DEMAND',
      message: `Replenish revolving LC after funds received on ${inv.invocation_no}`,
    });
  }
  recordSecurityEvent({
    instrumentId: inv.payment_security_id,
    contractId: inv.contract_id,
    user: req.user,
    eventType: `INVOCATION_${status}`,
    details: { invocation_id: inv.id, notes },
  });
  res.json(db.prepare('SELECT * FROM security_invocations WHERE id = ?').get(inv.id));
});

router.post('/releases/:id/act', requireRole(...REIA_WRITE, 'FINANCE_USER'), (req, res) => {
  const { decision } = req.body; // APPROVED | REJECTED
  const rel = db.prepare('SELECT * FROM security_releases WHERE id = ?').get(req.params.id);
  if (!rel) return res.status(404).json({ error: 'Not found' });
  if (rel.status !== 'PENDING') return res.status(400).json({ error: 'Already acted' });

  if (decision === 'REJECTED') {
    db.prepare(`UPDATE security_releases SET status = 'REJECTED', acted_by = ?, acted_at = datetime('now') WHERE id = ?`)
      .run(req.user.name, rel.id);
    db.prepare(`UPDATE payment_security SET status = 'ACTIVE', updated_at = datetime('now') WHERE id = ?`).run(rel.payment_security_id);
    return res.json(db.prepare('SELECT * FROM security_releases WHERE id = ?').get(rel.id));
  }

  if (!rel.checklist_no_dues || !rel.checklist_no_disputes) {
    return res.status(400).json({ error: 'Checklist incomplete: no dues and no disputes required' });
  }
  db.prepare(`UPDATE security_releases SET status = 'RELEASED', acted_by = ?, acted_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, rel.id);
  db.prepare(`UPDATE payment_security SET status = 'RELEASED', updated_at = datetime('now') WHERE id = ?`)
    .run(rel.payment_security_id);
  recordSecurityEvent({
    instrumentId: rel.payment_security_id,
    contractId: rel.contract_id,
    user: req.user,
    eventType: 'RELEASED',
    details: null,
  });
  pushNotification({ role: 'REIA_USER', type: 'SECURITY_RELEASED', message: `Security instrument released` });
  res.json(db.prepare('SELECT * FROM security_releases WHERE id = ?').get(rel.id));
});

router.post('/:id/verify', requireRole(...REIA_WRITE), (req, res) => {
  const { bank_confirmation_ref } = req.body;
  if (!bank_confirmation_ref) return res.status(400).json({ error: 'bank_confirmation_ref required' });
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE payment_security SET bank_confirmation_ref = ?, verified_at = datetime('now'), verified_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(bank_confirmation_ref, req.user.name, ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'VERIFIED', details: { bank_confirmation_ref } });
  res.json(enrich(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(ps.id)));
});

router.post('/:id/utilize', requireRole(...REIA_WRITE), (req, res) => {
  const amount = Number(req.body.amount);
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (!(amount > 0) || amount > refreshAvailable(ps)) {
    return res.status(400).json({ error: 'Invalid amount / exceeds available' });
  }
  db.prepare(`UPDATE payment_security SET utilized_amount = utilized_amount + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(amount, ps.id);
  const fresh = syncInstrumentAvailable(ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'UTILIZE', details: { amount } });
  if (ps.is_revolving && refreshAvailable(fresh) < fresh.required_amount) {
    pushNotification({
      role: 'BUYER',
      type: 'SECURITY_REPLENISH_DEMAND',
      message: `LC ${fresh.instrument_no} below required cover — replenish demanded`,
    });
  }
  res.json(enrich(fresh));
});

router.post('/:id/replenish', requireRole(...REIA_WRITE, 'BUYER'), (req, res) => {
  const amount = Number(req.body.amount);
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (!canAccessInstrument(req.user, ps)) return res.status(403).json({ error: 'Not authorized' });
  if (!(amount > 0)) return res.status(400).json({ error: 'amount required' });
  const newUtil = Math.max(0, (ps.utilized_amount || 0) - amount);
  db.prepare(`UPDATE payment_security SET utilized_amount = ?, updated_at = datetime('now') WHERE id = ?`).run(newUtil, ps.id);
  const fresh = syncInstrumentAvailable(ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'REPLENISH', details: { amount } });
  res.json(enrich(fresh));
});

router.post('/:id/renew', requireRole(...REIA_WRITE), (req, res) => {
  const { validity_end, limit_amount, amount } = req.body;
  const existing = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const newLimit = limit_amount ?? amount ?? existing.limit_amount;
  db.prepare(`
    UPDATE payment_security SET validity_end = ?, limit_amount = ?, available_amount = ? - utilized_amount,
      status = CASE WHEN utilized_amount > 0 THEN 'PARTIALLY_UTILIZED' ELSE 'ACTIVE' END,
      renewal_status = 'RENEWED', updated_at = datetime('now')
    WHERE id = ?
  `).run(validity_end, newLimit, newLimit, existing.id);
  const fresh = syncInstrumentAvailable(existing.id);
  recordSecurityEvent({ instrumentId: existing.id, contractId: existing.contract_id, user: req.user, eventType: 'RENEW', details: { validity_end, limit_amount: newLimit } });
  logAudit({ user: req.user, action: 'RENEW', module: 'REIA', entityType: 'payment_security', entityId: existing.id });
  res.json(enrich(fresh));
});

// Backward-compat invoke → waterfall on contract or single instrument
router.post('/:id/invoke', requireRole(...REIA_WRITE), (req, res) => {
  const { amount } = req.body;
  const existing = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const elig = evaluateInvocationEligibility(existing.contract_id);
  const amt = amount != null ? Number(amount) : elig.amount || refreshAvailable(existing);
  const inv = invokeWaterfall(existing.contract_id, amt, elig.overdue_invoices, req.user);
  logAudit({ user: req.user, action: 'INVOKE', module: 'REIA', entityType: 'payment_security', entityId: existing.id, details: { amount: amt } });
  res.json({ instrument: enrich(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(existing.id)), invocation: inv });
});

router.post('/:id/release-request', (req, res) => {
  const ps = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!ps) return res.status(404).json({ error: 'Not found' });
  if (!canAccessInstrument(req.user, ps) && !isReia(req.user)) return res.status(403).json({ error: 'Not authorized' });

  const outstanding = computeCoverage(ps.contract_id).outstanding_dues;
  const openDisputes = db.prepare(`
    SELECT COUNT(*) c FROM disputes d JOIN invoices i ON i.id = d.invoice_id
    WHERE i.contract_id = ? AND d.status IN ('RAISED','ACKNOWLEDGED','UNDER_REVIEW','INFO_REQUESTED','ESCALATED')
  `).get(ps.contract_id).c;

  const id = newId('SRL');
  db.prepare(`
    INSERT INTO security_releases (
      id, payment_security_id, contract_id, status, checklist_no_dues, checklist_no_disputes, reason, requested_by
    ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)
  `).run(
    id, ps.id, ps.contract_id,
    outstanding <= 0 ? 1 : 0,
    openDisputes === 0 ? 1 : 0,
    req.body.reason || 'Contract completion release',
    req.user.name
  );
  db.prepare(`UPDATE payment_security SET status = 'RELEASE_PENDING', updated_at = datetime('now') WHERE id = ?`).run(ps.id);
  recordSecurityEvent({ instrumentId: ps.id, contractId: ps.contract_id, user: req.user, eventType: 'RELEASE_REQUESTED', details: { outstanding, openDisputes } });
  res.status(201).json(db.prepare('SELECT * FROM security_releases WHERE id = ?').get(id));
});

export default router;
