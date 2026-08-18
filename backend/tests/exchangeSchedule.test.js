import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';
import { buildEnergySchedule, listObligations, slotFromLabel, quarterLabels } from '../src/services/exchangeSchedule.js';
import { hoursFromTimeBlock } from '../src/services/exchangeIsetToBids.js';

const CLIENT = 'TCL-SCHED-TEST';
const CONTRACT = 'EXC-SCHED-TEST';

function insertBid({ id, product = 'DAM', date = '2026-09-01', status = 'CLEARED', blocks, exchange = 'IEX' }) {
  const bidId = id || newId('BID');
  const bidMw = blocks.reduce((a, b) => a + b.mw, 0);
  const clearedMw = blocks.reduce((a, b) => a + (b.cleared ?? 0), 0);
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit,
      cleared_quantum_mw, contract_id, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYSTEM')
  `).run(bidId, CLIENT, exchange, product, date, date, bidMw, blocks[0].price, clearedMw, CONTRACT, status);
  for (const b of blocks) {
    db.prepare(`
      INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('BLK'), bidId, b.time_block, b.mw, b.price, b.cleared ?? 0, b.clearedPrice ?? null,
      b.blockStatus ?? ((b.cleared ?? 0) === 0 ? 'UNCLEARED' : 'CLEARED'),
    );
  }
  return bidId;
}

beforeEach(() => {
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  db.prepare('DELETE FROM exchange_contracts WHERE id = ?').run(CONTRACT);
  db.prepare('DELETE FROM trading_clients WHERE id = ?').run(CLIENT);
  db.prepare("INSERT INTO trading_clients (id, name, client_type) VALUES (?, 'Schedule Test DISCOM', 'DISCOM')").run(CLIENT);
  db.prepare(`
    INSERT INTO exchange_contracts (id, portfolio_id, loa_no, start_date, end_date, side, client_id, client_name,
      product, bidding_type, billing_type, status)
    VALUES (?, 'PF-1', 'EXC/LOA/SCHED', '2026-09-01', '2026-09-30', 'Buyer', ?, 'Schedule Test DISCOM',
      'DAM', 'Single', 'Weekly', 'ACTIVE')
  `).run(CONTRACT, CLIENT);
});

