import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';

describe('Public Market Ticker & Clean Energy Telemetry Endpoints', () => {
  beforeEach(() => {
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.prepare(`DELETE FROM market_rates`).run();
    db.prepare(`DELETE FROM energy_data`).run();
    db.prepare(`DELETE FROM contracts`).run();

    // Seed market rates for IEX, PXIL, HPX
    const insertRate = db.prepare(`
      INSERT INTO market_rates (id, exchange, product, rate_date, time_block, mcp_rate, volume_mw, min_rate, max_rate, avg_rate, data_source)
      VALUES (?, ?, ?, ?, 'DAILY', ?, ?, ?, ?, ?, ?)
    `);

    // Prev day (2026-08-17)
    insertRate.run(newId('MRT'), 'IEX', 'DAM', '2026-08-17', 4.45, 5582, 3.21, 6.43, 4.47, 'IEX_PORTAL');
    insertRate.run(newId('MRT'), 'HPX', 'DAM', '2026-08-17', 4.01, 800, 3.00, 6.00, 4.10, 'HPX_PORTAL');
    insertRate.run(newId('MRT'), 'PXIL', 'DAM', '2026-08-17', 3.96, 1400, 3.00, 5.50, 3.92, 'PXIL_PORTAL');

    // Current day (2026-08-18)
    insertRate.run(newId('MRT'), 'IEX', 'DAM', '2026-08-18', 4.03, 4379, 3.27, 5.25, 3.93, 'IEX_PORTAL');
    insertRate.run(newId('MRT'), 'IEX', 'GDAM', '2026-08-18', 4.01, 1090, 2.75, 6.03, 4.08, 'IEX_PORTAL');
    insertRate.run(newId('MRT'), 'IEX', 'RTM', '2026-08-18', 5.02, 2438, 3.54, 7.39, 5.07, 'IEX_PORTAL');
    insertRate.run(newId('MRT'), 'HPX', 'DAM', '2026-08-18', 4.37, 866, 3.04, 6.50, 4.44, 'HPX_PORTAL');
    insertRate.run(newId('MRT'), 'PXIL', 'DAM', '2026-08-18', 4.37, 1695, 2.99, 6.58, 4.45, 'PXIL_PORTAL');

    // Seed contracts and energy_data
    const insertContract = db.prepare(`
      INSERT INTO contracts (id, contract_no, contract_type, project_type, capacity_mw, tariff_per_unit, tenure_start, tenure_end, status)
      VALUES (?, ?, ?, ?, ?, 2.50, '2020-01-01', '2045-01-01', 'ACTIVE')
    `);
    const cHydro = 'CON-TEST-HYDRO-01';
    const cSolar = 'CON-TEST-SOLAR-01';
    insertContract.run(cHydro, 'PPA/TEST/HYDRO/001', 'PPA', 'Hydro', 1500);
    insertContract.run(cSolar, 'PPA/TEST/SOLAR/001', 'PPA', 'Solar', 50);

    const insertEnergy = db.prepare(`
      INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
      VALUES (?, ?, ?, 'FINAL', 'REA', ?, 'VALIDATED')
    `);
    insertEnergy.run(newId('ENG'), cHydro, '2025-05', 100000); // 100 MUs all-time prior FY
    insertEnergy.run(newId('ENG'), cHydro, '2026-05', 200000); // 200 MUs in FY 2026-27
    insertEnergy.run(newId('ENG'), cSolar, '2026-06', 50000);  // 50 MUs in FY 2026-27
  });

  it('GET /api/public/market-ticker returns real exchange prices and volumes without authentication', async () => {
    const res = await request(app).get('/api/public/market-ticker');
    expect(res.status).toBe(200);
    expect(res.body.latest_date).toBe('2026-08-18');
    expect(res.body.prev_date).toBe('2026-08-17');
    expect(res.body.total_volume_mw).toBe(4379 + 1090 + 2438 + 866 + 1695);
    expect(Array.isArray(res.body.rates)).toBe(true);
    expect(res.body.rates.length).toBe(5);

    const iexDam = res.body.rates.find(r => r.exchange === 'IEX' && r.product === 'DAM');
    expect(iexDam).toBeDefined();
    expect(iexDam.mcp_rate).toBe(4.03);
    expect(iexDam.prev_rate).toBe(4.45);
    expect(iexDam.diff).toBe(-0.42);
    expect(iexDam.volume_mw).toBe(4379);
    expect(iexDam.data_source).toBe('IEX_PORTAL');
  });

  it('GET /api/public/clean-energy returns verified clean MUs and CEA CO2 offset calculations', async () => {
    const res = await request(app).get('/api/public/clean-energy');
    expect(res.status).toBe(200);
    expect(res.body.financial_year).toBe('FY 2026-27');
    expect(res.body.cea_emission_factor_t_per_mu).toBe(716);
    expect(res.body.clean_energy).toBeDefined();

    // 100 + 200 + 50 = 350 MUs all time
    expect(res.body.clean_energy.all_time_mu).toBe(350);
    // 200 + 50 = 250 MUs in FY 2026-27
    expect(res.body.clean_energy.fy_mu).toBe(250);
    expect(res.body.clean_energy.hydro_mu).toBe(300);
    expect(res.body.clean_energy.solar_mu).toBe(50);

    // CO2 avoided
    expect(res.body.co2_avoided_tonnes.all_time).toBe(350 * 716);
    expect(res.body.co2_avoided_tonnes.fy).toBe(250 * 716);
  });
});
