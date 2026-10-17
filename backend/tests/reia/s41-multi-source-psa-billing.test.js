import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';
import { generateInvoicePdfBuffer } from '../../src/scripts/invoicePdf.js';
import { resolveBetaRow } from '../../src/services/betaFactor.js';

// A DISCOM's PSA is often backed by several developers' PPAs at once. Its bill
// took the energy of only the latest one, so the buyer was billed for part of
// what it received — and mapping a second source was refused to hide that.

let reia, ppaA, ppaB, psa;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  ppaA = makeContract({ contract_type: 'PPA', contract_no: 'PPA-A', capacity_mw: 100, tariff_per_unit: 2.5, seller_id: makeEntity('SELLER').id });
  ppaB = makeContract({ contract_type: 'PPA', contract_no: 'PPA-B', capacity_mw: 50, tariff_per_unit: 2.5, seller_id: makeEntity('SELLER').id });
  psa = makeContract({ contract_type: 'PSA', contract_no: 'PSA-X', capacity_mw: 100, tariff_per_unit: 3, buyer_id: makeEntity('BUYER').id });
});

const map = (ppa, pct, from = '2026-04-01', extra = {}) => request(app).post(`/api/contracts/${ppa.id}/allocations`).set(auth(reia))
  .send({ psa_id: psa.id, allocation_percent: pct, effective_from: from, ...extra });
