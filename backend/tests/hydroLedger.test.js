import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import {
  postBillToLedger, recordPayment, reversePayment, resetClearing, accountMaintenance,
  accountDisplay, openDebits, openCredits, outstandingOf, unappliedOf,
  accruedLpsFor, postLps, billReversalBlockers, reverseBillDocs, dueDateFor,
} from '../src/services/hydroLedger.js';

// The beneficiary's running account: a bill lands on it, payments clear it,
// a payment can be released back into an advance and re-applied, and an overdue
// balance accrues surcharge. These are the movements the Account Display shows.

let contractId;
let bill;

/** A station bill with two beneficiaries owing round numbers, so the ledger
 *  arithmetic is readable rather than buried in nine-digit rupee figures. */
function makeBill({ month = '2026-06', dueDate = '2026-07-31', lines } = {}) {
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
    ) VALUES (?, ?, ?, 'NJHPS', ?, '2026-2027', 'PROVISIONAL',
      1, 1, 1, 12, 1, 1, 30, 365, 87, 1.271, 1.271,
      87, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      'ISSUED', 'APPROVED', ?, '2026-07-01')
  `).run(id, newId('BILL'), contractId, month, dueDate);

  for (const l of (lines || [
    { name: 'PUNJAB', total: 100000, nrldc: 0 },
    { name: 'HARYANA', total: 50000, nrldc: 0 },
  ])) {
    db.prepare(`
      INSERT INTO hydro_bill_lines (
        id, bill_id, sr_no, beneficiary_name, pct_rea, pct_excl_free, pct_proportionate,
        capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
        energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
      ) VALUES (?, ?, ?, ?, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, ?, ?)
    `).run(newId('HBL'), id, 1, l.name, l.nrldc, l.total);
  }
  return db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(id);
}

beforeEach(() => {
  db.prepare('DELETE FROM hydro_ledger_clearings').run();
  db.prepare('DELETE FROM hydro_ledger_docs').run();
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  contractId = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get().id;
  bill = makeBill();
});

afterAll(() => {
  db.prepare('DELETE FROM hydro_ledger_clearings').run();
  db.prepare('DELETE FROM hydro_ledger_docs').run();
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
});

const punjab = () => accountDisplay(contractId, 'PUNJAB');

describe('posting a bill to the ledger', () => {
  it('gives each beneficiary its own document for its own share', () => {
    const r = postBillToLedger(bill);
    expect(r.posted).toBe(2);
    const acc = punjab();
    expect(acc.rows).toHaveLength(1);
    expect(acc.rows[0].doc_type).toBe('PB');
    expect(acc.rows[0].amount).toBe(100000);
    expect(acc.rows[0].due_date).toBe('2026-07-31');
    expect(acc.totals.outstanding).toBe(100000);
  });

  it('bills the NRLDC fee alongside the beneficiary\'s own charges', () => {
    db.prepare('DELETE FROM hydro_bill_lines WHERE bill_id = ?').run(bill.id);
    db.prepare('DELETE FROM hydro_station_bills WHERE id = ?').run(bill.id);
    bill = makeBill({ lines: [{ name: 'PUNJAB', total: 100000, nrldc: 1500 }] });
    postBillToLedger(bill);
    expect(punjab().rows[0].amount).toBe(101500);
  });

  it('does not post the same bill twice', () => {
    postBillToLedger(bill);
    const again = postBillToLedger(bill);
    expect(again.posted).toBe(0);
    expect(again.already).toBe(2);
    expect(punjab().rows).toHaveLength(1);
  });
});

describe('payment', () => {
  beforeEach(() => postBillToLedger(bill));

  const pay = (amount, date = '2026-07-15') => recordPayment({
    contractId, beneficiaryName: 'PUNJAB', amount, paymentDate: date,
  });

  it('clears the bill it is paid against', () => {
    const r = pay(100000);
    expect(r.clearings).toHaveLength(1);
    expect(r.unapplied).toBe(0);

    const acc = punjab();
    expect(acc.totals.outstanding).toBe(0);
    const pb = acc.rows.find((x) => x.doc_type === 'PB');
    expect(pb.outstanding).toBe(0);
    // The CLR DOC / CLR Date columns of the printed screen.
    expect(pb.clr_doc).toBe(r.doc.doc_no);
    expect(pb.clr_date).toBe('2026-07-15');
  });

  it('tells a screen how much of a payment is set against bills', () => {
    // The clearing rows are keyed by the debit they paid, so a payment cannot
    // see them from its own row. Without this a screen cannot tell an applied
    // payment from an advance, and so cannot offer to reset the clearing.
    const r = pay(40000);
    const acc = punjab();
    const pmt = acc.rows.find((x) => x.doc_type === 'PMT');
    expect(pmt.applied).toBe(40000);
    expect(pmt.unapplied).toBe(0);

    resetClearing(r.doc.id);
    const after = punjab().rows.find((x) => x.doc_type === 'PMT');
    expect(after.applied).toBe(0);
    expect(after.unapplied).toBe(40000);
  });

  it('leaves a part payment showing what is still owed', () => {
    pay(40000);
    const acc = punjab();
    expect(acc.totals.outstanding).toBe(60000);
    expect(acc.totals.received).toBe(40000);
  });

  it('shows money paid beyond the bill as an advance, not as settled', () => {
    const r = pay(130000);
    expect(r.unapplied).toBe(30000);
    const acc = punjab();
    expect(acc.totals.outstanding).toBe(0);
    expect(acc.totals.advance).toBe(30000);
    // The payment is partly applied, so it still reads as a payment.
    expect(acc.rows.find((x) => x.doc_type === 'PMT').display_type).toBe('PMT');
  });

  it('shows a payment against nothing as an advance', () => {
    db.prepare('DELETE FROM hydro_ledger_clearings').run();
    db.prepare(`DELETE FROM hydro_ledger_docs WHERE doc_type = 'PB'`).run();
    pay(25000);
    const acc = punjab();
    expect(acc.rows.find((x) => x.doc_type === 'PMT').display_type).toBe('ADV');
    expect(acc.totals.advance).toBe(25000);
  });

  it('clears the oldest bill first', () => {
    const older = makeBill({ month: '2026-05', dueDate: '2026-06-30' });
    postBillToLedger(older);
    pay(100000);
    const acc = punjab();
    const may = acc.rows.find((r) => r.info?.includes('2026-05'));
    const june = acc.rows.find((r) => r.info?.includes('2026-06'));
    expect(may.outstanding).toBe(0);
    expect(june.outstanding).toBe(100000);
  });

  it('refuses a payment that is not a positive amount', () => {
    expect(() => pay(0)).toThrow(/positive amount/);
    expect(() => pay(-500)).toThrow(/positive amount/);
  });

  it('keeps one beneficiary\'s payment off another\'s account', () => {
    pay(100000);
    expect(accountDisplay(contractId, 'HARYANA').totals.outstanding).toBe(50000);
  });
});

describe('reversing a payment', () => {
  beforeEach(() => postBillToLedger(bill));

  it('reopens the bill it had cleared and leaves both documents visible', () => {
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 100000, paymentDate: '2026-07-15' });
    expect(punjab().totals.outstanding).toBe(0);

    const r = reversePayment(p.doc.id, { reason: 'wrong beneficiary' });
    expect(r.reversal_doc_no).toBeTruthy();

    const acc = punjab();
    expect(acc.totals.outstanding).toBe(100000);
    // Neither the payment nor its counter-entry is deleted.
    expect(acc.rows.filter((x) => x.doc_type === 'PMT')).toHaveLength(2);
    expect(acc.rows.every((x) => x.doc_type !== 'PMT' || x.status === 'REVERSED')).toBe(true);
    // The reversal does not leave money sitting as an advance.
    expect(acc.totals.advance).toBe(0);
  });

  it('insists on a reason and refuses a second reversal', () => {
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 10000, paymentDate: '2026-07-15' });
    expect(() => reversePayment(p.doc.id, {})).toThrow(/must say why/);
    reversePayment(p.doc.id, { reason: 'duplicate' });
    expect(() => reversePayment(p.doc.id, { reason: 'again' })).toThrow(/already reversed/);
  });
});

describe('reset clearing and account maintenance', () => {
  beforeEach(() => postBillToLedger(bill));

  it('releases a payment into an advance, then applies it back', () => {
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 100000, paymentDate: '2026-07-15' });
    expect(punjab().totals.outstanding).toBe(0);

    const reset = resetClearing(p.doc.id);
    expect(reset.unapplied).toBe(100000);
    let acc = punjab();
    // The money is still on the account — it is just no longer against a bill.
    expect(acc.totals.outstanding).toBe(100000);
    expect(acc.totals.advance).toBe(100000);
    expect(acc.rows.find((x) => x.doc_type === 'PMT').display_type).toBe('ADV');

    accountMaintenance(p.doc.id, { onDate: '2026-08-01' });
    acc = punjab();
    expect(acc.totals.outstanding).toBe(0);
    expect(acc.totals.advance).toBe(0);
  });

  it('refuses to reset a payment that is already an advance', () => {
    db.prepare(`DELETE FROM hydro_ledger_docs WHERE doc_type = 'PB'`).run();
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 5000, paymentDate: '2026-07-15' });
    expect(() => resetClearing(p.doc.id)).toThrow(/already an advance/);
  });

  it('applies an advance to a chosen bill rather than the oldest', () => {
    const older = makeBill({ month: '2026-05', dueDate: '2026-06-30' });
    postBillToLedger(older);
    db.prepare(`DELETE FROM hydro_ledger_clearings`).run();
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 100000, paymentDate: '2026-07-15' });
    resetClearing(p.doc.id);

    const juneDoc = openDebits(contractId, 'PUNJAB').find((d) => d.info.includes('2026-06'));
    accountMaintenance(p.doc.id, { debitDocIds: [juneDoc.id] });

    expect(outstandingOf(juneDoc.id)).toBe(0);
    const mayDoc = openDebits(contractId, 'PUNJAB').find((d) => d.info.includes('2026-05'));
    expect(mayDoc.outstanding).toBe(100000);
  });

  it('refuses maintenance on an advance with nothing left', () => {
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 100000, paymentDate: '2026-07-15' });
    expect(() => accountMaintenance(p.doc.id)).toThrow(/nothing left to apply/);
  });
});

describe('late payment surcharge', () => {
  beforeEach(() => postBillToLedger(bill));

  it('accrues nothing before the due date', () => {
    const a = accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date('2026-07-20') });
    expect(a.total_accrued).toBe(0);
  });

  it('accrues on the outstanding balance once overdue', () => {
    const a = accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date('2026-09-30') });
    expect(a.lines).toHaveLength(1);
    expect(a.lines[0].days_overdue).toBeGreaterThan(0);
    expect(a.total_accrued).toBeGreaterThan(0);
    expect(a.lines[0].outstanding).toBe(100000);
  });

  it('surcharges only what is still unpaid', () => {
    const full = accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date('2026-09-30') }).total_accrued;
    recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 75000, paymentDate: '2026-08-01' });
    const part = accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date('2026-09-30') }).total_accrued;
    expect(part).toBeLessThan(full);
    expect(part).toBeGreaterThan(0);
  });

  it('posts the surcharge as its own document on the account', () => {
    const r = postLps(contractId, 'PUNJAB', { asOf: new Date('2026-09-30') });
    expect(r.posted).toBe(1);
    const acc = punjab();
    const lps = acc.rows.find((x) => x.doc_type === 'LPS');
    expect(lps.amount).toBeGreaterThan(0);
    // The surcharge is money owed, so it joins the outstanding balance.
    expect(acc.totals.outstanding).toBe(100000 + lps.amount);
    expect(acc.totals.surcharge).toBe(lps.amount);
  });

  it('charges only the increment when run again', () => {
    const first = postLps(contractId, 'PUNJAB', { asOf: new Date('2026-09-30') });
    const same = postLps(contractId, 'PUNJAB', { asOf: new Date('2026-09-30') });
    expect(same.posted).toBe(0);

    const later = postLps(contractId, 'PUNJAB', { asOf: new Date('2026-10-31') });
    expect(later.posted).toBe(1);

    // Posting twice must charge the same as posting once for the whole period:
    // the second run adds only the days the first did not cover.
    const posted = punjab().totals.surcharge;
    const wholePeriod = accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date('2026-10-31') }).total_accrued;
    expect(posted).toBeCloseTo(wholePeriod, 0);
    expect(posted).toBeGreaterThan(first.accrual.total_chargeable);
    // And the surcharge itself is not surcharged — only bills accrue LPS.
    expect(accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date('2026-12-31') }).lines).toHaveLength(1);
  });

  it('stops accruing once the bill is paid', () => {
    recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 100000, paymentDate: '2026-07-20' });
    const a = accruedLpsFor(contractId, 'PUNJAB', { asOf: new Date('2026-12-31') });
    expect(a.total_accrued).toBe(0);
  });
});

describe('reversing a bill', () => {
  beforeEach(() => postBillToLedger(bill));

  it('withdraws its documents when nothing has been paid', () => {
    expect(billReversalBlockers(bill.id)).toEqual([]);
    const r = reverseBillDocs(bill.id, { reason: 'wrong REA' });
    expect(r.reversed).toBe(2);
    expect(punjab().totals.outstanding).toBe(0);
  });

  it('refuses while a payment stands against it, and names the payment', () => {
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 60000, paymentDate: '2026-07-15' });
    const blockers = billReversalBlockers(bill.id);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].doc_no).toBe(p.doc.doc_no);
    expect(() => reverseBillDocs(bill.id, { reason: 'x' })).toThrow(/Reset the clearing/);
  });

  it('goes through once the clearing is reset', () => {
    const p = recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 60000, paymentDate: '2026-07-15' });
    resetClearing(p.doc.id);
    expect(() => reverseBillDocs(bill.id, { reason: 'wrong REA' })).not.toThrow();
  });
});

describe('due date', () => {
  it('comes from the contract\'s own payment terms', () => {
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
    const due = dueDateFor(contract, '2026-07-01');
    expect(due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(due).getTime()).toBeGreaterThan(new Date('2026-07-01').getTime());
  });
});
