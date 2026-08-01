/**
 * Indian Energy Exchange (IEX) Front Office API integration.
 *
 * Two pulls matter here and they are different things:
 *   portfolioschedulereport — what OUR bids actually cleared  -> bid_blocks
 *   pqresults               — the market clearing price/qty   -> market_rates
 *
 * Bid submission is deliberately not wired to the live API: it moves real money
 * and needs member credentials plus a controlled test window. It stays in stub
 * mode and refuses to pretend otherwise.
 *
 * UNITS: IEX quotes prices in Rs/MWh. Everything in this platform — bid
 * price_per_unit, cleared_price, the CERC margin caps, the exposure formula —
 * is Rs/kWh. Every price crossing this boundary is converted once, here.
 *
 * SCALING: the API sends quantities and prices as flat integers that must be
 * divided by 10^decimals, where the decimals come from the Asset Master API
 * ("Order Display Quantity = 10.0 and Order Quantity Decimal = 10 then at API
 * Order Quantity value should be 100").
 */
import db from '../db/index.js';
import { getParam } from '../mastersService.js';

/** IEX product code -> URL path segment, per the per-product API documents. */
const PRODUCT_PATH = { DAM: 'dam', GDAM: 'gdam', RTM: 'rtm', HPDAM: 'hpdam' };

/** Rs/MWh (exchange) -> Rs/kWh (this platform). */
export const mwhToKwhPrice = (rsPerMwh) => Number(rsPerMwh) / 1000;

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready at boot */ }
  return fallback;
}

export function getIexConfig() {
  const token = envOrParam('IEX_API_TOKEN', 'iex_api_token', '');
  const baseUrl = envOrParam('IEX_BASE_URL', 'iex_base_url', '');
  const loginUserId = envOrParam('IEX_LOGIN_USER_ID', 'iex_login_user_id', '');
  const participantId = envOrParam('IEX_PARTICIPANT_ID', 'iex_participant_id', '');
  const enabled = String(envOrParam('IEX_ENABLED', 'iex_enabled', 'false')) === 'true';
  return {
    enabled,
    live: enabled && !!token && !!baseUrl && !!loginUserId,
    token, baseUrl, loginUserId, participantId,
  };
}

/** Headers every IEX request carries, per the API header table in the spec. */
function iexHeaders(cfg) {
  return {
    Authentication: `Bearer ${cfg.token}`,
    UserId: cfg.loginUserId,
    ParticipantId: cfg.participantId || '',
    'Content-Type': 'application/json',
  };
}

