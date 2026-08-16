import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import {
  summariseSchedules,
  grossUpForLosses,
  computeBilateralSettlement,
  buildBilateralInvoice,
} from '../src/services/bilateralSettlement.js';

const TX = 'BIL-SETTLE-TEST';

function makeTransaction(overrides = {}) {
  db.prepare('DELETE FROM bilateral_schedules WHERE transaction_id = ?').run(TX);
  db.prepare('DELETE FROM bilateral_transactions WHERE id = ?').run(TX);
  const row = {
    id: TX,
    counterparty: 'New Delhi Municipal Council',
    quantum_mw: 50,
    tariff_per_unit: 4.5,
    purchase_rate_per_unit: 4.47,
    sale_rate_per_unit: 4.5,
    trading_margin_per_unit: 0.03,
    loss_injection_state: 0,
    loss_inter_state: 0,
    loss_drawee_state: 0,
    start_date: '2026-09-01',
    end_date: '2026-09-07',
    procurer_name: 'New Delhi Municipal Council',
    procurer_sldc: 'Delhi',
    supplier_sldc: 'West Bengal',
    wheeling_charges: 0,
    transmission_charges: 0,
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO bilateral_transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...cols.map((c) => row[c]));
  return row;
}

/** One 15-minute block. */
function addBlock({ date = '2026-09-01', block, approved, curtailed = 0, actual = null, dsm = 0, status = 'APPROVED' }) {
  db.prepare(`
    INSERT INTO bilateral_schedules
      (id, transaction_id, schedule_date, time_block, approved_mw, curtailed_mw, actual_mw, dsm_penalty_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId('SCH'), TX, date, block, approved, curtailed, actual, dsm, status);
}

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  makeTransaction();
});

describe('summariseSchedules', () => {
  it('converts 15-minute blocks to MWh at a quarter-hour each', () => {
    addBlock({ block: '00:00-00:15', approved: 100 });
    addBlock({ block: '00:15-00:30', approved: 100 });
    const s = summariseSchedules(TX);
    expect(s.blocks).toBe(2);
    expect(s.scheduled_mwh).toBe(50); // 2 blocks x 100 MW x 0.25 h
  });

  it('bills the schedule net of curtailment', () => {
    addBlock({ block: '00:00-00:15', approved: 100, curtailed: 40 });
    const s = summariseSchedules(TX);
    expect(s.scheduled_mwh).toBe(15); // (100 - 40) x 0.25
    expect(s.curtailed_mwh).toBe(10);
  });

  it('prefers metered actuals over the schedule and reports the deviation', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 80, dsm: 1200 });
    const s = summariseSchedules(TX);
    expect(s.delivered_mwh).toBe(20);
    expect(s.deviation_mwh).toBe(-5);
    expect(s.dsm_penalty_amount).toBe(1200);
  });

  it('is final only once every block carries a meter reading', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 100 });
    expect(summariseSchedules(TX).is_final).toBe(true);
    addBlock({ block: '00:15-00:30', approved: 100 });
    const s = summariseSchedules(TX);
    expect(s.is_final).toBe(false);
    expect(s.metered_blocks).toBe(1);
  });

  it('restricts the aggregate to the supply period asked for', () => {
    addBlock({ date: '2026-09-01', block: '00:00-00:15', approved: 100 });
    addBlock({ date: '2026-09-05', block: '00:00-00:15', approved: 100 });
    expect(summariseSchedules(TX, '2026-09-01', '2026-09-01').scheduled_mwh).toBe(25);
    expect(summariseSchedules(TX).days).toBe(2);
  });

  it('leaves a cancelled block out of the settlement', () => {
    addBlock({ block: '00:00-00:15', approved: 100, status: 'CANCELLED' });
    expect(summariseSchedules(TX).blocks).toBe(0);
  });

  it('returns zeroes rather than NaN when nothing is scheduled', () => {
    const s = summariseSchedules(TX);
    expect(s.delivered_mwh).toBe(0);
    expect(s.is_final).toBe(false);
  });
});

describe('grossUpForLosses', () => {
  it('grosses the drawal quantum up through the three loss legs', () => {
    const tx = { loss_injection_state: 2, loss_inter_state: 3, loss_drawee_state: 1 };
    const r = grossUpForLosses(100, tx);
    // 100 / (0.98 x 0.97 x 0.99)
    expect(r.injected_mwh).toBeCloseTo(106.3, 1);
    expect(r.loss_mwh).toBeCloseTo(6.3, 1);
  });

  it('leaves the quantum alone when there are no losses', () => {
    expect(grossUpForLosses(100, {}).injected_mwh).toBe(100);
  });

  it('does not return Infinity when the loss legs total 100%', () => {
    const r = grossUpForLosses(100, { loss_injection_state: 100 });
    expect(Number.isFinite(r.injected_mwh)).toBe(true);
    expect(r.injected_mwh).toBe(100);
  });
});

describe('computeBilateralSettlement', () => {
  it('prices the delivered energy at the contracted sale rate', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 100 });
    const s = computeBilateralSettlement({ transaction_id: TX });
    // 25 MWh x 1000 kWh x Rs 4.50
    expect(s.money.sale_value).toBe(112500);
  });

  it('keeps sale - purchase = margin in rupees, not just per unit', () => {
    addBlock({ block: '00:00-00:15', approved: 137, actual: 137 });
    const s = computeBilateralSettlement({ transaction_id: TX });
    expect(s.money.sale_value - s.money.purchase_value).toBe(s.money.trading_margin);
  });

  it('derives the purchase rate from the margin when the column is unset', () => {
    makeTransaction({ purchase_rate_per_unit: null });
    addBlock({ block: '00:00-00:15', approved: 100, actual: 100 });
    const s = computeBilateralSettlement({ transaction_id: TX });
    expect(s.rates.purchase_rate_per_unit).toBe(4.47);
  });

  it('refuses to settle a transaction that does not exist', () => {
    expect(() => computeBilateralSettlement({ transaction_id: 'BIL-nope' })).toThrow(/not found/i);
  });
});

describe('buildBilateralInvoice', () => {
  it('withholds TDS the way the ledger does — 0.1% of the face value', () => {
    // The register's own row: 1,79,00,751 billed, 17,901 withheld.
    makeTransaction({ sale_rate_per_unit: 4.5, tariff_per_unit: 4.5 });
    addBlock({ block: '00:00-00:15', approved: 100, actual: 100 });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' });
    expect(inv.invoice_amount).toBe(112500);
    expect(inv.tds_rate).toBe(0.1);
    expect(inv.tds_deducted).toBe(113);
    expect(inv.net_receivable).toBe(112500 - 113);
  });

  it('adds the deviation penalty as its own leg of the energy bill', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 80, dsm: 1200 });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' });
    const dsm = inv.line_items.find((l) => /Deviation/.test(l.description));
    expect(dsm.amount).toBe(1200);
    expect(inv.invoice_amount).toBe(20 * 1000 * 4.5 + 1200);
  });

  it('leaves GST off unless it is asked for', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 100 });
    expect(buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' }).gst_amount).toBe(0);
    const withGst = buildBilateralInvoice({
      transaction_id: TX, bill_type: 'BILATERAL_ENERGY', options: { gst_applicable: true },
    });
    expect(withGst.gst_amount).toBe(Math.round(112500 * 0.18));
  });

  it('marks a bill provisional until every block is metered', () => {
    addBlock({ block: '00:00-00:15', approved: 100 });
    expect(buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' }).is_final).toBe(false);
  });

  it('bills open-access charges on the injected quantum and only the buyer legs', () => {
    makeTransaction({ loss_injection_state: 2, loss_inter_state: 3, loss_drawee_state: 1 });
    addBlock({ block: '00:00-00:15', approved: 400, actual: 400 });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_OA' });
    // Delivered 100 MWh grosses up to ~106.3 MWh across the corridor.
    expect(inv.settlement.losses.injected_mwh).toBeCloseTo(106.3, 1);
    // Injection-state legs belong on the seller's bill, not the buyer's.
    expect(inv.line_items.some((l) => /West Bengal/.test(l.description))).toBe(false);
    expect(inv.line_items.some((l) => /Delhi STU/.test(l.description))).toBe(true);
    expect(inv.line_items.some((l) => /NOAR Application Fee/.test(l.description))).toBe(true);
  });

  it('raises the seller-side open-access bill when asked for it', () => {
    addBlock({ block: '00:00-00:15', approved: 400, actual: 400 });
    const inv = buildBilateralInvoice({
      transaction_id: TX, bill_type: 'BILATERAL_OA', options: { bearer: 'SELLER' },
    });
    expect(inv.line_items.some((l) => /West Bengal STU/.test(l.description))).toBe(true);
    expect(inv.line_items.some((l) => /Delhi/.test(l.description))).toBe(false);
  });

  it('carries contracted wheeling and transmission charges onto the OA bill', () => {
    makeTransaction({ wheeling_charges: 1200, transmission_charges: 3400 });
    addBlock({ block: '00:00-00:15', approved: 400, actual: 400 });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_OA' });
    expect(inv.line_items.find((l) => /Wheeling/.test(l.description)).amount).toBe(1200);
    expect(inv.line_items.find((l) => /Transmission/.test(l.description)).amount).toBe(3400);
  });

  it('bills the SLDC consent fee flat, off the rate master', () => {
    addBlock({ block: '00:00-00:15', approved: 100, actual: 100 });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_SLDC' });
    expect(inv.invoice_amount).toBe(5000);
    expect(inv.tds_deducted).toBe(0);
  });

  it('warns instead of billing zero when the consent fee has no rate', () => {
    db.prepare("DELETE FROM rate_master WHERE charge_name = 'SLDC Consent Fee'").run();
    addBlock({ block: '00:00-00:15', approved: 100, actual: 100 });
    const inv = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_SLDC' });
    expect(inv.line_items).toHaveLength(0);
    expect(inv.warnings.some((w) => /SLDC Consent Fee/.test(w))).toBe(true);
  });

  it('rejects a bill type that is not one of the three', () => {
    expect(() => buildBilateralInvoice({ transaction_id: TX, bill_type: 'EXCHANGE_OA' }))
      .toThrow(/bill_type must be one of/);
  });
});
