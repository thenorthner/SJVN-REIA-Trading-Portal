import db from '../db/index.js';
import { computeOaCharges } from './oaCharges.js';
import { getEffectiveRate } from './rateMaster.js';

// Settlement for a power-exchange client agreement: turn the bid blocks the
// exchange actually cleared into a billable position for a supply period, then
// price the bills the ISET desk raises against it.
//
// This is the exchange counterpart of bilateralSettlement.js. The chain stopped
// at "result recorded": bid_blocks held the cleared MW and the market clearing
// price, and view_bill_invoices held the EXCHANGE_ENERGY / EXCHANGE_OA bills,
// but nothing joined them — so every exchange bill in the register was a
// hand-entered sample.

// A bid block is a 15-minute market interval, so a block cleared at 1 MW
// carries 0.25 MWh.
const BLOCK_HOURS = 0.25;
const KWH_PER_MWH = 1000;
const GST_RATE = 0.18;

// Only these blocks represent energy that will actually flow.
const CLEARED_BLOCK_STATUSES = ['CLEARED', 'PARTIALLY_CLEARED'];

// Withholding follows the same convention as the bilateral register: the rate
// is stated as a percentage and energy supply attracts 0.1%. The fee-based
// bills are pass-throughs and carry none unless the caller states otherwise.
const DEFAULT_TDS_PCT = {
  EXCHANGE_ENERGY: 0.1,
  EXCHANGE_OA: 0,
  TRADING_MARGIN: 0,
};

export const EXCHANGE_BILL_TYPES = Object.keys(DEFAULT_TDS_PCT);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rupees = (v) => Math.round(num(v));

/**
 * The bids that settle against an exchange contract for a supply period.
 *
 * A bid placed after contract_id existed says which agreement it belongs to.
 * Older bids do not, so they are matched the way the desk would match them by
 * hand — same client, same product, delivered inside the contract's window.
 */
export function bidsForContract(contract, from = null, to = null) {
  const start = from || contract.start_date;
  const end = to || contract.end_date;
  return db.prepare(`
    SELECT * FROM bids
    WHERE (
      contract_id = ?
      OR (contract_id IS NULL AND client_id = ? AND product = ?)
    )
      AND delivery_date >= ? AND delivery_date <= ?
      AND status IN ('CLEARED','PARTIALLY_CLEARED')
      AND is_no_bid = 0
    ORDER BY delivery_date, created_at
  `).all(contract.id, contract.client_id, contract.product, start, end);
}

/**
 * Aggregate what the exchange cleared across those bids.
 *
 * Energy is valued at the price the market actually cleared at, falling back to
 * the bid price only when the result did not carry one — a cleared block always
 * has a price in practice, and treating a missing one as zero would understate
 * the bill rather than flag it.
 */
export function summariseClearedBids(bids) {
  const bidIds = bids.map((b) => b.id);
  const dates = new Set();
  let clearedMwh = 0;
  let bidMwh = 0;
  let clearedValue = 0;
  let blocks = 0;
  let clearedBlocks = 0;
  const warnings = [];

  for (const bid of bids) {
    dates.add(bid.delivery_date);
    const rows = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ?').all(bid.id);
    for (const blk of rows) {
      blocks += 1;
      bidMwh += num(blk.quantum_mw) * BLOCK_HOURS;
      if (!CLEARED_BLOCK_STATUSES.includes(blk.status)) continue;
      const mwh = num(blk.cleared_quantum_mw) * BLOCK_HOURS;
      if (mwh <= 0) continue;
      clearedBlocks += 1;
      const price = blk.cleared_price != null ? num(blk.cleared_price) : num(blk.price_per_unit);
      if (blk.cleared_price == null) {
        warnings.push(`Block ${blk.time_block} on ${bid.delivery_date} cleared without a price; billed at the bid price ${price}`);
      }
      clearedMwh += mwh;
      clearedValue += mwh * KWH_PER_MWH * price;
    }
  }

  const sortedDates = [...dates].sort();
  return {
    bid_ids: bidIds,
    bids: bids.length,
    blocks,
    cleared_blocks: clearedBlocks,
    days: sortedDates.length,
    period_from: sortedDates[0] || null,
    period_to: sortedDates[sortedDates.length - 1] || null,
    bid_mwh: Number(bidMwh.toFixed(4)),
    cleared_mwh: Number(clearedMwh.toFixed(4)),
    uncleared_mwh: Number((bidMwh - clearedMwh).toFixed(4)),
    // Volume-weighted average of the prices the market cleared at.
    avg_clearing_price: clearedMwh > 0 ? Number((clearedValue / (clearedMwh * KWH_PER_MWH)).toFixed(4)) : 0,
    cleared_value: rupees(clearedValue),
    warnings,
  };
}

