import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { pooledForecastAccuracy } from '../services/marketForecast.js';
import {
  observedDays, latestObservedDate, summariseDays, summariseBy, blockCurves, bidVsCleared, SOURCE_LABELS,
} from '../services/marketPrices.js';
import { clientScope } from '../services/tradingClientScope.js';

const router = Router();
router.use(requireAuth);
// Market intelligence is an internal desk view: trading, finance, management,
// admin — plus the trading clients whose bids are priced off these rates.
router.use(requireRole(...ROLE_GROUPS.TRADING_ALL, 'TRADING_CLIENT'));

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const PRODUCTS = ['DAM', 'RTM', 'GDAM'];
const CONDITIONS = ['ABOVE', 'BELOW'];
const MAX_ROWS = 5000;
const DEFAULT_WINDOW_DAYS = 30;

const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

function isIsoDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const ms = new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

/**
 * Shared query-string parsing for every read endpoint. Returns `{ error }` so
 * the caller can answer 400 instead of silently ignoring a bad filter.
 */
function parseFilters(query) {
  const { start_date, end_date, exchange, product } = query;
  if (start_date && !isIsoDate(start_date)) return { error: 'start_date must be a valid YYYY-MM-DD date' };
  if (end_date && !isIsoDate(end_date)) return { error: 'end_date must be a valid YYYY-MM-DD date' };
  if (start_date && end_date && start_date > end_date) return { error: 'start_date must not be after end_date' };
  if (exchange && !EXCHANGES.includes(exchange)) return { error: `exchange must be one of ${EXCHANGES.join(', ')}` };
  if (product && !PRODUCTS.includes(product)) return { error: `product must be one of ${PRODUCTS.join(', ')}` };
  return { start_date: start_date || null, end_date: end_date || null, exchange: exchange || null, product: product || null };
}

/**
 * Resolves the effective analysis window. When the caller gives no dates we
 * anchor on the newest price the platform observed — the CERC report runs a
 * month or two behind, so anchoring on "today" would often return nothing.
 *
 * Every figure below comes from services/marketPrices.js, not from market_rates
 * directly: that table is mostly the demo seed's sine-wave prices, and every
 * number these endpoints returned used to be those.
 */
function resolveWindow(f) {
  const latest = latestObservedDate({ exchange: f.exchange, product: f.product });
  if (!latest) return null;
  const end = f.end_date || latest;
  const start = f.start_date || shiftDate(end, -(DEFAULT_WINDOW_DAYS - 1));
  return { start_date: start, end_date: end, days: Math.max(1, daysBetween(start, end)) };
}

// ── Rates ────────────────────────────────────────────────────────────────────

router.get('/rates', (req, res) => {
  const f = parseFilters(req.query);
  if (f.error) return res.status(400).json({ error: f.error });

  let limit = Number(req.query.limit ?? 1000);
  if (!Number.isFinite(limit) || limit <= 0) limit = 1000;
  limit = Math.min(Math.floor(limit), MAX_ROWS);

  // With no explicit dates, fall back to the same default window /summary and
  // /trend use, so the rates table always matches the charts above it.
  const win = resolveWindow(f);
  if (!win) return res.json([]);
  const rows = observedDays({ from: win.start_date, to: win.end_date, exchange: f.exchange, product: f.product })
    .reverse()
    .slice(0, limit)
    .map((r) => ({
      rate_date: r.date, exchange: r.exchange, product: r.product,
      mcp_rate: round2(r.price), min_rate: round2(r.min), max_rate: round2(r.max),
      energy_mwh: r.energy_mwh, blocks: r.blocks, data_source: r.source, source_label: SOURCE_LABELS[r.source] || r.source,
    }));
  res.json(rows);
});

// ── KPI summary ──────────────────────────────────────────────────────────────

