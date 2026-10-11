/**
 * Power Exchange India Limited (PXIL) member API integration — Phase 1.
 *
 * Six read-only report endpoints, all GET, all date-ranged except the reverse
 * auction summary:
 *
 *   tam-gtam            Billing: day-level TAM/GTAM trades, charges, margins
 *   slot-wise           Billing: every product's trades in 15-minute slots,
 *                       with the STOA charges broken into their components
 *   format-d            Scheduled transactions with counterparties and volumes
 *   member-dor          Day-wise obligation/charges for the member
 *   reverse-auction     Live L1 summary for reverse auctions (no date range)
 *   trade-margin        Entity/portfolio/application margins, with PXIL's own
 *                       declared sums at every level
 *
 * DAM and RTM are deliberately absent: PXIL serves those over a WebSocket
 * (ws://apieastern.pxil.in/) behind a separately generated session token. That
 * is a different transport with a different lifecycle and belongs in its own
 * module once Phase 1 is signed off.
 *
 * Nothing here writes to the database. The documented samples leave two
 * questions open (see UNRESOLVED below) and inventing tables around answers we
 * do not have yet would only have to be undone. This module fetches,
 * normalises, and reports — persistence lands after validation against live
 * PXIL data.
 *
 * Without a token every call runs in stub mode against a recorded-shape sample,
 * so the mapping and its tests can be built before credentials are confirmed.
 *
 * CONFIRMED by PXIL (Gaurav Tiwari, reply to A1–A5, Sep 2026):
 *   - The daily report is at /PXILPublish/api/tam-gtam/. Every path ends in a
 *     trailing slash, exactly as the revised documents print it.
 *   - Bearer header on TAM-GTAM, slot-wise, Format-D and Trade Margin.
 *     Member DOR and Reverse Auction are still "Version 1" and take the token
 *     only as the APITokenNo query parameter, until PXIL upgrades them. The
 *     revised documents still print "Bearer Token" for those two — the email
 *     overrides them.
 *   - Production is https://dashboard.pxil.in. On a call afterwards PXIL asked
 *     for everything to be done on staging first
 *     (https://stagingmypratyaydashboard.pxil.in, same paths, its own token).
 *     Staging data is stale, so it proves connectivity and shapes, not figures.
 *
 * CHANGED by PXIL (Avadheshkumar Bari, 30 Sep 2026): the TAM-GTAM slot-wise
 * endpoint is discontinued. Its replacement is /slot-wise-quantity-and-charges/,
 * which covers every product, returns rows under SlotWiseQuantityAndCharges
 * instead of TAMGTAM, and adds ApprovalNo plus ten components of STOACharges
 * (application, operating and transmission charges). Existing keys are unchanged.
 *   - Both environments filter by source IP, separately. A caller that is not
 *     whitelisted gets HTTP 403 {"message": "Access denied. Your IP is not
 *     allowed.", "your_ip": ...} — not a 401, so it must not be read as a bad
 *     token.
 *
 * SEEN LIVE (first calls PXIL answered, production and staging, 5 Oct 2026):
 *   - An empty range is HTTP 404 {"message":"No data available","statuscode":404}
 *     on the four billing reports — not a 200 with no rows. It is an empty
 *     report and is treated as one; any other 404 is still a failure.
 *   - A range can be refused for its size (HTTP 400): Member DOR beyond 31
 *     days, and the billing reports with "Data limit exceeded: Rows are greater
 *     than or equal to 50,000". A refused range is asked again in pieces.
 *   - Member DOR and Reverse Auction answer 400 "API Token is mandatory" to a
 *     Bearer header: the query string really is the only way in.
 *   - PXIL rations calls. After about sixty requests in the day production
 *     answered every report with HTTP 429 "Request limit exceeded. Please wait
 *     for 68472 seconds" — nineteen hours. The limit itself is not documented.
 *     A 429 is remembered and nothing is sent again until the wait is over.
 *   - The `timestamp` PXIL stamps on a response is host-local and undeclared:
 *     for calls seconds apart production said 00:18 and staging 10:48, when
 *     IST was 10:48. It cannot be used as a clock.
 *
 * UNRESOLVED — see docs/PXIL_API_Clarifications_Email_Draft.md:
 *   1. Member DOR's sample Total exceeds the sum of its own Category by
 *      115386.32 (B1). Every row is checked and the gap reported, never
 *      silently absorbed.
 *   2. Slot boundaries are echoed as received. The sample's first slot starts
 *      at 00:15, so we do not know whether a day is 95 or 96 slots, nor whether
 *      a slot is labelled by its start or its end. Renumbering on a guess would
 *      shift every block by fifteen minutes.
 */
import { getParam } from '../mastersService.js';

function envOrParam(envKey, paramKey, fallback = '') {
  if (process.env[envKey]) return process.env[envKey];
  try {
    const v = getParam(paramKey, null);
    if (v != null && v !== '') return String(v);
  } catch { /* masters may not be ready at boot */ }
  return fallback;
}

export function getPxilConfig() {
  const token = envOrParam('PXIL_API_TOKEN', 'pxil_api_token', '');
  const baseUrl = envOrParam('PXIL_BASE_URL', 'pxil_base_url', 'https://dashboard.pxil.in');
  const portfolioId = envOrParam('PXIL_PORTFOLIO_ID', 'pxil_portfolio_id', '');
  const enabled = String(envOrParam('PXIL_ENABLED', 'pxil_enabled', 'false')) === 'true';
  return {
    enabled,
    live: enabled && !!token && !!baseUrl,
    token, baseUrl, portfolioId,
  };
}

function stubNote(cfg) {
  if (!cfg.enabled) return 'PXIL integration is off (set pxil_enabled) — returning a sample of the documented response shape.';
  if (!cfg.token) return 'PXIL token missing (set pxil_api_token) — returning a sample of the documented response shape.';
  return 'PXIL not configured — returning a sample of the documented response shape.';
}

/* ------------------------------------------------------------------ dates */

/**
 * PXIL sends dates back in two different orders, and the request format is a
 * third. The year's position disambiguates ISO from the rest; between DD-MM and
 * MM-DD the documents and Indian convention both say day first.
 *
 * Returns ISO (YYYY-MM-DD), or null for a blank/unparseable value — an empty
 * string is normal in these payloads and is not an error.
 */
export function parsePxilDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const datePart = s.split(' ')[0];

  const iso = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return datePart;

  const dmy = datePart.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** `"06-01-2026 16:44:59.529"` -> `"2026-01-06T16:44:59.529"`. Null if unparseable. */
export function parsePxilTimestamp(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const date = parsePxilDate(s);
  if (!date) return null;
  const time = s.split(' ')[1];
  return time ? `${date}T${time}` : date;
}

/**
 * Does a batch of DD-MM-YYYY strings actually prove day-first ordering?
 *
 * Any first component above 12 can only be a day. Until one shows up, DD-MM and
 * MM-DD are indistinguishable and a wrong reading silently shifts settlement
 * periods for the first twelve days of every month. This lets a sync report
 * "unconfirmed" instead of quietly assuming.
 */
export function dayFirstConfirmed(values) {
  return (values || []).some((v) => {
    const m = String(v || '').trim().match(/^(\d{2})-(\d{2})-(\d{4})/);
    return !!m && Number(m[1]) > 12;
  });
}

