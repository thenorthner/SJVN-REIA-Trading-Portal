import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

let reia, trading;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  trading = tokenFor('TRADING_USER');
});

const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const instrument = (contractId, { type = 'LC', amount = 1000000, drawn = 0, priority = 10 } = {}) => {
  const id = `PSC-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, is_revolving,
              limit_amount, utilized_amount, available_amount, waterfall_priority, issuing_bank,
              validity_start, validity_end, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SBI', ?, ?, 'ACTIVE')`)
    .run(id, `PS/G/${id.slice(-5)}`, contractId, type, type === 'LC' ? 1 : 0,
         amount, drawn, amount - drawn, priority, day(-30), day(365));
  return id;
};

describe('S25 Invoking an instrument draws on the side it answers for', () => {
  // The waterfall takes a side and this route never passed one, so it always ran
  // the buyer's. Invoking a bank guarantee — which only ever answers for the
  // seller — drew nothing and still filed a demand notice for the attempt.
  let contract, bg, lc;
  beforeEach(() => {
    contract = makeContract({ status: 'ACTIVE' });
    bg = instrument(contract.id, { type: 'BANK_GUARANTEE', amount: 500000, priority: 20 });
    lc = instrument(contract.id, { type: 'LC', amount: 800000, priority: 10 });
  });
  const invoke = (id, body = {}) =>
    request(app).post(`/api/payment-security/${id}/invoke`).set(auth(reia)).send({ amount: 300000, ...body });
  const usedOn = (id) => db.prepare('SELECT utilized_amount FROM payment_security WHERE id = ?').get(id).utilized_amount;

  it('draws the guarantee when the guarantee is invoked', async () => {
    const r = await invoke(bg);
    expect(r.status, 'invoking a guarantee drew nothing').toBeLessThan(400);
    expect(usedOn(bg)).toBe(300000);
    expect(usedOn(lc), "the buyer's letter of credit was drawn for a seller default").toBe(0);
  });

  it('draws the letter of credit when that is invoked', async () => {
    const r = await invoke(lc);
    expect(r.status).toBeLessThan(400);
    expect(usedOn(lc)).toBe(300000);
    expect(usedOn(bg)).toBe(0);
  });

  it('asks which default when the instrument answers for either', async () => {
    const pooled = instrument(contract.id, { type: 'CORPUS_FUND', amount: 400000, priority: 40 });
    const r = await invoke(pooled);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/BUYER or SELLER/);
  });

  it('takes the side when it is given', async () => {
    const pooled = instrument(contract.id, { type: 'CORPUS_FUND', amount: 400000, priority: 40 });
    const r = await invoke(pooled, { side: 'SELLER' });
    expect(r.status).toBeLessThan(400);
  });

  it('files no demand notice when nothing could be drawn', async () => {
    // A guarantee on a contract that has none: the old behaviour recorded a
    // NOTICE_ISSUED for an attempt that moved no money.
    const bare = makeContract({ status: 'ACTIVE' });
    const lonely = instrument(bare.id, { type: 'BANK_GUARANTEE', amount: 100000 });
    db.prepare('UPDATE payment_security SET utilized_amount = 100000, available_amount = 0 WHERE id = ?').run(lonely);
    const before = db.prepare('SELECT COUNT(*) c FROM security_invocations').get().c;
    const r = await invoke(lonely);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no demand notice/i);
    expect(db.prepare('SELECT COUNT(*) c FROM security_invocations').get().c,
      'a demand notice was filed for something that never happened').toBe(before);
  });

  it('records which instruments it actually drew', async () => {
    await invoke(bg);
    const a = db.prepare(`SELECT * FROM audit_logs WHERE action = 'INVOKE' ORDER BY rowid DESC`).get();
    expect(String(a.details)).toMatch(/SELLER/);
    expect(String(a.details)).toMatch(/instrument_no/);
  });
});

