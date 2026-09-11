import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia, auditFor } from './helpers/reia.js';

// The seller portal as each of a seller company's users sees it — its admin,
// maker (L1), checker (L2) and approver (L3) — and as a second seller company,
// which must neither see nor touch any of it.

let A, B, ppaA, ppaB, t;

beforeEach(() => {
  resetReia();
  A = makeEntity('SELLER', { name: 'Seller A' });
  B = makeEntity('SELLER', { name: 'Seller B' });
  const buyer = makeEntity('BUYER');
  ppaA = makeContract({ contract_type: 'PPA', seller_id: A.id, buyer_id: buyer.id });
  ppaB = makeContract({ contract_type: 'PPA', seller_id: B.id, buyer_id: buyer.id });
  t = {
    admin: tokenFor('SELLER', { linked_entity_id: A.id }),
    l1: tokenFor('SELLER_L1', { linked_entity_id: A.id }),
    l2: tokenFor('SELLER_L2', { linked_entity_id: A.id }),
    l3: tokenFor('SELLER_L3', { linked_entity_id: A.id }),
    other: tokenFor('SELLER', { linked_entity_id: B.id }),
    otherL1: tokenFor('SELLER_L1', { linked_entity_id: B.id }),
    otherL2: tokenFor('SELLER_L2', { linked_entity_id: B.id }),
  };
});

const bill = (contract, status) => makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status });
const get = (path, who) => request(app).get(path).set(auth(who));
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);
const put = (path, who, body = {}) => request(app).put(path).set(auth(who)).send(body);
const statusOf = (id) => db.prepare('SELECT status FROM invoices WHERE id = ?').get(id).status;
const invoiceBody = (period = '2026-08') => ({ contract_id: ppaA.id, billing_period: period, energy_mwh: 10, tariff_per_unit: 3, energy_charges: 30000 });

