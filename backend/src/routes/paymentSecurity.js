import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';

const router = Router();
router.use(requireAuth);

// H. Payment Security tracking (LC / BG / Corpus Fund)
router.get('/', (req, res) => {
  const { contract_id, status } = req.query;
  let sql = `SELECT ps.*, c.contract_no FROM payment_security ps JOIN contracts c ON c.id = ps.contract_id WHERE 1=1`;
  const params = [];
  if (contract_id) { sql += ' AND ps.contract_id = ?'; params.push(contract_id); }
  if (status) { sql += ' AND ps.status = ?'; params.push(status); }
  sql += ' ORDER BY ps.validity_end ASC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/expiring', (req, res) => {
  const days = Number(req.query.days || 30);
  const rows = db.prepare(`
    SELECT ps.*, c.contract_no FROM payment_security ps JOIN contracts c ON c.id = ps.contract_id
    WHERE ps.status = 'ACTIVE' AND julianday(ps.validity_end) - julianday('now') <= ?
    ORDER BY ps.validity_end ASC
  `).all(days);
  res.json(rows);
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('PSC');
  db.prepare(`
    INSERT INTO payment_security (id, contract_id, mechanism_type, amount, issuing_bank, beneficiary,
      validity_start, validity_end, utilized_amount, status, remarks)
    VALUES (@id, @contract_id, @mechanism_type, @amount, @issuing_bank, @beneficiary,
      @validity_start, @validity_end, 0, 'ACTIVE', @remarks)
  `).run({ id, ...b, remarks: b.remarks ?? null });
  logAudit({ user: req.user, action: 'CREATE', module: 'REIA', entityType: 'payment_security', entityId: id, details: b });
  res.status(201).json(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id));
});

router.post('/:id/renew', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { validity_end, amount } = req.body;
  const existing = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE payment_security SET validity_end = ?, amount = COALESCE(?, amount), status = 'RENEWED' WHERE id = ?`)
    .run(validity_end, amount ?? null, existing.id);
  logAudit({ user: req.user, action: 'RENEW', module: 'REIA', entityType: 'payment_security', entityId: existing.id });
  res.json(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(existing.id));
});

router.post('/:id/invoke', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { amount } = req.body;
  const existing = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE payment_security SET utilized_amount = utilized_amount + ?, status = 'INVOKED' WHERE id = ?`)
    .run(amount, existing.id);
  logAudit({ user: req.user, action: 'INVOKE', module: 'REIA', entityType: 'payment_security', entityId: existing.id, details: { amount } });
  res.json(db.prepare('SELECT * FROM payment_security WHERE id = ?').get(existing.id));
});

export default router;
