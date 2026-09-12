import express from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { secureLogAudit } from '../auditEngine.js';
import { seedInvoiceCounters } from '../util.js';
import { createTradingInvoice } from '../services/tradingInvoice.js';
import { clientScope, isTradingClient, mayUseClient, tradingClientIdFor } from '../services/tradingClientScope.js';

seedInvoiceCounters();

const router = express.Router();

function newId(prefix) {
  // Same width as util.js newId — see the note there on 32-bit ids colliding.
  return `${prefix}-${uuidv4().replace(/-/g, '').slice(0, 16)}`;
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
  
  // Resolved through one rule rather than assuming linked_entity_id already
  // holds a trading_clients id — it may hold the entity's id instead, and an
  // unlinked client account must match nothing rather than everything.
  const scope = clientScope(req.user, 'tc.id');
  if (scope.restricted) {
    sql += scope.sql;
    params.push(...scope.params);
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
  if (isTradingClient(req.user)) return res.status(403).json({ error: 'Clients cannot generate invoices' });
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
  // The ledger was fetched by whatever id was in the URL, so one trading client
  // could read another's account.
  if (!mayUseClient(req.user, client_id)) return res.status(403).json({ error: 'You can only see your own ledger' });
  const rows = db.prepare(`
    SELECT * FROM client_ledgers 
    WHERE client_id = ? 
    ORDER BY timestamp DESC
  `).all(client_id);
  res.json(rows);
});

// 3. SOA
router.get('/soa', (req, res) => {
  // Statements of account are per client; this handed every client's to
  // whoever asked. A client now sees its own, the desk sees all of them.
  // LEFT JOIN because a trading client need not be linked to an entity — the
  // inner join dropped those clients' statements entirely.
  const scope = clientScope(req.user, 's.client_id');
  const rows = db.prepare(`
    SELECT s.*, COALESCE(c.name, tc.name) AS client_name
    FROM settlement_statements s
    JOIN trading_clients tc ON s.client_id = tc.id
    LEFT JOIN entities c ON tc.entity_id = c.id
    WHERE 1=1${scope.sql}
    ORDER BY s.created_at DESC
  `).all(...scope.params);
  res.json(rows);
});

router.post('/netting', (req, res) => {
  // Netting writes a set-off straight into a client's ledger, so it belongs to
  // the desk. A client could post entries against its own account — or, since
  // client_id came from the body, against another's.
  if (isTradingClient(req.user)) return res.status(403).json({ error: 'Clients cannot post netting entries' });
  const { client_id, receivables_amount, payables_amount, period } = req.body;
  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
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
