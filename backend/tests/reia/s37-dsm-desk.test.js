import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeContract, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { storeParsedDsa } from '../../src/services/nrpcDsaIngest.js';

// The deviation desk, as reading it for its first end-to-end test found it:
// a deleted week could never be entered again, an official row's notes could
// not be saved, and the screen had no way to raise a week from a statement
// without knowing the figures the server would give it.

let reia, contract;

const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const put = (path, body = {}, who = reia) => request(app).put(path).set(auth(who)).send(body);
const del = (path, who = reia) => request(app).delete(path).set(auth(who));
const manual = (over = {}) => ({
  contract_id: contract.id, period_month: '2026-05', week_no: 6, entry_type: 'PRIMARY',
  scheduled_mwh: 1000, actual_mwh: 1040, deviation_rate: 350, ...over,
});

/** Nathpa Jhakri's real WK-40 of 2025-26: −8.37312 Rs Lakh, money SJVN receives. */
function storeStatement({ entity = 'NATHPA JHAKRI HEP', net = -8.37312, body } = {}) {
  const figures = {
    schedule_lu: 511.07, actual_lu: 517.20474, devi_amt_lakh: net,
    sus_devi: null, sus_amount_lakh: null, add_devi_lakh: null, adj_lakh: 0, net_devi_lakh: net,
  };
  return storeParsedDsa({
    header: { week_no: 40, financial_year: '2025-26', week_start: '2025-12-29', week_end: '2026-01-04', issued_date: '2026-01-14', due_date: '2026-01-24' },
    entities: [
      { entity_name: entity, days: [{ entry_date: '2025-12-29', ...figures }], total: figures },
      { entity_name: 'SOME OTHER GENCO', days: [{ entry_date: '2025-12-29', ...figures, net_devi_lakh: 1.5, devi_amt_lakh: 1.5 }], total: { ...figures, net_devi_lakh: 1.5, devi_amt_lakh: 1.5 } },
    ],
    problems: [], warnings: [],
  }, { buffer: Buffer.from(body || `pdf-${Math.random()}`), sourceKind: 'ARCHIVE', weekCode: '291225-040126(WK-40)', createdBy: 'test' });
}

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM deviation_settlements').run();
  db.prepare('DELETE FROM nrpc_dsa_accounts').run();
  reia = tokenFor('REIA_USER');
  contract = makeContract({ project_type: 'Hydro', contract_no: 'PPA/SJVN/NJHPS/T1' });
});

describe('A week that was deleted', () => {
  it('can be entered again', async () => {
    // "Delete" only marks the row cancelled, and the slot is unique — so the
    // form answered "already exists, edit it" about a row nobody could edit.
    const first = await post('/api/deviation', manual());
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await del(`/api/deviation/${first.body.id}`)).status).toBe(200);

    const again = await post('/api/deviation', manual({ actual_mwh: 1100 }));
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.deviation_amount).toBe(35000);
    // The deleted one stays on record, under its own number.
    expect(db.prepare(`SELECT status FROM deviation_settlements ORDER BY created_at, rowid`).all().map((r) => r.status)).toEqual(['CANCELLED', 'CALCULATED']);
  });

  it('still refuses a second live entry for the same week', async () => {
    await post('/api/deviation', manual());
    const twin = await post('/api/deviation', manual());
    expect(twin.status).toBe(409);
    expect((await post('/api/deviation', manual({ entry_type: 'REVISED' }))).status).toBe(201);
  });

  it('is not brought back by an edit, and is not deleted twice', async () => {
    const row = (await post('/api/deviation', manual())).body;
    await del(`/api/deviation/${row.id}`);
    const edit = await put(`/api/deviation/${row.id}`, { notes: 'x' });
    expect(edit.status, 'an edit revived a deleted week').toBe(400);
    expect(db.prepare('SELECT status FROM deviation_settlements WHERE id = ?').get(row.id).status).toBe('CANCELLED');
    expect((await del(`/api/deviation/${row.id}`)).status).toBe(400);
  });

  it('holds a manual week to sane figures', async () => {
    expect((await post('/api/deviation', manual({ week_no: 60 }))).status).toBe(400);
    expect((await post('/api/deviation', manual({ scheduled_mwh: -5 }))).status).toBe(400);
    expect((await post('/api/deviation', manual({ period_month: '2026-13' }))).status).toBe(400);
    // ₹/MWh, not ₹/kWh.
    const rate = await post('/api/deviation', manual({ deviation_rate: 2 }));
    expect(rate.status).toBe(400);
    expect(rate.body.error).toMatch(/₹\/MWh/);
  });
});

