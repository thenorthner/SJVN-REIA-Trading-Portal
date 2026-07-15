import db from './db/index.js';
import { newId } from './util.js';
import { payableNow } from './disputesConstants.js';
import { OPEN_STATUSES as OPEN_DISPUTE_STATUSES } from './disputesConstants.js';
import {
  TOLERANCE_QTY_PCT,
  TOLERANCE_AMOUNT,
  AVAILABILITY_THRESHOLD,
  PATTERN_LOOKBACK_MONTHS,
  PATTERN_EXCEPTION_THRESHOLD,
  classifyVariance,
  prevPeriod,
  genReconNo,
} from './reconciliationConstants.js';

function makeItem(partial) {
  return {
    id: newId('RCI'),
    label: partial.label || partial.item_type,
    metered_value: partial.metered_value ?? null,
    billed_value: partial.billed_value ?? null,
    paid_value: partial.paid_value ?? null,
    sap_reference_amount: partial.sap_reference_amount ?? null,
    variance: partial.variance ?? 0,
    variance_pct: partial.variance_pct ?? null,
    unit: partial.unit || 'INR',
    match_status: partial.match_status || 'EXCEPTION',
    pattern_flag: partial.pattern_flag ? 1 : 0,
    dispute_id: partial.dispute_id ?? null,
    invoice_id: partial.invoice_id ?? null,
    override_reason: null,
    notes: partial.notes ?? null,
    item_type: partial.item_type,
  };
}

function classifyAmount(billed, paidOrOther, unit = 'INR') {
  const variance = (billed || 0) - (paidOrOther || 0);
  const cls = classifyVariance(variance, billed, { unit });
  return { variance, ...cls };
}

function classifyQty(metered, billed) {
  const variance = (metered || 0) - (billed || 0);
  const cls = classifyVariance(variance, metered || billed, { unit: 'MWh' });
  return { variance, ...cls };
}

function checkPatternFlag(contractId, tradingClientId, itemType) {
  const rows = db.prepare(`
    SELECT ri.match_status FROM recon_items ri
    JOIN reconciliations r ON r.id = ri.reconciliation_id
    WHERE ri.item_type = ?
      AND ri.match_status = 'EXCEPTION'
      AND (
        (r.contract_id IS NOT NULL AND r.contract_id = ?)
        OR (r.trading_client_id IS NOT NULL AND r.trading_client_id = ?)
      )
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(itemType, contractId || '', tradingClientId || '', PATTERN_LOOKBACK_MONTHS);
  return rows.length >= PATTERN_EXCEPTION_THRESHOLD;
}

function getEnergyForPeriod(contractId, period) {
  return db.prepare(`
    SELECT * FROM energy_data
    WHERE contract_id = ? AND period_month = ?
    ORDER BY (data_type = 'FINAL') DESC, (status = 'LOCKED') DESC, created_at DESC
    LIMIT 1
  `).get(contractId, period);
}

function getInvoicesForPeriod(contractId, period) {
  return db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND status != 'CANCELLED'
    ORDER BY created_at DESC
  `).all(contractId, period);
}

