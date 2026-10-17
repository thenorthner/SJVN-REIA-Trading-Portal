import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { signToken } from '../../src/middleware/auth.js';
import { computeCoverage } from '../../src/paymentSecurityEngine.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Found by the browser audit of the contract compliance desk (17-Oct-2026): it
// called three PSAs "none required" that the Payment Security engine calls
// under-secured; counted a drawn letter of credit at its full limit; filed
// drafts and terminated contracts under "Action due" (11 of 12); held a PSA to a
// COD of its own; counted energy rows as months and missed energy billed before
// the COD; took a submitted approval as in order; ignored a blacklisted
// counterparty; and replaced an unusable notice window with 90 without a word.

const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
let reia, seller;
const report = (q = '') => request(app).get(`/api/reports/contract-compliance${q}`).set(auth(reia));
const rowOf = (body, no) => body.contracts.find((r) => r.contract_no === no);
const checkOf = (row, code, label) => row.checks.find((c) => c.code === code && (!label || c.label === label));
const instrument = (contract, entity, type, limit, over = {}) => db.prepare(`
  INSERT INTO payment_security (id, instrument_no, entity_id, contract_id, mechanism_type, limit_amount, utilized_amount, available_amount, status, validity_start, validity_end)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId('PS'), `S51-${newId('X')}`, entity.id, contract.id, type, limit,
  over.used ?? 0, limit - (over.used ?? 0), over.status || 'ACTIVE', dayOffset(-30), over.end || dayOffset(400));
const energy = (contract, period) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, ?, 'FINAL', 'REA', 1000, 'LOCKED')`)
  .run(newId('ENG'), contract.id, period);
const approval = (entity, label, status) => db.prepare(`
  INSERT INTO entity_regulatory_approvals (id, entity_id, approval_code, label, is_mandatory, status) VALUES (?, ?, ?, ?, 1, ?)`)
  .run(newId('APR'), entity.id, `C-${label}`, label, status);
const live = (over = {}) => makeContract({
  contract_type: 'PPA', seller_id: seller.id, status: 'ACTIVE', tenure_start: dayOffset(-700), tenure_end: dayOffset(2000),
  cod_date: dayOffset(-600), capacity_mw: 50, commissioned_capacity_mw: 50, ...over,
});

beforeEach(() => {
  resetReia();
  for (const t of ['payment_security', 'security_requirements', 'entity_regulatory_approvals']) db.prepare(`DELETE FROM ${t}`).run();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER');
});

describe('S51 Security is the Payment Security engine\'s', () => {
  it('holds a PSA to the bills it has to cover, as the engine does, where it used to say "none required"', async () => {
    const buyer = makeEntity('BUYER');
    const psa = live({ contract_type: 'PSA', contract_no: 'PSA/S51/1', seller_id: null, buyer_id: buyer.id });
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-08', total_amount: 1000000 });
    const sec = checkOf(rowOf((await report()).body, 'PSA/S51/1'), 'SECURITY');
    const cover = computeCoverage(psa.id);
    expect(cover.adequate).toBe(false);
    expect(sec.state).toBe('BREACH');
    expect(sec.detail).toContain(`against ₹${Math.max(cover.exposure, cover.required_amount).toLocaleString('en-IN')} required`);
  });

  it('counts what is left on a drawn instrument, and only the paying side\'s', async () => {
    const buyer = makeEntity('BUYER');
    const psa = live({ contract_type: 'PSA', contract_no: 'PSA/S51/2', seller_id: null, buyer_id: buyer.id });
    instrument(psa, buyer, 'LC', 500000, { used: 100000, status: 'PARTIALLY_UTILIZED' });
    instrument(psa, buyer, 'BANK_GUARANTEE', 9000000); // a seller's instrument: no cover for a buyer's default
    expect(checkOf(rowOf((await report()).body, 'PSA/S51/2'), 'SECURITY').detail).toMatch(/^₹4,00,000 in force/);
  });

  it('breaches a lapsed guarantee nobody replaced, and not one that was replaced', async () => {
    const gone = live({ contract_no: 'PPA/S51/GONE' });
    instrument(gone, seller, 'BANK_GUARANTEE', 1000000, { end: dayOffset(-3) });
    const replaced = live({ contract_no: 'PPA/S51/REPLACED' });
    instrument(replaced, seller, 'BANK_GUARANTEE', 1000000, { end: dayOffset(-3) });
    instrument(replaced, seller, 'BANK_GUARANTEE', 1000000);
    const { body } = await report();
    expect(checkOf(rowOf(body, 'PPA/S51/GONE'), 'SECURITY')).toMatchObject({ state: 'BREACH' });
    expect(checkOf(rowOf(body, 'PPA/S51/GONE'), 'SECURITY').detail).toMatch(/lapsed 3 days ago and not replaced/);
    expect(checkOf(rowOf(body, 'PPA/S51/REPLACED'), 'SECURITY').state).toBe('OK');
  });
});

