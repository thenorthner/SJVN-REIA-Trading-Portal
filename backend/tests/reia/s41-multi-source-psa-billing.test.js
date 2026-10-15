import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';
import { generateInvoicePdfBuffer } from '../../src/scripts/invoicePdf.js';

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
    expect(r.body.energy_charges).toBe(Math.round(800 * 1000 * 3));
    expect(r.body.trading_margin).toBe(Math.round(800 * 70));
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

  it('bills a provisional on whatever each source has, final or not', async () => {
    energy(ppaA, 1000);
    energy(ppaB, 450, { type: 'PROVISIONAL', status: 'VALIDATED' });
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
