import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';
import { rtmSessionAt, dayAheadGateAt } from '../src/services/rtmSession.js';

// Buy bids are paid for in advance: pre-payment + credit limit, less what other
// buy bids already hold. Sell bids are not funds-limited.

let trader, buyerId, generatorId;

// 4 MW x 1000 x 0.25h x Rs 5/kWh = Rs 5,000 per DAM block.
const bid = (clientId, over = {}) => ({
  client_id: clientId, exchange: 'IEX', product: 'DAM', type: 'Buy',
  bid_date: '2026-10-18', delivery_date: '2026-10-19',
  quantum_mw: 4, price_per_unit: 5,
  blocks: [{ time_block: 'Block-1', quantum_mw: 4, price_per_unit: 5 }],
  ...over,
});

beforeEach(() => {
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  buyerId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, name, client_type, status, exposure_limit, pre_payment_balance, credit_limit)
              VALUES (?, ?, 'DISCOM', 'ACTIVE', 100000000, 6000, 3000)`).run(buyerId, `Funds buyer ${buyerId}`);
  generatorId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, name, client_type, status, exposure_limit, pre_payment_balance, credit_limit)
              VALUES (?, ?, 'GENERATOR', 'ACTIVE', 100000000, 0, 0)`).run(generatorId, `Funds seller ${generatorId}`);
  trader = tokenFor('TRADING_USER');
});

const post = (body) => request(app).post('/api/bids').set(auth(trader)).send(body);

describe('buy-bid funds check', () => {
  it('lets a buy bid through when pre-payment covers it, and stores the side', async () => {
    const res = await post(bid(buyerId));
    expect(res.status).toBe(201);
    expect(res.body.funds).toMatchObject({ applies: true, ok: true, available: 9000 });
    expect(db.prepare('SELECT bid_type FROM bids WHERE id = ?').get(res.body.id).bid_type).toBe('BUY');
  });

  it('uses the credit limit once the pre-payment is not enough', async () => {
    // Rs 8,000 > Rs 6,000 balance but <= Rs 9,000 with credit.
    const res = await post(bid(buyerId, { blocks: [{ time_block: 'Block-1', quantum_mw: 6.4, price_per_unit: 5 }], quantum_mw: 6.4 }));
    expect(res.status).toBe(201);
    expect(res.body.funds.uses_credit).toBe(true);
  });

  it('refuses a buy bid beyond pre-payment + credit, naming the shortfall', async () => {
    const res = await post(bid(buyerId, { blocks: [{ time_block: 'Block-1', quantum_mw: 8, price_per_unit: 5 }], quantum_mw: 8 }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    expect(res.body.funds.shortfall).toBe(1000);
    expect(res.body.error).toMatch(/Insufficient funds/);
  });

  it('accepts the same bid with a written override and records it', async () => {
    const res = await post(bid(buyerId, {
      blocks: [{ time_block: 'Block-1', quantum_mw: 8, price_per_unit: 5 }], quantum_mw: 8,
      funds_override_reason: 'Receipt due tomorrow, MD approved',
    }));
    expect(res.status).toBe(201);
    const ev = db.prepare("SELECT details FROM bid_events WHERE bid_id = ? AND event_type = 'FUNDS_OVERRIDE'").get(res.body.id);
    expect(JSON.parse(ev.details).reason).toMatch(/MD approved/);
  });

  it('counts money held by earlier approved buy bids', async () => {
    const first = await post(bid(buyerId, { blocks: [{ time_block: 'Block-1', quantum_mw: 6.4, price_per_unit: 5 }], quantum_mw: 6.4 }));
    expect(first.status).toBe(201);
    db.prepare("UPDATE bids SET approval_status = 'APPROVED' WHERE id = ?").run(first.body.id);
    // Rs 8,000 held; only Rs 1,000 left, so a Rs 5,000 bid no longer fits.
    const second = await post(bid(buyerId));
    expect(second.status).toBe(400);
    expect(second.body.funds.committed).toBe(8000);
  });

  it('does not limit sell bids by funds', async () => {
    const res = await post(bid(generatorId, { type: 'Sell' }));
    expect(res.status).toBe(201);
    expect(res.body.funds.applies).toBe(false);
  });

  it('shows the funds position through /funds/:clientId and the compliance pre-check', async () => {
    const pos = await request(app).get(`/api/bids/funds/${buyerId}`).set(auth(trader));
    expect(pos.body).toEqual({ pre_payment_balance: 6000, credit_limit: 3000, committed: 0, available: 9000 });
    const check = await request(app).post('/api/bids/compliance-check').set(auth(trader))
      .send(bid(buyerId, { blocks: [{ time_block: 'Block-1', quantum_mw: 8, price_per_unit: 5 }] }));
    expect(check.body.funds).toMatchObject({ applies: true, ok: false, shortfall: 1000 });
  });

  it('checks the whole upload per client on bulk entry', async () => {
    const rows = ['Block-1', 'Block-2'].map((tb) => ({
      client_id: buyerId, exchange: 'IEX', product: 'DAM', bid_date: '2026-10-18', delivery_date: '2026-10-19',
      time_block: tb, quantum_mw: 8, price_per_unit: 5, type: 'Buy', // 2 x Rs 10,000 = Rs 20,000 > 9,000
    }));
    const res = await request(app).post('/api/bids/bulk').set(auth(trader)).send({ rows });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.errors)).toMatch(/Insufficient funds/);
  });
});

