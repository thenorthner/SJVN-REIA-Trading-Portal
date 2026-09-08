/**
 * Indian Energy Exchange (IEX) Front Office API integration.
 *
 * Spec: docs/Technical Document for FO API/ — IEX_DAM_API 2.2, GDAM 2.0,
 * HPDAM 2.0, RTM 2.0. The four products share one URL grammar; only the
 * leading path segment changes.
 *
 * Two pulls matter here and they are different things:
 *   portfolioschedulereport — what OUR portfolios actually cleared -> bid_blocks
 *   pqresults               — the market clearing price/qty        -> market_rates
 *
 * Bid submission is deliberately not wired to the live API: it moves real money
 * and needs a controlled test window. It stays in stub mode and refuses to
 * pretend otherwise.
 *
 * UNITS: IEX quotes prices in Rs/MWh. Everything in this platform — bid
 * price_per_unit, cleared_price, the CERC margin caps, the exposure formula —
 * is Rs/kWh. Every price crossing this boundary is converted once, here.
 *
 * SCALING: the API sends quantities and prices as flat integers that must be
 * divided by the decimal factor from the Asset Master. That factor IS the
 * divisor, not an exponent — the spec defines it as "1 : 0 Decimal Place,
 * 10 : 1 Decimal Place, 100 : 2 Decimal Place", and its worked example reads
 * "Order Display Quantity = 10.0 and Order Quantity Decimal = 10 then at API
 * Order Quantity value should be 100". So 100 / 10 = 10.0.
 *
 * DATES: the API takes and returns delivery dates as epoch SECONDS at UTC
 * midnight. IEX confirmed this by worked example on 08-09-2026: delivery date
 * T+1 came back as 1788912000, which is exactly divisible by 86400 and reads
 * as 2026-09-09T00:00:00Z. It is NOT IST midnight — that would have been
 * 1788892200, and using it would address the neighbouring trading day.
 * resolveDeliveryDate() still prefers the exchange's own value ("use the values
 * returned by the respective APIs without any modification or recalculation",
 * per IEX); the UTC-midnight computation is only the offline fallback.
 *
 * HOSTS: there is no single base URL. IEX serves each segment from its own
 * host and appends the same {product}/api/v2/... path grammar to it — their
 * own example is
 *   GET https://alphaidamapi.iexindia.com/dam/api/v2/deliverydates/USER,PARTICIPANT
 * DAM and GDAM share the iDAM host; RTM, HPDAM and REC each have their own.
 *
 * SCALING (confirmed by IEX 08-09-2026): results — including the Portfolio
 * Schedule Report — are scaled by the TRADE decimals, and in UAT that factor is
 * 100 ("Quantity or Price must be divided by 100 to get the exact quantity in
 * MW and Price in Rs/MWh").
 *
 * CAUTION for whoever wires bid submission: IEX states the SUBMIT side uses a
 * different factor from the RESULT side — "while submitting bid order Quantity
 * (MW) x 10, e.g. 5.3 MW -> 53" against divide-by-100 when reading results.
 * That asymmetry is a silent 10x waiting to happen. Submission must read its
 * own factor from the Asset Master order decimals, never reuse the trade ones.
 *
 * TOKEN: valid for six months from issue, renewed by mail 15 days before it
 * lapses. There is no login or refresh endpoint — IEX confirmed none exists.
 * The one-hour expiry on the first UAT token was, in IEX's words, a typo, so
 * the JWT `exp` claim is treated as advisory here rather than as a gate.
 *
 * NOT IMPLEMENTED: REC has a host and a document but no client yet; ESCerts
 * likewise. Bid submission stays manual.
 */
import db from '../db/index.js';
import { getParam } from '../mastersService.js';

/** IEX product code -> URL path segment, per the per-product API documents. */
const PRODUCT_PATH = { DAM: 'dam', GDAM: 'gdam', RTM: 'rtm', HPDAM: 'hpdam' };

