import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { computeOaCharges } from '../services/oaCharges.js';
import { reconcileOaCharges, actualsByMonth } from '../services/oaReconciliation.js';

const router = Router();
router.use(requireAuth);

const OA_READ = [...ROLE_GROUPS.TRADING_ALL];
const OA_WRITE = [...ROLE_GROUPS.TRADING_WRITE];

function paramsFromBody(b) {
  return {
    quantum_mwh: b.quantum_mwh, days: b.days, on_date: b.on_date,
    ists_rate: b.ists_rate, injection_state: b.injection_state, drawal_state: b.drawal_state,
    include_ists: b.include_ists !== false, region: b.region, bearer_overrides: b.bearer_overrides || {},
  };
}

// Compute an OA charge estimate without saving. Body: quantum_mwh, days, on_date,
// injection_state, drawal_state, optional ists_rate override and bearer_overrides.
router.post('/estimate', requireRole(...OA_READ), (req, res) => {
  if (req.body.quantum_mwh == null) return res.status(400).json({ error: 'quantum_mwh is required' });
  res.json(computeOaCharges(paramsFromBody(req.body)));
});

// Compute and persist an estimate, optionally against a bilateral transaction.
router.post('/estimate/save', requireRole(...OA_WRITE), (req, res) => {
  if (req.body.quantum_mwh == null) return res.status(400).json({ error: 'quantum_mwh is required' });
  const { bilateral_id } = req.body;
  if (bilateral_id && !db.prepare('SELECT 1 FROM bilateral_transactions WHERE id = ?').get(bilateral_id)) {
    return res.status(404).json({ error: 'bilateral_id does not exist' });
  }
  const result = computeOaCharges(paramsFromBody(req.body));
  const id = newId('OAE');
  db.prepare(`
    INSERT INTO oa_charge_estimates (id, bilateral_id, quantum_mwh, days, on_date, injection_state, drawal_state,
      total, seller_total, buyer_total, breakdown_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, bilateral_id || null, result.quantum_mwh, result.days, result.on_date,
    req.body.injection_state || null, req.body.drawal_state || null,
    result.total, result.by_bearer.SELLER, result.by_bearer.BUYER, JSON.stringify(result.line_items), req.user?.id || null);
  logAudit({ req, user: req.user, action: 'SAVE_OA_ESTIMATE', module: 'TRADING', entityType: 'oa_charge_estimate', entityId: id, details: { bilateral_id, total: result.total } });
  res.status(201).json({ id, ...result });
});

// Saved estimates for a bilateral transaction, newest first.
router.get('/estimate/:bilateralId', requireRole(...OA_READ), (req, res) => {
  const rows = db.prepare('SELECT * FROM oa_charge_estimates WHERE bilateral_id = ? ORDER BY created_at DESC').all(req.params.bilateralId);
  res.json(rows.map(r => ({ ...r, line_items: JSON.parse(r.breakdown_json || '[]') })));
});

// Estimate against what each application was actually charged.
router.get('/reconcile', requireRole(...OA_READ), (req, res) => {
  res.json(reconcileOaCharges({ from: req.query.from, to: req.query.to }));
});

// Actual open-access cost rolled up by month.
router.get('/actuals-by-month', requireRole(...OA_READ), (req, res) => {
  res.json(actualsByMonth({ from: req.query.from, to: req.query.to }));
});

export default router;