describe('client credit limit', () => {
  it('is saved on create and update and must not be negative', async () => {
    const created = await request(app).post('/api/trading-clients').set(auth(trader))
      .send({ name: `Credit client ${Date.now()}`, client_type: 'DISCOM', exposure_limit: 1000000, credit_limit: 250000 });
    expect(created.status).toBe(201);
    expect(created.body.credit_limit).toBe(250000);
    const bad = await request(app).put(`/api/trading-clients/${created.body.id}`).set(auth(trader)).send({ credit_limit: -5 });
    expect(bad.status).toBe(400);
    const ok = await request(app).put(`/api/trading-clients/${created.body.id}`).set(auth(trader)).send({ credit_limit: 300000 });
    expect(ok.body.credit_limit).toBe(300000);
  });

  it('moves the pre-payment balance only with a reason, and never below zero', async () => {
    const noReason = await request(app).post(`/api/trading-clients/${buyerId}/prepayment`).set(auth(trader)).send({ amount: 100 });
    expect(noReason.status).toBe(400);
    const add = await request(app).post(`/api/trading-clients/${buyerId}/prepayment`).set(auth(trader)).send({ amount: 4000, reason: 'UTR 123' });
    expect(add.body.pre_payment_balance).toBe(10000);
    const tooMuch = await request(app).post(`/api/trading-clients/${buyerId}/prepayment`).set(auth(trader)).send({ amount: -20000, reason: 'refund' });
    expect(tooMuch.status).toBe(400);
  });
});

describe('RTM session clock', () => {
  const ist = (hh, mm, ss = 0) => new Date(Date.UTC(2026, 7, 20, hh, mm, ss) - 330 * 60000); // 20 Aug 2026 IST

  it('matches the figures on the vendor demo: 11:28:04 -> session 26, closes in 1m56s', () => {
    const s = rtmSessionAt(ist(11, 28, 4));
    expect(s).toMatchObject({ session_no: 26, delivery_from: '12:30', delivery_to: '13:00', delivery_date: '2026-08-20', seconds_left: 116 });
  });

  it('moves to the next session the second the gate closes', () => {
    expect(rtmSessionAt(ist(11, 29, 59)).session_no).toBe(26);
    expect(rtmSessionAt(ist(11, 30, 0)).session_no).toBe(27);
    expect(rtmSessionAt(ist(11, 30, 0)).seconds_left).toBe(1800);
  });

  it('rolls over midnight into session 1 of the next day', () => {
    // Session 1 (00:00) closes its gate at 23:00 the evening before.
    expect(rtmSessionAt(ist(22, 40))).toMatchObject({ session_no: 1, delivery_date: '2026-08-21', delivery_from: '00:00', seconds_left: 1200 });
    expect(rtmSessionAt(ist(23, 0))).toMatchObject({ session_no: 2, delivery_date: '2026-08-21', delivery_from: '00:30' });
  });

  it('honours a different gate lead and slot length', () => {
    // 10:30 would close its gate exactly now, so the open one is 10:45.
    const s = rtmSessionAt(ist(10, 0), { gateMinutes: 30, slotMinutes: 15 });
    expect(s).toMatchObject({ delivery_from: '10:45', delivery_to: '11:00', session_no: 44, seconds_left: 900 });
  });

  it('serves the session over the API', async () => {
    const res = await request(app).get('/api/bids/rtm-session').set(auth(trader));
    expect(res.status).toBe(200);
    expect(res.body.session_no).toBeGreaterThanOrEqual(1);
    expect(res.body.session_no).toBeLessThanOrEqual(48);
    expect(res.body.seconds_left).toBeGreaterThan(0);
  });
});

