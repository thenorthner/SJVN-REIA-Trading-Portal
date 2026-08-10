import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { estimatedMonthlyBill, syncRequirementsFromContract, securityBreakdown, invokeWaterfall } from '../../src/paymentSecurityEngine.js';
import { baselineCufFor, invalidateParamCache } from '../../src/mastersService.js';

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

describe('S24 Cover is what is standing behind the contract today', () => {
  // Cover was counted from status alone. An instrument nobody had confirmed with
  // a bank counted in full, and one whose validity had run out went on counting
  // until some sweep happened to relabel it.
  let contract;
  beforeEach(() => {
    contract = makeContract({ contract_type: 'PSA', status: 'ACTIVE', capacity_mw: 10, tariff_per_unit: 3 });
  });

  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const instrument = ({ amount = 1000000, verified = false, ends = day(365), starts = day(-30) } = {}) => {
    const id = `PSC-${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, limit_amount,
                utilized_amount, available_amount, waterfall_priority, validity_start, validity_end, verified_at, status)
                VALUES (?, ?, ?, 'LC', ?, 0, ?, 10, ?, ?, ?, 'ACTIVE')`)
      .run(id, `PS/T/${id.slice(-5)}`, contract.id, amount, amount, starts, ends, verified ? '2026-01-01' : null);
    return id;
  };
  const cover = () => securityBreakdown(contract.id);

  it('leaves a lapsed instrument out of cover', () => {
    instrument({ amount: 500000, ends: day(-1) });
    const c = cover();
    expect(c.counted, 'a guarantee that expired yesterday was still counted as security').toBe(0);
    expect(c.lapsed).toBe(500000);
  });

  it('leaves out one whose validity has not started', () => {
    instrument({ amount: 500000, starts: day(30), ends: day(400) });
    expect(cover().counted).toBe(0);
  });

  it('counts one that is live today', () => {
    instrument({ amount: 500000 });
    expect(cover().counted).toBe(500000);
  });

  it('shows how much of the cover nobody has confirmed', () => {
    instrument({ amount: 400000, verified: true });
    instrument({ amount: 600000, verified: false });
    const c = cover();
    expect(c.verified).toBe(400000);
    expect(c.unverified, 'an instrument nobody confirmed was indistinguishable from one a bank had').toBe(600000);
  });

  it('counts both by default, so a live system is not emptied overnight', () => {
    instrument({ amount: 400000, verified: true });
    instrument({ amount: 600000, verified: false });
    expect(cover().counted).toBe(1000000);
  });

  it('counts only confirmed instruments once that is switched on', () => {
    instrument({ amount: 400000, verified: true });
    instrument({ amount: 600000, verified: false });
    db.prepare(`UPDATE system_parameters SET param_value = '1' WHERE param_key = 'security_require_bank_confirmation'`).run();
    invalidateParamCache();
    try {
      expect(cover().counted, 'the rule was switched on and nothing changed').toBe(400000);
    } finally {
      db.prepare(`UPDATE system_parameters SET param_value = '0' WHERE param_key = 'security_require_bank_confirmation'`).run();
      invalidateParamCache();
    }
  });

  it('surfaces the split on the adequacy response', async () => {
    instrument({ amount: 400000, verified: true });
    instrument({ amount: 600000, verified: false });
    instrument({ amount: 900000, ends: day(-5) });
    const r = await request(app).get(`/api/payment-security/adequacy/${contract.id}`).set(auth(reia));
    const c = r.body.coverages[0];
    expect(c.verified_security).toBe(400000);
    expect(c.unverified_security).toBe(600000);
    expect(c.lapsed_security_excluded).toBe(900000);
    expect(c.available_security).toBe(1000000);
  });

  it('will not draw on a lapsed instrument', () => {
    instrument({ amount: 500000, ends: day(-1) });
    const live = instrument({ amount: 300000 });
    const r = invokeWaterfall(contract.id, 700000, [], { name: 'test' }, 'BUYER');
    // the invocation row carries the draws as waterfall_used
    const drawn = JSON.parse(r.waterfall_used || '[]').map((w) => w.id);
    expect(drawn, 'a demand was issued against a guarantee that had expired').toEqual([live]);
    expect(db.prepare('SELECT utilized_amount FROM payment_security WHERE id = ?').get(live).utilized_amount).toBe(300000);
  });
});

