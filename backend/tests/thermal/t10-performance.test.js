import { describe, it, expect } from 'vitest';
import db from '../../src/db/index.js';
import { makeContract } from '../helpers/reia.js';
import { INSERT_BILL, emptyBillBlocks } from '../../src/services/hydroClaims.js';
import { generationPerformance } from '../../src/services/stationDesk.js';

// Thermal QA run 10 (19-Oct-2026): a revised month stands on its revision; a real financial year.

const bill = (c, kind, pafm, issuedAt) => {
  const id = `HSB-T10-${kind}-${c.id}`;
  db.prepare(INSERT_BILL).run({
    id, bill_no: `HB/T10/${kind}/${c.id}`, contract_id: c.id, station_name: 'S', billing_month: '2026-07', financial_year: '2026-2027',
    bill_kind: kind, rea_reference: null, revision_reason: null, ...emptyBillBlocks(c), total_charges: 1000, prepared_by: null, created_by: null,
  });
  db.prepare(`UPDATE hydro_station_bills SET status = 'ISSUED', c1_pafm_pct = ?, a11_napaf_pct = 85, a8_days_in_month = 31, a9_days_in_year = 365, issued_at = ? WHERE id = ?`)
    .run(pafm, issuedAt, id);
};

describe('Generation performance', () => {
  it('reads a revised month off its revision', () => {
    const c = makeContract({ project_type: 'Thermal', contract_type: 'PPA', capacity_mw: 1320 });
    bill(c, 'PROVISIONAL', 90, '2026-08-05 10:00:00');
    bill(c, 'REVISION', 80, '2026-09-10 10:00:00');
    const jul = generationPerformance('THERMAL', '2026-2027').stations.find((s) => s.contract_id === c.id).months.find((m) => m.month === '2026-07');
    expect(jul.bill_kind).toBe('REVISION');
    expect(jul.pafm_pct).toBe(80);
    expect(jul.below_napaf).toBe(true);
  });

  it('takes one April-to-March year', () => {
    expect(() => generationPerformance('THERMAL', '2026-2028')).toThrow(/April-to-March/);
  });
});
