import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import {
  seedDsmSlabs, getEffectiveSlab, computeDsmCharge, computeDsmChargeFromMw,
  deviationSide, getReferencePrice,
} from '../src/services/dsmCharges.js';
import { summariseSchedules, buildBilateralInvoice } from '../src/services/bilateralSettlement.js';

const DATE = '2026-09-01';

beforeEach(() => {
  db.prepare('DELETE FROM dsm_charge_slabs').run();
  seedDsmSlabs();
});

/** Give one seeded band a notified rate, the way the desk would. */
function verifySlab(slabName, { charge_value, charge_basis = 'FLAT', reference_price_key = null, cap = null }) {
  db.prepare(`UPDATE dsm_charge_slabs
    SET charge_value = ?, charge_basis = ?, reference_price_key = ?, cap_paise_per_kwh = ?, is_verified = 1
    WHERE slab_name = ?`).run(charge_value, charge_basis, reference_price_key, cap, slabName);
}

describe('slab seed', () => {
  it('lays out both sides of the normal band with no rates in it', () => {
    const rows = db.prepare('SELECT * FROM dsm_charge_slabs').all();
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.charge_value === null)).toBe(true);
    expect(rows.every((r) => r.is_verified === 0)).toBe(true);
  });

  it('is idempotent', () => {
    seedDsmSlabs();
    expect(db.prepare('SELECT COUNT(*) c FROM dsm_charge_slabs').get().c).toBe(6);
  });

  it('leaves an entered rate alone on re-seed', () => {
    verifySlab('Under-injection, frequency below normal band', { charge_value: 550 });
    seedDsmSlabs();
    const row = db.prepare(`SELECT * FROM dsm_charge_slabs WHERE slab_name = 'Under-injection, frequency below normal band'`).get();
    expect(row.charge_value).toBe(550);
    expect(row.is_verified).toBe(1);
  });
});

describe('band lookup', () => {
  it('puts a frequency on its band, boundary belonging to the band above', () => {
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: 49.90, onDate: DATE }).slab_name)
      .toMatch(/below normal band/);
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: 49.95, onDate: DATE }).slab_name)
      .toMatch(/in normal band/);
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: 50.05, onDate: DATE }).slab_name)
      .toMatch(/above normal band/);
  });

  it('keeps the two sides apart', () => {
    expect(getEffectiveSlab({ side: 'OVER', frequencyHz: 49.90, onDate: DATE }).deviation_side).toBe('OVER');
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: 49.90, onDate: DATE }).deviation_side).toBe('UNDER');
  });

  it('returns nothing before the slabs took effect, or without a frequency', () => {
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: 49.9, onDate: '2022-01-01' })).toBeNull();
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: null, onDate: DATE })).toBeNull();
  });

  it('prefers a later revision of the same band', () => {
    db.prepare(`INSERT INTO dsm_charge_slabs
      (id, slab_name, deviation_side, freq_from_hz, freq_to_hz, charge_basis, charge_value,
       settlement_sign, effective_from, is_verified, is_active)
      VALUES (?, 'Under-injection, below normal band (revised)', 'UNDER', NULL, 49.95, 'FLAT', 600, 1, '2026-04-01', 1, 1)`)
      .run(newId('DSMS'));
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: 49.9, onDate: DATE }).charge_value).toBe(600);
    // ...but not before that revision was notified.
    expect(getEffectiveSlab({ side: 'UNDER', frequencyHz: 49.9, onDate: '2026-03-31' }).charge_value).toBeNull();
  });
});

