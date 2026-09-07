import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import {
  financialYearOf, monthsOfFinancialYear, computeEcr3, apportion,
  deriveAllocationColumns, getAllocations, priorCumulative,
  computeStationBill, allocateBeneficiaries, seedNjhpsAllocations,
} from '../src/services/hydroStationBill.js';

// The station as the NJHPS bill states it (block A1-A11).
const NJHPS = {
  id: null,                       // filled in by the fixture
  project_type: 'Hydro',
  annual_afc: 14615741000,
  annual_design_energy_mwh: 6612000,
  normative_aux: 1.2,
  free_energy_home_state: 12,
  napaf_percent: 87,
  capacity_mw: 1500,
};

// June-2026 provisional bill, as printed.
const JUNE = {
  periodMonth: '2026-06',
  exBusScheduledKwh: 731158750.0,
  freePowerKwh: 87739035.0,
  pafmPercent: 109.667,
  betaValue: 0,
  priorScheduledKwh: 714468750.0,   // = May's E4
  priorFreeKwh: 85736250.0,         // = May's E5
  nrldcTotalFee: 646884.0,
};

let contractId;

beforeEach(() => {
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  const con = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  contractId = con?.id;
  NJHPS.id = contractId;
  seedNjhpsAllocations();
});

describe('financial year', () => {
  it('starts in April', () => {
    expect(financialYearOf('2026-06')).toBe('2026-2027');
    expect(financialYearOf('2026-04')).toBe('2026-2027');
    expect(financialYearOf('2027-03')).toBe('2026-2027');
    expect(financialYearOf('2026-03')).toBe('2025-2026');
  });

  it('lays the year out in billing order', () => {
    const months = monthsOfFinancialYear('2026-2027');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-04');
    expect(months[11]).toBe('2027-03');
  });
});

describe('energy charge rate', () => {
  // A12 = AFC x 0.5 x 10 / { DE x (100-AUX) x (100-FEHS) }
  it('derives the NJHPS rate of 1.271 Rs/kWh from AFC', () => {
    expect(computeEcr3(14615741000, 6612000, 1.2, 12)).toBe(1.271);
  });

  it('refuses to invent a rate without AFC or design energy', () => {
    expect(computeEcr3(0, 6612000, 1.2, 12)).toBeNull();
    expect(computeEcr3(14615741000, 0, 1.2, 12)).toBeNull();
  });
});

describe('allocation columns', () => {
  it('carves the free power out of the home state and scales the rest to 100', () => {
    const rows = deriveAllocationColumns([
      { beneficiary_name: 'GoHP', pct_rea: 34, is_home_state: 1 },
      { beneficiary_name: 'CHANDIGARH', pct_rea: 1.714551, is_home_state: 0 },
      { beneficiary_name: 'REST', pct_rea: 64.285449, is_home_state: 0 },
    ], 12);
    // GoHP: 34 -> 22 -> 25, the figure the bill charges it on.
    expect(rows[0].pct_excl_free).toBeCloseTo(22, 6);
    expect(rows[0].pct_proportionate).toBeCloseTo(25, 6);
    expect(rows[1].pct_proportionate).toBeCloseTo(1.948353, 6);
    const sumC = rows.reduce((a, r) => a + r.pct_excl_free, 0);
    const sumD = rows.reduce((a, r) => a + r.pct_proportionate, 0);
    expect(sumC).toBeCloseTo(88, 4);
    expect(sumD).toBeCloseTo(100, 4);
  });

  it('refuses a home state whose share cannot absorb the free power', () => {
    expect(() => deriveAllocationColumns(
      [{ beneficiary_name: 'GoHP', pct_rea: 5, is_home_state: 1 }], 12,
    )).toThrow(/free energy is carved out/);
  });
});

