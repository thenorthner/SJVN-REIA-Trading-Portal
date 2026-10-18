/**
 * The monthly two-part bill of a thermal (coal) station, on the CERC tariff:
 *
 *   Capacity charge  = AFC × NDM / NDY × (PAFM / NAPAF)
 *   Energy charge    = ECR × ex-bus scheduled energy
 *   ECR (₹/kWh)      = [ (GHR − SFC × CVSF) × LPPF / CVPF + SFC × LPSFi ] × 100 / (100 − AUX)
 *
 *   AFC   annual fixed charges (₹)            NAPAF normative availability (%)
 *   GHR   gross station heat rate (kCal/kWh)   AUX   normative auxiliary consumption (%)
 *   SFC   secondary fuel oil (ml/kWh)          CVSF  its calorific value (kCal/ml)
 *   CVPF  GCV of the coal as received, less the storage loss norm (85 kCal/kg
 *         under the CERC Tariff Regulations), kCal/kg
 *   LPPF  landed price of coal (₹/kg)
 *   LPSFi landed price of secondary oil (₹/ml)
 *
 * AFC, NAPAF and the norms are the financial year's (thermal_station_tariffs);
 * PAFM, scheduled energy and the month's fuel are entered with the bill.
 *
 * Not modelled, and said so on the bill: the split of capacity charge between
 * peak and off-peak hours, and the incentive on PLF above normative. Those are
 * billed, where they arise, on a supplementary bill.
 *
 * The result is shaped as a hydro_station_bills row so a thermal bill goes
 * through the same approval, issue, ledger, notes and recovery as a hydro one.
 */
import db from '../db/index.js';
import { getAllocations, apportion, financialYearOf } from './hydroStationBill.js';
import { daysInMonth, daysInYear } from './cercHydroBilling.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const num = (v) => (v === '' || v == null ? null : Number(v));
const fail = (message) => Object.assign(new Error(message), { status: 400 });

export const isThermal = (contract) => String(contract?.project_type || '') === 'Thermal';

/** The tariff row for the financial year a month falls in. */
export function thermalTariffFor(contractId, periodMonth) {
  return db.prepare('SELECT * FROM thermal_station_tariffs WHERE contract_id = ? AND financial_year = ?')
    .get(contractId, financialYearOf(periodMonth)) || null;
}

/** What is still missing before a thermal station can be billed for a month. */
export function thermalReadiness(contract, periodMonth = null) {
  const missing = [];
  const month = periodMonth || new Date().toISOString().slice(0, 7);
  if (!thermalTariffFor(contract.id, month)) missing.push(`Tariff for ${financialYearOf(month)} (AFC, NAPAF, heat rate, aux)`);
  const alloc = db.prepare('SELECT COUNT(*) c FROM hydro_beneficiary_allocations WHERE contract_id = ? AND is_active = 1').get(contract.id).c;
  if (!alloc) missing.push('Beneficiary allocation');
  return { ready: missing.length === 0, missing, allocation_rows: alloc };
}

/** The energy charge rate, ₹/kWh, from the norms and the month's fuel. */
export function computeEcr({ ghr, auxPct, sfc = 0, cvsf = 10, gcvKcalPerKg, coalRsPerTonne, oilRsPerKl = 0 }) {
  // A missing heat rate came back as a NaN rate, shown as nothing (Thermal QA run 1).
  if (!(ghr >= 1500 && ghr <= 4000)) throw fail('Gross station heat rate (kCal/kWh) is needed for the energy charge rate, between 1,500 and 4,000');
  if (!(gcvKcalPerKg > 0)) throw fail('GCV of coal (kCal/kg) is needed for the energy charge rate');
  if (!(coalRsPerTonne > 0)) throw fail('Landed price of coal (₹/tonne) is needed for the energy charge rate');
  if (!(auxPct >= 0 && auxPct < 100)) throw fail('Auxiliary consumption must be between 0 and 100%');
  const lppf = coalRsPerTonne / 1000;   // ₹/kg
  const lpsf = oilRsPerKl / 1e6;        // ₹/ml
  const raw = ((ghr - sfc * cvsf) * lppf) / gcvKcalPerKg + sfc * lpsf;
  return Math.round(((raw * 100) / (100 - auxPct)) * 10000) / 10000; // to 0.01 paise
}

/**
 * Compute a month's thermal bill and its beneficiary split, without saving it.
 * `body` carries the month's figures; `tariffOverride` lets an arrear be worked
 * on a revised tariff.
 */
