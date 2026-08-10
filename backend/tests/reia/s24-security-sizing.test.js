import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { estimatedMonthlyBill, syncRequirementsFromContract } from '../../src/paymentSecurityEngine.js';
import { baselineCufFor } from '../../src/mastersService.js';

let reia;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); });

describe('S24 A new PSA is secured against what it will actually bill', () => {
  // The estimate multiplied MWh by rupees-per-kWh without converting between
  // them, so it came out a thousandfold short: a 50 MW PSA at Rs 4.00/kWh was
  // secured for Rs 39,600 against a first bill of Rs 3.66 crore. It only ever
  // ran on a contract with no billing history — which is exactly when the
  // letter of credit has to be in place, since supply starts before any
  // payment record exists.

  it('estimates a month of billing at the right order of magnitude', () => {
    // 50 MW x 24 x 30 x 22% = 7,920 MWh; at Rs 4.00/kWh that is Rs 3.168 crore.
    const est = estimatedMonthlyBill({ capacity_mw: 50, tariff_per_unit: 4.0, project_type: 'SOLAR' });
    expect(est).toBe(Math.round(50 * 24 * 30 * 0.22 * 1000 * 4.0));
    expect(est, 'the MWh-to-kWh conversion is missing again').toBeGreaterThan(30000000);
  });

  it('sizes the requirement off it when there is no history', () => {
    const c = makeContract({ contract_type: 'PSA', status: 'ACTIVE', capacity_mw: 50,
      tariff_per_unit: 4.0, project_type: 'SOLAR' });
    syncRequirementsFromContract(c.id);
    const lc = db.prepare(`SELECT * FROM security_requirements WHERE contract_id = ? AND mechanism_type = 'LC'`).get(c.id);
    expect(lc.min_amount).toBe(Math.round(estimatedMonthlyBill(c) * 1.1));
    expect(lc.min_amount, 'a new buyer was left effectively unsecured').toBeGreaterThan(30000000);
  });

  it('gives the corpus something to hold on a contract with no history', () => {
    // It was sized off the history figure alone, so with no history it was zero.
    const c = makeContract({ contract_type: 'PSA', status: 'ACTIVE', capacity_mw: 50, tariff_per_unit: 4.0 });
    syncRequirementsFromContract(c.id);
    const corpus = db.prepare(`SELECT * FROM security_requirements WHERE contract_id = ? AND mechanism_type = 'CORPUS_FUND'`).get(c.id);
    expect(corpus.min_amount, 'an instrument that secured nothing').toBeGreaterThan(0);
  });

  it('prefers real billing history over the estimate once there is any', () => {
    const c = makeContract({ contract_type: 'PSA', status: 'ACTIVE', capacity_mw: 50, tariff_per_unit: 4.0 });
    makeInvoice({ contract_id: c.id, direction: 'SJVN_TO_BUYER', status: 'APPROVED',
      total_amount: 10000000, billing_period: '2026-05' });
    syncRequirementsFromContract(c.id);
    const lc = db.prepare(`SELECT * FROM security_requirements WHERE contract_id = ? AND mechanism_type = 'LC'`).get(c.id);
    expect(lc.min_amount, 'the estimate overrode a figure we actually measured').toBe(Math.round(10000000 * 1.1));
  });

  it('sizes on commissioned capacity when the plant is part-built', () => {
    const full = estimatedMonthlyBill({ capacity_mw: 50, tariff_per_unit: 4.0 });
    const part = estimatedMonthlyBill({ capacity_mw: 50, commissioned_capacity_mw: 10, tariff_per_unit: 4.0 });
    expect(part).toBe(Math.round(full / 5));
  });

  it('reaches the module through the API too', async () => {
    const seller = makeEntity('SELLER'); const buyer = makeEntity('BUYER');
    const c = makeContract({ contract_type: 'PSA', status: 'ACTIVE', seller_id: seller.id, buyer_id: buyer.id,
      capacity_mw: 50, tariff_per_unit: 4.0 });
    await request(app).post(`/api/payment-security/from-contract/${c.id}`).set(auth(reia)).send({});
    const r = await request(app).get(`/api/payment-security/adequacy/${c.id}`).set(auth(reia));
    expect(r.status).toBe(200);
    expect(r.body.coverages[0].required_amount).toBeGreaterThan(30000000);
  });
});

describe('S24 One answer for what a plant is expected to generate', () => {
  // Energy validation read the masters but matched project_type case-sensitively,
  // so a contract recorded as "WIND" fell through to solar's 22%. The security
  // engine ignored the masters entirely and used a hardcoded 0.25 — three
  // different answers to the same question.

  it('reads the configured factor for each technology', () => {
    expect(baselineCufFor('SOLAR')).toBeCloseTo(0.22, 3);
    expect(baselineCufFor('WIND')).toBeCloseTo(0.30, 3);
    expect(baselineCufFor('HYDRO')).toBeCloseTo(0.65, 3);
    expect(baselineCufFor('HYBRID')).toBeCloseTo(0.25, 3);
  });

  it('does not care how the project type was capitalised', () => {
    expect(baselineCufFor('WIND'), 'an uppercase WIND was judged as solar').toBe(baselineCufFor('Wind'));
    expect(baselineCufFor('hydro')).toBe(baselineCufFor('Hydro'));
  });

  it('falls back to solar for anything unrecognised', () => {
    expect(baselineCufFor(undefined)).toBeCloseTo(0.22, 3);
    expect(baselineCufFor('SOMETHING_ELSE')).toBeCloseTo(0.22, 3);
  });

  it('judges a wind plant on wind output', async () => {
    // 20 MW wind at 30% for a month is 4,320 MWh. Under solar's 22% the
    // expectation would be 3,168 and this would read as a 36% overshoot.
    const c = makeContract({ status: 'ACTIVE', project_type: 'WIND', capacity_mw: 20 });
    const e = await request(app).post('/api/energy-data').set(auth(reia))
      .send({ contract_id: c.id, period_month: '2026-06', data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: 4320 });
    const v = await request(app).post(`/api/energy-data/${e.body.id}/validate`).set(auth(reia)).send({});
    expect(v.body.status, 'a wind plant was measured against solar output').toBe('VALIDATED');
    expect(v.body.deviation_notes).toMatch(/30% CUF/);
  });

  it('gives an uppercase HYDRO its wider tolerance', async () => {
    const c = makeContract({ status: 'ACTIVE', project_type: 'HYDRO', capacity_mw: 10 });
    const e = await request(app).post('/api/energy-data').set(auth(reia))
      .send({ contract_id: c.id, period_month: '2026-06', data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: 2000 });
    const v = await request(app).post(`/api/energy-data/${e.body.id}/validate`).set(auth(reia)).send({});
    expect(v.body.deviation_notes, 'hydro was held to the tighter non-hydro tolerance').toMatch(/Tolerance: 80%/);
  });
});
