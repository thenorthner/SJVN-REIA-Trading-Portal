import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { makeUser, auth } from './helpers/reia.js';
import { signToken } from '../src/middleware/auth.js';
import { postBillToLedger, accountDisplay, outstandingOf } from '../src/services/hydroLedger.js';

// The hydro desk after a bill is out: disputes, LC, balance confirmation, TDS.

let contractId;
let pb;
let desk;
let hod;
const post = (url, token, body = {}) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

function issuedBill(month, dueDate, total) {
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
    ) VALUES (?, ?, ?, 'NJHPS', ?, '2026-2027', 'PROVISIONAL',
      1, 1, 1, 12, 1, 1, 30, 365, 87, 1.271, 1.271,
      87, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      'ISSUED', 'APPROVED', ?, ?)
  `).run(id, newId('BILL'), contractId, month, dueDate, `${month}-28`);
  db.prepare(`
    INSERT INTO hydro_bill_lines (
      id, bill_id, sr_no, beneficiary_name, pct_rea, pct_excl_free, pct_proportionate,
      capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
      energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
    ) VALUES (?, ?, 1, 'PUNJAB', 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, ?)
  `).run(newId('HBL'), id, total);
  postBillToLedger(db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(id));
  return db.prepare(`SELECT * FROM hydro_ledger_docs WHERE bill_id = ? AND doc_type = 'PB'`).get(id);
}

beforeAll(() => {
  for (const t of ['hydro_dispute_events', 'hydro_disputes', 'hydro_security_events', 'hydro_security_instruments',
    'hydro_reconciliations', 'hydro_tds_entries', 'hydro_arrear_months', 'hydro_notes', 'hydro_ledger_clearings',
    'hydro_ledger_docs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  contractId = newId('CON');
  db.prepare(`INSERT INTO contracts (id, contract_no, contract_type, project_type, capacity_mw, tariff_per_unit, tenure_start, tenure_end, status, payment_terms_days)
    VALUES (?, ?, 'PPA', 'Hydro', 1500, 1, '2026-04-01', '2036-03-31', 'ACTIVE', 45)`).run(contractId, `PPA/DESK/${contractId}`);
  issuedBill('2026-04', '2026-06-15', 120000);
  pb = issuedBill('2026-05', '2026-07-15', 100000);
  desk = signToken(makeUser('COMMERCIAL', { name: 'Desk Officer' }));
  hod = signToken(makeUser('COMMERCIAL_ADMIN', { name: 'Desk HoD' }));
});

describe('Hydro disputes', () => {
  let d;
  it('raises a dispute on a beneficiary share with SLA dates', async () => {
    const r = await post('/api/hydro-desk/disputes', desk, {
      ledger_doc_id: pb.id, reason_code: 'PAFM_AVAILABILITY', disputed_amount: 20000,
      description: 'PAFM taken as 95% but REA certifies 92.4%', received_on: '2026-07-01',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    d = r.body;
    expect(d.dispute_no).toMatch(/^HDSP\//);
    expect(d.ack_due).toBe('2026-07-03');
    expect(d.resolve_due).toBe('2026-07-16');
  });

  it('refuses disputing more than was billed', async () => {
    const r = await post('/api/hydro-desk/disputes', desk, {
      ledger_doc_id: pb.id, reason_code: 'OTHER', disputed_amount: 90000, description: 'Whole bill disputed again',
    });
    expect(r.status).toBe(400);
  });

  it('follows the allowed steps and raises a draft credit note on acceptance', async () => {
    expect((await post(`/api/hydro-desk/disputes/${d.id}/move`, desk, { to: 'RESOLVED_ACCEPTED', remarks: 'too early' })).status).toBe(400);
    await post(`/api/hydro-desk/disputes/${d.id}/move`, desk, { to: 'ACKNOWLEDGED' });
    await post(`/api/hydro-desk/disputes/${d.id}/move`, desk, { to: 'UNDER_REVIEW' });
    const r = await post(`/api/hydro-desk/disputes/${d.id}/move`, desk, { to: 'RESOLVED_ACCEPTED', accepted_amount: 15000, remarks: 'REA PAFM confirmed' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.credit_note_no).toMatch(/^HCN\//);
    expect(r.body.credit_note_status).toBe('DRAFT');
    expect(r.body.events.map((e) => e.to_status)).toEqual(['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'RESOLVED_ACCEPTED']);
    // The credit note moves money only once a second officer approves it.
    expect(outstandingOf(pb.id)).toBe(100000);
    const note = db.prepare('SELECT * FROM hydro_notes WHERE id = ?').get(r.body.credit_note_id);
    expect((await post(`/api/hydro-billing/notes/${note.id}/approve`, hod)).status).toBe(200);
    expect(outstandingOf(pb.id)).toBe(85000);
  });
});

describe('Hydro payment security', () => {
  let lc;
  it('shows the cover required against what is held', async () => {
    const r = await post('/api/hydro-desk/security', desk, {
      contract_id: contractId, beneficiary_name: 'PUNJAB', instrument_type: 'LC', instrument_no: 'LC/PSPCL/01',
      issuing_bank: 'State Bank of India', amount: 50000, valid_from: '2026-04-01', valid_to: '2099-03-31',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    lc = r.body;
    const pos = await get(`/api/hydro-desk/security?contract_id=${contractId}`, desk);
    const punjab = pos.body.rows.find((x) => x.beneficiary_name === 'PUNJAB');
    expect(punjab.required).toBeGreaterThan(0);
    expect(punjab.live_cover).toBe(50000);
    expect(punjab.status).toBe('SHORT');
  });

  it('invokes the LC for overdue bills and posts it to the account', async () => {
    const before = accountDisplay(contractId, 'PUNJAB').totals.outstanding;
    const r = await post(`/api/hydro-desk/security/${lc.id}/invoke`, desk, { amount: 30000, remarks: 'April bill unpaid 90 days' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(accountDisplay(contractId, 'PUNJAB').totals.outstanding).toBeCloseTo(before - 30000, 2);
    expect(r.body.instrument.available).toBe(20000);
    const tooMuch = await post(`/api/hydro-desk/security/${lc.id}/invoke`, desk, { amount: 25000, remarks: 'more than left' });
    expect(tooMuch.status).toBe(400);
  });
});

describe('Hydro TDS', () => {
  it('credits TDS to the account without counting it as money received', async () => {
    const before = accountDisplay(contractId, 'PUNJAB').totals;
    const r = await post('/api/hydro-desk/tds', desk, {
      contract_id: contractId, beneficiary_name: 'PUNJAB', section: '194Q', tds_amount: 100,
      deduction_date: '2026-07-20', deductor_tan: 'PTLP12345A', reference: 'UTR 1234',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.entry.quarter).toBe('Q2');
    const after = accountDisplay(contractId, 'PUNJAB').totals;
    expect(after.outstanding).toBeCloseTo(before.outstanding - 100, 2);
    expect(after.received).toBe(before.received);
    expect(after.tds).toBe(100);

    const cert = await post(`/api/hydro-desk/tds/${r.body.entry.id}/certificate`, desk, { certificate_no: 'FORM16A-001' });
    expect(cert.body.status).toBe('CERTIFICATE_RECEIVED');
    const matched = await post(`/api/hydro-desk/tds/${r.body.entry.id}/certificate`, desk, { amount_26as: 100 });
    expect(matched.body.status).toBe('MATCHED_26AS');
  });
});

describe('Hydro balance confirmation', () => {
  it('draws the statement from the ledger and is confirmed only on a matching balance', async () => {
    const r = await post('/api/hydro-desk/reconciliations', desk, {
      contract_id: contractId, beneficiary_name: 'PUNJAB', period_from: '2026-04-01', period_to: new Date().toISOString().slice(0, 10),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.closing_balance).toBeCloseTo(accountDisplay(contractId, 'PUNJAB').totals.balance, 2);
    await post(`/api/hydro-desk/reconciliations/${r.body.id}/move`, desk, { to: 'SENT' });
    const wrong = await post(`/api/hydro-desk/reconciliations/${r.body.id}/move`, desk, { to: 'CONFIRMED', beneficiary_balance: 1 });
    expect(wrong.status).toBe(400);
    const disputed = await post(`/api/hydro-desk/reconciliations/${r.body.id}/move`, desk, { to: 'DISPUTED', beneficiary_balance: 1, remarks: 'LC invocation not booked by them' });
    expect(disputed.body.difference).toBeCloseTo(r.body.closing_balance - 1, 2);
    expect((await get(`/api/hydro-desk/reconciliations/${r.body.id}/pdf`, desk)).status).toBe(200);
  });
});
