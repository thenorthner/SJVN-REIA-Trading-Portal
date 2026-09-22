import { surchargeDays, isWorkingDay, lpsCountsWorkingDaysOnly } from './services/workingCalendar.js';
import { nextSeriesNo } from './util.js';

/** Dispute Management constants & helpers */

export const REASON_CODES = [
  'ENERGY_DATA_MISMATCH',
  'TARIFF_RATE_ERROR',
  'REBATE_ERROR',
  'LPS_PENALTY_ERROR',
  'TRANSMISSION_WHEELING',
  'CUF_PERFORMANCE',
  'TAX_GST_ERROR',
  'CONTRACT_INTERPRETATION',
  'DUPLICATE_BILLING',
  'OTHER',
];

export const REASON_LABELS = {
  ENERGY_DATA_MISMATCH: 'Energy data mismatch (metered vs billed)',
  TARIFF_RATE_ERROR: 'Tariff/rate calculation error',
  REBATE_ERROR: 'Rebate calculation error',
  LPS_PENALTY_ERROR: 'LPS/penalty calculation error',
  TRANSMISSION_WHEELING: 'Transmission/wheeling charge dispute',
  CUF_PERFORMANCE: 'CUF/performance penalty dispute',
  TAX_GST_ERROR: 'Tax/GST calculation error',
  CONTRACT_INTERPRETATION: 'Contract term interpretation dispute',
  DUPLICATE_BILLING: 'Duplicate billing',
  OTHER: 'Other',
};

export const CHARGE_LINES = [
  'energy_charges',
  'transmission_charges',
  'trading_margin',
  'rebate',
  'lps',
  'penalty',
  'taxes',
  'other_adjustments',
];

export const CHARGE_LABELS = {
  energy_charges: 'Energy charges',
  transmission_charges: 'Transmission / wheeling',
  trading_margin: 'Trading margin',
  rebate: 'Rebate',
  lps: 'LPS',
  penalty: 'Penalty (CUF/performance)',
  taxes: 'Tax / GST',
  other_adjustments: 'Other adjustments',
};

export const OPEN_STATUSES = [
  'RAISED',
  'ACKNOWLEDGED',
  'UNDER_REVIEW',
  'INFO_REQUESTED',
  'ESCALATED',
];

export const TERMINAL_RESOLVED = ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'];

export const SLA_ACK_DAYS = 2;
export const SLA_RESOLVE_DAYS = 15;
export const SLA_LONG_PENDING_DAYS = 60;

