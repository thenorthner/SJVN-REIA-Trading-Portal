import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// Market rates & simple forecast readiness (I.4.4 Analytics and Forecasting Readiness)
router.get('/', (req, res) => {
  const { product } = req.query;
  let sql = 'SELECT * FROM market_rates WHERE 1=1';
  const params = [];
  if (product) { sql += ' AND product = ?'; params.push(product); }
  sql += ' ORDER BY rate_date ASC';
  res.json(db.prepare(sql).all(...params));
});

export default router;
