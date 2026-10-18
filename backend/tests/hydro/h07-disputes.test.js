import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { auth, makeContract, makeUser } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { insertDoc } from '../../src/services/hydroLedger.js';

// Hydro QA run 7 (18-Oct-2026): the dispute register and the credit an
// accepted dispute promises.

let station, pb, desk, admin;
const post = (path, body, who) => request(app).post(`/api/hydro-desk${path}`).set(auth(who)).send(body);
const get = (path, who) => request(app).get(`/api/hydro-desk${path}`).set(auth(who));

async function acceptedDispute(amount = 50000) {
  const d = await post('/disputes', { ledger_doc_id: pb.id, reason_code: 'REA_ENERGY_MISMATCH', description: 'REA shows less energy than billed', disputed_amount: amount }, desk);
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  await post(`/disputes/${d.body.id}/move`, { to: 'UNDER_REVIEW', remarks: 'review' }, desk);
  const a = await post(`/disputes/${d.body.id}/move`, { to: 'RESOLVED_ACCEPTED', remarks: 'accepted in part', accepted_amount: amount / 2 }, desk);
  expect(a.body.status).toBe('RESOLVED_ACCEPTED');
  return a.body;
}

beforeEach(() => {
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA7-${Math.random().toString(36).slice(2, 8)}` });
  db.prepare(`INSERT INTO hydro_beneficiary_allocations (id, contract_id, beneficiary_name, pct_rea, effective_from) VALUES (?, ?, 'QA STATE', 100, '2026-04-01')`).run(newId('HBA'), station.id);
  const billId = newId('HSB');
  const zeros = ['a1_afc', 'a2_design_energy_mwh', 'a3_aux_pct', 'a4_fehs_pct', 'a5_ex_bus_design_energy_mwh', 'a6_ex_bus_saleable_design_energy_mwh', 'a8_days_in_month', 'a9_days_in_year', 'a11_napaf_pct', 'a12_ecr', 'a13_ecr_excess', 'c1_pafm_pct', 'c2_capacity_charge', 'c5_total_capacity_charge', 'e1_ex_bus_scheduled_kwh', 'e2_free_power_kwh', 'e3_saleable_scheduled_kwh', 'e4_cum_scheduled_kwh', 'e5_cum_free_power_kwh', 'e6_cum_saleable_kwh', 'e7_excess_kwh', 'e8_upto_design_kwh', 'ee1_energy_charge', 'ee2_excess_energy_charge', 'total_charges'];
  db.prepare(`INSERT INTO hydro_station_bills (id, bill_no, contract_id, station_name, billing_month, financial_year, status, ${zeros.join(', ')}) VALUES (?, ?, ?, 'QA', '2026-06', '2026-2027', 'ISSUED', ${zeros.map(() => '0').join(', ')})`).run(billId, `HB/QA7/${billId.slice(-6)}`, station.id);
  pb = insertDoc({ doc_no: `PB/QA7/${billId.slice(-6)}`, contract_id: station.id, beneficiary_name: 'QA STATE', doc_type: 'PB', bill_id: billId, amount: 1000000, doc_date: '2026-09-01', due_date: '2026-10-15' });
  desk = signToken(makeUser('COMMERCIAL', { name: 'QA7 Desk' }));
  admin = signToken(makeUser('COMMERCIAL_ADMIN', { name: 'QA7 Admin' }));
});

describe('The dispute register', () => {
  it('answers /disputes/stats as statistics, not as a dispute id', async () => {
    const r = await get(`/disputes/stats?contract_id=${station.id}`, desk);
    expect(r.status).toBe(200);
  });

  it('refuses a comment on a dispute that does not exist', async () => {
    const r = await post('/disputes/NOPE/comments', { body: 'hello' }, desk);
    expect(r.status).toBe(404);
  });
});

describe('An accepted dispute', () => {
  it('is closed only once its credit note is approved', async () => {
    const d = await acceptedDispute();
    expect((await post(`/disputes/${d.id}/move`, { to: 'CLOSED', remarks: 'close' }, desk)).body.error).toMatch(/is draft/);
    await request(app).post(`/api/hydro-billing/notes/${d.credit_note_id}/approve`).set(auth(admin)).send({});
    expect((await post(`/disputes/${d.id}/move`, { to: 'CLOSED', remarks: 'close' }, desk)).body.status).toBe('CLOSED');
  });

  it('goes back to review when its credit note is rejected', async () => {
    const d = await acceptedDispute();
    await request(app).post(`/api/hydro-billing/notes/${d.credit_note_id}/reject`).set(auth(admin)).send({ reason: 'amount not agreed' });
    const after = (await get(`/disputes/${d.id}`, desk)).body;
    expect(after).toMatchObject({ status: 'UNDER_REVIEW', accepted_amount: null, credit_note_id: null });
    expect(after.events.at(-1).remarks).toMatch(/rejected: amount not agreed/);
  });
});
