/**
 * IEX REC & EC (Energy Certificates / ESCerts) API integration.
 *
 * Spec: docs/Technical Document for FO API/IEX_REC_EC_API_1.0_29June2026.pdf.
 * One document, one path prefix (`rec/api/v2/`) and one host serve BOTH
 * segments — REC and EC are told apart by the `Product` symbol, not by the URL.
 *
 * This is a separate module from iexService.js on purpose. REC/EC is a
 * different market model and, more importantly, a different wire contract:
 *
 *   1. THE HEADERS ARE NOT THE SAME. The FO API (DAM/GDAM/HPDAM/RTM) sends
 *      `UserId` and `Authentication: Bearer …`. REC/EC sends `LoginUserId` and
 *      `Authorization: Bearer …`. Reusing the FO headers here returns 401 with
 *      nothing to explain why, so they are written out separately rather than
 *      shared and parameterised.
 *   2. Scaling factors come from the PRODUCT master (`PriceDecimalLocator`,
 *      `QtyDecimalLocator`), not the Asset master's OrderQtyDecimal/…
 *   3. There are no time blocks and no delivery date. Positions are an order
 *      book and a trade book, filtered by instrument and clock time.
 *
 * UNITS: REC and EC are priced per certificate, NOT per MWh. The Rs/MWh ->
 * Rs/kWh conversion that every FO price goes through must never be applied
 * here — a certificate price divided by 1000 is meaningless. Prices are
 * returned as the exchange states them, in `price_rs` fields named to say so.
 *
 * Order entry, modification and cancellation are deliberately not implemented.
 * They move real money; the same rule as the FO client applies.
 *
 * UNRESOLVED: it is not confirmed whether the member token is shared with the
 * FO API or issued per system. The one token IEX issued to SJVN carries the
 * claim `system: TradeV2Api`. IEX_REC_API_TOKEN overrides for REC/EC if they
 * turn out to differ; otherwise the shared IEX_API_TOKEN is used.
 */
import { getParam } from '../mastersService.js';
import { PRODUCT_HOSTS, readTokenExpiry, unscale } from './iexService.js';

/**
 * The spec fixes the response timeout for every API at 40 seconds. Overridable
 * so the abort path can actually be exercised — a timeout nobody has ever seen
 * fire is a guess, not a guarantee — and so ops can tighten it if the exchange
 * turns out to hang for the full 40s under load.
 *
 * Read per request rather than captured at import: every other setting in this
 * module is resolved at call time, and a value frozen at module load cannot be
 * changed without a restart.
 */
const requestTimeoutMs = () => {
  const v = Number(envOrParam('IEX_TIMEOUT_MS', 'iex_timeout_ms', ''));
  return Number.isFinite(v) && v > 0 ? v : 40_000;
};

/** Path prefix — shared by both segments. */
const REC_PATH = 'rec/api/v2';

/** The spec's own wildcard, used for every optional filter. */
const ALL = 'ALL';

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready at boot */ }
  return fallback;
}

export function getRecConfig() {
  // REC/EC may or may not share the FO token — fall back to it, allow an override.
  const token = envOrParam('IEX_REC_API_TOKEN', 'iex_rec_api_token', '')
    || envOrParam('IEX_API_TOKEN', 'iex_api_token', '');
  const loginUserId = envOrParam('IEX_LOGIN_USER_ID', 'iex_login_user_id', '');
  const participantId = envOrParam('IEX_PARTICIPANT_ID', 'iex_participant_id', '');
  const portfolioId = envOrParam('IEX_PORTFOLIO_ID', 'iex_portfolio_id', ALL);
  const environment = envOrParam('IEX_ENVIRONMENT', 'iex_environment', 'UAT').toUpperCase();
  const enabled = String(envOrParam('IEX_ENABLED', 'iex_enabled', 'false')) === 'true';
  const baseUrlOverride = envOrParam('IEX_BASE_URL', 'iex_base_url', '');
  const enforceTokenExpiry = String(envOrParam('IEX_ENFORCE_TOKEN_EXPIRY', 'iex_enforce_token_expiry', 'false')) === 'true';

  const baseUrl = baseUrlOverride || (PRODUCT_HOSTS[environment] || {}).REC || '';
  const tokenExpiresAt = readTokenExpiry(token);
  const tokenExpired = tokenExpiresAt != null && tokenExpiresAt * 1000 <= Date.now();

  return {
    enabled,
    live: enabled && !!token && !!loginUserId && !!baseUrl,
    token, loginUserId, participantId, portfolioId, environment, baseUrl,
    enforceTokenExpiry,
    tokenExpiresAt,
    tokenExpiresAtIso: tokenExpiresAt ? new Date(tokenExpiresAt * 1000).toISOString() : null,
    tokenExpired,
  };
}

