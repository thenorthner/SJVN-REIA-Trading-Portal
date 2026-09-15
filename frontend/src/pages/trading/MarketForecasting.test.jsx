import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The forecasting screen. What matters is what a trader could be misled by: a
// forecast off stale prices that looks current, a range drawn from nothing, a
// button the API would refuse, and a price file half-loaded.

const state = vi.hoisted(() => ({ user: null, series: null, runs: [], detail: null, accuracy: null, calls: [], createError: null, uploadError: null }));
vi.mock('../../api/client.js', () => {
  const api = {
    marketForecast: {
      series: () => Promise.resolve(state.series),
      runs: (params) => { state.calls.push(['runs', params]); return Promise.resolve({ runs: state.runs }); },
      run: (id, params) => { state.calls.push(['run', id, params]); return Promise.resolve(state.detail); },
      accuracy: (params) => Promise.resolve(state.accuracy),
      createRun: (body) => {
        state.calls.push(['create', body]);
        return state.createError ? Promise.reject(state.createError) : Promise.resolve(state.detail);
      },
      uploadPrices: (body) => {
        state.calls.push(['upload', body]);
        return state.uploadError ? Promise.reject(state.uploadError) : Promise.resolve({});
      },
    },
  };
  return { api, default: api };
});
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: state.user }) }));
// recharts measures a DOM box jsdom does not lay out; the figures around it are what matter.
vi.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub, ComposedChart: Stub, LineChart: Stub,
    Line: () => null, Area: () => null, XAxis: () => null, YAxis: () => null,
    CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
  };
});

const MarketForecasting = (await import('./MarketForecasting.jsx')).default;

const series = (exchange, product, over = {}) => ({
  exchange, product, days: 0, first_date: null, last_date: null, sources: {}, block_days: 0, last_block_date: null, latest_run: null, ...over,
});

const SERIES = {
  today: '2026-09-15',
  models: [{ model: 'AUTO', label: 'Auto — best backtest' }, { model: 'WEEKDAY_PROFILE', label: 'Weekday profile' }],
  max_horizon_days: 31,
  block_horizon_days: 7,
  source_labels: { CERC_MMR: 'CERC monthly market report', EXCHANGE_FILE: 'Exchange price file', IEX_API: 'IEX API' },
  series: [
    series('IEX', 'DAM', { days: 486, first_date: '2024-03-01', last_date: '2026-02-28', sources: { CERC_MMR: 486 } }),
    series('IEX', 'GDAM'), series('IEX', 'RTM'),
    series('PXIL', 'DAM'), series('PXIL', 'GDAM'), series('PXIL', 'RTM'),
    series('HPX', 'DAM'), series('HPX', 'GDAM'), series('HPX', 'RTM'),
  ],
};

const point = (date, horizon, over = {}) => ({
  date, horizon, forecast: 4, lower: 3.4, upper: 4.8, actual: null, actual_source: null, error: null, abs_pct_error: null, within_band: null, ...over,
});

const RUN = {
  id: 'PFR-1', exchange: 'IEX', product: 'DAM', requested_model: 'AUTO', model: 'WEEKDAY_PROFILE', model_label: 'Weekday profile',
  selection: 'BEST_BACKTEST', cutoff_date: '2026-02-28', horizon_days: 3, first_target_date: '2026-03-01', last_target_date: '2026-03-03',
  history_from: '2024-03-01', history_days: 486, sources: { CERC_MMR: 486 },
  backtest: [
    { model: 'WEEKDAY_PROFILE', label: 'Weekday profile', mape: 9.69, mae: 0.36, bias: -0.02, origins: 90 },
    { model: 'MOVING_AVERAGE', label: '7-day average', mape: 15.1, mae: 0.6, bias: 0.1, origins: 90 },
  ],
  backtest_mape: 9.69, backtest_origins: 90, interval_coverage: 79.5, block_shape_days: 0,
  trigger_type: 'MANUAL', created_by_name: 'Desk Trader', created_at: '2026-09-15 06:00:00', data_age_days: 199,
};

const DETAIL = {
  run: RUN,
  points: [
    point('2026-03-01', 1, { forecast: 3.13, lower: 2.65, upper: 3.61, actual: 3.5, error: -0.37, abs_pct_error: 10.57, within_band: false }),
    point('2026-03-02', 2, { forecast: 3.99 }),
    point('2026-03-03', 3, { forecast: 3.98 }),
  ],
  realised: { scored_days: 1, awaiting_days: 2, mape: 10.57, mae: 0.37, bias: -0.37, within_band_pct: 0 },
  history: [{ date: '2026-02-27', price: 4.1, source: 'CERC_MMR' }, { date: '2026-02-28', price: 3.9, source: 'CERC_MMR' }],
  blocks: { dates: [], date: null, rows: [] },
  price_cap: 10,
};

const ACCURACY = {
  exchange: 'IEX', product: 'DAM', window: { from: null, to: null }, latest_actual_date: '2026-03-01',
  summary: { scored_days: 1, awaiting_days: 2, forecast_days: 3, mape: 10.57, mae: 0.37, rmse: 0.37, bias: -0.37, within_band_pct: 0 },
  by_horizon: [{ key: 'Day 1', forecasts: 1, mape: 10.57, bias: -0.37, within_band_pct: 0 }],
  by_model: [{ key: 'WEEKDAY_PROFILE', label: 'Weekday profile', forecasts: 1, mape: 10.57, bias: -0.37, within_band_pct: 0 }],
  days: DETAIL.points,
};