describe('day-ahead gate clock', () => {
  const ist = (hh, mm, ss = 0, day = 20) => new Date(Date.UTC(2026, 7, day, hh, mm, ss) - 330 * 60000);

  it('counts to today\'s gate for tomorrow\'s delivery before the gate', () => {
    expect(dayAheadGateAt(ist(9, 45), '12:00')).toMatchObject({ gate_time: '12:00', delivery_date: '2026-08-21', seconds_left: 8100 });
  });

  it('moves to tomorrow\'s gate once today\'s has passed', () => {
    expect(dayAheadGateAt(ist(12, 0), '12:00')).toMatchObject({ delivery_date: '2026-08-22', seconds_left: 86400 });
    expect(dayAheadGateAt(ist(15, 30), '12:00')).toMatchObject({ delivery_date: '2026-08-22' });
  });

  it('falls back to 12:00 when the setting is unreadable', () => {
    expect(dayAheadGateAt(ist(9, 0), 'noon').gate_time).toBe('12:00');
    expect(dayAheadGateAt(ist(9, 0), '25:00').gate_time).toBe('12:00');
  });

  it('serves DAM and GDAM, and has none for TAM', async () => {
    const ok = await request(app).get('/api/bids/gate-closure?product=DAM').set(auth(trader));
    expect(ok.status).toBe(200);
    expect(ok.body.gate_time).toMatch(/^\d\d:\d\d$/);
    expect((await request(app).get('/api/bids/gate-closure?product=GDAM').set(auth(trader))).status).toBe(200);
    expect((await request(app).get('/api/bids/gate-closure?product=TAM').set(auth(trader))).status).toBe(404);
  });
});