export const SUPPORTED_PRODUCTS = Object.keys(PRODUCT_PATH);

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

/**
 * Per-segment hosts, as supplied by IEX on 08-09-2026. There is no single base
 * URL: each segment answers on its own host, with the usual {product}/api/v2/
 * path appended. DAM and GDAM share the iDAM host.
 *
 * A blank means IEX has not supplied that host — REC has no production URL in
 * their table, and asking for one is better than guessing at a name that looks
 * plausible and silently fails.
 */
export const PRODUCT_HOSTS = {
  UAT: {
    DAM: 'https://alphaidamapi.iexindia.com/',
    GDAM: 'https://alphaidamapi.iexindia.com/',
    HPDAM: 'https://alphahpdamapi.iexindia.com/',
    RTM: 'https://alphartmapi.iexindia.com/',
    REC: 'https://alpharecapi.iexindia.com/',
  },
  LIVE: {
    DAM: 'https://idamapi.iexindia.com/',
    GDAM: 'https://idamapi.iexindia.com/',
    HPDAM: 'https://hpdamapi.iexindia.com/',
    RTM: 'https://rtmapi.iexindia.com/',
    REC: '',
  },
};

/** Post-trade (Clearing & Settlement back office) — a different system entirely. */
export const CNS_HOSTS = {
  UAT: 'https://alphawebportal.iexindia.com/',
  LIVE: 'https://energx.iexindia.com/',
};

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

/**
 * Expiry of the issued token, read from the JWT itself.
 *
 * The exchange hands over an opaque credential; it happens to be a JWT whose
 * `exp` we can read without verifying the signature (we are not the verifier —
 * IEX is). Knowing the expiry lets a desk see "the token died at 15:21" instead
 * of a wall of 401s that reads like an exchange outage.
 *
 * Returns null for anything that is not a readable JWT — an opaque token is
 * valid, it just cannot be introspected.
 */
export function readTokenExpiry(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!Number.isFinite(Number(payload?.exp))) return null;
    return Number(payload.exp);
  } catch {
    return null;
  }
}

