import db from '../db/index.js';
import { newId, genSjvnInvoiceNo, clientCodeFor } from '../util.js';
import { buildBilateralInvoice, BILATERAL_BILL_TYPES } from './bilateralSettlement.js';
import { buildExchangeInvoice, EXCHANGE_BILL_TYPES } from './exchangeSettlement.js';
import { isOneOff } from './billCharges.js';

// One place where a settled bill is priced and written into the View Bills
// register, whichever desk it came from.
//
// The bilateral and exchange routes each grew their own copy of the same
// insert; the Generate Bill screen needs a third caller that can raise any of
// the six types without knowing which engine is behind it. Rather than a third
// copy, the shape lives here and all three go through it.

/**
 * The six bills the desk raises, and what each one needs to be raised.
 *
 * `kind` says which contract register the bill settles against, which is how a
 * caller that only knows a bill type finds the right contract to bill.
 */
export const BILL_TYPES = {
  BILATERAL_ENERGY: { label: 'Bilateral Energy Settlement', kind: 'BILATERAL', series: 'ENERGY' },
  BILATERAL_OA: { label: 'Bilateral Open Access', kind: 'BILATERAL', series: 'BILAT/OA' },
  BILATERAL_SLDC: { label: 'Bilateral SLDC Consent Fee', kind: 'BILATERAL', series: 'BILAT/SLDC' },
  EXCHANGE_ENERGY: { label: 'Exchange Energy Settlement', kind: 'EXCHANGE', series: 'EXCHANGE' },
  EXCHANGE_OA: { label: 'Exchange Open Access', kind: 'EXCHANGE', series: 'EXCHANGE/OA' },
  TRADING_MARGIN: { label: 'Exchange Trading Margin', kind: 'EXCHANGE', series: 'MARGIN' },
};

export const ALL_BILL_TYPES = Object.keys(BILL_TYPES);

/** A bill the register already holds that this one would bill again. */
export class BillingConflict extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
  }
}

/**
 * The one-off charges earlier bills of this type under the contract already
 * carried, by description, with the invoice that carried each. A bill for the
 * very same period is left out: it is the one a final bill replaces, or the
 * duplicate the register refuses anyway.
 */
function billedOnce(spec, bill_type, contract_id, buyer, from, to) {
  const column = spec.kind === 'BILATERAL' ? 'bilateral_id' : 'exchange_contract_id';
  const rows = db.prepare(`
    SELECT invoice_no, breakup_json, supply_from_date, supply_to_date FROM view_bill_invoices
    WHERE ${column} = ? AND bill_type = ? AND status = 'ACTIVE'
      AND IFNULL(bilateral_buyer, '') = IFNULL(?, '')
    ORDER BY created_at
  `).all(contract_id, bill_type, buyer || null);
  const out = {};
  for (const r of rows) {
    if ((r.supply_from_date || '') === (from || '') && (r.supply_to_date || '') === (to || '')) continue;
    let items = [];
    try { items = JSON.parse(r.breakup_json || '{}').line_items || []; } catch { /* an unreadable breakup carried nothing we can see */ }
    for (const l of items) {
      if (isOneOff(l) && l.amount > 0 && !out[l.description]) out[l.description] = r.invoice_no;
    }
  }
  return out;
}

/** Price a bill without writing it, routing to the engine behind its type. */
export function priceBill({ bill_type, contract_id, from = null, to = null, options = {} }) {
  const spec = BILL_TYPES[bill_type];
  if (!spec) throw new Error(`bill_type must be one of: ${ALL_BILL_TYPES.join(', ')}`);
  const price = (opts) => (spec.kind === 'BILATERAL'
    ? buildBilateralInvoice({ transaction_id: contract_id, bill_type, from, to, options: opts })
    : buildExchangeInvoice({ contract_id, bill_type, from, to, options: opts }));

  // Priced once to learn the period the bill actually covers, then again
  // without any one-off charge an earlier bill has already carried.
  const first = price(options);
  const already = billedOnce(spec, bill_type, contract_id, first.buyer, first.supply_from_date, first.supply_to_date);
  return Object.keys(already).length ? price({ ...options, already_billed: already }) : first;
}