describe('S51 What is judged, and on what', () => {
  it('lists drafts and terminated contracts as not live, outside the compliance counts', async () => {
    live({ contract_no: 'PPA/S51/DRAFT', status: 'DRAFT' });
    live({ contract_no: 'PPA/S51/TERM', status: 'TERMINATED' });
    approval(seller, 'CEA Registration', 'NOT_STARTED');
    const { body } = await report();
    expect(rowOf(body, 'PPA/S51/DRAFT').state).toBe('NOT_LIVE');
    expect(body.totals).toMatchObject({ not_live: 2, due: 0, breach: 0 });
  });

  it('reads a PSA\'s commissioning off its source plant, and does not judge its capacity', async () => {
    const buyer = makeEntity('BUYER');
    const ppa = live({ contract_no: 'PPA/S51/SRC', cod_date: dayOffset(30) });
    const psa = live({ contract_type: 'PSA', contract_no: 'PSA/S51/3', seller_id: null, buyer_id: buyer.id, cod_date: null });
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2024-01-01')`).run(newId('CAL'), ppa.id, psa.id);
    energy(psa, '2026-08');
    const row = rowOf((await report()).body, 'PSA/S51/3');
    expect(checkOf(row, 'COD')).toMatchObject({ state: 'DUE' });
    expect(checkOf(row, 'COD').detail).toMatch(/Source plant not yet commissioned: PPA\/S51\/SRC/);
    expect(checkOf(row, 'CAPACITY').state).toBe('NOT_APPLICABLE');
  });

  it('catches energy accounted before the COD, and counts months, not readings', async () => {
    const early = live({ contract_no: 'PPA/S51/EARLY', cod_date: '2026-08-01' });
    energy(early, '2026-07');
    const none = live({ contract_no: 'PPA/S51/NOCOD', cod_date: null });
    energy(none, '2026-07');
    energy(none, '2026-07');
    const { body } = await report();
    expect(checkOf(rowOf(body, 'PPA/S51/EARLY'), 'COD')).toMatchObject({ state: 'BREACH', detail: 'Energy accounted from 2026-07, before the COD of 2026-08-01' });
    expect(checkOf(rowOf(body, 'PPA/S51/NOCOD'), 'COD').detail).toMatch(/^1 month\(s\) of energy/);
  });
});

describe('S51 The counterparty', () => {
  it('takes a submitted approval as waiting, not in order', async () => {
    live({ contract_no: 'PPA/S51/SUB' });
    approval(seller, 'CEA Registration', 'SUBMITTED');
    const a = checkOf(rowOf((await report()).body, 'PPA/S51/SUB'), 'APPROVALS', 'Statutory approvals');
    expect(a).toMatchObject({ state: 'DUE' });
    expect(a.detail).toMatch(/awaiting verification: CEA Registration/);
  });

  it('breaches a live contract with a blacklisted or unapproved counterparty', async () => {
    const black = makeEntity('SELLER', { name: 'Black Ltd' });
    db.prepare(`UPDATE entities SET is_blacklisted = 1, blacklist_reason = 'fraud finding' WHERE id = ?`).run(black.id);
    live({ contract_no: 'PPA/S51/BLACK', seller_id: black.id });
    live({ contract_no: 'PPA/S51/PENDING', seller_id: makeEntity('SELLER', { name: 'New Ltd', status: 'PENDING' }).id });
    const { body } = await report();
    expect(checkOf(rowOf(body, 'PPA/S51/BLACK'), 'APPROVALS', 'Counterparty standing')).toMatchObject({ state: 'BREACH', detail: 'Black Ltd is blacklisted: fraud finding' });
    expect(checkOf(rowOf(body, 'PPA/S51/PENDING'), 'APPROVALS', 'Counterparty standing').detail).toMatch(/onboarding is pending, not approved/);
  });
});

describe('S51 The notice window and access', () => {
  it('refuses an unusable window instead of using 90', async () => {
    for (const q of ['0', '-5', 'abc', '2.5']) expect((await report(`?expiry_notice_days=${q}`)).status).toBe(400);
    expect((await report('?expiry_notice_days=30')).body.expiry_notice_days).toBe(30);
  });

  it('is SJVN\'s only', async () => {
    const s = signToken(makeUser('SELLER', { linked_entity_id: seller.id }));
    expect((await request(app).get('/api/reports/contract-compliance').set(auth(s))).status).toBe(403);
  });
});
