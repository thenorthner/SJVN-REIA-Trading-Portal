import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, makeUser } from './helpers/reia.js';
import { signToken } from '../src/middleware/auth.js';
import { seedNjhpsAllocations } from '../src/services/hydroStationBill.js';
import { consolidate } from '../src/services/hydroPtc.js';

// Power trading bills. A trade has no availability, no design energy and no
// beneficiary allocation: SJVN sells a quantum to one counterparty over a date
// range and is owed the gross sale less the trading expense. What comes after
// the bill — despatch, the account, payment, reversal — is the same machinery
// the tariff bills use, which is what these tests check at the end.

const signFor = (user) => signToken(user);
let reia, viewer, contract;

const TABLES = ['hydro_ptc_bills', 'hydro_fi_posting_lines', 'hydro_fi_postings',
  'hydro_tcs_claims', 'hydro_additional_charges', 'hydro_ledger_clearings',
  'hydro_ledger_docs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills'];

beforeEach(() => {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  seedNjhpsAllocations();
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  reia = tokenFor('REIA_USER');
  viewer = tokenFor('MANAGEMENT');
});

afterAll(() => { for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run(); });

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

const TRADE = {
  billing_month: '2026-06',
  exchange_beneficiary: 'PTC India Limited',
  from_date: '2026-06-01',
  to_date: '2026-06-30',
  due_date: '2026-07-15',
  energy_kwh: 50000000,
  gross_sale: 225000000,
  trading_expense: 1125000,
};

describe('consolidating a trade', () => {
  it('nets the trading expense off the gross sale', () => {
    expect(consolidate({ grossSale: 225000000, tradingExpense: 1125000 }))
      .toEqual({ gross_sale: 225000000, trading_expense: 1125000, net_amount: 223875000 });
  });

  it('treats a trade with no expense as netting to the gross', () => {
    expect(consolidate({ grossSale: 1000, tradingExpense: null }).net_amount).toBe(1000);
  });

  it('refuses a gross sale that is not positive', () => {
    expect(() => consolidate({ grossSale: 0, tradingExpense: 0 })).toThrow(/must be a positive figure/);
  });

  it('refuses a negative expense', () => {
    expect(() => consolidate({ grossSale: 1000, tradingExpense: -5 })).toThrow(/cannot be negative/);
  });

  it('refuses a trade whose expense exceeds the sale', () => {
    // That is a loss to settle another way, not a sale bill to raise.
    expect(() => consolidate({ grossSale: 1000, tradingExpense: 1500 }))
      .toThrow(/made a loss and cannot be billed as a sale/);
  });
});

