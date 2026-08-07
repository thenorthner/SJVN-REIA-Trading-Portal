import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import { computeOaCharges } from '../src/services/oaCharges.js';

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
});

const amountOf = (r, charge) => r.line_items.find(i => i.charge === charge)?.amount;

describe('computeOaCharges', () => {
  it('prices a real ledger application to the rupee', () => {
    // Application SJVN010426WR2354: 205.95 MWh at 391.2/MWh was charged 80,568.
    const r = computeOaCharges({ quantum_mwh: 205.95, ists_rate: 391.2 });
    expect(amountOf(r, 'ISTS')).toBe(80568);
    expect(amountOf(r, 'NOAR Application Fee')).toBe(5000);
    expect(amountOf(r, 'RLDC Fee')).toBe(1000);
    expect(r.total).toBe(86568);
  });

  it('bills per-day charges by the number of days', () => {
    const r = computeOaCharges({ quantum_mwh: 100, days: 5, injection_state: 'West Bengal' });
    expect(amountOf(r, 'RLDC Fee')).toBe(5000);
    expect(amountOf(r, 'West Bengal SLDC')).toBe(5000);
  });

  it('leaves the flat application fee flat regardless of days', () => {
    expect(amountOf(computeOaCharges({ quantum_mwh: 100, days: 9 }), 'NOAR Application Fee')).toBe(5000);
  });

  it('splits the bearer by which side of the corridor a charge sits on', () => {
    // Injection-state charges fall on the seller, drawal-state on the buyer.
    const r = computeOaCharges({ quantum_mwh: 300, include_ists: false, injection_state: 'West Bengal', drawal_state: 'Delhi' });
    expect(amountOf(r, 'West Bengal STU')).toBe(71520);
    expect(amountOf(r, 'Delhi STU')).toBe(114762);
    expect(r.by_bearer.SELLER).toBe(71520 + 1000);
    expect(r.by_bearer.BUYER).toBe(114762 + 1000 + 1000 + 5000);
    expect(r.by_bearer.SELLER + r.by_bearer.BUYER).toBe(r.total);
  });

  it('honours a bearer override', () => {
    const r = computeOaCharges({ quantum_mwh: 100, ists_rate: 400, bearer_overrides: { ISTS: 'SELLER' } });
    expect(r.line_items.find(i => i.charge === 'ISTS').bearer).toBe('SELLER');
  });

  it('marks where each rate came from', () => {
    expect(computeOaCharges({ quantum_mwh: 100, ists_rate: 400 }).line_items.find(i => i.charge === 'ISTS').rate_source).toBe('OVERRIDE');
    expect(computeOaCharges({ quantum_mwh: 100 }).line_items.find(i => i.charge === 'ISTS').rate_source).toBe('RATE_MASTER');
  });

  it('warns instead of silently dropping a state it cannot price', () => {
    const r = computeOaCharges({ quantum_mwh: 100, drawal_state: 'Atlantis', include_ists: false });
    expect(r.warnings.some(w => /Atlantis STU/.test(w))).toBe(true);
    expect(amountOf(r, 'Atlantis STU')).toBeUndefined();
  });

  it('omits ISTS when asked to', () => {
    expect(amountOf(computeOaCharges({ quantum_mwh: 100, include_ists: false }), 'ISTS')).toBeUndefined();
  });

  it('treats a missing quantum as zero rather than NaN', () => {
    const r = computeOaCharges({});
    expect(Number.isFinite(r.total)).toBe(true);
  });
});
