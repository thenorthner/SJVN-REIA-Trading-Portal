import express from 'express';
import { buildEnergySchedule, listObligations } from '../services/exchangeSchedule.js';

const router = express.Router();

function fail(res, err) {
  return res.status(400).json({ error: err.message || 'Bad request' });
}

/** Daily obligation rollup — one row per delivery date × client × exchange. */
router.get('/obligations', (req, res) => {
  try {
    res.json(listObligations({
      product: req.query.product,
      from: req.query.from || null,
      to: req.query.to || null,
      client_id: req.query.client_id || req.query.portfolio || null,
      exchange: req.query.exchange || null,
    }));
  } catch (err) {
    fail(res, err);
  }
});

/** 96-block energy schedule from cleared / filed bid_blocks. */
router.get('/', (req, res) => {
  try {
    res.json(buildEnergySchedule({
      date: req.query.date,
      product: req.query.product,
      client_id: req.query.client_id || req.query.portfolio || null,
      exchange: req.query.exchange || null,
    }));
  } catch (err) {
    fail(res, err);
  }
});

export default router;
