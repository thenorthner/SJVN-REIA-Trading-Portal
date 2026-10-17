/**
 * G1: contract-year CUF tracker (Batch 1, 17-Oct-2026).
 *
 * CUF is assessed over the contract year. This says, for each live RE PPA,
 * where its current contract year stands: CUF so far, what the rest of the
 * year has to average to reach the minimum, and — if the year carries on at
 * today's rate — the shortfall and the compensation it would cost at the
 * year-end true-up.
 */
import db from '../db/index.js';
import { cufYearPosition } from './cufPenalty.js';
import { lastCompleteMonth } from './energyRules.js';
import { billableCapacityMw } from '../util.js';
import { resolveTariff } from './tariffStructure.js';
import { getParamNumber } from '../mastersService.js';

const RE = ['Solar', 'Wind', 'Hybrid', 'FDRE'];
const daysIn = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const monthsBetween = (a, b) => {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [ey, em] = b.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
};

export function cufTrackerFor(contract, upTo = lastCompleteMonth()) {
  const cap = billableCapacityMw(contract);
  const pos = cufYearPosition(contract, upTo, { upTo, capacityMw: cap });
  if (!pos.applicable) return null;
  const yearMonths = pos.assessed_from > pos.year_end ? [] : monthsBetween(pos.assessed_from, pos.year_end);
  const yearPossible = yearMonths.reduce((t, p) => t + cap * 24 * daysIn(p), 0);
  const remainingPossible = Math.max(0, yearPossible - pos.possible_mwh);
  const minCuf = Number(pos.min_cuf_percent) || 0;
  const target = (minCuf / 100) * yearPossible;
  const neededMwh = Math.max(0, target - pos.energy_mwh);
  const neededCuf = remainingPossible > 0 ? (neededMwh / remainingPossible) * 100 : null;
  const runRate = pos.cuf_percent != null ? pos.cuf_percent / 100 : null;
  const projectedEnergy = runRate != null ? pos.energy_mwh + runRate * remainingPossible : null;
  const projectedCuf = projectedEnergy != null && yearPossible > 0 ? (projectedEnergy / yearPossible) * 100 : null;
  const projectedShortfall = projectedEnergy != null ? Math.max(0, target - projectedEnergy) : null;
  const tariff = resolveTariff(contract, pos.year_end).rate || Number(contract.tariff_per_unit) || 0;
  const fixed = getParamNumber('cuf_penalty_per_mwh', 0);
  const rate = fixed > 0 ? fixed : tariff * 1000;
  const factor = Number(contract.cuf_shortfall_comp_pct) > 0 ? Number(contract.cuf_shortfall_comp_pct) / 100 : getParamNumber('cuf_penalty_factor', 1);
  let state;
  if (pos.cuf_percent == null) state = 'NO_DATA';
  else if (pos.year_over && pos.complete) state = pos.penalty > 0 ? 'SHORT' : 'MET';
  else if (neededCuf != null && neededCuf > 100) state = 'CANNOT_MEET';
  else if (projectedShortfall > 0) state = 'AT_RISK';
  else state = 'ON_TRACK';
  const r = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    contract_id: contract.id,
    contract_no: contract.contract_no,
    project_type: contract.project_type,
    seller: contract.seller_name || null,
    capacity_mw: cap,
    contract_year: pos.contract_year,
    year_start: pos.year_start,
    year_end: pos.year_end,
    months_counted: pos.months_counted,
    months_in_year: yearMonths.length,
    months_missing: pos.months_missing,
    energy_mwh: pos.energy_mwh,
    cuf_ytd: pos.cuf_percent,
    min_cuf: minCuf,
    needed_cuf_rest_of_year: r(neededCuf),
    projected_cuf: r(projectedCuf),
    projected_shortfall_mwh: r(projectedShortfall, 3),
    projected_compensation: projectedShortfall != null ? Math.round(projectedShortfall * rate * factor) : null,
    compensation_basis: `${Math.round(factor * 100)}% of ₹${r(rate)}/MWh`,
    state,
    label: pos.label,
  };
}

export function cufTracker({ contractId = null, upTo = lastCompleteMonth() } = {}) {
  const contracts = db.prepare(`
    SELECT c.*, s.name AS seller_name FROM contracts c LEFT JOIN entities s ON s.id = c.seller_id
    WHERE c.contract_type = 'PPA' AND c.status IN ('ACTIVE', 'NEARING_EXPIRY', 'AMENDED', 'RENEWED')
      AND (? IS NULL OR c.id = ?)
    ORDER BY c.contract_no
  `).all(contractId, contractId).filter((c) => RE.some((t) => t.toUpperCase() === String(c.project_type || '').toUpperCase()));
  const order = { CANNOT_MEET: 0, SHORT: 1, AT_RISK: 2, ON_TRACK: 3, MET: 4, NO_DATA: 5 };
  const rows = contracts.map((c) => cufTrackerFor({ ...c, project_type: RE.find((t) => t.toUpperCase() === String(c.project_type).toUpperCase()) }, upTo))
    .filter(Boolean).sort((a, b) => order[a.state] - order[b.state] || a.contract_no.localeCompare(b.contract_no));
  return {
    as_of: upTo,
    rows,
    totals: {
      contracts: rows.length,
      at_risk: rows.filter((x) => ['AT_RISK', 'CANNOT_MEET'].includes(x.state)).length,
      projected_compensation: rows.reduce((t, x) => t + (['AT_RISK', 'CANNOT_MEET'].includes(x.state) ? x.projected_compensation || 0 : 0), 0),
    },
  };
}