describe('Raising a week from the statement', () => {
  it('shows the figure a row would carry before it is raised', async () => {
    const { account_id } = storeStatement();
    const a = (await get(`/api/nrpc-dsa/accounts/${account_id}`)).body;
    const nj = a.totals.find((t) => t.entity_name === 'NATHPA JHAKRI HEP');
    // −8.37312 Rs Lakh received on the statement is +8,37,312 recoverable here.
    expect(nj).toMatchObject({ settled_lakh: -8.37312, settlement_rupees: 837312, schedule_mwh: 51107, actual_mwh: 51720.474, sjvn_station: true });
    expect(a.totals.find((t) => t.entity_name === 'SOME OTHER GENCO')).toMatchObject({ settlement_rupees: -150000, sjvn_station: false });
    expect(a.raised).toEqual([]);
    // Whether "View source" will open: the stored file, not just a recorded path.
    expect(typeof a.has_pdf).toBe('boolean');
  });

  it('records the published figure, says so when asked twice, and lists it against the statement', async () => {
    const { account_id } = storeStatement();
    const body = { contract_id: contract.id, dsa_account_id: account_id, entity_name: 'NATHPA JHAKRI HEP' };
    const made = await post('/api/deviation/from-dsa', body);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({ deviation_amount: 837312, status: 'CALCULATED', is_estimate: false });

    const twice = await post('/api/deviation/from-dsa', body);
    expect(twice.status).toBe(409);
    expect(twice.body.error).toMatch(/already raised/);

    const a = (await get(`/api/nrpc-dsa/accounts/${account_id}`)).body;
    expect(a.raised).toHaveLength(1);
    expect(a.raised[0]).toMatchObject({ dsm_no: made.body.dsm_no, contract_id: contract.id });
  });

  it('takes the place of a deleted row for that week, and tells an estimate to make way', async () => {
    const { account_id } = storeStatement();
    const body = { contract_id: contract.id, dsa_account_id: account_id, entity_name: 'NATHPA JHAKRI HEP' };
    const estimate = (await post('/api/deviation', manual({ period_month: '2025-12', week_no: 40 }))).body;
    const blocked = await post('/api/deviation/from-dsa', body);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/manual estimate/);

    await del(`/api/deviation/${estimate.id}`);
    expect((await post('/api/deviation/from-dsa', body)).status).toBe(201);
  });

  it("lets an official row's notes be saved, and still not its figures", async () => {
    // The screen sent the whole form back, figures included, so saving a note
    // was refused every time.
    const { account_id } = storeStatement();
    const row = (await post('/api/deviation/from-dsa', { contract_id: contract.id, dsa_account_id: account_id, entity_name: 'NATHPA JHAKRI HEP' })).body;
    const notes = await put(`/api/deviation/${row.id}`, { notes: 'checked against the PDF', plant_code: '001' });
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    expect(notes.body).toMatchObject({ notes: 'checked against the PDF', deviation_amount: 837312 });
    expect((await put(`/api/deviation/${row.id}`, { actual_mwh: 1 })).status).toBe(400);
  });
});

