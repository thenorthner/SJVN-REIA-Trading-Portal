/**
 * WBES client.
 *
 * Two of these exist because of how the access actually arrived. Grid India sent
 * the whole endpoint URL where a base URL was asked for, and they answer their
 * own refusals with HTTP 200 carrying a WBES-4xx code — which, read as a success,
 * is indistinguishable from a day on which nothing was scheduled. Both mistakes
 * produce a plausible empty schedule rather than an error anyone would notice.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normaliseBaseUrl,
  getWbesConfig,
  fetchScheduleData,
  fetchLatestRevisionNo,
} from '../src/services/wbesService.js';

const ENV_KEYS = [
  'WBES_ENABLED', 'WBES_API_KEY', 'WBES_BASE_URL', 'WBES_USERNAME',
  'WBES_UTILITY_ACRONYM', 'WBES_KEY_IN_QUERY',
];

function liveConfig({ base = 'https://gateway.example/POSOCO', acronym = 'SJVNL' } = {}) {
  process.env.WBES_ENABLED = 'true';
  process.env.WBES_API_KEY = 'test-key';
  process.env.WBES_BASE_URL = base;
  process.env.WBES_USERNAME = 'usr_SJVNL';
  process.env.WBES_UTILITY_ACRONYM = acronym;
}

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok, status, text: async () => JSON.stringify(payload) };
  });
  return calls;
}

beforeEach(() => { ENV_KEYS.forEach((k) => delete process.env[k]); });
afterEach(() => { vi.restoreAllMocks(); ENV_KEYS.forEach((k) => delete process.env[k]); });

describe('base URL', () => {
  // What Grid India actually sent on 28-Sep-2026, pasted verbatim.
  it('cuts the full endpoint URL they hand out back to a base', () => {
    expect(normaliseBaseUrl('https://gateway.grid-india.in/POSOCO/reports/1.0/WebAccessAPI/GetUtilityExternalSharedData?apikey='))
      .toBe('https://gateway.grid-india.in/POSOCO');
  });

  it('leaves a base alone, trailing slash or not', () => {
    expect(normaliseBaseUrl('https://gateway.grid-india.in/POSOCO')).toBe('https://gateway.grid-india.in/POSOCO');
    expect(normaliseBaseUrl('https://gateway.grid-india.in/POSOCO/')).toBe('https://gateway.grid-india.in/POSOCO');
    expect(normaliseBaseUrl('')).toBe('');
  });

  it('builds the documented path once, not twice, from the URL as sent', async () => {
    liveConfig({ base: 'https://gateway.example/POSOCO/reports/1.0/WebAccessAPI/GetUtilityExternalSharedData?apikey=' });
    const calls = stubFetch({ ResponseBody: { GroupWiseDataList: [] }, ResponseStatus: { Code: 'WBES-200' } });
    await fetchScheduleData('2026-09-26');
    expect(calls[0].url).toBe('https://gateway.example/POSOCO/reports/1.0/WebAccessAPI/GetUtilityExternalSharedData?apikey=test-key');
  });
});

describe('the API key', () => {
  it('goes in the header and, as Grid India documented it, the query too', async () => {
    liveConfig();
    const calls = stubFetch({ ResponseBody: 3, ResponseStatus: { Code: 'WBES-200' } });
    await fetchLatestRevisionNo('2026-09-26');
    expect(calls[0].headers['X-API-Key']).toBe('test-key');
    expect(calls[0].url).toContain('?apikey=test-key');
  });

  it('can be kept out of the URL once the header is known to be honoured', async () => {
    liveConfig();
    process.env.WBES_KEY_IN_QUERY = 'false';
    const calls = stubFetch({ ResponseBody: 3, ResponseStatus: { Code: 'WBES-200' } });
    await fetchLatestRevisionNo('2026-09-26');
    expect(calls[0].url).not.toContain('apikey');
    expect(calls[0].headers['X-API-Key']).toBe('test-key');
  });
});

describe('refusals that arrive as HTTP 200', () => {
  // Verbatim from guide 3.2: a rejected key, username or IP comes back inside a
  // 200. Read as data it is an empty schedule, i.e. a silently wrong settlement.
  const REFUSAL = {
    ResponseBody: null,
    ResponseStatus: { Code: 'WBES-400', Message: 'API Access Validation Failed - ', DetailsList: [] },
  };

  it('does not read an access failure as a day with no schedule', async () => {
    liveConfig();
    stubFetch(REFUSAL);
    const res = await fetchScheduleData('2026-09-26');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/WBES-400.*API Access Validation Failed/);
  });

  it('reports the same on the revision-number call', async () => {
    liveConfig();
    stubFetch(REFUSAL);
    const res = await fetchLatestRevisionNo('2026-09-26');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/WBES-400/);
  });

  it('accepts WBES-200 as the success it is', async () => {
    liveConfig();
    stubFetch({ ResponseBody: 7, ResponseStatus: { Code: 'WBES-200', Message: null, DetailsList: [] } });
    const res = await fetchLatestRevisionNo('2026-09-26');
    expect(res).toMatchObject({ ok: true, mode: 'WBES', revision_no: 7 });
  });
});

describe('a connection dropped before any reply', () => {
  // Measured from a non-whitelisted address on 28-Sep-2026: TCP 443 opens, the
  // ClientHello goes out, zero bytes come back, no certificate is served. Node
  // reports that as a flat "fetch failed", which reads like an outage and sends
  // someone to check the key — when in fact the key was never transmitted.
  it('explains a dead TLS handshake as the IP allow-list, not an outage', async () => {
    liveConfig();
    const err = new Error('fetch failed');
    err.cause = { code: 'ECONNRESET' };
    global.fetch = vi.fn(async () => { throw err; });
    const res = await fetchLatestRevisionNo('2026-09-26');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/dropped before a reply/);
    expect(res.error).toMatch(/49\.50\.97\.173/);
    expect(res.error).toMatch(/never even sent/);
  });

  it('leaves an ordinary error alone', async () => {
    liveConfig();
    global.fetch = vi.fn(async () => { throw new Error('Unexpected token < in JSON'); });
    const res = await fetchScheduleData('2026-09-26');
    expect(res.error).toBe('Unexpected token < in JSON');
  });
});

describe('the request body', () => {
  it('sends the date as DD-MM-YYYY and the acronym as a list', async () => {
    liveConfig();
    const calls = stubFetch({ ResponseBody: { GroupWiseDataList: [] }, ResponseStatus: { Code: 'WBES-200' } });
    await fetchScheduleData('2026-09-26');
    expect(calls[0].body).toEqual({
      Date: '26-09-2026', SchdRevNo: -1, UserName: 'usr_SJVNL', UtilAcronymList: ['SJVNL'],
    });
  });

  // The acronym is unconfirmed, so an empty one must mean "as the guide shows
  // it" — an empty list — and never the string "" in a list, which no gateway
  // would match.
  it('sends an empty list when no acronym is configured', async () => {
    liveConfig({ acronym: '' });
    const calls = stubFetch({ ResponseBody: { GroupWiseDataList: [] }, ResponseStatus: { Code: 'WBES-200' } });
    await fetchScheduleData('2026-09-26');
    expect(calls[0].body.UtilAcronymList).toEqual([]);
  });

  it('omits the acronym entirely from the revision-number call, which takes none', async () => {
    liveConfig();
    const calls = stubFetch({ ResponseBody: 3, ResponseStatus: { Code: 'WBES-200' } });
    await fetchLatestRevisionNo('2026-09-26');
    expect(calls[0].body).toEqual({ Date: '26-09-2026', UserName: 'usr_SJVNL' });
  });
});

describe('stub mode', () => {
  it('stays in stub mode with no base URL, and says what is missing', async () => {
    process.env.WBES_ENABLED = 'true';
    process.env.WBES_API_KEY = 'test-key';
    const res = await fetchLatestRevisionNo('2026-09-26');
    expect(res.mode).toBe('STUB');
    expect(getWbesConfig().live).toBe(false);
    expect(res.note).toMatch(/wbes_base_url/);
  });
});
