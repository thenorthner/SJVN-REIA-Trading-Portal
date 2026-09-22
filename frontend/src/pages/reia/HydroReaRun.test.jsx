import { describe, it, expect } from 'vitest';
import { monthFromReaLink, parseReaLinks, monthsBetween } from './HydroReaRun.jsx';

// Links as NRPC's site serves them, September 2026.
describe('REA links pasted from nrpc.gov.in', () => {
  it('reads the month off the file name, provisional or final', () => {
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/090920261230385307REA0826_P.pdf')).toBe('2026-08');
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/230620261441432086Rea0625_F.pdf')).toBe('2025-06');
    expect(monthFromReaLink('https://nrpc.gov.in/comm/2021-22/REA/REA1225_P.pdf')).toBe('2025-12');
  });

  it('does not read a supporting workbook, an amendment code or a nonsense month as an REA', () => {
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/090920261231098653Supporting_files_at_cr0826.xlsx')).toBeNull();
    expect(monthFromReaLink('https://nrpc.gov.in/allfile/x/REA1326_P.pdf')).toBeNull();
    expect(monthFromReaLink('hello')).toBeNull();
  });

  it('keys a pasted list by month and says what it could not read', () => {
    const { links, unread } = parseReaLinks(`
      https://nrpc.gov.in/allfile/090920261745080463REA0426_P.pdf
      https://nrpc.gov.in/allfile/090920261745379237REA0526_P.pdf
      https://nrpc.gov.in/allfile/150920261731280113Supporting_files_at_cr0426.xlsx
    `);
    expect(Object.keys(links)).toEqual(['2026-04', '2026-05']);
    expect(unread).toHaveLength(1);
  });
});

describe('months to run', () => {
  it('lists every month in the range, across a year end', () => {
    expect(monthsBetween('2026-04', '2026-08')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsBetween('2026-06', '2026-06')).toEqual(['2026-06']);
  });
});
