import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo } from '../util.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.REIA_WRITE;

function withContract(row) {
  if (!row) return row;
  const c = db.prepare('SELECT contract_no, contract_type, project_type FROM contracts WHERE id = ?').get(row.contract_id);
  return { ...row, contract_no: c?.contract_no, project_type: c?.project_type };
}

/** Net deviation = (actual − scheduled) MWh × rate (₹/MWh). +recoverable / −payable. */
function computeNet(scheduled, actual, rate) {
  const dev = Math.round(((Number(actual) || 0) - (Number(scheduled) || 0)) * 1000) / 1000;
  const amount = Math.round(dev * (Number(rate) || 0));
  return { deviation_mwh: dev, deviation_amount: amount };
}

// List — filter by contract / period / status
router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, period_month, status } = req.query;
  let sql = 'SELECT * FROM deviation_settlements WHERE 1=1';
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND period_month = ?'; params.push(period_month); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY period_month DESC, week_no DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withContract));
});

// Summary totals for a period (for dashboards / settlement)
router.get('/summary', requireRole(...READ), (req, res) => {
  const { contract_id, period_month } = req.query;
  let sql = `SELECT COUNT(*) weeks, COALESCE(SUM(deviation_amount),0) net_amount,
             COALESCE(SUM(CASE WHEN deviation_amount>0 THEN deviation_amount ELSE 0 END),0) recoverable,
             COALESCE(SUM(CASE WHEN deviation_amount<0 THEN deviation_amount ELSE 0 END),0) payable
             FROM deviation_settlements WHERE status != 'CANCELLED'`;
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND period_month = ?'; params.push(period_month); }
  res.json(db.prepare(sql).get(...params));
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  res.json(withContract(row));
});

// Create a weekly deviation entry (data provided by NRPC)
router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!b.period_month) return res.status(400).json({ error: 'period_month (YYYY-MM) is required' });
  if (b.week_no == null || b.week_no === '') return res.status(400).json({ error: 'week_no is required' });
  const entry_type = ['PRIMARY', 'REVISED'].includes(b.entry_type) ? b.entry_type : 'PRIMARY';

  const dup = db.prepare(`SELECT id FROM deviation_settlements WHERE contract_id=? AND period_month=? AND week_no=? AND entry_type=?`)
    .get(b.contract_id, b.period_month, Number(b.week_no), entry_type);
  if (dup) return res.status(409).json({ error: `A ${entry_type} entry for week ${b.week_no} already exists this period. Edit it or use REVISED.` });

  const { deviation_mwh, deviation_amount } = computeNet(b.scheduled_mwh, b.actual_mwh, b.deviation_rate);
  const id = newId('DSM');
  db.prepare(`
    INSERT INTO deviation_settlements (id, dsm_no, contract_id, plant_code, plant_name, period_month,
      week_no, week_date, entry_type, scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate,
      deviation_amount, status, notes, created_by)
    VALUES (@id, @dsm_no, @contract_id, @plant_code, @plant_name, @period_month,
      @week_no, @week_date, @entry_type, @scheduled_mwh, @actual_mwh, @deviation_mwh, @deviation_rate,
      @deviation_amount, 'CALCULATED', @notes, @created_by)
  `).run({
    id,
    dsm_no: `DSM/${contract.contract_no?.replace(/[^A-Za-z0-9]+/g, '-')}/${b.period_month}/W${b.week_no}${entry_type === 'REVISED' ? '-R' : ''}`,
    contract_id: b.contract_id,
    plant_code: b.plant_code || null,
    plant_name: b.plant_name || null,
    period_month: b.period_month,
    week_no: Number(b.week_no),
    week_date: b.week_date || null,
    entry_type,
    scheduled_mwh: Number(b.scheduled_mwh) || 0,
    actual_mwh: Number(b.actual_mwh) || 0,
    deviation_mwh,
    deviation_rate: Number(b.deviation_rate) || 0,
    deviation_amount,
    notes: b.notes || null,
    created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'deviation_settlement', entityId: id, details: { ...b, deviation_mwh, deviation_amount } });
  res.status(201).json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(id)));
});

// Edit (recomputes net); blocked once dispatched
router.put('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  if (row.status === 'DISPATCHED') return res.status(400).json({ error: 'Dispatched deviation bills cannot be edited' });
  const b = req.body;
  const { deviation_mwh, deviation_amount } = computeNet(
    b.scheduled_mwh ?? row.scheduled_mwh, b.actual_mwh ?? row.actual_mwh, b.deviation_rate ?? row.deviation_rate);
  db.prepare(`
    UPDATE deviation_settlements SET plant_code=?, plant_name=?, week_date=?, scheduled_mwh=?, actual_mwh=?,
      deviation_mwh=?, deviation_rate=?, deviation_amount=?, notes=?, status='CALCULATED', updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.plant_code ?? row.plant_code, b.plant_name ?? row.plant_name, b.week_date ?? row.week_date,
    Number(b.scheduled_mwh ?? row.scheduled_mwh) || 0, Number(b.actual_mwh ?? row.actual_mwh) || 0,
    deviation_mwh, Number(b.deviation_rate ?? row.deviation_rate) || 0, deviation_amount,
    b.notes ?? row.notes, req.params.id,
  );
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id, details: b });
  res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
});

// Submit for dispatch
router.post('/:id/submit', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  db.prepare(`UPDATE deviation_settlements SET status='SUBMITTED', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'SUBMIT', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id });
  res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
});

// Dispatch — assigns a bill number + dispatch date (SAP DSA Dispatch step)
router.post('/:id/dispatch', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  const invoice_no = req.body.invoice_no || genInvoiceNo('DSM');
  const dispatch_date = req.body.dispatch_date || new Date().toISOString().split('T')[0];
  db.prepare(`UPDATE deviation_settlements SET status='DISPATCHED', invoice_no=?, dispatch_date=?, updated_at=datetime('now') WHERE id=?`)
    .run(invoice_no, dispatch_date, req.params.id);
  logAudit({ req, user: req.user, action: 'DISPATCH', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id, details: { invoice_no, dispatch_date } });
  pushNotification({ role: 'REIA_USER', type: 'DSM_DISPATCHED', message: `DSM bill ${invoice_no} dispatched (${row.dsm_no})` });
  res.json(withContract(db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM deviation_settlements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Deviation record not found' });
  if (row.status === 'DISPATCHED') return res.status(400).json({ error: 'Dispatched deviation bills cannot be deleted' });
  db.prepare(`UPDATE deviation_settlements SET status='CANCELLED', updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  logAudit({ req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'deviation_settlement', entityId: req.params.id });
  res.json({ ok: true });
});

export default router;
