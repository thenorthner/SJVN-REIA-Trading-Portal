import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { seedNjhpsAllocations } from '../src/services/hydroStationBill.js';
import { makeUser } from './helpers/reia.js';
import { signToken } from '../src/middleware/auth.js';

/** A token for a user that already exists, so a test can hold both the user
 *  record (for its id) and the credentials that act as them. */
const signFor = (user) => signToken(user);

// The workflow around the NJHPS station bill: what a station needs before it can
// be billed, previewing a month, saving it, issuing it, and revising it when the
// beta certificate arrives after the provisional bill has gone out.

let reia, viewer, contract;

// NJHPS and Rampur are seeded contracts that other suites read, and these tests
// rewrite their tariff constants to the figures on the printed bill. Snapshot
// both and put them back afterwards, so nothing here follows the shared database
// out of this file.
const TOUCHED = ['PPA/SJVN/NJHPS/001', 'PPA/SJVN/RHPS/001'];
const RESTORE_COLS = ['annual_afc', 'annual_design_energy_mwh', 'normative_aux',
  'free_energy_home_state', 'napaf_percent', 'capacity_mw', 'capacity_charges_total'];
let snapshot = [];

beforeAll(() => {
  snapshot = TOUCHED.map((no) =>
    db.prepare('SELECT * FROM contracts WHERE contract_no = ?').get(no)).filter(Boolean);
});

afterAll(() => {
  db.prepare('DELETE FROM hydro_ledger_clearings').run();
  db.prepare('DELETE FROM hydro_ledger_docs').run();
  db.prepare('DELETE FROM hydro_bill_approvals').run();
  const sets = RESTORE_COLS.map((c) => `${c} = ?`).join(', ');
  const stmt = db.prepare(`UPDATE contracts SET ${sets} WHERE id = ?`);
  for (const row of snapshot) stmt.run(...RESTORE_COLS.map((c) => row[c]), row.id);
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
});

const JUNE = {
  billing_month: '2026-06',
  ex_bus_scheduled_kwh: 731158750,
  free_power_kwh: 87739035,
  pafm_percent: 109.667,
  beta_value: 0,
  prior_scheduled_kwh: 714468750,
  prior_free_kwh: 85736250,
  nrldc_total_fee: 646884,
};

beforeEach(() => {
  db.prepare('DELETE FROM hydro_ledger_clearings').run();
  db.prepare('DELETE FROM hydro_ledger_docs').run();
  db.prepare('DELETE FROM hydro_bill_approvals').run();
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  seedNjhpsAllocations();

  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  // Put the station's tariff constants beyond doubt for the assertions below.
  // capacity_charges_total is restored along with the rest because one test
  // below nulls it to check the readiness message; NJHPS is a seeded contract
  // other suites read, so leaving it nulled would follow them out of this file.
  db.prepare(`
    UPDATE contracts SET annual_afc = 14615741000, annual_design_energy_mwh = 6612000,
      normative_aux = 1.2, free_energy_home_state = 12, napaf_percent = 87, capacity_mw = 1500,
      capacity_charges_total = 85000000
    WHERE id = ?
  `).run(contract.id);
  contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.id);

  reia = tokenFor('REIA_USER');
  viewer = tokenFor('MANAGEMENT');
});

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

describe('stations', () => {
  it('lists hydro stations with what each still needs', async () => {
    const r = await get('/api/hydro-billing/stations', viewer);
    expect(r.status).toBe(200);
    const njhps = r.body.find((s) => s.contract_no === 'PPA/SJVN/NJHPS/001');
    expect(njhps.ready).toBe(true);
    expect(njhps.allocation_rows).toBe(15);
  });

  it('names the constants a station is missing rather than billing it anyway', async () => {
    db.prepare('UPDATE contracts SET annual_afc = NULL, capacity_charges_total = NULL WHERE id = ?').run(contract.id);
    const r = await get('/api/hydro-billing/stations', viewer);
    const njhps = r.body.find((s) => s.contract_no === 'PPA/SJVN/NJHPS/001');
    expect(njhps.ready).toBe(false);
    expect(njhps.missing).toContain('Annual Fixed Charges (AFC)');
  });
});

