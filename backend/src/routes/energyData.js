import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';
import { runFinalDataRecon } from './reconciliation.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { contract_id, period_month, status } = req.query;
  let sql = `SELECT ed.*, c.contract_no FROM energy_data ed JOIN contracts c ON c.id = ed.contract_id WHERE 1=1`;
  const params = [];
  
  if (req.user.role === 'SELLER') {
    sql += ' AND c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role === 'BUYER') {
    sql += ' AND c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  }
  
  if (contract_id) { sql += ' AND ed.contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND ed.period_month = ?'; params.push(period_month); }
  if (status) { sql += ' AND ed.status = ?'; params.push(status); }
  sql += ' ORDER BY ed.period_month DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('ENG');
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status)
    VALUES (@id, @contract_id, @period_month, @data_type, @source, @energy_mwh, @cuf_percent, @availability_percent, 'DRAFT')
  `).run({
    id,
    contract_id: b.contract_id,
    period_month: b.period_month,
    data_type: b.data_type || 'PROVISIONAL',
    source: b.source || 'MANUAL',
    energy_mwh: b.energy_mwh,
    cuf_percent: b.cuf_percent ?? null,
    availability_percent: b.availability_percent ?? null,
  });
  logAudit({ user: req.user, action: 'CREATE', module: 'REIA', entityType: 'energy_data', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(id));
});

// Validate against contract parameters (simple deviation check demo)
router.post('/:id/validate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Energy data not found' });
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(row.contract_id);
  const expected = contract.capacity_mw * 24 * 30 * 0.22; // rough expected generation at 22% CUF
  const deviationPct = Math.abs(row.energy_mwh - expected) / expected * 100;
  const flagged = deviationPct > 30;
  db.prepare(`UPDATE energy_data SET status = ?, deviation_notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(flagged ? 'DISPUTED' : 'VALIDATED', `Deviation ${deviationPct.toFixed(1)}% vs expected ${expected.toFixed(0)} MWh`, row.id);
  logAudit({ user: req.user, action: 'VALIDATE', module: 'REIA', entityType: 'energy_data', entityId: row.id, details: { deviationPct } });
  res.json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id));
});

// Freeze / lock post-finalization
router.post('/:id/lock', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Energy data not found' });
  if (row.status === 'LOCKED') return res.status(400).json({ error: 'Already locked' });
  db.prepare(`UPDATE energy_data SET status = 'LOCKED', data_type = 'FINAL', updated_at = datetime('now') WHERE id = ?`).run(row.id);
  logAudit({ user: req.user, action: 'LOCK', module: 'REIA', entityType: 'energy_data', entityId: row.id });

  // If a provisional recon existed for this period, auto-trigger FINAL re-recon
  try {
    const hadProv = db.prepare(`
      SELECT id FROM reconciliations
      WHERE contract_id = ? AND period = ? AND data_basis = 'PROVISIONAL'
      LIMIT 1
    `).get(row.contract_id, row.period_month);
    if (hadProv) {
      runFinalDataRecon(row.contract_id, row.period_month, req.user);
      pushNotification({
        role: 'REIA_USER',
        type: 'RECONCILIATION',
        message: `Final-data reconciliation triggered for ${row.period_month} after energy lock`,
      });
    }
  } catch (err) {
    console.error('Final recon trigger failed', err.message);
  }

  res.json(db.prepare('SELECT * FROM energy_data WHERE id = ?').get(row.id));
});

export default router;
