import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { bankEnergy, drawBanked, settleExpiredBanking, bankedPosition } from '../services/energyBanking.js';

const router = Router();
router.use(requireAuth);

const BANK_READ = [...ROLE_GROUPS.REIA_ALL];
const BANK_WRITE = [...ROLE_GROUPS.REIA_WRITE];

// What is still banked for a contract, by cycle.
router.get('/:contractId', requireRole(...BANK_READ), (req, res) => {
  res.json(bankedPosition(req.params.contractId));
});

// Credit energy the buyer could not take to the seller's bank.
router.post('/', requireRole(...BANK_WRITE), (req, res) => {
  try {
    const row = bankEnergy({ ...req.body, createdBy: req.user?.id });
    logAudit({ req, user: req.user, action: 'BANK_ENERGY', module: 'REIA', entityType: 'energy_banking', entityId: row.id, details: req.body });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Draw banked energy back out within the cycle.
router.post('/draw', requireRole(...BANK_WRITE), (req, res) => {
  try {
    const result = drawBanked(req.body);
    logAudit({ req, user: req.user, action: 'DRAW_BANKED', module: 'REIA', entityType: 'energy_banking', entityId: req.body.contract_id, details: req.body });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Settle cycles that closed with energy unused. Also runs on a schedule.
router.post('/settle', requireRole(...BANK_WRITE), (req, res) => {
  const result = settleExpiredBanking(req.body?.as_of);
  logAudit({ req, user: req.user, action: 'SETTLE_BANKING', module: 'REIA', entityType: 'energy_banking', entityId: 'sweep', details: result });
  res.json(result);
});

export default router;
