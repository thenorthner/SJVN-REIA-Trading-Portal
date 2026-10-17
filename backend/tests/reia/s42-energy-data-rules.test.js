import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';
import { lastCompleteMonth } from '../../src/services/energyRules.js';

// Found by the browser audit of the Energy Data desk (16-Oct-2026).

const WIDE = { tenure_start: '2020-01-01', tenure_end: '2050-12-31', status: 'ACTIVE' };
let reia, seller, solar, hydro;
const thisMonth = new Date().toISOString().slice(0, 7);
const last = lastCompleteMonth();
// A past month of 31 days inside the tenure, for fixed arithmetic: 50 MW × 744 h.
const AUG = '2025-08';

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER');
  solar = makeContract({ ...WIDE, contract_no: 'S42-SOLAR', project_type: 'Solar', capacity_mw: 50, seller_id: seller.id });
  hydro = makeContract({ ...WIDE, contract_no: 'S42-HYDRO', project_type: 'Hydro', capacity_mw: 1500, seller_id: seller.id });
});

const record = (body) => request(app).post('/api/energy-data').set(auth(reia)).send({ period_month: AUG, ...body });
const validate = (id) => request(app).post(`/api/energy-data/${id}/validate`).set(auth(reia));
const lock = (id, reason) => request(app).post(`/api/energy-data/${id}/lock`).set(auth(reia)).send(reason ? { override_reason: reason } : {});

