import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { checkPortfolioAdequacy } from '../paymentSecurityEngine.js';

const router = Router();
router.use(requireAuth);

function withClient(row) {
  if (!row) return row;
  const client = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(row.client_id);
  return { ...row, client_name: client?.name };
}

// II. Bilateral Transaction Management
router.get('/', (req, res) => {
  const { status, open_access_status } = req.query;
  let sql = 'SELECT * FROM bilateral_transactions WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (open_access_status) { sql += ' AND open_access_status = ?'; params.push(open_access_status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withClient));
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('BIL');
  db.prepare(`
    INSERT INTO bilateral_transactions (id, client_id, counterparty, loi_contract_ref, quantum_mw, tariff_per_unit,
      open_access_status, schedule_status, wheeling_charges, transmission_charges, losses_percent, start_date, end_date, status)
    VALUES (@id, @client_id, @counterparty, @loi_contract_ref, @quantum_mw, @tariff_per_unit,
      'PENDING', 'DRAFT', @wheeling_charges, @transmission_charges, @losses_percent, @start_date, @end_date, 'ACTIVE')
  `).run({
    id,
    client_id: b.client_id,
    counterparty: b.counterparty,
    loi_contract_ref: b.loi_contract_ref ?? null,
    quantum_mw: b.quantum_mw,
    tariff_per_unit: b.tariff_per_unit,
    wheeling_charges: b.wheeling_charges || 0,
    transmission_charges: b.transmission_charges || 0,
    losses_percent: b.losses_percent || 0,
    start_date: b.start_date,
    end_date: b.end_date,
  });
  logAudit({ user: req.user, action: 'CREATE', module: 'TRADING', entityType: 'bilateral', entityId: id, details: b });
  res.status(201).json(withClient(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(id)));
});

router.post('/:id/open-access', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const { decision } = req.body; // APPROVED | REJECTED | PARTIAL
  const row = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE bilateral_transactions SET open_access_status = ? WHERE id = ?`).run(decision, row.id);
  logAudit({ user: req.user, action: `OPEN_ACCESS_${decision}`, module: 'TRADING', entityType: 'bilateral', entityId: row.id });
  res.json(withClient(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(row.id)));
});

router.post('/:id/schedule', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const { schedule_status } = req.body; // SUBMITTED | APPROVED | REVISED | CANCELLED
  const row = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (['SUBMITTED', 'APPROVED'].includes(schedule_status)) {
    const sec = checkPortfolioAdequacy();
    if (!sec.adequate) {
      return res.status(400).json({ error: sec.error, security: sec });
    }
  }
  db.prepare(`UPDATE bilateral_transactions SET schedule_status = ? WHERE id = ?`).run(schedule_status, row.id);
  logAudit({ user: req.user, action: `SCHEDULE_${schedule_status}`, module: 'TRADING', entityType: 'bilateral', entityId: row.id });
  res.json(withClient(db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(row.id)));
});

export default router;
