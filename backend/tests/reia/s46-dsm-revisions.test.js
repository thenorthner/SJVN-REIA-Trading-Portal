import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, resetReia } from '../helpers/reia.js';
import { fyWeekStart } from '../../src/routes/deviationSettlements.js';

// Found by the browser audit of the DSM desk (17-Oct-2026): a revised NRPC
// statement for a week already billed was billed in full again (₹10,41,467 then
// ₹11,00,000 for one week), a second revision had nowhere to go, and estimates
// took a ₹120 crore week on a 412 MW plant, a negative rate and week 40 in May.

let reia, admin, rampur;
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);

function statement(id, revision, lakh, status = 'ACTIVE') {
  db.prepare(`INSERT INTO nrpc_dsa_accounts (id, week_code, week_no, financial_year, week_start, week_end, issued_date, due_date, file_sha256, entity_count, status, revision)
    VALUES (?, 'WK-40', 40, '2025-26', '2025-12-29', '2026-01-04', '2026-01-14', '2026-01-24', ?, 1, ?, ?)`).run(id, `sha-${id}`, status, revision);
  db.prepare(`INSERT INTO nrpc_dsa_entity_totals (id, account_id, entity_name, schedule_lu, actual_lu, devi_amt_lakh, adj_lakh, net_devi_lakh)
    VALUES (?, ?, 'RAMPUR HEP', 140.71702, 146.55249, ?, 0, ?)`).run(`T-${id}`, id, lakh, lakh);
}
const supersede = (oldId, newId) => db.prepare(`UPDATE nrpc_dsa_accounts SET status = 'SUPERSEDED', superseded_by = ? WHERE id = ?`).run(newId, oldId);
const raise = (accountId) => post('/api/deviation/from-dsa', { contract_id: rampur.id, dsa_account_id: accountId, entity_name: 'RAMPUR HEP' });
const dispatch = (rowId) => post(`/api/deviation/${rowId}/dispatch`, {});
const bill = (no) => db.prepare('SELECT * FROM invoices WHERE invoice_no = ?').get(no);

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM deviation_settlements').run();
  db.prepare('DELETE FROM nrpc_dsa_entity_totals').run();
  db.prepare('DELETE FROM nrpc_dsa_accounts').run();
  reia = tokenFor('REIA_USER');
  admin = tokenFor('SJVN_ADMIN');
  rampur = makeContract({ contract_no: 'PPA/SJVN/RHPS/T1', project_type: 'Hydro', capacity_mw: 412 });
});

describe('S46 A revised statement for a billed week', () => {
  it('bills only the difference once the first bill has been presented', async () => {
    statement('A0', null, -10.41467);
    const r0 = (await raise('A0')).body;
    const d0 = (await dispatch(r0.id)).body;
    expect(bill(d0.invoice_no).total_amount).toBe(1041467);
    db.prepare(`UPDATE invoices SET status = 'SENT' WHERE invoice_no = ?`).run(d0.invoice_no);

    statement('A1', 'R1', -11.0);
    supersede('A0', 'A1');
    const r1 = await raise('A1');
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const d1 = (await dispatch(r1.body.id)).body;
    const b1 = bill(d1.invoice_no);
    expect(b1.total_amount, 'the week was billed in full a second time').toBe(58533);
    expect(JSON.parse(b1.invoice_breakdown_json).some((l) => l.code === 'PRIOR' && l.value === -1041467)).toBe(true);
  });

  it('withdraws a first bill nobody has been given, and bills the revision in full', async () => {
    statement('A0', null, -10.41467);
    const d0 = (await dispatch((await raise('A0')).body.id)).body;
    statement('A1', 'R1', -11.0);
    supersede('A0', 'A1');
    const d1 = (await dispatch((await raise('A1')).body.id)).body;
    expect(bill(d1.invoice_no).total_amount).toBe(1100000);
    expect(bill(d0.invoice_no)).toMatchObject({ status: 'CANCELLED' });
    expect(bill(d0.invoice_no).cancel_reason).toMatch(/Superseded by revised NRPC statement/);
  });

  it('takes a second revision after the first was billed', async () => {
    statement('A1', 'R1', -11.0);
    const d1 = (await dispatch((await raise('A1')).body.id)).body;
    db.prepare(`UPDATE invoices SET status = 'SENT' WHERE invoice_no = ?`).run(d1.invoice_no);
    statement('A2', 'R2', -10.5);
    supersede('A1', 'A2');
    const r2 = await raise('A2');
    expect(r2.status, 'R2 had nowhere to go').toBe(201);
    const d2 = (await dispatch(r2.body.id)).body;
    // R1 was ₹11 lakh recoverable from the pool; R2 lowers it to ₹10.5 lakh, so
    // SJVN gives ₹50,000 back — a positive payable, never a negative bill.
    expect(bill(d1.invoice_no)).toMatchObject({ total_amount: 1100000, direction: 'SJVN_TO_BUYER' });
    expect(bill(d2.invoice_no)).toMatchObject({ total_amount: 50000, direction: 'SELLER_TO_SJVN' });
    expect(d2.invoice_no).toMatch(/^DSM-POOL/);
    expect((await raise('A2')).status, 'the same statement was raised twice').toBe(409);
  });
});

describe('S46 Estimates', () => {
  const estimate = (over = {}) => post('/api/deviation', {
    contract_id: rampur.id, period_month: '2026-05', week_no: 6, scheduled_mwh: 1000, actual_mwh: 1100, deviation_rate: 2880, ...over,
  });

  it('numbers weeks as NRPC does', () => {
    expect(fyWeekStart(2025, 40)).toBe('2025-12-29');
    expect(fyWeekStart(2022, 44)).toBe('2023-01-23');
    expect(fyWeekStart(2026, 6)).toBe('2026-05-04');
  });

  it('refuses a negative rate, a week outside the month, and more than the plant makes', async () => {
    expect((await estimate({ deviation_rate: -3000 })).body.error).toMatch(/never negative/);
    expect((await estimate({ week_no: 40 })).body.error).toMatch(/does not fall in 2026-05/);
    const big = await estimate({ scheduled_mwh: 500000, actual_mwh: 900000 });
    expect(big.status).toBe(400);
    expect(big.body.error).toMatch(/76,137\.6 MWh/); // 412 × 168 × 1.1
    const ok = await estimate();
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ deviation_amount: 288000, week_date: '2026-05-04' });
  });

  it('is for a station\'s PPA, not a buyer\'s PSA', async () => {
    const psa = makeContract({ contract_type: 'PSA', capacity_mw: 50 });
    expect((await estimate({ contract_id: psa.id })).body.error).toMatch(/is a PSA/);
  });
});
