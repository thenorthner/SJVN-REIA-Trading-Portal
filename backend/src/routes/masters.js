import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { getParam, invalidateParamCache, ensureMasterDefaults } from '../mastersService.js';

const router = Router();
router.use(requireAuth);

const MASTERS_READ = [...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'];
const MASTERS_WRITE = [...ROLE_GROUPS.REIA_WRITE];

ensureMasterDefaults();

router.get('/summary', requireRole(...MASTERS_READ), (req, res) => {
  res.json({
    entities: db.prepare('SELECT COUNT(*) c FROM entities').get().c,
    contracts: db.prepare(`SELECT COUNT(*) c FROM contracts WHERE status != 'TERMINATED'`).get().c,
    projects: db.prepare('SELECT COUNT(*) c FROM entities WHERE parent_entity_id IS NOT NULL').get().c,
    banks: db.prepare('SELECT COUNT(*) c FROM bank_master WHERE is_active = 1').get().c,
    regulatory_params: db.prepare(`SELECT COUNT(*) c FROM system_parameters WHERE category = 'REGULATORY' AND is_active = 1`).get().c,
    billing_params: db.prepare(`SELECT COUNT(*) c FROM system_parameters WHERE category = 'BILLING' AND is_active = 1`).get().c,
    document_types: db.prepare('SELECT COUNT(*) c FROM document_type_master WHERE is_active = 1').get().c,
    lookups: db.prepare('SELECT COUNT(*) c FROM lookup_master WHERE is_active = 1').get().c,
  });
});

// ── Banks ──────────────────────────────────────────
router.get('/banks', requireRole(...MASTERS_READ), (req, res) => {
  const activeOnly = req.query.active !== '0';
  let sql = 'SELECT * FROM bank_master';
  if (activeOnly) sql += ' WHERE is_active = 1';
  sql += ' ORDER BY bank_name';
  res.json(db.prepare(sql).all());
});

router.post('/banks', requireRole(...MASTERS_WRITE), (req, res) => {
  const b = req.body;
  if (!b.bank_name) return res.status(400).json({ error: 'bank_name is required' });
  const id = newId('BNK');
  db.prepare(`
    INSERT INTO bank_master (id, bank_name, ifsc_prefix, branch_name, city, swift_code, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, b.bank_name, b.ifsc_prefix || null, b.branch_name || null, b.city || null, b.swift_code || null, b.is_active === 0 ? 0 : 1);
  logAudit({ req, user: req.user, action: 'CREATE', module: 'MASTERS', entityType: 'bank_master', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM bank_master WHERE id = ?').get(id));
});

router.put('/banks/:id', requireRole(...MASTERS_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM bank_master WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bank not found' });
  const b = { ...existing, ...req.body };
  db.prepare(`
    UPDATE bank_master SET bank_name=?, ifsc_prefix=?, branch_name=?, city=?, swift_code=?, is_active=?, updated_at=datetime('now')
    WHERE id=?
  `).run(b.bank_name, b.ifsc_prefix, b.branch_name, b.city, b.swift_code, b.is_active ? 1 : 0, req.params.id);
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'MASTERS', entityType: 'bank_master', entityId: req.params.id, details: req.body });
  res.json(db.prepare('SELECT * FROM bank_master WHERE id = ?').get(req.params.id));
});

router.delete('/banks/:id', requireRole(...MASTERS_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM bank_master WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Bank not found' });
  db.prepare(`UPDATE bank_master SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'DEACTIVATE', module: 'MASTERS', entityType: 'bank_master', entityId: req.params.id });
  res.json({ ok: true });
});

// ── System parameters ──────────────────────────────
router.get('/parameters', requireRole(...MASTERS_READ), (req, res) => {
  let sql = 'SELECT * FROM system_parameters WHERE 1=1';
  const params = [];
  if (req.query.category) { sql += ' AND category = ?'; params.push(req.query.category); }
  if (req.query.active !== '0') sql += ' AND is_active = 1';
  sql += ' ORDER BY category, param_key';
  res.json(db.prepare(sql).all(...params));
});

