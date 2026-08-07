import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { marginCheck, receiptExceptions } from '../src/services/marginAssurance.js';

// The desk's core commercial rule: the gap between the purchase and sale rate is
// the trading margin, and it should hold on every settled day.
const CONTRACT = 'TEST_LOA';

function settle(date, kwh, buy, sell, extra = {}) {
  db.prepare(`
    INSERT INTO energy_settlements (id, contract_ref, settlement_date, energy_kwh,
      purchase_rate, purchase_amount, sale_rate, sale_amount, margin_rate, margin_amount,
      net_receivable, actual_receipt, receipt_difference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`ES-${date}`, CONTRACT, date, kwh, buy, kwh * buy, sell, kwh * sell,
    Number((sell - buy).toFixed(4)), Number((kwh * (sell - buy)).toFixed(2)),
    extra.net ?? 0, extra.received ?? 0, extra.diff ?? 0);
}

beforeEach(() => {
  db.prepare('DELETE FROM energy_settlements').run();
  db.prepare('DELETE FROM bilateral_transactions').run();
  // The expected margin is read off the deal, so a deal has to exist for the
  // contract the settlements belong to.
  db.prepare(`INSERT OR IGNORE INTO trading_clients (id, name, client_type, status)
              VALUES ('TCL-TEST', 'Test Client', 'C&I', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO bilateral_transactions
    (id, client_id, counterparty, loi_contract_ref, quantum_mw, tariff_per_unit, trading_margin_per_unit, start_date, end_date)
    VALUES ('BIL-TEST', 'TCL-TEST', 'Test Seller', ?, 10, 3.17, 0.03, '2026-04-01', '2026-04-30')`).run(CONTRACT);
});

describe('marginCheck', () => {
  it('passes a book where every day holds the contract margin', () => {
    settle('2026-04-01', 100000, 3.14, 3.17);
    settle('2026-04-02', 100000, 2.50, 2.53);   // rate moves, margin does not
    settle('2026-04-03', 100000, 1.18, 1.21);
    const r = marginCheck();
    expect(r.days).toBe(3);
    expect(r.days_breached).toBe(0);
    expect(r.compliance_pct).toBe(100);
    expect(r.effective_margin_rate).toBe(0.03);
  });

  it('flags a day priced off contract', () => {
    settle('2026-04-01', 100000, 3.14, 3.17);
    settle('2026-04-02', 100000, 3.14, 3.19);   // 0.05 — off contract
    const r = marginCheck();
    expect(r.days_breached).toBe(1);
    expect(r.breaches[0].settlement_date).toBe('2026-04-02');
    expect(r.breaches[0].drift).toBeCloseTo(0.02, 4);
    expect(r.compliance_pct).toBe(50);
  });

  it('catches a margin that is too thin as well as too fat', () => {
    settle('2026-04-01', 100000, 3.14, 3.15);   // 0.01
    expect(marginCheck().days_breached).toBe(1);
  });

  it('absorbs sub-paise rounding rather than crying wolf', () => {
    settle('2026-04-01', 100000, 3.14, 3.1703);   // 0.0003 drift
    expect(marginCheck().days_breached).toBe(0);
  });

  it('totals the margin earned across the period', () => {
    settle('2026-04-01', 100000, 3.14, 3.17);
    settle('2026-04-02', 200000, 2.50, 2.53);
    const r = marginCheck();
    expect(r.total_energy_kwh).toBe(300000);
    expect(r.total_margin).toBeCloseTo(9000, 2);
  });

  it('honours a date filter', () => {
    settle('2026-04-01', 100000, 3.14, 3.17);
    settle('2026-04-02', 100000, 3.14, 3.17);
    expect(marginCheck({ from: '2026-04-02' }).days).toBe(1);
  });

  it('reports full compliance on an empty book rather than dividing by zero', () => {
    const r = marginCheck();
    expect(r.days).toBe(0);
    expect(r.compliance_pct).toBe(100);
    expect(r.effective_margin_rate).toBe(0);
  });
});

describe('receiptExceptions', () => {
  it('lists days where the money received did not match the bill', () => {
    settle('2026-04-01', 100000, 3.14, 3.17, { net: 1000, received: 1000, diff: 0 });
    settle('2026-04-02', 100000, 3.14, 3.17, { net: 1000, received: 400, diff: -600 });
    const ex = receiptExceptions({}, 1);
    expect(ex).toHaveLength(1);
    expect(ex[0].settlement_date).toBe('2026-04-02');
  });
});
