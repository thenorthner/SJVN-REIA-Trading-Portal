import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeContract } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { seedNjhpsAllocations } from '../../src/services/hydroStationBill.js';

// Hydro QA run 14 (18-Oct-2026): the month-end handover to Finance.

let desk, contract;
const JUNE = {
  billing_month: '2026-06', ex_bus_scheduled_kwh: 731158750, free_power_kwh: 87739035,
  pafm_percent: 109.667, beta_value: 0, nrldc_total_fee: 646884,
};
const TABLES = ['hydro_fi_posting_lines', 'hydro_fi_postings', 'hydro_ledger_clearings', 'hydro_ledger_docs',
  'hydro_bill_approvals', 'hydro_bill_lines', 'hydro_station_bills'];

beforeEach(() => {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  seedNjhpsAllocations();
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  desk = tokenFor('COMMERCIAL_ADMIN');
});
afterAll(() => { for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run(); });

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

async function issue(id) {
  const maker = makeUser('COMMERCIAL_ADMIN', { name: `H14 Maker ${Math.random()}` });
  const hod = makeUser('COMMERCIAL_ADMIN', { name: `H14 HOD ${Math.random()}` });
  // The maker of record is whoever created the bill; send and sign as others.
  db.prepare('UPDATE hydro_station_bills SET created_by = ? WHERE id = ?').run(maker.id, id);
  await post(`/api/hydro-billing/${id}/send-for-approval`, signToken(maker), {
    next_approver_id: hod.id, final_approver_id: hod.id, comments: 'go',
  });
  await post(`/api/hydro-billing/${id}/approve`, signToken(hod), { action: 'APPROVE', comments: 'ok' });
  const r = await post(`/api/hydro-billing/${id}/issue`, desk, { due_date: '2026-07-31' });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function issuedBill(body = {}) {
  const b = await post('/api/hydro-billing', desk, { contract_id: contract.id, ...JUNE, ...body });
  expect(b.status, JSON.stringify(b.body)).toBe(200);
  return issue(b.body.id);
}
const prepare = (body) => post('/api/hydro-billing/fi/prepare', desk, { contract_id: contract.id, period_month: '2026-06', ...body });
const bookable = () => get(`/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=2026-06`, desk);

describe('What Finance books', () => {
  it('books a revision at the difference the ledger charged, not the whole month again', async () => {
    const first = await issuedBill();
    await issuedBill({ bill_kind: 'REVISION', revises_bill_id: first.id, revision_reason: 'β certified', beta_value: 1.0 });
    // Issued in the same second, as under load: the revision still restates its own bill.
    db.prepare(`UPDATE hydro_station_bills SET issued_at = '2026-07-01 10:00:00'`).run();
    const r = await bookable();
    const charged = db.prepare(`SELECT SUM(CASE WHEN doc_type='PB' THEN amount WHEN mode='CREDIT_NOTE' THEN -amount ELSE 0 END) s FROM hydro_ledger_docs WHERE status <> 'REVERSED'`).get().s;
    expect(r.body.bills).toHaveLength(2);
    expect(r.body.totals.total_amount).toBeCloseTo(charged, 1);
  });

  it('includes supplementary bills, and books a late one after the month was posted', async () => {
    await issuedBill();
    const p = await prepare();
    expect((await post(`/api/hydro-billing/fi/${p.body.id}/post`, desk, { fi_document_no: 'VCH-H14-1' })).status).toBe(200);
    const sup = await post('/api/hydro-billing/supplementary', desk, {
      contract_id: contract.id, billing_month: '2026-06', amount: 50000, reason: 'TAXES_DUTIES', particulars: 'water cess',
    });
    expect(sup.status, JSON.stringify(sup.body)).toBe(200);
    await issue(sup.body.id);
    const late = await prepare();
    expect(late.status, JSON.stringify(late.body)).toBe(200);
    expect(late.body.lines.map((l) => l.bill_kind)).toEqual(['SUPPLEMENTARY']);
    expect(late.body.total_amount).toBe(50000);
  });
});

describe('Posting', () => {
  it('needs a voucher, used once', async () => {
    await issuedBill();
    const p = await prepare();
    expect((await post(`/api/hydro-billing/fi/${p.body.id}/post`, desk, {})).status).toBe(400);
    db.prepare(`INSERT INTO hydro_fi_postings (id, posting_no, contract_id, station_name, period_month, bill_category, status, fi_document_no)
      VALUES ('HFP-H14-X', 'FI/X/1', ?, 'X', '2026-05', 'HYDRO', 'POSTED', 'VCH-SAME')`).run(contract.id);
    expect((await post(`/api/hydro-billing/fi/${p.body.id}/post`, desk, { fi_document_no: 'vch-same' })).status).toBe(409);
  });

  it('a bill on a posting cannot be cancelled until the posting is reversed', async () => {
    const bill = await issuedBill();
    const p = await prepare();
    const c = await post(`/api/hydro-billing/${bill.id}/cancel`, desk, { reason: 'wrong' });
    expect(c.status).toBe(409);
    expect(c.body.error).toMatch(/FI posting/);
    // A prepared posting is withdrawn, with no counter-entry Finance never had.
    const w = await post(`/api/hydro-billing/fi/${p.body.id}/reverse`, desk, { reason: 'redo' });
    expect(w.body.withdrawn).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) n FROM hydro_fi_postings WHERE posting_no LIKE '%/REV'`).get().n).toBe(0);
    expect((await post(`/api/hydro-billing/${bill.id}/cancel`, desk, { reason: 'wrong' })).status).toBe(200);
  });

  it('a desk works its own stations\' postings, and only stations', async () => {
    await issuedBill();
    const p = await prepare();
    const thermal = tokenFor('THERMAL_ADMIN');
    expect((await post(`/api/hydro-billing/fi/${p.body.id}/reverse`, thermal, { reason: 'x' })).status).toBe(403);
    expect((await post(`/api/hydro-billing/fi/${p.body.id}/post`, thermal, { fi_document_no: 'T' })).status).toBe(403);
    const solar = makeContract({ project_type: 'Solar' });
    expect((await prepare({ contract_id: solar.id })).body.error).toMatch(/not a hydro or thermal station/);
  });
});
