import db from './db/index.js';
import { newId, billableCapacityMw } from './util.js';
import { sourcesForPsa } from './services/allocations.js';
import { cufYearPosition } from './services/cufPenalty.js';
import { supersededByDeveloperSql } from './services/outstanding.js';
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
  summariseItems,
  NOT_CONNECTED,
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

// The month's standing figure: the locked one, final before provisional. A
// FINAL draft used to win over the locked provisional figure the bill was raised on.
const pickEnergy = (contractId, period) => db.prepare(`
  SELECT * FROM energy_data
  WHERE contract_id = ? AND period_month = ? AND status <> 'DRAFT'
  ORDER BY (status = 'LOCKED') DESC, (data_type = 'FINAL') DESC, created_at DESC
  LIMIT 1
`).get(contractId, period);

function getEnergyForPeriod(contract, period) {
  const own = pickEnergy(contract.id, period);
  if (own || contract.contract_type !== 'PSA') return own;
  // A PSA's energy is recorded on the PPAs that feed it: its share of each.
  // Read off the PSA's own (empty) rows, every PSA statement opened with an
  // energy exception.
  const sources = sourcesForPsa(contract.id, period);
  if (!sources.length) return null;
  let mwh = 0;
  let allLocked = true;
  // Final only when every source PPA's figure is final; one provisional
  // source makes the PSA's share provisional too.
  let allFinal = true;
  const parts = [];
  for (const src of sources) {
    const e = pickEnergy(src.ppa_id, period);
    if (!e) return { energy_mwh: null, source: 'source PPAs', data_type: 'PROVISIONAL', status: 'MISSING', missing: src.ppa_contract_no };
    if (e.status !== 'LOCKED') allLocked = false;
    if (e.data_type !== 'FINAL') allFinal = false;
    mwh += (Number(e.energy_mwh) || 0) * (Number(src.allocation_percent) || 0) / 100;
    parts.push(`${src.ppa_contract_no} ${src.allocation_percent}%`);
  }
  return { energy_mwh: Math.round(mwh * 1000) / 1000, source: parts.join(' + '), data_type: allFinal ? 'FINAL' : 'PROVISIONAL', status: allLocked ? 'LOCKED' : 'VALIDATED', availability_percent: null, cuf_percent: null, derived: true };
}

// A bill is "billed" once presented — not a draft, one in approval or one
// rejected — and SJVN's computed bill of a month stops counting once the
// developer's own invoice for it is approved. Both were added, so Sunrise's
// October reconciled 16,368 MWh billed against 8,184 metered. DSM bills settle
// with the pool, not with this counterparty.
function getInvoicesForPeriod(contractId, period) {
  return db.prepare(`
    SELECT * FROM invoices i
    WHERE i.contract_id = ? AND i.billing_period = ?
      AND i.status IN ('APPROVED','SENT','PARTIALLY_PAID','DISPUTED','PAID')
      AND i.invoice_no NOT LIKE 'DSM-%'
      AND ${supersededByDeveloperSql('i')}
    ORDER BY i.created_at DESC
  `).all(contractId, period);
}

function paymentsSum(invoiceIds) {
  if (!invoiceIds.length) return 0;
  const ph = invoiceIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id IN (${ph})
  `).get(...invoiceIds).s;
}

/**
 * What "paid" is made of: money received, what the payer kept back (TDS and
 * other deductions), and credit notes set against the bills. A credit note
 * settles a bill without any money changing hands, so a statement that counts
 * it as paid says so.
 */
function paidMakeUp(invoiceIds) {
  if (!invoiceIds.length) return { cash: 0, withheld: 0, credit: 0, notes: [] };
  const ph = invoiceIds.map(() => '?').join(',');
  const r = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN mode = 'CREDIT_NOTE' THEN 0 ELSE amount END), 0) cash,
      COALESCE(SUM(CASE WHEN mode = 'CREDIT_NOTE' THEN 0 ELSE COALESCE(deduction, 0) END), 0) withheld,
      COALESCE(SUM(CASE WHEN mode = 'CREDIT_NOTE' THEN amount + COALESCE(deduction, 0) ELSE 0 END), 0) credit
    FROM payments WHERE invoice_id IN (${ph})
  `).get(...invoiceIds);
  const notes = db.prepare(`SELECT DISTINCT reference FROM payments WHERE mode = 'CREDIT_NOTE' AND invoice_id IN (${ph}) AND reference IS NOT NULL`)
    .all(...invoiceIds).map((n) => n.reference);
  return { ...r, notes };
}

