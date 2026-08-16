import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const ACTION_FIELDS = {
  px1: 'px1_status',
  px2: 'px2_status',
  exchange_request: 'exchange_request_status',
  exchange_approval: 'exchange_approval_status',
};

/** Seed ISET-style sample applications once. */
export function seedExchangeApplications() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM exchange_applications').get().n;
  if (n > 0) return;

  const samples = [
    {
      application_id: 'PX20250527A1018',
      application_date: '2025-05-27 05:29:00',
      portfolio_id: 'IEXNDMC123',
      exchange: 'IEX',
      product: 'DAM',
      bid_type: 'Single Bid',
    },
    {
      application_id: 'PX20250527A1017',
      application_date: '2025-05-27 12:16:00',
      portfolio_id: 'IEXNDMC123',
      exchange: 'IEX',
      product: 'DAM',
      bid_type: 'Single Bid',
    },
    {
      application_id: 'PX20251126A1022',
      application_date: '2025-11-26 07:15:00',
      portfolio_id: '1234578901',
      exchange: 'IEX',
      product: 'DAM',
      bid_type: 'Single Bid',
    },
  ];

  const insert = db.prepare(`
    INSERT INTO exchange_applications (
      id, application_id, application_date, portfolio_id, exchange, product, bid_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      insert.run(newId('PXA'), r.application_id, r.application_date, r.portfolio_id, r.exchange, r.product, r.bid_type);
    }
  });
  tx(samples);
}

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM exchange_applications WHERE 1=1';
  const params = [];
  if (q) {
    sql += ` AND (
      application_id LIKE ? OR portfolio_id LIKE ? OR exchange LIKE ? OR product LIKE ? OR bid_type LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY application_date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_applications WHERE id = ? OR application_id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.post('/:id/approve', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_applications WHERE id = ? OR application_id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const decision = String(req.body?.decision || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be APPROVED or REJECTED' });
  }
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;

  db.prepare(`
    UPDATE exchange_applications SET approval_status = ?, notes = COALESCE(?, notes) WHERE id = ?
  `).run(decision, notes, row.id);

  secureLogAudit(req, {
    action: decision === 'APPROVED' ? 'APPROVE_EXCHANGE_APPLICATION' : 'REJECT_EXCHANGE_APPLICATION',
    module: 'TRADING',
    entityType: 'exchange_application',
    entityId: row.id,
    details: { application_id: row.application_id, decision, notes },
  });

  res.json(db.prepare('SELECT * FROM exchange_applications WHERE id = ?').get(row.id));
});

router.post('/:id/step', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_applications WHERE id = ? OR application_id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const step = String(req.body?.step || '').toLowerCase();
  const field = ACTION_FIELDS[step];
  if (!field) return res.status(400).json({ error: `step must be one of: ${Object.keys(ACTION_FIELDS).join(', ')}` });

  const status = String(req.body?.status || 'DONE').toUpperCase();
  db.prepare(`UPDATE exchange_applications SET ${field} = ? WHERE id = ?`).run(status, row.id);

  secureLogAudit(req, {
    action: 'UPDATE_EXCHANGE_APPLICATION_STEP',
    module: 'TRADING',
    entityType: 'exchange_application',
    entityId: row.id,
    details: { application_id: row.application_id, step, status },
  });

  res.json(db.prepare('SELECT * FROM exchange_applications WHERE id = ?').get(row.id));
});

export default router;