describe('pricing a block', () => {
  it('will not price a deviation off a slab with no notified rate', () => {
    const r = computeDsmCharge({ deviationMwh: -5, frequencyHz: 49.9, onDate: DATE });
    expect(r.amount).toBe(0);
    expect(r.basis).toBe('SLAB_UNVERIFIED');
    expect(r.warning).toMatch(/no verified rate/);
  });

  it('prices a flat slab on the size of the deviation', () => {
    verifySlab('Under-injection, frequency below normal band', { charge_value: 550 });
    // 5 MWh short = 5,000 kWh at 550 paise/kWh = Rs 27,500 payable.
    const r = computeDsmCharge({ deviationMwh: -5, frequencyHz: 49.9, onDate: DATE });
    expect(r.basis).toBe('CERC_SLAB');
    expect(r.rate_paise_per_kwh).toBe(550);
    expect(r.amount).toBe(27500);
  });

  it('returns a credit as a negative amount when the slab says so', () => {
    verifySlab('Over-injection, frequency in normal band', { charge_value: 300 });
    const r = computeDsmCharge({ deviationMwh: 4, frequencyHz: 50.0, onDate: DATE });
    expect(r.amount).toBe(-12000);
  });

  it('prices a percentage slab off its reference price, capped', () => {
    verifySlab('Under-injection, frequency below normal band', {
      charge_value: 120, charge_basis: 'PCT_OF_REFERENCE', reference_price_key: 'DAM_ACP',
    });
    // 120% of 400 paise/kWh = 480 paise; 2 MWh = 2,000 kWh = Rs 9,600.
    const priced = computeDsmCharge({ deviationMwh: -2, frequencyHz: 49.9, onDate: DATE, referencePricePaisePerKwh: 400 });
    expect(priced.rate_paise_per_kwh).toBe(480);
    expect(priced.amount).toBe(9600);

    verifySlab('Under-injection, frequency below normal band', {
      charge_value: 120, charge_basis: 'PCT_OF_REFERENCE', reference_price_key: 'DAM_ACP', cap: 450,
    });
    const capped = computeDsmCharge({ deviationMwh: -2, frequencyHz: 49.9, onDate: DATE, referencePricePaisePerKwh: 400 });
    expect(capped.rate_paise_per_kwh).toBe(450);
    expect(capped.amount).toBe(9000);
  });

  it('leaves a percentage slab unpriced when the reference price is unavailable', () => {
    verifySlab('Under-injection, frequency below normal band', {
      charge_value: 120, charge_basis: 'PCT_OF_REFERENCE', reference_price_key: 'DAM_ACP',
    });
    db.prepare(`DELETE FROM market_rates WHERE rate_date = ?`).run(DATE);
    const r = computeDsmCharge({ deviationMwh: -2, frequencyHz: 49.9, onDate: DATE });
    expect(r.amount).toBe(0);
    expect(r.basis).toBe('NO_REFERENCE_PRICE');
  });

  describe('DAM_ACP reference price', () => {
    const putBlocks = (exchange, date, price, volume = 1000, source = 'EXCHANGE_FILE') => {
      const insert = db.prepare(`INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, volume_mw, data_source)
        VALUES (?, ?, 'DAM', ?, ?, ?, ?, ?)`);
      for (let b = 1; b <= 96; b += 1) {
        const m = (b - 1) * 15;
        const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        insert.run(newId('MKT'), exchange, date, label, typeof price === 'function' ? price(b) : price, volume, source);
      }
    };
    beforeEach(() => {
      db.prepare('DELETE FROM market_rates').run();
      db.prepare('DELETE FROM cerc_market_data').run();
    });

    it('ignores rows nothing real wrote — the demo seed and hand-typed daily rows', () => {
      db.prepare(`INSERT INTO market_rates (id, exchange, product, rate_date, mcp_rate, time_block, data_source)
        VALUES (?, 'IEX', 'DAM', '2026-09-02', 9.5, 'DAILY', 'IEX_PORTAL'), (?, NULL, 'DAM', '2026-09-02', 4.25, 'DAILY', 'MANUAL')`)
        .run(newId('MRT'), newId('MRT'));
      expect(getReferencePrice('DAM_ACP', '2026-09-02')).toBeNull();
      expect(getReferencePrice('UNKNOWN_KEY', '2026-09-02')).toBeNull();
    });

    it('prices a block off that block, across exchanges by cleared volume', () => {
      // IEX clears 3,000 MW at ₹8 in the evening block, PXIL 1,000 MW at ₹6; ₹3 the rest of the day.
      putBlocks('IEX', '2026-09-02', (b) => (b === 73 ? 8 : 3), 3000);
      putBlocks('PXIL', '2026-09-02', (b) => (b === 73 ? 6 : 3), 1000);
      expect(getReferencePrice('DAM_ACP', '2026-09-02', { timeBlock: '18:00-18:15' })).toBe(750);
      expect(getReferencePrice('DAM_ACP', '2026-09-02', { timeBlock: '02:00-02:15' })).toBe(300);
    });

    it('takes the day when no block is given, and the CERC figure where that is all there is', () => {
      putBlocks('IEX', '2026-09-02', (b) => (b <= 48 ? 2 : 6));
      expect(getReferencePrice('DAM_ACP', '2026-09-02')).toBe(400);
      db.prepare(`INSERT INTO cerc_market_data (id, report_period, data_category, product, exchange, metric_name, metric_value, metric_unit, day_of_month, source_table)
        VALUES (?, '2026-02', 'PRICE', 'DAM', 'IEX', 'Daily Price', 3.559, 'Rs/kWh', 14, 'EXCEL')`).run(newId('CMD'));
      expect(getReferencePrice('DAM_ACP', '2026-02-14', { timeBlock: '18:00-18:15' })).toBe(355.9);
      expect(getReferencePrice('DAM_ACP', '2026-02-15')).toBeNull();
    });

    it('bills a percentage slab off the block the deviation happened in', () => {
      verifySlab('Under-injection, frequency below normal band', {
        charge_value: 100, charge_basis: 'PCT_OF_REFERENCE', reference_price_key: 'DAM_ACP',
      });
      putBlocks('IEX', DATE, (b) => (b === 73 ? 8 : 3));
      const peak = computeDsmCharge({ deviationMwh: -1, frequencyHz: 49.9, onDate: DATE, timeBlock: '18:00-18:15' });
      const night = computeDsmCharge({ deviationMwh: -1, frequencyHz: 49.9, onDate: DATE, timeBlock: '02:00-02:15' });
      expect(peak.amount).toBe(8000);
      expect(night.amount).toBe(3000);
    });
  });

  it('says why it could not price, instead of returning a plausible zero', () => {
    expect(computeDsmCharge({ deviationMwh: -5, frequencyHz: null, onDate: DATE }).basis).toBe('NO_FREQUENCY');
    expect(computeDsmCharge({ deviationMwh: 0, frequencyHz: 49.9, onDate: DATE }).basis).toBe('NO_DEVIATION');
    expect(computeDsmCharge({ deviationMwh: -5, frequencyHz: 49.9, onDate: '2022-01-01' }).basis).toBe('NO_SLAB');
  });

  it('converts a block MW deviation to its quarter-hour energy', () => {
    verifySlab('Under-injection, frequency below normal band', { charge_value: 100 });
    // 20 MW short for 15 minutes = 5 MWh = 5,000 kWh at 100 paise = Rs 5,000.
    expect(computeDsmChargeFromMw({ deviationMw: -20, frequencyHz: 49.9, onDate: DATE }).amount).toBe(5000);
  });

  it('reads the side off the sign of the deviation', () => {
    expect(deviationSide(3)).toBe('OVER');
    expect(deviationSide(-3)).toBe('UNDER');
    expect(deviationSide(0)).toBeNull();
  });
});

