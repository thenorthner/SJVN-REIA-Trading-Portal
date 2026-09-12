import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// The clearance registry ran on invented NOC numbers and measured its renewal
// alert against a date written into the source; the application detail page
// carried one real application's numbers and showed them for every id.

const state = vi.hoisted(() => ({ nocs: [], detail: null, clearance: null, application: null, fail: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    nocUpdation: {
      list: () => Promise.resolve(state.nocs),
      get: () => Promise.resolve(state.detail),
    },
    bids: { standingClearance: () => (state.clearance ? Promise.resolve(state.clearance) : Promise.reject(new Error('none'))) },
    isetReports: {
      noarApplication: () => (state.fail ? Promise.reject(state.fail) : Promise.resolve(state.application)),
    },
  };
  return { api, default: api };
});

const NOARRegistry = (await import('./NOARRegistry.jsx')).default;
const NOARDetailCard = (await import('./NOARDetailCard.jsx')).default;

const iso = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

let host, root;
beforeEach(() => {
  state.nocs = [];
  state.detail = null;
  state.clearance = null;
  state.application = null;
  state.fail = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async (El) => {
  await act(async () => { root.render(<MemoryRouter><El /></MemoryRouter>); });
};

describe('standing clearance registry', () => {
  it('measures validity against today, not a date in the source', async () => {
    state.nocs = [
      { id: 'N1', client_id: 'TCL-1', client_name: 'Alpha Discom', noar_id: 'NOAR-1', issuing_authority: 'HPSLDC', noc_reference_no: 'NOC/1', noc_valid_from: iso(-120), noc_valid_to: iso(-5), status: 'ACTIVE', order_count: 2, total_quantum_mw: 30 },
      { id: 'N2', client_id: 'TCL-1', client_name: 'Alpha Discom', noar_id: 'NOAR-1', issuing_authority: 'HPSLDC', noc_reference_no: 'NOC/2', noc_valid_from: iso(-10), noc_valid_to: iso(200), status: 'ACTIVE', order_count: 1, total_quantum_mw: 29.29 },
    ];
    await render(NOARRegistry);
    // The one that ended five days ago is expired; the other is active.
    expect(host.textContent).toMatch(/Trading is exposed/);
    expect(host.textContent).toMatch(/NOC\/1 for Alpha Discom expired/);
    expect(host.textContent).toMatch(/Expired/);
    expect(host.textContent).toMatch(/Active today/);
  });

  it('warns about a renewal that falls inside the next thirty days', async () => {
    state.nocs = [
      { id: 'N3', client_id: 'TCL-2', client_name: 'Beta Power', issuing_authority: 'UPSLDC', noc_reference_no: 'NOC/3', noc_valid_from: iso(-60), noc_valid_to: iso(9), status: 'ACTIVE', order_count: 1, total_quantum_mw: 50 },
    ];
    await render(NOARRegistry);
    expect(host.textContent).toMatch(/Renewal due/);
    expect(host.textContent).toMatch(/in 9 days/);
  });

  it('says the register is empty rather than showing invented certificates', async () => {
    await render(NOARRegistry);
    expect(host.textContent).toMatch(/No clearance has been recorded yet/);
    expect(host.textContent).not.toMatch(/HPSLDC\/NR\/2023|Naitwar/);
  });
});

describe('NOAR application detail', () => {
  it('shows the approval, the charge lines and their total', async () => {
    state.application = {
      application_no: 'APP-1',
      approval: {
        application_no: 'APP-1', applicant_name: 'SJVN Limited', seller_name: 'Test Solar',
        buyer_name: 'Test Council', from_date: '2026-09-01', to_date: '2026-09-01',
        applied_capacity_mwh: 437.775, approved_capacity_mwh: 400.5,
        approval_no: 'NR/2026/1/A', approval_date: '2026-08-30',
      },
      charges: [
        { name: 'Application Fee', vendor: null, pan: null, payable: 5000, tds: null, net: 5000 },
        { name: 'STOA — CTU', vendor: 'PGCIL', pan: 'AAACP5678B', payable: 100000, tds: 10000, net: 90000 },
      ],
      payment: { nodal_rldc: 'NRLDC', payment_date: '2026-09-04', total_stoa: 105000, total_tds: 10000, net_payment: 95000, actual_stoa_paid: 105000, actual_tds_paid: 10000 },
    };
    await render(NOARDetailCard);
    expect(host.textContent).toMatch(/SJVN Limited/);
    expect(host.textContent).toMatch(/400\.5 MWh/);
    expect(host.textContent).toMatch(/PGCIL/);
    const totals = host.querySelector('.totals-row').textContent;
    // Amounts read the way the rest of the app writes them: Indian grouping.
    expect(totals).toMatch(/₹1,05,000/);
    expect(totals).toMatch(/₹95,000/);
    expect(host.textContent).toMatch(/NRLDC/);
  });

  it('reports an unknown application instead of showing someone elses', async () => {
    state.fail = { response: { data: { error: 'No NOAR application on record with number APP-9' } } };
    await render(NOARDetailCard);
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/No NOAR application on record/);
    expect(host.textContent).not.toMatch(/ReNew Surya|New Delhi Municipal/);
  });

  it('shows the charges even when the approval has not been entered', async () => {
    state.application = {
      application_no: 'APP-2',
      approval: null,
      charges: [{ name: 'Application Fee', vendor: null, pan: null, payable: 5000, tds: null, net: 5000 }],
      payment: null,
    };
    await render(NOARDetailCard);
    expect(host.textContent).toMatch(/No approval is on record/);
    expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });
});
