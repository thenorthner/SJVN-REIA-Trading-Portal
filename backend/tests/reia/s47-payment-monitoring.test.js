import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { ageingBuckets, payablesOutstanding } from '../../src/services/outstanding.js';
import { paymentMonitoring } from '../../src/services/paymentMonitoring.js';

// Found by the browser audit of Payment Monitoring (17-Oct-2026): Sunrise's
// October stood in payables twice once its own invoice was approved beside
// SJVN's computed bill, either could be released against, a release had no
// ceiling, a confirmed intimation could exceed the bill, confirmed money paid
// the bill before its surcharge, and bills sent without a due date read
// "not yet due" for ever.

let finance, seller, buyerCo, buyer, ppa, psa;
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const post = (path, body, who = finance) => request(app).post(path).set(auth(who)).send(body);

beforeEach(() => {
  resetReia();
  finance = tokenFor('FINANCE_USER');
  seller = makeEntity('SELLER');
  db.prepare('UPDATE entities SET is_penny_drop_verified = 1, pending_bank_json = NULL WHERE id = ?').run(seller.id);
  buyerCo = makeEntity('BUYER');
  buyer = signToken(makeUser('BUYER', { linked_entity_id: buyerCo.id }));
  ppa = makeContract({ contract_type: 'PPA', seller_id: seller.id });
  psa = makeContract({ contract_type: 'PSA', buyer_id: buyerCo.id });
});

/** SJVN's computed bill of a month (it carries a breakdown) and the developer's own (it does not). */
const computedBill = (over = {}) => makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 1000000, billing_period: '2026-09', invoice_breakdown_json: '[{"code":"TOTAL","value":1000000}]', invoice_type: 'PROVISIONAL', ...over });
const developerBill = (over = {}) => makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 1000000, billing_period: '2026-09', invoice_breakdown_json: '', invoice_type: 'PROVISIONAL', ...over });

describe('S47 One month is owed to a developer once', () => {
  it('counts the developer\'s own invoice, not SJVN\'s computed bill beside it', () => {
    computedBill();
    expect(payablesOutstanding()).toBe(1000000);
    developerBill();
    expect(payablesOutstanding(), 'the month was counted twice').toBe(1000000);
    expect(paymentMonitoring('PAYABLE').bills).toHaveLength(1);
  });

  it('releases against the developer\'s invoice only, and never more than is left', async () => {
    const c = computedBill();
    const d = developerBill();
    const onComputed = await post(`/api/invoices/${c.id}/release-to-generator`, { amount: 1000, source: 'OWN_FUND' });
    expect(onComputed.status).toBe(400);
    expect(onComputed.body.error).toMatch(/developer's own invoice/);
    const over = await post(`/api/invoices/${d.id}/release-to-generator`, { amount: 5000000, source: 'OWN_FUND' });
    expect(over.status, 'an Own Fund release had no ceiling').toBe(400);
    // Paid today, inside the rebate window: the whole bill in cash as well as the
    // rebate it earns would settle more than the bill (22-Oct-2026).
    const whole = await post(`/api/invoices/${d.id}/release-to-generator`, { amount: 1000000, source: 'OWN_FUND' });
    expect(whole.status).toBe(400);
    expect(whole.body.rebate_rate).toBeGreaterThan(0);
    expect(whole.body.error).toMatch(/early-payment rebate/);
    expect((await post(`/api/invoices/${d.id}/release-to-generator`, { amount: whole.body.left, source: 'OWN_FUND' })).status).toBe(201);
    const after = db.prepare('SELECT status, rebate FROM invoices WHERE id = ?').get(d.id);
    expect(after.status).toBe('PAID');
    expect(Math.round(whole.body.left + after.rebate), 'cash and rebate settle the bill, no more').toBe(1000000);
  });

  it('takes off what was already paid on the computed bill', async () => {
    const c = computedBill();
    db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, 400000, ?, ?)').run(newId('PAY'), c.id, day(-5), 'RELEASE:OWN_FUND');
    const d = developerBill();
    const r = await post(`/api/invoices/${d.id}/release-to-generator`, { amount: 700000, source: 'OWN_FUND' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/left .* after ₹4,00,000 already paid .*₹6,00,000 owed, less the .*% early-payment rebate/);
  });
});

describe('S47 Confirming a buyer\'s payment', () => {
  const bill = (over = {}) => {
    const b = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, energy_charges: 100000, due_date: day(-60), ...over });
    db.prepare(`UPDATE invoices SET issued_at = date('now', '-100 days') WHERE id = ?`).run(b.id);
    return b;
  };
  const intimate = (b, body) => post('/api/buyer-bills/intimations', { invoice_id: b.id, payment_date: day(0), mode: 'RTGS', reference: `UTR${Math.random().toString(36).slice(2, 9)}`, ...body }, buyer);

  it('will not confirm more than the bill has left', async () => {
    const b = bill();
    const i = (await intimate(b, { amount: 500000 })).body;
    expect(i.exceeds_balance).toBe(1);
    const r = await post(`/api/buyer-bills/intimations/${i.id}/confirm`, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/more than the .* left/);
    expect(db.prepare('SELECT COUNT(*) c FROM payments WHERE invoice_id = ?').get(b.id).c).toBe(0);
  });

  it('pays the surcharge first, then the bill', async () => {
    const b = bill();
    const i = (await intimate(b, { amount: 50000 })).body;
    expect((await post(`/api/buyer-bills/intimations/${i.id}/confirm`, {})).status).toBe(200);
    const p = db.prepare('SELECT amount, lps_component FROM payments WHERE invoice_id = ?').get(b.id);
    expect(p.amount).toBe(50000);
    expect(p.lps_component, 'the surcharge earned was left unpaid').toBeGreaterThan(0);
  });
});

describe('S47 A bill with no due date', () => {
  it('is flagged, not filed as not yet due', () => {
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: null });
    const b = ageingBuckets('SJVN_TO_BUYER');
    expect(b.find((x) => x.bucket === 'NO_DUE_DATE')).toMatchObject({ invoices: 1, amount: 100000 });
    expect(b.find((x) => x.bucket === 'NOT_DUE').amount).toBe(0);
  });
});
