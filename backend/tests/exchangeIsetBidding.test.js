import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';
import { expandQuarterHours, rsPerKwh, planFromSchedule } from '../src/services/exchangeIsetToBids.js';

// ISET Exchange Bidding used to write its own tables and leave `bids` empty.
// Settlement bills off `bids` / `bid_blocks`, so a submitted ISET form has to
// land there as a DRAFT DAM bid the desk can approve.

let trader, clientId, contractId;

beforeEach(() => {
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  db.prepare('DELETE FROM exchange_biddings').run();
  db.prepare('DELETE FROM exchange_bidding_latest').run();
  db.prepare('DELETE FROM exchange_contracts').run();

  const entityId = newId('BUY');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, short_code, status)
              VALUES (?, 'BUYER', 'DISCOM', 'New Delhi Municipal Council', 'NDMC', 'APPROVED')`).run(entityId);
  clientId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, name, entity_id, client_type, status, exposure_limit)
              VALUES (?, 'New Delhi Municipal Council', ?, 'DISCOM', 'ACTIVE', 100000000)`).run(clientId, entityId);
  trader = tokenFor('TRADING_USER');
});

const contractBody = (over = {}) => ({
  portfolio_id: 'IEXNDMC123',
  loa_no: 'EXC/LOA/001',
  start_date: '2026-09-01',
  end_date: '2026-09-30',
  side: 'Buyer',
  client_id: clientId,
  product: 'DAM',
  bidding_type: 'Single Bid',
  billing_type: 'Weekly',
  trading_margin: 0.03,
  is_renewable: 'No',
  carry_over: 'No',
  schedule_details: [{ date_from: '2026-09-01', date_to: '2026-09-30', time_from: '00:00', time_to: '24:00', rate: 4.2, quantum: 100 }],
  ...over,
});

async function createContract(over = {}) {
  const r = await request(app).post('/api/exchange-contracts').set(auth(trader)).send(contractBody(over));
  expect(r.status).toBe(201);
  contractId = r.body.id;
  return r.body;
}

describe('ISET schedule → 15-minute DAM blocks', () => {
  it('expands 18:00–20:00 into eight quarter-hour labels', () => {
    const labels = expandQuarterHours('18:00', '20:00');
    expect(labels).toHaveLength(8);
    expect(labels[0]).toBe('18:00-18:15');
    expect(labels[7]).toBe('19:45-20:00');
  });

  it('treats ISET INR/MWh as Rs/kWh', () => {
    expect(rsPerKwh(5500, 'mwh')).toBe(5.5);
    expect(rsPerKwh(5.5, 'auto')).toBe(5.5);
    expect(rsPerKwh(5500, 'auto')).toBe(5.5);
  });

  it('fans a two-day evening row into two delivery dates', () => {
    const { byDate, errors } = planFromSchedule([
      { date_from: '2026-09-01', date_to: '2026-09-02', time_from: '18:00', time_to: '20:00', price: 5500, capacity: 80 },
    ], { priceUnit: 'mwh' });
    expect(errors).toEqual([]);
    expect([...byDate.keys()]).toEqual(['2026-09-01', '2026-09-02']);
    expect(byDate.get('2026-09-01').size).toBe(8);
    expect(byDate.get('2026-09-01').get('18:00-18:15')).toEqual({
      time_block: '18:00-18:15', quantum_mw: 80, price_per_unit: 5.5,
    });
  });
});

