import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';

// The exchange desk end to end: a client agreement is created, bids are filed
// under it, approved and submitted, the exchange returns a clearing result, and
// the cleared volume becomes the energy, open-access and margin bills.

let trader, checker, clientId;

beforeEach(() => {
  db.prepare('DELETE FROM view_bill_invoices').run();
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  db.prepare('DELETE FROM exchange_contracts').run();
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();

  // The desk bills this counterparty as NDMC, which is what its ledger numbers
  // read — the code comes off the linked entity's short_code.
  const entityId = newId('BUY');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, short_code, status)
              VALUES (?, 'BUYER', 'DISCOM', 'New Delhi Municipal Council', 'NDMC', 'APPROVED')`).run(entityId);
  clientId = newId('TCL');
  // Headroom to bid with: the desk blocks a bid that would breach the client's
  // exposure limit, and a client created with none has a limit of zero.
  db.prepare(`INSERT INTO trading_clients (id, name, entity_id, client_type, status, exposure_limit)
              VALUES (?, 'New Delhi Municipal Council', ?, 'DISCOM', 'ACTIVE', 100000000)`).run(clientId, entityId);
  trader = tokenFor('TRADING_USER');
  checker = tokenFor('SJVN_ADMIN');
});

const contractBody = (over = {}) => ({
  portfolio_id: 'PF-NDMC-1',
  loa_no: 'EXC/LOA/001',
  start_date: '2026-09-01',
  end_date: '2026-09-30',
  side: 'Buyer',
  client_id: clientId,
  product: 'DAM',
  bidding_type: 'Single',
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
  return r.body;
}

/** File a bid under the contract, take it through approval, submission and result. */
async function clearBid(contractId, { date = '2026-09-01', blocks, cleared } = {}) {
  const bid = await request(app).post('/api/bids').set(auth(trader)).send({
    client_id: clientId,
    contract_id: contractId,
    exchange: 'IEX',
    product: 'DAM',
    bid_date: date,
    delivery_date: date,
    quantum_mw: blocks[0].quantum_mw,
    price_per_unit: blocks[0].price_per_unit,
    blocks,
  });
  expect(bid.status).toBe(201);
  const ap = await request(app).post(`/api/bids/${bid.body.id}/approve`).set(auth(checker)).send({ status: 'APPROVED' });
  expect(ap.status).toBe(200);
  const sub = await request(app).post(`/api/bids/${bid.body.id}/submit`).set(auth(trader)).send({});
  expect(sub.status).toBe(200);
  const res = await request(app).post(`/api/bids/${bid.body.id}/result`).set(auth(trader)).send({ blocks: cleared });
  expect(res.status).toBe(200);
  return bid.body.id;
}

const contractRow = (id) => db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(id);

describe('filing a bid under an exchange contract', () => {
  it('records the agreement the bid was placed for', async () => {
    const c = await createContract();
    const id = await clearBid(c.id, {
      blocks: [{ time_block: '00:00-00:15', quantum_mw: 100, price_per_unit: 4.2 }],
      cleared: [{ time_block: '00:00-00:15', cleared_quantum_mw: 100, cleared_price: 4.5 }],
    });
    expect(db.prepare('SELECT contract_id FROM bids WHERE id = ?').get(id).contract_id).toBe(c.id);
  });

  it('rejects a contract that does not exist', async () => {
    const r = await request(app).post('/api/bids').set(auth(trader)).send({
      client_id: clientId, contract_id: 'EXC-nope', exchange: 'IEX', product: 'DAM',
      bid_date: '2026-09-01', delivery_date: '2026-09-01', quantum_mw: 10, price_per_unit: 4,
      blocks: [{ time_block: '00:00-00:15', quantum_mw: 10, price_per_unit: 4 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/does not exist/);
  });

  it('rejects a delivery date outside the contract window', async () => {
    const c = await createContract();
    const r = await request(app).post('/api/bids').set(auth(trader)).send({
      client_id: clientId, contract_id: c.id, exchange: 'IEX', product: 'DAM',
      bid_date: '2026-12-01', delivery_date: '2026-12-01', quantum_mw: 10, price_per_unit: 4,
      blocks: [{ time_block: '00:00-00:15', quantum_mw: 10, price_per_unit: 4 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/outside the contract window/);
  });

  it('rejects a contract belonging to another client', async () => {
    const c = await createContract();
    const other = newId('TCL');
    db.prepare(`INSERT INTO trading_clients (id, name, client_type, status, exposure_limit) VALUES (?, 'Other Co', 'TRADER', 'ACTIVE', 100000000)`).run(other);
    const r = await request(app).post('/api/bids').set(auth(trader)).send({
      client_id: other, contract_id: c.id, exchange: 'IEX', product: 'DAM',
      bid_date: '2026-09-01', delivery_date: '2026-09-01', quantum_mw: 10, price_per_unit: 4,
      blocks: [{ time_block: '00:00-00:15', quantum_mw: 10, price_per_unit: 4 }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/different client/);
  });

  it('moves the contract off DRAFT once a bid is live on the exchange', async () => {
    const c = await createContract();
    expect(contractRow(c.id).status).toBe('DRAFT');
    await clearBid(c.id, {
      blocks: [{ time_block: '00:00-00:15', quantum_mw: 100, price_per_unit: 4.2 }],
      cleared: [{ time_block: '00:00-00:15', cleared_quantum_mw: 100, cleared_price: 4.5 }],
    });
    // The window is in the future relative to the seeded dates, so it reads ACTIVE
    // or COMPLETED depending on today — either way it has left DRAFT.
    expect(['ACTIVE', 'COMPLETED']).toContain(contractRow(c.id).status);
  });
});

describe('carrying uncleared volume forward under a contract', () => {
  /** Bid 200 MW on DAM, clear only 80, leaving 120 to carry. */
  async function partiallyCleared(contractId) {
    const bid = await request(app).post('/api/bids').set(auth(trader)).send({
      client_id: clientId, contract_id: contractId, exchange: 'IEX', product: 'DAM',
      bid_date: '2026-09-01', delivery_date: '2026-09-01', quantum_mw: 200, price_per_unit: 4.2,
      blocks: [{ time_block: '00:00-00:15', quantum_mw: 200, price_per_unit: 4.2 }],
    });
    await request(app).post(`/api/bids/${bid.body.id}/approve`).set(auth(checker)).send({ status: 'APPROVED' });
    await request(app).post(`/api/bids/${bid.body.id}/submit`).set(auth(trader)).send({});
    await request(app).post(`/api/bids/${bid.body.id}/result`).set(auth(trader))
      .send({ blocks: [{ time_block: '00:00-00:15', cleared_quantum_mw: 80, cleared_price: 4.5 }] });
    return bid.body.id;
  }

  it('keeps the leg under the same client agreement', async () => {
    const c = await createContract();
    const src = await partiallyCleared(c.id);
    const r = await request(app).post(`/api/bids/${src}/carry-forward`).set(auth(trader))
      .send({ to_product: 'RTM' });
    expect(r.status).toBe(201);
    const leg = db.prepare('SELECT * FROM bids WHERE carry_forward_from = ?').get(src);
    // The leg changed product, so without the contract link the settlement's
    // client+product fallback would never find it.
    expect(leg.contract_id).toBe(c.id);
    expect(leg.product).toBe('RTM');
    expect(leg.ocf_leg).toBe(1);
  });

  it('applies the premium to the carried price', async () => {
    const c = await createContract();
    const src = await partiallyCleared(c.id);
    await request(app).post(`/api/bids/${src}/carry-forward`).set(auth(trader))
      .send({ to_product: 'RTM', premium_discount: 0.35 });
    const leg = db.prepare('SELECT * FROM bids WHERE carry_forward_from = ?').get(src);
    const block = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ?').get(leg.id);
    expect(leg.premium_discount).toBe(0.35);
    expect(block.price_per_unit).toBe(4.55);   // 4.20 bid + 0.35 premium
    expect(block.quantum_mw).toBe(120);        // only the uncleared quantum
  });

  it('applies a discount as a negative premium, never below zero', async () => {
    const c = await createContract();
    const src = await partiallyCleared(c.id);
    await request(app).post(`/api/bids/${src}/carry-forward`).set(auth(trader))
      .send({ to_product: 'RTM', premium_discount: -0.5 });
    const leg = db.prepare('SELECT * FROM bids WHERE carry_forward_from = ?').get(src);
    const block = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ?').get(leg.id);
    expect(block.price_per_unit).toBe(3.7);
  });

  it('settles the carried leg into the same contract once it clears', async () => {
    const c = await createContract();
    const src = await partiallyCleared(c.id);
    const cf = await request(app).post(`/api/bids/${src}/carry-forward`).set(auth(trader))
      .send({ to_product: 'RTM', premium_discount: 0 });
    const legId = cf.body.id;
    await request(app).post(`/api/bids/${legId}/approve`).set(auth(checker)).send({ status: 'APPROVED' });
    await request(app).post(`/api/bids/${legId}/submit`).set(auth(trader)).send({});
    await request(app).post(`/api/bids/${legId}/result`).set(auth(trader))
      .send({ blocks: [{ time_block: '00:00-00:15', cleared_quantum_mw: 120, cleared_price: 4.1 }] });

    const s = await request(app).get(`/api/exchange-contracts/${c.id}/settlement`).set(auth(trader));
    // 80 MW cleared on DAM plus 120 MW on the carried RTM leg, a quarter-hour each.
    expect(s.body.cleared.cleared_mwh).toBe(50);
    expect(s.body.cleared.bids).toBe(2);
  });
});

/** A contract with 100 MWh cleared at Rs 4.50. */
async function readyToBill(over = {}) {
  const c = await createContract(over);
  await clearBid(c.id, {
    blocks: [
      { time_block: '00:00-00:15', quantum_mw: 200, price_per_unit: 4.2 },
      { time_block: '00:15-00:30', quantum_mw: 200, price_per_unit: 4.2 },
    ],
    cleared: [
      { time_block: '00:00-00:15', cleared_quantum_mw: 200, cleared_price: 4.5 },
      { time_block: '00:15-00:30', cleared_quantum_mw: 200, cleared_price: 4.5 },
    ],
  });
  return c;
}

describe('exchange settlement endpoint', () => {
  it('returns the cleared position for the supply period', async () => {
    const c = await readyToBill();
    const r = await request(app).get(`/api/exchange-contracts/${c.id}/settlement`).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.cleared.cleared_mwh).toBe(100); // 2 blocks x 200 MW x 0.25 h
    expect(r.body.money.energy_value).toBe(100 * 1000 * 4.5);
    expect(r.body.money.trading_margin).toBe(100 * 1000 * 0.03);
  });

  it('prices a named bill without writing one', async () => {
    const c = await readyToBill();
    const r = await request(app).get(`/api/exchange-contracts/${c.id}/settlement`)
      .query({ bill_type: 'TRADING_MARGIN' }).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.invoice_amount).toBe(3000);
    expect(db.prepare('SELECT COUNT(*) n FROM view_bill_invoices').get().n).toBe(0);
  });

  it('lists the cleared bids behind the settlement', async () => {
    const c = await readyToBill();
    const r = await request(app).get(`/api/exchange-contracts/${c.id}/bids`).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  it('404s for a contract that does not exist', async () => {
    const r = await request(app).get('/api/exchange-contracts/EXC-nope/settlement').set(auth(trader));
    expect(r.status).toBe(404);
  });
});

describe('exchange invoice generation', () => {
  it('raises an energy bill into the View Bills register', async () => {
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY', invoice_date: '2026-09-08' });
    expect(r.status).toBe(201);
    expect(r.body.invoice_amount).toBe(100 * 1000 * 4.5 + 100 * 1000 * 0.03);
    expect(r.body.exchange_contract_id).toBe(c.id);
    expect(r.body.quantum_mwh).toBe(100);
    expect(r.body.rate_per_unit).toBe(4.5);
    expect(r.body.generated_from).toBe('SETTLEMENT');
    expect(r.body.invoice_no).toMatch(/^SJVN\/EXCHANGE\/NDMC\/202609\/\d+$/);

    const list = await request(app).get('/api/view-bill-invoices')
      .query({ bill_type: 'EXCHANGE_ENERGY' }).set(auth(trader));
    expect(list.body.map((i) => i.id)).toContain(r.body.id);
  });

  it('filters View Bills by the exchange contract product', async () => {
    const dam = await readyToBill();
    const gdam = await readyToBill({ product: 'GDAM', loa_no: 'EXC/LOA/GDAM/001', is_renewable: 'Yes' });
    const damInv = await request(app).post(`/api/exchange-contracts/${dam.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY', invoice_date: '2026-09-08' });
    const gdamInv = await request(app).post(`/api/exchange-contracts/${gdam.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY', invoice_date: '2026-09-08' });
    expect(damInv.status).toBe(201);
    expect(gdamInv.status).toBe(201);

    const damList = await request(app).get('/api/view-bill-invoices')
      .query({ bill_type: 'EXCHANGE_ENERGY', product: 'DAM' }).set(auth(trader));
    expect(damList.status).toBe(200);
    expect(damList.body.map((i) => i.id)).toEqual([damInv.body.id]);

    const gdamList = await request(app).get('/api/view-bill-invoices')
      .query({ bill_type: 'EXCHANGE_ENERGY', product: 'GDAM' }).set(auth(trader));
    expect(gdamList.body.map((i) => i.id)).toEqual([gdamInv.body.id]);
  });

  it('rejects an unknown product filter on View Bills', async () => {
    const r = await request(app).get('/api/view-bill-invoices')
      .query({ product: 'NOT_A_MARKET' }).set(auth(trader));
    expect(r.status).toBe(400);
  });

  it('numbers the open-access and margin bills under their own registers', async () => {
    const c = await readyToBill();
    const oa = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_OA', invoice_date: '2026-09-08' });
    expect(oa.status).toBe(201);
    expect(oa.body.invoice_no).toMatch(/^SJVN\/EXCHANGE\/OA\/NDMC\/202609\/\d+$/);

    const margin = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'TRADING_MARGIN', invoice_date: '2026-09-08' });
    expect(margin.status).toBe(201);
    expect(margin.body.invoice_amount).toBe(3000);
    expect(margin.body.invoice_no).toMatch(/^SJVN\/MARGIN\/NDMC\/202609\/\d+$/);
  });

  it('bills the exchange transaction fee on the open-access bill', async () => {
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_OA' });
    const fee = r.body.line_items.find((l) => /IEX transaction fee/i.test(l.description));
    expect(fee.amount).toBe(100 * 20);
  });

  it('stores the breakup so a bill can be read back to its bid blocks', async () => {
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY' });
    const breakup = JSON.parse(db.prepare('SELECT breakup_json FROM view_bill_invoices WHERE id = ?').get(r.body.id).breakup_json);
    expect(breakup.settlement.cleared.cleared_blocks).toBe(2);
    expect(breakup.settlement.cleared.bid_ids).toHaveLength(1);
  });

  it('refuses to bill a period in which nothing cleared', async () => {
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY', from: '2026-09-20', to: '2026-09-25' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Nothing to bill/);
  });

  it('will not bill open-access fees for a period in which nothing cleared', async () => {
    // The NOAR fee and the RLDC/SLDC day charges price to a real amount with no
    // volume behind them, so the bill has to be asked for explicitly.
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_OA', from: '2026-09-20', to: '2026-09-25' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No volume settled/);
    expect(r.body.would_bill).toBeGreaterThan(0);
  });

  it('bills the flat charges for an empty period when explicitly asked to', async () => {
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_OA', from: '2026-09-20', to: '2026-09-25', allow_zero_volume: true });
    expect(r.status).toBe(201);
    expect(r.body.quantum_mwh).toBe(0);
  });

  it('refuses a period whose end precedes its start', async () => {
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY', from: '2026-09-05', to: '2026-09-01' });
    expect(r.status).toBe(400);
  });

  it('will not bill a cancelled contract', async () => {
    const c = await readyToBill();
    db.prepare("UPDATE exchange_contracts SET status = 'CANCELLED' WHERE id = ?").run(c.id);
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/CANCELLED/);
  });

  it('lists the bills raised against the contract', async () => {
    const c = await readyToBill();
    await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader)).send({ bill_type: 'EXCHANGE_ENERGY' });
    await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader)).send({ bill_type: 'TRADING_MARGIN' });
    const r = await request(app).get(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader));
    expect(r.body).toHaveLength(2);
  });

  it('keeps a read-only role out of the billing run', async () => {
    const c = await readyToBill();
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(tokenFor('MANAGEMENT')))
      .send({ bill_type: 'EXCHANGE_ENERGY' });
    expect(r.status).toBe(403);
  });

  it('settles a sell-side contract net of the retained margin', async () => {
    const c = await readyToBill({ side: 'Seller' });
    const r = await request(app).post(`/api/exchange-contracts/${c.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'EXCHANGE_ENERGY' });
    expect(r.status).toBe(201);
    expect(r.body.invoice_amount).toBe(100 * 1000 * 4.5 - 100 * 1000 * 0.03);
  });
});
