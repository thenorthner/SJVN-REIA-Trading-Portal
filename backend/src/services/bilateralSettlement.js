import db from '../db/index.js';
import { computeOaCharges } from './oaCharges.js';
import { getEffectiveRate } from './rateMaster.js';

// Settlement for a bilateral open-access transaction: turn the 15-minute
// schedule blocks into a billable quantum for a supply period, then price the
// three bills the ISET desk raises against it — the energy settlement invoice,
// the open-access charges invoice and the SLDC consent fee invoice.
//
// Without this the chain stopped at "actuals recorded": bilateral_schedules held
// the metered energy and view_bill_invoices held the bills, but nothing joined
// them, so every bilateral invoice in the register was a hand-entered sample.

// One schedule row is one 15-minute block, so a block at 1 MW carries 0.25 MWh.
const BLOCK_HOURS = 0.25;
const KWH_PER_MWH = 1000;
const GST_RATE = 0.18;

// The View Bills register states TDS as a percentage, and its own rows withhold
// 0.1% of the face value: 1,79,00,751 billed, 17,901 withheld, 1,78,82,850
// received. Energy supply attracts that 194Q withholding; the open-access and
// SLDC bills are pass-throughs of statutory charges and carry none unless the
// caller states otherwise.
const DEFAULT_TDS_PCT = {
  BILATERAL_ENERGY: 0.1,
  BILATERAL_OA: 0,
  BILATERAL_SLDC: 0,
};

export const BILATERAL_BILL_TYPES = Object.keys(DEFAULT_TDS_PCT);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rupees = (v) => Math.round(num(v));

/**
 * Aggregate the schedule blocks of a transaction over a supply period.
 *
 * A block's scheduled energy is what survived curtailment; its delivered energy
 * is the metered actual where one was recorded, and the schedule itself where
 * the meter has not reported yet. Reporting both, plus how many blocks are
 * actually metered, keeps a provisional bill distinguishable from a final one.
 */
export function summariseSchedules(transactionId, from = null, to = null) {
  let sql = `SELECT * FROM bilateral_schedules
    WHERE transaction_id = ? AND status != 'CANCELLED'`;
  const params = [transactionId];
  if (from) { sql += ' AND schedule_date >= ?'; params.push(from); }
  if (to) { sql += ' AND schedule_date <= ?'; params.push(to); }
  sql += ' ORDER BY schedule_date, time_block';
  const rows = db.prepare(sql).all(...params);

  const dates = new Set();
  let scheduledMwh = 0;
  let curtailedMwh = 0;
  let deliveredMwh = 0;
  let dsmPenalty = 0;
  let meteredBlocks = 0;

  for (const r of rows) {
    dates.add(r.schedule_date);
    const curtailed = Math.max(0, num(r.curtailed_mw));
    const scheduled = Math.max(0, num(r.approved_mw) - curtailed);
    const metered = r.actual_mw != null;
    if (metered) meteredBlocks += 1;
    const delivered = metered ? Math.max(0, num(r.actual_mw)) : scheduled;

    scheduledMwh += scheduled * BLOCK_HOURS;
    curtailedMwh += curtailed * BLOCK_HOURS;
    deliveredMwh += delivered * BLOCK_HOURS;
    dsmPenalty += num(r.dsm_penalty_amount);
  }

  const sortedDates = [...dates].sort();
  return {
    blocks: rows.length,
    metered_blocks: meteredBlocks,
    // A bill is final only once every block in the period has metered data.
    is_final: rows.length > 0 && meteredBlocks === rows.length,
    days: sortedDates.length,
    period_from: sortedDates[0] || from || null,
    period_to: sortedDates[sortedDates.length - 1] || to || null,
    scheduled_mwh: Number(scheduledMwh.toFixed(4)),
    curtailed_mwh: Number(curtailedMwh.toFixed(4)),
    delivered_mwh: Number(deliveredMwh.toFixed(4)),
    deviation_mwh: Number((deliveredMwh - scheduledMwh).toFixed(4)),
    dsm_penalty_amount: rupees(dsmPenalty),
  };
}

/**
 * Gross the drawal-point energy back up to the injection point.
 *
 * Open-access losses are borne in kind at three points — intra-state at
 * injection, ISTS on the corridor, intra-state at drawal — so the seller has to
 * inject more than the buyer draws. The buyer is billed for what it drew; the
 * injected figure is what the seller schedules and what the open-access charges
 * are levied on.
 */
