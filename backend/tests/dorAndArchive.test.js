import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';

// Two endpoints that used to generate their answers: the Daily Obligation Report
// built 96 blocks off a hand-written curve with a hardcoded total "for screenshot
// replica", and the schedule archive invented thirty filenames, one per day. Both
// read the platform's own data now.

let trader, clientId, contractId;

const mkBid = (over = {}) => {
  const id = newId('BID');
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw,
      price_per_unit, cleared_quantum_mw, contract_id, status)
    VALUES (?, ?, 'IEX', 'DAM', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, over.client_id || clientId, over.bid_date || '2026-09-19',
    over.delivery_date || '2026-09-20', over.quantum_mw ?? 50, over.price_per_unit ?? 4,
    over.cleared_quantum_mw ?? 40, over.contract_id ?? contractId, over.status || 'CLEARED');
  return id;
};

const mkBlock = (bidId, block, over = {}) => db.prepare(`
  INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit, cleared_quantum_mw, cleared_price, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(newId('BLK'), bidId, block, over.quantum_mw ?? 50, over.price_per_unit ?? 4,
  over.cleared_quantum_mw ?? 40, over.cleared_price ?? 4.5, over.status || 'CLEARED');

const mkUpload = (over = {}) => db.prepare(`
  INSERT INTO csv_uploads (id, upload_kind, filename, rldc, reading_date, revision_no, row_count, status, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(newId('CSV'), over.upload_kind || 'RLDC_SCHEDULE', over.filename || 'IEX260920SCH_TEST.xlsx',
  over.rldc || 'NRLDC', over.reading_date || '2026-09-20', over.revision_no || 'R0',
  over.row_count ?? 96, over.status || 'PROCESSED', over.created_by || 'desk@sjvn');

beforeEach(() => {
  for (const table of ['bid_blocks', 'bids', 'csv_uploads', 'exchange_contracts', 'trading_clients']) {
    try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* table may not exist */ }
  }
  trader = tokenFor('TRADING_USER');
  clientId = newId('TCL');
  db.prepare("INSERT INTO trading_clients (id, name, client_type, status) VALUES (?, 'Test Client', 'DISCOM', 'ACTIVE')").run(clientId);
  contractId = newId('EXC');
  db.prepare(`
    INSERT INTO exchange_contracts (id, client_id, portfolio_id, side, start_date, end_date, status)
    VALUES (?, ?, 'PF-TEST-1', 'Buyer', '2026-09-01', '2026-09-30', 'ACTIVE')
  `).run(contractId, clientId);
});

const get = (path, who = trader) => request(app).get(path).set(auth(who));

describe('daily obligation report', () => {
  it('reports the blocks that actually cleared, and nothing else', async () => {
    const bid = mkBid();
    mkBlock(bid, '18:00-18:15', { cleared_quantum_mw: 40, cleared_price: 4.5 });
    mkBlock(bid, '18:15-18:30', { cleared_quantum_mw: 20, cleared_price: 5 });

    const r = await get('/api/trading/dor?date=2026-09-20');
    expect(r.status).toBe(200);
    expect(r.body.blocks).toHaveLength(2);
    expect(r.body.blocks[0]).toMatchObject({ block_no: 73, time_label: '18:00 - 18:15', volume_mw: 40, mcp: 4.5 });
    // 40 MW for a quarter hour is 10 MWh, at 4.5 Rs/kWh = 45,000.
    expect(r.body.blocks[0].mwh).toBe(10);
    expect(r.body.blocks[0].trade_value).toBe(45000);
    expect(r.body.summary).toMatchObject({ blocks_with_obligation: 2, total_mwh: 15 });
    expect(r.body.summary.total_revenue).toBe(45000 + 25000);
  });

  it('reads an injection as a negative position', async () => {
    db.prepare("UPDATE exchange_contracts SET side = 'Seller' WHERE id = ?").run(contractId);
    const bid = mkBid();
    mkBlock(bid, '10:00-10:15', { cleared_quantum_mw: 30, cleared_price: 3 });
    const r = await get('/api/trading/dor?date=2026-09-20');
    expect(r.body.blocks[0].volume_mw).toBe(-30);
    // The energy is still energy; only the direction is signed.
    expect(r.body.blocks[0].mwh).toBe(7.5);
  });

  it('says there is no obligation rather than drawing a day that did not happen', async () => {
    const r = await get('/api/trading/dor?date=2026-09-21');
    expect(r.body.blocks).toEqual([]);
    expect(r.body.summary).toMatchObject({ total_mwh: 0, total_revenue: 0, weighted_avg_rate: 0 });
    expect(r.body.note).toMatch(/No bid carries an obligation on 2026-09-21/);
    // And it no longer states charges nobody computed.
    expect(r.body.financial_summary).toBeNull();
  });

  it('answers for one portfolio', async () => {
    const bid = mkBid();
    mkBlock(bid, '09:00-09:15');
    expect((await get('/api/trading/dor?date=2026-09-20&portfolio=PF-TEST-1')).body.blocks).toHaveLength(1);
    expect((await get('/api/trading/dor?date=2026-09-20&portfolio=PF-SOMEBODY-ELSE')).body.blocks).toHaveLength(0);
  });

  it('leaves a draft bid out — it carries no obligation', async () => {
    const draft = mkBid({ status: 'DRAFT' });
    mkBlock(draft, '09:00-09:15');
    const r = await get('/api/trading/dor?date=2026-09-20');
    expect(r.body.blocks).toHaveLength(0);
  });
});

describe('schedule archive', () => {
  it('lists the files that were actually uploaded', async () => {
    mkUpload({ filename: 'IEX260920SCH_PF-TEST-1.xlsx', row_count: 96 });
    mkUpload({ filename: 'IEX260919SCH_PF-TEST-1.xlsx', reading_date: '2026-09-19', status: 'SUBMITTED' });

    const r = await get('/api/trading/archive');
    expect(r.status).toBe(200);
    expect(r.body.archives).toHaveLength(2);
    expect(r.body.archives[0]).toMatchObject({
      filename: 'IEX260920SCH_PF-TEST-1.xlsx', delivery_date: '2026-09-20',
      row_count: 96, status: 'PROCESSED', uploaded_by: 'desk@sjvn', rldc: 'NRLDC',
    });
    // Newest delivery first.
    expect(r.body.archives[1].delivery_date).toBe('2026-09-19');
  });

  it('says the archive is empty rather than inventing a month of files', async () => {
    const r = await get('/api/trading/archive');
    expect(r.body.archives).toEqual([]);
    expect(r.body.note).toMatch(/No schedule file has been uploaded yet/);
  });

  it('finds a portfolio by the name the exchange puts in the filename', async () => {
    mkUpload({ filename: 'IEX260920SCH_PF-TEST-1.xlsx' });
    mkUpload({ filename: 'IEX260920SCH_PF-OTHER.xlsx' });
    const r = await get('/api/trading/archive?portfolio=PF-TEST-1');
    expect(r.body.archives.map((a) => a.filename)).toEqual(['IEX260920SCH_PF-TEST-1.xlsx']);
  });

  it('shows schedule files by default, and another kind when asked', async () => {
    mkUpload({ filename: 'schedule.xlsx' });
    mkUpload({ filename: 'charges.csv', upload_kind: 'CHARGES' });
    expect((await get('/api/trading/archive')).body.archives.map((a) => a.filename)).toEqual(['schedule.xlsx']);
    expect((await get('/api/trading/archive?kind=CHARGES')).body.archives.map((a) => a.filename)).toEqual(['charges.csv']);
  });

  it('keeps both inside the trading desk', async () => {
    const seller = tokenFor('SELLER');
    expect((await get('/api/trading/dor', seller)).status).toBe(403);
    expect((await get('/api/trading/archive', seller)).status).toBe(403);
  });
});
