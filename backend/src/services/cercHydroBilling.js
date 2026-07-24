/**
 * CERC Hydro / PSP billing helpers (NJHPS-style Tariff Regulations 2024).
 *
 * Capacity (month): AFC * 0.5 * NDM/NDY * (PAFM / NAPAF)
 * ECR (Rs/kWh):     AFC * 0.5 * 10 / { DE_MWh * (100-AUX) * (100-FEHS) }
 * Beta incentive:   (pct * beta * sharing * AFC) / 12   (SJVN sharing default 0.5)
 *
 * Energy from REA is treated as ex-bus scheduled (E1); free power is carved out
 * for saleable energy ? do NOT also subtract a rupee "FP deduction".
 */
import { computeBetaFromAnnualAfc } from './betaFactor.js';

export function daysInMonth(periodMonth) {
  const m = String(periodMonth || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return 30;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return new Date(y, mo, 0).getDate();
}

export function daysInYear(periodMonth) {
  const m = String(periodMonth || '').match(/^(\d{4})-/);
  const y = m ? Number(m[1]) : new Date().getFullYear();
  return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
}

/** Resolve annual AFC: prefer annual_afc, else legacy capacity_charges_total * 12. */
export function resolveAnnualAfc(contract) {
  if (contract?.annual_afc != null && Number(contract.annual_afc) > 0) {
    return Number(contract.annual_afc);
  }
  if (contract?.capacity_charges_total != null && Number(contract.capacity_charges_total) > 0) {
    return Number(contract.capacity_charges_total) * 12;
  }
  return 0;
}

export function computeEcr(afc, designEnergyMwh, auxPct, fehsPct) {
  const de = Number(designEnergyMwh) || 0;
  const aux = Number(auxPct) || 0;
  const fehs = Number(fehsPct) || 0;
  const denom = de * (100 - aux) * (100 - fehs);
  if (!(afc > 0) || !(denom > 0)) return null;
  return Math.round(((afc * 0.5 * 10) / denom) * 1000) / 1000;
}

export function computeCercHydroBill({
  contract,
  periodMonth,
  exBusEnergyMwh,
  pafmPercent,
  betaValue,
}) {
  const afc = resolveAnnualAfc(contract);
  const aux = Number(contract.normative_aux) || 0;
  const fehs = Number(contract.free_energy_home_state) || 0;
  const napaf = Number(contract.napaf_percent) || 87;
  const de = Number(contract.annual_design_energy_mwh) || 0;
  const ndm = daysInMonth(periodMonth);
  const ndy = daysInYear(periodMonth);
  const pafm = (pafmPercent != null && Number.isFinite(Number(pafmPercent)))
    ? Number(pafmPercent)
    : napaf;

  const useFullFormula = afc > 0 && de > 0;

  let capacityCharges = 0;
  let capacityLabel = 'Monthly Capacity Charge';
  if (afc > 0) {
    const ratio = (pafm / (napaf || 1));
    capacityCharges = Math.round(afc * 0.5 * (ndm / ndy) * ratio);
    capacityLabel = `Capacity Charge (AFC*0.5*${ndm}/${ndy}*PAFM ${pafm.toFixed(2)}/NAPAF ${napaf})`;
  } else if (contract.capacity_charges_total) {
    capacityCharges = Math.round(Number(contract.capacity_charges_total));
    capacityLabel = 'Monthly Capacity Charge (AFC/12 legacy)';
  }

  let ecr = computeEcr(afc, de, aux, fehs);
  if (ecr == null) ecr = Number(contract.tariff_per_unit) || 0;

  const e1 = Math.round((Number(exBusEnergyMwh) || 0) * 1000) / 1000;
  const freeMwh = Math.round((e1 * fehs / 100) * 1000) / 1000;
  const saleableMwh = Math.round((e1 - freeMwh) * 1000) / 1000;
  const energyCharges = Math.round(saleableMwh * 1000 * ecr);

  const beta = computeBetaFromAnnualAfc(afc, betaValue, contract.project_type);

  return {
    afc,
    aux,
    fehs,
    napaf,
    de,
    ndm,
    ndy,
    pafm,
    ecr,
    useFullFormula,
    capacityCharges,
    capacityLabel,
    e1,
    freeMwh,
    saleableMwh,
    energyCharges,
    freePowerDeduction: 0,
    incentiveCharges: beta.incentive,
    beta,
  };
}
