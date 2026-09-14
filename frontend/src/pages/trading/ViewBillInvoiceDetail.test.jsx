import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// This page was a printed-invoice replica with three real invoices — clients,
// GSTINs, portfolio codes — written into the source, keyed on a slug, and it fell
// back to showing the first of them whenever the id did not match.

const state = vi.hoisted(() => ({ invoice: null, notes: [], fail: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    viewBillInvoices: {
      get: () => (state.fail ? Promise.reject(state.fail) : Promise.resolve(state.invoice)),
      downloadPdf: () => Promise.resolve(new Blob()),
    },
    tradingNotes: { list: () => Promise.resolve(state.notes) },
  };
  return { api, default: api };
});

const ViewBillInvoiceDetail = (await import('./ViewBillInvoiceDetail.jsx')).default;

const INVOICE = {
  id: 'VBI-1', bill_type: 'EXCHANGE_OA', client_name: 'Alpha Discom',
  invoice_no: 'SJVN/EXCHANGE/OA/ALPHA/202609/001', invoice_amount: 118000,
  invoice_date: '2026-09-05', invoice_due_date: '2026-09-12',
  supply_from_date: '2026-09-01', supply_to_date: '2026-09-01',
  invoice_generated_on: '2026-09-05 11:00:00', quantum_mwh: 240.5,
  rate_per_unit: 0.41, gst_amount: 18000, settlement_basis: 'PROVISIONAL',
  status: 'ACTIVE', remarks: null,
  breakup_json: JSON.stringify([
    { description: 'Open access charges (IEX-DAM)', basis: 'MWh @ Rs/kWh', quantity: 240.5, rate: 0.41, amount: 100000 },
    { description: 'GST at 18%', basis: 'On charges', quantity: null, rate: null, amount: 18000 },
  ]),
};

let host, root;
beforeEach(() => {
  state.invoice = INVOICE;
  state.notes = [];
  state.fail = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><ViewBillInvoiceDetail /></MemoryRouter>); });
};

describe('invoice detail', () => {
  it('shows the invoice as the register holds it, with its line items', async () => {
    await render();
    expect(host.textContent).toMatch(/SJVN\/EXCHANGE\/OA\/ALPHA\/202609\/001/);
    expect(host.textContent).toMatch(/Alpha Discom/);
    expect(host.textContent).toMatch(/240\.5 MWh/);
    expect(host.textContent).toMatch(/PROVISIONAL/);
    expect(host.querySelectorAll('.report-table tbody tr')).toHaveLength(3); // two lines + total
    expect(host.querySelector('.totals-row').textContent).toMatch(/₹1,18,000/);
    // No invented tax-invoice document: no GSTIN, no letterhead.
    expect(host.textContent).not.toMatch(/GSTIN|Mini Ratna|CIN:/);
  });

  it('says a hand-entered invoice has no breakup instead of inventing one', async () => {
    state.invoice = { ...INVOICE, breakup_json: null };
    await render();
    expect(host.textContent).toMatch(/carries no itemised breakup/);
  });

  it('reports an unknown reference instead of falling back to another invoice', async () => {
    state.fail = { response: { status: 404, data: { error: 'Not found' } } };
    await render();
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/No invoice on record with reference/);
    expect(host.textContent).not.toMatch(/NDMC|Kreate/);
  });

  it('shows a cancellation and the notes raised against the invoice', async () => {
    state.invoice = { ...INVOICE, status: 'CANCELLED', cancel_reason: 'Superseded by 002' };
    state.notes = [{ id: 'N1', note_no: 'DN/1', note_type: 'DEBIT', amount: 5000, reason: 'Rate revision', status: 'ISSUED' }];
    await render();
    expect(host.textContent).toMatch(/This invoice was cancelled: Superseded by 002/);
    expect(host.textContent).toMatch(/DN\/1/);
  });
});
