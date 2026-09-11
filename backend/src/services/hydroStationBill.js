/**
 * NJHPS-style hydro station bill.
 *
 * The bill SJVN's Commercial & System Operation Department issues for a hydro
 * station is computed once for the whole station and then split across the
 * beneficiaries of that station. This module does both halves:
 *
 *   computeStationBill()      the A / C / E / EE blocks — the station's charges
 *   allocateBeneficiaries()   the beneficiary-wise breakup those charges split into
 *
 * The formulae are the ones printed on the bill itself (the May-2026 revision
 * bill spells each of them out beside its row), and they are CERC Tariff
 * Regulations 2024 for a hydro generating station:
 *
 *   A5   = DE x (100 - AUX) / 100                                      MWh
 *   A6   = DE x (100 - AUX) x (100 - FEHS) / 10000                     MWh
 *   A12  = AFC x 0.5 x 10 / { DE x (100 - AUX) x (100 - FEHS) }        Rs/kWh
 *   C2   = AFC x 0.5 x NDM / NDY x (PAFM / NAPAF)                      Rs
 *   C4   = 3% x beta x 0.5 x AFC / 12                                  Rs
 *   E3   = E1 - E2                                                     kWh
 *   E7   = cumulative saleable - annual saleable design energy         kWh
 *   EE1  = E8 x A12,   EE2 = E7 x A13                                  Rs
 *
 * Half of AFC is recovered through the capacity charge and half through the
 * energy charge, which is why 0.5 appears in both C2 and A12: deriving the ECR
 * from the same AFC is what keeps the two halves adding back to one AFC.
 *
 * Energy is in kWh throughout, matching the printed bill. Design energy (A2,
 * A5, A6) stays in MWh, also as printed.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { daysInMonth, daysInYear, resolveAnnualAfc } from './cercHydroBilling.js';
import { computeBetaFromAnnualAfc } from './betaFactor.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Rupees are billed to the paisa. */
const money = (v) => Math.round(num(v) * 100) / 100;

/** kWh is printed to one decimal on the bill. */
const kwh = (v) => Math.round(num(v) * 10) / 10;

/** Allocation percentages carry six decimals on the REA sheet. */
const pct = (v) => Math.round(num(v) * 1e6) / 1e6;

/**
 * The financial year a billing month falls in. April starts the year, so
 * 2026-06 is FY 2026-2027 and 2027-03 is still FY 2026-2027 — which matters
 * because the annual design energy cap (A6) resets with the financial year.
 */
