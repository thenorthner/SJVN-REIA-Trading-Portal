import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, resetReia } from '../helpers/reia.js';

let reia;
beforeEach(() => {
  resetReia();
  // resetReia leaves the REC ledger and the bid tables alone, and these assert
  // on totals, so seeded rows would answer for figures this test did not create.
  for (const t of ['rec_ledger', 'bid_blocks', 'bids']) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* table may not exist */ }
  }
  reia = tokenFor('REIA_USER');
});

// vintage_month is NOT NULL on the ledger.
const recLot = (id, status, sold, amount) => db.prepare(`
  INSERT INTO rec_ledger (id, rec_no, vintage_month, quantity, status, sold_qty, sale_amount)
  VALUES (?, ?, '2026-04', 1000, ?, ?, ?)`).run(id, `R/${id}`, status, sold, amount);

const get = () => request(app).get('/api/dashboard/trading/analytics').set(auth(reia));

describe('S27 The analytics screens read the platform, not a typed-in array', () => {
  // The four trading dashboards were built against hardcoded data, so the REC
  // cards claimed 66,167 certificates sold for Rs 7.5 crore while the ledger
  // held 32,500 for Rs 1.27 crore — a dashboard reporting a book that was not
  // its own.

  it('reports RECs from the ledger', async () => {
    recLot('REC-T1', 'SOLD', 800, 960000);
    recLot('REC-T2', 'LISTED', 200, 240000);
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body.rec.sold).toBe(1000);
    expect(r.body.rec.revenue_rupees).toBe(1200000);
    expect(r.body.rec.revenue_crore, 'crore is the unit the card shows').toBeCloseTo(0.12, 2);
  });

  it('leaves cancelled lots out of the count', async () => {
    recLot('REC-T3', 'CANCELLED', 900, 999999);
    expect((await get()).body.rec.sold).toBe(0);
  });

  it('counts only energy that has been locked', async () => {
    const c = makeContract({ status: 'ACTIVE' });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-L', ?, '2026-05', 'FINAL', 'SEA', 5000, 'LOCKED')`).run(c.id);
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-D', ?, '2026-05', 'PROVISIONAL', 'MANUAL', 9000, 'DRAFT')`).run(c.id);
    const r = await get();
    expect(r.body.energy.delivered_mwh, 'a draft period was counted as delivered').toBe(5000);
    expect(r.body.energy.delivered_mu, 'MU is MWh over a thousand').toBe(5);
  });

  it('separates this financial year from the whole history', async () => {
    const c = makeContract({ status: 'ACTIVE' });
    const fy = (await get()).body.financial_year_from;      // e.g. 2026-04
    const priorYear = `${Number(fy.slice(0, 4)) - 1}-05`;
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-FY', ?, ?, 'FINAL', 'SEA', 3000, 'LOCKED')`).run(c.id, fy);
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-OLD', ?, ?, 'FINAL', 'SEA', 7000, 'LOCKED')`).run(c.id, priorYear);
    const r = await get();
    expect(r.body.energy.delivered_mu).toBe(10);
    expect(r.body.energy.fy_delivered_mu, 'last year was counted into this one').toBe(3);
  });

  it('starts the financial year in April', async () => {
    expect((await get()).body.financial_year_from).toMatch(/^\d{4}-04$/);
  });

  it('splits bids by exchange and by product', async () => {
    db.prepare(`INSERT INTO trading_clients (id, name, client_type, exposure_limit, status)
                VALUES ('TCL-A', 'A', 'DISCOM', 1000000, 'ACTIVE')`).run();
    const bid = (id, ex, prod, mw, cleared) => db.prepare(`
      INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price)
      VALUES (?, 'TCL-A', ?, ?, '2026-05-01', '2026-05-02', ?, 4.0, ?, 4.1)`).run(id, ex, prod, mw, cleared);
    bid('B1', 'IEX', 'DAM', 100, 60);
    bid('B2', 'IEX', 'GDAM', 50, 50);
    bid('B3', 'PXIL', 'DAM', 20, 0);

    const r = await get();
    const byEx = Object.fromEntries(r.body.exchanges.map((e) => [e.exchange, e]));
    expect(byEx.IEX.offered_mw).toBe(150);
    expect(byEx.IEX.cleared_mw).toBe(110);
    expect(byEx.PXIL.cleared_mw).toBe(0);
    const byProd = Object.fromEntries(r.body.products.map((p) => [p.product, p]));
    expect(byProd.DAM.bids).toBe(2);
    expect(byProd.GDAM.cleared_mw).toBe(50);
  });

  it('says which of its series are published statistics rather than ours', async () => {
    // The macro charts sit in identical cards beside the live ones and read as
    // the same body of fact; the payload names the difference so a screen can.
    const r = await get();
    expect(r.body.external_series.source).toMatch(/Central Electricity Authority/);
    expect(r.body.external_series.note).toMatch(/no source in this platform/i);
  });

  it('does not serve an intraday series it cannot honestly build', async () => {
    // bid_blocks holds three different time_block conventions and no ordering.
    expect((await get()).body.blocks).toBeUndefined();
  });
});
