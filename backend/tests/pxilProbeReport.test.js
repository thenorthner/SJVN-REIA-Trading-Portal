/**
 * The probe report, and the two places its endpoint list is written down.
 *
 * PXIL only answers one whitelisted public IP, so the capture has to be taken
 * by a standalone tool on the server (tools/pxil-probe/pxil-probe.mjs, no
 * node_modules, no database) and analysed here. That split means the endpoint
 * list exists twice — these tests pin the copies together, and pin what the
 * report concludes from a recorded body, so a capture that cost a server
 * session is never misread.
 */
import { describe, it, expect } from 'vitest';
import { buildEndpoints, renderProbeReport, clampFrom } from '../src/services/pxilProbeReport.js';
import {
  ENDPOINT_SPECS, clampFrom as toolClampFrom, windowsNewestFirst, halveNewestFirst,
} from '../../tools/pxil-probe/pxil-probe.mjs';

const RANGE = { fromdate: '2026-08-01', todate: '2026-09-22' };

/** A recorded 200 in the wrapper TAM-GTAM / Format-D / Trade Margin use. */
const envelope = (body) => ({ ResponseStatus: { Code: 'CNSAPI-200', Message: 'Success' }, ResponseBody: body });
/** Member DOR spells the same thing StatusCode / StatusMessage. */
const dorEnvelope = (body) => ({ ResponseStatus: { StatusCode: '200', StatusMessage: 'Success' }, ResponseBody: body });

const ok = (json) => ({ status: 200, ok: true, content_type: 'application/json', ip_not_allowed: null, json, ms: 12 });
const refused = (ip) => ({
  status: 403,
  ok: false,
  content_type: 'application/json',
  ip_not_allowed: ip,
  json: { message: 'Access denied. Your IP is not allowed.', your_ip: ip },
  ms: 9,
});

function render(attempts, meta = {}, controls = null, scan = null, usage = null) {
  const lines = [];
  const summary = renderProbeReport({ meta: { ...RANGE, baseUrl: 'https://dashboard.pxil.in', ...meta }, attempts, controls, scan, usage }, (l) => lines.push(l));
  return { text: lines.join('\n'), lines, summary };
}

/** Both auth styles on every endpoint answered the same way. */
function allEndpoints(result) {
  const attempts = {};
  for (const spec of ENDPOINT_SPECS) attempts[spec.key] = { header: result(), query: result() };
  return attempts;
}

describe('endpoint list, written down twice', () => {
  it('the standalone server tool and the backend agree, key for key', () => {
    const backend = buildEndpoints(RANGE);
    expect(ENDPOINT_SPECS.map((s) => s.key)).toEqual(backend.map((e) => e.key));

    for (const spec of ENDPOINT_SPECS) {
      const ep = backend.find((e) => e.key === spec.key);
      expect(ep, `${spec.key} missing from buildEndpoints`).toBeTruthy();
      expect(ep.path, `${spec.key} path`).toBe(spec.path);
      expect(ep.bodyKey, `${spec.key} bodyKey`).toBe(spec.bodyKey);
      expect(ep.documented, `${spec.key} auth style`).toBe(spec.documented);
      // `ranged` in the tool is what "has a date range" means in the backend.
      expect(Object.keys(ep.params).includes('fromdate'), `${spec.key} ranged`).toBe(spec.ranged);
      expect(ep.maxDays, `${spec.key} range limit`).toBe(spec.maxDays);
    }
  });

  it('both keep Member DOR inside the 31 days PXIL allows, the same way', () => {
    // 1 Aug → 22 Sep is 53 days; PXIL answered 400 to exactly this on 5 Oct 2026.
    const dor = buildEndpoints(RANGE).find((e) => e.key === 'member-dor');
    expect(dor.params).toMatchObject({ fromdate: '2026-08-23', todate: '2026-09-22' });
    expect(buildEndpoints(RANGE).find((e) => e.key === 'tam-gtam').params.fromdate).toBe('2026-08-01');
    for (const [from, to] of [['2026-08-01', '2026-09-22'], ['2026-09-10', '2026-09-22'], ['2026-09-22', '2026-09-22']]) {
      expect(toolClampFrom(from, to, 31)).toBe(clampFrom(from, to, 31));
    }
    // A range already inside the limit is left alone.
    expect(clampFrom('2026-09-10', '2026-09-22', 31)).toBe('2026-09-10');
  });

  it('keeps the reverse auction out of the date-ranged calls', () => {
    // It is a live L1 snapshot; sending it a range is what got a 400 before.
    expect(ENDPOINT_SPECS.find((s) => s.key === 'reverse-auction').ranged).toBe(false);
    expect(buildEndpoints(RANGE).find((e) => e.key === 'reverse-auction').params).toEqual({});
  });
});

