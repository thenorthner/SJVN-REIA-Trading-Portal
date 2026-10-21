import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { auth, makeContract, makeUser } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// Hydro QA run 2 (18-Oct-2026): who may sign a hydro bill, and how often.

let maker, hod, admin2, sjvnAdmin, reiaUser, buyer, bill;
const tok = (u) => signToken(u);
const send = (body, who = maker) => request(app).post(`/api/hydro-billing/${bill.id}/send-for-approval`).set(auth(tok(who))).send({ comments: 'QA', ...body });
const act = (body, who) => request(app).post(`/api/hydro-billing/${bill.id}/approve`).set(auth(tok(who))).send({ comments: 'QA', ...body });

function draftBill(createdBy) {
  const station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA2-${Math.random().toString(36).slice(2, 8)}` });
  const id = newId('HSB');
  const zeros = ['a1_afc', 'a2_design_energy_mwh', 'a3_aux_pct', 'a4_fehs_pct', 'a5_ex_bus_design_energy_mwh', 'a6_ex_bus_saleable_design_energy_mwh',
    'a8_days_in_month', 'a9_days_in_year', 'a11_napaf_pct', 'a12_ecr', 'a13_ecr_excess', 'c1_pafm_pct', 'c2_capacity_charge', 'c5_total_capacity_charge',
    'e1_ex_bus_scheduled_kwh', 'e2_free_power_kwh', 'e3_saleable_scheduled_kwh', 'e4_cum_scheduled_kwh', 'e5_cum_free_power_kwh', 'e6_cum_saleable_kwh',
    'e7_excess_kwh', 'e8_upto_design_kwh', 'ee1_energy_charge', 'ee2_excess_energy_charge', 'total_charges'];
  db.prepare(`INSERT INTO hydro_station_bills (id, bill_no, contract_id, station_name, billing_month, financial_year, created_by, prepared_by, ${zeros.join(', ')})
    VALUES (?, ?, ?, 'QA Station', '2026-09', '2026-2027', ?, ?, ${zeros.map(() => '0').join(', ')})`).run(id, `HB/QA/${id.slice(-6)}`, station.id, createdBy.id, createdBy.name);
  return db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(id);
}

beforeEach(() => {
  maker = makeUser('COMMERCIAL_ADMIN', { name: 'QA Maker' });
  hod = makeUser('COMMERCIAL', { name: 'QA HoD' });
  admin2 = makeUser('COMMERCIAL_ADMIN', { name: 'QA Admin Two' });
  sjvnAdmin = makeUser('SJVN_ADMIN', { name: 'QA SJVN Admin' });
  reiaUser = makeUser('REIA_USER', { name: 'QA REIA' });
  buyer = makeUser('BUYER', { name: 'QA Buyer' });
  bill = draftBill(maker);
});

describe('The approval chain of a hydro bill', () => {
  it('names only approvers on the hydro desk', async () => {
    expect((await send({ next_approver_id: reiaUser.id, final_approver_id: admin2.id })).body.error).toMatch(/cannot approve a hydro bill/);
    expect((await send({ next_approver_id: hod.id, final_approver_id: buyer.id })).body.error).toMatch(/cannot approve a hydro bill/);
    expect((await send({ next_approver_id: hod.id, final_approver_id: admin2.id })).status).toBe(200);
  });

  it('never lets the SJVN administrator into the chain (Target #2 Phase B)', async () => {
    // Before Phase B an administrator could raise a bill and was then refused as
    // its own approver. Now it neither sends a bill nor can be named to sign one.
    bill = draftBill(sjvnAdmin);
    expect((await send({ next_approver_id: hod.id, final_approver_id: hod.id }, sjvnAdmin)).status).toBe(403);
    bill = draftBill(maker);
    const named = await send({ next_approver_id: sjvnAdmin.id, final_approver_id: sjvnAdmin.id });
    expect(named.status).toBe(400);
    expect(named.body.error).toMatch(/cannot approve a hydro bill/);
  });

  it('does not name the maker as the final approver', async () => {
    expect((await send({ next_approver_id: hod.id, final_approver_id: maker.id })).body.error).toMatch(/Segregation of duties/);
  });

  it('lets each approver sign once', async () => {
    await send({ next_approver_id: hod.id, final_approver_id: admin2.id });
    expect((await act({ action: 'APPROVE', next_approver_id: hod.id }, hod)).body.error).toMatch(/each approver signs a bill once/);
    expect((await act({ action: 'APPROVE', next_approver_id: admin2.id }, hod)).body.outcome).toBe('APPROVED_AND_MOVED_ON');
    expect((await act({ action: 'APPROVE' }, admin2)).body.outcome).toBe('APPROVED');
  });
});

describe('The final signature', () => {
  it('is on the bill under the name of whoever signed last', async () => {
    await send({ next_approver_id: hod.id, final_approver_id: admin2.id });
    const r = await act({ action: 'APPROVE', mark_final: true }, hod);
    expect(r.body.approval_status).toBe('APPROVED');
    expect(db.prepare('SELECT final_approver_name FROM hydro_station_bills WHERE id = ?').get(bill.id).final_approver_name).toBe('QA HoD');
  });
});
