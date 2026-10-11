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
  noDataAvailable,
  DOR_WINDOW_DAYS,
  dayFirstConfirmed,
  extractSlotWise,
  extractDor,
  extractFormatD,
  extractTradeMargin,
  summariseSlotLabelling,
  summariseStoaBreakup,
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
  RANGE_TOO_LONG: '!',
  RATE_LIMITED: '✗',
  NO_RESULT: '·',
};

/**
 * The widest range a billing report is asked for in one call. Not a rule PXIL
 * states: 60 days was answered on 5 Oct 2026 and 188 came back "Data limit
 * exceeded: Rows are greater than or equal to 50,000".
 */
export const BILLING_ASK_DAYS = 60;

/**
 * The six Phase 1 endpoints, with the ResponseBody key their rows live under
 * and the auth style PXIL's reply specifies for each.
 *
 * `documented: 'query'` on Member DOR and Reverse Auction is not a preference —
 * PXIL says those two are still Version 1 and take the token only as
 * APITokenNo, and a Bearer header gets 400 "API Token is mandatory".
 *
 * Every ranged report is asked for the end of the range only, in a window PXIL
 * accepts (`maxDays`): PXIL rations calls, and a call it refuses for size is a
 * call spent on nothing.
 */
export function buildEndpoints({ fromdate, todate, portfolioId = '' } = {}) {
  const ranged = { fromdate, todate, reportType: 'JSON' };
  if (portfolioId) ranged.portfolioId = portfolioId;
  const last = (maxDays) => ({ ...ranged, fromdate: clampFrom(fromdate, todate, maxDays) });
  const billing = { params: last(BILLING_ASK_DAYS), documented: 'header', maxDays: BILLING_ASK_DAYS };
  return [
    { key: 'tam-gtam', path: 'tam-gtam', bodyKey: 'TAMGTAM', ...billing },
    { key: 'slot-wise', path: 'slot-wise-quantity-and-charges', bodyKey: 'SlotWiseQuantityAndCharges', ...billing },
    { key: 'format-d', path: 'format-d', bodyKey: 'Trades', ...billing },
    { key: 'trade-margin', path: 'trade-margin', bodyKey: 'TradeMargin', ...billing },
    { key: 'member-dor', path: 'member-dor', params: last(DOR_WINDOW_DAYS), bodyKey: 'DOR', documented: 'query', maxDays: DOR_WINDOW_DAYS },
    { key: 'reverse-auction', path: 'reverse-auction/l1-summary', params: {}, bodyKey: null, documented: 'query' },
  ];
}

/** The later of `fromdate` and the day that makes the range `maxDays` long, inclusive. */
export function clampFrom(fromdate, todate, maxDays) {
  const earliest = Date.parse(`${todate}T00:00:00Z`) - (maxDays - 1) * 24 * 3600 * 1000;
  if (!Number.isFinite(earliest)) return fromdate;
  const iso = new Date(earliest).toISOString().slice(0, 10);
  return iso > fromdate ? iso : fromdate;
}

const works = (c) => c.verdict === 'DATA' || c.verdict === 'EMPTY';

/**
 * Pick the attempt to parse for the rest of the report: whichever style
 * returned rows, else whichever answered at all, else the documented one — so
 * a genuinely empty date range still yields a body to inspect instead of
 * being reported as a failure.
 *
 * A report PXIL refused for the whole range was walked in windows by the
 * capture tool. The window it found rows in — or, failing that, one that
 * answered empty — then stands in as the body to analyse.
 */
