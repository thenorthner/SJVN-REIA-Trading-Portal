import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';

// The platform held the energy, the capacity and each contract's minimum CUF, and
// worked out a shortfall penalty when a bill was raised — but nothing showed the
// performance itself, so "which projects are underperforming, and since when" meant
// reading invoices one at a time.

let reia, seller, solar;

const energy = (contractId, period, mwh, over = {}) => {
  const id = newId('ENG');
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, availability_percent, status)
    VALUES (?, ?, ?, ?, 'REA', ?, ?, ?, ?)
  `).run(id, contractId, period, over.data_type || 'FINAL', mwh,
    over.cuf_percent ?? null, over.availability_percent ?? null, over.status || 'LOCKED');
  return id;
};

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER', { name: 'Test Solar Ltd' });
  // 100 MW commissioned, minimum CUF 22%: a 31-day month can produce
  // 100 × 24 × 31 = 74,400 MWh, so 22% is 16,368 MWh.
  solar = makeContract({
    seller_id: seller.id, status: 'ACTIVE', project_type: 'Solar',
    capacity_mw: 100, commissioned_capacity_mw: 100, min_cuf_percent: 22, contract_no: 'PPA/SOLAR/001',
  });
});

const report = (query = '') => request(app).get(`/api/reports/generation-performance${query}`).set(auth(reia));

describe('S30 Generation performance', () => {
  it('works out the CUF from the energy and the commissioned capacity', async () => {
    energy(solar.id, '2026-08', 18600); // 25% of 74,400
    const r = await report();
    expect(r.status).toBe(200);
    const month = r.body.months[0];
    expect(month).toMatchObject({
      contract_no: 'PPA/SOLAR/001', seller_name: 'Test Solar Ltd',
      period_month: '2026-08', energy_mwh: 18600, possible_mwh: 74400,
      actual_cuf_percent: 25, min_cuf_percent: 22, meets_cuf: true,
    });
    expect(month.cuf_shortfall_percent).toBe(0);
    expect(month.shortfall_mwh).toBe(0);
  });

  it('measures the shortfall when a month falls short', async () => {
    energy(solar.id, '2026-08', 14880); // 20%, two points under
    const { body } = await report();
    const month = body.months[0];
    expect(month.actual_cuf_percent).toBe(20);
    expect(month.cuf_shortfall_percent).toBe(2);
    expect(month.meets_cuf).toBe(false);
    // 2% of 74,400 MWh.
    expect(month.shortfall_mwh).toBe(1488);
  });

  it('measures against what is commissioned, not what was contracted', async () => {
    const partial = makeContract({
      seller_id: seller.id, status: 'ACTIVE', project_type: 'Solar',
      capacity_mw: 100, commissioned_capacity_mw: 50, min_cuf_percent: 22, contract_no: 'PPA/PART/001',
    });
    energy(partial.id, '2026-08', 9300); // 25% of the 37,200 MWh 50 MW can make
    const { body } = await report('?contract_id=' + partial.id);
    expect(body.months[0]).toMatchObject({
      capacity_mw: 50, contracted_capacity_mw: 100, possible_mwh: 37200, actual_cuf_percent: 25, meets_cuf: true,
    });
  });

  it('takes the CUF the meter data states over one it would compute', async () => {
    energy(solar.id, '2026-08', 14880, { cuf_percent: 23.5 });
    const { body } = await report();
    expect(body.months[0].actual_cuf_percent).toBe(23.5);
    expect(body.months[0].meets_cuf).toBe(true);
  });

  it('counts a final figure once, not beside the provisional it replaced', async () => {
    energy(solar.id, '2026-08', 14000, { data_type: 'PROVISIONAL', status: 'VALIDATED' });
    energy(solar.id, '2026-08', 18600, { data_type: 'FINAL' });
    const { body } = await report();
    expect(body.months).toHaveLength(1);
    expect(body.months[0]).toMatchObject({ data_type: 'FINAL', energy_mwh: 18600 });
  });

  it('leaves out a draft reading, which is not accounted energy', async () => {
    energy(solar.id, '2026-07', 18600, { status: 'DRAFT' });
    const { body } = await report();
    expect(body.months).toHaveLength(0);
  });

  it('rolls months up per project, worst shortfall first', async () => {
    const other = makeContract({
      seller_id: seller.id, status: 'ACTIVE', project_type: 'Solar',
      capacity_mw: 100, commissioned_capacity_mw: 100, min_cuf_percent: 22, contract_no: 'PPA/SOLAR/002',
    });
    energy(solar.id, '2026-07', 14880, { availability_percent: 96 });   // 20% of 74,400 — July has 31 days too
    energy(solar.id, '2026-08', 14880, { availability_percent: 94 });   // 20% of 74,400
    energy(other.id, '2026-08', 18600);                                  // 25%, no shortfall

    const { body } = await report();
    expect(body.projects[0].contract_no).toBe('PPA/SOLAR/001');
    expect(body.projects[0]).toMatchObject({ months: 2, months_below_cuf: 2, avg_availability_percent: 95 });
    // The CUF over the period, weighted by month length, not the mean of two CUFs.
    expect(body.projects[0].period_cuf_percent).toBe(20);
    expect(body.projects[1]).toMatchObject({ contract_no: 'PPA/SOLAR/002', months_below_cuf: 0, shortfall_mwh: 0 });
    expect(body.totals).toMatchObject({ months: 3, projects: 2, months_below_cuf: 2 });
  });

  it('answers for a window of months', async () => {
    energy(solar.id, '2026-06', 18600);
    energy(solar.id, '2026-07', 18000);
    energy(solar.id, '2026-08', 18600);
    const { body } = await report('?from=2026-07&to=2026-08');
    expect(body.months.map((m) => m.period_month).sort()).toEqual(['2026-07', '2026-08']);
  });

  it('says nothing rather than zero when the capacity is unknown', async () => {
    const noCapacity = makeContract({
      seller_id: seller.id, status: 'ACTIVE', project_type: 'Solar',
      capacity_mw: 0, commissioned_capacity_mw: 0, contract_no: 'PPA/NOCAP/001',
    });
    energy(noCapacity.id, '2026-08', 5000);
    const { body } = await report('?contract_id=' + noCapacity.id);
    expect(body.months[0].actual_cuf_percent).toBeNull();
    expect(body.months[0].meets_cuf).toBeNull();
  });

  it('is not a counterparty’s to read', async () => {
    const sellerUser = tokenFor('SELLER', { linked_entity_id: seller.id });
    expect((await request(app).get('/api/reports/generation-performance').set(auth(sellerUser))).status).toBe(403);
  });
});