describe('seeded NJHPS allocation master', () => {
  it('holds the fifteen billing parties and closes on 100%', () => {
    const rows = getAllocations(contractId, '2026-06', 12);
    expect(rows).toHaveLength(15);
    expect(rows.reduce((a, r) => a + r.pct_rea, 0)).toBeCloseTo(100, 5);
    expect(rows.reduce((a, r) => a + r.pct_proportionate, 0)).toBeCloseTo(100, 4);
  });

  it('bills Delhi and Rajasthan through their discoms', () => {
    const rows = getAllocations(contractId, '2026-06', 12);
    const delhi = rows.filter((r) => r.parent_state === 'DELHI');
    expect(delhi.map((r) => r.beneficiary_name).sort())
      .toEqual(['BSES RAJDHANI POWER', 'BSES YAMUNA POWER', 'TPDDL']);
    // Delhi's own allocation on the sheet is 11.162216%.
    expect(delhi.reduce((a, r) => a + r.pct_rea, 0)).toBeCloseTo(11.162216, 6);
  });

  it('is idempotent', () => {
    expect(seedNjhpsAllocations()).toBe(0);
    expect(getAllocations(contractId, '2026-06', 12)).toHaveLength(15);
  });
});

describe('station bill — NJHPS June 2026', () => {
  const bill = () => computeStationBill({ contract: NJHPS, ...JUNE });

  it('reproduces the A block', () => {
    const b = bill();
    expect(b.a5_ex_bus_design_energy_mwh).toBeCloseTo(6532656.0, 3);
    expect(b.a6_ex_bus_saleable_design_energy_mwh).toBeCloseTo(5748737.28, 2);
    expect(b.a12_ecr).toBe(1.271);
    expect(b.a13_ecr_excess).toBe(1.271);
    expect(b.a8_days_in_month).toBe(30);
    expect(b.a9_days_in_year).toBe(365);
    expect(b.financial_year).toBe('2026-2027');
  });

  it('reproduces the capacity charge of Rs 757,139,569', () => {
    const b = bill();
    // The bill prints PAFM rounded to three decimals, so the charge derived
    // from it lands within a few hundred rupees of the printed figure.
    expect(b.c2_capacity_charge).toBeCloseTo(757139569, -3);
    expect(b.c4_beta_incentive).toBe(0);
    expect(b.c5_total_capacity_charge).toBe(b.c2_capacity_charge);
  });

  it('pays no beta incentive when beta is not certified', () => {
    const b = computeStationBill({ contract: NJHPS, ...JUNE, betaValue: null });
    expect(b.c3_beta_factor).toBeNull();
    expect(b.c4_beta_incentive).toBe(0);
    expect(b.c4_beta_note).toMatch(/not yet certified/i);
  });

  it('reproduces the E block including the cumulative rows', () => {
    const b = bill();
    expect(b.e3_saleable_scheduled_kwh).toBe(643419715.0);
    expect(b.e4_cum_scheduled_kwh).toBe(1445627500.0);
    expect(b.e5_cum_free_power_kwh).toBe(173475285.0);
    expect(b.e6_cum_saleable_kwh).toBe(1272152215.0);
    // Cumulative saleable is still well inside the annual design energy.
    expect(b.e7_excess_kwh).toBe(0);
    expect(b.e8_upto_design_kwh).toBe(643419715.0);
  });

  it('reproduces the energy charge and the bill total', () => {
    const b = bill();
    expect(b.ee1_energy_charge).toBeCloseTo(817786458, -1);
    expect(b.ee2_excess_energy_charge).toBe(0);
    expect(b.total_charges).toBeCloseTo(1574926027, -3);
  });

  it('falls back to the contracted free power share when the REA has none', () => {
    const b = computeStationBill({ contract: NJHPS, ...JUNE, freePowerKwh: null });
    expect(b.e2_free_power_kwh).toBeCloseTo(731158750 * 0.12, 0);
  });

  it('refuses free power larger than the energy scheduled', () => {
    expect(() => computeStationBill({ contract: NJHPS, ...JUNE, freePowerKwh: 8e8 }))
      .toThrow(/exceeds the energy scheduled/);
  });

  it('bills at normative availability when PAFM has not been certified', () => {
    const b = computeStationBill({ contract: NJHPS, ...JUNE, pafmPercent: null });
    expect(b.c1_pafm_pct).toBe(87);
    // AFC x 0.5 x 30/365, with PAFM/NAPAF = 1.
    expect(b.c2_capacity_charge).toBeCloseTo(14615741000 * 0.5 * (30 / 365), 0);
  });

  it('refuses a station with no AFC', () => {
    expect(() => computeStationBill({
      contract: { ...NJHPS, annual_afc: 0, capacity_charges_total: 0 }, ...JUNE,
    })).toThrow(/Annual Fixed Charges/);
  });
});

