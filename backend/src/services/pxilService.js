/**
 * Power Exchange India Limited (PXIL) member API integration — Phase 1.
 *
 * Six read-only report endpoints, all GET, all date-ranged except the reverse
 * auction summary:
 *
 *   tam-gtam            Billing: day-level TAM/GTAM trades, charges, margins
 *   tam-gtam-slot-wise  Billing: the same trades broken into 15-minute slots
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
 * Nothing here writes to the database. The documented samples leave four
 * questions open (see UNRESOLVED below) and inventing tables around answers we
 * do not have yet would only have to be undone. This module fetches,
 * normalises, and reports — persistence lands after validation against PXIL's
 * staging environment.
 *
 * Without a token every call runs in stub mode against a recorded-shape sample,
 * so the mapping and its tests can be built before credentials are confirmed.
 *
 * UNRESOLVED — raised with PXIL, see docs/PXIL_API_Clarifications_Email_Draft.md:
 *   1. The daily TAM-GTAM document prints the *slot-wise* URL. The real daily
 *      path is a guess (`tam-gtam`) and is overridable by parameter.
 *   2. Two auth styles are documented. Both are implemented, chosen per
 *      endpoint from the document that describes it.
 *   3. Member DOR's sample Total exceeds the sum of its own Category by
 *      115386.32. Every row is checked and the gap reported, never silently
 *      absorbed.
 *   4. Slot boundaries are echoed as received. The sample's first slot starts
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
  // See UNRESOLVED #1 — the daily TAM-GTAM path is not reliably documented.
  const tamGtamPath = envOrParam('PXIL_TAM_GTAM_PATH', 'pxil_tam_gtam_path', 'tam-gtam');
  const enabled = String(envOrParam('PXIL_ENABLED', 'pxil_enabled', 'false')) === 'true';
  return {
    enabled,
    live: enabled && !!token && !!baseUrl,
    token, baseUrl, portfolioId, tamGtamPath,
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
 * The three document sets wrap their payload three different ways. Normalise to
 * one shape so callers do not each re-learn the differences.
 *
 * A 200 carrying an empty body is a normal outcome — PXIL has no trades on a
 * non-trading day — so `ok` reflects the status code, and emptiness is left for
 * the caller to read off the payload.
 */
export function normaliseEnvelope(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: null, message: 'Empty or non-JSON response', body: null };
  }

  // Reverse auction: flat, no wrapper.
  if (payload.statuscode !== undefined || (payload.data !== undefined && payload.ResponseBody === undefined)) {
    const code = payload.statuscode;
    return {
      ok: Number(code) === 200,
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
 * `auth: 'query'` puts the token in the query string. That is documented for
 * two endpoints and we have asked PXIL to move them to the header — a token in
 * a URL lands in access logs and proxy logs on both sides. Until they confirm,
 * we follow the document, and callers must keep these URLs out of logs.
 */
const AUTH_HEADER = 'header';
const AUTH_QUERY = 'query';

function endpointPath(name, cfg) {
  switch (name) {
    case 'tam-gtam': return cfg.tamGtamPath;
    case 'tam-gtam-slot-wise': return 'tam-gtam-slot-wise';
    case 'format-d': return 'format-d';
    case 'member-dor': return 'member-dor';
    case 'reverse-auction': return 'reverse-auction/l1-summary';
    case 'trade-margin': return 'trade-margin';
    default: throw new Error(`Unknown PXIL endpoint: ${name}`);
  }
}

async function pxilGet(name, params, authStyle) {
  const cfg = getPxilConfig();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }

  const headers = { Accept: 'application/json' };
  if (authStyle === AUTH_QUERY) search.set('APITokenNo', cfg.token);
  else headers.Authorization = `Bearer ${cfg.token}`;

  const path = endpointPath(name, cfg);
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/PXILPublish/api/${path}/?${search.toString()}`;

  const resp = await fetch(url, { method: 'GET', headers });
  const text = await resp.text();
  if (!resp.ok) {
    // The token may be in the query string; never echo the URL into an error.
    throw new Error(`PXIL ${name} HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`PXIL ${name}: response was not JSON: ${text.slice(0, 200)}`);
  }
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
    return { ok: false, mode: 'PXIL', error: err.message };
  }
}

