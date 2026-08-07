import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { position, timeline, ageing, settlementSpeed, listEntries } from '../services/paymentCycle.js';

const router = Router();
router.use(requireAuth);

const PAY_READ = [...ROLE_GROUPS.TRADING_ALL, 'FINANCE_USER'];

const filters = (q) => ({ from: q.from, to: q.to, direction: q.direction });

// Net cash position across both legs.
router.get('/position', requireRole(...PAY_READ), (req, res) => {
  res.json(position(filters(req.query)));
});

// Daily movement with a running balance.
router.get('/timeline', requireRole(...PAY_READ), (req, res) => {
  res.json(timeline(filters(req.query)));
});

// Unsettled invoices bucketed by days past due.
router.get('/ageing', requireRole(...PAY_READ), (req, res) => {
  res.json(ageing(req.query.as_of));
});

// Average / fastest / slowest days to pay per side.
router.get('/settlement-speed', requireRole(...PAY_READ), (req, res) => {
  res.json(settlementSpeed(filters(req.query)));
});

// The underlying register. ?direction=INFLOW|OUTFLOW narrows to one leg.
router.get('/entries', requireRole(...PAY_READ), (req, res) => {
  res.json(listEntries(filters(req.query)));
});

export default router;