describe('S24 Restoring cover says what restored it', () => {
  // is_revolving was recorded on every instrument and read by nothing, so a
  // corpus fund — which does not come back on its own — replenished as freely
  // as a revolving letter of credit.
  let contract;
  beforeEach(() => { contract = makeContract({ contract_type: 'PSA', status: 'ACTIVE' }); });

  const instrument = ({ type = 'LC', revolving = 1, limit = 1000000, drawn = 400000 } = {}) => {
    const id = `PSC-${Math.random().toString(36).slice(2, 10)}`;
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, is_revolving,
                limit_amount, utilized_amount, available_amount, waterfall_priority,
                validity_start, validity_end, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, '2026-01-01', '2030-01-01', 'PARTIALLY_UTILIZED')`)
      .run(id, `PS/R/${id.slice(-5)}`, contract.id, type, revolving, limit, drawn, limit - drawn);
    return id;
  };
  const replenish = (id, body) => request(app).post(`/api/payment-security/${id}/replenish`).set(auth(reia)).send(body);
  const drawnOn = (id) => db.prepare('SELECT utilized_amount FROM payment_security WHERE id = ?').get(id).utilized_amount;

  it('replenishes a revolving instrument without ceremony', async () => {
    const id = instrument({ revolving: 1 });
    const r = await replenish(id, { amount: 400000 });
    expect(r.status).toBeLessThan(400);
    expect(drawnOn(id)).toBe(0);
  });

  it('asks a non-revolving one what restored it', async () => {
    const id = instrument({ type: 'CORPUS_FUND', revolving: 0 });
    const r = await replenish(id, { amount: 400000 });
    expect(r.status, 'a fund that does not revolve was topped up on nobody’s say-so').toBe(400);
    expect(r.body.error).toMatch(/not revolving/i);
    expect(drawnOn(id), 'the draw was reversed anyway').toBe(400000);
  });

  it('accepts it once there is a reference', async () => {
    const id = instrument({ type: 'CORPUS_FUND', revolving: 0 });
    const r = await replenish(id, { amount: 400000, reason: 'NEFT UTR 1234 into the corpus, 12 Aug' });
    expect(r.status).toBeLessThan(400);
    expect(drawnOn(id)).toBe(0);
  });

  it('records what was said, and whether it revolved', async () => {
    const id = instrument({ type: 'CORPUS_FUND', revolving: 0 });
    await replenish(id, { amount: 400000, reason: 'NEFT UTR 1234' });
    const e = db.prepare(`SELECT * FROM security_events WHERE payment_security_id = ? AND event_type = 'REPLENISH'`).get(id);
    expect(String(e.details)).toMatch(/UTR 1234/);
    expect(String(e.details)).toMatch(/"is_revolving":0/);
  });

  it('will not restore more cover than was ever drawn', async () => {
    const id = instrument({ revolving: 1, limit: 1000000, drawn: 400000 });
    const r = await replenish(id, { amount: 900000 });
    expect(r.status, 'replenishing past the draw invents cover out of nothing').toBe(400);
    expect(drawnOn(id)).toBe(400000);
  });
});

describe('S24 An EMD or PBG on a buyer contract is a requirement too', () => {
  // These were read on a PPA and ignored on a PSA, so amounts entered on a buyer
  // contract because they had actually been furnished derived no requirement and
  // the instruments were never raised.
  it('derives them on a PSA', () => {
    const c = makeContract({ contract_type: 'PSA', status: 'ACTIVE', capacity_mw: 10, tariff_per_unit: 3,
      emd_amount: 1000000, pbg_amount: 5000000 });
    syncRequirementsFromContract(c.id);
    const rows = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(c.id);
    const byKind = Object.fromEntries(rows.map((r) => [`${r.mechanism_type}:${r.bg_subtype ?? ''}`, r.min_amount]));
    expect(byKind['BANK_GUARANTEE:EMD'], 'the EMD on the contract meant nothing').toBe(1000000);
    expect(byKind['BANK_GUARANTEE:PBG']).toBe(5000000);
    expect(byKind['LC:'], 'the LC requirement was lost in the process').toBeGreaterThan(0);
  });

  it('still derives them on a PPA', () => {
    const c = makeContract({ contract_type: 'PPA', status: 'ACTIVE', emd_amount: 250000, pbg_amount: 750000 });
    syncRequirementsFromContract(c.id);
    const rows = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(c.id);
    expect(rows.find((r) => r.bg_subtype === 'EMD').min_amount).toBe(250000);
    expect(rows.find((r) => r.bg_subtype === 'PBG').min_amount).toBe(750000);
  });

  it('leaves a contract carrying neither alone', () => {
    const c = makeContract({ contract_type: 'PPA', status: 'ACTIVE', emd_amount: null, pbg_amount: null });
    syncRequirementsFromContract(c.id);
    const rows = db.prepare('SELECT * FROM security_requirements WHERE contract_id = ?').all(c.id);
    expect(rows.filter((r) => r.mechanism_type === 'BANK_GUARANTEE')).toHaveLength(0);
  });
});
