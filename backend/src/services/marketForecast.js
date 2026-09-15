// Market price forecasting: what the platform knows cleared, what the models
// expect next, and how close earlier forecasts came.
//
// The models live in priceForecastModels.js and never touch the database. This
// file decides what counts as an actual price, keeps runs, scores them, and
// loads the exchange's own price files for when the API is not there.

import XLSX from 'xlsx';
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam } from '../mastersService.js';
import { getIexConfig, syncMarketRates } from './iexService.js';
import {
  buildForecast, MODELS, MODEL_LABELS, intradayShape, blockForecast, dailyPrice,
  blockLabel, bucketLabel, scoreErrors, toDay, fromDay,
} from './priceForecastModels.js';

export const FORECAST_EXCHANGES = ['IEX', 'PXIL', 'HPX'];
export const FORECAST_PRODUCTS = ['DAM', 'GDAM', 'RTM'];
export const FORECAST_MODELS = ['AUTO', ...MODELS];
export const MAX_HORIZON_DAYS = 31;
// The intraday shape is laid over the first week only. Beyond that a block
// price is the day's guess times last month's shape, which is not a figure
// anybody should bid on.
export const BLOCK_HORIZON_DAYS = 7;
export const EXCHANGE_FILE_SOURCE = 'EXCHANGE_FILE';
const BLOCKS_PER_DAY = 96;
// A day loaded block by block counts as a day's price once nearly all of it is there.
const MIN_BLOCKS_FOR_DAILY_PRICE = 90;
const SHAPE_LOOKBACK_DAYS = 28;

// market_rates also holds the demo seed's rows (data_source IEX_PORTAL and the
// like — nothing in the platform writes those). A forecast trained on them would
// be a forecast of a random-number generator, so an actual is only what one of
// the platform's real ingestion paths wrote.
const OBSERVED_MARKET_SOURCES = ['IEX_API', EXCHANGE_FILE_SOURCE];

export const SOURCE_LABELS = {
  CERC_MMR: 'CERC monthly market report',
  [EXCHANGE_FILE_SOURCE]: 'Exchange price file',
  IEX_API: 'IEX API',
};

// The exchanges' price ceiling. Every monthly maximum in two years of CERC
// reports for IEX DAM, GDAM and RTM is exactly ₹10/kWh.
const DEFAULT_PRICE_CAP = { DAM: 10, GDAM: 10, RTM: 10 };

export class ForecastError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function priceCap(product) {
  const map = getParam('market_price_cap', null) || DEFAULT_PRICE_CAP;
  const v = Number(map?.[product]);
  return Number.isFinite(v) && v > 0 ? v : (DEFAULT_PRICE_CAP[product] ?? 10);
}

export const istToday = (now = new Date()) => new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);

export function isIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && fromDay(toDay(v)) === v;
}

const round4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);
const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

function blockFromLabel(label) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(label || ''));
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins % 15 || mins >= 1440 ? null : mins / 15 + 1;
}

function oneOf(value, allowed, name) {
  const v = String(value || '').trim().toUpperCase();
  if (!allowed.includes(v)) throw new ForecastError(400, `${name} must be one of ${allowed.join(', ')}`);
  return v;
}

function requireSeries(exchange, product) {
  return { exchange: oneOf(exchange, FORECAST_EXCHANGES, 'exchange'), product: oneOf(product, FORECAST_PRODUCTS, 'product') };
}

// ── Actual prices ────────────────────────────────────────────────────────────

/**
 * Block-wise prices the platform observed, one entry per delivery date, with
 * the source that wrote it. Loading a date replaces everything held for it, so
 * a date has one source.
 */
export function loadBlockDays(exchange, product, { from = null, to = null } = {}) {
  const rows = db.prepare(`
    SELECT rate_date, time_block, mcp_rate, volume_mw, data_source FROM market_rates
    WHERE exchange = ? AND product = ?
      AND data_source IN (${OBSERVED_MARKET_SOURCES.map(() => '?').join(', ')})
      AND time_block IS NOT NULL AND time_block != 'DAILY'
      AND (? IS NULL OR rate_date >= ?) AND (? IS NULL OR rate_date <= ?)
    ORDER BY rate_date, time_block
  `).all(exchange, product, ...OBSERVED_MARKET_SOURCES, from, from, to, to);
  const byDate = new Map();
  for (const r of rows) {
    const block = blockFromLabel(r.time_block);
    if (!block) continue;
    if (!byDate.has(r.rate_date)) byDate.set(r.rate_date, { source: r.data_source, blocks: [] });
    byDate.get(r.rate_date).blocks.push({ block, price: r.mcp_rate, volume: r.volume_mw });
  }
  return [...byDate.entries()].map(([date, d]) => ({ date, source: d.source, blocks: d.blocks }));
}

/**
 * One price per delivery date, from the strongest source that has the day.
 * Weakest first, each later source replacing it:
 *
 *   IEX API, daily row   a plain mean of the day's periods, as the API sync
 *                        wrote it before it kept blocks
 *   blocks               the day's 96 blocks weighted by cleared volume — the
 *                        API sync now, or a price file the desk loaded
 *   CERC report          the exchange's own daily weighted price, as filed with
 *                        the Commission — the figure nobody gets to revise
 */
