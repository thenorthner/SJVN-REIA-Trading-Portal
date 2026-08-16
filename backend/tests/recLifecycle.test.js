import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';

// The REC desk end to end: certificates are issued into the ledger, a bid is
// raised and cleared by a second pair of eyes, the exchange session returns a
// discovered rate, and the execution both moves the stock and settles the trade.

let trader, checker;

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  db.prepare('DELETE FROM rec_transactions').run();
  db.prepare('DELETE FROM rec_orders').run();
  db.prepare('DELETE FROM rec_bids').run();
  db.prepare('DELETE FROM rec_ledger').run();
  trader = tokenFor('TRADING_USER');
  checker = tokenFor('SJVN_ADMIN');
});

function makeLot({ vintage = '2026-01', qty = 1000, tech = 'Solar', cost = 100 } = {}) {
  const id = newId('REC');
  db.prepare(`
    INSERT INTO rec_ledger (id, rec_no, source, vintage_month, quantity, status,
      application_date, issuance_date, issue_cost_per_rec, technology)
    VALUES (?, ?, 'Charanka', ?, ?, 'ISSUED', ?, ?, ?, ?)
  `).run(id, `R/${id}`, vintage, qty, `${vintage}-01`, `${vintage}-15`, cost, tech);
  return id;
}

/**
 * Raise a sell bid. A sell is checked against the live position, so unless the
 * test is about that check the helper puts backing stock behind it.
 *
 * The backing lot carries a far-future vintage so it always sorts last in the
 * FIFO draw and never disturbs a test's own lot ordering. Tests that set up an
 * exact position pass ensureStock: false — inferring it from whatever happens
 * to be in the ledger made the helper depend on state left by other files.
 */
async function raiseBid({ ensureStock = true, ...over } = {}) {
  if (ensureStock && (over.side ?? 'Sell') === 'Sell') {
    makeLot({ vintage: '2099-12', qty: 50000 });
  }
  const r = await request(app).post('/api/rec-trading/bids').set(auth(trader)).send({
    entity_name: 'SJVN Limited',
    exchange: 'IEX',
    portfolio_code: 'PF-SJVN-1',
    rec_type: 'Solar REC',
    price: 2000,
    quantity: 500,
    side: 'Sell',
    ...over,
  });
  expect(r.status).toBe(201);
  return r.body;
}

const bidRow = (id) => db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(id);

describe('REC inventory endpoint', () => {
  it('reports the sellable position with its oldest vintage', async () => {
    makeLot({ vintage: '2026-03', qty: 400 });
    makeLot({ vintage: '2026-01', qty: 600 });
    const r = await request(app).get('/api/rec-trading/inventory').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.held_qty).toBe(1000);
    expect(r.body.oldest_vintage).toBe('2026-01');
    expect(r.body.breakdown).toHaveLength(2);
  });

  it('narrows the position to a certificate type', async () => {
    makeLot({ qty: 400, tech: 'Solar' });
    makeLot({ qty: 600, tech: 'Wind' });
    const r = await request(app).get('/api/rec-trading/inventory').query({ rec_type: 'Solar REC' }).set(auth(trader));
    expect(r.body.held_qty).toBe(400);
  });
});

