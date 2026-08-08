import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, columnsOf, hasTable, resetReia } from '../helpers/reia.js';

let reia, contract;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  contract = makeContract();
});

const upload = (body) => request(app).post('/api/energy-data').set(auth(reia))
  .send({ contract_id: contract.id, period_month: '2026-04', source: 'SELLER', energy_mwh: 1000, ...body });

describe('S4 Energy data accounting', () => {
  it('tags a provisional upload as provisional', async () => {
    const r = await upload({ data_type: 'PROVISIONAL' });
    expect(r.status).toBeLessThan(400);
    expect(db.prepare('SELECT data_type FROM energy_data WHERE id = ?').get(r.body.id).data_type).toBe('PROVISIONAL');
  });

  it('keeps provisional data editable', async () => {
    const r = await upload({ data_type: 'PROVISIONAL' });
    const row = db.prepare('SELECT status FROM energy_data WHERE id = ?').get(r.body.id);
    expect(row.status).not.toBe('LOCKED');
  });

  it('locks final data so it can no longer be edited', async () => {
    const r = await upload({ data_type: 'FINAL' });
    const lock = await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia)).send({});
    expect(lock.status).toBeLessThan(400);
    expect(db.prepare('SELECT status FROM energy_data WHERE id = ?').get(r.body.id).status).toBe('LOCKED');
  });

  it('refuses to edit locked data without a reopening', async () => {
    const r = await upload({ data_type: 'FINAL' });
    await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia)).send({});
    const edit = await request(app).post('/api/energy-data').set(auth(reia))
      .send({ contract_id: contract.id, period_month: '2026-04', data_type: 'FINAL', source: 'SELLER', energy_mwh: 9999 });
    const locked = db.prepare(`SELECT energy_mwh FROM energy_data WHERE id = ?`).get(r.body.id);
    expect(locked.energy_mwh, 'a locked period was overwritten').toBe(1000);
    expect(edit.status >= 400 || locked.energy_mwh === 1000).toBe(true);
  });

  it('has a controlled reopening workflow that records who and why', () => {
    expect(hasTable('recon_reopen_requests'), 'no reopen-request workflow table exists').toBe(true);
    expect(columnsOf('recon_reopen_requests')).toEqual(
      expect.arrayContaining(['requested_by', 'reason', 'status']));
  });

  // What /validate actually does is a plausibility check: energy against the
  // generation expected from capacity x CUF, within a configured tolerance.
  it('accepts generation that is plausible for the plant', async () => {
    // 100 MW solar at 22% CUF over a month is roughly 15,840 MWh.
    const r = await upload({ data_type: 'PROVISIONAL', energy_mwh: 15840 });
    const v = await request(app).post(`/api/energy-data/${r.body.id}/validate`).set(auth(reia)).send({});
    expect(v.status).toBeLessThan(400);
    expect(db.prepare('SELECT status FROM energy_data WHERE id = ?').get(r.body.id).status).toBe('VALIDATED');
  });

  it('disputes generation far outside the plausible band', async () => {
    const r = await upload({ data_type: 'PROVISIONAL', energy_mwh: 1000 });
    await request(app).post(`/api/energy-data/${r.body.id}/validate`).set(auth(reia)).send({});
    const row = db.prepare('SELECT status, deviation_notes FROM energy_data WHERE id = ?').get(r.body.id);
    expect(row.status).toBe('DISPUTED');
    expect(row.deviation_notes).toMatch(/Deviation/);
  });

  it('reconciles two sources for the same period against each other', async () => {
    // Both figures are plausible for the plant, but they disagree by 40% with
    // each other — so one of them is wrong and billing either silently hides it.
    await upload({ data_type: 'PROVISIONAL', source: 'SELLER', energy_mwh: 15840 });
    const sea = await upload({ data_type: 'PROVISIONAL', source: 'SEA', energy_mwh: 22000 });
    await request(app).post(`/api/energy-data/${sea.body.id}/validate`).set(auth(reia)).send({});
    const row = db.prepare('SELECT status, deviation_notes FROM energy_data WHERE id = ?').get(sea.body.id);
    expect(row.deviation_notes, 'validation never compares the two sources').toMatch(/Source mismatch/);
    expect(row.deviation_notes).toMatch(/SELLER/);
    expect(row.status).toBe('DISPUTED');
  });

  it('passes two sources that agree, and says it checked', async () => {
    await upload({ data_type: 'PROVISIONAL', source: 'SELLER', energy_mwh: 15840 });
    const sea = await upload({ data_type: 'PROVISIONAL', source: 'SEA', energy_mwh: 15900 });
    await request(app).post(`/api/energy-data/${sea.body.id}/validate`).set(auth(reia)).send({});
    const row = db.prepare('SELECT status, deviation_notes FROM energy_data WHERE id = ?').get(sea.body.id);
    expect(row.status).toBe('VALIDATED');
    expect(row.deviation_notes).toMatch(/Cross-checked against 1 other source/);
  });

  it('records which energy dataset an invoice was billed from', () => {
    expect(columnsOf('invoices')).toEqual(expect.arrayContaining(['energy_data_id']));
  });

  it('bills from locked data rather than a stale draft', async () => {
    const draft = await upload({ data_type: 'PROVISIONAL', energy_mwh: 500 });
    const final = await upload({ data_type: 'FINAL', energy_mwh: 1000 });
    await request(app).post(`/api/energy-data/${final.body.id}/lock`).set(auth(reia)).send({});
    const inv = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: contract.id, billing_period: '2026-04' });
    if (inv.status === 201) {
      const row = db.prepare('SELECT energy_mwh, energy_data_id FROM invoices WHERE id = ?').get(inv.body.id);
      expect(row.energy_data_id, 'invoice did not record its energy source').toBeTruthy();
      expect(row.energy_data_id).not.toBe(draft.body.id);
    }
  });
});
