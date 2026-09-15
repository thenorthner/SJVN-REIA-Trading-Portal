import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The intraday tab reads the block-wise days the platform holds. It used to draw
// a random day on every render beside an "Auto-Route to GDAM" button.

const state = vi.hoisted(() => ({ blocks: null, rates: [], calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    marketAnalytics: {
      getBlocks: (params) => { state.calls.push(['blocks', params]); return Promise.resolve(state.blocks); },
      getRates: (params) => { state.calls.push(['rates', params]); return Promise.resolve(state.rates); },
    },
  };
  return { api, default: api };
});
vi.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub, LineChart: Stub, BarChart: Stub, ComposedChart: Stub,
    Line: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null,
    CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
  };
});

const IntradayMarketTab = (await import('./IntradayMarketTab.jsx')).default;

const label = (b) => { const m = (b - 1) * 15; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const curve = (fn) => Array.from({ length: 96 }, (_, i) => ({ block: i + 1, time_block: label(i + 1), mcp: fn(i + 1), mcv: 1000 }));

const BLOCKS = {
  exchange: 'IEX', date: '2026-09-12', available_dates: ['2026-09-12', '2026-09-11'],
  products: {
    DAM: { source: 'EXCHANGE_FILE', day_price: 4, blocks: curve((b) => (b <= 48 ? 2 : 6)) },
    GDAM: { source: 'IEX_API', day_price: 4.5, blocks: curve((b) => (b <= 60 ? 3 : 6)) },
    RTM: { source: null, day_price: null, blocks: [] },
  },
};

let host, root;
beforeEach(() => {
  state.blocks = BLOCKS;
  state.rates = [
    { rate_date: '2026-09-12', mcp_rate: 4, min_rate: 2, max_rate: 6 },
    { rate_date: '2026-09-11', mcp_rate: 3.8, min_rate: null, max_rate: null },
  ];
  state.calls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<IntradayMarketTab />); }); };

describe('Intraday prices', () => {
  it('shows each product\'s day price and where it came from, and says which product is not loaded', async () => {
    await render();
    expect(state.calls).toContainEqual(['blocks', { exchange: 'IEX' }]);
    expect(host.textContent).toMatch(/DAM day price₹4\.00\/kWh/);
    expect(host.textContent).toMatch(/from exchange price file/);
    expect(host.textContent).toMatch(/from IEX API/);
    expect(host.textContent).toMatch(/RTM day priceNot loaded/);
  });

  it('states the GDAM premium as a fact, with no routing advice or dead buttons', async () => {
    await render();
    // Overnight GDAM ₹3 against DAM ₹2 (blocks 1–48); DAM above it until 15:00, level after.
    expect(host.textContent).toMatch(/GDAM cleared above DAM in 48 of 96 blocks/);
    expect(host.textContent).toMatch(/\+₹0\.50\/kWh/);
    expect(host.textContent).not.toMatch(/Auto-Route|Export PDF|SAMPLE DATA/);
  });

  it('offers only the days that exist, and asks for the one chosen', async () => {
    await render();
    const [, dateSelect] = host.querySelectorAll('select');
    expect([...dateSelect.options].map((o) => o.value)).toEqual(['2026-09-12', '2026-09-11']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(dateSelect, '2026-09-11');
      dateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.calls).toContainEqual(['blocks', { exchange: 'IEX', date: '2026-09-11' }]);
  });

  it('says where block prices come from when there are none', async () => {
    state.blocks = { exchange: 'IEX', date: null, available_dates: [], products: { DAM: { blocks: [] }, GDAM: { blocks: [] }, RTM: { blocks: [] } } };
    await render();
    expect(host.textContent).toMatch(/holds no block-wise IEX prices/);
    expect(host.textContent).toMatch(/Load price file/);
  });

  it('draws the daily price trend from observed days, without a range for days that have none', async () => {
    await render();
    expect(state.calls).toContainEqual(['rates', { exchange: 'IEX', product: 'DAM' }]);
    expect(host.textContent).toMatch(/2 day\(s\), 2026-09-11 to 2026-09-12/);
    expect(host.textContent).toMatch(/block range shows only on days loaded block by block/);
  });
});
