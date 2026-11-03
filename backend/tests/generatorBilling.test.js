import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { auth, tokenFor } from './helpers/reia.js';
import { newId } from '../src/util.js';

// A CERC two-part tariff bill for a hydro station: the capacity half of AFC by
// the days of the month and the beneficiary's share, and the energy half through
// an ECR worked out on the energy that can actually be sold.

let maker; let checker; let buyerId; let sellerId;

// NJHPS, 2026-27, as the Commercial department gave it: AFC Rs 1,700.8363 crore,
// design energy 6,612 MU, auxiliary consumption 1.2%, free energy to Himachal 12%
// — which their own working puts at an ECR of Rs 1.479/kWh.
const NJHPS = {
  station_name: 'Nathpa Jhakri HPS (NJHPS)',
  billing_month: '2026-06',
  afc: 17008363000,
  napaf: 87,
  actual_paf: 90,
  ex_bus_energy: 540000,
  design_energy_mu: 6612,
  aux_consumption_pct: 1.2,
  free_energy_pct: 12,
  allocation_pct: 25,
};

beforeEach(() => {
  db.prepare('DELETE FROM generator_bills').run();
  buyerId = newId('BUY');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, status)
              VALUES (?, 'BUYER', 'DISCOM', 'Punjab SPCL', 'APPROVED')`).run(buyerId);
  sellerId = newId('SEL');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, status)
              VALUES (?, 'SELLER', 'SOLAR', 'A Solar Park', 'APPROVED')`).run(sellerId);
  maker = tokenFor('REIA_MAKER');
  checker = tokenFor('REIA_CHECKER');
});

const generate = (o = {}, who = maker) => request(app).post('/api/generator-billing/generate').set(auth(who))
  .send({ ...NJHPS, beneficiary_id: buyerId, ...o });
const move = (id, status, who = checker) => request(app).post(`/api/generator-billing/${id}/status`).set(auth(who)).send({ status });

describe('pricing a generator bill', () => {
  it('derives the ECR on design energy net of auxiliary consumption and free energy', async () => {
    const r = await generate();
    expect(r.status).toBe(200);
    expect(r.body.ecr).toBeCloseTo(1.479, 3);
  });

  it('charges capacity by the days of the month and the beneficiary share', async () => {
    const r = await generate();
    // June: 30 days of the 365 in FY 2026-27, a quarter share, PAF above normative.
    expect(r.body.ndm).toBe(30);
    expect(r.body.ndy).toBe(365);
    expect(r.body.capacity_charge).toBeCloseTo(17008363000 * 0.5 * (30 / 365) * 0.25, 2);
    expect(r.body.energy_charge).toBeCloseTo(540000 * 1000 * r.body.ecr, 2);
  });

  it('reduces capacity pro rata when availability falls short', async () => {
    const r = await generate({ actual_paf: 43.5 });
    expect(r.body.capacity_charge).toBeCloseTo(17008363000 * 0.5 * (30 / 365) * 0.25 * 0.5, 2);
  });

  it('counts a leap February in the year it falls in', async () => {
    const r = await generate({ billing_month: '2024-02' });
    expect(r.body.ndm).toBe(29);
    expect(r.body.ndy).toBe(366);
  });
});

describe('what a generator bill refuses', () => {
  it('refuses inputs that cannot be right', async () => {
    for (const [o, msg] of [
      [{ afc: -17008363000 }, /afc/],
      [{ actual_paf: 250 }, /actual_paf/],
      [{ napaf: 0 }, /napaf/],
      [{ ex_bus_energy: 'abc' }, /ex_bus_energy/],
      [{ allocation_pct: '' }, /allocation_pct/],
      [{ allocation_pct: 140 }, /allocation_pct/],
    ]) {
      const r = await generate(o);
      expect(r.status, JSON.stringify(o)).toBe(400);
      expect(r.body.error).toMatch(msg);
    }
  });

  it('refuses a month that has not begun', async () => {
    const r = await generate({ billing_month: '2099-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/has not begun/);
  });

  it('bills a beneficiary, not a seller', async () => {
    const r = await generate({ beneficiary_id: sellerId });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/is not a buyer/);
  });

  it('knows a station however its name is typed', async () => {
    expect((await generate()).status).toBe(200);
    const again = await generate({ station_name: '  nathpa jhakri   HPS (NJHPS) ' });
    expect(again.status).toBe(409);
  });
});

describe('moving a generator bill on', () => {
  it('goes DRAFT to FINAL to PAID, one step at a time, by the checker', async () => {
    const { body: bill } = await generate();
    expect((await move(bill.id, 'FINAL', maker)).status).toBe(403);
    expect((await move(bill.id, 'PAID')).status).toBe(409);
    expect((await move(bill.id, 'FINAL')).status).toBe(200);
    expect((await move(bill.id, 'PAID')).status).toBe(200);
    const back = await move(bill.id, 'DRAFT');
    expect(back.status).toBe(409);
    expect(back.body.error).toMatch(/nothing follows it/);
  });
});