describe('seller portal — every user of the company', () => {
  it.each(['admin', 'l1', 'l2', 'l3'])('%s sees the company dashboard', async (who) => {
    const r = await get('/api/seller-dashboard', t[who]);
    expect(r.status).toBe(200);
    expect(r.body.active_contracts).toBe(1);
  });

  it('sees its own invoices at every status, and nobody else sees them', async () => {
    const mine = ['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'REJECTED', 'SENT'].map((s) => bill(ppaA, s).id);
    const theirs = bill(ppaB, 'SUBMITTED').id;

    const list = await get('/api/invoices?direction=SELLER_TO_SJVN', t.l2);
    expect(list.body.map((i) => i.id).sort()).toEqual([...mine].sort());

    const submitted = mine[2];
    expect((await get(`/api/invoices/${submitted}`, t.admin)).status).toBe(200);
    expect((await get(`/api/invoices/${submitted}/pdf`, t.admin)).status).toBe(200);
    expect((await get(`/api/invoices/${theirs}`, t.admin)).status).toBe(404);
    expect((await get(`/api/invoices/${submitted}`, t.other)).status).toBe(404);
  });
});

describe('maker and checker', () => {
  it("keeps the maker's invoice a draft until the company's checker sends it to SJVN", async () => {
    const made = await post('/api/invoices', t.l1, invoiceBody());
    expect(made.status).toBe(201);
    expect(made.body.status).toBe('DRAFT');

    expect((await post(`/api/invoices/${made.body.id}/submit-l2`, t.l1)).status).toBe(200);
    expect(statusOf(made.body.id)).toBe('PENDING_L2');

    // The maker cannot clear its own draft.
    expect((await post(`/api/invoices/${made.body.id}/approve-l2`, t.l1)).status).toBe(403);

    const approved = await post(`/api/invoices/${made.body.id}/approve-l2`, t.l2, { comments: 'Checked against the REA' });
    expect(approved.status).toBe(200);
    expect(statusOf(made.body.id)).toBe('SUBMITTED');
    expect(auditFor(made.body.id).map((a) => a.action)).toEqual(expect.arrayContaining(['CREATE', 'SUBMIT_L2', 'APPROVE_L2']));
  });

  it('tells SJVN about a seller invoice only once it is actually submitted', async () => {
    const before = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'INVOICE_SUBMITTED'").get().n;
    const made = await post('/api/invoices', t.l1, invoiceBody());
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'INVOICE_SUBMITTED'").get().n).toBe(before);
    await post(`/api/invoices/${made.body.id}/submit-l2`, t.l1);
    await post(`/api/invoices/${made.body.id}/approve-l2`, t.l2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'INVOICE_SUBMITTED'").get().n).toBe(before + 1);
  });

  it('lets the company admin approve a maker draft when there is no checker', async () => {
    const inv = bill(ppaA, 'PENDING_L2');
    expect((await post(`/api/invoices/${inv.id}/approve-l2`, t.admin)).status).toBe(200);
    expect(statusOf(inv.id)).toBe('SUBMITTED');
  });

  it('lets the admin and checkers submit straight to SJVN', async () => {
    for (const [who, period] of [['admin', '2026-06'], ['l2', '2026-07'], ['l3', '2026-08']]) {
      const r = await post('/api/invoices', t[who], invoiceBody(period));
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('SUBMITTED');
    }
  });

  it('leaves resubmitting a rejected bill to the admin and checkers', async () => {
    const inv = bill(ppaA, 'REJECTED');
    expect((await post(`/api/invoices/${inv.id}/submit-for-approval`, t.l1)).status).toBe(403);
    expect((await post(`/api/invoices/${inv.id}/submit-for-approval`, t.l2)).status).toBe(200);
    expect(statusOf(inv.id)).toBe('UNDER_APPROVAL');
  });
});

describe('another seller company', () => {
  it("cannot bill on this company's contract", async () => {
    const r = await post('/api/invoices', t.other, invoiceBody());
    expect(r.status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE contract_id = ?').get(ppaA.id).n).toBe(0);
  });

  it("cannot validate, submit, hand on or approve this company's invoices", async () => {
    expect((await post(`/api/invoices/${bill(ppaA, 'SUBMITTED').id}/validate`, t.other)).status).toBe(404);
    expect((await post(`/api/invoices/${bill(ppaA, 'REJECTED').id}/submit-for-approval`, t.other)).status).toBe(404);
    expect((await post(`/api/invoices/${bill(ppaA, 'DRAFT').id}/submit-l2`, t.otherL1)).status).toBe(404);
    expect((await post(`/api/invoices/${bill(ppaA, 'PENDING_L2').id}/approve-l2`, t.otherL2)).status).toBe(404);
  });

  it("cannot edit this company's profile or its regulatory file", async () => {
    expect((await put(`/api/entities/${A.id}`, t.other, { name: 'Hijacked', corporate_email: 'x@evil.test' })).status).toBe(404);
    expect(db.prepare('SELECT name FROM entities WHERE id = ?').get(A.id).name).toBe('Seller A');
    expect((await put(`/api/entities/${A.id}/regulatory-approvals/any`, t.other)).status).toBe(404);
    // The company's own admin still can.
    expect((await put(`/api/entities/${A.id}`, t.admin, { corporate_phone: '0177-2660000' })).status).toBe(200);
  });
});

describe('disputes', () => {
  const dispute = (invoiceId) => ({
    invoice_id: invoiceId, raised_by_role: 'SELLER', reason_code: 'ENERGY_DATA_MISMATCH',
    charge_line: 'energy_charges', issue_description: 'REA shows less energy', disputed_amount: 1000,
  });

  it("lets a checker raise one on the company's bill, and no other company", async () => {
    const inv = bill(ppaA, 'SENT');
    expect((await post('/api/disputes', t.l2, dispute(inv.id))).status).toBe(201);
    expect((await post('/api/disputes', t.otherL2, dispute(inv.id))).status).toBe(403);
  });

  it('holds sub-users to the dispute window like the company admin', async () => {
    const inv = bill(ppaA, 'SENT');
    db.prepare("UPDATE invoices SET created_at = datetime('now', '-40 days'), issued_at = NULL WHERE id = ?").run(inv.id);
    const r = await post('/api/disputes', t.l2, dispute(inv.id));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/conclusive/);
  });
});

describe('payments ledger', () => {
  it('comes back in one call, scoped to the company, without recording any bill as opened', async () => {
    const mine = bill(ppaA, 'PAID');
    const theirs = bill(ppaB, 'PAID');
    const pay = (inv, amount) => db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date) VALUES (?, ?, ?, ?)')
      .run(newId('PAY'), inv.id, amount, '2026-09-01');
    pay(mine, 1000);
    pay(theirs, 2000);

    const r = await get('/api/invoices/payments?direction=SELLER_TO_SJVN', t.l1);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ invoice_id: mine.id, amount: 1000, invoice_no: mine.invoice_no, contract_no: ppaA.contract_no });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'VIEW_INVOICE'").get().n).toBe(0);
  });
});
