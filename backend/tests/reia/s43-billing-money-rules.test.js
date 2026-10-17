import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { invalidateParamCache } from '../../src/mastersService.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { lastCompleteMonth } from '../../src/services/energyRules.js';

// Found by the browser audit of the Billing desk (16-Oct-2026), on the QA copy:
// a PSA bill charged the margin twice, a 0 MWh draft produced a bill for minus
// ₹2.36 crore, an admin approved their own bill, and Finance recorded a payment
// dated next January for ten times the bill.

const AUG = '2025-08'; // a past month of 31 days
const WIDE = { tenure_start: '2020-01-01', tenure_end: '2050-12-31', status: 'ACTIVE' };
let reia, ppa, psa;

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  ppa = makeContract({ ...WIDE, contract_no: 'S43-PPA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.88, seller_id: makeEntity('SELLER').id });
  psa = makeContract({ ...WIDE, contract_no: 'S43-PSA', contract_type: 'PSA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.95, buyer_id: makeEntity('BUYER').id });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES ('CAL-S43', ?, ?, 100, '2020-01-01')`).run(ppa.id, psa.id);
});

const energy = (contract, mwh, { status = 'LOCKED', period = AUG, id, type = 'PROVISIONAL', created = '2025-09-02 10:00:00' } = {}) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status, created_at)
  VALUES (?, ?, ?, ?, 'SEA', ?, ?, ?)`).run(id || `ENG-S43-${Math.random().toString(36).slice(2, 8)}`, contract.id, period, type, mwh, status, created);
const bill = (contract, body = {}, token = reia) => request(app).post('/api/invoices/generate').set(auth(token))
  .send({ contract_id: contract.id, period_month: AUG, ...body });
const lines = (inv) => JSON.parse(inv.invoice_breakdown_json);

describe('S43 The trading margin is inside the PSA tariff', () => {
  it('bills the buyer MWh × PSA tariff, of which ₹70/MWh is the margin', async () => {
    energy(ppa, 8400);
    const p = (await bill(ppa)).body;
    expect(p.total_amount).toBe(24192000); // 8,400 × 1,000 × 2.88
    const r = await bill(psa);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.total_amount).toBe(24780000); // 8,400 × 1,000 × 2.95 — was 2,53,68,000
    expect(r.body.trading_margin).toBe(588000); // 8,400 × 70
    expect(r.body.energy_charges).toBe(24192000); // the generator's bill, passed through
    expect(r.body.total_amount - p.total_amount).toBe(8400 * 70);
    expect(lines(r.body).some((l) => l.code === 'NOTE' && /Pass-through/.test(l.label))).toBe(false);
  });

  it('says so when the pass-through rate is not the generator\'s tariff', async () => {
    db.prepare('UPDATE contracts SET tariff_per_unit = 3 WHERE id = ?').run(psa.id);
    energy(ppa, 8400);
    const r = await bill(psa);
    expect(r.status).toBe(201);
    expect(lines(r.body).find((l) => l.code === 'NOTE').label).toMatch(/₹2\.93\/unit differs from the source PPA tariff \(S43-PPA ₹2\.88\)/);
  });

  it('refuses a margin larger than the PSA tariff', async () => {
    db.prepare('UPDATE contracts SET trading_margin_per_mwh = 4000 WHERE id = ?').run(psa.id);
    energy(ppa, 1000);
    const r = await bill(psa);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/does not cover the trading margin/);
  });
});

describe('S43 A bill is raised on the month\'s locked figure', () => {
  it('refuses energy that is not locked, and names its state', async () => {
    // The July case: a 0 MWh draft and a validated 8,000, recorded together.
    energy(ppa, 0, { status: 'DRAFT', id: 'ENG-S43-D' });
    energy(ppa, 8000, { status: 'VALIDATED', id: 'ENG-S43-V' });
    const r = await bill(ppa);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not LOCKED/);
    expect(db.prepare('SELECT COUNT(*) n FROM invoices').get().n).toBe(0);
  });

  it('takes the locked figure over a later draft', async () => {
    energy(ppa, 8000, { id: 'ENG-S43-L', created: '2025-09-01 10:00:00' });
    energy(ppa, 100, { status: 'DRAFT', created: '2025-09-20 10:00:00' });
    const r = await bill(ppa);
    expect(r.status).toBe(201);
    expect(r.body.energy_mwh).toBe(8000);
    expect(r.body.energy_data_id).toBe('ENG-S43-L');
  });

  it('refuses the month still running', async () => {
    const now = new Date().toISOString().slice(0, 7);
    energy(ppa, 100, { period: now });
    const r = await bill(ppa, { period_month: now });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(new RegExp(`has not ended yet.*${lastCompleteMonth()}`));
  });

  it('never raises a bill for nothing', async () => {
    // A locked 0 MWh month on a plant with a 19% CUF obligation. Its shortfall
    // used to be deducted and drive the bill below zero; CUF is now assessed
    // over the contract year, and a month with nothing in it is not billed.
    db.prepare('UPDATE contracts SET min_cuf_percent = 19 WHERE id = ?').run(ppa.id);
    energy(ppa, 0);
    const r = await bill(ppa);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing to bill.*year-end CUF true-up/);
    expect(db.prepare('SELECT COUNT(*) n FROM invoices').get().n).toBe(0);
  });
});

describe('S43 Linking developer bills', () => {
  it('takes only a live bill from a source PPA, for the same month', async () => {
    energy(ppa, 8400);
    const other = makeContract({ ...WIDE, project_type: 'Solar' });
    const wrongPlant = makeInvoice({ contract_id: other.id, direction: 'SELLER_TO_SJVN', billing_period: AUG });
    const wrongMonth = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', billing_period: '2025-07' });
    const good = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', billing_period: AUG, status: 'APPROVED' });

    expect((await bill(psa, { seller_invoice_ids: ['INV-NOPE'] })).body.error).toMatch(/does not exist/);
    expect((await bill(psa, { seller_invoice_ids: [wrongPlant.id] })).body.error).toMatch(/not a developer bill on a PPA that supplies/);
    expect((await bill(psa, { seller_invoice_ids: [wrongMonth.id] })).body.error).toMatch(/is for 2025-07/);
    // Nothing half-saved by any refusal: the 500 used to leave the bill behind.
    expect(db.prepare(`SELECT COUNT(*) n FROM invoices WHERE contract_id = ?`).get(psa.id).n).toBe(0);

    const r = await bill(psa, { seller_invoice_ids: [good.id, good.id] });
    expect(r.status).toBe(201);
    expect(db.prepare('SELECT seller_invoice_id FROM invoice_mapping WHERE buyer_invoice_id = ?').all(r.body.id)).toEqual([{ seller_invoice_id: good.id }]);
  });
});

describe('S43 Approval has no exempt role', () => {
  const SWITCH = 'invoice_approval_distinct_approvers';
  const set = (v) => { db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(String(v), SWITCH); invalidateParamCache(); };
  afterEach(() => set(0));
  const act = (inv, level, who) => request(app).post(`/api/invoices/${inv.id}/approvals/${level}/act`).set(auth(signToken(who))).send({ decision: 'APPROVED', security_ack: 'test fixture: cover is tracked on the security desk' });
  const inApproval = (overrides) => {
    const inv = makeInvoice({ contract_id: psa.id, status: 'UNDER_APPROVAL', total_amount: 25368000, ...overrides });
    for (let l = 1; l <= 3; l += 1) db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, ?, 'PENDING')`).run(`S43-${inv.id}-${l}`, inv.id, l);
    return inv;
  };

  it('refuses the admin who raised a bill its first level', async () => {
    const admin = makeUser('SJVN_ADMIN', { name: 'S43 Admin' });
    const inv = inApproval({ created_by: admin.name, created_by_id: admin.id });
    const r = await act(inv, 1, admin);
    expect(r.status).toBe(403);
  });

  it('refuses an admin a second level once each level needs its own person', async () => {
    set(1);
    const admin = makeUser('REIA_ADMIN', { name: 'S43 REIA Admin' });
    const inv = inApproval({});
    expect((await act(inv, 1, admin)).status).toBe(200);
    const r = await act(inv, 2, admin);
    expect(r.status).toBe(403);
    expect(r.body.error).not.toMatch(/Vikas|Divyankur/);
  });
});