describe('allocation master', () => {
  it('returns the sheet with the charging percentages derived', async () => {
    const r = await get(`/api/hydro-billing/allocations?contract_id=${contract.id}&month=2026-06`, viewer);
    expect(r.status).toBe(200);
    expect(r.body.fehs_pct).toBe(12);
    expect(r.body.rows).toHaveLength(15);
    const gohp = r.body.rows.find((x) => x.beneficiary_name === 'GoHP');
    expect(gohp.pct_rea).toBe(34);
    expect(gohp.pct_proportionate).toBeCloseTo(25, 6);
  });

  it('lets the desk correct a percentage', async () => {
    const row = db.prepare(`
      SELECT id FROM hydro_beneficiary_allocations
      WHERE contract_id = ? AND beneficiary_name = 'MPPMCL'
    `).get(contract.id);
    const r = await request(app).patch(`/api/hydro-billing/allocations/${row.id}`)
      .set(auth(reia)).send({ pct_rea: 0.2 });
    expect(r.status).toBe(200);
    expect(r.body.pct_rea).toBe(0.2);
  });

  it('does not let a viewer edit the master', async () => {
    const row = db.prepare('SELECT id FROM hydro_beneficiary_allocations LIMIT 1').get();
    const r = await request(app).patch(`/api/hydro-billing/allocations/${row.id}`)
      .set(auth(viewer)).send({ pct_rea: 50 });
    expect(r.status).toBe(403);
  });
});

