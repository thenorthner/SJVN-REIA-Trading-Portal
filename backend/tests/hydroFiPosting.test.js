import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, makeUser } from './helpers/reia.js';
import { signToken } from '../src/middleware/auth.js';
import { seedNjhpsAllocations } from '../src/services/hydroStationBill.js';

// The month-end handover to corporate Finance: gather the month's issued bills,
// check the totals, book them, and — when a booking is wrong — reverse it and
// start again, because a posted entry is Finance's record and not ours to edit.

const signFor = (user) => signToken(user);
let reia, viewer, contract;

const JUNE = {
  billing_month: '2026-06',
  ex_bus_scheduled_kwh: 731158750,
  free_power_kwh: 87739035,
  pafm_percent: 109.667,
  beta_value: 0,
  nrldc_total_fee: 646884,
};

const TABLES = ['hydro_fi_posting_lines', 'hydro_fi_postings', 'hydro_tcs_claims',
  'hydro_additional_charges', 'hydro_ledger_clearings', 'hydro_ledger_docs',
  'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills'];

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

/** A bill taken all the way to ISSUED, which is the only state Finance books. */
async function issuedBill(overrides = {}) {
  const maker = makeUser('REIA_USER', { name: `FI Maker ${Math.random()}` });
  const hod = makeUser('REIA_ADMIN', { name: `FI HOD ${Math.random()}` });
  const b = await post('/api/hydro-billing', signFor(maker), {
    contract_id: contract.id, ...JUNE, ...overrides,
  });
  expect(b.status, JSON.stringify(b.body)).toBe(200);
  await post(`/api/hydro-billing/${b.body.id}/send-for-approval`, signFor(maker), {
    next_approver_id: hod.id, final_approver_id: hod.id, comments: 'go',
  });
  await post(`/api/hydro-billing/${b.body.id}/approve`, signFor(hod), {
    action: 'APPROVE', comments: 'approved',
  });
  await post(`/api/hydro-billing/${b.body.id}/issue`, reia, { due_date: '2026-07-31' });
  return b.body;
}

describe('what a month would post', () => {
  it('lists only the issued bills, and splits the pass-through out of the sale', async () => {
    const bill = await issuedBill();
    const r = await get(
      `/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=2026-06`, viewer,
    );
    expect(r.status).toBe(200);
    expect(r.body.bills).toHaveLength(1);
    expect(r.body.bills[0].bill_no).toBe(bill.bill_no);
    // NRLDC fees are POSOCO's, passed through — not SJVN's sale.
    expect(r.body.totals.sale_amount).toBeCloseTo(1574926027, -1);
    expect(r.body.totals.nrldc_amount).toBe(646884);
    expect(r.body.totals.total_amount).toBeCloseTo(1574926027 + 646884, -1);
  });

  it('ignores a draft, because a draft is not a sale', async () => {
    await post('/api/hydro-billing', reia, { contract_id: contract.id, ...JUNE });
    const r = await get(
      `/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=2026-06`, viewer,
    );
    expect(r.body.bills).toHaveLength(0);
  });

  it('accepts a month written as a name', async () => {
    await issuedBill();
    const r = await get(
      `/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=June-2026`, viewer,
    );
    expect(r.body.period_month).toBe('2026-06');
    expect(r.body.bills).toHaveLength(1);
  });
});

