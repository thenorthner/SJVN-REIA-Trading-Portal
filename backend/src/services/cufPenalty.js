/**
 * CUF / performance shortfall penalty for Solar / Wind / Hybrid invoices.
 *
 * Hydro/PSP: capacity charges already scale with PAFM/NAPAF — do not double-count.
 *
 * Formula:
 *   minCuf   = contract.min_cuf_percent ?? master default by project_type
 *   actualCuf = energy.cuf_percent ?? (energy_mwh / (capacity_mw × 24 × days) × 100)
 *   shortfallMwh = max(0, (minCuf − actualCuf) / 100 × capacity_mw × 24 × days)
 *   rate ₹/MWh = master cuf_penalty_per_mwh if > 0, else tariff_per_unit × 1000
 *   penalty = round(shortfallMwh × rate)
 */
import db from '../db/index.js';
import { daysInMonth } from './cercHydroBilling.js';
import { getParamNumber } from '../mastersService.js';
import { sourcesForPsa } from './allocations.js';

const RE_TYPES = new Set(['Solar', 'Wind', 'Hybrid', 'FDRE']);

export function defaultMinCufPercent(projectType) {
  if (projectType === 'Wind') return getParamNumber('wind_base_cuf_pct', 30);
  if (projectType === 'Hybrid' || projectType === 'FDRE') {
    return getParamNumber('hybrid_base_cuf_pct', getParamNumber('solar_base_cuf_pct', 22));
  }
  return getParamNumber('solar_base_cuf_pct', 22);
}

export function resolveMinCufPercent(contract) {
  if (contract?.min_cuf_percent != null && Number.isFinite(Number(contract.min_cuf_percent))) {
    return Number(contract.min_cuf_percent);
  }
  return defaultMinCufPercent(contract?.project_type);
}

export function computeActualCufPercent({ energyMwh, capacityMw, periodMonth, cufPercent }) {
  // Worked out from the energy wherever it can be (decided 17-Oct-2026): the
  // meter's rounded CUF (5.38 for 5.376) moved money by thousands. The reported
  // figure is used only where there is no energy or capacity to work from.
  const hours = 24 * daysInMonth(periodMonth);
  const denom = (Number(capacityMw) || 0) * hours;
  if (denom > 0 && energyMwh != null && Number.isFinite(Number(energyMwh))) {
    return (Number(energyMwh) || 0) / denom * 100;
  }
  if (cufPercent != null && Number.isFinite(Number(cufPercent))) return Number(cufPercent);
  return null;
}

/**
 * @returns {{
 *   applicable: boolean,
 *   penalty: number,
 *   minCuf: number|null,
 *   actualCuf: number|null,
 *   shortfallMwh: number,
 *   ratePerMwh: number,
 *   label: string|null,
 *   breakdown?: object
 * }}
 */
export function computeCufPenalty({
  contract,
  periodMonth,
  energyMwh,
  capacityMw,
  cufPercent,
  tariffPerUnit,
}) {
  const projectType = contract?.project_type;
  if (!RE_TYPES.has(projectType)) {
    return {
      applicable: false,
      penalty: 0,
      minCuf: null,
      actualCuf: null,
      shortfallMwh: 0,
      ratePerMwh: 0,
      label: null,
    };
  }

  // commissioned_capacity_mw defaults to 0, which means "not recorded", not a dead plant.
  const cap = Number(capacityMw) || Number(contract?.commissioned_capacity_mw) || Number(contract?.capacity_mw) || 0;
  const minCuf = resolveMinCufPercent(contract);
  const actualCuf = computeActualCufPercent({
    energyMwh,
    capacityMw: cap,
    periodMonth,
    cufPercent,
  });

  if (actualCuf == null || !(cap > 0) || !(minCuf > 0)) {
    return {
      applicable: true,
      penalty: 0,
      minCuf,
      actualCuf,
      shortfallMwh: 0,
      ratePerMwh: 0,
      label: 'CUF penalty — insufficient data',
    };
  }

  if (actualCuf >= minCuf) {
    return {
      applicable: true,
      penalty: 0,
      minCuf,
      actualCuf,
      shortfallMwh: 0,
      ratePerMwh: 0,
      label: `CUF met (${actualCuf.toFixed(2)}% ≥ min ${minCuf}%)`,
    };
  }

  const hours = 24 * daysInMonth(periodMonth);
  const shortfallMwh = ((minCuf - actualCuf) / 100) * cap * hours;

  const fixedRate = getParamNumber('cuf_penalty_per_mwh', 0);
  const tariff = Number(tariffPerUnit ?? contract?.tariff_per_unit) || 0;
  const ratePerMwh = fixedRate > 0 ? fixedRate : tariff * 1000;
  const ownPct = Number(contract?.cuf_shortfall_comp_pct);
  const factor = ownPct > 0 ? ownPct / 100 : getParamNumber('cuf_penalty_factor', 1);
  const penalty = Math.round(shortfallMwh * ratePerMwh * (factor > 0 ? factor : 1));

  const rateNote = fixedRate > 0
    ? `₹${fixedRate}/MWh (master)`
    : `₹${tariff}/kWh (= ₹${ratePerMwh}/MWh)`;

  return {
    applicable: true,
    penalty,
    minCuf,
    actualCuf,
    shortfallMwh: Math.round(shortfallMwh * 1000) / 1000,
    ratePerMwh,
    label: `CUF shortfall penalty (${actualCuf.toFixed(2)}% vs min ${minCuf}%; ${Math.round(shortfallMwh * 1000) / 1000} MWh × ${rateNote})`,
    breakdown: {
      code: 'PEN',
      label: `CUF shortfall penalty (${actualCuf.toFixed(2)}% < ${minCuf}%; ${Math.round(shortfallMwh * 1000) / 1000} MWh)`,
      value: -penalty,
    },
  };
}

