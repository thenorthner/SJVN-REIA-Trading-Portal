import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, resetReia } from '../helpers/reia.js';

// The platform knew when a contract runs, when the project was commissioned, what
// security it requires against what is lodged, and whether the counterparty's
// approvals are in order. Nothing put those beside each other, so "which PPAs
// expire this quarter, which are live without their guarantee, whose licences
// lapsed" had no screen to ask them of.

const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

let reia, seller;

const security = (contractId, entityId, limit, validityEnd, status = 'ACTIVE') => db.prepare(`
  INSERT INTO payment_security (
    id, instrument_no, entity_id, contract_id, mechanism_type, limit_amount,
    utilized_amount, available_amount, status, validity_end
  ) VALUES (?, ?, ?, ?, 'BANK_GUARANTEE', ?, 0, ?, ?, ?)
`).run(newId('PS'), `BG-${newId('X')}`, entityId, contractId, limit, limit, status, validityEnd);

const requirement = (contractId, minAmount) => db.prepare(`
  INSERT INTO security_requirements (id, contract_id, mechanism_type, min_amount)
  VALUES (?, ?, 'BANK_GUARANTEE', ?)
`).run(newId('SR'), contractId, minAmount);

const approval = (entityId, label, status, over = {}) => db.prepare(`
  INSERT INTO entity_regulatory_approvals (id, entity_id, approval_code, label, is_mandatory, status, valid_until)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(newId('APR'), entityId, over.code || `CODE-${label.replace(/\s/g, '')}`, label,
  over.is_mandatory ?? 1, status, over.valid_until || null);

const energy = (contractId, period, status = 'LOCKED') => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
  VALUES (?, ?, ?, 'FINAL', 'REA', 1000, ?)
`).run(newId('ENG'), contractId, period, status);

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM payment_security').run();
  db.prepare('DELETE FROM security_requirements').run();
  db.prepare('DELETE FROM entity_regulatory_approvals').run();
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER', { name: 'Test Solar Ltd' });
});

const report = (query = '') => request(app).get(`/api/reports/contract-compliance${query}`).set(auth(reia));
const checkOf = (row, code) => row.checks.find((c) => c.code === code);

