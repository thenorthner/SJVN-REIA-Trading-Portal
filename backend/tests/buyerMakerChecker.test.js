import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

let gen, discom, psa, maker, checker, finance;
const as = (u) => auth(signToken(u));
const get = (u, p = '') => request(app).get(`/api/buyer-bills${p}`).set(as(u));
const post = (u, p, body) => request(app).post(`/api/buyer-bills${p}`).set(as(u)).send(body);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const bill = (extra = {}) => makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', invoice_no: `S/${Math.random().toString(36).slice(2, 7)}`, billing_period: '2026-08', total_amount: 1000000, energy_charges: 1000000, due_date: day(15), ...extra });

beforeEach(() => {
  resetReia();
  gen = makeEntity('SELLER', { name: 'Generator' });
  discom = makeEntity('BUYER', { name: 'North Discom' });
  psa = makeContract({ contract_type: 'PSA', seller_id: gen.id, buyer_id: discom.id });
  maker = makeUser('BUYER_L1', { name: 'Mala Maker', linked_entity_id: discom.id });
  checker = makeUser('BUYER_L2', { name: 'Chetan Checker', linked_entity_id: discom.id });
  finance = makeUser('FINANCE_USER', { name: 'Farid Finance' });
});

describe('Buyer Maker-Checker Workflow & Dual Authorization', () => {
  it('L1 Maker creates an intimation -> status is PENDING_CHECKER', async () => {
    const inv = bill();
    const res = await post(maker, '/intimations', {
      invoice_id: inv.id,
      amount: 500000,
      tds_amount: 500,
      tds_section: '194Q',
      payment_date: day(-1),
      mode: 'RTGS',
      reference: 'TEST-MK-UTR-1',
      remarks: 'Prepared by Maker L1',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING_CHECKER');
    expect(res.body.with).toBe('Your checker');
    expect(res.body.prepared_by_name).toBe('Mala Maker');
    expect(res.body.approved_by_name).toBeNull();
  });

  it('L1 Maker cannot approve or return an intimation to maker (403)', async () => {
    const inv = bill();
    const created = await post(maker, '/intimations', {
      invoice_id: inv.id,
      amount: 100000,
      payment_date: day(-1),
      mode: 'NEFT',
      reference: 'TEST-MK-NOAUTH',
    });
    const pinId = created.body.id;

    // Maker tries to approve own intimation -> 403
    const approveRes = await post(maker, `/intimations/${pinId}/approve`, {});
    expect(approveRes.status).toBe(403);

    // Maker tries to return to maker -> 403
    const returnRes = await post(maker, `/intimations/${pinId}/return-to-maker`, { note: 'Cannot return' });
    expect(returnRes.status).toBe(403);
  });

  it('Checker can return an intimation to Maker with feedback remarks', async () => {
    const inv = bill();
    const created = await post(maker, '/intimations', {
      invoice_id: inv.id,
      amount: 200000,
      payment_date: day(-1),
      mode: 'RTGS',
      reference: 'TEST-MK-RETURN',
    });
    const pinId = created.body.id;

    // Checker returns to maker
    const res = await post(checker, `/intimations/${pinId}/return-to-maker`, {
      note: 'UTR mismatch with bank advice. Please verify.',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RETURNED_BY_CHECKER');
    expect(res.body.with).toBe('Returned to Maker');
    expect(res.body.decision_note).toContain('UTR mismatch');

    // Maker can now withdraw the returned intimation
    const withdrawRes = await post(maker, `/intimations/${pinId}/withdraw`, { note: 'Withdrawn to re-enter' });
    expect(withdrawRes.status).toBe(200);
    expect(withdrawRes.body.status).toBe('WITHDRAWN');
  });

  it('Checker can bulk approve pending intimations into SUBMITTED for SJVN Finance', async () => {
    const inv = bill();
    const p1 = await post(maker, '/intimations', { invoice_id: inv.id, amount: 150000, payment_date: day(-1), mode: 'RTGS', reference: 'TEST-BULK1' });
    const p2 = await post(maker, '/intimations', { invoice_id: inv.id, amount: 250000, payment_date: day(-1), mode: 'RTGS', reference: 'TEST-BULK2' });

    const ids = [p1.body.id, p2.body.id];

    // Maker cannot bulk approve
    const makerBulk = await post(maker, '/intimations/bulk-approve', { ids });
    expect(makerBulk.status).toBe(403);

    // Checker bulk approves
    const checkerBulk = await post(checker, '/intimations/bulk-approve', { ids });
    expect(checkerBulk.status).toBe(200);
    expect(checkerBulk.body.approved_count).toBe(2);

    // Finance can now see both in SUBMITTED
    const finRes = await request(app)
      .get('/api/buyer-bills/intimations?status=SUBMITTED')
      .set(as(finance));

    const subIds = finRes.body.intimations.map((i) => i.id);
    expect(subIds).toContain(p1.body.id);
    expect(subIds).toContain(p2.body.id);
  });

  it('Maker (L1) cannot execute final legal dual sign-off on balance reconciliation (403)', async () => {
    const reconId = 'RCN-TEST-' + Math.random().toString(36).slice(2, 7);
    db.prepare(`
      INSERT INTO reconciliations (id, recon_no, contract_id, period, period_type, status, counterparty_role, created_at)
      VALUES (?, ?, ?, '2026-08', 'MONTHLY', 'PENDING_SIGN_OFF', 'BUYER', datetime('now'))
    `).run(reconId, 'RCN/TEST/001', psa.id);

    const signRes = await request(app)
      .post(`/api/reconciliation/${reconId}/acknowledge`)
      .set(as(maker))
      .send({ decision: 'AGREE' });

    expect(signRes.status).toBe(403);
    expect(signRes.body.error).toContain('Maker (Level 1) cannot execute final legal sign-off');

    // Checker CAN sign
    const checkerSignRes = await request(app)
      .post(`/api/reconciliation/${reconId}/acknowledge`)
      .set(as(checker))
      .send({ decision: 'AGREE', remarks: 'Authorized by Buyer Checker L2' });

    expect(checkerSignRes.status).toBe(200);
    expect(checkerSignRes.body.decision).toBe('AGREE');
  });
});
