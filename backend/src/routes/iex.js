/**
 * IEX Front Office API — read-only HTTP surface over iexService.
 *
 * Every route here fetches and normalises; nothing writes to the database. The
 * one write path in the integration (market_rates) already lives on
 * /api/bids/iex/market-rates/sync, where it is audited alongside the rest of
 * the bidding workflow.
 *
 * Each response carries `mode`: STUB when the integration is not configured,
 * IEX when the bytes came from the exchange. A desk must never present STUB
 * data as settled fact, so the flag travels with the payload rather than being
 * inferred from configuration.
 */
import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import {
  getIexConfig,
  checkConnectivity,
  fetchDeliveryDates,
  fetchClearedResults,
  fetchMarketPq,
  getDecimals,
  SUPPORTED_PRODUCTS,
} from '../services/iexService.js';
import {
  getRecConfig,
  checkRecConnectivity,
  fetchProductMaster,
  fetchOrderBook,
  fetchTradeBook,
} from '../services/iexRecService.js';

const router = Router();
router.use(requireAuth);

const IEX_READ = [...ROLE_GROUPS.TRADING_ALL];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A failed upstream call is not a bug in this service: 502, not 500. */
function send(res, result) {
  if (!result.ok) return res.status(502).json({ error: result.error, mode: result.mode, note: result.note });
  return res.json(result);
}

function readProduct(req) {
  const product = String(req.query.product || 'DAM').trim().toUpperCase();
  if (!SUPPORTED_PRODUCTS.includes(product)) {
    return { error: `product must be one of: ${SUPPORTED_PRODUCTS.join(', ')}` };
  }
  return { product };
}

/** product + delivery date, the shape most of these reports take. */
function dated(handler) {
  return async (req, res, next) => {
    const { product, error } = readProduct(req);
    if (error) return res.status(400).json({ error });
    const date = String(req.query.date || '').trim();
    if (!ISO_DATE.test(date)) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    try {
      send(res, await handler(product, date, req));
    } catch (err) {
      next(err);
    }
  };
}

/**
 * What the integration is pointed at, and whether it is live.
 *
 * The token is never returned — only whether one is present and when it dies.
 * A desk needs to know it is looking at stub data, and needs warning before the
 * credential lapses; it does not need the credential itself to know either.
 */
router.get('/status', requireRole(...IEX_READ), (_req, res) => {
  const cfg = getIexConfig();
  const rec = getRecConfig();
  res.json({
    enabled: cfg.enabled,
    live: cfg.live,
    mode: cfg.live ? 'IEX' : 'STUB',
    environment: cfg.environment,
    // Per-segment hosts, published by IEX — not a single base URL.
    hosts: cfg.hosts,
    base_url_override: cfg.baseUrlOverride || null,
    cns_base_url: cfg.cnsBaseUrl || null,
    token_present: !!cfg.token,
    token_expires_at: cfg.tokenExpiresAtIso,
    token_expired: cfg.tokenExpired,
    // IEX puts token life at six months and called the short expiry on the
    // first UAT token a typo, so a stale claim warns rather than blocks.
    token_expiry_enforced: cfg.enforceTokenExpiry,
    login_user_id: cfg.loginUserId || null,
    participant_id: cfg.participantId || null,
    bid_area_id: cfg.bidAreaId,
    portfolio_id: cfg.portfolioId,
    products: SUPPORTED_PRODUCTS,
    rec: {
      live: rec.live,
      mode: rec.live ? 'IEX' : 'STUB',
      base_url: rec.baseUrl || null,
      // REC/EC may or may not share the FO token — IEX has not confirmed.
      token_present: !!rec.token,
    },
    capabilities: {
      cleared_results: cfg.live ? 'LIVE' : 'STUB',
      market_prices: cfg.live ? 'LIVE' : 'STUB',
      // Two-way and money-moving: stays manual until a controlled rollout.
      bid_submission: 'STUB',
      // One document and one host serve both REC and EC/ESCerts; the segments
      // are told apart by product symbol, not by URL.
      rec: rec.live ? 'LIVE' : 'STUB',
      escerts: rec.live ? 'LIVE' : 'STUB',
      rec_order_entry: 'NOT_IMPLEMENTED',
    },
  });
});

/**
 * One live round trip. This is the check to run after IEX confirms an IP is
 * whitelisted — it separates "wrong URL", "bad token" and "not whitelisted"
 * from "the report is empty today".
 */