describe('S25 Drawing on security records what was left standing', () => {
  it('carries the position before and after', async () => {
    const c = makeContract({ status: 'ACTIVE' });
    const id = instrument(c.id, { amount: 1000000 });
    await request(app).post(`/api/payment-security/${id}/utilize`).set(auth(reia))
      .send({ amount: 300000, reason: 'Buyer default on 2026-06' });
    const e = db.prepare(`SELECT * FROM security_events WHERE payment_security_id = ? AND event_type = 'UTILIZE'`).get(id);
    const d = JSON.parse(e.details);
    expect(d.available_before, 'the event said how much was drawn but not what remained').toBe(1000000);
    expect(d.available_after).toBe(700000);
    expect(d.reason).toMatch(/Buyer default/);
  });
});

describe('S25 New exposure is not taken on against inadequate security', () => {
  // Adequacy was computed, reported, and consulted by nothing — a bid could be
  // placed for a buyer whose cover stood at a fraction of what it already owed.
  let entity, client, contract;
  beforeEach(() => {
    entity = makeEntity('BUYER');
    contract = makeContract({ contract_type: 'PSA', status: 'ACTIVE', buyer_id: entity.id,
      capacity_mw: 20, tariff_per_unit: 3.5 });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 10000000 });
    const id = `TCL-${Math.random().toString(36).slice(2, 9)}`;
    db.prepare(`INSERT INTO trading_clients (id, entity_id, name, client_type, exposure_limit, status)
                VALUES (?, ?, 'Weak Buyer', 'DISCOM', 500000000, 'ACTIVE')`).run(id, entity.id);
    client = id;
  });

  const bid = (over = {}) => request(app).post('/api/bids').set(auth(trading)).send({
    client_id: client, exchange: 'IEX', product: 'DAM', bid_type: 'BUY',
    bid_date: day(0), delivery_date: day(1), quantum_mw: 100, price_per_unit: 4.0,
    blocks: [{ time_block: 1, quantum_mw: 100, price_per_unit: 4.0 }], ...over,
  });

  it('refuses a bid for a buyer whose cover falls short', async () => {
    const r = await bid();
    expect(r.status, 'exposure was taken on against a buyer with no adequate security').toBe(400);
    expect(r.body.error).toMatch(/payment security/i);
    expect(r.body.adequacy).toBeTruthy();
  });

  it('allows it when someone owns that decision', async () => {
    const r = await bid({ security_override_reason: 'Cleared by CFO pending LC amendment 14 Aug' });
    expect(r.status, 'the override did not work').toBeLessThan(400);
  });

  it('leaves a properly secured buyer alone', async () => {
    instrument(contract.id, { type: 'LC', amount: 500000000 });
    const r = await bid();
    expect(r.status, 'a well-secured buyer was blocked').toBeLessThan(400);
  });

  it('names every missing field at once instead of crashing on each', async () => {
    const r = await bid({ product: undefined, bid_date: undefined, quantum_mw: undefined });
    expect(r.status, 'a missing NOT NULL column came back as a 500').toBe(400);
    expect(r.body.missing_fields).toEqual(expect.arrayContaining(['product', 'bid_date', 'quantum_mw']));
  });

  it('catches a block missing its time slot', async () => {
    const r = await bid({ blocks: [{ quantum_mw: 100, price_per_unit: 4.0 }] });
    expect(r.status).toBe(400);
    expect(r.body.missing_fields).toContain('blocks[].time_block');
  });
});

describe('S25 The portfolio says what kind of security it holds', () => {
  it('breaks the total down by instrument', async () => {
    const c = makeContract({ contract_type: 'PSA', status: 'ACTIVE' });
    instrument(c.id, { type: 'LC', amount: 3000000 });
    instrument(c.id, { type: 'BANK_GUARANTEE', amount: 2000000 });
    instrument(c.id, { type: 'CORPUS_FUND', amount: 1000000 });
    const r = await request(app).get('/api/payment-security/stats').set(auth(reia));
    expect(r.status).toBe(200);
    const byType = Object.fromEntries((r.body.security_by_type || []).map((x) => [x.mechanism_type, x]));
    expect(byType.LC, 'a letter of credit and a guarantee were added into one figure').toBeTruthy();
    expect(byType.LC.available).toBe(3000000);
    expect(byType.BANK_GUARANTEE.available).toBe(2000000);
    expect(byType.CORPUS_FUND.available).toBe(1000000);
    expect(byType.LC.count).toBe(1);
  });
});
