import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { priceTradingInvoice, createTradingInvoice, shapeOf } from '../src/services/tradingInvoice.js';
import { seedInvoiceCounters } from '../src/util.js';

beforeEach(() => {
  db.prepare('DELETE FROM client_ledgers').run();
  db.prepare('DELETE FROM trading_invoices').run();
  db.prepare('DELETE FROM invoice_counters').run();
  seedInvoiceCounters();
  db.prepare(`INSERT OR IGNORE INTO trading_clients (id, name, client_type, status)
              VALUES ('TCL-TEST', 'Kreate Energy', 'TRADER', 'ACTIVE')`).run();
});

describe('shapeOf', () => {
  it('separates the two shapes the table holds', () => {
    expect(shapeOf('POWER_SUPPLY_ONLY')).toBe('ENERGY');
    expect(shapeOf('COMBINED')).toBe('ENERGY');
    expect(shapeOf('EXCHANGE')).toBe('SETTLEMENT');
    expect(shapeOf('BILATERAL')).toBe('SETTLEMENT');
    expect(shapeOf('NONSENSE')).toBeNull();
  });
});

describe('pricing rules, shared by both shapes', () => {
  // The face value of an invoice is gross. The ISET ledger settles this: an
  // energy bill reads 86,60,920 with 8,661 withheld and 86,52,259 received.
  it('keeps the face value gross and shows TDS as a withholding', () => {
    const p = priceTradingInvoice({
      invoice_kind: 'POWER_SUPPLY_ONLY', quantum_mwh: 2732.15, rate_per_unit: 3170, gst_applicable: false,
    });
    expect(p.total_amount).toBe(p.subtotal);
    expect(p.net_payable).toBe(p.total_amount - p.tds_amount);
    expect(p.net_payable).toBeLessThan(p.total_amount);
  });

  it('reproduces the ledger energy bill', () => {
    const p = priceTradingInvoice({ invoice_kind: 'POWER_SUPPLY_ONLY', quantum_mwh: 8660920, rate_per_unit: 1, gst_applicable: false });
    expect(p.total_amount).toBe(8660920);
    expect(p.tds_section).toBe('194Q');
    expect(p.tds_amount).toBe(8661);
    expect(p.net_payable).toBe(8652259);
  });

  it('charges GST on the taxable value, never on the value net of TDS', () => {
    const p = priceTradingInvoice({ invoice_kind: 'POWER_SUPPLY_ONLY', quantum_mwh: 1000, rate_per_unit: 100, gst_applicable: true });
    expect(p.gst_amount).toBe(Math.round(p.subtotal * 0.18));
    expect(p.total_amount).toBe(p.subtotal + p.gst_amount);
  });

  it('withholds on the taxable value, not on GST', () => {
    const p = priceTradingInvoice({ invoice_kind: 'POWER_SUPPLY_ONLY', quantum_mwh: 1000, rate_per_unit: 100, gst_applicable: true });
    expect(p.tds_amount).toBe(Math.round(p.subtotal * p.tds_rate));
  });

  it('applies the same rules to a settlement bill', () => {
    const p = priceTradingInvoice({
      invoice_kind: 'EXCHANGE', exchange_fee: 5000, clearing_charges: 2000, regulatory_levy: 1000,
      sjvn_margin: 30000, gst_applicable: false,
    });
    expect(p.subtotal).toBe(38000);
    expect(p.total_amount).toBe(38000);           // face value gross, not 38000 - tds
    expect(p.tds_section).toBe('194C');
    expect(p.tds_amount).toBe(3800);
    expect(p.net_payable).toBe(34200);
  });

  it('sums a bilateral settlement bill from its own legs', () => {
    const p = priceTradingInvoice({
      invoice_kind: 'BILATERAL', transmission_charges: 8000, dsm_charges: 1500, sjvn_margin: 30000, gst_applicable: false,
    });
    expect(p.subtotal).toBe(39500);
  });
});