export function financialYearOf(periodMonth) {
  const m = String(periodMonth || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = mo >= 4 ? y : y - 1;
  return `${start}-${start + 1}`;
}

/** The months of a financial year, in billing order, as YYYY-MM. */
export function monthsOfFinancialYear(fy) {
  const m = String(fy || '').match(/^(\d{4})-(\d{4})$/);
  if (!m) return [];
  const start = Number(m[1]);
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const mo = ((3 + i) % 12) + 1;
    const y = mo >= 4 ? start : start + 1;
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Energy Charge Rate, Rs/kWh, rounded to the three decimals the bill prints.
 *
 * The rounding is not cosmetic: the bill states EE1 as E8 x A12, and A12 is the
 * three-decimal rate on its face. Billing on the unrounded rate instead moves
 * NJHPS's monthly energy charge by more than a lakh of rupees against the
 * issued bill, so the printed rate is the rate.
 */
export function computeEcr3(afc, designEnergyMwh, auxPct, fehsPct) {
  const denom = num(designEnergyMwh) * (100 - num(auxPct)) * (100 - num(fehsPct));
  if (!(num(afc) > 0) || !(denom > 0)) return null;
  return Math.round(((num(afc) * 0.5 * 10) / denom) * 1000) / 1000;
}

/**
 * Split `total` across `weights` so the parts sum to exactly `total`.
 *
 * Apportioning a bill by percentages that are themselves rounded to six
 * decimals leaves a residue of a few rupees. Dropping it would mean the
 * beneficiary rows do not add up to the station's charge — the first thing
 * anyone checking the bill adds up — so it is carried to the largest share,
 * where it is proportionally smallest.
 */
export function apportion(total, weights, round = money) {
  const w = weights.map(num);
  const sum = w.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return w.map(() => 0);
  const parts = w.map((x) => round((num(total) * x) / sum));
  const residue = round(num(total) - parts.reduce((a, b) => a + b, 0));
  if (residue !== 0) {
    let big = 0;
    for (let i = 1; i < w.length; i += 1) if (w[i] > w[big]) big = i;
    parts[big] = round(parts[big] + residue);
  }
  return parts;
}

/**
 * Derive the charging percentages from the stored REA allocation.
 *
 * Only pct_rea (allocation sheet column B) is held in the master. The free
 * energy to the home state is carved out of the home state's own share, and
 * the remainder is scaled back up to 100% so it can apportion charges:
 *
 *   C = B, less FEHS for the home state          -> sums to 100 - FEHS
 *   D = C / (1 - FEHS/100)                       -> sums to 100
 *
 * On NJHPS with FEHS 12: GoHP's 34.000000 becomes 22.000000 and then 25.000000,
 * while Chandigarh's 1.714551 passes through to 1.948353.
 */
export function deriveAllocationColumns(rows, fehsPct) {
  const fehs = num(fehsPct);
  const retained = (100 - fehs) / 100;
  if (!(retained > 0)) throw new Error(`Free energy to home state is ${fehs}% — nothing is left to bill`);
  return rows.map((r) => {
    const b = num(r.pct_rea);
    const c = r.is_home_state ? b - fehs : b;
    if (c < 0) {
      throw new Error(
        `Home state ${r.beneficiary_name} holds ${b}% of the station but ${fehs}% free energy is carved out of it`,
      );
    }
    return { ...r, pct_rea: pct(b), pct_excl_free: pct(c), pct_proportionate: pct(c / retained) };
  });
}

/**
 * The allocation master in force for a station on a given month, with the
 * charging percentages derived.
 */
export function getAllocations(contractId, periodMonth, fehsPct) {
  const asOf = `${periodMonth}-01`;
  const rows = db.prepare(`
    SELECT * FROM hydro_beneficiary_allocations
    WHERE contract_id = ? AND is_active = 1
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY COALESCE(sr_no, 9999), beneficiary_name
  `).all(contractId, asOf, asOf);
  return deriveAllocationColumns(rows, fehsPct);
}

/**
 * Energy billed for this station earlier in the same financial year.
 *
 * The cumulative rows E4 and E5 on the bill are running totals across the
 * financial year, and E7 — energy beyond the annual design energy — is only
 * meaningful against them. Reading them back off the issued bills is what keeps
 * a month from being billed as if it were the first of the year.
 *
 * Revisions are excluded: a revision restates a month that is already counted,
 * so adding it would count that month twice.
 */
export function priorCumulative(contractId, periodMonth, { excludeBillId = null } = {}) {
  const fy = financialYearOf(periodMonth);
  const months = monthsOfFinancialYear(fy).filter((m) => m < periodMonth);
  if (!months.length) return { scheduled: 0, free: 0, months: [] };
  const placeholders = months.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT billing_month, e1_ex_bus_scheduled_kwh, e2_free_power_kwh
    FROM hydro_station_bills
    WHERE contract_id = ? AND status <> 'CANCELLED' AND bill_kind <> 'REVISION'
      AND billing_month IN (${placeholders})
      AND (? IS NULL OR id <> ?)
    ORDER BY billing_month
  `).all(contractId, ...months, excludeBillId, excludeBillId);
  return {
    scheduled: kwh(rows.reduce((a, r) => a + num(r.e1_ex_bus_scheduled_kwh), 0)),
    free: kwh(rows.reduce((a, r) => a + num(r.e2_free_power_kwh), 0)),
    months: rows.map((r) => r.billing_month),
  };
}

/**
 * Compute the station's charges for one month.
 *
 * `contract` supplies the tariff constants (AFC, design energy, AUX, FEHS,
 * NAPAF, installed capacity). Everything that varies month to month — the
 * scheduled energy, the achieved availability, the certified beta — is passed
 * in, because it comes off the Regional Energy Account rather than the contract.
 */
export function computeStationBill({
  contract,
  periodMonth,
  exBusScheduledKwh,
  freePowerKwh,
  pafmPercent,
  betaValue,
  priorScheduledKwh = 0,
  priorFreeKwh = 0,
  ecrExcessOverride = null,
  nrldcTotalFee = 0,
  ursNrKwh = 0,
}) {
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) {
    throw new Error(`billing_month must be YYYY-MM, got "${periodMonth}"`);
  }

  const afc = resolveAnnualAfc(contract);
  const de = num(contract.annual_design_energy_mwh);
  const aux = num(contract.normative_aux);
  const fehs = num(contract.free_energy_home_state);
  const napaf = num(contract.napaf_percent) || 87;
  const ic = num(contract.capacity_mw) || null;

  if (!(afc > 0)) throw new Error('Contract has no Annual Fixed Charges (AFC) — set annual_afc before billing');
  if (!(de > 0)) throw new Error('Contract has no Annual Design Energy — set annual_design_energy_mwh before billing');
  if (!(napaf > 0)) throw new Error('Contract has no NAPAF — set napaf_percent before billing');

  const ndm = daysInMonth(periodMonth);
  const ndy = daysInYear(periodMonth);

  // ─── A block: the tariff constants and the rates that fall out of them ───
  const a5 = (de * (100 - aux)) / 100;
  const a6 = (de * (100 - aux) * (100 - fehs)) / 10000;
  const a12 = computeEcr3(afc, de, aux, fehs);
  if (a12 == null) throw new Error('Energy Charge Rate could not be derived — check AFC, design energy, AUX and FEHS');
  // Energy beyond the annual design energy has its own rate. NJHPS prints A12
  // and A13 equal, so falling back to A12 is right there — but Rampur bills the
  // excess at 1.300 against 2.425 up to the cap, so the station's own rate is
  // taken from the contract before that fallback applies.
  const a13 = ecrExcessOverride != null && ecrExcessOverride !== ''
    ? num(ecrExcessOverride)
    : (num(contract.ecr_excess_rate) > 0 ? num(contract.ecr_excess_rate) : a12);

  // ─── C block: capacity charges, inclusive of the beta incentive ───
  // PAFM defaults to NAPAF so a month whose availability has not yet been
  // certified bills at normative rather than at zero.
  const pafm = pafmPercent == null || pafmPercent === '' ? napaf : num(pafmPercent);
  const c2 = money(afc * 0.5 * (ndm / ndy) * (pafm / napaf));
  const beta = computeBetaFromAnnualAfc(afc, betaValue, contract.project_type);
  const c4 = money(beta.incentive);
  const c5 = money(c2 + c4);

  // ─── E block: energy, this month and cumulative for the financial year ───
  const e1 = kwh(exBusScheduledKwh);
  // The REA states the free power actually accounted; falling back to the
  // contracted FEHS keeps a month billable before the REA carries that line.
  const e2 = freePowerKwh == null || freePowerKwh === '' ? kwh((e1 * fehs) / 100) : kwh(freePowerKwh);
  if (e2 > e1) throw new Error(`Free power (${e2} kWh) exceeds the energy scheduled for the month (${e1} kWh)`);
  const e3 = kwh(e1 - e2);

  // Un-requisitioned surplus — energy the station scheduled that no beneficiary
  // is billed for, because its supply was regulated. It comes off the saleable
  // energy before anything is charged on it; on a month with no regulation it is
  // zero and every figure below is exactly what it would have been without it.
  const urs = kwh(ursNrKwh);
  if (urs < 0) throw new Error('Un-requisitioned surplus cannot be negative');
  if (urs > e3) {
    throw new Error(`Un-requisitioned surplus (${urs} kWh) exceeds the saleable energy for the month (${e3} kWh)`);
  }
  const e3Billable = kwh(e3 - urs);

  const e4 = kwh(num(priorScheduledKwh) + e1);
  const e5 = kwh(num(priorFreeKwh) + e2);
  const e6 = kwh(e4 - e5);

  // Energy beyond the station's annual saleable design energy. The bill states
  // this as {cumulative saleable} - {annual saleable design energy}; capping it
  // at this month's saleable energy is what that means once the cap has already
  // been passed in an earlier month, when the whole of this month is beyond it.
  const annualSaleableKwh = a6 * 1000;
  const e7 = kwh(Math.min(e3Billable, Math.max(0, e6 - annualSaleableKwh)));
  const e8 = kwh(e3Billable - e7);

  // ─── EE block ───
  const ee1 = money(e8 * a12);
  const ee2 = money(e7 * a13);
  const total = money(c5 + ee1 + ee2);

  return {
    financial_year: financialYearOf(periodMonth),
    a1_afc: money(afc),
    a2_design_energy_mwh: de,
    a3_aux_pct: aux,
    a4_fehs_pct: fehs,
    a5_ex_bus_design_energy_mwh: Math.round(a5 * 1000) / 1000,
    a6_ex_bus_saleable_design_energy_mwh: Math.round(a6 * 1000) / 1000,
    a7_installed_capacity_mw: ic,
    a8_days_in_month: ndm,
    a9_days_in_year: ndy,
    a11_napaf_pct: napaf,
    a12_ecr: a12,
    a13_ecr_excess: a13,

    c1_pafm_pct: Math.round(pafm * 1000) / 1000,
    c2_capacity_charge: c2,
    c3_beta_factor: beta.beta,
    c4_beta_incentive: c4,
    c4_beta_note: beta.eligible ? `β ${beta.beta} — incentive payable` : beta.reason,
    c5_total_capacity_charge: c5,

    e1_ex_bus_scheduled_kwh: e1,
    e2_free_power_kwh: e2,
    e3_saleable_scheduled_kwh: e3,
    urs_nr_kwh: urs,
    // What the beneficiaries are actually billed on, once the regulated energy
    // is out. Equal to E3 whenever nothing was regulated.
    e3_billable_kwh: e3Billable,
    e4_cum_scheduled_kwh: e4,
    e5_cum_free_power_kwh: e5,
    e6_cum_saleable_kwh: e6,
    e7_excess_kwh: e7,
    e8_upto_design_kwh: e8,

    ee1_energy_charge: ee1,
    ee2_excess_energy_charge: ee2,
    total_charges: total,
    nrldc_total_fee: money(nrldcTotalFee),

    // Not persisted — the annual cap the E7/E8 split was made against, which is
    // worth showing on screen but is a restatement of A6.
    _annualSaleableKwh: annualSaleableKwh,
  };
}

/**
 * Each beneficiary's ex-bus saleable scheduled energy for the month.
 *
 * The authoritative figure is the Regional Energy Account's own table D2,
 * "Energy Scheduled To the Beneficiaries from CS Hydro Stations", which states
 * it per beneficiary rather than leaving it to be derived. Deriving it from the
 * allocation percentage instead lands a few thousand kWh out — on NJHPS for
 * June 2026 the REA gives Chandigarh 12,539,615 kWh where the percentage gives
 * 12,536,087, because a share rounded to six decimals is not the number the
 * energy was actually scheduled on.
 *
 * So the REA's figures are used whenever the desk supplies them, and the
 * percentage split remains the fallback for a month whose D2 is not to hand.
 *
 * Supplying them is all-or-nothing and has to add up to E3: a partly-keyed
 * column that silently derived the rest would tie to the station total while
 * being wrong beneficiary by beneficiary, which is precisely the failure this
 * exists to remove.
 */
function resolveActualEnergy(bill, allocations, weights, scheduledEnergy) {
  if (!scheduledEnergy || Object.keys(scheduledEnergy).length === 0) {
    return apportion(bill.e3_saleable_scheduled_kwh, weights, kwh);
  }

  // The REA prints "J&K" where the allocation sheet says "J & K", and
  // "Chandigarh" where it says "CHANDIGARH". Making the desk retype a pasted
  // column to match is how a figure lands on the wrong row, so a name that is
  // not an exact match is matched on its letters and digits alone. Two
  // beneficiaries that would read the same that way are never guessed between.
  const nameKey = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const exact = new Set(allocations.map((r) => r.beneficiary_name));
  const byKey = new Map();
  for (const r of allocations) {
    const k = nameKey(r.beneficiary_name);
    byKey.set(k, byKey.has(k) ? null : r.beneficiary_name); // null: more than one reads this way
  }

  const energy = {};
  const pastedAs = {};
  const strays = [];
  for (const [name, value] of Object.entries(scheduledEnergy)) {
    const match = exact.has(name) ? name : byKey.get(nameKey(name));
    if (match === null) {
      throw new Error(`"${name}" could be more than one beneficiary of this station — enter it exactly as the allocation names it`);
    }
    if (match === undefined) { strays.push(name); continue; }
    if (match in energy) {
      throw new Error(`Scheduled energy for ${match} was given twice, as "${pastedAs[match]}" and "${name}"`);
    }
    energy[match] = value;
    pastedAs[match] = name;
  }
  if (strays.length) {
    throw new Error(
      `Scheduled energy was given for ${strays.join(', ')}, which ${strays.length === 1 ? 'is not a beneficiary' : 'are not beneficiaries'} of this station`,
    );
  }

  const missing = allocations.filter((r) => energy[r.beneficiary_name] == null);
  if (missing.length) {
    throw new Error(
      `Scheduled energy is missing for ${missing.map((r) => r.beneficiary_name).join(', ')} — give the REA figure for every beneficiary, or none and let it be derived`,
    );
  }

  const values = allocations.map((r) => {
    const v = kwh(energy[r.beneficiary_name]);
    if (v < 0) throw new Error(`${r.beneficiary_name} has negative scheduled energy`);
    return v;
  });

  const total = kwh(values.reduce((a, b) => a + b, 0));
  const e3 = kwh(bill.e3_saleable_scheduled_kwh);
  if (Math.abs(total - e3) > 1) {
    throw new Error(
      `Scheduled energy totals ${total} kWh across the beneficiaries but the station's saleable energy for the month is ${e3} kWh — the two must agree`,
    );
  }
  return values;
}

