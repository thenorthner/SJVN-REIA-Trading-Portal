import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth, makeEntity } from './helpers/reia.js';

// The trading client portal: a counterparty trading company sees its own
// account — its bids, agreements, bills and ledger — and nothing of anyone
// else's, however its login happens to be linked.

let entityA, clientA, clientB, t;

const mkClient = (name, entityId = null) => {
  const id = newId('TCL');
  db.prepare('INSERT INTO trading_clients (id, entity_id, name, client_type, status) VALUES (?, ?, ?, ?, ?)')
    .run(id, entityId, name, 'DISCOM', 'ACTIVE');
  return id;
};

const mkBid = (clientId, date = '2026-09-01') => {
  const id = newId('BID');
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, cleared_quantum_mw, status)
    VALUES (?, ?, 'IEX', 'DAM', ?, ?, 50, 4.2, 40, 'CLEARED')
  `).run(id, clientId, date, date);
  return id;
};

const mkInvoice = (clientId, amount = 100000) => {
  const id = newId('TIN');
  db.prepare(`
    INSERT INTO trading_invoices (id, invoice_no, client_id, invoice_kind, billing_period, quantum_mwh, total_amount, status)
    VALUES (?, ?, ?, 'EXCHANGE', '2026-09', 100, ?, 'SENT')
  `).run(id, `INV-${id}`, clientId, amount);
  return id;
};

const mkExchangeContract = (clientId) => db.prepare(`
  INSERT INTO exchange_contracts (id, client_id, side, start_date, end_date, status)
  VALUES (?, ?, 'Buyer', '2026-09-01', '2026-09-30', 'ACTIVE')
`).run(newId('EXC'), clientId);

const mkBilateral = (clientId) => db.prepare(`
  INSERT INTO bilateral_transactions (id, client_id, counterparty, quantum_mw, tariff_per_unit, start_date, end_date, status)
  VALUES (?, ?, 'Counterparty Ltd', 50, 4.2, '2026-09-01', '2026-09-30', 'ACTIVE')
