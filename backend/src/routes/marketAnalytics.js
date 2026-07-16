import express from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { secureLogAudit } from '../auditEngine.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireRole('SJVN_ADMIN', 'TRADING_USER', 'TRADING_CLIENT', 'FINANCE_USER'));

function newId(prefix) {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

// 1. Market Rates (Compare Exchanges)
router.get('/rates', (req, res) => {
  const { start_date, end_date } = req.query;
  let sql = 'SELECT * FROM market_rates WHERE 1=1';
  const params = [];

  if (start_date) { sql += ' AND rate_date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND rate_date <= ?'; params.push(end_date); }
  
  sql += ' ORDER BY rate_date ASC';
  res.json(db.prepare(sql).all(...params));
});

// 2. Events & Factors
router.get('/context', (req, res) => {
  const { start_date, end_date } = req.query;
  let eventSql = 'SELECT * FROM market_events WHERE 1=1';
  let factorSql = 'SELECT * FROM market_factors WHERE 1=1';
  const params = [];

  if (start_date) { 
    eventSql += ' AND event_date >= ?'; 
    factorSql += ' AND factor_date >= ?';
    params.push(start_date); 
  }
  if (end_date) { 
    eventSql += ' AND event_date <= ?'; 
    factorSql += ' AND factor_date <= ?';
    params.push(end_date); 
  }

  eventSql += ' ORDER BY event_date ASC';
  factorSql += ' ORDER BY factor_date ASC';

  const events = db.prepare(eventSql).all(...params);
  const factors = db.prepare(factorSql).all(...params);

  res.json({ events, factors });
});

// 3. Price Alerts
router.get('/alerts', (req, res) => {
  res.json(db.prepare('SELECT * FROM price_alerts WHERE user_id = ?').all(req.user.id));
});

router.post('/alerts', (req, res) => {
  const { product, condition, threshold_price } = req.body;
  const alertId = newId('ALT');
  db.prepare(`
    INSERT INTO price_alerts (id, user_id, product, condition, threshold_price, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(alertId, req.user.id, product, condition, Number(threshold_price));

  secureLogAudit(req, 'ALERT_CREATED', 'price_alerts', alertId, { product, condition, threshold_price });
  res.json({ id: alertId });
});

export default router;