describe('station bill — May 2026 and the beta revision', () => {
  const MAY = {
    periodMonth: '2026-05',
    exBusScheduledKwh: 459358500.0,
    freePowerKwh: 55123020.0,
    pafmPercent: 100.0,
    priorScheduledKwh: 255110250.0,
    priorFreeKwh: 30613230.0,
  };

  it('reproduces the provisional bill of Rs 1,227,195,310', () => {
    const b = computeStationBill({ contract: NJHPS, ...MAY, betaValue: 0 });
    expect(b.c2_capacity_charge).toBeCloseTo(713412015, -2);
    expect(b.c4_beta_incentive).toBe(0);
    expect(b.e3_saleable_scheduled_kwh).toBe(404235480.0);
    expect(b.e4_cum_scheduled_kwh).toBe(714468750.0);
    expect(b.e6_cum_saleable_kwh).toBe(628732500.0);
    expect(b.ee1_energy_charge).toBeCloseTo(513783295, -1);
    expect(b.total_charges).toBeCloseTo(1227195310, -3);
  });

  it('reproduces the revised bill of Rs 1,245,464,986 once beta is certified at 1.00', () => {
    const b = computeStationBill({ contract: NJHPS, ...MAY, betaValue: 1.0 });
    // C4 = 3% x 1.00 x 0.5 x AFC / 12
    expect(b.c4_beta_incentive).toBeCloseTo(18269676, 0);
    expect(b.c5_total_capacity_charge).toBeCloseTo(731681691, -2);
    expect(b.total_charges).toBeCloseTo(1245464986, -3);
  });

  it('the differential is the beta incentive alone', () => {
    const provisional = computeStationBill({ contract: NJHPS, ...MAY, betaValue: 0 });
    const revised = computeStationBill({ contract: NJHPS, ...MAY, betaValue: 1.0 });
    expect(revised.total_charges - provisional.total_charges).toBeCloseTo(18269676, 0);
  });
});

describe('energy beyond the annual design energy', () => {
  // Drive cumulative saleable energy just past A6 (5,748,737,280 kWh).
  const base = {
    periodMonth: '2027-02',
    exBusScheduledKwh: 500000000,
    freePowerKwh: 60000000,
    pafmPercent: 87,
    betaValue: 0,
  };

  it('splits the month at the cap and prices each side on its own rate', () => {
    const b = computeStationBill({
      contract: NJHPS, ...base,
      priorScheduledKwh: 6250000000, priorFreeKwh: 750000000,
    });
    // Cumulative saleable 5,500,000,000 before this month, 5,940,000,000 after;
    // the cap is 5,748,737,280, so 191,262,720 kWh of the month is beyond it.
    expect(b.e6_cum_saleable_kwh).toBe(5940000000);
    expect(b.e7_excess_kwh).toBeCloseTo(191262720, 0);
    expect(b.e8_upto_design_kwh).toBeCloseTo(440000000 - 191262720, 0);
    expect(b.ee2_excess_energy_charge).toBeGreaterThan(0);
    expect(b.total_charges).toBeCloseTo(
      b.c5_total_capacity_charge + b.ee1_energy_charge + b.ee2_excess_energy_charge, 2,
    );
  });

  it('treats the whole month as excess once the cap was passed earlier', () => {
    const b = computeStationBill({
      contract: NJHPS, ...base,
      priorScheduledKwh: 9000000000, priorFreeKwh: 1080000000,
    });
    expect(b.e7_excess_kwh).toBe(b.e3_saleable_scheduled_kwh);
    expect(b.e8_upto_design_kwh).toBe(0);
    expect(b.ee1_energy_charge).toBe(0);
  });

  it('prices excess energy at A13 when the tariff order sets a different rate', () => {
    const b = computeStationBill({
      contract: NJHPS, ...base,
      priorScheduledKwh: 9000000000, priorFreeKwh: 1080000000,
      ecrExcessOverride: 2.5,
    });
    expect(b.a13_ecr_excess).toBe(2.5);
    expect(b.ee2_excess_energy_charge).toBeCloseTo(b.e7_excess_kwh * 2.5, 0);
  });
});

