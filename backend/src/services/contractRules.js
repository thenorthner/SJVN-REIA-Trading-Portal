// The rules a contract record has to satisfy, whichever route writes it. The
// form checked these in the browser and the server checked none of them, so a
// contract with negative capacity, a negative tariff and a tenure ending before
// it began could be created by anyone calling the API directly.

const PROJECT_TYPES = {
  SOLAR: 'Solar', WIND: 'Wind', HYBRID: 'Hybrid', FDRE: 'FDRE',
  PEAKPOWER: 'PeakPower', 'PEAK POWER': 'PeakPower', 'PEAK-POWER': 'PeakPower',
  HYDRO: 'Hydro', PSP: 'PSP', 'PUMPED STORAGE': 'PSP',
  STORAGE: 'Storage', BESS: 'Storage', 'BESS / STORAGE': 'Storage',
};

export const PROJECT_TYPE_VALUES = ['Solar', 'Wind', 'Hybrid', 'FDRE', 'PeakPower', 'Hydro', 'PSP', 'Storage'];

/** One spelling per technology; bulk loads wrote SOLAR and the form Solar, which split every filter and total. */
export function normalizeProjectType(v) {
  if (v == null) return v;
  const key = String(v).trim().toUpperCase();
  return PROJECT_TYPES[key] || String(v).trim();
}