`).run(newId('BLT'), clientId);

const mkLedger = (clientId, balance) => {
  db.prepare(`
    INSERT INTO client_ledgers (id, client_id, transaction_type, credit, debit, running_balance, description, timestamp)
    VALUES (?, ?, 'INVOICE', ?, 0, ?, 'probe', datetime('now'))
  `).run(newId('CLG'), clientId, balance, balance);
};

const mkStatement = (clientId) => {
  db.prepare('INSERT INTO settlement_statements (id, client_id, period) VALUES (?, ?, ?)')
    .run(newId('SOA'), clientId, '2026-09');
};

beforeEach(() => {
  for (const table of ['client_ledgers', 'settlement_statements', 'trading_invoices', 'bids', 'exchange_contracts', 'bilateral_transactions', 'trading_clients']) {
    try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* table may not exist */ }
  }
  entityA = makeEntity('BUYER', { name: 'Client A Ltd' });
  clientA = mkClient('Client A', entityA.id);
  clientB = mkClient('Client B');
  mkBid(clientA);
  mkBid(clientA);
  mkBid(clientB);
  mkInvoice(clientA, 100000);
  mkInvoice(clientB, 900000);
  mkLedger(clientA, 100000);
  mkLedger(clientB, 900000);
  mkStatement(clientA);
  mkStatement(clientB);
  mkExchangeContract(clientA);
  mkExchangeContract(clientB);
  mkBilateral(clientA);
  mkBilateral(clientB);

  t = {
    // The two ways a client login is linked in this data: to the trading client
    // row itself, and to the entity behind it.
    byClientId: tokenFor('TRADING_CLIENT', { linked_entity_id: clientA }),
    byEntityId: tokenFor('TRADING_CLIENT', { linked_entity_id: entityA.id }),
    otherClient: tokenFor('TRADING_CLIENT', { linked_entity_id: clientB }),
    unlinked: tokenFor('TRADING_CLIENT'),
    desk: tokenFor('TRADING_USER'),
  };
});

const get = (path, who) => request(app).get(path).set(auth(who));
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);

describe('trading client — its own account', () => {
  it.each(['byClientId', 'byEntityId'])('summarises the account for a login linked %s', async (how) => {
    const r = await get('/api/trading-client/summary', t[how]);
    expect(r.status).toBe(200);
    expect(r.body.client.id).toBe(clientA);
    expect(r.body.bids).toMatchObject({ total: 2, cleared_mw: 80, quantum_mw: 100 });
    expect(r.body.invoices).toMatchObject({ total: 1, billed: 100000 });
    expect(r.body.contracts).toMatchObject({ exchange_contracts: 1, bilateral_deals: 1 });
    expect(r.body.ledger_balance).toBe(100000);
    expect(r.body.recent_invoices).toHaveLength(1);
  });

  it("refuses another client's account", async () => {
    const r = await get(`/api/trading-client/summary?client_id=${clientB}`, t.byClientId);
    expect(r.status).toBe(403);
  });

  it('tells an unlinked login what is wrong instead of showing the desk', async () => {
    const r = await get('/api/trading-client/summary', t.unlinked);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not linked to a trading client/i);
  });
});

describe('trading client — the screens its menu opens', () => {
  it('shows only its own bids, agreements and deals', async () => {
    const bids = await get('/api/bids', t.byClientId);
    expect(bids.status).toBe(200);
    expect(bids.body).toHaveLength(2);
    expect(bids.body.every((b) => b.client_id === clientA)).toBe(true);

    const exchange = await get('/api/exchange-contracts', t.byEntityId);
    expect(exchange.status).toBe(200);
    expect(exchange.body.map((c) => c.client_id)).toEqual([clientA]);

    const bilateral = await get('/api/bilateral', t.byClientId);
    expect(bilateral.status).toBe(200);
    expect(bilateral.body.map((c) => c.client_id)).toEqual([clientA]);
  });

  it("cannot open another client's agreement or deal by id", async () => {
    const theirExchange = db.prepare('SELECT id FROM exchange_contracts WHERE client_id = ?').get(clientB).id;
    const theirDeal = db.prepare('SELECT id FROM bilateral_transactions WHERE client_id = ?').get(clientB).id;
    expect((await get(`/api/exchange-contracts/${theirExchange}`, t.byClientId)).status).toBe(404);
    expect((await get(`/api/bilateral/${theirDeal}`, t.byClientId)).status).toBe(404);
  });

  it('shows only its own bills, ledger and statements', async () => {
    const invoices = await get('/api/billing-settlement/invoices', t.byClientId);
    expect(invoices.body.map((i) => i.client_id)).toEqual([clientA]);

    const ledger = await get(`/api/billing-settlement/ledger/${clientA}`, t.byClientId);
    expect(ledger.status).toBe(200);
    expect(ledger.body).toHaveLength(1);

    const soa = await get('/api/billing-settlement/soa', t.byEntityId);
    expect(soa.body.map((s) => s.client_id)).toEqual([clientA]);
  });

  it("cannot read another client's ledger or post netting", async () => {
    expect((await get(`/api/billing-settlement/ledger/${clientB}`, t.byClientId)).status).toBe(403);
    const netting = await post('/api/billing-settlement/netting', t.byClientId, {
      client_id: clientB, receivables_amount: 10, payables_amount: 5, period: '2026-09',
    });
    expect(netting.status).toBe(403);
    expect(db.prepare("SELECT COUNT(*) AS n FROM client_ledgers WHERE transaction_type = 'SET_OFF'").get().n).toBe(0);
  });

  it('leaves the desk seeing every client', async () => {
    expect((await get('/api/bids', t.desk)).body).toHaveLength(3);
    expect((await get('/api/billing-settlement/invoices', t.desk)).body).toHaveLength(2);
    expect((await get('/api/billing-settlement/soa', t.desk)).body).toHaveLength(2);
  });
});

describe('the desk keeps its own actions', () => {
  // The client's menu used to open the desk's consoles, so their buttons were
  // in front of a client that the API would refuse. The menu now points at the
  // client's own screens; these are the refusals behind that.
  it('refuses a client the writes those consoles offer', async () => {
    const bid = {
      client_id: clientA, exchange: 'IEX', product: 'DAM', bid_date: '2026-09-01',
      delivery_date: '2026-09-01', quantum_mw: 10, price_per_unit: 4,
      blocks: [{ time_block: '00:00-00:15', quantum_mw: 10, price_per_unit: 4 }],
    };
    expect((await post('/api/bids', t.byClientId, bid)).status).toBe(403);
    expect((await post('/api/bilateral', t.byClientId, {})).status).toBe(403);
    expect((await post('/api/exchange-contracts', t.byClientId, {})).status).toBe(403);
    expect((await post('/api/billing-settlement/invoices/generate', t.byClientId, {})).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bids').get().n).toBe(3);
  });
});
