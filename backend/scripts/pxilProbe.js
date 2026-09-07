#!/usr/bin/env node
/**
 * PXIL connectivity and discovery probe.
 *
 *   node backend/scripts/pxilProbe.js [fromdate] [todate]
 *
 * Six of the nine questions we raised with PXIL can be answered from their own
 * live responses instead of waiting for a reply. This probe asks them:
 *
 *   Q1  Which path serves the daily TAM-GTAM report? Their daily document
 *       prints the slot-wise URL, so both candidates are tried and the one that
 *       answers wins.
 *   Q2  Does the Bearer header work on all six endpoints, or do Member DOR and
 *       Reverse Auction really require the token in the query string? Every
 *       endpoint is tried both ways. If the header works everywhere we can stop
 *       putting a credential in a URL.
 *   Q4  Does Member DOR's Total equal the sum of its Category in live data, or
 *       is the gap in their sample real?
 *   Q6  Which Format-D fields are actually populated, and how do TransactionPrice
 *       and TransactionRate relate?
 *   Q7  Is the response date order really DD-MM-YYYY? Any day above 12 proves
 *       it; the probe reports "unproven" rather than assuming.
 *   Q9  Do slots start at 00:00 or 00:15, and does a full day carry 95 or 96?
 *
 * Read-only throughout: six GETs, no writes, nothing persisted.
 *
 * The token is never printed, and neither is any URL — under query auth a URL
 * contains the credential, and this report is meant to be pasteable into an
 * email to PXIL.
 */
import {
  getPxilConfig,
  probeRequest,
  classifyProbe,
  normaliseEnvelope,
  dayFirstConfirmed,
  extractTamGtamSlotWise,
  extractDor,
  extractFormatD,
  extractTradeMargin,
  summariseSlotLabelling,
  summariseDorReconciliation,
  summariseFormatDFields,
} from '../src/services/pxilService.js';

const [, , argFrom, argTo] = process.argv;

/** Default to a window whose days run past the 12th, so DD-MM can be proven. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 45 * 24 * 3600 * 1000);
  return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)];
}

const [fromdate, todate] = argFrom && argTo ? [argFrom, argTo] : defaultRange();

const line = (s = '') => console.log(s);
const rule = (t) => { line(); line(`── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`); };
const mark = { DATA: '✓', EMPTY: '○', AUTH_REJECTED: '✗', NOT_FOUND: '✗', UNREACHABLE: '✗', NOT_JSON: '✗', ERROR_ENVELOPE: '!', NO_RESULT: '✗' };

const cfg = getPxilConfig();
if (!cfg.token) {
  console.error('No PXIL token configured. Set PXIL_API_TOKEN in backend/.env (and PXIL_ENABLED=true), then re-run.');
  process.exit(1);
}

const ranged = { fromdate, todate, reportType: 'JSON' };
if (cfg.portfolioId) ranged.portfolioId = cfg.portfolioId;

// path, params, the ResponseBody key its rows live under, and the auth style
// PXIL's document specifies for it.
const ENDPOINTS = [
  { key: 'tam-gtam (daily, guessed)', path: cfg.tamGtamPath, params: ranged, bodyKey: 'TAMGTAM', documented: 'header' },
  { key: 'tam-gtam-slot-wise', path: 'tam-gtam-slot-wise', params: ranged, bodyKey: 'TAMGTAM', documented: 'header' },
  { key: 'format-d', path: 'format-d', params: ranged, bodyKey: 'Trades', documented: 'header' },
  { key: 'trade-margin', path: 'trade-margin', params: ranged, bodyKey: 'TradeMargin', documented: 'header' },
  { key: 'member-dor', path: 'member-dor', params: ranged, bodyKey: 'DOR', documented: 'query' },
  { key: 'reverse-auction', path: 'reverse-auction/l1-summary', params: {}, bodyKey: null, documented: 'query' },
];

line('PXIL integration probe');
line(`Endpoint      ${cfg.baseUrl}`);
line(`Date range    ${fromdate} → ${todate}`);
line(`Portfolio     ${cfg.portfolioId || '(not set — all portfolios)'}`);
line(`Token         present, ${cfg.token.length} chars (not printed)`);

/* ------------------------------------------------- Q2: which auth works */

rule('Q2  Authentication style per endpoint');
line('Both styles are tried on every endpoint. If the Bearer header works');
line('everywhere, we can stop putting the token in a query string.');
line();
line('endpoint                      documented   header                query');

