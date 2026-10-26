import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, makeUser, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// Batch 1 (17-Oct-2026): S1 requirement vs held, S4 LC reinstatement, S5
// release checklist, D1 dispute impact, D3 Finance note queue, G4 duplicate
// reading, G1 contract-year CUF tracker.

let reia, checker, approver, finance, sellerCo, buyerCo, psa, ppa;
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const instrument = (contract, over = {}) => {
  const id = newId('PSC');
  const r = { id, contract_id: contract.id, mechanism_type: 'LC', instrument_no: `PS/T/${id.slice(-6)}`, limit_amount: 1000000, utilized_amount: 0,
    issue_date: day(-30), validity_start: day(-30), validity_end: day(300), status: 'ACTIVE', is_revolving: 1, verified_at: day(-29), ...over };
  const keys = Object.keys(r);
  db.prepare(`INSERT INTO payment_security (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => r[k]));
  return db.prepare('SELECT * FROM payment_security WHERE id = ?').get(id);
};

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  // Phase B.2: the checker validates, locks and decides releases; the approver decides disputes.
  checker = tokenFor('REIA_CHECKER');
  approver = tokenFor('REIA_APPROVER');
  finance = tokenFor('FINANCE_USER');
  sellerCo = makeEntity('SELLER');
  buyerCo = makeEntity('BUYER');
  ppa = makeContract({ contract_type: 'PPA', seller_id: sellerCo.id, buyer_id: buyerCo.id, capacity_mw: 10, tariff_per_unit: 3, project_type: 'Solar', min_cuf_percent: 20, tenure_start: '2026-04-01', tenure_end: '2051-03-31' });
  psa = makeContract({ contract_type: 'PSA', seller_id: sellerCo.id, buyer_id: buyerCo.id });
});

describe('S1 requirement vs held', () => {
  it('shows each head\'s gap and asks the paying side for it', async () => {
    db.prepare(`INSERT INTO security_requirements (id, contract_id, mechanism_type, min_amount, months_cover) VALUES (?, ?, 'LC', 3000000, 0)`).run(newId('SRQ'), psa.id);
    instrument(psa, { limit_amount: 1000000 });
    const board = (await get('/api/payment-security/board')).body;
    const row = board.rows.find((r) => r.contract_id === psa.id);
    expect(row.paying_side).toBe('BUYER');
    expect(row.heads.find((h) => h.head === 'LC')).toMatchObject({ required: 3000000, held: 1000000, gap: 2000000 });
    const buyer = makeUser('BUYER', { linked_entity_id: buyerCo.id });
    const r = await post(`/api/payment-security/board/${psa.id}/request`, { note: 'by month end' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(db.prepare('SELECT message FROM notifications WHERE user_id = ?').all(buyer.id).map((n) => n.message).join(' ')).toMatch(/Letter of credit: ₹20,00,000 short/);
    expect(r.body.row.last_requested).toBeTruthy();
  });
});

describe('S4 reinstatement tracker', () => {
  it('flags a revolving LC not restored within the period, once', async () => {
    const lc = instrument(psa, { utilized_amount: 300000, status: 'PARTIALLY_UTILIZED' });
    db.prepare(`INSERT INTO security_events (id, payment_security_id, contract_id, actor_name, event_type, created_at) VALUES (?, ?, ?, 'x', 'UTILIZE', datetime('now', '-10 days'))`).run(newId('SEV'), lc.id, psa.id);
    const t = (await get('/api/payment-security/reinstatements')).body;
    expect(t.rows.find((r) => r.id === lc.id)).toMatchObject({ kind: 'BUYER_LC', drawn: 300000, days_since_draw: 10, overdue: true });
    const first = (await post('/api/payment-security/alerts/run')).body;
    expect(first.late_reinstatements).toBe(1);
    expect((await post('/api/payment-security/alerts/run')).body.late_reinstatements).toBe(0);
  });
});

describe('S5 release checklist', () => {
  it('lists each item, and Finance signs off before the desk releases', async () => {
    const ps = instrument(psa);
    const buyer = signToken(makeUser('BUYER', { linked_entity_id: buyerCo.id }));
    const rel = (await post(`/api/payment-security/${ps.id}/release-request`, { reason: 'PSA has run its term' }, buyer)).body;
    let q = (await get('/api/payment-security/releases')).body.find((r) => r.id === rel.id);
    expect(q.checklist.items.map((i) => i.key)).toEqual(['TERM', 'NO_DUES', 'NO_DISPUTES', 'REPLACEMENT', 'FINANCE']);
    expect(q.checklist.ready).toBe(false);
    db.prepare(`UPDATE contracts SET status = 'EXPIRED' WHERE id = ?`).run(psa.id);
    expect((await post(`/api/payment-security/releases/${rel.id}/finance-signoff`, {}, finance)).status).toBe(200);
    q = (await get('/api/payment-security/releases')).body.find((r) => r.id === rel.id);
    expect(q.checklist.ready).toBe(true);
    expect((await post(`/api/payment-security/releases/${rel.id}/act`, { decision: 'APPROVED' }, checker)).status).toBe(200);
  });
});

describe('D1 and D3 disputes', () => {
  it('shows a bill\'s dispute impact, and puts the dispute\'s note in Finance\'s queue with its record', async () => {
    const inv = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 400000, energy_charges: 400000 });
    db.prepare(`UPDATE invoices SET issued_at = datetime('now') WHERE id = ?`).run(inv.id);
    const buyer = tokenFor('BUYER', { linked_entity_id: buyerCo.id });
    const d = (await post('/api/disputes', { invoice_id: inv.id, reason_code: 'TARIFF_RATE_ERROR', charge_line: 'energy_charges', disputed_amount: 50000, issue_description: 'rate applied is wrong' }, buyer)).body;
    db.prepare(`UPDATE disputes SET supporting_docs = ? WHERE id = ?`).run(JSON.stringify([{ filename: 'f1.pdf', original_name: 'PPA clause.pdf', uploaded_by: 'Buyer' }]), d.id);
    let detail = (await get(`/api/invoices/${inv.id}`)).body;
    expect(detail.dispute_impact).toMatchObject({ held: 50000 });
    expect(detail.dispute_impact.open_disputes[0].dispute_no).toBe(d.dispute_no);

    expect((await post(`/api/disputes/${d.id}/resolve`, { outcome: 'PARTIAL_CREDIT', accepted_amount: 20000, resolution_notes: 'Tariff schedule supports part of the claim' }, approver)).status).toBe(200);
    detail = (await get(`/api/invoices/${inv.id}`)).body;
    expect(detail.dispute_impact.pending_credit).toBe(20000);

    const queue = (await get('/api/notes/approval-queue', finance)).body;
    const item = queue.find((n) => n.invoice_no === inv.invoice_no);
    expect(item).toMatchObject({ source: 'DISPUTE', can_approve: true });
    expect(item.dispute).toMatchObject({ dispute_no: d.dispute_no, resolution_notes: 'Tariff schedule supports part of the claim' });
    expect(item.dispute.evidence[0]).toMatchObject({ name: 'PPA clause.pdf' });
  });
});

describe('G4 duplicate reading', () => {
  it('flags a month equal to the last one, and will not lock it without a reason', async () => {
    const row = (period, mwh, status) => {
      const id = newId('ENG');
      db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, ?, 'FINAL', 'SEA', ?, ?)`).run(id, ppa.id, period, mwh, status);
      return id;
    };
    row('2026-07', 1460.25, 'LOCKED');
    const aug = row('2026-08', 1460.25, 'DRAFT');
    const v = (await post(`/api/energy-data/${aug}/validate`, {}, checker)).body;
    expect(v.status).toBe('DISPUTED');
    expect(v.deviation_notes).toMatch(/Same as 2026-07 to the decimal/);
    const lock = await post(`/api/energy-data/${aug}/lock`, {}, checker);
    expect(lock.status).toBe(400);
    expect(lock.body.error).toMatch(/exactly 2026-07's figure/);
    expect((await post(`/api/energy-data/${aug}/lock`, { override_reason: 'Confirmed with the SLDC: identical by coincidence' }, checker)).status).toBe(200);
  });
});

describe('G1 contract-year CUF tracker', () => {
  it('says what the rest of the year must average and what the run-rate would cost', async () => {
    // 10 MW: April 2026 at 10% CUF (720 MWh of 7,200 possible); minimum 20%.
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-04', 'FINAL', 'SEA', 720, 'LOCKED')`).run(newId('ENG'), ppa.id);
    const t = (await get(`/api/reports/cuf-tracker?contract_id=${ppa.id}`)).body;
    const r = t.rows[0];
    expect(r).toMatchObject({ contract_year: 1, min_cuf: 20 });
    expect(r.cuf_ytd).toBeGreaterThan(0);
    expect(r.needed_cuf_rest_of_year).toBeGreaterThan(20);
    expect(['AT_RISK', 'CANNOT_MEET']).toContain(r.state);
    expect(r.projected_shortfall_mwh).toBeGreaterThan(0);
    expect(r.projected_compensation).toBeGreaterThan(0);
  });
});
