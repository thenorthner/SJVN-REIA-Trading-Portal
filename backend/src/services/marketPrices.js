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

// ── SJVN's bids against the market ──────────────────────────────────────────

/**
 * The 15-minute blocks (1–96) a bid block's label covers: "18:00-18:15",
 * "00:00-24:00" for a whole-day block bid, "Block-12", or a bare start time.
 */
export function blocksCoveredBy(label) {
  const s = String(label || '').trim();
  const mins = (h, m) => Number(h) * 60 + Number(m);
  let m = /^block[-\s]?(\d{1,2})$/i.exec(s) || /^(\d{1,2})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 96 ? [n] : [];
  }
  m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const a = mins(m[1], m[2]);
    let b = mins(m[3], m[4]);
    if (b <= a) b = 1440;
    if (a % 15 || b % 15 || b > 1440) return [];
    const out = [];
    for (let t = a; t < b; t += 15) out.push(t / 15 + 1);
    return out;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const a = mins(m[1], m[2]);
    return a % 15 || a >= 1440 ? [] : [a / 15 + 1];
  }
  return [];
}

const BID_STATUSES = ['SUBMITTED', 'CLEARED', 'PARTIALLY_CLEARED'];

/**
 * Block by block for a product and delivery date: what SJVN bid (MW, and the
 * volume-weighted bid price), what cleared (MW, price), and the exchange's own
 * clearing price for the block where the platform holds it. A block bid over a
 * range puts its MW in every block it covers. `scope` narrows to one trading
 * client's bids (see tradingClientScope.clientScope).
 */
export function bidVsCleared(db, { product, date = null, exchange = null, scope = { sql: '', params: [] } }) {
  const exFilter = exchange ? ' AND b.exchange = ?' : '';
  const exParams = exchange ? [exchange] : [];
  const dates = db.prepare(`
    SELECT DISTINCT b.delivery_date AS d FROM bids b
    WHERE b.product = ? AND b.is_no_bid = 0 AND b.status IN (${BID_STATUSES.map(() => '?').join(', ')})${exFilter}${scope.sql}
    ORDER BY b.delivery_date DESC LIMIT 90
  `).all(product, ...BID_STATUSES, ...exParams, ...scope.params).map((r) => r.d);
  const day = date || dates[0] || null;
  if (!day) return { product, exchange, date: null, available_dates: dates, blocks: [], totals: null, market_exchange: null };

  const rows = db.prepare(`
    SELECT b.id AS bid_id, b.exchange, b.submission_mode, blk.time_block, blk.quantum_mw, blk.price_per_unit,
           blk.cleared_quantum_mw, blk.cleared_price
    FROM bids b JOIN bid_blocks blk ON blk.bid_id = b.id
    WHERE b.product = ? AND b.delivery_date = ? AND b.is_no_bid = 0
      AND b.status IN (${BID_STATUSES.map(() => '?').join(', ')})${exFilter}${scope.sql}
  `).all(product, day, ...BID_STATUSES, ...exParams, ...scope.params);

  const acc = Array.from({ length: 96 }, () => ({ bid_mw: 0, bid_value: 0, cleared_mw: 0, cleared_value: 0 }));
  const unreadable = new Set();
  for (const r of rows) {
    const covered = blocksCoveredBy(r.time_block);
    if (!covered.length) { unreadable.add(r.time_block); continue; }
    for (const n of covered) {
      const a = acc[n - 1];
      a.bid_mw += r.quantum_mw || 0;
      a.bid_value += (r.quantum_mw || 0) * (r.price_per_unit || 0);
      a.cleared_mw += r.cleared_quantum_mw || 0;
      a.cleared_value += (r.cleared_quantum_mw || 0) * (r.cleared_price ?? r.price_per_unit ?? 0);
    }
  }

  // The market price is one exchange's: the one asked for, or the one the bids sit on.
  const bidExchanges = [...new Set(rows.map((r) => r.exchange))];
  const marketExchange = exchange || (bidExchanges.length === 1 ? bidExchanges[0] : null);
  const market = new Map(
    marketExchange && MARKET_PRODUCTS.includes(product)
      ? (loadBlockDays(marketExchange, product, { from: day, to: day })[0]?.blocks || []).map((b) => [b.block, b.price])
      : [],
  );

  const blocks = acc.map((a, i) => ({
    block: i + 1,
    time_block: blockLabel(i + 1),
    bid_mw: round2(a.bid_mw),
    bid_price: a.bid_mw > 0 ? round4(a.bid_value / a.bid_mw) : null,
    cleared_mw: round2(a.cleared_mw),
    cleared_price: a.cleared_mw > 0 ? round4(a.cleared_value / a.cleared_mw) : null,
    market_mcp: market.has(i + 1) ? round4(market.get(i + 1)) : null,
  }));

  const bidMwh = acc.reduce((s, a) => s + a.bid_mw * BLOCK_HOURS, 0);
  const clearedMwh = acc.reduce((s, a) => s + a.cleared_mw * BLOCK_HOURS, 0);
  return {
    product,
    exchange,
    date: day,
    available_dates: dates,
    market_exchange: marketExchange,
    market_loaded: market.size > 0,
    blocks,
    totals: {
      bids: new Set(rows.map((r) => r.bid_id)).size,
      stub_bids: new Set(rows.filter((r) => r.submission_mode === 'STUB').map((r) => r.bid_id)).size,
      bid_mwh: round2(bidMwh),
      cleared_mwh: round2(clearedMwh),
      cleared_pct: bidMwh > 0 ? round2((clearedMwh / bidMwh) * 100) : null,
    },
    unreadable_time_blocks: [...unreadable],
  };
}