export function buildThermalBill(contract, month, body, { tariffOverride = null } = {}) {
  const t = tariffOverride || thermalTariffFor(contract.id, month);
  if (!t) throw fail(`No thermal tariff on record for ${financialYearOf(month)} — set it under Thermal → Station & Tariff first`);

  const scheduled = num(body.ex_bus_scheduled_kwh);
  if (!(scheduled >= 0)) throw fail('Ex-bus scheduled energy (kWh) for the month is required');
  // What the plant could have sent out running flat out all month; a figure
  // above it is a typing error, and it was billed (Thermal QA run 2).
  const ceiling = Number(contract.capacity_mw) > 0 ? Number(contract.capacity_mw) * 1000 * 24 * daysInMonth(month) : null;
  if (ceiling != null && scheduled > ceiling) {
    throw fail(`Ex-bus scheduled energy ${scheduled} kWh is more than ${contract.capacity_mw} MW could generate in ${month} (${ceiling} kWh)`);
  }
  const pafm = num(body.pafm_percent);
  // A coal unit cannot be available more than all of the time; 110% is a hydro limit.
  if (!(pafm >= 0 && pafm <= 100)) throw fail('PAFM (%) for the month is required, between 0 and 100');
  const range = (v, label, min, max) => {
    if (v != null && !(v >= min && v <= max)) throw fail(`${label} ${v} is outside ${min}–${max}; check the figure`);
  };
  range(num(body.gcv_kcal_per_kg), 'GCV of coal as received (kCal/kg)', 2000, 7500);
  range(num(body.coal_rs_per_tonne), 'Landed price of coal (₹/tonne)', 500, 25000);
  range(num(body.oil_rs_per_kl), 'Landed price of secondary oil (₹/kL)', 0, 250000);

  const fuel = {
    gcv_kcal_per_kg: num(body.gcv_kcal_per_kg),
    coal_rs_per_tonne: num(body.coal_rs_per_tonne),
    oil_rs_per_kl: num(body.oil_rs_per_kl) ?? 0,
  };
  // CVPF is the GCV as received less the storage loss norm; billing the
  // received GCV whole understated the rate (Thermal QA run 1).
  const storageLoss = t.gcv_storage_loss_kcal ?? 85;
  fuel.gcv_storage_loss_kcal = storageLoss;
  fuel.cvpf_kcal_per_kg = fuel.gcv_kcal_per_kg > 0 ? fuel.gcv_kcal_per_kg - storageLoss : null;
  const ecr = computeEcr({
    ghr: t.gross_heat_rate, auxPct: t.aux_pct, sfc: t.sfc_ml_per_kwh, cvsf: t.cv_secondary_kcal_per_ml,
    gcvKcalPerKg: fuel.cvpf_kcal_per_kg, coalRsPerTonne: fuel.coal_rs_per_tonne, oilRsPerKl: fuel.oil_rs_per_kl,
  });

  const ndm = daysInMonth(month);
  const ndy = daysInYear(month);
  const capacity = money(t.annual_afc * (ndm / ndy) * (pafm / t.napaf_percent));
  const energyCharge = money(ecr * scheduled);
  const total = money(capacity + energyCharge);
  const nrldcFee = money(num(body.nrldc_total_fee) || 0);

  const allocations = getAllocations(contract.id, month, 0);
  if (!allocations.length) throw fail('No beneficiary allocation is in force for this station and month');
  const weights = allocations.map((a) => Number(a.pct_proportionate) || Number(a.pct_rea) || 0);
  const capShares = apportion(capacity, weights);
  const feeShares = apportion(nrldcFee, allocations.map((a) => Number(a.pct_rea) || 0));

  // Beneficiary energy: the REA's own figures when given (must add up to the
  // station's), otherwise split on the allocation.
  let energyKwh;
  const given = body.scheduled_energy && typeof body.scheduled_energy === 'object' ? body.scheduled_energy : null;
  if (given && Object.keys(given).length) {
    energyKwh = allocations.map((a) => Number(given[a.beneficiary_name]) || 0);
    const sum = energyKwh.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - scheduled) > 1) throw fail(`Beneficiary energy adds up to ${sum} kWh but the station scheduled ${scheduled} kWh`);
  } else {
    energyKwh = apportion(scheduled, weights, (v) => Math.round(v));
  }
  const energyShares = energyKwh.map((k) => money(k * ecr));
  // The rounding of each share is carried on the largest, so lines add to the total.
  const drift = money(energyCharge - energyShares.reduce((a, b) => a + b, 0));
  if (drift !== 0) {
    let big = 0;
    energyShares.forEach((v, i) => { if (v > energyShares[big]) big = i; });
    energyShares[big] = money(energyShares[big] + drift);
  }

  const lines = allocations.map((a, i) => ({
    sr_no: a.sr_no || i + 1,
    beneficiary_name: a.beneficiary_name,
    beneficiary_id: a.beneficiary_id || null,
    parent_state: a.parent_state || null,
    pct_incl_free: a.pct_incl_free ?? null,
    pct_rea: a.pct_rea,
    pct_excl_free: a.pct_excl_free ?? a.pct_rea,
    pct_proportionate: a.pct_proportionate ?? a.pct_rea,
    capacity_charge: capShares[i],
    saleable_energy_kwh: energyKwh[i],
    energy_upto_design_kwh: energyKwh[i],
    energy_excess_kwh: 0,
    actual_scheduled_energy_kwh: energyKwh[i],
    deducted_scheduled_energy_kwh: 0,
    is_regulated: 0,
    energy_charge_upto: energyShares[i],
    energy_charge_excess: 0,
    energy_charge_total: energyShares[i],
    nrldc_fee: feeShares[i],
    total_charges: money(capShares[i] + energyShares[i]),
  }));

  const inputs = {
    tariff: {
      financial_year: t.financial_year, annual_afc: t.annual_afc, napaf_percent: t.napaf_percent,
      gross_heat_rate: t.gross_heat_rate, aux_pct: t.aux_pct, sfc_ml_per_kwh: t.sfc_ml_per_kwh,
      cv_secondary_kcal_per_ml: t.cv_secondary_kcal_per_ml, gcv_storage_loss_kcal: storageLoss, order_ref: t.order_ref || null,
    },
    fuel,
    pafm_percent: pafm,
    ex_bus_scheduled_kwh: scheduled,
    scheduled_energy: given || null,
    nrldc_total_fee: nrldcFee,
    ecr,
    capacity_formula: `${t.annual_afc} × ${ndm}/${ndy} × ${pafm}/${t.napaf_percent}`,
    not_modelled: 'Peak / off-peak split of capacity charge and the PLF incentive are not computed on this bill.',
  };

  const bill = {
    financial_year: financialYearOf(month),
    a1_afc: t.annual_afc, a2_design_energy_mwh: 0, a3_aux_pct: t.aux_pct, a4_fehs_pct: 0,
    a5_ex_bus_design_energy_mwh: 0, a6_ex_bus_saleable_design_energy_mwh: 0,
    a7_installed_capacity_mw: contract.capacity_mw ?? null, a8_days_in_month: ndm, a9_days_in_year: ndy,
    a11_napaf_pct: t.napaf_percent, a12_ecr: ecr, a13_ecr_excess: 0,
    c1_pafm_pct: pafm, c2_capacity_charge: capacity, c3_beta_factor: null, c4_beta_incentive: 0, c4_beta_note: null,
    c5_total_capacity_charge: capacity,
    e1_ex_bus_scheduled_kwh: scheduled, e2_free_power_kwh: 0, e3_saleable_scheduled_kwh: scheduled,
    e4_cum_scheduled_kwh: scheduled, e5_cum_free_power_kwh: 0, e6_cum_saleable_kwh: scheduled,
    e7_excess_kwh: 0, e8_upto_design_kwh: scheduled, urs_nr_kwh: 0,
    ee1_energy_charge: energyCharge, ee2_excess_energy_charge: 0, total_charges: total, nrldc_total_fee: nrldcFee,
    thermal_inputs: inputs,
  };
  const sources = { tariff: `thermal tariff ${t.financial_year}${t.order_ref ? ` (${t.order_ref})` : ''}`, fuel: 'entered with the bill', energy: given ? 'REA beneficiary figures, as entered' : 'split on the allocation' };
  return { bill, lines, sources };
}

/** Recompute an issued thermal bill on a (revised) tariff, for an arrear. */
export function rebuildThermalBill(contract, basis, month) {
  const inputs = JSON.parse(basis.thermal_inputs_json || '{}');
  return buildThermalBill(contract, month, {
    ex_bus_scheduled_kwh: inputs.ex_bus_scheduled_kwh ?? basis.e1_ex_bus_scheduled_kwh,
    pafm_percent: inputs.pafm_percent ?? basis.c1_pafm_pct,
    gcv_kcal_per_kg: inputs.fuel?.gcv_kcal_per_kg,
    coal_rs_per_tonne: inputs.fuel?.coal_rs_per_tonne,
    oil_rs_per_kl: inputs.fuel?.oil_rs_per_kl,
    scheduled_energy: inputs.scheduled_energy,
    nrldc_total_fee: basis.nrldc_total_fee,
  });
}