describe('laying in a whole allocation sheet', () => {
  let rampur;
  beforeEach(() => {
    rampur = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/RHPS/001'`).get();
  });

  const sheet = (rows) => ({
    contract_id: rampur.id,
    effective_from: '2026-04-01',
    source_note: 'Provisional REA, RHPS, FY 2026-2027',
    rows,
  });

  // A station's own sheet, shaped like an REA allocation but standing in for one.
  const OK_ROWS = [
    { beneficiary_name: 'GoHP', pct_rea: 30, is_home_state: 1 },
    { beneficiary_name: 'HARYANA', pct_rea: 20 },
    { beneficiary_name: 'PUNJAB', pct_rea: 25 },
    { beneficiary_name: 'TPDDL', pct_rea: 25, parent_state: 'DELHI' },
  ];

  it('makes an unbillable station billable', async () => {
    const before = await get('/api/hydro-billing/stations', viewer);
    expect(before.body.find((s) => s.id === rampur.id).ready).toBe(false);

    const r = await post('/api/hydro-billing/allocations/bulk', reia, sheet(OK_ROWS));
    expect(r.status).toBe(200);
    expect(r.body.closes_on_100).toBe(true);
    expect(r.body.rows).toHaveLength(4);

    const after = await get('/api/hydro-billing/stations', viewer);
    const station = after.body.find((s) => s.id === rampur.id);
    expect(station.ready).toBe(true);
    expect(station.allocation_rows).toBe(4);
  });

  it('derives the charging percentages from the sheet it was given', async () => {
    const r = await post('/api/hydro-billing/allocations/bulk', reia, sheet(OK_ROWS));
    const gohp = r.body.rows.find((x) => x.beneficiary_name === 'GoHP');
    // 30 - 12 = 18, then 18 / 0.88.
    expect(gohp.pct_excl_free).toBeCloseTo(18, 6);
    expect(gohp.pct_proportionate).toBeCloseTo(20.454545, 5);
    expect(r.body.rows.reduce((a, x) => a + x.pct_proportionate, 0)).toBeCloseTo(100, 4);
  });

  it('replaces the sheet rather than appending to it', async () => {
    await post('/api/hydro-billing/allocations/bulk', reia, sheet(OK_ROWS));
    const again = await post('/api/hydro-billing/allocations/bulk', reia, sheet(OK_ROWS));
    expect(again.body.rows_replaced).toBe(4);
    const listed = await get(`/api/hydro-billing/allocations?contract_id=${rampur.id}&month=2026-06`, viewer);
    expect(listed.body.rows).toHaveLength(4);
  });

  it('saves a sheet that does not close on 100% but says it cannot bill', async () => {
    const r = await post('/api/hydro-billing/allocations/bulk', reia,
      sheet([{ beneficiary_name: 'GoHP', pct_rea: 30, is_home_state: 1 }, { beneficiary_name: 'PUNJAB', pct_rea: 25 }]));
    expect(r.status).toBe(200);
    expect(r.body.closes_on_100).toBe(false);
    expect(r.body.warning).toMatch(/not 100%/);

    // And the bill really is refused, rather than quietly under-billing.
    const bill = await post('/api/hydro-billing/preview', viewer, {
      contract_id: rampur.id, billing_month: '2026-06', ex_bus_scheduled_kwh: 1e8,
    });
    expect(bill.status).toBe(400);
    expect(bill.body.error).toMatch(/not 100%/);
  });

  it('insists the free power is pinned to exactly one home state', async () => {
    const none = await post('/api/hydro-billing/allocations/bulk', reia,
      sheet(OK_ROWS.map((r) => ({ ...r, is_home_state: 0 }))));
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/mark which beneficiary carries it/);

    const two = await post('/api/hydro-billing/allocations/bulk', reia,
      sheet([{ beneficiary_name: 'GoHP', pct_rea: 30, is_home_state: 1 },
        { beneficiary_name: 'HPSEB', pct_rea: 70, is_home_state: 1 }]));
    expect(two.status).toBe(400);
    expect(two.body.error).toMatch(/Only one beneficiary/);
  });

  it('refuses a home state whose share cannot absorb the free power', async () => {
    const r = await post('/api/hydro-billing/allocations/bulk', reia,
      sheet([{ beneficiary_name: 'GoHP', pct_rea: 5, is_home_state: 1 },
        { beneficiary_name: 'PUNJAB', pct_rea: 95 }]));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/free energy is carved out/);
  });

  it('refuses a beneficiary listed twice', async () => {
    const r = await post('/api/hydro-billing/allocations/bulk', reia,
      sheet([{ beneficiary_name: 'PUNJAB', pct_rea: 50, is_home_state: 1 },
        { beneficiary_name: 'punjab', pct_rea: 50 }]));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/appears twice/);
  });

  it('refuses an empty sheet and a row with no percentage', async () => {
    expect((await post('/api/hydro-billing/allocations/bulk', reia, sheet([]))).status).toBe(400);
    const bad = await post('/api/hydro-billing/allocations/bulk', reia,
      sheet([{ beneficiary_name: 'PUNJAB', pct_rea: 'x' }]));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/no usable REA percentage/);
  });

  it('does not let a read-only user replace the sheet', async () => {
    const r = await post('/api/hydro-billing/allocations/bulk', viewer, sheet(OK_ROWS));
    expect(r.status).toBe(403);
  });

  it('leaves an already-raised bill on the percentages it was computed on', async () => {
    await post('/api/hydro-billing/allocations/bulk', reia, sheet(OK_ROWS));
    const raised = await post('/api/hydro-billing', reia, {
      contract_id: rampur.id, billing_month: '2026-06', ex_bus_scheduled_kwh: 1e8, pafm_percent: 85, beta_value: 0,
    });
    expect(raised.status).toBe(200);

    // Move Punjab's share to Haryana and re-lay the sheet.
    await post('/api/hydro-billing/allocations/bulk', reia, sheet([
      { beneficiary_name: 'GoHP', pct_rea: 30, is_home_state: 1 },
      { beneficiary_name: 'HARYANA', pct_rea: 45 },
      { beneficiary_name: 'TPDDL', pct_rea: 25, parent_state: 'DELHI' },
    ]));

    const stored = await get(`/api/hydro-billing/${raised.body.id}`, viewer);
    expect(stored.body.lines).toHaveLength(4);
    expect(stored.body.lines.find((l) => l.beneficiary_name === 'PUNJAB').pct_rea).toBe(25);
  });
});