/**
 * REC/EC headers — note `LoginUserId` and `Authorization`, which differ from
 * the FO API's `UserId` and `Authentication`. See the module comment.
 */
function recHeaders(cfg) {
  return {
    Authorization: `Bearer ${cfg.token}`,
    LoginUserId: cfg.loginUserId,
    ParticipantId: cfg.participantId || '',
    'Content-Type': 'application/json',
  };
}

/**
 * Turn an upstream error body into something a desk can act on.
 *
 * Gateways answer with HTML, and dumping "<!DOCTYPE html><html><head>..." into
 * an operator's face says nothing. 403 in particular is THE expected failure
 * for this integration — IEX only serves whitelisted IPs — so it gets named
 * rather than left as a status code to look up.
 */
function describeHttpError(status, body) {
  const text = String(body || '').trim();
  const isHtml = /^<(!doctype|html)/i.test(text);
  const title = isHtml ? (text.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim() : '';
  const detail = isHtml ? (title || `${text.length} bytes of HTML`) : text.slice(0, 300);
  if (status === 403) {
    return `HTTP 403 (${detail}) — most likely this host is not whitelisted for the calling IP. IEX only serves requests from the IP registered with them.`;
  }
  if (status === 401) {
    return `HTTP 401 (${detail}) — the token was rejected. Check that it is current and issued for this environment.`;
  }
  return `HTTP ${status}: ${detail}`;
}

async function recGet(cfg, path) {
  if (cfg.tokenExpired && cfg.enforceTokenExpiry) {
    throw new Error(`IEX token expired at ${cfg.tokenExpiresAtIso} — request not sent (iex_enforce_token_expiry is on).`);
  }
  if (!cfg.baseUrl) {
    throw new Error(`No IEX REC host is configured for ${cfg.environment}. IEX published one for UAT only — set iex_base_url to override.`);
  }
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/${path}`;
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, { method: 'GET', headers: recHeaders(cfg), signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`IEX REC request timed out after ${timeoutMs / 1000}s: ${path}`);
    throw new Error(`IEX REC request failed (${path}): ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`IEX REC ${describeHttpError(resp.status, text)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`IEX REC returned a non-JSON body for ${path}: ${text.slice(0, 200)}`);
  }
}

const stubNote = (cfg) => {
  if (!cfg.enabled) return 'IEX not enabled (iex_enabled != true) — REC/EC running in stub mode.';
  const missing = [
    !cfg.token && 'iex_api_token',
    !cfg.loginUserId && 'iex_login_user_id',
    !cfg.baseUrl && `a REC host for ${cfg.environment}`,
  ].filter(Boolean);
  return `IEX REC/EC enabled but not fully configured (needs ${missing.join(', ')}) — running in stub mode.`;
};

const expiryNote = (cfg) => (cfg.tokenExpired
  ? `The configured token's own expiry claim passed at ${cfg.tokenExpiresAtIso}. IEX states tokens last six months and that this claim was a typo, so the request was still sent — but if it came back 401, this is why.`
  : undefined);

/* ----------------------------------------------------------------- scaling */

/**
 * Price/quantity decimal locators, per PRODUCT rather than per asset.
 *
 * REC and EC products can in principle carry different locators, so this is
 * keyed by product symbol and never collapsed into one process-wide factor.
 * The map is rebuilt per call of fetchProductMaster and cached from there.
 */
const productCache = new Map();
export function clearRecProductCache() { productCache.clear(); }

export async function fetchProductMaster() {
  const cfg = getRecConfig();
  if (!cfg.live) return { ok: true, mode: 'STUB', products: null, note: stubNote(cfg) };
  try {
    const data = await recGet(cfg, `${REC_PATH}/master/products/${cfg.loginUserId},${cfg.participantId}`);
    const rows = data?.ProductDetails || data?.Products || (Array.isArray(data) ? data : []);
    const products = rows.map((p) => ({
      product: p.Product,
      description: p.ProductDesc ?? null,
      instrument_name: p.InstrumentName ?? null,
      instrument_type: p.InstrumentType ?? null,
      underlying_asset: p.ULAsset ?? null,
      session: p.Session ?? null,
      qty_tick: Number(p.QtyTick) || null,
      price_tick: Number(p.PriceTick) || null,
      base_price_rs: unscale(p.BasePrice, p.PriceDecimalLocator),
      min_qty: unscale(p.MinQty, p.QtyDecimalLocator),
      trading_unit: p.TradingUnit ?? null,
      quote_unit: p.QuoteUnit ?? null,
      // Kept raw: these are the divisors every other number in the segment
      // depends on, so they must be inspectable rather than merely applied.
      price_decimal_locator: Number(p.PriceDecimalLocator) || 1,
      qty_decimal_locator: Number(p.QtyDecimalLocator) || 1,
      upper_dpr: p.HigherDPR ?? null,
      lower_dpr: p.LowerDPR ?? null,
    }));
    products.forEach((p) => productCache.set(p.product, p));
    return { ok: true, mode: 'IEX', products, warning: expiryNote(cfg) };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

/**
 * The divisors for a product symbol.
 *
 * Refuses rather than assuming 1 when the product master has not been read:
 * an unscaled certificate price is wrong by a power of ten, and REC volumes
 * are large enough that nobody would spot it by eye.
 */
async function decimalsFor(product) {
  if (productCache.has(product)) return productCache.get(product);
  const res = await fetchProductMaster();
  if (!res.ok) throw new Error(`Cannot read IEX REC product master: ${res.error}`);
  if (res.products && productCache.has(product)) return productCache.get(product);
  // 'ALL' spans products; without a single symbol there is no single factor.
  return null;
}

/** Apply a row's own product factors, or the ones we already know. */
function scaleRow(row, known) {
  const p = known || productCache.get(row.Product) || null;
  const priceF = p?.price_decimal_locator ?? 1;
  const qtyF = p?.qty_decimal_locator ?? 1;
  return { priceF, qtyF, scaled: !!p };
}

/* ------------------------------------------------------------------- books */

const path13 = (parts) => parts.map((v) => (v === undefined || v === null || v === '' ? ALL : v)).join(',');

/**
 * Orders resting or already dealt with, for REC or EC.
 *
 * Every filter defaults to the spec's own wildcard, so the no-argument call is
 * "the whole book" rather than an accidental empty result.
 */
export async function fetchOrderBook({
  instrumentName = ALL, buySell = ALL, product = ALL, userId = ALL,
  portfolioId, fromTime = ALL, toTime = ALL, orderId = 0, status = ALL,
  pageNumber = 0, pageSize = 0,
} = {}) {
  const cfg = getRecConfig();
  if (!cfg.live) return { ok: true, mode: 'STUB', orders: null, note: stubNote(cfg) };
  try {
    const known = product !== ALL ? await decimalsFor(product) : null;
    const segments = path13([
      cfg.loginUserId, cfg.participantId, instrumentName, buySell, product, userId,
      portfolioId ?? cfg.portfolioId, fromTime, toTime, orderId, status, pageNumber, pageSize,
    ]);
    const data = await recGet(cfg, `${REC_PATH}/orders/${segments}`);
    const rows = data?.OrderDetails || [];
    const orders = rows.map((o) => {
      const { priceF, qtyF, scaled } = scaleRow(o, known);
      return {
        order_id: o.OrderId,
        order_time: o.OrderTime ?? null,
        instrument_name: o.InstrumentName ?? null,
        product: o.Product ?? null,
        session: o.Session ?? null,
        side: o.BuySell === 'Buy' ? 'BUY' : o.BuySell === 'Sell' ? 'SELL' : (o.BuySell ?? null),
        // Per certificate, not per MWh — never converted to Rs/kWh.
        price_rs: unscale(o.Price, priceF),
        executed_qty: unscale(o.TotalExecutedQuantity, qtyF),
        pending_qty: unscale(o.PendingQuantity, qtyF),
        status: o.Status ?? null,
        validity: o.Validity ?? null,
        portfolio_id: o.PortfolioId ?? null,
        user_id: o.UserId ?? null,
        // The spec says "0" means success here, not an empty string.
        error: o.Error && String(o.Error) !== '0' ? o.Error : null,
        scaled,
      };
    });
    return {
      ok: true, mode: 'IEX', orders,
      total_records: data?.TotalRecord ?? orders.length,
      // A row we could not scale is reported, not silently passed off as MW.
      unscaled_rows: orders.filter((o) => !o.scaled).length,
      warning: expiryNote(cfg),
    };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

/** Executed REC/EC trades. */
export async function fetchTradeBook({
  instrumentName = ALL, buySell = ALL, product = ALL, userId = ALL,
  portfolioId, fromTime = ALL, toTime = ALL, orderId = 0, tradeId = 0,
  pageNumber = 0, pageSize = 0,
} = {}) {
  const cfg = getRecConfig();
  if (!cfg.live) return { ok: true, mode: 'STUB', trades: null, note: stubNote(cfg) };
  try {
    const known = product !== ALL ? await decimalsFor(product) : null;
    const segments = path13([
      cfg.loginUserId, cfg.participantId, instrumentName, buySell, product, userId,
      portfolioId ?? cfg.portfolioId, fromTime, toTime, orderId, tradeId, pageNumber, pageSize,
    ]);
    const data = await recGet(cfg, `${REC_PATH}/trades/${segments}`);
    const rows = data?.TradeDetails || [];
    const trades = rows.map((t) => {
      const { priceF, qtyF, scaled } = scaleRow(t, known);
      const qty = unscale(t.Quantity, qtyF);
      const price = unscale(t.TradedPrice, priceF);
      return {
        trade_id: t.TradeId,
        order_id: t.OrderId,
        trade_time: t.TradeTime ?? null,
        instrument_name: t.InstrumentName ?? null,
        product: t.Product ?? null,
        session: t.Session ?? null,
        side: t.BuySell === 'Buy' ? 'BUY' : t.BuySell === 'Sell' ? 'SELL' : (t.BuySell ?? null),
        qty,
        price_rs: price,
        value_rs: qty * price,
        portfolio_id: t.PortfolioId ?? null,
        user_id: t.UserId ?? null,
        scaled,
      };
    });
    return {
      ok: true, mode: 'IEX', trades,
      total_records: data?.TotalRecord ?? trades.length,
      unscaled_rows: trades.filter((t) => !t.scaled).length,
      warning: expiryNote(cfg),
    };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

/** A cheap round trip that proves credentials, whitelisting and host at once. */
export async function checkRecConnectivity() {
  const cfg = getRecConfig();
  if (!cfg.live) return { ok: false, mode: 'STUB', reachable: false, note: stubNote(cfg) };
  const started = Date.now();
  try {
    const data = await recGet(cfg, `${REC_PATH}/businessconfig/${cfg.loginUserId},${cfg.participantId}`);
    return {
      ok: true, mode: 'IEX', reachable: true,
      base_url: cfg.baseUrl,
      elapsed_ms: Date.now() - started,
      business_date: data?.BusinessDate ?? null,
      warning: expiryNote(cfg),
    };
  } catch (err) {
    return {
      ok: false, mode: 'IEX', reachable: false,
      base_url: cfg.baseUrl,
      elapsed_ms: Date.now() - started,
      error: err.message,
      warning: expiryNote(cfg),
    };
  }
}

/**
 * Place a REC/EC order.
 *
 * Not implemented, for the same reason FO submission is not: it is a two-way,
 * money-moving call. It refuses rather than pretending.
 */
export async function placeRecOrder() {
  throw new Error('Live IEX REC/EC order entry is not implemented. Order book, trade book and masters are read-only and available; submission needs a controlled rollout.');
}