export function getIexConfig() {
  const token = envOrParam('IEX_API_TOKEN', 'iex_api_token', '');
  const loginUserId = envOrParam('IEX_LOGIN_USER_ID', 'iex_login_user_id', '');
  const participantId = envOrParam('IEX_PARTICIPANT_ID', 'iex_participant_id', '');
  // 'ALL' is the spec's own wildcard for both of these.
  const bidAreaId = envOrParam('IEX_BID_AREA_ID', 'iex_bid_area_id', 'ALL');
  const portfolioId = envOrParam('IEX_PORTFOLIO_ID', 'iex_portfolio_id', 'ALL');
  const environment = envOrParam('IEX_ENVIRONMENT', 'iex_environment', 'UAT').toUpperCase();
  const enabled = String(envOrParam('IEX_ENABLED', 'iex_enabled', 'false')) === 'true';
  // A single override still wins over the per-segment table — it is how you
  // point the whole client at a mock or at a host IEX moves without notice.
  const baseUrlOverride = envOrParam('IEX_BASE_URL', 'iex_base_url', '');
  // IEX says the token lasts six months and that the one-hour expiry on the
  // first UAT token was a typo, so a stale `exp` no longer blocks a request by
  // default. Set this to re-arm the hard refusal if their claim proves wrong.
  const enforceTokenExpiry = String(envOrParam('IEX_ENFORCE_TOKEN_EXPIRY', 'iex_enforce_token_expiry', 'false')) === 'true';

  const tokenExpiresAt = readTokenExpiry(token);
  const tokenExpired = tokenExpiresAt != null && tokenExpiresAt * 1000 <= Date.now();

  const hosts = PRODUCT_HOSTS[environment] || {};
  const baseUrlFor = (product) => baseUrlOverride || hosts[product] || '';

  return {
    enabled,
    // The host no longer has to be configured — IEX has published it, so a
    // token and a user id are all that stand between us and a live call.
    live: enabled && !!token && !!loginUserId,
    token, loginUserId, participantId, bidAreaId, portfolioId, environment,
    baseUrlOverride, baseUrlFor, hosts,
    cnsBaseUrl: CNS_HOSTS[environment] || '',
    enforceTokenExpiry,
    tokenExpiresAt,
    tokenExpiresAtIso: tokenExpiresAt ? new Date(tokenExpiresAt * 1000).toISOString() : null,
    tokenExpired,
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

/**
 * One GET against the exchange.
 *
 * An expired token is refused before the call rather than after: firing it
 * would return a 401 that is indistinguishable from a credential being revoked
 * or the exchange being down, and the desk would chase the wrong problem.
 */
async function iexGet(cfg, product, path) {
  if (cfg.tokenExpired && cfg.enforceTokenExpiry) {
    throw new Error(`IEX token expired at ${cfg.tokenExpiresAtIso} — request not sent (iex_enforce_token_expiry is on). Obtain a fresh token from the exchange and update iex_api_token.`);
  }
  const base = cfg.baseUrlFor(product);
  if (!base) {
    throw new Error(`No IEX host is configured for ${product} in ${cfg.environment}. IEX has not published one — set iex_base_url to override.`);
  }
  const url = `${base.replace(/\/$/, '')}/${path}`;
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(url, { method: 'GET', headers: iexHeaders(cfg), signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`IEX request timed out after ${timeoutMs / 1000}s: ${path}`);
    throw new Error(`IEX request failed (${path}): ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`IEX ${describeHttpError(resp.status, text)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`IEX returned a non-JSON body for ${path}: ${text.slice(0, 200)}`);
  }
}

function productPath(product) {
  const seg = PRODUCT_PATH[product];
  if (!seg) throw new Error(`IEX has no Front Office API for product ${product}. Supported: ${SUPPORTED_PRODUCTS.join(', ')}`);
  return seg;
}

/* ----------------------------------------------------------------- scaling */

/**
 * Undo the exchange's flat-integer encoding.
 *
 * `factor` is the Asset Master decimal value and is the divisor itself (1, 10,
 * 100). A missing or nonsensical factor divides by 1 rather than by zero or by
 * 10^100 — an unscaled number is wrong by a power of ten and must never be
 * produced silently, so callers get `factorUsed` back alongside the value.
 */
export const unscale = (raw, factor) => {
  const f = Number(factor);
  return Number(raw || 0) / (Number.isFinite(f) && f > 0 ? f : 1);
};

/**
 * Quantity/price decimal factors for a product, from the Asset Master. Cached
 * for the process — these track exchange configuration, not the request.
 *
 * Only successes are cached: caching a failure would pin the process to a bad
 * factor for its whole life.
 */
const decimalsCache = new Map();
export function clearDecimalsCache() { decimalsCache.clear(); }

export async function getDecimals(product) {
  if (decimalsCache.has(product)) return decimalsCache.get(product);
  const cfg = getIexConfig();
  if (!cfg.live) return { orderPrice: 1, orderQty: 1, tradePrice: 1, tradeQty: 1, source: 'DEFAULT' };

  let data;
  try {
    data = await iexGet(cfg, product, `${productPath(product)}/api/v2/master/assets/${cfg.loginUserId},${cfg.participantId}`);
  } catch (err) {
    // Do not silently assume 1 — an unscaled price is off by a power of ten.
    throw new Error(`Cannot read IEX Asset Master decimals for ${product}: ${err.message}`);
  }
  const asset = (data?.AssetDetails || data?.Assets || [])[0];
  if (!asset) throw new Error(`IEX Asset Master returned no assets for ${product}; cannot determine scaling factors.`);

  const result = {
    orderPrice: Number(asset.OrderPriceDecimal) || 1,
    orderQty: Number(asset.OrderQtyDecimal) || 1,
    // Trade decimals govern executed values; fall back to the order factors
    // when the exchange omits them rather than defaulting to unscaled.
    tradePrice: Number(asset.TradePriceDecimal) || Number(asset.OrderPriceDecimal) || 1,
    tradeQty: Number(asset.TradeQtyDecimal) || Number(asset.OrderQtyDecimal) || 1,
    assetId: asset.AssetId ?? null,
    source: 'ASSET_MASTER',
  };
  decimalsCache.set(product, result);
  return result;
}

/* ------------------------------------------------------------------- dates */

/**
 * Epoch seconds at UTC midnight of an ISO date — the fallback, not the truth.
 *
 * IEX confirmed the convention with a worked example: T+1 came back as
 * 1788912000, exactly 20705 whole days since the epoch, i.e. 2026-09-09T00:00Z.
 * An IST midnight would have been 1788892200 and would address the wrong day.
 */
export const utcMidnightEpoch = (isoDate) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || '').trim());
  if (!m) throw new Error(`Delivery date must be YYYY-MM-DD, got "${isoDate}"`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
};

/** The calendar date an epoch-seconds delivery value denotes. */
export const epochToDate = (epochSeconds) =>
  new Date(Number(epochSeconds) * 1000).toISOString().slice(0, 10);

/**
 * Delivery dates the exchange is currently trading, with their own epoch values.
 */
export async function fetchDeliveryDates(product) {
  const cfg = getIexConfig();
  if (!cfg.live) return { ok: true, mode: 'STUB', dates: null, note: stubNote(cfg) };
  try {
    const data = await iexGet(cfg, product, `${productPath(product)}/api/v2/deliverydates/${cfg.loginUserId},${cfg.participantId}`);
    const rows = data?.DeliveryDates || data?.DeliveryDateDetails || (Array.isArray(data) ? data : []);
    const dates = rows.map((r) => ({
      delivery_date_id: r.DeliveryDateId ?? null,
      epoch_seconds: Number(r.DeliveryDate),
      iso_date: Number.isFinite(Number(r.DeliveryDate)) ? epochToDate(r.DeliveryDate) : null,
    }));
    return { ok: true, mode: 'IEX', dates };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

/**
 * The epoch-seconds value the exchange itself uses for an ISO delivery date.
 *
 * Asking beats computing: the spec never states which midnight its seconds are
 * counted from, and a delivery date that is off by 5.5 hours silently returns
 * the wrong trading day. We only fall back to a computed UTC midnight when the
 * exchange cannot be asked, and the caller is told which of the two it got.
 */
export async function resolveDeliveryDate(product, isoDate) {
  const fallback = utcMidnightEpoch(isoDate);
  const listed = await fetchDeliveryDates(product);
  if (listed.ok && listed.dates) {
    const match = listed.dates.find((d) => d.iso_date === isoDate);
    if (match) return { epoch: match.epoch_seconds, source: 'EXCHANGE' };
    return {
      epoch: fallback,
      source: 'COMPUTED',
      warning: `${isoDate} is not in the exchange's open delivery dates for ${product} (${listed.dates.map((d) => d.iso_date).filter(Boolean).join(', ') || 'none returned'}); using a computed UTC midnight.`,
    };
  }
  return { epoch: fallback, source: 'COMPUTED', warning: listed.error ? `Delivery date list unavailable (${listed.error}); using a computed UTC midnight.` : undefined };
}

/* ----------------------------------------------------------------- reports */

const stubNote = (cfg) => {
  if (!cfg.enabled) return 'IEX not enabled (iex_enabled != true) — running in stub mode.';
  const missing = [
    !cfg.token && 'iex_api_token',
    !cfg.loginUserId && 'iex_login_user_id',
  ].filter(Boolean);
  return `IEX enabled but credentials incomplete (needs ${missing.join(', ')}) — running in stub mode.`;
};

/**
 * The expiry warning that rides along with a live response.
 *
 * Since a stale `exp` no longer blocks the call, it has to surface somewhere or
 * it may as well not be read at all. A 401 arriving next to this line is
 * self-explanatory; a 401 on its own is not.
 */
const expiryNote = (cfg) => (cfg.tokenExpired
  ? `The configured token's own expiry claim passed at ${cfg.tokenExpiresAtIso}. IEX states tokens last six months and that this claim was a typo, so the request was still sent — but if it came back 401, this is why.`
  : undefined);

/**
 * What our portfolios actually cleared for a delivery date, block by block.
 *
 * The exchange nests this three deep:
 *   ReportDetails[]      one per asset / bid area / participant
 *     PeriodDetails[]    the time blocks, with the AREA's price and volume
 *       ScheduleDetails[]  our own portfolios' scheduled quantity
 *
 * AreaBuyQty/AreaSellQty are the whole bid area's volume, not ours — reading
 * them as SJVN's cleared quantity would overstate every settlement by orders
 * of magnitude. Our quantity is the sum of ScheduleDetails[].Quantity.
 * Prices come back converted to Rs/kWh.
 */
export async function fetchClearedResults(product, deliveryDate) {
  const cfg = getIexConfig();
  if (!PRODUCT_PATH[product]) {
    return { ok: false, error: `IEX results are not available for product ${product}` };
  }
  if (!cfg.live) return { ok: true, mode: 'STUB', blocks: null, note: stubNote(cfg) };

  try {
    const decimals = await getDecimals(product);
    const { epoch, source, warning } = await resolveDeliveryDate(product, deliveryDate);
    const data = await iexGet(
      cfg, product,
      `${productPath(product)}/api/v2/portfolioschedulereport/${cfg.loginUserId},${cfg.participantId},${epoch},${cfg.bidAreaId},${cfg.portfolioId}`,
    );

    const blocks = [];
    for (const report of data?.ReportDetails || []) {
      for (const period of report?.PeriodDetails || []) {
        const schedules = period?.ScheduleDetails || [];
        const ourQtyRaw = schedules.reduce((sum, s) => sum + Number(s?.Quantity || 0), 0);
        blocks.push({
          from_period: period.FromPeriodId,
          to_period: period.ToPeriodId,
          bid_area: report.BidAreaId ?? null,
          cleared_mw: unscale(ourQtyRaw, decimals.tradeQty),
          cleared_price_rs_per_kwh: mwhToKwhPrice(unscale(period.AreaPrice, decimals.tradePrice)),
          area_buy_mw: unscale(period.AreaBuyQty, decimals.tradeQty),
          area_sell_mw: unscale(period.AreaSellQty, decimals.tradeQty),
          portfolios: schedules.map((s) => ({
            portfolio_id: s.PortfolioId,
            mw: unscale(s.Quantity, decimals.tradeQty),
            single_bid_mw: unscale(s.SingleBidQty, decimals.tradeQty),
            block_bid_mw: unscale(s.BlockBidQty, decimals.tradeQty),
          })),
        });
      }
    }
    return {
      ok: true,
      mode: 'IEX',
      blocks,
      delivery_date_epoch: epoch,
      delivery_date_source: source,
      scaling: { qty_factor: decimals.tradeQty, price_factor: decimals.tradePrice, source: decimals.source },
      warning: warning || expiryNote(cfg),
    };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

/**
 * Market clearing price/quantity for a delivery date — the market's own curve,
 * not our position. Feeds market_rates.
 *
 * PQDetails[] carries one entry per time block, each holding a BidAreaDetails[]
 * with a row per bid area. We take the configured bid area rather than the
 * first one the exchange happens to list; with 'ALL' configured there is no
 * single area to report, so every area comes back and the caller chooses.
 */
export async function fetchMarketPq(product, deliveryDate) {
  const cfg = getIexConfig();
  if (!PRODUCT_PATH[product]) return { ok: false, error: `No IEX PQ results for product ${product}` };
  if (!cfg.live) return { ok: true, mode: 'STUB', periods: null, note: stubNote(cfg) };

  try {
    const decimals = await getDecimals(product);
    const { epoch, source, warning } = await resolveDeliveryDate(product, deliveryDate);
    const data = await iexGet(
      cfg, product,
      `${productPath(product)}/api/v2/pqresults/${cfg.loginUserId},${cfg.participantId},${epoch}`,
    );

    const wantArea = String(cfg.bidAreaId || 'ALL').toUpperCase();
    const periods = (data?.PQDetails || []).map((p) => {
      const areas = p.BidAreaDetails || [];
      const chosen = wantArea === 'ALL'
        ? areas
        : areas.filter((a) => String(a.BidArea ?? a.BidAreaId ?? '').toUpperCase() === wantArea);
      const rows = chosen.map((a) => ({
        bid_area: a.BidArea ?? a.BidAreaId ?? null,
        mcp_rs_per_kwh: mwhToKwhPrice(unscale(a.Price, decimals.tradePrice)),
        buy_mw: unscale(a.BuyQty, decimals.tradeQty),
        sell_mw: unscale(a.SellQty, decimals.tradeQty),
      }));
      // A period's headline numbers: the single configured area, or the mean
      // price and total volume when every area is in scope.
      const prices = rows.map((r) => r.mcp_rs_per_kwh).filter(Number.isFinite);
      return {
        from_period: p.FromPeriodId,
        to_period: p.ToPeriodId,
        mcp_rs_per_kwh: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
        buy_mw: rows.reduce((a, r) => a + (r.buy_mw || 0), 0),
        sell_mw: rows.reduce((a, r) => a + (r.sell_mw || 0), 0),
        areas: rows,
      };
    });
    return {
      ok: true,
      mode: 'IEX',
      periods,
      last_updated: data?.LastUpdatedTime ?? null,
      delivery_date_epoch: epoch,
      delivery_date_source: source,
      scaling: { qty_factor: decimals.tradeQty, price_factor: decimals.tradePrice, source: decimals.source },
      warning: warning || expiryNote(cfg),
    };
  } catch (err) {
    return { ok: false, mode: 'IEX', error: err.message };
  }
}

/**
 * A cheap round trip that proves credentials, whitelisting and base URL in one
 * call — the thing you run after the exchange says "your IP is whitelisted".
 */
export async function checkConnectivity(product = 'DAM') {
  const cfg = getIexConfig();
  if (!cfg.live) return { ok: false, mode: 'STUB', reachable: false, note: stubNote(cfg) };
  const started = Date.now();
  try {
    const data = await iexGet(cfg, product, `${productPath(product)}/api/v2/businessconfig/${cfg.loginUserId},${cfg.participantId}`);
    return {
      ok: true,
      mode: 'IEX',
      reachable: true,
      product,
      base_url: cfg.baseUrlFor(product),
      elapsed_ms: Date.now() - started,
      business_date: data?.BusinessDate ?? null,
      business_date_iso: Number.isFinite(Number(data?.BusinessDate)) ? epochToDate(data.BusinessDate) : null,
      warning: expiryNote(cfg),
    };
  } catch (err) {
    return {
      ok: false, mode: 'IEX', reachable: false, product,
      base_url: cfg.baseUrlFor(product),
      elapsed_ms: Date.now() - started,
      error: err.message,
      warning: expiryNote(cfg),
    };
  }
}

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
    return {
      success: true,
      mode: 'IEX',
      blocks,
      unmatched,
      warning: live.warning,
      message: 'Results pulled from the IEX schedule report.',
    };
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
 * moving call needing a controlled test window; a half-tested version would
 * place real orders. In stub mode it returns a receipt so the internal workflow
 * can be exercised, and it refuses rather than pretending when the exchange is
 * configured as live.
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

  return {
    ok: true,
    mode: res.mode,
    rows_written: 1,
    periods: res.periods.length,
    avg_rs_per_kwh: Math.round(avg * 100) / 100,
    warning: res.warning,
  };
}
