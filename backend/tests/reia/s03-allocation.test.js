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
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-FAN', ?, '2026-04', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(ppa.id);

    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: ppa.id, period_month: '2026-04', split_by_allocation: true });
    expect(r.status).toBe(201);
    expect(r.body.count).toBe(3);

    const raised = db.prepare('SELECT * FROM invoices WHERE billing_period = ?').all('2026-04');
    expect(raised.length, 'one invoice per PSA was not raised from the PPA').toBe(3);
    const refs = new Set(raised.map(i => i.billing_family_ref).filter(Boolean));
    expect(refs.size, 'invoices do not share a reference back to the source PPA').toBe(1);
    // Each PSA is billed its own share of the PPA's energy.
    expect(raised.map(i => i.energy_mwh).sort((a, b) => a - b)).toEqual([200, 300, 500]);
  });

  it('bills no PSA at all if any one of them cannot be billed', async () => {
    for (const p of psas) await allocate(p.contract.id, p.pct);
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
                VALUES ('ENG-PART', ?, '2026-04', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(ppa.id);
    // One PSA is not billable, so the whole period must be refused rather than
    // billing two buyers and silently leaving the third out.
    db.prepare(`UPDATE contracts SET status = 'DRAFT' WHERE id = ?`).run(psas[2].contract.id);

    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: ppa.id, period_month: '2026-04', split_by_allocation: true });
    expect(r.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) c FROM invoices').get().c).toBe(0);
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

describe('S3 Allocations change over the life of a PPA', () => {
  // A buyer leaving mid-term and the others taking up its share is one business
  // event, and there was no way to record it: allocations could only be created,
  // never ended or amended, so a new row for the remaining buyers was refused
  // for taking the PPA past 100% while the old rows ran open-ended. Billing then
  // read allocations with no date filter at all, so even the dates that could be
  // written were never honoured — a PSA that ended in July kept being billed.

  let ppa, A, B, C, reia;
  beforeEach(() => {
    reia = tokenFor('REIA_USER');
    ppa = makeContract({ contract_type: 'PPA', status: 'ACTIVE', capacity_mw: 100 });
    [A, B, C] = ['A', 'B', 'C'].map(() => makeContract({ contract_type: 'PSA', status: 'ACTIVE', capacity_mw: 100, tariff_per_unit: 4 }));
  });

  const allocate = (psa, pct, from = '2026-04-01') =>
    request(app).post(`/api/contracts/${ppa.id}/allocations`).set(auth(reia))
      .send({ psa_id: psa.id, allocation_percent: pct, effective_from: from });

  const revise = (body) =>
    request(app).post(`/api/contracts/${ppa.id}/allocations/revise`).set(auth(reia)).send(body);

  const billedMwh = async (psa, period, ppaMwh = 80) => {
    const existing = db.prepare('SELECT id FROM energy_data WHERE contract_id = ? AND period_month = ?').get(ppa.id, period);
    if (!existing) {
      await request(app).post('/api/energy-data').set(auth(reia))
        .send({ contract_id: ppa.id, period_month: period, data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: ppaMwh });
    }
    const r = await request(app).post('/api/invoices/generate').set(auth(reia))
      .send({ contract_id: psa.id, period_month: period });
    return { status: r.status, mwh: r.body?.energy_mwh, error: r.body?.error };
  };

  const setup30_50_20 = async () => {
    await allocate(A, 30); await allocate(B, 50); await allocate(C, 20);
  };

  it('re-splits from a date, ending the PSA left out of the list', async () => {
    await setup30_50_20();
    const r = await revise({
      effective_from: '2026-07-01',
      allocations: [{ psa_id: A.id, allocation_percent: 37.5 }, { psa_id: B.id, allocation_percent: 62.5 }],
      reason: 'Buyer C contract ended 30 June',
    });
    expect(r.status, 'a PPA could not be re-split at all').toBe(200);
    expect(r.body.ended_psa_ids).toContain(C.id);
    expect(r.body.previous_allocations_closed_on).toBe('2026-06-30');
  });

  it('bills the period before the change on the old split', async () => {
    await setup30_50_20();
    await revise({ effective_from: '2026-07-01', allocations: [{ psa_id: A.id, allocation_percent: 37.5 }, { psa_id: B.id, allocation_percent: 62.5 }] });
    expect((await billedMwh(A, '2026-06')).mwh, 'June did not bill on the 30% that was in force then').toBe(24);
    expect((await billedMwh(B, '2026-06')).mwh).toBe(40);
    expect((await billedMwh(C, '2026-06')).mwh).toBe(16);
  });

  it('bills the period after the change on the new split', async () => {
    await setup30_50_20();
    await revise({ effective_from: '2026-07-01', allocations: [{ psa_id: A.id, allocation_percent: 37.5 }, { psa_id: B.id, allocation_percent: 62.5 }] });
    expect((await billedMwh(A, '2026-07')).mwh, 'July still billed the old 30%').toBe(30);   // 37.5% of 80
    expect((await billedMwh(B, '2026-07')).mwh).toBe(50);                                    // 62.5% of 80
  });

  it('stops billing a PSA whose share has ended', async () => {
    await setup30_50_20();
    await revise({ effective_from: '2026-07-01', allocations: [{ psa_id: A.id, allocation_percent: 37.5 }, { psa_id: B.id, allocation_percent: 62.5 }] });
    const r = await billedMwh(C, '2026-07');
    expect(r.status, 'a PSA whose contract had ended was still billed').toBe(400);
    expect(r.error).toMatch(/no allocation for 2026-07/i);
  });

  it('leaves invoices already raised on the old split alone', async () => {
    await setup30_50_20();
    const before = await billedMwh(C, '2026-06');
    expect(before.mwh).toBe(16);
    await revise({ effective_from: '2026-07-01', allocations: [{ psa_id: A.id, allocation_percent: 37.5 }, { psa_id: B.id, allocation_percent: 62.5 }] });
    const row = db.prepare(`SELECT energy_mwh FROM invoices WHERE contract_id = ? AND billing_period = '2026-06'`).get(C.id);
    expect(row.energy_mwh, 'a prior invoice was retroactively recalculated').toBe(16);
  });

  it('refuses a re-split that comes to more than the PPA', async () => {
    await setup30_50_20();
    const r = await revise({ effective_from: '2026-07-01', allocations: [{ psa_id: A.id, allocation_percent: 60 }, { psa_id: B.id, allocation_percent: 60 }] });
    expect(r.status).toBe(400);
    expect(r.body.requested_total_percent).toBe(120);
    // and nothing moved
    expect((await billedMwh(A, '2026-07')).mwh).toBe(24);
  });

  it('frees the departed share for a new PSA to take up', async () => {
    await setup30_50_20();
    await revise({ effective_from: '2026-07-01', allocations: [{ psa_id: A.id, allocation_percent: 30 }, { psa_id: B.id, allocation_percent: 50 }] });
    const D = makeContract({ contract_type: 'PSA', status: 'ACTIVE', capacity_mw: 100, tariff_per_unit: 4 });
    const r = await allocate(D, 20, '2026-07-01');
    expect(r.status, "the share released by C was not available to re-allocate").toBe(201);
  });

  it('needs a date and the complete new split, not a partial edit', async () => {
    await setup30_50_20();
    expect((await revise({ allocations: [{ psa_id: A.id, allocation_percent: 50 }] })).status).toBe(400);
    expect((await revise({ effective_from: '2026-07-01' })).status).toBe(400);
  });

  it('records what the split was and what it became', async () => {
    await setup30_50_20();
    await revise({ effective_from: '2026-07-01', allocations: [{ psa_id: A.id, allocation_percent: 37.5 }, { psa_id: B.id, allocation_percent: 62.5 }], reason: 'C exited' });
    const a = db.prepare(`SELECT * FROM audit_logs WHERE action = 'REVISE_ALLOCATION' ORDER BY created_at DESC`).get();
    expect(a, 'a re-split left no audit trail').toBeTruthy();
    expect(a.details).toMatch(/before/);
    expect(a.details).toMatch(/after/);
  });

  it('accepts an allocation with no effective_from', async () => {
    // Optional in the API's own signature, but the fallback referenced a
    // variable that did not exist in scope and threw a 500.
    const r = await request(app).post(`/api/contracts/${ppa.id}/allocations`).set(auth(reia))
      .send({ psa_id: A.id, allocation_percent: 25 });
    expect(r.status, 'omitting the optional effective_from crashed the route').toBe(201);
  });

  it('says how to end a share when asked to allocate zero', async () => {
    const r = await allocate(A, 0);
    expect(r.status).toBe(400);
    expect(r.body.error, 'the message claimed 0 was allowed while refusing it').toMatch(/revise/i);
  });
});
