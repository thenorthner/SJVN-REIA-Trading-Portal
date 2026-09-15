// Observed exchange prices, read the one way the platform reads them.
//
// Market Rates & Analytics, the MIS pack and the trading dashboard all queried
// market_rates directly — and market_rates is mostly the demo seed: three
// exchanges × three products × ninety days of prices from a sine wave, with
// "events" to explain the bumps. Every figure those screens printed was that.
//
// This reads the same actuals the forecasting and DSM code do (the CERC monthly
// report, exchange price files, the IEX API — loadDailyActuals decides which wins
// on a day) and adds what only block-wise days can say: the day's range and the
// energy that cleared.

import {
  FORECAST_EXCHANGES, FORECAST_PRODUCTS, SOURCE_LABELS, loadDailyActuals, loadBlockDays,
} from './marketForecast.js';
import { dailyPrice, blockLabel } from './priceForecastModels.js';

export const MARKET_EXCHANGES = FORECAST_EXCHANGES;
export const MARKET_PRODUCTS = FORECAST_PRODUCTS;
export { SOURCE_LABELS };

const BLOCK_HOURS = 0.25;
const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const round4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

const scopeOf = ({ exchange = null, product = null } = {}) => ({
  exchanges: exchange ? MARKET_EXCHANGES.filter((e) => e === exchange) : MARKET_EXCHANGES,
  products: product ? MARKET_PRODUCTS.filter((p) => p === product) : MARKET_PRODUCTS,
});

/**
 * One row per exchange, product and delivery date with an observed price:
 * { date, exchange, product, price, min, max, energy_mwh, blocks, source }.
 * min, max and energy come from block-wise days only; a CERC day has a price and
 * nothing else, and says so with nulls.
 */
export function observedDays({ from = null, to = null, exchange = null, product = null } = {}) {
  const rows = [];
  const { exchanges, products } = scopeOf({ exchange, product });
  for (const ex of exchanges) {
    for (const pr of products) {
      const blocksByDate = new Map(loadBlockDays(ex, pr, { from, to }).map((d) => [d.date, d.blocks]));
      for (const a of loadDailyActuals(ex, pr, { from, to })) {
        const blocks = blocksByDate.get(a.date) || [];
        const prices = blocks.map((b) => b.price).filter(Number.isFinite);
        const mw = blocks.map((b) => (b.volume > 0 ? b.volume : 0));
        rows.push({
          date: a.date,
          exchange: ex,
          product: pr,
          price: a.price,
          min: prices.length ? round4(Math.min(...prices)) : null,
          max: prices.length ? round4(Math.max(...prices)) : null,
          energy_mwh: mw.some((v) => v > 0) ? round2(mw.reduce((s, v) => s + v * BLOCK_HOURS, 0)) : null,
          blocks: blocks.length,
          source: a.source,
        });
      }
    }
  }
  return rows.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** The newest delivery date any series in scope has an observed price for. */
export function latestObservedDate(scope = {}) {
  const { exchanges, products } = scopeOf(scope);
  let latest = null;
  for (const ex of exchanges) {
    for (const pr of products) {
      const days = loadDailyActuals(ex, pr);
      const last = days[days.length - 1]?.date;
      if (last && (!latest || last > latest)) latest = last;
    }
  }
  return latest;
}

/**
 * Figures across a set of observed days. The average is of daily prices — a
 * day counts once whatever its source; the range uses a day's block extremes
 * where it has them and its daily price where it does not.
 */
export function summariseDays(rows) {
  if (!rows.length) {
    return { observations: 0, avg_rate: null, min_rate: null, max_rate: null, total_energy_mwh: null, latest_date: null };
  }
  const lows = rows.map((r) => (r.min != null ? r.min : r.price));
  const highs = rows.map((r) => (r.max != null ? r.max : r.price));
  const energy = rows.filter((r) => r.energy_mwh != null);
  return {
    observations: rows.length,
    avg_rate: round2(rows.reduce((s, r) => s + r.price, 0) / rows.length),
    min_rate: round2(Math.min(...lows)),
    max_rate: round2(Math.max(...highs)),
    total_energy_mwh: energy.length ? Math.round(energy.reduce((s, r) => s + r.energy_mwh, 0)) : null,
    latest_date: rows[rows.length - 1].date,
  };
}

/** Group observed days by a key and summarise each group, keys in the given order. */
export function summariseBy(rows, key, order) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r);
  }
  return order.filter((k) => groups.has(k)).map((k) => ({ [key]: k, ...summariseDays(groups.get(k)) }));
}

/**
 * The 96-block curve for one exchange and delivery date, per product, from
 * block-wise prices only. Also lists the dates that have any, so a screen can
 * offer days that exist instead of an empty chart for one that does not.
 */
export function blockCurves({ date = null, exchange = 'IEX' } = {}) {
  const ex = MARKET_EXCHANGES.includes(exchange) ? exchange : 'IEX';
  const dates = new Set();
  const byProduct = {};
  for (const pr of MARKET_PRODUCTS) {
    for (const d of loadBlockDays(ex, pr)) dates.add(d.date);
  }
  const available = [...dates].sort().reverse();
  const day = date && available.includes(date) ? date : (date || available[0] || null);

  for (const pr of MARKET_PRODUCTS) {
    const blocks = day ? (loadBlockDays(ex, pr, { from: day, to: day })[0]?.blocks || []) : [];
    byProduct[pr] = {
      source: day ? (loadBlockDays(ex, pr, { from: day, to: day })[0]?.source || null) : null,
      day_price: round4(dailyPrice(blocks)),
      blocks: blocks
        .sort((a, b) => a.block - b.block)
        .map((b) => ({ block: b.block, time_block: blockLabel(b.block), mcp: round4(b.price), mcv: b.volume == null ? null : round2(b.volume) })),
    };
  }
  return { exchange: ex, date: day, available_dates: available, products: byProduct };
}
