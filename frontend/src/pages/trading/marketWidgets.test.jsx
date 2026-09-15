import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// The market widgets read the CERC report and the observed prices, and name the
// figures the platform has no source for. Each used to carry its own typed-in
// copy — some impossible, some padded with "State2 … State20".

const MONTH = {
  period: '2026-02', periods: ['2026-02', '2026-01'],
  segments: [
    { exchange: 'IEX', product: 'DAM', min: 1.72, max: 10, weighted_avg: 3.56, volume_mu: 6570 },
    { exchange: 'IEX', product: 'GDAM', min: 1.8, max: 10, weighted_avg: 3.43, volume_mu: 756 },
    { exchange: 'IEX', product: 'HP-DAM', min: null, max: null, weighted_avg: null, volume_mu: 0 },
    { exchange: 'IEX', product: 'RTM', min: 1.3, max: 10, weighted_avg: 3.4, volume_mu: 4379 },
    { exchange: 'PXIL', product: 'DAM', min: null, max: null, weighted_avg: null, volume_mu: 0 },
  ],
  exchanges: [
    { exchange: 'IEX', total_mu: 11705, volumes: [{ product: 'DAM', volume_mu: 6570 }, { product: 'GDAM', volume_mu: 756 }, { product: 'HP-DAM', volume_mu: 0 }, { product: 'RTM', volume_mu: 4379 }] },
    { exchange: 'PXIL', total_mu: 0, volumes: [{ product: 'DAM', volume_mu: 0 }] },
    { exchange: 'HPX', total_mu: 0, volumes: [] },
  ],
  rec: [{ exchange: 'IEX', volume_mwh: 2391262, price_rs_mwh: 336.68 }, { exchange: 'PXIL', volume_mwh: null, price_rs_mwh: null }, { exchange: 'HPX', volume_mwh: null, price_rs_mwh: null }],
  short_term: { bilateral_mu: 7926, exchanges_mu: 11720, dsm_mu: 3689, total_mu: 23336 },
  not_in_report: ['Shares of the trading licensees'],
};

const state = vi.hoisted(() => ({ calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    cercMarket: {
      marketMonth: (period) => { state.calls.push(['month', period]); return Promise.resolve({ ...MONTH, period: period || MONTH.period }); },
      volumeHistory: () => Promise.resolve([
        { period: '2026-01', bilateral_mu: 8879, exchanges_mu: 11584, dsm_mu: 2879, total_mu: 23342 },
        { period: '2026-02', bilateral_mu: 7926, exchanges_mu: 11720, dsm_mu: 3689, total_mu: 23336 },
      ]),
    },
    marketAnalytics: {
      getRates: () => Promise.resolve([{ rate_date: '2026-02-28', mcp_rate: 3.9, min_rate: null, max_rate: null, energy_mwh: null }]),
      getBlocks: () => Promise.resolve({ exchange: 'IEX', date: null, available_dates: [], products: { DAM: { blocks: [] }, GDAM: { blocks: [] }, RTM: { blocks: [] } } }),
    },
    dashboard: { trading: { analytics: () => Promise.resolve({
      financial_year_from: '2026-04-01',
      energy: { delivered_mu: 12.5, delivered_mwh: 12500, fy_delivered_mu: 4 },
      rec: { sold: 32500, revenue_crore: 1.27, revenue_rupees: 12700000 },
    }) } },
  };
  return { api, default: api };
});
vi.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>;
  const Null = () => null;
  return {
    ResponsiveContainer: Stub, LineChart: Stub, BarChart: Stub, ComposedChart: Stub,
    Line: Null, Bar: Stub, Cell: Null, XAxis: Null, YAxis: Null, CartesianGrid: Null, Tooltip: Null, Legend: Null,
  };
});