export function addDaysIso(fromDate, days) {
  const d = new Date(fromDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function invoiceChargeBreakdown(inv) {
  return {
    energy_charges: inv.energy_charges || 0,
    transmission_charges: inv.transmission_charges || 0,
    trading_margin: inv.trading_margin || 0,
    rebate: inv.rebate || 0,
    lps: inv.lps || 0,
    penalty: inv.penalty || 0,
    taxes: inv.taxes || 0,
    other_adjustments: inv.other_adjustments || 0,
  };
}

export function payableNow(inv) {
  const total = inv.total_amount || 0;
  const rebate = inv.rebate || 0;
  const lps = inv.lps || 0;
  const disputed = inv.disputed_amount || 0;
  return {
    total_amount: total,
    rebate,
    lps,
    disputed_amount: disputed,
    payable_now: Math.max(0, total - rebate + lps - disputed),
  };
}

/** LPS base while dispute is open — undisputed portion only */
export function lpsBaseAmount(inv) {
  return Math.max(0, (inv.total_amount || 0) - (inv.disputed_amount || 0));
}

/** Whole days from a → b (ceil). */
export function daysBetween(a, b) {
  return Math.ceil((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

/**
 * Accrued Late Payment Surcharge as of `asOf` on the OUTSTANDING undisputed amount.
 * Works before any payment is recorded (proactive display) and at payment time.
 */
export function accruedLps(inv, { annualPct = 15, asOf = new Date(), paid = 0, graceDays = 0, monthlyStepPct = 0, stepCapPct = 0, state = null } = {}) {
  const empty = { days_overdue: 0, lps: 0, base: 0, annual_pct: annualPct };
  if (!inv || !inv.due_date) return empty;
  // Days the payer is actually charged for. With lps_day_count_mode set to
  // WORKING_DAYS these exclude that party's weekly offs and state holidays, so
  // a beneficiary is not surcharged for days its office was shut.
  const daysOverdue = surchargeDays(inv.due_date, asOf, state);
  // No surcharge until the grace window past the due date has elapsed.
  if (daysOverdue <= (graceDays || 0)) return empty;
  const undisputed = Math.max(0, (inv.total_amount || 0) - (inv.disputed_amount || 0));
  const outstanding = Math.max(0, undisputed - (paid || 0));

  // Escalating LPS per MoP LPS Rules 2022 (PSA Art. 6.3): base rate for the
  // first 30-day month of default, then +monthlyStepPct for each successive
  // month, capped at stepCapPct above base. With monthlyStepPct = 0 this
  // collapses to a flat annual rate (backward-compatible).
  const dailyUnit = outstanding / 100 / 365;
  let lps = 0;
  let remaining = daysOverdue;
  let monthIdx = 0;
  let effectivePct = annualPct;
  while (remaining > 0) {
    const daysThisMonth = Math.min(30, remaining);
    const step = Math.min((monthlyStepPct || 0) * monthIdx, stepCapPct || 0);
    effectivePct = annualPct + step;
    lps += dailyUnit * effectivePct * daysThisMonth;
    remaining -= daysThisMonth;
    monthIdx += 1;
  }
  return { days_overdue: daysOverdue, lps: Math.round(lps), base: outstanding, annual_pct: annualPct, effective_pct: effectivePct };
}

/**
 * Late Payment Surcharge on an invoice as the money actually moved.
 *
 * accruedLps() charges one outstanding figure for every day since the due
 * date. That is only right while nothing has been paid: after a late part
 * payment it charges the rest from the due date and forgets what the paid part
 * earned while it was late. Here every chargeable day past the due date is
 * charged on what was unpaid that day:
 *
 *   base(day) = opening base - payments made before that day
 *               + debit notes whose own due date has passed
 *
 * A payment on day D covers day D (as the single-figure engine counts it), and
 * a debit note starts earning surcharge the day after its own due date — not
 * the original bill's, which may be months gone. Rate: the base rate for the
 * first 30 chargeable days, +monthlyStepPct for each further 30, capped at base
 * + stepCapPct (MoP LPS Rules 2022). Chargeable days are working days for the
 * payer when lps_day_count_mode says so. Nothing at all if the bill was settled
 * within the grace days.
 *
 * @param inv       invoice-like: total_amount, disputed_amount, due_date
 * @param payments  [{ amount, date }]            (amount includes deductions)
 * @param notes     [{ amount, due_date }]        debit notes folded into total_amount
 */
export function accruedLpsTimeline(inv, {
  payments = [], notes = [], annualPct = 15, asOf = new Date(), graceDays = 0,
  monthlyStepPct = 0, stepCapPct = 0, state = null,
} = {}) {
  const empty = { days_overdue: 0, lps: 0, base: 0, annual_pct: annualPct, effective_pct: annualPct };
  if (!inv || !inv.due_date) return empty;
  const DAY = 86400000;
  const day = (d) => { const x = new Date(d); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };
  const due = day(inv.due_date);
  const end = day(asOf);
  if (!(end > due)) return empty;

  const noteTotal = notes.reduce((a, n) => a + (Number(n.amount) || 0), 0);
  const opening = Math.max(0, (inv.total_amount || 0) - (inv.disputed_amount || 0) - noteTotal);
  const pays = payments.map((p) => ({ amount: Number(p.amount) || 0, on: day(p.date) }));
  const dn = notes.map((n) => ({ amount: Number(n.amount) || 0, due: day(n.due_date || inv.due_date) }));
  const workingOnly = lpsCountsWorkingDaysOnly();

  let lps = 0;
  let charged = 0;
  let lastBase = 0;
  let pct = annualPct;
  for (let t = due + DAY; t <= end; t += DAY) {
    const base = Math.max(0, opening
      - pays.filter((p) => p.on < t).reduce((a, p) => a + p.amount, 0)
      + dn.filter((n) => n.due < t).reduce((a, n) => a + n.amount, 0));
    lastBase = base;
    if (base <= 0.005) {
      // Settled — unless a debit note falls due later, nothing more accrues.
      if (!dn.some((n) => n.due >= t)) break;
      continue;
    }
    if (workingOnly && !isWorkingDay(new Date(t), state)) continue;
    charged += 1;
    const step = Math.min((monthlyStepPct || 0) * Math.floor((charged - 1) / 30), stepCapPct || 0);
    pct = annualPct + step;
    lps += (base * pct) / 100 / 365;
  }
  if (charged <= (graceDays || 0)) return { ...empty, days_overdue: charged, base: lastBase };
  return { days_overdue: charged, lps: Math.round(lps), base: lastBase, annual_pct: annualPct, effective_pct: pct };
}

/**
 * Tiered early-payment rebate %: pay within N days of bill → given %.
 * tiers = [{ within_days, pct }]. Returns null when no tiers configured (caller falls back).
 */
export function tieredRebatePct(daysFromBill, tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const sorted = tiers
    .filter((t) => t && Number.isFinite(Number(t.within_days)) && Number.isFinite(Number(t.pct)))
    .sort((a, b) => Number(a.within_days) - Number(b.within_days));
  for (const t of sorted) {
    if (daysFromBill <= Number(t.within_days)) return Number(t.pct);
  }
  return 0;
}

// disputes.dispute_no is UNIQUE, and four random digits collide long before a
// register of this kind fills up — see the note on genInstrumentNo. Sequential
// from the shared register, five digits so it clears the old four-digit range.
export function genDisputeNo() {
  const year = new Date().getFullYear();
  return `DSP/${year}/${String(nextSeriesNo('DSP', year)).padStart(5, '0')}`;
}

export const ALLOWED_TRANSITIONS = {
  RAISED: ['ACKNOWLEDGED', 'UNDER_REVIEW', 'ESCALATED'],
  ACKNOWLEDGED: ['UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED'],
  UNDER_REVIEW: ['INFO_REQUESTED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED', 'ESCALATED'],
  INFO_REQUESTED: ['UNDER_REVIEW', 'ESCALATED'],
  ESCALATED: ['UNDER_REVIEW', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'],
  RESOLVED_ACCEPTED: ['CLOSED'],
  RESOLVED_REJECTED: ['CLOSED'],
  CLOSED: [],
};