describe('regulation of power (URS_NR)', () => {
  // SJVN regulates a beneficiary's supply: that energy is scheduled from the
  // station but billed to nobody, and shows on the REA as un-requisitioned
  // surplus. The exclusion screen reconciles the two — what is deducted from the
  // regulated beneficiaries must equal the surplus.
  const withUrs = (urs) => computeStationBill({ contract: NJHPS, ...JUNE, ursNrKwh: urs });

  /** Deduct the whole of one beneficiary's entitlement, the way the manual's
   *  screen shows TPDDL being excluded in full. */
  function fullDeductionFor(name) {
    const bill = computeStationBill({ contract: NJHPS, ...JUNE });
    const lines = allocateBeneficiaries(bill, getAllocations(contractId, '2026-06', 12));
    const line = lines.find((l) => l.beneficiary_name === name);
    return line.saleable_energy_kwh;
  }

  it('leaves an ordinary month exactly as it was', () => {
    const plain = computeStationBill({ contract: NJHPS, ...JUNE });
    const zero = withUrs(0);
    expect(zero.urs_nr_kwh).toBe(0);
    expect(zero.e3_billable_kwh).toBe(plain.e3_saleable_scheduled_kwh);
    expect(zero.total_charges).toBe(plain.total_charges);
  });

  it('takes the surplus out of the energy the station bills for', () => {
    const b = withUrs(20000000);
    // E3 is still what the REA reported; only the billable energy moves.
    expect(b.e3_saleable_scheduled_kwh).toBe(643419715.0);
    expect(b.e3_billable_kwh).toBe(623419715.0);
    expect(b.e8_upto_design_kwh).toBe(623419715.0);
    // And the energy charge follows the billable figure, not E3.
    expect(b.ee1_energy_charge).toBeCloseTo(623419715 * 1.271, 0);
  });

  it('leaves the capacity charge untouched — it is not paid for energy taken', () => {
    const plain = computeStationBill({ contract: NJHPS, ...JUNE });
    const b = withUrs(20000000);
    expect(b.c5_total_capacity_charge).toBe(plain.c5_total_capacity_charge);
  });

  it('refuses a surplus larger than the month\'s saleable energy', () => {
    expect(() => withUrs(700000000)).toThrow(/exceeds the saleable energy/);
    expect(() => withUrs(-1)).toThrow(/cannot be negative/);
  });

  it('bills the regulated beneficiary for what is left, and the rest in full', () => {
    const tpddlFull = fullDeductionFor('TPDDL');
    const bill = withUrs(tpddlFull);
    const lines = allocateBeneficiaries(bill, getAllocations(contractId, '2026-06', 12), {
      deductions: { TPDDL: tpddlFull },
    });

    const tpddl = lines.find((l) => l.beneficiary_name === 'TPDDL');
    expect(tpddl.is_regulated).toBe(1);
    expect(tpddl.actual_scheduled_energy_kwh).toBeCloseTo(tpddlFull, 0);
    expect(tpddl.deducted_scheduled_energy_kwh).toBeCloseTo(tpddlFull, 0);
    // Nothing left to bill it for, so it pays no energy charge at all.
    expect(tpddl.saleable_energy_kwh).toBeCloseTo(0, 0);
    expect(tpddl.energy_charge_total).toBe(0);
    // But it still carries its capacity charge.
    expect(tpddl.capacity_charge).toBeGreaterThan(0);

    // An unregulated beneficiary is untouched.
    const punjab = lines.find((l) => l.beneficiary_name === 'PUNJAB');
    expect(punjab.deducted_scheduled_energy_kwh).toBe(0);
    expect(punjab.saleable_energy_kwh).toBe(punjab.actual_scheduled_energy_kwh);
  });

  it('still adds back to the station bill once energy is withheld', () => {
    const tpddlFull = fullDeductionFor('TPDDL');
    const bill = withUrs(tpddlFull);
    const lines = allocateBeneficiaries(bill, getAllocations(contractId, '2026-06', 12), {
      deductions: { TPDDL: tpddlFull },
    });
    const sum = (k) => lines.reduce((a, r) => a + r[k], 0);

    expect(sum('capacity_charge')).toBeCloseTo(bill.c5_total_capacity_charge, 2);
    expect(sum('energy_charge_total')).toBeCloseTo(bill.ee1_energy_charge + bill.ee2_excess_energy_charge, 2);
    expect(sum('total_charges')).toBeCloseTo(bill.total_charges, 2);
    // The energy columns reconcile the way the exclusion screen does:
    // actual - deducted = remaining, and the deductions are the surplus.
    expect(sum('deducted_scheduled_energy_kwh')).toBeCloseTo(bill.urs_nr_kwh, 1);
    expect(sum('actual_scheduled_energy_kwh')).toBeCloseTo(bill.e3_saleable_scheduled_kwh, 1);
    expect(sum('saleable_energy_kwh')).toBeCloseTo(bill.e3_billable_kwh, 1);
  });

  it('spreads a regulation across the discoms of one beneficiary', () => {
    const bill = withUrs(30000000);
    const lines = allocateBeneficiaries(bill, getAllocations(contractId, '2026-06', 12), {
      deductions: { TPDDL: 10000000, 'BSES RAJDHANI POWER': 12000000, 'BSES YAMUNA POWER': 8000000 },
    });
    const delhi = lines.filter((l) => l.parent_state === 'DELHI');
    expect(delhi.every((l) => l.is_regulated === 1)).toBe(true);
    expect(delhi.reduce((a, l) => a + l.deducted_scheduled_energy_kwh, 0)).toBeCloseTo(30000000, 1);
  });

  it('refuses when the deductions do not add up to the surplus', () => {
    const bill = withUrs(20000000);
    const allocs = getAllocations(contractId, '2026-06', 12);
    expect(() => allocateBeneficiaries(bill, allocs, { deductions: { TPDDL: 15000000 } }))
      .toThrow(/totals 15000000 kWh but the un-requisitioned surplus is 20000000/);
    // And a surplus with nothing deducted against it is refused too.
    expect(() => allocateBeneficiaries(bill, allocs)).toThrow(/must agree/);
  });

  it('refuses to deduct more than a beneficiary was scheduled', () => {
    const bill = withUrs(20000000);
    const allocs = getAllocations(contractId, '2026-06', 12);
    // MPPMCL holds 0.196% of the station — nowhere near 20 million kWh.
    expect(() => allocateBeneficiaries(bill, allocs, { deductions: { MPPMCL: 20000000 } }))
      .toThrow(/but 20000000 kWh is being deducted from it/);
  });

  it('refuses a negative deduction', () => {
    const bill = withUrs(0);
    const allocs = getAllocations(contractId, '2026-06', 12);
    expect(() => allocateBeneficiaries(bill, allocs, { deductions: { TPDDL: -5, PUNJAB: 5 } }))
      .toThrow(/negative deduction/);
  });
});

