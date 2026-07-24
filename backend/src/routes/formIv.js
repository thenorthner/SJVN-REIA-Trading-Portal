import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;
const STATUSES = ['DRAFT', 'PREPARED', 'SUBMITTED'];

router.get('/', requireRole(...READ), (req, res) => {
  const { status, period_type } = req.query;
  let sql = 'SELECT * FROM cerc_form_iv WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (period_type) { sql += ' AND period_type = ?'; params.push(period_type); }
  sql += ' ORDER BY period DESC, created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/summary', requireRole(...READ), (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN status='SUBMITTED' THEN 1 ELSE 0 END),0) submitted,
    COALESCE(SUM(CASE WHEN status!='SUBMITTED' THEN 1 ELSE 0 END),0) pending
    FROM cerc_form_iv`).get();
  const latest = db.prepare("SELECT period, status FROM cerc_form_iv WHERE period_type='MONTHLY' ORDER BY period DESC LIMIT 1").get();
  res.json({ ...row, latest_period: latest?.period || null, latest_status: latest?.status || 'Pending' });
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body;
  const period_type = b.period_type === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY';
  if (!b.period) return res.status(400).json({ error: 'period (YYYY-MM or FY) is required' });
  const dup = db.prepare('SELECT id FROM cerc_form_iv WHERE period_type=? AND period=?').get(period_type, b.period);
  if (dup) return res.status(409).json({ error: `A ${period_type} Form-IV for ${b.period} already exists.` });
  const id = newId('FIV');
  const seq = (db.prepare('SELECT COUNT(*) c FROM cerc_form_iv').get().c || 0) + 1;
  db.prepare(`
    INSERT INTO cerc_form_iv (id, form_no, period_type, period, total_volume_mu, total_revenue,
      trading_margin, status, submission_date, reference_no, notes, created_by)
    VALUES (@id, @form_no, @period_type, @period, @total_volume_mu, @total_revenue,
      @trading_margin, @status, @submission_date, @reference_no, @notes, @created_by)
  `).run({
    id, form_no: `FORM-IV/${b.period}/${String(seq).padStart(3, '0')}`,
    period_type, period: b.period,
    total_volume_mu: Number(b.total_volume_mu) || 0,
    total_revenue: Number(b.total_revenue) || 0,
    trading_margin: Number(b.trading_margin) || 0,
    status: STATUSES.includes(b.status) ? b.status : 'DRAFT',
    submission_date: b.submission_date || (b.status === 'SUBMITTED' ? new Date().toISOString().split('T')[0] : null),
    reference_no: b.reference_no || null,
    notes: b.notes || null, created_by: req.user.name,
  });
  logAudit({ req, user: req.user, action: 'CREATE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(id));
});

router.put('/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Form-IV record not found' });
  const b = req.body;
  const status = STATUSES.includes(b.status) ? b.status : row.status;
  db.prepare(`
    UPDATE cerc_form_iv SET total_volume_mu=?, total_revenue=?, trading_margin=?, status=?,
      submission_date=?, reference_no=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    Number(b.total_volume_mu ?? row.total_volume_mu) || 0,
    Number(b.total_revenue ?? row.total_revenue) || 0,
    Number(b.trading_margin ?? row.trading_margin) || 0,
    status,
    status === 'SUBMITTED' ? (b.submission_date || row.submission_date || new Date().toISOString().split('T')[0]) : (b.submission_date ?? row.submission_date),
    b.reference_no ?? row.reference_no, b.notes ?? row.notes, req.params.id,
  );
  logAudit({ req, user: req.user, action: 'UPDATE', module: 'TRADING', entityType: 'cerc_form_iv', entityId: req.params.id, details: b });
  res.json(db.prepare('SELECT * FROM cerc_form_iv WHERE id = ?').get(req.params.id));
});

export default router;