describe('raising a trading bill', () => {
  const ptc = (body) => post('/api/hydro-billing/ptc', reia, {
    contract_id: contract.id, ...TRADE, ...body,
  });

  it('bills the counterparty for the net of the trade', async () => {
    const r = await ptc();
    expect(r.status).toBe(200);
    expect(r.body.bill_kind).toBe('PTC');
    expect(r.body.bill_no).toMatch(/^HPTC/);
    expect(r.body.net_amount).toBe(223875000);
    expect(r.body.exchange_beneficiary).toBe('PTC India Limited');

    const bill = await get(`/api/hydro-billing/${r.body.id}`, viewer);
    expect(bill.body.total_charges).toBe(223875000);
    expect(bill.body.due_date).toBe('2026-07-15');
    // One line, for the counterparty — a trade is not apportioned.
    expect(bill.body.lines).toHaveLength(1);
    expect(bill.body.lines[0].beneficiary_name).toBe('PTC India Limited');
    expect(bill.body.lines[0].total_charges).toBe(223875000);
    // And none of the tariff machinery applies to it.
    expect(bill.body.a1_afc).toBe(0);
    expect(bill.body.c5_total_capacity_charge).toBe(0);
  });

  it('records the trade window and quantum', async () => {
    await ptc();
    const r = await get(`/api/hydro-billing/ptc?contract_id=${contract.id}`, viewer);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({
      exchange_beneficiary: 'PTC India Limited',
      from_date: '2026-06-01',
      to_date: '2026-06-30',
      energy_kwh: 50000000,
      gross_sale: 225000000,
      trading_expense: 1125000,
      net_amount: 223875000,
    });
  });

  it('consolidates without saving anything', async () => {
    const r = await post('/api/hydro-billing/ptc/consolidate', viewer, {
      gross_sale: 225000000, trading_expense: 1125000,
    });
    expect(r.body.net_amount).toBe(223875000);
    expect((await get(`/api/hydro-billing/ptc?contract_id=${contract.id}`, viewer)).body).toHaveLength(0);
  });

  it('refuses a trade that ends before it begins', async () => {
    const r = await ptc({ from_date: '2026-06-30', to_date: '2026-06-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/before it began/);
  });

  it('refuses a due date before the trade ends', async () => {
    const r = await ptc({ due_date: '2026-06-15' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/before the trade ends/);
  });

  it('insists on a counterparty and a date range', async () => {
    expect((await ptc({ exchange_beneficiary: '' })).body.error).toMatch(/exchange_beneficiary is required/);
    expect((await ptc({ from_date: '' })).body.error).toMatch(/from_date and to_date are required/);
  });

  it('does not let a viewer raise one', async () => {
    const r = await post('/api/hydro-billing/ptc', viewer, { contract_id: contract.id, ...TRADE });
    expect(r.status).toBe(403);
  });
});

describe('a trading bill runs the same lifecycle as a tariff bill', () => {
  async function raisedAndIssued() {
    const maker = makeUser('REIA_USER', { name: `PTC Maker ${Math.random()}` });
    const hod = makeUser('REIA_ADMIN', { name: `PTC HOD ${Math.random()}` });
    const r = await post('/api/hydro-billing/ptc', signFor(maker), { contract_id: contract.id, ...TRADE });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    await post(`/api/hydro-billing/${r.body.id}/send-for-approval`, signFor(maker), {
      next_approver_id: hod.id, final_approver_id: hod.id, comments: 'trade bill',
    });
    await post(`/api/hydro-billing/${r.body.id}/approve`, signFor(hod), {
      action: 'APPROVE', comments: 'approved',
    });
    const issued = await post(`/api/hydro-billing/${r.body.id}/issue`, reia, {});
    return { bill: r.body, issued };
  }

  it('goes through approval, and cannot be issued without it', async () => {
    const r = await post('/api/hydro-billing/ptc', reia, { contract_id: contract.id, ...TRADE });
    const issued = await post(`/api/hydro-billing/${r.body.id}/issue`, reia, {});
    expect(issued.status).toBe(400);
    expect(issued.body.error).toMatch(/not been sent for approval/);
  });

  it('opens an account for the counterparty when issued', async () => {
    const { issued } = await raisedAndIssued();
    expect(issued.status).toBe(200);
    // One document, for the one party the trade was with.
    expect(issued.body.ledger_docs_posted).toBe(1);

    const acct = await get(
      `/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=${encodeURIComponent('PTC India Limited')}`,
      viewer,
    );
    expect(acct.body.totals.outstanding).toBe(223875000);
    expect(acct.body.rows[0].due_date).toBe('2026-07-15');
  });

  it('takes payment, and reverses it, on the same account machinery', async () => {
    await raisedAndIssued();
    const pay = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'PTC India Limited',
      amount: 223875000, payment_date: '2026-07-10', mode: 'RTGS', rebate: false,
    });
    expect(pay.status).toBe(200);
    expect(pay.body.unapplied).toBe(0);

    const rev = await post(`/api/hydro-billing/ledger/${pay.body.doc.id}/reverse-payment`, reia, {
      reason: 'credited to the wrong trade',
    });
    expect(rev.status).toBe(200);

    const acct = await get(
      `/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=${encodeURIComponent('PTC India Limited')}`,
      viewer,
    );
    expect(acct.body.totals.outstanding).toBe(223875000);
  });

  it('is released and despatched like any other bill', async () => {
    const { bill } = await raisedAndIssued();
    expect((await post(`/api/hydro-billing/${bill.id}/release`, reia, {})).status).toBe(200);
    const d = await post(`/api/hydro-billing/${bill.id}/dispatch`, reia, {
      dispatch_invoice_no: 'SJVN/PTC/2026-06/001',
      courier_tracking_no: 'DTDC-5521',
      dispatch_date: '2026-07-02',
    });
    expect(d.status).toBe(200);
    expect(d.body.courier_tracking_no).toBe('DTDC-5521');
  });

  it('accrues late payment surcharge once it is overdue', async () => {
    await raisedAndIssued();
    const r = await get(
      `/api/hydro-billing/ledger/lps?contract_id=${contract.id}`
      + `&beneficiary=${encodeURIComponent('PTC India Limited')}&as_of=2026-09-30`,
      viewer,
    );
    expect(r.body.total_chargeable).toBeGreaterThan(0);
    expect(r.body.lines[0].days_overdue).toBeGreaterThan(0);
  });
});
