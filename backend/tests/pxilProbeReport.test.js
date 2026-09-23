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
import { buildEndpoints, renderProbeReport } from '../src/services/pxilProbeReport.js';
import { ENDPOINT_SPECS } from '../../tools/pxil-probe/pxil-probe.mjs';

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

function render(attempts, meta = {}) {
  const lines = [];
  const summary = renderProbeReport({ meta: { ...RANGE, baseUrl: 'https://dashboard.pxil.in', ...meta }, attempts }, (l) => lines.push(l));
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
    }
  });

  it('keeps the reverse auction out of the date-ranged calls', () => {
    // It is a live L1 snapshot; sending it a range is what got a 400 before.
    expect(ENDPOINT_SPECS.find((s) => s.key === 'reverse-auction').ranged).toBe(false);
    expect(buildEndpoints(RANGE).find((e) => e.key === 'reverse-auction').params).toEqual({});
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
    'tam-gtam-slot-wise': {
      header: ok(envelope({
        TAMGTAM: [{
          Date: '15-09-2026',
          EntityId: 'E1',
          Applications: [{ ApplicationNo: 'A1', PortfolioId: 'P1', TradeSlotWiseDetails: slots(96, true) }],
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
