import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { makeUser, auth } from './helpers/reia.js';
import { signToken } from '../src/middleware/auth.js';
import { accountDisplay } from '../src/services/hydroLedger.js';

// Arrear and supplementary bills on a hydro station: raised as drafts, through
// the same approval and issue as a monthly bill, and onto the ledger.

let contract;
let maker;
let hod;
let makerUser;
let hodUser;

const post = (url, token, body = {}) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

async function approveAndIssue(id) {
  await post(`/api/hydro-billing/${id}/send-for-approval`, maker, { next_approver_id: hodUser.id, final_approver_id: hodUser.id, comments: 'for approval' });
  await post(`/api/hydro-billing/${id}/approve`, hod, { action: 'APPROVE', comments: 'checked' });
  return post(`/api/hydro-billing/${id}/issue`, maker, { due_date: '2026-12-31' });
}

beforeAll(async () => {
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  for (const t of ['hydro_arrear_months', 'hydro_notes', 'hydro_ledger_clearings', 'hydro_ledger_docs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM hydro_station_tariffs WHERE contract_id = ?').run(contract.id);
  makerUser = makeUser('COMMERCIAL', { name: 'Desk Maker' });
  hodUser = makeUser('COMMERCIAL_ADMIN', { name: 'HoD Approver' });
  maker = signToken(makerUser);
  hod = signToken(hodUser);

  // An issued April bill on the tariff as it stood.
  const april = await post('/api/hydro-billing', maker, {
    contract_id: contract.id, billing_month: '2026-04', bill_kind: 'PROVISIONAL',
    ex_bus_scheduled_kwh: 500000000, pafm_percent: 95, beta_value: 1,
  });
  expect(april.status, JSON.stringify(april.body)).toBe(200);
  const issued = await approveAndIssue(april.body.id);
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
});

describe('Arrear bill', () => {
  it('says there is no arrear while the tariff on record is unchanged', async () => {
    const r = await post('/api/hydro-billing/arrears', maker, {
      contract_id: contract.id, from_month: '2026-04', to_month: '2026-04', reason: 'CERC order dated 01.10.2026 revising AFC',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no arrear/i);
  });

  it('bills the difference a revised AFC makes, and posts it to each beneficiary', async () => {
    const before = accountDisplay(contract.id, 'PUNJAB').totals.outstanding;
    db.prepare(`INSERT INTO hydro_station_tariffs (id, contract_id, financial_year, annual_afc) VALUES ('HST-ARR', ?, '2026-2027', ?)`)
      .run(contract.id, Number(contract.annual_afc) * 1.1);

    const preview = await post('/api/hydro-billing/arrears/preview', maker, { contract_id: contract.id, from_month: '2026-04', to_month: '2026-05' });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.months).toHaveLength(1);
    expect(preview.body.skipped.map((s) => s.month)).toEqual(['2026-05']);
    expect(preview.body.total_differential).toBeGreaterThan(0);

    const r = await post('/api/hydro-billing/arrears', maker, {
      contract_id: contract.id, from_month: '2026-04', to_month: '2026-04',
      reason: 'CERC order dated 01.10.2026 revising AFC for 2026-27', order_reference: 'CERC Petition 12/GT/2026',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const bill = await get(`/api/hydro-billing/${r.body.id}`, maker);
    expect(bill.body.bill_kind).toBe('ARREAR');
    expect(bill.body.arrear_months).toHaveLength(1);

    const issued = await approveAndIssue(r.body.id);
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    const punjabArrear = bill.body.lines.find((l) => l.beneficiary_name === 'PUNJAB').total_charges;
    expect(accountDisplay(contract.id, 'PUNJAB').totals.outstanding).toBeCloseTo(before + punjabArrear, 1);

    const pdf = await get(`/api/hydro-billing/${r.body.id}/pdf`, maker);
    expect(pdf.status).toBe(200);
  });

  it('does not bill the same arrear twice', async () => {
    const r = await post('/api/hydro-billing/arrears', maker, {
      contract_id: contract.id, from_month: '2026-04', to_month: '2026-04', reason: 'CERC order dated 01.10.2026 again',
    });
    expect(r.status).toBe(400);
  });
});

describe('Supplementary bill', () => {
  it('apportions a one-off amount across the beneficiaries and posts it on issue', async () => {
    const r = await post('/api/hydro-billing/supplementary', maker, {
      contract_id: contract.id, billing_month: '2026-04', amount: 1000000, reason: 'TAXES_DUTIES',
      particulars: 'HP water cess for April 2026 as per GoHP notification',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const bill = await get(`/api/hydro-billing/${r.body.id}`, maker);
    expect(bill.body.lines.length).toBeGreaterThan(1);
    expect(bill.body.lines.reduce((a, l) => a + l.total_charges, 0)).toBeCloseTo(1000000, 1);
    expect((await approveAndIssue(r.body.id)).status).toBe(200);
    expect((await get(`/api/hydro-billing/${r.body.id}/pdf`, maker)).status).toBe(200);
  });

  it('can be raised on one beneficiary alone', async () => {
    const r = await post('/api/hydro-billing/supplementary', maker, {
      contract_id: contract.id, billing_month: '2026-04', amount: 5000, reason: 'OMITTED_ITEM',
      particulars: 'Meter testing charges omitted from April bill', beneficiary_name: 'PUNJAB',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.beneficiaries).toBe(1);
  });

  it('refuses a negative amount — that is a credit note', async () => {
    const r = await post('/api/hydro-billing/supplementary', maker, {
      contract_id: contract.id, billing_month: '2026-04', amount: -10, reason: 'OTHER', particulars: 'negative test entry here',
    });
    expect(r.status).toBe(400);
  });
});

describe('Recalling a bill from approval', () => {
  it('lets the maker take it back, shows who it was with, and lets it be sent again', async () => {
    const r = await post('/api/hydro-billing/supplementary', maker, {
      contract_id: contract.id, billing_month: '2026-04', amount: 100, reason: 'OTHER', particulars: 'recall test supplementary bill',
    });
    await post(`/api/hydro-billing/${r.body.id}/send-for-approval`, maker, { next_approver_id: hodUser.id, final_approver_id: hodUser.id, comments: 'for approval' });
    const list = await get(`/api/hydro-billing?contract_id=${contract.id}`, maker);
    expect(list.body.find((b) => b.id === r.body.id).pending_with).toBe(hodUser.name);

    const recall = await post(`/api/hydro-billing/${r.body.id}/recall`, maker, { reason: 'amount to be corrected' });
    expect(recall.status, JSON.stringify(recall.body)).toBe(200);
    expect(db.prepare('SELECT approval_status FROM hydro_station_bills WHERE id = ?').get(r.body.id).approval_status).toBe('NOT_SENT');
    const again = await post(`/api/hydro-billing/${r.body.id}/send-for-approval`, maker, { next_approver_id: hodUser.id, final_approver_id: hodUser.id, comments: 'again' });
    expect(again.status).toBe(200);
  });
});

describe('Receivables ageing', () => {
  it('ages what each beneficiary owes by days past due', async () => {
    const r = await get(`/api/hydro-billing/receivables?contract_id=${contract.id}&as_of=2027-03-15`, maker);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const punjab = r.body.rows.find((x) => x.beneficiary_name === 'PUNJAB');
    expect(punjab.outstanding).toBeGreaterThan(0);
    expect(punjab.d61_90 + punjab.d31_60 + punjab.d1_30 + punjab.d90_plus + punjab.current).toBeCloseTo(punjab.outstanding, 1);
    expect(r.body.totals.outstanding).toBeGreaterThan(0);
  });
});