// ── Annual assessment ────────────────────────────────────────────────────────
//
// CUF is an annual obligation (decided 17-Oct-2026). Solar generation dips in
// the monsoon and peaks in summer, and PPAs assess the minimum over the contract
// year, so a month on its own is not a shortfall: Sunrise's July (5.38 % on
// 50 MW) priced at ₹1.78 crore against ₹57.6 lakh of energy, and billing then
// refused the bill. Monthly bills now carry the year-to-date CUF as an
// indicator only; once the contract year is over and every month of it is
// locked, the year's shortfall is priced once and settled by a credit note at
// the year-end true-up.
//
// The contract year is counted as the tariff counts it — from the tenure start
// (tariffStructure.contractYearFor) — and starts no earlier than the COD.

const monthAdd = (period, n) => {
  const [y, m] = String(period).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthsBetween = (from, to) => {
  const out = [];
  for (let p = from; p <= to; p = monthAdd(p, 1)) out.push(p);
  return out;
};

/** The contract year a period falls in: its number and its first and last months. */
export function contractYearBounds(contract, periodMonth) {
  const start = String(contract?.tenure_start || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || periodMonth < start) {
    return { contract_year: 1, year_start: periodMonth, year_end: monthAdd(periodMonth, 11) };
  }
  const [py, pm] = periodMonth.split('-').map(Number);
  const [sy, sm] = start.split('-').map(Number);
  const year = Math.floor(((py - sy) * 12 + (pm - sm)) / 12) + 1;
  const yearStart = monthAdd(start, (year - 1) * 12);
  return { contract_year: year, year_start: yearStart, year_end: monthAdd(yearStart, 11) };
}

// The month's standing figure, as billing takes it: locked, final before
// provisional. A PSA has none of its own: its share of each source PPA's.
// Deemed generation — energy the plant stood ready to make but the grid could
// not take (curtailment, backing down, grid unavailability, as certified) —
// counts toward CUF as generated (decided 17-Oct-2026), as SECI-model PPAs
// provide: the developer is not penalised for what the grid refused.
// G2: certified curtailment / backing-down hours come off the hours the plant
// could have run, so the month's possible energy is cap × (hours − curtailed).
// Where hours are certified, deemed generation MWh is not added as well (it is
// the same relief counted the other way).
function pickMonthEnergy(contractId, period) {
  return db.prepare(`
    SELECT energy_mwh + CASE WHEN COALESCE(curtailment_hours, 0) > 0 THEN 0 ELSE COALESCE(deemed_generation_mwh, 0) END AS energy_mwh,
      COALESCE(curtailment_hours, 0) AS curtailment_hours, status FROM energy_data
    WHERE contract_id = ? AND period_month = ? AND status NOT IN ('DRAFT', 'REJECTED')
    ORDER BY (status = 'LOCKED') DESC, (data_type = 'FINAL') DESC, created_at DESC LIMIT 1
  `).get(contractId, period);
}

export function monthEnergyForCuf(contract, period) {
  const own = pickMonthEnergy(contract.id, period);
  if (own || contract.contract_type !== 'PSA') {
    return own ? { energy_mwh: Number(own.energy_mwh) || 0, locked: own.status === 'LOCKED', curtailment_hours: Number(own.curtailment_hours) || 0 } : null;
  }
  const sources = sourcesForPsa(contract.id, period);
  if (!sources.length) return null;
  let mwh = 0;
  let locked = true;
  for (const s of sources) {
    const e = pickMonthEnergy(s.ppa_id, period);
    if (!e) return null;
    mwh += (Number(e.energy_mwh) || 0) * (Number(s.allocation_percent) || 0) / 100;
    if (e.status !== 'LOCKED') locked = false;
  }
  return { energy_mwh: Math.round(mwh * 1000) / 1000, locked };
}

/**
 * Where a contract stands on CUF for the contract year containing `periodMonth`,
 * counting months up to `upTo` (default: that period). The penalty is worked out
 * only for a finished year with every month locked; until then the position is
 * an indicator.
 */
export function cufYearPosition(contract, periodMonth, { upTo = periodMonth, capacityMw = null, tariffPerUnit = null } = {}) {
  if (!RE_TYPES.has(contract?.project_type)) {
    return { applicable: false, label: null };
  }
  const bounds = contractYearBounds(contract, periodMonth);
  const cod = contract.cod_date ? String(contract.cod_date).slice(0, 7) : null;
  const from = cod && cod > bounds.year_start ? cod : bounds.year_start;
  const last = upTo < bounds.year_end ? upTo : bounds.year_end;
  const cap = Number(capacityMw) || Number(contract.commissioned_capacity_mw) || Number(contract.capacity_mw) || 0;
  const minCuf = resolveMinCufPercent(contract);
  const months = from > last ? [] : monthsBetween(from, last).map((p) => {
    const e = monthEnergyForCuf(contract, p);
    const curtailed = Math.min(24 * daysInMonth(p), Number(e?.curtailment_hours) || 0);
    return {
      period: p,
      energy_mwh: e ? e.energy_mwh : null,
      locked: !!e?.locked,
      curtailment_hours: curtailed,
      possible_mwh: cap * (24 * daysInMonth(p) - curtailed),
    };
  });
  const counted = months.filter((m) => m.energy_mwh != null);
  const energy = counted.reduce((a, m) => a + m.energy_mwh, 0);
  const possible = counted.reduce((a, m) => a + m.possible_mwh, 0);
  const cuf = possible > 0 ? (energy / possible) * 100 : null;
  const yearOver = upTo >= bounds.year_end;
  const allMonths = cod && cod > bounds.year_end ? [] : monthsBetween(from, bounds.year_end);
  const missing = allMonths.filter((p) => !months.some((m) => m.period === p && m.energy_mwh != null && m.locked));
  const complete = yearOver && allMonths.length > 0 && missing.length === 0;

  let shortfallMwh = 0;
  let penalty = 0;
  let ratePerMwh = 0;
  if (complete && cuf != null && cap > 0 && minCuf > 0 && cuf < minCuf) {
    shortfallMwh = ((minCuf - cuf) / 100) * possible;
    const fixedRate = getParamNumber('cuf_penalty_per_mwh', 0);
    const tariff = Number(tariffPerUnit ?? contract.tariff_per_unit) || 0;
    ratePerMwh = fixedRate > 0 ? fixedRate : tariff * 1000;
    // The PPA's own compensation rate (e.g. 50% of tariff in SECI hybrid
    // RfS, 25% in some state PPAs) wins over the master factor.
    const ownPct = Number(contract.cuf_shortfall_comp_pct);
    const factor = ownPct > 0 ? ownPct / 100 : getParamNumber('cuf_penalty_factor', 1);
    penalty = Math.round(shortfallMwh * ratePerMwh * (factor > 0 ? factor : 1));
  }
  const pct = (v) => (v == null ? 'n/a' : `${v.toFixed(2)}%`);
  const span = `${bounds.year_start} → ${bounds.year_end}`;
  const label = cuf == null
    ? `CUF for contract year ${bounds.contract_year} (${span}): no energy yet — assessed at the year end`
    : complete
      ? (penalty > 0
        ? `CUF for contract year ${bounds.contract_year} (${span}): ${pct(cuf)} vs min ${minCuf}% — ${Math.round(shortfallMwh * 1000) / 1000} MWh short, ₹${penalty.toLocaleString('en-IN')} settled by the year-end true-up note`
        : `CUF for contract year ${bounds.contract_year} (${span}): ${pct(cuf)} vs min ${minCuf}% — met`)
      : `CUF for contract year ${bounds.contract_year} so far (${counted.length} month${counted.length === 1 ? '' : 's'} to ${last}): ${pct(cuf)} vs min ${minCuf}% — assessed at the year end (${bounds.year_end}), not deducted monthly`;

  return {
    applicable: true,
    ...bounds,
    assessed_from: from,
    months,
    months_counted: counted.length,
    months_missing: missing,
    energy_mwh: Math.round(energy * 1000) / 1000,
    possible_mwh: Math.round(possible * 100) / 100,
    cuf_percent: cuf == null ? null : Math.round(cuf * 100) / 100,
    min_cuf_percent: minCuf,
    year_over: yearOver,
    complete,
    shortfall_mwh: Math.round(shortfallMwh * 1000) / 1000,
    rate_per_mwh: ratePerMwh,
    penalty,
    label,
  };
}
