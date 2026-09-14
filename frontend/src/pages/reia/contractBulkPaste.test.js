import { describe, it, expect } from 'vitest';
import { parseContractBulk, BULK_COLUMNS } from './contractBulkPaste.js';

// The sheet a desk pastes out of Excel: the header row names the columns, so a
// rearranged file still loads, and a column the loader does not read is named
// rather than silently dropped.

const HEADER = BULK_COLUMNS.join(',');

describe('reading a pasted contract sheet', () => {
  it('reads the template as written', () => {
    const { rows, errors, unknownColumns } = parseContractBulk([
      HEADER,
      'PPA/SOLAR/001,PPA,SOLAR,SELL-0001,,100,100,2026-04-01,3.15,2026-04-01,2051-03-31,MONTHLY,5000000,20000000',
    ].join('\n'));
    expect(errors).toEqual([]);
    expect(unknownColumns).toEqual([]);
    expect(rows).toEqual([{
      contract_no: 'PPA/SOLAR/001', contract_type: 'PPA', project_type: 'SOLAR',
      seller_id: 'SELL-0001', capacity_mw: 100, commissioned_capacity_mw: 100,
      cod_date: '2026-04-01', tariff_per_unit: 3.15,
      tenure_start: '2026-04-01', tenure_end: '2051-03-31', billing_cycle: 'MONTHLY',
      emd_amount: 5000000, pbg_amount: 20000000,
    }]);
    // An empty cell is left out rather than sent as an empty string.
    expect('buyer_id' in rows[0]).toBe(false);
  });

  it('takes the columns in whatever order the sheet has them', () => {
    const { rows, errors } = parseContractBulk([
      'contract_type,contract_no,capacity_mw,tariff_per_unit,project_type,tenure_start,tenure_end',
      'PSA,PSA/001,50,3.4,WIND,2026-04-01,2031-03-31',
    ].join('\n'));
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ contract_no: 'PSA/001', contract_type: 'PSA', capacity_mw: 50 });
  });

  it('reads a tab-separated paste, which is what Excel puts on the clipboard', () => {
    const { rows } = parseContractBulk([
      'contract_no\tcontract_type\tcapacity_mw',
      'PPA/TAB/1\tPPA\t75.5',
    ].join('\n'));
    expect(rows[0]).toMatchObject({ contract_no: 'PPA/TAB/1', capacity_mw: 75.5 });
  });

  it('strips the quotes and thousands separators a spreadsheet exports', () => {
    const { rows } = parseContractBulk([
      'contract_no,capacity_mw,emd_amount',
      '"PPA/Q/1","100","5,000,000"',
    ].join('\n'));
    expect(rows[0]).toEqual({ contract_no: 'PPA/Q/1', capacity_mw: 100, emd_amount: 5000000 });
  });

  it('names the columns it will not read', () => {
    const { unknownColumns, rows } = parseContractBulk([
      'contract_no,status,remarks',
      'PPA/U/1,ACTIVE,load me live',
    ].join('\n'));
    expect(unknownColumns).toEqual(['status', 'remarks']);
    expect(rows[0]).toEqual({ contract_no: 'PPA/U/1' });
  });

  it('says so when the first line is data rather than a header', () => {
    const { rows, errors } = parseContractBulk('PPA/NOHEAD/1,PPA,SOLAR\n');
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/first line must name the columns/);
  });

  it('reports a line whose number is not a number, by line', () => {
    const { rows, errors } = parseContractBulk([
      'contract_no,capacity_mw',
      'PPA/OK/1,100',
      'PPA/BAD/2,one hundred',
    ].join('\n'));
    expect(rows).toHaveLength(1);
    expect(errors).toEqual(['Line 3: capacity_mw is not a number']);
  });

  it('ignores blank lines and a trailing newline', () => {
    const { rows, errors } = parseContractBulk([
      'contract_no,capacity_mw',
      'PPA/A,10',
      '',
      ',,',
      'PPA/B,20',
      '',
    ].join('\n'));
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.contract_no)).toEqual(['PPA/A', 'PPA/B']);
  });

  it('reads nothing out of nothing', () => {
    expect(parseContractBulk('')).toMatchObject({ rows: [], errors: [] });
    expect(parseContractBulk(null)).toMatchObject({ rows: [], errors: [] });
  });
});
