import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser } from '../helpers/reia.js';
import { insertDoc } from '../../src/services/hydroLedger.js';
import { raiseNote, approveNote } from '../../src/services/hydroNotes.js';

// Hydro QA run 14, follow-up (18-Oct-2026): approved debit and credit notes were
// never handed to Finance, so Finance's sale stood overstated by every credit
// note. They book under a NOTES category of their own.

let desk, contract, maker, checker;
const TABLES = ['hydro_fi_posting_lines', 'hydro_fi_postings', 'hydro_notes', 'hydro_ledger_clearings', 'hydro_ledger_docs'];

beforeEach(() => {
  for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
  contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  desk = tokenFor('COMMERCIAL_ADMIN');
  maker = makeUser('COMMERCIAL', { name: 'H14b Maker' });
  checker = makeUser('COMMERCIAL_ADMIN', { name: 'H14b Checker' });
  // The account a note sits on.
  insertDoc({
    doc_no: `PB/H14B/${Math.random().toString(36).slice(2, 8)}`, contract_id: contract.id, beneficiary_name: 'QA STATE',
    doc_type: 'PB', amount: 1000000, doc_date: '2026-06-05', due_date: '2026-07-05',
  });
});
afterAll(() => { for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run(); });

const post = (url, token, body) => request(app).post(url).set(auth(token)).send(body);
const get = (url, token) => request(app).get(url).set(auth(token));

function note(type, amount, { approve = true, date = '2026-06-20' } = {}) {
  const n = raiseNote({
    contract_id: contract.id, beneficiary_name: 'QA STATE', note_type: type, reason: 'BILLING_ERROR',
    remarks: 'H14b note for the FI handover', amount, note_date: date,
  }, maker);
  return approve ? approveNote(n.id, checker).note : n;
}
const prepare = () => post('/api/hydro-billing/fi/prepare', desk, { contract_id: contract.id, period_month: '2026-06', bill_category: 'NOTES' });
const bookable = () => get(`/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=2026-06&bill_category=NOTES`, desk);

describe('What Finance books for notes', () => {
  it('offers NOTES as a category', async () => {
    const r = await get(`/api/hydro-billing/fi?contract_id=${contract.id}`, desk);
    expect(r.body.categories.map((c) => c.value)).toContain('NOTES');
  });

  it('books a credit note as a negative sale and a debit note as a positive one', async () => {
    note('CREDIT', 30000);
    note('DEBIT', 12000);
    const r = await bookable();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.bills.map((b) => [b.bill_kind, b.sale_amount])).toEqual([['CREDIT_NOTE', -30000], ['DEBIT_NOTE', 12000]]);
    expect(r.body.totals).toMatchObject({ bills_count: 2, sale_amount: -18000, nrldc_amount: 0, tcs_amount: 0, total_amount: -18000 });

    const p = await prepare();
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ bill_category: 'NOTES', bills_count: 2, sale_amount: -18000, total_amount: -18000 });
    expect(p.body.lines.every((l) => l.note_id && l.bill_id === null)).toBe(true);
  });

  it('leaves out drafts and notes dated in another month', async () => {
    note('CREDIT', 5000, { approve: false });
    note('CREDIT', 7000, { date: '2026-07-02' });
    const r = await bookable();
    expect(r.body.bills).toHaveLength(0);
    expect((await prepare()).status).toBe(400);
  });

  it('a note on a live posting is not offered again; a later one books after the month was posted', async () => {
    note('CREDIT', 30000);
    const p = await prepare();
    expect((await bookable()).body.bills).toHaveLength(0);
    expect((await post(`/api/hydro-billing/fi/${p.body.id}/post`, desk, { fi_document_no: 'VCH-H14B-1' })).status).toBe(200);
    expect((await prepare()).status).toBe(409);
    note('DEBIT', 4000);
    const late = await prepare();
    expect(late.status, JSON.stringify(late.body)).toBe(200);
    expect(late.body.lines.map((l) => [l.bill_kind, l.sale_amount])).toEqual([['DEBIT_NOTE', 4000]]);
  });

  it('reversing a posting frees its notes', async () => {
    note('CREDIT', 30000);
    const p = await prepare();
    await post(`/api/hydro-billing/fi/${p.body.id}/post`, desk, { fi_document_no: 'VCH-H14B-2' });
    const rev = await post(`/api/hydro-billing/fi/${p.body.id}/reverse`, desk, { reason: 'wrong voucher' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    const reversal = db.prepare('SELECT * FROM hydro_fi_postings WHERE id = ?').get(rev.body.reversal_id);
    expect(reversal).toMatchObject({ bill_category: 'NOTES', sale_amount: 30000 });
    expect((await bookable()).body.bills).toHaveLength(1);
    expect((await prepare()).status).toBe(200);
  });

  it('bills and notes stay apart: a HYDRO posting books no notes', async () => {
    note('CREDIT', 30000);
    const r = await get(`/api/hydro-billing/fi/bookable?contract_id=${contract.id}&period_month=2026-06`, desk);
    expect(r.body.bills).toHaveLength(0);
  });
});

