import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { computeCoverage, createInstrumentsFromRequirements } from '../../src/paymentSecurityEngine.js';

// Found by the browser audit of Payment Security (17-Oct-2026) on the QA copy:
// activating a contract made up ACTIVE "To be confirmed" instruments that counted
// as cover and were drawn on; a buyer's LC was drawn for ₹3 lakh against ₹1 lakh
// owed, twice for the same bill; money received under a demand settled nothing;
// a refused demand left the cover drawn.

let reia, checker, psa, ppa;
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const row = (id) => db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id);

function instrument(contract, over = {}) {
  const r = {
    id: newId('PSC'), instrument_no: `PS/T/${Math.random().toString(36).slice(2, 8)}`, contract_id: contract.id, mechanism_type: 'LC',
    is_revolving: 0, limit_amount: 500000, utilized_amount: 0, waterfall_priority: 10, issuing_bank: 'SBI', bank_reference_no: `LC-${Math.random()}`,
    validity_start: day(-30), validity_end: day(300), status: 'ACTIVE', ...over,
  };
  r.available_amount = r.limit_amount - r.utilized_amount;
  const keys = Object.keys(r);
  db.prepare(`INSERT INTO payment_security (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => r[k]));
  return row(r.id);
}
const overdueBill = (amount = 100000) => makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: amount, energy_charges: amount, due_date: day(-40) });

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  // Phase B.2: checking is the checker's.
  checker = tokenFor('REIA_CHECKER');
  psa = makeContract({ contract_type: 'PSA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.95, buyer_id: makeEntity('BUYER').id });
  ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', seller_id: makeEntity('SELLER').id, pbg_amount: 5000000 });
});

describe('S45 Cover is what a bank has issued', () => {
  it('sets a requirement on activation and makes up no instrument', () => {
    expect(createInstrumentsFromRequirements(psa.id)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) c FROM payment_security').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM security_requirements WHERE contract_id = ?').get(psa.id).c).toBeGreaterThan(0);
    expect(computeCoverage(psa.id).available_security).toBe(0);
  });

  it('counts on a PSA only what answers for the buyer\'s payment', () => {
    instrument(psa, { limit_amount: 500000 });
    instrument(psa, { mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'PBG', limit_amount: 10000000, waterfall_priority: 20 });
    expect(computeCoverage(psa.id).available_security).toBe(500000);
  });

  it('wants the bank\'s number for a letter of credit the desk records', async () => {
    const r = await post('/api/payment-security', { contract_id: psa.id, mechanism_type: 'LC', limit_amount: 500000, issuing_bank: 'SBI', validity_start: day(0), validity_end: day(365) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/letter of credit number/);
  });
});

describe('S45 Invoking a buyer\'s letter of credit', () => {
  it('is for what is overdue, and not for the same bill twice', async () => {
    const lc = instrument(psa);
    expect((await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 100000 })).status, 'drawn with nothing overdue').toBe(400);
    overdueBill(100000);
    const over = await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 200000 });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/Only ₹1,00,000 can be demanded/);
    expect((await post('/api/payment-security/invocations', { contract_id: psa.id })).status).toBe(201);
    const again = await post('/api/payment-security/invocations', { contract_id: psa.id });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already demanded/);
    expect(row(lc.id).utilized_amount).toBe(100000);
  });

  it('settles the bill when the bank pays, and gives the cover back when it refuses', async () => {
    const lc = instrument(psa);
    const bill = overdueBill(100000);
    const inv = (await post('/api/payment-security/invocations', { contract_id: psa.id })).body;
    await post(`/api/payment-security/invocations/${inv.id}/transition`, { status: 'CLAIMED' }, checker);
    const paid = await post(`/api/payment-security/invocations/${inv.id}/transition`, { status: 'FUNDS_RECEIVED' }, checker);
    expect(paid.body.settled).toEqual([{ invoice_no: bill.invoice_no, amount: 100000 }]);
    // The principal is paid; only the surcharge earned while it was late is left.
    const after = db.prepare('SELECT status, lps FROM invoices WHERE id = ?').get(bill.id);
    expect(db.prepare('SELECT COALESCE(SUM(amount), 0) s FROM payments WHERE invoice_id = ?').get(bill.id).s).toBe(100000);
    const elig = (await request(app).get(`/api/payment-security/${lc.id}`).set(auth(reia))).body.invocation_eligibility;
    expect(elig.amount, 'the paid principal was invocable again').toBe(Math.round(after.lps));

    const bill2 = overdueBill(50000);
    const inv2 = (await post('/api/payment-security/invocations', { contract_id: psa.id, amount: 50000 })).body;
    expect(row(lc.id).utilized_amount).toBe(150000);
    await post(`/api/payment-security/invocations/${inv2.id}/transition`, { status: 'REJECTED', notes: 'Bank refused' }, checker);
    expect(row(lc.id).utilized_amount, 'a refused demand left the cover drawn').toBe(100000);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(bill2.id).status).toBe('SENT');
  });

  it('needs the ground for a seller default', async () => {
    instrument(ppa, { mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'PBG', limit_amount: 5000000, waterfall_priority: 20 });
    expect((await post('/api/payment-security/invocations', { contract_id: ppa.id, amount: 100000 })).status).toBe(400);
    expect((await post('/api/payment-security/invocations', { contract_id: ppa.id, amount: 100000, reason: 'Commissioning missed the SCOD by 90 days' })).status).toBe(201);
  });
});

describe('S45 Drawing, releasing and accepting', () => {
  it('says why a draw is taken', async () => {
    const lc = instrument(psa);
    expect((await post(`/api/payment-security/${lc.id}/utilize`, { amount: 1000 }, checker)).status).toBe(400);
    expect((await post(`/api/payment-security/${lc.id}/utilize`, { amount: 1000, reason: 'Default on the June bill' }, checker)).status).toBe(200);
  });

  it('keeps an instrument as cover while its release is only asked for', async () => {
    const lc = instrument(psa);
    expect((await post(`/api/payment-security/${lc.id}/release-request`, { reason: 'Contract ends' })).status).toBe(201);
    expect(row(lc.id).status).toBe('RELEASE_PENDING');
    expect(computeCoverage(psa.id).available_security).toBe(500000);
  });

  it('does not take on a submission that ran out while it waited', async () => {
    const ps = instrument(ppa, { mechanism_type: 'BANK_GUARANTEE', bg_subtype: 'PBG', status: 'DRAFT', submitted_by_side: 'SELLER', validity_end: day(-1) });
    const r = await post(`/api/security-desk/instruments/${ps.id}/decide`, { decision: 'ACCEPTED' }, checker);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/expired on .* while it awaited acceptance/);
    expect(row(ps.id).status).toBe('DRAFT');
  });
});