export function normalizeContractNo(v) {
  return v == null ? '' : String(v).trim().replace(/\s+/g, ' ');
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => (v === '' || v == null ? null : Number(v));
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const TERMINATION_GROUNDS = ['FOR_CAUSE', 'FOR_CONVENIENCE', 'MUTUAL_AGREEMENT', 'FORCE_MAJEURE', 'REGULATORY_ORDER'];

/**
 * Every problem with a contract's fields, each in words an officer can act on.
 * `c` is the full record as it would be stored (for an amendment, the merged one).
 */
export function contractFieldErrors(c) {
  const errors = [];
  const add = (m) => errors.push(m);

  if (!normalizeContractNo(c.contract_no)) add('Contract number is required.');
  if (!['PPA', 'PSA'].includes(c.contract_type)) add('Contract type must be PPA or PSA.');
  if (c.project_type && !PROJECT_TYPE_VALUES.includes(normalizeProjectType(c.project_type))) {
    add(`Project type "${c.project_type}" is not one of ${PROJECT_TYPE_VALUES.join(', ')}.`);
  }

  const cap = num(c.capacity_mw);
  if (!Number.isFinite(cap) || cap <= 0) add('Capacity must be greater than 0 MW.');
  else if (cap > 10000) add(`Capacity of ${cap} MW is not credible for one contract — check the figure (limit 10,000 MW).`);

  const comm = num(c.commissioned_capacity_mw);
  if (comm != null) {
    if (!Number.isFinite(comm) || comm < 0) add('Commissioned capacity cannot be negative.');
    else if (Number.isFinite(cap) && comm > cap) add(`Commissioned capacity (${comm} MW) cannot exceed the contracted capacity (${cap} MW).`);
    if (comm > 0 && !c.cod_date) add('A commissioned capacity needs its COD date.');
  }

  const tariff = num(c.tariff_per_unit);
  if (!Number.isFinite(tariff) || tariff <= 0) add('Tariff must be greater than ₹0/unit.');
  else if (tariff > 20) add(`A tariff of ₹${tariff}/unit is not credible — check the figure (limit ₹20/unit).`);

  const margin = num(c.trading_margin_per_mwh);
  if (margin != null && (!Number.isFinite(margin) || margin < 0)) add('Trading margin cannot be negative.');

  if (!c.tenure_start || !ISO.test(String(c.tenure_start))) add('Tenure start date is required (YYYY-MM-DD).');
  if (!c.tenure_end || !ISO.test(String(c.tenure_end))) add('Tenure end date is required (YYYY-MM-DD).');
  if (c.tenure_start && c.tenure_end && String(c.tenure_end) <= String(c.tenure_start)) add('Tenure end must be after tenure start.');
  if (c.tenure_start && c.tenure_end && ISO.test(String(c.tenure_start)) && ISO.test(String(c.tenure_end))) {
    const years = (new Date(c.tenure_end) - new Date(c.tenure_start)) / (365.25 * 86400000);
    if (years > 50) add(`A tenure of ${Math.round(years)} years is longer than any PPA/PSA (limit 50 years).`);
  }
  if (c.cod_date && !ISO.test(String(c.cod_date))) add('COD date must be YYYY-MM-DD.');

  const terms = num(c.payment_terms_days);
  if (terms != null && (!Number.isInteger(terms) || terms < 0 || terms > 365)) add('Payment terms must be 0–365 days.');

  const rebate = num(c.rebate_pct);
  const rebateDays = num(c.rebate_days);
  if (rebate != null) {
    if (!Number.isFinite(rebate) || rebate < 0 || rebate > 100) add('Rebate must be between 0% and 100%.');
    if (!(rebateDays > 0)) add('A rebate needs the number of days it is allowed within.');
    else if ((c.rebate_basis || 'BILL_DATE') === 'BILL_DATE' && terms != null && rebateDays > terms) {
      add(`The rebate window (${rebateDays} days) is longer than the payment terms (${terms} days) — an early-payment rebate must fall before the due date.`);
    }
  }

  const lps = num(c.lps_annual_pct);
  if (lps != null && (!Number.isFinite(lps) || lps < 0 || lps > 100)) add('LPS must be between 0% and 100% per annum.');
  const grace = num(c.lps_grace_days);
  if (grace != null && (!Number.isInteger(grace) || grace < 0)) add('LPS grace period cannot be negative.');

  for (const [field, label] of [['pbg_amount', 'PBG / security amount'], ['emd_amount', 'EMD amount']]) {
    const v = num(c[field]);
    if (v != null && (!Number.isFinite(v) || v < 0)) add(`${label} cannot be negative.`);
  }
  if (num(c.pbg_amount) > 0 && !c.pbg_type) add('Select the instrument the guarantee is given as.');
  if (c.pbg_expiry && !ISO.test(String(c.pbg_expiry))) add('PBG expiry must be YYYY-MM-DD.');

  for (const [field, label] of [['min_cuf_percent', 'Minimum CUF'], ['min_peak_availability_percent', 'Minimum peak availability'], ['napaf_percent', 'NAPAF'], ['normative_aux', 'Normative auxiliary consumption'], ['free_energy_home_state', 'Free energy to home state']]) {
    const v = num(c[field]);
    if (v != null && (!Number.isFinite(v) || v < 0 || v > 100)) add(`${label} must be between 0% and 100%.`);
  }
  if (num(c.min_peak_availability_percent) != null) {
    if (!c.peak_window_start || !c.peak_window_end) add('A peak availability obligation needs its peak window (from and to).');
  }
  for (const [field, label] of [['peak_window_start', 'Peak window from'], ['peak_window_end', 'Peak window to']]) {
    if (c[field] && !TIME.test(String(c[field]))) add(`${label} must be a time (HH:MM).`);
  }
  if (c.peak_window_start && c.peak_window_end && c.peak_window_start === c.peak_window_end) add('The peak window cannot start and end at the same time.');
  const penalty = num(c.peak_penalty_per_mwh);
  if (penalty != null && (!Number.isFinite(penalty) || penalty < 0)) add('Peak shortfall penalty cannot be negative.');

  return errors;
}

/** The columns an amendment may change — anything else in a request body is not a term of the contract. */
export const AMENDABLE_FIELDS = [
  'capacity_mw', 'commissioned_capacity_mw', 'cod_date', 'tariff_type', 'tariff_per_unit', 'tenure_end', 'billing_cycle',
  'payment_terms_days', 'rebate_pct', 'rebate_days', 'rebate_basis', 'lps_annual_pct', 'lps_grace_days', 'payment_security_type',
  'emd_amount', 'pbg_amount', 'pbg_type', 'pbg_expiry', 'trading_margin_per_mwh',
  'normative_aux', 'free_energy_home_state', 'capacity_charges_total', 'annual_afc', 'annual_design_energy_mwh', 'napaf_percent',
  'transmission_charge_per_mwh', 'min_cuf_percent', 'peak_window_start', 'peak_window_end', 'min_peak_availability_percent', 'peak_penalty_per_mwh',
];

/** A form's blank means "none"; commissioned capacity has no "none", it is 0. */
export function cleanTerms(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!AMENDABLE_FIELDS.includes(k) && !['tenure_start', 'project_type'].includes(k)) continue;
    out[k] = v === '' ? null : v;
  }
  if ('commissioned_capacity_mw' in out && out.commissioned_capacity_mw == null) out.commissioned_capacity_mw = 0;
  return out;
}

/** Fields that really changed, compared as numbers where both sides are numbers. */
export function changedTerms(original, body) {
  const changed = {};
  for (const k of AMENDABLE_FIELDS) {
    if (!(k in body)) continue;
    const a = original[k];
    const b = body[k] === '' ? null : body[k];
    const bothNum = a != null && b != null && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && String(b).trim() !== '';
    const same = bothNum ? Number(a) === Number(b) : String(a ?? '') === String(b ?? '');
    if (!same) changed[k] = { old: a ?? null, new: b };
  }
  return changed;
}
