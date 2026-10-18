import { describe, it, expect, beforeEach } from 'vitest';
import { makeContract, makeUser } from '../helpers/reia.js';
import { insertDoc, recordPayment } from '../../src/services/hydroLedger.js';
import { raiseNote, approveNote } from '../../src/services/hydroNotes.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';

// Hydro QA run 5 (18-Oct-2026): a credit note named against a bill stays within
// what that bill owes, when raised and again when approved.

let station, pb, maker, checker;
const credit = (amount, over = {}) => raiseNote({ contract_id: station.id, beneficiary_name: 'QA STATE', note_type: 'CREDIT', reason: 'BILLING_ERROR', remarks: 'QA credit note for the bill', amount, against_doc_id: pb.id, ...over }, maker);

beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA5-${Math.random().toString(36).slice(2, 8)}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'QA STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
  pb = insertDoc({ doc_no: `PB/QA5/${Math.random().toString(36).slice(2, 8)}`, contract_id: station.id, beneficiary_name: 'QA STATE', doc_type: 'PB', amount: 100000, doc_date: '2026-09-01', due_date: '2026-10-15' });
  maker = makeUser('COMMERCIAL', { name: 'QA5 Maker' });
  checker = makeUser('COMMERCIAL_ADMIN', { name: 'QA5 Checker' });
});

describe('A credit note against a bill', () => {
  it('counts the drafts already raised on that bill', () => {
    credit(60000);
    expect(() => credit(60000)).toThrow(/already on draft credit notes/);
    expect(credit(40000).amount).toBe(40000);
  });

  it('is refused at approval if the bill no longer owes that much', () => {
    const n = credit(50000);
    recordPayment({ contractId: station.id, beneficiaryName: 'QA STATE', amount: 100000, paymentDate: '2026-09-02', rebate: false });
    expect(() => approveNote(n.id, checker)).toThrow(/now has only ₹0 outstanding/);
  });

  it('cannot be dated after today', () => {
    expect(() => credit(1000, { note_date: '2099-01-01' })).toThrow(/after today/);
  });
});