describe('settlement rollup', () => {
  const TX = 'BLT-DSM-TEST';

  beforeEach(() => {
    db.prepare('DELETE FROM bilateral_schedules WHERE transaction_id = ?').run(TX);
    db.prepare('DELETE FROM bilateral_transactions WHERE id = ?').run(TX);
    db.prepare(`INSERT INTO bilateral_transactions
      (id, counterparty, transaction_type, oa_type, start_date, end_date, quantum_mw,
       tariff_per_unit, sale_rate_per_unit, purchase_rate_per_unit, trading_margin_per_unit)
      VALUES (?, 'NTPCREL', 'PURCHASE', 'STOA', ?, ?, 100, 3.5, 3.5, 3.47, 0.03)`).run(TX, DATE, DATE);
  });

  const addBlock = ({ block, approved, actual, dsm = 0, basis = null }) => {
    db.prepare(`INSERT INTO bilateral_schedules
      (id, transaction_id, schedule_date, time_block, approved_mw, curtailed_mw, actual_mw,
       dsm_penalty_amount, dsm_basis, status)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'APPROVED')`)
      .run(newId('SCH'), TX, DATE, block, approved, actual, dsm, basis);
  };

  it('counts the blocks that deviated but could not be priced', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 80, dsm: 27500, basis: 'CERC_SLAB' });
    addBlock({ block: '00:15-00:30', approved: 100, actual: 80, basis: 'NO_FREQUENCY' });
    addBlock({ block: '00:30-00:45', approved: 100, actual: 100, basis: 'NO_DEVIATION' });
    const s = summariseSchedules(TX);
    expect(s.dsm_penalty_amount).toBe(27500);
    expect(s.unpriced_deviation_blocks).toBe(1);
  });

  it('warns on the energy bill rather than implying the deviation was free', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 80, basis: 'NO_FREQUENCY' });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' });
    expect(inv.warnings.join(' ')).toMatch(/no DSM slab price/);
  });

  it('says nothing when every deviating block was priced', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 80, dsm: 27500, basis: 'CERC_SLAB' });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' });
    expect(inv.warnings).toEqual([]);
  });
});
