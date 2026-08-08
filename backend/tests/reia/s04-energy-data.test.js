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

// What the test contract (100 MW solar) is expected to generate in a month at
// the 22% base CUF: 100 x 24 x 30 x 0.22. A period at this figure validates
// clean, which is what a lock now requires.
const PLAUSIBLE_MWH = 15840;

/** Upload and take the period through validation, the way a period reaches lock. */
const uploadValidated = async (body) => {
  const r = await upload({ energy_mwh: PLAUSIBLE_MWH, ...body });
  const v = await request(app).post(`/api/energy-data/${r.body.id}/validate`).set(auth(reia)).send({});
  expect(v.body.status, 'the fixture figure did not validate clean').toBe('VALIDATED');
  return r;
};

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
    const r = await uploadValidated({ data_type: 'FINAL' });
    const lock = await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia)).send({});
    expect(lock.status).toBeLessThan(400);
    expect(db.prepare('SELECT status FROM energy_data WHERE id = ?').get(r.body.id).status).toBe('LOCKED');
  });

  it('refuses to edit locked data without a reopening', async () => {
    const r = await uploadValidated({ data_type: 'FINAL' });
    await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia)).send({});
    const edit = await request(app).post('/api/energy-data').set(auth(reia))
      .send({ contract_id: contract.id, period_month: '2026-04', data_type: 'FINAL', source: 'SELLER', energy_mwh: 9999 });
    const locked = db.prepare(`SELECT energy_mwh FROM energy_data WHERE id = ?`).get(r.body.id);
    expect(locked.energy_mwh, 'a locked period was overwritten').toBe(PLAUSIBLE_MWH);
    expect(edit.status >= 400 || locked.energy_mwh === PLAUSIBLE_MWH).toBe(true);
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

describe('S4 Validation gates the lock', () => {
  // Locking makes a period billable, so it is the last point at which a
  // validation result can still change anything. It used to change nothing:
  // an unvalidated period locked, and a period validation had flagged locked
  // just as easily — the bill went out either way.

  /** A figure far enough from the contract's expected generation to be flagged. */
  const implausible = () => upload({ data_type: 'FINAL', energy_mwh: 1 });

  it('refuses to lock a period that was never validated', async () => {
    const r = await upload({ data_type: 'FINAL' });
    const lock = await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia)).send({});
    expect(lock.status, 'an unvalidated period locked and became billable').toBe(400);
    expect(lock.body.error).toMatch(/validate/i);
    expect(db.prepare('SELECT status FROM energy_data WHERE id = ?').get(r.body.id).status).toBe('DRAFT');
  });

  it('refuses to lock a period validation flagged, with no reason given', async () => {
    const r = await implausible();
    await request(app).post(`/api/energy-data/${r.body.id}/validate`).set(auth(reia)).send({});
    expect(db.prepare('SELECT status FROM energy_data WHERE id = ?').get(r.body.id).status).toBe('DISPUTED');

    const lock = await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia)).send({});
    expect(lock.status, 'a period that failed validation locked and was billed anyway').toBe(400);
    expect(lock.body.validation_note, 'the refusal did not say what failed').toBeTruthy();
    expect(db.prepare('SELECT status FROM energy_data WHERE id = ?').get(r.body.id).status).toBe('DISPUTED');
  });

  it('allows the override but records who did it and why', async () => {
    const r = await implausible();
    await request(app).post(`/api/energy-data/${r.body.id}/validate`).set(auth(reia)).send({});
    const lock = await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia))
      .send({ override_reason: 'Plant was under forced outage for 26 days — SLDC log attached.' });

    expect(lock.status).toBeLessThan(400);
    const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(r.body.id);
    expect(row.status).toBe('LOCKED');
    expect(row.lock_override_reason).toMatch(/forced outage/);
    expect(row.lock_override_by, 'the override recorded no one').toBeTruthy();

    const audit = db.prepare(
      `SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY created_at DESC`
    ).all(r.body.id).map((a) => a.action);
    expect(audit, 'an override was not distinguishable from a clean lock').toContain('LOCK_OVERRIDE');
  });

  it('leaves a clean lock unmarked, with no override recorded', async () => {
    const r = await uploadValidated({ data_type: 'FINAL' });
    await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia)).send({});
    const row = db.prepare('SELECT * FROM energy_data WHERE id = ?').get(r.body.id);
    expect(row.status).toBe('LOCKED');
    expect(row.lock_override_reason).toBeNull();
    expect(row.locked_at, 'lock time was not recorded').toBeTruthy();
  });

  // Refusing the lock is not by itself enough: only a FINAL bill ever required
  // locked energy, so a flagged period could still be billed provisionally and
  // the validation result changed nothing either way.
  it('refuses to bill a period that failed validation', async () => {
    const r = await implausible();
    await request(app).post(`/api/energy-data/${r.body.id}/validate`).set(auth(reia)).send({});

    const inv = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: contract.id, period_month: '2026-04' });
    expect(inv.status, 'a period that failed validation was billed provisionally').toBe(400);
    expect(inv.body.validation_note, 'the refusal did not say what failed').toBeTruthy();
  });

  it('bills once the flag is owned, and the bill discloses it', async () => {
    const r = await implausible();
    await request(app).post(`/api/energy-data/${r.body.id}/validate`).set(auth(reia)).send({});
    await request(app).post(`/api/energy-data/${r.body.id}/lock`).set(auth(reia))
      .send({ override_reason: 'Forced outage 26 days — SLDC log attached.' });

    const inv = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: contract.id, period_month: '2026-04' });
    expect(inv.status).toBe(201);

    // The counterparty is being billed against a figure the system questioned,
    // and the dispute window is short — the bill has to say so on its face.
    const breakdown = JSON.parse(inv.body.invoice_breakdown_json || '[]');
    const note = breakdown.find((b) => b.code === 'NOTE');
    expect(note, 'the bill did not disclose that its energy was locked over a flag').toBeTruthy();
    expect(note.label).toMatch(/forced outage/i);
  });
});