export function loadDailyActuals(exchange, product, { from = null, to = null } = {}) {
  const byDate = new Map();
  const put = (date, price, source) => {
    if (!isIsoDate(date) || (from && date < from) || (to && date > to)) return;
    if (Number.isFinite(price) && price >= 0) byDate.set(date, { date, price: round4(price), source });
  };

  for (const r of db.prepare(`
    SELECT rate_date, AVG(mcp_rate) price FROM market_rates
    WHERE exchange = ? AND product = ? AND data_source = 'IEX_API'
      AND (time_block IS NULL OR time_block = 'DAILY')
      AND (? IS NULL OR rate_date >= ?) AND (? IS NULL OR rate_date <= ?)
    GROUP BY rate_date
  `).all(exchange, product, from, from, to, to)) put(r.rate_date, r.price, 'IEX_API');

  for (const d of loadBlockDays(exchange, product, { from, to })) {
    if (d.blocks.length >= MIN_BLOCKS_FOR_DAILY_PRICE) put(d.date, dailyPrice(d.blocks), d.source);
  }

  for (const r of db.prepare(`
    SELECT report_period, day_of_month, metric_value FROM cerc_market_data
    WHERE data_category = 'PRICE' AND metric_name = 'Daily Price'
      AND product = ? AND exchange = ? AND day_of_month IS NOT NULL
      AND (? IS NULL OR report_period >= ?) AND (? IS NULL OR report_period <= ?)
  `).all(product, exchange, from && from.slice(0, 7), from && from.slice(0, 7), to && to.slice(0, 7), to && to.slice(0, 7))) {
    put(`${r.report_period}-${String(r.day_of_month).padStart(2, '0')}`, r.metric_value, 'CERC_MMR');
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

const countBy = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});

/** Every exchange × product, with how much history it has and its latest run. */
export function listSeries({ now = new Date() } = {}) {
  const latestRun = db.prepare(`
    SELECT id, cutoff_date, created_at, model, horizon_days FROM price_forecast_runs
    WHERE exchange = ? AND product = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
  `);
  const series = [];
  for (const exchange of FORECAST_EXCHANGES) {
    for (const product of FORECAST_PRODUCTS) {
      const actuals = loadDailyActuals(exchange, product);
      const blockDays = loadBlockDays(exchange, product);
      series.push({
        exchange,
        product,
        days: actuals.length,
        first_date: actuals[0]?.date || null,
        last_date: actuals[actuals.length - 1]?.date || null,
        sources: countBy(actuals, 'source'),
        block_days: blockDays.length,
        last_block_date: blockDays[blockDays.length - 1]?.date || null,
        latest_run: latestRun.get(exchange, product) || null,
      });
    }
  }
  return {
    today: istToday(now),
    models: FORECAST_MODELS.map((m) => ({ model: m, label: m === 'AUTO' ? 'Auto — best backtest' : MODEL_LABELS[m] })),
    max_horizon_days: MAX_HORIZON_DAYS,
    block_horizon_days: BLOCK_HORIZON_DAYS,
    source_labels: SOURCE_LABELS,
    series,
  };
}

/** The daily actuals for a window, for charting history on its own. */
export function actualsFor({ exchange, product, from, to }) {
  const s = requireSeries(exchange, product);
  if (from && !isIsoDate(from)) throw new ForecastError(400, 'from must be a valid YYYY-MM-DD date');
  if (to && !isIsoDate(to)) throw new ForecastError(400, 'to must be a valid YYYY-MM-DD date');
  return {
    ...s,
    actuals: loadDailyActuals(s.exchange, s.product).filter((a) => (!from || a.date >= from) && (!to || a.date <= to)),
  };
}

// ── Runs ─────────────────────────────────────────────────────────────────────

const HISTORY_CONTEXT_DAYS = 60;

function formatRun(row) {
  if (!row) return null;
  const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  const { model_params, sources, backtest, ...rest } = row;
  return {
    ...rest,
    model_label: MODEL_LABELS[row.model] || row.model,
    model_params: parse(model_params),
    sources: parse(sources) || {},
    backtest: (parse(backtest) || []).map((b) => ({ ...b, label: MODEL_LABELS[b.model] || b.model })),
    // How old the newest price was when the run was made. A forecast "for
    // tomorrow" off prices six months old is a forecast of six months ago.
    data_age_days: toDay(String(row.created_at).slice(0, 10)) - toDay(row.cutoff_date),
  };
}

function scored(point, actual) {
  const a = actual?.price ?? null;
  const hasBand = point.lower_rate != null && point.upper_rate != null;
  return {
    date: point.target_date,
    horizon: point.horizon,
    forecast: point.forecast_rate,
    lower: point.lower_rate,
    upper: point.upper_rate,
    actual: a,
    actual_source: actual?.source || null,
    error: a == null ? null : round4(point.forecast_rate - a),
    abs_pct_error: a == null || !(a > 0) ? null : round2((Math.abs(point.forecast_rate - a) / a) * 100),
    within_band: a == null || !hasBand ? null : a >= point.lower_rate && a <= point.upper_rate,
  };
}

