import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

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

function whereClause(f) {
  const sql = [];
  const params = [];
  if (f.start_date) { sql.push('rate_date >= ?'); params.push(f.start_date); }
  if (f.end_date) { sql.push('rate_date <= ?'); params.push(f.end_date); }
  if (f.exchange) { sql.push('exchange = ?'); params.push(f.exchange); }
  if (f.product) { sql.push('product = ?'); params.push(f.product); }
  return { sql: sql.length ? ` AND ${sql.join(' AND ')}` : '', params };
}

/**
 * Resolves the effective analysis window. When the caller gives no dates we
 * anchor on the newest rate we actually hold (demo data is historical, so
 * anchoring on "today" would return an empty window).
 */
function resolveWindow(f) {
  const latest = db.prepare('SELECT MAX(rate_date) d FROM market_rates').get()?.d;
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
  const w = whereClause(win ? { ...f, start_date: win.start_date, end_date: win.end_date } : f);
  const rows = db.prepare(`
    SELECT * FROM market_rates WHERE 1=1${w.sql}
    ORDER BY rate_date DESC, exchange ASC, product ASC
    LIMIT ?
  `).all(...w.params, limit);
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
  const w = whereClause(scope);

  const overall = db.prepare(`
    SELECT COUNT(*) observations, AVG(mcp_rate) avg_rate, MIN(mcp_rate) min_rate, MAX(mcp_rate) max_rate,
           SUM(COALESCE(volume_mw, 0)) total_volume_mw, MAX(rate_date) latest_date
    FROM market_rates WHERE 1=1${w.sql}
  `).get(...w.params);

  // Previous window of identical length, immediately before the current one.
  const prevEnd = shiftDate(win.start_date, -1);
  const prevStart = shiftDate(prevEnd, -(win.days - 1));
  const pw = whereClause({ ...scope, start_date: prevStart, end_date: prevEnd });
  const previous = db.prepare(`
    SELECT COUNT(*) observations, AVG(mcp_rate) avg_rate
    FROM market_rates WHERE 1=1${pw.sql}
  `).get(...pw.params);

  const changePercent = previous?.avg_rate
    ? ((overall.avg_rate - previous.avg_rate) / previous.avg_rate) * 100
    : null;

  const perExchange = db.prepare(`
    SELECT exchange, COUNT(*) observations, AVG(mcp_rate) avg_rate, MIN(mcp_rate) min_rate,
           MAX(mcp_rate) max_rate, SUM(COALESCE(volume_mw, 0)) total_volume_mw, MAX(rate_date) latest_date
    FROM market_rates WHERE exchange IS NOT NULL${w.sql}
    GROUP BY exchange ORDER BY exchange ASC
  `).all(...w.params);

  const latestStmt = db.prepare(`
    SELECT AVG(mcp_rate) mcp_rate FROM market_rates
    WHERE exchange = ? AND rate_date = ?${scope.product ? ' AND product = ?' : ''}
  `);

  const exchanges = perExchange.map((r) => ({
    exchange: r.exchange,
    observations: r.observations,
    avg_rate: round2(r.avg_rate),
    min_rate: round2(r.min_rate),
    max_rate: round2(r.max_rate),
    total_volume_mw: Math.round(r.total_volume_mw || 0),
    latest_date: r.latest_date,
    latest_mcp: round2(
      latestStmt.get(...[r.exchange, r.latest_date, ...(scope.product ? [scope.product] : [])])?.mcp_rate
    ),
  }));

  const ranked = exchanges.filter((e) => e.avg_rate != null).sort((a, b) => b.avg_rate - a.avg_rate);

  // Forecast quality: MAPE + mean absolute error of the published day-ahead
  // forecast against the cleared MCP.
  const acc = db.prepare(`
    SELECT COUNT(*) observations,
           AVG(ABS(mcp_rate - forecast_rate)) avg_abs_error,
           AVG(ABS(mcp_rate - forecast_rate) / mcp_rate) * 100 mape_percent
    FROM market_rates
    WHERE forecast_rate IS NOT NULL AND mcp_rate > 0${w.sql}
  `).get(...w.params);

  res.json({
    window: win,
    filters: { exchange: scope.exchange, product: scope.product },
    overall: {
      observations: overall.observations,
      avg_rate: round2(overall.avg_rate),
      min_rate: round2(overall.min_rate),
      max_rate: round2(overall.max_rate),
      total_volume_mw: Math.round(overall.total_volume_mw || 0),
      latest_date: overall.latest_date,
    },
    previous: {
      window: { start_date: prevStart, end_date: prevEnd },
      observations: previous?.observations || 0,
      avg_rate: round2(previous?.avg_rate),
      change_percent: round2(changePercent),
    },
    exchanges,
    // "Best" = highest average realisation, i.e. where SJVN would have sold best.
    best_exchange: ranked[0] || null,
    worst_exchange: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    forecast: {
      observations: acc?.observations || 0,
      avg_abs_error: round2(acc?.avg_abs_error),
      mape_percent: round2(acc?.mape_percent),
      accuracy_percent: acc?.mape_percent == null ? null : round2(Math.max(0, 100 - acc.mape_percent)),
    },
  });
});

