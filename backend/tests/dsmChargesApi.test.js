import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth } from './helpers/reia.js';
import { seedDsmSlabs } from '../src/services/dsmCharges.js';

// The slab register the desk maintains, and the block-actuals path that prices
// a deviation off it.

const DATE = '2026-09-01';
let trader, viewer, TX;

beforeEach(() => {
  // Blocks reference the slab that priced them, so they go first.
  db.prepare('DELETE FROM bilateral_schedules').run();
  db.prepare('DELETE FROM dsm_charge_slabs').run();
  seedDsmSlabs();
  trader = tokenFor('TRADING_USER');
  viewer = tokenFor('MANAGEMENT');

  TX = newId('BLT');
  db.prepare(`INSERT INTO bilateral_transactions
    (id, counterparty, transaction_type, oa_type, start_date, end_date, quantum_mw, tariff_per_unit)
    VALUES (?, 'NTPCREL', 'PURCHASE', 'STOA', ?, ?, 100, 3.5)`).run(TX, DATE, DATE);
});

function addBlock(approved = 100) {
  const id = newId('SCH');
  db.prepare(`INSERT INTO bilateral_schedules
    (id, transaction_id, schedule_date, time_block, approved_mw, curtailed_mw, status)
    VALUES (?, ?, ?, '00:00-00:15', ?, 0, 'APPROVED')`).run(id, TX, DATE, approved);
  return id;
}

async function verifyBand(slabName, chargeValue) {
  const slab = db.prepare('SELECT id FROM dsm_charge_slabs WHERE slab_name = ?').get(slabName);
  return request(app).patch(`/api/masters/dsm/slabs/${slab.id}`).set(auth(trader))
    .send({ charge_value: chargeValue, is_verified: 1 });
}

