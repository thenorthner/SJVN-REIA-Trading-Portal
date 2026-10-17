import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, makeUser, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { invoiceLpsAsOf } from '../../src/services/invoiceLps.js';
import { runSlaEscalations } from '../../src/routes/disputes.js';

// Batch 2 (17-Oct-2026): the note engine (R4, V4), the month-close board
// (R1, L2), the developer release planner (PM4), LPS bills (PM5) and
// deemed acceptance of an unanswered dispute resolution (D2).

let reia, finance, sellerCo, buyerCo, ppa, psa;
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const lock = (contract, period, mwh) => db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, ?, 'FINAL', 'SEA', ?, 'LOCKED')`).run(newId('ENG'), contract.id, period, mwh);
const ALL_CLEAR = [
  { key: 'REA_UPLOADED', status: 'VERIFIED' }, { key: 'ENERGY_VERIFIED', status: 'VERIFIED' },
  { key: 'TARIFF_VERIFIED', status: 'VERIFIED' }, { key: 'CAPACITY_VERIFIED', status: 'VERIFIED' },
  { key: 'CUF_COMPLIANCE', status: 'VERIFIED' }, { key: 'COD_COMPLIANCE', status: 'VERIFIED' },
  { key: 'CURTAILMENT_CHECKED', status: 'NA' }, { key: 'CHANGE_IN_LAW_VERIFIED', status: 'NA' },
];

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');
  sellerCo = makeEntity('SELLER');
  buyerCo = makeEntity('BUYER');
  ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.88, seller_id: sellerCo.id, buyer_id: buyerCo.id, cod_date: '2024-01-01', tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
  psa = makeContract({ contract_type: 'PSA', seller_id: sellerCo.id, buyer_id: buyerCo.id, tariff_per_unit: 2.95, trading_margin_per_mwh: 70, tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2024-01-01')`).run(newId('ALC'), ppa.id, psa.id);
});

describe('Note engine', () => {
  it('V4: drafts the verifier\'s damages as a note once, and the note closes the verification gap', async () => {
    lock(ppa, '2026-08', 8200);
    const seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
    const inv = (await post('/api/invoices', { contract_id: ppa.id, billing_period: '2026-08', invoice_type: 'FINAL', energy_mwh: 8200, tariff_per_unit: 2.88, energy_charges: 23616000 }, seller)).body;
    await post(`/api/invoices/${inv.id}/submit-for-approval`);
    const v = (await post(`/api/invoices/${inv.id}/verification`, { technical: ALL_CLEAR, commercial: { liquidated_damages: 150000 } })).body;
    expect(v.verification_status).toBe('FAILED');
    const note = await post('/api/notes/from-exception', { kind: 'VERIFICATION_LD', invoice_id: inv.id });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect(note.body).toMatchObject({ note_type: 'CREDIT', amount: 150000, status: 'DRAFT', source_kind: 'VERIFICATION_LD' });
    expect((await post('/api/notes/from-exception', { kind: 'VERIFICATION_LD', invoice_id: inv.id })).status).toBe(409);
    const again = (await get(`/api/invoices/${inv.id}/verification`)).body;
    expect(again.commercial_gap).toBe(0);
    const q = (await get('/api/notes/approval-queue', finance)).body;
    expect(q.find((n) => n.id === note.body.id).source).toBe('VERIFICATION_LD');
  });

  it('R4: drafts an accepted reconciliation exception into a note, once', async () => {
    const bill = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-08', total_amount: 500000 });
    const rid = newId('RCN');
    db.prepare(`INSERT INTO reconciliations (id, recon_no, scope, contract_id, period, period_type, status, counterparty_role) VALUES (?, ?, 'REIA_CONTRACT', ?, '2026-08', 'MONTHLY', 'AGREED', 'BUYER')`).run(rid, `RCN/T/${rid.slice(-4)}`, psa.id);
    const xid = newId('RXC');
    db.prepare(`INSERT INTO recon_exceptions (id, reconciliation_id, label, amount, reason, status) VALUES (?, ?, 'Energy short-billed', 25000, 'JMR differs', 'ACCEPTED')`).run(xid, rid);
    const note = await post('/api/notes/from-exception', { kind: 'RECON_EXCEPTION', exception_id: xid });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect(note.body).toMatchObject({ note_type: 'CREDIT', amount: 25000, invoice_id: bill.id });
    expect(db.prepare('SELECT note_id FROM recon_exceptions WHERE id = ?').get(xid).note_id).toBe(note.body.id);
    expect((await post('/api/notes/from-exception', { kind: 'RECON_EXCEPTION', exception_id: xid })).status).toBe(409);
  });
});