describe('the windows the server tool walks', () => {
  const days = ([from, to]) => (Date.parse(to) - Date.parse(from)) / 86400000 + 1;

  it('cover the range newest first, with no day skipped or asked twice', () => {
    const windows = windowsNewestFirst('2025-04-01', '2026-03-31', 31);
    expect(windows[0]).toEqual(['2026-03-01', '2026-03-31']);
    expect(windows[windows.length - 1][0]).toBe('2025-04-01');
    expect(windows.every((w) => days(w) <= 31)).toBe(true);
    expect(windows.reduce((a, w) => a + days(w), 0)).toBe(365);
    for (let i = 1; i < windows.length; i += 1) {
      expect(Date.parse(windows[i - 1][0]) - Date.parse(windows[i][1])).toBe(86400000);
    }
    expect(windowsNewestFirst('2026-03-31', '2026-03-31', 31)).toEqual([['2026-03-31', '2026-03-31']]);
  });

  it('halve a refused window into its later and earlier parts', () => {
    expect(halveNewestFirst('2026-03-01', '2026-03-31')).toEqual([['2026-03-17', '2026-03-31'], ['2026-03-01', '2026-03-16']]);
    expect(halveNewestFirst('2026-03-01', '2026-03-02')).toEqual([['2026-03-02', '2026-03-02'], ['2026-03-01', '2026-03-01']]);
  });
});

describe('a capture taken from a non-whitelisted host', () => {
  const { text, summary } = render(allEndpoints(() => refused('223.31.159.139')));

  it('names the IP PXIL saw and stops there', () => {
    expect(text).toContain('PXIL refused our source IP (223.31.159.139)');
    expect(summary.refusedIp).toContain('223.31.159.139');
    expect(summary.reachable).toBe(0);
  });

  it('never reads the 403 as a bad token', () => {
    // PXIL answers 403 for the IP filter and 401 for a token. Conflating them
    // sent us chasing a dead token on IEX for a day.
    expect(text).not.toContain('AUTH_REJECTED');
    expect(text).toContain('IP_NOT_WHITELISTED');
  });
});

describe('a capture with live rows', () => {
  const slots = (count, startAtMidnight) => Array.from({ length: count }, (_, i) => {
    const minutes = (startAtMidnight ? i : i + 1) * 15;
    const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    const toMinutes = minutes + 15;
    return {
      fromTime: `${hh}:${mm}`,
      toTime: `${String(Math.floor(toMinutes / 60) % 24).padStart(2, '0')}:${String(toMinutes % 60).padStart(2, '0')}`,
      Mw: 40,
      Mwh: 10,
    };
  });

  const attempts = {
    // Day 15 is above 12, which is the only thing that can prove day-first.
    'tam-gtam': { header: ok(envelope({ TAMGTAM: [{ Date: '15-09-2026', EntityId: 'E1', EntityName: 'SJVN Limited' }] })), query: refused('x') },
    'slot-wise': {
      header: ok(envelope({
        SlotWiseQuantityAndCharges: [{
          Date: '15-09-2026',
          EntityId: 'E1',
          Applications: [{
            ApplicationNo: 'A1',
            PortfolioId: 'P1',
            TradeSlotWiseDetails: slots(96, true),
            STOACharges: 1550,
            ApplicationNLDCCharges: 500,
            TransmissionStateTCharges: 900,
          }],
        }],
      })),
      query: refused('x'),
    },
    'format-d': { header: ok(envelope({ Trades: [] })), query: refused('x') },
    'trade-margin': { header: ok(envelope({ TradeMargin: [] })), query: refused('x') },
    'member-dor': {
      header: refused('x'),
      query: ok(dorEnvelope({
        DOR: [{
          ApplicationNo: 'MG320260101WR32983',
          Total: 1000,
          Category: { Charges: 0, Fees: 100, IGST: 0, CGST: 0, SGST: 0, CP: 800 },
        }],
      })),
    },
    'reverse-auction': { header: refused('x'), query: ok({ statuscode: 200, message: 'ok', data: { L1: 5.5 } }) },
  };

  const { text } = render(attempts, { tokenLength: 36, tokenFingerprint: 'abc12345', outboundIp: '49.50.97.173' });

  it('proves the response date order from a day above the 12th', () => {
    expect(text).toContain('PROVEN day-first');
  });

  it('reports a STOA breakup that falls short of STOACharges', () => {
    expect(text).toContain('Largest gap   150');
    expect(text).toContain('The components do NOT add up to STOACharges');
  });

  it('settles slot labelling from a full 96-block day', () => {
    expect(text).toContain('Slots are labelled by START time');
    expect(text).toContain('yes (95 or 96 blocks present)');
  });

  it('reports a DOR gap as blocking rather than absorbing it', () => {
    expect(text).toContain('Largest gap   100');
    expect(text).toContain('The gap is REAL in live data');
    expect(text).toContain('This stays blocking');
  });

  it('distinguishes an empty range from a failure', () => {
    // Format-D answered 200 with no rows; that is a normal non-trading period.
    expect(text).toContain('No Format-D rows in this range');
    expect(text).not.toContain('Format-D returned no usable body');
  });

  it('carries the capture provenance into the report', () => {
    expect(text).toContain('fingerprint abc12345');
    expect(text).toContain('49.50.97.173');
  });

  it('does not print a token length it was not given', () => {
    const { text: bare } = render(allEndpoints(() => refused('1.2.3.4')));
    expect(bare).not.toContain('Token         present');
  });
});