/* -------------------------------------------------------------- envelopes */

/**
 * PXIL's answer for a range with nothing in it, as sent by TAM-GTAM, slot-wise,
 * Format-D and Trade Margin on 5 Oct 2026:
 *
 *   HTTP 404 {"message":"No data available","statuscode":404,"timestamp":"..."}
 *
 * The message is matched as well as the code, so a 404 that says anything else
 * — a mistyped path, a retired endpoint — is never mistaken for a quiet period.
 */
export function noDataAvailable(payload) {
  return !!payload && Number(payload.statuscode) === 404
    && /no data/i.test(String(payload.message || ''));
}

/**
 * A range PXIL will not serve in one call. Two refusals, both HTTP 400, both
 * seen on 5 Oct 2026:
 *
 *   Member DOR       "The difference between From Date and To Date cannot exceed 31 days"
 *   billing reports  "Data limit exceeded: Rows are greater than or equal to 50,000.
 *                     Please reduce the date range"
 *
 * Returns PXIL's message, or null when the payload is anything else.
 */
export function rangeRefused(payload) {
  const message = String(payload?.message || '');
  return /cannot exceed \d+ days|data limit exceeded/i.test(message) ? message : null;
}

/**
 * PXIL's request limit, as met on production on 5 Oct 2026:
 *
 *   HTTP 429 {"message":"Request limit exceeded. Please wait for 68472 seconds and try again."}
 *
 * Returns the seconds PXIL said to wait — null when it did not say, as on
 * Member DOR — or undefined when the response is not a rate limit at all.
 */
export function rateLimitWait(status, text) {
  if (status !== 429) return undefined;
  const m = String(text || '').match(/wait for (\d+) seconds/i);
  return m ? Number(m[1]) : null;
}

/** How long to stay away when PXIL answers 429 without saying for how long. */
const UNSTATED_WAIT_MS = 15 * 60 * 1000;

// When PXIL will answer again. While this is in the future no request is sent:
// every one would be refused, and nothing says a refused call is not counted.
let blockedUntil = 0;

/** The moment PXIL's request limit lifts (epoch ms), or null when we are not shut out. */
export function pxilBlockedUntil() {
  return Date.now() < blockedUntil ? blockedUntil : null;
}

/** Forget a remembered request limit — once PXIL confirms it has been lifted, and in tests. */
export function clearPxilBlock() {
  blockedUntil = 0;
}

const istTime = (ms) => `${new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST`;

function rateLimitError(name) {
  return Object.assign(
    new Error(`PXIL ${name}: PXIL's request limit is used up — it will not answer again before ${istTime(blockedUntil)}`),
    { rateLimited: true },
  );
}

/**
 * The three document sets wrap their payload three different ways. Normalise to
 * one shape so callers do not each re-learn the differences.
 *
 * A 200 carrying an empty body is a normal outcome — PXIL has no trades on a
 * non-trading day — so `ok` reflects the status code, and emptiness is left for
 * the caller to read off the payload. The billing reports say the same thing a
 * second way, as a 404 "No data available"; that is `ok` too, with a null body
 * and `empty` set.
 */
export function normaliseEnvelope(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: null, message: 'Empty or non-JSON response', body: null };
  }

  // Reverse auction: flat, no wrapper.
  if (payload.statuscode !== undefined || (payload.data !== undefined && payload.ResponseBody === undefined)) {
    const code = payload.statuscode;
    const empty = noDataAvailable(payload);
    return {
      ok: Number(code) === 200 || empty,
      empty,
      code: code ?? null,
      message: payload.message ?? null,
      body: payload.data ?? null,
      timestamp: parsePxilTimestamp(payload.timestamp),
    };
  }

  const status = payload.ResponseStatus || {};
  // TAM-GTAM / Format-D / Trade Margin use Code+Message; Member DOR uses
  // StatusCode+StatusMessage. Codes arrive as "CNSAPI-200" or "200".
  const rawCode = status.Code ?? status.StatusCode ?? null;
  const message = status.Message ?? status.StatusMessage ?? null;
  const numeric = String(rawCode ?? '').match(/(\d{3})\s*$/);

  return {
    ok: numeric ? numeric[1] === '200' : false,
    code: rawCode,
    message,
    body: payload.ResponseBody ?? null,
  };
}

/** First present key of several spellings. PXIL spells some keys two ways. */
export function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ------------------------------------------------------------------ fetch */

/**
 * Endpoints and how each authenticates.
 *
 * `auth: 'query'` puts the token in the query string. PXIL has confirmed that
 * Member DOR and Reverse Auction accept nothing else until their Version 1 APIs
 * are upgraded. A token in a URL lands in access logs and proxy logs, so
 * callers must keep these URLs out of logs; move both to the header once PXIL
 * says the upgrade is live.
 */
const AUTH_HEADER = 'header';
const AUTH_QUERY = 'query';

function endpointPath(name) {
  switch (name) {
    case 'tam-gtam': return 'tam-gtam';
    case 'slot-wise': return 'slot-wise-quantity-and-charges';
    case 'format-d': return 'format-d';
    case 'member-dor': return 'member-dor';
    case 'reverse-auction': return 'reverse-auction/l1-summary';
    case 'trade-margin': return 'trade-margin';
    default: throw new Error(`Unknown PXIL endpoint: ${name}`);
  }
}

