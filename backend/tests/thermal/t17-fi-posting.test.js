import { describe, it, expect } from 'vitest';
import db from '../../src/db/index.js';
import { makeContract } from '../helpers/reia.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { INSERT_BILL, emptyBillBlocks } from '../../src/services/hydroClaims.js';
import { preparePosting, listPostings } from '../../src/services/hydroFiPosting.js';

// Thermal QA run 17 (19-Oct-2026): a thermal station's sale reaches Finance as thermal, not hydro.

describe('A thermal FI posting', () => {
  it('is numbered and labelled as thermal energy sale', () => {
    const c = makeContract({ project_type: 'Thermal' });
    const id = `HSB-T17-${c.id}`;
    db.prepare(INSERT_BILL).run({
      id, bill_no: `HB/T17/${c.id}`, contract_id: c.id, station_name: 'Buxar', billing_month: '2026-09', financial_year: '2026-2027',
      bill_kind: 'PROVISIONAL', rea_reference: null, revision_reason: null, ...emptyBillBlocks(c), total_charges: 1000000, prepared_by: null, created_by: null,
    });
    db.prepare(`UPDATE hydro_station_bills SET status = 'ISSUED' WHERE id = ?`).run(id);
    insertDoc({ doc_no: `PB/T17/${c.id}`, contract_id: c.id, beneficiary_name: 'BIHAR', doc_type: 'PB', bill_id: id, amount: 1000000, doc_date: '2026-10-01', due_date: '2026-11-15' });
    const p = preparePosting({ contract: { ...c, station_name: 'Buxar', plant_code: null }, periodMonth: '2026-09', category: 'HYDRO' });
    expect(p.posting_no).toMatch(/^FI\/THM\/THERMAL\/202609\//);
    expect(p.category_label).toMatch(/^Thermal energy sale/);
    expect(listPostings(c.id)[0].category_label).toMatch(/^Thermal/);
  });
});
