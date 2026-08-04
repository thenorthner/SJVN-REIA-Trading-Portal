import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { cercScraper } from '../services/cercScraper.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole(...ROLE_GROUPS.TRADING_ALL, 'TRADING_CLIENT'));

router.get('/summary', (req, res) => {
  const row = db.prepare(`SELECT * FROM cerc_monthly_summary ORDER BY report_period DESC LIMIT 1`).get();
  res.json(row || null);
});

router.get('/summary/:period', (req, res) => {
  const { period } = req.params;
  const row = db.prepare(`SELECT * FROM cerc_monthly_summary WHERE report_period = ?`).get(period);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.get('/prices', (req, res) => {
  const { period, product, exchange } = req.query;
  const sql = ['SELECT * FROM cerc_market_data WHERE data_category = ?'];
  const params = ['PRICE'];
  if (period) { sql.push('report_period = ?'); params.push(period); }
  if (product) { sql.push('product = ?'); params.push(product); }
  if (exchange) { sql.push('exchange = ?'); params.push(exchange); }
  
  const rows = db.prepare(sql.join(' AND ')).all(...params);
  res.json(rows);
});

router.get('/volumes', (req, res) => {
  const { period, product } = req.query;
  const sql = ['SELECT * FROM cerc_market_data WHERE data_category = ?'];
  const params = ['VOLUME'];
  if (period) { sql.push('report_period = ?'); params.push(period); }
  if (product) { sql.push('product = ?'); params.push(product); }
  
  const rows = db.prepare(sql.join(' AND ')).all(...params);
  res.json(rows);
});

router.get('/daily-trend', (req, res) => {
  const { period } = req.query;
  const sql = ['SELECT * FROM cerc_market_data WHERE day_of_month IS NOT NULL'];
  const params = [];
  if (period) { sql.push('report_period = ?'); params.push(period); }
  
  const q = sql.length > 1 ? sql.join(' AND ') : sql[0];
  const rows = db.prepare(q).all(...params);
  res.json(rows);
});

router.get('/dsm', (req, res) => {
  const { period } = req.query;
  const sql = ['SELECT * FROM cerc_market_data WHERE data_category = ?'];
  const params = ['DSM'];
  if (period) { sql.push('report_period = ?'); params.push(period); }
  
  const rows = db.prepare(sql.join(' AND ')).all(...params);
  res.json(rows);
});

router.get('/rec', (req, res) => {
  const { period } = req.query;
  const sql = ['SELECT * FROM cerc_market_data WHERE data_category = ?'];
  const params = ['REC'];
  if (period) { sql.push('report_period = ?'); params.push(period); }
  
  const rows = db.prepare(sql.join(' AND ')).all(...params);
  res.json(rows);
});

router.get('/periods', (req, res) => {
  const rows = db.prepare(`SELECT report_period FROM cerc_monthly_summary ORDER BY report_period DESC`).all();
  res.json(rows.map(r => r.report_period));
});

router.get('/fetch-log', (req, res) => {
  const rows = cercScraper.getCercFetchLog(req.query);
  res.json(rows);
});

router.post('/trigger', async (req, res) => {
  try {
    const { period } = req.body;
    if (!period) return res.status(400).json({ error: 'period required' });
    const result = await cercScraper.fetchCercReport(period);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const result = await cercScraper.scanForNewReports();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