async function pxilGet(name, params, authStyle) {
  if (pxilBlockedUntil()) throw rateLimitError(name);
  const cfg = getPxilConfig();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }

  const headers = { Accept: 'application/json' };
  if (authStyle === AUTH_QUERY) search.set('APITokenNo', cfg.token);
  else headers.Authorization = `Bearer ${cfg.token}`;

  const path = endpointPath(name);
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/PXILPublish/api/${path}/?${search.toString()}`;

  // Bound the call: a desk screen should not wait on PXIL indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let resp;
  let text;
  try {
    resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    text = await resp.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`PXIL ${name}: no response in 30s`);
    }
    throw new Error(`PXIL ${name}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const ip = ipNotAllowed(resp.status, text);
    if (ip) throw new Error(`PXIL ${name}: this server's IP (${ip}) is not whitelisted with PXIL`);
    const wait = rateLimitWait(resp.status, text);
    if (wait !== undefined) {
      blockedUntil = Date.now() + (wait === null ? UNSTATED_WAIT_MS : wait * 1000);
      throw rateLimitError(name);
    }
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON — falls through to the error below */ }
    // An empty range arrives as a 404 with a body; hand it on as the report it is.
    if (noDataAvailable(body)) return body;
    // Too large to serve in one call is something the caller can act on.
    if (rangeRefused(body)) {
      throw Object.assign(new Error(`PXIL ${name}: ${rangeRefused(body)}`), { rangeRefused: true });
    }
    // The token may be in the query string; never echo the URL into an error.
    throw new Error(`PXIL ${name} HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`PXIL ${name}: response was not JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * PXIL's gateway refuses an unlisted source IP with a 403 that names the IP it
 * saw. Returns that IP (or 'unknown'), or null when this is some other error.
 */
export function ipNotAllowed(status, text) {
  if (status !== 403) return null;
  try {
    const body = JSON.parse(text);
    if (/IP is not allowed/i.test(String(body?.message || ''))) return body.your_ip || 'unknown';
  } catch { /* not the gateway's JSON */ }
  return null;
}

/** Run a live call or fall back to the recorded sample, uniformly. */
async function fetchOrStub(name, params, authStyle, stubFactory) {
  const cfg = getPxilConfig();
  if (!cfg.live) {
    return { ok: true, mode: 'STUB', raw: stubFactory(params), note: stubNote(cfg) };
  }
  try {
    return { ok: true, mode: 'PXIL', raw: await pxilGet(name, params, authStyle) };
  } catch (err) {
    return { ok: false, mode: 'PXIL', error: err.message, rangeRefused: !!err.rangeRefused };
  }
}

const dateParams = (fromdate, todate, extra = {}) => ({
  fromdate, todate, reportType: 'JSON', ...extra,
});

const DAY_MS = 24 * 3600 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Consecutive, non-overlapping [from, to] windows of at most `windowDays` days covering the range. */
export function splitDateRange(fromdate, todate, windowDays) {
  const end = Date.parse(`${todate}T00:00:00Z`);
  const windows = [];
  for (let start = Date.parse(`${fromdate}T00:00:00Z`); start <= end; start += windowDays * DAY_MS) {
    windows.push([isoDay(start), isoDay(Math.min(start + (windowDays - 1) * DAY_MS, end))]);
  }
  // An unparseable date yields nothing; send it as given and let PXIL refuse it.
  return windows.length ? windows : [[fromdate, todate]];
}

/** A range cut into two halves, in date order. */
export function halveDateRange(fromdate, todate) {
  const start = Date.parse(`${fromdate}T00:00:00Z`);
  const days = Math.round((Date.parse(`${todate}T00:00:00Z`) - start) / DAY_MS) + 1;
  const mid = start + (Math.ceil(days / 2) - 1) * DAY_MS;
  return [[fromdate, isoDay(mid)], [isoDay(mid + DAY_MS), todate]];
}

/**
 * The most calls one report may cost. PXIL shut us out for a day after about
 * sixty, so a single click on a desk screen must never spend more than a
 * fraction of that: a range that needs more is the user's to narrow.
 */
const MAX_RANGE_CALLS = 12;

/**
 * A ranged report, in as few calls as PXIL will accept.
 *
 * The 50,000-row limit is on rows, not days, so no window can be worked out up
 * front: a refused range is halved and each half asked again, down to a single
 * day. Member DOR's limit is on days and known, so it starts in windows of that
 * size (`windowDays`).
 *
 * Resolves to the envelopes in date order. A stub is asked once — the sample
 * is one fixed shape however wide the range.
 */
async function fetchRanged(name, label, fromdate, todate, { extra, authStyle, stub, windowDays } = {}) {
  const queue = getPxilConfig().live && windowDays
    ? splitDateRange(fromdate, todate, windowDays)
    : [[fromdate, todate]];
  const envelopes = [];
  let mode;
  let note;
  let calls = 0;
  while (queue.length) {
    const [from, to] = queue.shift();
    calls += 1;
    if (calls > MAX_RANGE_CALLS) {
      return {
        ok: false,
        mode,
        error: `PXIL ${label}: ${fromdate} to ${todate} needs more than ${MAX_RANGE_CALLS} calls at the size PXIL allows — choose a shorter period`,
      };
    }
    const res = await fetchOrStub(name, dateParams(from, to, extra), authStyle, () => stub(from));
    if (!res.ok) {
      if (res.rangeRefused && from < to) {
        queue.unshift(...halveDateRange(from, to));
        continue;
      }
      // Once the range has been cut up, say which piece failed.
      const piece = from === fromdate && to === todate ? '' : ` (${from} to ${to})`;
      return { ok: false, mode: res.mode, error: `${res.error}${piece}` };
    }
    const env = normaliseEnvelope(res.raw);
    if (!env.ok) return { ok: false, mode: res.mode, error: `PXIL ${label}: ${env.code} ${env.message}` };
    envelopes.push(env);
    mode = res.mode;
    note = res.note;
  }
  return {
    ok: true,
    mode,
    note,
    envelopes,
    // The code of a piece that had something in it, if any did.
    code: (envelopes.find((e) => !e.empty) || envelopes[envelopes.length - 1]).code,
    windows: envelopes.length,
  };
}

/**
 * Rows PXIL sent in more than one piece of a cut-up range.
 *
 * Nothing says a report cannot return an application whose delivery period
 * straddles two pieces in both of them, and anyone totalling the table would
 * then count it twice. So repeats are counted and reported — never dropped,
 * because which copy is the row is PXIL's to say.
 */
function repeatsAcross(batches) {
  const seen = new Set();
  let repeated = 0;
  for (const batch of batches) {
    const keys = batch.map((row) => JSON.stringify(row));
    repeated += keys.filter((k) => seen.has(k)).length;
    for (const k of keys) seen.add(k);
  }
  return repeated;
}

/* -------------------------------------------------------------- TAM-GTAM */

/** The money PXIL attaches to one application, keyed alike in the daily and slot-wise reports. */
function applicationMoney(app) {
  return {
    invoice: num(app.Invoice),
    stoa_charges: num(app.STOACharges),
    pxil_fees: num(app.PXILFees),
    igst: num(app.IGST),
    sgst: num(app.SGST),
    cgst: num(app.CGST),
    ugst: num(app.UGST),
    total_payin_payout: num(app.TotalPayinPayout),
    // Spelled "InitialMargin(PostTradeMargin)" in the daily and trade-margin
    // documents, "InitialMargin(Post-Trade Margin)" in the slot-wise one.
    initial_margin: num(pick(app, 'InitialMargin(PostTradeMargin)', 'InitialMargin(Post-Trade Margin)')),
    delivery_margin: num(app.DeliveryMargin),
    applicable_margin: num(app.ApplicableMargin),
    balance_margin: num(app.BalanceMargin),
    margin_release: num(app.MarginRelease),
  };
}

/**
 * Day-level TAM/GTAM billing rows, flattened to one row per application.
 *
 * Charges arrive per application; nothing is summed across applications here
 * because buy and sell legs share the shape and netting them is a settlement
 * decision, not a parsing one.
 */
export function extractTamGtam(body) {
  const rows = [];
  for (const entity of body?.TAMGTAM || []) {
    for (const app of entity.Applications || []) {
      rows.push({
        trade_date: parsePxilDate(entity.Date),
        entity_id: entity.EntityId ?? null,
        entity_name: entity.EntityName ?? null,
        application_no: app.ApplicationNo ?? null,
        portfolio_id: app.PortfolioId ?? null,
        portfolio_name: app.PortfolioName ?? null,
        symbol: app.Symbol ?? null,
        source_type: app.SourceType ?? null,
        source: app.Source ?? null,
        side: app.BuySell ?? null,
        product_code: app.ProductCode ?? null,
        obligation_no: app.ObligationNo ?? null,
        delivery_date: parsePxilDate(app.DeliveryDate),
        delivery_start_date: parsePxilDate(app.DeliveryStartDate),
        delivery_end_date: parsePxilDate(app.DeliveryEndDate),
        price_rs_per_mwh: num(app.PriceRsMWh),
        traded_qty_mwh: num(app.TradedQtyMWh),
        trade_value: num(app.TradeValue),
        ...applicationMoney(app),
      });
    }
  }
  return rows;
}

export async function fetchTamGtam(fromdate, todate, { portfolioId } = {}) {
  const res = await fetchRanged('tam-gtam', 'TAM-GTAM', fromdate, todate, {
    extra: { portfolioId: portfolioId ?? getPxilConfig().portfolioId },
    authStyle: AUTH_HEADER,
    stub: stubTamGtam,
  });
  if (!res.ok) return res;

  const batches = res.envelopes.map((env) => extractTamGtam(env.body));
  return {
    ok: true,
    mode: res.mode,
    code: res.code,
    rows: batches.flat(),
    date_order_confirmed: dayFirstConfirmed(
      res.envelopes.flatMap((env) => (env.body?.TAMGTAM || []).map((e) => e.Date)),
    ),
    windows: res.windows,
    repeated_across_windows: repeatsAcross(batches),
    note: res.note,
  };
}

/* -------------------------------------------------------------- slot-wise */

/**
 * Slot rows, kept exactly as PXIL labels them.
 *
 * MWh is echoed rather than recomputed as MW/4: if the two ever disagree that
 * is a fact worth seeing, not one to paper over. `mwh_matches_mw` says whether
 * they agree, so a sync can flag it.
 */
export function extractSlots(app, key) {
  return (app[key] || []).map((slot) => {
    const mw = num(slot.Mw);
    const mwh = num(slot.Mwh);
    return {
      from_time: slot.fromTime ?? null,
      to_time: slot.toTime ?? null,
      mw,
      mwh,
      mwh_matches_mw: Math.abs(mwh - mw / 4) < 1e-6,
    };
  });
}

/**
 * The ten components PXIL breaks STOACharges into, in the document's order.
 * DE is how the document spells it; its expansion is not given.
 */
const STOA_COMPONENTS = [
  ['application_nldc', 'ApplicationNLDCCharges'],
  ['application_rldc', 'ApplicationRLDCCharges'],
  ['application_sldc', 'ApplicationSLDCCharges'],
  ['operating_de', 'OperatingDECharges'],
  ['operating_nldc', 'OperatingNLDCCharges'],
  ['operating_rldc', 'OperatingRLDCCharges'],
  ['operating_sldc', 'OperatingSLDCCharges'],
  ['transmission_det', 'TransmissionDETCharges'],
  ['transmission_state', 'TransmissionStateTCharges'],
  ['transmission_zonal', 'TransmissionZonalTCharges'],
];

/**
 * STOACharges against the sum of its own components.
 *
 * PXIL describes the new keys as a breakup of STOA charges but does not say
 * they sum to it, and their DOR sample already has a Total that its parts do
 * not reach. So the gap is computed and carried, never absorbed. When PXIL
 * sends none of the keys, `reconciles` is null: no breakup is not a mismatch.
 */
export function extractStoaBreakup(app) {
  const present = STOA_COMPONENTS.some(([, key]) => app[key] !== undefined && app[key] !== null);
  const components = Object.fromEntries(STOA_COMPONENTS.map(([name, key]) => [name, num(app[key])]));
  const componentSum = Object.values(components).reduce((a, b) => a + b, 0);
  // Money: compare in paise, not to a float epsilon.
  const variance = Math.round((num(app.STOACharges) - componentSum) * 100) / 100;
  return {
    present,
    components,
    component_sum: Math.round(componentSum * 100) / 100,
    variance: present ? variance : null,
    reconciles: present ? Math.abs(variance) < 0.01 : null,
  };
}

export function extractSlotWise(body) {
  const rows = [];
  for (const entity of body?.SlotWiseQuantityAndCharges || []) {
    for (const app of entity.Applications || []) {
      const trade = extractSlots(app, 'TradeSlotWiseDetails');
      const scheduled = extractSlots(app, 'ScheduledSlotWiseDetails');
      rows.push({
        trade_date: parsePxilDate(entity.Date),
        entity_id: entity.EntityId ?? null,
        entity_name: entity.EntityName ?? null,
        application_no: app.ApplicationNo ?? null,
        approval_no: app.ApprovalNo ?? null,
        portfolio_id: app.PortfolioId ?? null,
        source_type: app.SourceType ?? null,
        source: app.Source ?? null,
        side: app.BuySell ?? null,
        product_code: app.ProductCode ?? null,
        delivery_date: parsePxilDate(app.DeliveryDate),
        price_rs_per_mwh: num(app.PriceRsMWh),
        traded_qty_mwh: num(app.TradedQtyMWh),
        trade_value: num(app.TradeValue),
        scheduling_requested_invoice_qty_mwh: num(app.SchedulingRequestedInvoiceQtyMWH),
        total_scheduled_accepted_invoice_qty_mwh: num(app.TotalScheduledAcceptedInvoiceQtyMWH),
        real_time_curtailment_mwh: num(app.RealTimeCurtailmentMWH),
        final_scheduled_qty_mwh: num(app.FinalscheduledQtyMWH),
        ...applicationMoney(app),
        stoa_breakup: extractStoaBreakup(app),
        trade_slots: trade,
        scheduled_slots: scheduled,
        // See UNRESOLVED #2: the sample's first slot starts at 00:15, so we
        // report the count instead of asserting a 96-block day.
        trade_slot_count: trade.length,
        scheduled_slot_count: scheduled.length,
        slot_mwh_mismatches: [...trade, ...scheduled].filter((s) => !s.mwh_matches_mw).length,
      });
    }
  }
  return rows;
}

export async function fetchSlotWise(fromdate, todate, { portfolioId } = {}) {
  const res = await fetchRanged('slot-wise', 'slot-wise', fromdate, todate, {
    extra: { portfolioId: portfolioId ?? getPxilConfig().portfolioId },
    authStyle: AUTH_HEADER,
    stub: stubSlotWise,
  });
  if (!res.ok) return res;

  const batches = res.envelopes.map((env) => extractSlotWise(env.body));
  const rows = batches.flat();
  return {
    ok: true,
    mode: res.mode,
    code: res.code,
    rows,
    stoa_unreconciled_count: rows.filter((r) => r.stoa_breakup.reconciles === false).length,
    windows: res.windows,
    repeated_across_windows: repeatsAcross(batches),
    note: res.note,
  };
}

/* --------------------------------------------------------------- Format-D */

export function extractFormatD(body) {
  return (body?.Trades || []).map((t) => ({
    application_no: t.ApplicationNo || null,
    product: t.Product || null,
    start_date: parsePxilDate(t.StartDate),
    end_date: parsePxilDate(t.EndDate),
    start_time: t.StartTime || null,
    end_time: t.EndTime || null,
    scheduled_volume: num(t.ScheduledVolume),
    seller_name: t.SellerName || null,
    seller_state: t.SellerState || null,
    buyer_name: t.BuyerName || null,
    buyer_state: t.BuyerState || null,
    transaction_price: num(t.TransactionPrice),
    transaction_rate: num(t.TransactionRate),
  }));
}

export async function fetchFormatD(fromdate, todate) {
  const res = await fetchRanged('format-d', 'Format-D', fromdate, todate, {
    authStyle: AUTH_HEADER,
    stub: stubFormatD,
  });
  if (!res.ok) return res;

  const batches = res.envelopes.map((env) => extractFormatD(env.body));
  const rows = batches.flat();
  // PXIL declares its own count on each call; across a cut-up range they add.
  const counts = res.envelopes.map((env) => env.body?.TotalCount).filter((c) => c !== undefined && c !== null);
  const declared = counts.length ? counts.reduce((a, c) => a + Number(c), 0) : null;
  return {
    ok: true,
    mode: res.mode,
    code: res.code,
    rows,
    // A mismatch means we lost rows in paging or parsing.
    total_count_declared: declared,
    total_count_matches: declared === null || declared === rows.length,
    windows: res.windows,
    repeated_across_windows: repeatsAcross(batches),
    note: res.note,
  };
}

/* ------------------------------------------------------------- Member DOR */

/**
 * Day-wise obligations.
 *
 * The document's own sample has Total exceeding the sum of Category by
 * 115386.32 (UNRESOLVED #1). Rather than trust one number over the other, every
 * row carries both and the gap between them. A caller reconciling against our
 * books must decide what to do with a row where `total_reconciles` is false —
 * it must never be silently posted.
 */
export function extractDor(body) {
  return (body?.DOR || []).map((d) => {
    const c = d.Category || {};
    const category = {
      charges: num(c.Charges),
      fees: num(c.Fees),
      igst: num(c.IGST),
      cgst: num(c.CGST),
      sgst: num(c.SGST),
      cp: num(c.CP),
    };
    const componentSum = Object.values(category).reduce((a, b) => a + b, 0);
    const total = num(d.Total);
    // Money: compare in paise, not to a float epsilon.
    const variance = Math.round((total - componentSum) * 100) / 100;
    return {
      application_no: d.ApplicationNo ?? null,
      portfolio_id: d.PortfolioID ?? null,
      portfolio_name: d.PortfolioName ?? null,
      side: d.BuySell ?? null,
      delivery_date_from: parsePxilDate(d.delivery_date_from),
      delivery_date_to: parsePxilDate(d.delivery_date_to),
      category,
      component_sum: Math.round(componentSum * 100) / 100,
      total,
      total_variance: variance,
      total_reconciles: Math.abs(variance) < 0.01,
    };
  });
}

/**
 * Member DOR refuses a wide range: HTTP 400 "The difference between From Date
 * and To Date cannot exceed 31 days" (production and staging, 5 Oct 2026).
 * Whether that difference counts both end days is not stated, so a window is 31
 * calendar days inclusive, which is within the limit on either reading.
 */
export const DOR_WINDOW_DAYS = 31;

export async function fetchMemberDor(fromdate, todate) {
  const res = await fetchRanged('member-dor', 'Member DOR', fromdate, todate, {
    authStyle: AUTH_QUERY,
    stub: stubDor,
    windowDays: DOR_WINDOW_DAYS,
  });
  if (!res.ok) return res;

  const batches = res.envelopes.map((env) => extractDor(env.body));
  const rows = batches.flat();
  const unreconciled = rows.filter((r) => !r.total_reconciles);
  return {
    ok: true,
    mode: res.mode,
    code: res.code,
    rows,
    windows: res.windows,
    repeated_across_windows: repeatsAcross(batches),
    unreconciled_count: unreconciled.length,
    unreconciled: unreconciled.map((r) => ({
      application_no: r.application_no,
      component_sum: r.component_sum,
      total: r.total,
      variance: r.total_variance,
    })),
    note: res.note,
  };
}

/* ---------------------------------------------------------- Reverse auction */

/**
 * Live L1 summary. No date range exists on this endpoint, so this is a snapshot
 * of whatever is open right now and cannot be backfilled — a caller that needs
 * history has to record each poll.
 */
export function extractReverseAuction(data) {
  return (data || []).map((a) => ({
    auction_id: a.auctionID ?? null,
    buyer: a.buyer ?? null,
    // Named deliveryMonth but carries a full date in the sample.
    delivery_month: parsePxilDate(a.deliveryMonth),
    auction_quantity: num(a.auctionQuantity),
    type: a.type ?? null,
    remaining_time: a.remainingTime ?? null,
    l1: num(a.L1),
    last_update: parsePxilTimestamp(a.lastUpdate),
    auction_close_time: parsePxilTimestamp(a.auctionCloseTime),
    sellers: (a.sellerData || []).map((s) => ({
      seller_id: s.sellerId ?? null,
      seller_name: s.sellerName ?? null,
      bid_price: num(s.bidPrice),
      bid_quantity: num(s.bidQuantity),
    })),
  }));
}

export async function fetchReverseAuctionL1() {
  const res = await fetchOrStub('reverse-auction', {}, AUTH_QUERY, () => stubReverseAuction());
  if (!res.ok) return res;

  const env = normaliseEnvelope(res.raw);
  if (!env.ok) return { ok: false, mode: res.mode, error: `PXIL reverse auction: ${env.code} ${env.message}` };

  const auctions = extractReverseAuction(env.body);
  return {
    ok: true,
    mode: res.mode,
    code: env.code,
    auctions,
    // This endpoint has no date filter, so the snapshot time is the only thing
    // that positions the data in time — and PXIL's `timestamp` cannot supply
    // it: production and staging stamp the same moment ten and a half hours
    // apart. Our clock places the snapshot; theirs is carried as sent.
    polled_at: new Date().toISOString(),
    pxil_timestamp: env.timestamp ?? null,
    note: res.note,
  };
}

/* ----------------------------------------------------------- Trade Margin */

/** Money compared in paise. A float epsilon is not a unit of currency. */
const paise = (v) => Math.round(v * 100) / 100;
const balances = (a, b) => Math.abs(paise(a - b)) < 0.01;

/**
 * Entity → Portfolios → Applications, three levels deep, with totals declared
 * at every level.
 *
 * PXIL states each portfolio's `Sum` and each entity's `TotalTrades` and margin
 * totals. Those are the numbers a desk would post against, so every one of them
 * is recomputed from the applications underneath it and the difference is
 * reported. Their own sample already disagrees with itself — it declares
 * TotalTrades: 10 over a single application — so this is not a theoretical
 * check.
 */
export function extractTradeMargin(body) {
  const entities = [];
  const rows = [];

  for (const e of body?.TradeMargin || []) {
    const portfolios = [];
    let entityApps = 0;
    const entityComputed = { trade_value: 0, initial_margin: 0, delivery_margin: 0, applicable_margin: 0 };

    for (const pf of e.Portfolios || []) {
      const apps = pf.Applications || [];
      entityApps += apps.length;
      const computed = { trade_value: 0, initial_margin: 0, delivery_margin: 0, applicable_margin: 0 };

      for (const a of apps) {
        const initial = num(pick(a, 'InitialMargin(PostTradeMargin)', 'InitialMargin(Post-Trade Margin)'));
        const row = {
          entity_id: e.EntityId ?? null,
          entity_name: e.EntityName ?? null,
          trade_date: parsePxilDate(e.TradeDate),
          portfolio_id: pf.PortfolioId ?? null,
          portfolio_name: pf.PortfolioName ?? null,
          application_no: a.ApplicationNo ?? null,
          side: a.BuySell ?? null,
          product_code: a.ProductCode ?? null,
          symbol: a.Symbol ?? null,
          delivery_start_date: parsePxilDate(a.DeliveryStartDate),
          delivery_end_date: parsePxilDate(a.DeliveryEndDate),
          price: num(a.Price),
          traded_qty: num(a.TradedQty),
          qty_for_schedule: num(a.QtyforSchedule),
          trade_value: num(a.TradeValue),
          initial_margin: initial,
          delivery_margin: num(a.DeliveryMargin),
          applicable_margin: num(a.ApplicableMargin),
        };
        rows.push(row);

        computed.trade_value += row.trade_value;
        computed.initial_margin += row.initial_margin;
        computed.delivery_margin += row.delivery_margin;
        computed.applicable_margin += row.applicable_margin;
      }

      for (const k of Object.keys(computed)) computed[k] = paise(computed[k]);
      for (const k of Object.keys(entityComputed)) entityComputed[k] += computed[k];

      const s = pf.Sum || {};
      const declared = {
        trade_value: num(s.SumofTradeValue),
        initial_margin: num(pick(s, 'SumofInitialMargin(PostTradeMargin)', 'SumofInitialMargin(Post-Trade Margin)')),
        delivery_margin: num(s.SumofDeliveryMargin),
        applicable_margin: num(s.SumofApplicableMargin),
      };
      const variance = {};
      for (const k of Object.keys(declared)) variance[k] = paise(declared[k] - computed[k]);

      portfolios.push({
        portfolio_id: pf.PortfolioId ?? null,
        portfolio_name: pf.PortfolioName ?? null,
        applications: apps.length,
        declared,
        computed,
        variance,
        // A portfolio with no Sum block declares nothing, so there is nothing to
        // disagree with — that is not the same as agreeing.
        sum_declared: !!pf.Sum,
        sums_reconcile: !pf.Sum || Object.keys(declared).every((k) => balances(declared[k], computed[k])),
      });
    }

    for (const k of Object.keys(entityComputed)) entityComputed[k] = paise(entityComputed[k]);

    const entityDeclared = {
      total_margin: num(e.TotalMargin),
      initial_margin: num(pick(e, 'InitialMargin(PostTradeMargin)', 'InitialMargin(Post-Trade Margin)')),
      delivery_margin: num(e.DeliveryMargin),
      applicable_margin: num(e.ApplicableMargin),
    };

    entities.push({
      entity_id: e.EntityId ?? null,
      entity_name: e.EntityName ?? null,
      trade_date: parsePxilDate(e.TradeDate),
      portfolios_declared: e.NumberOfPortfolios ?? null,
      portfolios_returned: portfolios.length,
      portfolio_count_matches: e.NumberOfPortfolios == null || Number(e.NumberOfPortfolios) === portfolios.length,
      trades_declared: e.TotalTrades ?? null,
      applications_returned: entityApps,
      // PXIL's own sample declares 10 trades and sends one application. Until
      // they say what TotalTrades counts, a mismatch is reported, not resolved.
      trade_count_matches: e.TotalTrades == null || Number(e.TotalTrades) === entityApps,
      declared: entityDeclared,
      computed: entityComputed,
      margin_variance: {
        initial_margin: paise(entityDeclared.initial_margin - entityComputed.initial_margin),
        delivery_margin: paise(entityDeclared.delivery_margin - entityComputed.delivery_margin),
        applicable_margin: paise(entityDeclared.applicable_margin - entityComputed.applicable_margin),
      },
      margins_reconcile: ['initial_margin', 'delivery_margin', 'applicable_margin']
        .every((k) => balances(entityDeclared[k], entityComputed[k])),
      // TotalMargin is not broken down anywhere in the document. Whether it is
      // meant to equal ApplicableMargin is checked but not assumed.
      total_equals_applicable: balances(entityDeclared.total_margin, entityDeclared.applicable_margin),
      portfolios,
    });
  }

  return { entities, rows };
}

export async function fetchTradeMargin(fromdate, todate, { portfolioId } = {}) {
  const res = await fetchRanged('trade-margin', 'Trade Margin', fromdate, todate, {
    extra: { portfolioId: portfolioId ?? getPxilConfig().portfolioId },
    authStyle: AUTH_HEADER,
    stub: stubTradeMargin,
  });
  if (!res.ok) return res;

  const parts = res.envelopes.map((env) => extractTradeMargin(env.body));
  const entities = parts.flatMap((part) => part.entities);
  const badPortfolios = entities.flatMap((e) => e.portfolios.filter((p) => !p.sums_reconcile));

  return {
    ok: true,
    mode: res.mode,
    code: res.code,
    entities,
    rows: parts.flatMap((part) => part.rows),
    date_order_confirmed: dayFirstConfirmed(
      res.envelopes.flatMap((env) => (env.body?.TradeMargin || []).map((e) => e.TradeDate)),
    ),
    unreconciled_portfolios: badPortfolios.length,
    unreconciled_entities: entities.filter((e) => !e.margins_reconcile).length,
    trade_count_mismatches: entities.filter((e) => !e.trade_count_matches).length,
    windows: res.windows,
    repeated_across_windows: repeatsAcross(parts.map((part) => part.rows)),
    note: res.note,
  };
}

/* ------------------------------------------------------------------ probe */

/**
 * One raw request, for the connectivity probe only.
 *
 * Unlike pxilGet this never throws on a non-200 and never falls back to a stub.
 * The probe's whole purpose is to see exactly what PXIL returns — a 404 on a
 * guessed path and a 401 on the wrong auth style are its findings, not its
 * failures.
 *
 * The URL is never returned, logged or put in an error. Under query auth it
 * carries the token, and a probe report is exactly the kind of thing that gets
 * pasted into an email.
 */
export async function probeRequest({ path, params = {}, authStyle = AUTH_HEADER, timeoutMs = 25000 }) {
  const cfg = getPxilConfig();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }

  const headers = { Accept: 'application/json' };
  if (authStyle === AUTH_QUERY) search.set('APITokenNo', cfg.token);
  else headers.Authorization = `Bearer ${cfg.token}`;

  const url = `${cfg.baseUrl.replace(/\/$/, '')}/PXILPublish/api/${path}/?${search.toString()}`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON — the snippet below says so */ }
    return {
      path,
      auth: authStyle,
      status: resp.status,
      ok: resp.ok,
      content_type: resp.headers.get('content-type'),
      ip_not_allowed: ipNotAllowed(resp.status, text),
      json,
      snippet: json ? null : text.slice(0, 200),
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      path,
      auth: authStyle,
      status: null,
      ok: false,
      error: err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Does this response actually carry the report we asked for?
 *
 * A gateway will happily return 200 with an HTML login page or an error
 * envelope. "Reachable" and "authenticated" and "returned a report" are three
 * different findings and the probe must not collapse them.
 */
export function classifyProbe(result, bodyKey) {
  if (!result) return { verdict: 'NO_RESULT', detail: 'No response recorded' };
  if (result.error) return { verdict: 'UNREACHABLE', detail: result.error };
  if (result.ip_not_allowed) {
    return { verdict: 'IP_NOT_WHITELISTED', detail: `PXIL saw our IP as ${result.ip_not_allowed}` };
  }
  if (result.status === 401 || result.status === 403) {
    return { verdict: 'AUTH_REJECTED', detail: `HTTP ${result.status}` };
  }
  if (result.status === 429) {
    const wait = rateLimitWait(429, JSON.stringify(result.json ?? result.snippet ?? ''));
    return { verdict: 'RATE_LIMITED', detail: wait ? `HTTP 429 — told to wait ${wait} seconds` : 'HTTP 429 — request limit' };
  }
  if (result.status === 404 && !noDataAvailable(result.json)) {
    return { verdict: 'NOT_FOUND', detail: 'HTTP 404 — wrong path' };
  }
  // The Version 1 APIs answer a Bearer header as if no token had been sent.
  if (result.status === 400 && /token is mandatory/i.test(String(result.json?.message || ''))) {
    return { verdict: 'AUTH_REJECTED', detail: 'HTTP 400 — token must be in the query string' };
  }
  if (result.status === 400 && rangeRefused(result.json)) {
    return { verdict: 'RANGE_TOO_LONG', detail: rangeRefused(result.json) };
  }
  if (!result.json) {
    return { verdict: 'NOT_JSON', detail: `HTTP ${result.status}, ${result.content_type || 'no content-type'}` };
  }

  const env = normaliseEnvelope(result.json);
  if (!env.ok) return { verdict: 'ERROR_ENVELOPE', detail: `${env.code ?? '?'} ${env.message ?? ''}`.trim() };
  if (env.empty) return { verdict: 'EMPTY', detail: '404 "No data available" — an empty report', code: env.code };

  const body = env.body;
  const rows = bodyKey ? body?.[bodyKey] : body;
  const count = Array.isArray(rows) ? rows.length : (rows ? 1 : 0);
  return {
    verdict: count > 0 ? 'DATA' : 'EMPTY',
    detail: count > 0 ? `${count} row(s)` : '200 with no rows — normal on a non-trading day',
    code: env.code,
  };
}

/**
 * What the slot boundaries prove about PXIL's labelling.
 *
 * Open question #9: the document's sample starts at 00:15, which is either a
 * 96th block labelled by its end time or a day that genuinely starts at 00:15.
 * Real data settles it — but only if a full day came back, so the count is
 * reported alongside rather than assumed.
 */
export function summariseSlotLabelling(rows) {
  const all = [];
  for (const r of rows || []) all.push(...(r.trade_slots || []), ...(r.scheduled_slots || []));
  if (!all.length) return { slots: 0, verdict: 'NO_SLOTS' };

  const froms = all.map((s) => s.from_time).filter(Boolean).sort();
  const tos = all.map((s) => s.to_time).filter(Boolean).sort();
  const counts = [...new Set((rows || []).map((r) => r.trade_slot_count).filter((n) => n > 0))];
  const earliest = froms[0] ?? null;
  const latest = tos[tos.length - 1] ?? null;

  // A day labelled by start time opens at 00:00 and closes at 00:00 the next
  // day; one labelled by end time opens at 00:15 and closes at 24:00 / 00:00.
  let verdict = 'INCONCLUSIVE';
  if (earliest === '00:00') verdict = 'LABELLED_BY_START';
  else if (earliest === '00:15') verdict = 'LABELLED_BY_END';

  return {
    slots: all.length,
    earliest_from: earliest,
    latest_to: latest,
    slots_per_application: counts,
    full_day: counts.some((n) => n === 95 || n === 96),
    mwh_mismatches: all.filter((s) => !s.mwh_matches_mw).length,
    verdict,
  };
}

/**
 * Whether live slot-wise rows break STOACharges down completely.
 *
 * PXIL's sample is all zeroes, so it cannot show whether the ten components
 * are the whole of STOACharges. Rows with a non-zero STOA are the only ones
 * that can; `rows_with_stoa` says how many there were.
 */
export function summariseStoaBreakup(rows) {
  const list = (rows || []).filter((r) => r.stoa_breakup?.present);
  const off = list.filter((r) => !r.stoa_breakup.reconciles);
  const worst = off.reduce((a, r) => (Math.abs(r.stoa_breakup.variance) > Math.abs(a) ? r.stoa_breakup.variance : a), 0);
  const withStoa = list.filter((r) => r.stoa_charges !== 0);
  return {
    rows: (rows || []).length,
    rows_with_breakup: list.length,
    rows_with_stoa: withStoa.length,
    reconciled: list.length - off.length,
    unreconciled: off.length,
    largest_variance: worst,
    verdict: !(rows || []).length ? 'NO_ROWS'
      : !list.length ? 'NO_BREAKUP'
        : off.length ? 'GAP'
          : withStoa.length ? 'RECONCILES' : 'ALL_ZERO',
  };
}

/**
 * Whether live DOR rows reproduce the sample's Total-vs-Category gap.
 *
 * If real rows reconcile, open question #4 was an artefact of the sample and
 * only the sample. If they do not, the gap is real and no DOR row can be posted
 * to the books until PXIL says what Total contains.
 */
export function summariseDorReconciliation(rows) {
  const list = rows || [];
  const off = list.filter((r) => !r.total_reconciles);
  const worst = off.reduce((a, r) => (Math.abs(r.total_variance) > Math.abs(a) ? r.total_variance : a), 0);
  return {
    rows: list.length,
    reconciled: list.length - off.length,
    unreconciled: off.length,
    largest_variance: worst,
    // The document annotates Charges as APPLICATION + OPERATING + TRANSMISSION,
    // and the sample leaves it at 0. If live rows do the same, that is where
    // the missing money is.
    charges_always_zero: list.length > 0 && list.every((r) => r.category.charges === 0),
    verdict: list.length === 0 ? 'NO_ROWS' : off.length === 0 ? 'RECONCILES' : 'GAP_CONFIRMED',
  };
}

/** Which Format-D fields live data actually populates — open question #6. */
export function summariseFormatDFields(rows) {
  const list = rows || [];
  if (!list.length) return { rows: 0, populated: [], blank: [] };
  const keys = Object.keys(list[0]);
  const populated = keys.filter((k) => list.some((r) => r[k] !== null && r[k] !== '' && r[k] !== 0));
  return {
    rows: list.length,
    populated,
    blank: keys.filter((k) => !populated.includes(k)),
    // The two price fields are documented without units. If they are always
    // equal, one of them is redundant; if they differ, the ratio is the clue.
    price_rate_ratios: [...new Set(list
      .filter((r) => r.transaction_rate)
      .map((r) => Math.round((r.transaction_price / r.transaction_rate) * 1000) / 1000))],
  };
}

/* ------------------------------------------------------------------ stubs */

/**
 * Samples in the documented shape, used until credentials are confirmed.
 *
 * These reproduce the documents faithfully, quirks included — the daily sample
 * is all zeroes exactly as printed, Format-D's rows are blank exactly as
 * printed, and the DOR Total is left disagreeing with its own Category so the
 * reconciliation path is actually exercised rather than assumed.
 */
function stubTamGtam(fromdate) {
  return {
    ResponseStatus: { Code: 'CNSAPI-200', Message: 'Success, report data generated successfully' },
    ResponseBody: {
      TAMGTAM: [{
        Date: '06-11-2025',
        EntityId: 'P100',
        EntityName: 'MOCK',
        Applications: [{
          ApplicationNo: 'MO433-0WR5468',
          PortfolioId: 'MOCC10240001',
          PortfolioName: 'MOCK Department_Government',
          Symbol: 'MOCK-SL',
          SourceType: 'GTAM',
          Source: 'GREEN',
          BuySell: 'B',
          DeliveryDate: '01-02-2026',
          TradeDate: '06-11-2025',
          DeliveryStartDate: '01-02-2026',
          DeliveryEndDate: '28-02-2026',
          ProductCode: 'MonthlyA_Gr3',
          ObligationNo: 0.0,
          PriceRsMWh: 0.0,
          TradedQtyMWh: 0.0,
          TradeValue: 0,
          Invoice: 0.0,
          STOACharges: 0.0,
          PXILFees: 0.0,
          IGST: 0, SGST: 0, CGST: 0.0, UGST: 0,
          TotalPayinPayout: 0,
          'InitialMargin(PostTradeMargin)': 0,
          DeliveryMargin: 0,
          ApplicableMargin: 0,
          BalanceMargin: 0,
          MarginRelease: 0,
        }],
      }],
      _stub_for: fromdate,
    },
  };
}

function stubSlotWise(fromdate) {
  const base = stubTamGtam(fromdate);
  const app = base.ResponseBody.TAMGTAM[0].Applications[0];
  return {
    ResponseStatus: base.ResponseStatus,
    ResponseBody: {
      SlotWiseQuantityAndCharges: [{
        ...base.ResponseBody.TAMGTAM[0],
        Applications: [{
          ...app,
          ApprovalNo: 'NR/2026/00001/C',
          ApplicationNLDCCharges: 0.0,
          ApplicationRLDCCharges: 0.0,
          ApplicationSLDCCharges: 0.0,
          OperatingDECharges: 0.0,
          OperatingNLDCCharges: 0.0,
          OperatingRLDCCharges: 0.0,
          OperatingSLDCCharges: 0.0,
          TransmissionDETCharges: 0.0,
          TransmissionStateTCharges: 0.0,
          TransmissionZonalTCharges: 0.0,
          SchedulingRequestedInvoiceQtyMWH: 0.0,
          TotalScheduledAcceptedInvoiceQtyMWH: 0,
          RealTimeCurtailmentMWH: 0,
          FinalscheduledQtyMWH: 0,
          // The document's slot-wise sample uses the hyphenated spelling.
          'InitialMargin(Post-Trade Margin)': 0,
          TradeSlotWiseDetails: [{ fromTime: '00:15', toTime: '00:30', Mw: 0.0, Mwh: 0.0 }],
          ScheduledSlotWiseDetails: [{ fromTime: '00:15', toTime: '00:30', Mw: 0.0, Mwh: 0.0 }],
        }],
      }],
      _stub_for: fromdate,
    },
  };
}

function stubFormatD(fromdate) {
  return {
    ResponseStatus: { Code: 'CNSAPI-200', Message: 'Success' },
    ResponseBody: {
      Trades: [{
        ApplicationNo: '',
        Product: '',
        StartDate: '',
        EndDate: '',
        StartTime: '',
        EndTime: '',
        ScheduledVolume: 0,
        SellerName: '',
        SellerState: '',
        BuyerName: '',
        BuyerState: '',
        TransactionPrice: 0,
        TransactionRate: 0,
      }],
      TotalCount: 1,
      _stub_for: fromdate,
    },
  };
}

function stubDor(fromdate) {
  return {
    ResponseBody: {
      DOR: [{
        ApplicationNo: 'MG320260101WR32983',
        PortfolioName: 'Electricity Department_Government of Goa WR',
        PortfolioID: '524',
        BuySell: 'B',
        delivery_date_from: '2026-01-11',
        delivery_date_to: '2026-01-11',
        Category: {
          // Left at 0 as printed. Total below does not add up to these, which
          // is the open question with PXIL and the reason this path is tested.
          Charges: 0,
          Fees: 4760.35,
          IGST: 856.863,
          CGST: 0.0,
          SGST: 0.0,
          CP: 1320997.15,
        },
        Total: 1442000.683,
      }],
      _stub_for: fromdate,
    },
    ResponseStatus: { StatusCode: '200', StatusMessage: 'Success' },
  };
}

/**
 * The Trade Margin sample, reproduced with its own inconsistency intact: the
 * entity declares TotalTrades: 10 over a single application. Leaving that in
 * means the trade-count check is exercised rather than assumed.
 */
function stubTradeMargin(fromdate) {
  return {
    ResponseStatus: { Code: 'CNSAPI-200', Message: 'Success, report data generated successfully' },
    ResponseBody: {
      TradeMargin: [{
        EntityId: 'C9999',
        EntityName: 'Power Exchange India Limited',
        TradeDate: '15-01-2026',
        NumberOfPortfolios: 1,
        TotalTrades: 10,
        TotalMargin: 250000.00,
        'InitialMargin(PostTradeMargin)': 50000.00,
        DeliveryMargin: 200000.00,
        ApplicableMargin: 250000.00,
        Portfolios: [{
          PortfolioId: 'DEMC99990001',
          PortfolioName: 'Demo Thermal Power Portfolio',
          Applications: [{
            ApplicationNo: 'DM20260201SR00001',
            BuySell: 'S',
            ProductCode: 'Daily_Con',
            DeliveryStartDate: '01-02-2026',
            DeliveryEndDate: '28-02-2026',
            Symbol: 'DEM_DC',
            Price: 4500.00,
            TradedQty: 100.00,
            QtyforSchedule: 100.00,
            TradeValue: 450000.00,
            'InitialMargin(PostTradeMargin)': 50000.00,
            DeliveryMargin: 200000.00,
            ApplicableMargin: 250000.00,
          }],
          Sum: {
            SumofTradeValue: 450000.00,
            'SumofInitialMargin(PostTradeMargin)': 50000.00,
            SumofApplicableMargin: 250000.00,
            SumofDeliveryMargin: 200000.00,
          },
        }],
      }],
      _stub_for: fromdate,
    },
  };
}

function stubReverseAuction() {
  return {
    message: 'success',
    statuscode: 200,
    data: [{
      auctionID: 'AnydaySSC_R/05012026040244',
      buyer: 'omkar ftw limited',
      deliveryMonth: '07-01-2026',
      auctionQuantity: 20,
      type: 'Green',
      remainingTime: '07:39:34',
      L1: 5.5,
      lastUpdate: '06-01-2026 16:44:59.529',
      auctionCloseTime: '07-01-2026 20:00',
      sellerData: [
        { sellerId: 'S1042', sellerName: 'Hari Om enterprises', bidPrice: 89, bidQuantity: 30 },
        { sellerId: 'S1043', sellerName: 'Mahesh Chemicals', bidPrice: 41, bidQuantity: 32 },
      ],
    }],
    timestamp: '13-01-2026 12:54:07',
  };
}