describe('bank receipts credit the pre-payment', () => {
  let vanClient;
  beforeEach(() => {
    db.prepare('DELETE FROM bank_transactions').run();
    vanClient = newId('TCL');
    db.prepare(`INSERT INTO trading_clients (id, name, client_type, status, exposure_limit, pre_payment_balance, virtual_account_no)
                VALUES (?, ?, 'DISCOM', 'ACTIVE', 1000000, 1000, ?)`).run(vanClient, `VAN client ${vanClient}`, `VAN${vanClient.slice(-6)}`);
  });
  const van = () => `VAN${vanClient.slice(-6)}`;
  const postReceipt = (body) => request(app).post('/api/trading/bank-transactions').set(auth(trader)).send(body);
  const balance = (id = vanClient) => db.prepare('SELECT pre_payment_balance AS b FROM trading_clients WHERE id = ?').get(id).b;

  it('credits the client named by the virtual account number', async () => {
    const res = await postReceipt({ utr_no: 'UTR-A1', van: van().toLowerCase(), amount: 2500.5, transaction_date: '2026-10-18' });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('APPLIED');
    expect(res.body.transaction).toMatchObject({ recon_status: 'MATCHED', client_id: vanClient });
    expect(balance()).toBe(3500.5);
  });

  it('credits once however many times the same UTR is sent', async () => {
    await postReceipt({ utr_no: 'UTR-B1', van: van(), amount: 100 });
    const again = await postReceipt({ utr_no: 'utr-b1', van: van(), amount: 100 });
    expect(again.status).toBe(409);
    expect(again.body.outcome).toBe('DUPLICATE');
    expect(balance()).toBe(1100);
  });

  it('keeps a receipt for an unknown account uncredited, then credits it when matched', async () => {
    const res = await postReceipt({ utr_no: 'UTR-C1', van: 'NOSUCHVAN', amount: 700 });
    expect(res.body.outcome).toBe('UNMATCHED');
    expect(res.body.transaction.recon_status).toBe('UNRECONCILED');
    expect(balance()).toBe(1000);
    const applied = await request(app).post(`/api/trading/bank-transactions/${res.body.transaction.id}/apply`).set(auth(trader)).send({ client_id: vanClient });
    expect(applied.status).toBe(200);
    expect(balance()).toBe(1700);
    const twice = await request(app).post(`/api/trading/bank-transactions/${res.body.transaction.id}/apply`).set(auth(trader)).send({ client_id: vanClient });
    expect(twice.status).toBe(400);
    expect(balance()).toBe(1700);
  });

  it('matches by exchange portfolio when no VAN is given', async () => {
    db.prepare("INSERT INTO client_exchange_portfolios (id, client_id, exchange, portfolio_id, portfolio_name) VALUES (?, ?, 'IEX', 'N1TEST0001', 'Test')").run(newId('CXP'), vanClient);
    const res = await postReceipt({ utr_no: 'UTR-D1', portfolio_id: 'n1test0001', amount: 50 });
    expect(res.body.outcome).toBe('APPLIED');
    expect(balance()).toBe(1050);
    db.prepare('DELETE FROM client_exchange_portfolios WHERE client_id = ?').run(vanClient);
  });

  it('reports each row of a pasted statement and rejects bad ones without stopping', async () => {
    const res = await postReceipt({ rows: [
      { utr_no: 'UTR-E1', van: van(), amount: 10 },
      { utr_no: 'UTR-E1', van: van(), amount: 10 },
      { utr_no: 'UTR-E2', van: van(), amount: -5 },
      { utr_no: 'UTR-E3', van: 'NOPE', amount: 20 },
    ] });
    expect(res.body.results.map((r) => r.outcome)).toEqual(['APPLIED', 'DUPLICATE', 'REJECTED', 'UNMATCHED']);
    expect(balance()).toBe(1010);
  });

  it('refuses a receipt with no UTR, no amount or nothing to match on', async () => {
    expect((await postReceipt({ van: van(), amount: 5 })).status).toBe(400);
    expect((await postReceipt({ utr_no: 'X', van: van(), amount: 0 })).status).toBe(400);
    expect((await postReceipt({ utr_no: 'Y', amount: 5 })).status).toBe(400);
  });

  it('makes a receipt count towards bid funds straight away', async () => {
    db.prepare('UPDATE trading_clients SET pre_payment_balance = 0, credit_limit = 0 WHERE id = ?').run(vanClient);
    const blocks = [{ time_block: 'Block-1', quantum_mw: 4, price_per_unit: 5 }];
    const refused = await post({ client_id: vanClient, exchange: 'IEX', product: 'DAM', type: 'Buy', bid_date: '2026-10-18', delivery_date: '2026-10-19', quantum_mw: 4, price_per_unit: 5, blocks });
    expect(refused.status).toBe(400);
    await postReceipt({ utr_no: 'UTR-F1', van: van(), amount: 6000 });
    const ok = await post({ client_id: vanClient, exchange: 'IEX', product: 'DAM', type: 'Buy', bid_date: '2026-10-18', delivery_date: '2026-10-19', quantum_mw: 4, price_per_unit: 5, blocks });
    expect(ok.status).toBe(201);
  });

  it('does not let one VAN be given to two clients', async () => {
    const dup = await request(app).post('/api/trading-clients').set(auth(trader))
      .send({ name: `Dup van ${Date.now()}`, client_type: 'DISCOM', virtual_account_no: van() });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/virtual account/i);
  });
});