describe('preparing and posting', () => {
  const prepare = (body) => post('/api/hydro-billing/fi/prepare', reia, {
    contract_id: contract.id, period_month: '2026-06', ...body,
  });

  it('gathers the month and carries the plant code SAP books it under', async () => {
    await issuedBill();
    const r = await prepare();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('PREPARED');
    expect(r.body.bill_category).toBe('HYDRO');
    expect(r.body.plant_code).toBe('001');   // NJHPS
    expect(r.body.bills_count).toBe(1);
    expect(r.body.lines).toHaveLength(1);
    expect(r.body.posting_no).toMatch(/^FI\/001\/HYDRO\/202606\//);
  });

  it('books it with the voucher Finance returned', async () => {
    await issuedBill();
    const prepared = await prepare();
    const r = await post(`/api/hydro-billing/fi/${prepared.body.id}/post`, reia, {
      fi_document_no: 'VCH-2026-90412',
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('POSTED');
    expect(r.body.fi_document_no).toBe('VCH-2026-90412');
    expect(r.body.posted_at).toBeTruthy();
  });

  it('will not post the same month twice', async () => {
    await issuedBill();
    const prepared = await prepare();
    await post(`/api/hydro-billing/fi/${prepared.body.id}/post`, reia, {});

    const again = await prepare();
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already posted/);

    const rePost = await post(`/api/hydro-billing/fi/${prepared.body.id}/post`, reia, {});
    expect(rePost.status).toBe(409);
    expect(rePost.body.error).toMatch(/already posted/);
  });

  it('will not prepare a month with nothing to book', async () => {
    const r = await prepare({ period_month: '2026-05' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/waiting to be booked/);
  });

  it('keeps the categories apart, because Finance books them to different heads', async () => {
    await issuedBill();
    const hydro = await prepare({ bill_category: 'HYDRO' });
    expect(hydro.status).toBe(200);
    // The same month for a different category is a different posting entirely.
    const additional = await prepare({ bill_category: 'ADDITIONAL' });
    expect(additional.status).toBe(400);
    expect(additional.body.error).toMatch(/No issued ADDITIONAL bills/);
  });

  it('refuses an unknown category', async () => {
    const r = await prepare({ bill_category: 'MYSTERY' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/bill_category must be one of/);
  });

  it('does not let a viewer prepare or post', async () => {
    await issuedBill();
    expect((await post('/api/hydro-billing/fi/prepare', viewer, {
      contract_id: contract.id, period_month: '2026-06',
    })).status).toBe(403);
  });
});

describe('reversing a posting', () => {
  const prepare = () => post('/api/hydro-billing/fi/prepare', reia, {
    contract_id: contract.id, period_month: '2026-06',
  });

  it('writes a counter-entry and frees the month to be prepared again', async () => {
    await issuedBill();
    const prepared = await prepare();
    await post(`/api/hydro-billing/fi/${prepared.body.id}/post`, reia, { fi_document_no: 'VCH-1' });

    const rev = await post(`/api/hydro-billing/fi/${prepared.body.id}/reverse`, reia, {
      reason: 'booked to the wrong head',
    });
    expect(rev.status).toBe(200);
    expect(rev.body.reversal_posting_no).toMatch(/\/REV$/);

    const listed = await get(`/api/hydro-billing/fi?contract_id=${contract.id}`, viewer);
    // The original and its counter-entry both remain visible.
    expect(listed.body.postings).toHaveLength(2);
    const counter = listed.body.postings.find((p) => p.posting_no.endsWith('/REV'));
    expect(counter.total_amount).toBeLessThan(0);
    expect(counter.status).toBe('REVERSED');

    // And the month can be booked again, which is the point of reversing.
    const again = await prepare();
    expect(again.status).toBe(200);
    expect(again.body.bills_count).toBe(1);
  });

  it('insists on a reason and refuses a second reversal', async () => {
    await issuedBill();
    const prepared = await prepare();
    expect((await post(`/api/hydro-billing/fi/${prepared.body.id}/reverse`, reia, {})).status).toBe(400);

    await post(`/api/hydro-billing/fi/${prepared.body.id}/reverse`, reia, { reason: 'wrong' });
    const again = await post(`/api/hydro-billing/fi/${prepared.body.id}/reverse`, reia, { reason: 'again' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already reversed/);
  });

  it('freezes what it booked, so a later revision cannot restate Finance\'s copy', async () => {
    const bill = await issuedBill();
    const prepared = await prepare();
    await post(`/api/hydro-billing/fi/${prepared.body.id}/post`, reia, {});

    const bookedAt = prepared.body.lines[0].total_amount;

    // The bill is revised afterwards, for a materially different figure.
    const maker = makeUser('REIA_USER', { name: 'Reviser' });
    const hod = makeUser('REIA_ADMIN', { name: 'Reviser HOD' });
    const rev = await post('/api/hydro-billing', signFor(maker), {
      contract_id: contract.id, ...JUNE, bill_kind: 'REVISION',
      revises_bill_id: bill.id, revision_reason: 'β certified', beta_value: 1.0,
    });
    expect(rev.status).toBe(200);

    const stored = await get(`/api/hydro-billing/fi/${prepared.body.id}`, viewer);
    expect(stored.body.lines[0].total_amount).toBe(bookedAt);
    expect(stored.body.total_amount).toBe(prepared.body.total_amount);
  });

  it('does not re-book a bill that is already on a live posting', async () => {
    await issuedBill();
    const prepared = await prepare();
    await post(`/api/hydro-billing/fi/${prepared.body.id}/post`, reia, {});

    const bookable = await get(
      `/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=2026-06`, viewer,
    );
    expect(bookable.body.bills).toHaveLength(0);
  });
});