router.get('/summary', (req, res) => {
  const f = parseFilters(req.query);
  if (f.error) return res.status(400).json({ error: f.error });

  const win = resolveWindow(f);
  if (!win) {
    return res.json({
      window: null, overall: null, previous: null, exchanges: [],
      best_exchange: null, worst_exchange: null, forecast: null,
    });
  }

  const scope = { ...f, start_date: win.start_date, end_date: win.end_date };
  const rows = observedDays({ from: scope.start_date, to: scope.end_date, exchange: scope.exchange, product: scope.product });
  const overall = summariseDays(rows);

  // Previous window of identical length, immediately before the current one.
  const prevEnd = shiftDate(win.start_date, -1);
  const prevStart = shiftDate(prevEnd, -(win.days - 1));
  const previous = summariseDays(observedDays({ from: prevStart, to: prevEnd, exchange: scope.exchange, product: scope.product }));
  const changePercent = previous.avg_rate && overall.avg_rate != null
    ? ((overall.avg_rate - previous.avg_rate) / previous.avg_rate) * 100
    : null;

  const exchanges = summariseBy(rows, 'exchange', EXCHANGES).map((e) => {
    const latest = rows.filter((r) => r.exchange === e.exchange && r.date === e.latest_date);
    return { ...e, latest_mcp: round2(latest.reduce((a, r) => a + r.price, 0) / (latest.length || 1)) };
  });
  const ranked = exchanges.filter((e) => e.avg_rate != null).sort((a, b) => b.avg_rate - a.avg_rate);

  // Forecast quality: the forecasting module's runs against the cleared price.
  const acc = pooledForecastAccuracy({
    from: scope.start_date, to: scope.end_date, exchange: scope.exchange, product: scope.product,
  });

  res.json({
    window: win,
    filters: { exchange: scope.exchange, product: scope.product },
    overall,
    sources: rows.reduce((acc2, r) => ({ ...acc2, [r.source]: (acc2[r.source] || 0) + 1 }), {}),
    previous: {
      window: { start_date: prevStart, end_date: prevEnd },
      observations: previous.observations,
      avg_rate: previous.avg_rate,
      change_percent: round2(changePercent),
    },
    exchanges,
    // "Best" = highest average realisation, i.e. where SJVN would have sold best.
    best_exchange: ranked[0] || null,
    worst_exchange: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    forecast: {
      observations: acc.observations,
      avg_abs_error: round2(acc.mae),
      mape_percent: round2(acc.mape),
      accuracy_percent: acc.mape == null ? null : round2(Math.max(0, 100 - acc.mape)),
    },
  });
});

// Latest price snapshot per product (DAM / RTM / GDAM) + latest REC price —
// the "Exchange Price Dashboard" header per the Power Trading Dashboard doc.
router.get('/latest-prices', (req, res) => {
  const products = PRODUCTS.map((p) => {
    // The newest observed day for the product; IEX first when exchanges tie,
    // being where most of the volume clears.
    const days = EXCHANGES
      .map((ex) => observedDays({ exchange: ex, product: p, from: latestObservedDate({ exchange: ex, product: p }) }).pop())
      .filter(Boolean)
      .sort((a, b) => (a.date === b.date ? EXCHANGES.indexOf(a.exchange) - EXCHANGES.indexOf(b.exchange) : (a.date < b.date ? 1 : -1)));
    const d = days[0];
    return d
      ? { product: p, mcp_rate: round2(d.price), energy_mwh: d.energy_mwh, date: d.date, exchange: d.exchange, source: d.source }
      : { product: p, mcp_rate: null, energy_mwh: null, date: null, exchange: null, source: null };
  });
  const rec = db.prepare(`
    SELECT sale_rate_per_rec, trade_date FROM rec_ledger
    WHERE status IN ('SOLD','LISTED') AND sale_rate_per_rec > 0
    ORDER BY COALESCE(trade_date, vintage_month) DESC, created_at DESC LIMIT 1
  `).get();
  res.json({ products, rec: { price: round2(rec?.sale_rate_per_rec), date: rec?.trade_date || null } });
});

// Time-block-wise MCP and MCV for a delivery date, per product, for one exchange —
// from block-wise prices only (exchange price files, the IEX API). Lists the
// dates that have any, so the screen offers days that exist.
router.get('/blocks', (req, res) => {
  const f = parseFilters(req.query);
  if (f.error) return res.status(400).json({ error: f.error });
  if (req.query.date && !isIsoDate(req.query.date)) return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD date' });
  res.json(blockCurves({ date: req.query.date || null, exchange: f.exchange || 'IEX' }));
});