const best = {};
for (const ep of ENDPOINTS) {
  const header = await probeRequest({ path: ep.path, params: ep.params, authStyle: 'header' });
  const query = await probeRequest({ path: ep.path, params: ep.params, authStyle: 'query' });
  const ch = classifyProbe(header, ep.bodyKey);
  const cq = classifyProbe(query, ep.bodyKey);

  const cell = (c, r) => `${mark[c.verdict] || '?'} ${c.verdict}${r.status ? ` ${r.status}` : ''}`;
  line(`${ep.key.padEnd(29)} ${ep.documented.padEnd(12)} ${cell(ch, header).padEnd(21)} ${cell(cq, query)}`);

  // Prefer whichever style actually returned rows; fall back to the documented
  // one so a genuinely empty range still yields a usable response to parse.
  const headerWorks = ch.verdict === 'DATA' || ch.verdict === 'EMPTY';
  const queryWorks = cq.verdict === 'DATA' || cq.verdict === 'EMPTY';
  best[ep.key] = {
    ep,
    result: ch.verdict === 'DATA' ? header : cq.verdict === 'DATA' ? query : headerWorks ? header : queryWorks ? query : header,
    style: ch.verdict === 'DATA' ? 'header' : cq.verdict === 'DATA' ? 'query' : headerWorks ? 'header' : queryWorks ? 'query' : null,
    header: ch,
    query: cq,
  };
}

const headerEverywhere = Object.values(best).every((b) => b.header.verdict === 'DATA' || b.header.verdict === 'EMPTY');
line();
line(headerEverywhere
  ? '→ The Bearer header is accepted on every endpoint. Ask PXIL to confirm we may'
  : '→ The Bearer header is NOT accepted everywhere. The query-string endpoints must');
line(headerEverywhere
  ? '  standardise on it and drop the query-string token entirely.'
  : '  keep their token in the URL, and those requests must stay out of all logs.');

/* --------------------------------------------- Q1: the daily TAM-GTAM path */

rule('Q1  Daily TAM-GTAM path');
const daily = best['tam-gtam (daily, guessed)'];
const slot = best['tam-gtam-slot-wise'];
const dailyOk = ['DATA', 'EMPTY'].includes(daily.header.verdict) || ['DATA', 'EMPTY'].includes(daily.query.verdict);
line(`Guessed path  /PXILPublish/api/${cfg.tamGtamPath}/   → ${dailyOk ? 'responds' : 'does not respond'}`);
line(`Slot-wise     /PXILPublish/api/tam-gtam-slot-wise/   → ${['DATA', 'EMPTY'].includes(slot.header.verdict) ? 'responds' : 'does not respond'}`);
line(dailyOk
  ? '→ The guessed daily path is live. Their daily document printing the slot-wise'
  : '→ The guessed daily path does not answer. The daily report is only reachable at');
line(dailyOk
  ? '  URL was a copy-paste error, as we suspected.'
  : '  some other path — this stays a blocking question for PXIL.');

/* --------------------------------------------------- Q7: response date order */

rule('Q7  Response date order (DD-MM-YYYY vs MM-DD-YYYY)');
const dateSamples = [];
for (const key of ['tam-gtam (daily, guessed)', 'trade-margin']) {
  const b = best[key];
  const env = b.result?.json ? normaliseEnvelope(b.result.json) : null;
  if (!env?.ok) continue;
  for (const e of env.body?.TAMGTAM || env.body?.TradeMargin || []) {
    if (e.Date) dateSamples.push(e.Date);
    if (e.TradeDate) dateSamples.push(e.TradeDate);
  }
}
if (!dateSamples.length) {
  line('No dated rows came back in this range — nothing to test. Re-run over a range');
  line('that definitely contains trades, ideally one spanning past the 12th.');
} else {
  const proven = dayFirstConfirmed(dateSamples);
  line(`Samples seen  ${[...new Set(dateSamples)].slice(0, 8).join(', ')}`);
  line(proven
    ? '→ PROVEN day-first: at least one value has a first component above 12, which'
    : '→ UNPROVEN: every day in this range is 12 or under, so DD-MM and MM-DD are');
  line(proven
    ? '  can only be a day. Responses are DD-MM-YYYY.'
    : '  indistinguishable here. Widen the range or get PXIL to confirm in writing.');
}

/* ---------------------------------------------------------- Q9: slot labelling */

rule('Q9  Slot labelling and blocks per day');
const slotEnv = slot.result?.json ? normaliseEnvelope(slot.result.json) : null;
if (!slotEnv?.ok) {
  line('Slot-wise endpoint returned no usable body — cannot test.');
} else {
  const s = summariseSlotLabelling(extractTamGtamSlotWise(slotEnv.body));
  if (!s.slots) {
    line('No slots in this range. Re-run over a date range with scheduled trades.');
  } else {
    line(`Slots seen    ${s.slots}, per application: ${s.slots_per_application.join(', ') || 'n/a'}`);
    line(`Boundaries    earliest from ${s.earliest_from}, latest to ${s.latest_to}`);
    line(`Full day      ${s.full_day ? 'yes (95 or 96 blocks present)' : 'no — partial data, count is not conclusive'}`);
    if (s.mwh_mismatches) line(`MWh check     ${s.mwh_mismatches} slot(s) where MWh ≠ MW ÷ 4`);
    line(s.verdict === 'LABELLED_BY_START'
      ? '→ Slots are labelled by START time (day opens 00:00–00:15).'
      : s.verdict === 'LABELLED_BY_END'
        ? '→ Slots are labelled by END time (day opens 00:15). Our block indices must be'
        : '→ INCONCLUSIVE — the earliest boundary is neither 00:00 nor 00:15.');
    if (s.verdict === 'LABELLED_BY_END') line('  shifted one block back to align with our 00:00-based schedule grid.');
  }
}