describe('the first capture PXIL answered — production, 5 Oct 2026', () => {
  // Bodies verbatim from the server run; only the timestamps are shortened.
  const said = (status, message, extra = {}) => ({
    status, ok: status === 200, content_type: 'application/json', ip_not_allowed: null,
    json: { message, statuscode: status, timestamp: '05-10-2026 00:18:13', ...extra }, ms: 100,
  });
  const noData = () => said(404, 'No data available');
  const noToken = () => said(400, 'Validation error - API Token is mandatory.');
  const attempts = {
    'tam-gtam': { header: noData(), query: noData() },
    'slot-wise': { header: noData(), query: noData() },
    'format-d': { header: noData(), query: noData() },
    'trade-margin': { header: noData(), query: noData() },
    'member-dor': {
      header: noToken(),
      query: said(400, 'Validation error - The difference between From Date and To Date cannot exceed 31 days'),
    },
    'reverse-auction': { header: noToken(), query: said(200, 'Auction data not found', { data: [], error: '' }) },
  };
  const { text, summary } = render(attempts, { fromdate: '2026-08-01', todate: '2026-09-29', tokenFingerprint: 'ee093733', tokenLength: 27 });

  it('reads the four billing 404s as empty reports, not wrong paths', () => {
    expect(text).not.toContain('NOT_FOUND');
    expect(text).toMatch(/tam-gtam\s+header\s+○ EMPTY 404/);
    expect(text).toMatch(/slot-wise\s+header\s+○ EMPTY 404/);
  });

  it('says Member DOR refused the range, not the token', () => {
    expect(text).toContain('member-dor refused the date range, not the token');
    expect(text).toContain('cannot exceed 31 days');
    expect(text).not.toContain('rejects the auth style PXIL confirmed');
  });

  it('shows the Version 1 APIs refusing a Bearer header', () => {
    expect(text).toMatch(/reverse-auction\s+query\s+✗ AUTH_REJECTED 400\s+○ EMPTY 200/);
  });

  it('admits the empty-versus-wrong-path question is unproven without a control', () => {
    expect(text).toContain('No control call in this capture');
    expect(summary.reachable).toBe(5);
  });
});

