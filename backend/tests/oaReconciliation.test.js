import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import { reconcileOaCharges, actualsByMonth } from '../src/services/oaReconciliation.js';

function application(no, date, mwh, ists, fee = 5000, rldc = 1000) {
  db.prepare(`
    INSERT INTO oa_application_charges (id, application_no, application_date, buyer,
      approved_mwh, ists_actual, application_fee_actual, rldc_fee_actual, total_actual)
    VALUES (?, ?, ?, 'Test Buyer', ?, ?, ?, ?, ?)
  `).run(`OAC-${no}`, no, date, mwh, ists, fee, rldc, ists + fee + rldc);
}

// ISTS is priced per corridor; these fix the rates the ledger actually billed at.
function istsRate(region, value) {
  db.prepare(`INSERT INTO rate_master (id, rate_category, charge_name, region, rate_value, unit, effective_from, effective_to, is_active)
              VALUES (?, 'ISTS', 'ISTS', ?, ?, 'Rs/MWh', '2026-04-01', NULL, 1)`).run(`R-${region}`, region, value);
}

beforeEach(() => {
  db.prepare('DELETE FROM oa_application_charges').run();
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  db.prepare(`DELETE FROM rate_master WHERE charge_name = 'ISTS'`).run();
  istsRate('WR', 390.12);
  istsRate('NR', 508.92);
});

describe('reconcileOaCharges', () => {
  it('matches an application priced at its corridor rate', () => {
    application('SJVN010526WR2400', '2026-05-01', 100, Math.round(100 * 390.12));
    const r = reconcileOaCharges();
    expect(r.applications).toBe(1);
    expect(r.mismatched).toBe(0);
    expect(r.match_pct).toBe(100);
  });

  it('prices each corridor on its own rate, not a national one', () => {
    application('SJVN010526WR2400', '2026-05-01', 100, Math.round(100 * 390.12));
    application('SJVN020526NR2401', '2026-05-02', 100, Math.round(100 * 508.92));
    const r = reconcileOaCharges();
    expect(r.mismatched).toBe(0);
    expect(r.rows.find(x => x.region === 'NR').ists_estimated).toBe(Math.round(100 * 508.92));
  });

  it('flags an application charged at the wrong rate', () => {
    application('SJVN010526WR2400', '2026-05-01', 100, 50000);   // nowhere near 39,012
    const r = reconcileOaCharges();
    expect(r.mismatched).toBe(1);
    expect(r.mismatches[0].application_no).toBe('SJVN010526WR2400');
  });

  it('reads a multi-day application back from its RLDC fee', () => {
    // Eight days of RLDC at 1,000 means the application ran eight days.
    application('SJVN010526WR2402', '2026-05-01', 100, Math.round(100 * 390.12), 5000, 8000);
    const r = reconcileOaCharges();
    expect(r.rows[0].days).toBe(8);
    expect(r.mismatched).toBe(0);
  });

  it('would call a multi-day application drift if it assumed one day', () => {
    application('SJVN010526WR2403', '2026-05-01', 100, Math.round(100 * 390.12), 5000, 8000);
    // The estimate has to include all eight days for the totals to agree.
    expect(reconcileOaCharges().rows[0].rldc_estimated).toBe(8000);
  });

  it('totals actual against estimated', () => {
    application('SJVN010526WR2400', '2026-05-01', 100, Math.round(100 * 390.12));
    const r = reconcileOaCharges();
    expect(r.total_actual).toBe(39012 + 5000 + 1000);
    expect(Math.abs(r.total_drift)).toBeLessThanOrEqual(1);
  });

  it('reports a clean run on an empty book', () => {
    const r = reconcileOaCharges();
    expect(r.applications).toBe(0);
    expect(r.match_pct).toBe(100);
  });
});

describe('actualsByMonth', () => {
  it('rolls actual cost up by month and charge type', () => {
    application('SJVN010526WR2400', '2026-05-01', 100, 39012);
    application('SJVN020526WR2401', '2026-05-02', 100, 39012);
    application('SJVN010626WR2500', '2026-06-01', 100, 39012);
    const months = actualsByMonth();
    expect(months.map(m => m.month)).toEqual(['2026-05', '2026-06']);
    expect(months[0].applications).toBe(2);
    expect(months[0].ists).toBe(78024);
    expect(months[0].application_fees).toBe(10000);
  });
});
