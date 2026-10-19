import { describe, it, expect } from 'vitest';
import { makeContract } from '../helpers/reia.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { createReconciliation } from '../../src/services/hydroDesk.js';

// Thermal QA run 13 (19-Oct-2026): a statement period is made of real dates.

describe('Balance confirmation', () => {
  it('refuses 30 February', () => {
    const c = makeContract({ project_type: 'Thermal' });
    insertDoc({ doc_no: `PB/T13/${c.id}`, contract_id: c.id, beneficiary_name: 'BIHAR', doc_type: 'PB', amount: 100, doc_date: '2026-01-15', due_date: '2026-03-01' });
    expect(() => createReconciliation({ contract_id: c.id, beneficiary_name: 'BIHAR', period_from: '2026-02-01', period_to: '2026-02-30' }, null))
      .toThrow(/real dates/);
    expect(createReconciliation({ contract_id: c.id, beneficiary_name: 'BIHAR', period_from: '2026-01-01', period_to: '2026-02-28' }, null).closing_balance).toBe(100);
  });
});
