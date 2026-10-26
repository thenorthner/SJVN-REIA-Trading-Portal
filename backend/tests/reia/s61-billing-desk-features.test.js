import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { invalidateParamCache } from '../../src/mastersService.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

// Billing desk features B1–B5 (17-Oct-2026): back-to-back card, notes from a
// refusal, band roles with real signers, advances beside a bill, readiness board.

let reia, finance, sellerCo, buyerCo, ppa, psa;
const P = '2026-08';
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const lockEnergy = (contractId, mwh = 1000, type = 'FINAL', period = P) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
  VALUES (?, ?, ?, ?, 'SEA', ?, 'LOCKED')
`).run(newId('ENG'), contractId, period, type, mwh);
const setParam = (k, v) => { db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(v, k); invalidateParamCache(); };

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  finance = tokenFor('FINANCE_USER');
  sellerCo = makeEntity('SELLER');
  buyerCo = makeEntity('BUYER');
  ppa = makeContract({ contract_type: 'PPA', seller_id: sellerCo.id, buyer_id: buyerCo.id, capacity_mw: 50, tariff_per_unit: 2.88 });
  psa = makeContract({ contract_type: 'PSA', seller_id: sellerCo.id, buyer_id: buyerCo.id, capacity_mw: 50, tariff_per_unit: 2.95, trading_margin_per_mwh: 70 });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`).run(newId('ALC'), ppa.id, psa.id);
});

describe('B1 back-to-back on a PSA bill', () => {
  it('matches MWh, rate and margin against the PPA bill, and flags a double margin', async () => {
    lockEnergy(ppa.id, 1000);
    const psaBill = (await post('/api/invoices/generate', { contract_id: psa.id, period_month: P, invoice_type: 'FINAL' })).body;
    let b = (await get(`/api/invoices/${psaBill.id}/back-to-back`)).body;
    expect(b).toMatchObject({ applicable: true, state: 'INCOMPLETE' });
    expect(b.flags.join(' ')).toMatch(/no PPA bill/);

    const ppaBill = (await post('/api/invoices/generate', { contract_id: ppa.id, period_month: P, invoice_type: 'FINAL' })).body;
    expect(ppaBill.invoice_no).toBeTruthy();
    b = (await get(`/api/invoices/${psaBill.id}/back-to-back`)).body;
    expect(b.state, JSON.stringify(b.flags)).toBe('OK');
    expect(b.sources[0]).toMatchObject({ expected_mwh: 1000, psa_mwh: 1000, mwh_ok: true });
    expect(b.spread_per_mwh).toBe(70);

    // The margin charged twice: energy at the full PSA tariff plus the margin line.
    db.prepare('UPDATE invoices SET energy_charges = energy_charges + 70000, total_amount = total_amount + 70000 WHERE id = ?').run(psaBill.id);
    b = (await get(`/api/invoices/${psaBill.id}/back-to-back`)).body;
    expect(b.state).toBe('MISMATCH');
    expect(b.flags.join(' ')).toMatch(/Spread ₹140\/MWh is not the ₹70\/MWh margin/);
  });
});

