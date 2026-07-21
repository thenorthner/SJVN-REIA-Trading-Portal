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
export function accruedLps(inv, { annualPct = 15, asOf = new Date(), paid = 0 } = {}) {
  const empty = { days_overdue: 0, lps: 0, base: 0, annual_pct: annualPct };
  if (!inv || !inv.due_date) return empty;
  const daysOverdue = daysBetween(new Date(inv.due_date), new Date(asOf));
  if (daysOverdue <= 0) return empty;
  const undisputed = Math.max(0, (inv.total_amount || 0) - (inv.disputed_amount || 0));
  const outstanding = Math.max(0, undisputed - (paid || 0));
  const lps = Math.round(outstanding * (annualPct / 100 / 365) * daysOverdue);
  return { days_overdue: daysOverdue, lps, base: outstanding, annual_pct: annualPct };
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

export function genDisputeNo() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  const year = new Date().getFullYear();
  return `DSP/${year}/${rand}`;
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
