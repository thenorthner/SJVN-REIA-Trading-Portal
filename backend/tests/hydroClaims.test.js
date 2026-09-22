import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { seedNjhpsAllocations } from '../src/services/hydroStationBill.js';
import { computeTcs } from '../src/services/hydroClaims.js';

// What a station bills besides its monthly energy bill: auxiliary consumption
// and exchange-rate variation, claimed together on a bill of their own, and tax
// collected at source, claimed from one beneficiary against money received.

let reia, viewer, contract;

beforeEach(() => {
  for (const t of ['hydro_tcs_claims', 'hydro_additional_charges', 'hydro_ledger_clearings',
    'hydro_ledger_docs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  seedNjhpsAllocations();
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  reia = tokenFor('REIA_USER');
  viewer = tokenFor('MANAGEMENT');
});

afterAll(() => {
  for (const t of ['hydro_tcs_claims', 'hydro_additional_charges', 'hydro_ledger_clearings',
    'hydro_ledger_docs', 'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills']) {
    db.prepare(`DELETE FROM ${t}`).run();
  }
});

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

const charge = (body) => post('/api/hydro-billing/charges', reia, {
  contract_id: contract.id, charge_type: 'AUX_CONSUMPTION', period_month: '2026-06', amount: 500000, ...body,
});

describe('recording an additional charge', () => {
  it('records an entry against the month it arose in', async () => {
    const r = await charge({ charge_type: 'FERV', amount: 1250000, remarks: 'JICA loan revaluation' });
    expect(r.status).toBe(200);
    expect(r.body.charge_type).toBe('FERV');
    expect(r.body.amount).toBe(1250000);
    expect(r.body.claimed_bill_id).toBeNull();
  });

  it('lists what is waiting to be claimed, with the total', async () => {
    await charge({ amount: 500000 });
    await charge({ charge_type: 'FERV', amount: 250000, period_month: '2026-05' });
    const r = await get(`/api/hydro-billing/charges?contract_id=${contract.id}`, viewer);
    expect(r.body.unclaimed).toHaveLength(2);
    expect(r.body.unclaimed_total).toBe(750000);
    // Oldest month first, because that is the order they are claimed in.
    expect(r.body.unclaimed[0].period_month).toBe('2026-05');
    expect(r.body.charge_types.map((t) => t.value)).toContain('AUX_CONSUMPTION');
  });

  it('takes a negative entry as a credit against the next claim', async () => {
    const r = await charge({ amount: -75000, remarks: 'over-charged in May' });
    expect(r.status).toBe(200);
    expect(r.body.amount).toBe(-75000);
  });

  it('refuses a zero amount and an unknown charge type', async () => {
    expect((await charge({ amount: 0 })).status).toBe(400);
    const bad = await charge({ charge_type: 'MYSTERY' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/charge_type must be one of/);
  });

  it('does not let a viewer record one', async () => {
    const r = await post('/api/hydro-billing/charges', viewer, {
      contract_id: contract.id, charge_type: 'FERV', period_month: '2026-06', amount: 1,
    });
    expect(r.status).toBe(403);
  });
});

describe('claiming additional charges on a bill', () => {
  const claim = (body) => post('/api/hydro-billing/charges/claim', reia, {
    contract_id: contract.id, billing_month: '2026-06', ...body,
  });

  it('raises one bill for the outstanding entries, split across the beneficiaries', async () => {
    await charge({ amount: 500000 });
    await charge({ charge_type: 'FERV', amount: 250000, period_month: '2026-05' });

    const r = await claim();
    expect(r.status).toBe(200);
    expect(r.body.bill_kind).toBe('ADDITIONAL');
    expect(r.body.total_charges).toBe(750000);
    expect(r.body.entries_claimed).toBe(2);
    expect(r.body.by_charge_type).toEqual({ AUX_CONSUMPTION: 500000, FERV: 250000 });
    expect(r.body.lines).toBe(15);

    const bill = await get(`/api/hydro-billing/${r.body.id}`, viewer);
    // Apportioned on the same basis the capacity charge uses, and adding back
    // to the claim exactly.
    const sum = bill.body.lines.reduce((a, l) => a + l.total_charges, 0);
    expect(sum).toBeCloseTo(750000, 2);
    const gohp = bill.body.lines.find((l) => l.beneficiary_name === 'GoHP');
    expect(gohp.total_charges).toBeCloseTo(750000 * 0.25, 0);
  });

  it('marks the entries claimed so they cannot be claimed twice', async () => {
    await charge({ amount: 500000 });
    const first = await claim();
    expect(first.status).toBe(200);

    const listed = await get(`/api/hydro-billing/charges?contract_id=${contract.id}`, viewer);
    expect(listed.body.unclaimed).toHaveLength(0);

    const second = await claim();
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/no unclaimed additional charges/);
  });

  it('claims only the entries asked for', async () => {
    const a = await charge({ amount: 500000 });
    await charge({ charge_type: 'FERV', amount: 250000 });

    const r = await claim({ charge_ids: [a.body.id] });
    expect(r.body.total_charges).toBe(500000);
    expect(r.body.entries_claimed).toBe(1);

    const listed = await get(`/api/hydro-billing/charges?contract_id=${contract.id}`, viewer);
    expect(listed.body.unclaimed).toHaveLength(1);
    expect(listed.body.unclaimed[0].charge_type).toBe('FERV');
  });

  it('refuses an entry that is already claimed', async () => {
    const a = await charge({ amount: 500000 });
    await claim({ charge_ids: [a.body.id] });
    const again = await claim({ charge_ids: [a.body.id] });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already claimed/);
  });

  it('does not sweep in an entry from a later month', async () => {
    await charge({ amount: 500000, period_month: '2026-06' });
    await charge({ amount: 900000, period_month: '2026-08' });
    const r = await claim({ billing_month: '2026-06' });
    expect(r.body.total_charges).toBe(500000);
    expect(r.body.entries_claimed).toBe(1);
  });

  it('refuses a claim whose entries net to nothing', async () => {
    await charge({ amount: 500000 });
    await charge({ amount: -500000 });
    const r = await claim();
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/net to zero/);
  });

  it('goes through the same approval and despatch lifecycle as a monthly bill', async () => {
    await charge({ amount: 500000 });
    const claimed = await claim();

    const listed = await get(`/api/hydro-billing?contract_id=${contract.id}&bill_kind=ADDITIONAL`, viewer);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].approval_status).toBe('NOT_SENT');

    // And it cannot be issued without approval, exactly like any other bill.
    const issued = await post(`/api/hydro-billing/${claimed.body.id}/issue`, reia, {});
    expect(issued.status).toBe(400);
    expect(issued.body.error).toMatch(/not been sent for approval/);
  });
});

