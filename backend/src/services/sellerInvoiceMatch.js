/**
 * Compare a seller-submitted invoice (SELLER_TO_SJVN) against the system
 * counterpart for the same contract + billing period.
 *
 * Counterpart resolution:
 *   1. invoice_mapping (seller → buyer / reverse)
 *   2. Best non-cancelled sibling invoice for contract+period
 *
 * Tolerances (masters, with defaults):
 *   qty   ~0.5%   seller_invoice_qty_tolerance_pct
 *   amount ~₹1 or 0.1%  seller_invoice_amount_tolerance_abs / _pct
 */
import db from '../db/index.js';
import { getParamNumber } from '../mastersService.js';

const COMPARE_FIELDS = [
  { key: 'energy_mwh', label: 'Energy (MWh)', kind: 'qty' },
  { key: 'energy_charges', label: 'Energy Charges', kind: 'amount' },
  { key: 'transmission_charges', label: 'Transmission Charges', kind: 'amount' },
  { key: 'trading_margin', label: 'Trading Margin', kind: 'amount' },
  { key: 'taxes', label: 'Taxes', kind: 'amount' },
  { key: 'total_amount', label: 'Total Amount', kind: 'amount' },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function withinQty(sellerVal, systemVal, tolPct) {
  const s = num(sellerVal);
  const sys = num(systemVal);
  if (s === 0 && sys === 0) return true;
  const base = Math.max(Math.abs(sys), Math.abs(s), 1e-9);
  return (Math.abs(s - sys) / base) * 100 <= tolPct;
}

function withinAmount(sellerVal, systemVal, tolPct, tolAbs) {
  const s = num(sellerVal);
  const sys = num(systemVal);
  const absDiff = Math.abs(s - sys);
  if (absDiff <= tolAbs) return true;
  const base = Math.max(Math.abs(sys), Math.abs(s), 1e-9);
  return (absDiff / base) * 100 <= tolPct;
}

/**
 * Resolve the system counterpart invoice for a seller (or any) invoice.
 * @returns {object|null}
 */
export function findSystemCounterpart(invoice) {
  if (!invoice?.id) return null;

  const viaSeller = db.prepare(`
    SELECT i.* FROM invoice_mapping m
    JOIN invoices i ON i.id = m.buyer_invoice_id
    WHERE m.seller_invoice_id = ? AND i.status != 'CANCELLED'
  `).get(invoice.id);
  if (viaSeller) return viaSeller;

  const viaBuyer = db.prepare(`
    SELECT i.* FROM invoice_mapping m
    JOIN invoices i ON i.id = m.seller_invoice_id
    WHERE m.buyer_invoice_id = ? AND i.id != ? AND i.status != 'CANCELLED'
  `).get(invoice.id, invoice.id);
  if (viaBuyer) return viaBuyer;

  // Prefer a sibling that looks system-generated (breakdown / REIA create path).
  return db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ?
      AND billing_period = ?
      AND id != ?
      AND status != 'CANCELLED'
    ORDER BY
      CASE WHEN invoice_breakdown_json IS NOT NULL AND TRIM(invoice_breakdown_json) != '' THEN 0 ELSE 1 END,
      CASE WHEN energy_data_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE status
        WHEN 'APPROVED' THEN 0 WHEN 'SENT' THEN 1 WHEN 'PAID' THEN 2
        WHEN 'DRAFT' THEN 3 WHEN 'SUBMITTED' THEN 4 ELSE 5
      END,
      created_at DESC
    LIMIT 1
  `).get(invoice.contract_id, invoice.billing_period, invoice.id) || null;
}

/**
 * @param {object} sellerInvoice
 * @param {object} [systemInvoice] — optional override; otherwise resolved
 * @returns {{
 *   status: 'MATCHED'|'PARTIAL'|'MISMATCH'|'NO_COUNTERPART',
 *   seller_invoice_id: string,
 *   system_invoice_id: string|null,
 *   tolerances: object,
 *   lines: Array<object>,
 *   matched_count: number,
 *   mismatch_count: number,
 * }}
 */
export function compareSellerToSystem(sellerInvoice, systemInvoice = null) {
  const system = systemInvoice || findSystemCounterpart(sellerInvoice);
  const qtyTol = getParamNumber('seller_invoice_qty_tolerance_pct', 0.5);
  const amtTolPct = getParamNumber('seller_invoice_amount_tolerance_pct', 0.1);
  const amtTolAbs = getParamNumber('seller_invoice_amount_tolerance_abs', 1);

  if (!system) {
    return {
      status: 'NO_COUNTERPART',
      seller_invoice_id: sellerInvoice.id,
      system_invoice_id: null,
      system_invoice_no: null,
      tolerances: { qty_pct: qtyTol, amount_pct: amtTolPct, amount_abs: amtTolAbs },
      lines: [],
      matched_count: 0,
      mismatch_count: 0,
    };
  }

  const lines = COMPARE_FIELDS.map((f) => {
    const sellerVal = num(sellerInvoice[f.key]);
    const systemVal = num(system[f.key]);
    const ok = f.kind === 'qty'
      ? withinQty(sellerVal, systemVal, qtyTol)
      : withinAmount(sellerVal, systemVal, amtTolPct, amtTolAbs);
    const absDiff = Math.abs(sellerVal - systemVal);
    const base = Math.max(Math.abs(systemVal), Math.abs(sellerVal), 1e-9);
    return {
      field: f.key,
      label: f.label,
      kind: f.kind,
      seller: sellerVal,
      system: systemVal,
      diff: Math.round((sellerVal - systemVal) * 1000) / 1000,
      diff_pct: Math.round((absDiff / base) * 10000) / 100,
      matched: ok,
    };
  });

  const matched_count = lines.filter((l) => l.matched).length;
  const mismatch_count = lines.length - matched_count;
  let status = 'MATCHED';
  if (mismatch_count === lines.length) status = 'MISMATCH';
  else if (mismatch_count > 0) status = 'PARTIAL';

  return {
    status,
    seller_invoice_id: sellerInvoice.id,
    seller_invoice_no: sellerInvoice.invoice_no,
    system_invoice_id: system.id,
    system_invoice_no: system.invoice_no,
    system_direction: system.direction,
    system_status: system.status,
    tolerances: { qty_pct: qtyTol, amount_pct: amtTolPct, amount_abs: amtTolAbs },
    lines,
    matched_count,
    mismatch_count,
  };
}

/**
 * Persist validation result onto the seller invoice row.
 */
export function persistValidation(invoiceId, result, { userName, waiveReason = null } = {}) {
  const payload = {
    ...result,
    waived: !!waiveReason,
    waive_reason: waiveReason || null,
  };
  db.prepare(`
    UPDATE invoices SET
      validation_status = ?,
      validation_json = ?,
      validated_at = datetime('now'),
      validated_by = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    result.status,
    JSON.stringify(payload),
    userName || null,
    invoiceId,
  );
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
}