describe('bidding against the live position', () => {
  it('refuses a sell bid larger than the certificates actually held', async () => {
    makeLot({ qty: 400 });
    const r = await request(app).post('/api/rec-trading/bids').set(auth(trader)).send({
      entity_name: 'SJVN Limited', exchange: 'IEX', portfolio_code: 'PF-1',
      rec_type: 'Solar REC', price: 2000, quantity: 500, side: 'Sell',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only 400 are sellable/);
  });

  it('counts certificates already committed to an open bid as unavailable', async () => {
    makeLot({ qty: 1000 });
    await raiseBid({ quantity: 800, ensureStock: false });   // still open, holds 800
    const r = await request(app).post('/api/rec-trading/bids').set(auth(trader)).send({
      entity_name: 'SJVN Limited', exchange: 'IEX', portfolio_code: 'PF-1',
      rec_type: 'Solar REC', price: 2000, quantity: 300, side: 'Sell',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/200 are sellable.*1000 held, 800 committed/);
  });

  it('frees the commitment again when the holding bid is cancelled', async () => {
    makeLot({ qty: 1000 });
    const first = await raiseBid({ quantity: 800, ensureStock: false });
    await request(app).post(`/api/rec-trading/bids/${first.id}/cancel`).set(auth(trader)).send({});
    const r = await request(app).post('/api/rec-trading/bids').set(auth(trader)).send({
      entity_name: 'SJVN Limited', exchange: 'IEX', portfolio_code: 'PF-1',
      rec_type: 'Solar REC', price: 2000, quantity: 900, side: 'Sell',
    });
    expect(r.status).toBe(201);
  });

  it('does not let a solar bid draw on non-solar stock', async () => {
    makeLot({ qty: 1000, tech: 'Wind' });
    const r = await request(app).post('/api/rec-trading/bids').set(auth(trader)).send({
      entity_name: 'SJVN Limited', exchange: 'IEX', portfolio_code: 'PF-1',
      rec_type: 'Solar REC', price: 2000, quantity: 100, side: 'Sell',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only 0 are sellable/);
  });

  it('leaves a buy bid free of any inventory constraint', async () => {
    const r = await request(app).post('/api/rec-trading/bids').set(auth(trader)).send({
      entity_name: 'SJVN Limited', exchange: 'IEX', portfolio_code: 'PF-1',
      rec_type: 'Solar REC', price: 2000, quantity: 5000, side: 'Buy',
    });
    expect(r.status).toBe(201);
  });

  it('reports held, committed and sellable separately', async () => {
    makeLot({ qty: 1000 });
    await raiseBid({ quantity: 250, ensureStock: false });
    const r = await request(app).get('/api/rec-trading/inventory').set(auth(trader));
    expect(r.body.held_qty).toBe(1000);
    expect(r.body.committed_qty).toBe(250);
    expect(r.body.sellable_qty).toBe(750);
  });
});

describe('REC bid approval', () => {
  it('takes a submitted bid to APPROVED', async () => {
    const bid = await raiseBid();
    expect(bid.status).toBe('SUBMITTED');
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/approve`).set(auth(checker)).send({ status: 'APPROVED' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('APPROVED');
  });

  it('will not let the desk member who raised a bid approve it', async () => {
    const bid = await raiseBid();
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/approve`).set(auth(trader)).send({ status: 'APPROVED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Maker-checker/);
  });

  it('requires a reason to reject', async () => {
    const bid = await raiseBid();
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/approve`).set(auth(checker)).send({ status: 'REJECTED' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/reject_reason is required/);
  });

  it('records the rejection reason when one is given', async () => {
    const bid = await raiseBid();
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/approve`).set(auth(checker))
      .send({ status: 'REJECTED', reject_reason: 'Price below the CERC floor' });
    expect(r.body.status).toBe('REJECTED');
    expect(r.body.reject_reason).toBe('Price below the CERC floor');
  });

  it('refuses to approve a bid twice', async () => {
    const bid = await raiseBid();
    await request(app).post(`/api/rec-trading/bids/${bid.id}/approve`).set(auth(checker)).send({ status: 'APPROVED' });
    const again = await request(app).post(`/api/rec-trading/bids/${bid.id}/approve`).set(auth(checker)).send({ status: 'APPROVED' });
    expect(again.status).toBe(400);
  });
});

/** A bid cleared for the exchange, with stock behind it. */
async function approvedBid(over = {}) {
  const bid = await raiseBid(over);
  await request(app).post(`/api/rec-trading/bids/${bid.id}/approve`).set(auth(checker)).send({ status: 'APPROVED' });
  return bidRow(bid.id);
}

describe('REC bid execution', () => {
  it('moves the certificates and settles the trade', async () => {
    makeLot({ vintage: '2026-01', qty: 300 });
    makeLot({ vintage: '2026-02', qty: 400 });
    const bid = await approvedBid({ quantity: 500, ensureStock: false });

    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 500, discovered_rate: 2400, trade_date: '2026-09-01', buyer: 'Green Buyer Co' });
    expect(r.status).toBe(201);
    // Drawn oldest vintage first, across two lots.
    expect(r.body.allocations.map((a) => a.quantity)).toEqual([300, 200]);
    expect(r.body.settlement.trade_obligation).toBe(1_200_000);
    expect(r.body.settlement.exchange_fees).toBe(1000);
    expect(r.body.settlement.net_revenue).toBe(1_200_000 - 1000 - 180);

    const inv = await request(app).get('/api/rec-trading/inventory').set(auth(trader));
    expect(inv.body.held_qty).toBe(200);
  });

  it('raises a REC order carrying the realised revenue', async () => {
    makeLot({ qty: 1000 });
    const bid = await approvedBid({ quantity: 500 });
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 500, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.body.rec_order.total_recs_sold).toBe(500);
    expect(r.body.rec_order.discovered_rate).toBe(2400);
    expect(r.body.rec_order.net_revenue).toBe(1_200_000 - 1000 - 180);
    expect(r.body.rec_order.bid_id).toBe(bid.id);
    expect(bidRow(bid.id).rec_order_id).toBe(r.body.rec_order.id);
  });

  it('still refuses at execution if the stock went away after the bid was cleared', async () => {
    // The bid-time check is not enough on its own: certificates can be redeemed
    // or sold by another route between approval and the session clearing.
    const lotId = makeLot({ qty: 500 });
    const bid = await approvedBid({ quantity: 500, ensureStock: false });
    await request(app).post(`/api/rec/${lotId}/transactions`).set(auth(trader))
      .send({ txn_type: 'REDEMPTION', quantity: 400, trade_date: '2026-08-20' });

    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 500, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Only 100 certificate/);
    expect(r.body.available).toBe(100);
    // Nothing moved, and the bid is still clear to trade a smaller volume.
    expect(db.prepare("SELECT COUNT(*) n FROM rec_transactions WHERE txn_type = 'SALE'").get().n).toBe(0);
    expect(bidRow(bid.id).status).toBe('APPROVED');
  });

  it('will not sell solar certificates out of non-solar stock', async () => {
    // Solar stock backs the bid at entry; it is redeemed before the session
    // clears, leaving only the wind lot, which cannot settle a solar sale.
    const solar = makeLot({ qty: 200, tech: 'Solar' });
    makeLot({ qty: 1000, tech: 'Wind' });
    const bid = await approvedBid({ quantity: 100, rec_type: 'Solar REC', ensureStock: false });
    await request(app).post(`/api/rec/${solar}/transactions`).set(auth(trader))
      .send({ txn_type: 'REDEMPTION', quantity: 200, trade_date: '2026-08-20' });

    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 100, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Only 0 certificate\(s\) held for Solar REC/);
  });

  it('brings a buy into the ledger instead of drawing stock down', async () => {
    const bid = await approvedBid({ side: 'Buy', quantity: 250, price: 1800, rec_type: 'Non-Solar REC' });
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 250, discovered_rate: 1750, trade_date: '2026-09-01' });
    expect(r.status).toBe(201);
    expect(r.body.lot_created).toBeTruthy();
    expect(r.body.rec_order).toBeNull();
    const inv = await request(app).get('/api/rec-trading/inventory').query({ rec_type: 'Non-Solar REC' }).set(auth(trader));
    expect(inv.body.held_qty).toBe(250);
  });

  it('only executes an approved bid', async () => {
    makeLot({ qty: 1000 });
    const bid = await raiseBid();
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 100, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Only an APPROVED bid/);
  });

  it('will not execute the same bid twice', async () => {
    makeLot({ qty: 1000 });
    const bid = await approvedBid({ quantity: 200 });
    await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 200, discovered_rate: 2400, trade_date: '2026-09-01' });
    const again = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 200, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(again.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM rec_transactions').get().n).toBe(1);
  });

  it('rejects a malformed trade date', async () => {
    makeLot({ qty: 1000 });
    const bid = await approvedBid();
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 100, discovered_rate: 2400, trade_date: '01-09-2026' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/YYYY-MM-DD/);
  });

  it('keeps a read-only role out of execution', async () => {
    makeLot({ qty: 1000 });
    const bid = await approvedBid();
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(tokenFor('MANAGEMENT')))
      .send({ executed_quantity: 100, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.status).toBe(403);
  });

  it('shows the bid with the tranches it booked', async () => {
    makeLot({ vintage: '2026-01', qty: 300 });
    makeLot({ vintage: '2026-02', qty: 300 });
    const bid = await approvedBid({ quantity: 400 });
    await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 400, discovered_rate: 2400, trade_date: '2026-09-01' });
    const r = await request(app).get(`/api/rec-trading/bids/${bid.id}`).set(auth(trader));
    expect(r.body.transactions).toHaveLength(2);
    expect(r.body.rec_order.total_recs_sold).toBe(400);
  });
});