describe('TCS arithmetic', () => {
  it('applies the rate to the receipt when no separate basis is given', () => {
    const r = computeTcs({ amountReceived: 10000000, tcsApplicableAmount: null, tcsRatePct: 0.1 });
    expect(r.tcs_applicable_amount).toBe(10000000);
    expect(r.tcs_amount).toBe(10000);
  });

  it('applies it to the stated basis when only part of the receipt is liable', () => {
    const r = computeTcs({ amountReceived: 10000000, tcsApplicableAmount: 4000000, tcsRatePct: 0.1 });
    expect(r.tcs_amount).toBe(4000);
  });

  it('refuses a basis larger than the receipt', () => {
    expect(() => computeTcs({ amountReceived: 1000, tcsApplicableAmount: 5000, tcsRatePct: 1 }))
      .toThrow(/cannot exceed the amount received/);
  });

  it('refuses a rate outside 0 to 100', () => {
    expect(() => computeTcs({ amountReceived: 1000, tcsRatePct: 0 })).toThrow(/between 0 and 100/);
    expect(() => computeTcs({ amountReceived: 1000, tcsRatePct: 101 })).toThrow(/between 0 and 100/);
  });
});

describe('claiming TCS from a beneficiary', () => {
  const tcs = (body) => post('/api/hydro-billing/tcs', reia, {
    contract_id: contract.id, beneficiary: 'GoHP', billing_month: '2026-06',
    payment_date: '2026-07-20', amount_received: 200000000, tcs_rate_pct: 0.1, ...body,
  });

  it('raises a bill against that beneficiary alone', async () => {
    const r = await tcs();
    expect(r.status).toBe(200);
    expect(r.body.bill_kind).toBe('TCS');
    expect(r.body.tcs_amount).toBe(200000);

    const bill = await get(`/api/hydro-billing/${r.body.id}`, viewer);
    // TCS is not apportioned: one line, for the one party it is charged to.
    expect(bill.body.lines).toHaveLength(1);
    expect(bill.body.lines[0].beneficiary_name).toBe('GoHP');
    expect(bill.body.lines[0].total_charges).toBe(200000);
    expect(bill.body.total_charges).toBe(200000);
  });

  it('records the receipt the tax was computed on', async () => {
    await tcs({ tcs_applicable_amount: 50000000 });
    const r = await get(`/api/hydro-billing/tcs?contract_id=${contract.id}`, viewer);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({
      beneficiary_name: 'GoHP',
      amount_received: 200000000,
      tcs_applicable_amount: 50000000,
      tcs_rate_pct: 0.1,
      tcs_amount: 50000,
      payment_date: '2026-07-20',
    });
    expect(r.body[0].bill_no).toMatch(/^HTCS/);
  });

  it('previews the figure without raising anything', async () => {
    const r = await post('/api/hydro-billing/tcs/preview', viewer, {
      amount_received: 1000000, tcs_rate_pct: 0.1,
    });
    expect(r.body.tcs_amount).toBe(1000);
    expect((await get(`/api/hydro-billing/tcs?contract_id=${contract.id}`, viewer)).body).toHaveLength(0);
  });

  it('refuses a beneficiary that is not on this station', async () => {
    const r = await tcs({ beneficiary: 'TAMIL NADU' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/is not a beneficiary of/);
  });

  it('does not let a viewer raise one', async () => {
    const r = await post('/api/hydro-billing/tcs', viewer, {
      contract_id: contract.id, beneficiary: 'GoHP', billing_month: '2026-06',
      amount_received: 1000, tcs_rate_pct: 1,
    });
    expect(r.status).toBe(403);
  });
});
