import { describe, it, expect, beforeAll } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { ensureMasterDefaults, invalidateParamCache } from '../src/mastersService.js';
import { clearHolidayCache } from '../src/services/workingCalendar.js';
import { insertDoc } from '../src/services/hydroLedger.js';
import { planHydroDueDateRedate, applyHydroDueDateRedate } from '../src/services/hydroDueDateRedate.js';
import { makeContract } from './helpers/reia.js';

// Hydro bills posted before due dates followed the working calendar are moved
// on to the beneficiary's next working day — once, and never under money
// already booked on the old date.
//
// Dates used (seeded calendar): Sat 1 Aug 2026 → Mon 3 Aug; Mon 13 Apr is
// Baisakhi in Punjab, Tue 14 Ambedkar Jayanti everywhere → Wed 15 Apr.

let plain;
let dueBasis;
const docs = {};

const bill = (contractId, beneficiary, due, extra = {}) => insertDoc({
  doc_no: newId('PB'), contract_id: contractId, beneficiary_name: beneficiary, doc_type: 'PB',
  amount: 100000, doc_date: '2026-03-01', due_date: due, ...extra,
});

/** A station bill to hang surcharge on; its figures play no part here. */
function stationBill(contractId) {
  const id = newId('HSB');
  const cols = ['a1_afc', 'a2_design_energy_mwh', 'a3_aux_pct', 'a4_fehs_pct', 'a5_ex_bus_design_energy_mwh',
    'a6_ex_bus_saleable_design_energy_mwh', 'a8_days_in_month', 'a9_days_in_year', 'a11_napaf_pct', 'a12_ecr',
    'a13_ecr_excess', 'c1_pafm_pct', 'c2_capacity_charge', 'c5_total_capacity_charge', 'e1_ex_bus_scheduled_kwh',
    'e2_free_power_kwh', 'e3_saleable_scheduled_kwh', 'e4_cum_scheduled_kwh', 'e5_cum_free_power_kwh',
    'e6_cum_saleable_kwh', 'e7_excess_kwh', 'e8_upto_design_kwh', 'ee1_energy_charge', 'ee2_excess_energy_charge',
    'total_charges'];
  db.prepare(`INSERT INTO hydro_station_bills (id, bill_no, contract_id, station_name, billing_month, financial_year, ${cols.join(', ')})
    VALUES (?, ?, ?, 'NJHPS', '2026-06', '2026-2027', ${cols.map(() => '1').join(', ')})`).run(id, newId('BILL'), contractId);
  return id;
}
const dueOf = (doc) => db.prepare('SELECT due_date FROM hydro_ledger_docs WHERE id = ?').get(doc.id).due_date;

beforeAll(() => {
  ensureMasterDefaults();
  for (const [k, v] of [['due_date_counting_mode', 'CALENDAR_ROLL_FORWARD'], ['lps_day_count_mode', 'CALENDAR'], ['weekly_off_days', '[0,6]']]) {
    db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(v, k);
  }
  invalidateParamCache();
  clearHolidayCache();

  plain = makeContract({ project_type: 'Hydro', rebate_basis: 'BILL_DATE' }).id;
  dueBasis = makeContract({ project_type: 'Hydro', rebate_pct: 1.5, rebate_days: 5, rebate_basis: 'DUE_DATE' }).id;

  docs.saturday = bill(plain, 'HARYANA', '2026-08-01');
  docs.baisakhi = bill(plain, 'PUNJAB', '2026-04-13');
  docs.haryanaMonday = bill(plain, 'HARYANA', '2026-04-13'); // open in Haryana
  docs.reversed = bill(plain, 'HARYANA', '2026-08-01');
  db.prepare("UPDATE hydro_ledger_docs SET status = 'REVERSED' WHERE id = ?").run(docs.reversed.id);

  docs.surcharged = bill(plain, 'HARYANA', '2026-08-01', { bill_id: stationBill(plain) });
  insertDoc({
    doc_no: newId('LPS'), contract_id: plain, beneficiary_name: 'HARYANA', doc_type: 'LPS',
    bill_id: docs.surcharged.bill_id, amount: 500, doc_date: '2026-09-30',
  });

  docs.rebated = bill(dueBasis, 'HARYANA', '2026-08-01');
  const rebate = insertDoc({
    doc_no: newId('RBT'), contract_id: dueBasis, beneficiary_name: 'HARYANA', doc_type: 'PMT', mode: 'REBATE',
    amount: 1500, doc_date: '2026-08-03',
  });
  db.prepare(`INSERT INTO hydro_ledger_clearings (id, credit_doc_id, debit_doc_id, amount, cleared_on)
    VALUES (?, ?, ?, 1500, '2026-08-03')`).run(newId('HLC'), rebate.id, docs.rebated.id);
});

describe('re-dating hydro due dates already on the books', () => {
  it('plans only the dates that land on the beneficiary\'s closed day', () => {
    const plan = planHydroDueDateRedate({ asOf: new Date('2026-10-30') });
    const moved = Object.fromEntries(plan.changes.map((c) => [c.id, c]));
    expect(moved[docs.saturday.id]).toMatchObject({ before: '2026-08-01', after: '2026-08-03', reason: 'Saturday' });
    expect(moved[docs.baisakhi.id]).toMatchObject({ before: '2026-04-13', after: '2026-04-15', state: 'Punjab' });
    expect(moved[docs.haryanaMonday.id]).toBeUndefined();
    // Surcharge to date falls by the two days no longer counted.
    expect(moved[docs.saturday.id].lps_after).toBeLessThan(moved[docs.saturday.id].lps_before);
  });

  it('leaves reversed bills and money already booked on the old date', () => {
    const plan = planHydroDueDateRedate({ asOf: new Date('2026-10-30') });
    const why = Object.fromEntries(plan.skipped.map((s) => [s.id, s.why]));
    expect(why[docs.reversed.id]).toMatch(/reversed/);
    expect(why[docs.surcharged.id]).toMatch(/surcharge already posted/);
    expect(why[docs.rebated.id]).toMatch(/rebate already booked/);
  });

  it('writes the new dates with an audit entry, and changes nothing on a second run', () => {
    const first = applyHydroDueDateRedate({ asOf: new Date('2026-10-30') });
    expect(first.applied).toBe(first.changes.length);
    expect(dueOf(docs.saturday)).toBe('2026-08-03');
    expect(dueOf(docs.baisakhi)).toBe('2026-04-15');
    expect(dueOf(docs.surcharged)).toBe('2026-08-01');
    expect(dueOf(docs.reversed)).toBe('2026-08-01');
    expect(dueOf(docs.rebated)).toBe('2026-08-01');

    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'REDATE_HYDRO_DUE_DATES' ORDER BY rowid DESC").get();
    expect(audit).toBeTruthy();
    expect(String(audit.after_value || audit.new_value || JSON.stringify(audit))).toContain('2026-08-03');

    const second = applyHydroDueDateRedate({ asOf: new Date('2026-10-30') });
    expect(second.applied).toBe(0);
    expect(second.changes).toHaveLength(0);
    const audits = db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'REDATE_HYDRO_DUE_DATES'").get().c;
    expect(audits).toBe(1);
  });
});
