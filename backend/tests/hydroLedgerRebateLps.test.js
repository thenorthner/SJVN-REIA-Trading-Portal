import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { getParam, ensureMasterDefaults } from '../src/mastersService.js';
import {
  postBillToLedger, recordPayment, reversePayment, resetClearing, accountMaintenance,
  accountDisplay, accruedLpsFor, postLps, openCredits,
} from '../src/services/hydroLedger.js';

// What the beneficiary account gets right about money: the CERC early-payment
// rebate on a hydro bill, and a late payment surcharge that follows the days
// each rupee was actually late — including on a bill that has since been paid.
//
// Figures are round so the arithmetic can be checked by hand: PUNJAB owes
// Rs 1,00,000 on a bill presented 1 July 2026 and due 31 July 2026.

let contractId;
let bill;

function makeBill({ total = 100000, nrldc = 0, issued = '2026-07-01', due = '2026-07-31' } = {}) {
  const id = newId('HSB');
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
      ee1_energy_charge, ee2_excess_energy_charge, total_charges,
      status, approval_status, due_date, issued_at
    ) VALUES (?, ?, ?, 'NJHPS', '2026-06', '2026-2027', 'PROVISIONAL',
      1, 1, 1, 12, 1, 1, 30, 365, 87, 1.271, 1.271,
      87, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      'ISSUED', 'APPROVED', ?, ?)
  `).run(id, newId('BILL'), contractId, due, issued);
  db.prepare(`
    INSERT INTO hydro_bill_lines (
      id, bill_id, sr_no, beneficiary_name, pct_rea, pct_excl_free, pct_proportionate,
      capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
      energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
    ) VALUES (?, ?, 1, 'PUNJAB', 100, 100, 100, 0, 0, 0, 0, 0, 0, 0, ?, ?)
  `).run(newId('HBL'), id, nrldc, total);
  const b = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(id);
  postBillToLedger(b);
  return b;
}

function clean() {
  db.prepare('DELETE FROM hydro_ledger_clearings').run();
  db.prepare('DELETE FROM hydro_ledger_docs').run();
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
}

// The masters are seeded on server boot; this suite does not boot the server.
ensureMasterDefaults();

beforeEach(() => {
  clean();
  contractId = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get().id;
  bill = makeBill();
});
afterAll(clean);

const pay = (amount, date, extra = {}) => recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount, paymentDate: date, ...extra });
const acc = () => accountDisplay(contractId, 'PUNJAB');
const lpsAt = (date) => accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date(date) }).total_accrued;

describe('early-payment rebate on a hydro bill', () => {
  it('uses the CERC tiers held in the masters', () => {
    expect(getParam('early_payment_rebate_tiers', null)).toEqual([{ within_days: 5, pct: 1.5 }, { within_days: 30, pct: 1 }]);
  });

  it('settles the bill for 98.5% when paid within five days of presentation', () => {
    const r = pay(98500, '2026-07-04');
    expect(r.rebate).toBe(1500);
    expect(r.unapplied).toBe(0);
    const a = acc();
    expect(a.totals.outstanding).toBe(0);
    expect(a.totals.received).toBe(98500);
    expect(a.totals.rebate).toBe(1500);
    const rb = a.rows.find((x) => x.display_type === 'RBT');
    expect(rb.reference).toBe(r.doc.doc_no);
    expect(rb.info).toMatch(/1\.5%/);
  });

  it('allows 1% between six and thirty days, and nothing after', () => {
    expect(pay(99000, '2026-07-20').rebate).toBe(1000);
    clean(); bill = makeBill();
    const late = pay(100000, '2026-08-05');
    expect(late.rebate).toBe(0);
    expect(acc().totals.outstanding).toBe(0);
  });

  it('leaves the excess as an advance when the gross bill is paid inside the window', () => {
    const r = pay(100000, '2026-07-04');
    expect(r.rebate).toBe(1500);
    expect(r.unapplied).toBe(1500);
    expect(acc().totals.advance).toBe(1500);
  });

  it("allows a part payment its own share of rebate, not the whole bill's", () => {
    // Rs 49,250 in the five-day window settles Rs 50,000 of the bill.
    const r = pay(49250, '2026-07-03');
    expect(r.rebate).toBe(750);
    expect(acc().totals.outstanding).toBe(50000);
    // The rest arrives after the window and earns nothing.
    expect(pay(50000, '2026-08-10').rebate).toBe(0);
    expect(acc().totals.outstanding).toBe(0);
    expect(acc().totals.rebate).toBe(750);
  });

  it('gives no rebate on the NRLDC fee billed alongside', () => {
    clean(); bill = makeBill({ total: 100000, nrldc: 2000 });
    // 1.5% of the Rs 1,00,000 station charges only: Rs 1,02,000 - 1,500.
    const r = pay(100500, '2026-07-02');
    expect(r.rebate).toBe(1500);
    expect(acc().totals.outstanding).toBe(0);
  });

  it('can be withheld on a payment the desk marks as not earning rebate', () => {
    const r = pay(100000, '2026-07-02', { rebate: false });
    expect(r.rebate).toBe(0);
    expect(acc().totals.outstanding).toBe(0);
  });

  it('goes when the payment that earned it is reversed', () => {
    const r = pay(98500, '2026-07-04');
    reversePayment(r.doc.id, { reason: 'bounced', onDate: '2026-07-10' });
    const a = acc();
    expect(a.totals.rebate).toBe(0);
    expect(a.totals.outstanding).toBe(100000);
    expect(openCredits(contractId, 'PUNJAB')).toHaveLength(0);
  });

  it('is withdrawn with a reset clearing and earned again when the advance is re-applied', () => {
    const r = pay(98500, '2026-07-04');
    const reset = resetClearing(r.doc.id);
    expect(reset.rebates_withdrawn).toBe(1);
    expect(acc().totals.rebate).toBe(0);
    // Re-applied later: the rebate follows when the money came in, not the re-application.
    accountMaintenance(r.doc.id, { onDate: '2026-08-15' });
    expect(acc().totals.rebate).toBe(1500);
    expect(acc().totals.outstanding).toBe(0);
  });

  it('never shows a rebate as an advance, and refuses to reverse one on its own', () => {
    pay(98500, '2026-07-04');
    const rb = acc().rows.find((x) => x.display_type === 'RBT');
    expect(openCredits(contractId, 'PUNJAB').map((c) => c.id)).not.toContain(rb.id);
    expect(() => reversePayment(rb.id, { reason: 'x' })).toThrow(/rebate/);
  });
});

describe('late payment surcharge follows the days each rupee was late', () => {
  // Base 15% for the first 30 days of default, 15.5% for the next 30 (MoP LPS
  // Rules 2022 step of 0.5% a month).
  const perDay = (amount, pct) => (amount * pct) / 100 / 365;

  it('charges a bill paid off late, even when no surcharge was posted before it cleared', () => {
    pay(100000, '2026-08-30'); // 30 days after the due date
    expect(lpsAt('2026-12-31')).toBe(Math.round(perDay(100000, 15) * 30));
  });

  it('charges each part of a split late payment for its own days', () => {
    pay(50000, '2026-08-30'); // half 30 days late
    pay(50000, '2026-09-29'); // half 60 days late
    const expected = Math.round(perDay(100000, 15) * 30 + perDay(50000, 15.5) * 30);
    expect(lpsAt('2026-12-31')).toBe(expected);
  });

  it('adds only the days not yet charged when posted again after a part payment', () => {
    postLps(contractId, 'PUNJAB', { asOf: new Date('2026-08-30') });
    pay(50000 + Math.round(perDay(100000, 15) * 30), '2026-08-30'); // the surcharge first, then half the bill
    const second = postLps(contractId, 'PUNJAB', { asOf: new Date('2026-09-29') });
    expect(second.posted).toBe(1);
    expect(Math.round(second.docs[0].amount)).toBe(Math.round(perDay(50000, 15.5) * 30));
  });

  it('takes a payment to the surcharge before the bill', () => {
    postLps(contractId, 'PUNJAB', { asOf: new Date('2026-08-30') });
    const lps = acc().rows.find((x) => x.doc_type === 'LPS');
    const r = pay(lps.amount, '2026-08-30');
    expect(r.clearings[0].debit_doc_no).toBe(lps.doc_no);
    const after = acc();
    expect(after.rows.find((x) => x.doc_type === 'LPS').outstanding).toBe(0);
    expect(after.rows.find((x) => x.doc_type === 'PB').outstanding).toBe(100000);
  });

  it('charges nothing on a bill settled inside the grace days', () => {
    db.prepare('UPDATE contracts SET lps_grace_days = 10 WHERE id = ?').run(contractId);
    try {
      pay(100000, '2026-08-05', { rebate: false }); // 5 days late, inside a 10-day grace
      expect(lpsAt('2026-12-31')).toBe(0);
    } finally {
      db.prepare('UPDATE contracts SET lps_grace_days = 0 WHERE id = ?').run(contractId);
    }
  });
});
