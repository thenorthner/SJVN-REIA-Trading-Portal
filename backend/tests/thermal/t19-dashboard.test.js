import { describe, it, expect } from 'vitest';
import db from '../../src/db/index.js';
import { makeContract } from '../helpers/reia.js';
import { INSERT_BILL, emptyBillBlocks } from '../../src/services/hydroClaims.js';
import { buildDashboard } from '../../src/services/hydroDashboard.js';

// Thermal QA run 19 (19-Oct-2026): recent bills are live bills, not cancelled probes.

describe('Dashboard recent bills', () => {
  it('leaves out cancelled bills', () => {
    const c = makeContract({ project_type: 'Thermal', contract_type: 'PPA' });
    for (const [month, status] of [['2026-12', 'CANCELLED'], ['2026-09', 'ISSUED']]) {
      db.prepare(INSERT_BILL).run({
        id: `HSB-T19-${month}-${c.id}`, bill_no: `HB/T19/${month}/${c.id}`, contract_id: c.id, station_name: 'S', billing_month: month,
        financial_year: '2026-2027', bill_kind: 'PROVISIONAL', rea_reference: null, revision_reason: null, ...emptyBillBlocks(c),
        total_charges: 100, prepared_by: null, created_by: null,
      });
      db.prepare('UPDATE hydro_station_bills SET status = ? WHERE id = ?').run(status, `HSB-T19-${month}-${c.id}`);
    }
    const mine = buildDashboard({ desk: 'THERMAL' }).recentBills.filter((b) => b.bill_no.includes(c.id));
    expect(mine.map((b) => b.billing_month)).toEqual(['2026-09']);
  });
});