describe('What the first end-to-end run found', () => {
  it("does not raise another station's section on a station's contract", async () => {
    const { account_id } = storeStatement();
    const wrong = await post('/api/deviation/from-dsa', { contract_id: contract.id, dsa_account_id: account_id, entity_name: 'SOME OTHER GENCO' });
    expect(wrong.status, "another company's week was raised on Nathpa Jhakri's contract").toBe(400);
    expect(wrong.body.error).toMatch(/NATHPA JHAKRI HEP on the statement/);
    const plain = makeContract({ contract_no: 'PPA/SJVN/SUNRISE/T9' });
    expect((await post('/api/deviation/from-dsa', { contract_id: plain.id, dsa_account_id: account_id, entity_name: 'NATHPA JHAKRI HEP' })).status).toBe(400);
    const ok = await post('/api/deviation/from-dsa', { contract_id: contract.id, dsa_account_id: account_id, entity_name: 'NATHPA JHAKRI HEP' });
    expect(ok.status).toBe(201);
    expect(ok.body.plant_code).toBe('001');
  });

  it('bills a week in one step, leaves it where it was when refused, and says which way the money moves', async () => {
    const { account_id } = storeStatement();
    const row = (await post('/api/deviation/from-dsa', { contract_id: contract.id, dsa_account_id: account_id, entity_name: 'NATHPA JHAKRI HEP' })).body;
    db.prepare(`INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh, tariff_per_unit, energy_charges, total_amount, status)
      VALUES ('INV-TAKEN2', 'DSM-TAKEN/2', ?, 'FINAL', 'SELLER_TO_SJVN', '2025-12', 1, 1, 1, 1, 'DRAFT')`).run(contract.id);
    expect((await post(`/api/deviation/${row.id}/dispatch`, { invoice_no: 'DSM-TAKEN/2' })).status).toBe(409);
    expect(db.prepare('SELECT status FROM deviation_settlements WHERE id = ?').get(row.id).status, 'a refused bill moved the week on').toBe('CALCULATED');
    const done = await post(`/api/deviation/${row.id}/dispatch`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const lines = JSON.parse(db.prepare('SELECT invoice_breakdown_json j FROM invoices WHERE id = ?').get(done.body.invoice_id).j);
    expect(lines.find((l) => l.code === 'FLOW').label).toMatch(/Recoverable by SJVN — received from the NRPC deviation pool/);
  });
});

describe('The supplementary bill a week becomes', () => {
  const raised = async () => {
    const { account_id } = storeStatement();
    return (await post('/api/deviation/from-dsa', { contract_id: contract.id, dsa_account_id: account_id, entity_name: 'NATHPA JHAKRI HEP' })).body;
  };

  it('is a draft that names who raised it and says its energy is energy', async () => {
    const maker = makeUser('REIA_USER', { name: 'DSM Maker' });
    const who = signToken(maker);
    const row = await raised();
    await post(`/api/deviation/${row.id}/submit`, {}, who);
    const done = await post(`/api/deviation/${row.id}/dispatch`, { dispatch_date: '2026-10-06' }, who);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('DISPATCHED');

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(done.body.invoice_id);
    expect(inv).toMatchObject({ invoice_type: 'SUPPLEMENTARY', status: 'DRAFT', total_amount: 837312, created_by_id: maker.id });
    const lines = JSON.parse(inv.invoice_breakdown_json);
    expect(lines.find((l) => l.code === 'SCH')).toMatchObject({ value: 51107, format: 'mwh' });
    expect(lines.find((l) => l.code === 'DEV').format).toBe('mwh');

    // And the maker cannot be the one to approve it.
    await post(`/api/invoices/${inv.id}/submit-for-approval`, {}, who);
    expect((await post(`/api/invoices/${inv.id}/approvals/1/act`, { decision: 'APPROVED' }, who)).status).toBe(403);
  });

  it('answers a bill number already in use in words', async () => {
    const row = await raised();
    db.prepare(`INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh, tariff_per_unit, energy_charges, total_amount, status)
      VALUES ('INV-TAKEN', 'DSM-TAKEN/1', ?, 'FINAL', 'SELLER_TO_SJVN', '2025-12', 1, 1, 1, 1, 'DRAFT')`).run(contract.id);
    const r = await post(`/api/deviation/${row.id}/dispatch`, { invoice_no: 'DSM-TAKEN/1' });
    expect(r.status, 'a duplicate bill number came back as a server error').toBe(409);
    expect(r.body.error).toMatch(/already on record/);
    expect(db.prepare('SELECT status FROM deviation_settlements WHERE id = ?').get(row.id).status).toBe('CALCULATED');
  });

  it('is never raised from an estimate', async () => {
    const est = (await post('/api/deviation', manual())).body;
    const r = await post(`/api/deviation/${est.id}/dispatch`, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/manual estimate/);
  });
});
