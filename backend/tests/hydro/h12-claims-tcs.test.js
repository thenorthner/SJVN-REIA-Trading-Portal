import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeContract } from '../helpers/reia.js';

// Hydro QA run 12 (18-Oct-2026): additional-charge claims and TCS.

let station, desk;
const post = (path, body) => request(app).post(`/api/hydro-billing${path}`).set(auth(desk)).send(body);
beforeEach(() => {
  desk = tokenFor('COMMERCIAL_ADMIN');
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA12-${Math.random().toString(36).slice(2, 8)}` });
  const add = db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, ?, ?, '2026-04-01')`);
  add.run(newId('HBA'), station.id, 'STATE A', 60);
  add.run(newId('HBA'), station.id, 'STATE B', 40);
});

describe('An additional-charge claim', () => {
  it('gives its charges back when the claim bill is cancelled', async () => {
    expect((await post('/charges', { contract_id: station.id, charge_type: 'AUX_CONSUMPTION', period_month: '2026-09', amount: 1234, remarks: 'H12' })).status).toBe(200);
    const claim = await post('/charges/claim', { contract_id: station.id, billing_month: '2026-09' });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    expect((await post(`/${claim.body.id}/cancel`, { reason: 'raised for the wrong month' })).status).toBe(200);
    expect(db.prepare('SELECT claimed_bill_id FROM hydro_additional_charges WHERE contract_id = ?').get(station.id).claimed_bill_id).toBeNull();
    expect((await post('/charges/claim', { contract_id: station.id, billing_month: '2026-09' })).status).toBe(200);
  });

  it('is only for a station', async () => {
    const solar = makeContract({ project_type: 'Solar' });
    expect((await post('/charges', { contract_id: solar.id, charge_type: 'OTHER', period_month: '2026-09', amount: 10, remarks: 'x' })).status).toBe(400);
  });
});

describe('TCS', () => {
  const tcs = (body) => post('/tcs', { contract_id: station.id, billing_month: '2026-09', amount_received: 1000000, tcs_rate_pct: 0.1, payment_date: '2026-10-01', ...body });
  it('is claimed per beneficiary, once per payment, on a real past date', async () => {
    expect((await tcs({ beneficiary: 'STATE A' })).body.tcs_amount).toBe(1000);
    const second = await tcs({ beneficiary: 'STATE B' });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await tcs({ beneficiary: 'STATE A' })).status).toBe(409);
    expect((await tcs({ beneficiary: 'STATE A', amount_received: 2000000, payment_date: '2099-01-01' })).body.error).toMatch(/after today/);
  });
});