let host, root;
beforeEach(() => {
  state.user = { role: 'TRADING_USER' };
  state.series = SERIES;
  state.runs = [{ ...RUN, realised: DETAIL.realised }];
  state.detail = DETAIL;
  state.accuracy = ACCURACY;
  state.calls = [];
  state.createError = null;
  state.uploadError = null;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const render = async () => { await act(async () => { root.render(<MarketForecasting />); }); };
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.textContent.startsWith(text));
const click = async (el) => { await act(async () => { el.click(); }); };

describe('Market price forecasting', () => {
  it('opens on the series that has prices, with its latest run', async () => {
    await render();
    expect(state.calls).toContainEqual(['runs', { exchange: 'IEX', product: 'DAM' }]);
    expect(state.calls).toContainEqual(['run', 'PFR-1', undefined]);
    expect(host.textContent).toMatch(/486 daily prices/);
    expect(host.textContent).toMatch(/CERC monthly market report 486/);
  });

  it('says plainly when the newest price is months old', async () => {
    await render();
    const warning = host.querySelector('.alert-warning');
    expect(warning.textContent).toMatch(/199 days/);
    expect(warning.textContent).toMatch(/not the days\s+ahead/);
  });

  it('shows the forecast, its range, its backtest, and what has cleared so far', async () => {
    await render();
    expect(host.textContent).toMatch(/₹3\.13\/kWh/);
    expect(host.textContent).toMatch(/80% range ₹2\.65 – ₹3\.61/);
    expect(host.textContent).toMatch(/9\.7%/);
    expect(host.textContent).toMatch(/1 of 3 days cleared/);
    const firstDay = [...host.querySelectorAll('.report-table tbody tr')].find((r) => r.textContent.includes('Mar 2026') && r.textContent.includes('₹3.50'));
    expect(firstDay.textContent).toMatch(/Outside range/);
    const published = [...host.querySelectorAll('.report-table tbody tr')].find((r) => r.textContent.includes('Published'));
    expect(published.textContent).toMatch(/Weekday profile/);
  });

  it('says why there is no intraday shape rather than drawing one', async () => {
    await render();
    expect(host.textContent).toMatch(/No block-wise IEX DAM prices were loaded/);
  });

  it('makes a forecast with what the desk chose', async () => {
    await render();
    await click(button('Make forecast'));
    expect(state.calls).toContainEqual(['create', { exchange: 'IEX', product: 'DAM', horizon_days: 7, model: 'AUTO', cutoff_date: null }]);
  });

  it('shows the API\'s reason when a forecast cannot be made', async () => {
    state.createError = { response: { data: { error: 'IEX DAM has a price for 1 of the 14 days up to 2026-09-14' } } };
    await render();
    await click(button('Make forecast'));
    expect(host.querySelector('.alert-error').textContent).toMatch(/1 of the 14 days/);
  });

  it('offers finance the figures but not the buttons', async () => {
    state.user = { role: 'FINANCE_USER' };
    await render();
    expect(button('Make forecast')).toBeUndefined();
    expect(button('Load price file')).toBeUndefined();
    expect(host.textContent).toMatch(/₹3\.13\/kWh/);
  });

  it('scores forecasts against actuals by distance and by model', async () => {
    await render();
    await click(button('Forecast vs actual'));
    expect(host.textContent).toMatch(/1 of 3/);
    expect(host.textContent).toMatch(/2 still waiting for a price/);
    expect(host.textContent).toMatch(/By distance ahead/);
    expect(host.textContent).toMatch(/Day 1/);
  });

  it('lists every file error and says nothing was saved', async () => {
    state.uploadError = { response: { data: { error: 'The file was not loaded — nothing was saved.', errors: ['Row 42: ₹4200/kWh is above the ₹10/kWh exchange ceiling'] } } };
    await render();
    await click(button('Load price file'));
    const file = new File(['x'], 'prices.csv', { type: 'text/csv' });
    const input = host.ownerDocument.querySelector('input[type="file"]');
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button('Load prices'));
    expect(state.calls.find((c) => c[0] === 'upload')[1]).toMatchObject({ exchange: 'IEX', product: 'DAM', file });
    const alert = host.ownerDocument.querySelector('.modal .alert-error');
    expect(alert.textContent).toMatch(/nothing was saved/);
    expect(alert.textContent).toMatch(/Row 42/);
  });

  it('says a series has no prices rather than offering an empty chart', async () => {
    state.series = { ...SERIES, series: SERIES.series.map((s) => ({ ...s, days: 0, sources: {} })) };
    state.runs = [];
    state.detail = null;
    state.accuracy = { ...ACCURACY, summary: { ...ACCURACY.summary, forecast_days: 0 }, days: [] };
    await render();
    expect(host.textContent).toMatch(/holds no IEX DAM prices/);
    expect(button('Make forecast').disabled).toBe(true);
  });
});