export function grossUpForLosses(deliveredMwh, tx) {
  const legs = {
    loss_injection_state: num(tx.loss_injection_state),
    loss_inter_state: num(tx.loss_inter_state),
    loss_drawee_state: num(tx.loss_drawee_state),
  };
  const retention = Object.values(legs).reduce((acc, pct) => acc * (1 - pct / 100), 1);
  // A loss set totalling 100% or more would divide by zero; treat it as lossless
  // rather than returning Infinity into a bill.
  const injected = retention > 0 ? deliveredMwh / retention : deliveredMwh;
  return {
    ...legs,
    retention_factor: Number(retention.toFixed(6)),
    injected_mwh: Number(injected.toFixed(4)),
    loss_mwh: Number((injected - deliveredMwh).toFixed(4)),
  };
}

/**
 * The full settlement position for a transaction over a supply period: energy
 * delivered, energy that had to be injected to deliver it, and the money each
 * side owes at the contracted purchase / sale / margin rates.
 */
export function computeBilateralSettlement({ transaction_id, from = null, to = null } = {}) {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(transaction_id);
  if (!tx) throw new Error('Bilateral transaction not found');

  const energy = summariseSchedules(tx.id, from, to);
  const losses = grossUpForLosses(energy.delivered_mwh, tx);

  // The contract's rate triangle. sale - purchase = margin holds per unit, so it
  // is made to hold in rupees too: the margin and the sale value are each
  // rounded once and the purchase value is taken as the difference.
  const saleRate = num(tx.sale_rate_per_unit ?? tx.tariff_per_unit);
  const marginRate = num(tx.trading_margin_per_unit);
  const purchaseRate = tx.purchase_rate_per_unit != null
    ? num(tx.purchase_rate_per_unit)
    : Number((saleRate - marginRate).toFixed(4));

  const billableKwh = energy.delivered_mwh * KWH_PER_MWH;
  const saleValue = rupees(billableKwh * saleRate);
  const marginValue = rupees(billableKwh * marginRate);
  const purchaseValue = saleValue - marginValue;

  return {
    transaction_id: tx.id,
    counterparty: tx.counterparty,
    loa_no: tx.loa_no || tx.loi_contract_ref || null,
    oa_type: tx.oa_type,
    requested_from: from,
    requested_to: to,
    energy,
    losses,
    rates: {
      purchase_rate_per_unit: purchaseRate,
      sale_rate_per_unit: saleRate,
      trading_margin_per_unit: marginRate,
    },
    money: {
      // What the buyer is billed for the energy it drew.
      sale_value: saleValue,
      // What SJVN owes the seller for the same quantum.
      purchase_value: purchaseValue,
      // The desk's spread — sale less purchase, by construction.
      trading_margin: marginValue,
      dsm_penalty_amount: energy.dsm_penalty_amount,
    },
  };
}

/** Line-item helper: keeps every bill's breakup the same shape. */
function line(description, basis, quantity, rate, amount) {
  return { description, basis, quantity, rate, amount: rupees(amount) };
}

function energyBillLines(tx, settlement, opts = {}) {
  const lines = [
    line(
      'Energy charges',
      'MWh @ Rs/kWh',
      settlement.energy.delivered_mwh,
      settlement.rates.sale_rate_per_unit,
      settlement.money.sale_value,
    ),
  ];
  if (settlement.money.dsm_penalty_amount) {
    lines.push(line('Deviation (DSM) charges', 'lump sum', null, null, settlement.money.dsm_penalty_amount));
  }
  // The bill screen asks whether to charge LPS on this bill; a surcharge sitting
  // on the contract is not automatically due on every bill raised under it.
  if (opts.include_lps && num(tx.late_payment_surcharge)) {
    lines.push(line('Late payment surcharge', 'lump sum', null, null, num(tx.late_payment_surcharge)));
  }
  if (num(tx.rebate)) {
    lines.push(line('Rebate', 'lump sum', null, null, -num(tx.rebate)));
  }
  return lines;
}

