import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { tokenFor, auth } from './helpers/reia.js';

// The HTTP surface over the IEX Front Office API. No credentials are configured
// in test, so every route answers in STUB mode — which is exactly the state a
// desk must be able to see and must never mistake for traded numbers.

let trader, viewer, outsider;

beforeEach(() => {
  trader = tokenFor('TRADING_USER');
  viewer = tokenFor('MANAGEMENT');
  outsider = tokenFor('SELLER');
});

afterEach(() => {
  delete process.env.IEX_API_TOKEN;
});

const get = (path, params = {}, token = trader) =>
  request(app).get(`/api/iex${path}`).query(params).set(auth(token));

describe('access', () => {
  it('refuses an unauthenticated caller', async () => {
    const r = await request(app).get('/api/iex/status');
    expect(r.status).toBe(401);
  });

  it('refuses a role outside the trading desk', async () => {
    const r = await get('/status', {}, outsider);
    expect(r.status).toBe(403);
  });

  it('lets a read-only trading role see the status', async () => {
    const r = await get('/status', {}, viewer);
    expect(r.status).toBe(200);
  });
});

describe('status', () => {
  it('reports stub mode without leaking the token', async () => {
    const r = await get('/status');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ live: false, mode: 'STUB' });
    expect(JSON.stringify(r.body)).not.toMatch(/eyJ/); // no JWT anywhere in it
  });

  it('publishes the per-segment hosts it will call', async () => {
    const r = await get('/status');
    expect(r.body.hosts.DAM).toBe('https://alphaidamapi.iexindia.com/');
    expect(r.body.hosts.RTM).toBe('https://alphartmapi.iexindia.com/');
    expect(r.body.cns_base_url).toMatch(/webportal|energx/);
  });

  it('says plainly what is read-only and what is not implemented at all', async () => {
    const r = await get('/status');
    expect(r.body.capabilities).toMatchObject({
      // Money-moving calls stay unimplemented on both sides of the integration.
      bid_submission: 'STUB',
      rec_order_entry: 'NOT_IMPLEMENTED',
      // REC and EC read paths exist now; STUB only because nothing is configured.
      rec: 'STUB',
      escerts: 'STUB',
    });
  });

  it('reports the REC segment separately from the Front Office one', async () => {
    const r = await get('/status');
    expect(r.body.rec).toMatchObject({ live: false, mode: 'STUB' });
    // IEX published a UAT REC host; the client defaults to it.
    expect(r.body.rec.base_url).toBe('https://alpharecapi.iexindia.com/');
  });

  it('surfaces the token expiry so a lapsed credential is visible before it is used', async () => {
    // The token IEX issued for UAT: a one-hour JWT that expired on 26-07-2026.
    process.env.IEX_API_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6IlNKVkExIiwiZXhwIjoxNzg1MDU5NDg4fQ.sig';
    const r = await get('/status');
    expect(r.body.token_present).toBe(true);
    expect(r.body.token_expired).toBe(true);
    expect(r.body.token_expires_at).toBe('2026-07-26T09:51:28.000Z');
    // Advisory, not a gate: IEX called that expiry a typo and puts real token
    // life at six months.
    expect(r.body.token_expiry_enforced).toBe(false);
  });
});

describe('report routes', () => {
  it('rejects a product with no IEX Front Office API', async () => {
    const r = await get('/pq-results', { product: 'REC', date: '2026-09-08' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/DAM, GDAM, RTM, HPDAM/);
  });

  it('requires an ISO delivery date', async () => {
    const r = await get('/pq-results', { product: 'DAM', date: '08-09-2026' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/YYYY-MM-DD/);
  });

  it('answers in stub mode, naming what is missing', async () => {
    const r = await get('/schedule-report', { product: 'DAM', date: '2026-09-08' });
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('STUB');
    expect(r.body.blocks).toBeNull();
    expect(r.body.note).toMatch(/iex_enabled/);
  });

  it('rejects a clock time that is not HH:MM:SS or the ALL wildcard', async () => {
    const r = await get('/rec/orders', { from_time: '10:00' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/HH:MM:SS/);
  });

  it('rejects an order status the REC spec does not define', async () => {
    const r = await get('/rec/orders', { status: 'Partial' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Pending, Executed, Rejected, Cancelled/);
  });

  it('answers the REC books in stub mode', async () => {
    const orders = await get('/rec/orders');
    expect(orders.status).toBe(200);
    expect(orders.body.mode).toBe('STUB');
    expect(orders.body.orders).toBeNull();
    const trades = await get('/rec/trades', { side: 'Sell', from_time: '10:00:00' });
    expect(trades.status).toBe(200);
    expect(trades.body.trades).toBeNull();
  });

  it('reports an unconfigured connectivity probe as unreachable, not as an error', async () => {
    const r = await get('/connectivity', { product: 'DAM' });
    expect(r.status).toBe(200);
    expect(r.body.reachable).toBe(false);
  });
});
