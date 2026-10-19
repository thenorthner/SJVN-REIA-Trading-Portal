import { describe, it, expect } from 'vitest';
import { makeContract } from '../helpers/reia.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { recordTds, updateTdsCertificate } from '../../src/services/hydroDesk.js';

// Thermal QA run 14 (19-Oct-2026): TDS and Form 16A on real dates.

describe('TDS', () => {
  it('refuses a deduction or certificate dated 30 February', () => {
    const c = makeContract({ project_type: 'Thermal' });
    insertDoc({ doc_no: `PB/T14/${c.id}`, contract_id: c.id, beneficiary_name: 'BIHAR', doc_type: 'PB', amount: 1000000, doc_date: '2026-01-15', due_date: '2026-03-01' });
    const base = { contract_id: c.id, beneficiary_name: 'BIHAR', section: '194Q', tds_amount: 1000 };
    expect(() => recordTds({ ...base, deduction_date: '2026-02-30' }, null)).toThrow(/that exists/);
    const ok = recordTds({ ...base, deduction_date: '2026-02-01' }, null);
    expect(() => updateTdsCertificate(ok.entry.id, { certificate_no: 'ABCD123', certificate_date: '2026-02-30' })).toThrow(/that exists/);
  });
});
