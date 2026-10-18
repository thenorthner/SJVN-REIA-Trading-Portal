import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { makeContract } from '../helpers/reia.js';
import { insertDoc, reversePayment } from '../../src/services/hydroLedger.js';
import { recordTds, listTds, updateTdsCertificate } from '../../src/services/hydroDesk.js';

// Hydro QA run 10 (18-Oct-2026): TDS a beneficiary deducted.

let station;
const user = { name: 'QA10 Desk' };
const tds = (over = {}) => recordTds({ contract_id: station.id, beneficiary_name: 'QA STATE', section: '194Q', deduction_date: '2026-10-01', tds_amount: 10000, reference: 'UTR-1', ...over }, user);
beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA10-${Math.random().toString(36).slice(2, 8)}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'QA STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
  insertDoc({ doc_no: `PB/QA10/${Math.random().toString(36).slice(2, 8)}`, contract_id: station.id, beneficiary_name: 'QA STATE', doc_type: 'PB', amount: 500000, doc_date: '2026-07-01', due_date: '2026-08-15' });
});

describe('TDS by a beneficiary', () => {
  it('is no more than the beneficiary owes', () => {
    expect(() => tds({ tds_amount: 600000 })).toThrow(/cannot be more than that/);
  });

  it('is recorded once', () => {
    tds();
    expect(() => tds()).toThrow(/already recorded/);
    expect(tds({ reference: 'UTR-2' }).entry.tds_amount).toBe(10000);
  });

  it('leaves the register when its ledger credit is reversed', () => {
    const t = tds();
    reversePayment(t.ledger_doc.id, { reason: 'keyed against the wrong beneficiary' });
    const reg = listTds({ contractId: station.id });
    expect(reg.rows.find((r) => r.id === t.entry.id).status).toBe('REVERSED');
    expect(reg.by_quarter).toEqual([]);
  });

  it('takes a Form 16A dated on or after the deduction and not ahead', () => {
    const t = tds();
    expect(() => updateTdsCertificate(t.entry.id, { certificate_no: '16A-1', certificate_date: '2099-12-31' })).toThrow(/after today/);
    expect(() => updateTdsCertificate(t.entry.id, { certificate_no: '16A-1', certificate_date: 'abc' })).toThrow(/must be a date/);
    expect(updateTdsCertificate(t.entry.id, { certificate_no: '16A-1', certificate_date: '2026-10-10' }).status).toBe('CERTIFICATE_RECEIVED');
  });
});