describe('S31 Contract compliance', () => {
  it('passes a contract that is inside its tenure, commissioned and secured', async () => {
    const c = makeContract({
      seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/OK/1',
      tenure_start: dayOffset(-400), tenure_end: dayOffset(900),
      cod_date: dayOffset(-380), capacity_mw: 100, commissioned_capacity_mw: 100,
    });
    requirement(c.id, 5000000);
    security(c.id, seller.id, 5000000, dayOffset(400));
    approval(seller.id, 'CEA Registration', 'VERIFIED');

    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/OK/1');
    expect(row.state).toBe('OK');
    expect(row.checks.map((k) => k.state)).not.toContain('BREACH');
    expect(checkOf(row, 'SECURITY').state).toBe('OK');
    expect(checkOf(row, 'APPROVALS').detail).toMatch(/1 in order/);
  });

  it('calls a live contract past its end date a breach', async () => {
    makeContract({
      seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/LAPSED/1',
      tenure_start: dayOffset(-800), tenure_end: dayOffset(-30), cod_date: dayOffset(-700),
    });
    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/LAPSED/1');
    expect(row.state).toBe('BREACH');
    expect(checkOf(row, 'TENURE').detail).toMatch(/Ended 30 days ago and still ACTIVE/);
  });

  it('flags one that ends inside the notice window as due, not broken', async () => {
    makeContract({
      seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/SOON/1',
      tenure_start: dayOffset(-700), tenure_end: dayOffset(45), cod_date: dayOffset(-600),
      capacity_mw: 50, commissioned_capacity_mw: 50,
    });
    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/SOON/1');
    expect(checkOf(row, 'TENURE').state).toBe('DUE');
    expect(row.days_to_expiry).toBe(45);
    expect(body.totals.expiring_within_notice).toBe(1);
  });

  it('takes the notice window the caller asks for', async () => {
    makeContract({
      seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/SOON/2',
      tenure_start: dayOffset(-700), tenure_end: dayOffset(45), cod_date: dayOffset(-600),
    });
    const tight = await report('?expiry_notice_days=30');
    expect(checkOf(tight.body.contracts[0], 'TENURE').state).toBe('OK');
    expect(tight.body.expiry_notice_days).toBe(30);
  });

  it('will not let energy be billed against a contract with no commissioning date', async () => {
    const c = makeContract({
      seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/NOCOD/1',
      tenure_start: dayOffset(-300), tenure_end: dayOffset(900), cod_date: null,
    });
    energy(c.id, '2026-07');
    energy(c.id, '2026-08');
    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/NOCOD/1');
    expect(checkOf(row, 'COD').state).toBe('BREACH');
    expect(checkOf(row, 'COD').detail).toMatch(/2 month\(s\) of energy accounted with no COD/);
  });

  it('calls a live contract short of its required security a breach', async () => {
    const c = makeContract({
      seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/SHORT/1',
      tenure_start: dayOffset(-100), tenure_end: dayOffset(900), cod_date: dayOffset(-90),
    });
    requirement(c.id, 5000000);
    security(c.id, seller.id, 2000000, dayOffset(400));
    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/SHORT/1');
    expect(checkOf(row, 'SECURITY').state).toBe('BREACH');
    expect(checkOf(row, 'SECURITY').detail).toMatch(/2000000 lodged against 5000000 required/);
  });

  it('warns before a guarantee lapses and breaches after', async () => {
    const soon = makeContract({ seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/BG-SOON/1', tenure_end: dayOffset(900), cod_date: dayOffset(-90) });
    security(soon.id, seller.id, 1000000, dayOffset(20));
    const lapsed = makeContract({ seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/BG-GONE/1', tenure_end: dayOffset(900), cod_date: dayOffset(-90) });
    security(lapsed.id, seller.id, 1000000, dayOffset(-3));

    const { body } = await report();
    expect(checkOf(body.contracts.find((r) => r.contract_no === 'PPA/BG-SOON/1'), 'SECURITY').state).toBe('DUE');
    expect(checkOf(body.contracts.find((r) => r.contract_no === 'PPA/BG-GONE/1'), 'SECURITY').state).toBe('BREACH');
  });

  it('reads the counterparty’s approvals, lapsed or outstanding', async () => {
    const lapsedSeller = makeEntity('SELLER', { name: 'Lapsed Licence Ltd' });
    const c = makeContract({ seller_id: lapsedSeller.id, status: 'ACTIVE', contract_no: 'PPA/APPROVALS/1', tenure_end: dayOffset(900), cod_date: dayOffset(-90) });
    approval(lapsedSeller.id, 'CEA Registration', 'VERIFIED', { valid_until: dayOffset(-10) });
    approval(lapsedSeller.id, 'Consent to Operate', 'NOT_STARTED');

    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/APPROVALS/1');
    expect(checkOf(row, 'APPROVALS').state).toBe('BREACH');
    expect(checkOf(row, 'APPROVALS').detail).toMatch(/1 lapsed: CEA Registration/);
    expect(c.id).toBeTruthy();
  });

  it('does not count an approval marked not applicable as missing', async () => {
    const s2 = makeEntity('SELLER', { name: 'Exempt Ltd' });
    makeContract({ seller_id: s2.id, status: 'ACTIVE', contract_no: 'PPA/NA/1', tenure_end: dayOffset(900), cod_date: dayOffset(-90) });
    approval(s2.id, 'Forest Clearance', 'NOT_APPLICABLE');
    approval(s2.id, 'CEA Registration', 'VERIFIED');
    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/NA/1');
    expect(checkOf(row, 'APPROVALS').state).toBe('OK');
  });

  it('sorts the breaches to the top and counts each state', async () => {
    makeContract({ seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/FINE/1', tenure_start: dayOffset(-100), tenure_end: dayOffset(900), cod_date: dayOffset(-90), capacity_mw: 10, commissioned_capacity_mw: 10 });
    makeContract({ seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/BROKEN/1', tenure_start: dayOffset(-900), tenure_end: dayOffset(-5), cod_date: dayOffset(-800) });

    const { body } = await report();
    expect(body.contracts[0].contract_no).toBe('PPA/BROKEN/1');
    expect(body.totals.breach).toBeGreaterThanOrEqual(1);
    expect(body.totals.contracts).toBe(body.totals.breach + body.totals.due + body.totals.ok);
  });

  it('judges a contract that is not live by what it is, not by breaching it', async () => {
    makeContract({ seller_id: seller.id, status: 'DRAFT', contract_no: 'PPA/DRAFT/1', tenure_start: dayOffset(-900), tenure_end: dayOffset(-100) });
    const { body } = await report();
    const row = body.contracts.find((r) => r.contract_no === 'PPA/DRAFT/1');
    expect(checkOf(row, 'TENURE').state).toBe('NOT_APPLICABLE');
    expect(checkOf(row, 'TENURE').detail).toMatch(/Contract is DRAFT/);
  });

  it('is not a counterparty’s to read', async () => {
    const sellerUser = tokenFor('SELLER', { linked_entity_id: seller.id });
    expect((await request(app).get('/api/reports/contract-compliance').set(auth(sellerUser))).status).toBe(403);
  });
});
