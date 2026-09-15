import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';

// Market Rates & Analytics, the MIS market summary and the trading dashboard's
// live rates all read market_rates straight, and market_rates is mostly the demo
// seed. They read observed prices now — the CERC report, exchange price files,
// the IEX API — and a database holding only seed rows has nothing to show.

let trader;

const seedRow = (date, exchange = 'IEX', product = 'DAM', price = 9.99) => db.prepare(`
  INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, volume_mw, data_source)
  VALUES (?, ?, ?, ?, 'DAILY', ?, 5000, 'IEX_PORTAL')
`).run(newId('MRT'), exchange, product, date, price);

const cerc = (date, price, { exchange = 'IEX', product = 'DAM' } = {}) => db.prepare(`
  INSERT INTO cerc_market_data (id, report_period, data_category, product, exchange, metric_name, metric_value, metric_unit, day_of_month, source_table)
  VALUES (?, ?, 'PRICE', ?, ?, 'Daily Price', ?, 'Rs/kWh', ?, 'EXCEL')
`).run(newId('CMD'), date.slice(0, 7), product, exchange, price, Number(date.slice(8)));

/** A block-wise day: ₹2 overnight (blocks 1–48), ₹6 after, 1,000 MW throughout. */
const blockDay = (date, { exchange = 'IEX', product = 'DAM', low = 2, high = 6, source = 'EXCHANGE_FILE' } = {}) => {
  const insert = db.prepare(`
    INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, volume_mw, data_source)
    VALUES (?, ?, ?, ?, ?, ?, 1000, ?)
  `);
  for (let b = 1; b <= 96; b += 1) {
    const m = (b - 1) * 15;
    insert.run(newId('MKT'), exchange, product, date, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, b <= 48 ? low : high, source);
  }
};

beforeEach(() => {
  for (const t of ['market_rates', 'cerc_market_data', 'price_alerts', 'bid_blocks', 'bids']) db.prepare(`DELETE FROM ${t}`).run();
  trader = tokenFor('TRADING_USER');
});

const get = (path) => request(app).get(path).set(auth(trader));