const dateParams = (fromdate, todate, extra = {}) => ({
  fromdate, todate, reportType: 'JSON', ...extra,
});

/* -------------------------------------------------------------- TAM-GTAM */

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
      });
    }
  }
  return rows;
}

export async function fetchTamGtam(fromdate, todate, { portfolioId } = {}) {
  const cfg = getPxilConfig();
  const res = await fetchOrStub(
    'tam-gtam',
    dateParams(fromdate, todate, { portfolioId: portfolioId ?? cfg.portfolioId }),
    AUTH_HEADER,
    () => stubTamGtam(fromdate),
  );
  if (!res.ok) return res;

  const env = normaliseEnvelope(res.raw);
  if (!env.ok) return { ok: false, mode: res.mode, error: `PXIL TAM-GTAM: ${env.code} ${env.message}` };

  const rows = extractTamGtam(env.body);
  return {
    ok: true,
    mode: res.mode,
    code: env.code,
    rows,
    date_order_confirmed: dayFirstConfirmed((env.body?.TAMGTAM || []).map((e) => e.Date)),
    note: res.note,
  };
}

/* ---------------------------------------------------- TAM-GTAM slot-wise */

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

export function extractTamGtamSlotWise(body) {
  const rows = [];
  for (const entity of body?.TAMGTAM || []) {
    for (const app of entity.Applications || []) {
      const trade = extractSlots(app, 'TradeSlotWiseDetails');
      const scheduled = extractSlots(app, 'ScheduledSlotWiseDetails');
      rows.push({
        trade_date: parsePxilDate(entity.Date),
        entity_id: entity.EntityId ?? null,
        entity_name: entity.EntityName ?? null,
        application_no: app.ApplicationNo ?? null,
        portfolio_id: app.PortfolioId ?? null,
        side: app.BuySell ?? null,
        product_code: app.ProductCode ?? null,
        delivery_date: parsePxilDate(app.DeliveryDate),
        traded_qty_mwh: num(app.TradedQtyMWh),
        scheduling_requested_invoice_qty_mwh: num(app.SchedulingRequestedInvoiceQtyMWH),
        total_scheduled_accepted_invoice_qty_mwh: num(app.TotalScheduledAcceptedInvoiceQtyMWH),
        real_time_curtailment_mwh: num(app.RealTimeCurtailmentMWH),
        final_scheduled_qty_mwh: num(app.FinalscheduledQtyMWH),
        trade_slots: trade,
        scheduled_slots: scheduled,
        // See UNRESOLVED #4: the sample's first slot starts at 00:15, so we
        // report the count instead of asserting a 96-block day.
        trade_slot_count: trade.length,
        scheduled_slot_count: scheduled.length,
        slot_mwh_mismatches: [...trade, ...scheduled].filter((s) => !s.mwh_matches_mw).length,
      });
    }
  }
  return rows;
}

export async function fetchTamGtamSlotWise(fromdate, todate, { portfolioId } = {}) {
  const cfg = getPxilConfig();
  const res = await fetchOrStub(
    'tam-gtam-slot-wise',
    dateParams(fromdate, todate, { portfolioId: portfolioId ?? cfg.portfolioId }),
    AUTH_HEADER,
    () => stubTamGtamSlotWise(fromdate),
  );
  if (!res.ok) return res;

  const env = normaliseEnvelope(res.raw);
  if (!env.ok) return { ok: false, mode: res.mode, error: `PXIL TAM-GTAM slot-wise: ${env.code} ${env.message}` };

  return { ok: true, mode: res.mode, code: env.code, rows: extractTamGtamSlotWise(env.body), note: res.note };
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
  const res = await fetchOrStub(
    'format-d',
    dateParams(fromdate, todate),
    AUTH_HEADER,
    () => stubFormatD(fromdate),
  );
  if (!res.ok) return res;

  const env = normaliseEnvelope(res.raw);
  if (!env.ok) return { ok: false, mode: res.mode, error: `PXIL Format-D: ${env.code} ${env.message}` };

  const rows = extractFormatD(env.body);
  const declared = env.body?.TotalCount;
  return {
    ok: true,
    mode: res.mode,
    code: env.code,
    rows,
    // PXIL declares its own count; a mismatch means we lost rows in paging or parsing.
    total_count_declared: declared ?? null,
    total_count_matches: declared === undefined || Number(declared) === rows.length,
    note: res.note,
  };
}