/**
 * Write a priced bill into the register.
 *
 * The invoice number is taken under the bill type's own series, using the
 * client's short code where the contract is linked to a trading client — the
 * desk's ledger reads SJVN/ENERGY/NDMC/…, not a code derived from the first
 * word of a legal name.
 */
export function raiseInvoice({
  bill_type, priced, bilateral_id = null, exchange_contract_id = null,
  client_id = null, client_code = null,
  invoice_date = null, credit_days = 7, remarks = null, actor_id = null,
}) {
  const spec = BILL_TYPES[bill_type];
  if (!spec) throw new Error(`bill_type must be one of: ${ALL_BILL_TYPES.join(', ')}`);

  const invoiceDate = invoice_date || new Date().toISOString().slice(0, 10);
  const days = Number.isFinite(Number(credit_days)) ? Number(credit_days) : 7;
  const dueDate = new Date(new Date(invoiceDate).getTime() + days * 86400000).toISOString().slice(0, 10);
  const billingName = client_code || (client_id && clientCodeFor(client_id)) || priced.client_name;
  const invoiceNo = genSjvnInvoiceNo(spec.series, billingName, invoiceDate);
  const id = newId('VBI');

  // An exchange bill settles a cleared market result, which has no later meter
  // reading to restate it; a bilateral bill is provisional until every block in
  // the period carries metered actuals.
  const basis = spec.kind === 'EXCHANGE' ? 'FINAL' : (priced.is_final ? 'FINAL' : 'PROVISIONAL');
  const sourceColumn = bilateral_id ? 'bilateral_id' : 'exchange_contract_id';
  const sourceId = bilateral_id || exchange_contract_id;

  if (sourceId) {
    const duplicate = db.prepare(`
      SELECT * FROM view_bill_invoices
      WHERE ${sourceColumn} = ? AND bill_type = ?
        AND IFNULL(supply_from_date, '') = IFNULL(?, '')
        AND IFNULL(supply_to_date, '') = IFNULL(?, '')
        AND IFNULL(settlement_basis, '') = IFNULL(?, '')
        AND IFNULL(bilateral_buyer, '') = IFNULL(?, '')
        AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sourceId, bill_type, priced.supply_from_date || null, priced.supply_to_date || null, basis, priced.buyer || null);
    if (duplicate) {
      throw new BillingConflict(`${duplicate.invoice_no} already bills this ${bill_type} period as ${basis}`);
    }

    // A different period that shares a day with an active bill would bill that
    // day's energy twice. The one exception is the provisional bill for this
    // exact period, which a final bill replaces below.
    if (priced.supply_from_date && priced.supply_to_date) {
      const overlap = db.prepare(`
        SELECT invoice_no, supply_from_date, supply_to_date, settlement_basis FROM view_bill_invoices
        WHERE ${sourceColumn} = ? AND bill_type = ? AND status = 'ACTIVE'
          AND IFNULL(bilateral_buyer, '') = IFNULL(?, '')
          AND supply_from_date IS NOT NULL AND supply_to_date IS NOT NULL
          AND supply_from_date <= ? AND supply_to_date >= ?
          AND NOT (? = 'FINAL' AND settlement_basis = 'PROVISIONAL'
                   AND supply_from_date = ? AND supply_to_date = ?)
        ORDER BY created_at DESC
        LIMIT 1
      `).get(sourceId, bill_type, priced.buyer || null, priced.supply_to_date, priced.supply_from_date,
        basis, priced.supply_from_date, priced.supply_to_date);
      if (overlap) {
        throw new BillingConflict(`${overlap.invoice_no} already bills ${overlap.supply_from_date} to ${overlap.supply_to_date} (${overlap.settlement_basis}) on this contract; a ${bill_type} bill for ${priced.supply_from_date} to ${priced.supply_to_date} would bill those days again`);
      }
    }
  }

  let supersedes = null;
  if (basis === 'FINAL' && sourceId) {
    supersedes = db.prepare(`
      SELECT * FROM view_bill_invoices
      WHERE ${sourceColumn} = ? AND bill_type = ?
        AND IFNULL(supply_from_date, '') = IFNULL(?, '')
        AND IFNULL(supply_to_date, '') = IFNULL(?, '')
        AND settlement_basis = 'PROVISIONAL'
        AND IFNULL(bilateral_buyer, '') = IFNULL(?, '')
        AND status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sourceId, bill_type, priced.supply_from_date || null, priced.supply_to_date || null, priced.buyer || null);
  }

  db.prepare(`
    INSERT INTO view_bill_invoices (
      id, bill_type, client_name, invoice_no, invoice_amount, invoice_date, invoice_due_date,
      supply_from_date, supply_to_date, invoice_generated_on,
      tds_rate, tds_deducted, remarks, status,
      bilateral_id, exchange_contract_id, quantum_mwh, rate_per_unit, gst_amount, breakup_json,
      settlement_basis, generated_from, supersedes_invoice_id, bilateral_buyer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, 'SETTLEMENT', ?, ?)
  `).run(
    id,
    bill_type,
    priced.client_name,
    invoiceNo,
    priced.invoice_amount,
    invoiceDate,
    dueDate,
    priced.supply_from_date,
    priced.supply_to_date,
    new Date().toISOString().slice(0, 16).replace('T', ' '),
    priced.tds_rate,
    priced.tds_deducted,
    remarks,
    bilateral_id,
    exchange_contract_id,
    priced.quantum_mwh,
    priced.rate_per_unit,
    priced.gst_amount,
    JSON.stringify({ line_items: priced.line_items, settlement: priced.settlement, warnings: priced.warnings }),
    basis,
    supersedes?.id || null,
    priced.buyer || null,
  );

  if (supersedes) {
    db.prepare(`
      UPDATE view_bill_invoices
         SET status = 'CANCELLED',
             cancel_reason = ?,
             superseded_by_invoice_id = ?
       WHERE id = ?
    `).run(`Superseded by final invoice ${invoiceNo}`, id, supersedes.id);
  }

  return db.prepare('SELECT * FROM view_bill_invoices WHERE id = ?').get(id);
}

