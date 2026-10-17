import { describe, it, expect, beforeEach } from 'vitest';
import XLSX from 'xlsx';
import db from '../src/db/index.js';
import { classifyBilateral, isLongTerm, buildAnnexures, annexuresWorkbook, ANNEXURES } from '../src/services/cercAnnexures.js';
import { licenceCompliance, saveLicenceYear } from '../src/services/cercLicence.js';

// A month far from any seeded data, so the split is exactly what is inserted here.
const PERIOD = '2031-05';
const IDS = ['ANX-T-RTC', 'ANX-T-PEAK', 'ANX-T-BANK', 'ANX-T-LONG', 'ANX-T-INTRA'];

function trade(id, overrides = {}) {
  const row = {
    id,
    counterparty: 'Annexure Test Buyer',
    quantum_mw: 10,
    tariff_per_unit: 4.03,
    purchase_rate_per_unit: 4,
    sale_rate_per_unit: 4.03,
    trading_margin_per_unit: 0.03,
    start_date: '2031-05-01',
    end_date: '2031-05-31',
    supplier_sldc: 'West Bengal',
    procurer_sldc: 'Delhi, SLDC',
    product: 'RTC Hydro',
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO bilateral_transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
}

beforeEach(() => {
  db.prepare(`DELETE FROM bilateral_transactions WHERE id IN (${IDS.map(() => '?').join(',')})`).run(...IDS);
  db.prepare("DELETE FROM cerc_form_iv WHERE period = ?").run(PERIOD);
  db.prepare("DELETE FROM cerc_licence_compliance WHERE fy = '2031-32'").run();
});

describe('classifyBilateral', () => {
  it('puts an ordinary short-term trade on IV-A, section A', () => {
    expect(classifyBilateral({ start_date: '2031-05-01', end_date: '2031-05-31', product: 'RTC Hydro' }))
      .toEqual({ code: 'IV-A', section: 'A' });
  });

  it('reads peak and off-peak from the product', () => {
    expect(classifyBilateral({ start_date: '2031-05-01', end_date: '2031-05-31', product: 'Evening Peak' }).code).toBe('IV-B');
    expect(classifyBilateral({ start_date: '2031-05-01', end_date: '2031-05-31', product: 'Off-Peak' }).code).toBe('IV-C');
  });

  it('treats banking and cross-border as sections, not forms', () => {
    expect(classifyBilateral({ start_date: '2031-05-01', end_date: '2031-05-31', contract_type: 'Banking' }))
      .toEqual({ code: 'IV-A', section: 'B' });
    expect(classifyBilateral({ start_date: '2031-05-01', end_date: '2031-05-31', remarks: 'Cross-border supply to Nepal' }))
      .toEqual({ code: 'IV-A', section: 'C' });
  });

  it('sends a contract of a year or more to IV-D, and a same-state trade to IV-E', () => {
    expect(isLongTerm({ start_date: '2031-04-01', end_date: '2032-03-31' })).toBe(true);
    expect(classifyBilateral({ start_date: '2031-04-01', end_date: '2032-03-31' }).code).toBe('IV-D');
    expect(classifyBilateral({ start_date: '2031-05-01', end_date: '2031-05-31', supplier_sldc: 'Delhi', procurer_sldc: 'Delhi, SLDC' }))
      .toEqual({ code: 'IV-E', section: 'ST' });
  });

  it('falls back to short-term RTC for a line with no trade behind it', () => {
    expect(classifyBilateral(null)).toEqual({ code: 'IV-A', section: 'A' });
  });
});

describe('buildAnnexures', () => {
  it('splits a period nobody has started straight from the trade book', () => {
    trade('ANX-T-RTC');
    trade('ANX-T-PEAK', { product: 'Peak' });
    trade('ANX-T-BANK', { contract_type: 'Banking' });
    trade('ANX-T-LONG', { start_date: '2031-01-01', end_date: '2032-06-30' });
    trade('ANX-T-INTRA', { supplier_sldc: 'Delhi' });

    const built = buildAnnexures('MONTHLY', PERIOD);
    const by = Object.fromEntries(built.annexures.map((a) => [a.code, a]));

    expect(built.basis).toBe('TRADE_BOOK');
    expect(built.form_status).toBe('MISSING');
    expect(by['IV-A'].rows.map((r) => r.section).sort()).toEqual(['A', 'B']);
    expect(by['IV-B'].row_count).toBe(1);
    expect(by['IV-D'].row_count).toBe(1);
    // Intra-State is a volume per state, with no parties on it.
    expect(by['IV-E'].rows).toEqual([{ code: 'IV-E', section: 'ST', seller_state: 'Delhi', volume_mu: 7.44 }]);

    const rtc = by['IV-A'].rows.find((r) => r.section === 'A');
    expect(rtc).toMatchObject({
      volume_mu: 7.44, seller_state: 'West Bengal', buyer_state: 'Delhi',
      start_time: '00:00', end_time: '24:00', purchase_price: 4, sale_price: 4.03, margin: 0.03,
    });
    // Every trade lands on exactly one form.
    expect(built.total_volume_mu).toBeCloseTo(7.44 * 5, 4);
  });

  it('rejects a period it cannot read', () => {
    expect(() => buildAnnexures('MONTHLY', 'May 2031')).toThrow(/YYYY-MM/);
  });
});

describe('annexuresWorkbook', () => {
  it('writes a sheet per form in the filed layout, NIL where there is nothing', () => {
    trade('ANX-T-RTC');
    const wb = XLSX.read(annexuresWorkbook(buildAnnexures('MONTHLY', PERIOD)), { type: 'buffer' });

    expect(wb.SheetNames).toEqual(ANNEXURES.map((a) => `Form ${a.code}`));

    const a = XLSX.utils.sheet_to_json(wb.Sheets['Form IV-A'], { header: 1, defval: '' });
    expect(a[0][0]).toBe('Form IV A');
    expect(a[1][0]).toMatch(/Short-term Inter-State.*RTC/);
    expect(a[4][0]).toBe('Month: May, 2031');
    expect(a[6].slice(0, 2)).toEqual(['Sr.No', 'Period of Power Delivery']);
    expect(a[7][1]).toBe('Start date (DD/MM/YYYY)');
    expect(a[8]).toEqual(expect.arrayContaining(['A', 'Inter State Trading Transactions']));
    expect(a[9].slice(0, 6)).toEqual([1, '01-05-2031', '31-05-2031', '00:00', '24:00', 7.44]);
    // Sections with nothing in them are still filed, as NIL.
    expect(a[11].slice(0, 2)).toEqual([1, 'NIL']);

    const k = XLSX.utils.sheet_to_json(wb.Sheets['Form IV-K'], { header: 1, defval: '' });
    expect(k.some((r) => r[0] === 'Form IV K : Margin')).toBe(true);
  });
});

describe('licence compliance', () => {
  const asOf = new Date('2031-06-15T00:00:00Z');
  const year = () => licenceCompliance({ asOf }).years.find((y) => y.fy === '2031-32');

  it('marks the fee overdue after 30 April and the net worth pending until recorded', () => {
    expect(year()).toMatchObject({
      is_current: true, fee_due_date: '2031-04-30', fee_status: 'OVERDUE', fee_days_past_due: 46,
      net_worth_status: 'PENDING',
    });
  });

  it('clears both once the payment and a sufficient net worth are recorded', () => {
    saveLicenceYear('2031-32', {
      fee_amount: 4000000, fee_paid_on: '2031-04-22', fee_reference: 'UTR123', net_worth_cr: 61.5, net_worth_as_on: '2031-03-31',
    }, 'Tester', { asOf });
    expect(year()).toMatchObject({ fee_status: 'PAID', fee_days_past_due: 0, net_worth_status: 'COMPLIANT' });

    saveLicenceYear('2031-32', { fee_amount: 4000000, fee_paid_on: '2031-04-22', fee_reference: 'UTR123', net_worth_cr: 42, net_worth_as_on: '2031-03-31' }, 'Tester', { asOf });
    expect(year().net_worth_status).toBe('SHORTFALL');
  });

  // Found by the audit of 17-Oct-2026: ₹1 paid on a future date read "Paid", a
  // fee paid five months late read "Paid", a 2019 certificate met the minimum,
  // and a year far ahead was stored and never shown.
  it('tells a late or short payment from a paid one, and a stale certificate from a current one', () => {
    saveLicenceYear('2031-32', { fee_amount: 4000000, fee_paid_on: '2031-05-20', fee_reference: 'UTR-LATE' }, 'Tester', { asOf });
    expect(year()).toMatchObject({ fee_status: 'PAID_LATE', fee_days_late: 20 });
    saveLicenceYear('2031-32', { fee_amount: 100, fee_paid_on: '2031-04-20', fee_reference: 'UTR-SHORT', net_worth_cr: 62.5, net_worth_as_on: '2025-03-31' }, 'Tester', { asOf });
    expect(year()).toMatchObject({ fee_status: 'SHORT', fee_short_by: 3999900, net_worth_status: 'STALE' });
    expect(licenceCompliance({ asOf }).totals.fee_overdue).toBeGreaterThanOrEqual(1);
  });

  it('refuses future dates, a payment with no amount, a net worth with no date, and a year beyond the next', () => {
    expect(() => saveLicenceYear('2031-32', { fee_amount: 4000000, fee_paid_on: '2031-07-01', fee_reference: 'X' }, 'Tester', { asOf })).toThrow(/in the future/);
    expect(() => saveLicenceYear('2031-32', { fee_paid_on: '2031-04-20', fee_reference: 'X' }, 'Tester', { asOf })).toThrow(/amount paid/);
    expect(() => saveLicenceYear('2031-32', { net_worth_cr: 60 }, 'Tester', { asOf })).toThrow(/certified as on/);
    expect(() => saveLicenceYear('2036-37', {}, 'Tester', { asOf })).toThrow(/beyond the next financial year/);
    expect(() => saveLicenceYear('2032-33', {}, 'Tester', { asOf })).not.toThrow();
  });

  it('refuses a payment with no reference, and a malformed year', () => {
    expect(() => saveLicenceYear('2031-32', { fee_amount: 4000000, fee_paid_on: '2031-04-22' }, 'Tester', { asOf })).toThrow(/reference/);
    expect(() => saveLicenceYear('2031-33', {}, 'Tester', { asOf })).toThrow(/2026-27/);
  });
});