/* ------------------------------------------------------------- Member DOR */

/**
 * Day-wise obligations.
 *
 * The document's own sample has Total exceeding the sum of Category by
 * 115386.32 (UNRESOLVED #3). Rather than trust one number over the other, every
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

export async function fetchMemberDor(fromdate, todate) {
  const res = await fetchOrStub(
    'member-dor',
    dateParams(fromdate, todate),
    AUTH_QUERY,
    () => stubDor(fromdate),
  );
  if (!res.ok) return res;

  const env = normaliseEnvelope(res.raw);
  if (!env.ok) return { ok: false, mode: res.mode, error: `PXIL Member DOR: ${env.code} ${env.message}` };

  const rows = extractDor(env.body);
  const unreconciled = rows.filter((r) => !r.total_reconciles);
  return {
    ok: true,
    mode: res.mode,
    code: env.code,
    rows,
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
    // that positions the data in time. Fall back to our own clock if absent.
    polled_at: env.timestamp || new Date().toISOString(),
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
  const cfg = getPxilConfig();
  const res = await fetchOrStub(
    'trade-margin',
    dateParams(fromdate, todate, { portfolioId: portfolioId ?? cfg.portfolioId }),
    AUTH_HEADER,
    () => stubTradeMargin(fromdate),
  );
  if (!res.ok) return res;

  const env = normaliseEnvelope(res.raw);
  if (!env.ok) return { ok: false, mode: res.mode, error: `PXIL Trade Margin: ${env.code} ${env.message}` };

  const { entities, rows } = extractTradeMargin(env.body);
  const badPortfolios = entities.flatMap((e) => e.portfolios.filter((p) => !p.sums_reconcile));

  return {
    ok: true,
    mode: res.mode,
    code: env.code,
    entities,
    rows,
    date_order_confirmed: dayFirstConfirmed((env.body?.TradeMargin || []).map((e) => e.TradeDate)),
    unreconciled_portfolios: badPortfolios.length,
    unreconciled_entities: entities.filter((e) => !e.margins_reconcile).length,
    trade_count_mismatches: entities.filter((e) => !e.trade_count_matches).length,
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
  if (result.status === 401 || result.status === 403) {
    return { verdict: 'AUTH_REJECTED', detail: `HTTP ${result.status}` };
  }
  if (result.status === 404) return { verdict: 'NOT_FOUND', detail: 'HTTP 404 — wrong path' };
  if (!result.json) {
    return { verdict: 'NOT_JSON', detail: `HTTP ${result.status}, ${result.content_type || 'no content-type'}` };
  }

  const env = normaliseEnvelope(result.json);
  if (!env.ok) return { verdict: 'ERROR_ENVELOPE', detail: `${env.code ?? '?'} ${env.message ?? ''}`.trim() };

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

function stubTamGtamSlotWise(fromdate) {
  const base = stubTamGtam(fromdate);
  const app = base.ResponseBody.TAMGTAM[0].Applications[0];
  return {
    ResponseStatus: base.ResponseStatus,
    ResponseBody: {
      TAMGTAM: [{
        ...base.ResponseBody.TAMGTAM[0],
        Applications: [{
          ...app,
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
