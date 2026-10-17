import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, makeUser, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { invalidateParamCache } from '../../src/mastersService.js';
import { categoryWatch, alertCategoryWatch } from '../../src/services/cercAnnual.js';
import { runClearanceExpiry } from '../../src/services/clearanceExpiry.js';
import { cufYearPosition } from '../../src/services/cufPenalty.js';
import { remindHearings } from '../../src/routes/disputes.js';
import { refreshTotals } from '../../src/services/cercFormIv.js';

// Batch 4 (17-Oct-2026): CERC4 annual roll-up, CERC5 category watch, K2
// clearance expiry, K3 bank-change call-back, G2 curtailment in CUF, D5 forum
// tracker, PM2 statement of account, SM3 banking statement.

let reia;
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const day = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
const setParam = (k, v) => { db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(v, k); invalidateParamCache(); };

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
});

describe('CERC4 annual Form-IV roll-up', () => {
  const trading = () => tokenFor('TRADING_USER');
  const monthly = (period, status = 'SUBMITTED', mu = 1) => {
    const id = newId('FIV');
    db.prepare(`INSERT INTO cerc_form_iv (id, form_no, period_type, period, status, total_volume_mu) VALUES (?, ?, 'MONTHLY', ?, ?, ?)`).run(id, `T/${period}`, period, status, mu);
    db.prepare(`INSERT INTO cerc_form_iv_lines (id, form_id, line_no, seller_name, buyer_name, period_from, period_to, quantum_mu, purchase_rate, sale_rate, trading_margin_per_unit)
      VALUES (?, ?, 1, 'Gen Co', 'Discom', ?, ?, ?, 2.5, 2.54, 0.04)`).run(newId('FIL'), id, `${period}-01`, `${period}-28`, mu);
    refreshTotals(id);
    return id;
  };
  const FY_MONTHS = ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
  beforeEach(() => { db.prepare('DELETE FROM cerc_form_iv_lines').run(); db.prepare('DELETE FROM cerc_form_iv').run(); });

  it('refuses while a monthly is not filed, then builds the annual from all twelve', async () => {
    FY_MONTHS.forEach((p, i) => monthly(p, i === 11 ? 'DRAFT' : 'SUBMITTED'));
    const pos = (await get('/api/form-iv/annual/2025-26', trading())).body;
    expect(pos.ready).toBe(false);
    expect(pos.not_filed).toEqual(['2026-03']);
    const refused = await post('/api/form-iv/annual/2025-26/roll-up', {}, trading());
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/not yet filed: 2026-03/);

    db.prepare(`UPDATE cerc_form_iv SET status = 'SUBMITTED' WHERE period = '2026-03'`).run();
    const r = await post('/api/form-iv/annual/2025-26/roll-up', {}, trading());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.annual.line_count).toBe(12);
    expect(r.body.annual.total_volume_mu).toBeCloseTo(12, 4);
    expect(r.body.differences).toEqual([]);
  });
});

describe('CERC5 licence category watch', () => {
  beforeEach(() => { db.prepare('DELETE FROM cerc_form_iv_lines').run(); db.prepare('DELETE FROM cerc_form_iv').run(); });
  const fyStart = () => { const d = new Date(Date.now() + 5.5 * 3600 * 1000); return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };

  it('has nothing to watch until a limit is set, and warns once at 85%', () => {
    const y = fyStart();
    db.prepare(`INSERT INTO cerc_form_iv (id, form_no, period_type, period, status, total_volume_mu) VALUES (?, 'W/1', 'MONTHLY', ?, 'SUBMITTED', 90)`).run(newId('FIV'), `${y}-04`);
    setParam('cerc_licence_category_limit_mu', '');
    expect(categoryWatch().state).toBe('NO_LIMIT');
    setParam('cerc_licence_category_limit_mu', '100');
    const w = categoryWatch();
    expect(w).toMatchObject({ state: 'WARN', volume_mu: 90, pct_of_limit: 90 });
    expect(alertCategoryWatch().sent).toBe(1);
    expect(alertCategoryWatch().sent, 'the same state is told once a year').toBe(0);
    setParam('cerc_licence_category_limit_mu', '80');
    expect(categoryWatch().state).toBe('OVER');
    setParam('cerc_licence_category_limit_mu', '');
  });
});

