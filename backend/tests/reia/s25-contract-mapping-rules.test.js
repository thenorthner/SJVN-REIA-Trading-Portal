import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Rules found missing by the browser audit of the Contracts desk (15-Oct-2026):
// every one of these was accepted, or shown wrongly, before.

let reia, seller, buyer;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER');
  buyer = makeEntity('BUYER');
});

const T = { tenure_start: '2026-11-01', tenure_end: '2051-10-31' };
const ppaOf = (o = {}) => makeContract({ contract_type: 'PPA', seller_id: seller.id, capacity_mw: 300, tariff_per_unit: 2.5, ...T, ...o });
const psaOf = (o = {}) => makeContract({ contract_type: 'PSA', buyer_id: buyer.id, capacity_mw: 180, tariff_per_unit: 2.57, ...T, ...o });
const map = (ppa, psa, pct, from = '2026-11-01', extra = {}) => request(app).post(`/api/contracts/${ppa.id}/allocations`).set(auth(reia))
  .send({ psa_id: psa.id, allocation_percent: pct, effective_from: from, ...extra });
const create = (body) => request(app).post('/api/contracts').set(auth(reia)).send({
  contract_no: 'S25-NEW', contract_type: 'PPA', seller_id: seller.id, project_type: 'Solar',
  capacity_mw: 10, tariff_per_unit: 2.5, ...T, ...body,
});