describe('A note handed to Finance', () => {
  it('cannot be withdrawn or rejected until its posting is reversed', async () => {
    // Only a draft can be withdrawn today, so put a draft on a posting by hand
    // to prove the guard holds whatever the note's state.
    const n = note('CREDIT', 30000, { approve: false });
    db.prepare(`INSERT INTO hydro_fi_postings (id, posting_no, contract_id, station_name, period_month, bill_category, status)
      VALUES ('HFP-H14B-X', 'FI/H14B/NOTES/1', ?, 'X', '2026-06', 'NOTES', 'POSTED')`).run(contract.id);
    db.prepare(`INSERT INTO hydro_fi_posting_lines (id, posting_id, note_id, bill_no, bill_kind, sale_amount, total_amount)
      VALUES ('HFL-H14B-X', 'HFP-H14B-X', ?, ?, 'CREDIT_NOTE', -30000, -30000)`).run(n.id, n.note_no);

    const r = await post(`/api/hydro-billing/notes/${n.id}/reject`, desk, { reason: 'raised in error' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/FI\/H14B\/NOTES\/1.*Reverse that posting first/);
    expect(db.prepare('SELECT status FROM hydro_notes WHERE id = ?').get(n.id).status).toBe('DRAFT');

    db.prepare(`UPDATE hydro_fi_postings SET status = 'REVERSED' WHERE id = 'HFP-H14B-X'`).run();
    expect((await post(`/api/hydro-billing/notes/${n.id}/reject`, desk, { reason: 'raised in error' })).status).toBe(200);
  });

  it('a posting whose note is no longer approved cannot be posted', async () => {
    const n = note('CREDIT', 30000);
    const p = await prepare();
    db.prepare(`UPDATE hydro_notes SET status = 'CANCELLED' WHERE id = ?`).run(n.id);
    const r = await post(`/api/hydro-billing/fi/${p.body.id}/post`, desk, { fi_document_no: 'VCH-H14B-3' });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain(n.note_no);
  });

  it('a line points at a bill or a note, never both or neither', () => {
    db.prepare(`INSERT INTO hydro_fi_postings (id, posting_no, contract_id, station_name, period_month, bill_category)
      VALUES ('HFP-H14B-Y', 'FI/H14B/NOTES/2', ?, 'X', '2026-06', 'NOTES')`).run(contract.id);
    expect(() => db.prepare(`INSERT INTO hydro_fi_posting_lines (id, posting_id, bill_no, bill_kind)
      VALUES ('HFL-H14B-Y', 'HFP-H14B-Y', 'X', 'CREDIT_NOTE')`).run()).toThrow(/CHECK/);
  });
});
