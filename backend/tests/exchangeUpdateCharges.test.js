import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import { buildLoadedCharges } from '../src/routes/exchangeUpdateCharges.js';

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
});

function head(charges, name) {
  return charges.find((c) => c.charge_head === name);
}

describe('buildLoadedCharges from rate master', () => {
  it('does not use the old ISET placeholders (450 / 2000)', () => {
    const charges = buildLoadedCharges({
      sellerState: 'West Bengal', buyerState: 'Delhi', onDate: '2026-05-01',
    });
    expect(head(charges, 'ISTS Transmission Charges').buyer_rate).toBe(379);
    expect(head(charges, 'State Transmission Charges').seller_rate).toBe(238.4);
    expect(head(charges, 'State Transmission Charges').buyer_rate).toBe(382.54);
    expect(head(charges, 'SLDC Application Fees').seller_rate).toBe(1000);
    expect(charges.some((c) => c.buyer_rate === 450 || c.seller_rate === 2000)).toBe(false);
  });

  it('prices a Haryana drawal corridor once the state is on the master', () => {
    const charges = buildLoadedCharges({
      sellerState: 'Himachal Pradesh', buyerState: 'Haryana', onDate: '2026-05-01',
    });
    expect(head(charges, 'State Transmission Charges').seller_rate).toBe(327.4);
    expect(head(charges, 'State Transmission Charges').buyer_rate).toBe(268.5);
    expect(head(charges, 'State Operating Charges').buyer_rate).toBe(1000);
  });

  it('leaves STU qty at 0 when the state is unknown rather than inventing Delhi/WB', () => {
    const charges = buildLoadedCharges({ onDate: '2026-05-01' });
    expect(head(charges, 'State Transmission Charges').seller_qty).toBe(0);
    expect(head(charges, 'State Transmission Charges').buyer_qty).toBe(0);
    expect(head(charges, 'ISTS Transmission Charges').buyer_rate).toBe(379);
  });
});

describe('GET /api/exchange-update-charges/load', () => {
  it('returns master rates, not hardcoded ISET pack', async () => {
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/exchange-update-charges/load')
      .query({ source: 'DEFAULT' }).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.source).toBe('RATE_MASTER');
    const ists = r.body.charges.find((c) => c.charge_head === 'ISTS Transmission Charges');
    expect(ists.buyer_rate).toBe(379);
    expect(r.body.charges.some((c) => c.buyer_rate === 450)).toBe(false);
  });
});