describe('S25 A contract is checked on the server, not only in the form', () => {
  it('refuses negative capacity, a negative tariff and a tenure that ends before it starts', async () => {
    const r = await create({ capacity_mw: -5, tariff_per_unit: -1, tenure_start: '2030-01-01', tenure_end: '2020-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.errors.join(' ')).toMatch(/capacity/i);
    expect(r.body.errors.join(' ')).toMatch(/tariff/i);
    expect(r.body.errors.join(' ')).toMatch(/tenure end/i);
  });

  it('refuses a zero tariff, CUF over 100% and a rebate window past the due date', async () => {
    const r = await create({ tariff_per_unit: 0, min_cuf_percent: 150, payment_terms_days: 30, rebate_pct: 2, rebate_days: 45 });
    expect(r.status).toBe(400);
    expect(r.body.errors.length).toBe(3);
  });

  it('treats "QA-1 " and "qa-1" as the number already on record, in words', async () => {
    expect((await create({ contract_no: 'QA-1' })).status).toBe(201);
    for (const no of ['QA-1', 'QA-1 ', 'qa-1']) {
      const r = await create({ contract_no: no });
      expect(r.status).toBe(409);
      expect(r.body.error).not.toMatch(/UNIQUE constraint/);
    }
  });

  it('stores one spelling per technology', async () => {
    const r = await create({ contract_no: 'S25-CASE', project_type: 'SOLAR' });
    expect(r.body.project_type).toBe('Solar');
  });

  it('searches for "%" literally instead of matching everything', async () => {
    ppaOf({ contract_no: 'PLAIN-1' });
    const r = await request(app).get('/api/contracts?q=%25').set(auth(reia));
    expect(r.body).toHaveLength(0);
  });

  it('discards an empty first draft, and nothing else', async () => {
    const draft = (await create({ contract_no: 'S25-DISCARD' })).body;
    expect((await request(app).delete(`/api/contracts/${draft.id}`).set(auth(reia))).status).toBe(200);
    const live = ppaOf({ status: 'ACTIVE' });
    expect((await request(app).delete(`/api/contracts/${live.id}`).set(auth(reia))).status).toBe(400);
  });
});

describe('S25 PPA → PSA mapping rules', () => {
  it('refuses a share that starts before either contract exists, or after one ends', async () => {
    const ppa = ppaOf(); const psa = psaOf();
    expect((await map(ppa, psa, 60, '2026-10-01')).status).toBe(400);
    expect((await map(ppa, psa, 60, '2060-01-01')).status).toBe(400);
  });

  it('says how much of the PPA is left when a share would exceed it', async () => {
    const ppa = ppaOf(); const a = psaOf(); const b = psaOf({ capacity_mw: 150, tariff_per_unit: 2.6 });
    expect((await map(ppa, a, 60)).status).toBe(201);
    const r = await map(ppa, b, 50);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Only 40% \(120 MW\) is left/);
    expect(r.body.error).not.toMatch(/\d\.\d{5,}/);
  });

  it('will not record the same PSA twice over the same dates', async () => {
    const ppa = ppaOf(); const psa = psaOf({ capacity_mw: 300 });
    expect((await map(ppa, psa, 20)).status).toBe(201);
    expect((await map(ppa, psa, 20)).status).toBe(409);
  });

  it('will not promise a PSA more MW than it contracts for', async () => {
    const ppa = ppaOf(); const psa = psaOf({ capacity_mw: 100 });
    const r = await map(ppa, psa, 50);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/150 MW/);
  });

  it('lets a PSA draw from several PPAs while their MW together fit it', async () => {
    // 180 MW PSA: 60% of a 300 MW PPA is 180 MW, so it is full.
    const ppa = ppaOf(); const other = ppaOf({ capacity_mw: 100, tariff_per_unit: 2.4 }); const psa = psaOf({ capacity_mw: 200 });
    expect((await map(ppa, psa, 60)).status).toBe(201);
    // 20 MW more fits the 200 MW it buys…
    expect((await map(other, psa, 20, '2026-11-01', { negative_spread_reason: 'Pooled tariff order' })).status).toBe(201);
    // …and a third source taking it past 200 MW does not.
    const third = ppaOf({ capacity_mw: 50 });
    const r = await map(third, psa, 10);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already receives 200 MW/);
    expect(r.body.received_from_other_sources_mw).toBe(200);
    expect(r.body.headroom_mw).toBe(0);
  });

  it('counts only the sources running at the same time as the new share', async () => {
    const a = ppaOf(); const b = ppaOf(); const psa = psaOf({ capacity_mw: 180 });
    // a supplies the whole 180 MW until the end of 2027; b takes over with 150 MW from 2028.
    expect((await map(a, psa, 60, '2026-11-01', { effective_to: '2027-12-31' })).status).toBe(201);
    expect((await map(b, psa, 50, '2028-01-01')).status).toBe(201);
    const c = ppaOf({ capacity_mw: 100 });
    // From mid-2027 the PSA is full on a; a and b never run together, so the
    // busiest point is 180 MW, not 330.
    const r = await map(c, psa, 10, '2027-06-01');
    expect(r.status).toBe(400);
    expect(r.body.received_from_other_sources_mw).toBe(180);
    // From 2028 there are 30 MW left beside b.
    expect((await map(c, psa, 10, '2028-01-01')).status).toBe(201);
  });

  it('asks for a reason before mapping a PSA that sells below its PPA', async () => {
    const ppa = ppaOf(); const psa = psaOf({ capacity_mw: 150, tariff_per_unit: 2.45 });
    const r = await map(ppa, psa, 40);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NEGATIVE_SPREAD');
    const ok = await map(ppa, psa, 40, '2026-11-01', { negative_spread_reason: 'Pooled tariff order 12/2026' });
    expect(ok.status).toBe(201);
    expect(ok.body.spread_per_unit).toBeCloseTo(-0.05);
  });

  it('refuses to map a contract that has ended', async () => {
    const ppa = ppaOf({ status: 'TERMINATED' }); const psa = psaOf();
    expect((await map(ppa, psa, 10)).status).toBe(400);
  });

  it('will not remove a share that has been billed', async () => {
    const ppa = ppaOf(); const psa = psaOf();
    const { id } = (await map(ppa, psa, 60)).body;
    makeInvoice({ contract_id: psa.id, billing_period: '2026-11', direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 1000 });
    const r = await request(app).delete(`/api/contracts/${ppa.id}/allocations/${id}`).set(auth(reia));
    expect(r.status).toBe(409);
  });
});

