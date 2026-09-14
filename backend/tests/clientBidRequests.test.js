import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth, makeEntity } from './helpers/reia.js';

// A trading client asking the desk for a bid, with its own maker and checker.
//
// The portal could only read, so a client that wanted power bought asked by phone
// and nothing recorded who asked, who in the client's office agreed, or what the
// desk did. A request is raised by the client's maker, cleared by its checker —
// never the same person — and only then is it the desk's to act on.

let clientA, clientB, entityA, t;

const mkClient = (name, entityId = null) => {
  const id = newId('TCL');
  db.prepare('INSERT INTO trading_clients (id, entity_id, name, client_type, status) VALUES (?, ?, ?, ?, ?)')
    .run(id, entityId, name, 'DISCOM', 'ACTIVE');
  return id;
};

const REQUEST = {
  side: 'BUY', exchange: 'IEX', product: 'DAM',
  delivery_date: '2026-09-20', quantum_mw: 50, price_limit_per_unit: 4.5,
  notes: 'Cover the evening peak',
};

beforeEach(() => {
  for (const table of ['client_bid_requests', 'bids', 'trading_clients']) {
    try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* table may not exist */ }
  }
  entityA = makeEntity('BUYER', { name: 'Client A Ltd' });
  clientA = mkClient('Client A', entityA.id);
  clientB = mkClient('Client B');

  t = {
    maker: tokenFor('TRADING_CLIENT_MAKER', { linked_entity_id: clientA, name: 'A Maker' }),
    checker: tokenFor('TRADING_CLIENT_CHECKER', { linked_entity_id: clientA, name: 'A Checker' }),
    viewer: tokenFor('TRADING_CLIENT', { linked_entity_id: clientA }),
    // The same person holding both roles, to prove four eyes is enforced by
    // identity and not merely by role.
    otherClientMaker: tokenFor('TRADING_CLIENT_MAKER', { linked_entity_id: clientB }),
    otherClientChecker: tokenFor('TRADING_CLIENT_CHECKER', { linked_entity_id: clientB }),
    unlinked: tokenFor('TRADING_CLIENT_MAKER'),
    desk: tokenFor('TRADING_USER'),
    seller: tokenFor('SELLER'),
  };
});

const get = (path, who) => request(app).get(path).set(auth(who));
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);
const raise = (who = t.maker, body = REQUEST) => post('/api/client-bid-requests', who, body);

describe('a client raises a bid request', () => {
  it('lets the maker raise one, pending its own checker', async () => {
    const r = await raise();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      client_id: clientA, client_name: 'Client A', side: 'BUY', exchange: 'IEX',
      quantum_mw: 50, status: 'PENDING_CHECK', raised_by_name: 'A Maker',
    });
    expect(r.body.checked_at).toBeNull();
  });

  it('refuses the read-only login and the desk', async () => {
    expect((await raise(t.viewer)).status).toBe(403);
    // The desk does not raise requests to itself.
    expect((await raise(t.desk)).status).toBe(403);
    expect((await raise(t.seller)).status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) n FROM client_bid_requests').get().n).toBe(0);
  });

  it('tells an unlinked login what is wrong instead of writing a stray request', async () => {
    const r = await raise(t.unlinked);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not linked to a trading client/i);
  });

  it('checks what it was given', async () => {
    const bad = await raise(t.maker, { ...REQUEST, side: 'HOLD', exchange: 'NSE', quantum_mw: 0, delivery_date: '20-09-2026' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual(expect.arrayContaining([
      'side must be BUY or SELL',
      'exchange must be one of IEX/PXIL/HPX',
      'delivery_date must be YYYY-MM-DD',
      'quantum_mw must be a positive number',
    ]));
  });
});

describe('the client’s checker clears it', () => {
  it('approves a request raised by someone else', async () => {
    const { body } = await raise();
    const r = await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'APPROVE', remarks: 'Agreed' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'APPROVED', checked_by_name: 'A Checker', check_remarks: 'Agreed' });
    expect(r.body.checked_at).toBeTruthy();
  });

  it('will not let the person who raised it clear it', async () => {
    // One login holding both roles is still one pair of eyes: this maker token and
    // this checker token are the same user id.
    const user = db.prepare("SELECT id FROM users WHERE name = 'A Maker'").get();
    const bothHats = tokenFor('TRADING_CLIENT_CHECKER', { id: `${user.id}-x`, linked_entity_id: clientA, name: 'A Maker' });
    const { body } = await raise();
    db.prepare('UPDATE client_bid_requests SET raised_by = ? WHERE id = ?')
      .run(`${user.id}-x`, body.id);

    const r = await post(`/api/client-bid-requests/${body.id}/check`, bothHats, { decision: 'APPROVE' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/cannot be cleared by the person who raised it/i);
    expect(db.prepare('SELECT status FROM client_bid_requests WHERE id = ?').get(body.id).status).toBe('PENDING_CHECK');
  });

  it('wants a reason when it sends one back', async () => {
    const { body } = await raise();
    const bare = await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'REJECT' });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toMatch(/remarks are required/i);

    const r = await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'REJECT', remarks: 'Price cap too low' });
    expect(r.body).toMatchObject({ status: 'REJECTED', check_remarks: 'Price cap too low' });
  });

  it('clears a request once, not twice', async () => {
    const { body } = await raise();
    await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'APPROVE' });
    const again = await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'REJECT', remarks: 'changed my mind' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/is APPROVED/);
  });

  it('is not something the maker or the desk can do', async () => {
    const { body } = await raise();
    expect((await post(`/api/client-bid-requests/${body.id}/check`, t.maker, { decision: 'APPROVE' })).status).toBe(403);
    expect((await post(`/api/client-bid-requests/${body.id}/check`, t.desk, { decision: 'APPROVE' })).status).toBe(403);
  });

  it("cannot reach into another client's request", async () => {
    const { body } = await raise();
    expect((await post(`/api/client-bid-requests/${body.id}/check`, t.otherClientChecker, { decision: 'APPROVE' })).status).toBe(404);
    expect((await get(`/api/client-bid-requests/${body.id}`, t.otherClientMaker)).status).toBe(404);
  });
});