const energy = (ppa, mwh, { period = '2026-05', type = 'FINAL', status = 'LOCKED', id } = {}) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
  VALUES (?, ?, ?, ?, 'SEA', ?, ?)`).run(id || `ENG-${ppa.contract_no}-${period}-${type}`, ppa.id, period, type, mwh, status);
const bill = (contractId, body = {}) => request(app).post('/api/invoices/generate').set(auth(reia))
  .send({ contract_id: contractId, period_month: '2026-05', ...body });
const lines = (inv) => JSON.parse(inv.invoice_breakdown_json);
const trailOf = (query) => request(app).get(`/api/billing-trail?${query}`).set(auth(reia));

describe('S41 A PSA supplied by two PPAs at once', () => {
  beforeEach(async () => {
    expect((await map(ppaA, 60)).status).toBe(201);   // 60 MW
    expect((await map(ppaB, 40)).status).toBe(201);   // 20 MW — 80 of the 100 MW it buys
  });

  it('bills the sum of its share of each', async () => {
    energy(ppaA, 1000); energy(ppaB, 500);
    const r = await bill(psa.id);
    expect(r.status).toBe(201);
    expect(r.body.energy_mwh).toBe(800);                        // 600 + 200
    // The ₹70/MWh margin is inside the ₹3 PSA rate: energy at ₹2.93 + margin = 800 × ₹3.
    expect(r.body.energy_charges).toBe(Math.round(800 * 1000 * 3) - Math.round(800 * 70));
    expect(r.body.trading_margin).toBe(Math.round(800 * 70));
    expect(r.body.energy_charges + r.body.trading_margin).toBe(800 * 1000 * 3);
  });

  it('shows on the bill where the MWh came from', async () => {
    energy(ppaA, 1000); energy(ppaB, 500);
    const inv = (await bill(psa.id)).body;
    const shares = lines(inv).filter((l) => l.code === 'ALLOC');
    expect(shares.map((l) => [l.ppa_contract_no, l.allocation_percent, l.value])).toEqual([['PPA-A', 60, 600], ['PPA-B', 40, 200]]);
    const sources = lines(inv).filter((l) => l.code === 'SRC');
    expect(sources.map((l) => [l.ppa_contract_no, l.value, l.energy_data_id])).toEqual([
      ['PPA-A', 1000, 'ENG-PPA-A-2026-05-FINAL'], ['PPA-B', 500, 'ENG-PPA-B-2026-05-FINAL']]);
    expect(lines(inv).find((l) => l.code === 'E1').value).toBe(800);
    // The bill itself stays on one page; the sources get a page of their own.
    const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
    expect(pages(await generateInvoicePdfBuffer(inv, psa, null, null))).toBe(2);
  });

  it('refuses the month while one source has no energy, and names it', async () => {
    energy(ppaA, 1000);
    const r = await bill(psa.id);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/PPA-B has no energy for 2026-05/);
    expect(r.body.missing_source_ppas).toEqual(['PPA-B']);
    expect(db.prepare('SELECT COUNT(*) n FROM invoices').get().n).toBe(0);
  });

  it('takes FINAL energy over provisional for each source, as one source does', async () => {
    energy(ppaA, 900, { type: 'PROVISIONAL', status: 'VALIDATED' });
    energy(ppaA, 1000);
    energy(ppaB, 500);
    const r = await bill(psa.id, { invoice_type: 'FINAL' });
    expect(r.status).toBe(201);
    expect(r.body.energy_mwh).toBe(800);
  });

  it('refuses a FINAL bill while one source is still unlocked, and says which', async () => {
    energy(ppaA, 1000);
    energy(ppaB, 500, { status: 'VALIDATED' });
    const r = await bill(psa.id, { invoice_type: 'FINAL' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^PPA-B: .*not LOCKED/);
  });

  it('bills a provisional on whatever each source has locked, final or not', async () => {
    energy(ppaA, 1000);
    energy(ppaB, 450, { type: 'PROVISIONAL', status: 'LOCKED' });
    const r = await bill(psa.id);
    expect(r.status).toBe(201);
    expect(r.body.invoice_type).toBe('PROVISIONAL');
    expect(r.body.energy_mwh).toBe(780);                        // 600 + 180
  });

  it('bills only the sources in force on the first day of the month', async () => {
    // A third PPA from mid-May counts from the June bill.
    const ppaC = makeContract({ contract_type: 'PPA', contract_no: 'PPA-C', capacity_mw: 20, tariff_per_unit: 2.5 });
    expect((await map(ppaC, 50, '2026-05-15')).status).toBe(201);
    energy(ppaA, 1000); energy(ppaB, 500);
    const r = await bill(psa.id);
    expect(r.status).toBe(201);
    expect(r.body.energy_mwh).toBe(800);
  });

  it('bills the PSA once when either PPA fans out its bills', async () => {
    energy(ppaA, 1000); energy(ppaB, 500);
    const viaA = await bill(ppaA.id, { split_by_allocation: true });
    expect(viaA.status).toBe(201);
    expect(viaA.body.invoices[0].energy_mwh).toBe(800);
    // B's only PSA is already billed with B's share on it — not a failure, and not a second bill.
    const viaB = await bill(ppaB.id, { split_by_allocation: true });
    expect(viaB.status).toBe(409);
    expect(viaB.body.already_billed[0].invoice_no).toBe(viaA.body.invoices[0].invoice_no);
    expect(db.prepare(`SELECT COUNT(*) n FROM invoices WHERE contract_id = ?`).get(psa.id).n).toBe(1);
  });

  it('still bills the other PSAs of a fan-out when one is already billed via its other source', async () => {
    const solo = makeContract({ contract_type: 'PSA', contract_no: 'PSA-SOLO', capacity_mw: 50, tariff_per_unit: 3 });
    expect((await request(app).post(`/api/contracts/${ppaB.id}/allocations`).set(auth(reia))
      .send({ psa_id: solo.id, allocation_percent: 60, effective_from: '2026-04-01' })).status).toBe(201);
    energy(ppaA, 1000); energy(ppaB, 500);
    expect((await bill(psa.id)).status).toBe(201);
    const viaB = await bill(ppaB.id, { split_by_allocation: true });
    expect(viaB.status).toBe(201);
    expect(viaB.body.count).toBe(1);
    expect(viaB.body.invoices[0].energy_mwh).toBe(300);
    expect(viaB.body.already_billed.map((a) => a.psa_contract_no)).toEqual(['PSA-X']);
  });

  it('will not blend two hydro stations into one CERC bill', async () => {
    db.prepare(`UPDATE contracts SET project_type = 'Hydro', annual_afc = 1000000 WHERE id = ?`).run(psa.id);
    energy(ppaA, 1000); energy(ppaB, 500);
    const r = await bill(psa.id);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/hydro PSA drawing from 2 stations/);
  });
});

describe('S41 A single-source PSA bills as it did', () => {
  it('keeps the source and allocation lines of one PPA', async () => {
    expect((await map(ppaA, 60)).status).toBe(201);
    energy(ppaA, 1000);
    const inv = (await bill(psa.id)).body;
    expect(inv.energy_mwh).toBe(600);
    expect(inv.energy_data_id).toBe('ENG-PPA-A-2026-05-FINAL');
    expect(lines(inv).filter((l) => ['SRC', 'ALLOC'].includes(l.code)).map((l) => [l.code, l.value])).toEqual([['SRC', 1000], ['ALLOC', 600]]);
    const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
    expect(pages(await generateInvoicePdfBuffer(inv, psa, null, null))).toBe(1);
  });
});

describe('S41 The Settlement Trail of a PSA supplied by two PPAs', () => {
  beforeEach(async () => {
    expect((await map(ppaA, 60)).status).toBe(201);
    expect((await map(ppaB, 40)).status).toBe(201);
  });

  it('lists every source PPA with its share and energy, and sums the month across them', async () => {
    energy(ppaA, 900, { type: 'PROVISIONAL', status: 'LOCKED' }); energy(ppaA, 1000);
    energy(ppaB, 450, { type: 'PROVISIONAL', status: 'VALIDATED' }); energy(ppaB, 500);
    const r = await trailOf(`contract_id=${psa.id}&period_month=2026-05`);
    expect(r.status).toBe(200);
    const topo = r.body.linked_topology;
    expect(topo.source_count).toBe(2);
    expect(topo.allocation_percent).toBeNull();          // no one share stands for the PSA
    expect(topo.sources.map((s) => [s.contract_no, s.allocation_percent, s.provisional_mwh, s.final_mwh, s.allocated_mwh]))
      .toEqual([['PPA-A', 60, 900, 1000, 600], ['PPA-B', 40, 450, 500, 200]]);
    expect(r.body.provisional_energy).toMatchObject({ energy_mwh: 1350, allocated_mwh: 720, status: 'VALIDATED', multi_source: true });
    expect(r.body.final_energy).toMatchObject({ energy_mwh: 1500, allocated_mwh: 800, status: 'LOCKED' });
    expect(r.body.final_energy.energy_data_ids).toEqual(['ENG-PPA-A-2026-05-FINAL', 'ENG-PPA-B-2026-05-FINAL']);
    expect(r.body.delta_mwh).toBe(150);
    expect(topo.hub.allocated_mwh).toBe(800);
    expect(topo.hub.spread_amount).toBe(Math.round(800 * 1000 * 0.5));   // ₹3.00 − ₹2.50 on what the PSA takes
  });

  it('opened from the bill, matches the energy the bill was worked on', async () => {
    energy(ppaA, 1000); energy(ppaB, 500);
    const inv = (await bill(psa.id)).body;
    const trail = (await trailOf(`invoice_id=${inv.id}`)).body;
    expect(trail.linked_topology.sources.map((s) => s.contract_no)).toEqual(['PPA-A', 'PPA-B']);
    expect(trail.final_energy.allocated_mwh).toBe(inv.energy_mwh);
  });

  it('states no final figure while one source has none, and still lists that source', async () => {
    energy(ppaA, 1000);
    energy(ppaB, 450, { type: 'PROVISIONAL', status: 'VALIDATED' });
    const trail = (await trailOf(`contract_id=${psa.id}&period_month=2026-05`)).body;
    expect(trail.final_energy).toBeNull();
    expect(trail.delta_mwh).toBeNull();
    expect(trail.linked_topology.sources.map((s) => [s.contract_no, s.final_mwh])).toEqual([['PPA-A', 1000], ['PPA-B', null]]);
  });

  it('shows only the sources in force for the period', async () => {
    const ppaC = makeContract({ contract_type: 'PPA', contract_no: 'PPA-C', capacity_mw: 20, tariff_per_unit: 2.5 });
    expect((await map(ppaC, 50, '2026-06-01')).status).toBe(201);
    const may = (await trailOf(`contract_id=${psa.id}&period_month=2026-05`)).body.linked_topology;
    expect(may.sources.map((s) => s.contract_no)).toEqual(['PPA-A', 'PPA-B']);
    const june = (await trailOf(`contract_id=${psa.id}&period_month=2026-06`)).body.linked_topology;
    expect(june.sources.map((s) => s.contract_no)).toEqual(['PPA-A', 'PPA-C', 'PPA-B']);
  });
});

describe('S41 The trail of a single-source PSA reads as it did', () => {
  it('keeps one PPA, its share, and that PPA\'s own energy row', async () => {
    expect((await map(ppaA, 60)).status).toBe(201);
    energy(ppaA, 1000);
    const trail = (await trailOf(`contract_id=${psa.id}&period_month=2026-05`)).body;
    expect(trail.linked_topology.allocation_percent).toBe(60);
    expect(trail.linked_topology.ppa.contract_no).toBe('PPA-A');
    expect(trail.linked_topology.sources.map((s) => [s.contract_no, s.allocated_mwh])).toEqual([['PPA-A', 600]]);
    expect(trail.final_energy).toMatchObject({ id: 'ENG-PPA-A-2026-05-FINAL', energy_mwh: 1000 });
  });
});

describe('S41 A PSA\'s Beta certificate comes from the station in force that month', () => {
  it('takes the PPA the PSA drew from, not an earlier one it has since left', () => {
    const add = (id, ppa, from, to) => db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
      VALUES (?, ?, ?, 100, ?, ?)`).run(id, ppa.id, psa.id, from, to);
    const beta = (id, ppa, v) => db.prepare(`INSERT INTO station_beta (id, contract_id, period_month, beta_value) VALUES (?, ?, '2026-05', ?)`).run(id, ppa.id, v);
    add('AL-OLD', ppaA, '2026-01-01', '2026-04-30');
    add('AL-NEW', ppaB, '2026-05-01', null);
    beta('B-A', ppaA, 0.4); beta('B-B', ppaB, 0.7);
    expect(resolveBetaRow(psa, '2026-05').id).toBe('B-B');
    expect(resolveBetaRow(psa, '2026-04')).toBeNull();     // A held it then, but A has no β for April
  });
});
