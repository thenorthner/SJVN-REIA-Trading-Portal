import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { tokenFor, auth } from './helpers/reia.js';

// The HTTP surface over the PXIL member report APIs. No credentials are
// configured in test, so every route answers in STUB mode from the documented
// sample — which is exactly the state a desk must be able to see.

const RANGE = { fromdate: '2026-01-01', todate: '2026-01-31' };

let trader, viewer, outsider;

beforeEach(() => {
  trader = tokenFor('TRADING_USER');
  viewer = tokenFor('MANAGEMENT');
  outsider = tokenFor('SELLER');
});

const q = (path, params = RANGE, token = trader) =>
  request(app).get(`/api/pxil${path}`).query(params).set(auth(token));

describe('access', () => {
  it('refuses an unauthenticated caller', async () => {
    const r = await request(app).get('/api/pxil/status');
    expect(r.status).toBe(401);
  });

  it('refuses a role outside the trading desk', async () => {
    const r = await request(app).get('/api/pxil/status').set(auth(outsider));
    expect(r.status).toBe(403);
  });

  it('lets a read-only trading role pull a report', async () => {
    const r = await q('/format-d', RANGE, viewer);
    expect(r.status).toBe(200);
  });
});

describe('status', () => {
  it('reports stub mode without leaking the token', async () => {
    const r = await request(app).get('/api/pxil/status').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('STUB');
    expect(r.body.live).toBe(false);
    expect(r.body.token_present).toBe(false);
    expect(r.body).not.toHaveProperty('token');
    expect(JSON.stringify(r.body)).not.toMatch(/APITokenNo/);
  });

  it('flags the daily TAM-GTAM path as unconfirmed', async () => {
    const r = await request(app).get('/api/pxil/status').set(auth(trader));
    expect(r.body.tam_gtam_path_confirmed).toBe(false);
    expect(r.body.endpoints).toHaveLength(6);
    expect(r.body.endpoints.map(e => e.key)).toContain('trade-margin');
  });
});

describe('date range validation', () => {
  const ranged = ['/tam-gtam', '/tam-gtam/slot-wise', '/format-d', '/member-dor', '/trade-margin'];

  for (const path of ranged) {
    it(`${path} requires both dates`, async () => {
      const r = await q(path, { fromdate: '2026-01-01' });
      expect(r.status).toBe(400);
    });

    // A DD-MM-YYYY string would reach PXIL and return an empty report, which is
    // indistinguishable from a genuinely quiet range. Reject it here instead.
    it(`${path} rejects a non-ISO date`, async () => {
      const r = await q(path, { fromdate: '01-01-2026', todate: '31-01-2026' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/YYYY-MM-DD/);
    });

    it(`${path} rejects an inverted range`, async () => {
      const r = await q(path, { fromdate: '2026-01-31', todate: '2026-01-01' });
      expect(r.status).toBe(400);
    });
  }
});

describe('reports in stub mode', () => {
  it('returns TAM-GTAM rows and says the date order is still unconfirmed', async () => {
    const r = await q('/tam-gtam');
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe('STUB');
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].trade_date).toBe('2025-11-06');
    // Every day in the sample is 12 or under, so DD-MM is not yet proven.
    expect(r.body.date_order_confirmed).toBe(false);
    expect(r.body.note).toMatch(/sample/i);
  });

  it('returns slot rows without renumbering them', async () => {
    const r = await q('/tam-gtam/slot-wise');
    expect(r.status).toBe(200);
    const row = r.body.rows[0];
    expect(row.trade_slots[0].from_time).toBe('00:15');
    expect(row.trade_slot_count).toBe(1);
  });

  it('returns Format-D rows and checks PXIL’s own count against them', async () => {
    const r = await q('/format-d');
    expect(r.status).toBe(200);
    expect(r.body.total_count_declared).toBe(1);
    expect(r.body.total_count_matches).toBe(true);
  });

  it('surfaces the DOR row whose Total does not match its Category', async () => {
    const r = await q('/member-dor');
    expect(r.status).toBe(200);
    expect(r.body.unreconciled_count).toBe(1);
    expect(r.body.rows[0].total_reconciles).toBe(false);
    expect(r.body.unreconciled[0].variance).toBeCloseTo(115386.32, 2);
  });

  it('returns trade margin entities with PXIL’s declared totals checked', async () => {
    const r = await q('/trade-margin');
    expect(r.status).toBe(200);
    expect(r.body.entities).toHaveLength(1);
    // Their sample declares 10 trades over a single application.
    expect(r.body.trade_count_mismatches).toBe(1);
    expect(r.body.entities[0].portfolios[0].sums_reconcile).toBe(true);
  });

  it('returns a reverse auction snapshot stamped with a poll time', async () => {
    const r = await request(app).get('/api/pxil/reverse-auction').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.auctions).toHaveLength(1);
    expect(r.body.auctions[0].l1).toBe(5.5);
    expect(r.body.auctions[0].sellers).toHaveLength(2);
    expect(r.body.polled_at).toBeTruthy();
  });

  it('does not require a date range on the reverse auction endpoint', async () => {
    const r = await request(app).get('/api/pxil/reverse-auction').set(auth(viewer));
    expect(r.status).toBe(200);
  });
});
