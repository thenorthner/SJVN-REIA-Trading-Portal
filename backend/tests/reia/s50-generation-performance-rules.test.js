import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { lastCompleteMonth } from '../../src/services/energyRules.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';

// Found by the browser audit of the generation performance desk (17-Oct-2026):
// 124 of its 129 rows were hydro months judged against the 22 % solar default
// (30 of the 31 "months below CUF"); a PSA's own copy of its source PPA's energy
// was a second project; two provisional readings of one month were two months;
// the month in progress was judged against a whole month's capacity; a reversed
// range came back empty; and the rupee figure billing deducts was nowhere.

let reia, solar;
const energy = (contract, period, mwh, over = {}) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId('ENG'), contract.id, period, over.data_type || 'PROVISIONAL', over.source || 'SEA', mwh,
  over.cuf_percent ?? null, over.status || 'LOCKED', over.created_at || '2026-09-05 10:00:00');
const report = (query = '') => request(app).get(`/api/reports/generation-performance${query}`).set(auth(reia));

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  solar = makeContract({
    contract_type: 'PPA', seller_id: makeEntity('SELLER').id, project_type: 'Solar', capacity_mw: 50, commissioned_capacity_mw: 50,
    tariff_per_unit: 2.88, contract_no: 'PPA/S50/SOLAR', tenure_start: '2024-01-01', tenure_end: '2040-12-31',
  });
});

describe('S50 What the desk judges', () => {
  it('leaves out hydro stations and a PSA\'s copy of its PPA\'s energy', async () => {
    const hydro = makeContract({ contract_type: 'PPA', project_type: 'Hydro', capacity_mw: 1500, contract_no: 'PPA/S50/HYDRO' });
    const psa = makeContract({ contract_type: 'PSA', project_type: 'Solar', capacity_mw: 50, contract_no: 'PSA/S50/SOLAR' });
    energy(solar, '2026-08', 8200);
    energy(hydro, '2026-08', 241933, { status: 'VALIDATED' });
    energy(psa, '2026-08', 8200);
    const { body } = (await report());
    expect(body.projects.map((p) => p.contract_no)).toEqual(['PPA/S50/SOLAR']);
    expect(body.totals).toMatchObject({ months: 1, energy_mwh: 8200 });
  });

  it('counts one reading a month, the one billing uses', async () => {
    energy(solar, '2026-08', 7000, { status: 'VALIDATED', source: 'JMR' });
    energy(solar, '2026-08', 8200, { status: 'LOCKED' });
    const { body } = await report();
    expect(body.months).toHaveLength(1);
    expect(body.months[0]).toMatchObject({ energy_mwh: 8200, status: 'LOCKED' });
  });

  it('does not judge the month in progress', async () => {
    const [y, m] = lastCompleteMonth().split('-').map(Number);
    const current = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
    energy(solar, current, 1000);
    energy(solar, '2026-08', 8200);
    const { body } = await report();
    expect(body.judged_up_to).toBe(lastCompleteMonth());
    expect(body.months.map((r) => r.period_month)).not.toContain(current);
  });

  it('refuses a malformed or reversed range instead of showing nothing', async () => {
    expect((await report('?from=abc')).status).toBe(400);
    const reversed = await report('?from=2026-09&to=2026-07');
    expect(reversed.status).toBe(400);
    expect(reversed.body.error).toMatch(/starts \(2026-09\) after it ends \(2026-07\)/);
    expect((await report('?from=2026-08&to=2026-08')).status).toBe(200);
  });
});

describe('S50 The shortfall: a monthly indicator, priced once a year', () => {
  it('shows July\'s shortfall as an indicator, and billing no longer deducts it', async () => {
    // 50 MW × 744 h = 37,200 MWh possible; 22 % is 8,184 MWh; 2,000 made → 6,184 MWh short.
    energy(solar, '2026-07', 2000);
    const row = (await report()).body.months[0];
    expect(row).toMatchObject({ actual_cuf_percent: 5.38, min_cuf_percent: 22, shortfall_mwh: 6184 });
    expect(row.penalty).toBeUndefined();

    const bill = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: solar.id, period_month: '2026-07', invoice_type: 'PROVISIONAL' });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body.total_amount).toBe(2000 * 2880);
  });

  it('lists each contract year with where its assessment stands', async () => {
    energy(solar, '2026-07', 2000);
    const { body } = await report();
    const years = body.contract_years.filter((y) => y.contract_no === 'PPA/S50/SOLAR');
    // Tenure from January 2024: contract year 3 is 2026-01 → 2026-12, in progress.
    expect(years.map((y) => [y.contract_year, y.state])).toEqual([[2, 'AWAITING_ENERGY'], [3, 'IN_PROGRESS']]);
    expect(body.totals.true_up_due).toBe(0);
  });
});
