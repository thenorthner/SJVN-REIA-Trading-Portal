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

  it('says plainly which segments are not implemented', async () => {
    const r = await get('/status');
    expect(r.body.capabilities).toMatchObject({
      bid_submission: 'STUB',
      rec: 'NOT_IMPLEMENTED',
      escerts: 'NOT_IMPLEMENTED',
    });
  });

  it('surfaces the token expiry so a lapsed credential is visible before it is used', async () => {
    // The token IEX issued for UAT: a one-hour JWT that expired on 26-07-2026.
    process.env.IEX_API_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6IlNKVkExIiwiZXhwIjoxNzg1MDU5NDg4fQ.sig';
    const r = await get('/status');
    expect(r.body.token_present).toBe(true);
    expect(r.body.token_expired).toBe(true);
    expect(r.body.token_expires_at).toBe('2026-07-26T09:51:28.000Z');
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

  it('reports an unconfigured connectivity probe as unreachable, not as an error', async () => {
    const r = await get('/connectivity', { product: 'DAM' });
    expect(r.status).toBe(200);
    expect(r.body.reachable).toBe(false);
  });
});
