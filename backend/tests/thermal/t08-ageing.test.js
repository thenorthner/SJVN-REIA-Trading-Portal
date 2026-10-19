import { describe, it, expect } from 'vitest';
import { makeContract } from '../helpers/reia.js';
import { receivablesAgeing } from '../../src/services/hydroLedger.js';

// Thermal QA run 8 (19-Oct-2026): an impossible as-of date is refused, not rolled over.

describe('Receivables ageing', () => {
  it('refuses 30 February', () => {
    const c = makeContract({ project_type: 'Thermal' });
    expect(() => receivablesAgeing(c.id, { asOf: '2026-02-30' })).toThrow(/not a real date/);
    expect(receivablesAgeing(c.id, { asOf: '2026-02-28' }).as_of).toBe('2026-02-28');
  });
});
