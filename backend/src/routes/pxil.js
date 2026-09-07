/**
 * PXIL member report APIs — read-only HTTP surface over pxilService.
 *
 * Every route is a GET that fetches and normalises; nothing here writes to the
 * database. Persistence waits until the shapes are validated against PXIL's
 * environment (see docs/PXIL_API_Clarifications_Email_Draft.md), because tables
 * built around an unconfirmed Total composition or an unconfirmed slot
 * numbering would only have to be rebuilt.
 *
 * Each response carries `mode`: STUB when we are answering from the documented
 * sample, PXIL when the bytes came from PXIL. A caller must never present STUB
 * data as settled fact, so the flag travels with the payload rather than being
 * inferred from configuration.
 */
import { Router } from 'express';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import {
  getPxilConfig,
  fetchTamGtam,
  fetchTamGtamSlotWise,
  fetchFormatD,
  fetchMemberDor,
  fetchReverseAuctionL1,
  fetchTradeMargin,
} from '../services/pxilService.js';

const router = Router();
router.use(requireAuth);

const PXIL_READ = [...ROLE_GROUPS.TRADING_ALL];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PXIL takes YYYY-MM-DD on the way in whatever it sends back. Reject anything
 * else here rather than letting a DD-MM-YYYY string reach PXIL and come back as
 * an empty report that reads like a quiet day.
 */
function readRange(req) {
  const fromdate = String(req.query.fromdate || '').trim();
  const todate = String(req.query.todate || '').trim();
  if (!fromdate || !todate) return { error: 'fromdate and todate are required (YYYY-MM-DD)' };
  if (!ISO_DATE.test(fromdate) || !ISO_DATE.test(todate)) {
    return { error: 'fromdate and todate must be YYYY-MM-DD' };
  }
  if (fromdate > todate) return { error: 'fromdate must not be after todate' };
  return { fromdate, todate };
}

/** A failed upstream call is not a bug in this service: 502, not 500. */
function send(res, result) {
  if (!result.ok) return res.status(502).json({ error: result.error, mode: result.mode });
  return res.json(result);
}

function ranged(handler) {
  return async (req, res, next) => {
    const range = readRange(req);
    if (range.error) return res.status(400).json({ error: range.error });
    try {
      send(res, await handler(range, req));
    } catch (err) {
      next(err);
    }
  };
}

/**
 * What the integration is pointed at, and whether it is live.
 *
 * The token is never returned — only whether one is present. A desk needs to
 * know it is looking at stub data; it does not need the credential to know that.
 */
router.get('/status', requireRole(...PXIL_READ), (req, res) => {
  const cfg = getPxilConfig();
  res.json({
    enabled: cfg.enabled,
    live: cfg.live,
    mode: cfg.live ? 'PXIL' : 'STUB',
    token_present: !!cfg.token,
    base_url: cfg.baseUrl,
    portfolio_id: cfg.portfolioId || null,
    // Unconfirmed with PXIL — their daily document prints the slot-wise path.
    tam_gtam_path: cfg.tamGtamPath,
    tam_gtam_path_confirmed: false,
    endpoints: [
      { key: 'tam-gtam', label: 'Billing — TAM/GTAM (daily)', ranged: true },
      { key: 'tam-gtam-slot-wise', label: 'Billing — TAM/GTAM (15-min slots)', ranged: true },
      { key: 'format-d', label: 'Format-D — scheduled transactions', ranged: true },
      { key: 'member-dor', label: 'Member DOR — day-wise obligations', ranged: true },
      { key: 'reverse-auction', label: 'Reverse Auction L1 summary (live)', ranged: false },
      { key: 'trade-margin', label: 'Trade Margin — entity, portfolio, application', ranged: true },
    ],
  });
});

router.get('/tam-gtam', requireRole(...PXIL_READ), ranged(
  ({ fromdate, todate }, req) => fetchTamGtam(fromdate, todate, { portfolioId: req.query.portfolioId }),
));

router.get('/tam-gtam/slot-wise', requireRole(...PXIL_READ), ranged(
  ({ fromdate, todate }, req) => fetchTamGtamSlotWise(fromdate, todate, { portfolioId: req.query.portfolioId }),
));

router.get('/format-d', requireRole(...PXIL_READ), ranged(
  ({ fromdate, todate }) => fetchFormatD(fromdate, todate),
));

router.get('/member-dor', requireRole(...PXIL_READ), ranged(
  ({ fromdate, todate }) => fetchMemberDor(fromdate, todate),
));

router.get('/trade-margin', requireRole(...PXIL_READ), ranged(
  ({ fromdate, todate }, req) => fetchTradeMargin(fromdate, todate, { portfolioId: req.query.portfolioId }),
));

// No date range exists upstream: this is a snapshot of whatever is open now.
router.get('/reverse-auction', requireRole(...PXIL_READ), async (req, res, next) => {
  try {
    send(res, await fetchReverseAuctionL1());
  } catch (err) {
    next(err);
  }
});

export default router;