describe('slab register', () => {
  it('lists the seeded bands', async () => {
    const r = await request(app).get('/api/masters/dsm/slabs').set(auth(viewer));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(6);
  });

  it('reports which bands still have no notified rate', async () => {
    const before = await request(app).get('/api/masters/dsm/readiness').set(auth(viewer));
    expect(before.body).toMatchObject({ slabs: 6, verified: 0, unverified: 6, can_price: false });

    await verifyBand('Under-injection, frequency below normal band', 550);
    const after = await request(app).get('/api/masters/dsm/readiness').set(auth(viewer));
    expect(after.body).toMatchObject({ verified: 1, unverified: 5, can_price: true });
    expect(after.body.pending).toHaveLength(5);
  });

  it('refuses to mark a slab verified while it has no rate', async () => {
    const slab = db.prepare(`SELECT id FROM dsm_charge_slabs WHERE deviation_side = 'UNDER' LIMIT 1`).get();
    const r = await request(app).patch(`/api/masters/dsm/slabs/${slab.id}`).set(auth(trader)).send({ is_verified: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/without a charge_value/);
  });

  it('rejects an inverted or incomplete band on create', async () => {
    const base = { slab_name: 'x', deviation_side: 'UNDER', charge_basis: 'FLAT', effective_from: DATE };
    const inverted = await request(app).post('/api/masters/dsm/slabs').set(auth(trader))
      .send({ ...base, freq_from_hz: 50.0, freq_to_hz: 49.5 });
    expect(inverted.status).toBe(400);

    const noReference = await request(app).post('/api/masters/dsm/slabs').set(auth(trader))
      .send({ ...base, charge_basis: 'PCT_OF_REFERENCE', charge_value: 120 });
    expect(noReference.status).toBe(400);
    expect(noReference.body.error).toMatch(/reference_price_key/);
  });

  it('keeps the register read-only for a non-trading role', async () => {
    const r = await request(app).post('/api/masters/dsm/slabs').set(auth(viewer))
      .send({ slab_name: 'x', deviation_side: 'UNDER', charge_basis: 'FLAT', effective_from: DATE });
    expect(r.status).toBe(403);
  });

  it('answers which slab prices a frequency', async () => {
    const hit = await request(app).get('/api/masters/dsm/slabs/effective')
      .query({ side: 'UNDER', frequency_hz: 49.9, date: DATE }).set(auth(viewer));
    expect(hit.body.slab_name).toMatch(/below normal band/);

    const miss = await request(app).get('/api/masters/dsm/slabs/effective')
      .query({ side: 'UNDER', frequency_hz: 49.9, date: '2022-01-01' }).set(auth(viewer));
    expect(miss.status).toBe(404);
  });
});

describe('preview', () => {
  it('prices a deviation without recording it', async () => {
    await verifyBand('Under-injection, frequency below normal band', 550);
    const r = await request(app).post('/api/masters/dsm/preview').set(auth(viewer))
      .send({ deviation_mw: -20, frequency_hz: 49.9, date: DATE });
    expect(r.body).toMatchObject({ amount: 27500, basis: 'CERC_SLAB', deviation_side: 'UNDER' });
    expect(db.prepare('SELECT COUNT(*) c FROM bilateral_schedules').get().c).toBe(0);
  });

  it('explains an unpriceable deviation', async () => {
    const r = await request(app).post('/api/masters/dsm/preview').set(auth(viewer))
      .send({ deviation_mw: -20, date: DATE });
    expect(r.body).toMatchObject({ amount: 0, basis: 'NO_FREQUENCY' });
    expect(r.body.warning).toMatch(/no grid frequency/);
  });
});

describe('recording actuals', () => {
  it('prices the block off the slab and stores what priced it', async () => {
    await verifyBand('Under-injection, frequency below normal band', 550);
    const id = addBlock(100);
    const r = await request(app).post(`/api/bilateral/schedules/${id}/actuals`).set(auth(trader))
      .send({ actual_mw: 80, grid_frequency_hz: 49.9 });
    expect(r.status).toBe(200);
    expect(r.body.dsm).toMatchObject({ basis: 'CERC_SLAB', rate_paise_per_kwh: 550, amount: 27500 });

    const row = db.prepare('SELECT * FROM bilateral_schedules WHERE id = ?').get(id);
    expect(row.deviation_mw).toBe(-20);
    expect(row.grid_frequency_hz).toBe(49.9);
    expect(row.dsm_penalty_amount).toBe(27500);
    expect(row.dsm_basis).toBe('CERC_SLAB');
    expect(row.dsm_slab_id).toBeTruthy();
  });

  it('records the deviation unpriced when no frequency is given', async () => {
    await verifyBand('Under-injection, frequency below normal band', 550);
    const id = addBlock(100);
    const r = await request(app).post(`/api/bilateral/schedules/${id}/actuals`).set(auth(trader))
      .send({ actual_mw: 80 });
    expect(r.body.dsm.basis).toBe('NO_FREQUENCY');

    const row = db.prepare('SELECT * FROM bilateral_schedules WHERE id = ?').get(id);
    expect(row.deviation_mw).toBe(-20);
    expect(row.dsm_penalty_amount).toBe(0);
    expect(row.dsm_basis).toBe('NO_FREQUENCY');
  });

  it('keeps a frequency recorded earlier when a later correction omits it', async () => {
    await verifyBand('Under-injection, frequency below normal band', 550);
    const id = addBlock(100);
    await request(app).post(`/api/bilateral/schedules/${id}/actuals`).set(auth(trader))
      .send({ actual_mw: 80, grid_frequency_hz: 49.9 });
    const r = await request(app).post(`/api/bilateral/schedules/${id}/actuals`).set(auth(trader))
      .send({ actual_mw: 90 });
    expect(r.body.dsm).toMatchObject({ basis: 'CERC_SLAB', amount: 13750 });
    expect(db.prepare('SELECT grid_frequency_hz FROM bilateral_schedules WHERE id = ?').get(id).grid_frequency_hz).toBe(49.9);
  });

  it('does not charge a block that met its schedule', async () => {
    await verifyBand('Under-injection, frequency below normal band', 550);
    const id = addBlock(100);
    const r = await request(app).post(`/api/bilateral/schedules/${id}/actuals`).set(auth(trader))
      .send({ actual_mw: 100, grid_frequency_hz: 49.9 });
    expect(r.body.dsm).toMatchObject({ basis: 'NO_DEVIATION', amount: 0 });
  });
});
