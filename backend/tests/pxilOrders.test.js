import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { auth, tokenFor } from './helpers/reia.js';
import { newId } from '../src/util.js';

let trader;
let clientId;
let contractId;

beforeEach(() => {
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  db.prepare('DELETE FROM pxil_orders').run();
  db.prepare('DELETE FROM exchange_contracts').run();
  db.prepare('DELETE FROM trading_clients').run();

  const entityId = newId('BUY');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, short_code, status)
              VALUES (?, 'BUYER', 'DISCOM', 'Punjab State Power Corporation Limited', 'PSPCL', 'APPROVED')`).run(entityId);
  clientId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, entity_id, name, client_type, status, exposure_limit)
              VALUES (?, ?, 'Punjab State Power Corporation Limited', 'DISCOM', 'ACTIVE', 100000000)`).run(clientId, entityId);
  contractId = newId('EXC');
  db.prepare(`INSERT INTO exchange_contracts
    (id, portfolio_id, loa_no, start_date, end_date, side, client_id, product, bidding_type, billing_type, trading_margin, is_renewable, carry_over, status)
    VALUES (?, 'PF-PXIL-1', 'EXC/PXIL/001', '2026-09-01', '2026-09-30', 'Buyer', ?, 'DAM', 'Single', 'Weekly', 0.03, 'No', 'No', 'ACTIVE')
  `).run(contractId, clientId);
  trader = tokenFor('TRADING_USER');
});

describe('pxil orders', () => {
  it('materialises placed PXIL orders into bids linked to the exchange contract', async () => {
    const created = await request(app).post('/api/pxil-orders').set(auth(trader)).send({
      client_id: clientId,
      contract_id: contractId,
      transaction_code: 'PXIL-TXN-1',
      user_id: 'sjvn.trader',
      password: 'secret',
      nor: 'NOR-1',
      tm_id: 'TM-1',
      reference_no: 'PXIL-REF-1',
      tac_id: 'TAC-1',
      order_type: 'NORMAL',
      product_code: 'DAM',
      quantity: 50,
      price: 4.2,
      delivery_date_from: '2026-09-10',
      delivery_date_to: '2026-09-10',
      from_time: '18:00',
      to_time: '18:30',
      side: 'Buyer',
    });
    expect(created.status).toBe(201);

    const placed = await request(app).post(`/api/pxil-orders/${created.body.id}/place-bid`).set(auth(trader)).send({});
    expect(placed.status).toBe(200);
    expect(placed.body.status).toBe('BID_PLACED');
    expect(placed.body.bid_ids).toHaveLength(1);

    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(placed.body.bid_ids[0]);
    expect(bid.contract_id).toBe(contractId);
    expect(bid.source_kind).toBe('PXIL_ORDER');
    expect(bid.source_id).toBe(created.body.id);
    const blocks = db.prepare('SELECT time_block FROM bid_blocks WHERE bid_id = ? ORDER BY time_block').all(bid.id);
    expect(blocks.map((b) => b.time_block)).toEqual(['18:00-18:15', '18:15-18:30']);
  });
});
