import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { postBillToLedger, accountDisplay, recordPayment, outstandingOf } from '../src/services/hydroLedger.js';
import { tokenFor, auth } from './helpers/reia.js';

// A debit or credit note on a hydro beneficiary's account: raised as a draft,
// approved by someone else, and only then does it move the account.

let contractId;
let pb;
let maker;
let checker;

function makeIssuedBill() {
  const id = newId('HSB');
  db.prepare(`
    INSERT INTO hydro_station_bills (
      id, bill_no, contract_id, station_name, billing_month, financial_year, bill_kind,
      a1_afc, a2_design_energy_mwh, a3_aux_pct, a4_fehs_pct,
      a5_ex_bus_design_energy_mwh, a6_ex_bus_saleable_design_energy_mwh,
      a8_days_in_month, a9_days_in_year, a11_napaf_pct, a12_ecr, a13_ecr_excess,
      c1_pafm_pct, c2_capacity_charge, c4_beta_incentive, c5_total_capacity_charge,
      e1_ex_bus_scheduled_kwh, e2_free_power_kwh, e3_saleable_scheduled_kwh,
      e4_cum_scheduled_kwh, e5_cum_free_power_kwh, e6_cum_saleable_kwh,
      e7_excess_kwh, e8_upto_design_kwh,
      ee1_energy_charge, ee2_excess_energy_charge, total_charges,
      status, approval_status, due_date, issued_at
    ) VALUES (?, ?, ?, 'NJHPS', '2026-06', '2026-2027', 'PROVISIONAL',
      1, 1, 1, 12, 1, 1, 30, 365, 87, 1.271, 1.271,
      87, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      'ISSUED', 'APPROVED', '2026-07-31', '2026-07-01')
  `).run(id, newId('BILL'), contractId);
  db.prepare(`
    INSERT INTO hydro_bill_lines (
      id, bill_id, sr_no, beneficiary_name, pct_rea, pct_excl_free, pct_proportionate,
      capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
      energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
    ) VALUES (?, ?, 1, 'PUNJAB', 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 100000)
  `).run(newId('HBL'), id);
  postBillToLedger(db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(id));
  return db.prepare(`SELECT * FROM hydro_ledger_docs WHERE bill_id = ? AND doc_type = 'PB'`).get(id);
}

beforeEach(() => {
  for (const t of ['hydro_notes', 'hydro_ledger_clearings', 'hydro_ledger_docs', 'hydro_bill_lines', 'hydro_station_bills']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  contractId = newId('CON');
  db.prepare(`INSERT INTO contracts (id, contract_no, contract_type, project_type, capacity_mw, tariff_per_unit, tenure_start, tenure_end, status, payment_terms_days)
    VALUES (?, ?, 'PPA', 'Hydro', 1500, 1, '2026-04-01', '2036-03-31', 'ACTIVE', 45)`).run(contractId, `PPA/NOTE/${contractId}`);
  pb = makeIssuedBill();
  maker = tokenFor('COMMERCIAL');
  checker = tokenFor('COMMERCIAL_ADMIN');
});

const raise = (over = {}, as = maker) => request(app).post('/api/hydro-billing/notes').set(auth(as)).send({
  contract_id: contractId, beneficiary_name: 'PUNJAB', reason: 'REVISED_REA',
  remarks: 'Revised REA for June 2026 issued by NRPC', ...over,
});

describe('Hydro debit / credit notes', () => {
  it('raises a note as a draft that does not touch the account', async () => {
    const r = await raise({ note_type: 'DEBIT', amount: 5000 });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.note_no).toMatch(/^HDN\/\d{4}-\d{2}\/0001$/);
    expect(accountDisplay(contractId, 'PUNJAB').totals.outstanding).toBe(100000);
  });

  it('will not let the maker approve their own note', async () => {
    const r = await raise({ note_type: 'DEBIT', amount: 5000 });
    const self = await request(app).post(`/api/hydro-billing/notes/${r.body.id}/approve`).set(auth(maker));
    expect(self.status).toBe(403);
  });

  it('posts an approved debit note as its own bill with its own due date', async () => {
    const r = await raise({ note_type: 'DEBIT', amount: 5000 });
    const ok = await request(app).post(`/api/hydro-billing/notes/${r.body.id}/approve`).set(auth(checker));
    expect(ok.status).toBe(200);
    const acct = accountDisplay(contractId, 'PUNJAB');
    const dn = acct.rows.find((x) => x.display_type === 'DN');
    expect(dn.amount).toBe(5000);
    expect(dn.due_date).toBeTruthy();
    expect(acct.totals.outstanding).toBe(105000);
    expect(acct.totals.debit_notes).toBe(5000);
    expect(acct.totals.billed, 'the debit note was counted as the station bill').toBe(100000);
  });

  it('sets an approved credit note against the bill without counting it as money received', async () => {
    const r = await raise({ note_type: 'CREDIT', amount: 8000, against_doc_id: pb.id, reason: 'BILLING_ERROR' });
    await request(app).post(`/api/hydro-billing/notes/${r.body.id}/approve`).set(auth(checker));
    const acct = accountDisplay(contractId, 'PUNJAB');
    expect(outstandingOf(pb.id)).toBe(92000);
    expect(acct.totals.received, 'a credit note showed as a collection').toBe(0);
    expect(acct.totals.credit_notes).toBe(8000);
    expect(acct.totals.rebate, 'a credit note earned a rebate').toBe(0);
    expect(acct.rows.some((x) => x.display_type === 'CN')).toBe(true);
  });

  it('refuses a credit note larger than what the named bill still owes', async () => {
    const r = await raise({ note_type: 'CREDIT', amount: 150000, against_doc_id: pb.id });
    expect(r.status).toBe(400);
  });

  it('refuses a payment entered with a mode the ledger reserves', () => {
    expect(() => recordPayment({ contractId, beneficiaryName: 'PUNJAB', amount: 10, paymentDate: '2026-07-10', mode: 'credit_note' }))
      .toThrow(/not a payment mode/);
  });

  it('withdraws a draft when its maker rejects it, and rejects it when someone else does', async () => {
    const a = await raise({ note_type: 'DEBIT', amount: 100 });
    const own = await request(app).post(`/api/hydro-billing/notes/${a.body.id}/reject`).set(auth(maker)).send({ reason: 'raised by mistake' });
    expect(own.body.status).toBe('CANCELLED');
    const b = await raise({ note_type: 'DEBIT', amount: 100 });
    const other = await request(app).post(`/api/hydro-billing/notes/${b.body.id}/reject`).set(auth(checker)).send({ reason: 'not supported by REA' });
    expect(other.body.status).toBe('REJECTED');
  });

  it('is closed to the thermal desk', async () => {
    const r = await raise({ note_type: 'DEBIT', amount: 100 }, tokenFor('THERMAL_ADMIN'));
    expect(r.status).toBe(403);
  });
});