describe('S25 Lifecycle and versions', () => {
  it('ends a contract\'s shares on its termination date', async () => {
    const ppa = ppaOf({ status: 'ACTIVE' }); const psa = psaOf({ status: 'ACTIVE' });
    await map(ppa, psa, 60);
    const r = await request(app).post(`/api/contracts/${psa.id}/status`).set(auth(reia))
      .send({ status: 'TERMINATED', termination_date: '2026-12-31', termination_ground: 'FOR_CONVENIENCE' });
    expect(r.status).toBe(200);
    const a = db.prepare('SELECT effective_to FROM contract_allocations WHERE psa_id = ?').get(psa.id);
    expect(a.effective_to).toBe('2026-12-31');
  });

  it('refuses a termination dated after the contract ends', async () => {
    const ppa = ppaOf({ status: 'ACTIVE' });
    const r = await request(app).post(`/api/contracts/${ppa.id}/status`).set(auth(reia))
      .send({ status: 'TERMINATED', termination_date: '2099-01-01', termination_ground: 'FOR_CAUSE' });
    expect(r.status).toBe(400);
  });

  it('corrects a draft in place instead of versioning an unsigned contract', async () => {
    const psa = psaOf({ status: 'DRAFT' });
    const r = await request(app).post(`/api/contracts/${psa.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 2.6, amendment_reason: 'typo' });
    expect(r.status).toBe(200);
    expect(r.body.edited_in_place).toBe(true);
    expect(r.body.status).toBe('DRAFT');
    expect(db.prepare('SELECT COUNT(*) n FROM contracts WHERE parent_contract_id = ?').get(psa.id).n).toBe(0);
  });

  it('carries a PSA\'s source PPA onto its new version', async () => {
    const ppa = ppaOf({ status: 'ACTIVE' }); const psa = psaOf({ status: 'ACTIVE' });
    await map(ppa, psa, 60);
    const r = await request(app).post(`/api/contracts/${psa.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 2.6, effective_from: '2027-04-01', amendment_reason: 'CERC order' });
    expect(r.status).toBe(201);
    const links = db.prepare('SELECT * FROM contract_allocations WHERE psa_id = ?').all(r.body.id);
    expect(links).toHaveLength(1);
    expect(links[0].effective_from).toBe('2027-04-01');
  });

  it('hands the shares over on the amendment date when the new version goes live', async () => {
    const ppa = ppaOf({ status: 'ACTIVE' }); const psa = psaOf({ status: 'ACTIVE' });
    await map(ppa, psa, 60);
    const v2 = (await request(app).post(`/api/contracts/${ppa.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 2.4, effective_from: '2027-04-01', amendment_reason: 'CERC order' })).body;
    db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES ('DOC-S25', ?, 'CONTRACT', 'RECORD', 'Agreement')`).run(ppa.id);
    expect((await request(app).post(`/api/contracts/${v2.id}/status`).set(auth(reia)).send({ status: 'ACTIVE' })).status).toBe(200);
    expect(db.prepare('SELECT effective_to FROM contract_allocations WHERE ppa_id = ?').get(ppa.id).effective_to).toBe('2027-03-31');
    expect(db.prepare('SELECT effective_from FROM contract_allocations WHERE ppa_id = ?').get(v2.id).effective_from).toBe('2027-04-01');
  });

  it('records only the terms that changed, not the screen it came from', async () => {
    const ppa = ppaOf({ status: 'ACTIVE' });
    await request(app).post(`/api/contracts/${ppa.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 2.4, capacity_mw: 300, seller_name: 'X', versions: [{}], effective_from: '2027-04-01', amendment_reason: 'r' });
    const a = db.prepare('SELECT changed_fields_json FROM contract_amendments WHERE contract_id = ?').get(ppa.id);
    expect(Object.keys(JSON.parse(a.changed_fields_json))).toEqual(['tariff_per_unit']);
  });

  it('refuses commissioned capacity above the contracted capacity', async () => {
    const ppa = ppaOf({ status: 'ACTIVE' });
    const r = await request(app).post(`/api/contracts/${ppa.id}/amend`).set(auth(reia))
      .send({ capacity_mw: 240, commissioned_capacity_mw: 260, cod_date: '2026-12-01', effective_from: '2027-04-01', amendment_reason: 'r' });
    expect(r.status).toBe(400);
  });
});

describe('S25 Changing a PPA\'s split from a date', () => {
  const revise = (ppa, body) => request(app).post(`/api/contracts/${ppa.id}/allocations/revise`).set(auth(reia)).send(body);
  let ppa, a, b, c;
  beforeEach(async () => {
    ppa = ppaOf({ status: 'ACTIVE' });
    a = psaOf({ status: 'ACTIVE', capacity_mw: 200 });
    b = psaOf({ status: 'ACTIVE', capacity_mw: 200 });
    c = psaOf({ status: 'ACTIVE', capacity_mw: 200 });
    await map(ppa, a, 30); await map(ppa, b, 50); await map(ppa, c, 20);
  });

  it('ends the PSA left out and starts the new shares on the date', async () => {
    const r = await revise(ppa, { effective_from: '2027-01-01', reason: 'C exit notice', allocations: [{ psa_id: a.id, allocation_percent: 40 }, { psa_id: b.id, allocation_percent: 60 }] });
    expect(r.status).toBe(200);
    expect(r.body.previous_allocations_closed_on).toBe('2026-12-31');
    expect(r.body.ended_psa_nos).toEqual([c.contract_no]);
    expect(r.body.allocations.map((x) => x.share_mw)).toEqual([120, 180]);
  });

  it('refuses a date outside the PPA or a PSA\'s tenure', async () => {
    expect((await revise(ppa, { effective_from: '2026-06-01', allocations: [{ psa_id: a.id, allocation_percent: 100 }] })).status).toBe(400);
    expect((await revise(ppa, { effective_from: '2060-01-01', allocations: [{ psa_id: a.id, allocation_percent: 100 }] })).status).toBe(400);
  });

  it('refuses a PSA named twice, a share over the PSA\'s MW and a total over 100%', async () => {
    expect((await revise(ppa, { effective_from: '2027-01-01', allocations: [{ psa_id: a.id, allocation_percent: 20 }, { psa_id: a.id, allocation_percent: 20 }] })).status).toBe(400);
    const small = psaOf({ status: 'ACTIVE', capacity_mw: 50 });
    const over = await revise(ppa, { effective_from: '2027-01-01', allocations: [{ psa_id: small.id, allocation_percent: 50 }] });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/150 MW/);
    expect((await revise(ppa, { effective_from: '2027-01-01', allocations: [{ psa_id: a.id, allocation_percent: 60 }, { psa_id: b.id, allocation_percent: 60 }] })).status).toBe(400);
  });

  it('gives a share to a PSA another PPA supplies only while its MW fit, and refuses an ended PSA', async () => {
    const other = ppaOf({ status: 'ACTIVE', capacity_mw: 100 });
    const d = psaOf({ status: 'ACTIVE' });                       // 180 MW
    await map(other, d, 50);                                     // 50 MW from the other PPA
    const over = await revise(ppa, { effective_from: '2027-01-01', allocations: [{ psa_id: d.id, allocation_percent: 50 }] });
    expect(over.status).toBe(400);                               // 150 + 50 > 180
    expect(over.body.error).toMatch(/already receives 50 MW/);
    expect((await revise(ppa, { effective_from: '2027-01-01', allocations: [{ psa_id: d.id, allocation_percent: 40 }] })).status).toBe(200); // 120 + 50
    const gone = psaOf({ status: 'TERMINATED' });
    expect((await revise(ppa, { effective_from: '2027-01-01', allocations: [{ psa_id: gone.id, allocation_percent: 10 }] })).status).toBe(400);
  });

  it('asks for a reason before giving a share to a PSA priced below the PPA', async () => {
    const cheap = psaOf({ status: 'ACTIVE', tariff_per_unit: 2.4, capacity_mw: 200 });
    const body = { effective_from: '2027-01-01', allocations: [{ psa_id: a.id, allocation_percent: 50 }, { psa_id: cheap.id, allocation_percent: 50 }] };
    const r = await revise(ppa, body);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NEGATIVE_SPREAD');
    expect((await revise(ppa, { ...body, reason: 'Pooled tariff order' })).status).toBe(200);
  });

  it('will not restate a month already billed, and says the earliest date it can use', async () => {
    makeInvoice({ contract_id: a.id, billing_period: '2027-01', direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 1000 });
    const r = await revise(ppa, { effective_from: '2027-01-01', reason: 'r', allocations: [{ psa_id: a.id, allocation_percent: 60 }] });
    expect(r.status).toBe(409);
    expect(r.body.earliest_effective_from).toBe('2027-02-01');
    expect((await revise(ppa, { effective_from: '2027-02-01', reason: 'r', allocations: [{ psa_id: a.id, allocation_percent: 60 }] })).status).toBe(200);
  });
});