describe('TDS section defaults', () => {
  it('puts an energy bill on 194Q', () => {
    expect(priceTradingInvoice({ invoice_kind: 'COMBINED', quantum_mwh: 100, rate_per_unit: 1000 }).tds_section).toBe('194Q');
  });

  it('puts a fee-based settlement bill on 194C', () => {
    expect(priceTradingInvoice({ invoice_kind: 'EXCHANGE', sjvn_margin: 1000 }).tds_section).toBe('194C');
  });

  it('leaves a pure margin bill untaxed — it carries no energy value', () => {
    const p = priceTradingInvoice({ invoice_kind: 'TRADING_MARGIN_ONLY', quantum_mwh: 100, margin_rate: 0.03 });
    expect(p.tds_section).toBe('NONE');
    expect(p.tds_amount).toBe(0);
    expect(p.net_payable).toBe(p.total_amount);
  });

  it('honours an explicit section and rate', () => {
    const p = priceTradingInvoice({
      invoice_kind: 'EXCHANGE', sjvn_margin: 100000, tds_section: '194Q', tds_rate: 0.001,
    });
    expect(p.tds_section).toBe('194Q');
    expect(p.tds_amount).toBe(100);
  });
});

describe('createTradingInvoice', () => {
  it('numbers both shapes from the same register', () => {
    const a = createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'POWER_SUPPLY_ONLY', billing_period: '2026-05', quantum_mwh: 10, rate_per_unit: 100 });
    const b = createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'EXCHANGE', billing_period: '2026-05', sjvn_margin: 1000 });
    expect(a.invoice_no).toBe('SJVN/ENERGY/KREATE/202605/146');
    expect(b.invoice_no).toBe('SJVN/ENERGY/KREATE/202605/147');
  });

  it('stores the withholding fields whichever route created it', () => {
    const inv = createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'EXCHANGE', billing_period: '2026-05', sjvn_margin: 30000 });
    expect(inv.tds_section).toBe('194C');
    expect(inv.tds_rate).toBe(0.10);
    expect(inv.net_payable).toBe(inv.total_amount - inv.tds_amount);
  });

  it('posts to the client ledger only when asked, and for the net amount', () => {
    createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'POWER_SUPPLY_ONLY', billing_period: '2026-05', quantum_mwh: 10, rate_per_unit: 100 });
    expect(db.prepare('SELECT COUNT(*) c FROM client_ledgers').get().c).toBe(0);

    const inv = createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'EXCHANGE', billing_period: '2026-05', sjvn_margin: 30000 }, { postLedger: true });
    const led = db.prepare('SELECT * FROM client_ledgers').get();
    expect(led.debit).toBe(inv.net_payable);
    expect(led.running_balance).toBe(inv.net_payable);   // first entry starts from 0, not NULL
  });

  it('carries the running balance forward across postings', () => {
    const a = createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'EXCHANGE', billing_period: '2026-05', sjvn_margin: 10000 }, { postLedger: true });
    const b = createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'EXCHANGE', billing_period: '2026-05', sjvn_margin: 20000 }, { postLedger: true });
    const last = db.prepare('SELECT running_balance FROM client_ledgers ORDER BY rowid DESC LIMIT 1').get();
    expect(last.running_balance).toBe(a.net_payable + b.net_payable);
  });

  it('rejects an unknown client without writing anything', () => {
    expect(() => createTradingInvoice({ client_id: 'nope', invoice_kind: 'EXCHANGE', billing_period: '2026-05', sjvn_margin: 1 }))
      .toThrow(/Client not found/);
    expect(db.prepare('SELECT COUNT(*) c FROM trading_invoices').get().c).toBe(0);
  });

  it('rejects an unknown invoice kind rather than writing a half-priced bill', () => {
    expect(() => createTradingInvoice({ client_id: 'TCL-TEST', invoice_kind: 'MYSTERY', billing_period: '2026-05' }))
      .toThrow(/Unknown invoice_kind/);
    expect(db.prepare('SELECT COUNT(*) c FROM trading_invoices').get().c).toBe(0);
  });
});
