import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, seedInvoiceCounters } from '../util.js';
import { createTradingInvoice } from '../services/tradingInvoice.js';

const router = Router();
router.use(requireAuth);

// Continue the ledger's real invoice registers (ENERGY 146+, OA 266+).
seedInvoiceCounters();

function withClient(row) {
  if (!row) return row;
  const client = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(row.client_id);
  return { ...row, client_name: client?.name };
}

// III. Trading Billing, Settlement and Accounting
router.get('/', (req, res) => {
  const { client_id, status } = req.query;
  let sql = 'SELECT * FROM trading_invoices WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withClient));
});

router.get('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM trading_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const payments = db.prepare('SELECT * FROM trading_payments WHERE trading_invoice_id = ? ORDER BY payment_date').all(req.params.id);
  res.json({ ...withClient(inv), payments });
});

// Configurable bill generation: trading margin only / power supply only / combined, with or without GST
router.post('/generate', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  try {
    const inv = createTradingInvoice(req.body);
    logAudit({ req, user: req.user, action: 'GENERATE', module: 'TRADING', entityType: 'trading_invoice', entityId: inv.id, details: req.body });
    res.status(201).json(withClient(inv));
  } catch (err) {
    const notFound = /Client not found/.test(err.message);
    res.status(notFound ? 404 : 400).json({ error: err.message });
  }
});

router.post('/:id/send', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM trading_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE trading_invoices SET status = 'SENT' WHERE id = ?`).run(inv.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SEND', module: 'TRADING', entityType: 'trading_invoice', entityId: inv.id });
  res.json(withClient(db.prepare('SELECT * FROM trading_invoices WHERE id = ?').get(inv.id)));
});

router.post('/:id/payments', requireRole(...ROLE_GROUPS.FINANCE, ...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM trading_invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const { amount, payment_date, mode, reference } = req.body;
  db.prepare(`INSERT INTO trading_payments (id, trading_invoice_id, amount, payment_date, mode, reference) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(newId('TPY'), inv.id, amount, payment_date, mode ?? null, reference ?? null);

  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM trading_payments WHERE trading_invoice_id = ?').get(inv.id).s;
  // The buyer remits net of TDS, so an invoice is fully settled once payments
  // reach net_payable — comparing against the gross total_amount would leave any
  // TDS-bearing invoice stuck at PARTIALLY_PAID forever.
  const settlementTarget = inv.net_payable != null ? inv.net_payable : inv.total_amount;
  const newStatus = totalPaid >= settlementTarget ? 'PAID' : 'PARTIALLY_PAID';
  db.prepare(`UPDATE trading_invoices SET status = ? WHERE id = ?`).run(newStatus, inv.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'PAYMENT_RECORDED', module: 'TRADING', entityType: 'trading_invoice', entityId: inv.id, details: req.body });
  res.status(201).json(withClient(db.prepare('SELECT * FROM trading_invoices WHERE id = ?').get(inv.id)));
});

export default router;
