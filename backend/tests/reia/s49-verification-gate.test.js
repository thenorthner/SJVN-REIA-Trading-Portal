import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Found by the browser audit of the verification queue (17-Oct-2026): a bill
// billed at ₹3.10 on a ₹2.88 PPA was approved at all three levels with its
// tariff check FAILED; the failed check could be cleared without a word; a save
// took any status, the energy charges and negative damages from the request; a
// seller could read another company's checklist; and four of the seven queue
// rows were DSM pool bills and SJVN's computed bills "failing" the tariff check.

let reia, sellerCo, seller, ppa;
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const lockEnergy = (contract, period, mwh, cuf = 22) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, status)
  VALUES (?, ?, ?, 'FINAL', 'SEA', ?, ?, 'LOCKED')`).run(`ENG-${Math.random().toString(36).slice(2, 9)}`, contract.id, period, mwh, cuf);
const raise = async (over = {}) => {
  const body = { contract_id: ppa.id, billing_period: '2026-08', invoice_type: 'FINAL', energy_mwh: 8200, tariff_per_unit: 2.88, energy_charges: 23616000, ...over };
  const r = await post('/api/invoices', body, seller);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.body.id);
};
const ALL_CLEAR = [
  { key: 'REA_UPLOADED', status: 'VERIFIED' }, { key: 'ENERGY_VERIFIED', status: 'VERIFIED' },
  { key: 'TARIFF_VERIFIED', status: 'VERIFIED' }, { key: 'CAPACITY_VERIFIED', status: 'VERIFIED' },
  { key: 'CUF_COMPLIANCE', status: 'VERIFIED' }, { key: 'COD_COMPLIANCE', status: 'VERIFIED' },
  { key: 'CURTAILMENT_CHECKED', status: 'NA' }, { key: 'CHANGE_IN_LAW_VERIFIED', status: 'NA' },
];
const verify = (inv, technical = ALL_CLEAR, commercial = {}) => post(`/api/invoices/${inv.id}/verification`, { technical, commercial });
const status = (inv) => db.prepare('SELECT status, verification_status, verified_by FROM invoices WHERE id = ?').get(inv.id);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  sellerCo = makeEntity('SELLER');
  seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
  ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.88, seller_id: sellerCo.id, cod_date: '2024-01-01', tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
  lockEnergy(ppa, '2026-08', 8200);
});

describe('S49 Approval waits for a completed verification', () => {
  it('refuses to approve a developer bill whose checklist is not done, and lets it through once it is', async () => {
    const inv = await raise();
    expect((await post(`/api/invoices/${inv.id}/submit-for-approval`)).status).toBe(200);
    const early = await post(`/api/invoices/${inv.id}/approvals/1/act`, { decision: 'APPROVED' });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/Verify this bill first/);

    const done = await verify(inv);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.verification_status).toBe('VERIFIED');
    expect((await post(`/api/invoices/${inv.id}/approvals/1/act`, { decision: 'APPROVED' })).status).toBe(200);
  });

  it('holds a wrong-tariff bill: the failed check cannot be cleared without a reason, and a failed checklist blocks approval', async () => {
    const inv = await raise({ tariff_per_unit: 3.1, energy_charges: 25420000 });
    await post(`/api/invoices/${inv.id}/submit-for-approval`);
    const silent = await verify(inv);
    expect(silent.status).toBe(400);
    expect(silent.body.error).toMatch(/Tariff Verified failed its automatic check .*Say why/);

    const asFailed = ALL_CLEAR.map((t) => (t.key === 'TARIFF_VERIFIED' ? { ...t, status: 'FAILED' } : t));
    expect((await verify(inv, asFailed)).body.verification_status).toBe('FAILED');
    const blocked = await post(`/api/invoices/${inv.id}/approvals/1/act`, { decision: 'APPROVED' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/failed: Tariff Verified/);
    // Sending it back is still open.
    expect((await post(`/api/invoices/${inv.id}/approvals/1/act`, { decision: 'REJECTED', comments: 'rate is 2.88' })).status).toBe(200);
  });

  it('records who verified only when the bill is verified', async () => {
    const inv = await raise();
    await verify(inv, [{ key: 'REA_UPLOADED', status: 'VERIFIED' }]);
    expect(status(inv)).toMatchObject({ verification_status: 'IN_PROGRESS', verified_by: null });
  });
});

describe('S49 What a save accepts', () => {
  it('refuses an unknown status, NA on a check every bill has, negative damages and text for a number', async () => {
    const inv = await raise();
    expect((await verify(inv, [{ key: 'TARIFF_VERIFIED', status: 'BANANA' }])).status).toBe(400);
    expect((await verify(inv, [{ key: 'TARIFF_VERIFIED', status: 'NA' }])).body.error).toMatch(/cannot be marked not applicable/);
    expect((await verify(inv, ALL_CLEAR, { liquidated_damages: -5000 })).body.error).toMatch(/cannot be negative/);
    expect((await verify(inv, ALL_CLEAR, { change_in_law: 'abc' })).body.error).toMatch(/must be a number/);
  });

  it('takes the energy charges from the bill, not the request', async () => {
    const inv = await raise();
    const r = await verify(inv, ALL_CLEAR, { energy_charges: 999, hacked: 1 });
    expect(r.body.commercial.energy_charges).toBe(23616000);
    expect(r.body.commercial.hacked).toBeUndefined();
    expect(r.body.verification_status).toBe('VERIFIED');
  });

  it('starts the build-up from the whole bill, and fails it when the adjustments do not meet the bill', async () => {
    const inv = await raise({ transmission_charges: 50000 });
    const clean = await verify(inv);
    expect(clean.body.commercial_gap, 'a transmission line read as a gap').toBe(0);
    const withLd = await verify(inv, ALL_CLEAR, { liquidated_damages: 100000 });
    expect(withLd.body).toMatchObject({ commercial_gap: -100000, verification_status: 'FAILED' });
  });

  it('refuses a buyer bill and SJVN\'s computed bill, and closes an approved bill once verified', async () => {
    const buyerBill = makeInvoice({ direction: 'SJVN_TO_BUYER', status: 'SENT' });
    expect((await verify(buyerBill)).status).toBe(400);
    const computed = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'UNDER_APPROVAL', invoice_breakdown_json: '[{"code":"E1"}]' });
    expect((await verify(computed)).body.error).toMatch(/developer's own bill/);
    const approved = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-08', energy_mwh: 8200, tariff_per_unit: 2.88, energy_charges: 23616000, total_amount: 23616000 });
    // Approved without a checklist: it can be verified after the fact, and the
    // queue stops flagging it once it reads VERIFIED. Then it is closed.
    const after = await verify(approved);
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body).toMatchObject({ verification_status: 'VERIFIED', retrospective: true });
    expect((await get('/api/reports/verification-queue')).body.totals.approved_unverified).toBe(0);
    expect((await verify(approved)).body.error).toMatch(/was verified; its checklist is closed/);
  });

  it('keeps an approved bill flagged when its checklist fails after the fact', async () => {
    const approved = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-08', energy_mwh: 9000, tariff_per_unit: 2.88, energy_charges: 25920000, total_amount: 25920000 });
    const r = await verify(approved, ALL_CLEAR.map((t) => (t.key === 'ENERGY_VERIFIED' ? { ...t, status: 'FAILED', note: 'billed 9,000 against 8,200 locked' } : t)));
    expect(r.body.verification_status).toBe('FAILED');
    expect((await get('/api/reports/verification-queue')).body.approved_unverified.map((b) => b.invoice_id)).toContain(approved.id);
  });
});

describe('S49 The checks read the figures', () => {
  it('sets a decision aside when the figures under it change', async () => {
    const inv = await raise();
    expect((await verify(inv)).body.verification_status).toBe('VERIFIED');
    db.prepare(`UPDATE energy_data SET energy_mwh = 8000 WHERE contract_id = ?`).run(ppa.id);
    const now = (await get(`/api/invoices/${inv.id}/verification`)).body;
    const energy = now.technical.find((t) => t.key === 'ENERGY_VERIFIED');
    expect(energy).toMatchObject({ status: 'FAILED', auto: 'FAILED' });
    expect(energy.note).toMatch(/set aside/);
    expect(now.verification_status).toBe('FAILED');
  });

  it('fails the energy account when a month\'s figure was locked before the month ended', async () => {
    db.prepare(`UPDATE energy_data SET created_at = '2026-08-02 10:00:00' WHERE contract_id = ?`).run(ppa.id);
    const inv = await raise();
    const rea = (await get(`/api/invoices/${inv.id}/verification`)).body.technical.find((t) => t.key === 'REA_UPLOADED');
    expect(rea.status).toBe('FAILED');
    // 50 MW × 24 h × 2 days.
    expect(rea.hint).toMatch(/recorded on 2026-08-02, before the month ended on 2026-08-31 \(at most 2,400 MWh/);
  });

  it('checks the rate the tariff structure gives for the year, not the base rate', async () => {
    db.prepare(`UPDATE contracts SET tariff_type = 'ESCALATING', tariff_structure_json = ? WHERE id = ?`)
      .run(JSON.stringify({ type: 'ESCALATING', base: 2.88, escalation_pct: 3 }), ppa.id);
    // 2026-08 is contract year 3 from January 2024: 2.88 × 1.03² = 3.0554.
    const inv = await raise({ tariff_per_unit: 3.0554, energy_charges: Math.round(8200 * 1000 * 3.0554) });
    const tariff = (await get(`/api/invoices/${inv.id}/verification`)).body.technical.find((t) => t.key === 'TARIFF_VERIFIED');
    expect(tariff.status).toBe('VERIFIED');
  });

  it('does not fail a developer\'s monthly bill on CUF: it is assessed over the contract year', async () => {
    db.prepare('UPDATE contracts SET min_cuf_percent = 19 WHERE id = ?').run(ppa.id);
    lockEnergy(ppa, '2026-07', 2000, null);
    const inv = await raise({ billing_period: '2026-07', energy_mwh: 2000, energy_charges: 5760000 });
    const cuf = (await get(`/api/invoices/${inv.id}/verification`)).body.technical.find((t) => t.key === 'CUF_COMPLIANCE');
    expect(cuf.status).toBe('VERIFIED');
    expect(cuf.hint).toMatch(/contract year 3 so far .* assessed at the year end \(2026-12\), not deducted monthly/);
  });

  it('verifies the revised bill afresh', async () => {
    const inv = await raise();
    await verify(inv);
    await post(`/api/invoices/${inv.id}/approvals/1/act`, { decision: 'REJECTED', comments: 'redo' });
    const revised = await request(app).put(`/api/invoices/${inv.id}/revise`).set(auth(seller)).send({ taxes: 1000 });
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    expect(status(inv)).toMatchObject({ verification_status: null, verified_by: null });
  });
});

describe('S49 Who sees what, and what the queue holds', () => {
  it('shows a seller its own checklist only', async () => {
    const inv = await raise();
    const otherCo = makeEntity('SELLER');
    const other = signToken(makeUser('SELLER', { linked_entity_id: otherCo.id }));
    expect((await get(`/api/invoices/${inv.id}/verification`, seller)).status).toBe(200);
    expect((await get(`/api/invoices/${inv.id}/verification`, other)).status).toBe(404);
  });

  it('lists the developer\'s bills with SJVN, not pool or computed bills, and flags one approved unverified', async () => {
    const inv = await raise();
    makeInvoice({ contract_id: ppa.id, invoice_no: 'DSM-PPA/2026/S49', direction: 'SELLER_TO_SJVN', status: 'DRAFT', tariff_per_unit: 0, invoice_type: 'SUPPLEMENTARY', invoice_breakdown_json: '[{"code":"DSM"}]' });
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SENT', invoice_breakdown_json: '[{"code":"E1"}]' });
    makeInvoice({ contract_id: ppa.id, invoice_no: 'S49-APPROVED', direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-06' });
    const q = (await get('/api/reports/verification-queue')).body;
    expect(q.invoices.map((r) => r.invoice_id)).toEqual([inv.id]);
    expect(q.totals).toMatchObject({ invoices: 1, pending: 1, failed: 0, approved_unverified: 1 });
    expect(q.approved_unverified[0].invoice_no).toBe('S49-APPROVED');
  });
});
