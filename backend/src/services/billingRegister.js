import db from '../db/index.js';
import { newId, genSjvnInvoiceNo, clientCodeFor } from '../util.js';
import { buildBilateralInvoice, BILATERAL_BILL_TYPES } from './bilateralSettlement.js';
import { buildExchangeInvoice, EXCHANGE_BILL_TYPES } from './exchangeSettlement.js';

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

/** Price a bill without writing it, routing to the engine behind its type. */
export function priceBill({ bill_type, contract_id, from = null, to = null, options = {} }) {
  const spec = BILL_TYPES[bill_type];
  if (!spec) throw new Error(`bill_type must be one of: ${ALL_BILL_TYPES.join(', ')}`);
  return spec.kind === 'BILATERAL'
    ? buildBilateralInvoice({ transaction_id: contract_id, bill_type, from, to, options })
    : buildExchangeInvoice({ contract_id, bill_type, from, to, options });
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

  db.prepare(`
    INSERT INTO view_bill_invoices (
      id, bill_type, client_name, invoice_no, invoice_amount, invoice_date, invoice_due_date,
      supply_from_date, supply_to_date, invoice_generated_on,
      tds_rate, tds_deducted, remarks, status,
      bilateral_id, exchange_contract_id, quantum_mwh, rate_per_unit, gst_amount, breakup_json,
      settlement_basis, generated_from
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, 'SETTLEMENT')
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
  );

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
    return {
      error: 'Nothing to bill for this period — no settled energy and no priceable charges',
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
