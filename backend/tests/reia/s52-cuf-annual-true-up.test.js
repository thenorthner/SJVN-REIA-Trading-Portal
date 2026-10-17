import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { signToken } from '../../src/middleware/auth.js';
import { cufYearPosition } from '../../src/services/cufPenalty.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// CUF moved from a monthly deduction to an annual true-up (decided
// 17-Oct-2026): a monsoon month priced on its own came to ₹1.78 crore against a
// ₹57.6 lakh bill and stopped it. Monthly bills now carry the contract-year
// position as an indicator; a finished, fully locked contract year is priced
// once and settled by a credit note, approved by a second person.

let reia, finance, sellerCo, ppa;
const YEAR1 = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12'];
const energy = (contract, period, mwh, status = 'LOCKED') => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status, created_at)
  VALUES (?, ?, ?, 'FINAL', 'SEA', ?, ?, '2026-01-15 10:00:00')`).run(newId('ENG'), contract.id, period, mwh, status);
const post = (path, body, who = reia) => request(app).post(path).set(auth(who)).send(body);
const trueUp = (year = 1, who = reia, contract = ppa) => post('/api/notes/cuf-true-up', { contract_id: contract.id, contract_year: year }, who);
const anchor = () => makeInvoice({
  contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2025-12', invoice_type: 'FINAL',
  energy_mwh: 7000, tariff_per_unit: 2.88, energy_charges: 20160000, total_amount: 20160000,
});

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');
  sellerCo = makeEntity('SELLER');
  ppa = makeContract({
    contract_type: 'PPA', project_type: 'Solar', seller_id: sellerCo.id, capacity_mw: 50, commissioned_capacity_mw: 50,
    tariff_per_unit: 2.88, min_cuf_percent: 22, tenure_start: '2025-01-01', tenure_end: '2049-12-31', cod_date: '2025-01-01', status: 'ACTIVE',
  });
});

describe('S52 The contract year, worked out by hand', () => {
  it('prices a finished, fully locked year once: (22 % − 19.18 %) of 4,38,000 MWh × ₹2,880', () => {
    for (const p of YEAR1) energy(ppa, p, 7000);
    const y = cufYearPosition(ppa, '2025-12', { upTo: '2026-09' });
    // 50 MW × 8,760 h = 4,38,000 MWh possible; 84,000 made = 19.18 %; 22 % is 96,360 → 12,360 MWh short.
    expect(y).toMatchObject({ contract_year: 1, year_start: '2025-01', year_end: '2025-12', complete: true, possible_mwh: 438000, energy_mwh: 84000, shortfall_mwh: 12360, penalty: 12360 * 2880 });
    expect(y.cuf_percent).toBeCloseTo(19.18, 2);
  });

  it('starts the first year at the COD, not the tenure start', () => {
    db.prepare(`UPDATE contracts SET cod_date = '2025-07-01' WHERE id = ?`).run(ppa.id);
    for (const p of YEAR1.slice(6)) energy(ppa, p, 7000);
    const y = cufYearPosition({ ...ppa, cod_date: '2025-07-01' }, '2025-12', { upTo: '2026-09' });
    expect(y).toMatchObject({ assessed_from: '2025-07', complete: true, months_counted: 6 });
  });

  it('does not deduct CUF on a monthly bill; it shows the year so far', async () => {
    energy(ppa, '2025-07', 2000);
    const r = await post('/api/invoices/generate', { contract_id: ppa.id, period_month: '2025-07', invoice_type: 'FINAL' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.total_amount).toBe(2000 * 2880);
    const line = JSON.parse(r.body.invoice_breakdown_json).find((l) => l.code === 'PEN');
    expect(line).toMatchObject({ value: 0 });
    expect(line.label).toMatch(/contract year 1 so far .* assessed at the year end \(2025-12\), not deducted monthly/);
  });
});

describe('S52 Raising the true-up', () => {
  it('raises a draft credit note on the year\'s last bill, once, and a second person approves it', async () => {
    for (const p of YEAR1) energy(ppa, p, 7000);
    const bill = anchor();
    const r = await trueUp();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ state: 'NOTE_RAISED', penalty: 35596800, anchor_invoice: { id: bill.id } });
    const note = db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(r.body.raised_note_id);
    expect(note).toMatchObject({ note_type: 'CREDIT', status: 'DRAFT', reason_code: 'LIQUIDATED_DAMAGES', amount: 35596800, period_month: '2025-12', invoice_id: bill.id });
    expect(note.reason).toMatch(/^CUF true-up, contract year 1 \(2025-01 → 2025-12\): CUF 19\.18% against the minimum 22%/);

    expect((await trueUp()).status, 'a second true-up for the same year').toBe(409);
    expect((await post(`/api/notes/${note.id}/approve`, {}, reia)).status, 'its maker approved it').toBe(403);
    const ok = await post(`/api/notes/${note.id}/approve`, {}, finance);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // Applied up to what is open on the bill; the rest stays as credit for the contract's other bills.
    expect(ok.body).toMatchObject({ status: 'ISSUED', applied_amount: 20160000, unapplied_credit: 35596800 - 20160000 });
  });

  it('refuses a year in progress, one with a month not locked, one met, and a hydro station', async () => {
    const now = await trueUp(2);
    expect(now.status).toBe(400);
    expect(now.body.error).toMatch(/is not over yet/);

    for (const p of YEAR1.slice(0, 11)) energy(ppa, p, 7000);
    energy(ppa, '2025-12', 7000, 'VALIDATED');
    anchor();
    const open = await trueUp();
    expect(open.status).toBe(400);
    expect(open.body).toMatchObject({ months_missing: ['2025-12'] });

    const met = makeContract({ contract_type: 'PPA', project_type: 'Solar', seller_id: sellerCo.id, capacity_mw: 1, commissioned_capacity_mw: 1, tariff_per_unit: 2.88, min_cuf_percent: 22, tenure_start: '2025-01-01', cod_date: '2025-01-01', status: 'ACTIVE' });
    for (const p of YEAR1) energy(met, p, 250);
    expect((await trueUp(1, reia, met)).body.error).toMatch(/met its CUF/);

    const hydro = makeContract({ contract_type: 'PPA', project_type: 'Hydro', capacity_mw: 100, tenure_start: '2025-01-01', status: 'ACTIVE' });
    expect((await trueUp(1, reia, hydro)).body.error).toMatch(/carries no CUF obligation/);
  });

  it('is SJVN\'s to raise', async () => {
    const seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
    expect((await trueUp(1, seller)).status).toBe(403);
  });
});