describe('a capture with the control call and Member DOR inside its limit', () => {
  const body = (status, message, extra = {}) => ({
    status, ok: status === 200, content_type: 'application/json', ip_not_allowed: null,
    json: { message, statuscode: status, ...extra }, ms: 100,
  });
  const attempts = {};
  for (const spec of ENDPOINT_SPECS) {
    const empty = spec.key === 'reverse-auction'
      ? body(200, 'Auction data not found', { data: [] })
      : body(404, 'No data available');
    attempts[spec.key] = spec.documented === 'query'
      ? { header: body(400, 'Validation error - API Token is mandatory.'), query: empty }
      : { header: empty, query: empty };
  }

  it('proves an empty report when a wrong path answers differently', () => {
    const control = { status: 404, ok: false, json: null, snippet: '<html>Not Found</html>', ms: 5 };
    const { text, summary } = render(attempts, {}, { unknown_path: control });
    expect(text).toContain('is a genuine');
    expect(text).toContain('Every endpoint answers with the auth style PXIL confirmed');
    expect(text).toContain('Every one of them is empty');
    expect(text).toContain('Asked for     2026-08-23 → 2026-09-22 only');
    expect(summary.reachable).toBe(6);
  });

  it('says so when a wrong path answers exactly like an empty report', () => {
    const { text } = render(attempts, {}, { unknown_path: body(404, 'No data available') });
    expect(text).toContain('The SAME answer as an empty report');
  });
});