describe('exchange schedule from bid_blocks', () => {
  it('maps a time label onto the 96-slot grid', () => {
    expect(quarterLabels()).toHaveLength(96);
    expect(slotFromLabel('18:00-18:15')).toBe(72);
    expect(slotFromLabel('00:00-00:15')).toBe(0);
    expect(slotFromLabel('23:45-00:00')).toBe(95);
  });

  it('fills cleared MW and value on the matching blocks only', () => {
    insertBid({
      date: '2026-09-01',
      blocks: [
        { time_block: '18:00-18:15', mw: 80, price: 6.5, cleared: 80, clearedPrice: 5.42 },
        { time_block: '18:15-18:30', mw: 80, price: 6.5, cleared: 40, clearedPrice: 5.42 },
      ],
    });
    const s = buildEnergySchedule({ date: '2026-09-01', product: 'DAM' });
    expect(s.blocks).toHaveLength(96);
    const a = s.blocks[72];
    const b = s.blocks[73];
    expect(a.cleared_mw).toBe(80);
    expect(a.scheduled_mwh).toBe(20);
    expect(a.cleared_price).toBe(5.42);
    expect(a.trade_value).toBe(20 * 1000 * 5.42);
    expect(b.cleared_mw).toBe(40);
    expect(s.blocks[0].cleared_mw).toBe(0);
    expect(s.summary.cleared_mwh).toBe(30);
    expect(s.summary.bids).toBe(1);
  });

  it('keeps GDAM volume off the DAM schedule', () => {
    insertBid({
      product: 'GDAM',
      blocks: [{ time_block: '10:00-10:15', mw: 50, price: 4, cleared: 50, clearedPrice: 4.1 }],
    });
    const dam = buildEnergySchedule({ date: '2026-09-01', product: 'DAM' });
    expect(dam.summary.cleared_mwh).toBe(0);
    const gdam = buildEnergySchedule({ date: '2026-09-01', product: 'GDAM' });
    expect(gdam.summary.cleared_mwh).toBe(12.5);
  });

  it('lists one obligation row per delivery date and client', () => {
    insertBid({
      date: '2026-09-01',
      blocks: [{ time_block: '18:00-18:15', mw: 80, price: 6.5, cleared: 80, clearedPrice: 5 }],
    });
    insertBid({
      date: '2026-09-02',
      blocks: [{ time_block: '18:00-18:15', mw: 80, price: 6.5, cleared: 80, clearedPrice: 6 }],
    });
    const list = listObligations({ product: 'DAM', from: '2026-09-01', to: '2026-09-30' });
    expect(list.rows).toHaveLength(2);
    expect(list.rows.map((r) => r.delivery_date).sort()).toEqual(['2026-09-01', '2026-09-02']);
    expect(list.rows.find((r) => r.delivery_date === '2026-09-01').trade_value).toBe(20 * 1000 * 5);
  });

  it('omits draft and submitted bids from the obligation list', () => {
    insertBid({
      status: 'SUBMITTED',
      blocks: [{ time_block: '18:00-18:15', mw: 80, price: 6.5, cleared: 0, blockStatus: 'PENDING' }],
    });
    expect(listObligations({ product: 'DAM' }).rows).toHaveLength(0);
    const sched = buildEnergySchedule({ date: '2026-09-01', product: 'DAM' });
    expect(sched.blocks[72].bid_mw).toBe(80);
    expect(sched.blocks[72].cleared_mw).toBe(0);
  });

  it('values a 24-hour TAM block as 24 MWh per MW, not a 15-minute slot', () => {
    expect(hoursFromTimeBlock('00:00-24:00', 'TAM')).toBe(24);
    insertBid({
      product: 'TAM',
      blocks: [{ time_block: '00:00-24:00', mw: 75, price: 4.4, cleared: 75, clearedPrice: 4.52 }],
    });
    const list = listObligations({ product: 'TAM' });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].cleared_mwh).toBe(1800);
    expect(list.rows[0].trade_value).toBe(8136000);
  });
});

describe('GET /api/trading/schedules', () => {
  it('returns the 96-block schedule for a delivery date', async () => {
    insertBid({
      blocks: [{ time_block: '18:00-18:15', mw: 80, price: 6.5, cleared: 80, clearedPrice: 5.42 }],
    });
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/trading/schedules')
      .query({ date: '2026-09-01', product: 'DAM' }).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.blocks).toHaveLength(96);
    expect(r.body.blocks[72].cleared_mw).toBe(80);
    expect(r.body.source).toBe('bids');
  });

  it('lists obligations without fake document URLs', async () => {
    insertBid({
      blocks: [{ time_block: '18:00-18:15', mw: 80, price: 6.5, cleared: 80, clearedPrice: 5.42 }],
    });
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/trading/schedules/obligations')
      .query({ product: 'DAM', from: '2026-09-01', to: '2026-09-01' }).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].pdfUrl).toBeUndefined();
    expect(r.body.rows[0].cleared_mwh).toBe(20);
  });

  it('rejects an unknown product', async () => {
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/trading/schedules')
      .query({ date: '2026-09-01', product: 'NOT_A_MARKET' }).set(auth(trader));
    expect(r.status).toBe(400);
  });
});

describe('GET /api/bids product filter', () => {
  it('returns only TAM bids when product=TAM', async () => {
    insertBid({
      product: 'TAM',
      blocks: [{ time_block: '00:00-24:00', mw: 75, price: 4.4, cleared: 75, clearedPrice: 4.52 }],
    });
    insertBid({
      product: 'DAM',
      blocks: [{ time_block: '18:00-18:15', mw: 80, price: 6.5, cleared: 80, clearedPrice: 5.42 }],
    });
    const trader = tokenFor('TRADING_USER');
    const tam = await request(app).get('/api/bids').query({ product: 'TAM' }).set(auth(trader));
    expect(tam.status).toBe(200);
    expect(tam.body.every((b) => b.product === 'TAM')).toBe(true);
    expect(tam.body).toHaveLength(1);
    const gdam = await request(app).get('/api/bids').query({ product: 'GTAM' }).set(auth(trader));
    expect(gdam.body).toHaveLength(0);
  });
});
