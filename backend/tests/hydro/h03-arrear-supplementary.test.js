import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { makeUser, auth } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// Hydro QA run 3 (18-Oct-2026): a second arrear on a month, supplementary
// bills on months not billed, and who may recall a bill.

let contract, maker, hod, other, hodUser, afc0;
const post = (url, token, body = {}) => request(app).post(url).set(auth(token)).send(body);

async function approveAndIssue(id) {
  await post(`/api/hydro-billing/${id}/send-for-approval`, maker, { next_approver_id: hodUser.id, final_approver_id: hodUser.id, comments: 'QA' });
  await post(`/api/hydro-billing/${id}/approve`, hod, { action: 'APPROVE', comments: 'QA' });
  return post(`/api/hydro-billing/${id}/issue`, maker, { due_date: '2026-12-31' });
}
const setAfc = (afc) => {
  db.prepare('DELETE FROM hydro_station_tariffs WHERE contract_id = ?').run(contract.id);
  db.prepare(`INSERT INTO hydro_station_tariffs (id, contract_id, financial_year, annual_afc) VALUES ('HST-H3', ?, '2026-2027', ?)`).run(contract.id, afc);
};

beforeAll(async () => {
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  for (const t of ['hydro_arrear_months', 'hydro_notes', 'hydro_ledger_clearings', 'hydro_ledger_docs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM hydro_station_tariffs WHERE contract_id = ?').run(contract.id);
  afc0 = Number(contract.annual_afc);
  const makerUser = makeUser('COMMERCIAL', { name: 'H3 Maker' });
  hodUser = makeUser('COMMERCIAL_ADMIN', { name: 'H3 HoD' });
  maker = signToken(makerUser);
  hod = signToken(hodUser);
  other = signToken(makeUser('COMMERCIAL', { name: 'H3 Other' }));
  const june = await post('/api/hydro-billing', maker, { contract_id: contract.id, billing_month: '2026-06', ex_bus_scheduled_kwh: 500000000, pafm_percent: 100, beta_value: 0 });
  expect(june.status, JSON.stringify(june.body)).toBe(200);
  expect((await approveAndIssue(june.body.id)).status).toBe(200);
});

describe('A second arrear on a month', () => {
  it('splits its difference against the first arrear too: capacity + energy = the difference', async () => {
    setAfc(afc0 * 1.1);
    const first = await post('/api/hydro-billing/arrears', maker, { contract_id: contract.id, from_month: '2026-06', to_month: '2026-06', reason: 'QA first revision of the AFC' });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((await approveAndIssue(first.body.id)).status).toBe(200);

    setAfc(afc0 * 1.2);
    const second = await post('/api/hydro-billing/arrears/preview', maker, { contract_id: contract.id, from_month: '2026-06', to_month: '2026-06' });
    const m = second.body.months[0];
    for (const l of m.lines) expect(l.capacity_differential + l.energy_differential).toBeCloseTo(l.differential, 1);
    // The second revision moves the AFC by the same step as the first, so the
    // second capacity difference equals the first's.
    expect(m.capacity_differential).toBeCloseTo(first.body.months[0].capacity_differential, 0);
  });
});

describe('A supplementary bill', () => {
  it('is raised on a month already billed — not one to come, nor one with no bill', async () => {
    const body = { contract_id: contract.id, amount: 100000, reason: 'TAXES_DUTIES', particulars: 'Water cess for the month' };
    expect((await post('/api/hydro-billing/supplementary', maker, { ...body, billing_month: '2099-12' })).body.error).toMatch(/still to come/);
    expect((await post('/api/hydro-billing/supplementary', maker, { ...body, billing_month: '2026-05' })).body.error).toMatch(/no issued bill for 2026-05/);
    expect((await post('/api/hydro-billing/supplementary', maker, { ...body, billing_month: '2026-06' })).status).toBe(200);
  });

  it('finds a named beneficiary whatever the case', async () => {
    const r = await post('/api/hydro-billing/supplementary', maker, { contract_id: contract.id, billing_month: '2026-06', amount: 5000, reason: 'OTHER', particulars: 'One beneficiary only item', beneficiary_name: 'punjab' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});

describe('Recalling a bill', () => {
  it('is for the maker: another desk officer is refused', async () => {
    const r = await post('/api/hydro-billing/supplementary', maker, { contract_id: contract.id, billing_month: '2026-06', amount: 1000, reason: 'OTHER', particulars: 'Recall test supplementary' });
    await post(`/api/hydro-billing/${r.body.id}/send-for-approval`, maker, { next_approver_id: hodUser.id, final_approver_id: hodUser.id, comments: 'QA' });
    expect((await post(`/api/hydro-billing/${r.body.id}/recall`, other, { reason: 'not mine to recall' })).status).toBe(403);
    expect((await post(`/api/hydro-billing/${r.body.id}/recall`, maker, { reason: 'wrong amount' })).status).toBe(200);
  });
});