function paymentsSum(invoiceIds) {
  if (!invoiceIds.length) return 0;
  const ph = invoiceIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id IN (${ph})
  `).get(...invoiceIds).s;
}

function openDisputesForPeriod(contractId, period) {
  return db.prepare(`
    SELECT d.* FROM disputes d
    JOIN invoices i ON i.id = d.invoice_id
    WHERE i.contract_id = ? AND i.billing_period = ?
      AND d.status IN (${OPEN_DISPUTE_STATUSES.map(() => '?').join(',')})
  `).all(contractId, period, ...OPEN_DISPUTE_STATUSES);
}

function carryForwardItems(contractId, period, periodType) {
  const prev = prevPeriod(period, periodType);
  const prior = db.prepare(`
    SELECT * FROM reconciliations
    WHERE contract_id = ? AND period = ? AND period_type = ?
    ORDER BY version DESC LIMIT 1
  `).get(contractId, prev, periodType);
  if (!prior) return { items: [], carriedFromId: null };

  const exceptions = db.prepare(`
    SELECT * FROM recon_items
    WHERE reconciliation_id = ? AND match_status IN ('EXCEPTION','CARRIED')
  `).all(prior.id);

  return {
    carriedFromId: prior.id,
    items: exceptions.map((ex) => makeItem({
      item_type: 'CARRY_FORWARD',
      label: `Carry-forward: ${ex.label || ex.item_type} (${prev})`,
      metered_value: ex.metered_value,
      billed_value: ex.billed_value,
      paid_value: ex.paid_value,
      variance: ex.variance,
      variance_pct: ex.variance_pct,
      unit: ex.unit,
      match_status: 'CARRIED',
      notes: `Unresolved from ${prior.recon_no}`,
      dispute_id: ex.dispute_id,
      invoice_id: ex.invoice_id,
    })),
  };
}

/** Build matching items for a REIA contract period (does not persist). */
export function buildContractReconItems({ contractId, period, periodType = 'MONTHLY', sapOverride = null }) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) throw new Error('Contract not found');

  const energy = getEnergyForPeriod(contractId, period);
  const invoices = getInvoicesForPeriod(contractId, period);
  const primaryInv = invoices[0] || null;
  const invoiceIds = invoices.map((i) => i.id);
  const billedMwh = invoices.reduce((s, i) => s + (i.energy_mwh || 0), 0);
  const billedTotal = invoices.reduce((s, i) => s + (i.total_amount || 0), 0);
  const billedTaxes = invoices.reduce((s, i) => s + (i.taxes || 0), 0);
  const billedPenalty = invoices.reduce((s, i) => s + (i.penalty || 0), 0);
  const paidTotal = paymentsSum(invoiceIds);
  const disputedTotal = invoices.reduce((s, i) => s + (i.disputed_amount || 0), 0);
  const payableAgg = invoices.reduce((s, i) => s + payableNow(i).payable_now, 0);

  const dataBasis = energy?.data_type === 'PROVISIONAL' ? 'PROVISIONAL' : 'FINAL';
  const items = [];

  // 1. Energy three-way (metered vs billed qty)
  const metered = energy?.energy_mwh ?? null;
  const energyCls = classifyQty(metered ?? 0, billedMwh);
  items.push(makeItem({
    item_type: 'ENERGY_THREE_WAY',
    label: 'Energy: Metered vs Billed (MWh)',
    metered_value: metered,
    billed_value: billedMwh,
    paid_value: null,
    unit: 'MWh',
    ...energyCls,
    invoice_id: primaryInv?.id,
    notes: energy ? `Source ${energy.source}, ${energy.data_type}/${energy.status}` : 'No energy data',
    pattern_flag: checkPatternFlag(contractId, null, 'ENERGY_THREE_WAY') && energyCls.match_status === 'EXCEPTION',
  }));

  // 2. Financial three-way (billed vs paid)
  const finCls = classifyAmount(billedTotal, paidTotal);
  items.push(makeItem({
    item_type: 'FINANCIAL_THREE_WAY',
    label: 'Financial: Billed vs Paid (₹)',
    metered_value: null,
    billed_value: billedTotal,
    paid_value: paidTotal,
    unit: 'INR',
    ...finCls,
    invoice_id: primaryInv?.id,
    notes: `Payable now (ex-disputed): ₹${payableAgg.toLocaleString('en-IN')}; disputed ₹${disputedTotal.toLocaleString('en-IN')}`,
    pattern_flag: checkPatternFlag(contractId, null, 'FINANCIAL_THREE_WAY') && finCls.match_status === 'EXCEPTION',
  }));

  // 3. Tax
  const filedTax = billedTaxes; // demo: filed = billed unless mismatch seeded via sapOverride.tax_filed
  const taxFiled = sapOverride?.tax_filed != null ? sapOverride.tax_filed : filedTax;
  const taxCls = classifyAmount(billedTaxes, taxFiled);
  items.push(makeItem({
    item_type: 'TAX',
    label: 'Tax/GST: Billed vs Filed',
    billed_value: billedTaxes,
    paid_value: taxFiled,
    unit: 'INR',
    ...taxCls,
    notes: 'Demo filed amount; live GST portal out of scope',
  }));

  // 4. Performance
  const availability = energy?.availability_percent ?? 100;
  const perfVariance = availability - AVAILABILITY_THRESHOLD;
  const perfOk = availability >= AVAILABILITY_THRESHOLD;
  items.push(makeItem({
    item_type: 'PERFORMANCE',
    label: `Performance: Availability vs ${AVAILABILITY_THRESHOLD}%`,
    metered_value: availability,
    billed_value: AVAILABILITY_THRESHOLD,
    unit: 'PCT',
    variance: perfVariance,
    variance_pct: null,
    match_status: perfOk ? 'EXACT' : 'EXCEPTION',
    notes: `CUF ${energy?.cuf_percent != null ? Number(energy.cuf_percent).toFixed(1) : 'n/a'}%`,
  }));

  // 5. Penalty
  const expectedPenalty = perfOk ? 0 : Math.round(billedTotal * 0.01);
  const penCls = classifyAmount(expectedPenalty, billedPenalty);
  items.push(makeItem({
    item_type: 'PENALTY',
    label: 'Penalty: Expected vs Billed',
    billed_value: billedPenalty,
    paid_value: expectedPenalty,
    unit: 'INR',
    variance: billedPenalty - expectedPenalty,
    ...classifyVariance(billedPenalty - expectedPenalty, expectedPenalty || billedPenalty || 1),
    notes: expectedPenalty ? 'Shortfall penalty expected' : 'No shortfall expected',
  }));

  // 6. Internal SAP
  const sapRef = sapOverride?.sap_amount != null
    ? sapOverride.sap_amount
    : Math.round(billedTotal * (sapOverride?.sap_factor ?? 1));
  const sapCls = classifyAmount(billedTotal, sapRef);
  items.push(makeItem({
    item_type: 'INTERNAL_SAP',
    label: 'Internal: System vs SAP mirror',
    billed_value: billedTotal,
    sap_reference_amount: sapRef,
    paid_value: sapRef,
    unit: 'INR',
    ...sapCls,
    notes: 'Demo SAP mirror — no live connector',
  }));

  // 7. Open disputes as refs
  for (const d of openDisputesForPeriod(contractId, period)) {
    items.push(makeItem({
      item_type: 'DISPUTE_REF',
      label: `Open dispute ${d.dispute_no}`,
      billed_value: d.disputed_amount,
      unit: 'INR',
      variance: d.disputed_amount,
      match_status: 'EXCEPTION',
      dispute_id: d.id,
      invoice_id: d.invoice_id,
      notes: `${d.reason_code} — ${d.status}`,
    }));
  }

  // 8. Carry-forward
  const carry = carryForwardItems(contractId, period, periodType);
  items.push(...carry.items);

  const matched = items.filter((i) => ['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'].includes(i.match_status)).length;
  const exceptions = items.filter((i) => ['EXCEPTION', 'CARRIED'].includes(i.match_status)).length;
  const unreconciled = items
    .filter((i) => ['EXCEPTION', 'CARRIED'].includes(i.match_status))
    .reduce((s, i) => s + Math.abs(i.variance || 0), 0);

  const energyMatch = items.find((i) => i.item_type === 'ENERGY_THREE_WAY')?.match_status !== 'EXCEPTION' ? 1 : 0;
  const paymentMatch = items.find((i) => i.item_type === 'FINANCIAL_THREE_WAY')?.match_status !== 'EXCEPTION' ? 1 : 0;
  const performanceMatch = items.find((i) => i.item_type === 'PERFORMANCE')?.match_status !== 'EXCEPTION' ? 1 : 0;

  let status = exceptions > 0 ? 'NEEDS_REVIEW' : 'AUTO_MATCHED';
  if (exceptions === 0) status = 'PENDING_SIGN_OFF';

  const counterpartyRole = contract.contract_type === 'PPA' ? 'SELLER' : 'BUYER';

  return {
    contract,
    energy,
    invoices,
    dataBasis,
    items,
    metrics: {
      items_total: items.length,
      items_auto_matched: matched,
      items_exception: exceptions,
      auto_match_pct: items.length ? Number(((matched / items.length) * 100).toFixed(2)) : 0,
      unreconciled_amount: unreconciled,
      energy_match: energyMatch,
      payment_match: paymentMatch,
      performance_match: performanceMatch,
    },
    carriedFromId: carry.carriedFromId,
    counterpartyRole,
    status,
  };
}

/** Trading three-way: bid vs cleared vs billed/paid */
export function buildTradingReconItems({ tradingClientId, period }) {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(tradingClientId);
  if (!client) throw new Error('Trading client not found');

  const bids = db.prepare(`
    SELECT * FROM bids WHERE client_id = ? AND substr(bid_date, 1, 7) = ?
  `).all(tradingClientId, period);
  const bidMw = bids.reduce((s, b) => s + (b.quantum_mw || 0), 0);
  const clearedMw = bids.reduce((s, b) => s + (b.cleared_quantum_mw || 0), 0);

  const invoices = db.prepare(`
    SELECT * FROM trading_invoices WHERE client_id = ? AND billing_period = ?
  `).all(tradingClientId, period);
  const billed = invoices.reduce((s, i) => s + (i.total_amount || 0), 0);
  const invIds = invoices.map((i) => i.id);
  let paid = 0;
  if (invIds.length) {
    const ph = invIds.map(() => '?').join(',');
    paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM trading_payments WHERE trading_invoice_id IN (${ph})`).get(...invIds).s;
  }

  const items = [];
  const clearCls = classifyQty(bidMw, clearedMw);
  items.push(makeItem({
    item_type: 'TRADING_BID_CLEAR_BILL',
    label: 'Trading: Bid vs Cleared (MW)',
    metered_value: bidMw,
    billed_value: clearedMw,
    unit: 'MWh',
    ...clearCls,
    notes: `${bids.length} bid(s)`,
  }));

  const finCls = classifyAmount(billed, paid);
  items.push(makeItem({
    item_type: 'FINANCIAL_THREE_WAY',
    label: 'Trading: Billed vs Paid',
    billed_value: billed,
    paid_value: paid,
    unit: 'INR',
    ...finCls,
  }));

  const sapRef = Math.round(billed);
  const sapCls = classifyAmount(billed, sapRef);
  items.push(makeItem({
    item_type: 'INTERNAL_SAP',
    label: 'Trading system vs SAP mirror',
    billed_value: billed,
    sap_reference_amount: sapRef,
    paid_value: sapRef,
    ...sapCls,
  }));

  const matched = items.filter((i) => ['EXACT', 'AUTO_MATCHED'].includes(i.match_status)).length;
  const exceptions = items.filter((i) => i.match_status === 'EXCEPTION').length;

  return {
    client,
    items,
    dataBasis: 'FINAL',
    metrics: {
      items_total: items.length,
      items_auto_matched: matched,
      items_exception: exceptions,
      auto_match_pct: items.length ? Number(((matched / items.length) * 100).toFixed(2)) : 0,
      unreconciled_amount: items.filter((i) => i.match_status === 'EXCEPTION').reduce((s, i) => s + Math.abs(i.variance || 0), 0),
      energy_match: clearCls.match_status !== 'EXCEPTION' ? 1 : 0,
      payment_match: finCls.match_status !== 'EXCEPTION' ? 1 : 0,
      performance_match: 1,
    },
    carriedFromId: null,
    counterpartyRole: 'TRADING_CLIENT',
    status: exceptions > 0 ? 'NEEDS_REVIEW' : 'PENDING_SIGN_OFF',
  };
}

