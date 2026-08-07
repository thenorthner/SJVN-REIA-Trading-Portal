import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { listDeviations, summary, scorecard, incidents, runDeviationAlerts } from '../services/deviationRegister.js';

const router = Router();
router.use(requireAuth);

const DEV_READ = [...ROLE_GROUPS.TRADING_ALL];

function filters(q) {
  return {
    bilateral_id: q.bilateral_id, contract_ref: q.contract_ref,
    from: q.from, to: q.to, only_deviations: q.only_deviations === '1',
  };
}

// Day-wise register. ?only_deviations=1 narrows to days a side defaulted.
router.get('/', requireRole(...DEV_READ), (req, res) => {
  res.json(listDeviations(filters(req.query)));
});

// Headline totals + reliability for the filtered period.
router.get('/summary', requireRole(...DEV_READ), (req, res) => {
  res.json(summary(filters(req.query)));
});

// Per-counterparty reliability scorecard with an A-D grade.
router.get('/scorecard', requireRole(...DEV_READ), (req, res) => {
  res.json(scorecard(filters(req.query)));
});

// Individual shortfall events, worst first.
router.get('/incidents', requireRole(...DEV_READ), (req, res) => {
  res.json(incidents(filters(req.query)));
});

// Run the shortfall alert sweep now rather than waiting for the daily schedule.
router.post('/run-alerts', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  res.json(runDeviationAlerts());
});

export default router;
