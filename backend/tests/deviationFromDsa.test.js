/**
 * Settling a deviation week from the NRPC statement rather than from a rate.
 *
 * The module was built around deviation_amount = (actual − scheduled) × rate.
 * Measured against NRPC's published accounts that does not hold, so a row now
 * records where its amount came from, and a statement-backed row carries the
 * published figure untouched. These tests pin that boundary: the conversion
 * into the platform's units and sign, and the guards that stop a published
 * figure being quietly replaced by an estimate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { tokenFor, auth, makeContract } from './helpers/reia.js';
import { storeParsedDsa } from '../src/services/nrpcDsaIngest.js';

let writer, contract;

beforeEach(() => {
  db.prepare('DELETE FROM deviation_settlements').run();
  db.prepare('DELETE FROM nrpc_dsa_accounts').run();
  writer = tokenFor('REIA_USER');
  contract = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/NJHPS/T-${Math.random().toString(36).slice(2, 8)}` });
});

/**
 * Store a statement for one entity. Figures default to Nathpa Jhakri's real
 * WK-40 of 2025-26: 511.07 LU scheduled, 517.20474 actual, and −8.37312 Rs
 * Lakh settled — negative being money SJVN receives.
 */
function storeStatement({
  weekNo = 40, fy = '2025-26', start = '2025-12-29', end = '2026-01-04',
  issued = '2026-01-14', entity = 'NATHPA JHAKRI HEP', net = -8.37312,
  schedule = 511.07, actual = 517.20474, weekCode = '291225-040126(WK-40)', body,
} = {}) {
  const figures = {
    schedule_lu: schedule, actual_lu: actual, devi_amt_lakh: net,
    sus_devi: null, sus_amount_lakh: null, add_devi_lakh: null,
    adj_lakh: 0, net_devi_lakh: net,
  };
  return storeParsedDsa({
    header: {
      week_no: weekNo, financial_year: fy, week_start: start, week_end: end,
      issued_date: issued, due_date: '2026-01-24',
    },
    entities: [{
      entity_name: entity,
      days: [{ entry_date: start, ...figures }],
      total: figures,
    }],
    problems: [],
    warnings: [],
  }, {
    buffer: Buffer.from(body || `pdf-${Math.random()}`),
    sourceKind: 'ARCHIVE', weekCode, createdBy: 'test',
  });
}

const promote = (token, body) =>
  request(app).post('/api/deviation/from-dsa').set(auth(token)).send(body);

describe('POST /api/deviation/from-dsa', () => {
  it('takes the published figure, converting units and flipping the sign', async () => {
    const acct = storeStatement();
    const res = await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });

    expect(res.status).toBe(201);
    // 511.07 Lakh Units is 51,107 MWh.
    expect(res.body.scheduled_mwh).toBe(51107);
    expect(res.body.actual_mwh).toBeCloseTo(51720.474, 3);
    // −8.37312 Rs Lakh "to be Received" becomes +837,312 recoverable.
    expect(res.body.deviation_amount).toBe(837312);
    expect(res.body.source).toBe('NRPC_DSA');
    expect(res.body.is_estimate).toBe(false);
    // No rate: the statement publishes none, and a zero would read as one.
    expect(res.body.deviation_rate).toBeNull();
    expect(res.body.status).toBe('CALCULATED');
  });

  it('turns a statement positive into a payable', async () => {
    const acct = storeStatement({ entity: 'SJVN GREEN ENERGY', net: 28.56544 });
    const sgel = makeContract({ project_type: 'Solar', contract_no: `PPA/SJVN/SGEL/T-${Math.random().toString(36).slice(2, 8)}` });
    const res = await promote(writer, {
      contract_id: sgel.id, dsa_account_id: acct.account_id, entity_name: 'SJVN GREEN ENERGY',
    });
    expect(res.body.deviation_amount).toBe(-2856544);
  });

  it('files the week under the month it starts in, and numbers it by financial-year week', async () => {
    const acct = storeStatement();
    const res = await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    // The week straddles the year end; it belongs to one period, the one it starts in.
    expect(res.body.period_month).toBe('2025-12');
    expect(res.body.week_no).toBe(40);
    expect(res.body.dsm_no).toContain('2025-26/W40');
  });

  it('marks a row from a revised statement as REVISED', async () => {
    const acct = storeStatement({ weekCode: '291225-040126(WK-40)_R1' });
    const res = await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    expect(res.body.entry_type).toBe('REVISED');
  });

  it('refuses a statement that has since been superseded', async () => {
    const original = storeStatement({ body: 'a', weekCode: '291225-040126(WK-40)' });
    storeStatement({ body: 'b', weekCode: '291225-040126(WK-40)_R1', net: -9.5 });

    const res = await promote(writer, {
      contract_id: contract.id, dsa_account_id: original.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/superseded/i);
  });

  it('refuses an entity the statement does not carry', async () => {
    const acct = storeStatement();
    const res = await promote(writer, {
      contract_id: makeContract({ project_type: 'Solar' }).id, dsa_account_id: acct.account_id, entity_name: 'RAMPUR HPS',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no entity named/i);
  });

  it('refuses a second row for the same contract, period and week', async () => {
    const acct = storeStatement();
    const body = { contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP' };
    await promote(writer, body);
    const res = await promote(writer, body);
    expect(res.status).toBe(409);
  });
});

describe('a statement-backed row is not editable into an estimate', () => {
  let rowId;
  beforeEach(async () => {
    const acct = storeStatement();
    const res = await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    rowId = res.body.id;
  });

  it.each(['scheduled_mwh', 'actual_mwh', 'deviation_rate'])('refuses an edit to %s', async (field) => {
    const res = await request(app).put(`/api/deviation/${rowId}`)
      .set(auth(writer)).send({ [field]: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be edited/);
  });

  it('allows notes, and leaves the published figure alone', async () => {
    const res = await request(app).put(`/api/deviation/${rowId}`)
      .set(auth(writer)).send({ notes: 'Checked against NRPC WK-40' });
    expect(res.status).toBe(200);
    expect(res.body.deviation_amount).toBe(837312);
    expect(res.body.deviation_rate).toBeNull();
  });
});

describe('submit guards', () => {
  it('refuses to submit a cancelled row', async () => {
    const acct = storeStatement();
    const { body: row } = await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    await request(app).delete(`/api/deviation/${row.id}`).set(auth(writer));

    const res = await request(app).post(`/api/deviation/${row.id}/submit`).set(auth(writer));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only DRAFT or CALCULATED/);
  });

  it('refuses to submit a row whose statement was superseded after it was created', async () => {
    const acct = storeStatement({ body: 'a', weekCode: '291225-040126(WK-40)' });
    const { body: row } = await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    // NRPC reissues the week after the row was raised.
    storeStatement({ body: 'b', weekCode: '291225-040126(WK-40)_R1', net: -9.5 });

    const res = await request(app).post(`/api/deviation/${row.id}/submit`).set(auth(writer));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/superseded/i);
  });
});

