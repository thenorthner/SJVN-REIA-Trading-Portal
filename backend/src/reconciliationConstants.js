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

export const ITEM_TYPES = [
  'ENERGY_THREE_WAY', 'FINANCIAL_THREE_WAY', 'TAX', 'PERFORMANCE', 'PENALTY',
  'INTERNAL_SAP', 'TRADING_BID_CLEAR_BILL', 'CARRY_FORWARD', 'DISPUTE_REF',
];

export function genReconNo() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RCN/${new Date().getFullYear()}/${rand}`;
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
