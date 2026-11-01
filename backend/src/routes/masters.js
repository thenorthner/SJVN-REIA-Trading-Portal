import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, PLATFORM_ADMINS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { getParam, invalidateParamCache, ensureMasterDefaults } from '../mastersService.js';

const router = Router();
router.use(requireAuth);

const MASTERS_READ = [...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.COMMERCIAL_ALL, ...ROLE_GROUPS.THERMAL_ALL, ...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'];
// Masters are governance (Target #2 Phase B): the SJVN and IT administrators
// keep them. A desk that bills from the loss or tariff masters does not also
// edit them; it asks the administrator, and the change is on the audit trail.
const MASTERS_WRITE = PLATFORM_ADMINS;

ensureMasterDefaults();

/**
 * Approval-chain parameters must leave every level with someone who can sign
 * it. A level only the SJVN or IT administrator may sign is a level the desks
 * cannot clear once the administrators stop transacting (Target #2), and a role
 * nobody can hold is a level nobody can clear at all. Applies to
 * invoice_approval_level_roles ({ "1": [...], ... }) and to the per-band
 * `roles` of invoice_approval_levels ([{ above, levels, roles }]).
 */
let holdableRoles = null;
function rolesUsersCanHold() {
  if (!holdableRoles) {
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
    holdableRoles = new Set([...ddl.matchAll(/'([A-Z_0-9]+)'/g)].map((m) => m[1]));
  }
  return holdableRoles;
}
function levelMapProblem(map, where) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return `${where} must be an object of level → roles`;
  for (const [level, roles] of Object.entries(map)) {
    if (!Array.isArray(roles) || roles.length === 0) return `${where}: level ${level} names no roles`;
    const unknown = roles.filter((r) => !rolesUsersCanHold().has(r));
    if (unknown.length) return `${where}: level ${level} names ${unknown.join(', ')}, which no user can hold`;
    if (roles.every((r) => PLATFORM_ADMINS.includes(r))) {
      return `${where}: level ${level} can only be signed by the SJVN / IT administrator — name the desk role that signs it`;
    }
  }
  return null;
}
/** The LPS base-rate schedule: dated rows, each a real day and a rate in percent. */
function lpsScheduleProblem(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return 'lps_base_rate_schedule must be valid JSON'; } }
  if (!Array.isArray(v)) return 'lps_base_rate_schedule must be a list of { from, pct } rows';
  const seen = new Set();
  for (const r of v) {
    const from = String(r?.from ?? '');
    const d = new Date(`${from}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== from) return `lps_base_rate_schedule: "${from}" is not a date`;
    if (seen.has(from)) return `lps_base_rate_schedule: ${from} is listed twice`;
    seen.add(from);
    const pct = Number(r?.pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return `lps_base_rate_schedule: the rate from ${from} must be a percent above 0`;
  }
  return null;
}

export function approvalParamProblem(key, value) {
  if (key === 'lps_base_rate_schedule') return lpsScheduleProblem(value);
  if (!['invoice_approval_level_roles', 'invoice_approval_levels'].includes(key)) return null;
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return `${key} must be valid JSON`; } }
  if (key === 'invoice_approval_level_roles') return levelMapProblem(v, key);
  if (!Array.isArray(v)) return `${key} must be a list of bands`;
  for (const band of v) {
    if (band?.roles !== undefined) {
      const p = levelMapProblem(band.roles, `${key} (band above ${band.above})`);
      if (p) return p;
    }
  }
  return null;
}

router.get('/summary', requireRole(...MASTERS_READ), (req, res) => {
  res.json({
    generation_assets: db.prepare('SELECT COUNT(*) c FROM generation_assets WHERE is_active = 1').get().c,
    entities: db.prepare('SELECT COUNT(*) c FROM entities').get().c,
    contracts: db.prepare(`SELECT COUNT(*) c FROM contracts WHERE status != 'TERMINATED'`).get().c,
    projects: db.prepare('SELECT COUNT(*) c FROM entities WHERE parent_entity_id IS NOT NULL').get().c,
    banks: db.prepare('SELECT COUNT(*) c FROM bank_master WHERE is_active = 1').get().c,
    regulatory_params: db.prepare(`SELECT COUNT(*) c FROM system_parameters WHERE category = 'REGULATORY' AND is_active = 1`).get().c,
    billing_params: db.prepare(`SELECT COUNT(*) c FROM system_parameters WHERE category = 'BILLING' AND is_active = 1`).get().c,
    document_types: db.prepare('SELECT COUNT(*) c FROM document_type_master WHERE is_active = 1').get().c,
    lookups: db.prepare('SELECT COUNT(*) c FROM lookup_master WHERE is_active = 1').get().c,
    station_beta: (() => {
      try { return db.prepare('SELECT COUNT(*) c FROM station_beta').get().c; } catch { return 0; }
    })(),
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
  const chainProblem = approvalParamProblem(param_key, param_value);
  if (chainProblem) return res.status(400).json({ error: chainProblem });
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
  // An empty string is a legitimate value: several TEXT parameters use "unset"
  // to mean disabled (smtp_host, noar_sla_digest_recipients). Rejecting it left
  // no way to switch those back off once configured. Omitting the field is
  // still an error — that is a malformed request rather than a deliberate clear.
  if (param_value === undefined || param_value === null) {
    return res.status(400).json({ error: 'param_value is required' });
  }
  if (param_value === '' && existing.data_type !== 'TEXT') {
    return res.status(400).json({ error: `param_value cannot be empty for a ${existing.data_type} parameter` });
  }
  const chainProblem = approvalParamProblem(req.params.key, param_value);
  if (chainProblem) return res.status(400).json({ error: chainProblem });
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
  const existing = db.prepare('SELECT * FROM document_type_master WHERE module_name = ? AND (code = ? OR label = ?)').get(b.module_name, b.code, b.label);
  if (existing) {
    if (!existing.is_active) {
      db.prepare('UPDATE document_type_master SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?').run(existing.id);
      return res.json(db.prepare('SELECT * FROM document_type_master WHERE id = ?').get(existing.id));
    }
    return res.json(existing);
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
// Reference lists, read by the trading desk too: the Bilateral Desk's NOAR
// rejection-reason dropdown comes from here, and a trading user was refused it,
// so the reason for a rejection could not be recorded by the people who record it.
router.get('/lookups', requireRole(...MASTERS_READ, ...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.TRADING_ALL), (req, res) => {
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
  const existing = db.prepare('SELECT * FROM lookup_master WHERE category = ? AND (code = ? OR label = ?)').get(b.category, b.code, b.label);
  if (existing) {
    if (!existing.is_active) {
      db.prepare('UPDATE lookup_master SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?').run(existing.id);
      return res.json(db.prepare('SELECT * FROM lookup_master WHERE id = ?').get(existing.id));
    }
    return res.json(existing);
  }
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

// ── SJVN Generation Assets Master (Power Plants on GIS Map) ──
// What the public map shows of SJVN's fleet. The administrators keep it, like
// every master; the desks read it.
const GEN_TYPES = ['HYDRO', 'THERMAL', 'SOLAR', 'WIND', 'PSP', 'REIA'];
const GEN_STAGES = ['OPERATIONAL', 'UNDER_CONSTRUCTION', 'DEVELOPMENT'];
const GEN_TYPE_COLOR = { HYDRO: '#0284c7', THERMAL: '#ea580c', SOLAR: '#eab308', WIND: '#10b981', PSP: '#8b5cf6', REIA: '#6366f1' };
const GEN_STAGE_COLOR = { OPERATIONAL: '#10b981', UNDER_CONSTRUCTION: '#f59e0b', DEVELOPMENT: '#38bdf8' };
const HEX = /^#[0-9a-fA-F]{6}$/;
const genText = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

/** The asset as it would be saved, or the first thing wrong with it, said in words. */
function genAssetFrom(b) {
  const name = genText(b.name, 160);
  if (!name) return { error: 'Give the plant a name.' };
  const type = String(b.type || '').toUpperCase();
  if (!GEN_TYPES.includes(type)) return { error: `Type must be one of ${GEN_TYPES.join(', ')}.` };
  const stage = String(b.status_category || 'OPERATIONAL').toUpperCase();
  if (!GEN_STAGES.includes(stage)) return { error: `Stage must be one of ${GEN_STAGES.join(', ')}.` };
  const capNum = Number(b.capacity_num);
  if (!Number.isFinite(capNum) || capNum <= 0 || capNum > 100000) return { error: 'Capacity in MW must be a number above 0.' };
  const blank = (v) => v == null || String(v).trim() === '';
  const x = blank(b.coords_x) ? NaN : Number(b.coords_x);
  const y = blank(b.coords_y) ? NaN : Number(b.coords_y);
  // The map is drawn on a 620 × 700 canvas; a point off it is a plant nobody can see.
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 620 || y < 0 || y > 700) {
    return { error: 'Map position must be inside the map (x 0–620, y 0–700). Pick the state to fill it in.' };
  }
  const state = genText(b.state, 80);
  if (!state) return { error: 'Say which state (or cross-border location) the plant is in.' };
  for (const k of ['color', 'status_color']) {
    if (b[k] && !HEX.test(String(b[k]))) return { error: `${k.replace('_', ' ')} must be a colour like #0284c7.` };
  }
  return {
    row: {
      name, hindi_name: genText(b.hindi_name, 160), type,
      // The figure shown is the figure counted: one source, not two that can disagree.
      capacity: genText(b.capacity, 40) || `${capNum.toLocaleString('en-IN')} MW`, capacity_num: capNum,
      config: genText(b.config, 300), location: genText(b.location, 200) || state,
      state, state_code: (genText(b.state_code, 8) || 'IN').toUpperCase(), basin: genText(b.basin, 200), grid: genText(b.grid, 200) || 'National Grid',
      status: genText(b.status, 120) || (stage === 'OPERATIONAL' ? 'Operational' : stage === 'UNDER_CONSTRUCTION' ? 'Under Construction' : 'In Development'),
      status_category: stage, status_color: b.status_color || GEN_STAGE_COLOR[stage],
      design_energy: genText(b.design_energy, 120), beneficiaries: genText(b.beneficiaries, 400),
      coords_x: x, coords_y: y, color: b.color || GEN_TYPE_COLOR[type], description: genText(b.description, 1000),
      is_active: b.is_active === undefined ? 1 : (b.is_active ? 1 : 0),
    },
  };
}

