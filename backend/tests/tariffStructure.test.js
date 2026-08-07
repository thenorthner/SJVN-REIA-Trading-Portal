import { describe, it, expect } from 'vitest';
import { resolveTariff, contractYearFor } from '../src/services/tariffStructure.js';

const contract = (over = {}) => ({ tariff_per_unit: 3.0, tenure_start: '2026-04-01', ...over });

describe('contractYearFor', () => {
  it('counts from the tenure start, not the calendar year', () => {
    expect(contractYearFor('2026-04', '2026-04-01')).toBe(1);
    expect(contractYearFor('2027-03', '2026-04-01')).toBe(1);   // still year 1
    expect(contractYearFor('2027-04', '2026-04-01')).toBe(2);   // year 2 begins
    expect(contractYearFor('2031-04', '2026-04-01')).toBe(6);
  });

  it('does not go below year 1 for a period before the start', () => {
    expect(contractYearFor('2025-01', '2026-04-01')).toBe(1);
  });
});

describe('resolveTariff', () => {
  it('bills a flat contract at its rate', () => {
    const t = resolveTariff(contract(), '2028-04');
    expect(t.type).toBe('FLAT');
    expect(t.rate).toBe(3.0);
    expect(t.fixed_charge).toBe(0);
  });

  it('compounds an escalating tariff by contract year', () => {
    const c = contract({ tariff_type: 'ESCALATING', tariff_structure_json: JSON.stringify({ base: 3.0, escalation_pct: 2 }) });
    expect(resolveTariff(c, '2026-05').rate).toBe(3.0);      // year 1: base
    expect(resolveTariff(c, '2027-05').rate).toBeCloseTo(3.06, 4);
    expect(resolveTariff(c, '2028-05').rate).toBeCloseTo(3.1212, 4);
  });

  it('splits a two-part tariff into a variable rate and a per-period fixed charge', () => {
    const c = contract({ tariff_type: 'TWO_PART', tariff_structure_json: JSON.stringify({ fixed_annual: 12000000, variable_per_unit: 1.5 }) });
    const t = resolveTariff(c, '2026-04');
    expect(t.rate).toBe(1.5);
    expect(t.fixed_charge).toBe(1000000);   // an annual fixed charge over 12 months
  });

  it('spreads the fixed leg over four periods on a quarterly cycle', () => {
    const c = contract({ tariff_type: 'TWO_PART', billing_cycle: 'QUARTERLY', tariff_structure_json: JSON.stringify({ fixed_annual: 12000000, variable_per_unit: 1.5 }) });
    expect(resolveTariff(c, '2026-04').fixed_charge).toBe(3000000);
  });

  it('falls back to the flat rate when the structure is malformed', () => {
    const c = contract({ tariff_type: 'ESCALATING', tariff_structure_json: '{not json' });
    expect(resolveTariff(c, '2027-05').rate).toBe(3.0);
  });

  it('explains on the bill how the rate was arrived at', () => {
    const c = contract({ tariff_type: 'ESCALATING', tariff_structure_json: JSON.stringify({ base: 3.0, escalation_pct: 2 }) });
    expect(resolveTariff(c, '2027-05').label).toMatch(/year 2.*\+2%/);
  });
});
