import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, genSjvnInvoiceNo, seedInvoiceCounters } from '../util.js';

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
  const { client_id, invoice_kind, billing_period, quantum_mwh, rate_per_unit, margin_rate, gst_applicable, tds_section: tdsSectionIn, tds_rate: tdsRateIn } = req.body;
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const powerSupplyValue = invoice_kind === 'TRADING_MARGIN_ONLY' ? 0 : quantum_mwh * rate_per_unit;
  const tradingMargin = invoice_kind === 'POWER_SUPPLY_ONLY' ? 0 : Math.round(quantum_mwh * (margin_rate ?? 0.05));
  const subtotal = powerSupplyValue + tradingMargin;
  const gst = gst_applicable ? Math.round(subtotal * 0.18) : 0;
  const total = subtotal + gst;

  // TDS withholding. An invoice that carries energy value attracts Section 194Q
  // at 0.1% of the gross (pre-GST) taxable amount by default — the caller can
  // override the section/rate (e.g. 194C @ 10% for a transmission-charge bill,
  // or NONE). Withheld on the taxable value, not on GST, matching the ISET ledger.
  const DEFAULT_RATES = { '194Q': 0.001, '194C': 0.10, NONE: 0 };
  const hasEnergyValue = invoice_kind !== 'TRADING_MARGIN_ONLY';
  const tdsSection = ['194Q', '194C', 'NONE'].includes(tdsSectionIn)
    ? tdsSectionIn
    : (hasEnergyValue ? '194Q' : 'NONE');
  const tdsRate = tdsRateIn != null ? Number(tdsRateIn) : DEFAULT_RATES[tdsSection];
  const tdsAmount = tdsSection === 'NONE' ? 0 : Math.round(subtotal * tdsRate);
  const netPayable = total - tdsAmount;

  // Energy/combined bills use the ENERGY register; a pure margin bill uses MARGIN.
  const series = invoice_kind === 'TRADING_MARGIN_ONLY' ? 'MARGIN' : 'ENERGY';
  const id = newId('TIN');
  db.prepare(`
    INSERT INTO trading_invoices (id, invoice_no, client_id, invoice_kind, billing_period, quantum_mwh,
      rate_per_unit, trading_margin, gst_applicable, gst_amount, total_amount,
      tds_section, tds_rate, tds_amount, net_payable, status)
    VALUES (@id, @invoice_no, @client_id, @invoice_kind, @billing_period, @quantum_mwh,
      @rate_per_unit, @trading_margin, @gst_applicable, @gst_amount, @total_amount,
      @tds_section, @tds_rate, @tds_amount, @net_payable, 'DRAFT')
  `).run({
    id,
    invoice_no: genSjvnInvoiceNo(series, client.name, billing_period),
    client_id,
    invoice_kind,
    billing_period,
    quantum_mwh,
    rate_per_unit,
    trading_margin: tradingMargin,
    gst_applicable: gst_applicable ? 1 : 0,
    gst_amount: gst,
    total_amount: total,
    tds_section: tdsSection,
    tds_rate: tdsRate,
    tds_amount: tdsAmount,
    net_payable: netPayable,
  });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'GENERATE', module: 'TRADING', entityType: 'trading_invoice', entityId: id, details: req.body });
  res.status(201).json(withClient(db.prepare('SELECT * FROM trading_invoices WHERE id = ?').get(id)));
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
