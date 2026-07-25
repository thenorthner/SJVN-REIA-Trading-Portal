import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.REIA_WRITE;

function withNames(row) {
  if (!row) return row;
  const c = db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(row.contract_id);
  const b = row.buyer_id ? db.prepare('SELECT name FROM entities WHERE id = ?').get(row.buyer_id) : null;
  return { ...row, contract_no: c?.contract_no, buyer_name: b?.name };
}

router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, buyer_id, status } = req.query;
  let sql = 'SELECT * FROM power_diversions WHERE 1=1';
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (buyer_id) { sql += ' AND buyer_id = ?'; params.push(buyer_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY period_month DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withNames));
});

router.get('/summary', requireRole(...READ), (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) total,
    COALESCE(SUM(quantum_mwh),0) total_mwh,
    COALESCE(SUM(sale_amount),0) total_sale,
    COALESCE(SUM(CASE WHEN net_gain>0 THEN net_gain ELSE 0 END),0) total_gain,
    COALESCE(SUM(CASE WHEN net_gain<0 THEN -net_gain ELSE 0 END),0) total_deficit,
    COALESCE(SUM(applied_amount),0) total_recovered
    FROM power_diversions WHERE status != 'CANCELLED'`).get();
  res.json(row);
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (contract.contract_type !== 'PSA') return res.status(400).json({ error: 'Power diversion applies to PSA (buyer) contracts' });
  if (!b.period_month) return res.status(400).json({ error: 'period_month is required' });
  const quantum = Number(b.quantum_mwh) || 0;
  const rate = Number(b.sale_rate_per_mwh) || 0;
  if (quantum <= 0) return res.status(400).json({ error: 'quantum_mwh must be positive' });
  const reason = ['PAYMENT_DEFAULT', 'NON_REQUISITION'].includes(b.reason) ? b.reason : 'PAYMENT_DEFAULT';
  const sale_amount = Math.round(quantum * rate);
  const expenses = Math.round(Number(b.expenses) || 0);
  const net_gain = sale_amount - expenses;

  const id = newId('PDV');
  const seq = (db.prepare('SELECT COUNT(*) c FROM power_diversions').get().c || 0) + 1;
  db.prepare(`
    INSERT INTO power_diversions (id, diversion_no, contract_id, buyer_id, period_month, reason,
      quantum_mwh, exchange_platform, sale_rate_per_mwh, sale_amount, expenses, net_gain, notes, created_by)
    VALUES (@id, @diversion_no, @contract_id, @buyer_id, @period_month, @reason,
      @quantum_mwh, @exchange_platform, @sale_rate_per_mwh, @sale_amount, @expenses, @net_gain, @notes, @created_by)
  `).run({
    id, diversion_no: `PDV/${b.period_month}/${String(seq).padStart(3, '0')}`,
    contract_id: b.contract_id, buyer_id: contract.buyer_id, period_month: b.period_month, reason,
    quantum_mwh: quantum, exchange_platform: b.exchange_platform || null, sale_rate_per_mwh: rate,
    sale_amount, expenses, net_gain, notes: b.notes || null, created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'power_diversion', entityId: id, details: b });
  res.status(201).json(withNames(db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(id)));
});

// Mark a diversion's gain as recovered (adjusted against the buyer's dues). The
// actual cash recovery is applied via the LPS-first waterfall from the client.
router.post('/:id/mark-recovered', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Diversion not found' });
  const applied = req.body.applied_amount != null ? Number(req.body.applied_amount) : Math.max(0, row.net_gain);
  db.prepare("UPDATE power_diversions SET status='RECOVERED', applied_amount=?, updated_at=datetime('now') WHERE id=?")
    .run(Math.round(applied), row.id);
  logAudit({ req, user: req.user, action: 'MARK_RECOVERED', module: 'REIA', entityType: 'power_diversion', entityId: row.id, details: { applied } });
  res.json(withNames(db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(row.id)));
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM power_diversions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Diversion not found' });
  db.prepare("UPDATE power_diversions SET status='CANCELLED', updated_at=datetime('now') WHERE id=?").run(row.id);
  logAudit({ req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'power_diversion', entityId: row.id });
  res.json({ ok: true });
});

export default router;
