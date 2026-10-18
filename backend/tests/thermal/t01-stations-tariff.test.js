import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { makeUser, makeEntity, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { buildThermalBill, computeEcr } from '../../src/services/thermalStationBill.js';

// Thermal QA run 1 (18-Oct-2026): stations and tariff.

let desk; let genco; let station;
const post = (url, body) => request(app).post(url).set(auth(desk)).send(body);
const stationBody = (x = {}) => ({
  seller_id: genco.id, contract_no: `PPA/T01/${Math.random().toString(36).slice(2, 8)}`, capacity_mw: 1320,
  tenure_start: '2026-04-01', tenure_end: '2051-03-31', ...x,
});
const tariffBody = (x = {}) => ({
  contract_id: station.id, financial_year: '2026-2027', annual_afc: 24500000000, napaf_percent: 85,
  gross_heat_rate: 2250, aux_pct: 6.5, sfc_ml_per_kwh: 0.5, cv_secondary_kcal_per_ml: 10, ...x,
});

beforeAll(async () => {
  desk = signToken(makeUser('THERMAL_ADMIN'));
  genco = makeEntity('SELLER', { name: 'T01 Genco' });
  db.prepare(`UPDATE entities SET verticals = 'THERMAL', status = 'APPROVED' WHERE id = ?`).run(genco.id);
  station = (await post('/api/thermal/stations', stationBody())).body;
});

describe('A thermal station', () => {
  it('takes real dates and sane commercial terms', async () => {
    for (const x of [{ tenure_start: '2026-02-30' }, { cod_date: 'abc' }, { commissioned_capacity_mw: 2000 },
      { payment_terms_days: -5 }, { rebate_pct: 150 }, { lps_annual_pct: -1 }]) {
      expect((await post('/api/thermal/stations', stationBody(x))).status, JSON.stringify(x)).toBe(400);
    }
  });
});

describe('A thermal tariff', () => {
  it('is for one April-to-March year', async () => {
    expect((await post('/api/thermal/tariffs', tariffBody({ financial_year: '2026-2028' }))).status).toBe(400);
    expect((await post('/api/thermal/tariffs', tariffBody({ financial_year: '2027-2026' }))).status).toBe(400);
  });

  it('keeps what a revision replaced, filed under Thermal', async () => {
    await post('/api/thermal/tariffs', tariffBody());
    await post('/api/thermal/tariffs', tariffBody({ annual_afc: 25000000000 }));
    const a = db.prepare(`SELECT module, before_value FROM audit_logs WHERE action = 'THERMAL_TARIFF_SET' AND entity_id = ? ORDER BY rowid DESC LIMIT 1`).get(station.id);
    expect(a.module).toBe('THERMAL');
    expect(JSON.parse(a.before_value).annual_afc).toBe(24500000000);
  });

  it('bills coal on its GCV as received less the storage loss', async () => {
    await post('/api/thermal/tariffs', tariffBody());
    for (const [name, pct] of [['BIHAR', 100]]) {
      db.prepare(`INSERT OR IGNORE INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from, is_active)
        VALUES (?, ?, ?, ?, '2026-04-01', 1)`).run(`HBA-T01-${station.id}`, station.id, name, pct);
    }
    const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(station.id);
    const { bill } = buildThermalBill(c, '2026-06', { ex_bus_scheduled_kwh: 1000000, pafm_percent: 85, gcv_kcal_per_kg: 3685, coal_rs_per_tonne: 4500 });
    expect(bill.a12_ecr).toBe(computeEcr({ ghr: 2250, auxPct: 6.5, sfc: 0.5, cvsf: 10, gcvKcalPerKg: 3600, coalRsPerTonne: 4500 }));
    expect(bill.thermal_inputs.fuel.cvpf_kcal_per_kg).toBe(3600);
  });

  it('refuses an ECR preview without a heat rate', async () => {
    const r = await post('/api/thermal/ecr-preview', { aux_pct: 6.5, gcv_kcal_per_kg: 3600, coal_rs_per_tonne: 4500 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/heat rate/);
  });
});
