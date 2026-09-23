/**
 * The PXIL probe's report, rendered from recorded attempts.
 *
 * Two callers share this renderer so that a live run and a replayed capture
 * print byte-for-byte the same report:
 *
 *   backend/scripts/pxilProbe.js    calls PXIL now, from a whitelisted host
 *   backend/scripts/pxilAnalyse.js  replays a capture taken by
 *                                   tools/pxil-probe/pxil-probe.mjs on the server
 *
 * That split exists because only one machine in this project can reach PXIL at
 * all — the server whose public IP PXIL whitelisted. Everywhere else every
 * endpoint answers 403. Capturing once on that box and analysing here means the
 * analysis can be corrected and re-run without asking for another server
 * session, which is the part that actually costs time.
 *
 * Input is deliberately the raw shape probeRequest returns, nothing narrower:
 * verdicts are recomputed here rather than recorded, so a capture taken today
 * still answers a question we only think to ask next week.
 */
import {
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
} from './pxilService.js';

const MARK = {
  IP_NOT_WHITELISTED: '✗',
  DATA: '✓',
  EMPTY: '○',
  AUTH_REJECTED: '✗',
  NOT_FOUND: '✗',
  UNREACHABLE: '✗',
  NOT_JSON: '✗',
  ERROR_ENVELOPE: '!',
  NO_RESULT: '·',
};

/**
 * The six Phase 1 endpoints, with the ResponseBody key their rows live under
 * and the auth style PXIL's reply specifies for each.
 *
 * `documented: 'query'` on Member DOR and Reverse Auction is not a preference —
 * PXIL says those two are still Version 1 and take the token only as
 * APITokenNo. Both styles are tried on every endpoint anyway, so the day PXIL
 * upgrades them the report says so on its own.
 */
export function buildEndpoints({ fromdate, todate, portfolioId = '' } = {}) {
  const ranged = { fromdate, todate, reportType: 'JSON' };
  if (portfolioId) ranged.portfolioId = portfolioId;
  return [
    { key: 'tam-gtam', path: 'tam-gtam', params: ranged, bodyKey: 'TAMGTAM', documented: 'header' },
    { key: 'tam-gtam-slot-wise', path: 'tam-gtam-slot-wise', params: ranged, bodyKey: 'TAMGTAM', documented: 'header' },
    { key: 'format-d', path: 'format-d', params: ranged, bodyKey: 'Trades', documented: 'header' },
    { key: 'trade-margin', path: 'trade-margin', params: ranged, bodyKey: 'TradeMargin', documented: 'header' },
    { key: 'member-dor', path: 'member-dor', params: ranged, bodyKey: 'DOR', documented: 'query' },
    { key: 'reverse-auction', path: 'reverse-auction/l1-summary', params: {}, bodyKey: null, documented: 'query' },
  ];
}

const works = (c) => c.verdict === 'DATA' || c.verdict === 'EMPTY';

/**
 * Pick the attempt to parse for the rest of the report: whichever style
 * returned rows, else whichever answered at all, else the documented one — so
 * a genuinely empty date range still yields a body to inspect instead of
 * being reported as a failure.
 */
function chooseBest(endpoints, attempts) {
  const best = {};
  for (const ep of endpoints) {
    const header = attempts?.[ep.key]?.header ?? null;
    const query = attempts?.[ep.key]?.query ?? null;
    const ch = classifyProbe(header, ep.bodyKey);
    const cq = classifyProbe(query, ep.bodyKey);
    const style = ch.verdict === 'DATA' ? 'header'
      : cq.verdict === 'DATA' ? 'query'
        : works(ch) ? 'header'
          : works(cq) ? 'query' : null;
    best[ep.key] = {
      ep,
      header: ch,
      query: cq,
      style,
      result: style === 'query' ? query : header,
    };
  }
  return best;
}

function envelopeOf(entry) {
  return entry?.result?.json ? normaliseEnvelope(entry.result.json) : null;
}

/**
 * Render the whole report into `line`, a sink taking one string at a time
 * (console.log when run as a CLI, an array push under test).
 */