function oaBillLines(tx, settlement, opts) {
  // Open-access charges are levied on the energy that crosses the corridor —
  // the injected quantum, not the smaller quantum that survives the losses.
  const oa = computeOaCharges({
    quantum_mwh: settlement.losses.injected_mwh,
    days: Math.max(1, settlement.energy.days),
    on_date: settlement.energy.period_from || tx.start_date,
    injection_state: opts.injection_state ?? tx.supplier_sldc ?? null,
    drawal_state: opts.drawal_state ?? tx.procurer_sldc ?? null,
    region: opts.region ?? tx.noar_region ?? null,
    ists_rate: opts.ists_rate,
    include_ists: opts.include_ists !== false,
  });

  // The bill goes to one party, so it carries that party's legs. 'ALL' raises a
  // single bill for the whole corridor.
  const bearer = String(opts.bearer || 'BUYER').toUpperCase();
  const items = bearer === 'ALL' ? oa.line_items : oa.line_items.filter((i) => i.bearer === bearer);
  const lines = items.map((i) => line(i.charge, i.basis, i.quantum_mwh ?? i.days ?? 1, i.rate, i.amount));

  // Charges agreed at contract level rather than priced off the rate master.
  if (num(tx.wheeling_charges)) {
    lines.push(line('Wheeling charges (contracted)', 'lump sum', null, null, num(tx.wheeling_charges)));
  }
  if (num(tx.transmission_charges)) {
    lines.push(line('Transmission charges (contracted)', 'lump sum', null, null, num(tx.transmission_charges)));
  }
  return { lines, warnings: oa.warnings, bearer, oa_total: oa.total, by_bearer: oa.by_bearer };
}

function sldcBillLines(tx, settlement, opts) {
  if (opts.amount != null) {
    return { lines: [line('SLDC consent fee', 'lump sum', null, null, num(opts.amount))], warnings: [] };
  }
  const onDate = settlement.energy.period_from || tx.start_date;
  const rate = getEffectiveRate('SLDC Consent Fee', onDate, opts.region ?? tx.noar_region ?? null);
  if (!rate) {
    return {
      lines: [],
      warnings: [`No rate found for 'SLDC Consent Fee' on ${onDate}; pass an explicit amount`],
    };
  }
  return {
    lines: [line('SLDC consent fee', rate.unit || 'flat', 1, rate.rate_value, rate.rate_value)],
    warnings: [],
  };
}

/**
 * Price one of the three bilateral bills off a settlement.
 *
 * Returns the register row's money fields alongside the itemised breakup, so a
 * generated invoice can always be re-read back to the blocks it came from.
 */
export function buildBilateralInvoice({ transaction_id, bill_type, from = null, to = null, options = {} } = {}) {
  if (!BILATERAL_BILL_TYPES.includes(bill_type)) {
    throw new Error(`bill_type must be one of: ${BILATERAL_BILL_TYPES.join(', ')}`);
  }
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(transaction_id);
  if (!tx) throw new Error('Bilateral transaction not found');

  const settlement = computeBilateralSettlement({ transaction_id, from, to });

  let lines = [];
  let warnings = [];
  let extra = {};
  if (bill_type === 'BILATERAL_ENERGY') {
    lines = energyBillLines(tx, settlement, options);
  } else if (bill_type === 'BILATERAL_OA') {
    const built = oaBillLines(tx, settlement, options);
    lines = built.lines;
    warnings = built.warnings;
    extra = { bearer: built.bearer, corridor_total: built.oa_total, by_bearer: built.by_bearer };
  } else {
    const built = sldcBillLines(tx, settlement, options);
    lines = built.lines;
    warnings = built.warnings;
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gstApplicable = Boolean(options.gst_applicable);
  const gst = gstApplicable ? rupees(subtotal * GST_RATE) : 0;
  const invoiceAmount = subtotal + gst;

  const tdsPct = options.tds_rate != null ? num(options.tds_rate) : DEFAULT_TDS_PCT[bill_type];
  // The register states the rate as a percentage, so the deduction divides by 100.
  const tdsDeducted = rupees(invoiceAmount * (tdsPct / 100));

  return {
    transaction_id: tx.id,
    bill_type,
    client_name: options.client_name || tx.procurer_name || tx.counterparty,
    supply_from_date: settlement.energy.period_from,
    supply_to_date: settlement.energy.period_to,
    quantum_mwh: settlement.energy.delivered_mwh,
    rate_per_unit: bill_type === 'BILATERAL_ENERGY' ? settlement.rates.sale_rate_per_unit : null,
    subtotal,
    gst_applicable: gstApplicable,
    gst_amount: gst,
    invoice_amount: invoiceAmount,
    tds_rate: tdsPct,
    tds_deducted: tdsDeducted,
    net_receivable: invoiceAmount - tdsDeducted,
    is_final: settlement.energy.is_final,
    line_items: lines,
    warnings,
    settlement,
    ...extra,
  };
}
