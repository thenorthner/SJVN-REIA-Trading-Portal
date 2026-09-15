import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// The forecast beside a bid being priced. It must match a bid's own time-block
// labels, say plainly when no forecast covers the day, and never show a number
// for a product the models do not forecast.

const state = vi.hoisted(() => ({ answer: null, calls: [] }));
vi.mock('../api/client.js', () => {
  const api = { marketForecast: { forDate: (params) => { state.calls.push(params); return Promise.resolve(state.answer); } } };
  return { api, default: api };
});

const { default: BidForecastPanel, blocksCovered } = await import('./BidForecastPanel.jsx');

const label = (b) => {
  const m = (b - 1) * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const ANSWER = {
  exchange: 'IEX', product: 'DAM', date: '2026-09-16', price_cap: 10,
  forecast: { horizon: 2, forecast: 3.05, lower: 2.61, upper: 3.5 },
  run: { id: 'PFR-1', model_label: 'Weekday profile', cutoff_date: '2026-09-14', backtest_mape: 10.43, data_age_days: 1 },
  // Evening blocks at ₹8, the rest at ₹3.
  blocks: Array.from({ length: 96 }, (_, i) => ({ block: i + 1, time_block: label(i + 1), forecast: i + 1 >= 73 && i + 1 <= 88 ? 8 : 3 })),
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

const render = async (props) => {
  await act(async () => { root.render(<MemoryRouter><BidForecastPanel {...props} /></MemoryRouter>); });
};

describe('blocksCovered', () => {
  it('reads the labels bids actually carry', () => {
    expect(blocksCovered('18:00-18:15')).toEqual([73]);
    expect(blocksCovered('18:00 - 18:30')).toEqual([73, 74]);
    expect(blocksCovered('00:00-24:00')).toHaveLength(96);
    expect(blocksCovered('23:45-00:00')).toEqual([96]);
    expect(blocksCovered('Block-12')).toEqual([12]);
    expect(blocksCovered('18:00')).toEqual([73]);
    expect(blocksCovered('18:07-18:15')).toEqual([]);
    expect(blocksCovered('Block-97')).toEqual([]);
    expect(blocksCovered('')).toEqual([]);
  });
});

describe('Bid forecast panel', () => {
  it('shows the day\'s forecast, its range, the ceiling from Masters and where it came from', async () => {
    await render({ exchange: 'IEX', product: 'DAM', deliveryDate: '2026-09-16', blocks: [] });
    expect(state.calls).toEqual([{ exchange: 'IEX', product: 'DAM', date: '2026-09-16' }]);
    expect(host.textContent).toMatch(/₹3\.05\/kWh/);
    expect(host.textContent).toMatch(/80% range ₹2\.61 – ₹3\.50/);
    expect(host.textContent).toMatch(/Exchange ceiling ₹10\.00\/kWh/);
    expect(host.textContent).toMatch(/Weekday profile/);
    expect(host.textContent).toMatch(/2 days ahead/);
    expect(host.textContent).toMatch(/backtest error 10\.4%/);
  });

  it('sets each bid block against the forecast for the blocks it covers', async () => {
    await render({
      exchange: 'IEX', product: 'DAM', deliveryDate: '2026-09-16',
      blocks: [
        { time_block: '18:00-18:15', quantum_mw: 10, price_per_unit: 10 },
        { time_block: '17:45-18:15', quantum_mw: 10, price_per_unit: '' },
        { time_block: '00:00-24:00', quantum_mw: 10, price_per_unit: 3.05 },
        { time_block: 'whenever', quantum_mw: 10, price_per_unit: 4 },
      ],
    });
    const rows = [...host.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent));
    expect(rows).toEqual([
      ['18:00-18:15', '₹8.00', '₹10.00', '+25%'],
      ['17:45-18:15', '₹5.50', '—', '—'],
      ['00:00-24:00', '₹3.05', '₹3.05', '0%'],
    ]);
  });

  it('says no forecast covers the day, and how far the newest one reaches', async () => {
    state.answer = { exchange: 'IEX', product: 'RTM', date: '2026-09-30', price_cap: 10, forecast: null, latest_forecast_date: '2026-09-21' };
    await render({ exchange: 'IEX', product: 'RTM', deliveryDate: '2026-09-30' });
    expect(host.textContent).toMatch(/No price forecast covers IEX RTM/);
    expect(host.textContent).toMatch(/newest reaches 21 Sept 2026/);
    expect(host.querySelector('a').getAttribute('href')).toBe('/trading/market-forecasting');
  });

  it('warns when the forecast was made from old prices', async () => {
    state.answer = { ...ANSWER, run: { ...ANSWER.run, data_age_days: 199 } };
    await render({ exchange: 'IEX', product: 'DAM', deliveryDate: '2026-09-16' });
    expect(host.textContent).toMatch(/199 days older than the run/);
  });

  it('stays out of the way for products and dates it cannot forecast', async () => {
    await render({ exchange: 'IEX', product: 'TAM', deliveryDate: '2026-09-16' });
    await render({ exchange: 'IEX', product: 'DAM', deliveryDate: '' });
    expect(state.calls).toEqual([]);
    expect(host.textContent).toBe('');
  });
});
