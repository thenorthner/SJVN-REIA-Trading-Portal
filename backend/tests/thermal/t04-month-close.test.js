import { describe, it, expect } from 'vitest';
import db from '../../src/db/index.js';
import { makeContract } from '../helpers/reia.js';
import { INSERT_BILL, emptyBillBlocks } from '../../src/services/hydroClaims.js';
import { monthCloseBoard } from '../../src/services/stationDesk.js';

// Thermal QA run 4 (19-Oct-2026): a month is not closed while any of its issued bills is unbooked.

const bill = (c, kind, no) => {
  const id = `HSB-T04-${no}-${c.id}`;
  db.prepare(INSERT_BILL).run({
    id, bill_no: `${no}/${c.id}`, contract_id: c.id, station_name: 'S', billing_month: '2026-09', financial_year: '2026-2027',
    bill_kind: kind, rea_reference: null, revision_reason: null, ...emptyBillBlocks(c), total_charges: 1000, prepared_by: null, created_by: null,
  });
  db.prepare(`UPDATE hydro_station_bills SET status = 'ISSUED', approval_status = 'APPROVED', dispatch_date = '2026-10-05' WHERE id = ?`).run(id);
  return id;
};

describe('Month-close board', () => {
  it('holds the close for a supplementary issued after the month was booked', () => {
    const c = makeContract({ project_type: 'Thermal', contract_type: 'PPA' });
    const main = bill(c, 'PROVISIONAL', 'HB');
    const p = `HFP-T04-${c.id}`;
    db.prepare(`INSERT INTO hydro_fi_postings (id, posting_no, contract_id, station_name, period_month, bill_category, status, fi_document_no)
      VALUES (?, ?, ?, 'S', '2026-09', 'HYDRO', 'POSTED', ?)`).run(p, `FI/T04/${c.id}`, c.id, `V-${c.id}`);
    db.prepare(`INSERT INTO hydro_fi_posting_lines (id, posting_id, bill_id, bill_no, bill_kind, total_amount) VALUES (?, ?, ?, ?, 'PROVISIONAL', 1000)`)
      .run(`HFL-T04-${c.id}`, p, main, `HB/${c.id}`);
    bill(c, 'SUPPLEMENTARY', 'HSP');
    const b = monthCloseBoard('THERMAL', '2026-09');
    const row = b.rows.find((r) => r.contract_id === c.id);
    expect(row.stage).not.toBe('BOOKED');
    expect(b.checklist.items.find((i) => i.key === 'fi').refs).toContain(`HSP/${c.id}`);
  });

  it('refuses month 13', () => {
    expect(() => monthCloseBoard('THERMAL', '2026-13')).toThrow(/must be a month/);
  });
});
