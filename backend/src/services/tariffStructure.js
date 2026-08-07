// Tariff structures a contract can be billed on.
//
// A contract carries tariff_type and, where the structure needs more than one
// number, tariff_structure_json. Billing asked only for tariff_per_unit before
// this, which meant an escalating or two-part contract was silently billed at
// its base rate for its whole tenure.
//
//   FLAT       one rate for the tenure
//   ESCALATING a base rate stepped up a fixed percent each contract year
//   TWO_PART   an annual fixed charge plus a variable rate on energy
//
// The contract year is counted from the tenure start, not the calendar year: a
// contract starting in April is in year 2 the following April, not the following
// January.

function parseStructure(contract) {
  if (!contract.tariff_structure_json) return null;
  try {
    const parsed = JSON.parse(contract.tariff_structure_json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;   // a malformed structure falls back to the flat rate
  }
}

/** 1 for the first contract year, 2 for the second, and so on. */
export function contractYearFor(periodMonth, tenureStart) {
  if (!periodMonth || !tenureStart) return 1;
  const [py, pm] = String(periodMonth).split('-').map(Number);
  const [sy, sm] = String(tenureStart).slice(0, 7).split('-').map(Number);
  if (!py || !pm || !sy || !sm) return 1;
  const months = (py - sy) * 12 + (pm - sm);
  return months < 0 ? 1 : Math.floor(months / 12) + 1;
}

/**
 * What to bill this period on, for the structure the contract is on.
 *
 * Returns the per-unit rate to apply to energy, plus any fixed charge for the
 * period, and a label explaining how the rate was arrived at so it can be shown
 * on the bill rather than appearing as an unexplained number.
 */
export function resolveTariff(contract, periodMonth) {
  const base = Number(contract.tariff_per_unit) || 0;
  const structure = parseStructure(contract);
  const type = String(contract.tariff_type || structure?.type || 'FLAT').toUpperCase();
  const year = contractYearFor(periodMonth, contract.tenure_start);

  if (type === 'ESCALATING') {
    const from = Number(structure?.base ?? base) || 0;
    const pct = Number(structure?.escalation_pct ?? 0) || 0;
    // Year 1 bills at the base; each further year compounds the escalation.
    const rate = Number((from * Math.pow(1 + pct / 100, year - 1)).toFixed(4));
    return {
      type, rate, fixed_charge: 0, contract_year: year,
      label: `Escalating tariff — year ${year}, base ₹${from}/unit +${pct}%/yr`,
    };
  }

  if (type === 'TWO_PART') {
    const variable = Number(structure?.variable_per_unit ?? base) || 0;
    // The fixed leg is stated annually and billed across the year's periods.
    const annualFixed = Number(structure?.fixed_annual ?? contract.annual_afc ?? 0) || 0;
    const periodsPerYear = String(contract.billing_cycle || 'MONTHLY').toUpperCase() === 'QUARTERLY' ? 4 : 12;
    return {
      type, rate: variable, fixed_charge: Math.round(annualFixed / periodsPerYear), contract_year: year,
      label: `Two-part tariff — ₹${variable}/unit variable, ₹${annualFixed}/yr fixed`,
    };
  }

  return { type: 'FLAT', rate: base, fixed_charge: 0, contract_year: year, label: `Flat tariff ₹${base}/unit` };
}
