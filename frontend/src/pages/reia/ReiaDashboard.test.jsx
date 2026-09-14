import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// The dashboard carried fourteen cards and none of them answered CP-58-61: the
// surcharge position, the split between developers and buyers, the age of the
// outstanding, or where the CERC Form-IV filings stand.

const state = vi.hoisted(() => ({ payload: null }));
vi.mock('../../api/client.js', () => {
  const api = { dashboard: { reia: () => Promise.resolve(state.payload) } };
  return { api, default: api };
});
// recharts measures a DOM box jsdom does not lay out; the cards are what matter.
vi.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub, LineChart: Stub, BarChart: Stub, PieChart: Stub,
    Line: () => null, Bar: () => null, Pie: () => null, Cell: () => null,
    XAxis: () => null, YAxis: () => null, CartesianGrid: () => null,
    Tooltip: () => null, Legend: () => null,
  };
});

const ReiaDashboard = (await import('./ReiaDashboard.jsx')).default;

const PAYLOAD = {
  kpis: {
    activeContracts: 4, contractedCapacity: 250, energySupplied: 1000, billedEnergy: 900,
    pendingApprovals: 1, pendingInvoiceApprovals: 1, pendingDisputes: 0, reconciliationExceptions: 0,
    expiringSecurities: 0, activeSellers: 2, activeBuyers: 2, pendingEntityApprovals: 0,
    contractsNearingExpiry: 0, documentsExpiringSoon: 0, totalInvoices: 6, totalInvoiceValue: 5000000,
    receivables: 1500000, payables: 300000, paymentsReceived: 0, paymentsDisbursed: 0, overdue: 3,
    lpsRecovered: 4000, lpsRecoverable: 31000,
    developerPending: 300000, buyerPending: 1500000,
    formIvPending: 2, formIvOverdue: 1,
  },
  byStatus: [], contractsByStatus: [], byProjectType: [], monthlyBilling: [], documentsExpiring: [],
  lps: {
    receivable: { recovered: 4000, billed_outstanding: 1000, accrued_unbilled: 29000, recoverable: 30000, annual_pct: 15 },
    payable: { recovered: 0, billed_outstanding: 1000, accrued_unbilled: 0, recoverable: 1000, annual_pct: 15 },
  },
  pendingSplit: {
    buyer: { invoices: 4, outstanding: 1500000, overdue_invoices: 3, overdue_amount: 1200000 },
    developer: { invoices: 1, outstanding: 300000, overdue_invoices: 1, overdue_amount: 300000 },
  },
  ageing: {
    receivable: [
      { bucket: 'NOT_DUE', label: 'Not yet due', invoices: 1, amount: 300000 },
      { bucket: 'DAYS_0_30', label: '1–30 days', invoices: 1, amount: 200000 },
      { bucket: 'DAYS_31_60', label: '31–60 days', invoices: 1, amount: 300000 },
      { bucket: 'DAYS_61_90', label: '61–90 days', invoices: 0, amount: 0 },
      { bucket: 'DAYS_90_PLUS', label: 'Over 90 days', invoices: 1, amount: 700000 },
    ],
    payable: [
      { bucket: 'NOT_DUE', label: 'Not yet due', invoices: 0, amount: 0 },
      { bucket: 'DAYS_0_30', label: '1–30 days', invoices: 1, amount: 300000 },
      { bucket: 'DAYS_31_60', label: '31–60 days', invoices: 0, amount: 0 },
      { bucket: 'DAYS_61_90', label: '61–90 days', invoices: 0, amount: 0 },
      { bucket: 'DAYS_90_PLUS', label: 'Over 90 days', invoices: 0, amount: 0 },
    ],
  },
  formIv: {
    total: 3, submitted: 1, pending: 2, overdue: 1, open_breaches: 2,
    latest_period: '2026-08', latest_status: 'DRAFT', latest_due_date: '2026-09-20',
  },
};

let host, root;
beforeEach(() => {
  state.payload = PAYLOAD;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><ReiaDashboard /></MemoryRouter>); });
};

describe('REIA dashboard — the CP-58-61 figures', () => {
  it('reports the surcharge recovered and what is still recoverable', async () => {
    await render();
    expect(host.textContent).toMatch(/LPS Recovered/);
    expect(host.textContent).toMatch(/LPS Recoverable/);
    // The unbilled part is called out, because that is the part no bill asks for.
    expect(host.textContent).toMatch(/not yet billed/);
    expect(host.textContent).toMatch(/has accrued on overdue bills at 15% a year/);
  });

  it('splits the pending money between developers and buyers, with bill counts', async () => {
    await render();
    expect(host.textContent).toMatch(/Pending to Developers/);
    expect(host.textContent).toMatch(/1 bills · 1 overdue/);
    expect(host.textContent).toMatch(/Pending from Buyers/);
    expect(host.textContent).toMatch(/4 bills · 3 overdue/);
  });

  it('ages the outstanding and totals to the same receivable as the KPI', async () => {
    await render();
    const table = [...host.querySelectorAll('table.data-table')].find((t) => t.textContent.includes('Over 90 days'));
    expect(table).toBeTruthy();
    expect(table.textContent).toMatch(/Not yet due/);
    const totals = table.querySelector('.totals-row').textContent;
    // 3 + 2 + 3 + 0 + 7 lakh = 15 lakh, the receivable KPI.
    expect(totals).toMatch(/15,00,000/);
    expect(totals).toMatch(/3,00,000/);
  });

  it('says where the Form-IV filing stands, and does not send a REIA user to the trading screen', async () => {
    await render();
    expect(host.textContent).toMatch(/CERC Form-IV/);
    expect(host.textContent).toMatch(/2026-08 · DRAFT/);
    expect(host.textContent).toMatch(/2 pending, 1 past due · 2 margin breaches/);
    const cards = [...host.querySelectorAll('.stat-card')];
    const formIv = cards.find((c) => c.textContent.includes('CERC Form-IV'));
    expect(formIv.parentElement.getAttribute('style')).toBeNull();
  });

  it('still renders when a deployment answers without the new sections', async () => {
    state.payload = { ...PAYLOAD, lps: undefined, pendingSplit: undefined, ageing: undefined, formIv: undefined };
    await render();
    expect(host.textContent).toMatch(/Active Contracts/);
    expect(host.textContent).toMatch(/Nothing filed/);
    expect(host.textContent).not.toMatch(/Over 90 days/);
  });
});