/** The exchange's own transaction fee on cleared volume, off the rate master. */
export function exchangeFeeFor(exchangeName, clearedMwh, onDate) {
  const name = `${String(exchangeName || 'IEX').toUpperCase()} Transaction Fee`;
  const rate = getEffectiveRate(name, onDate);
  if (!rate) {
    return { charge: name, rate: null, amount: 0, warning: `No rate found for '${name}' on ${onDate}` };
  }
  return { charge: name, rate: rate.rate_value, amount: rupees(rate.rate_value * clearedMwh), warning: null };
}

/**
 * The settlement position for an exchange contract over a supply period.
 *
 * Which way the money runs is decided by the contract's side. On a Buyer
 * contract SJVN buys the client's power on the exchange, so the client is
 * billed the market cost plus the desk's margin. On a Seller contract SJVN
 * sells the client's power, so the client receives the market proceeds less
 * that margin. Both are reported as an amount the client owes, negative when
 * the flow is the other way.
 */
export function computeExchangeSettlement({ contract_id, from = null, to = null } = {}) {
  const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(contract_id);
  if (!contract) throw new Error('Exchange contract not found');

  const bids = bidsForContract(contract, from, to);
  const cleared = summariseClearedBids(bids);

  const marginRate = num(contract.trading_margin);
  const marginValue = rupees(cleared.cleared_mwh * KWH_PER_MWH * marginRate);
  const isBuy = contract.side === 'Buyer';

  // Which exchange the volume actually cleared on; a contract's bids sit on one.
  const exchangeName = bids[0]?.exchange || 'IEX';
  const feeDate = cleared.period_from || contract.start_date;
  const fee = exchangeFeeFor(exchangeName, cleared.cleared_mwh, feeDate);

  return {
    contract_id: contract.id,
    client_name: contract.client_name,
    side: contract.side,
    product: contract.product,
    exchange: exchangeName,
    requested_from: from,
    requested_to: to,
    cleared,
    rates: {
      avg_clearing_price: cleared.avg_clearing_price,
      trading_margin_per_unit: marginRate,
      exchange_fee_rate: fee.rate,
    },
    money: {
      // Value of the cleared energy at the market clearing price.
      energy_value: cleared.cleared_value,
      // The desk's spread on the cleared volume.
      trading_margin: marginValue,
      exchange_fee: fee.amount,
      // What the client owes on the energy leg once the margin is applied in
      // the direction the contract runs.
      client_energy_position: isBuy ? cleared.cleared_value + marginValue : cleared.cleared_value - marginValue,
    },
    warnings: [...cleared.warnings, fee.warning].filter(Boolean),
  };
}

/** Line-item helper — same shape as the bilateral breakup. */
function line(description, basis, quantity, rate, amount) {
  return { description, basis, quantity, rate, amount: rupees(amount) };
}

function energyBillLines(contract, s, opts = {}) {
  const lines = [
    line(
      `Energy cleared on ${s.exchange} (${s.product})`,
      'MWh @ Rs/kWh',
      s.cleared.cleared_mwh,
      s.rates.avg_clearing_price,
      s.money.energy_value,
    ),
  ];
  // On a buy the margin is charged to the client; on a sell it is retained out
  // of the proceeds, so it lands on the bill with the opposite sign.
  if (s.money.trading_margin) {
    lines.push(line(
      contract.side === 'Buyer' ? 'Trading margin' : 'Trading margin retained',
      'MWh @ Rs/kWh',
      s.cleared.cleared_mwh,
      s.rates.trading_margin_per_unit,
      contract.side === 'Buyer' ? s.money.trading_margin : -s.money.trading_margin,
    ));
  }
  // Opt-in, the same way the bill screen asks for it on the bilateral side.
  if (opts.include_lps && num(contract.late_payment_surcharge)) {
    lines.push(line('Late payment surcharge', 'lump sum', null, null, num(contract.late_payment_surcharge)));
  }
  if (num(contract.rebate)) {
    lines.push(line('Rebate', 'lump sum', null, null, -num(contract.rebate)));
  }
  return lines;
}

function marginBillLines(contract, s) {
  const lines = [];
  if (s.money.trading_margin) {
    lines.push(line('Trading margin', 'MWh @ Rs/kWh', s.cleared.cleared_mwh, s.rates.trading_margin_per_unit, s.money.trading_margin));
  }
  if (num(contract.client_registration_fee)) {
    lines.push(line('Client registration fee', 'flat', null, null, num(contract.client_registration_fee)));
  }
  if (num(contract.application_fee)) {
    lines.push(line('Application fee', 'flat', null, null, num(contract.application_fee)));
  }
  return lines;
}

