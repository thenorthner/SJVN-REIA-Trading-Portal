import { describe, it, expect, beforeAll } from 'vitest';
import db from '../../src/db/index.js';
import { makeEntity, makeContract } from '../helpers/reia.js';
import { rebateRateFor } from '../../src/services/hydroLedger.js';

// Thermal QA run 6 (19-Oct-2026): a station's rebate is never below CERC's tiers.

let thermal; let reiaPpa;
const pb = (contractId) => ({ contract_id: contractId, doc_date: '2026-09-29', due_date: '2026-11-13', bill_line_id: null });
beforeAll(() => {
  const g = makeEntity('SELLER', { name: 'T06 Genco' });
  const mk = (type) => {
    const c = makeContract({ project_type: type, seller_id: g.id });
    db.prepare(`UPDATE contracts SET rebate_pct = 1.5, rebate_days = 5, rebate_basis = 'BILL_DATE' WHERE id = ?`).run(c.id);
    return c.id;
  };
  thermal = mk('Thermal'); reiaPpa = mk('Solar');
});

describe('Early-payment rebate', () => {
  it('gives a thermal station 1% on day 20 under the CERC tiers', () => {
    expect(rebateRateFor(pb(thermal), '2026-10-19').pct).toBe(1);
    expect(rebateRateFor(pb(thermal), '2026-10-02').pct).toBe(1.5);
    expect(rebateRateFor(pb(thermal), '2026-11-15').pct).toBe(0);
  });

  it('leaves a REIA PPA on its own term', () => {
    expect(rebateRateFor(pb(reiaPpa), '2026-10-19').pct).toBe(0);
  });
});
