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
  rec: [
    { exchange: 'IEX', volume_mwh: 2391262, price_rs_mwh: 336.68, buy_bid_mwh: 4206930, sell_bid_mwh: 4228834, buy_sell_ratio: 0.9948 },
    { exchange: 'PXIL', volume_mwh: null, price_rs_mwh: null, buy_bid_mwh: null, sell_bid_mwh: null, buy_sell_ratio: null },
    { exchange: 'HPX', volume_mwh: null, price_rs_mwh: null, buy_bid_mwh: null, sell_bid_mwh: null, buy_sell_ratio: null },
    { exchange: 'TRADERS', volume_mwh: 301332, price_rs_mwh: 338, buy_bid_mwh: null, sell_bid_mwh: null, buy_sell_ratio: null },
  ],
  short_term: { bilateral_mu: 7926, exchanges_mu: 11720, dsm_mu: 3689, total_mu: 23336 },
  licensees: { entity_count: 39, top5_share_percent: 81.2, hhi: 0.186, source_table: 'Table-2' },
};

// What the report's entity-wise tables list, by segment and side.
const PARTICIPANTS = {
  TRADING_LICENSEE: [{ rank: 1, entity_name: 'PTC India Ltd.', volume_mu: null, share_percent: 34.09 }, { rank: 2, entity_name: 'Powerpulse Trading Solutions Ltd.', volume_mu: null, share_percent: 19.09 }],
  BILATERAL: [{ rank: 1, entity_name: 'Karnataka', volume_mu: 812.4, share_percent: 10.2 }],
  DAM: [{ rank: 1, entity_name: 'Uttar Pradesh', volume_mu: 640.2, share_percent: 9.7 }],
  GDAM: [
    { rank: 1, entity_name: 'Karnataka', volume_mu: 213.49609, share_percent: 28.229 },
    { rank: 2, entity_name: 'ADANI RENEWABLE ENERGY FIFTY SEVEN LIMITED_PSS13', volume_mu: 44.765385, share_percent: 5.919 },
  ],
};


const state = vi.hoisted(() => ({ calls: [] }));
vi.mock('../../api/client.js', () => {
  const api = {
    cercMarket: {
      marketMonth: (period) => { state.calls.push(['month', period]); return Promise.resolve({ ...MONTH, period: period || MONTH.period }); },
      participants: ({ period, segment, side }) => {
        state.calls.push(['participants', period, segment, side]);
        const rows = PARTICIPANTS[segment] || [];
        return Promise.resolve({
          period, periods: MONTH.periods, segment, side, entities_in_table: rows.length, in_report: rows.length > 0,
          concentration: rows.length ? { entity_count: 39, total_volume_mu: 7926, top5_volume_mu: 3200, top5_share_percent: 81.2, hhi: 0.186, source_table: 'Table-2' } : null,
          participants: rows,
        });
      },
      termAhead: ({ period, market }) => {
        state.calls.push(['termAhead', period, market]);
        const iex = market === 'TAM'
          ? [{ contract_type: 'DAILY', contract_label: 'Daily Contracts', volume_mu: 215.35, price_rs_kwh: 5.49 }, { contract_type: 'WEEKLY', contract_label: 'Weekly Contracts', volume_mu: 0, price_rs_kwh: null }]
          : [];
        return Promise.resolve({
          period, periods: MONTH.periods, market, in_report: iex.length > 0,
          exchanges: [
            { exchange: 'IEX', contracts: iex, volume_mu: iex.length ? 215.35 : null, weighted_price_rs_kwh: iex.length ? 5.49 : null },
            { exchange: 'PXIL', contracts: [], volume_mu: null, weighted_price_rs_kwh: null },
            { exchange: 'HPX', contracts: [], volume_mu: null, weighted_price_rs_kwh: null },
          ],
        });
      },
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
  it('Macro shows the month\'s mix, the licensees\' shares and the REC bid book, all from the report', async () => {
    await render(<Macro />);
    expect(host.textContent).toMatch(/Bilateral7,926 MU/);
    expect(state.calls).toContainEqual(['participants', '2026-02', 'TRADING_LICENSEE', 'ALL']);
    expect(host.textContent).toMatch(/PTC India Ltd\./);
    expect(host.textContent).toMatch(/top five of 39 licensees transacted 81\.2%/);
    // The REC bid book: bid to buy against offered to sell, and the traders' sales beside it.
    expect(host.textContent).toMatch(/REC bids and trades/);
    expect(host.textContent).toMatch(/42,06,930|4,206,930/);
    expect(host.textContent).toMatch(/Through traders \(bilateral\)/);
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
    expect(host.textContent).toMatch(/Share of electricity transacted by the top 10 trading licensees/);
    expect(host.textContent).toMatch(/Powerpulse Trading Solutions Ltd\./);
    expect(host.textContent).not.toMatch(/not among the tables the platform reads/);
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
  it('reads the participants and the term-ahead contracts from the report, not placeholder states', async () => {
    await render(<><GTAM /><TAM /></>);
    expect(host.textContent).not.toMatch(/State2|State20/);
    expect(state.calls).toContainEqual(['participants', '2026-02', 'BILATERAL', 'SELL']);
    expect(state.calls).toContainEqual(['termAhead', '2026-02', 'GTAM']);
    expect(host.textContent).toMatch(/Top 10 bilateral sellers — Feb 2026/);
    expect(host.textContent).toMatch(/Karnataka/);
    expect(host.textContent).toMatch(/Term-ahead market \(TAM\) by contract type/);
    expect(host.textContent).toMatch(/215\.4/);
  });

  it('says so when a month\'s report has no table, instead of an empty chart', async () => {
    await render(<GTAM />);
    // The mock holds no GTAM contracts for the month.
    expect(host.textContent).toMatch(/The Feb 2026 CERC report has no GTAM tables/);
  });
});

describe('Top 10 GDAM participants', () => {
  it('lists the report\'s GDAM sellers and buyers for the month, with the full names in the table', async () => {
    const Top10 = (await import('./Top10GDAMParticipantsChart.jsx')).default;
    await render(<Top10 />);
    expect(state.calls).toContainEqual(['participants', '2026-02', 'GDAM', 'SELL']);
    expect(state.calls).toContainEqual(['participants', '2026-02', 'GDAM', 'BUY']);
    expect(host.textContent).toMatch(/Top 10 GDAM sellers — Feb 2026/);
    expect(host.textContent).toMatch(/Top 10 GDAM buyers — Feb 2026/);
    // A long entity name is shortened on the axis but whole in the table.
    expect(host.textContent).toMatch(/ADANI RENEWABLE ENERGY FIFTY SEVEN LIMITED_PSS13/);
    expect(host.textContent).toMatch(/HHI 0\.186 \(0 is many equal participants, 1 is a single one\)/);
    expect(host.textContent).not.toMatch(/Delhi/);
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
