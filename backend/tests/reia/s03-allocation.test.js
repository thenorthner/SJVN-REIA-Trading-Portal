import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, columnsOf, resetReia } from '../helpers/reia.js';

let reia, ppa, psas;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  const seller = makeEntity('SELLER');
  ppa = makeContract({ contract_type: 'PPA', capacity_mw: 100, seller_id: seller.id });
  psas = [30, 50, 20].map(pct => ({
    pct,
    contract: makeContract({ contract_type: 'PSA', capacity_mw: pct, buyer_id: makeEntity('BUYER').id }),
  }));
});

async function allocate(psaContractId, percent, effectiveFrom = '2026-04-01', effectiveTo = null) {
  return request(app).post(`/api/contracts/${ppa.id}/allocations`).set(auth(reia))
    .send({ psa_id: psaContractId, allocation_percent: percent, effective_from: effectiveFrom, effective_to: effectiveTo });
}

describe('S3 PPA to PSA allocation', () => {
  it('splits one PPA across three PSAs', async () => {
    for (const p of psas) expect((await allocate(p.contract.id, p.pct)).status).toBe(201);
    const rows = db.prepare('SELECT * FROM contract_allocations WHERE ppa_id = ?').all(ppa.id);
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.allocation_percent, 0)).toBe(100);
  });

  it('lists the allocations back against the PPA', async () => {
    for (const p of psas) await allocate(p.contract.id, p.pct);
    const r = await request(app).get(`/api/contracts/${ppa.id}/allocations`).set(auth(reia));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(3);
  });

  it('carries an effective window on every allocation', () => {
    expect(columnsOf('contract_allocations')).toEqual(
      expect.arrayContaining(['ppa_id', 'psa_id', 'allocation_percent', 'effective_from', 'effective_to']));
  });

  it('rejects a split that adds up to more than the whole PPA', async () => {
    await allocate(psas[0].contract.id, 60);
    await allocate(psas[1].contract.id, 60);
    const total = db.prepare('SELECT COALESCE(SUM(allocation_percent),0) t FROM contract_allocations WHERE ppa_id = ?').get(ppa.id).t;
    expect(total, 'allocations were allowed to exceed 100% of the PPA').toBeLessThanOrEqual(100);
  });

  it("splits a day's energy into three proportional allocations", async () => {
    for (const p of psas) await allocate(p.contract.id, p.pct);
    const r = await request(app).post('/api/energy-data').set(auth(reia))
      .send({ contract_id: ppa.id, period_month: '2026-04', data_type: 'FINAL', source: 'SEA', energy_mwh: 1000 });
    expect(r.status).toBeLessThan(400);
    const split = await request(app).post(`/api/contracts/${ppa.id}/allocate-energy`).set(auth(reia))
      .send({ period_month: '2026-04', energy_mwh: 1000 });
    expect(split.status, 'no endpoint splits PPA energy across its PSAs').toBeLessThan(400);
    if (split.status < 400) {
      const amounts = (split.body.allocations || []).map(a => a.energy_mwh).sort((a, b) => a - b);
      expect(amounts).toEqual([200, 300, 500]);
    }
  });

  it('raises one invoice per PSA, each traceable to the same PPA', async () => {
    for (const p of psas) await allocate(p.contract.id, p.pct);
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: ppa.id, billing_period: '2026-04', energy_mwh: 1000, split_by_allocation: true });
    const raised = db.prepare('SELECT * FROM invoices WHERE billing_period = ?').all('2026-04');
    expect(raised.length, 'one invoice per PSA was not raised from the PPA').toBe(3);
    const refs = new Set(raised.map(i => i.billing_family_ref).filter(Boolean));
    expect(refs.size, 'invoices do not share a reference back to the source PPA').toBe(1);
  });

  it('bills the old split before the change and the new split after it', async () => {
    // 30/50/20 until the end of May; from June the third PSA leaves and the
    // remaining two go to 37.5/62.5.
    await allocate(psas[0].contract.id, 30, '2026-04-01', '2026-05-31');
    await allocate(psas[1].contract.id, 50, '2026-04-01', '2026-05-31');
    await allocate(psas[2].contract.id, 20, '2026-04-01', '2026-05-31');
    await allocate(psas[0].contract.id, 37.5, '2026-06-01');
    await allocate(psas[1].contract.id, 62.5, '2026-06-01');

    const inForce = (onDate) => db.prepare(`
      SELECT psa_id, allocation_percent FROM contract_allocations
      WHERE ppa_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    `).all(ppa.id, onDate, onDate);

    const may = inForce('2026-05-15');
    expect(may).toHaveLength(3);
    expect(may.map(a => a.allocation_percent).sort((a, b) => a - b)).toEqual([20, 30, 50]);

    const june = inForce('2026-06-15');
    expect(june).toHaveLength(2);
    expect(june.map(a => a.allocation_percent).sort((a, b) => a - b)).toEqual([37.5, 62.5]);
  });

  it('does not retroactively restate an already-billed period when the split changes', async () => {
    await allocate(psas[0].contract.id, 30, '2026-04-01', '2026-05-31');
    const before = db.prepare('SELECT * FROM contract_allocations WHERE ppa_id = ?').all(ppa.id);
    await allocate(psas[0].contract.id, 37.5, '2026-06-01');
    const aprilStill = db.prepare(`
      SELECT allocation_percent FROM contract_allocations
      WHERE ppa_id = ? AND effective_from <= '2026-04-15' AND (effective_to IS NULL OR effective_to >= '2026-04-15')
    `).all(ppa.id);
    expect(aprilStill.map(a => a.allocation_percent)).toEqual([30]);
    expect(before.length).toBe(1);
  });
});