describe('GET /api/deviation/summary', () => {
  it('counts a revised week once, not twice', async () => {
    const primary = storeStatement({ body: 'a', weekCode: '291225-040126(WK-40)' });
    await promote(writer, {
      contract_id: contract.id, dsa_account_id: primary.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    // The reissue supersedes the original in the statement store, so promote
    // it directly and check the summary does not add the two together.
    const revised = storeStatement({ body: 'b', weekCode: '291225-040126(WK-40)_R1', net: -9.5 });
    await promote(writer, {
      contract_id: contract.id, dsa_account_id: revised.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });

    const res = await request(app).get('/api/deviation/summary').set(auth(writer));
    expect(res.body.weeks).toBe(1);
    // The revision's figure, not the sum of both.
    expect(res.body.net_amount).toBe(950000);
    expect(res.body.from_statement).toBe(1);
  });

  it('reports how many rows are estimates rather than statements', async () => {
    const acct = storeStatement();
    await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    await request(app).post('/api/deviation').set(auth(writer)).send({
      contract_id: contract.id, period_month: '2026-01', week_no: 41,
      scheduled_mwh: 1000, actual_mwh: 1050, deviation_rate: 2500,
    });

    const res = await request(app).get('/api/deviation/summary').set(auth(writer));
    expect(res.body.from_statement).toBe(1);
    expect(res.body.estimated).toBe(1);
  });
});

describe('an estimate cannot become a bill', () => {
  it('refuses to dispatch a manual row', async () => {
    // Manual rows are priced by deviation x rate, which is not how NRPC
    // settles. They exist so finance can accrue a provision while the
    // statement is still a week away — not so a beneficiary can be invoiced.
    const { body: row } = await request(app).post('/api/deviation').set(auth(writer)).send({
      contract_id: contract.id, period_month: '2026-02', week_no: 7,
      scheduled_mwh: 1000, actual_mwh: 1050, deviation_rate: 2500,
    });
    expect(row.source).toBe('MANUAL');
    await request(app).post(`/api/deviation/${row.id}/submit`).set(auth(writer));

    const res = await request(app).post(`/api/deviation/${row.id}/dispatch`)
      .set(auth(writer)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/manual estimate/i);
    expect(res.body.source).toBe('MANUAL');

    // And nothing was raised on the way to refusing.
    const invoices = db.prepare('SELECT COUNT(*) c FROM invoices').get().c;
    expect(invoices).toBe(0);
  });

  it('still dispatches a statement-backed row', async () => {
    const acct = storeStatement();
    const { body: row } = await promote(writer, {
      contract_id: contract.id, dsa_account_id: acct.account_id, entity_name: 'NATHPA JHAKRI HEP',
    });
    await request(app).post(`/api/deviation/${row.id}/submit`).set(auth(writer));
    const res = await request(app).post(`/api/deviation/${row.id}/dispatch`)
      .set(auth(writer)).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISPATCHED');
  });
});

describe('GET /api/deviation/summary — pending reconciliation', () => {
  it('counts estimates whose statement has not arrived', async () => {
    await request(app).post('/api/deviation').set(auth(writer)).send({
      contract_id: contract.id, period_month: '2026-02', week_no: 7, week_date: '2026-02-09',
      scheduled_mwh: 1000, actual_mwh: 1050, deviation_rate: 2500,
    });
    const res = await request(app).get('/api/deviation/summary').set(auth(writer));
    expect(res.body.pending_reconciliation).toBe(1);
    expect(res.body.estimates_replaceable).toBe(0);
  });

  it('moves one to replaceable once its statement is held', async () => {
    await request(app).post('/api/deviation').set(auth(writer)).send({
      contract_id: contract.id, period_month: '2025-12', week_no: 40, week_date: '2025-12-31',
      scheduled_mwh: 1000, actual_mwh: 1050, deviation_rate: 2500,
    });
    // The statement covering 2025-12-29..2026-01-04 lands.
    storeStatement();

    const res = await request(app).get('/api/deviation/summary').set(auth(writer));
    expect(res.body.pending_reconciliation).toBe(0);
    expect(res.body.estimates_replaceable).toBe(1);
  });
});
