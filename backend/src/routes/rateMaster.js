import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { seedRateMaster, getEffectiveRate, reviseRate } from '../services/rateMaster.js';

const router = Router();
router.use(requireAuth);

const RATE_READ = [...ROLE_GROUPS.TRADING_ALL];
const RATE_WRITE = [...ROLE_GROUPS.TRADING_WRITE];

seedRateMaster();

// Full rate register, newest-effective first. Optional ?category= filter.
router.get('/', requireRole(...RATE_READ), (req, res) => {
  const { category, active } = req.query;
  let sql = 'SELECT * FROM rate_master WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND rate_category = ?'; params.push(category); }
  if (active !== '0') sql += ' AND is_active = 1';
  sql += ' ORDER BY rate_category, charge_name, effective_from DESC';
  res.json(db.prepare(sql).all(...params));
});

// The rate in force for a charge on a date: /effective?charge=ISTS&date=2026-05-01
router.get('/effective', requireRole(...RATE_READ), (req, res) => {
  const { charge, date } = req.query;
  if (!charge) return res.status(400).json({ error: 'charge is required' });
  const row = getEffectiveRate(charge, date);
  if (!row) return res.status(404).json({ error: `No effective rate for '${charge}' on ${date || 'today'}` });
  res.json(row);
});

// Create a brand-new charge (first row of a new series).
router.post('/', requireRole(...RATE_WRITE), (req, res) => {
  const { rate_category, charge_name, region, rate_value, unit, effective_from, effective_to, note } = req.body;
  if (!charge_name || !rate_category || rate_value == null || !unit || !effective_from) {
    return res.status(400).json({ error: 'rate_category, charge_name, rate_value, unit and effective_from are required' });
  }
  const id = newId('RATE');
  db.prepare(`
    INSERT INTO rate_master (id, rate_category, charge_name, region, rate_value, unit, effective_from, effective_to, note, is_active, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, rate_category, charge_name, region || null, Number(rate_value), unit, effective_from, effective_to || null, note || null, req.user?.id || null);
  logAudit({ req, user: req.user, action: 'CREATE_RATE', module: 'TRADING', entityType: 'rate_master', entityId: id, details: req.body });
  res.status(201).json(db.prepare('SELECT * FROM rate_master WHERE id = ?').get(id));
});

// Revise an existing charge: closes the current window and opens a new one.
router.post('/revise', requireRole(...RATE_WRITE), (req, res) => {
  const { charge_name, rate_value, effective_from, note } = req.body;
  if (!charge_name || rate_value == null || !effective_from) {
    return res.status(400).json({ error: 'charge_name, rate_value and effective_from are required' });
  }
  const id = reviseRate({ chargeName: charge_name, newValue: Number(rate_value), effectiveFrom: effective_from, createdBy: req.user?.id, note });
  logAudit({ req, user: req.user, action: 'REVISE_RATE', module: 'TRADING', entityType: 'rate_master', entityId: id, details: req.body });
  res.status(201).json(db.prepare('SELECT * FROM rate_master WHERE id = ?').get(id));
});

export default router;
