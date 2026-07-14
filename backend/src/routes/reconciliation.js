import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

// J. Reconciliation
router.get('/', (req, res) => {
  const { status, period_type } = req.query;
  let sql = `SELECT r.*, c.contract_no FROM reconciliations r JOIN contracts c ON c.id = r.contract_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  if (period_type) { sql += ' AND r.period_type = ?'; params.push(period_type); }
  sql += ' ORDER BY r.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Run an automated reconciliation check for a contract/period (rule + pattern based demo)
router.post('/run', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { contract_id, period_type, period } = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const energy = db.prepare('SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ?').get(contract_id, period);
  const invoice = db.prepare('SELECT * FROM invoices WHERE contract_id = ? AND billing_period = ?').get(contract_id, period);

  const energyMatch = energy && invoice ? Math.abs(energy.energy_mwh - invoice.energy_mwh) < 1 : false;
  const paymentMatch = invoice ? ['PAID', 'PARTIALLY_PAID'].includes(invoice.status) : false;
  const performanceMatch = energy ? (energy.availability_percent ?? 100) >= 90 : true;

  const notes = [];
  if (!energyMatch) notes.push('Energy quantum mismatch between billing record and metered data.');
  if (!paymentMatch) notes.push('Payment not yet reconciled against invoice.');
  if (!performanceMatch) notes.push('Availability below threshold - review penalty computation.');

  const id = newId('REC');
  db.prepare(`
    INSERT INTO reconciliations (id, contract_id, period_type, period, energy_match, payment_match, performance_match, discrepancy_notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, contract_id, period_type, period, energyMatch ? 1 : 0, paymentMatch ? 1 : 0, performanceMatch ? 1 : 0,
    notes.join(' ') || null, notes.length ? 'OPEN' : 'RESOLVED');

  logAudit({ user: req.user, action: 'RECONCILIATION_RUN', module: 'REIA', entityType: 'reconciliation', entityId: id, details: { energyMatch, paymentMatch, performanceMatch } });
  res.status(201).json(db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(id));
});

router.post('/:id/resolve', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { notes } = req.body;
  const rec = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE reconciliations SET status = 'RESOLVED', discrepancy_notes = ? WHERE id = ?`).run(notes ?? rec.discrepancy_notes, rec.id);
  logAudit({ user: req.user, action: 'RECONCILIATION_RESOLVED', module: 'REIA', entityType: 'reconciliation', entityId: rec.id });
  res.json(db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(rec.id));
});

export default router;