router.get('/generation-assets', requireRole(...MASTERS_READ), (req, res) => {
  const assets = db.prepare('SELECT * FROM generation_assets ORDER BY capacity_num DESC').all();
  res.json(assets);
});

router.post('/generation-assets', requireRole(...MASTERS_WRITE), (req, res) => {
  const { row, error } = genAssetFrom(req.body || {});
  if (error) return res.status(400).json({ error });
  const assetId = req.body.id ? String(req.body.id).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40) : newId('GEN');
  if (db.prepare('SELECT 1 FROM generation_assets WHERE id = ?').get(assetId)) {
    return res.status(409).json({ error: `A plant with code ${assetId} is already on the master. Edit that one, or pick another code.` });
  }
  db.prepare(`
    INSERT INTO generation_assets (
      id, name, hindi_name, type, capacity, capacity_num, config, location,
      state, state_code, basin, grid, status, status_category, status_color,
      design_energy, beneficiaries, coords_x, coords_y, color, description, is_active, created_by
    ) VALUES (
      @id, @name, @hindi_name, @type, @capacity, @capacity_num, @config, @location,
      @state, @state_code, @basin, @grid, @status, @status_category, @status_color,
      @design_energy, @beneficiaries, @coords_x, @coords_y, @color, @description, @is_active, @created_by
    )
  `).run({ ...row, id: assetId, created_by: req.user?.id || null });
  const created = db.prepare('SELECT * FROM generation_assets WHERE id = ?').get(assetId);
  logAudit({ req, user: req.user, action: 'CREATE', module: 'MASTERS', entityType: 'generation_assets', entityId: assetId, afterValue: created });
  res.status(201).json(created);
});

