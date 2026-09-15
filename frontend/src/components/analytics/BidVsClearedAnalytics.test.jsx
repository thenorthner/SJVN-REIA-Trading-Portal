import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The DAM/GDAM "Market MCP" tab: the bid book against what cleared and the
// market price, where it used to be Math.random.

const state = vi.hoisted(() => ({ answer: null, calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = { marketAnalytics: { bidVsCleared: (params) => { state.calls.push(params); return Promise.resolve(state.answer); } } };
  return { api, default: api };
});
vi.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub, LineChart: Stub, Line: () => null, XAxis: () => null, YAxis: () => null,
    CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
  };
});

const BidVsClearedAnalytics = (await import('./BidVsClearedAnalytics.jsx')).default;

const ANSWER = {
  product: 'GDAM', exchange: null, date: '2026-09-12', available_dates: ['2026-09-12', '2026-09-10'],
  market_exchange: 'IEX', market_loaded: false,
  blocks: [{ block: 73, time_block: '18:00', bid_mw: 25, bid_price: 6.2, cleared_mw: 15, cleared_price: 5, market_mcp: null }],
  totals: { bids: 2, stub_bids: 1, bid_mwh: 125, cleared_mwh: 122.5, cleared_pct: 98 },
  unreadable_time_blocks: ['Evening peak'],
};

let host, root;
beforeEach(() => {
  state.answer = ANSWER;
  state.calls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<BidVsClearedAnalytics product="GDAM" />); }); };

describe('Bid against cleared', () => {
  it('asks for the product it is shown on, and totals what was bid and cleared', async () => {
    await render();
    expect(state.calls[0]).toEqual({ product: 'GDAM' });
    expect(host.textContent).toMatch(/125 MWh/);
    expect(host.textContent).toMatch(/122\.5 MWh/);
    expect(host.textContent).toMatch(/98%/);
  });

  it('says stub bids were not sent, and when the market price is not loaded', async () => {
    await render();
    expect(host.querySelector('.alert-warning').textContent).toMatch(/1 of 2 bid\(s\).*stub mode/);
    expect(host.textContent).toMatch(/No block-wise IEX GDAM prices for this day/);
    expect(host.textContent).toMatch(/Evening peak/);
  });

  it('offers the delivery dates that have bids', async () => {
    await render();
    const select = host.querySelector('select');
    expect([...select.options].map((o) => o.value)).toEqual(['2026-09-12', '2026-09-10']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, '2026-09-10');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.calls).toContainEqual({ product: 'GDAM', date: '2026-09-10' });
  });

  it('says there is nothing to compare before any bid', async () => {
    state.answer = { ...ANSWER, date: null, available_dates: [], blocks: [], totals: null };
    await render();
    expect(host.textContent).toMatch(/No GDAM bid has been submitted or cleared yet/);
  });
});
