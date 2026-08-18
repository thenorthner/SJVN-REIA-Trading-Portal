import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { generateIexBidBook, REPORT_TYPES } from '../services/iexBidBookFromBids.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const reportType = String(req.query.report_type || '').toUpperCase();
  if (!REPORT_TYPES.includes(reportType)) {
    return res.status(400).json({ error: `report_type must be one of: ${REPORT_TYPES.join(', ')}` });
  }
  try {
    res.json(generateIexBidBook(reportType));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to build bid book report' });
  }
});

export default router;
