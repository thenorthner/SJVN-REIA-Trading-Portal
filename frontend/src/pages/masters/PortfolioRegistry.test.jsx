import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// The registry showed one invented company with two invented portfolio ids and a
// drawer of made-up contact details. It reads the desk's register now.

const rows = vi.hoisted(() => ({ value: [], fail: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    clientPortfolios: {
      list: () => (rows.fail ? Promise.reject(rows.fail) : Promise.resolve(rows.value)),
    },
  };
  return { api, default: api };
});

const PortfolioRegistry = (await import('./PortfolioRegistry.jsx')).default;

let host, root;
beforeEach(() => {
  rows.fail = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => {
  await act(async () => { root.render(<MemoryRouter><PortfolioRegistry /></MemoryRouter>); });
};

describe('portfolio registry', () => {
  it('says so when nothing has been recorded', async () => {
    rows.value = [];
    await render();
    expect(host.textContent).toMatch(/No portfolio has been recorded yet/);
    expect(host.textContent).not.toMatch(/NAITWAR/i);
  });

  it('groups the register by client and shows each portfolio', async () => {
    rows.value = [
      { id: 'P1', client_id: 'TCL-2', client_name: 'Zeta Power', exchange: 'IEX', portfolio_id: 'PF-901', portfolio_name: 'Zeta DAM', updated_at: '2026-09-01 10:00:00', updated_by: 'desk@sjvn' },
      { id: 'P2', client_id: 'TCL-1', client_name: 'Alpha Discom', exchange: 'PXIL', portfolio_id: 'PF-100', portfolio_name: 'Alpha RTM', updated_at: '2026-09-02 10:00:00', updated_by: null },
      { id: 'P3', client_id: 'TCL-1', client_name: 'Alpha Discom', exchange: 'IEX', portfolio_id: 'PF-101', portfolio_name: 'Alpha DAM', updated_at: '2026-09-03 10:00:00', updated_by: 'desk@sjvn' },
    ];
    await render();
    // Alphabetical by client, so Alpha's card comes before Zeta's.
    expect(host.textContent.indexOf('Alpha Discom')).toBeLessThan(host.textContent.indexOf('Zeta Power'));
    expect(host.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(host.textContent).toMatch(/PF-101/);
    expect(host.textContent).toMatch(/by desk@sjvn/);
  });

  it('reports a failure instead of an empty register', async () => {
    rows.value = [];
    rows.fail = { response: { data: { error: 'Forbidden' } } };
    await render();
    expect(host.querySelector('[role="alert"]').textContent).toBe('Forbidden');
  });
});
