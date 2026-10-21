import express from 'express';
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import { recordReceipt, applyReceipt } from '../services/bankReceipts.js';

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

const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not record the receipt' });

// POST /api/trading/bank-transactions — one receipt, or { rows: [...] } for a pasted statement.
// A receipt that names a known client credits that client's pre-payment straight away.
router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [req.body];
  if (rows.length === 0 || rows.length > 500) return res.status(400).json({ error: 'Send between 1 and 500 receipts at a time' });
  const results = rows.map((row, i) => {
    try {
      const r = recordReceipt(row || {}, req.user.id);
      return { row: i + 1, utr_no: r.transaction.utr_no, outcome: r.outcome, transaction: r.transaction, client: r.client || null };
    } catch (e) {
      return { row: i + 1, utr_no: row?.utr_no || null, outcome: 'REJECTED', error: e.message };
    }
  });
  const applied = results.filter((r) => r.outcome === 'APPLIED');
  secureLogAudit(req, {
    action: 'BANK_RECEIPTS_RECORDED', module: 'TRADING', entityType: 'bank_transaction', entityId: results[0]?.transaction?.id || null,
    details: {
      received: rows.length, applied: applied.length,
      applied_rs: applied.reduce((a, r) => a + r.transaction.amount, 0),
      unmatched: results.filter((r) => r.outcome === 'UNMATCHED').length,
      duplicates: results.filter((r) => r.outcome === 'DUPLICATE').length,
      rejected: results.filter((r) => r.outcome === 'REJECTED').length,
    },
  });
  if (!Array.isArray(req.body?.rows)) {
    const only = results[0];
    if (only.outcome === 'REJECTED') return res.status(400).json({ error: only.error });
    return res.status(only.outcome === 'DUPLICATE' ? 409 : 201).json(only);
  }
  res.status(201).json({ results });
});

// POST /api/trading/bank-transactions/:id/apply — credit an unmatched receipt to a chosen client.
router.post('/:id/apply', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  try {
    const r = applyReceipt(req.params.id, req.body?.client_id);
    secureLogAudit(req, { action: 'BANK_RECEIPT_APPLIED', module: 'TRADING', entityType: 'bank_transaction', entityId: r.transaction.id, details: { client_id: r.client.id, amount: r.transaction.amount } });
    res.json(r);
  } catch (e) { fail(res, e); }
});

export default router;