function realisedOf(points) {
  const withActual = points.filter((p) => p.actual != null);
  const banded = withActual.filter((p) => p.within_band != null);
  return {
    scored_days: withActual.length,
    awaiting_days: points.length - withActual.length,
    ...scoreErrors(withActual.map((p) => ({ actual: p.actual, forecast: p.forecast }))),
    within_band_pct: banded.length ? round2((banded.filter((p) => p.within_band).length / banded.length) * 100) : null,
  };
}

const RUN_SELECT = `
  SELECT r.*, u.name AS created_by_name FROM price_forecast_runs r
  LEFT JOIN users u ON u.id = r.created_by`;

/**
 * Make, test and keep a forecast. `cutoff` stands the model at an earlier date
 * — it sees nothing after it — so the desk can ask what the model would have
 * said then and hold it to what actually cleared.
 */
export function createForecastRun({ exchange, product, horizon = 7, model = 'AUTO', cutoff = null, trigger = 'MANUAL', user = null } = {}) {
  const s = requireSeries(exchange, product);
  const h = Number(horizon);
  if (!Number.isInteger(h) || h < 1 || h > MAX_HORIZON_DAYS) {
    throw new ForecastError(400, `horizon must be a whole number of days from 1 to ${MAX_HORIZON_DAYS}`);
  }
  const m = String(model || 'AUTO').toUpperCase();
  if (!FORECAST_MODELS.includes(m)) throw new ForecastError(400, `model must be one of ${FORECAST_MODELS.join(', ')}`);
  if (cutoff && !isIsoDate(cutoff)) throw new ForecastError(400, 'cutoff must be a valid YYYY-MM-DD date');

  const history = loadDailyActuals(s.exchange, s.product).filter((a) => !cutoff || a.date <= cutoff);
  if (!history.length) {
    throw new ForecastError(422, cutoff
      ? `The platform holds no ${s.exchange} ${s.product} prices on or before ${cutoff}.`
      : `The platform holds no ${s.exchange} ${s.product} prices yet. Load the exchange's block-wise price file, or wait for the CERC monthly report.`);
  }

  const cap = priceCap(s.product);
  const result = buildForecast(history.map((a) => ({ date: a.date, value: a.price })), { horizon: h, model: m, cap });
  if (!result.ok) {
    // Almost always recency, not volume: two years of CERC prices and then one
    // day loaded last week is a single recent day.
    const last = history[history.length - 1].date;
    const within = (days) => history.filter((a) => toDay(a.date) > toDay(last) - days).length;
    throw new ForecastError(422,
      `${s.exchange} ${s.product} has a price for ${within(14)} of the 14 days up to ${last} and ${within(28)} of the 28`
      + (m === 'AUTO' ? '' : `, which ${MODEL_LABELS[m]} cannot forecast from`)
      + '. The simplest model needs four recent days and the weekly ones four weeks — load the missing days\' exchange price files.');
  }

  const cutoffDay = toDay(result.cutoff_date);
  const shape = intradayShape(
    loadBlockDays(s.exchange, s.product).filter((d) => {
      const day = toDay(d.date);
      return day <= cutoffDay && day > cutoffDay - SHAPE_LOOKBACK_DAYS;
    }),
    { lookbackDays: SHAPE_LOOKBACK_DAYS, minBlocks: MIN_BLOCKS_FOR_DAILY_PRICE },
  );

  const id = newId('PFR');
  const points = result.points;
  const insertPoint = db.prepare(`
    INSERT INTO price_forecasts (id, run_id, exchange, product, target_date, time_block, horizon, forecast_rate, lower_rate, upper_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO price_forecast_runs (
        id, exchange, product, requested_model, model, selection, model_params, cutoff_date, horizon_days,
        first_target_date, last_target_date, history_from, history_days, sources, backtest,
        backtest_mape, backtest_mae, backtest_bias, backtest_origins, interval_coverage,
        block_shape_days, trigger_type, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, s.exchange, s.product, m, result.model, result.selection,
      result.params ? JSON.stringify(result.params) : null,
      result.cutoff_date, h, points[0].date, points[points.length - 1].date,
      result.history_from, result.history_days,
      JSON.stringify(countBy(history, 'source')),
      JSON.stringify(result.backtest),
      result.chosen_backtest.mape, result.chosen_backtest.mae, result.chosen_backtest.bias,
      result.chosen_backtest.origins, result.interval_coverage,
      shape ? shape.days : 0,
      trigger === 'SCHEDULED' ? 'SCHEDULED' : 'MANUAL',
      user?.id || null,
    );
    for (const p of points) {
      insertPoint.run(newId('PFC'), id, s.exchange, s.product, p.date, 'DAILY', p.horizon, p.forecast, p.lower, p.upper);
      if (!shape || p.horizon > BLOCK_HORIZON_DAYS) continue;
      // No band on a block: the shape has not been backtested, and the day's
      // band borrowed onto a block would claim a confidence nobody measured.
      for (const b of blockForecast(p.forecast, shape.forDate(p.date).shape, { cap })) {
        insertPoint.run(newId('PFC'), id, s.exchange, s.product, p.date, blockLabel(b.block), p.horizon, b.forecast, null, null);
      }
    }
  })();

  return getForecastRun(id);
}

export function getForecastRun(id, { blockDate } = {}) {
  const run = db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(id);
  if (!run) return null;

  const actuals = loadDailyActuals(run.exchange, run.product);
  const actualByDate = new Map(actuals.map((a) => [a.date, a]));
  const points = db.prepare(`
    SELECT target_date, horizon, forecast_rate, lower_rate, upper_rate FROM price_forecasts
    WHERE run_id = ? AND time_block = 'DAILY' ORDER BY target_date
  `).all(id).map((p) => scored(p, actualByDate.get(p.target_date)));

  const cutoffDay = toDay(run.cutoff_date);
  const history = actuals.filter((a) => {
    const day = toDay(a.date);
    return day <= cutoffDay && day > cutoffDay - HISTORY_CONTEXT_DAYS;
  });

  const blockDates = db.prepare(`
    SELECT DISTINCT target_date FROM price_forecasts WHERE run_id = ? AND time_block != 'DAILY' ORDER BY target_date
  `).all(id).map((r) => r.target_date);
  const date = blockDate && blockDates.includes(blockDate) ? blockDate : (blockDates[0] || null);
  let blocks = [];
  if (date) {
    const observed = new Map((loadBlockDays(run.exchange, run.product).find((d) => d.date === date)?.blocks || [])
      .map((b) => [b.block, b.price]));
    blocks = db.prepare(`
      SELECT time_block, forecast_rate FROM price_forecasts
      WHERE run_id = ? AND target_date = ? AND time_block != 'DAILY' ORDER BY time_block
    `).all(id, date).map((b) => ({
      time_block: b.time_block,
      forecast: b.forecast_rate,
      actual: round4(observed.get(blockFromLabel(b.time_block))) ?? null,
    }));
  }

  return {
    run: formatRun(run),
    points,
    realised: realisedOf(points),
    history,
    blocks: { dates: blockDates, date, rows: blocks },
    price_cap: priceCap(run.product),
  };
}

export function listForecastRuns({ exchange, product, limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (exchange) { where.push('r.exchange = ?'); params.push(oneOf(exchange, FORECAST_EXCHANGES, 'exchange')); }
  if (product) { where.push('r.product = ?'); params.push(oneOf(product, FORECAST_PRODUCTS, 'product')); }
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const runs = db.prepare(`
    ${RUN_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?
  `).all(...params, cap);

  const actualCache = new Map();
  const actualsOf = (ex, pr) => {
    const key = `${ex}|${pr}`;
    if (!actualCache.has(key)) actualCache.set(key, new Map(loadDailyActuals(ex, pr).map((a) => [a.date, a])));
    return actualCache.get(key);
  };
  const pointsOf = db.prepare(`
    SELECT target_date, horizon, forecast_rate, lower_rate, upper_rate FROM price_forecasts
    WHERE run_id = ? AND time_block = 'DAILY'
  `);
  return runs.map((row) => {
    const { backtest, ...run } = formatRun(row);
    const actual = actualsOf(row.exchange, row.product);
    return { ...run, realised: realisedOf(pointsOf.all(row.id).map((p) => scored(p, actual.get(p.target_date)))) };
  });
}

// ── Forecast against actual ──────────────────────────────────────────────────

/**
 * How the forecasts have done, once the prices they were about have cleared.
 *
 * Every run's cutoff is before its first target, so everything here was a
 * genuine forecast when it was made. For the day-by-day comparison each date
 * takes the forecast made from the newest data — the one a desk would have been
 * looking at; the distance and model tables use every forecast ever made for a
 * day, because that is how accuracy falls away with distance.
 */
export function forecastAccuracy({ exchange, product, from, to } = {}) {
  const s = requireSeries(exchange, product);
  if (from && !isIsoDate(from)) throw new ForecastError(400, 'from must be a valid YYYY-MM-DD date');
  if (to && !isIsoDate(to)) throw new ForecastError(400, 'to must be a valid YYYY-MM-DD date');

  const where = ["f.exchange = ?", "f.product = ?", "f.time_block = 'DAILY'"];
  const params = [s.exchange, s.product];
  if (from) { where.push('f.target_date >= ?'); params.push(from); }
  if (to) { where.push('f.target_date <= ?'); params.push(to); }
  const rows = db.prepare(`
    SELECT f.run_id, f.target_date, f.horizon, f.forecast_rate, f.lower_rate, f.upper_rate, r.model, r.cutoff_date
    FROM price_forecasts f JOIN price_forecast_runs r ON r.id = f.run_id
    WHERE ${where.join(' AND ')}
    ORDER BY f.target_date ASC, r.cutoff_date DESC, r.created_at DESC, r.rowid DESC
  `).all(...params);

  const actuals = loadDailyActuals(s.exchange, s.product);
  const actualByDate = new Map(actuals.map((a) => [a.date, a]));
  const all = rows.map((r) => ({ ...scored(r, actualByDate.get(r.target_date)), run_id: r.run_id, model: r.model, cutoff_date: r.cutoff_date }));

  const freshest = [];
  const seen = new Set();
  for (const p of all) {
    if (seen.has(p.date)) continue;
    seen.add(p.date);
    freshest.push(p);
  }
  const withActual = all.filter((p) => p.actual != null);

  const groupScore = (items, keyOf, order) => {
    const groups = new Map();
    for (const p of items) {
      const k = keyOf(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const keys = order ? order.filter((k) => groups.has(k)) : [...groups.keys()];
    return keys.map((k) => {
      const r = realisedOf(groups.get(k));
      return { key: k, forecasts: r.scored_days, mape: r.mape, mae: r.mae, rmse: r.rmse, bias: r.bias, within_band_pct: r.within_band_pct };
    });
  };

  return {
    ...s,
    window: { from: from || null, to: to || null },
    latest_actual_date: actuals[actuals.length - 1]?.date || null,
    summary: { ...realisedOf(freshest), forecast_days: freshest.length },
    by_horizon: groupScore(withActual, (p) => bucketLabel(p.horizon), ['Day 1', 'Days 2–7', 'Days 8–14', 'Day 15+']),
    by_model: groupScore(withActual, (p) => p.model).map((g) => ({ ...g, label: MODEL_LABELS[g.key] || g.key })),
    days: freshest,
  };
}

/**
 * The same figure pooled across every series a filter covers — what Market
 * Rates & Analytics and the MIS pack quote. Those used to read a forecast_rate
 * column that only the demo seed ever filled, with an error written into it on
 * purpose; a MAPE printed from that was a number somebody chose.
 */
export function pooledForecastAccuracy({ from, to, exchange, product } = {}) {
  const exchanges = exchange ? [exchange].filter((e) => FORECAST_EXCHANGES.includes(e)) : FORECAST_EXCHANGES;
  const products = product ? [product].filter((p) => FORECAST_PRODUCTS.includes(p)) : FORECAST_PRODUCTS;
  const days = [];
  for (const ex of exchanges) {
    for (const pr of products) {
      for (const d of forecastAccuracy({ exchange: ex, product: pr, from, to }).days) {
        if (d.actual != null) days.push({ ...d, exchange: ex, product: pr });
      }
    }
  }
  return { observations: days.length, ...scoreErrors(days.map((d) => ({ actual: d.actual, forecast: d.forecast }))), days };
}

// ── Scheduled refresh ────────────────────────────────────────────────────────

/**
 * A week-ahead AUTO run for every series whose newest price has no run yet.
 * Driven by data rather than by the clock: a day nothing new arrived makes no
 * run, and a CERC report landing a month of prices makes exactly one.
 */
export function refreshForecasts({ horizon = 7 } = {}) {
  const exists = db.prepare('SELECT 1 FROM price_forecast_runs WHERE exchange = ? AND product = ? AND cutoff_date = ? LIMIT 1');
  const created = [];
  const skipped = [];
  for (const exchange of FORECAST_EXCHANGES) {
    for (const product of FORECAST_PRODUCTS) {
      const actuals = loadDailyActuals(exchange, product);
      if (!actuals.length) continue;
      if (exists.get(exchange, product, actuals[actuals.length - 1].date)) continue;
      try {
        created.push(createForecastRun({ exchange, product, horizon, trigger: 'SCHEDULED' }).run.id);
      } catch (err) {
        if (!(err instanceof ForecastError)) throw err;
        skipped.push({ exchange, product, reason: err.message });
      }
    }
  }
  return { created: created.length, run_ids: created, skipped };
}

/**
 * Pull the clearing prices a forecast is waiting on from the IEX API, before the
 * afternoon refresh: tomorrow's DAM and GDAM (out by 13:00), today's, and
 * yesterday's RTM, which only completes at midnight. A day already held block by
 * block is not asked for again. Does nothing while IEX is in stub mode, which is
 * where it stays until the whitelisted server has it switched on.
 */
export async function pullIexPrices({ now = new Date() } = {}) {
  if (!getIexConfig().live) return { mode: 'STUB', pulled: [] };
  const today = istToday(now);
  const shift = (n) => fromDay(toDay(today) + n);
  const wanted = [['DAM', shift(1)], ['GDAM', shift(1)], ['DAM', today], ['GDAM', today], ['RTM', shift(-1)], ['RTM', today]];
  const held = (product, date) => (loadBlockDays('IEX', product, { from: date, to: date })[0]?.blocks.length || 0) >= MIN_BLOCKS_FOR_DAILY_PRICE;

  const pulled = [];
  for (const [product, date] of wanted) {
    if (held(product, date)) continue;
    try {
      const r = await syncMarketRates(product, date);
      pulled.push({ product, date, rows: r.rows_written || 0, error: r.ok ? null : r.error });
    } catch (err) {
      pulled.push({ product, date, rows: 0, error: err.message });
    }
  }
  return { mode: 'LIVE', pulled };
}

// ── For the bidding desk ─────────────────────────────────────────────────────

/**
 * The forecast for one delivery date that a trader pricing a bid should see:
 * from the run with the newest prices behind it. Every run's cutoff is before
 * its targets, so this is always a forecast made without the answer.
 */
export function forecastForDate({ exchange, product, date }) {
  const s = requireSeries(exchange, product);
  if (!isIsoDate(date)) throw new ForecastError(400, 'date must be a valid YYYY-MM-DD date');
  const cap = priceCap(s.product);
  const hit = db.prepare(`
    SELECT f.run_id, f.horizon, f.forecast_rate, f.lower_rate, f.upper_rate
    FROM price_forecasts f JOIN price_forecast_runs r ON r.id = f.run_id
    WHERE f.exchange = ? AND f.product = ? AND f.target_date = ? AND f.time_block = 'DAILY'
    ORDER BY r.cutoff_date DESC, r.created_at DESC, r.rowid DESC LIMIT 1
  `).get(s.exchange, s.product, date);

  if (!hit) {
    const latest = db.prepare(`
      SELECT last_target_date FROM price_forecast_runs WHERE exchange = ? AND product = ?
      ORDER BY last_target_date DESC LIMIT 1
    `).get(s.exchange, s.product);
    return { ...s, date, price_cap: cap, forecast: null, latest_forecast_date: latest?.last_target_date || null };
  }

  const { backtest, model_params, sources, ...run } = formatRun(db.prepare(`${RUN_SELECT} WHERE r.id = ?`).get(hit.run_id));
  const blocks = db.prepare(`
    SELECT time_block, forecast_rate FROM price_forecasts
    WHERE run_id = ? AND target_date = ? AND time_block != 'DAILY' ORDER BY time_block
  `).all(hit.run_id, date).map((b) => ({ block: blockFromLabel(b.time_block), time_block: b.time_block, forecast: b.forecast_rate }));

  return {
    ...s,
    date,
    price_cap: cap,
    forecast: { horizon: hit.horizon, forecast: hit.forecast_rate, lower: hit.lower_rate, upper: hit.upper_rate },
    run,
    blocks,
  };
}

/**
 * A run as a workbook: the daily figures with actuals so far, the 96 blocks in
 * both Rs/kWh and the Rs/MWh an exchange bid is entered in, and what the run
 * was made from — so the sheet still says what it is once it has left the
 * screen.
 */
export function forecastRunWorkbook(id) {
  const detail = getForecastRun(id);
  if (!detail) return null;
  const { run, points, realised } = detail;
  const day = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });

  const daily = [
    ['Delivery date', 'Day', 'Days ahead', 'Forecast (Rs/kWh)', '10th percentile (Rs/kWh)', '90th percentile (Rs/kWh)', 'Actual (Rs/kWh)', 'Actual from', 'Absolute error %'],
    ...points.map((p) => [
      p.date, day(p.date), p.horizon, p.forecast, p.lower, p.upper, p.actual,
      p.actual_source ? (SOURCE_LABELS[p.actual_source] || p.actual_source) : null, p.abs_pct_error,
    ]),
  ];

  const blockRows = db.prepare(`
    SELECT target_date, time_block, forecast_rate FROM price_forecasts
    WHERE run_id = ? AND time_block != 'DAILY' ORDER BY target_date, time_block
  `).all(id);
  const blocks = [
    ['Delivery date', 'Block', 'From', 'To', 'Forecast (Rs/kWh)', 'Forecast (Rs/MWh)'],
    ...blockRows.map((b) => {
      const n = blockFromLabel(b.time_block);
      return [b.target_date, n, b.time_block, blockLabel(n + 1 > BLOCKS_PER_DAY ? 1 : n + 1), b.forecast_rate, round2(b.forecast_rate * 1000)];
    }),
  ];

  const about = [
    ['Exchange', run.exchange],
    ['Product', run.product],
    ['Model', run.model_label],
    ['How it was chosen', { BEST_BACKTEST: 'Lowest backtest MAPE of every model', REQUESTED: 'Chosen by the desk', FALLBACK: 'Too little history to compare; simplest model that fits' }[run.selection] || run.selection],
    ['Prices up to', run.cutoff_date],
    ['Trained on', `${run.history_days} days from ${run.history_from}`],
    ['Sources', Object.entries(run.sources).map(([k, n]) => `${SOURCE_LABELS[k] || k}: ${n}`).join('; ')],
    ['Backtest MAPE %', run.backtest_mape],
    ['Backtest cutoffs', run.backtest_origins],
    ['Backtest actuals inside the 80% range %', run.interval_coverage],
    ['Days cleared so far', `${realised.scored_days} of ${points.length}`],
    ['MAPE against what cleared %', realised.mape],
    ['Made (UTC)', run.created_at],
    ['Made by', run.trigger_type === 'SCHEDULED' ? 'Scheduled refresh' : (run.created_by_name || run.created_by)],
    ['Run', run.id],
    [],
    ['The model saw no price after "Prices up to". The range is the 10th–90th percentile of its own backtest misses; blocks carry no range because the intraday shape has not been backtested.'],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daily), 'Daily');
  if (blockRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(blocks), 'Blocks');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(about), 'About this run');
  return {
    buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }),
    filename: `SJVN_Price_Forecast_${run.exchange}_${run.product}_${run.first_target_date}_to_${run.last_target_date}.xlsx`,
    run,
  };
}

/** A blank day in the layout the price file reader is surest of. */
export function priceFileTemplate() {
  const lines = ['Date,Time Block,MCV (MW),MCP (Rs/MWh)'];
  for (let b = 1; b <= BLOCKS_PER_DAY; b += 1) {
    lines.push(`${b === 1 ? 'DD-MM-YYYY' : ''},${blockLabel(b)} - ${b === BLOCKS_PER_DAY ? '24:00' : blockLabel(b + 1)},,`);
  }
  return `${lines.join('\n')}\n`;
}

// ── Exchange price files ─────────────────────────────────────────────────────
// Until the IEX API is live — and for PXIL and HPX, which have no API here at
// all — the day's prices come from the exchange's own download: one row per
// 15-minute block with its clearing price and volume. Column names drift from
// one download to the next, so columns are found by what they are called and,
// failing that, by what they hold.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad2 = (n) => String(n).padStart(2, '0');
const MAX_REPORTED_ERRORS = 20;

function isoFrom(y, m, d) {
  if (!y || !m || !d) return null;
  const s = `${y}-${pad2(m)}-${pad2(d)}`;
  return isIsoDate(s) ? s : null;
}

export function parseBlockCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 1 && v <= BLOCKS_PER_DAY) return v;
    // A time-formatted cell arrives as a fraction of a day.
    if (v >= 0 && v < 1) {
      const mins = Math.round(v * 1440);
      return mins % 15 === 0 ? mins / 15 + 1 : null;
    }
    return null;
  }
  const s = String(v).trim();
  if (/^\d{1,2}$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= BLOCKS_PER_DAY ? n : null;
  }
  // "00:15 - 00:30" or "00:15"
  const m = /^(\d{1,2}):(\d{2})(?:\s*[-–]\s*\d{1,2}:\d{2})?$/.exec(s);
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins % 15 === 0 && mins < 1440 ? mins / 15 + 1 : null;
}

export function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? isoFrom(d.y, d.m, d.d) : null;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return isoFrom(+m[1], +m[2], +m[3]);
  // Day first, as every Indian exchange writes it.
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return isoFrom(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]+(\d{4})$/.exec(s);
  if (m) return isoFrom(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

const toNumber = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Reads a block-wise price file into days. Returns `errors` rather than a
 * partial result: a file with one bad row is not loaded at all, because a day
 * missing the rows that did not parse would still look like a day.
 */
export function parseExchangePriceFile(buffer, { date = null, cap = 10, today = istToday() } = {}) {
  let rows;
  try {
    // raw: a CSV date like 01-09-2026 must stay text, or it is read as 9 January.
    const wb = XLSX.read(buffer, { type: 'buffer', raw: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true, blankrows: false });
  } catch {
    return { errors: ['The file could not be read as a spreadsheet or CSV.'] };
  }

  const norm = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  // The header is the first row naming a price with other columns beside it — a
  // one-cell title such as "Market Clearing Price" above the table is not it.
  const headerIdx = rows.slice(0, 15).findIndex((r) => (r || []).filter((c) => norm(c)).length >= 2
    && (r || []).some((c) => /\bmcp\b|clearing price|price/.test(norm(c))));
  if (headerIdx < 0) return { errors: ['No price column: expected a header such as "MCP (Rs/MWh)".'] };
  const header = rows[headerIdx].map(norm);
  const body = rows.slice(headerIdx + 1);
  const find = (...patterns) => {
    for (const p of patterns) {
      const i = header.findIndex((h) => p.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };

  const priceCol = find(/\bmcp\b/, /clearing price/, /price/);
  const volumeCol = find(/\bmcv\b/, /cleared volume/, /scheduled volume/, /volume/);
  const dateCol = find(/\bdate\b/);
  let blockCol = find(/time ?block/, /\bblock\b/, /\bperiod\b/);
  if (blockCol < 0) {
    // One IEX download heads its block numbers "Months". Take the first column
    // nobody else claimed whose every value is a block.
    blockCol = header.findIndex((_, i) => {
      if ([priceCol, volumeCol, dateCol].includes(i)) return false;
      const vals = body.map((r) => r?.[i]).filter((v) => v != null && v !== '');
      return vals.length > 0 && vals.slice(0, BLOCKS_PER_DAY).every((v) => parseBlockCell(v) != null);
    });
  }
  if (blockCol < 0) return { errors: ['No time-block column: expected block numbers 1–96 or times such as "00:15 - 00:30".'] };
  if (dateCol < 0 && !date) return { errors: ['The file has no date column — choose the delivery date these prices are for.'] };
  if (date && !isIsoDate(date)) return { errors: ['date must be a valid YYYY-MM-DD date.'] };

  const priceHeader = header[priceCol];
  let unit = /mwh/.test(priceHeader) ? 'Rs/MWh' : (/kwh|unit/.test(priceHeader) ? 'Rs/kWh' : null);
  const unitInferred = !unit;
  if (!unit) {
    const values = body.map((r) => toNumber(r?.[priceCol])).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    unit = values.length && values[Math.floor(values.length / 2)] > 30 ? 'Rs/MWh' : 'Rs/kWh';
  }
  const divisor = unit === 'Rs/MWh' ? 1000 : 1;
  const latestAllowed = fromDay(toDay(today) + 1); // DAM results for tomorrow are out by the afternoon

  const errors = [];
  const days = new Map();
  let carriedDate = null;
  body.forEach((r, i) => {
    const rowNo = headerIdx + i + 2;
    if (!r || r.every((c) => c == null || c === '')) return;
    const block = parseBlockCell(r[blockCol]);
    if (block == null) {
      // A totals line or a footnote, not a block.
      if (r.some((c) => /total|average|avg|max|min|weighted|note|source/i.test(String(c ?? ''))) || r[priceCol] == null) return;
      errors.push(`Row ${rowNo}: "${r[blockCol]}" is not a time block (1–96 or HH:MM).`);
      return;
    }

    let rowDate = date;
    if (dateCol >= 0) {
      const cell = r[dateCol];
      // Exports often print the date on a day's first row only.
      if (cell != null && cell !== '') {
        const parsed = parseDateCell(cell);
        if (!parsed) { errors.push(`Row ${rowNo}: "${cell}" is not a date.`); return; }
        carriedDate = parsed;
      }
      rowDate = carriedDate || date;
    }
    if (!rowDate) { errors.push(`Row ${rowNo}: no delivery date.`); return; }
    if (rowDate > latestAllowed) { errors.push(`Row ${rowNo}: ${rowDate} is after ${latestAllowed}; prices cannot have cleared yet.`); return; }

    const raw = toNumber(r[priceCol]);
    if (raw == null || Number.isNaN(raw) || raw < 0) { errors.push(`Row ${rowNo}: price "${r[priceCol] ?? ''}" is not a number.`); return; }
    const price = raw / divisor;
    if (price > cap + 1e-6) {
      errors.push(`Row ${rowNo}: ₹${round4(price)}/kWh is above the ₹${cap}/kWh exchange ceiling — is the price column really ${unit}?`);
      return;
    }
    const volume = volumeCol >= 0 ? toNumber(r[volumeCol]) : null;
    if (Number.isNaN(volume)) { errors.push(`Row ${rowNo}: volume "${r[volumeCol]}" is not a number.`); return; }

    if (!days.has(rowDate)) days.set(rowDate, new Map());
    const day = days.get(rowDate);
    if (day.has(block)) { errors.push(`Row ${rowNo}: ${rowDate} block ${block} appears twice.`); return; }
    day.set(block, { block, price: round4(price), volume });
  });

  if (errors.length > MAX_REPORTED_ERRORS) {
    const more = errors.length - MAX_REPORTED_ERRORS;
    errors.splice(MAX_REPORTED_ERRORS, errors.length, `…and ${more} more.`);
  }
  if (!errors.length && !days.size) errors.push('No price rows found under the header.');
  return {
    errors,
    price_unit: unit,
    price_unit_inferred: unitInferred,
    days: [...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([d, blocks]) => ({ date: d, blocks: [...blocks.values()].sort((a, b) => a.block - b.block) })),
  };
}

/**
 * Load a price file into market_rates. A date in the file replaces everything
 * held for that exchange, product and date — including the demo seed's rows —
 * so re-loading a corrected file is how a mistake is put right.
 */
export function importExchangePriceFile({ buffer, filename, exchange, product, date = null } = {}) {
  const s = requireSeries(exchange, product);
  if (!buffer?.length) throw new ForecastError(400, 'Attach the exchange price file.');
  const parsed = parseExchangePriceFile(buffer, { date: date || null, cap: priceCap(s.product) });
  if (parsed.errors.length) {
    throw new ForecastError(422, 'The file was not loaded — nothing was saved.', { errors: parsed.errors });
  }

  let replaced = 0;
  const insert = db.prepare(`
    INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, volume_mw, data_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const day of parsed.days) {
      replaced += db.prepare('DELETE FROM market_rates WHERE exchange = ? AND product = ? AND rate_date = ?')
        .run(s.exchange, s.product, day.date).changes;
      for (const b of day.blocks) {
        insert.run(newId('MKT'), s.exchange, s.product, day.date, blockLabel(b.block), b.price, b.volume, EXCHANGE_FILE_SOURCE);
      }
    }
  })();

  return {
    ...s,
    filename: filename || null,
    price_unit: parsed.price_unit,
    price_unit_inferred: parsed.price_unit_inferred,
    rows: parsed.days.reduce((a, d) => a + d.blocks.length, 0),
    replaced_rows: replaced,
    days: parsed.days.map((d) => ({
      date: d.date,
      blocks: d.blocks.length,
      complete: d.blocks.length === BLOCKS_PER_DAY,
      counts_as_daily_price: d.blocks.length >= MIN_BLOCKS_FOR_DAILY_PRICE,
      daily_price: round4(dailyPrice(d.blocks)),
    })),
  };
}
