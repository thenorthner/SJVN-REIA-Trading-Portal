#!/usr/bin/env node
/**
 * PXIL connectivity and discovery probe.
 *
 *   node backend/scripts/pxilProbe.js [fromdate] [todate]
 *
 * PXIL has answered A1–A5 (path, auth, production, IP whitelist, trailing
 * slash). Point PXIL_BASE_URL/PXIL_API_TOKEN at staging or production; each has
 * its own token and its own IP whitelist. Staging data is stale, so pass a date
 * range PXIL says it holds. What is left can be read off their responses:
 *
 *   Q2  PXIL says Member DOR and Reverse Auction take the token only in the
 *       query string, and the other four only as a Bearer header. Every
 *       endpoint is still tried both ways, so the day they upgrade the two
 *       Version 1 APIs shows up here.
 *   Q4  Does Member DOR's Total equal the sum of its Category in live data, or
 *       is the gap in their sample real?
 *   Q6  Which Format-D fields are actually populated, and how do TransactionPrice
 *       and TransactionRate relate?
 *   Q7  Is the response date order really DD-MM-YYYY? Any day above 12 proves
 *       it; the probe reports "unproven" rather than assuming.
 *   Q9  Do slots start at 00:00 or 00:15, and does a full day carry 95 or 96?
 *
 * Read-only throughout: GETs only, no writes, nothing persisted. Run it from the
 * server whose public IP PXIL whitelisted — from anywhere else every endpoint
 * reports IP_NOT_WHITELISTED, with the IP PXIL saw.
 *
 * This variant needs the repo and its node_modules, and loading pxilService
 * opens the platform database. On the deployed Windows box, prefer the
 * standalone capture tool, which needs neither:
 *
 *   node tools/pxil-probe/pxil-probe.mjs 2026-08-01 2026-09-22   (on the server)
 *   node backend/scripts/pxilAnalyse.js pxil-capture-*.json      (anywhere)
 *
 * Both print the same report — renderProbeReport is shared.
 *
 * The token is never printed, and neither is any URL — under query auth a URL
 * contains the credential, and this report is meant to be pasteable into an
 * email to PXIL.
 */
import '../src/loadEnv.js';
import { getPxilConfig, probeRequest } from '../src/services/pxilService.js';
import { buildEndpoints, renderProbeReport } from '../src/services/pxilProbeReport.js';

const [, , argFrom, argTo] = process.argv;

/** Default to a window whose days run past the 12th, so DD-MM can be proven. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 45 * 24 * 3600 * 1000);
  return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
}

const [fromdate, todate] = argFrom && argTo ? [argFrom, argTo] : defaultRange();

const cfg = getPxilConfig();
if (!cfg.token) {
  console.error('No PXIL token configured. Set PXIL_API_TOKEN in backend/.env (and PXIL_ENABLED=true), then re-run.');
  process.exit(1);
}

const meta = {
  baseUrl: cfg.baseUrl,
  fromdate,
  todate,
  portfolioId: cfg.portfolioId,
  tokenLength: cfg.token.length,
};

// Both auth styles on every endpoint, so an upgrade on PXIL's side shows up
// without anyone having to ask.
const attempts = {};
for (const ep of buildEndpoints(meta)) {
  attempts[ep.key] = {
    header: await probeRequest({ path: ep.path, params: ep.params, authStyle: 'header' }),
    query: await probeRequest({ path: ep.path, params: ep.params, authStyle: 'query' }),
  };
}

renderProbeReport({ meta, attempts });