export function buildStatement(recon, items, extras = {}) {
  return {
    recon_no: recon.recon_no,
    version: recon.version,
    scope: recon.scope,
    period_type: recon.period_type,
    period: recon.period,
    data_basis: recon.data_basis,
    status: recon.status,
    generated_at: new Date().toISOString(),
    metrics: {
      auto_match_pct: recon.auto_match_pct,
      items_total: recon.items_total,
      items_exception: recon.items_exception,
      unreconciled_amount: recon.unreconciled_amount,
      energy_match: !!recon.energy_match,
      payment_match: !!recon.payment_match,
      performance_match: !!recon.performance_match,
    },
    items: items.map((i) => ({
      type: i.item_type,
      label: i.label,
      metered: i.metered_value,
      billed: i.billed_value,
      paid: i.paid_value,
      sap: i.sap_reference_amount,
      variance: i.variance,
      status: i.match_status,
      pattern_flag: !!i.pattern_flag,
      notes: i.notes,
    })),
    discrepancies: items.filter((i) => ['EXCEPTION', 'CARRIED'].includes(i.match_status)),
    sign_off: {
      sjvn: recon.sjvn_ack_at ? { at: recon.sjvn_ack_at, by: recon.sjvn_ack_by } : null,
      counterparty: recon.counterparty_ack_at ? { at: recon.counterparty_ack_at, by: recon.counterparty_ack_by, role: recon.counterparty_role } : null,
    },
    ...extras,
  };
}

export { genReconNo, TOLERANCE_QTY_PCT, TOLERANCE_AMOUNT };
