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
import { daysInMonth } from './cercHydroBilling.js';
import { getParamNumber } from '../mastersService.js';

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
  if (cufPercent != null && Number.isFinite(Number(cufPercent))) {
    return Number(cufPercent);
  }
  const hours = 24 * daysInMonth(periodMonth);
  const denom = (Number(capacityMw) || 0) * hours;
  if (!(denom > 0)) return null;
  return (Number(energyMwh) || 0) / denom * 100;
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

  const cap = Number(capacityMw ?? contract?.commissioned_capacity_mw ?? contract?.capacity_mw) || 0;
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
  const factor = getParamNumber('cuf_penalty_factor', 1);
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