export function renderProbeReport({ meta = {}, attempts = {} }, line = console.log) {
  const endpoints = buildEndpoints(meta);
  const best = chooseBest(endpoints, attempts);
  const rule = (t) => { line(''); line(`── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`); };

  line('PXIL integration probe');
  line(`Endpoint      ${meta.baseUrl || '(unknown)'}`);
  line(`Date range    ${meta.fromdate} → ${meta.todate}`);
  line(`Portfolio     ${meta.portfolioId || '(not set — all portfolios)'}`);
  if (meta.tokenLength) {
    line(`Token         present, ${meta.tokenLength} chars${meta.tokenFingerprint ? `, fingerprint ${meta.tokenFingerprint}` : ''} (not printed)`);
  }
  if (meta.capturedAt) line(`Captured      ${meta.capturedAt}${meta.host ? ` on ${meta.host}` : ''}`);
  if (meta.outboundIp) line(`Outbound IP   ${meta.outboundIp} (as seen by an external echo service)`);

  /* ----------------------------------------------- Q2: which auth works */

  rule('Q2  Authentication style per endpoint');
  line('Both styles are tried on every endpoint. If the Bearer header works');
  line('everywhere, we can stop putting the token in a query string.');
  line('');
  line('endpoint                      documented   header                query');

  for (const ep of endpoints) {
    const b = best[ep.key];
    const cell = (c, r) => `${MARK[c.verdict] || '?'} ${c.verdict}${r?.status ? ` ${r.status}` : ''}`;
    line(`${ep.key.padEnd(29)} ${ep.documented.padEnd(12)} ${cell(b.header, attempts?.[ep.key]?.header).padEnd(21)} ${cell(b.query, attempts?.[ep.key]?.query)}`);
  }

  const results = Object.values(best);
  line('');
  const refusedIp = results.find((b) => b.header.verdict === 'IP_NOT_WHITELISTED' || b.query.verdict === 'IP_NOT_WHITELISTED');
  const refusedDetail = refusedIp
    ? (refusedIp.header.verdict === 'IP_NOT_WHITELISTED' ? refusedIp.header : refusedIp.query).detail
    : '';
  if (refusedIp) {
    line(`→ PXIL refused our source IP (${refusedDetail.replace('PXIL saw our IP as ', '')}). Nothing else`);
    line('  can be tested until PXIL whitelists that IP for this environment.');
  } else if (results.every((b) => b.header.verdict === 'UNREACHABLE' && b.query.verdict === 'UNREACHABLE')) {
    line('→ Nothing answered at all — check the base URL and outbound network.');
  } else if (results.every((b) => works(b.ep.documented === 'header' ? b.header : b.query))) {
    line('→ Every endpoint answers with the auth style PXIL confirmed.');
    const upgraded = results.filter((b) => b.ep.documented === 'query' && works(b.header));
    if (upgraded.length) {
      line(`  ${upgraded.map((b) => b.ep.key).join(' and ')} now also accept the Bearer header —`);
      line('  PXIL may have upgraded them; move them off the query string once they confirm.');
    }
  } else {
    line('→ At least one endpoint rejects the auth style PXIL confirmed. That contradicts');
    line('  their reply and goes back to them with the row above.');
  }

  /* ------------------------------------------- Q7: response date order */

  rule('Q7  Response date order (DD-MM-YYYY vs MM-DD-YYYY)');
  const dateSamples = [];
  for (const key of ['tam-gtam', 'trade-margin']) {
    const env = envelopeOf(best[key]);
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

  /* ------------------------------------------ Q9: slot labelling */

  rule('Q9  Slot labelling and blocks per day');
  const slotEnv = envelopeOf(best['tam-gtam-slot-wise']);
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

  /* ---------------------------------------- Q4: DOR reconciliation */

  rule('Q4  Member DOR — does Total equal the sum of Category?');
  const dorEnv = envelopeOf(best['member-dor']);
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

  /* -------------------------------------------- Q6: Format-D fields */

  rule('Q6  Format-D — which fields are actually populated?');
  const fdEnv = envelopeOf(best['format-d']);
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
      const identical = f.price_rate_ratios.length === 1 && f.price_rate_ratios[0] === 1;
      line(identical
        ? '→ TransactionPrice and TransactionRate are identical. One is redundant; ask'
        : '→ The two price fields differ. The ratio above is the clue to their units —');
      line(identical
        ? '  PXIL which one is authoritative.'
        : '  a ratio near 1000 means one is ₹/MWh against ₹/kWh.');
    }
  }

  /* ------------------------------- Trade Margin self-consistency */

  rule("Trade Margin — do PXIL's declared totals match their own rows?");
  const tmEnv = envelopeOf(best['trade-margin']);
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
        line('');
        line(`→ ${badTrades} entity/entities declare a TotalTrades that does not equal the number of`);
        line('  applications returned. Ask PXIL what TotalTrades counts — it is not rows.');
      }
    }
  }

  rule('Summary');
  const reachable = results.filter((b) => b.style).length;
  line(`${reachable} of ${endpoints.length} endpoints returned a parseable report.`);
  line('Nothing was written to the database. Re-run over a range with known trades');
  line('before drawing conclusions from any "no rows" result above.');
  line('');

  return { best, reachable, refusedIp: refusedIp ? refusedDetail : null };
}
