import { describe, it, expect } from 'vitest';
import { parseLedgerDate, applicationDate } from '../src/services/ledgerImporter.js';

// The workbook's numeric date cells are day/month swapped: the dates were typed
// DD/MM/YYYY into a workbook reading MM/DD/YYYY. These pin that behaviour down,
// because getting it wrong silently moves data by months.
describe('parseLedgerDate', () => {
  it('swaps day and month back on a mis-read serial', () => {
    // 46026 decodes to 4 January 2026; the application number says 1 April.
    expect(parseLedgerDate(46026)).toBe('2026-04-01');
  });

  it('swaps the whole mis-read run consistently', () => {
    expect(parseLedgerDate(46027)).toBe('2026-05-01');   // decodes 5 Jan -> 1 May
    expect(parseLedgerDate(46058)).toBe('2026-05-02');
    expect(parseLedgerDate(46361)).toBe('2026-05-12');
  });

  it('leaves a serial alone when the decoded day cannot be a month', () => {
    // A day above 12 could not have been mis-read as a month, so it is genuine.
    const iso = parseLedgerDate(46020);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number(iso.slice(8))).toBeGreaterThan(12);
  });

  it('reads the three text separators the sheets use', () => {
    expect(parseLedgerDate('25/04/2026')).toBe('2026-04-25');   // schedule sheets
    expect(parseLedgerDate('07.04.2026')).toBe('2026-04-07');   // billing sheets
    expect(parseLedgerDate('25-04-2026')).toBe('2026-04-25');   // energy payment sheet
  });

  it('pads a single-digit day or month', () => {
    expect(parseLedgerDate('1/4/2026')).toBe('2026-04-01');
  });

  it('returns null for an empty cell and passes free text through', () => {
    expect(parseLedgerDate(null)).toBeNull();
    expect(parseLedgerDate('')).toBeNull();
    expect(parseLedgerDate('Payment Recevied on next day')).toBe('Payment Recevied on next day');
  });
});

describe('applicationDate', () => {
  it('takes the date from the application number, which is authoritative', () => {
    expect(applicationDate('SJVN010426WR2354', 46026)).toBe('2026-04-01');
    expect(applicationDate('SJVN310726WR2850', null)).toBe('2026-07-31');
  });

  it('agrees with the repaired cell rather than contradicting it', () => {
    expect(applicationDate('SJVN010426WR2354', 46026)).toBe(parseLedgerDate(46026));
  });

  it('falls back to the cell when the number carries no date', () => {
    expect(applicationDate('SJVN/2023-24/02/11042023', '11/04/2023')).toBe('2023-04-11');
  });
});