describe('reversing an executed sale', () => {
  /** Execute a sell and hand back the tranches it booked. */
  async function executedSale(qty = 400) {
    makeLot({ vintage: '2026-01', qty: 300 });
    makeLot({ vintage: '2026-02', qty: 300 });
    const bid = await approvedBid({ quantity: qty });
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: qty, discovered_rate: 2400, trade_date: '2026-09-01' });
    return { bid, txns: db.prepare('SELECT * FROM rec_transactions WHERE bid_id = ? ORDER BY created_at').all(bid.id), order: r.body.rec_order };
  }

  it('puts the certificates back on the lot', async () => {
    const { txns } = await executedSale();
    const before = (await request(app).get('/api/rec-trading/inventory').set(auth(trader))).body.held_qty;
    await request(app).post(`/api/rec/transactions/${txns[0].id}/reverse`).set(auth(trader)).send({ reason: 'Trade busted' });
    const after = (await request(app).get('/api/rec-trading/inventory').set(auth(trader))).body.held_qty;
    expect(after).toBe(before + txns[0].quantity);
  });

  it('restates the bid and its REC order to what is still sold', async () => {
    const { bid, txns, order } = await executedSale(400);
    expect(order.total_recs_sold).toBe(400);
    // Reverse the first tranche (300 certificates), leaving 100 sold.
    const r = await request(app).post(`/api/rec/transactions/${txns[0].id}/reverse`).set(auth(trader)).send({});
    expect(r.status).toBe(201);
    expect(r.body.restated.executed_quantity).toBe(100);

    expect(bidRow(bid.id).executed_quantity).toBe(100);
    const restated = db.prepare('SELECT * FROM rec_orders WHERE id = ?').get(order.id);
    expect(restated.total_recs_sold).toBe(100);
    expect(restated.trade_obligation).toBe(100 * 2400);
    expect(restated.net_revenue).toBe(100 * 2400 - 200 - 36);
  });

  it('cancels the REC order and reopens the bid when the whole sale is reversed', async () => {
    makeLot({ vintage: '2026-01', qty: 500 });
    const bid = await approvedBid({ quantity: 200 });
    const ex = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 200, discovered_rate: 2400, trade_date: '2026-09-01' });
    const txn = db.prepare('SELECT * FROM rec_transactions WHERE bid_id = ?').get(bid.id);

    await request(app).post(`/api/rec/transactions/${txn.id}/reverse`).set(auth(trader)).send({});
    // Nothing was sold in the end, so the bid is a cleared bid again.
    expect(bidRow(bid.id).status).toBe('APPROVED');
    expect(bidRow(bid.id).executed_quantity).toBeNull();
    const order = db.prepare('SELECT * FROM rec_orders WHERE id = ?').get(ex.body.rec_order.id);
    expect(order.status).toBe('CANCELLED');
    expect(order.net_revenue).toBe(0);
  });

  it('leaves a hand-recorded sale alone — it has no bid to restate', async () => {
    const lotId = makeLot({ qty: 500 });
    const sale = await request(app).post(`/api/rec/${lotId}/transactions`).set(auth(trader))
      .send({ txn_type: 'SALE', quantity: 100, rate_per_rec: 2400, trade_date: '2026-09-01' });
    expect(sale.status).toBe(201);
    const txn = db.prepare('SELECT * FROM rec_transactions WHERE lot_id = ?').get(lotId);
    const r = await request(app).post(`/api/rec/transactions/${txn.id}/reverse`).set(auth(trader)).send({});
    expect(r.status).toBe(201);
    expect(r.body.restated).toBeNull();
  });
});

