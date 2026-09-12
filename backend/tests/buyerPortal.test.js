import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

// The buyer portal as each of a buyer company's users sees it — its admin,
// maker (L1), checker (L2), approver (L3) — and as a second buyer company,
// which must neither see nor touch any of it.

let S, X, Y, psaX, psaY, t;

beforeEach(() => {
  resetReia();
  S = makeEntity('SELLER', { name: 'Generator' });
  X = makeEntity('BUYER', { name: 'Buyer X' });
  Y = makeEntity('BUYER', { name: 'Buyer Y' });
  psaX = makeContract({ contract_type: 'PSA', seller_id: S.id, buyer_id: X.id });
  psaY = makeContract({ contract_type: 'PSA', seller_id: S.id, buyer_id: Y.id });
  t = {
    admin: tokenFor('BUYER', { linked_entity_id: X.id }),
    l1: tokenFor('BUYER_L1', { linked_entity_id: X.id }),
    l2: tokenFor('BUYER_L2', { linked_entity_id: X.id }),
    l3: tokenFor('BUYER_L3', { linked_entity_id: X.id }),
    other: tokenFor('BUYER', { linked_entity_id: Y.id }),
    otherL2: tokenFor('BUYER_L2', { linked_entity_id: Y.id }),
    sellerL2: tokenFor('SELLER_L2', { linked_entity_id: S.id }),
  };
});

const bill = (contract, status) => makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status });
const get = (path, who) => request(app).get(path).set(auth(who));
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);
const payment = { amount: 1000, payment_date: '2026-09-10', mode: 'NEFT', reference: 'UTR-1' };
const paidOn = (id) => db.prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?').get(id).n;

function instrument(contract, { utilized = 0, revolving = 1 } = {}) {
  const mechSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'payment_security'").get().sql;
  const mech = /mechanism_type[\s\S]*?IN\s*\(\s*'([^']+)'/.exec(mechSql)[1];
  const id = newId('PS');
  db.prepare(`
    INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, limit_amount, utilized_amount, is_revolving)
    VALUES (?, ?, ?, ?, 1000000, ?, ?)
  `).run(id, `INS-${id}`, contract.id, mech, utilized, revolving);
  return id;
}

function statement(contract, role = 'BUYER') {
  const id = newId('RCN');
  db.prepare(`
    INSERT INTO reconciliations (id, recon_no, contract_id, period_type, period, status, counterparty_role)
    VALUES (?, ?, ?, 'MONTHLY', '2026-08', 'PENDING_SIGN_OFF', ?)
  `).run(id, `RCN/2026/${id.slice(-5)}`, contract.id, role);
  return id;
}

describe('buyer portal — every user of the company', () => {
  it.each(['admin', 'l1', 'l2', 'l3'])('%s sees the company dashboard', async (who) => {
    const r = await get('/api/buyer-dashboard', t[who]);
    expect(r.status).toBe(200);
    expect(r.body.active_contracts).toBe(1);
  });

  it.each(['admin', 'l1', 'l2', 'l3'])('%s can notify a payment on the company bill', async (who) => {
    const inv = bill(psaX, 'SENT');
    const r = await post(`/api/invoices/${inv.id}/payments`, t[who], payment);
    expect(r.status).toBe(201);
    expect(paidOn(inv.id)).toBe(1);
  });

  it.each(['admin', 'l1', 'l2', 'l3'])('%s can replenish a drawn revolving instrument', async (who) => {
    const ps = instrument(psaX, { utilized: 500 });
    const r = await post(`/api/payment-security/${ps}/replenish`, t[who], { amount: 500, reference: 'top-up' });
    expect(r.status).toBe(200);
  });

  it('is not shown a bill SJVN is still drafting', async () => {
    const draft = bill(psaX, 'DRAFT');
    const sent = bill(psaX, 'SENT');
    const list = await get('/api/invoices?direction=SJVN_TO_BUYER', t.l1);
    expect(list.body.map((i) => i.id)).toEqual([sent.id]);
    expect((await get(`/api/invoices/${draft.id}`, t.l1)).status).toBe(404);
  });
});

describe('reconciliation sign-off', () => {
  it('lets a buyer sub-user sign off its own statement', async () => {
    const recon = statement(psaX, 'BUYER');
    const r = await post(`/api/reconciliation/${recon}/acknowledge`, t.l2, { decision: 'AGREE', remarks: 'Checked' });
    expect(r.status).toBe(200);
    const row = db.prepare('SELECT counterparty_ack_at, counterparty_ack_by FROM reconciliations WHERE id = ?').get(recon);
    expect(row.counterparty_ack_at).toBeTruthy();
    expect(row.counterparty_ack_by).toBe('BUYER_L2 user');
  });

  it('lets a seller sub-user sign off theirs too', async () => {
    const recon = statement(psaX, 'SELLER');
    expect((await post(`/api/reconciliation/${recon}/acknowledge`, t.sellerL2, { decision: 'AGREE' })).status).toBe(200);
  });

  it("refuses another company's statement", async () => {
    const recon = statement(psaY, 'BUYER');
    expect((await post(`/api/reconciliation/${recon}/acknowledge`, t.l2, { decision: 'AGREE' })).status).toBe(403);
  });
});

describe('another buyer company', () => {
  it("cannot record a payment against this company's bill", async () => {
    const inv = bill(psaX, 'SENT');
    const r = await post(`/api/invoices/${inv.id}/payments`, t.other, payment);
    expect(r.status).toBe(404);
    expect(paidOn(inv.id)).toBe(0);
  });

  it("cannot replenish or release this company's security", async () => {
    const ps = instrument(psaX, { utilized: 500 });
    expect((await post(`/api/payment-security/${ps}/replenish`, t.otherL2, { amount: 500 })).status).toBe(403);
    expect((await post(`/api/payment-security/${ps}/release-request`, t.other, { reason: 'x' })).status).toBe(403);
  });

  it("cannot read this company's payment ledger", async () => {
    const mine = bill(psaX, 'PAID');
    const theirs = bill(psaY, 'PAID');
    const pay = (inv, amount) => db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date) VALUES (?, ?, ?, ?)')
      .run(newId('PAY'), inv.id, amount, '2026-09-01');
    pay(mine, 1000);
    pay(theirs, 2000);

    const ours = await get('/api/invoices/payments?direction=SJVN_TO_BUYER', t.l1);
    expect(ours.body.map((p) => p.invoice_id)).toEqual([mine.id]);
    const theirLedger = await get('/api/invoices/payments?direction=SJVN_TO_BUYER', t.other);
    expect(theirLedger.body.map((p) => p.invoice_id)).toEqual([theirs.id]);
    // And reading the ledger records nobody as having opened a bill.
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'VIEW_INVOICE'").get().n).toBe(0);
  });
});
