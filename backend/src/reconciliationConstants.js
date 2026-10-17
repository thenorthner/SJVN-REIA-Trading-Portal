import { nextSeriesNo } from './util.js';

/** Reconciliation constants */

export const TOLERANCE_QTY_PCT = 0.5; // ±0.5%
export const TOLERANCE_AMOUNT = 100; // ±₹100
export const AVAILABILITY_THRESHOLD = 90;
export const PATTERN_LOOKBACK_MONTHS = 6;
export const PATTERN_EXCEPTION_THRESHOLD = 3;

export const RECON_STATUSES = [
  'DRAFT', 'IN_PROGRESS', 'AUTO_MATCHED', 'NEEDS_REVIEW', 'PENDING_SIGN_OFF',
  'AGREED', 'DISPUTED', 'CLOSED', 'REOPENED',
];

export const OPEN_RECON_STATUSES = [
  'DRAFT', 'IN_PROGRESS', 'AUTO_MATCHED', 'NEEDS_REVIEW', 'PENDING_SIGN_OFF', 'REOPENED', 'DISPUTED',
];

/**
 * A line the platform cannot actually check, because the system it would be
 * checked against is not connected.
 *
 * The tax line wants a figure filed with the GST portal and the SAP line wants
 * the finance system's own total. Neither connector exists, so both defaulted to
 * the platform's own number and compared it against itself — reporting an
 * exact match on every run, and lifting the auto-match percentage with two of
 * the six lines that were never able to move it.
 *
 * Saying so is the honest answer. A NOT_CONNECTED line counts as neither
 * matched nor an exception: it does not block sign-off, because there is nothing
 * for anyone to resolve, and it does not flatter the percentage either.
 */
export const NOT_CONNECTED = 'NOT_CONNECTED';

/** Statuses that mean a line agrees. */
export const MATCHED_STATUSES = ['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'];

/** Statuses that mean a line is open and has to be dealt with before sign-off. */
export const OPEN_ITEM_STATUSES = ['EXCEPTION', 'CARRIED'];

/**
 * The counts every screen reads off a statement.
 *
 * Four call sites used to compute these separately, which is how a new status
 * ends up counted one way in the engine and another in the route.
 */
export function summariseItems(items = []) {
  const matched = items.filter((i) => MATCHED_STATUSES.includes(i.match_status)).length;
  const exceptions = items.filter((i) => OPEN_ITEM_STATUSES.includes(i.match_status)).length;
  const notConnected = items.filter((i) => i.match_status === NOT_CONNECTED).length;
  // Only lines that could have gone either way are in the denominator.
  const checkable = matched + exceptions;
  return {
    matched,
    exceptions,
    not_connected: notConnected,
    checkable,
    auto_match_pct: checkable ? Number(((matched / checkable) * 100).toFixed(2)) : 0,
    // Rupees only. Energy (MWh) and availability (%) variances were added in,
    // so 2,000 MWh unbilled read as ₹2,000 of exposure.
    unreconciled_amount: items
      .filter((i) => OPEN_ITEM_STATUSES.includes(i.match_status) && (i.unit || 'INR') === 'INR')
      .reduce((s, i) => s + Math.abs(i.variance || 0), 0),
  };
}

export const ITEM_TYPES = [
  'ENERGY_THREE_WAY', 'FINANCIAL_THREE_WAY', 'TAX', 'PERFORMANCE', 'PENALTY',
  'INTERNAL_SAP', 'TRADING_BID_CLEAR_BILL', 'CARRY_FORWARD', 'DISPUTE_REF',
];

// reconciliations.recon_no is UNIQUE, and a monthly run per contract fills a
// four-digit random space fast — see the note on genInstrumentNo.
export function genReconNo() {
  const year = new Date().getFullYear();
  return `RCN/${year}/${String(nextSeriesNo('RCN', year)).padStart(5, '0')}`;
}

export function classifyVariance(variance, baseValue, { qtyPct = TOLERANCE_QTY_PCT, amountTol = TOLERANCE_AMOUNT, unit = 'INR' } = {}) {
  const abs = Math.abs(variance || 0);
  if (abs < 0.0001) return { match_status: 'EXACT', variance_pct: 0 };
  if (unit === 'MWh' || unit === 'PCT') {
    const base = Math.abs(baseValue || 0) || 1;
    const pct = (abs / base) * 100;
    if (pct <= qtyPct) return { match_status: 'AUTO_MATCHED', variance_pct: Number(pct.toFixed(4)) };
    return { match_status: 'EXCEPTION', variance_pct: Number(pct.toFixed(4)) };
  }
  const base = Math.abs(baseValue || 0) || 1;
  const pct = (abs / base) * 100;
  if (abs <= amountTol || pct <= qtyPct) return { match_status: 'AUTO_MATCHED', variance_pct: Number(pct.toFixed(4)) };
  return { match_status: 'EXCEPTION', variance_pct: Number(pct.toFixed(4)) };
}

export function prevPeriod(period, periodType = 'MONTHLY') {
  if (periodType === 'ANNUAL') {
    return String(Number(period) - 1);
  }
  if (periodType === 'QUARTERLY') {
    const m = period.match(/^(\d{4})-Q(\d)$/);
    if (!m) return period;
    let y = Number(m[1]);
    let q = Number(m[2]) - 1;
    if (q < 1) { q = 4; y -= 1; }
    return `${y}-Q${q}`;
  }
  const [y, mo] = period.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
