import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';

// The NOC Updation screen writes a standing clearance and the blocks it clears.

let trader, viewer;

const HEADER = {
  client_name: 'Himachal Sorang Power Pvt. Ltd.',
  client_id: 'CL-SORANG',
  noar_id: 'NOAR-99120',
  issuing_authority: 'NRLDC',
  noc_reference_no: 'NRLDC/NOC/2026/4412',
  noc_valid_from: '2026-09-01',
  noc_valid_to: '2026-09-30',
};

const LINE = {
  direction: 'INJECTION', energy_source: 'CONVENTIONAL',
  valid_from: '2026-09-01', valid_to: '2026-09-30',
  hour_from: '00:00', hour_to: '06:00', quantum_mw: 50,
};

beforeEach(() => {
  db.prepare('DELETE FROM noc_updation_orders').run();
  db.prepare('DELETE FROM noc_updations').run();
  trader = tokenFor('TRADING_USER');
  viewer = tokenFor('MANAGEMENT');
});

const create = (body) => request(app).post('/api/noc-updation').set(auth(trader)).send(body);

describe('NOC Updation', () => {
  it('stores the clearance with its order lines', async () => {
    const res = await create({ ...HEADER, orders: [LINE] });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].quantum_mw).toBe(50);

    const list = await request(app).get('/api/noc-updation').set(auth(viewer));
    expect(list.status).toBe(200);
    expect(list.body[0].order_count).toBe(1);
    expect(list.body[0].total_quantum_mw).toBe(50);
  });

  it('refuses a clearance with no order lines', async () => {
    const res = await create({ ...HEADER, orders: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one order line/i);
  });

  it('refuses a line that runs outside the NOC validity', async () => {
    const res = await create({ ...HEADER, orders: [{ ...LINE, valid_to: '2026-10-15' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inside the NOC validity/i);
  });

  it('refuses a block whose To hour is not after its From hour', async () => {
    const res = await create({ ...HEADER, orders: [{ ...LINE, hour_to: '00:00' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/To hour must be after/i);
  });

  it('keeps a cancelled clearance and its lines on the register', async () => {
    const { body } = await create({ ...HEADER, orders: [LINE] });
    const res = await request(app).patch(`/api/noc-updation/${body.id}/cancel`).set(auth(trader)).send({ reason: 'superseded' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    const detail = await request(app).get(`/api/noc-updation/${body.id}`).set(auth(viewer));
    expect(detail.body.orders).toHaveLength(1);
  });

  it('will not let a read-only role write one', async () => {
    const res = await request(app).post('/api/noc-updation').set(auth(viewer)).send({ ...HEADER, orders: [LINE] });
    expect(res.status).toBe(403);
  });
});