function oaBillLines(contract, s, opts) {
  // Exchange-cleared energy still has to be wheeled, so it carries the same
  // open-access legs as a bilateral trade, plus the exchange's own fee.
  const oa = computeOaCharges({
    quantum_mwh: s.cleared.cleared_mwh,
    days: Math.max(1, s.cleared.days),
    on_date: s.cleared.period_from || contract.start_date,
    injection_state: opts.injection_state ?? null,
    drawal_state: opts.drawal_state ?? contract.concerned_sldc ?? null,
    region: opts.region ?? contract.region ?? null,
    ists_rate: opts.ists_rate,
    include_ists: opts.include_ists !== false,
  });

  const bearer = String(opts.bearer || 'BUYER').toUpperCase();
  const items = bearer === 'ALL' ? oa.line_items : oa.line_items.filter((i) => i.bearer === bearer);
  const lines = items.map((i) => line(i.charge, i.basis, i.quantum_mwh ?? i.days ?? 1, i.rate, i.amount));

  if (s.money.exchange_fee) {
    lines.push(line(`${s.exchange} transaction fee`, 'Rs/MWh', s.cleared.cleared_mwh, s.rates.exchange_fee_rate, s.money.exchange_fee));
  }
  return { lines, warnings: oa.warnings };
}

/**
 * Price one of the exchange bills off a settlement.
 *
 * Returns the register row's money fields alongside the itemised breakup, so a
 * generated invoice can always be read back to the bid blocks behind it.
 */
export function buildExchangeInvoice({ contract_id, bill_type, from = null, to = null, options = {} } = {}) {
  if (!EXCHANGE_BILL_TYPES.includes(bill_type)) {
    throw new Error(`bill_type must be one of: ${EXCHANGE_BILL_TYPES.join(', ')}`);
  }
  const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(contract_id);
  if (!contract) throw new Error('Exchange contract not found');

  const settlement = computeExchangeSettlement({ contract_id, from, to });

  let lines = [];
  let warnings = [...settlement.warnings];
  if (bill_type === 'EXCHANGE_ENERGY') {
    lines = energyBillLines(contract, settlement, options);
  } else if (bill_type === 'TRADING_MARGIN') {
    lines = marginBillLines(contract, settlement);
  } else {
    const built = oaBillLines(contract, settlement, options);
    lines = built.lines;
    warnings = [...warnings, ...built.warnings];
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gstApplicable = Boolean(options.gst_applicable);
  const gst = gstApplicable ? rupees(subtotal * GST_RATE) : 0;
  const invoiceAmount = subtotal + gst;

  const tdsPct = options.tds_rate != null ? num(options.tds_rate) : DEFAULT_TDS_PCT[bill_type];
  const tdsDeducted = rupees(invoiceAmount * (tdsPct / 100));

  return {
    contract_id: contract.id,
    bill_type,
    client_name: options.client_name || contract.client_name,
    supply_from_date: settlement.cleared.period_from,
    supply_to_date: settlement.cleared.period_to,
    quantum_mwh: settlement.cleared.cleared_mwh,
    rate_per_unit: bill_type === 'EXCHANGE_ENERGY' ? settlement.rates.avg_clearing_price : null,
    subtotal,
    gst_applicable: gstApplicable,
    gst_amount: gst,
    invoice_amount: invoiceAmount,
    tds_rate: tdsPct,
    tds_deducted: tdsDeducted,
    net_receivable: invoiceAmount - tdsDeducted,
    line_items: lines,
    warnings,
    settlement,
  };
}

/**
 * Derive the contract's lifecycle from the bids filed against it.
 *
 * status carried its full vocabulary but nothing ever moved it off DRAFT.
 * CANCELLED is a decision rather than an observation, so it is left alone.
 */
export function refreshExchangeContractStatus(contractId, today = new Date().toISOString().slice(0, 10)) {
  const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(contractId);
  if (!contract || contract.status === 'CANCELLED') return contract?.status ?? null;

  const filed = db.prepare(`
    SELECT COUNT(*) AS n FROM bids
    WHERE (contract_id = ? OR (contract_id IS NULL AND client_id = ? AND product = ?))
      AND delivery_date >= ? AND delivery_date <= ?
      AND status != 'DRAFT'
  `).get(contract.id, contract.client_id, contract.product, contract.start_date, contract.end_date).n;

  let status;
  if (!filed) status = 'DRAFT';
  else if (today > contract.end_date) status = 'COMPLETED';
  else status = 'ACTIVE';

  if (status !== contract.status) {
    db.prepare('UPDATE exchange_contracts SET status = ? WHERE id = ?').run(status, contract.id);
  }
  return status;
}