/* -------------------------------------------------------- Q4: DOR reconciliation */

rule('Q4  Member DOR — does Total equal the sum of Category?');
const dorEnv = best['member-dor'].result?.json ? normaliseEnvelope(best['member-dor'].result.json) : null;
if (!dorEnv?.ok) {
  line('Member DOR returned no usable body — cannot test.');
} else {
  const d = summariseDorReconciliation(extractDor(dorEnv.body));
  line(`Rows          ${d.rows}   reconciled ${d.reconciled}   off ${d.unreconciled}`);
  if (d.unreconciled) line(`Largest gap   ${d.largest_variance}`);
  line(`Charges       ${d.charges_always_zero ? 'zero on every row — likely where the missing money belongs' : 'populated on at least one row'}`);
  line(d.verdict === 'RECONCILES'
    ? '→ Live rows reconcile. The gap was an artefact of their sample only, and DOR'
    : d.verdict === 'NO_ROWS'
      ? '→ No rows in this range — inconclusive. Re-run over a range with obligations.'
      : '→ The gap is REAL in live data. No DOR row may be posted to the books until');
  line(d.verdict === 'RECONCILES'
    ? '  rows can be posted once the other questions close.'
    : d.verdict === 'NO_ROWS' ? '' : '  PXIL states what Total contains. This stays blocking.');
}

/* ------------------------------------------------------------ Q6: Format-D fields */

rule('Q6  Format-D — which fields are actually populated?');
const fdEnv = best['format-d'].result?.json ? normaliseEnvelope(best['format-d'].result.json) : null;
if (!fdEnv?.ok) {
  line('Format-D returned no usable body — cannot test.');
} else {
  const f = summariseFormatDFields(extractFormatD(fdEnv.body));
  if (!f.rows) {
    line('No Format-D rows in this range — their sample was blank and so is this.');
    line('Ask PXIL for one populated example, or re-run over a scheduled period.');
  } else {
    line(`Rows          ${f.rows}`);
    line(`Populated     ${f.populated.join(', ')}`);
    line(`Always blank  ${f.blank.join(', ') || 'none'}`);
    line(`price ÷ rate  ${f.price_rate_ratios.join(', ') || 'n/a'}`);
    line(f.price_rate_ratios.length === 1 && f.price_rate_ratios[0] === 1
      ? '→ TransactionPrice and TransactionRate are identical. One is redundant; ask'
      : '→ The two price fields differ. The ratio above is the clue to their units —');
    line(f.price_rate_ratios.length === 1 && f.price_rate_ratios[0] === 1
      ? '  PXIL which one is authoritative.'
      : '  a ratio near 1000 means one is ₹/MWh against ₹/kWh.');
  }
}

/* ------------------------------------------------ Trade Margin self-consistency */

rule('Trade Margin — do PXIL\'s declared totals match their own rows?');
const tmEnv = best['trade-margin'].result?.json ? normaliseEnvelope(best['trade-margin'].result.json) : null;
if (!tmEnv?.ok) {
  line('Trade Margin returned no usable body — cannot test.');
} else {
  const { entities } = extractTradeMargin(tmEnv.body);
  if (!entities.length) {
    line('No entities in this range.');
  } else {
    for (const e of entities) {
      line(`${e.entity_name} (${e.entity_id}) on ${e.trade_date}`);
      line(`  portfolios  declared ${e.portfolios_declared}, returned ${e.portfolios_returned} ${e.portfolio_count_matches ? '✓' : '✗'}`);
      line(`  trades      declared ${e.trades_declared}, applications ${e.applications_returned} ${e.trade_count_matches ? '✓' : '✗'}`);
      line(`  margins     ${e.margins_reconcile ? '✓ entity totals match the sum of applications' : `✗ off by ${JSON.stringify(e.margin_variance)}`}`);
      for (const p of e.portfolios) {
        line(`  ${p.portfolio_id.padEnd(14)} Sum ${p.sums_reconcile ? '✓' : `✗ ${JSON.stringify(p.variance)}`}`);
      }
    }
    const badTrades = entities.filter((e) => !e.trade_count_matches).length;
    if (badTrades) {
      line();
      line(`→ ${badTrades} entity/entities declare a TotalTrades that does not equal the number of`);
      line('  applications returned. Ask PXIL what TotalTrades counts — it is not rows.');
    }
  }
}

rule('Summary');
const reachable = Object.values(best).filter((b) => b.style).length;
line(`${reachable} of ${ENDPOINTS.length} endpoints returned a parseable report.`);
line('Nothing was written to the database. Re-run over a range with known trades');
line('before drawing conclusions from any "no rows" result above.');
line();