router.put('/generation-assets/:id', requireRole(...MASTERS_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM generation_assets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Plant not found' });
  // A capacity typed as text alone used to leave the counted figure as it was.
  const body = { ...existing, ...req.body };
  if (req.body.capacity !== undefined && req.body.capacity_num === undefined) {
    body.capacity_num = parseFloat(String(req.body.capacity).replace(/[^0-9.]/g, ''));
  }
  const { row, error } = genAssetFrom(body);
  if (error) return res.status(400).json({ error });
  db.prepare(`
    UPDATE generation_assets SET
      name=@name, hindi_name=@hindi_name, type=@type, capacity=@capacity, capacity_num=@capacity_num, config=@config, location=@location,
      state=@state, state_code=@state_code, basin=@basin, grid=@grid, status=@status, status_category=@status_category, status_color=@status_color,
      design_energy=@design_energy, beneficiaries=@beneficiaries, coords_x=@coords_x, coords_y=@coords_y, color=@color, description=@description,
      is_active=@is_active, updated_at=datetime('now')
    WHERE id=@id
  `).run({ ...row, id: req.params.id });
  const updated = db.prepare('SELECT * FROM generation_assets WHERE id = ?').get(req.params.id);
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'MASTERS', entityType: 'generation_assets', entityId: req.params.id, beforeValue: existing, afterValue: updated });
  res.json(updated);
});

router.delete('/generation-assets/:id', requireRole(...MASTERS_WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM generation_assets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Plant not found' });
  db.prepare('DELETE FROM generation_assets WHERE id = ?').run(req.params.id);
  // The whole record goes into the trail, so a removal can be seen and undone.
  logAudit({ req, user: req.user, action: 'DELETE', module: 'MASTERS', entityType: 'generation_assets', entityId: req.params.id, beforeValue: existing });
  res.json({ message: 'Plant removed', id: req.params.id });
});

export default router;