async function iexGet(cfg, path) {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/${path}`;
  const resp = await fetch(url, { method: 'GET', headers: iexHeaders(cfg) });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`IEX HTTP ${resp.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/**
 * Quantity/price decimals for a product, from the Asset Master. Cached for the
 * process — these change with exchange configuration, not per request.
 * Falls back to 0 (no scaling) only when the master cannot be read, and says so.
 */
const decimalsCache = new Map();
export async function getDecimals(product) {
  if (decimalsCache.has(product)) return decimalsCache.get(product);
  const cfg = getIexConfig();
  let result = { priceDecimal: 0, qtyDecimal: 0, source: 'DEFAULT' };
  if (cfg.live) {
    try {
      const data = await iexGet(cfg, `${PRODUCT_PATH[product]}/api/v2/master/assets/${cfg.loginUserId},${cfg.participantId}`);
      const asset = (data?.Assets || data?.AssetDetails || [])[0] || {};
      result = {
        priceDecimal: Number(asset.OrderPriceDecimal ?? 0) || 0,
        qtyDecimal: Number(asset.OrderQuantityDecimal ?? 0) || 0,
        source: 'ASSET_MASTER',
      };
    } catch (err) {
      // Do not silently assume 0 — an unscaled price is off by powers of ten.
      throw new Error(`Cannot read IEX Asset Master decimals for ${product}: ${err.message}`);
    }
  }
  decimalsCache.set(product, result);
  return result;
}

const unscale = (raw, decimals) => Number(raw || 0) / (10 ** Number(decimals || 0));

/**
 * What our portfolio actually cleared for a delivery date, block by block.
 * Prices come back converted to Rs/kWh.
 */
export async function fetchClearedResults(product, deliveryDate) {
  const cfg = getIexConfig();
  if (!PRODUCT_PATH[product]) {
    return { ok: false, error: `IEX results are not available for product ${product}` };
  }
  if (!cfg.live) return { ok: true, mode: 'STUB', blocks: null, note: stubNote(cfg) };

  try {
    const { priceDecimal, qtyDecimal } = await getDecimals(product);
    const data = await iexGet(
      cfg,
      `${PRODUCT_PATH[product]}/api/v2/portfolioschedulereport/${cfg.loginUserId},${cfg.participantId},${deliveryDate}`,
    );
    const periods = data?.PeriodWiseScheduleReportDetails || data?.ScheduleDetails || [];
    const blocks = periods.map((p) => ({
      from_period: p.FromPeriodId,
      to_period: p.ToPeriodId,
      cleared_mw: unscale(p.AreaSellQty ?? p.AreaBuyQty ?? p.ScheduleQty, qtyDecimal),
      cleared_price_rs_per_kwh: mwhToKwhPrice(unscale(p.AreaPrice ?? p.Price, priceDecimal)),
    }));
    return { ok: true, mode: 'IEX', blocks, raw_periods: periods.length };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

/**
 * Market clearing price/quantity for a delivery date — the market's own curve,
 * not our position. Feeds market_rates.
 */
export async function fetchMarketPq(product, deliveryDate) {
  const cfg = getIexConfig();
  if (!PRODUCT_PATH[product]) return { ok: false, error: `No IEX PQ results for product ${product}` };
  if (!cfg.live) return { ok: true, mode: 'STUB', periods: null, note: stubNote(cfg) };

  try {
    const { priceDecimal, qtyDecimal } = await getDecimals(product);
    const data = await iexGet(
      cfg,
      `${PRODUCT_PATH[product]}/api/v2/pqresults/${cfg.loginUserId},${cfg.participantId},${deliveryDate}`,
    );
    const periods = (data?.PQDetails || []).map((p) => {
      const area = (p.BidAreaDetails || [])[0] || {};
      return {
        from_period: p.FromPeriodId,
        to_period: p.ToPeriodId,
        mcp_rs_per_kwh: mwhToKwhPrice(unscale(area.Price, priceDecimal)),
        buy_mw: unscale(area.BuyQty, qtyDecimal),
        sell_mw: unscale(area.SellQty, qtyDecimal),
      };
    });
    return { ok: true, mode: 'IEX', periods, last_updated: data?.LastUpdatedTime ?? null };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

const stubNote = (cfg) => (cfg.enabled
  ? 'IEX enabled but credentials incomplete (needs iex_api_token, iex_base_url, iex_login_user_id) — running in stub mode.'
  : 'IEX not enabled (iex_enabled != true) — running in stub mode.');

/**
 * Clearing outcome for a bid.
 *
 * Live: the exchange's own schedule report. Stub: a deterministic clearing
 * against a notional market price — blocks priced at or above it clear at that
 * price, the rest do not. Deterministic on purpose; random results would write
 * numbers that look real, differ every run, and cannot be reconciled.
 *
 * Prices returned are Rs/kWh, matching bid_blocks.
 */
export async function getTradeResult(bid) {
  const product = bid.product;
  const live = await fetchClearedResults(product, bid.delivery_date);

  if (live.ok && live.blocks) {
    // The exchange reports by period id; our blocks carry their own labels, so
    // pair them in order and report any it could not place.
    const ours = bid.blocks || [];
    const blocks = [];
    const unmatched = [];
    live.blocks.forEach((r, i) => {
      const target = ours[i];
      if (!target) { unmatched.push(r); return; }
      blocks.push({
        time_block: target.time_block,
        cleared_mw: r.cleared_mw,
        cleared_price_rs_per_kwh: r.cleared_price_rs_per_kwh,
      });
    });
    return { success: true, mode: 'IEX', blocks, unmatched, message: 'Results pulled from the IEX schedule report.' };
  }
  if (!live.ok) return { success: false, mode: live.mode, message: live.error };

  // ── Stub ──
  const notionalMcp = 4.10; // Rs/kWh — a plausible clearing price for the day.
  const blocks = (bid.blocks || []).map((b) => {
    const clears = Number(b.price_per_unit) >= notionalMcp;
    return {
      time_block: b.time_block,
      cleared_mw: clears ? Number(b.quantum_mw) : 0,
      cleared_price_rs_per_kwh: clears ? notionalMcp : null,
    };
  });
  return {
    success: true,
    mode: 'STUB',
    blocks,
    message: `Stub clearing at a notional MCP of Rs ${notionalMcp}/kWh — bids at or above it clear. ${live.note}`,
  };
}

/**
 * Submit a bid to the exchange.
 *
 * Live submission is intentionally not implemented. It is a two-way, money-
 * moving call needing member credentials and a controlled test window; a
 * half-tested version would place real orders. In stub mode it returns a
 * receipt so the internal workflow can be exercised, and it refuses rather
 * than pretending when the exchange is configured as live.
 */
export async function placeOrder(bid) {
  const cfg = getIexConfig();
  if (cfg.live) {
    throw new Error('Live IEX bid submission is not implemented yet. Results and market data pull are live; submission still needs a controlled rollout.');
  }
  return {
    success: true,
    mode: 'STUB',
    receiptRef: `IEX-STUB-${bid.id}-${Date.now()}`,
    message: `Recorded as submitted without contacting the exchange. ${stubNote(cfg)}`,
  };
}

/**
 * Land a day's market clearing prices into market_rates so analytics runs on
 * real observations rather than seed data. Re-running a date replaces it.
 */
export async function syncMarketRates(product, deliveryDate, { exchange = 'IEX' } = {}) {
  const res = await fetchMarketPq(product, deliveryDate);
  if (!res.ok) return { ok: false, error: res.error, mode: res.mode };
  if (!res.periods) return { ok: true, mode: 'STUB', rows_written: 0, note: res.note };

  const prices = res.periods.map((p) => p.mcp_rs_per_kwh).filter((n) => Number.isFinite(n));
  if (!prices.length) return { ok: true, mode: res.mode, rows_written: 0, note: 'No priced periods returned.' };

  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const volume = res.periods.reduce((a, p) => a + (p.sell_mw || 0), 0);
  const { newId } = await import('../util.js');

  db.transaction(() => {
    db.prepare('DELETE FROM market_rates WHERE exchange = ? AND product = ? AND rate_date = ?')
      .run(exchange, product, deliveryDate);
    db.prepare(`
      INSERT INTO market_rates (id, exchange, product, rate_date, mcp_rate, min_rate, max_rate, avg_rate, volume_mw, data_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IEX_API')
    `).run(
      newId('MKT'), exchange, product, deliveryDate,
      Math.round(avg * 100) / 100,
      Math.round(Math.min(...prices) * 100) / 100,
      Math.round(Math.max(...prices) * 100) / 100,
      Math.round(avg * 100) / 100,
      Math.round(volume),
    );
  })();

  return { ok: true, mode: res.mode, rows_written: 1, periods: res.periods.length, avg_rs_per_kwh: Math.round(avg * 100) / 100 };
}