describe('B2 a refused bill offers its note', () => {
  it('suggests a credit note on the provisional when the final comes in below what was paid', async () => {
    lockEnergy(ppa.id, 1000, 'PROVISIONAL');
    const prov = (await post('/api/invoices/generate', { contract_id: ppa.id, period_month: P, invoice_type: 'PROVISIONAL' })).body;
    db.prepare(`UPDATE invoices SET status = 'SENT' WHERE id = ?`).run(prov.id);
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, ?, '2026-09-10', 'NEFT')`).run(newId('PAY'), prov.id, prov.total_amount);
    lockEnergy(ppa.id, 800, 'FINAL');
    const r = await post('/api/invoices/generate', { contract_id: ppa.id, period_month: P, invoice_type: 'FINAL' });
    expect(r.status).toBe(400);
    expect(r.body.suggested_note).toMatchObject({ note_type: 'CREDIT', invoice_id: prov.id, amount: 200 * 2880 });
    // The suggestion is a valid note as it stands.
    const note = await post('/api/notes', r.body.suggested_note);
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect(note.body.status).toBe('DRAFT');
  });
});

describe('B3 band roles and the people who can sign', () => {
  it('takes the band\'s roles, and lists only real signers', async () => {
    setParam('invoice_approval_levels', JSON.stringify([{ above: 1000000, levels: 2, roles: { 1: ['REIA_ADMIN'], 2: ['FINANCE_USER'] } }, { above: 0, levels: 1 }]));
    try {
      const admin = makeUser('REIA_ADMIN', { name: 'Asha Admin' });
      makeUser('REIA_USER', { name: 'Ravi Ops' });
      lockEnergy(ppa.id, 1000);
      const bill = (await post('/api/invoices/generate', { contract_id: psa.id, period_month: P, invoice_type: 'FINAL' })).body;
      expect((await post(`/api/invoices/${bill.id}/submit-for-approval`)).status).toBe(200);
      const detail = (await get(`/api/invoices/${bill.id}`)).body;
      const l1 = detail.approvals.find((a) => a.level === 1);
      // A band saved with the old name is read as the role it became.
      expect(l1.approver_roles).toEqual(['REIA_CHECKER']);
      expect(l1.eligible_signers).toContain('Asha Admin');
      expect(l1.eligible_signers).not.toContain('Ravi Ops');
      const ops = await post(`/api/invoices/${bill.id}/approvals/1/act`, { decision: 'APPROVED', comments: 'ok', security_ack: 'cover tracked on the desk' }, tokenFor('REIA_USER', { name: 'Other Ops' }));
      expect(ops.status).toBe(403);
      // Phase B.2: a maker is no reviewer at all, so the route turns them away before the band is read.
      expect(ops.body.error).toMatch(/REIA_MAKER is not authorized/);
      const ok = await post(`/api/invoices/${bill.id}/approvals/1/act`, { decision: 'APPROVED', comments: 'ok', security_ack: 'cover tracked on the desk' }, signToken(admin));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    } finally {
      setParam('invoice_approval_levels', JSON.stringify([{ above: 1000000, levels: 3 }, { above: 100000, levels: 2 }]));
    }
  });
});

describe('B4 advances beside a bill', () => {
  it('shows the buyer\'s open advances on its open bill', async () => {
    lockEnergy(ppa.id, 1000);
    const bill = (await post('/api/invoices/generate', { contract_id: psa.id, period_month: P, invoice_type: 'FINAL' })).body;
    db.prepare(`UPDATE invoices SET status = 'SENT' WHERE id = ?`).run(bill.id);
    db.prepare(`INSERT INTO unapplied_receipts (id, receipt_no, entity_id, source, amount, balance, received_on) VALUES ('ADV-T1', 'ADV/T/1', ?, 'EXCESS_PAYMENT', 50000, 50000, '2026-09-01')`).run(buyerCo.id);
    const d = (await get(`/api/invoices/${bill.id}`, finance)).body;
    expect(d.advances).toMatchObject({ open_balance: 50000 });
    expect(d.advances.items[0].receipt_no).toBe('ADV/T/1');
  });
});

describe('B5 readiness board', () => {
  it('says what is ready, raises it in one go, and then reads billed', async () => {
    let board = (await get(`/api/invoices/readiness?period_month=${P}`)).body;
    const row = (id) => board.rows.find((r) => r.contract_id === id);
    expect(row(ppa.id).state).toBe('WAITING_ENERGY');
    expect(row(psa.id).state).toBe('WAITING_ENERGY');

    lockEnergy(ppa.id, 1000);
    board = (await get(`/api/invoices/readiness?period_month=${P}`)).body;
    expect(row(psa.id)).toMatchObject({ state: 'READY', ppa_bill_in: false });
    expect(row(psa.id).note).toMatch(/back-to-back/);

    const r = await post('/api/invoices/generate-ready', { period_month: P });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.raised.map((x) => x.contract_no).sort()).toEqual([ppa.contract_no, psa.contract_no].sort());
    board = (await get(`/api/invoices/readiness?period_month=${P}`)).body;
    expect(row(psa.id).state).toBe('BILLED');
    expect((await post('/api/invoices/generate-ready', { period_month: P })).status).toBe(400);
  });

  it('will not offer a month still running', async () => {
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const board = (await get(`/api/invoices/readiness?period_month=${thisMonth}`)).body;
    expect(board.month_open).toBe(true);
    expect(board.rows.every((r) => r.state !== 'READY')).toBe(true);
  });
});

describe('Own-station flag', () => {
  it('is an administrator\'s call, with a reason', async () => {
    const st = makeEntity('SELLER');
    expect((await post(`/api/entities/${st.id}/own-station`, { is_sjvn_own: true, reason: 'SJVN hydro station selling here' })).status).toBe(403);
    const admin = tokenFor('SJVN_ADMIN');
    // A REIA stakeholder is a third-party developer and can never be SJVN's own.
    expect((await post(`/api/entities/${st.id}/own-station`, { is_sjvn_own: true, reason: 'SJVN hydro station selling here' }, admin)).status).toBe(400);
    db.prepare(`UPDATE entities SET verticals = 'HYDRO' WHERE id = ?`).run(st.id);
    expect((await post(`/api/entities/${st.id}/own-station`, { is_sjvn_own: true, reason: 'short' }, admin)).status).toBe(400);
    const ok = await post(`/api/entities/${st.id}/own-station`, { is_sjvn_own: true, reason: 'SJVN hydro station selling here' }, admin);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(db.prepare('SELECT is_sjvn_own FROM entities WHERE id = ?').get(st.id).is_sjvn_own).toBe(1);
    expect((await post(`/api/entities/${buyerCo.id}/own-station`, { is_sjvn_own: true, reason: 'a buyer cannot be one' }, admin)).status).toBe(400);
  });
});