describe('Market analytics reads observed prices only', () => {
  it('has nothing to say when the only rows are the demo seed\'s', async () => {
    seedRow('2026-09-10');
    seedRow('2026-09-11', 'PXIL');
    const summary = await get('/api/market-analytics/summary');
    expect(summary.body).toMatchObject({ window: null, overall: null });
    expect((await get('/api/market-analytics/rates')).body).toEqual([]);
    expect((await get('/api/market-analytics/latest-prices')).body.products.find((p) => p.product === 'DAM').mcp_rate).toBeNull();
    const realtime = await get('/api/dashboard/trading/realtime');
    expect(realtime.body.live_rates).toEqual({});
  });

  it('summarises CERC days and block-wise days together, taking the range from blocks where there are any', async () => {
    seedRow('2026-09-12', 'IEX', 'DAM', 9.99);
    cerc('2026-09-10', 3.5);
    cerc('2026-09-11', 4.5, { exchange: 'PXIL' });
    blockDay('2026-09-12'); // volume-weighted day price ₹4, range ₹2–₹6, 24,000 MWh

    const r = await get('/api/market-analytics/summary?start_date=2026-09-10&end_date=2026-09-12');
    expect(r.status).toBe(200);
    expect(r.body.overall).toMatchObject({ observations: 3, avg_rate: 4, min_rate: 2, max_rate: 6, total_energy_mwh: 24000, latest_date: '2026-09-12' });
    expect(r.body.sources).toEqual({ CERC_MMR: 2, EXCHANGE_FILE: 1 });
    expect(r.body.exchanges.map((e) => [e.exchange, e.avg_rate, e.latest_mcp])).toEqual([['IEX', 3.75, 4], ['PXIL', 4.5, 4.5]]);
    expect(r.body.best_exchange.exchange).toBe('PXIL');

    const trend = await get('/api/market-analytics/trend?start_date=2026-09-10&end_date=2026-09-12');
    expect(trend.body.points).toEqual([
      { date: '2026-09-10', energy_mwh: null, IEX: 3.5 },
      { date: '2026-09-11', energy_mwh: null, PXIL: 4.5 },
      { date: '2026-09-12', energy_mwh: 24000, IEX: 4 },
    ]);

    const rates = await get('/api/market-analytics/rates?start_date=2026-09-10&end_date=2026-09-12');
    expect(rates.body[0]).toMatchObject({ rate_date: '2026-09-12', mcp_rate: 4, min_rate: 2, max_rate: 6, data_source: 'EXCHANGE_FILE', source_label: 'Exchange price file' });
  });

  it('anchors the default window on the newest observed price, not the newest seed row', async () => {
    cerc('2026-02-28', 3.8);
    seedRow('2026-09-14');
    const r = await get('/api/market-analytics/summary');
    expect(r.body.window).toMatchObject({ end_date: '2026-02-28' });
  });

  it('gives a day\'s 96-block curve per product, and the days that have one', async () => {
    blockDay('2026-09-12');
    blockDay('2026-09-13', { product: 'GDAM', low: 1, high: 3 });
    seedRow('2026-09-14');
    const latest = await get('/api/market-analytics/blocks?exchange=IEX');
    expect(latest.body).toMatchObject({ exchange: 'IEX', date: '2026-09-13', available_dates: ['2026-09-13', '2026-09-12'] });
    expect(latest.body.products.GDAM.blocks).toHaveLength(96);
    expect(latest.body.products.GDAM).toMatchObject({ day_price: 2, source: 'EXCHANGE_FILE' });
    expect(latest.body.products.DAM.blocks).toEqual([]);

    const day = await get('/api/market-analytics/blocks?exchange=IEX&date=2026-09-12');
    expect(day.body.products.DAM.blocks[72]).toMatchObject({ block: 73, time_block: '18:00', mcp: 6, mcv: 1000 });
    expect((await get('/api/market-analytics/blocks?date=12-09-2026')).status).toBe(400);
  });

  it('fires alerts off the newest observed price', async () => {
    seedRow('2026-09-14', 'IEX', 'DAM', 9.99);
    cerc('2026-09-10', 5.2);
    const created = await request(app).post('/api/market-analytics/alerts').set(auth(trader)).send({ product: 'DAM', condition: 'ABOVE', threshold_price: 5 });
    expect(created.body).toMatchObject({ triggered: true, last_rate: 5.2, last_rate_date: '2026-09-10' });
  });

  it('gives the MIS pack observed figures and prices SJVN\'s execution against them', async () => {
    seedRow('2026-09-12', 'IEX', 'DAM', 9.99);
    blockDay('2026-09-12');
    const clientId = newId('TCL');
    db.prepare("INSERT INTO trading_clients (id, name, client_type, status) VALUES (?, 'MIS Client', 'DISCOM', 'ACTIVE')").run(clientId);
    const bidId = newId('BID');
    db.prepare(`INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, cleared_quantum_mw, status)
      VALUES (?, ?, 'IEX', 'DAM', '2026-09-11', '2026-09-12', 10, 4.5, 10, 'CLEARED')`).run(bidId, clientId);
    db.prepare(`INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price, status)
      VALUES (?, ?, '18:00-18:15', 10, 4.5, 10, 4.4, 'CLEARED')`).run(newId('BLK'), bidId);

    const r = await get('/api/reports/market-analytics?from=2026-09-12&to=2026-09-12');
    expect(r.status).toBe(200);
    expect(r.body.overall).toMatchObject({ observations: 1, avg_rate: 4 });
    expect(r.body.by_exchange).toEqual([expect.objectContaining({ exchange: 'IEX', avg_rate: 4, total_energy_mwh: 24000 })]);
    expect(r.body.daily).toEqual([expect.objectContaining({ rate_date: '2026-09-12', avg_rate: 4 })]);
    expect(r.body.execution).toEqual([expect.objectContaining({ delivery_date: '2026-09-12', market_mcp: 4, vs_market: 0.4 })]);
  });
});
