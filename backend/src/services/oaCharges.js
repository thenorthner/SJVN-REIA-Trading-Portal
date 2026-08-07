import { getEffectiveRate } from './rateMaster.js';

// Compute the itemised open-access charges for one application/schedule, pricing
// every leg from the effective-dated rate_master. Mirrors the ISET ledger's OA
// bill structure: ISTS and STU are per-MWh, RLDC/SLDC operating charges are
// per-day, and the NOAR application fee is a flat per-application charge.
//
// Bearer convention (overridable): the injection (from) state's STU/SLDC fall on
// the SELLER; ISTS, the drawal (to) state's STU/SLDC, RLDC and the NOAR fee fall
// on the BUYER — matching how the ledger's 200 MW Kreate applications were borne.
export function computeOaCharges({
  quantum_mwh,
  days = 1,
  on_date,
  ists_rate,                 // optional ₹/MWh override; else rate_master 'ISTS'
  injection_state,           // e.g. 'West Bengal' -> 'West Bengal STU/SLDC'
  drawal_state,              // e.g. 'Delhi'       -> 'Delhi STU/SLDC'
  include_ists = true,
  region,                    // transmission corridor (WR/NR/ER) — ISTS is priced per corridor
  bearer_overrides = {},     // { ISTS: 'SELLER', ... }
} = {}) {
  const qty = Number(quantum_mwh) || 0;
  const nDays = Math.max(1, Number(days) || 1);
  const date = on_date || new Date().toISOString().slice(0, 10);
  const items = [];
  const warnings = [];

  const bearerFor = (charge, dflt) => bearer_overrides[charge] || dflt;

  // rate: ₹ value; basis decides the multiplier (per-MWh, per-day, or flat).
  const addLine = (charge, category, rate, basis, bearer, source) => {
    if (rate == null) { warnings.push(`No rate found for '${charge}' on ${date}`); return; }
    const mult = basis === 'Rs/MWh' ? qty : basis === 'Rs/day' ? nDays : 1;
    items.push({
      charge, category, rate, basis,
      quantum_mwh: basis === 'Rs/MWh' ? qty : null,
      days: basis === 'Rs/day' ? nDays : null,
      amount: Math.round(rate * mult),
      bearer, rate_source: source,
    });
  };

  const rateVal = (name, reg) => getEffectiveRate(name, date, reg)?.rate_value ?? null;

  // ISTS (buyer): explicit override wins, else the effective CTUIL tariff.
  if (include_ists) {
    const r = ists_rate != null ? Number(ists_rate) : rateVal('ISTS', region);
    addLine('ISTS', 'ISTS', r, 'Rs/MWh', bearerFor('ISTS', 'BUYER'), ists_rate != null ? 'OVERRIDE' : 'RATE_MASTER');
  }

  // Injection-state STU / SLDC -> seller.
  if (injection_state) {
    addLine(`${injection_state} STU`, 'STU', rateVal(`${injection_state} STU`), 'Rs/MWh', bearerFor(`${injection_state} STU`, 'SELLER'), 'RATE_MASTER');
    addLine(`${injection_state} SLDC`, 'SLDC', rateVal(`${injection_state} SLDC`), 'Rs/day', bearerFor(`${injection_state} SLDC`, 'SELLER'), 'RATE_MASTER');
  }

  // Drawal-state STU / SLDC -> buyer.
  if (drawal_state) {
    addLine(`${drawal_state} STU`, 'STU', rateVal(`${drawal_state} STU`), 'Rs/MWh', bearerFor(`${drawal_state} STU`, 'BUYER'), 'RATE_MASTER');
    addLine(`${drawal_state} SLDC`, 'SLDC', rateVal(`${drawal_state} SLDC`), 'Rs/day', bearerFor(`${drawal_state} SLDC`, 'BUYER'), 'RATE_MASTER');
  }

  // RLDC operating charge and the flat NOAR application fee -> buyer.
  addLine('RLDC Fee', 'RLDC', rateVal('RLDC Fee'), 'Rs/day', bearerFor('RLDC Fee', 'BUYER'), 'RATE_MASTER');
  addLine('NOAR Application Fee', 'NOAR_FEE', rateVal('NOAR Application Fee'), 'flat', bearerFor('NOAR Application Fee', 'BUYER'), 'RATE_MASTER');

  const total = items.reduce((s, i) => s + i.amount, 0);
  const by_bearer = items.reduce((acc, i) => {
    acc[i.bearer] = (acc[i.bearer] || 0) + i.amount;
    return acc;
  }, {});

  return {
    quantum_mwh: qty, days: nDays, on_date: date, region: region || null,
    line_items: items,
    total,
    by_bearer: { SELLER: by_bearer.SELLER || 0, BUYER: by_bearer.BUYER || 0 },
    warnings,
  };
}