describe('K2 clearance expiry', () => {
  const clearance = (entityId, validUntil, code) => {
    const id = newId('REG');
    db.prepare(`INSERT INTO entity_regulatory_approvals (id, entity_id, approval_code, label, is_mandatory, status, valid_until) VALUES (?, ?, ?, ?, 1, 'VERIFIED', ?)`).run(id, entityId, code, code, validUntil);
    return id;
  };

  it('reminds once per step and marks a lapsed clearance expired', async () => {
    const ent = makeEntity('SELLER');
    const soon = clearance(ent.id, day(25), 'QA_CONNECTIVITY');
    const gone = clearance(ent.id, day(-1), 'QA_LICENCE');
    const first = runClearanceExpiry();
    expect(first).toEqual({ expired: 1, reminded: 1 });
    expect(runClearanceExpiry(), 'the 30-day step is not repeated').toEqual({ expired: 0, reminded: 0 });
    expect(db.prepare('SELECT status FROM entity_regulatory_approvals WHERE id = ?').get(gone).status).toBe('EXPIRED');
    expect(db.prepare('SELECT days_left FROM clearance_alerts WHERE approval_id = ?').get(soon).days_left).toBe(25);
    const board = (await get('/api/entities/clearances/expiring?days=60')).body;
    expect(board.map((a) => a.id).sort()).toEqual([soon, gone].sort());
  });
});

