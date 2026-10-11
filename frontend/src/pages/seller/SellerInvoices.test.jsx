import { describe, it, expect, vi } from 'vitest';

// The arithmetic and the choices behind the seller's invoice form, the shared
// figures on a bill, and where signing in lands — the parts of the first
// end-to-end run's findings that are plain functions.

vi.mock('../../api/client.js', () => ({ default: {}, api: {} }));

const { chargesFor, energyRowFor } = await import('./SellerInvoices.jsx');
const { calcBalanceDue } = await import('../../components/invoiceShared.jsx');
const { fmtCurrency } = await import('../../components/ui.jsx');
const { landingFor } = await import('../Login.jsx');

describe('energy charges on the seller form', () => {
  it('are MWh × 1000 units × the tariff per unit', () => {
    // The form left the 1000 out and raised the month at ₹43,947.
    expect(chargesFor(17100, 2.57)).toBe(43947000);
    expect(chargesFor(25200, 2.55)).toBe(64260000);
    expect(chargesFor('', 2.57)).toBe(0);
  });

  it('run on the locked row that matches the invoice type', () => {
    const rows = [
      { id: 'P', data_type: 'PROVISIONAL', energy_mwh: 24000 },
      { id: 'F', data_type: 'FINAL', energy_mwh: 25200 },
    ];
    expect(energyRowFor(rows, 'FINAL').id).toBe('F');
    expect(energyRowFor(rows, 'PROVISIONAL').id).toBe('P');
    expect(energyRowFor(rows, 'SUPPLEMENTARY').id).toBe('F');
    // Only a final figure is locked: a provisional bill still has something to run on.
    expect(energyRowFor([rows[1]], 'PROVISIONAL').id).toBe('F');
    expect(energyRowFor([], 'FINAL')).toBeNull();
    expect(energyRowFor(null, 'FINAL')).toBeNull();
  });
});

describe('what is left on a bill', () => {
  it("is the server's figure where it sends one", () => {
    expect(calcBalanceDue({ balance_due: 1149000, total_amount: 1200000, paid_total: 51000 })).toBe(1149000);
  });
  it('is otherwise the payable amount less what has been settled', () => {
    expect(calcBalanceDue({ direction: 'SJVN_TO_BUYER', status: 'PARTIALLY_PAID', total_amount: 125000, paid_total: 1000 })).toBe(124000);
    expect(calcBalanceDue({ direction: 'SELLER_TO_SJVN', status: 'PARTIALLY_PAID', total_amount: 45447, rebate: 151, paid_total: 10150 })).toBe(35146);
    expect(calcBalanceDue({ status: 'PAID', total_amount: 500, paid_total: 0 })).toBe(0);
    expect(calcBalanceDue(null)).toBe(0);
  });
});

describe('a negative amount', () => {
  it('carries its sign before the rupee mark', () => {
    expect(fmtCurrency(-8000)).toBe('-₹8,000');
    expect(fmtCurrency(8000)).toBe('₹8,000');
    expect(fmtCurrency(-0.2)).toBe('₹0');
    expect(fmtCurrency(null)).toBe('₹0');
  });
});

describe('where signing in lands', () => {
  const at = (pathname, search = '') => ({ pathname, search });
  it('is the page that was asked for', () => {
    expect(landingFor({ role: 'SJVN_ADMIN' }, at('/reia/invoices'))).toBe('/reia/invoices');
    expect(landingFor({ role: 'BUYER' }, at('/buyer/disputes', '?invoice=INV-1'))).toBe('/buyer/disputes?invoice=INV-1');
    expect(landingFor({ role: 'SELLER_L1' }, at('/mail'))).toBe('/mail');
  });
  it("is home when the page belongs to someone else's portal", () => {
    expect(landingFor({ role: 'BUYER' }, at('/seller/invoices'))).toBe('/');
    expect(landingFor({ role: 'SELLER' }, at('/reia/invoices'))).toBe('/');
    expect(landingFor({ role: 'REIA_USER' }, at('/buyer/invoices'))).toBe('/');
    expect(landingFor({ role: 'SJVN_ADMIN' }, null)).toBe('/');
    expect(landingFor({ role: 'SJVN_ADMIN' }, at('/login'))).toBe('/');
  });
});
