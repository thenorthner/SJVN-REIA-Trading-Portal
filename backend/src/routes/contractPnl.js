import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { contractPnl, realisedPnl } from '../services/contractPnl.js';

const router = Router();
router.use(requireAuth);

const PNL_READ = [...ROLE_GROUPS.TRADING_ALL, 'FINANCE_USER'];

// Per-deal contribution modelled off scheduled volume and the deal's rates.
router.get('/contracts', requireRole(...PNL_READ), (req, res) => {
  res.json(contractPnl({ from: req.query.from, to: req.query.to }));
});

// Portfolio P&L from invoices actually raised and received.
router.get('/realised', requireRole(...PNL_READ), (req, res) => {
  res.json(realisedPnl({ from: req.query.from, to: req.query.to }));
});

export default router;
