import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { generateTradingViewBillPdf } from '../scripts/tradingViewBillPdf.js';

// The sample invoices were transcribed from the live ISET ledger — real client
// names, invoice numbers and amounts — and this repo has a remote, so they live
// in the ignored src/data/live/ rather than inline here. A clone without them
// simply starts with an empty register.
const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), '../data/live/viewBillSeeds.json');
function liveSeeds() {
  try {
    const rows = JSON.parse(readFileSync(SEED_PATH, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

const router = Router();
router.use(requireAuth);

const BILL_TYPES = [
  'TRADING_MARGIN', 'EXCHANGE_OA', 'EXCHANGE_ENERGY',
  'BILATERAL_ENERGY', 'BILATERAL_OA', 'BILATERAL_SLDC',
];

const CONTRACT_PRODUCTS = ['DAM', 'HPDAM', 'TAM', 'GDAM', 'RTM', 'GTAM', 'REC', 'ESCERT', 'RPO'];

function parseProducts(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function parseAmt(s) {
  if (s == null || s === '') return null;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Seed ISET View Bills samples once per bill_type group. */
export function seedViewBillInvoices() {
  const insert = db.prepare(`
    INSERT INTO view_bill_invoices (
      id, bill_type, client_name, invoice_no, invoice_amount, invoice_date, invoice_due_date,
      supply_from_date, supply_to_date, invoice_generated_on,
      received_amount, payment_date, tds_rate, tds_deducted, bank_name, remarks, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `);
  const existsNo = db.prepare('SELECT 1 FROM view_bill_invoices WHERE invoice_no = ?');
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM view_bill_invoices').get().n;

  const rows = liveSeeds();
  if (!rows.length) return;

  const tx = db.transaction(() => {
    for (const r of rows) {
      if (existsNo.get(r.invoice_no)) continue;
      // First boot: seed everything. Later boots: only add missing OA/SLDC samples.
      if (countAll > 0 && !['BILATERAL_OA', 'BILATERAL_SLDC'].includes(r.bill_type)) continue;
      insert.run(
        newId('VBI'),
        r.bill_type,
        r.client_name,
        r.invoice_no,
        r.invoice_amount,
        r.invoice_date,
        r.invoice_due_date || null,
        r.supply_from_date || null,
        r.supply_to_date || null,
        r.invoice_generated_on || null,
        r.received_amount ?? null,
        r.payment_date || null,
        r.tds_rate ?? null,
        r.tds_deducted ?? null,
        r.bank_name || null,
        r.remarks || null,
      );
    }
  });
  tx();
}

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { bill_type, q, status, product } = req.query;
  let sql = 'SELECT * FROM view_bill_invoices WHERE 1=1';
  const params = [];
  if (bill_type) {
    if (!BILL_TYPES.includes(bill_type)) return res.status(400).json({ error: 'Invalid bill_type' });
    sql += ' AND bill_type = ?';
    params.push(bill_type);
  }
  if (product) {
    const products = parseProducts(product);
    if (!products.length || products.some((p) => !CONTRACT_PRODUCTS.includes(p))) {
      return res.status(400).json({ error: 'Invalid product' });
    }
    sql += ` AND exchange_contract_id IN (SELECT id FROM exchange_contracts WHERE product IN (${products.map(() => '?').join(',')}))`;
    params.push(...products);
  }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else { sql += " AND status != 'CANCELLED'"; }
  if (q) {
    sql += ' AND (client_name LIKE ? OR invoice_no LIKE ? OR remarks LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY invoice_date DESC, invoice_no DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM view_bill_invoices WHERE id = ? OR invoice_no = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.get('/:id/pdf', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM view_bill_invoices WHERE id = ? OR invoice_no = ?').get(req.params.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const notes = db.prepare(`
    SELECT * FROM trading_debit_credit_notes
    WHERE view_bill_invoice_id = ?
    ORDER BY created_at ASC
  `).all(row.id);
  secureLogAudit(req, { action: 'EXPORT_VIEW_BILL_PDF', module: 'TRADING', entityType: 'view_bill_invoice', entityId: row.id });
  generateTradingViewBillPdf(row, notes, res);
});

router.put('/:id', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM view_bill_invoices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status === 'CANCELLED') return res.status(400).json({ error: 'Cancelled invoice cannot be edited' });
  const b = req.body || {};
  db.prepare(`
    UPDATE view_bill_invoices SET
      client_name = COALESCE(?, client_name),
      invoice_amount = COALESCE(?, invoice_amount),
      invoice_date = COALESCE(?, invoice_date),
      invoice_due_date = COALESCE(?, invoice_due_date),
      supply_from_date = COALESCE(?, supply_from_date),
      supply_to_date = COALESCE(?, supply_to_date),
      remarks = COALESCE(?, remarks)
    WHERE id = ?
  `).run(
    b.client_name ?? null,
    b.invoice_amount != null ? Number(b.invoice_amount) : null,
    b.invoice_date ?? null,
    b.invoice_due_date ?? null,
    b.supply_from_date ?? null,
    b.supply_to_date ?? null,
    b.remarks ?? null,
    row.id,
  );
  secureLogAudit(req, { action: 'UPDATE_VIEW_BILL', module: 'TRADING', entityType: 'view_bill_invoice', entityId: row.id });
  res.json(db.prepare('SELECT * FROM view_bill_invoices WHERE id = ?').get(row.id));
});

router.post('/:id/payment', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM view_bill_invoices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`
    UPDATE view_bill_invoices SET
      received_amount = ?, payment_date = ?, tds_rate = ?, tds_deducted = ?, bank_name = ?, remarks = COALESCE(?, remarks)
    WHERE id = ?
  `).run(
    parseAmt(b.received_amount),
    b.payment_date || null,
    b.tds_rate != null && b.tds_rate !== '' ? Number(b.tds_rate) : null,
    parseAmt(b.tds_deducted),
    b.bank_name || null,
    b.remarks ?? null,
    row.id,
  );
  secureLogAudit(req, { action: 'RECORD_VIEW_BILL_PAYMENT', module: 'TRADING', entityType: 'view_bill_invoice', entityId: row.id, details: b });
  res.json(db.prepare('SELECT * FROM view_bill_invoices WHERE id = ?').get(row.id));
});

router.post('/:id/cancel', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM view_bill_invoices WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE view_bill_invoices SET status = 'CANCELLED', cancel_reason = ? WHERE id = ?`)
    .run(String(req.body?.reason || '').trim() || null, row.id);
  secureLogAudit(req, { action: 'CANCEL_VIEW_BILL', module: 'TRADING', entityType: 'view_bill_invoice', entityId: row.id });
  res.json(db.prepare('SELECT * FROM view_bill_invoices WHERE id = ?').get(row.id));
});

export default router;