describe('POST /api/exchange-bidding creates DAM bids', () => {
  const body = (over = {}) => ({
    client_id: clientId,
    client_name: 'New Delhi Municipal Council',
    client_ref_no: 'NDMC/DAM/TEST',
    exchange: 'IEX',
    segment: 'Day Ahead',
    portfolio_id: 'IEXNDMC123',
    contract_id: contractId,
    product_type: 'DAM',
    bidding_type: 'Single Bid',
    supply_start_date: '2026-09-10',
    supply_end_date: '2026-09-10',
    schedule_details: [{
      date_from: '2026-09-10', date_to: '2026-09-10',
      time_from: '18:00', time_to: '20:00', price: 5500, capacity: 80, side: 'Buy',
    }],
    ...over,
  });

  it('writes the ISET row and a DRAFT bid under the same contract', async () => {
    await createContract();
    const r = await request(app).post('/api/exchange-bidding').set(auth(trader)).send(body());
    expect(r.status).toBe(201);
    expect(r.body.bid_ids).toHaveLength(1);

    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(r.body.bid_ids[0]);
    expect(bid.status).toBe('DRAFT');
    expect(bid.approval_status).toBe('PENDING');
    expect(bid.product).toBe('DAM');
    expect(bid.contract_id).toBe(contractId);
    expect(bid.client_id).toBe(clientId);
    expect(bid.source_kind).toBe('ISET');
    expect(bid.source_id).toBe(r.body.id);
    expect(bid.price_per_unit).toBeCloseTo(5.5);

    const blocks = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ? ORDER BY time_block').all(bid.id);
    expect(blocks).toHaveLength(8);
    expect(blocks[0].time_block).toBe('18:00-18:15');
    expect(blocks[0].quantum_mw).toBe(80);
    expect(blocks[0].price_per_unit).toBeCloseTo(5.5);
  });

  it('opens one bid per delivery date when the schedule spans days', async () => {
    await createContract();
    const r = await request(app).post('/api/exchange-bidding').set(auth(trader)).send(body({
      supply_start_date: '2026-09-10',
      supply_end_date: '2026-09-11',
      schedule_details: [{
        date_from: '2026-09-10', date_to: '2026-09-11',
        time_from: '18:00', time_to: '20:00', price: 5500, capacity: 80, side: 'Buy',
      }],
    }));
    expect(r.status).toBe(201);
    expect(r.body.bid_ids).toHaveLength(2);
    const dates = r.body.bid_ids.map((id) => db.prepare('SELECT delivery_date FROM bids WHERE id = ?').get(id).delivery_date).sort();
    expect(dates).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('rolls back the ISET row when the bid cannot be placed', async () => {
    await createContract();
    const r = await request(app).post('/api/exchange-bidding').set(auth(trader)).send(body({
      supply_start_date: '2026-12-01',
      supply_end_date: '2026-12-01',
      schedule_details: [{
        date_from: '2026-12-01', date_to: '2026-12-01',
        time_from: '18:00', time_to: '20:00', price: 5500, capacity: 80, side: 'Buy',
      }],
    }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/outside the contract window/);
    expect(db.prepare('SELECT COUNT(*) n FROM exchange_biddings').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM bids').get().n).toBe(0);
  });

  it('refuses a bid without a client', async () => {
    await createContract();
    const r = await request(app).post('/api/exchange-bidding').set(auth(trader)).send(body({ client_id: '' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/client_id is required/);
  });
});

describe('POST /api/exchange-bidding-latest creates DAM bids', () => {
  const body = (over = {}) => ({
    client_id: clientId,
    client_name: 'New Delhi Municipal Council',
    client_ref_no: 'NDMC/DAM/TEST',
    contract_id: contractId,
    product_type: 'DAM',
    bid_type: 'single',
    delivery_date: '2026-09-10',
    asset_id: 'INDIA',
    bid_area_id: 'N1',
    portfolio_id: 'IEXNDMC123',
    details: [{
      from_period_id: '18:00',
      to_period_id: '20:00',
      buy_sell: 'Buy (B)',
      ocf_opted: 'No',
      pq_data: [{ rate: 5.5, quantity: 80, bid_reference: 'NDMC01' }],
    }],
    ...over,
  });

  it('links the transaction to a DRAFT DAM bid at Rs/kWh', async () => {
    await createContract();
    const r = await request(app).post('/api/exchange-bidding-latest').set(auth(trader)).send(body());
    expect(r.status).toBe(201);
    expect(r.body.bid_ids).toHaveLength(1);
    expect(r.body.report_lines[0].dam_bid_id).toBe(r.body.bid_ids[0]);

    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(r.body.bid_ids[0]);
    expect(bid.status).toBe('DRAFT');
    expect(bid.product).toBe('DAM');
    expect(bid.exchange).toBe('IEX');
    expect(bid.source_kind).toBe('ISET_LATEST');
    expect(bid.price_per_unit).toBeCloseTo(5.5);
    expect(db.prepare('SELECT COUNT(*) n FROM bid_blocks WHERE bid_id = ?').get(bid.id).n).toBe(8);
  });

  it('converts an INR/MWh rate on Bidding Latest the same way', async () => {
    await createContract();
    const r = await request(app).post('/api/exchange-bidding-latest').set(auth(trader)).send(body({
      details: [{
        from_period_id: '18:00', to_period_id: '20:00', buy_sell: 'Buy (B)', ocf_opted: 'No',
        pq_data: [{ rate: 6200, quantity: 80, bid_reference: 'NDMC02' }],
      }],
    }));
    expect(r.status).toBe(201);
    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(r.body.bid_ids[0]);
    expect(bid.price_per_unit).toBeCloseTo(6.2);
  });
});