// SJVN's bids against what cleared and against the market, block by block. A
// trading client sees its own bids only; the market price is the market's.
router.get('/bid-vs-cleared', (req, res) => {
  const product = String(req.query.product || 'DAM').toUpperCase();
  if (!/^[A-Z-]{2,10}$/.test(product)) return res.status(400).json({ error: 'product is required' });
  const exchange = req.query.exchange ? String(req.query.exchange).toUpperCase() : null;
  if (exchange && !EXCHANGES.includes(exchange)) return res.status(400).json({ error: `exchange must be one of ${EXCHANGES.join(', ')}` });
  if (req.query.date && !isIsoDate(req.query.date)) return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD date' });
  res.json(bidVsCleared(db, { product, exchange, date: req.query.date || null, scope: clientScope(req.user, 'b.client_id') }));
});

// ── Chart series ─────────────────────────────────────────────────────────────

router.get('/trend', (req, res) => {
  const f = parseFilters(req.query);
  if (f.error) return res.status(400).json({ error: f.error });

  const win = resolveWindow(f);
  if (!win) return res.json({ window: null, exchanges: [], points: [], forecast: [] });

  const scope = { ...f, start_date: win.start_date, end_date: win.end_date };
  const rows = observedDays({ from: scope.start_date, to: scope.end_date, exchange: scope.exchange, product: scope.product });

  // One point per date: each exchange's price (the mean of its products when no
  // product is chosen) and the energy that cleared where blocks say.
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, energy_mwh: null, _n: {} });
    const point = byDate.get(r.date);
    const n = point._n[r.exchange] || 0;
    point[r.exchange] = round2(((point[r.exchange] || 0) * n + r.price) / (n + 1));
    point._n[r.exchange] = n + 1;
    if (r.energy_mwh != null) point.energy_mwh = Math.round((point.energy_mwh || 0) + r.energy_mwh);
  }
  for (const point of byDate.values()) delete point._n;

  const forecastByDate = new Map();
  for (const d of pooledForecastAccuracy({
    from: scope.start_date, to: scope.end_date, exchange: scope.exchange, product: scope.product,
  }).days) {
    if (!forecastByDate.has(d.date)) forecastByDate.set(d.date, []);
    forecastByDate.get(d.date).push(d);
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const present = new Set(rows.map((r) => r.exchange));
  res.json({
    window: win,
    filters: { exchange: scope.exchange, product: scope.product },
    exchanges: EXCHANGES.filter((e) => present.has(e)),
    points: [...byDate.values()],
    forecast: [...forecastByDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, ds]) => {
      const actual = avg(ds.map((d) => d.actual));
      const forecast = avg(ds.map((d) => d.forecast));
      return { date, actual: round2(actual), forecast: round2(forecast), variance: round2(actual - forecast) };
    }),
  });
});

// ── Events & external factors ────────────────────────────────────────────────

// Events and external factors have no ingestion path — only the demo seed ever
// wrote them, and it no longer does. Until one exists this answers with whatever
// the desk's database holds, which on a fresh install is nothing.
router.get('/context', (req, res) => {
  const f = parseFilters(req.query);
  if (f.error) return res.status(400).json({ error: f.error });

  // Same default window as the rate endpoints — events and factors must line up
  // with the price trend they are meant to explain.
  const win = resolveWindow(f);
  const start = f.start_date || win?.start_date;
  const end = f.end_date || win?.end_date;

  const eventSql = ['1=1'];
  const eventParams = [];
  const factorSql = ['1=1'];
  const factorParams = [];
  if (start) {
    eventSql.push('event_date >= ?'); eventParams.push(start);
    factorSql.push('factor_date >= ?'); factorParams.push(start);
  }
  if (end) {
    eventSql.push('event_date <= ?'); eventParams.push(end);
    factorSql.push('factor_date <= ?'); factorParams.push(end);
  }

  res.json({
    window: start && end ? { start_date: start, end_date: end } : null,
    events: db.prepare(`SELECT * FROM market_events WHERE ${eventSql.join(' AND ')} ORDER BY event_date DESC LIMIT ?`)
      .all(...eventParams, MAX_ROWS),
    factors: db.prepare(`SELECT * FROM market_factors WHERE ${factorSql.join(' AND ')} ORDER BY factor_date DESC LIMIT ?`)
      .all(...factorParams, MAX_ROWS),
  });
});

// ── Price alerts ─────────────────────────────────────────────────────────────

/**
 * Latest cleared rate per product, per exchange. Alerts are evaluated on read
 * against this snapshot — no background scheduler is involved.
 */
