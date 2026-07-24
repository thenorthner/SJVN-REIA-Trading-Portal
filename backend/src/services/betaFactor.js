/**
 * CERC Tariff Regulations 2024 — Frequency Response Incentive (Beta β)
 * Hydro/PSP Reg 65(4): Incentive = (3% × β × CCy) / 12
 * SJVN NJHPS practice: CCy ≈ 0.5 × AFC → (3% × β × 0.5 × AFC) / 12
 * Prefer computeBetaFromAnnualAfc when annual AFC is known.
 */
import db from '../db/index.js';
import { getParamNumber } from '../mastersService.js';

export function resolveBetaRow(contract, periodMonth) {
  if (!contract?.id || !periodMonth) return null;
  let row = db.prepare(`
    SELECT * FROM station_beta WHERE contract_id = ? AND period_month = ?
  `).get(contract.id, periodMonth);

  if (!row && contract.contract_type === 'PSA') {
    const alloc = db.prepare('SELECT ppa_id FROM contract_allocations WHERE psa_id = ?').get(contract.id);
    if (alloc?.ppa_id) {
      row = db.prepare(`
        SELECT * FROM station_beta WHERE contract_id = ? AND period_month = ?
      `).get(alloc.ppa_id, periodMonth);
    }
  }
  return row || null;
}

export function incentivePctForProject(projectType) {
  if (['Hydro', 'PSP'].includes(projectType)) {
    return getParamNumber('freq_response_incentive_pct_hydro', 3);
  }
  return getParamNumber('freq_response_incentive_pct_thermal', 1);
}

/** Preferred: Incentive = (pct × β × sharing × annualAfc) / 12 */
export function computeBetaFromAnnualAfc(annualAfc, betaValue, projectType) {
  const pct = incentivePctForProject(projectType);
  const minBeta = getParamNumber('freq_response_beta_min', 0.30);
  const sharing = getParamNumber('freq_response_beta_sharing_factor', 0.5);
  const beta = betaValue == null || betaValue === '' ? null : Number(betaValue);

  if (beta == null || !Number.isFinite(beta)) {
    return { incentive: 0, eligible: false, beta: null, pct, minBeta, sharing, reason: 'β not yet certified (NRPC pending)' };
  }
  if (beta < 0 || beta > 1) {
    return { incentive: 0, eligible: false, beta, pct, minBeta, sharing, reason: 'β out of range (0–1)' };
  }
  if (beta <= minBeta) {
    return {
      incentive: 0,
      eligible: false,
      beta,
      pct,
      minBeta,
      sharing,
      reason: `β ${beta.toFixed(2)} ≤ ${minBeta} — incentive not payable`,
    };
  }
  const afc = Number(annualAfc) || 0;
  const incentive = Math.round((pct / 100) * beta * sharing * afc / 12);
  return {
    incentive,
    eligible: true,
    beta,
    pct,
    minBeta,
    sharing,
    reason: `(${pct}% × β ${beta.toFixed(2)} × ${sharing} × AFC)/12`,
  };
}

/**
 * Legacy helper: if monthlyCapacityCharge is AFC/12, applying sharing 0.5
 * approximates (pct × β × 0.5 × AFC)/12. Prefer computeBetaFromAnnualAfc.
 */
export function computeFreqResponseIncentive(monthlyCapacityCharge, betaValue, projectType) {
  const pct = incentivePctForProject(projectType);
  const minBeta = getParamNumber('freq_response_beta_min', 0.30);
  const sharing = getParamNumber('freq_response_beta_sharing_factor', 0.5);
  const beta = betaValue == null || betaValue === '' ? null : Number(betaValue);

  if (beta == null || !Number.isFinite(beta)) {
    return { incentive: 0, eligible: false, beta: null, pct, minBeta, sharing, reason: 'β not yet certified (NRPC pending)' };
  }
  if (beta < 0 || beta > 1) {
    return { incentive: 0, eligible: false, beta, pct, minBeta, sharing, reason: 'β out of range (0–1)' };
  }
  if (beta <= minBeta) {
    return {
      incentive: 0,
      eligible: false,
      beta,
      pct,
      minBeta,
      sharing,
      reason: `β ${beta.toFixed(2)} ≤ ${minBeta} — incentive not payable`,
    };
  }
  const base = Number(monthlyCapacityCharge) || 0;
  const incentive = Math.round((pct / 100) * beta * sharing * base);
  return {
    incentive,
    eligible: true,
    beta,
    pct,
    minBeta,
    sharing,
    reason: `legacy: (${pct}% × β ${beta.toFixed(2)} × ${sharing} × monthly capacity)`,
  };
}

/** Sum incentive already billed on non-cancelled invoices for contract/period/direction. */
export function billedIncentiveTotal(contractId, periodMonth, direction) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(incentive_charges), 0) AS s
    FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = ?
      AND status != 'CANCELLED'
  `).get(contractId, periodMonth, direction);
  return row?.s || 0;
}