describe('apportion', () => {
  it('splits exactly, carrying the rounding residue to the largest share', () => {
    const parts = apportion(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('returns zeros rather than a lost remainder when there is nothing to split', () => {
    expect(apportion(0, [0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('beneficiary breakup — NJHPS June 2026', () => {
  const build = () => {
    const bill = computeStationBill({ contract: NJHPS, ...JUNE });
    return { bill, lines: allocateBeneficiaries(bill, getAllocations(contractId, '2026-06', 12)) };
  };

  it('bills every beneficiary on the sheet', () => {
    const { lines } = build();
    expect(lines).toHaveLength(15);
  });

  it('adds back to the station bill, to the paisa', () => {
    const { bill, lines } = build();
    const sum = (k) => lines.reduce((a, r) => a + r[k], 0);
    expect(sum('capacity_charge')).toBeCloseTo(bill.c5_total_capacity_charge, 2);
    expect(sum('energy_charge_total')).toBeCloseTo(bill.ee1_energy_charge + bill.ee2_excess_energy_charge, 2);
    expect(sum('total_charges')).toBeCloseTo(bill.total_charges, 2);
    expect(sum('saleable_energy_kwh')).toBeCloseTo(bill.e3_saleable_scheduled_kwh, 1);
    expect(sum('nrldc_fee')).toBeCloseTo(bill.nrldc_total_fee, 2);
  });

  // The printed sheet's own energy columns do not tie exactly to E3 x D%: on the
  // June bill Chandigarh's saleable energy sits 3,528 kWh above that product and
  // Uttar Pradesh's 685 kWh below it, in opposite directions, so the residues are
  // the source sheet's per-row rounding rather than a single consistent basis we
  // could reproduce. What is reproduced exactly is the capacity charge and the
  // station tie-out; the energy columns are matched to within a thousandth of a
  // percent of the printed figures.
  const nearly = (actual, printed) => {
    expect(Math.abs(actual - printed) / printed).toBeLessThan(1e-5);
  };

  it('reproduces the printed figures for GoHP', () => {
    const { lines } = build();
    const gohp = lines.find((r) => r.beneficiary_name === 'GoHP');
    expect(gohp.pct_proportionate).toBeCloseTo(25.0, 6);
    expect(gohp.capacity_charge).toBeCloseTo(189284892, -3);
    nearly(gohp.saleable_energy_kwh, 160854925);
    nearly(gohp.energy_charge_total, 204446610);
    nearly(gohp.total_charges, 393731502);
  });

  it('reproduces the printed figures for Uttar Pradesh', () => {
    const { lines } = build();
    const up = lines.find((r) => r.beneficiary_name === 'UTTAR PRADESH');
    expect(up.pct_proportionate).toBeCloseTo(16.738636, 5);
    expect(up.capacity_charge).toBeCloseTo(126734836, -3);
    nearly(up.saleable_energy_kwh, 107700370);
    nearly(up.energy_charge_total, 136887170);
    nearly(up.total_charges, 263622006);
  });

  it('splits NRLDC fees on the REA share, not the charging share', () => {
    const { lines } = build();
    // GoHP carries its free power share of the fees: 34% of 646,884.
    const gohp = lines.find((r) => r.beneficiary_name === 'GoHP');
    expect(gohp.nrldc_fee).toBeCloseTo(219941, 0);
    const chandigarh = lines.find((r) => r.beneficiary_name === 'CHANDIGARH');
    expect(chandigarh.nrldc_fee).toBeCloseTo(11091, 0);
  });

  it('refuses to bill against percentages that do not close on 100', () => {
    const bill = computeStationBill({ contract: NJHPS, ...JUNE });
    const short = getAllocations(contractId, '2026-06', 12).slice(0, 5);
    expect(() => allocateBeneficiaries(bill, short)).toThrow(/not 100%/);
  });

  it('refuses to bill a station with no allocation in force', () => {
    const bill = computeStationBill({ contract: NJHPS, ...JUNE });
    expect(() => allocateBeneficiaries(bill, [])).toThrow(/No beneficiary allocation/);
  });
});

describe('cumulative energy read back from issued bills', () => {
  function issue(month, e1, e2) {
    db.prepare(`
      INSERT INTO hydro_station_bills (
        id, bill_no, contract_id, station_name, billing_month, financial_year, bill_kind,
        a1_afc, a2_design_energy_mwh, a3_aux_pct, a4_fehs_pct,
        a5_ex_bus_design_energy_mwh, a6_ex_bus_saleable_design_energy_mwh,
        a8_days_in_month, a9_days_in_year, a11_napaf_pct, a12_ecr, a13_ecr_excess,
        c1_pafm_pct, c2_capacity_charge, c4_beta_incentive, c5_total_capacity_charge,
        e1_ex_bus_scheduled_kwh, e2_free_power_kwh, e3_saleable_scheduled_kwh,
        e4_cum_scheduled_kwh, e5_cum_free_power_kwh, e6_cum_saleable_kwh,
        e7_excess_kwh, e8_upto_design_kwh,
        ee1_energy_charge, ee2_excess_energy_charge, total_charges, status
      ) VALUES (?, ?, ?, 'NJHPS', ?, '2026-2027', 'PROVISIONAL',
        1, 1, 1, 12, 1, 1, 30, 365, 87, 1.271, 1.271,
        87, 0, 0, 0, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'ISSUED')
    `).run(newId('HSB'), newId('BILL'), contractId, month, e1, e2);
  }

  it('sums the financial year up to but not including the month being billed', () => {
    issue('2026-04', 255110250, 30613230);
    issue('2026-05', 459358500, 55123020);
    const prior = priorCumulative(contractId, '2026-06');
    expect(prior.scheduled).toBe(714468750);
    expect(prior.free).toBe(85736250);
    expect(prior.months).toEqual(['2026-04', '2026-05']);
  });

  it('does not reach across the financial year boundary', () => {
    issue('2026-04', 255110250, 30613230);
    expect(priorCumulative(contractId, '2026-04').scheduled).toBe(0);
    expect(priorCumulative(contractId, '2027-04').scheduled).toBe(0);
  });
});