const inr = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
function paidWords({ cash, withheld, credit, notes }) {
  if (!credit && !withheld) return '';
  const parts = [`received ${inr(cash)}`];
  if (withheld) parts.push(`${inr(withheld)} TDS/deductions`);
  if (credit) parts.push(`${inr(credit)} by credit note${notes.length ? ` ${notes.join(', ')}` : ''}`);
  return `Paid = ${parts.join(' + ')}; `;
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

/** What still stands between a month and its reconciliation (R1). */
function monthGapsForRecon(energy, invoices) {
  const missing = [];
  if (!energy || energy.energy_mwh == null) missing.push(`no energy recorded${energy?.missing ? ` on ${energy.missing}` : ''}`);
  else if (energy.status !== 'LOCKED') missing.push('the energy is not locked');
  if (!invoices.length) missing.push('no bill has been presented');
  return missing;
}

/** Whether a contract's month can be reconciled, and what it waits on. */
export function reconReadiness(contractId, period) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) return { ready: false, missing: ['contract not found'] };
  const missing = monthGapsForRecon(getEnergyForPeriod(contract, period), getInvoicesForPeriod(contractId, period));
  return { ready: !missing.length, missing };
}

/** Build matching items for a REIA contract period (does not persist). */
export function buildContractReconItems({ contractId, period, periodType = 'MONTHLY', sapOverride = null }) {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!contract) throw new Error('Contract not found');

  const energy = getEnergyForPeriod(contract, period);
  const invoices = getInvoicesForPeriod(contractId, period);
  // Nothing to reconcile is not a match. A month with no energy and no bill —
  // including one not yet over — came out 100 % matched and was sent to the
  // counterparty to sign.
  // A PSA whose source PPA has no energy comes back as a "missing" marker,
  // which is no energy either: the three Adani-fed PSAs got a statement for a
  // September with nothing in it (17-Oct-2026).
  if ((!energy || energy.energy_mwh == null) && !invoices.length) {
    throw Object.assign(new Error(`Nothing to reconcile for ${contract.contract_no} in ${period}: no energy is recorded and no bill has been presented.`), { status: 400 });
  }
  // R1 (17-Oct-2026): a month is reconciled once it is closed on both sides —
  // its energy locked and its bill presented. A statement on half a month
  // asked the counterparty to sign figures that were still moving.
  if (periodType === 'MONTHLY') {
    const missing = monthGapsForRecon(energy, invoices);
    if (missing.length) {
      throw Object.assign(new Error(`${contract.contract_no} ${period} is not ready to reconcile: ${missing.join('; ')}.`), { status: 400, reason: 'NOT_READY', missing });
    }
  }
  const primaryInv = invoices[0] || null;
  const invoiceIds = invoices.map((i) => i.id);
  // Banked energy is billed on its own bills (BNK-…) when drawn or when it
  // lapses, in a later month; the month's bill leaves it out. So the energy
  // line compares the month's bill with the energy less what was banked from
  // it, and leaves those bills out of the quantity.
  const billedMwh = invoices.filter((i) => !String(i.invoice_no || '').startsWith('BNK-'))
    .reduce((s, i) => s + (i.energy_mwh || 0), 0);
  const billedTotal = invoices.reduce((s, i) => s + (i.total_amount || 0), 0);
  const billedTaxes = invoices.reduce((s, i) => s + (i.taxes || 0), 0);
  const billedPenalty = invoices.reduce((s, i) => s + (i.penalty || 0), 0);
  const paidTotal = paymentsSum(invoiceIds);
  const disputedTotal = invoices.reduce((s, i) => s + (i.disputed_amount || 0), 0);
  const payableAgg = invoices.reduce((s, i) => s + payableNow(i).payable_now, 0);

  const dataBasis = energy?.data_type === 'PROVISIONAL' ? 'PROVISIONAL' : 'FINAL';
  const items = [];

  // 1. Energy three-way (metered vs billed qty)
  const bankedFrom = (ppaId) => Number(db.prepare('SELECT COALESCE(SUM(banked_mwh), 0) s FROM energy_banking WHERE contract_id = ? AND period_month = ?').get(ppaId, period).s) || 0;
  const banked = contract.contract_type === 'PSA'
    ? sourcesForPsa(contract.id, period).reduce((t, src) => t + bankedFrom(src.ppa_id) * (Number(src.allocation_percent) || 0) / 100, 0)
    : bankedFrom(contract.id);
  const metered = energy?.energy_mwh == null ? null : Math.round((energy.energy_mwh - banked) * 1000) / 1000;
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
    notes: energy?.missing ? `No energy recorded on ${energy.missing}` : energy ? `Source ${energy.source}, ${energy.data_type}/${energy.status}${banked ? `; ${Math.round(banked * 1000) / 1000} MWh banked, billed when drawn or settled` : ''}` : 'No energy data',
    pattern_flag: checkPatternFlag(contractId, null, 'ENERGY_THREE_WAY') && energyCls.match_status === 'EXCEPTION',
  }));

  // 2. Financial three-way (billed vs paid). What was due is the bill less the
  // early-payment rebate allowed on it, plus surcharge charged: a bill settled
  // in full with a rebate showed the rebate as an unexplained gap for ever
  // (17-Oct-2026 golden run: Sunrise September).
  const rebateTotal = invoices.reduce((s, i) => s + (Number(i.rebate) || 0), 0);
  const lpsBilled = invoices.reduce((s, i) => s + (Number(i.lps) || 0), 0);
  const dueTotal = Math.round((billedTotal - rebateTotal + lpsBilled) * 100) / 100;
  // A bill not yet due is not an exception for being unpaid (decided
  // 17-Oct-2026): what is still unpaid on bills whose due date has not come is
  // left out of the comparison, and said so.
  const todayIso = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const notYetDue = invoices.reduce((s, i) => {
    if (!i.due_date || String(i.due_date).slice(0, 10) < todayIso) return s;
    const due = (Number(i.total_amount) || 0) - (Number(i.rebate) || 0) + (Number(i.lps) || 0);
    return s + Math.max(0, due - paymentsSum([i.id]));
  }, 0);
  const finCls = classifyAmount(Math.round((dueTotal - notYetDue) * 100) / 100, paidTotal);
  items.push(makeItem({
    item_type: 'FINANCIAL_THREE_WAY',
    label: 'Financial: Billed vs Paid (₹)',
    metered_value: null,
    billed_value: billedTotal,
    paid_value: paidTotal,
    unit: 'INR',
    ...finCls,
    invoice_id: primaryInv?.id,
    notes: `${paidWords(paidMakeUp(invoiceIds))}${notYetDue > 0 ? `₹${Math.round(notYetDue).toLocaleString('en-IN')} not yet due, left out; ` : ''}Due ₹${dueTotal.toLocaleString('en-IN')}${rebateTotal ? ` (after ₹${Math.round(rebateTotal).toLocaleString('en-IN')} rebate)` : ''}${lpsBilled ? ` incl. ₹${Math.round(lpsBilled).toLocaleString('en-IN')} surcharge` : ''}; payable now (ex-disputed): ₹${payableAgg.toLocaleString('en-IN')}; disputed ₹${disputedTotal.toLocaleString('en-IN')}`,
    pattern_flag: checkPatternFlag(contractId, null, 'FINANCIAL_THREE_WAY') && finCls.match_status === 'EXCEPTION',
  }));

  // 3. Tax. There is no GST connector, so unless a filed figure is supplied the
  //    line has nothing to compare against. It used to default to the billed
  //    amount and compare it with itself, which reported an exact match every
  //    run; now it says it could not be checked.
  const taxFiled = sapOverride?.tax_filed != null ? Number(sapOverride.tax_filed) : null;
  items.push(makeItem(taxFiled == null
    ? {
      item_type: 'TAX',
      label: 'Tax/GST: Billed vs Filed',
      billed_value: billedTaxes,
      paid_value: null,
      unit: 'INR',
      variance: 0,
      variance_pct: null,
      match_status: NOT_CONNECTED,
      notes: 'No GST portal connector — the filed figure has to be supplied to check this',
    }
    : {
      item_type: 'TAX',
      label: 'Tax/GST: Billed vs Filed',
      billed_value: billedTaxes,
      paid_value: taxFiled,
      unit: 'INR',
      ...classifyAmount(billedTaxes, taxFiled),
      notes: 'Filed figure supplied with the run',
    }));

  // 4. Performance. With no availability on record there is nothing to judge;
  // it used to be taken as 100 % and reported as met.
  const availability = energy?.availability_percent;
  if (availability == null) {
    items.push(makeItem({
      item_type: 'PERFORMANCE', label: `Performance: Availability vs ${AVAILABILITY_THRESHOLD}%`, metered_value: null, billed_value: AVAILABILITY_THRESHOLD,
      unit: 'PCT', variance: 0, variance_pct: null, match_status: NOT_CONNECTED, notes: 'No availability recorded for the month — nothing to check',
    }));
  } else {
    const perfOk = availability >= AVAILABILITY_THRESHOLD;
    items.push(makeItem({
      item_type: 'PERFORMANCE',
      label: `Performance: Availability vs ${AVAILABILITY_THRESHOLD}%`,
      metered_value: availability,
      billed_value: AVAILABILITY_THRESHOLD,
      unit: 'PCT',
      variance: availability - AVAILABILITY_THRESHOLD,
      variance_pct: null,
      match_status: perfOk ? 'EXACT' : 'EXCEPTION',
      notes: `CUF ${energy?.cuf_percent != null ? Number(energy.cuf_percent).toFixed(1) : 'n/a'}%`,
    }));
  }

  // 5. Penalty, worked out the way billing works it out. CUF is assessed over
  // the contract year and settled by the year-end true-up note, so no monthly
  // bill should carry a CUF deduction: expected is nil, and the year-to-date
  // position is given as the note. (It used to expect the month's own shortfall
  // — and before that 1 % of the bill whenever availability fell below 90 %.)
  const expectedPenalty = 0;
  let penaltyNote = 'No shortfall penalty on this contract';
  if (energy && energy.energy_mwh != null && contract.contract_type === 'PPA') {
    const cuf = cufYearPosition(contract, period, { capacityMw: billableCapacityMw(contract), tariffPerUnit: contract.tariff_per_unit });
    penaltyNote = cuf.applicable ? cuf.label : 'No CUF obligation for this technology';
  }
  items.push(makeItem({
    item_type: 'PENALTY',
    label: 'Penalty: Expected vs Billed',
    billed_value: billedPenalty,
    paid_value: expectedPenalty,
    unit: 'INR',
    variance: billedPenalty - expectedPenalty,
    ...classifyVariance(billedPenalty - expectedPenalty, expectedPenalty || billedPenalty || 1),
    notes: penaltyNote,
  }));

  // 6. Internal SAP. Same shape as the tax line: with no finance-system
  //    connector, defaulting the mirror to our own total made the line agree
  //    with itself. A factor of 1 is not a comparison.
  const sapRef = sapOverride?.sap_amount != null
    ? Number(sapOverride.sap_amount)
    : (sapOverride?.sap_factor != null
      ? Math.round(billedTotal * Number(sapOverride.sap_factor))
      : null);
  items.push(makeItem(sapRef == null
    ? {
      item_type: 'INTERNAL_SAP',
      label: 'Internal: System vs SAP mirror',
      billed_value: billedTotal,
      sap_reference_amount: null,
      paid_value: null,
      unit: 'INR',
      variance: 0,
      variance_pct: null,
      match_status: NOT_CONNECTED,
      notes: 'No SAP connector — the mirror figure has to be supplied to check this',
    }
    : {
      item_type: 'INTERNAL_SAP',
      label: 'Internal: System vs SAP mirror',
      billed_value: billedTotal,
      sap_reference_amount: sapRef,
      paid_value: sapRef,
      unit: 'INR',
      ...classifyAmount(billedTotal, sapRef),
      notes: 'SAP mirror figure supplied with the run',
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

  const summary = summariseItems(items);
  const exceptions = summary.exceptions;

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
      items_auto_matched: summary.matched,
      items_exception: summary.exceptions,
      // Lines with nothing to check against are outside the percentage, so a
      // missing connector cannot make the books look more agreed than they are.
      items_not_connected: summary.not_connected,
      auto_match_pct: summary.auto_match_pct,
      unreconciled_amount: summary.unreconciled_amount,
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

  items.push(makeItem({
    item_type: 'INTERNAL_SAP',
    label: 'Trading system vs SAP mirror',
    billed_value: billed,
    sap_reference_amount: null,
    paid_value: null,
    variance: 0,
    variance_pct: null,
    match_status: NOT_CONNECTED,
    notes: 'No SAP connector — nothing to compare the trading total against',
  }));

  const summary = summariseItems(items);
  const exceptions = summary.exceptions;

  return {
    client,
    items,
    dataBasis: 'FINAL',
    metrics: {
      items_total: items.length,
      items_auto_matched: summary.matched,
      items_exception: summary.exceptions,
      items_not_connected: summary.not_connected,
      auto_match_pct: summary.auto_match_pct,
      unreconciled_amount: summary.unreconciled_amount,
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