const Collective = (await import('./CollectiveMarketAnalyticsWidget.jsx')).default;
const Macro = (await import('./MacroTradingIntelligenceWidget.jsx')).default;
const MMR = (await import('./MMRDashboard.jsx')).default;
const PowerMarket = (await import('./PowerMarketDashboard.jsx')).default;
const Main = (await import('./MainDashboard.jsx')).default;
const GTAM = (await import('./GTAMAnalyticsWidget.jsx')).default;
const TAM = (await import('./TAMAnalyticsWidget.jsx')).default;

let host, root;
beforeEach(() => {
  state.calls = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (el) => { await act(async () => { root.render(el); }); };

describe('Collective market', () => {
  it('lists the segments that traded, with the report\'s own range, and leaves out the ones that did not', async () => {
    await render(<Collective />);
    const rows = [...host.querySelectorAll('.report-table tbody tr')].map((r) => r.textContent);
    expect(rows.some((t) => t.includes('IEXRTM1.3010.003.40'))).toBe(true);
    expect(rows.some((t) => t.startsWith('PXILDAM'))).toBe(false);
    expect(host.textContent).toMatch(/2,391,262|23,91,262/);
    expect(host.textContent).not.toMatch(/Volume Type 1|11\.00/);
  });

  it('asks for the month chosen', async () => {
    await render(<Collective />);
    const select = host.querySelector('select');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(select, '2026-01');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.calls).toContainEqual(['month', '2026-01']);
  });
});

describe('Macro, MMR, Power Market and Main dashboards', () => {
  it('Macro shows the month\'s mix and names the licensee shares it does not hold', async () => {
    await render(<Macro />);
    expect(host.textContent).toMatch(/Bilateral7,926 MU/);
    expect(host.textContent).toMatch(/Share of the trading licensees/);
    expect(host.textContent).not.toMatch(/PTC India|Powerpulse/);
  });

  it('MMR reads the month from the report instead of spreading a year across it', async () => {
    await render(<MMR />);
    expect(host.textContent).toMatch(/Total short-term transactions and DSM: 23,336 MU/);
    expect(host.textContent).toMatch(/GDAM756/);
    expect(host.textContent).toMatch(/Month by month/);
  });

  it('Power Market draws observed days and the report month, and names what it cannot show', async () => {
    await render(<PowerMarket />);
    expect(host.textContent).toMatch(/1 day\(s\) held, 2026-02-28 to 2026-02-28/);
    expect(host.textContent).toMatch(/Purchase and sell bid volumes are not in the files/);
    expect(host.textContent).toMatch(/Share of electricity transacted by the trading licensees/);
    expect(host.textContent).toMatch(/holds no block-wise IEX prices/);
  });

  it('Main dashboard says it holds no generation mix, and charts the report months it has', async () => {
    await render(<Main />);
    expect(host.textContent).toMatch(/does not hold CEA generation data/);
    expect(host.textContent).not.toMatch(/Thermal 72/);
    expect(host.textContent).toMatch(/last six report months/);
  });
});

describe('GTAM and TAM', () => {
  it('names the data the platform does not hold instead of drawing placeholder states', async () => {
    await render(<><GTAM /><TAM /></>);
    expect(host.textContent).not.toMatch(/State2|State20/);
    expect(host.textContent).toMatch(/Top 10 bilateral participants/);
    expect(host.textContent).toMatch(/TAM volume and price by contract type/);
  });
});

describe('CEA reports dashboard', () => {
  it('says the platform holds no CEA data instead of drawing typed-in figures as CEA\'s', async () => {
    const { MemoryRouter } = await import('react-router-dom');
    const CEA = (await import('./CEAReportsDashboard.jsx')).default;
    await render(<MemoryRouter><CEA /></MemoryRouter>);
    expect(host.textContent).toMatch(/holds no CEA data/);
    expect(host.textContent).toMatch(/Installed capacity by category/);
    expect(host.textContent).not.toMatch(/243,?000|THERMAL|Jan-2024/);
  });
});
