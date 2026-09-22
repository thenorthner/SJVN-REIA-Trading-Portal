import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { cercScraper } from '../src/services/cercScraper.js';
import { tokenFor, auth } from './helpers/reia.js';

// "Fetch Latest CERC MMC Report" sent no month, and the server filled in
// January 2026 — so the button re-fetched the same old report every time. And
// when cercind.gov.in could not be reached the screen showed a bare
// "500 fetch failed". Found by the button audit.

afterEach(() => vi.restoreAllMocks());

const trigger = (token, body) => request(app).post('/api/cerc-market/trigger').set(auth(token)).send(body);

describe('CERC report fetch', () => {
  it('asks for a month instead of fetching January 2026 by default', async () => {
    const spy = vi.spyOn(cercScraper, 'fetchCercReport');
    const res = await trigger(tokenFor('TRADING_USER'), {});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('says the CERC site could not be reached, as a 502, when it is out of reach', async () => {
    vi.spyOn(cercScraper, 'fetchCercReport').mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND cercind.gov.in'), { code: 'ENOTFOUND' }) }),
    );
    const res = await trigger(tokenFor('TRADING_USER'), { period: '2026-08' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Could not reach cercind\.gov\.in for the 2026-08 report/);
  });

  it('fetches the month asked for', async () => {
    const spy = vi.spyOn(cercScraper, 'fetchCercReport').mockResolvedValue({ status: 'PROCESSED' });
    const res = await trigger(tokenFor('TRADING_USER'), { period: '2026-08' });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('2026-08');
  });

  it('leaves fetching to the trading desk: a trading client may read, not fetch', async () => {
    const spy = vi.spyOn(cercScraper, 'fetchCercReport');
    const scan = vi.spyOn(cercScraper, 'scanForNewReports');
    const client = tokenFor('TRADING_CLIENT');
    expect((await trigger(client, { period: '2026-08' })).status).toBe(403);
    expect((await request(app).post('/api/cerc-market/scan').set(auth(client))).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
  });
});
