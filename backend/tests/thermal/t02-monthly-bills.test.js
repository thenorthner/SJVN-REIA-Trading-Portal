import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { makeUser, makeEntity, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// Thermal QA run 2 (18-Oct-2026): the monthly bill's own figures, and its audit.

let desk; let station;
const post = (url, body) => request(app).post(url).set(auth(desk)).send(body);
const good = (x = {}) => ({
  contract_id: station.id, billing_month: '2026-06', ex_bus_scheduled_kwh: 750000000, pafm_percent: 85,
  gcv_kcal_per_kg: 3685, coal_rs_per_tonne: 4500, oil_rs_per_kl: 60000, ...x,
});

beforeAll(async () => {
  desk = signToken(makeUser('THERMAL_ADMIN'));
  const genco = makeEntity('SELLER', { name: 'T02 Genco' });
  db.prepare(`UPDATE entities SET verticals = 'THERMAL', status = 'APPROVED' WHERE id = ?`).run(genco.id);
  station = (await post('/api/thermal/stations', {
    seller_id: genco.id, contract_no: `PPA/T02/${genco.id}`, capacity_mw: 1320, tenure_start: '2026-04-01', tenure_end: '2051-03-31',
  })).body;
  await post('/api/thermal/tariffs', {
    contract_id: station.id, financial_year: '2026-2027', annual_afc: 25000000000, napaf_percent: 85,
    gross_heat_rate: 2250, aux_pct: 6.5, sfc_ml_per_kwh: 0.5, cv_secondary_kcal_per_ml: 10,
  });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from, is_active)
    VALUES (?, ?, 'BIHAR', 100, '2026-04-01', 1)`).run(`HBA-T02-${station.id}`, station.id);
});

describe('A thermal monthly bill', () => {
  it('refuses figures a coal station cannot have', async () => {
    for (const x of [{ pafm_percent: 105 }, { ex_bus_scheduled_kwh: 2000000000 }, { gcv_kcal_per_kg: 36000 }, { coal_rs_per_tonne: 45 }]) {
      const r = await post('/api/hydro-billing', good(x));
      expect(r.status, JSON.stringify(x)).toBe(400);
    }
  });

  it('is for a month that is over', async () => {
    const r = await post('/api/hydro-billing', good({ billing_month: '2099-01' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not over yet/);
  });

  it('is filed under Thermal in the audit', async () => {
    const r = await post('/api/hydro-billing', good());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const a = db.prepare(`SELECT module FROM audit_logs WHERE action = 'HYDRO_STATION_BILL_CREATED' AND entity_id = ?`).get(r.body.id);
    expect(a.module).toBe('THERMAL');
  });
});