describe('S43 Recording a payment', () => {
  let finance, inv;
  beforeEach(() => {
    finance = tokenFor('FINANCE_USER');
    inv = makeInvoice({ contract_id: psa.id, status: 'SENT', total_amount: 100000 });
    db.prepare(`UPDATE invoices SET issued_at = date('now','-3 days'), due_date = date('now','+40 days') WHERE id = ?`).run(inv.id);
  });
  const pay = (body) => request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance)).send({ mode: 'NEFT', reference: 'UTR-S43', ...body });

  it('refuses a date after today, and a date that is not one', async () => {
    expect((await pay({ amount: 1000, payment_date: '2099-01-01' })).status).toBe(400);
    expect((await pay({ amount: 1000, payment_date: '2025-02-30' })).status).toBe(400);
    expect((await pay({ amount: 1000, payment_date: '2025-13-01' })).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) n FROM payments WHERE invoice_id = ?').get(inv.id).n).toBe(0);
  });

  it('refuses more than is outstanding, and anything once the bill is paid', async () => {
    const over = await pay({ amount: 1000000 });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/more than the ₹1,00,000 outstanding/);
    expect((await pay({ amount: 60000 })).status).toBe(201);
    expect((await pay({ amount: 50000 })).status).toBe(400); // 40,000 left
    expect((await pay({ amount: 40000 })).body.status).toBe('PAID');
    expect((await pay({ amount: 1 })).body.error).toMatch(/already paid/);
  });

  it('refuses a zero or negative amount', async () => {
    expect((await pay({ amount: 0 })).status).toBe(400);
    expect((await pay({ amount: -5 })).status).toBe(400);
  });
});

describe('S43 Notifications reach the bill\'s own party', () => {
  it('tells the buyer\'s users a bill was approved, and no other buyer', async () => {
    const mine = makeUser('BUYER', { linked_entity_id: psa.buyer_id });
    const otherBuyer = makeUser('BUYER', { linked_entity_id: makeEntity('BUYER').id });
    const inv = makeInvoice({ contract_id: psa.id, status: 'UNDER_APPROVAL', total_amount: 1000 });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('S43-N1', ?, 1, 'PENDING')`).run(inv.id);
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(reia)).send({ decision: 'APPROVED', security_ack: 'test fixture: cover is tracked on the security desk' });
    expect(r.status).toBe(200);
    const to = (u) => db.prepare(`SELECT COUNT(*) n FROM notifications WHERE type = 'INVOICE_APPROVED' AND user_id = ?`).get(u.id).n;
    expect(to(mine)).toBe(1);
    expect(to(otherBuyer)).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) n FROM notifications WHERE type = 'INVOICE_APPROVED' AND role = 'BUYER'`).get().n).toBe(0);
  });
});
