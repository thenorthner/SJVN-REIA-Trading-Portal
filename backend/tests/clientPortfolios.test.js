import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';

// Update Portfolio ID: the portfolio each exchange assigned a trading client.

let trader, viewer, ndmc, gacl;

beforeEach(() => {
  db.prepare('DELETE FROM client_exchange_portfolios').run();
  ndmc = newId('TCL');
  gacl = newId('TCL');
  const ins = db.prepare(`INSERT INTO trading_clients (id, name, client_type, status) VALUES (?, ?, 'DISCOM', 'ACTIVE')`);
  ins.run(ndmc, 'New Delhi Municipal Council');
  ins.run(gacl, 'Gujarat Alkalies & Chemicals Ltd');
  trader = tokenFor('TRADING_USER');
  viewer = tokenFor('MANAGEMENT');
});

const save = (body, who = trader) => request(app).put('/api/client-portfolios').set(auth(who)).send(body);
const mapping = (over = {}) => ({
  client_id: ndmc, exchange: 'IEX', portfolio_id: 'N1DL0NDM0001', portfolio_name: 'NDMC — IEX', ...over,
});

describe('Update Portfolio ID', () => {
  it('saves a mapping and reads it back with the client name', async () => {
    const r = await save(mapping());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ client_id: ndmc, exchange: 'IEX', portfolio_id: 'N1DL0NDM0001', client_name: 'New Delhi Municipal Council' });

    const list = await request(app).get('/api/client-portfolios').query({ client_id: ndmc }).set(auth(viewer));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].portfolio_name).toBe('NDMC — IEX');
  });

  it('replaces the portfolio on a second save rather than adding another', async () => {
    await save(mapping());
    const r = await save(mapping({ portfolio_id: 'N1DL0NDM0002', portfolio_name: 'NDMC — renumbered' }));
    expect(r.status).toBe(200);
    expect(r.body.portfolio_id).toBe('N1DL0NDM0002');
    expect(db.prepare('SELECT COUNT(*) AS n FROM client_exchange_portfolios WHERE client_id = ?').get(ndmc).n).toBe(1);
  });

  it('keeps one portfolio per client on each exchange', async () => {
    await save(mapping());
    const pxil = await save(mapping({ exchange: 'PXIL', portfolio_id: 'PX-NDMC-01' }));
    expect(pxil.status).toBe(201);
    expect(db.prepare('SELECT COUNT(*) AS n FROM client_exchange_portfolios WHERE client_id = ?').get(ndmc).n).toBe(2);
  });

  it('refuses a portfolio another client already holds on that exchange, whatever the case', async () => {
    await save(mapping());
    const r = await save(mapping({ client_id: gacl, portfolio_id: 'n1dl0ndm0001' }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/New Delhi Municipal Council/);
  });

  it('lets the same code stand on a different exchange', async () => {
    await save(mapping({ portfolio_id: 'SHARED01' }));
    const r = await save(mapping({ client_id: gacl, exchange: 'PXIL', portfolio_id: 'SHARED01' }));
    expect(r.status).toBe(201);
  });

  it('refuses what it cannot store', async () => {
    expect((await save(mapping({ exchange: 'NSE' }))).status).toBe(400);
    expect((await save(mapping({ portfolio_id: 'a b' }))).status).toBe(400);
    expect((await save(mapping({ portfolio_id: '' }))).status).toBe(400);
    expect((await save(mapping({ portfolio_name: '  ' }))).status).toBe(400);
    expect((await save(mapping({ client_id: 'TCL-NOPE' }))).status).toBe(404);
  });

  it('lets management read the mappings but not change them', async () => {
    expect((await save(mapping(), viewer)).status).toBe(403);
    expect((await request(app).get('/api/client-portfolios').set(auth(viewer))).status).toBe(200);
  });

  it('records each change in the audit trail', async () => {
    await save(mapping());
    await save(mapping({ portfolio_id: 'N1DL0NDM0002' }));
    const actions = db.prepare(`SELECT action FROM audit_logs WHERE entity_type = 'client_exchange_portfolio' ORDER BY rowid`).all().map((r) => r.action);
    expect(actions.slice(-2)).toEqual(['CREATE_PORTFOLIO_ID', 'UPDATE_PORTFOLIO_ID']);
  });
});
