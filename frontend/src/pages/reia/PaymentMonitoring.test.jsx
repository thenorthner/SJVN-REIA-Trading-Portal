import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// Outstanding, delay days and surcharge, on both sides of the desk.

const state = vi.hoisted(() => ({ answers: {}, calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    reports: {
      paymentMonitoring: (side) => { state.calls.push(side); return Promise.resolve(state.answers[side]); },
    },
  };
  return { api, default: api };
});

const PaymentMonitoring = (await import('./PaymentMonitoring.jsx')).default;

const bill = (over = {}) => ({
  id: 'INV-1', invoice_no: 'SJVN/2026/0001', contract_no: 'PSA/001', billing_period: '2026-08',
  counterparty_id: 'BUY-1', counterparty_name: 'Test Discom', due_date: '2026-08-20',
  days_past_due: 25, surcharge_days: 18, outstanding: 500000, lps_charged: 0,
  lps_accrued_unbilled: 4200, status: 'SENT', ...over,
});

const RECEIVABLE = {
  side: 'RECEIVABLE', as_of: '2026-09-14', annual_pct: 15,
  totals: { invoices: 2, outstanding: 700000, overdue_invoices: 1, overdue_amount: 500000, lps_charged: 1000, lps_accrued_unbilled: 4200 },
  ageing: [
    { bucket: 'NOT_DUE', label: 'Not yet due', invoices: 1, amount: 200000 },
    { bucket: 'DAYS_0_30', label: '1–30 days', invoices: 1, amount: 500000 },
    { bucket: 'DAYS_31_60', label: '31–60 days', invoices: 0, amount: 0 },
    { bucket: 'DAYS_61_90', label: '61–90 days', invoices: 0, amount: 0 },
    { bucket: 'DAYS_90_PLUS', label: 'Over 90 days', invoices: 0, amount: 0 },
  ],
  counterparties: [
    { counterparty_id: 'BUY-1', counterparty_name: 'Test Discom', invoices: 1, outstanding: 500000, overdue_invoices: 1, overdue_amount: 500000, oldest_days_past_due: 25 },
    { counterparty_id: 'BUY-2', counterparty_name: 'Another Discom', invoices: 1, outstanding: 200000, overdue_invoices: 0, overdue_amount: 0, oldest_days_past_due: 0 },
  ],
  bills: [
    bill(),
    bill({ id: 'INV-2', invoice_no: 'SJVN/2026/0002', counterparty_id: 'BUY-2', counterparty_name: 'Another Discom', days_past_due: -6, surcharge_days: 0, outstanding: 200000, lps_accrued_unbilled: 0 }),
  ],
};

const PAYABLE = {
  ...RECEIVABLE, side: 'PAYABLE',
  totals: { invoices: 1, outstanding: 300000, overdue_invoices: 1, overdue_amount: 300000, lps_charged: 0, lps_accrued_unbilled: 900 },
  counterparties: [{ counterparty_id: 'SELL-1', counterparty_name: 'Test Solar Ltd', invoices: 1, outstanding: 300000, overdue_invoices: 1, overdue_amount: 300000, oldest_days_past_due: 9 }],
  bills: [bill({ id: 'INV-9', counterparty_id: 'SELL-1', counterparty_name: 'Test Solar Ltd', outstanding: 300000, days_past_due: 9 })],
};

let host, root;
beforeEach(() => {
  state.answers = { RECEIVABLE, PAYABLE };
  state.calls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><PaymentMonitoring /></MemoryRouter>); });
};
const button = (label) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const bodyRows = (selector) => [...host.querySelectorAll(selector)].map((tr) => tr.textContent);

describe('payment monitoring', () => {
  it('opens on what buyers owe, with the delay and the surcharge earned', async () => {
    await render();
    expect(state.calls).toEqual(['RECEIVABLE']);
    expect(host.textContent).toMatch(/25d late/);
    expect(host.textContent).toMatch(/6d to go/);
    expect(host.textContent).toMatch(/18 chargeable days/);
    expect(host.textContent).toMatch(/Surcharge earned, not billed/);
    // The rate the surcharge runs at is named, not left to be guessed.
    expect(host.textContent).toMatch(/At 15% a year/);
  });

  it('ages the outstanding and totals to the same figure', async () => {
    await render();
    const ageing = [...host.querySelectorAll('table.data-table')][0];
    expect(ageing.textContent).toMatch(/Not yet due/);
    expect(ageing.querySelector('.totals-row').textContent).toMatch(/7,00,000/);
  });

  it('switches to what SJVN owes its developers', async () => {
    await render();
    await act(async () => { button('Owed by SJVN').click(); });
    expect(state.calls).toEqual(['RECEIVABLE', 'PAYABLE']);
    expect(host.textContent).toMatch(/Test Solar Ltd/);
    expect(host.textContent).toMatch(/Developer/);
  });

  it('narrows the bills to one counterparty when its row is clicked', async () => {
    await render();
    const row = [...host.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('Another Discom') && tr.className.includes('clickable'));
    await act(async () => { row.click(); });
    const listed = bodyRows('.report-table tbody tr');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatch(/SJVN\/2026\/0002/);
    expect(host.textContent).toMatch(/Showing one buyer's bills below/);
  });

  it('can show only what is actually late', async () => {
    await render();
    const checkbox = host.querySelector('input[type="checkbox"]');
    await act(async () => { checkbox.click(); });
    const listed = bodyRows('.report-table tbody tr');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatch(/25d late/);
  });

  it('says plainly when a side has nothing outstanding', async () => {
    state.answers.RECEIVABLE = {
      ...RECEIVABLE, bills: [], counterparties: [],
      totals: { invoices: 0, outstanding: 0, overdue_invoices: 0, overdue_amount: 0, lps_charged: 0, lps_accrued_unbilled: 0 },
    };
    await render();
    expect(host.textContent).toMatch(/Nothing outstanding on this side/);
  });
});