describe('Month-close board', () => {
  it('R1: will not reconcile a month without its bill, and says what it waits on', async () => {
    lock(ppa, '2026-08', 8200);
    const r = await post('/api/reconciliation/run', { contract_id: ppa.id, period: '2026-08', scope: 'REIA_CONTRACT' });
    expect(r.status).toBe(400);
    expect(r.body.missing).toEqual(['no bill has been presented']);
    const board = (await get('/api/invoices/month-close?period_month=2026-08')).body;
    const row = board.reconciliation.rows.find((x) => x.contract_id === ppa.id);
    expect(row).toMatchObject({ ready: false, missing: ['no bill has been presented'] });
  });

  it('L2: lists the open items before the month is booked', async () => {
    lock(ppa, '2026-08', 8200);
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'UNDER_APPROVAL', billing_period: '2026-08', total_amount: 700000, invoice_breakdown_json: '[{"code":"TOTAL"}]' });
    const c = (await get('/api/reia-fi/checklist?period_month=2026-08', finance)).body;
    const item = (k) => c.items.find((i) => i.key === k);
    expect(c.clear).toBe(false);
    expect(item('BILLS_IN_APPROVAL')).toMatchObject({ count: 1, amount: 700000 });
    expect(item('ENERGY_UNBILLED').count).toBe(1); // the PPA's locked month, not billed
    expect(item('OPEN_DISPUTES').clear).toBe(true);
  });
});

describe('PM4 developer release planner', () => {
  it('shows what the buyer has paid that is the generator\'s, and what can go out now', async () => {
    db.prepare('UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?').run(sellerCo.id);
    const dev = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-08', energy_charges: 2880000, total_amount: 2880000, due_date: '2026-10-30' });
    const psaBill = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'PARTIALLY_PAID', billing_period: '2026-08', energy_charges: 2880000, trading_margin: 70000, total_amount: 2950000 });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, 1475000, '2026-09-20', 'NEFT')`).run(newId('PAY'), psaBill.id);
    const p = (await get('/api/invoices/release-planner', finance)).body;
    const row = p.rows.find((r) => r.invoice_id === dev.id);
    // Half the PSA bill paid; the generator's part of it is energy ÷ total.
    expect(row.realized).toBe(Math.round(1475000 * 2880000 / 2950000));
    expect(row.releasable_now).toBe(row.realized);
  });
});

describe('PM5 LPS bills', () => {
  it('bills a month\'s surcharge once, nets it off the source bill, and gives it back on cancel', async () => {
    const overdue = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-06', total_amount: 1000000, energy_charges: 1000000, due_date: '2026-07-31' });
    const preview = (await get('/api/invoices/lps-bills/preview?period_month=2026-09')).body;
    const row = preview.rows.find((r) => r.contract_id === psa.id);
    expect(row.total).toBeGreaterThan(0);
    const before = invoiceLpsAsOf(db.prepare('SELECT * FROM invoices WHERE id = ?').get(overdue.id), new Date('2026-09-30T18:00:00Z')).lps;
    const r = await post('/api/invoices/lps-bills', { period_month: '2026-09' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const lpsBill = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.body.raised[0].invoice_id);
    expect(lpsBill.invoice_no).toMatch(/^LPS-PSA\//);
    expect(lpsBill.total_amount).toBe(row.total);
    const src = db.prepare('SELECT * FROM invoices WHERE id = ?').get(overdue.id);
    expect(src.lps_invoiced).toBe(row.total);
    expect(invoiceLpsAsOf(src, new Date('2026-09-30T18:00:00Z')).lps).toBeCloseTo(before - row.total, 1);
    expect(invoiceLpsAsOf(lpsBill, new Date('2027-09-30')).lps).toBe(0);
    expect((await post('/api/invoices/lps-bills', { period_month: '2026-09' })).status).toBe(400);
    expect((await post(`/api/invoices/${lpsBill.id}/cancel`, { reason: 'raised in error' })).status).toBe(200);
    expect(db.prepare('SELECT lps_invoiced FROM invoices WHERE id = ?').get(overdue.id).lps_invoiced).toBe(0);
  });
});

describe('D2 deemed acceptance', () => {
  it('closes a resolution the party let stand past the window', async () => {
    const inv = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 400000, energy_charges: 400000 });
    const id = newId('DIS');
    db.prepare(`INSERT INTO disputes (id, dispute_no, invoice_id, raised_by_role, reason_code, charge_line, issue_description, disputed_amount, status, resolution_outcome, resolved_at)
      VALUES (?, 'DSP/T/1', ?, 'BUYER', 'TARIFF_RATE_ERROR', 'energy_charges', 'x', 10000, 'RESOLVED_REJECTED', 'REJECTED', datetime('now', '-20 days'))`).run(id, inv.id);
    const fresh = newId('DIS');
    db.prepare(`INSERT INTO disputes (id, dispute_no, invoice_id, raised_by_role, reason_code, charge_line, issue_description, disputed_amount, status, resolution_outcome, resolved_at)
      VALUES (?, 'DSP/T/2', ?, 'BUYER', 'TARIFF_RATE_ERROR', 'energy_charges', 'x', 10000, 'RESOLVED_REJECTED', 'REJECTED', datetime('now', '-3 days'))`).run(fresh, inv.id);
    expect(runSlaEscalations().deemed_accepted).toBe(1);
    expect(db.prepare('SELECT status, resolution_response, resolution_response_by FROM disputes WHERE id = ?').get(id)).toMatchObject({ status: 'CLOSED', resolution_response: 'ACCEPTED' });
    expect(db.prepare('SELECT resolution_response_by FROM disputes WHERE id = ?').get(id).resolution_response_by).toMatch(/Deemed accepted/);
    expect(db.prepare('SELECT status FROM disputes WHERE id = ?').get(fresh).status).toBe('RESOLVED_REJECTED');
  });
});