describe('preview', () => {
  it('reproduces the June 2026 bill and its beneficiary breakup', async () => {
    const r = await post('/api/hydro-billing/preview', viewer, { contract_id: contract.id, ...JUNE });
    expect(r.status).toBe(200);
    expect(r.body.bill.a12_ecr).toBe(1.271);
    expect(r.body.bill.total_charges).toBeCloseTo(1574926027, -3);
    expect(r.body.lines).toHaveLength(15);
    const sum = r.body.lines.reduce((a, l) => a + l.total_charges, 0);
    expect(sum).toBeCloseTo(r.body.bill.total_charges, 2);
  });

  it('says where each input came from', async () => {
    const r = await post('/api/hydro-billing/preview', viewer, { contract_id: contract.id, ...JUNE });
    expect(r.body.sources.energy).toBe('entered');
    expect(r.body.sources.cumulative).toMatch(/first bill|carried from/);
  });

  it('accepts a month written as a name', async () => {
    const r = await post('/api/hydro-billing/preview', viewer, {
      contract_id: contract.id, ...JUNE, billing_month: 'June-2026',
    });
    expect(r.status).toBe(200);
    expect(r.body.bill.billing_month).toBe('2026-06');
  });

  it('refuses a month it cannot read', async () => {
    const r = await post('/api/hydro-billing/preview', viewer, {
      contract_id: contract.id, ...JUNE, billing_month: 'sometime in June',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/billing_month/);
  });

  it('refuses to guess the energy when neither the request nor energy data has it', async () => {
    const r = await post('/api/hydro-billing/preview', viewer, {
      contract_id: contract.id, billing_month: '2026-06',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No ex-bus scheduled energy/);
  });

  it('takes the energy from the month\'s energy data when it is not entered', async () => {
    db.prepare(`
      INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, availability_percent, status)
      VALUES ('ED-HB-TEST', ?, '2026-06', 'PROVISIONAL', 'REA', 731158.75, 109.667, 'VALIDATED')
    `).run(contract.id);
    const r = await post('/api/hydro-billing/preview', viewer, {
      contract_id: contract.id, billing_month: '2026-06',
      prior_scheduled_kwh: 714468750, prior_free_kwh: 85736250,
    });
    db.prepare(`DELETE FROM energy_data WHERE id = 'ED-HB-TEST'`).run();
    expect(r.status).toBe(200);
    expect(r.body.bill.e1_ex_bus_scheduled_kwh).toBe(731158750);
    expect(r.body.sources.energy).toMatch(/energy_data PROVISIONAL/);
    expect(r.body.sources.pafm).toMatch(/availability/);
  });
});

describe('raising a bill', () => {
  const create = (body = {}) => post('/api/hydro-billing', reia, { contract_id: contract.id, ...JUNE, ...body });

  it('saves the bill with its fifteen beneficiary lines', async () => {
    const r = await create();
    expect(r.status).toBe(200);
    expect(r.body.bill_no).toMatch(/^HB/);
    const stored = await get(`/api/hydro-billing/${r.body.id}`, viewer);
    expect(stored.body.status).toBe('DRAFT');
    expect(stored.body.lines).toHaveLength(15);
    expect(stored.body.financial_year).toBe('2026-2027');
    const sum = stored.body.lines.reduce((a, l) => a + l.capacity_charge, 0);
    expect(sum).toBeCloseTo(stored.body.c5_total_capacity_charge, 2);
  });

  it('does not let a read-only user raise one', async () => {
    const r = await post('/api/hydro-billing', viewer, { contract_id: contract.id, ...JUNE });
    expect(r.status).toBe(403);
  });

  it('refuses a second provisional bill for the same month and names the first', async () => {
    const first = await create();
    const second = await create();
    expect(second.status).toBe(409);
    expect(second.body.existing_bill_no).toBe(first.body.bill_no);
    expect(second.body.error).toMatch(/already has a PROVISIONAL bill/);
  });

  it('allows a FINAL bill alongside the provisional one', async () => {
    await create();
    const r = await create({ bill_kind: 'FINAL' });
    expect(r.status).toBe(200);
    expect(r.body.bill_kind).toBe('FINAL');
  });

  it('carries the cumulative energy forward from the month already billed', async () => {
    await post('/api/hydro-billing', reia, {
      contract_id: contract.id,
      billing_month: '2026-05',
      ex_bus_scheduled_kwh: 459358500,
      free_power_kwh: 55123020,
      pafm_percent: 100,
      beta_value: 0,
      prior_scheduled_kwh: 255110250,
      prior_free_kwh: 30613230,
    });
    const r = await post('/api/hydro-billing/preview', viewer, {
      contract_id: contract.id, billing_month: '2026-06',
      ex_bus_scheduled_kwh: 731158750, free_power_kwh: 87739035, pafm_percent: 109.667, beta_value: 0,
    });
    // April is not on the platform, so the carried figure is May's own month
    // rather than the printed cumulative — but it is carried, not restarted.
    expect(r.body.sources.cumulative).toMatch(/carried from 2026-05/);
    expect(r.body.bill.e4_cum_scheduled_kwh).toBe(459358500 + 731158750);
  });
});

describe('revision when beta arrives late', () => {
  async function provisional() {
    return post('/api/hydro-billing', reia, {
      contract_id: contract.id,
      billing_month: '2026-05',
      ex_bus_scheduled_kwh: 459358500,
      free_power_kwh: 55123020,
      pafm_percent: 100,
      beta_value: 0,
      prior_scheduled_kwh: 255110250,
      prior_free_kwh: 30613230,
    });
  }

  it('bills only the difference the certified beta makes', async () => {
    const first = await provisional();
    expect(first.body.total_charges).toBeCloseTo(1227195310, -3);

    const rev = await post('/api/hydro-billing', reia, {
      contract_id: contract.id,
      billing_month: '2026-05',
      bill_kind: 'REVISION',
      revises_bill_id: first.body.id,
      revision_reason: 'β certified at 1.00 by NRPC on 19.06.2026',
      ex_bus_scheduled_kwh: 459358500,
      free_power_kwh: 55123020,
      pafm_percent: 100,
      beta_value: 1.0,
      prior_scheduled_kwh: 255110250,
      prior_free_kwh: 30613230,
    });
    expect(rev.status).toBe(200);
    expect(rev.body.total_charges).toBeCloseTo(1245464986, -3);

    const stored = await get(`/api/hydro-billing/${rev.body.id}`, viewer);
    expect(stored.body.prev_total_charges).toBeCloseTo(1227195310, -3);
    expect(stored.body.differential_amount).toBeCloseTo(18269676, -2);
    expect(stored.body.revises_bill_no).toBe(first.body.bill_no);
  });

  it('insists a revision says what changed', async () => {
    const first = await provisional();
    const r = await post('/api/hydro-billing', reia, {
      contract_id: contract.id, billing_month: '2026-05', bill_kind: 'REVISION',
      revises_bill_id: first.body.id, ex_bus_scheduled_kwh: 459358500, beta_value: 1.0,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/what changed/);
  });

  it('refuses to revise a month that was never billed', async () => {
    const r = await post('/api/hydro-billing', reia, {
      contract_id: contract.id, ...JUNE, bill_kind: 'REVISION', revision_reason: 'x',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Nothing to revise/);
  });

  it('does not double-count a revised month in the cumulative energy', async () => {
    await provisional();
    await post('/api/hydro-billing', reia, {
      contract_id: contract.id, billing_month: '2026-05', bill_kind: 'REVISION',
      revision_reason: 'β certified', ex_bus_scheduled_kwh: 459358500, free_power_kwh: 55123020,
      pafm_percent: 100, beta_value: 1.0, prior_scheduled_kwh: 255110250, prior_free_kwh: 30613230,
    });
    const r = await post('/api/hydro-billing/preview', viewer, {
      contract_id: contract.id, billing_month: '2026-06',
      ex_bus_scheduled_kwh: 731158750, free_power_kwh: 87739035, pafm_percent: 109.667, beta_value: 0,
    });
    expect(r.body.bill.e4_cum_scheduled_kwh).toBe(459358500 + 731158750);
  });
});

describe('approval chain before a bill can be issued', () => {
  let maker, approver1, approver2, final;
  let makerTok, tok1, tok2, finalTok;

  beforeEach(() => {
    maker = makeUser('REIA_USER', { name: 'Maker' });
    approver1 = makeUser('REIA_USER', { name: 'Approver One' });
    approver2 = makeUser('REIA_USER', { name: 'Approver Two' });
    final = makeUser('REIA_ADMIN', { name: 'HOD' });
    makerTok = signFor(maker); tok1 = signFor(approver1);
    tok2 = signFor(approver2); finalTok = signFor(final);
  });

  const raise = () => post('/api/hydro-billing', makerTok, { contract_id: contract.id, ...JUNE });

  const send = (id, body) => post(`/api/hydro-billing/${id}/send-for-approval`, makerTok, {
    next_approver_id: approver1.id, final_approver_id: final.id, comments: 'please approve', ...body,
  });

  it('refuses to issue a bill that has not been approved', async () => {
    const b = await raise();
    const r = await post(`/api/hydro-billing/${b.body.id}/issue`, reia, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not been sent for approval/);
    expect(r.body.approval_status).toBe('NOT_SENT');
  });

  it('refuses to issue a bill still sitting with an approver', async () => {
    const b = await raise();
    await send(b.body.id);
    const r = await post(`/api/hydro-billing/${b.body.id}/issue`, reia, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/still with Approver One/);
  });

  it('puts the bill in the approver\'s inbox', async () => {
    const b = await raise();
    await send(b.body.id);
    const inbox = await get('/api/hydro-billing/approvals/inbox', tok1);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].bill_no).toBe(b.body.bill_no);
    // And not in anyone else's.
    expect((await get('/api/hydro-billing/approvals/inbox', tok2)).body).toHaveLength(0);
  });

  it('will not let the person who raised the bill approve it', async () => {
    const b = await raise();
    const self = await send(b.body.id, { next_approver_id: maker.id });
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/Segregation of duties/);
  });

  it('carries a bill up a multi-step chain and then releases it', async () => {
    const b = await raise();
    await send(b.body.id);

    const step1 = await post(`/api/hydro-billing/${b.body.id}/approve`, tok1, {
      action: 'APPROVE', comments: 'checked the REA', next_approver_id: approver2.id,
    });
    expect(step1.status).toBe(200);
    expect(step1.body.now_with).toBe('Approver Two');
    expect(step1.body.approval_status).toBe('IN_APPROVAL');

    const step2 = await post(`/api/hydro-billing/${b.body.id}/approve`, tok2, {
      action: 'APPROVE', comments: 'agreed', next_approver_id: final.id,
    });
    expect(step2.body.is_final_step).toBe(true);

    const last = await post(`/api/hydro-billing/${b.body.id}/approve`, finalTok, {
      action: 'APPROVE', comments: 'approved for issue',
    });
    expect(last.body.outcome).toBe('APPROVED');
    expect(last.body.approval_status).toBe('APPROVED');

    const issued = await post(`/api/hydro-billing/${b.body.id}/issue`, reia, {});
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('ISSUED');
  });

  it('lets an approver finish the chain early by marking it final', async () => {
    const b = await raise();
    await send(b.body.id);
    const r = await post(`/api/hydro-billing/${b.body.id}/approve`, tok1, {
      action: 'APPROVE', comments: 'no further review needed', mark_final: true,
    });
    expect(r.body.approval_status).toBe('APPROVED');
  });

  it('needs somewhere to send the bill next if it is not the final approval', async () => {
    const b = await raise();
    await send(b.body.id);
    const r = await post(`/api/hydro-billing/${b.body.id}/approve`, tok1, {
      action: 'APPROVE', comments: 'ok',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Name the next approver/);
  });

  it('only lets the approver it is with act on it', async () => {
    const b = await raise();
    await send(b.body.id);
    const r = await post(`/api/hydro-billing/${b.body.id}/approve`, tok2, {
      action: 'APPROVE', comments: 'not mine', mark_final: true,
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/is with Approver One, not you/);
  });

  it('insists every decision carries a comment', async () => {
    const b = await raise();
    await send(b.body.id);
    const r = await post(`/api/hydro-billing/${b.body.id}/approve`, tok1, {
      action: 'APPROVE', mark_final: true,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must carry a comment/);
  });

  it('a rejection stops the bill and is not issuable', async () => {
    const b = await raise();
    await send(b.body.id);
    const r = await post(`/api/hydro-billing/${b.body.id}/approve`, tok1, {
      action: 'REJECT', comments: 'PAFM looks wrong',
    });
    expect(r.body.outcome).toBe('REJECTED');

    const issued = await post(`/api/hydro-billing/${b.body.id}/issue`, reia, {});
    expect(issued.status).toBe(400);
    expect(issued.body.error).toMatch(/was rejected/);
  });

  it('records the whole chain with who said what', async () => {
    const b = await raise();
    await send(b.body.id);
    await post(`/api/hydro-billing/${b.body.id}/approve`, tok1, {
      action: 'FORWARD', comments: 'over to you', next_approver_id: approver2.id,
    });
    const trail = await get(`/api/hydro-billing/${b.body.id}/approvals`, viewer);
    expect(trail.body.trail).toHaveLength(2);
    expect(trail.body.trail[0].status).toBe('FORWARDED');
    expect(trail.body.trail[0].comments).toBe('over to you');
    expect(trail.body.pending.approver_name).toBe('Approver Two');
  });

  it('will not send the same bill for approval twice', async () => {
    const b = await raise();
    await send(b.body.id);
    const again = await send(b.body.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already with an approver/);
  });
});

describe('the beneficiary ledger once a bill is issued', () => {
  let billId;

  async function issueApproved() {
    const maker = makeUser('REIA_USER', { name: 'Ledger Maker' });
    const hod = makeUser('REIA_ADMIN', { name: 'Ledger HOD' });
    const b = await post('/api/hydro-billing', signFor(maker), { contract_id: contract.id, ...JUNE });
    await post(`/api/hydro-billing/${b.body.id}/send-for-approval`, signFor(maker), {
      next_approver_id: hod.id, final_approver_id: hod.id, comments: 'go',
    });
    await post(`/api/hydro-billing/${b.body.id}/approve`, signFor(hod), {
      action: 'APPROVE', comments: 'approved',
    });
    const issued = await post(`/api/hydro-billing/${b.body.id}/issue`, reia, { due_date: '2026-07-31' });
    return { id: b.body.id, issued };
  }

  beforeEach(async () => {
    const r = await issueApproved();
    billId = r.id;
    expect(r.issued.status).toBe(200);
  });

  it('opens an account for every beneficiary on the bill', async () => {
    const accounts = await get(`/api/hydro-billing/ledger/accounts?contract_id=${contract.id}`, viewer);
    expect(accounts.body).toHaveLength(15);
    const gohp = accounts.body.find((a) => a.beneficiary_name === 'GoHP');
    expect(gohp.outstanding).toBeGreaterThan(0);
  });

  it('shows the bill as a PB document the beneficiary owes', async () => {
    const r = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    expect(r.status).toBe(200);
    const pb = r.body.rows.find((x) => x.doc_type === 'PB');
    expect(pb.due_date).toBe('2026-07-31');
    expect(r.body.totals.outstanding).toBeCloseTo(pb.amount, 2);
  });

  it('clears the account when the beneficiary pays in full', async () => {
    const before = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    const owed = before.body.totals.outstanding;

    const pay = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'GoHP', amount: owed,
      payment_date: '2026-07-20', mode: 'RTGS', reference: 'UTR-123',
    });
    expect(pay.status).toBe(200);
    expect(pay.body.unapplied).toBe(0);

    const after = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    expect(after.body.totals.outstanding).toBe(0);
    expect(after.body.rows.find((x) => x.doc_type === 'PB').clr_doc).toBe(pay.body.doc.doc_no);
  });

  it('flags money paid beyond the bill as an advance', async () => {
    const before = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    const pay = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'GoHP',
      amount: before.body.totals.outstanding + 5000, payment_date: '2026-07-20',
    });
    expect(pay.body.unapplied).toBe(5000);
    expect(pay.body.note).toMatch(/unapplied/);
  });

  it('does not let a viewer record a payment', async () => {
    const r = await post('/api/hydro-billing/ledger/payment', viewer, {
      contract_id: contract.id, beneficiary: 'GoHP', amount: 100, payment_date: '2026-07-20',
    });
    expect(r.status).toBe(403);
  });

  it('reverses a payment and reopens the bill', async () => {
    const before = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    const owed = before.body.totals.outstanding;
    const pay = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'GoHP', amount: owed, payment_date: '2026-07-20',
    });

    const rev = await post(`/api/hydro-billing/ledger/${pay.body.doc.id}/reverse-payment`, reia, {
      reason: 'credited to the wrong station',
    });
    expect(rev.status).toBe(200);

    const after = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    expect(after.body.totals.outstanding).toBeCloseTo(owed, 2);
  });

  it('resets a clearing into an advance and applies it again', async () => {
    const before = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    const owed = before.body.totals.outstanding;
    const pay = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'GoHP', amount: owed, payment_date: '2026-07-20',
    });

    const reset = await post(`/api/hydro-billing/ledger/${pay.body.doc.id}/reset-clearing`, reia, {});
    expect(reset.status).toBe(200);
    let acc = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    expect(acc.body.totals.advance).toBeCloseTo(owed, 2);
    expect(acc.body.rows.find((x) => x.doc_type === 'PMT').display_type).toBe('ADV');

    const applied = await post(`/api/hydro-billing/ledger/${pay.body.doc.id}/account-maintenance`, reia, {});
    expect(applied.status).toBe(200);
    acc = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    expect(acc.body.totals.outstanding).toBe(0);
  });

  it('refuses to cancel a bill that has been paid against, and says which payment', async () => {
    const before = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    const pay = await post('/api/hydro-billing/ledger/payment', reia, {
      contract_id: contract.id, beneficiary: 'GoHP',
      amount: before.body.totals.outstanding, payment_date: '2026-07-20',
    });

    const cancel = await post(`/api/hydro-billing/${billId}/cancel`, reia, { reason: 'wrong REA' });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error).toMatch(/Reset the clearing/);
    expect(cancel.body.blocking_payments[0].doc_no).toBe(pay.body.doc.doc_no);

    await post(`/api/hydro-billing/ledger/${pay.body.doc.id}/reset-clearing`, reia, {});
    const retry = await post(`/api/hydro-billing/${billId}/cancel`, reia, { reason: 'wrong REA' });
    expect(retry.status).toBe(200);
  });

  it('accrues and posts late payment surcharge on an overdue bill', async () => {
    const peek = await get(
      `/api/hydro-billing/ledger/lps?contract_id=${contract.id}&beneficiary=GoHP&as_of=2026-10-31`, viewer,
    );
    expect(peek.status).toBe(200);
    expect(peek.body.total_chargeable).toBeGreaterThan(0);

    const posted = await post('/api/hydro-billing/ledger/lps', reia, {
      contract_id: contract.id, beneficiary: 'GoHP', as_of: '2026-10-31',
    });
    expect(posted.body.posted).toBe(1);

    const acc = await get(`/api/hydro-billing/ledger?contract_id=${contract.id}&beneficiary=GoHP`, viewer);
    expect(acc.body.totals.surcharge).toBeGreaterThan(0);
    expect(acc.body.rows.some((x) => x.doc_type === 'LPS')).toBe(true);
  });
});

