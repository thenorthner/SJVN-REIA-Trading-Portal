import db from '../db/index.js';
import { computeOaCharges } from './oaCharges.js';
import { getEffectiveRate } from './rateMaster.js';
import { rateSegments, splitSets, sharesOn } from './bilateralRevisions.js';

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

function scheduleRows(transactionId, from, to) {
  let sql = `SELECT * FROM bilateral_schedules
    WHERE transaction_id = ? AND status != 'CANCELLED'`;
  const params = [transactionId];
  if (from) { sql += ' AND schedule_date >= ?'; params.push(from); }
  if (to) { sql += ' AND schedule_date <= ?'; params.push(to); }
  sql += ' ORDER BY schedule_date, time_block';
  return db.prepare(sql).all(...params);
}

/**
 * The blocks gathered into days. A rate revision and a buyer split both change
 * on a date, so a day is the smallest thing either needs to divide.
 */
function dayBuckets(rows) {
  const days = new Map();
  for (const r of rows) {
    if (!days.has(r.schedule_date)) {
      days.set(r.schedule_date, {
        date: r.schedule_date, blocks: 0, metered_blocks: 0, unpriced_deviation_blocks: 0,
        scheduled_mwh: 0, curtailed_mwh: 0, delivered_mwh: 0, dsm_penalty: 0,
      });
    }
    const d = days.get(r.schedule_date);
    const curtailed = Math.max(0, num(r.curtailed_mw));
    const scheduled = Math.max(0, num(r.approved_mw) - curtailed);
    const metered = r.actual_mw != null;
    d.blocks += 1;
    if (metered) d.metered_blocks += 1;
    const delivered = metered ? Math.max(0, num(r.actual_mw)) : scheduled;
    d.scheduled_mwh += scheduled * BLOCK_HOURS;
    d.curtailed_mwh += curtailed * BLOCK_HOURS;
    d.delivered_mwh += delivered * BLOCK_HOURS;
    d.dsm_penalty += num(r.dsm_penalty_amount);
    // A block that deviated but could not be priced off the DSM slab master —
    // no frequency recorded, no slab for that band, or a slab still carrying no
    // notified rate. Counted so a bill can say so rather than imply zero.
    if (r.dsm_basis && r.dsm_basis !== 'CERC_SLAB' && r.dsm_basis !== 'NO_DEVIATION') {
      d.unpriced_deviation_blocks += 1;
    }
  }
  return [...days.values()];
}

/**
 * Energy over a set of days, each counted at a factor — 1 for the whole
 * transaction, a buyer's share for that buyer's part of it. Block counts and
 * finality belong to the transaction's schedule, not to a share of it.
 */
function energyOver(days, factorOf = () => 1, from = null, to = null) {
  let scheduled = 0; let curtailed = 0; let delivered = 0; let dsm = 0;
  let blocks = 0; let metered = 0; let unpriced = 0;
  const dates = [];
  for (const d of days) {
    blocks += d.blocks;
    metered += d.metered_blocks;
    unpriced += d.unpriced_deviation_blocks;
    const f = factorOf(d.date);
    if (!f) continue;
    dates.push(d.date);
    scheduled += d.scheduled_mwh * f;
    curtailed += d.curtailed_mwh * f;
    delivered += d.delivered_mwh * f;
    dsm += d.dsm_penalty * f;
  }
  return {
    blocks,
    metered_blocks: metered,
    // A bill is final only once every block in the period has metered data.
    is_final: blocks > 0 && metered === blocks,
    days: dates.length,
    period_from: dates[0] || from || null,
    period_to: dates[dates.length - 1] || to || null,
    scheduled_mwh: Number(scheduled.toFixed(4)),
    curtailed_mwh: Number(curtailed.toFixed(4)),
    delivered_mwh: Number(delivered.toFixed(4)),
    deviation_mwh: Number((delivered - scheduled).toFixed(4)),
    dsm_penalty_amount: rupees(dsm),
    unpriced_deviation_blocks: unpriced,
  };
}

/**
 * Aggregate the schedule blocks of a transaction over a supply period.
 *
 * A block's scheduled energy is what survived curtailment; its delivered energy
 * is the metered actual where one was recorded, and the schedule itself where
 * the meter has not reported yet. Reporting both, plus how many blocks are
 * actually metered, keeps a provisional bill distinguishable from a final one.
 */
