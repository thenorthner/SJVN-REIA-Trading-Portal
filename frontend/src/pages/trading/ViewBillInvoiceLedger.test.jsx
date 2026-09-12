import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Seven invoice screens render through this one ledger. Its markup was written
// in utility classes for a CSS framework this app does not ship, so it came out
// unstyled; these tests hold it to the shared report chrome and to the sorting
// and filtering the header row offers.

const state = vi.hoisted(() => ({ rows: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    viewBillInvoices: {
      list: () => Promise.resolve(state.rows),
      get: (id) => Promise.resolve(state.rows.find((r) => r.id === id)),
      downloadPdf: () => Promise.resolve(new Blob()),
    },
    tradingNotes: { list: () => Promise.resolve([]) },
  };
  return { api, default: api };
});

const ViewBillInvoiceLedger = (await import('./ViewBillInvoiceLedger.jsx')).default;

const INVOICES = [
  {
    id: 'VBI-1', client_name: 'Alpha Discom', invoice_no: 'SJVN/TM/2026/001',
    invoice_amount: 125000.5, invoice_date: '2026-08-05', invoice_due_date: '2026-08-20',
    supply_from_date: '2026-07-01', supply_to_date: '2026-07-31',
    invoice_generated_on: '2026-08-05 10:30:00', status: 'SENT',
  },
  {
    id: 'VBI-2', client_name: 'Beta Power', invoice_no: 'SJVN/TM/2026/002',
    invoice_amount: 4200, invoice_date: '2026-09-02', invoice_due_date: '2026-09-17',
    supply_from_date: '2026-08-01', supply_to_date: '2026-08-31',
    invoice_generated_on: '2026-09-02 09:00:00', status: 'SENT',
  },
];

let host, root;
beforeEach(() => {
  state.rows = INVOICES;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (props = {}) => {
  await act(async () => {
    root.render(<ViewBillInvoiceLedger billType="TRADING_MARGIN" title="Trading Margin Invoice Summary" {...props} />);
  });
};
const bodyRows = () => [...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
const setSearch = async (value) => {
  const el = host.querySelector('input[type="search"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('view bills ledger', () => {
  it('renders in the shared report chrome, not in classes nothing defines', async () => {
    await render();
    expect(host.querySelector('table.report-table')).toBeTruthy();
    expect(host.querySelector('.report-table-wrap')).toBeTruthy();
    expect(host.querySelector('.report-toolbar .export-group')).toBeTruthy();
    // Nothing left that depends on a framework this app does not ship.
    const classes = [...host.querySelectorAll('[class]')].map((el) => el.className).join(' ');
    expect(classes).not.toMatch(/bg-\[|text-\[|border-gray-|px-\d|py-\d/);
  });

  it('lists the invoices newest first and counts what is shown', async () => {
    await render();
    expect(bodyRows()).toHaveLength(2);
    expect(bodyRows()[0]).toMatch(/SJVN\/TM\/2026\/002/);
    expect(host.querySelector('.report-count').textContent).toMatch(/Showing 2 of 2 invoices/);
  });

  it('filters on what the invoice actually says', async () => {
    await render();
    await setSearch('alpha');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toMatch(/Alpha Discom/);
    expect(host.querySelector('.report-count').textContent).toMatch(/Showing 1 of 2 invoices \(filtered\)/);
  });

  it('sorts by a column the user clicks, and leaves the row counter alone', async () => {
    await render();
    const headers = [...host.querySelectorAll('thead th')];
    expect(headers[0].className).not.toMatch(/sortable/);
    const client = headers.find((th) => th.textContent.startsWith('Client Name'));
    await act(async () => { client.click(); });
    expect(bodyRows()[0]).toMatch(/Alpha Discom/);
    expect(client.getAttribute('aria-sort')).toBe('ascending');
    await act(async () => { client.click(); });
    expect(bodyRows()[0]).toMatch(/Beta Power/);
    expect(client.getAttribute('aria-sort')).toBe('descending');
  });

  it('spans the empty row across every column, payment columns included', async () => {
    state.rows = [];
    await render();
    expect(host.querySelector('.empty-cell').getAttribute('colspan')).toBe('14');
    await act(() => root.unmount());
    root = createRoot(host);
    await render({ showPaymentColumns: true });
    expect(host.querySelector('.empty-cell').getAttribute('colspan')).toBe('21');
    expect(host.querySelectorAll('thead th')).toHaveLength(21);
  });
});