router.get('/parameters/:key', requireRole(...MASTERS_READ), (req, res) => {
  const row = db.prepare('SELECT * FROM system_parameters WHERE param_key = ?').get(req.params.key);
  if (!row) return res.status(404).json({ error: 'Parameter not found' });
  res.json(row);
});

router.post('/parameters', requireRole(...MASTERS_WRITE), (req, res) => {
  const { category, param_key, param_value, data_type, unit, description } = req.body;
  if (!category || !param_key || param_value === undefined || param_value === null || param_value === '') {
    return res.status(400).json({ error: 'category, param_key and param_value are required' });
  }
  if (!['REGULATORY', 'BILLING', 'GENERAL'].includes(category)) {
    return res.status(400).json({ error: 'category must be REGULATORY, BILLING or GENERAL' });
  }
  const dtype = ['NUMBER', 'TEXT', 'PERCENT', 'JSON'].includes(data_type) ? data_type : 'NUMBER';
  const existing = db.prepare('SELECT id FROM system_parameters WHERE param_key = ?').get(param_key);
  if (existing) return res.status(409).json({ error: `Parameter '${param_key}' already exists` });
  const id = newId('PRM');
  try {
    db.prepare(`
      INSERT INTO system_parameters (id, category, param_key, param_value, data_type, unit, description, effective_from, is_active, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, date('now'), 1, ?)
    `).run(id, category, param_key, String(param_value), dtype, unit || null, description || null, req.user.name);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  invalidateParamCache();
  logAudit({ req, user: req.user, action: 'CREATE', module: 'MASTERS', entityType: 'system_parameters', entityId: id, details: { param_key, category } });
  res.status(201).json(db.prepare('SELECT * FROM system_parameters WHERE id = ?').get(id));
});

router.put('/parameters/:key', requireRole(...MASTERS_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM system_parameters WHERE param_key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'Parameter not found' });
  const { param_value, description, unit, is_active } = req.body;
  if (param_value === undefined || param_value === null || param_value === '') {
    return res.status(400).json({ error: 'param_value is required' });
  }
  db.prepare(`
    UPDATE system_parameters
    SET param_value = ?, description = COALESCE(?, description), unit = COALESCE(?, unit),
        is_active = COALESCE(?, is_active), updated_by = ?, updated_at = datetime('now')
    WHERE param_key = ?
  `).run(
    String(param_value),
    description ?? null,
    unit ?? null,
    is_active === undefined ? null : (is_active ? 1 : 0),
    req.user.name,
    req.params.key
  );
  invalidateParamCache();
  logAudit({
    req, user: req.user, action: 'UPDATE', module: 'MASTERS', entityType: 'system_parameters',
    entityId: existing.id, beforeValue: existing.param_value, afterValue: String(param_value),
    details: { param_key: req.params.key },
  });
  res.json(db.prepare('SELECT * FROM system_parameters WHERE param_key = ?').get(req.params.key));
});

// ── Document types ─────────────────────────────────
router.get('/document-types', (req, res) => {
  // Any authenticated user may read taxonomy for uploads.
  // Default: active only. Pass active=0 (masters admin view) to include inactive.
  let sql = 'SELECT * FROM document_type_master WHERE 1=1';
  const params = [];
  if (req.query.active !== '0') sql += ' AND is_active = 1';
  if (req.query.module) { sql += ' AND module_name = ?'; params.push(req.query.module); }
  sql += ' ORDER BY module_name, sort_order, label';
  const rows = db.prepare(sql).all(...params);
  if (req.query.grouped === '1') {
    const grouped = {};
    for (const r of rows) {
      if (!grouped[r.module_name]) grouped[r.module_name] = [];
      grouped[r.module_name].push({
        value: r.code,
        label: r.label,
        category: r.category,
        reason: r.reason || '',
        is_mandatory: !!r.is_mandatory,
      });
    }
    return res.json(grouped);
  }
  res.json(rows);
});