describe('K3 bank-change call-back', () => {
  let ent;
  beforeEach(() => {
    ent = makeEntity('SELLER');
    db.prepare(`UPDATE entities SET status = 'APPROVED', is_penny_drop_verified = 1, corporate_phone = '+91 98765 43210',
      pending_bank_json = '{"account_no":"999988887777"}', pending_bank_requested_by = 'Maker', pending_bank_requested_at = datetime('now') WHERE id = ?`).run(ent.id);
  });

  it('takes only a number already on record', async () => {
    const r = await post(`/api/entities/${ent.id}/bank-callback`, { contact_name: 'CFO', phone: '9000000001', confirmed: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already on record/);
    const ok = await post(`/api/entities/${ent.id}/bank-callback`, { contact_name: 'CFO', phone: '9876543210', confirmed: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.confirmed).toBe(1);
    expect((await get(`/api/entities/${ent.id}/bank-callbacks`)).body).toHaveLength(1);
  });

  it('alerts the admins when the contact does not confirm, and verification stays blocked', async () => {
    await post(`/api/entities/${ent.id}/bank-callback`, { contact_name: 'CFO', phone: '9876543210', confirmed: false });
    expect(db.prepare(`SELECT COUNT(*) n FROM notifications WHERE type = 'BANK_CHANGE' AND message LIKE '%did NOT confirm%'`).get().n).toBeGreaterThan(0);
    const later = new Date(Date.now() + 2000).toISOString();
    db.prepare(`INSERT INTO entity_regulatory_approvals (id, entity_id, approval_code, label, is_mandatory, status, verified_at, reference_no)
      VALUES (?, ?, 'BANK_ACCOUNT_PROOF', 'Bank Account Proof', 1, 'VERIFIED', ?, 'CHQ-NEW')`).run(newId('REG'), ent.id, later);
    const v = await post(`/api/entities/${ent.id}/verify-bank`, {}, tokenFor('REIA_ADMIN'));
    expect(v.status).toBe(400);
    expect(v.body.needs_callback).toBe(true);
  });
});

describe('G2 certified curtailment in CUF', () => {
  it('takes certified hours out of the possible generation, and needs the SLDC reference', async () => {
    const ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', capacity_mw: 10, tariff_per_unit: 2.5, cod_date: '2024-04-01', tenure_start: '2024-04-01', tenure_end: '2049-03-31' });
    const id = newId('ENG');
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, deemed_generation_mwh, status) VALUES (?, ?, '2026-06', 'FINAL', 'SEA', 1500, 200, 'LOCKED')`).run(id, ppa.id);
    const before = cufYearPosition(ppa, '2026-06').months.find((m) => m.period === '2026-06');
    expect(before, JSON.stringify(before)).toMatchObject({ energy_mwh: 1700, possible_mwh: 7200 });

    expect((await post(`/api/energy-data/${id}/curtailment`, { hours: 100 })).status).toBe(400);
    expect((await post(`/api/energy-data/${id}/curtailment`, { hours: 721, reference: 'SLDC/CURT/2026/06' })).status).toBe(400);
    const r = await post(`/api/energy-data/${id}/curtailment`, { hours: 100, reference: 'SLDC/CURT/2026/06' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = cufYearPosition(ppa, '2026-06').months.find((m) => m.period === '2026-06');
    // Hours replace deemed generation for the month: not both.
    expect(after).toMatchObject({ energy_mwh: 1500, curtailment_hours: 100, possible_mwh: 6200 });
  });
});

describe('D5 forum tracker', () => {
  let dispute;
  beforeEach(() => {
    const psa = makeContract({ contract_type: 'PSA' });
    const inv = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 500000, energy_charges: 500000 });
    dispute = newId('DIS');
    db.prepare(`INSERT INTO disputes (id, dispute_no, invoice_id, raised_by_role, reason_code, charge_line, issue_description, disputed_amount, status, resolution_response, escalation_forum, contested_amount, escalated_at)
      VALUES (?, 'DSP/F/1', ?, 'BUYER', 'TARIFF_RATE_ERROR', 'energy_charges', 'x', 100000, 'RESOLVED_REJECTED', 'CONTESTED', 'CERC', 100000, datetime('now'))`).run(dispute, inv.id);
  });

  it('keeps the case, the hearings and the exposure, and reminds before a hearing', async () => {
    expect((await post(`/api/dispute-extras/${dispute}/forum`, { case_no: 'Petition 12/MP/2026', expected_exposure: 200000 })).status).toBe(400);
    const c = await post(`/api/dispute-extras/${dispute}/forum`, { case_no: 'Petition 12/MP/2026', filed_on: day(-10), expected_exposure: 60000 });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const h = await post(`/api/dispute-extras/${dispute}/hearings`, { hearing_date: day(-2), purpose: 'Admission', next_date: day(5) });
    expect(h.status, JSON.stringify(h.body)).toBeLessThan(300);
    const t = (await get('/api/dispute-extras/forum-tracker')).body;
    const row = t.rows.find((r) => r.id === dispute);
    expect(row).toMatchObject({ case_no: 'Petition 12/MP/2026', expected_exposure: 60000, next_hearing: day(5), days_to_hearing: 5, status: 'PENDING' });
    expect(row.hearings).toHaveLength(1);
    expect(t.totals).toMatchObject({ pending: 1, exposure: 60000, hearings_in_7_days: 1 });
    expect(remindHearings().sent).toBe(1);
    expect(remindHearings().sent, 'once per step').toBe(0);
  });
});

describe('PM2 statement of account', () => {
  it("keeps DSM pool bills off a buyer's statement and shows advances", async () => {
    const buyerCo = makeEntity('BUYER');
    const psa = makeContract({ contract_type: 'PSA', buyer_id: buyerCo.id });
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-08', total_amount: 1000000 });
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-08', total_amount: 50000, invoice_no: 'DSM-POOL/2026/0001' });
    const rid = newId('UAR');
    db.prepare(`INSERT INTO unapplied_receipts (id, receipt_no, entity_id, contract_id, source, amount, balance, received_on) VALUES (?, 'ADV/1', ?, ?, 'EXCESS_PAYMENT', 30000, 30000, date('now'))`).run(rid, buyerCo.id, psa.id);
    db.prepare(`INSERT INTO unapplied_receipt_events (id, receipt_id, event_type, amount) VALUES (?, ?, 'RECEIVED', 30000)`).run(newId('UAE'), rid);
    db.prepare(`INSERT INTO unapplied_receipt_events (id, receipt_id, event_type, amount) VALUES (?, ?, 'REFUNDED', 10000)`).run(newId('UAE'), rid);

    const buyer = signToken(makeUser('BUYER', { linked_entity_id: buyerCo.id }));
    const s = (await get('/api/ledger/statement', buyer)).body;
    expect(s.entries.some((e) => String(e.invoice_no || '').startsWith('DSM-'))).toBe(false);
    expect(s.entries.filter((e) => e.type === 'ADVANCE').map((e) => e.credit)).toEqual([30000]);
    expect(s.entries.filter((e) => e.type === 'ADVANCE_REFUND').map((e) => e.debit)).toEqual([10000]);
    expect(s.totals).toMatchObject({ advances: 30000, refunds: 10000 });
    const pdf = await get('/api/ledger/statement.pdf', buyer);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
  });
});

describe('SM3 banking statement', () => {
  it('sums each cycle and lets only its own developer read it', async () => {
    const sellerCo = makeEntity('SELLER');
    const ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', seller_id: sellerCo.id });
    const bank = (cycle, banked, drawn, settled, status) => db.prepare(`INSERT INTO energy_banking (id, contract_id, cycle, period_month, banked_mwh, drawn_mwh, tariff_per_unit, cycle_ends_on, settled_mwh, settlement_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, 2.5, ?, ?, ?, ?)`).run(newId('EB'), ppa.id, cycle, `${cycle.slice(0, 4)}-06`, banked, drawn, `${Number(cycle.slice(0, 4)) + 1}-03-31`, settled, settled * 2500 * 0.75, status);
    bank('2025-26', 100, 40, 45, 'SETTLED');
    bank('2026-27', 80, 20, 0, 'OPEN');

    const st = (await get(`/api/energy-banking/${ppa.id}/statement`)).body;
    expect(st.cycles.find((c) => c.cycle === '2025-26')).toMatchObject({ banked_mwh: 100, drawn_mwh: 40, settled_mwh: 45, lapsed_mwh: 15, balance_mwh: 0 });
    expect(st.totals).toMatchObject({ banked_mwh: 180, balance_mwh: 60, lapsed_mwh: 15 });

    const own = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
    const other = signToken(makeUser('SELLER', { linked_entity_id: makeEntity('SELLER').id }));
    const pdf = await get(`/api/energy-banking/${ppa.id}/statement.pdf`, own);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect((await get(`/api/energy-banking/${ppa.id}/statement.pdf`, other)).status).toBe(403);
  });
});
