import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { makeContract } from '../helpers/reia.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { addInstrument, amendInstrument, invokeInstrument, releaseInstrument } from '../../src/services/hydroDesk.js';

// Hydro QA run 8 (18-Oct-2026): an LC / BG on a beneficiary's account.

let station, lc;
const user = { name: 'QA8 Desk' };
const lcFor = (over = {}) => addInstrument({ contract_id: station.id, beneficiary_name: 'QA STATE', instrument_type: 'LC', instrument_no: `LC-${Math.random().toString(36).slice(2, 8)}`, issuing_bank: 'PNB', amount: 500000, valid_from: '2026-04-01', valid_to: '2099-03-31', ...over }, user);

beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA8-${Math.random().toString(36).slice(2, 8)}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'QA STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
  insertDoc({ doc_no: `PB/QA8/${Math.random().toString(36).slice(2, 8)}`, contract_id: station.id, beneficiary_name: 'QA STATE', doc_type: 'PB', amount: 300000, doc_date: '2026-08-01', due_date: '2026-09-01' });
  lc = lcFor();
});

describe('An LC / BG', () => {
  it('is taken only for a beneficiary the station bills', () => {
    expect(() => lcFor({ beneficiary_name: 'NOBODY STATE' })).toThrow(/not a beneficiary of this station/);
  });

  it('is amended only to a real date', () => {
    expect(() => amendInstrument(lc.id, { valid_to: 'abc' }, user)).toThrow(/valid_to must be a date/);
  });

  it('is invoked on a day it was in force, not ahead', () => {
    expect(() => invokeInstrument(lc.id, { amount: 1000, invoked_on: '2099-01-01', remarks: 'overdue bill' }, user)).toThrow(/after today/);
    expect(() => invokeInstrument(lc.id, { amount: 1000, invoked_on: '2025-01-01', remarks: 'overdue bill' }, user)).toThrow(/was in force from/);
    expect(invokeInstrument(lc.id, { amount: 1000, remarks: 'overdue bill' }, user).cleared).toBe(1000);
  });

  it('is not released while the beneficiary is overdue, unless it has lapsed', () => {
    expect(() => releaseInstrument(lc.id, { remarks: 'returning it' }, user)).toThrow(/overdue — a live LC is not released/);
    const old = lcFor({ valid_from: '2025-04-01', valid_to: '2026-03-31' });
    expect(releaseInstrument(old.id, { remarks: 'lapsed, closing it' }, user).status).toBe('RELEASED');
  });
});