describe('REC order provenance', () => {
  it('marks a settlement-derived order as such', async () => {
    makeLot({ qty: 1000 });
    const bid = await approvedBid({ quantity: 100 });
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 100, discovered_rate: 2400, trade_date: '2026-09-01' });
    expect(r.body.rec_order.generated_from).toBe('SETTLEMENT');
  });

  it('marks a hand-keyed order MANUAL so revenue reporting can tell them apart', async () => {
    const r = await request(app).post('/api/rec-trading/orders').set(auth(trader))
      .send({ trade_date: '2026-09-01', total_recs_sold: 500, discovered_rate: 2400 });
    expect(r.status).toBe(201);
    expect(r.body.generated_from).toBe('MANUAL');
    expect(r.body.bid_id).toBeNull();
  });
});

describe('REC bid cancellation', () => {
  it('withdraws a bid that has not traded', async () => {
    const bid = await raiseBid();
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/cancel`).set(auth(trader)).send({});
    expect(r.body.status).toBe('CANCELLED');
  });

  it('refuses to cancel a bid whose certificates have already moved', async () => {
    makeLot({ qty: 1000 });
    const bid = await approvedBid({ quantity: 100 });
    await request(app).post(`/api/rec-trading/bids/${bid.id}/execute`).set(auth(trader))
      .send({ executed_quantity: 100, discovered_rate: 2400, trade_date: '2026-09-01' });
    const r = await request(app).post(`/api/rec-trading/bids/${bid.id}/cancel`).set(auth(trader)).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/reverse its transactions/);
  });
});