/**
 * Why a priced bill cannot be raised, or null when it can.
 *
 * Both desks refuse the same two things: a bill with no money in it, and a
 * bill whose flat and per-day legs would price to a real amount on a period in
 * which nothing actually flowed.
 */
export function billingObjection(priced, { allow_zero_volume = false } = {}) {
  if (!priced.line_items.length || priced.invoice_amount === 0) {
    const billedBefore = priced.warnings.filter((w) => /billed once already/.test(w));
    return {
      error: billedBefore.length
        ? `Nothing left to bill: ${billedBefore.join('; ')}`
        : 'Nothing to bill for this period — no settled energy and no priceable charges',
      warnings: priced.warnings,
    };
  }
  if (priced.quantum_mwh === 0 && !allow_zero_volume) {
    return {
      error: 'No volume settled in this period. Pass allow_zero_volume to bill the flat and per-day charges anyway.',
      would_bill: priced.invoice_amount,
      warnings: priced.warnings,
    };
  }
  return null;
}

/** Sanity check that BILL_TYPES stays in step with the two engines. */
export function billTypeCoverage() {
  const declared = new Set(ALL_BILL_TYPES);
  const engines = new Set([...BILATERAL_BILL_TYPES, ...EXCHANGE_BILL_TYPES]);
  return {
    declared: [...declared],
    missing_from_registry: [...engines].filter((t) => !declared.has(t)),
    unknown_to_engines: [...declared].filter((t) => !engines.has(t)),
  };
}
