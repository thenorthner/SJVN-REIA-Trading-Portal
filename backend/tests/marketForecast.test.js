import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';
import {
  buildForecast, forecastWith, backtest, normaliseSeries, intradayShape, toDay, fromDay, dayOfWeek,
} from '../src/services/priceForecastModels.js';
import { refreshForecasts, parseExchangePriceFile, pullIexPrices, priceFileTemplate } from '../src/services/marketForecast.js';
import { periodBlocks, syncMarketRates, clearDecimalsCache } from '../src/services/iexService.js';

// Market price forecasting. The models are checked on series whose right answer
// is known; the API on the things a desk would be misled by if they went wrong —
// training on the demo seed, scoring a forecast against a price it had already
// seen, and a price file loaded half-way.

const START = '2026-01-01';
const addDays = (iso, n) => fromDay(toDay(iso) + n);

/** Sunday clears at 3.2, the rest of the week around 4, with a small wobble. */
const weekly = (iso) => {
  const d = toDay(iso);
  return (dayOfWeek(d) === 0 ? 3.2 : 4) + 0.05 * Math.sin(d / 3);
};

function makeSeries(days, { from = START, price = weekly, skip = () => false } = {}) {
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i);
    if (!skip(date)) out.push({ date, value: Math.round(price(date) * 10000) / 10000 });
  }
  return out;
}

function putCerc(series, { exchange = 'IEX', product = 'DAM' } = {}) {
  const insert = db.prepare(`
    INSERT INTO cerc_market_data (id, report_period, data_category, product, exchange, metric_name, metric_value, metric_unit, day_of_month, source_table)
    VALUES (?, ?, 'PRICE', ?, ?, 'Daily Price', ?, 'Rs/kWh', ?, 'EXCEL')
  `);
  db.transaction(() => {
    for (const p of series) insert.run(newId('CMD'), p.date.slice(0, 7), product, exchange, p.value, Number(p.date.slice(8)));
  })();
}

