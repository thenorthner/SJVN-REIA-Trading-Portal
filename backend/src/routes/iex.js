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
  res.json({
    enabled: cfg.enabled,
    live: cfg.live,
    mode: cfg.live ? 'IEX' : 'STUB',
    environment: cfg.environment,
    base_url_set: !!cfg.baseUrl,
    token_present: !!cfg.token,
    token_expires_at: cfg.tokenExpiresAtIso,
    token_expired: cfg.tokenExpired,
    login_user_id: cfg.loginUserId || null,
    participant_id: cfg.participantId || null,
    bid_area_id: cfg.bidAreaId,
    portfolio_id: cfg.portfolioId,
    products: SUPPORTED_PRODUCTS,
    capabilities: {
      cleared_results: cfg.live ? 'LIVE' : 'STUB',
      market_prices: cfg.live ? 'LIVE' : 'STUB',
      // Two-way and money-moving: stays manual until a controlled rollout.
      bid_submission: 'STUB',
      // No FO API document has been supplied for these segments.
      rec: 'NOT_IMPLEMENTED',
      escerts: 'NOT_IMPLEMENTED',
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

export default router;