describe('issue and cancel', () => {
  const create = () => post('/api/hydro-billing', reia, { contract_id: contract.id, ...JUNE });

  it('issues an approved bill once, and posts it to the beneficiary ledger', async () => {
    const b = await create();
    // Issuing is gated on approval now, so the bill goes up the chain first.
    const hod = makeUser('REIA_ADMIN', { name: 'Issue HOD' });
    await post(`/api/hydro-billing/${b.body.id}/send-for-approval`, reia, {
      next_approver_id: hod.id, final_approver_id: hod.id, comments: 'go',
    });
    await post(`/api/hydro-billing/${b.body.id}/approve`, signFor(hod), {
      action: 'APPROVE', comments: 'approved',
    });

    const first = await post(`/api/hydro-billing/${b.body.id}/issue`, reia, { checked_by: 'Munish Kumar' });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('ISSUED');
    expect(first.body.checked_by).toBe('Munish Kumar');
    // One document per beneficiary opens on issue.
    expect(first.body.ledger_docs_posted).toBe(15);
    expect(first.body.due_date).toBeTruthy();

    const again = await post(`/api/hydro-billing/${b.body.id}/issue`, reia, {});
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already ISSUED/);
  });

  it('insists a cancellation says why, then frees the month', async () => {
    const b = await create();
    const noReason = await post(`/api/hydro-billing/${b.body.id}/cancel`, reia, {});
    expect(noReason.status).toBe(400);

    const done = await post(`/api/hydro-billing/${b.body.id}/cancel`, reia, { reason: 'REA superseded' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('CANCELLED');

    const rebill = await create();
    expect(rebill.status).toBe(200);
  });

  it('warns when cancelling a month later bills have already carried forward', async () => {
    const may = await post('/api/hydro-billing', reia, {
      contract_id: contract.id, billing_month: '2026-05',
      ex_bus_scheduled_kwh: 459358500, free_power_kwh: 55123020, pafm_percent: 100, beta_value: 0,
    });
    await create();
    const r = await post(`/api/hydro-billing/${may.body.id}/cancel`, reia, { reason: 'wrong REA' });
    expect(r.body.warning).toMatch(/2026-06/);
  });
});

describe('listing', () => {
  it('filters by station, month and status', async () => {
    await post('/api/hydro-billing', reia, { contract_id: contract.id, ...JUNE });
    const all = await get('/api/hydro-billing', viewer);
    expect(all.body.length).toBe(1);
    const byMonth = await get('/api/hydro-billing?billing_month=June-2026', viewer);
    expect(byMonth.body.length).toBe(1);
    const wrongMonth = await get('/api/hydro-billing?billing_month=2026-07', viewer);
    expect(wrongMonth.body.length).toBe(0);
    const issued = await get('/api/hydro-billing?status=ISSUED', viewer);
    expect(issued.body.length).toBe(0);
  });
});