export function summariseSchedules(transactionId, from = null, to = null) {
  return energyOver(dayBuckets(scheduleRows(transactionId, from, to)), () => 1, from, to);
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
 *
 * Where the rates were revised within the period, each stretch is priced at its
 * own rates and the stretches are added up. Where the power is split between
 * buyers, `buyer` settles that buyer's share of each day; without it the whole
 * transaction is settled and each buyer's part is listed beside it.
 */
export function computeBilateralSettlement({ transaction_id, from = null, to = null, buyer = null } = {}) {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(transaction_id);
  if (!tx) throw new Error('Bilateral transaction not found');

  const days = dayBuckets(scheduleRows(tx.id, from, to));
  const sets = splitSets(tx.id);
  // Before the first split, and on a transaction never split, the power is the
  // transaction's own buyer's.
  const ownBuyer = {
    buyer_name: tx.procurer_name || tx.counterparty,
    client_id: tx.client_id || null,
    drawal_state: tx.procurer_sldc || null,
    share_percent: 100,
  };
  const buyersOn = (date) => sharesOn(sets, date) || [ownBuyer];
  const isSplit = days.some((d) => sharesOn(sets, d.date));

  const buyers = new Map();
  for (const d of days) for (const b of buyersOn(d.date)) if (!buyers.has(b.buyer_name)) buyers.set(b.buyer_name, b);
  if (buyer) {
    if (!isSplit && buyer !== ownBuyer.buyer_name) {
      throw new Error(`This transaction is not split between buyers; it is billed to ${ownBuyer.buyer_name}`);
    }
    if (isSplit && !buyers.has(buyer)) {
      throw new Error(`${buyer} holds no share of this transaction in the period — its buyers are ${[...buyers.keys()].join(', ')}`);
    }
  }
  const shareOf = (name) => (date) => (buyersOn(date).find((b) => b.buyer_name === name)?.share_percent || 0) / 100;
  const factor = isSplit && buyer ? shareOf(buyer) : () => 1;

  const energy = energyOver(days, factor, from, to);
  const losses = grossUpForLosses(energy.delivered_mwh, tx);

  // Each stretch at its own rates. The contract's rate triangle holds per unit,
  // sale - purchase = margin, and is made to hold in rupees too: the margin and
  // the sale value are each rounded once and the purchase value is the difference.
  const segments = rateSegments(tx, from || energy.period_from || tx.start_date, to || energy.period_to || tx.end_date);
  const priceSegment = (seg, dayFactor) => {
    const mwh = days.filter((d) => d.date >= seg.from && d.date <= seg.to)
      .reduce((a, d) => a + d.delivered_mwh * dayFactor(d.date), 0);
    const kwh = mwh * KWH_PER_MWH;
    const saleValue = rupees(kwh * seg.sale_rate_per_unit);
    const marginValue = rupees(kwh * seg.trading_margin_per_unit);
    return { mwh: Number(mwh.toFixed(4)), kwh, sale_value: saleValue, trading_margin: marginValue, purchase_value: saleValue - marginValue };
  };
  // A stretch with no scheduled day in the period has nothing to price; the
  // first is kept regardless, so a period with no blocks still shows its rates.
  const priced = segments
    .map((seg) => ({ seg, p: priceSegment(seg, factor) }))
    .filter(({ seg }, i) => i === 0 || days.some((d) => d.date >= seg.from && d.date <= seg.to));

  const sum = (k) => priced.reduce((a, x) => a + x.p[k], 0);
  const totalKwh = sum('kwh');
  const single = priced.length === 1;
  const weighted = (k) => (totalKwh ? Number((priced.reduce((a, x) => a + x.p.kwh * x.seg[k], 0) / totalKwh).toFixed(4)) : priced[0].seg[k]);

  let split = null;
  if (isSplit) {
    const whole = energyOver(days, () => 1).delivered_mwh;
    split = {
      buyers: [...buyers.values()].map((b) => {
        const f = shareOf(b.buyer_name);
        const mwh = energyOver(days, f).delivered_mwh;
        return {
          buyer_name: b.buyer_name,
          client_id: b.client_id,
          drawal_state: b.drawal_state,
          delivered_mwh: mwh,
          sale_value: priced.reduce((a, x) => a + priceSegment(x.seg, f).sale_value, 0),
          share_of_energy_percent: whole ? Number(((mwh / whole) * 100).toFixed(4)) : null,
        };
      }),
      sets: sets.map((set, i) => ({
        ...set,
        applies_to: sets[i + 1] ? sets[i + 1].effective_from : null,
      })),
    };
  }

  return {
    transaction_id: tx.id,
    counterparty: tx.counterparty,
    loa_no: tx.loa_no || tx.loi_contract_ref || null,
    oa_type: tx.oa_type,
    requested_from: from,
    requested_to: to,
    buyer: isSplit ? (buyer || null) : null,
    energy,
    losses,
    rates: {
      purchase_rate_per_unit: single ? priced[0].seg.purchase_rate_per_unit : weighted('purchase_rate_per_unit'),
      sale_rate_per_unit: single ? priced[0].seg.sale_rate_per_unit : weighted('sale_rate_per_unit'),
      trading_margin_per_unit: single ? priced[0].seg.trading_margin_per_unit : weighted('trading_margin_per_unit'),
      // Weighted by the energy delivered at each rate: the single figure the
      // register has room for. The segments are what was actually charged.
      is_average: !single,
    },
    rate_segments: priced.map(({ seg, p }) => ({
      from: seg.from,
      to: seg.to,
      source: seg.source,
      revision_id: seg.revision_id,
      reason: seg.reason,
      sale_rate_per_unit: seg.sale_rate_per_unit,
      purchase_rate_per_unit: seg.purchase_rate_per_unit,
      trading_margin_per_unit: seg.trading_margin_per_unit,
      delivered_mwh: p.mwh,
      sale_value: p.sale_value,
      purchase_value: p.purchase_value,
      trading_margin: p.trading_margin,
    })),
    money: {
      // What the buyer is billed for the energy it drew.
      sale_value: sum('sale_value'),
      // What SJVN owes the seller for the same quantum.
      purchase_value: sum('purchase_value'),
      // The desk's spread — sale less purchase, by construction.
      trading_margin: sum('trading_margin'),
      dsm_penalty_amount: energy.dsm_penalty_amount,
    },
    split,
  };
}

/** Line-item helper: keeps every bill's breakup the same shape. */
function line(description, basis, quantity, rate, amount) {
  return { description, basis, quantity, rate, amount: rupees(amount) };
}

/**
 * A buyer's part of a lump sum agreed for the whole transaction — LPS, a rebate,
 * contracted wheeling — in proportion to the energy it took in the period.
 */
function lumpShare(settlement, amount) {
  if (!settlement.buyer) return { amount, note: '' };
  const part = settlement.split?.buyers.find((b) => b.buyer_name === settlement.buyer);
  const pct = part?.share_of_energy_percent;
  if (pct == null) return { amount: 0, note: ' (no energy in the period to share it by)' };
  return { amount: amount * (pct / 100), note: ` (${settlement.buyer}'s ${Number(pct.toFixed(2))}% of the period's energy)` };
}

function energyBillLines(tx, settlement, opts = {}) {
  // One line per rate the energy was charged at: a bill spanning a revision
  // shows both rates, not a blended one.
  const lines = settlement.rate_segments.length > 1
    ? settlement.rate_segments.map((seg) => line(
      `Energy charges, ${seg.from} to ${seg.to}`,
      'MWh @ Rs/kWh',
      seg.delivered_mwh,
      seg.sale_rate_per_unit,
      seg.sale_value,
    ))
    : [line(
      'Energy charges',
      'MWh @ Rs/kWh',
      settlement.energy.delivered_mwh,
      settlement.rates.sale_rate_per_unit,
      settlement.money.sale_value,
    )];
  if (settlement.money.dsm_penalty_amount) {
    lines.push(line('Deviation (DSM) charges', 'lump sum', null, null, settlement.money.dsm_penalty_amount));
  }
  // The bill screen asks whether to charge LPS on this bill; a surcharge sitting
  // on the contract is not automatically due on every bill raised under it.
  if (opts.include_lps && num(tx.late_payment_surcharge)) {
    const share = lumpShare(settlement, num(tx.late_payment_surcharge));
    lines.push(line(`Late payment surcharge${share.note}`, 'lump sum', null, null, share.amount));
  }
  if (num(tx.rebate)) {
    const share = lumpShare(settlement, num(tx.rebate));
    lines.push(line(`Rebate${share.note}`, 'lump sum', null, null, -share.amount));
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
    // A buyer in a split draws in its own state.
    drawal_state: opts.drawal_state
      ?? settlement.split?.buyers.find((b) => b.buyer_name === settlement.buyer)?.drawal_state
      ?? tx.procurer_sldc ?? null,
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
    const share = lumpShare(settlement, num(tx.wheeling_charges));
    lines.push(line(`Wheeling charges (contracted)${share.note}`, 'lump sum', null, null, share.amount));
  }
  if (num(tx.transmission_charges)) {
    const share = lumpShare(settlement, num(tx.transmission_charges));
    lines.push(line(`Transmission charges (contracted)${share.note}`, 'lump sum', null, null, share.amount));
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

  const settlement = computeBilateralSettlement({ transaction_id, from, to, buyer: options.buyer || null });

  // Energy and open access are each buyer's own bill once the power is split;
  // a bill for the whole of a split transaction would bill every buyer's share
  // to one of them.
  if (settlement.split && !settlement.buyer && bill_type !== 'BILATERAL_SLDC') {
    throw new Error(`This transaction's power is split between ${settlement.split.buyers.map((b) => b.buyer_name).join(', ')} in this period; say which buyer the bill is for`);
  }

  let lines = [];
  let warnings = [];
  let extra = {};
  if (bill_type === 'BILATERAL_ENERGY') {
    lines = energyBillLines(tx, settlement, options);
    if (settlement.energy.unpriced_deviation_blocks) {
      warnings = [`${settlement.energy.unpriced_deviation_blocks} block(s) deviated but carry no DSM slab price — the deviation charge on this bill excludes them`];
    }
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

  if (bill_type === 'BILATERAL_ENERGY' && settlement.rates.is_average) {
    warnings = [...warnings, `The rate was revised within the period: the bill charges ${settlement.rate_segments.length} rates line by line, and the register's single rate is their average weighted by energy`];
  }

  return {
    transaction_id: tx.id,
    bill_type,
    buyer: settlement.buyer,
    client_name: options.client_name || settlement.buyer || tx.procurer_name || tx.counterparty,
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
