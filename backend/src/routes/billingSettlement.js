import express from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { secureLogAudit } from '../auditEngine.js';
import { seedInvoiceCounters } from '../util.js';
import { createTradingInvoice } from '../services/tradingInvoice.js';

seedInvoiceCounters();

const router = express.Router();

function newId(prefix) {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

// Ensure the user has trading or admin rights
router.use(requireAuth);
router.use(requireRole('SJVN_ADMIN', 'TRADING_USER', 'TRADING_CLIENT', 'FINANCE_USER'));

// 1. Invoices
router.get('/invoices', (req, res) => {
  const { status, client_id, invoice_kind } = req.query;
  let sql = `
    SELECT i.*, COALESCE(c.name, tc.name) AS client_name
    FROM trading_invoices i
    JOIN trading_clients tc ON i.client_id = tc.id
    -- LEFT JOIN: a trading client need not be linked to an entity, and an inner
    -- join silently dropped every invoice belonging to one that is not, so the
    -- list looked empty rather than incomplete.
    LEFT JOIN entities c ON tc.entity_id = c.id
    WHERE 1=1
  `;
  const params = [];
  
  if (req.user.role === 'TRADING_CLIENT') {
    sql += ' AND tc.id = ?';
    params.push(req.user.linked_entity_id); // Assuming linked_entity_id is trading_client id for this demo
  } else if (client_id) {
    sql += ' AND i.client_id = ?';
    params.push(client_id);
  }

  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  if (invoice_kind) { sql += ' AND i.invoice_kind = ?'; params.push(invoice_kind); }
  
  sql += ' ORDER BY i.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/invoices/generate', (req, res) => {
  if (req.user.role === 'TRADING_CLIENT') return res.status(403).json({ error: 'Clients cannot generate invoices' });
  try {
    // Priced and written by the shared service, so a settlement bill and an
    // energy bill are accounted for the same way. Settlement bills also post to
    // the client ledger.
    const inv = createTradingInvoice(req.body, { postLedger: true });
    secureLogAudit(req, {
      action: 'INVOICE_GENERATED', module: 'TRADING', entityType: 'trading_invoices', entityId: inv.id,
      details: { total_amount: inv.total_amount, net_payable: inv.net_payable, invoice_kind: inv.invoice_kind },
    });
    res.json({ id: inv.id, invoice_no: inv.invoice_no, total_amount: inv.total_amount, net_payable: inv.net_payable });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 2. Ledger
router.get('/ledger/:client_id', (req, res) => {
  const { client_id } = req.params;
  const rows = db.prepare(`
    SELECT * FROM client_ledgers 
    WHERE client_id = ? 
    ORDER BY timestamp DESC
  `).all(client_id);
  res.json(rows);
});

// 3. SOA
router.get('/soa', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, c.name as client_name 
    FROM settlement_statements s
    JOIN trading_clients tc ON s.client_id = tc.id
    JOIN entities c ON tc.entity_id = c.id
    ORDER BY s.created_at DESC
  `).all();
  res.json(rows);
});

router.post('/netting', (req, res) => {
  const { client_id, receivables_amount, payables_amount, period } = req.body;
  // This is a simplified netting for demo purposes. In real-life it would tie specific invoices.
  
  const netAmount = Math.abs(receivables_amount - payables_amount);
  const type = receivables_amount > payables_amount ? 'NET_RECEIVABLE' : 'NET_PAYABLE';

  db.prepare(`
    INSERT INTO client_ledgers (id, client_id, transaction_type, reference_id, credit, debit, running_balance, description, timestamp)
    VALUES (?, ?, 'SET_OFF', ?, ?, ?,
      COALESCE((SELECT running_balance FROM client_ledgers WHERE client_id = ? ORDER BY timestamp DESC LIMIT 1), 0) + ?,
      ?, datetime('now'))
  `).run(
    newId('CLG'), client_id, `NET-${period}`, 
    type === 'NET_PAYABLE' ? netAmount : 0, 
    type === 'NET_RECEIVABLE' ? netAmount : 0, 
    client_id, 
    type === 'NET_RECEIVABLE' ? netAmount : -netAmount, 
    `Netting for ${period}`
  );

  secureLogAudit(req, { action: 'NETTING_APPLIED', module: 'TRADING', entityType: 'client_ledgers', entityId: client_id, details: { netAmount, type } });
  res.json({ success: true, netAmount, type });
});

export default router;
