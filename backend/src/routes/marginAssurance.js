import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { marginCheck, rateTrend, receiptExceptions } from '../services/marginAssurance.js';

const router = Router();
router.use(requireAuth);

const MARGIN_READ = [...ROLE_GROUPS.TRADING_ALL, 'FINANCE_USER'];

const filters = (q) => ({ from: q.from, to: q.to });

// Per-day margin against the contract's expected margin, with breaches called out.
router.get('/check', requireRole(...MARGIN_READ), (req, res) => {
  res.json(marginCheck(filters(req.query)));
});

// Daily purchase / sale / margin rates for trending.
router.get('/rate-trend', requireRole(...MARGIN_READ), (req, res) => {
  res.json(rateTrend(filters(req.query)));
});

// Days where the receipt did not match what was billed.
router.get('/receipt-exceptions', requireRole(...MARGIN_READ), (req, res) => {
  const minAbs = req.query.min_abs != null ? Number(req.query.min_abs) : 1;
  res.json(receiptExceptions(filters(req.query), minAbs));
});

export default router;
