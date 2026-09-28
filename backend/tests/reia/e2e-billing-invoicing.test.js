import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// One month of PSA billing, walked the whole way: energy locked, bill raised,
// verified, taken through a three-level approval chain by three different
// people, despatched on email and SMS, paid, and then adjusted by a
// supplementary. Then the other direction — SJVN paying the generator — with the
// bank-verification gate in front of it.
//
// The suites around this one each check a stage in isolation. This one exists
// because the stages have to hold together: a refusal that is correct on its own
// is still a bug if it fires halfway through a month-end run, and a state that
// is reachable in a unit test is not necessarily reachable from DRAFT.

const signFor = (user) => signToken(user);
const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body || {});
const get = (url, token) => request(app).get(url).set(auth(token));

/** Deliveries land as files in backend/outbox when no gateway is configured.
 *  Track the ones this suite causes so the run does not leave them behind. */
const OUTBOX = path.join(process.cwd(), 'outbox');
const written = new Set();
function rememberOutboxFiles(invoiceId) {
  for (const d of db.prepare('SELECT detail_json FROM invoice_deliveries WHERE invoice_id = ?').all(invoiceId)) {
    try {
      const j = JSON.parse(d.detail_json || '{}');
      for (const p of [j.meta_path, j.provider_ref, j.pdf_path]) {
        if (typeof p === 'string' && p) written.add(path.isAbsolute(p) ? p : path.join(OUTBOX, p));
      }
    } catch { /* a delivery that failed has nothing to clean up */ }
  }
}

/** A distinct mobile per test — notificationService drops a repeat to the same
 *  number within 60 seconds, which would otherwise silence the second test. */
let phoneSeq = 0;
const nextPhone = () => `98${String(10000000 + (phoneSeq += 1)).slice(0, 8)}`;

/** dispatch() is fire-and-forget by design so gateway latency never holds up the
 *  API response; the delivery row is written a tick later. */
const settle = () => new Promise((r) => setTimeout(r, 30));

let reia, finance, buyer, seller, contract;

beforeAll(() => { if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true }); });

afterAll(() => {
  // dispatch() writes its own outbox files; provider_ref holds the path it used.
  for (const d of db.prepare('SELECT provider_ref FROM notification_deliveries').all()) {
    if (!d.provider_ref) continue;
    written.add(path.isAbsolute(d.provider_ref) ? d.provider_ref : path.join(OUTBOX, d.provider_ref));
  }
  for (const f of written) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  db.prepare('DELETE FROM notification_deliveries').run();
});

beforeEach(() => {
  resetReia();
  for (const d of db.prepare('SELECT provider_ref FROM notification_deliveries').all()) {
    if (d.provider_ref) written.add(path.isAbsolute(d.provider_ref) ? d.provider_ref : path.join(OUTBOX, d.provider_ref));
  }
  db.prepare('DELETE FROM notification_deliveries').run();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');

  buyer = makeEntity('BUYER', { name: 'Himachal Pradesh State Electricity Board' });
  seller = makeEntity('SELLER', { name: 'Solar Developer Pvt Ltd' });
  db.prepare(`
    UPDATE entities SET corporate_email = ?, corporate_phone = ?, is_penny_drop_verified = 1
    WHERE id IN (?, ?)
  `).run('billing@hpseb.test.in', nextPhone(), buyer.id, seller.id);

  contract = makeContract({
    contract_type: 'PSA', project_type: 'SOLAR', status: 'ACTIVE',
    seller_id: seller.id, buyer_id: buyer.id,
    tariff_per_unit: 3.0, payment_terms_days: 30,
    rebate_pct: 2, rebate_days: 5, lps_annual_pct: 12,
  });
});

