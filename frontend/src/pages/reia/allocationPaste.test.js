import { describe, it, expect } from 'vitest';
import { parseAllocationPaste, parseEnergyPaste } from './allocationPaste.js';

// The desk has the REA allocation in a spreadsheet, so the sheet arrives here as
// a paste. What matters most is that a multi-word beneficiary name survives the
// split intact — "BSES RAJDHANI POWER" is one party, not three — and that a line
// the parser cannot read is reported rather than dropped, because a silently
// missing beneficiary is a sheet that no longer closes on 100%.

describe('parsing a pasted REA allocation sheet', () => {
  it('reads a tab-separated paste, the shape Excel gives', () => {
    const { rows, errors, total, closesOn100 } = parseAllocationPaste(
      'CHANDIGARH\t1.714551\nPUNJAB\t11.356856\nGoHP*\t34.000000\nUTTAR PRADESH\t52.928593',
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ sr_no: 1, beneficiary_name: 'CHANDIGARH', pct_rea: 1.714551 });
    expect(total).toBeCloseTo(100, 6);
    expect(closesOn100).toBe(true);
  });

  it('keeps a multi-word beneficiary name in one piece', () => {
    const { rows } = parseAllocationPaste('BSES RAJDHANI POWER\t5.851416\nAJMER VVNL\t2.810239');
    expect(rows.map((r) => r.beneficiary_name)).toEqual(['BSES RAJDHANI POWER', 'AJMER VVNL']);
  });

  it('splits on two or more spaces when the paste has lost its tabs', () => {
    const { rows, errors } = parseAllocationPaste('BSES YAMUNA POWER   2.405400   DELHI');
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      beneficiary_name: 'BSES YAMUNA POWER', pct_rea: 2.4054, parent_state: 'DELHI',
    });
  });

  it('marks the home state from a trailing asterisk', () => {
    const { rows } = parseAllocationPaste('GoHP*\t34\nPUNJAB\t66');
    expect(rows[0]).toMatchObject({ beneficiary_name: 'GoHP', is_home_state: 1 });
    expect(rows[1].is_home_state).toBe(0);
  });

  it('drops a serial number the paste carried in from the sheet', () => {
    const { rows } = parseAllocationPaste('1\tCHANDIGARH\t1.714551\n2\tTPDDL\t2.905400\tDELHI');
    expect(rows[0]).toMatchObject({ beneficiary_name: 'CHANDIGARH', pct_rea: 1.714551 });
    expect(rows[1]).toMatchObject({ beneficiary_name: 'TPDDL', pct_rea: 2.9054, parent_state: 'DELHI' });
  });

  it('accepts a percent sign, commas and blank lines', () => {
    const { rows, errors } = parseAllocationPaste('GoHP*, 34%\n\nPUNJAB, 66%\n\n');
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].pct_rea).toBe(34);
  });

  it('renumbers rows so the saved sheet is ordered even if the paste was not', () => {
    const { rows } = parseAllocationPaste('7\tPUNJAB\t50\n3\tHARYANA*\t50');
    expect(rows.map((r) => r.sr_no)).toEqual([1, 2]);
  });

  it('reports the lines it could not read instead of dropping them silently', () => {
    const { rows, errors } = parseAllocationPaste('GoHP*\t34\nPUNJAB\nHARYANA\tabc');
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Line 2/);
    expect(errors[1]).toMatch(/Line 3/);
  });

  it('says a sheet does not close on 100% so it cannot bill', () => {
    const { total, closesOn100 } = parseAllocationPaste('GoHP*\t34\nPUNJAB\t50');
    expect(total).toBe(84);
    expect(closesOn100).toBe(false);
  });

  it('treats an empty paste as nothing to save, not as a valid sheet', () => {
    const { rows, closesOn100 } = parseAllocationPaste('   \n\n');
    expect(rows).toEqual([]);
    expect(closesOn100).toBe(false);
  });

  it('reads the whole NJHPS sheet back to 100%', () => {
    const { rows, errors, closesOn100 } = parseAllocationPaste(`
      CHANDIGARH\t1.714551
      TPDDL\t2.905400\tDELHI
      BSES RAJDHANI POWER\t5.851416\tDELHI
      BSES YAMUNA POWER\t2.405400\tDELHI
      GoHP*\t34.000000
      HPSEB\t2.470000
      HARYANA\t5.750689
      J & K\t7.423054
      PUNJAB\t11.356856
      MPPMCL\t0.172814
      AJMER VVNL\t2.810239\tRAJASTHAN
      JAIPUR VVNL\t3.964832\tRAJASTHAN
      JODHPUR VVNL\t3.598641\tRAJASTHAN
      UTTARAKHAND\t0.846108
      UTTAR PRADESH\t14.730000
    `);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(15);
    expect(closesOn100).toBe(true);
    // "J & K" keeps its ampersand rather than being split on it.
    expect(rows.find((r) => r.pct_rea === 7.423054).beneficiary_name).toBe('J & K');
    expect(rows.filter((r) => r.is_home_state)).toHaveLength(1);
  });
});

// The REA states each beneficiary's scheduled energy in its table D2, in Lakh
// Units. That column is what SJVN actually bills on, so it is pasted in the same
// way the allocation sheet is — and the unit is asked for rather than guessed,
// because reading LU as kWh is a factor-of-100,000 error.

describe('parsing the REA table D2 energy column', () => {
  // NRPC Provisional REA, June 2026, NJHPS — verbatim.
  const D2 = [
    'CHANDIGARH\t125.396150',
    'DELHI\t816.163800',
    'HARYANA\t420.496400',
    'UTTAR PRADESH\t1077.003700',
  ].join('\n');

  it('converts Lakh Units to kWh by default', () => {
    const { rows, errors } = parseEnergyPaste(D2);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ beneficiary_name: 'CHANDIGARH', kwh: 12539615 });
    expect(rows[3]).toEqual({ beneficiary_name: 'UTTAR PRADESH', kwh: 107700370 });
  });

  it('takes the figures as they are when they are already kWh', () => {
    const { rows } = parseEnergyPaste('CHANDIGARH\t12539615', { unit: 'kWh' });
    expect(rows[0].kwh).toBe(12539615);
  });

  it('keeps a multi-word beneficiary name in one piece', () => {
    const { rows } = parseEnergyPaste('BSES RAJDHANI POWER\t427.863857');
    expect(rows[0].beneficiary_name).toBe('BSES RAJDHANI POWER');
    expect(rows[0].kwh).toBeCloseTo(42786385.7, 1);
  });

  it('reports the total so it can be checked against the station', () => {
    const { total } = parseEnergyPaste(D2);
    expect(total).toBeCloseTo(12539615 + 81616380 + 42049640 + 107700370, 1);
  });

  it('drops a serial number and accepts thousands separators', () => {
    const { rows, errors } = parseEnergyPaste('1\tCHANDIGARH\t1,077.003700');
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ beneficiary_name: 'CHANDIGARH', kwh: 107700370 });
  });

  it('reports lines it cannot read instead of dropping them', () => {
    const { rows, errors } = parseEnergyPaste('CHANDIGARH\t125.396150\nDELHI\nHARYANA\tabc');
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Line 2/);
  });

  it('refuses a negative figure', () => {
    const { rows, errors } = parseEnergyPaste('CHANDIGARH\t-5');
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/not a usable energy figure/);
  });
});
