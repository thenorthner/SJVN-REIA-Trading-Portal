import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { seedRateMaster, getEffectiveRate, reviseRate } from '../src/services/rateMaster.js';

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
});

describe('seeded rates', () => {
  it('carries the ledger charge card', () => {
    expect(getEffectiveRate('West Bengal STU', '2026-05-01').rate_value).toBe(238.4);
    expect(getEffectiveRate('Delhi STU', '2026-05-01').rate_value).toBe(382.54);
    expect(getEffectiveRate('Haryana STU', '2026-05-01').rate_value).toBe(268.5);
    expect(getEffectiveRate('Punjab STU', '2026-05-01').rate_value).toBe(291.2);
    expect(getEffectiveRate('Gujarat STU', '2026-05-01').rate_value).toBe(214.8);
    expect(getEffectiveRate('Sikkim STU', '2026-05-01').rate_value).toBe(248.6);
    expect(getEffectiveRate('Himachal Pradesh STU', '2026-05-01').rate_value).toBe(327.4);
    expect(getEffectiveRate('Haryana SLDC', '2026-05-01').rate_value).toBe(1000);
    expect(getEffectiveRate('NOAR Application Fee', '2026-05-01').rate_value).toBe(5000);
    expect(getEffectiveRate('RLDC Fee', '2026-05-01').rate_value).toBe(1000);
  });

  it('is idempotent', () => {
    const before = db.prepare('SELECT COUNT(*) c FROM rate_master').get().c;
    seedRateMaster();
    expect(db.prepare('SELECT COUNT(*) c FROM rate_master').get().c).toBe(before);
  });
});

describe('effective dating', () => {
  it('returns nothing before a rate began', () => {
    expect(getEffectiveRate('ISTS', '2022-01-01')).toBeNull();
  });

  it('returns nothing for a charge that does not exist', () => {
    expect(getEffectiveRate('Nonexistent Charge', '2026-05-01')).toBeNull();
  });

  it('picks the window containing the date after a revision', () => {
    reviseRate({ chargeName: 'Delhi STU', newValue: 400, effectiveFrom: '2026-06-01' });
    expect(getEffectiveRate('Delhi STU', '2026-05-31').rate_value).toBe(382.54);
    expect(getEffectiveRate('Delhi STU', '2026-06-01').rate_value).toBe(400);
    expect(getEffectiveRate('Delhi STU', '2026-09-09').rate_value).toBe(400);
  });

  it('closes the old window the day before, leaving no overlap', () => {
    reviseRate({ chargeName: 'Delhi STU', newValue: 400, effectiveFrom: '2026-06-01' });
    expect(getEffectiveRate('Delhi STU', '2026-05-31').effective_to).toBe('2026-05-31');
    const open = db.prepare(`SELECT COUNT(*) c FROM rate_master WHERE charge_name='Delhi STU' AND effective_to IS NULL`).get().c;
    expect(open).toBe(1);
  });

  it('keeps the superseded rate readable as history', () => {
    reviseRate({ chargeName: 'Delhi STU', newValue: 400, effectiveFrom: '2026-06-01' });
    expect(db.prepare(`SELECT COUNT(*) c FROM rate_master WHERE charge_name='Delhi STU'`).get().c).toBe(2);
  });
});

describe('per-corridor ISTS', () => {
  // ISTS is billed per transmission corridor: the same day costs a different
  // amount in each, which is what the reconciliation surfaced.
  beforeEach(() => {
    db.prepare('DELETE FROM rate_master WHERE charge_name = ?').run('ISTS');
    const ins = db.prepare(`INSERT INTO rate_master (id, rate_category, charge_name, region, rate_value, unit, effective_from, effective_to, is_active)
                            VALUES (?, 'ISTS', 'ISTS', ?, ?, 'Rs/MWh', '2026-04-01', NULL, 1)`);
    ins.run('R-WR', 'WR', 390.12);
    ins.run('R-NR', 'NR', 508.92);
    ins.run('R-ALL', 'ALL', 379);
  });

  it('prefers the corridor asked for', () => {
    expect(getEffectiveRate('ISTS', '2026-05-10', 'WR').rate_value).toBe(390.12);
    expect(getEffectiveRate('ISTS', '2026-05-10', 'NR').rate_value).toBe(508.92);
  });

  it('falls back to the region-agnostic rate for an unknown corridor', () => {
    expect(getEffectiveRate('ISTS', '2026-05-10', 'SR').rate_value).toBe(379);
  });

  it('uses the region-agnostic rate when no corridor is given', () => {
    expect(getEffectiveRate('ISTS', '2026-05-10').rate_value).toBe(379);
  });
});
