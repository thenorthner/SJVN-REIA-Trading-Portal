import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { deriveClientCode, genSjvnInvoiceNo, seedInvoiceCounters, genApplicationNo, seedApplicationCounters } from '../src/util.js';

beforeEach(() => {
  db.prepare('DELETE FROM invoice_counters').run();
});

describe('deriveClientCode', () => {
  it('takes the first real word', () => {
    expect(deriveClientCode('Kreate Energy India Pvt Ltd')).toBe('KREATE');
    expect(deriveClientCode('Teesta Urja Ltd')).toBe('TEESTA');
  });

  it('drops the M/s honorific rather than turning it into a code', () => {
    expect(deriveClientCode('M/s. GUJARAT ALKALIES AND CHEMICALS LIMITED')).toBe('GUJARAT');
    expect(deriveClientCode('M/s Electrotherm')).toBe('ELECTROTHERM');
  });

  it('falls back when there is nothing usable', () => {
    expect(deriveClientCode('')).toBe('CLIENT');
    expect(deriveClientCode(null)).toBe('CLIENT');
  });
});

describe('genSjvnInvoiceNo', () => {
  it('builds the official SJVN format', () => {
    seedInvoiceCounters();
    expect(genSjvnInvoiceNo('ENERGY', 'KREATE', '2026-05')).toBe('SJVN/ENERGY/KREATE/202605/146');
  });

  it('continues the ledger registers rather than restarting them', () => {
    seedInvoiceCounters();
    // The ledger's last issued numbers were ENERGY 145 and OA 265.
    expect(genSjvnInvoiceNo('ENERGY', 'KREATE', '2026-05')).toBe('SJVN/ENERGY/KREATE/202605/146');
    expect(genSjvnInvoiceNo('OA', 'KREATE', '2026-05')).toBe('SJVN/OA/KREATE/202605/266');
  });

  it('runs a series on across months', () => {
    seedInvoiceCounters();
    genSjvnInvoiceNo('ENERGY', 'KREATE', '2026-05');
    expect(genSjvnInvoiceNo('ENERGY', 'KREATE', '2026-06')).toBe('SJVN/ENERGY/KREATE/202606/147');
  });

  it('keeps each series and client on its own counter', () => {
    seedInvoiceCounters();
    genSjvnInvoiceNo('ENERGY', 'KREATE', '2026-05');
    expect(genSjvnInvoiceNo('ENERGY', 'Electrotherm India', '2026-05')).toBe('SJVN/ENERGY/ELECTROTHERM/202605/1');
    expect(genSjvnInvoiceNo('OA', 'KREATE', '2026-05')).toBe('SJVN/OA/KREATE/202605/266');
  });

  it('accepts either YYYY-MM or YYYYMM', () => {
    expect(genSjvnInvoiceNo('ENERGY', 'TestCo', '202607')).toMatch(/\/202607\/1$/);
  });

  it('never issues the same number twice', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(genSjvnInvoiceNo('ENERGY', 'LoopCo', '2026-05'));
    expect(seen.size).toBe(50);
  });
});

describe('genApplicationNo', () => {
  it('builds SJVN<DDMMYY><REGION><SEQ> and continues the ledger register', () => {
    seedApplicationCounters();
    // The ledger's last Western Region filing was WR2850.
    expect(genApplicationNo('2026-08-01')).toBe('SJVN010826WR2851');
  });

  it('keeps a separate counter per corridor', () => {
    seedApplicationCounters();
    genApplicationNo('2026-08-01');
    expect(genApplicationNo('2026-08-01', 'NR')).toBe('SJVN010826NR1');
  });

  it('takes the date part from the application date', () => {
    seedApplicationCounters();
    expect(genApplicationNo('2026-12-25')).toMatch(/^SJVN251226WR/);
  });

  it('rejects an unusable date instead of producing a wrong number', () => {
    expect(() => genApplicationNo('not-a-date')).toThrow(/Invalid application date/);
  });
});
