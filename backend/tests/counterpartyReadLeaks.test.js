import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { addAlias } from '../src/services/entityResolver.js';
import { newId } from '../src/util.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

// Three reads a seller or buyer login could make about data that is not its
// company's. KYC approval does not widen what a company may read: these are
// refused to an approved company as much as to a pending one.

const as = (u) => auth(signToken(u));
const get = (u, url) => request(app).get(url).set(as(u));
// A refusal shown to a counterparty names no other desk (the REIA beta never mentions one).
const neutral = (body) => expect(JSON.stringify(body)).not.toMatch(/trading|hydro|commercial|thermal/i);

let tag, sellerCo, buyerCo, otherCo, seller, sellerL3, buyer, reia;

beforeEach(() => {
  resetReia();
  // Names are unique per test: entities and aliases outlive resetReia, and a
  // name resolves to the first company that carries it.
  tag = Math.random().toString(36).slice(2, 8);
  sellerCo = makeEntity('SELLER', { name: `Leak Test Solar ${tag}` });
  buyerCo = makeEntity('BUYER', { name: `Leak Test Discom ${tag}` });
  otherCo = makeEntity('SELLER', { name: `Someone Else Wind ${tag}`, pan_no: 'AAACS9999Q' });
  seller = makeUser('SELLER', { linked_entity_id: sellerCo.id });
  sellerL3 = makeUser('SELLER_L3', { linked_entity_id: sellerCo.id });
  buyer = makeUser('BUYER', { linked_entity_id: buyerCo.id });
  reia = makeUser('REIA_MAKER');
});

describe('the trading client register', () => {
  let alpha, beta;
  const client = (name, overrides = {}) => {
    const id = newId('TCL');
    db.prepare(`INSERT INTO trading_clients (id, entity_id, name, client_type, status, exposure_limit, risk_rating)
      VALUES (?, ?, ?, 'DISCOM', 'ACTIVE', ?, ?)`).run(id, overrides.entity_id || null, name, overrides.exposure_limit ?? 5000000, overrides.risk_rating || 'HIGH');
    return id;
  };

  beforeEach(() => {
    db.prepare('DELETE FROM trading_clients WHERE name LIKE ?').run('Register Client%');
    alpha = client('Register Client Alpha');
    beta = client('Register Client Beta');
  });

  it('is refused to a seller and a buyer, list and record alike', async () => {
    for (const u of [seller, sellerL3, buyer]) {
      const list = await get(u, '/api/trading-clients?status=ACTIVE');
      expect(list.status, u.role).toBe(403);
      expect(JSON.stringify(list.body)).not.toContain('Register Client');
      neutral(list.body);
      const one = await get(u, `/api/trading-clients/${alpha}`);
      expect(one.status, u.role).toBe(403);
      expect(one.body.exposure_limit).toBeUndefined();
      neutral(one.body);
    }
  });

  it('still lists for the trading desk, and for the REIA desk that reconciles a client', async () => {
    for (const role of ['TRADING_USER', 'TRADING_ADMIN', 'FINANCE_USER', 'MANAGEMENT', 'SJVN_ADMIN', 'REIA_MAKER', 'REIA_CHECKER']) {
      const res = await get(makeUser(role), '/api/trading-clients?status=ACTIVE');
      expect(res.status, role).toBe(200);
      expect(res.body.map((c) => c.id), role).toEqual(expect.arrayContaining([alpha, beta]));
    }
    const one = await get(makeUser('TRADING_USER'), `/api/trading-clients/${beta}`);
    expect(one.status).toBe(200);
    expect(one.body.name).toBe('Register Client Beta');
  });

  it('shows a trading client its own row only', async () => {
    const own = makeUser('TRADING_CLIENT', { linked_entity_id: alpha });
    const list = await get(own, '/api/trading-clients');
    expect(list.status).toBe(200);
    expect(list.body.map((c) => c.id)).toEqual([alpha]);
    expect((await get(own, `/api/trading-clients/${alpha}`)).status).toBe(200);
    expect((await get(own, `/api/trading-clients/${beta}`)).status).toBe(404);

    const unlinked = makeUser('TRADING_CLIENT_MAKER');
    expect((await get(unlinked, '/api/trading-clients')).body).toEqual([]);
  });
});