router.post('/document-types', requireRole(...MASTERS_WRITE), (req, res) => {
  const b = req.body;
  if (!b.module_name || !b.code || !b.label || !b.category) {
    return res.status(400).json({ error: 'module_name, code, label, category required' });
  }
  const id = newId('DTM');
  try {
    db.prepare(`
      INSERT INTO document_type_master (id, module_name, code, label, category, reason, is_mandatory, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, b.module_name, b.code, b.label, b.category, b.reason || null, b.is_mandatory ? 1 : 0, b.sort_order || 0);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  logAudit({ req, user: req.user, action: 'CREATE', module: 'MASTERS', entityType: 'document_type_master', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM document_type_master WHERE id = ?').get(id));
});

router.put('/document-types/:id', requireRole(...MASTERS_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM document_type_master WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Document type not found' });
  const b = { ...existing, ...req.body };
  db.prepare(`
    UPDATE document_type_master
    SET label=?, category=?, reason=?, is_mandatory=?, is_active=?, sort_order=?, updated_at=datetime('now')
    WHERE id=?
  `).run(b.label, b.category, b.reason, b.is_mandatory ? 1 : 0, b.is_active ? 1 : 0, b.sort_order ?? 0, req.params.id);
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'MASTERS', entityType: 'document_type_master', entityId: req.params.id, details: req.body });
  res.json(db.prepare('SELECT * FROM document_type_master WHERE id = ?').get(req.params.id));
});

// ── Lookups ────────────────────────────────────────
router.get('/lookups', requireRole(...MASTERS_READ, ...ROLE_GROUPS.REIA_ALL), (req, res) => {
  let sql = 'SELECT * FROM lookup_master WHERE 1=1';
  const params = [];
  if (req.query.active !== '0') sql += ' AND is_active = 1';
  if (req.query.category) { sql += ' AND category = ?'; params.push(req.query.category); }
  sql += ' ORDER BY category, sort_order, label';
  res.json(db.prepare(sql).all(...params));
});

router.post('/lookups', requireRole(...MASTERS_WRITE), (req, res) => {
  const b = req.body;
  if (!b.category || !b.code || !b.label) return res.status(400).json({ error: 'category, code, label required' });
  const id = newId('LKP');
  try {
    db.prepare(`
      INSERT INTO lookup_master (id, category, code, label, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, b.category, b.code, b.label, b.sort_order || 0);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  logAudit({ req, user: req.user, action: 'CREATE', module: 'MASTERS', entityType: 'lookup_master', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM lookup_master WHERE id = ?').get(id));
});

router.put('/lookups/:id', requireRole(...MASTERS_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM lookup_master WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lookup not found' });
  const b = { ...existing, ...req.body };
  db.prepare(`
    UPDATE lookup_master SET label=?, sort_order=?, is_active=?, updated_at=datetime('now') WHERE id=?
  `).run(b.label, b.sort_order ?? 0, b.is_active ? 1 : 0, req.params.id);
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'MASTERS', entityType: 'lookup_master', entityId: req.params.id, details: req.body });
  res.json(db.prepare('SELECT * FROM lookup_master WHERE id = ?').get(req.params.id));
});

// ── Projects (SPV / child entities) ────────────────
router.get('/projects', requireRole(...MASTERS_READ), (req, res) => {
  const rows = db.prepare(`
    SELECT e.*, p.name as parent_name
    FROM entities e
    LEFT JOIN entities p ON p.id = e.parent_entity_id
    WHERE e.parent_entity_id IS NOT NULL OR e.category LIKE '%SPV%' OR e.category LIKE '%Project%'
    ORDER BY e.name
  `).all();
  // Prefer true children; if none, still return empty rather than all entities
  const children = db.prepare(`
    SELECT e.*, p.name as parent_name
    FROM entities e
    JOIN entities p ON p.id = e.parent_entity_id
    ORDER BY p.name, e.name
  `).all();
  res.json(children.length ? children : rows.filter((r) => r.parent_entity_id));
});

// Resolved runtime values (for debugging / UI hints)
router.get('/resolved-billing', requireRole(...MASTERS_READ), (req, res) => {
  res.json({
    trading_margin_per_mwh: getParam('trading_margin_per_mwh', 70),
    early_payment_rebate_pct: getParam('early_payment_rebate_pct', 2),
    lps_annual_pct: getParam('lps_annual_pct', 15),
    nrldc_fee_per_mw: getParam('nrldc_fee_per_mw', 100),
    default_payment_terms_days: getParam('default_payment_terms_days', 30),
  });
});

export default router;
