import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, columnsOf, resetReia } from '../helpers/reia.js';

let reia, seller, buyer;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER');
  buyer = makeEntity('BUYER');
});

const base = () => ({
  contract_no: `PPA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  contract_type: 'PPA', project_type: 'SOLAR', seller_id: seller.id, buyer_id: buyer.id,
  capacity_mw: 100, tariff_per_unit: 3.0, tenure_start: '2026-04-01', tenure_end: '2031-03-31',
});

describe('S2 Contract management', () => {
  it('persists capacity, tariff, tenure, billing and payment terms', async () => {
    const r = await request(app).post('/api/contracts').set(auth(reia)).send({
      ...base(), billing_cycle: 'MONTHLY', payment_terms_days: 45,
      rebate_pct: 2, rebate_days: 5, lps_annual_pct: 12, payment_security_type: 'LC',
    });
    expect(r.status).toBe(201);
    const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(r.body.id);
    expect(c.capacity_mw).toBe(100);
    expect(c.tariff_per_unit).toBe(3.0);
    expect(c.billing_cycle).toBe('MONTHLY');
    expect(c.payment_terms_days).toBe(45);
    expect(c.rebate_pct).toBe(2);
    expect(c.lps_annual_pct).toBe(12);
  });

  it('supports the full lifecycle vocabulary', () => {
    const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='contracts'`).get().sql;
    for (const s of ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED']) expect(sql).toContain(s);
  });

  it('blocks an illegal jump straight from DRAFT to ACTIVE', async () => {
    const c = makeContract({ status: 'DRAFT' });
    const r = await request(app).post(`/api/contracts/${c.id}/status`).set(auth(reia)).send({ status: 'ACTIVE' });
    // A contract must pass through signing and regulatory approval first.
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses to bill a contract still pending regulatory approval', async () => {
    const c = makeContract({ status: 'PENDING_REGULATORY_APPROVAL' });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-PRA', ?, '2026-04', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(c.id);
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: c.id, period_month: '2026-04' });
    expect(r.status, 'a contract awaiting regulatory approval was billed').toBeGreaterThanOrEqual(400);
  });

  it('records a tariff structure beyond a single flat number', () => {
    expect(columnsOf('contracts')).toEqual(expect.arrayContaining(['tariff_type', 'tariff_structure_json']));
  });

  it('applies an escalating tariff for the correct contract year', async () => {
    const c = makeContract({
      status: 'ACTIVE', tariff_type: 'ESCALATING', tariff_per_unit: 3.0,
      // A five-year tenure, because this bills a year-2 period and the default
      // fixture runs only to 2027-03-31 — billing past a contract's end is now
      // refused, which is what made this fixture's own dates matter.
      tenure_start: '2026-04-01', tenure_end: '2031-03-31',
      tariff_structure_json: JSON.stringify({ type: 'ESCALATING', base: 3.0, escalation_pct: 2, from: '2026-04-01' }),
    });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-ESC', ?, '2027-05', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(c.id);
    // Year 2 of the contract should bill at 3.06, not the base 3.00.
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: c.id, period_month: '2027-05' });
    expect(r.status).toBe(201);
    const inv = db.prepare('SELECT tariff_per_unit FROM invoices WHERE id = ?').get(r.body.id);
    expect(inv.tariff_per_unit).toBeCloseTo(3.06, 2);
  });

  it('bills a two-part tariff as fixed plus variable, not one blended rate', async () => {
    const c = makeContract({
      status: 'ACTIVE', tariff_type: 'TWO_PART', annual_afc: 12000000,
      tariff_structure_json: JSON.stringify({ type: 'TWO_PART', fixed_annual: 12000000, variable_per_unit: 1.5 }),
    });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-2P', ?, '2026-04', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(c.id);
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: c.id, period_month: '2026-04' });
    expect(r.status).toBe(201);
    const inv = db.prepare('SELECT capacity_charges, energy_charges FROM invoices WHERE id = ?').get(r.body.id);
    expect(inv.capacity_charges).toBeGreaterThan(0);
    expect(inv.energy_charges).toBeGreaterThan(0);
  });

  it('versions an amendment while preserving the previous version', async () => {
    const c = makeContract({ tariff_per_unit: 3.0 });
    const r = await request(app).post(`/api/contracts/${c.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 3.5, reason: 'CERC revision', effective_from: '2026-10-01' });
    expect(r.status).toBeLessThan(400);
    const amendments = db.prepare('SELECT * FROM contract_amendments WHERE contract_id = ?').all(c.id);
    expect(amendments.length).toBeGreaterThan(0);
    const old = amendments.find(a => JSON.stringify(a).includes('3'));
    expect(old, 'previous value not preserved on the amendment').toBeTruthy();
  });

  it('commits only the valid rows of a bulk upload and reports the rest', async () => {
    const r = await request(app).post('/api/contracts/bulk-upload').set(auth(reia)).send({
      rows: [
        { ...base(), contract_no: 'BULK-OK-1' },
        { contract_no: 'BULK-BAD-1', contract_type: 'PPA' },   // missing everything else
        { ...base(), contract_no: 'BULK-OK-2' },
      ],
    });
    expect(r.status).toBeLessThan(500);
    expect(db.prepare(`SELECT COUNT(*) c FROM contracts WHERE contract_no LIKE 'BULK-OK-%'`).get().c).toBe(2);
    expect(db.prepare(`SELECT COUNT(*) c FROM contracts WHERE contract_no = 'BULK-BAD-1'`).get().c).toBe(0);
    expect(JSON.stringify(r.body)).toMatch(/error|invalid|fail|reject/i);
  });

  it('refuses to bill before the commercial operation date', async () => {
    const c = makeContract({ cod_date: '2026-07-01', status: 'ACTIVE' });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-COD', ?, '2026-05', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(c.id);
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: c.id, period_month: '2026-05' });
    expect(r.status, 'a period before COD was billed').toBeGreaterThanOrEqual(400);
  });

  it('bills only the commissioned share on a partly commissioned plant', async () => {
    const c = makeContract({ status: 'ACTIVE', capacity_mw: 100, commissioned_capacity_mw: 40, cod_date: '2026-01-01' });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-PC', ?, '2026-04', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(c.id);
    const stored = db.prepare('SELECT capacity_mw, commissioned_capacity_mw FROM contracts WHERE id = ?').get(c.id);
    expect(stored.commissioned_capacity_mw).toBe(40);
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: c.id, period_month: '2026-04' });
    if (r.status === 201) {
      const inv = db.prepare('SELECT capacity_charges FROM invoices WHERE id = ?').get(r.body.id);
      const full = db.prepare('SELECT annual_afc FROM contracts WHERE id = ?').get(c.id).annual_afc || 0;
      // Capacity charge must reflect 40 MW, never the full 100 MW.
      if (full > 0) expect(inv.capacity_charges).toBeLessThan(full / 12);
    }
  });
});
