import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';

// The CERC monthly report, one month at a time and month by month — what the
// market widgets read instead of their own hardcoded copies of it.

let trader;
const summary = (period, total) => db.prepare('INSERT INTO cerc_monthly_summary (id, report_period, total_short_term_volume_mu) VALUES (?, ?, ?)').run(newId('CMS'), period, total);
const metric = (period, category, product, exchange, name, value) => db.prepare(`
  INSERT INTO cerc_market_data (id, report_period, data_category, product, exchange, metric_name, metric_value, metric_unit)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'X')
`).run(newId('CMD'), period, category, product, exchange, name, value);

beforeEach(() => {
  db.prepare('DELETE FROM cerc_market_data').run();
  db.prepare('DELETE FROM cerc_monthly_summary').run();
  trader = tokenFor('TRADING_USER');
  for (const [period, bilateral, px, dsm] of [['2026-01', 8879, 11584, 2879], ['2026-02', 7926, 11720, 3689]]) {
    summary(period, bilateral + px + dsm);
    metric(period, 'VOLUME', 'BILATERAL', 'ALL', 'Volume', bilateral);
    metric(period, 'VOLUME', 'PX_TOTAL', 'ALL', 'Volume', px);
    metric(period, 'VOLUME', 'DSM', 'GRID', 'Volume', dsm);
  }
  metric('2026-02', 'VOLUME', 'DAM', 'IEX', 'Volume', 6570);
  metric('2026-02', 'VOLUME', 'GDAM', 'IEX', 'Volume', 756);
  metric('2026-02', 'PRICE', 'RTM', 'IEX', 'Minimum', 1.3);
  metric('2026-02', 'PRICE', 'RTM', 'IEX', 'Maximum', 10);
  metric('2026-02', 'PRICE', 'RTM', 'IEX', 'Weighted Average', 3.4);
  metric('2026-02', 'REC', 'REC', 'IEX', 'Traded Volume', 2391262);
  metric('2026-02', 'REC', 'REC', 'IEX', 'Weighted Avg Price', 336.68);
});

const get = (path) => request(app).get(`/api/cerc-market${path}`).set(auth(trader));

describe('CERC market month', () => {
  it('opens on the newest month and lists the others', async () => {
    const r = await get('/market-month');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ period: '2026-02', periods: ['2026-02', '2026-01'] });
    expect(r.body.short_term).toEqual({ bilateral_mu: 7926, exchanges_mu: 11720, dsm_mu: 3689, total_mu: 23335 });
  });

  it('gives every exchange and product its own price range and volume, and the REC that traded', async () => {
    const { body } = await get('/market-month?period=2026-02');
    expect(body.segments.find((s) => s.exchange === 'IEX' && s.product === 'RTM')).toEqual({
      exchange: 'IEX', product: 'RTM', min: 1.3, max: 10, weighted_avg: 3.4, volume_mu: null,
    });
    const iex = body.exchanges.find((e) => e.exchange === 'IEX');
    expect(iex.volumes.find((v) => v.product === 'GDAM').volume_mu).toBe(756);
    expect(iex.total_mu).toBe(7326);
    expect(body.rec.find((x) => x.exchange === 'IEX')).toEqual({ exchange: 'IEX', volume_mwh: 2391262, price_rs_mwh: 336.68 });
    expect(body.not_in_report).toContain('Shares of the trading licensees');
  });

  it('falls back to the newest month for a month the report does not have, and runs month by month', async () => {
    expect((await get('/market-month?period=1999-01')).body.period).toBe('2026-02');
    const history = await get('/volume-history');
    expect(history.body.map((h) => [h.period, h.bilateral_mu, h.exchanges_mu, h.dsm_mu])).toEqual([
      ['2026-01', 8879, 11584, 2879],
      ['2026-02', 7926, 11720, 3689],
    ]);
  });
});
