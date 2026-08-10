import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, makeEntity, resetReia } from '../helpers/reia.js';
import { billableCapacityMw } from '../../src/util.js';
import { settlementPosition } from '../../src/services/contractSettlement.js';

let reia;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); });

const energy = (contractId, period, mwh) =>
  request(app).post('/api/energy-data').set(auth(reia))
    .send({ contract_id: contractId, period_month: period, data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: mwh });
const bill = (contractId, period) =>
  request(app).post('/api/invoices/generate').set(auth(reia)).send({ contract_id: contractId, period_month: period });

describe('S20 A contract bills only the periods it covered', () => {
  // EXPIRED is a billable status on purpose — a final bill for a period the
  // contract did cover often lands after it has ended — but nothing checked the
  // period, so a contract that ran to July 2026 raised invoices for 2031.
  let c;
  beforeEach(() => {
    c = makeContract({ status: 'ACTIVE', tenure_start: '2026-04-01', tenure_end: '2026-07-30', cod_date: '2026-04-01' });
  });

  it('bills a period inside the tenure', async () => {
    await energy(c.id, '2026-06', 100);
    expect((await bill(c.id, '2026-06')).status).toBe(201);
  });

  it('bills the final, part-month period the contract ran into', async () => {
    // Tenure ends on the 30th; July is still a period it covered.
    await energy(c.id, '2026-07', 100);
    expect((await bill(c.id, '2026-07')).status, 'the last month of the contract was refused').toBe(201);
  });

  it('refuses a period that begins after the contract ended', async () => {
    await energy(c.id, '2026-09', 100);
    const r = await bill(c.id, '2026-09');
    expect(r.status, 'a period the contract never covered was billed').toBe(400);
    expect(r.body.error).toMatch(/did not cover/i);
    expect(r.body.tenure_end).toBe('2026-07-30');
  });

  it('refuses a period years past the end date', async () => {
    await energy(c.id, '2031-01', 100);
    expect((await bill(c.id, '2031-01')).status).toBe(400);
  });

  it('still bills a covered period after the contract is marked EXPIRED', async () => {
    // The reason EXPIRED is billable at all: the true-up arrives late.
    db.prepare(`UPDATE contracts SET status = 'EXPIRED' WHERE id = ?`).run(c.id);
    await energy(c.id, '2026-06', 100);
    expect((await bill(c.id, '2026-06')).status, 'a legitimate late true-up was blocked').toBe(201);
  });
});

describe('S20 A part-commissioned plant is judged on what is commissioned', () => {
  // commissioned_capacity_mw was stored, shown in one report, and read by
  // nothing. Validation benchmarked the full contracted MW, so a 10 MW plant
  // filing a month's output for 25 MW passed as clean and was billed on it.

  it('falls back to contracted capacity when nothing is commissioned yet', () => {
    expect(billableCapacityMw({ capacity_mw: 25, commissioned_capacity_mw: 0 })).toBe(25);
    expect(billableCapacityMw({ capacity_mw: 25, commissioned_capacity_mw: null })).toBe(25);
  });

  it('uses the commissioned figure when there is one', () => {
    expect(billableCapacityMw({ capacity_mw: 25, commissioned_capacity_mw: 10 })).toBe(10);
  });

  it('flags a month of output the commissioned plant could not have produced', async () => {
    // 25 MW at 22% CUF expects 3,960 MWh; 10 MW expects 1,584.
    const c = makeContract({ status: 'ACTIVE', project_type: 'SOLAR', capacity_mw: 25, commissioned_capacity_mw: 10 });
    const e = await energy(c.id, '2026-06', 3960);
    const v = await request(app).post(`/api/energy-data/${e.body.id}/validate`).set(auth(reia)).send({});
    expect(v.body.status, 'output impossible for the commissioned plant was called clean').toBe('DISPUTED');
    expect(v.body.deviation_notes, 'the note does not say which capacity it judged').toMatch(/10 MW commissioned of 25 MW contracted/);
  });

  it('accepts what the commissioned plant plausibly did produce', async () => {
    const c = makeContract({ status: 'ACTIVE', project_type: 'SOLAR', capacity_mw: 25, commissioned_capacity_mw: 10 });
    const e = await energy(c.id, '2026-06', 1584);
    const v = await request(app).post(`/api/energy-data/${e.body.id}/validate`).set(auth(reia)).send({});
    expect(v.body.status).toBe('VALIDATED');
  });

  it('leaves a fully commissioned plant judged exactly as before', async () => {
    const c = makeContract({ status: 'ACTIVE', project_type: 'SOLAR', capacity_mw: 25 });
    const e = await energy(c.id, '2026-06', 3960);
    const v = await request(app).post(`/api/energy-data/${e.body.id}/validate`).set(auth(reia)).send({});
    expect(v.body.status).toBe('VALIDATED');
    expect(v.body.deviation_notes).not.toMatch(/commissioned of/);
  });
});