router.get('/connectivity', requireRole(...IEX_READ), async (req, res, next) => {
  const { product, error } = readProduct(req);
  if (error) return res.status(400).json({ error });
  try {
    const result = await checkConnectivity(product);
    // A reachability probe that fails is a successful probe with a bad answer,
    // so it reports 200 with reachable:false rather than a 502.
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** Scaling factors in force for a product — what every number here is divided by. */
router.get('/decimals', requireRole(...IEX_READ), async (req, res, next) => {
  const { product, error } = readProduct(req);
  if (error) return res.status(400).json({ error });
  try {
    res.json({ product, ...(await getDecimals(product)) });
  } catch (err) {
    res.status(502).json({ error: err.message, mode: 'IEX' });
  }
});

/** Delivery dates the exchange is trading, with the epoch values it expects back. */
router.get('/delivery-dates', requireRole(...IEX_READ), async (req, res, next) => {
  const { product, error } = readProduct(req);
  if (error) return res.status(400).json({ error });
  try {
    send(res, await fetchDeliveryDates(product));
  } catch (err) {
    next(err);
  }
});

/** Market clearing price and quantity for a delivery date. */
router.get('/pq-results', requireRole(...IEX_READ), dated((product, date) => fetchMarketPq(product, date)));

/** What our own portfolios cleared for a delivery date. */
router.get('/schedule-report', requireRole(...IEX_READ), dated((product, date) => fetchClearedResults(product, date)));

/* --------------------------------------------------------------- REC / EC */

/**
 * REC and EC (ESCerts) share one API, one host and one path prefix; the
 * `product` filter is what separates the two segments. These are read-only —
 * order entry is not implemented, the same as bid submission on the FO side.
 */

router.get('/rec/connectivity', requireRole(...IEX_READ), async (_req, res, next) => {
  try {
    res.json(await checkRecConnectivity());
  } catch (err) {
    next(err);
  }
});

/** Tradable REC/EC products, with the decimal locators everything else needs. */
router.get('/rec/products', requireRole(...IEX_READ), async (_req, res, next) => {
  try {
    send(res, await fetchProductMaster());
  } catch (err) {
    next(err);
  }
});

/**
 * The spec takes clock times as HH:MM:SS or its own 'ALL' wildcard. Anything
 * else is rejected here rather than passed through to come back as an empty
 * book that reads like a quiet session.
 */
const TIME_OR_ALL = /^(ALL|([01]\d|2[0-3]):[0-5]\d:[0-5]\d)$/;

function readBookFilters(req) {
  const fromTime = String(req.query.from_time || 'ALL').trim().toUpperCase();
  const toTime = String(req.query.to_time || 'ALL').trim().toUpperCase();
  if (!TIME_OR_ALL.test(fromTime) || !TIME_OR_ALL.test(toTime)) {
    return { error: "from_time and to_time must be HH:MM:SS (24-hour) or ALL" };
  }
  const buySell = String(req.query.side || 'ALL').trim();
  if (!['ALL', 'Buy', 'Sell'].includes(buySell)) {
    return { error: 'side must be Buy, Sell or ALL' };
  }
  return {
    filters: {
      instrumentName: String(req.query.instrument || 'ALL').trim(),
      product: String(req.query.product || 'ALL').trim(),
      buySell,
      fromTime,
      toTime,
      pageNumber: Number(req.query.page || 0) || 0,
      pageSize: Number(req.query.page_size || 0) || 0,
    },
  };
}

router.get('/rec/orders', requireRole(...IEX_READ), async (req, res, next) => {
  const { filters, error } = readBookFilters(req);
  if (error) return res.status(400).json({ error });
  const status = String(req.query.status || 'ALL').trim();
  if (!['ALL', 'Pending', 'Executed', 'Rejected', 'Cancelled'].includes(status)) {
    return res.status(400).json({ error: 'status must be one of: ALL, Pending, Executed, Rejected, Cancelled' });
  }
  try {
    send(res, await fetchOrderBook({ ...filters, status }));
  } catch (err) {
    next(err);
  }
});

router.get('/rec/trades', requireRole(...IEX_READ), async (req, res, next) => {
  const { filters, error } = readBookFilters(req);
  if (error) return res.status(400).json({ error });
  try {
    send(res, await fetchTradeBook(filters));
  } catch (err) {
    next(err);
  }
});

export default router;
