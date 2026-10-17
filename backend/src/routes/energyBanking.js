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
    // Named fields only: the service's own clock is not the request's to set.
    const { contract_id, cycle, period_month, banked_mwh, tariff_per_unit, cycle_ends_on } = req.body || {};
    const row = bankEnergy({ contract_id, cycle, period_month, banked_mwh, tariff_per_unit, cycle_ends_on, createdBy: req.user?.id });
    logAudit({ req, user: req.user, action: 'BANK_ENERGY', module: 'REIA', entityType: 'energy_banking', entityId: row.id, details: req.body });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Draw banked energy back out within the cycle.
router.post('/draw', requireRole(...BANK_WRITE), (req, res) => {
  try {
    const { contract_id, cycle, draw_mwh } = req.body || {};
    const result = drawBanked({ contract_id, cycle, draw_mwh, createdBy: { name: req.user?.name, id: req.user?.id } });
    logAudit({ req, user: req.user, action: 'DRAW_BANKED', module: 'REIA', entityType: 'energy_banking', entityId: req.body.contract_id, details: req.body });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Settle cycles that closed with energy unused. Also runs on a schedule.
// Only a cycle that has actually closed: the sweep took any "as of", so naming
// 2099 cashed out a cycle still running.
router.post('/settle', requireRole(...BANK_WRITE), (req, res) => {
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const asOf = req.body?.as_of;
  if (asOf !== undefined && asOf !== null && asOf !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) return res.status(400).json({ error: 'as_of must be a date (YYYY-MM-DD)' });
    if (String(asOf) > today) return res.status(400).json({ error: `as_of ${asOf} is in the future; only cycles that have closed by today are settled.` });
  }
  const result = settleExpiredBanking(asOf || today);
  logAudit({ req, user: req.user, action: 'SETTLE_BANKING', module: 'REIA', entityType: 'energy_banking', entityId: 'sweep', details: result });
  res.json(result);
});

export default router;
