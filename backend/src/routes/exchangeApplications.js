import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { applyApplicationStep, withLinkedBids } from '../services/exchangeApplicationBids.js';

const router = Router();
router.use(requireAuth);

const ACTION_FIELDS = {
  px1: 'px1_status',
  px2: 'px2_status',
  exchange_request: 'exchange_request_status',
  exchange_approval: 'exchange_approval_status',
};


router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM exchange_applications WHERE 1=1';
  const params = [];
  if (q) {
    sql += ` AND (
      application_id LIKE ? OR portfolio_id LIKE ? OR exchange LIKE ? OR product LIKE ? OR bid_type LIKE ?
      OR IFNULL(contract_id,'') LIKE ? OR IFNULL(bid_ids,'') LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  sql += ' ORDER BY application_date DESC';
  res.json(db.prepare(sql).all(...params).map(withLinkedBids));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_applications WHERE id = ? OR application_id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withLinkedBids(row));
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

  res.json(withLinkedBids(db.prepare('SELECT * FROM exchange_applications WHERE id = ?').get(row.id)));
});

router.post('/:id/step', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM exchange_applications WHERE id = ? OR application_id = ?')
    .get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const step = String(req.body?.step || '').toLowerCase();
  if (!ACTION_FIELDS[step]) {
    return res.status(400).json({ error: `step must be one of: ${Object.keys(ACTION_FIELDS).join(', ')}` });
  }

  let updated;
  try {
    updated = applyApplicationStep(row, step, req.body?.status || 'DONE');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  secureLogAudit(req, {
    action: 'UPDATE_EXCHANGE_APPLICATION_STEP',
    module: 'TRADING',
    entityType: 'exchange_application',
    entityId: row.id,
    details: {
      application_id: row.application_id,
      step,
      status: updated[ACTION_FIELDS[step]],
      contract_id: updated.contract_id,
      bid_ids: updated.bid_ids,
    },
  });

  res.json(withLinkedBids(updated));
});

export default router;