// Latest price snapshot per product (DAM / RTM / GDAM) + latest REC price —
// the "Exchange Price Dashboard" header per the Power Trading Dashboard doc.
router.get('/latest-prices', (req, res) => {
  const products = PRODUCTS.map((p) => {
    const row = db.prepare(`
      SELECT mcp_rate, volume_mw, rate_date, exchange FROM market_rates
      WHERE product = ? ORDER BY rate_date DESC, created_at DESC LIMIT 1
    `).get(p);
    return { product: p, mcp_rate: round2(row?.mcp_rate), volume_mw: Math.round(row?.volume_mw || 0), date: row?.rate_date || null, exchange: row?.exchange || null };
  });
  const rec = db.prepare(`
    SELECT sale_rate_per_rec, trade_date FROM rec_ledger
    WHERE status IN ('SOLD','LISTED') AND sale_rate_per_rec > 0
    ORDER BY COALESCE(trade_date, vintage_month) DESC, created_at DESC LIMIT 1
  `).get();
  res.json({ products, rec: { price: round2(rec?.sale_rate_per_rec), date: rec?.trade_date || null } });
});

// Time-block-wise MCP vs MCV (cleared volume) for a day — intraday comparison.
router.get('/blocks', (req, res) => {
  const f = parseFilters(req.query);
  if (f.error) return res.status(400).json({ error: f.error });
  const date = (req.query.date && isIsoDate(req.query.date))
    ? req.query.date
    : db.prepare("SELECT MAX(rate_date) d FROM market_rates WHERE time_block IS NOT NULL AND time_block != 'DAILY'").get()?.d;
  if (!date) return res.json({ date: null, blocks: [] });
  let sql = `SELECT time_block, AVG(mcp_rate) mcp, SUM(COALESCE(volume_mw,0)) mcv
    FROM market_rates WHERE rate_date = ? AND time_block IS NOT NULL AND time_block != 'DAILY'`;
  const params = [date];
  if (f.exchange) { sql += ' AND exchange = ?'; params.push(f.exchange); }
  if (f.product) { sql += ' AND product = ?'; params.push(f.product); }
  sql += ' GROUP BY time_block ORDER BY time_block ASC';
  const blocks = db.prepare(sql).all(...params).map((b) => ({ time_block: b.time_block, mcp: round2(b.mcp), mcv: Math.round(b.mcv || 0) }));
  res.json({ date, blocks });
});

// ── Chart series ─────────────────────────────────────────────────────────────

router.get('/trend', (req, res) => {
  const f = parseFilters(req.query);
  if (f.error) return res.status(400).json({ error: f.error });

  const win = resolveWindow(f);
  if (!win) return res.json({ window: null, exchanges: [], points: [], forecast: [] });

  const scope = { ...f, start_date: win.start_date, end_date: win.end_date };
  const w = whereClause(scope);
  const rows = db.prepare(`
    SELECT rate_date, exchange, AVG(mcp_rate) mcp_rate, AVG(forecast_rate) forecast_rate,
           SUM(COALESCE(volume_mw, 0)) volume_mw
    FROM market_rates WHERE 1=1${w.sql}
    GROUP BY rate_date, exchange
    ORDER BY rate_date ASC
  `).all(...w.params);

  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.rate_date)) byDate.set(r.rate_date, { date: r.rate_date, volume_mw: 0 });
    const point = byDate.get(r.rate_date);
    if (r.exchange) point[r.exchange] = round2(r.mcp_rate);
    point.volume_mw = Math.round(point.volume_mw + (r.volume_mw || 0));
  }

  const forecastRows = db.prepare(`
    SELECT rate_date, AVG(mcp_rate) actual, AVG(forecast_rate) forecast
    FROM market_rates WHERE forecast_rate IS NOT NULL${w.sql}
    GROUP BY rate_date ORDER BY rate_date ASC
  `).all(...w.params);

  const present = new Set(rows.map((r) => r.exchange).filter(Boolean));
  res.json({
    window: win,
    filters: { exchange: scope.exchange, product: scope.product },
    exchanges: EXCHANGES.filter((e) => present.has(e)),
    points: [...byDate.values()],
    forecast: forecastRows.map((r) => ({
      date: r.rate_date,
      actual: round2(r.actual),
      forecast: round2(r.forecast),
      variance: round2(r.actual - r.forecast),
    })),
  });
});

// ── Events & external factors ────────────────────────────────────────────────

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
  const rows = db.prepare(`
    SELECT r.product, r.exchange, r.rate_date, r.mcp_rate
    FROM market_rates r
    WHERE r.rate_date = (SELECT MAX(m.rate_date) FROM market_rates m WHERE m.product = r.product)
  `).all();
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product)) map.set(r.product, []);
    map.get(r.product).push(r);
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
