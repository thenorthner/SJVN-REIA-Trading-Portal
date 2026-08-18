import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';

const CLIENT = 'TCL-PX-TEST';
const CONTRACT = 'EXC-PX-TEST';
const APP = 'PXA-PX-TEST';
const BID = 'BID-PX-TEST';

beforeEach(() => {
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids WHERE id = ?').run(BID);
  db.prepare('DELETE FROM exchange_applications WHERE id = ?').run(APP);
  db.prepare('DELETE FROM exchange_contracts WHERE id = ?').run(CONTRACT);
  db.prepare('DELETE FROM trading_clients WHERE id = ?').run(CLIENT);
  db.prepare("INSERT INTO trading_clients (id, name, client_type, status) VALUES (?, 'NDMC PX', 'DISCOM', 'ACTIVE')").run(CLIENT);
  db.prepare(`
    INSERT INTO exchange_contracts (
      id, portfolio_id, loa_no, start_date, end_date, side, client_id, client_name,
      product, bidding_type, billing_type, concerned_sldc, status
    ) VALUES (?, 'IEXNDMC123', 'EXC/LOA/PX', '2026-09-01', '2026-09-30', 'Buyer', ?, 'NDMC PX',
      'DAM', 'Single Bid', 'Weekly', 'Delhi', 'ACTIVE')
  `).run(CONTRACT, CLIENT);
  db.prepare(`
    INSERT INTO exchange_applications (
      id, application_id, application_date, portfolio_id, exchange, product, bid_type
    ) VALUES (?, 'PX20260901A0001', '2026-09-01 10:00:00', 'IEXNDMC123', 'IEX', 'DAM', 'Single Bid')
  `).run(APP);
  db.prepare(`
    INSERT INTO bids (
      id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit,
      contract_id, status, approval_status, created_by
    ) VALUES (?, ?, 'IEX', 'DAM', '2026-09-01', '2026-09-01', 80, 5.5, ?, 'CLEARED', 'APPROVED', 'SYSTEM')
  `).run(BID, CLIENT, CONTRACT);
});

describe('exchange applications join bids', () => {
  it('lists an application with no bid_ids still unresolved', async () => {
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).get('/api/exchange-applications').set(auth(trader));
    expect(r.status).toBe(200);
    const row = r.body.find((a) => a.id === APP);
    expect(row).toBeTruthy();
    expect(row.linked_bid_count).toBe(1);
    expect(row.bids[0].id).toBe(BID);
    expect(row.contract_id).toBe(CONTRACT);
  });

  it('PX1 attaches the portfolio contract', async () => {
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).post(`/api/exchange-applications/${APP}/step`)
      .set(auth(trader)).send({ step: 'px1' });
    expect(r.status).toBe(200);
    expect(r.body.px1_status).toBe('DONE');
    expect(r.body.contract_id).toBe(CONTRACT);
    expect(r.body.contract_label).toBe('EXC/LOA/PX');
  });

  it('PX2 persists the DAM-desk bid for that delivery date', async () => {
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).post(`/api/exchange-applications/${APP}/step`)
      .set(auth(trader)).send({ step: 'px2' });
    expect(r.status).toBe(200);
    expect(r.body.px2_status).toBe('DONE');
    expect(r.body.bid_ids).toEqual([BID]);
    expect(r.body.bids[0].status).toBe('CLEARED');
    const stored = db.prepare('SELECT bid_ids, contract_id FROM exchange_applications WHERE id = ?').get(APP);
    expect(JSON.parse(stored.bid_ids)).toEqual([BID]);
    expect(stored.contract_id).toBe(CONTRACT);
  });

  it('refuses PX2 when no bid exists on that date', async () => {
    db.prepare('DELETE FROM bids WHERE id = ?').run(BID);
    const trader = tokenFor('TRADING_USER');
    const r = await request(app).post(`/api/exchange-applications/${APP}/step`)
      .set(auth(trader)).send({ step: 'px2' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No DAM bid/i);
  });

  it('Exchange Approval follows the linked bid rather than a disconnected flag', async () => {
    const trader = tokenFor('TRADING_USER');
    await request(app).post(`/api/exchange-applications/${APP}/step`).set(auth(trader)).send({ step: 'px2' });
    const r = await request(app).post(`/api/exchange-applications/${APP}/step`)
      .set(auth(trader)).send({ step: 'exchange_approval' });
    expect(r.status).toBe(200);
    expect(r.body.exchange_approval_status).toBe('APPROVED');
  });
});
