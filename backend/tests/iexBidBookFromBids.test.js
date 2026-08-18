import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';
import {
  formatIexDate,
  generateIexBidBook,
  isBlockBid,
  spanFromBlocks,
  totalExecutedMwBlocks,
} from '../src/services/iexBidBookFromBids.js';

let trader, clientId, contractSingle, contractBlock;

beforeEach(() => {
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  db.prepare('DELETE FROM exchange_contracts').run();
  db.prepare('DELETE FROM trading_client_exchanges').run();

  const entityId = newId('BUY');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, short_code, status)
              VALUES (?, 'BUYER', 'DISCOM', 'New Delhi Municipal Council', 'NDMC', 'APPROVED')`).run(entityId);
  clientId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, name, entity_id, client_type, status, exposure_limit)
              VALUES (?, 'New Delhi Municipal Council', ?, 'DISCOM', 'ACTIVE', 100000000)`).run(clientId, entityId);
  db.prepare(`INSERT INTO trading_client_exchanges (id, client_id, exchange, registration_id, is_active)
              VALUES (?, ?, 'IEX', 'N2DL0SJV0000', 1)`).run(newId('TCE'), clientId);

  contractSingle = newId('EXC');
  db.prepare(`
    INSERT INTO exchange_contracts (
      id, portfolio_id, loa_no, start_date, end_date, side, client_id, product, bidding_type, status
    ) VALUES (?, 'IEXNDMC123', 'EXC/LOA/001', '2026-09-01', '2026-09-30', 'Buyer', ?, 'DAM', 'Single Bid', 'ACTIVE')
  `).run(contractSingle, clientId);

  contractBlock = newId('EXC');
  db.prepare(`
    INSERT INTO exchange_contracts (
      id, portfolio_id, loa_no, start_date, end_date, side, client_id, product, bidding_type, status
    ) VALUES (?, 'IEXTEESTA012', 'EXC/LOA/002', '2026-09-01', '2026-09-30', 'Seller', ?, 'DAM', 'Block Bid', 'ACTIVE')
  `).run(contractBlock, clientId);

  trader = tokenFor('TRADING_USER');
});

function insertBidWithBlocks({ id, contractId, product = 'DAM', status = 'CLEARED', blocks, receipt = null }) {
  db.prepare(`
    INSERT INTO bids (
      id, client_id, exchange, product, bid_date, delivery_date,
      quantum_mw, price_per_unit, contract_id, approval_status, status, exchange_receipt_ref, created_at
    ) VALUES (?, ?, 'IEX', ?, '2026-09-10', '2026-09-10', ?, ?, ?, 'APPROVED', ?, ?, '2026-09-10 10:05:00')
  `).run(
    id,
    clientId,
    product,
    blocks.reduce((a, b) => a + b.quantum_mw, 0) / blocks.length,
    blocks[0].price_per_unit,
    contractId,
    status,
    receipt,
  );
  for (const b of blocks) {
    db.prepare(`
      INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('BLK'), id, b.time_block, b.quantum_mw, b.price_per_unit,
      b.cleared ?? b.quantum_mw, b.clearedPrice ?? b.price_per_unit, b.status || 'CLEARED',
    );
  }
  db.prepare(`INSERT INTO bid_events (id, bid_id, actor_id, event_type, details, created_at)
              VALUES (?, ?, 'USR', 'SUBMITTED', '{}', '2026-09-10 11:05:00')`).run(newId('BEV'), id);
  db.prepare(`INSERT INTO bid_events (id, bid_id, actor_id, event_type, details, created_at)
              VALUES (?, ?, 'USR', 'RESULT_RECORDED', '{}', '2026-09-10 18:35:00')`).run(newId('BEV'), id);
}

describe('iex bid book helpers', () => {
  it('spans the first and last 15-min block', () => {
    expect(spanFromBlocks([
      { time_block: '18:00-18:15' },
      { time_block: '19:45-20:00' },
    ])).toEqual({ from: '18:00', to: '20:00' });
  });

  it('sums cleared MW across blocks for executed qty', () => {
    expect(totalExecutedMwBlocks([
      { cleared_quantum_mw: 80 },
      { cleared_quantum_mw: 80 },
    ])).toBe(160);
  });

  it('routes block contracts to block reports', () => {
    const blocks = [
      { time_block: '18:00-18:15', price_per_unit: 4.1, quantum_mw: 100 },
      { time_block: '18:15-18:30', price_per_unit: 4.1, quantum_mw: 100 },
    ];
    expect(isBlockBid({ bidding_type: 'Block Bid' }, blocks)).toBe(true);
    expect(isBlockBid({ bidding_type: 'Single Bid' }, blocks)).toBe(false);
  });
});

describe('generateIexBidBook', () => {
  it('builds DAM single rows from cleared bids', () => {
    insertBidWithBlocks({
      id: 'BID-TEST-001',
      contractId: contractSingle,
      receipt: '126081300210011',
      blocks: [
        { time_block: '18:00-18:15', quantum_mw: 80, price_per_unit: 5.5, clearedPrice: 5.88 },
        { time_block: '18:15-18:30', quantum_mw: 80, price_per_unit: 5.5, clearedPrice: 5.88 },
      ],
    });

    const rows = generateIexBidBook('DAM_SINGLE');
    expect(rows).toHaveLength(1);
    expect(rows[0].order_id).toBe('126081300210011');
    expect(rows[0].from_period_id).toBe('18:00');
    expect(rows[0].to_period_id).toBe('18:30');
    expect(rows[0].total_executed_qty).toBe('160');
    expect(rows[0].trade_price).toBe('5880.0');
    expect(rows[0].order_status).toBe('Executed');
    expect(rows[0].delivery_date).toBe(formatIexDate('2026-09-10'));
  });

  it('puts block contracts on the DAM block report', () => {
    insertBidWithBlocks({
      id: 'BID-TEST-BLK',
      contractId: contractBlock,
      blocks: [
        { time_block: '18:00-18:15', quantum_mw: 100, price_per_unit: 4.1, clearedPrice: 4.22 },
        { time_block: '18:15-18:30', quantum_mw: 100, price_per_unit: 4.1, clearedPrice: 4.22 },
      ],
    });

    expect(generateIexBidBook('DAM_SINGLE')).toHaveLength(0);
    const rows = generateIexBidBook('DAM_BLOCK');
    expect(rows).toHaveLength(1);
    expect(rows[0].order_type).toBe('Block Bid');
    expect(rows[0].quantity).toBe('-100');
    expect(rows[0].buy_sell).toBe('Sell');
  });

  it('skips DRAFT bids', () => {
    insertBidWithBlocks({
      id: 'BID-DRAFT',
      contractId: contractSingle,
      status: 'DRAFT',
      blocks: [{ time_block: '18:00-18:15', quantum_mw: 50, price_per_unit: 4.0 }],
    });
    expect(generateIexBidBook('DAM_SINGLE')).toHaveLength(0);
  });
});

describe('GET /api/iex-bid-book', () => {
  it('returns live rows from bids', async () => {
    insertBidWithBlocks({
      id: 'BID-API-001',
      contractId: contractSingle,
      blocks: [{ time_block: '18:00-18:15', quantum_mw: 60, price_per_unit: 6.0, clearedPrice: 6.1 }],
    });

    const r = await request(app).get('/api/iex-bid-book?report_type=DAM_SINGLE').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.some((row) => row.bid_id === 'BID-API-001')).toBe(true);
  });
});