describe('a wide range PXIL refused for size, walked in windows', () => {
  // Production, 5 Oct 2026, 1 Apr 2025 → 31 Mar 2026: every billing report
  // answered "Data limit exceeded", Member DOR was asked for its last 31 days.
  const body = (status, message, extra = {}) => ({
    status, ok: status === 200, content_type: 'application/json', ip_not_allowed: null,
    json: { message, statuscode: status, ...extra }, ms: 100,
  });
  const tooMany = () => body(400, 'Data limit exceeded: Rows are greater than or equal to 50,000. Please reduce the date range');
  const noData = () => body(404, 'No data available');
  const noToken = () => body(400, 'Validation error - API Token is mandatory.');
  const dorEmpty = () => ({
    status: 200, ok: true, content_type: 'application/json', ip_not_allowed: null, ms: 90,
    json: { ResponseBody: { DOR: [] }, ResponseStatus: { StatusCode: '200', StatusMessage: 'No data found' } },
  });
  const meta = { fromdate: '2025-04-01', todate: '2026-03-31' };
  const attempts = {
    'tam-gtam': { header: tooMany(), query: tooMany() },
    'slot-wise': { header: tooMany(), query: tooMany() },
    'format-d': { header: tooMany(), query: tooMany() },
    'trade-margin': { header: tooMany(), query: tooMany() },
    'member-dor': { header: noToken(), query: dorEmpty() },
    'reverse-auction': { header: noToken(), query: body(200, 'Auction data not found', { data: [] }) },
  };
  const win = (fromdate, todate, over = {}) => ({ fromdate, todate, status: 404, rows: 0, refused: false, empty: true, error: null, ...over });
  const emptyScan = (style, result) => ({
    style,
    windows: [win('2026-03-01', '2026-03-31'), win('2026-01-29', '2026-02-28'), win('2025-04-01', '2026-01-28', { status: 400, refused: true, empty: false })],
    sample: null,
    empty: { fromdate: '2026-03-01', todate: '2026-03-31', result },
    truncated: false,
  });

  it('says the refusal was about size, and that no window had rows', () => {
    const scan = {
      'tam-gtam': emptyScan('header', noData()),
      'slot-wise': emptyScan('header', noData()),
      'format-d': emptyScan('header', noData()),
      'trade-margin': emptyScan('header', noData()),
      'member-dor': emptyScan('query', dorEmpty()),
    };
    const { text, summary } = render(attempts, meta, null, scan);
    expect(text).toContain('refused the date range, not the token');
    expect(text).toContain('Each was then walked in smaller windows');
    expect(text).toMatch(/tam-gtam\s+3 window\(s\) asked: 2 empty, 1 refused for size/);
    expect(text).toContain('no rows in any window of 2025-04-01 → 2026-03-31');
    // The finding worth taking to PXIL: a limit that trips for a member with no rows.
    expect(text).toContain('evidently counted before the member filter');
    // Every report did answer, in a window — that is connected, and empty.
    expect(summary.reachable).toBe(6);
    expect(text).toContain('Every one of them is empty');
  });

  it('analyses the window the scan found rows in', () => {
    const found = {
      status: 200, ok: true, content_type: 'application/json', ip_not_allowed: null, ms: 120,
      json: {
        ResponseStatus: { Code: 'CNSAPI-200', Message: 'Success' },
        ResponseBody: { TAMGTAM: [{ Date: '15-12-2025', EntityId: 'P1', Applications: [{ ApplicationNo: 'A1' }] }] },
      },
    };
    const scan = {
      'tam-gtam': {
        style: 'header',
        windows: [win('2026-03-01', '2026-03-31'), win('2025-11-28', '2025-12-28', { status: 200, rows: 1, empty: false })],
        sample: { fromdate: '2025-11-28', todate: '2025-12-28', result: found },
        empty: null,
        truncated: false,
      },
    };
    const { text } = render(attempts, meta, null, scan);
    expect(text).toContain('rows in 2025-11-28 → 2025-12-28; analysed below');
    expect(text).toContain('PROVEN day-first');
    expect(text).not.toContain('Every one of them is empty');
  });

  // The capture of 5 Oct 2026, 10:18 UTC: eight TAM-GTAM windows answered, then
  // PXIL's request limit refused the other ten and every window of every other report.
  it('never reads a window PXIL refused by its request limit as "no rows"', () => {
    const limited = (fromdate, todate) => win(fromdate, todate, { status: 429, empty: false });
    const scan = {
      'tam-gtam': {
        style: 'header',
        windows: [win('2026-09-05', '2026-10-05'), win('2026-01-31', '2026-03-02'), limited('2025-12-31', '2026-01-30'), limited('2025-04-01', '2025-04-26')],
        sample: null,
        empty: { fromdate: '2026-09-05', todate: '2026-10-05', result: noData() },
        truncated: false,
      },
      'slot-wise': { style: 'header', windows: [limited('2026-09-05', '2026-10-05'), limited('2026-08-05', '2026-09-04')], sample: null, empty: null, truncated: false },
    };
    const { text } = render(attempts, { fromdate: '2025-04-01', todate: '2026-10-05' }, null, scan);
    expect(text).toContain("PXIL's request limit (HTTP 429) was hit during this capture");
    expect(text).toMatch(/tam-gtam\s+4 window\(s\) asked: 2 empty, 0 refused for size, 2 refused by the request limit/);
    expect(text).toContain('no rows back to 2026-01-31; 2 window(s) unanswered, so earlier dates are untested');
    expect(text).toContain('nothing answered; 2 window(s) unanswered');
    expect(text).not.toContain('no rows in any window of');
    // Not every window was answered, so nothing can be concluded about the size limit.
    expect(text).not.toContain('evidently counted before the member filter');
  });

  it('says what a budgeted run left unasked', () => {
    const scan = {
      'tam-gtam': {
        style: 'header',
        windows: [win('2026-06-08', '2026-08-06')],
        sample: null,
        empty: { fromdate: '2026-06-08', todate: '2026-08-06', result: noData() },
        pending: [['2026-04-09', '2026-06-07'], ['2025-04-01', '2026-04-08']],
      },
    };
    const { text } = render(attempts, meta, null, scan, { calls: 10, budget: 10, rateLimit: { seconds: 68472 } });
    expect(text).toContain('Calls made    10 of a budget of 10');
    expect(text).toContain('it said to wait 68472 seconds, about 19 hours');
    expect(text).toMatch(/tam-gtam\s+1 window\(s\) asked: 1 empty, 0 refused for size; 2 never asked/);
    expect(text).toContain('no rows back to 2026-06-08; 2 window(s) unanswered');
  });

  it('asks for a fresh capture when the tool that took it could not walk the range', () => {
    const { text } = render(attempts, meta);
    expect(text).toContain('Capture again with the current tool');
    expect(text).toContain('Asked for     2026-03-01 → 2026-03-31 only');
  });
});

describe('an upgraded Version 1 endpoint', () => {
  it('is reported the day the Bearer header starts working on it', () => {
    // PXIL said Member DOR and Reverse Auction take the token only as a query
    // parameter. When that changes we want to hear it from the probe, not find
    // out years later.
    const attempts = {};
    for (const spec of ENDPOINT_SPECS) {
      attempts[spec.key] = { header: ok(envelope({ [spec.bodyKey || 'Trades']: [] })), query: ok(envelope({ [spec.bodyKey || 'Trades']: [] })) };
    }
    const { text } = render(attempts);
    expect(text).toContain('Every endpoint answers with the auth style PXIL confirmed');
    expect(text).toContain('now also accept the Bearer header');
    expect(text).toContain('member-dor');
  });
});
