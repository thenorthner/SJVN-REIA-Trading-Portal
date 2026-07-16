import express from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { secureLogAudit } from '../auditEngine.js';

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
    SELECT i.*, c.name as client_name 
    FROM trading_invoices i 
    JOIN trading_clients tc ON i.client_id = tc.id
    JOIN entities c ON tc.entity_id = c.id
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

  const { client_id, trade_date, settlement_date, invoice_kind, trade_type, billing_period, quantum_mwh,
    exchange_fee, clearing_charges, regulatory_levy, sjvn_margin, transmission_charges, dsm_charges, gst_applicable } = req.body;

  try {
    const margin = Number(sjvn_margin) || 0;
    const tds = margin * 0.10; // Simple 10% TDS rule for demo
    
    // Base Calculation
    let baseAmount = 0;
    if (invoice_kind === 'EXCHANGE') {
      baseAmount = (Number(exchange_fee) || 0) + (Number(clearing_charges) || 0) + (Number(regulatory_levy) || 0) + margin;
    } else {
      baseAmount = (Number(transmission_charges) || 0) + (Number(dsm_charges) || 0) + margin;
    }

    const preTdsTotal = baseAmount - tds;
    const gst = gst_applicable ? preTdsTotal * 0.18 : 0;
    const finalTotal = preTdsTotal + gst;

    const tinId = newId('TIN');
    const invoiceNo = `TRD/${new Date().getFullYear()}/${Math.floor(Math.random()*10000)}`;

    const stmt = db.prepare(`
      INSERT INTO trading_invoices (id, invoice_no, client_id, trade_date, settlement_date, invoice_kind, trade_type, billing_period, quantum_mwh,
        exchange_fee, clearing_charges, regulatory_levy, sjvn_margin, transmission_charges, dsm_charges, tds_amount, gst_applicable, gst_amount, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
    `);

    stmt.run(tinId, invoiceNo, client_id, trade_date, settlement_date, invoice_kind, trade_type, billing_period, quantum_mwh,
      exchange_fee || 0, clearing_charges || 0, regulatory_levy || 0, margin, transmission_charges || 0, dsm_charges || 0, tds, gst_applicable ? 1 : 0, gst, finalTotal);

    // Add Ledger Entry for DRAFT -> It's just provisional, maybe wait till 'SENT'? For demo, add immediately.
    db.prepare(`
      INSERT INTO client_ledgers (id, client_id, transaction_type, reference_id, credit, debit, running_balance, description, timestamp)
      VALUES (?, ?, 'INVOICE', ?, 0, ?, (SELECT COALESCE(running_balance,0) FROM client_ledgers WHERE client_id = ? ORDER BY timestamp DESC LIMIT 1) + ?, ?, ?)
    `).run(newId('CLG'), client_id, tinId, finalTotal, client_id, finalTotal, `Invoice Generated: ${invoiceNo}`, `${trade_date} 10:00:00`);

    secureLogAudit(req, 'INVOICE_GENERATED', 'trading_invoices', tinId, { total_amount: finalTotal, invoice_kind });

    res.json({ id: tinId, invoice_no: invoiceNo });
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
      (SELECT COALESCE(running_balance,0) FROM client_ledgers WHERE client_id = ? ORDER BY timestamp DESC LIMIT 1) + ?, 
      ?, datetime('now'))
  `).run(
    newId('CLG'), client_id, `NET-${period}`, 
    type === 'NET_PAYABLE' ? netAmount : 0, 
    type === 'NET_RECEIVABLE' ? netAmount : 0, 
    client_id, 
    type === 'NET_RECEIVABLE' ? netAmount : -netAmount, 
    `Netting for ${period}`
  );

  secureLogAudit(req, 'NETTING_APPLIED', 'client_ledgers', client_id, { netAmount, type });
  res.json({ success: true, netAmount, type });
});

export default router;