describe('S42 Recording a figure', () => {
  it('refuses the month still running and a future month', async () => {
    const r = await record({ contract_id: solar.id, period_month: thisMonth, energy_mwh: 100 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/has not ended yet/);
    expect((await record({ contract_id: solar.id, period_month: '2049-01', energy_mwh: 100 })).status).toBe(400);
    expect((await record({ contract_id: solar.id, period_month: last, energy_mwh: 100 })).status).toBe(201);
  });

  it('refuses more energy than the plant can make, with the arithmetic', async () => {
    const r = await record({ contract_id: solar.id, energy_mwh: 40000 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/50 MW × 744 h = 37200 MWh/);
    expect((await record({ contract_id: hydro.id, energy_mwh: 1300000 })).status).toBe(400); // 1500 × 744 × 1.1 = 1,227,600
  });

  it('takes a hydro PAF above 100% but not above 120%', async () => {
    expect((await record({ contract_id: hydro.id, energy_mwh: 700000, availability_percent: 109.667 })).status).toBe(201);
    expect((await record({ contract_id: hydro.id, energy_mwh: 700000, availability_percent: 121, source: 'REA' })).status).toBe(400);
    expect((await record({ contract_id: solar.id, energy_mwh: 8000, availability_percent: 101 })).status).toBe(400);
  });

  it('works out the CUF, and refuses one that contradicts the energy', async () => {
    const ok = await record({ contract_id: solar.id, energy_mwh: 8184 });
    expect(ok.body.cuf_percent).toBeCloseTo(22, 1); // 8184 / (50 × 744)
    const bad = await record({ contract_id: solar.id, energy_mwh: 8200, cuf_percent: 90, source: 'JMR' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/is 22\.04%/);
  });

  it('refuses negative deemed generation, a draft contract, and a PSA fed by a PPA', async () => {
    expect((await record({ contract_id: solar.id, energy_mwh: 100, deemed_generation_mwh: -5 })).status).toBe(400);
    const draft = makeContract({ ...WIDE, status: 'DRAFT', seller_id: seller.id });
    expect((await record({ contract_id: draft.id, energy_mwh: 100 })).status).toBe(400);
    const psa = makeContract({ ...WIDE, contract_type: 'PSA', capacity_mw: 50, buyer_id: makeEntity('BUYER').id });
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES ('CAL-S42', ?, ?, 100, '2020-01-01')`).run(solar.id, psa.id);
    const r = await record({ contract_id: psa.id, energy_mwh: 100 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/record the energy on the PPA/);
  });
});

describe('S42 Validation', () => {
  it('flags a figure above the physical maximum even inside hydro\'s wide band', async () => {
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES ('ENG-S42H', ?, ?, 'PROVISIONAL', 'REA', 1250000, 'DRAFT')`).run(hydro.id, AUG);
    const r = await validate('ENG-S42H');
    expect(r.body.status).toBe('DISPUTED');
    expect(r.body.deviation_notes).toMatch(/above the most the plant can make/);
  });

  it('prints the deviation to two decimals, so a pass and a fail at the line read differently', async () => {
    const a = (await record({ contract_id: solar.id, energy_mwh: 10639 })).body; // 29.997%
    expect((await validate(a.id)).body.deviation_notes).toMatch(/Deviation 30\.00%/);
    const b = (await record({ contract_id: solar.id, energy_mwh: 10640, period_month: '2025-07' })).body; // 30.01%
    const v = await validate(b.id);
    expect(v.body.status).toBe('DISPUTED');
    expect(v.body.deviation_notes).toMatch(/Deviation 30\.01%/);
  });

  it('compares sources of the same kind only, and flags both sides of a disagreement', async () => {
    const m = (await record({ contract_id: solar.id, energy_mwh: 8200 })).body;
    expect((await validate(m.id)).body.status).toBe('VALIDATED');
    const fin = (await record({ contract_id: solar.id, energy_mwh: 9000, source: 'JMR', data_type: 'FINAL' })).body;
    expect((await validate(fin.id)).body.deviation_notes).not.toMatch(/Source mismatch/);
    const s = (await record({ contract_id: solar.id, energy_mwh: 8400, source: 'SLDC' })).body;
    expect((await validate(s.id)).body.status).toBe('DISPUTED');
    expect(db.prepare('SELECT status FROM energy_data WHERE id = ?').get(m.id).status).toBe('DISPUTED');
  });
});

describe('S42 Locking and objections', () => {
  it('locks one figure per contract, month and kind', async () => {
    const a = (await record({ contract_id: solar.id, energy_mwh: 8200 })).body;
    await validate(a.id);
    expect((await lock(a.id)).status).toBe(200);
    const b = (await record({ contract_id: solar.id, energy_mwh: 8250, source: 'JMR' })).body;
    await validate(b.id);
    const r = await lock(b.id, 'Second figure for the same month, for the test');
    expect(r.status).toBe(409);
  });

  it('wants an override reason an auditor can read', async () => {
    const a = (await record({ contract_id: solar.id, energy_mwh: 2000 })).body;
    await validate(a.id); // DISPUTED: 75.6% short
    expect((await lock(a.id, 'x')).status).toBe(400);
    expect((await lock(a.id, 'NRLDC certified curtailment for the month')).status).toBe(200);
  });

  it('lets an upheld objection be corrected, and the corrected figure be locked', async () => {
    const sellerUser = tokenFor('SELLER', { linked_entity_id: seller.id });
    const a = (await record({ contract_id: solar.id, energy_mwh: 8350, source: 'JMR' })).body;
    await validate(a.id);
    const o = await request(app).post(`/api/energy-records/${a.id}/respond`).set(auth(sellerUser)).send({ response: 'OBJECTED', note: 'Our meter shows 8,200', claimed_mwh: 8200 });
    expect(o.status).toBe(200);
    await request(app).post(`/api/energy-records/${a.id}/resolve-objection`).set(auth(reia)).send({ outcome: 'UPHELD', note: 'Agreed' });
    expect((await lock(a.id)).status).toBe(400);
    const fixed = await record({ contract_id: solar.id, energy_mwh: 8200, source: 'JMR' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.response_status).toBeNull();
    await validate(a.id);
    expect((await lock(a.id)).status).toBe(200);
  });
});

describe('S42 Blocks and the counterparty view', () => {
  const blocks = (id, rows) => request(app).post(`/api/energy-records/${id}/blocks`).set(auth(reia))
    .attach('file', Buffer.from(['Date,Block,Scheduled MWh,Actual MWh', ...rows].join('\n')), 'b.csv');

  it('refuses blocks on a locked month, above a quarter-hour\'s output, or negative', async () => {
    const a = (await record({ contract_id: solar.id, energy_mwh: 8200 })).body;
    expect((await blocks(a.id, [`${AUG}-01,1,6,30`])).status).toBe(400); // 50 MW × 0.25 h = 12.5
    expect((await blocks(a.id, [`${AUG}-01,1,6,-1`])).status).toBe(400);
    await validate(a.id); await lock(a.id);
    expect((await blocks(a.id, [`${AUG}-01,1,6,6`])).status).toBe(400);
  });

  it('shows the counterparty no drafts, and the locked figure as the month\'s figure', async () => {
    const sellerUser = tokenFor('SELLER', { linked_entity_id: seller.id });
    const a = (await record({ contract_id: solar.id, energy_mwh: 8184 })).body;
    await validate(a.id); await lock(a.id);
    await record({ contract_id: solar.id, energy_mwh: 100, source: 'RLDC' }); // a later draft
    const list = await request(app).get('/api/energy-data').set(auth(sellerUser));
    expect(list.body.some((r) => r.status === 'DRAFT')).toBe(false);
    const an = await request(app).get('/api/energy-records/analytics').set(auth(sellerUser));
    expect(an.body.series.find((s) => s.period === AUG).energy_mwh).toBe(8184);
  });
});