function latestRatesByProduct() {
  const map = new Map();
  for (const product of PRODUCTS) {
    const latest = latestObservedDate({ product });
    if (!latest) continue;
    map.set(product, observedDays({ product, from: latest, to: latest })
      .map((r) => ({ product, exchange: r.exchange, rate_date: r.date, mcp_rate: r.price })));
  }
  return map;
}

/**
 * An ABOVE alert fires when ANY exchange cleared above the threshold (a selling
 * opportunity); a BELOW alert fires when ANY exchange cleared below it (a
 * buying opportunity). `last_rate` reports the exchange that drove the decision.
 */
function evaluateAlert(alert, latestByProduct) {
  const rows = latestByProduct.get(alert.product) || [];
  if (!rows.length) return { ...alert, triggered: false, last_rate: null, last_rate_exchange: null, last_rate_date: null };

  const pick = alert.condition === 'BELOW'
    ? rows.reduce((a, b) => (b.mcp_rate < a.mcp_rate ? b : a))
    : rows.reduce((a, b) => (b.mcp_rate > a.mcp_rate ? b : a));

  const hit = alert.condition === 'BELOW'
    ? pick.mcp_rate <= alert.threshold_price
    : pick.mcp_rate >= alert.threshold_price;

  return {
    ...alert,
    triggered: Boolean(alert.is_active) && hit,
    last_rate: round2(pick.mcp_rate),
    last_rate_exchange: pick.exchange,
    last_rate_date: pick.rate_date,
  };
}

router.get('/alerts', (req, res) => {
  const alerts = db.prepare('SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  const latest = latestRatesByProduct();
  res.json(alerts.map((a) => evaluateAlert(a, latest)));
});

router.post('/alerts', (req, res) => {
  const { product, condition, threshold_price } = req.body || {};
  if (!PRODUCTS.includes(product)) return res.status(400).json({ error: `product must be one of ${PRODUCTS.join(', ')}` });
  if (!CONDITIONS.includes(condition)) return res.status(400).json({ error: `condition must be one of ${CONDITIONS.join(', ')}` });
  const threshold = Number(threshold_price);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return res.status(400).json({ error: 'threshold_price must be a positive number' });
  }

  const id = newId('ALT');
  db.prepare(`
    INSERT INTO price_alerts (id, user_id, product, condition, threshold_price, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, req.user.id, product, condition, threshold);

  secureLogAudit(req, {
    action: 'CREATE_PRICE_ALERT',
    module: 'TRADING',
    entityType: 'price_alert',
    entityId: id,
    afterValue: { product, condition, threshold_price: threshold, is_active: 1 },
  });

  const alert = db.prepare('SELECT * FROM price_alerts WHERE id = ?').get(id);
  res.status(201).json(evaluateAlert(alert, latestRatesByProduct()));
});

router.patch('/alerts/:id', (req, res) => {
  const alert = db.prepare('SELECT * FROM price_alerts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  const raw = req.body?.is_active;
  const next = raw === undefined ? (alert.is_active ? 0 : 1) : (raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0);
  db.prepare('UPDATE price_alerts SET is_active = ? WHERE id = ?').run(next, alert.id);

  secureLogAudit(req, {
    action: next ? 'ACTIVATE_PRICE_ALERT' : 'DEACTIVATE_PRICE_ALERT',
    module: 'TRADING',
    entityType: 'price_alert',
    entityId: alert.id,
    beforeValue: { is_active: alert.is_active },
    afterValue: { is_active: next },
  });

  const updated = db.prepare('SELECT * FROM price_alerts WHERE id = ?').get(alert.id);
  res.json(evaluateAlert(updated, latestRatesByProduct()));
});

router.delete('/alerts/:id', (req, res) => {
  const alert = db.prepare('SELECT * FROM price_alerts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  db.prepare('DELETE FROM price_alerts WHERE id = ?').run(alert.id);
  secureLogAudit(req, {
    action: 'DELETE_PRICE_ALERT',
    module: 'TRADING',
    entityType: 'price_alert',
    entityId: alert.id,
    beforeValue: { product: alert.product, condition: alert.condition, threshold_price: alert.threshold_price },
  });

  res.json({ ok: true, id: alert.id });
});

export default router;