/** A locked month of energy — what billing reads. */
function lockEnergy(mwh, period = '2026-04') {
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
    VALUES (?, ?, ?, 'FINAL', 'SEA', ?, 'LOCKED')
  `).run(`ENG-${Math.random().toString(36).slice(2, 10)}`, contract.id, period, mwh);
}

/** Three approvers who are not the maker, each acting on their own level. */
async function clearApprovalChain(invoiceId, levels) {
  for (let lvl = 1; lvl <= levels; lvl += 1) {
    const checker = makeUser('REIA_USER', { name: `Checker L${lvl} ${Math.random()}` });
    const r = await post(`/api/invoices/${invoiceId}/approvals/${lvl}/act`, signFor(checker),
      { decision: 'APPROVED', comments: `cleared at level ${lvl}` });
    expect(r.status, `level ${lvl}: ${JSON.stringify(r.body)}`).toBe(200);
  }
}

describe('E2E: a PSA month from energy data to a settled bill', () => {
  it('goes the whole way, and refuses each shortcut on the way', async () => {
    const maker = makeUser('REIA_USER', { name: 'Month-end Maker' });
    lockEnergy(2000); // 2000 MWh x Rs 3/unit = Rs 6,00,00,000 — past the top approval band

    // ── 1. Raise the bill ───────────────────────────────────────────────────
    const gen = await post('/api/invoices/generate', signFor(maker),
      { contract_id: contract.id, period_month: '2026-04' });
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    const inv = gen.body;
    expect(inv.status).toBe('DRAFT');
    expect(inv.direction).toBe('SJVN_TO_BUYER');
    expect(inv.energy_charges).toBeCloseTo(2000 * 3.0 * 1000, 0);
    expect(inv.total_amount).toBeGreaterThan(inv.energy_charges - 1); // margin/tax sit on top
    expect(inv.due_date, 'a raised bill carries no due date').toBeTruthy();

    // A draft has not been asked for, so nothing can be paid against it.
    const earlyPay = await post(`/api/invoices/${inv.id}/payments`, finance,
      { amount: 1000, payment_date: '2026-05-02' });
    expect(earlyPay.status).toBe(400);
    expect(earlyPay.body.error).toMatch(/has not been issued yet/i);

    // Nor can it be sent before it has been through approval.
    const earlySend = await post(`/api/invoices/${inv.id}/send`, reia);
    expect(earlySend.status).toBe(400);
    expect(earlySend.body.error).toMatch(/APPROVED/);

    // ── 2. Technical and commercial verification ────────────────────────────
    const template = await get(`/api/invoices/${inv.id}/verification`, reia);
    expect(template.status).toBe(200);
    expect(Array.isArray(template.body.technical)).toBe(true);

    const verified = await post(`/api/invoices/${inv.id}/verification`, reia, {
      technical: template.body.technical.map((t) => ({ ...t, status: 'OK' })),
      commercial: template.body.commercial || {},
    });
    expect(verified.status).toBe(200);
    expect(db.prepare('SELECT verification_status, verified_by FROM invoices WHERE id = ?').get(inv.id).verified_by)
      .toBeTruthy();

    // ── 3. Into approval — banded on value ──────────────────────────────────
    const submitted = await post(`/api/invoices/${inv.id}/submit-for-approval`, signFor(maker));
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('UNDER_APPROVAL');

    const levels = db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c;
    expect(levels, 'a six-crore bill was routed through a single approval level').toBe(3);

    // The maker cannot clear their own bill, at any level.
    const selfApprove = await post(`/api/invoices/${inv.id}/approvals/1/act`, signFor(maker),
      { decision: 'APPROVED' });
    expect(selfApprove.status).toBe(403);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('UNDER_APPROVAL');

    // Two of three levels is not approval.
    const l1 = makeUser('REIA_USER', { name: 'Checker One' });
    const l2 = makeUser('REIA_USER', { name: 'Checker Two' });
    await post(`/api/invoices/${inv.id}/approvals/1/act`, signFor(l1), { decision: 'APPROVED' });
    await post(`/api/invoices/${inv.id}/approvals/2/act`, signFor(l2), { decision: 'APPROVED' });
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('UNDER_APPROVAL');

    const l3 = makeUser('REIA_USER', { name: 'Checker Three' });
    const final = await post(`/api/invoices/${inv.id}/approvals/3/act`, signFor(l3),
      { decision: 'APPROVED', comments: 'released for despatch' });
    expect(final.status).toBe(200);
    expect(final.body.status).toBe('APPROVED');

    // ── 4. Despatch — email and SMS, both logged ────────────────────────────
    const sent = await post(`/api/invoices/${inv.id}/send`, reia);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.status).toBe('SENT');
    rememberOutboxFiles(inv.id);

    const deliveries = db.prepare('SELECT * FROM invoice_deliveries WHERE invoice_id = ?').all(inv.id);
    const email = deliveries.find((d) => d.channel === 'EMAIL');
    const sms = deliveries.find((d) => d.channel === 'SMS');
    expect(email, 'no email delivery was logged').toBeTruthy();
    expect(email.recipient).toContain('billing@hpseb.test.in');
    expect(sms, 'no SMS delivery was logged for a counterparty with a mobile').toBeTruthy();
    // With no gateway keyed, neither channel reached anyone — and the log says so
    // rather than claiming a send.
    expect(email.status).toBe('SIMULATED');
    expect(sms.status).toBe('SIMULATED');
    expect(JSON.parse(sms.detail_json).mode).toBe('FILE_OUTBOX');

    // ── 5. Payment, in two parts ────────────────────────────────────────────
    const total = db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(inv.id).total_amount;

    const part = await post(`/api/invoices/${inv.id}/payments`, finance,
      { amount: Math.round(total / 2), payment_date: '2026-05-20', mode: 'NEFT', reference: 'UTR-1' });
    expect(part.status).toBe(201);
    expect(part.body.status).toBe('PARTIALLY_PAID');

    const rest = await post(`/api/invoices/${inv.id}/payments`, finance,
      { amount: total - Math.round(total / 2), payment_date: '2026-05-25', mode: 'NEFT', reference: 'UTR-2' });
    expect(rest.status).toBe(201);
    expect(rest.body.status).toBe('PAID');

    expect(db.prepare('SELECT COUNT(*) c FROM payments WHERE invoice_id = ?').get(inv.id).c).toBe(2);

    // ── 6. The trail the auditor reads ──────────────────────────────────────
    const trail = db.prepare(
      `SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY rowid`).all(inv.id).map((a) => a.action);
    expect(trail).toEqual(expect.arrayContaining([
      'GENERATE', 'INVOICE_VERIFICATION', 'SUBMIT_FOR_APPROVAL',
      'APPROVAL_APPROVED', 'SEND', 'PAYMENT_RECORDED',
    ]));
  });

  it('sends the payment-received alert to the desk over SMS, and logs the attempt', async () => {
    // The channel policy puts PAYMENT_RECEIVED on SMS, so a finance officer with
    // a mobile on record should get one. This is the path the DLT content
    // template has to cover.
    const deskPhone = nextPhone();
    const officer = makeUser('FINANCE_USER', { name: 'Desk Officer' });
    db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(deskPhone, officer.id);

    lockEnergy(100);
    const maker = makeUser('REIA_USER', { name: 'Small Bill Maker' });
    const gen = await post('/api/invoices/generate', signFor(maker),
      { contract_id: contract.id, period_month: '2026-04' });
    expect(gen.status).toBe(201);
    const inv = gen.body;

    await post(`/api/invoices/${inv.id}/submit-for-approval`, signFor(maker));
    const levels = db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c;
    await clearApprovalChain(inv.id, levels);
    await post(`/api/invoices/${inv.id}/send`, reia);
    rememberOutboxFiles(inv.id);

    const pay = await post(`/api/invoices/${inv.id}/payments`, finance,
      { amount: 1000, payment_date: '2026-05-10' });
    expect(pay.status).toBe(201);

    await settle();
    const smsRow = db.prepare(`
      SELECT * FROM notification_deliveries WHERE event = 'PAYMENT_RECEIVED' AND channel = 'SMS' AND address = ?
    `).get(deskPhone);
    expect(smsRow, 'no SMS delivery was attempted for PAYMENT_RECEIVED').toBeTruthy();
    expect(smsRow.status).toBe('SENT');       // written to the outbox without error
    expect(smsRow.provider).toBe('FILE_OUTBOX');
    // The body is what a DLT content template has to match, character for
    // character. Pin the fixed text so a reword is a visible test change and
    // not a silently scrubbed message.
    expect(smsRow.body).toMatch(/^SJVN: Payment of Rs [\d,]+ recorded against .+\. Status now [A-Z_]+\.$/);
    if (smsRow.provider_ref) written.add(path.join(OUTBOX, smsRow.provider_ref));
  });

  it('charges late payment surcharge when the money comes in after the due date', async () => {
    lockEnergy(500);
    const maker = makeUser('REIA_USER', { name: 'LPS Maker' });
    const gen = await post('/api/invoices/generate', signFor(maker),
      { contract_id: contract.id, period_month: '2026-04' });
    const inv = gen.body;
    await post(`/api/invoices/${inv.id}/submit-for-approval`, signFor(maker));
    await clearApprovalChain(inv.id,
      db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c);
    await post(`/api/invoices/${inv.id}/send`, reia);
    rememberOutboxFiles(inv.id);

    const due = db.prepare('SELECT due_date, total_amount FROM invoices WHERE id = ?').get(inv.id);
    const lateBy = new Date(new Date(due.due_date).getTime() + 60 * 86400000).toISOString().slice(0, 10);

    const paid = await post(`/api/invoices/${inv.id}/payments`, finance,
      { amount: due.total_amount, payment_date: lateBy, mode: 'RTGS' });
    expect(paid.status).toBe(201);

    const after = db.prepare('SELECT lps, rebate FROM invoices WHERE id = ?').get(inv.id);
    expect(after.lps, 'a payment 60 days past due carried no surcharge').toBeGreaterThan(0);
    expect(after.rebate || 0, 'a late payment was given the early-payment rebate').toBe(0);
  });
});

describe('E2E: adjusting a month that has already been billed', () => {
  it('raises a supplementary against a paid bill and leaves the original alone', async () => {
    lockEnergy(300);
    const maker = makeUser('REIA_USER', { name: 'Adjust Maker' });
    const gen = await post('/api/invoices/generate', signFor(maker),
      { contract_id: contract.id, period_month: '2026-04' });
    const inv = gen.body;
    await post(`/api/invoices/${inv.id}/submit-for-approval`, signFor(maker));
    await clearApprovalChain(inv.id,
      db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c);
    await post(`/api/invoices/${inv.id}/send`, reia);
    rememberOutboxFiles(inv.id);
    const total = db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(inv.id).total_amount;
    await post(`/api/invoices/${inv.id}/payments`, finance, { amount: total, payment_date: '2026-05-20' });

    const supp = await post('/api/invoices/supplementary', reia, {
      parent_invoice_id: inv.id, contract_id: contract.id, billing_period: '2026-04',
      amount: 125000, reason_code: 'TARIFF_REVISION', reason: 'CERC order dated 2026-05-30',
    });
    expect(supp.status, JSON.stringify(supp.body)).toBe(201);
    expect(supp.body.invoice_type).toBe('SUPPLEMENTARY');
    expect(supp.body.parent_invoice_id).toBe(inv.id);
    expect(supp.body.status).toBe('DRAFT');
    // A supplementary is its own bill: the settled original does not reopen.
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('PAID');
    // And it starts its own approval chain rather than inheriting a cleared one.
    expect(db.prepare(`SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ? AND status = 'PENDING'`)
      .get(supp.body.id).c).toBeGreaterThan(0);
  });

  it('recovers an under-billed past period through an arrear bill', async () => {
    const arrear = await post('/api/invoices/arrear', reia, {
      contract_id: contract.id, arrear_period: '2026-02', amount: 450000, taxes: 0,
      reason: 'Escalation missed in the February run',
    });
    expect(arrear.status, JSON.stringify(arrear.body)).toBe(201);
    expect(arrear.body.invoice_type).toBe('ARREAR');

    const noReason = await post('/api/invoices/arrear', reia,
      { contract_id: contract.id, arrear_period: '2026-02', amount: 450000 });
    expect(noReason.status, 'an arrear was recovered without saying why').toBe(400);
  });

  it('will not let a cancelled bill be paid, sent or re-approved', async () => {
    lockEnergy(50);
    const maker = makeUser('REIA_USER', { name: 'Cancel Maker' });
    const inv = (await post('/api/invoices/generate', signFor(maker),
      { contract_id: contract.id, period_month: '2026-04' })).body;

    const cancelled = await post(`/api/invoices/${inv.id}/cancel`, reia, { reason: 'raised on the wrong PSA' });
    expect(cancelled.status).toBeLessThan(400);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('CANCELLED');

    expect((await post(`/api/invoices/${inv.id}/payments`, finance,
      { amount: 100, payment_date: '2026-05-01' })).status).toBe(400);
    expect((await post(`/api/invoices/${inv.id}/send`, reia)).status).toBe(400);
    expect((await post(`/api/invoices/${inv.id}/submit-for-approval`, signFor(maker))).status).toBe(400);
  });
});

describe('E2E: paying the generator', () => {
  /** A developer bill that has cleared approval, ready to be paid out against. */
  async function approvedDeveloperBill() {
    const maker = makeUser('REIA_USER', { name: `Dev Bill Maker ${Math.random()}` });
    const ppa = makeContract({
      contract_type: 'PPA', project_type: 'SOLAR', status: 'ACTIVE',
      seller_id: seller.id, buyer_id: buyer.id, tariff_per_unit: 3.0, payment_terms_days: 30,
    });
    db.prepare(`
      INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
      VALUES (?, ?, '2026-04', 'FINAL', 'SEA', 400, 'LOCKED')
    `).run(`ENG-${Math.random().toString(36).slice(2, 10)}`, ppa.id);

    const gen = await post('/api/invoices/generate', signFor(maker),
      { contract_id: ppa.id, period_month: '2026-04' });
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    expect(gen.body.direction).toBe('SELLER_TO_SJVN');
    await post(`/api/invoices/${gen.body.id}/submit-for-approval`, signFor(maker));
    await clearApprovalChain(gen.body.id,
      db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(gen.body.id).c);
    return db.prepare('SELECT * FROM invoices WHERE id = ?').get(gen.body.id);
  }

  it('refuses to release money to an account that has not passed penny drop', async () => {
    const inv = await approvedDeveloperBill();
    db.prepare('UPDATE entities SET is_penny_drop_verified = 0 WHERE id = ?').run(seller.id);

    const r = await post(`/api/invoices/${inv.id}/release-to-generator`, finance,
      { amount: 10000, source: 'OWN_FUND', payment_date: '2026-05-15' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/penny.drop/i);
    expect(db.prepare('SELECT COUNT(*) c FROM payments WHERE invoice_id = ?').get(inv.id).c).toBe(0);
  });

  it('refuses to release money while a bank change is still unverified', async () => {
    const inv = await approvedDeveloperBill();
    db.prepare('UPDATE entities SET pending_bank_json = ? WHERE id = ?')
      .run(JSON.stringify({ account_no: '9999', ifsc: 'HDFC0000001' }), seller.id);

    const r = await post(`/api/invoices/${inv.id}/release-to-generator`, finance,
      { amount: 10000, source: 'OWN_FUND', payment_date: '2026-05-15' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/awaiting penny-drop verification/i);
  });

  it('will not pay out from DISCOM realization that has not been realized', async () => {
    const inv = await approvedDeveloperBill();
    const r = await post(`/api/invoices/${inv.id}/release-to-generator`, finance,
      { amount: 10000, source: 'DISCOM_REALIZATION', payment_date: '2026-05-15' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing realized|realized from the DISCOM/i);
  });

  it('releases from own fund once the account is verified, and records it as a payment', async () => {
    const inv = await approvedDeveloperBill();
    const r = await post(`/api/invoices/${inv.id}/release-to-generator`, finance,
      { amount: 250000, source: 'OWN_FUND', payment_date: '2026-05-15', reference: 'UTR-DEV-1' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const pmt = db.prepare('SELECT * FROM payments WHERE invoice_id = ?').get(inv.id);
    expect(pmt.amount).toBe(250000);
    expect(pmt.release_source).toBe('OWN_FUND');
    expect(db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE entity_id = ? AND action = 'RELEASE_TO_GENERATOR'`)
      .get(inv.id).c).toBe(1);
  });

  it('refuses a source it does not recognise', async () => {
    const inv = await approvedDeveloperBill();
    const r = await post(`/api/invoices/${inv.id}/release-to-generator`, finance,
      { amount: 1000, source: 'PETTY_CASH', payment_date: '2026-05-15' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/source must be one of/);
  });
});