function chooseBest(endpoints, attempts, scan) {
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
    const walked = scan?.[ep.key];
    const stand = walked?.sample || walked?.empty || null;
    best[ep.key] = {
      ep,
      header: ch,
      query: cq,
      style: stand ? walked.style || ep.documented : style,
      result: stand ? stand.result : style === 'query' ? query : header,
      sampled: walked?.sample ? { fromdate: walked.sample.fromdate, todate: walked.sample.todate } : null,
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
export function renderProbeReport({ meta = {}, attempts = {}, controls = null, scan = null, usage = null }, line = console.log) {
  const endpoints = buildEndpoints(meta);
  const best = chooseBest(endpoints, attempts, scan);
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
  if (usage?.calls != null) line(`Calls made    ${usage.calls}${usage.budget ? ` of a budget of ${usage.budget}` : ''}`);

  // A 429 anywhere changes how everything after it reads, so it goes first.
  const limitedWindows = Object.values(scan || {}).flatMap((s) => s.windows || []).filter((w) => w.status === 429).length;
  const limitedCalls = Object.values(best).filter((b) => b.header.verdict === 'RATE_LIMITED' || b.query.verdict === 'RATE_LIMITED').length;
  if (usage?.rateLimit || limitedWindows || limitedCalls) {
    const seconds = usage?.rateLimit?.seconds;
    line('');
    line(`!! PXIL's request limit (HTTP 429) was hit during this capture${seconds ? ` — it said to wait ${seconds} seconds, about ${Math.round(seconds / 3600)} hours` : ''}.`);
    line('   Whatever was asked after that went unanswered. "No rows" below covers only');
    line('   the windows PXIL actually answered.');
  }

  /* ----------------------------------------------- Q2: which auth works */

  rule('Q2  Authentication style per endpoint');
  line('Each report is asked with the style PXIL documents for it; the other style is');
  line('tried only when the capture asks for both (a · means it was not tried).');
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
  const tooLong = results.filter((b) => b.header.verdict === 'RANGE_TOO_LONG' || b.query.verdict === 'RANGE_TOO_LONG');
  if (refusedIp) {
    line(`→ PXIL refused our source IP (${refusedDetail.replace('PXIL saw our IP as ', '')}). Nothing else`);
    line('  can be tested until PXIL whitelists that IP for this environment.');
  } else if (tooLong.length) {
    line(`→ ${tooLong.map((b) => b.ep.key).join(', ')} refused the date range, not the token:`);
    line(`  "${(tooLong[0].query.verdict === 'RANGE_TOO_LONG' ? tooLong[0].query : tooLong[0].header).detail}".`);
    line(tooLong.every((b) => scan?.[b.ep.key])
      ? '  Each was then walked in smaller windows — see the window scan below.'
      : '  Capture again with the current tool, which walks a refused range in smaller windows.');
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

  /* ------------------------------------------------------ window scan */

  if (scan && Object.keys(scan).length) {
    rule('Window scan — where are the rows?');
    line('Each report walked back through the range, newest first, in windows PXIL');
    line('accepts. A report stops at its first window with rows.');
    line('');
    const span = (w) => Math.round((Date.parse(w.todate) - Date.parse(w.fromdate)) / 86400000) + 1;
    // Unanswered: refused by the request limit, failed, or never reached.
    const unanswered = (s) => s.windows.filter((w) => !w.empty && !w.rows && !w.refused).length + (s.pending || []).length;
    for (const ep of endpoints.filter((e) => scan[e.key])) {
      const s = scan[ep.key];
      const answered = s.windows.filter((w) => w.empty || w.rows);
      const refused = s.windows.filter((w) => w.refused);
      const limited = s.windows.filter((w) => w.status === 429).length;
      const failed = s.windows.length - answered.length - refused.length - limited;
      line(`${ep.key.padEnd(14)} ${s.windows.length} window(s) asked: ${answered.filter((w) => w.empty).length} empty, ${refused.length} refused for size`
        + `${limited ? `, ${limited} refused by the request limit` : ''}${failed ? `, ${failed} failed` : ''}`
        + `${(s.pending || []).length ? `; ${s.pending.length} never asked` : ''}`);
      if (refused.length) {
        const widest = answered.length ? Math.max(...answered.map(span)) : null;
        line(`${''.padEnd(14)} narrowest refused ${Math.min(...refused.map(span))} day(s)${widest ? `, widest answered ${widest} day(s)` : ''}`);
      }
      const oldest = answered.map((w) => w.fromdate).sort()[0];
      line(s.sample
        ? `${''.padEnd(14)} → rows in ${s.sample.fromdate} → ${s.sample.todate}; analysed below`
        : unanswered(s) || s.truncated
          ? `${''.padEnd(14)} → ${oldest ? `no rows back to ${oldest}` : 'nothing answered'}; ${unanswered(s)} window(s) unanswered, so earlier dates are untested`
          : `${''.padEnd(14)} → no rows in any window of ${meta.fromdate} → ${meta.todate}`);
    }
    const sizeRefused = endpoints.filter((e) => scan[e.key] && !scan[e.key].sample && !scan[e.key].truncated
      && !unanswered(scan[e.key])
      && /data limit exceeded/i.test(`${best[e.key].header.detail} ${best[e.key].query.detail}`));
    if (sizeRefused.length) {
      line('');
      line(`→ PXIL refused ${sizeRefused.map((e) => e.key).join(', ')} for the whole range as 50,000 rows or`);
      line('  more, yet holds no rows for this member in any window of it. So the limit is');
      line('  evidently counted before the member filter — a member with no data is told to');
      line('  "reduce the date range". Worth raising with PXIL.');
    }
  }

  /* ------------------------------------- control: a path that is not there */

  rule('Control — is "No data available" really an empty report?');
  const control = controls?.unknown_path;
  if (!control) {
    line('No control call in this capture (it predates the control). An empty range');
    line('and a wrong path both come back as 404, so this stays unproven until one is taken.');
  } else {
    const said = control.json ? JSON.stringify(control.json) : (control.snippet || control.error || '');
    line(`A path that does not exist answers: HTTP ${control.status ?? '—'} ${said.slice(0, 160)}`);
    line(noDataAvailable(control.json)
      ? '→ The SAME answer as an empty report. "No data available" therefore cannot tell a'
      : '→ Different from "No data available", so that message on a real path is a genuine');
    line(noDataAvailable(control.json)
      ? '  quiet range from a wrong path. Ask PXIL how the two are meant to be told apart.'
      : '  empty range and not a missing endpoint.');
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
  const slotEnv = envelopeOf(best['slot-wise']);
  if (!slotEnv?.ok) {
    line('Slot-wise endpoint returned no usable body — cannot test.');
  } else {
    const s = summariseSlotLabelling(extractSlotWise(slotEnv.body));
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

  /* ------------------------------------- slot-wise STOA breakup */

  rule('Slot-wise — do the ten STOA components add up to STOACharges?');
  if (!slotEnv?.ok) {
    line('Slot-wise endpoint returned no usable body — cannot test.');
  } else {
    const b = summariseStoaBreakup(extractSlotWise(slotEnv.body));
    if (b.verdict === 'NO_ROWS') line('No slot-wise rows in this range — nothing to test.');
    else {
      line(`Rows          ${b.rows}   with breakup ${b.rows_with_breakup}   with non-zero STOA ${b.rows_with_stoa}`);
      line(`Reconciled    ${b.reconciled}   off ${b.unreconciled}`);
      if (b.unreconciled) line(`Largest gap   ${b.largest_variance}`);
      line(b.verdict === 'RECONCILES'
        ? '→ STOACharges equals the sum of its components on every row. The breakup'
        : b.verdict === 'GAP'
          ? '→ The components do NOT add up to STOACharges. Ask PXIL what the rest is'
          : b.verdict === 'ALL_ZERO'
            ? '→ Every row has zero STOA — nothing to test. Re-run over a range with'
            : '→ No row carries the breakup keys. Check the capture used the new endpoint.');
      if (b.verdict === 'RECONCILES') line('  is complete and can be posted component by component.');
      if (b.verdict === 'GAP') line('  before posting the components separately.');
      if (b.verdict === 'ALL_ZERO') line('  open-access (STOA) scheduling.');
    }
  }

  /* ---------------------------------------- Q4: DOR reconciliation */

  rule('Q4  Member DOR — does Total equal the sum of Category?');
  const dorParams = best['member-dor'].ep.params;
  const dorRefused = [best['member-dor'].header, best['member-dor'].query].some((c) => c.verdict === 'RANGE_TOO_LONG');
  if (dorParams.fromdate !== meta.fromdate && !dorRefused && !scan?.['member-dor']) {
    line(`Asked for     ${dorParams.fromdate} → ${dorParams.todate} only: PXIL refuses more than ${DOR_WINDOW_DAYS} days per call.`);
  }
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
  const withRows = results.filter((b) => b.header.verdict === 'DATA' || b.query.verdict === 'DATA' || b.sampled).length;
  if (reachable === endpoints.length && withRows === 0) {
    line('Every one of them is empty: the token, the IP and the paths all work, and PXIL');
    line('holds nothing for this member in this range. Nothing about the figures is proven');
    line('until a range with trades is captured.');
  }
  line('Nothing was written to the database. Re-run over a range with known trades');
  line('before drawing conclusions from any "no rows" result above.');
  line('');

  return { best, reachable, refusedIp: refusedIp ? refusedDetail : null };
}
