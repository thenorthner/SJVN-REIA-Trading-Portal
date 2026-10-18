import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { makeContract } from '../helpers/reia.js';
import { insertDoc, recordPayment } from '../../src/services/hydroLedger.js';
import { createReconciliation, moveReconciliation } from '../../src/services/hydroDesk.js';

// Hydro QA run 9 (18-Oct-2026): a balance is agreed on the account as it stands.

let station;
const user = { name: 'QA9 Desk' };
const period = { period_from: '2026-04-01', period_to: '2026-09-30' };
beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA9-${Math.random().toString(36).slice(2, 8)}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'QA STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
  insertDoc({ doc_no: `PB/QA9/${Math.random().toString(36).slice(2, 8)}`, contract_id: station.id, beneficiary_name: 'QA STATE', doc_type: 'PB', amount: 500000, doc_date: '2026-07-01', due_date: '2026-08-15' });
});
const statement = () => createReconciliation({ contract_id: station.id, beneficiary_name: 'QA STATE', ...period }, user);
const payInPeriod = () => recordPayment({ contractId: station.id, beneficiaryName: 'QA STATE', amount: 100000, paymentDate: '2026-09-10', rebate: false });

describe('A balance confirmation', () => {
  it('is drawn up afresh when sent, so a payment entered after it is in what goes out', () => {
    const r = statement();
    payInPeriod();
    expect(moveReconciliation(r.id, { to: 'SENT' }, user).closing_balance).toBe(400000);
  });

  it('is not confirmed on figures the account has since moved away from', () => {
    const r = statement();
    moveReconciliation(r.id, { to: 'SENT' }, user);
    payInPeriod();
    expect(() => moveReconciliation(r.id, { to: 'CONFIRMED', beneficiary_balance: 500000 }, user)).toThrow(/send the statement again/);
    moveReconciliation(r.id, { to: 'DISPUTED', beneficiary_balance: 400000, remarks: 'paid 1 lakh on 10 Sep' }, user);
    moveReconciliation(r.id, { to: 'SENT' }, user);
    expect(moveReconciliation(r.id, { to: 'CONFIRMED', beneficiary_balance: 400000 }, user).status).toBe('CONFIRMED');
  });

  it('is not drawn up twice for a period already signed off', () => {
    const r = statement();
    moveReconciliation(r.id, { to: 'SENT' }, user);
    moveReconciliation(r.id, { to: 'CONFIRMED', beneficiary_balance: 500000 }, user);
    moveReconciliation(r.id, { to: 'SIGNED_OFF' }, user);
    expect(() => statement()).toThrow(/already signed off this period/);
  });
});
