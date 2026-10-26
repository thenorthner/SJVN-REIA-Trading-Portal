import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { computeCufPenalty, computeActualCufPercent } from '../../src/services/cufPenalty.js';
import { bankingCycleFor } from '../../src/services/energyBanking.js';
import { contractCompliance } from '../../src/services/contractCompliance.js';

// The open questions from the REIA QA runs, decided on 17-Oct-2026
// (docs/DECISIONS_2026-10-17.md). One test per decision that changes behaviour.

let reia, checker, finance;
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  // Phase B.2: activating a contract and drawing on an LC are the checker's.
  checker = tokenFor('REIA_CHECKER');
  finance = tokenFor('FINANCE_USER');
});

describe('Contracts', () => {
  const doc = (c) => db.prepare(`INSERT INTO documents (id, contract_id, document_type, category, title) VALUES (?, ?, 'CONTRACT', 'RECORD', 'Agreement')`).run(`DOC-${c.id}`, c.id);

  it('stays SIGNED until its start date', async () => {
    const c = makeContract({ status: 'SIGNED', tenure_start: day(30), tenure_end: day(400), min_cuf_percent: 20 });
    doc(c);
    const r = await post(`/api/contracts/${c.id}/status`, { status: 'ACTIVE' }, checker);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/stays SIGNED until then/);
  });

  it('goes live as an RE PPA only with its own minimum CUF', async () => {
    const c = makeContract({ status: 'SIGNED', project_type: 'Solar', tenure_start: day(-10), tenure_end: day(400) });
    db.prepare('UPDATE contracts SET min_cuf_percent = NULL WHERE id = ?').run(c.id);
    doc(c);
    const r = await post(`/api/contracts/${c.id}/status`, { status: 'ACTIVE' }, checker);
    expect(r.status).toBe(400);
    expect(r.body.missing_field).toBe('min_cuf_percent');
    db.prepare('UPDATE contracts SET min_cuf_percent = 21 WHERE id = ?').run(c.id);
    expect((await post(`/api/contracts/${c.id}/status`, { status: 'ACTIVE' }, checker)).status).toBe(200);
  });
});

describe('CUF', () => {
  it('prices the shortfall at the PPA\'s own compensation rate', () => {
    const c = makeContract({ project_type: 'Solar', capacity_mw: 10, min_cuf_percent: 20, cuf_shortfall_comp_pct: 50 });
    const row = db.prepare('SELECT * FROM contracts WHERE id = ?').get(c.id);
    const full = computeCufPenalty({ contract: { ...row, cuf_shortfall_comp_pct: null }, periodMonth: '2026-06', energyMwh: 720, capacityMw: 10, tariffPerUnit: 3 });
    const half = computeCufPenalty({ contract: row, periodMonth: '2026-06', energyMwh: 720, capacityMw: 10, tariffPerUnit: 3 });
    expect(half.penalty).toBe(Math.round(full.penalty / 2));
  });

  it('is worked out from the energy, not the rounded reported figure', () => {
    expect(computeActualCufPercent({ energyMwh: 2000, capacityMw: 50, periodMonth: '2026-07', cufPercent: 5.38 })).toBeCloseTo(2000 / (50 * 744) * 100, 6);
  });
});

describe('Banking cycle', () => {
  it('follows the contract\'s basis, monthly by default', () => {
    expect(bankingCycleFor({}, '2026-08')).toMatchObject({ basis: 'MONTHLY', cycle: 'M2026-08', ends: '2026-08-31' });
    expect(bankingCycleFor({ banking_cycle_basis: 'SEASONAL' }, '2026-11')).toMatchObject({ cycle: 'S2-FY2026-27', ends: '2027-03-31' });
    expect(bankingCycleFor({ banking_cycle_basis: 'ANNUAL' }, '2027-02')).toMatchObject({ cycle: 'FY2026-27', ends: '2027-03-31' });
  });
});

describe('Disputes', () => {
  it('is raised, not auto-acknowledged', async () => {
    const buyerCo = makeEntity('BUYER');
    const c = makeContract({ contract_type: 'PSA', buyer_id: buyerCo.id });
    const inv = makeInvoice({ contract_id: c.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, energy_charges: 100000 });
    db.prepare(`UPDATE invoices SET issued_at = datetime('now') WHERE id = ?`).run(inv.id);
    const buyer = tokenFor('BUYER', { linked_entity_id: buyerCo.id });
    const r = await post('/api/disputes', { invoice_id: inv.id, reason_code: 'TARIFF_RATE_ERROR', charge_line: 'energy_charges', disputed_amount: 10000, issue_description: 'rate' }, buyer);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(db.prepare('SELECT status, acknowledged_by FROM disputes WHERE id = ?').get(r.body.id)).toMatchObject({ status: 'RAISED', acknowledged_by: null });
  });
});

