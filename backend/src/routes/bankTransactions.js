import express from 'express';
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/trading/bank-transactions
router.get('/', requireAuth, (req, res) => {
  try {
    const { portfolio, van, utr, from_date, to_date } = req.query;

    let query = 'SELECT * FROM bank_transactions WHERE 1=1';
    const params = [];

    if (portfolio) {
      query += ' AND portfolio_id = ?';
      params.push(portfolio);
    }
    if (van) {
      query += ' AND van = ?';
      params.push(van);
    }
    if (utr) {
      query += ' AND utr_no = ?';
      params.push(utr);
    }
    if (from_date) {
      query += ' AND date(transaction_date) >= date(?)';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND date(transaction_date) <= date(?)';
      params.push(to_date);
    }

    query += ' ORDER BY transaction_date DESC';

    const transactions = db.prepare(query).all(...params);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching bank transactions:', error);
    res.status(500).json({ error: 'Failed to fetch bank transactions' });
  }
});

export default router;
