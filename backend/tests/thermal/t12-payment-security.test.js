import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { makeContract, makeUser } from '../helpers/reia.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { INSERT_BILL, emptyBillBlocks } from '../../src/services/hydroClaims.js';
import { securityPosition, addInstrument } from '../../src/services/hydroDesk.js';

// Thermal QA run 12 (19-Oct-2026): LC cover on the months billed; real validity dates.

let c;
const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const bill = (month, amount) => {
  const id = `HSB-T12-${month}-${c.id}`;
  db.prepare(INSERT_BILL).run({
    id, bill_no: `HB/T12/${month}/${c.id}`, contract_id: c.id, station_name: 'S', billing_month: month, financial_year: '2026-2027',
    bill_kind: 'PROVISIONAL', rea_reference: null, revision_reason: null, ...emptyBillBlocks(c), total_charges: amount, prepared_by: null, created_by: null,
  });
  db.prepare(`UPDATE hydro_station_bills SET status = 'ISSUED' WHERE id = ?`).run(id);
  // Both bills go out on the same day.
  insertDoc({ doc_no: `PB/T12/${month}/${c.id}`, contract_id: c.id, beneficiary_name: 'BIHAR', doc_type: 'PB', bill_id: id, amount, doc_date: today, due_date: '2099-01-01' });
};
beforeAll(() => {
  c = makeContract({ project_type: 'Thermal' });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from, is_active) VALUES (?, ?, 'BIHAR', 100, '2026-04-01', 1)`).run(`HBA-T12-${c.id}`, c.id);
  bill('2026-08', 3000000); bill('2026-09', 1000000);
});

describe('Payment security', () => {
  it('averages over the months billed, not the day the bills went out', () => {
    const row = securityPosition(c.id).rows.find((r) => r.beneficiary_name === 'BIHAR');
    expect(row.average_monthly_billing).toBe(2000000);
    expect(row.required).toBe(2100000);
  });

  it('takes real validity dates', () => {
    const body = { contract_id: c.id, beneficiary_name: 'BIHAR', instrument_type: 'LC', instrument_no: 'LC-T12', issuing_bank: 'SBI', amount: 100, valid_from: '2026-13-01', valid_to: '2027-09-30' };
    expect(() => addInstrument(body, makeUser('THERMAL_USER'))).toThrow(/real dates/);
  });
});