describe('the notification board of a seller or buyer with no company yet', () => {
  let contract;

  beforeEach(() => {
    for (const t of ['board_acknowledgements', 'board_alert_episodes', 'board_preferences', 'broadcast_messages']) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    // SJVN's own board has an overdue bill on it.
    contract = makeContract({ seller_id: otherCo.id });
    makeInvoice({ contract_id: contract.id, status: 'SENT', due_date: '2020-01-01' });
    db.prepare(`INSERT INTO broadcast_messages (id, title, message, severity, audience) VALUES ('BRD-LEAK-1', 'Portal maintenance', 'Sunday 2 am', 'INFO', 'ALL')`).run();
  });

  it('carries no contract alerts — SJVN\'s board is not its board — only the messages', async () => {
    expect((await get(reia, '/api/alerts/board')).body.alerts.some((a) => a.id === 'overdue-payments')).toBe(true);

    for (const u of [makeUser('SELLER'), makeUser('SELLER_L2'), makeUser('BUYER'), makeUser('BUYER_L1')]) {
      const res = await get(u, '/api/alerts/board');
      expect(res.status, u.role).toBe(200);
      expect(res.body.alerts, u.role).toEqual([]);
      expect(res.body.summary.total_items, u.role).toBe(0);
      expect(res.body.broadcasts.map((b) => b.id), u.role).toEqual(['BRD-LEAK-1']);
    }
  });

  it('keeps SJVN\'s alerts out of its history, including ones logged under it before', async () => {
    db.prepare(`INSERT INTO board_alert_episodes (id, scope_key, alert_key, category, grp, severity, title, detail, peak_count, last_count)
      VALUES ('BAE-LEAK-1', 'SELLER:UNLINKED', 'overdue-payments', 'Billing', 'BILLING', 'CRITICAL', 'Overdue payments', '1 bill, ₹30,00,000', 1, 1)`).run();
    const unlinked = makeUser('SELLER');
    await get(unlinked, '/api/alerts/board');
    const history = await get(unlinked, '/api/alerts/history');
    expect(history.status).toBe(200);
    expect(history.body.items.filter((i) => i.kind === 'ALERT')).toEqual([]);
    expect(history.body.items.map((i) => i.id)).toEqual(['BRD-LEAK-1']);
  });

  it('a company\'s own login still sees its own contract\'s alert', async () => {
    const mine = makeContract({ seller_id: sellerCo.id });
    makeInvoice({ contract_id: mine.id, direction: 'SELLER_TO_SJVN', status: 'SENT', due_date: '2020-01-01' });
    const board = (await get(seller, '/api/alerts/board')).body;
    expect(board.alerts.find((a) => a.id === 'overdue-payments')?.count).toBe(1);
  });
});

describe('entity name resolution and aliases', () => {
  beforeEach(() => {
    addAlias(otherCo.id, `SEWE ${tag} Ltd`);
    addAlias(sellerCo.id, `LTSP ${tag} Ltd`);
  });

  it('do not tell a seller or buyer about another company, PAN included', async () => {
    for (const u of [seller, sellerL3, buyer]) {
      const resolved = await get(u, `/api/entities/resolve?name=${encodeURIComponent(otherCo.name)}`);
      expect(resolved.status, u.role).toBe(200);
      expect(resolved.body, u.role).toEqual({ resolved: false, entity: null });
      expect(JSON.stringify(resolved.body)).not.toContain('AAACS9999Q');

      const aliases = await get(u, `/api/entities/${otherCo.id}/aliases`);
      expect(aliases.status, u.role).toBe(404);
      expect(JSON.stringify(aliases.body)).not.toContain(`SEWE ${tag}`);
      neutral(aliases.body);
    }
  });

  it('answer a company about itself', async () => {
    const resolved = await get(seller, `/api/entities/resolve?name=${encodeURIComponent(`LTSP ${tag} Ltd`)}`);
    expect(resolved.body).toMatchObject({ resolved: true, entity: { id: sellerCo.id } });
    const aliases = await get(sellerL3, `/api/entities/${sellerCo.id}/aliases`);
    expect(aliases.status).toBe(200);
    expect(aliases.body.map((a) => a.alias_name)).toContain(`LTSP ${tag} Ltd`);
  });

  it('answer the SJVN desk about anyone', async () => {
    const resolved = await get(reia, `/api/entities/resolve?name=${encodeURIComponent(`SEWE ${tag} Ltd`)}`);
    expect(resolved.body).toMatchObject({ resolved: true, entity: { id: otherCo.id, pan_no: 'AAACS9999Q' } });
    const aliases = await get(reia, `/api/entities/${otherCo.id}/aliases`);
    expect(aliases.status).toBe(200);
    expect(aliases.body.map((a) => a.alias_name)).toContain(`SEWE ${tag} Ltd`);
  });
});