describe('S20 Ending a contract asks the money question', () => {
  // Termination wrote a status, a reason and a date. Nothing looked at whether
  // money was still owed either way, and nothing touched the security the
  // contract had been running on.
  let seller, c;
  beforeEach(() => {
    seller = makeEntity('SELLER');
    c = makeContract({ status: 'ACTIVE', seller_id: seller.id });
  });

  const setStatus = (status, body = {}) =>
    request(app).post(`/api/contracts/${c.id}/status`).set(auth(reia)).send({ status, ...body });

  it('reports nothing outstanding on a clean contract', () => {
    expect(settlementPosition(c.id).settled).toBe(true);
  });

  it('surfaces the position when the contract is terminated', async () => {
    makeInvoice({ contract_id: c.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 500000 });
    const r = await setStatus('TERMINATED', { termination_reason: 'FOR_CAUSE' });
    expect(r.status).toBe(200);
    expect(r.body.settlement, 'a contract was ended with no settlement position reported').toBeTruthy();
    expect(r.body.settlement.payable_to_generator).toBe(500000);
    expect(r.body.outstanding_actions.join(' ')).toMatch(/payable to the generator/i);
  });

  it('terminates anyway, since non-payment is the usual reason to', async () => {
    makeInvoice({ contract_id: c.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 700000 });
    const r = await setStatus('TERMINATED', { termination_reason: 'FOR_CAUSE' });
    expect(r.status, 'refusing to end a contract until the defaulter pays is backwards').toBe(200);
    expect(db.prepare('SELECT status FROM contracts WHERE id = ?').get(c.id).status).toBe('TERMINATED');
  });

  it('refuses to close a contract while its settlement is open', async () => {
    makeInvoice({ contract_id: c.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 500000 });
    await setStatus('TERMINATED', { termination_reason: 'FOR_CAUSE' });
    const r = await setStatus('CLOSED');
    expect(r.status, 'a contract with dues outstanding was quietly closed').toBe(400);
    expect(r.body.outstanding_actions.length).toBeGreaterThan(0);
    expect(db.prepare('SELECT status FROM contracts WHERE id = ?').get(c.id).status).toBe('TERMINATED');
  });

  it('closes once the settlement is clear', async () => {
    await setStatus('TERMINATED', { termination_reason: 'FOR_CONVENIENCE' });
    const r = await setStatus('CLOSED');
    expect(r.status).toBeLessThan(400);
    expect(db.prepare('SELECT status FROM contracts WHERE id = ?').get(c.id).status).toBe('CLOSED');
  });

  it('lets it be closed over an open settlement when someone owns that', async () => {
    makeInvoice({ contract_id: c.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 500000 });
    await setStatus('TERMINATED', { termination_reason: 'FOR_CAUSE' });
    const r = await setStatus('CLOSED', { settlement_override_reason: 'Written back under the settlement agreement of 12 Aug.' });
    expect(r.status).toBeLessThan(400);
    const a = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'STATUS_CLOSED'`).get(c.id);
    expect(String(a.reason ?? ''), 'closing over an open settlement recorded no reason').toMatch(/written back/i);
  });

  it('tells finance there is something left to do', async () => {
    makeInvoice({ contract_id: c.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 500000 });
    await setStatus('TERMINATED', { termination_reason: 'FOR_CAUSE' });
    const n = db.prepare(`SELECT * FROM notifications WHERE type = 'CONTRACT_SETTLEMENT_DUE'`).get();
    expect(n, 'finance was never told the contract ended with money open').toBeTruthy();
    expect(n.role).toBe('FINANCE_USER');
  });

  it('records the state the contract moved from', async () => {
    await setStatus('TERMINATED', { termination_reason: 'FOR_CAUSE' });
    const a = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'STATUS_TERMINATED'`).get(c.id);
    expect(String(a.before_value ?? '')).toContain('ACTIVE');
  });
});