describe('Payments and advances', () => {
  it('lets only Finance record a receipt, and holds an excess as the buyer\'s advance', async () => {
    const buyerCo = makeEntity('BUYER');
    const c = makeContract({ contract_type: 'PSA', buyer_id: buyerCo.id });
    const inv = makeInvoice({ contract_id: c.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: day(20) });
    const body = { amount: 150000, payment_date: day(0), mode: 'NEFT', reference: 'UTR-ADV-1' };
    expect((await post(`/api/invoices/${inv.id}/payments`, body)).status).toBe(403);
    expect((await post(`/api/invoices/${inv.id}/payments`, body, finance)).status).toBe(400);
    const ok = await post(`/api/invoices/${inv.id}/payments`, { ...body, excess_to_advance: true }, finance);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('PAID');
    const adv = db.prepare('SELECT * FROM unapplied_receipts WHERE entity_id = ?').get(buyerCo.id);
    expect(adv).toMatchObject({ source: 'EXCESS_PAYMENT', amount: 50000, balance: 50000, status: 'OPEN' });

    // Applied to the buyer's next bill.
    const next = makeInvoice({ contract_id: c.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 30000, due_date: day(30), billing_period: '2026-06' });
    const applied = await post(`/api/advances/${adv.id}/apply`, { invoice_id: next.id }, finance);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.invoice.status).toBe('PAID');
    expect(applied.body.advance).toMatchObject({ balance: 20000, status: 'OPEN' });
    expect((await post(`/api/advances/${adv.id}/refund`, { reference: 'UTR-RF-1', note: 'buyer asked for it back' }, finance)).body).toMatchObject({ balance: 0, status: 'REFUNDED' });
  });
});

describe('SJVN\'s own letters of credit', () => {
  it('records a seller\'s draw as an event, not a typed figure', async () => {
    const c = makeContract({ contract_type: 'PPA' });
    const lc = (await post('/api/security-desk/lcs', { contract_id: c.id, amount: 1000000, issuing_bank: 'SBI', validity_end: day(300) })).body;
    expect((await post(`/api/security-desk/lcs/${lc.id}/amend`, { utilized_amount: 5000 })).status).toBe(400);
    const drawn = await post(`/api/security-desk/lcs/${lc.id}/draws`, { amount: 200000, draw_date: day(0), bank_reference: 'BNK-77' }, checker);
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200);
    expect(drawn.body).toMatchObject({ utilized_amount: 200000, available_amount: 800000 });
    expect((await post(`/api/security-desk/lcs/${lc.id}/reinstate`, {}, checker)).body.utilized_amount).toBe(0);
  });
});

describe('Contract compliance', () => {
  it('does not hold SJVN\'s own station to developer KYC', () => {
    const own = makeEntity('SELLER');
    db.prepare('UPDATE entities SET is_sjvn_own = 1, status = ? WHERE id = ?').run('PENDING', own.id);
    const c = makeContract({ contract_type: 'PPA', seller_id: own.id });
    const row = contractCompliance().contracts.find((r) => r.contract_id === c.id || r.id === c.id);
    const approvals = row.checks.filter((k) => k.code === 'APPROVALS');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].state).toBe('NOT_APPLICABLE');
  });
});

describe('Onboarding', () => {
  it('takes a counterparty\'s new company only as its own group company', async () => {
    const mine = makeEntity('SELLER');
    const seller = signToken(makeUser('SELLER', { linked_entity_id: mine.id }));
    const asBuyer = await post('/api/entities', { entity_type: 'BUYER', name: 'X', category: 'DISCOM', pan_no: 'AAAPL1234C', gst_no: '27AAAPL1234C1Z5', contracted_capacity_mw: 10 }, seller);
    expect(asBuyer.status).toBe(403);
  });
});

describe('CERC Form-IV', () => {
  it('records a return filed outside the platform on its acknowledgement', async () => {
    const trader = tokenFor('TRADING_USER');
    const r = await post('/api/form-iv/mark-filed-outside', { period_type: 'MONTHLY', period: '2023-05', reference_no: 'CERC/ACK/123', submission_date: '2023-06-14' }, trader);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'SUBMITTED', reference_no: 'CERC/ACK/123', filed_outside: 1 });
  });
});
