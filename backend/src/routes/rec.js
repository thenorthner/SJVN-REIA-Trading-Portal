import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;

// Profit realised on a sold REC lot = sale amount − issuance cost.
function withProfit(row) {
  if (!row) return row;
  const cost = (Number(row.quantity) || 0) * (Number(row.issue_cost_per_rec) || 0);
  const profit = row.status === 'SOLD' || row.status === 'REDEEMED'
    ? Math.round((Number(row.sale_amount) || 0) - cost)
    : 0;
  return { ...row, issue_cost_total: Math.round(cost), profit };
}

// List — filter by source / vintage / status
router.get('/', requireRole(...READ), (req, res) => {
  const { source, vintage_month, status } = req.query;
  let sql = 'SELECT * FROM rec_ledger WHERE 1=1';
  const params = [];
  if (source) { sql += ' AND source = ?'; params.push(source); }
  if (vintage_month) { sql += ' AND vintage_month = ?'; params.push(vintage_month); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY vintage_month DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withProfit));
});

// Portfolio summary for the dashboard (REC Traded, Profit From REC etc.)
router.get('/summary', requireRole(...READ), (req, res) => {
  const rows = db.prepare("SELECT * FROM rec_ledger WHERE status != 'CANCELLED'").all().map(withProfit);
  const sum = (f) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  res.json({
    total_lots: rows.length,
    total_recs: sum((r) => r.quantity),
    issued_recs: sum((r) => ['ISSUED', 'LISTED', 'SOLD', 'REDEEMED'].includes(r.status) ? r.quantity : 0),
    sold_recs: sum((r) => ['SOLD', 'REDEEMED'].includes(r.status) ? r.quantity : 0),
    rec_revenue: sum((r) => r.sale_amount),
    profit_from_rec: sum((r) => r.profit),
    pending_recs: sum((r) => ['APPLIED', 'ISSUED', 'LISTED'].includes(r.status) ? r.quantity : 0),
  });
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'REC lot not found' });
  res.json(withProfit(row));
});

const STATUSES = ['APPLIED', 'ISSUED', 'LISTED', 'SOLD', 'REDEEMED', 'CANCELLED'];

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  if (!b.vintage_month) return res.status(400).json({ error: 'vintage_month (YYYY-MM) is required' });
  const quantity = parseInt(b.quantity, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity (number of RECs) must be a positive number' });
  const status = STATUSES.includes(b.status) ? b.status : 'APPLIED';
  const saleRate = Number(b.sale_rate_per_rec) || 0;
  const id = newId('REC');
  const seq = (db.prepare('SELECT COUNT(*) c FROM rec_ledger').get().c || 0) + 1;
  const rec_no = b.rec_no || `REC/${(b.source || 'CSPP').replace(/[^A-Za-z0-9]+/g, '')}/${b.vintage_month}/${String(seq).padStart(4, '0')}`;

  db.prepare(`
    INSERT INTO rec_ledger (id, rec_no, source, vintage_month, quantity, status,
      application_date, issuance_date, issue_cost_per_rec, sale_rate_per_rec, sale_amount,
      trade_platform, trade_date, buyer, notes, created_by)
    VALUES (@id, @rec_no, @source, @vintage_month, @quantity, @status,
      @application_date, @issuance_date, @issue_cost_per_rec, @sale_rate_per_rec, @sale_amount,
      @trade_platform, @trade_date, @buyer, @notes, @created_by)
  `).run({
    id, rec_no,
    source: b.source || null,
    vintage_month: b.vintage_month,
    quantity,
    status,
    application_date: b.application_date || null,
    issuance_date: b.issuance_date || null,
    issue_cost_per_rec: Number(b.issue_cost_per_rec) || 0,
    sale_rate_per_rec: saleRate,
    sale_amount: Math.round(quantity * saleRate),
    trade_platform: b.trade_platform || null,
    trade_date: b.trade_date || null,
    buyer: b.buyer || null,
    notes: b.notes || null,
    created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: 'CREATE', module: 'TRADING', entityType: 'rec_lot', entityId: id, details: b });
  res.status(201).json(withProfit(db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(id)));
});

router.put('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'REC lot not found' });
  const b = req.body;
  const quantity = b.quantity != null ? parseInt(b.quantity, 10) : row.quantity;
  const saleRate = b.sale_rate_per_rec != null ? Number(b.sale_rate_per_rec) : row.sale_rate_per_rec;
  const status = STATUSES.includes(b.status) ? b.status : row.status;
  db.prepare(`
    UPDATE rec_ledger SET source=?, vintage_month=?, quantity=?, status=?, application_date=?,
      issuance_date=?, issue_cost_per_rec=?, sale_rate_per_rec=?, sale_amount=?, trade_platform=?,
      trade_date=?, buyer=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.source ?? row.source, b.vintage_month ?? row.vintage_month, quantity, status,
    b.application_date ?? row.application_date, b.issuance_date ?? row.issuance_date,
    b.issue_cost_per_rec != null ? Number(b.issue_cost_per_rec) : row.issue_cost_per_rec,
    saleRate, Math.round(quantity * saleRate), b.trade_platform ?? row.trade_platform,
    b.trade_date ?? row.trade_date, b.buyer ?? row.buyer, b.notes ?? row.notes, req.params.id,
  );
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'TRADING', entityType: 'rec_lot', entityId: req.params.id, details: b });
  res.json(withProfit(db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'REC lot not found' });
  db.prepare("UPDATE rec_ledger SET status='CANCELLED', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  logAudit({ req, user: req.user, action: 'CANCEL', module: 'TRADING', entityType: 'rec_lot', entityId: req.params.id });
  res.json({ ok: true });
});

export default router;
