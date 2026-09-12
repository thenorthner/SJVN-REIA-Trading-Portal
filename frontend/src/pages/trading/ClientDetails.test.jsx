import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// This screen showed a single row reading "Demo Value" in all twelve columns.

const state = vi.hoisted(() => ({ rows: [] }));
vi.mock('../../api/client.js', () => {
  const api = { tradingClients: { list: () => Promise.resolve(state.rows) } };
  return { api, default: api };
});

const ClientDetails = (await import('./ClientDetails.jsx')).default;

const CLIENTS = [
  { id: 'TCL-1', name: 'Alpha Discom', client_type: 'DISCOM', sldc_name: 'HPSLDC', standing_clearance_no: 'SC/1', noc_valid_till: '2027-03-31', tgna_approved_mw: 120, exposure_limit: 5000000, status: 'ACTIVE' },
  { id: 'TCL-2', name: 'Beta Hydro', client_type: 'GENERATOR', sldc_name: null, standing_clearance_no: null, noc_valid_till: null, tgna_approved_mw: null, exposure_limit: 0, status: 'SUSPENDED' },
];

let host, root;
beforeEach(() => {
  state.rows = CLIENTS;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><ClientDetails /></MemoryRouter>); });
};
const bodyRows = () => [...host.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
const setValue = async (el, value, event = 'change') => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
};

describe('client details', () => {
  it('lists the clients on record, with what the register leaves blank marked', async () => {
    await render();
    expect(bodyRows()).toHaveLength(2);
    expect(host.textContent).toMatch(/Alpha Discom/);
    expect(host.textContent).not.toMatch(/Demo Value/);
    expect(bodyRows()[1]).toMatch(/—/);
    expect(host.querySelector('.report-count').textContent).toMatch(/Showing 2 of 2 clients/);
  });

  it('filters by category and by what the desk types', async () => {
    await render();
    await setValue(host.querySelector('select'), 'GENERATOR');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toMatch(/Beta Hydro/);

    await setValue(host.querySelector('select'), '');
    await setValue(host.querySelector('input[type="search"]'), 'hpsldc', 'input');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toMatch(/Alpha Discom/);
    expect(host.querySelector('.report-count').textContent).toMatch(/\(filtered\)/);
  });

  it('says the register is empty rather than showing a placeholder row', async () => {
    state.rows = [];
    await render();
    expect(host.querySelector('.empty-cell').textContent).toBe('No clients on record');
  });
});