/**
 * Split the station's charges across its beneficiaries.
 *
 * Charges are apportioned on the proportionate percentage (column D), which is
 * the allocation net of free power scaled back to 100%. NRLDC fees are split on
 * the REA percentage (column B) instead: those fees are levied on the station's
 * whole capacity allocation, free power included, so the home state carries its
 * full share of them.
 */
export function allocateBeneficiaries(bill, allocations, { deductions = null, scheduledEnergy = null } = {}) {
  if (!allocations.length) throw new Error('No beneficiary allocation is in force for this station and month');

  const totalD = allocations.reduce((a, r) => a + num(r.pct_proportionate), 0);
  const totalB = allocations.reduce((a, r) => a + num(r.pct_rea), 0);
  // A percentage set that does not close on 100 would silently under- or
  // over-bill the station, so it is refused rather than normalised away.
  if (Math.abs(totalD - 100) > 0.01) {
    throw new Error(`Beneficiary allocations total ${totalD.toFixed(6)}% of charges, not 100% — fix the allocation master`);
  }
  if (Math.abs(totalB - 100) > 0.01) {
    throw new Error(`REA allocations total ${totalB.toFixed(6)}%, not 100% — fix the allocation master`);
  }

  const w = allocations.map((r) => num(r.pct_proportionate));
  const wRea = allocations.map((r) => num(r.pct_rea));

  const capacity = apportion(bill.c5_total_capacity_charge, w);
  const nrldc = apportion(bill.nrldc_total_fee, wRea);

  // ─── Regulation of power ───
  // Each beneficiary's entitlement on its share is the ACTUAL SCHEDULED ENERGY
  // of the exclusion screen; what is withheld from a regulated beneficiary is
  // the DEDUCTED SCHEDULED ENERGY, and what is left is what it is billed for.
  const urs = kwh(bill.urs_nr_kwh ?? 0);
  const actual = resolveActualEnergy(bill, allocations, w, scheduledEnergy);
  const deducted = allocations.map((r) => kwh(deductions?.[r.beneficiary_name] ?? 0));

  const deductedTotal = kwh(deducted.reduce((a, b) => a + b, 0));
  // The two figures the desk is told to reconcile: what was taken off the
  // regulated beneficiaries has to be exactly the surplus the REA reports, or
  // the station is billing for energy it did not allocate to anyone.
  if (Math.abs(deductedTotal - urs) > 0.1) {
    throw new Error(
      `Deducted scheduled energy totals ${deductedTotal} kWh but the un-requisitioned surplus is ${urs} kWh — the two must agree before the bill can be raised`,
    );
  }
  for (let i = 0; i < allocations.length; i += 1) {
    if (deducted[i] < 0) {
      throw new Error(`${allocations[i].beneficiary_name} has a negative deduction`);
    }
    if (deducted[i] > actual[i] + 0.1) {
      throw new Error(
        `${allocations[i].beneficiary_name} was scheduled ${actual[i]} kWh but ${deducted[i]} kWh is being deducted from it`,
      );
    }
  }

  // What is left after the deduction is what carries the energy charge, so the
  // billed column adds to the station's own billable energy rather than to E3.
  // With nothing regulated this is the entitlement unchanged, so one expression
  // covers both cases.
  const saleable = actual.map((a, i) => kwh(a - deducted[i]));
  const upto = apportion(bill.e8_upto_design_kwh, saleable, kwh);
  const excess = apportion(bill.e7_excess_kwh, saleable, kwh);

  // The energy charges are each beneficiary's own energy at the station's rate,
  // trued up to the station total so the columns add back to EE1 and EE2. When
  // a band carries no energy its charge is zero on both sides, so apportioning
  // over all-zero weights is correct rather than a lost remainder.
  const chargeUpto = apportion(bill.ee1_energy_charge, upto);
  const chargeExcess = apportion(bill.ee2_excess_energy_charge, excess);

  return allocations.map((r, i) => {
    const energyTotal = money(chargeUpto[i] + chargeExcess[i]);
    return {
      sr_no: r.sr_no || i + 1,
      beneficiary_name: r.beneficiary_name,
      beneficiary_id: r.beneficiary_id || null,
      parent_state: r.parent_state || null,
      pct_incl_free: r.pct_incl_free == null ? null : pct(r.pct_incl_free),
      pct_rea: r.pct_rea,
      pct_excl_free: r.pct_excl_free,
      pct_proportionate: r.pct_proportionate,
      capacity_charge: capacity[i],
      actual_scheduled_energy_kwh: actual[i],
      deducted_scheduled_energy_kwh: deducted[i],
      is_regulated: deducted[i] > 0 ? 1 : 0,
      saleable_energy_kwh: saleable[i],
      energy_upto_design_kwh: upto[i],
      energy_excess_kwh: excess[i],
      energy_charge_upto: chargeUpto[i],
      energy_charge_excess: chargeExcess[i],
      energy_charge_total: energyTotal,
      nrldc_fee: nrldc[i],
      total_charges: money(capacity[i] + energyTotal),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The NJHPS beneficiary allocation as it stands on the provisional REA for
 * FY 2026-2027.
 *
 * These are the fifteen billing parties on the station's bill: eleven state
 * beneficiaries, with Delhi and Rajasthan each billed through their discoms.
 * pct_rea is column B of the allocation sheet — after the share of Sale of
 * Rights has been reallocated to HPSEB, which is why GoHP shows 34.000000 here
 * against 36.470000 on the raw allocation and HPSEB shows 2.470000 against nil.
 */
const NJHPS_ALLOCATIONS = [
  { sr_no: 1, beneficiary_name: 'CHANDIGARH', pct_incl_free: 1.714551, pct_rea: 1.714551 },
  { sr_no: 2, beneficiary_name: 'TPDDL', parent_state: 'DELHI', pct_incl_free: 2.905400, pct_rea: 2.905400 },
  { sr_no: 3, beneficiary_name: 'BSES RAJDHANI POWER', parent_state: 'DELHI', pct_incl_free: 5.851416, pct_rea: 5.851416 },
  { sr_no: 4, beneficiary_name: 'BSES YAMUNA POWER', parent_state: 'DELHI', pct_incl_free: 2.405400, pct_rea: 2.405400 },
  { sr_no: 5, beneficiary_name: 'GoHP', pct_incl_free: 36.470000, pct_rea: 34.000000, is_home_state: 1 },
  { sr_no: 6, beneficiary_name: 'HPSEB', pct_incl_free: 0.000000, pct_rea: 2.470000 },
  { sr_no: 7, beneficiary_name: 'HARYANA', pct_incl_free: 5.750689, pct_rea: 5.750689 },
  { sr_no: 8, beneficiary_name: 'J & K', pct_incl_free: 7.423054, pct_rea: 7.423054 },
  { sr_no: 9, beneficiary_name: 'PUNJAB', pct_incl_free: 11.356856, pct_rea: 11.356856 },
  { sr_no: 10, beneficiary_name: 'MPPMCL', pct_incl_free: 0.172814, pct_rea: 0.172814 },
  { sr_no: 11, beneficiary_name: 'AJMER VVNL', parent_state: 'RAJASTHAN', pct_incl_free: 2.810239, pct_rea: 2.810239 },
  { sr_no: 12, beneficiary_name: 'JAIPUR VVNL', parent_state: 'RAJASTHAN', pct_incl_free: 3.964832, pct_rea: 3.964832 },
  { sr_no: 13, beneficiary_name: 'JODHPUR VVNL', parent_state: 'RAJASTHAN', pct_incl_free: 3.598641, pct_rea: 3.598641 },
  { sr_no: 14, beneficiary_name: 'UTTARAKHAND', pct_incl_free: 0.846108, pct_rea: 0.846108 },
  { sr_no: 15, beneficiary_name: 'UTTAR PRADESH', pct_incl_free: 14.730000, pct_rea: 14.730000 },
];

const NJHPS_SOURCE = 'Provisional REA, NJHPS, FY 2026-2027 — weighted average capacity allocation '
  + 'including 22% equity and 12% free power, after allocating the SoR share to HPSEB';

/**
 * The RHPS beneficiary allocation, from the station's August 2026 bill.
 *
 * Thirteen billing parties, not NJHPS's fifteen, and the differences are the
 * point: Rampur's Delhi share sits entirely with BSES Rajdhani rather than
 * splitting three ways, its Sale of Rights reallocation to HPSEB is 2.810000
 * against NJHPS's 2.470000, and its free energy to the home state is 13% — so
 * GoHP's 39.100000 here becomes 26.100000 net of it, where the same arithmetic
 * on NJHPS uses 12%. Rajasthan splits on the same discom shares as NJHPS
 * (27.090 / 38.220 / 34.690).
 */
const RHPS_ALLOCATIONS = [
  { sr_no: 1, beneficiary_name: 'CHANDIGARH', pct_incl_free: 1.091914, pct_rea: 1.091914 },
  { sr_no: 2, beneficiary_name: 'GoHP', pct_incl_free: 41.910000, pct_rea: 39.100000, is_home_state: 1 },
  { sr_no: 3, beneficiary_name: 'HPSEB', pct_incl_free: 0.000000, pct_rea: 2.810000 },
  { sr_no: 4, beneficiary_name: 'HARYANA', pct_incl_free: 5.514893, pct_rea: 5.514893 },
  { sr_no: 5, beneficiary_name: 'J & K', pct_incl_free: 7.509969, pct_rea: 7.509969 },
  { sr_no: 6, beneficiary_name: 'PUNJAB', pct_incl_free: 7.530850, pct_rea: 7.530850 },
  { sr_no: 7, beneficiary_name: 'MPPMCL', pct_incl_free: 0.157719, pct_rea: 0.157719 },
  { sr_no: 8, beneficiary_name: 'AJMER VVNL', parent_state: 'RAJASTHAN', pct_incl_free: 2.813236, pct_rea: 2.813236 },
  { sr_no: 9, beneficiary_name: 'JAIPUR VVNL', parent_state: 'RAJASTHAN', pct_incl_free: 3.969063, pct_rea: 3.969063 },
  { sr_no: 10, beneficiary_name: 'JODHPUR VVNL', parent_state: 'RAJASTHAN', pct_incl_free: 3.602479, pct_rea: 3.602479 },
  { sr_no: 11, beneficiary_name: 'UTTARAKHAND', pct_incl_free: 10.580000, pct_rea: 10.580000 },
  { sr_no: 12, beneficiary_name: 'UTTAR PRADESH', pct_incl_free: 13.760000, pct_rea: 13.760000 },
  { sr_no: 13, beneficiary_name: 'BSES RAJDHANI POWER', parent_state: 'DELHI', pct_incl_free: 1.559877, pct_rea: 1.559877 },
];

const RHPS_SOURCE = 'Provisional REA, RHPS, FY 2026-2027 — weighted average capacity allocation '
  + 'including 26.1% equity and 13% free power, after allocating the SoR share to HPSEB';

/**
 * Lay out the NJHPS allocation master once.
 *
 * Idempotent on (contract, beneficiary, effective_from), so a desk that has
 * corrected a percentage never has it reset on restart.
 */
export function seedNjhpsAllocations() {
  return seedStationAllocations('PPA/SJVN/NJHPS/001', NJHPS_ALLOCATIONS, NJHPS_SOURCE)
    + seedStationAllocations('PPA/SJVN/RHPS/001', RHPS_ALLOCATIONS, RHPS_SOURCE);
}

function seedStationAllocations(contractNo, rows, sourceNote) {
  const contract = db.prepare('SELECT id FROM contracts WHERE contract_no = ?').get(contractNo);
  if (!contract) return 0;

  const effectiveFrom = '2026-04-01';
  const exists = db.prepare(`
    SELECT 1 FROM hydro_beneficiary_allocations
    WHERE contract_id = ? AND beneficiary_name = ? AND effective_from = ? LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO hydro_beneficiary_allocations
      (id, contract_id, beneficiary_name, parent_state, sr_no, pct_incl_free, pct_rea,
       is_home_state, effective_from, source_note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYSTEM_SEED')
  `);

  let added = 0;
  const tx = db.transaction(() => {
    for (const a of rows) {
      if (exists.get(contract.id, a.beneficiary_name, effectiveFrom)) continue;
      insert.run(
        newId('HBA'), contract.id, a.beneficiary_name, a.parent_state || null, a.sr_no,
        a.pct_incl_free, a.pct_rea, a.is_home_state ? 1 : 0, effectiveFrom, sourceNote,
      );
      added += 1;
    }
  });
  tx();
  return added;
}