const blockRows = (date, { price = (b) => (b >= 72 && b <= 84 ? 8 : 4), exchange = 'IEX', product = 'DAM', source = 'EXCHANGE_FILE' } = {}) => {
  const insert = db.prepare(`
    INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, volume_mw, data_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let b = 1; b <= 96; b += 1) {
    const mins = (b - 1) * 15;
    const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    insert.run(newId('MKT'), exchange, product, date, label, price(b), 1000, source);
  }
};

let trader;
beforeEach(() => {
  for (const t of ['price_forecasts', 'price_forecast_runs', 'market_rates', 'cerc_market_data']) db.prepare(`DELETE FROM ${t}`).run();
  trader = tokenFor('TRADING_USER');
});

const get = (path, token = trader) => request(app).get(`/api/market-forecast${path}`).set(auth(token));
const post = (path, body, token = trader) => request(app).post(`/api/market-forecast${path}`).set(auth(token)).send(body);

describe('Forecast models', () => {
  it('puts the weekday back: Sunday forecast low, Monday forecast normal', () => {
    const obs = normaliseSeries(makeSeries(140));
    const fc = forecastWith('WEEKDAY_PROFILE', obs, 7);
    const sunday = fc.find((p) => dayOfWeek(p.day) === 0);
    const monday = fc.find((p) => dayOfWeek(p.day) === 1);
    expect(sunday.value).toBeCloseTo(3.2, 1);
    expect(monday.value).toBeCloseTo(4, 1);
  });

  it('lines weekdays up by calendar, not by position, across a month-long gap', () => {
    // February is missing, as a CERC month sometimes is.
    const obs = normaliseSeries(makeSeries(120, { skip: (d) => d.startsWith('2026-02') }));
    const last = obs[obs.length - 1].day;
    const fc = forecastWith('SEASONAL_NAIVE', obs, 7);
    for (const p of fc) expect(dayOfWeek(p.day)).toBe(dayOfWeek(p.day - 7));
    const sunday = fc.find((p) => dayOfWeek(p.day) === 0);
    expect(sunday.value).toBeCloseTo(weekly(fromDay(last - ((last - sunday.day) % 7 + 7) % 7)), 4);
  });

  it('never forecasts above the exchange ceiling', () => {
    const obs = normaliseSeries(makeSeries(120, { price: (d) => 6 + (toDay(d) - toDay(START)) * 0.05 }));
    for (const model of ['WEEKDAY_PROFILE', 'HOLT_WINTERS', 'MOVING_AVERAGE']) {
      const fc = forecastWith(model, obs, 30, { cap: 10 });
      expect(Math.max(...fc.map((p) => p.value))).toBeLessThanOrEqual(10);
    }
  });

  it('backtests only on what was known at each cutoff', () => {
    // A price that only ever rises: a model that cannot see ahead is always low.
    const obs = normaliseSeries(makeSeries(150, { price: (d) => 2 + (toDay(d) - toDay(START)) * 0.01 }));
    const bt = backtest('MOVING_AVERAGE', obs, { horizon: 3 });
    expect(bt.origins).toBeGreaterThan(3);
    expect(bt.errors.every((e) => e.forecast < e.actual)).toBe(true);
    expect(bt.bias).toBeLessThan(0);
  });

  it('AUTO publishes a seasonal model on a weekly series, with a band around it', () => {
    const r = buildForecast(makeSeries(200), { horizon: 7, cap: 10 });
    expect(r.ok).toBe(true);
    expect(r.selection).toBe('BEST_BACKTEST');
    expect(['MOVING_AVERAGE']).not.toContain(r.model);
    expect(r.backtest.map((b) => b.model)).toEqual(expect.arrayContaining(['WEEKDAY_PROFILE', 'HOLT_WINTERS', 'SEASONAL_NAIVE', 'MOVING_AVERAGE', 'ENSEMBLE']));
    for (const p of r.points) {
      expect(p.lower).toBeLessThanOrEqual(p.forecast);
      expect(p.upper).toBeGreaterThanOrEqual(p.forecast);
    }
    expect(r.points[0].date).toBe(addDays(r.cutoff_date, 1));
  });

  it('with too little history to test, falls back — and draws no band from nothing', () => {
    const r = buildForecast(makeSeries(20), { horizon: 3 });
    expect(r.ok).toBe(true);
    expect(r.selection).toBe('FALLBACK');
    expect(r.points[0].lower).toBeNull();
    expect(buildForecast(makeSeries(2), { horizon: 3 })).toMatchObject({ ok: false });
  });

  it('shapes the day from loaded blocks, weekdays apart from weekends', () => {
    const days = [];
    for (let i = 0; i < 14; i += 1) {
      const date = addDays('2026-08-01', i);
      const weekend = [0, 6].includes(dayOfWeek(toDay(date)));
      days.push({ date, blocks: Array.from({ length: 96 }, (_, k) => ({ block: k + 1, price: k + 1 === 80 && !weekend ? 8 : 4, volume: 1 })) });
    }
    const shape = intradayShape(days);
    const weekday = shape.forDate('2026-08-17').shape; // a Monday
    const weekend = shape.forDate('2026-08-16').shape; // a Sunday
    expect(weekday[79] / weekday[0]).toBeCloseTo(2, 4);
    expect(weekend[79] / weekend[0]).toBeCloseTo(1, 4);
  });
});

describe('Market forecast API', () => {
  it('is the desk\'s: a trading client and REIA are refused, finance may read but not run', async () => {
    expect((await get('/series', tokenFor('TRADING_CLIENT'))).status).toBe(403);
    expect((await get('/series', tokenFor('REIA_USER'))).status).toBe(403);
    const finance = tokenFor('FINANCE_USER');
    expect((await get('/series', finance)).status).toBe(200);
    expect((await post('/runs', { exchange: 'IEX', product: 'DAM' }, finance)).status).toBe(403);
  });

  it('counts only prices the platform observed, never the demo seed', async () => {
    db.prepare(`
      INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, forecast_rate, data_source)
      VALUES ('MRT-IEX-DAM-2026-03-01', 'IEX', 'DAM', '2026-03-01', 'DAILY', 4.1, 4.0, 'IEX_PORTAL')
    `).run();
    let dam = (await get('/series')).body.series.find((s) => s.exchange === 'IEX' && s.product === 'DAM');
    expect(dam.days).toBe(0);

    putCerc(makeSeries(30));
    dam = (await get('/series')).body.series.find((s) => s.exchange === 'IEX' && s.product === 'DAM');
    expect(dam).toMatchObject({ days: 30, first_date: START, last_date: addDays(START, 29), sources: { CERC_MMR: 30 } });
  });

  it('makes, keeps and audits a run from CERC daily prices', async () => {
    putCerc(makeSeries(150));
    const r = await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 10 });
    expect(r.status).toBe(201);
    const { run, points } = r.body;
    expect(run).toMatchObject({ exchange: 'IEX', product: 'DAM', requested_model: 'AUTO', horizon_days: 10, cutoff_date: addDays(START, 149) });
    expect(points).toHaveLength(10);
    expect(points[0]).toMatchObject({ date: addDays(START, 150), horizon: 1, actual: null });
    expect(run.backtest_mape).toBeGreaterThan(0);
    expect(run.sources).toEqual({ CERC_MMR: 150 });

    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'CREATE_PRICE_FORECAST' AND entity_id = ?").get(run.id);
    expect(audit).toBeTruthy();
    expect((await get(`/runs/${run.id}`)).body.points).toHaveLength(10);
    expect((await get('/runs')).body.runs.map((x) => x.id)).toContain(run.id);
  });

  it('stands at an earlier cutoff, sees nothing after it, and is scored against what cleared', async () => {
    putCerc(makeSeries(150));
    const cutoff = addDays(START, 119);
    const r = await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 14, cutoff_date: cutoff });
    expect(r.status).toBe(201);
    expect(r.body.run.cutoff_date).toBe(cutoff);
    expect(r.body.run.sources).toEqual({ CERC_MMR: 120 });
    expect(r.body.realised).toMatchObject({ scored_days: 14, awaiting_days: 0 });
    expect(r.body.realised.mape).toBeLessThan(10);
    const p = r.body.points[0];
    expect(p.actual).toBeCloseTo(weekly(addDays(cutoff, 1)), 3);
    expect(p.abs_pct_error).not.toBeNull();
  });

  it('refuses what it cannot do, and says why', async () => {
    expect((await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 0 })).status).toBe(400);
    expect((await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 40 })).status).toBe(400);
    expect((await post('/runs', { exchange: 'IEX', product: 'DAM', model: 'CRYSTAL_BALL' })).status).toBe(400);
    expect((await post('/runs', { exchange: 'NYSE', product: 'DAM' })).status).toBe(400);

    const empty = await post('/runs', { exchange: 'IEX', product: 'RTM' });
    expect(empty.status).toBe(422);
    expect(empty.body.error).toMatch(/no IEX RTM prices/);

    // Two years ago, then one day last week: that is one recent day, not enough.
    putCerc(makeSeries(200));
    putCerc([{ date: '2026-09-10', value: 4 }]);
    const stale = await post('/runs', { exchange: 'IEX', product: 'DAM' });
    expect(stale.status).toBe(422);
    expect(stale.body.error).toMatch(/1 of the 14 days up to 2026-09-10/);
  });

  it('compares each day with the forecast made from the newest data, and every forecast by distance', async () => {
    putCerc(makeSeries(150));
    const older = await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 7, cutoff_date: addDays(START, 119), model: 'MOVING_AVERAGE' });
    const newer = await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 7, cutoff_date: addDays(START, 122), model: 'WEEKDAY_PROFILE' });
    const r = await get('/accuracy?exchange=IEX&product=DAM');
    expect(r.status).toBe(200);
    const overlap = r.body.days.find((d) => d.date === addDays(START, 124));
    expect(overlap.run_id).toBe(newer.body.run.id);
    expect(r.body.days.find((d) => d.date === addDays(START, 121)).run_id).toBe(older.body.run.id);
    expect(r.body.summary).toMatchObject({ forecast_days: 10, scored_days: 10 });
    const models = r.body.by_model.map((m) => m.key).sort();
    expect(models).toEqual(['MOVING_AVERAGE', 'WEEKDAY_PROFILE']);
    expect(r.body.by_horizon.reduce((a, b) => a + b.forecasts, 0)).toBe(14);
    expect(r.body.by_horizon[0].key).toBe('Day 1');
  });

  it('lays the day over its blocks for the first week only', async () => {
    const series = makeSeries(150);
    putCerc(series);
    const cutoff = series[series.length - 1].date;
    for (let i = 0; i < 10; i += 1) blockRows(addDays(cutoff, -i));
    // CERC outranks the file for a day both have, so these days keep their CERC price.
    const r = await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 10 });
    expect(r.status).toBe(201);
    expect(r.body.run.block_shape_days).toBe(10);
    expect(r.body.blocks.dates).toHaveLength(7);
    expect(r.body.blocks.rows).toHaveLength(96);
    const [first] = r.body.points;
    const b80 = r.body.blocks.rows.find((b) => b.time_block === '19:45');
    const b1 = r.body.blocks.rows.find((b) => b.time_block === '00:00');
    expect(b80.forecast / b1.forecast).toBeCloseTo(2, 2);
    // The day's volume-weighted average of the blocks is the day's forecast.
    const avg = r.body.blocks.rows.reduce((a, b) => a + b.forecast, 0) / 96;
    expect(avg).toBeCloseTo(first.forecast, 2);
  });

  it('feeds Market Rates & Analytics from runs, not the seed\'s invented forecast column', async () => {
    const series = makeSeries(150);
    putCerc(series);
    // A seeded row carrying a forecast nobody made.
    db.prepare(`
      INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, forecast_rate, data_source)
      VALUES ('MRT-IEX-DAM-X', 'IEX', 'DAM', ?, 'DAILY', 4, 1, 'IEX_PORTAL')
    `).run(series[series.length - 1].date);
    const window = `start_date=${addDays(START, 120)}&end_date=${addDays(START, 149)}&exchange=IEX&product=DAM`;
    let summary = await request(app).get(`/api/market-analytics/summary?${window}`).set(auth(trader));
    expect(summary.body.forecast.observations).toBe(0);

    await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 7, cutoff_date: addDays(START, 129) });
    summary = await request(app).get(`/api/market-analytics/summary?${window}`).set(auth(trader));
    expect(summary.body.forecast.observations).toBe(7);
    expect(summary.body.forecast.mape_percent).toBeLessThan(10);
  });

  it('refreshes each series once per new price, and not again until another arrives', async () => {
    putCerc(makeSeries(120));
    expect(refreshForecasts().created).toBe(1);
    expect(refreshForecasts().created).toBe(0);
    putCerc([{ date: addDays(START, 120), value: 4 }]);
    const again = refreshForecasts();
    expect(again.created).toBe(1);
    const run = db.prepare('SELECT * FROM price_forecast_runs WHERE id = ?').get(again.run_ids[0]);
    expect(run).toMatchObject({ trigger_type: 'SCHEDULED', cutoff_date: addDays(START, 120), horizon_days: 7 });
  });
});

describe('Exchange price files', () => {
  const xlsx = (rows) => XLSX.write({ SheetNames: ['S'], Sheets: { S: XLSX.utils.aoa_to_sheet(rows) } }, { type: 'buffer', bookType: 'xlsx' });
  const upload = (buffer, fields, name = 'prices.xlsx', token = trader) => {
    let req = request(app).post('/api/market-forecast/actuals/upload').set(auth(token)).attach('file', buffer, name);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  };

  // The shape of the IEX download in docs/: block numbers under "Months", Rs/MWh, no date.
  const ieXDownload = () => xlsx([
    ['Months', 'MCV (MWh)', 'MCP (Rs./MWh)'],
    ...Array.from({ length: 96 }, (_, i) => [i + 1, 5000, i + 1 >= 73 && i + 1 <= 84 ? 10000 : 3000]),
  ]);

  it('reads the IEX download: finds the block column, converts Rs/MWh, and asks for the date it lacks', async () => {
    const noDate = await upload(ieXDownload(), { exchange: 'IEX', product: 'DAM' });
    expect(noDate.status).toBe(422);
    expect(noDate.body.errors[0]).toMatch(/no date column/);

    const r = await upload(ieXDownload(), { exchange: 'IEX', product: 'DAM', date: '2026-09-14' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ rows: 96, price_unit: 'Rs/MWh', price_unit_inferred: false });
    expect(r.body.days).toEqual([expect.objectContaining({ date: '2026-09-14', blocks: 96, complete: true })]);
    const peak = db.prepare("SELECT mcp_rate FROM market_rates WHERE rate_date = '2026-09-14' AND time_block = '18:00'").get();
    expect(peak.mcp_rate).toBe(10);
    expect(db.prepare("SELECT * FROM audit_logs WHERE action = 'UPLOAD_MARKET_PRICES'").get()).toBeTruthy();

    const series = (await get('/series')).body.series.find((s) => s.exchange === 'IEX' && s.product === 'DAM');
    expect(series).toMatchObject({ days: 1, block_days: 1, sources: { EXCHANGE_FILE: 1 } });
  });

  it('replaces whatever was held for the date, including the demo seed', async () => {
    db.prepare(`
      INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, data_source)
      VALUES ('MRT-IEX-DAM-2026-09-14', 'IEX', 'DAM', '2026-09-14', 'DAILY', 7.7, 'IEX_PORTAL')
    `).run();
    const r = await upload(ieXDownload(), { exchange: 'IEX', product: 'DAM', date: '2026-09-14' });
    expect(r.body.replaced_rows).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM market_rates WHERE data_source = 'IEX_PORTAL'").get().c).toBe(0);
  });

  it('loads nothing when one row is wrong', async () => {
    // Rs/kWh header, but one price typed in Rs/MWh: above the ₹10 ceiling.
    const rows = [['Date', 'Time Block', 'MCP (Rs/kWh)'], ...Array.from({ length: 96 }, (_, i) => ['14-09-2026', i + 1, i === 40 ? 4200 : 4.2])];
    const r = await upload(xlsx(rows), { exchange: 'IEX', product: 'DAM' });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/nothing was saved/);
    expect(r.body.errors.join(' ')).toMatch(/Row 42: .*above the ₹10\/kWh exchange ceiling/);
    expect(db.prepare('SELECT COUNT(*) c FROM market_rates').get().c).toBe(0);
  });

  it('reads a day-first CSV with the date on each day\'s first row and times as blocks', () => {
    const lines = ['Market Snapshot', 'Date,Hour,Time Block,Purchase Bid (MW),MCV (MW),MCP (Rs/MWh)'];
    for (const date of ['01-09-2026', '02-09-2026']) {
      for (let b = 1; b <= 96; b += 1) {
        const mins = (b - 1) * 15;
        const t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        lines.push(`${b === 1 ? date : ''},${Math.ceil(b / 4)},${t(mins)} - ${t((mins + 15) % 1440)},9000,"4,500",${date === '01-09-2026' ? 3000 : 3500}`);
      }
    }
    const parsed = parseExchangePriceFile(Buffer.from(lines.join('\n')), { cap: 10, today: '2026-09-15' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(parsed.days[0].blocks).toHaveLength(96);
    expect(parsed.days[0].blocks[95]).toMatchObject({ block: 96, price: 3, volume: 4500 });
    expect(parsed.days[1].blocks[0].price).toBe(3.5);
  });

  it('refuses a price for a day that cannot have cleared, and a block given twice', () => {
    const rows = [['Date', 'Block', 'MCP'], ['20-09-2026', 1, 4], ['14-09-2026', 1, 4], ['14-09-2026', 1, 4.1]];
    const parsed = parseExchangePriceFile(xlsx(rows), { cap: 10, today: '2026-09-15' });
    expect(parsed.errors.join(' ')).toMatch(/2026-09-20 is after 2026-09-16/);
    expect(parsed.errors.join(' ')).toMatch(/block 1 appears twice/);
  });

  it('is for the desk to load, not finance', async () => {
    const r = await upload(ieXDownload(), { exchange: 'IEX', product: 'DAM', date: '2026-09-14' }, 'p.xlsx', tokenFor('FINANCE_USER'));
    expect(r.status).toBe(403);
  });
});

describe('IEX API prices into forecasting', () => {
  const IEX_ENV = ['IEX_ENABLED', 'IEX_BASE_URL', 'IEX_LOGIN_USER_ID', 'IEX_PARTICIPANT_ID', 'IEX_BID_AREA_ID', 'IEX_PORTFOLIO_ID', 'IEX_API_TOKEN'];
  const realFetch = global.fetch;
  let asked;

  // A full day of IEX DAM: 96 periods, the evening dearer, volume heavier at night.
  const pqDay = () => ({
    LastUpdatedTime: 1789000000,
    PQDetails: Array.from({ length: 96 }, (_, i) => {
      const t = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return {
        FromPeriodId: t(i * 15), ToPeriodId: t((i + 1) * 15),
        BidAreaDetails: [{ BidArea: 'A1', Price: i >= 72 && i < 84 ? 800000 : 300000, BuyQty: 500000, SellQty: i < 24 ? 600000 : 300000 }],
      };
    }),
  });

  const goLive = () => {
    Object.assign(process.env, {
      IEX_ENABLED: 'true', IEX_BASE_URL: 'https://iex.example/', IEX_LOGIN_USER_ID: 'SJVA1',
      IEX_PARTICIPANT_ID: 'N2DL0SJV0000', IEX_BID_AREA_ID: 'A1', IEX_PORTFOLIO_ID: 'ALL', IEX_API_TOKEN: 'test-token',
    });
    asked = [];
    global.fetch = vi.fn(async (url) => {
      asked.push(String(url));
      const body = String(url).includes('/master/assets')
        ? { AssetDetails: [{ AssetId: 'A1', OrderQtyDecimal: 100, OrderPriceDecimal: 100, TradeQtyDecimal: 100, TradePriceDecimal: 100 }] }
        : String(url).includes('/deliverydates/') ? { DeliveryDates: [] }
          : String(url).includes('/pqresults/') ? pqDay() : null;
      return body ? { ok: true, status: 200, text: async () => JSON.stringify(body) } : { ok: false, status: 404, text: async () => 'no stub' };
    });
  };

  beforeEach(() => clearDecimalsCache());
  afterEach(() => {
    IEX_ENV.forEach((k) => delete process.env[k]);
    global.fetch = realFetch;
  });

  it('turns a PQ period into the blocks it covers', () => {
    expect(periodBlocks('00:00', '00:15')).toEqual([1]);
    expect(periodBlocks('23:45', '00:00')).toEqual([96]);
    expect(periodBlocks('18:00', '18:30')).toEqual([73, 74]);
    expect(periodBlocks('18:07', '18:15')).toEqual([]);
    expect(periodBlocks('1', '2')).toEqual([]);
  });

  it('keeps the day block by block, and reads it as a volume-weighted day from the API', async () => {
    goLive();
    const r = await syncMarketRates('DAM', '2026-09-14');
    expect(r).toMatchObject({ ok: true, rows_written: 96 });
    const rows = db.prepare("SELECT * FROM market_rates WHERE rate_date = '2026-09-14' ORDER BY time_block").all();
    expect(rows).toHaveLength(96);
    expect(rows.every((x) => x.exchange === 'IEX' && x.data_source === 'IEX_API')).toBe(true);
    expect(rows.find((x) => x.time_block === '18:00').mcp_rate).toBe(8);

    const series = (await get('/series')).body.series.find((s) => s.exchange === 'IEX' && s.product === 'DAM');
    expect(series).toMatchObject({ days: 1, block_days: 1, sources: { IEX_API: 1 } });
    const { actuals } = (await get('/actuals?exchange=IEX&product=DAM')).body;
    // 24 night blocks at 6000 MW and 3 Rs, 60 more at 3000 MW and 3 Rs, 12 at 3000 MW and 8 Rs.
    const expected = (24 * 6000 * 3 + 60 * 3000 * 3 + 12 * 3000 * 8) / (24 * 6000 + 72 * 3000);
    expect(actuals[0].price).toBeCloseTo(expected, 3);
  });

  it('files IEX\'s feed under IEX only', async () => {
    const r = await request(app).post('/api/bids/iex/market-rates/sync').set(auth(trader)).send({ date: '2026-09-14', product: 'DAM', exchange: 'PXIL' });
    expect(r.status).toBe(400);
  });

  it('pulls nothing in stub mode, and only the days not already held when live', async () => {
    expect(await pullIexPrices()).toEqual({ mode: 'STUB', pulled: [] });

    goLive();
    blockRows('2026-09-15', { product: 'DAM', source: 'EXCHANGE_FILE' });
    const r = await pullIexPrices({ now: new Date('2026-09-15T09:00:00Z') });
    expect(r.mode).toBe('LIVE');
    expect(r.pulled.map((p) => `${p.product} ${p.date}`)).toEqual([
      'DAM 2026-09-16', 'GDAM 2026-09-16', 'GDAM 2026-09-15', 'RTM 2026-09-14', 'RTM 2026-09-15',
    ]);
    expect(r.pulled.every((p) => p.rows === 96 && !p.error)).toBe(true);
    // The file the desk loaded for today's DAM was left alone.
    expect(db.prepare("SELECT DISTINCT data_source FROM market_rates WHERE product = 'DAM' AND rate_date = '2026-09-15'").all()).toEqual([{ data_source: 'EXCHANGE_FILE' }]);
  });
});

describe('Forecasts for the bidding desk', () => {
  it('gives a delivery date the forecast made from the newest prices, with its blocks', async () => {
    const series = makeSeries(150);
    putCerc(series);
    const cutoff = series[series.length - 1].date;
    for (let i = 0; i < 10; i += 1) blockRows(addDays(cutoff, -i));
    const target = addDays(cutoff, 2);
    await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 7, cutoff_date: addDays(cutoff, -3), model: 'MOVING_AVERAGE' });
    const newer = await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 7 });

    const r = await get(`/for-date?exchange=IEX&product=DAM&date=${target}`);
    expect(r.status).toBe(200);
    expect(r.body.run.id).toBe(newer.body.run.id);
    expect(r.body.forecast).toMatchObject({ horizon: 2 });
    expect(r.body.forecast.forecast).toBe(newer.body.points[1].forecast);
    expect(r.body.blocks).toHaveLength(96);
    expect(r.body.blocks[72]).toMatchObject({ block: 73, time_block: '18:00' });
    expect(r.body.price_cap).toBe(10);
    expect(r.body.run.backtest).toBeUndefined();
  });

  it('says how far the newest forecast reaches when a date has none', async () => {
    putCerc(makeSeries(150));
    await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 3 });
    const r = await get(`/for-date?exchange=IEX&product=DAM&date=${addDays(START, 170)}`);
    expect(r.body).toMatchObject({ forecast: null, latest_forecast_date: addDays(START, 152) });
    expect((await get('/for-date?exchange=IEX&product=DAM&date=tomorrow')).status).toBe(400);
  });

  it('exports a run as a workbook that says what it is, and records the export', async () => {
    const series = makeSeries(150);
    putCerc(series);
    const cutoff = series[series.length - 1].date;
    for (let i = 0; i < 10; i += 1) blockRows(addDays(cutoff, -i));
    const { run, points } = (await post('/runs', { exchange: 'IEX', product: 'DAM', horizon_days: 9 })).body;

    const r = await request(app).get(`/api/market-forecast/runs/${run.id}/export`).set(auth(trader))
      .buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/SJVN_Price_Forecast_IEX_DAM_/);
    const wb = XLSX.read(r.body, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Daily', 'Blocks', 'About this run']);
    const daily = XLSX.utils.sheet_to_json(wb.Sheets.Daily, { header: 1 });
    expect(daily).toHaveLength(10);
    expect(daily[1].slice(0, 6)).toEqual([points[0].date, expect.any(String), 1, points[0].forecast, points[0].lower, points[0].upper]);
    const blocks = XLSX.utils.sheet_to_json(wb.Sheets.Blocks, { header: 1 });
    expect(blocks).toHaveLength(1 + 7 * 96);
    expect(blocks[96]).toEqual([addDays(cutoff, 1), 96, '23:45', '00:00', expect.any(Number), expect.any(Number)]);
    expect(blocks[96][5]).toBeCloseTo(blocks[96][4] * 1000, 1);
    const about = Object.fromEntries(XLSX.utils.sheet_to_json(wb.Sheets['About this run'], { header: 1 }).filter((x) => x.length === 2));
    expect(about['Prices up to']).toBe(cutoff);
    expect(db.prepare("SELECT * FROM audit_logs WHERE action = 'DATA_EXPORT' AND entity_id = ?").get(run.id)).toBeTruthy();
    expect((await request(app).get('/api/market-forecast/runs/PFR-nope/export').set(auth(trader))).status).toBe(404);
  });

  it('hands out a price file template the reader takes back once it is filled in', async () => {
    const r = await get('/actuals/template');
    expect(r.status).toBe(200);
    expect(r.text).toBe(priceFileTemplate());
    const filled = r.text.trim().split('\n').map((line, i) => {
      if (i === 0) return line;
      const [date, block] = line.split(',');
      return `${date === 'DD-MM-YYYY' ? '14-09-2026' : date},${block},5000,${3000 + i}`;
    }).join('\n');
    const parsed = parseExchangePriceFile(Buffer.from(filled), { cap: 10, today: '2026-09-15' });
    expect(parsed.errors).toEqual([]);
    expect(parsed.days[0].blocks).toHaveLength(96);
    expect(parsed.days[0].blocks[95]).toMatchObject({ block: 96, price: 3.096 });
  });

  it('reads a block-wise day as a day for the latest price', async () => {
    blockRows('2026-09-14', { price: (b) => (b <= 48 ? 2 : 6) });
    const r = await request(app).get('/api/market-analytics/latest-prices').set(auth(trader));
    const dam = r.body.products.find((p) => p.product === 'DAM');
    expect(dam).toMatchObject({ date: '2026-09-14', exchange: 'IEX', mcp_rate: 4, volume_mw: 1000 });
  });
});