describe('what each side sees', () => {
  it('shows a client only its own requests, and the desk every one', async () => {
    await raise();
    await raise(t.otherClientMaker, { ...REQUEST, quantum_mw: 999 });

    const mine = await get('/api/client-bid-requests', t.viewer);
    expect(mine.body.map((r) => r.client_id)).toEqual([clientA]);

    const theirs = await get('/api/client-bid-requests', t.otherClientMaker);
    expect(theirs.body.map((r) => r.client_id)).toEqual([clientB]);

    const desk = await get('/api/client-bid-requests', t.desk);
    expect(desk.body).toHaveLength(2);
    expect((await get('/api/client-bid-requests', t.seller)).status).toBe(403);
  });

  it('filters by status and by delivery date for the desk', async () => {
    const a = await raise();
    await post(`/api/client-bid-requests/${a.body.id}/check`, t.checker, { decision: 'APPROVE' });
    await raise(t.maker, { ...REQUEST, delivery_date: '2026-10-05' });

    const approved = await get('/api/client-bid-requests?status=APPROVED', t.desk);
    expect(approved.body.map((r) => r.id)).toEqual([a.body.id]);
    const october = await get('/api/client-bid-requests?from=2026-10-01', t.desk);
    expect(october.body).toHaveLength(1);
  });

  it('ignores a client_id from a client trying to read another account', async () => {
    await raise(t.otherClientMaker);
    const r = await get(`/api/client-bid-requests?client_id=${clientB}`, t.viewer);
    expect(r.body).toEqual([]);
  });
});

describe('the desk acts on an approved request', () => {
  const mkBid = (clientId) => {
    const id = newId('BID');
    db.prepare(`
      INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, status)
      VALUES (?, ?, 'IEX', 'DAM', '2026-09-19', '2026-09-20', 50, 4.4, 'SUBMITTED')
    `).run(id, clientId);
    return id;
  };

  it('records the bid it placed against the request', async () => {
    const { body } = await raise();
    await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'APPROVE' });
    const bidId = mkBid(clientA);

    const r = await post(`/api/client-bid-requests/${body.id}/place`, t.desk, { bid_id: bidId });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'PLACED', bid_id: bidId, bid_status: 'SUBMITTED' });
    // The client can now see what was done about its request.
    const seen = await get(`/api/client-bid-requests/${body.id}`, t.viewer);
    expect(seen.body).toMatchObject({ status: 'PLACED', bid_id: bidId });
  });

  it('will not act on a request its checker has not cleared', async () => {
    const { body } = await raise();
    const bidId = mkBid(clientA);
    const r = await post(`/api/client-bid-requests/${body.id}/place`, t.desk, { bid_id: bidId });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/is PENDING_CHECK/);
  });

  it("will not close a request against another client's bid", async () => {
    const { body } = await raise();
    await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'APPROVE' });
    const r = await post(`/api/client-bid-requests/${body.id}/place`, t.desk, { bid_id: mkBid(clientB) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/belongs to another client/i);
  });

  it('is the desk’s to do, not the client’s', async () => {
    const { body } = await raise();
    await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'APPROVE' });
    const bidId = mkBid(clientA);
    for (const who of ['maker', 'checker', 'viewer']) {
      expect((await post(`/api/client-bid-requests/${body.id}/place`, t[who], { bid_id: bidId })).status).toBe(403);
    }
  });
});

describe('withdrawing a request', () => {
  it('lets the client take back what the desk has not acted on', async () => {
    const { body } = await raise();
    const r = await post(`/api/client-bid-requests/${body.id}/withdraw`, t.maker, { reason: 'No longer needed' });
    expect(r.body.status).toBe('WITHDRAWN');
  });

  it('will not take back a bid the desk has already placed', async () => {
    const { body } = await raise();
    await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'APPROVE' });
    const bidId = newId('BID');
    db.prepare(`
      INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, status)
      VALUES (?, ?, 'IEX', 'DAM', '2026-09-19', '2026-09-20', 50, 4.4, 'SUBMITTED')
    `).run(bidId, clientA);
    await post(`/api/client-bid-requests/${body.id}/place`, t.desk, { bid_id: bidId });

    const r = await post(`/api/client-bid-requests/${body.id}/withdraw`, t.maker);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already placed a bid/i);
  });
});

describe('the trail', () => {
  it('records who raised it, who cleared it and what the desk did', async () => {
    const { body } = await raise();
    await post(`/api/client-bid-requests/${body.id}/check`, t.checker, { decision: 'APPROVE', remarks: 'Agreed' });
    const actions = db.prepare(`
      SELECT action, user_name FROM audit_logs
      WHERE entity_type = 'client_bid_request' AND entity_id = ? ORDER BY rowid
    `).all(body.id);
    expect(actions.map((a) => a.action)).toEqual(['RAISE_CLIENT_BID_REQUEST', 'APPROVE_CLIENT_BID_REQUEST']);
    expect(actions.map((a) => a.user_name)).toEqual(['A Maker', 'A Checker']);
  });
});
