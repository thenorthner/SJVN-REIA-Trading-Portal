import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, makeUser, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { storeParsedDsa } from '../../src/services/nrpcDsaIngest.js';
import { checkAdequacy } from '../../src/paymentSecurityEngine.js';

// Batch 3 (17-Oct-2026): CC4 contract hold, CC2 compliance request, V1 send
// back, V2 verification SLA, V3 bulk verify, DSM1 statement sync, DSM4 pool
// tracker, SM1 default gate, SM5 diversion P&L.

let reia, checker, finance, sellerCo, buyerCo, ppa, psa;
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const lock = (contract, period, mwh) => db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, status) VALUES (?, ?, ?, 'FINAL', 'SEA', ?, 22, 'LOCKED')`).run(newId('ENG'), contract.id, period, mwh);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  // Phase B.2: checking is the checker's.
  checker = tokenFor('REIA_CHECKER');
  finance = tokenFor('FINANCE_USER');
  sellerCo = makeEntity('SELLER');
  buyerCo = makeEntity('BUYER');
  ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.88, seller_id: sellerCo.id, buyer_id: buyerCo.id, cod_date: '2024-01-01', tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
  psa = makeContract({ contract_type: 'PSA', seller_id: sellerCo.id, buyer_id: buyerCo.id, tariff_per_unit: 2.95, trading_margin_per_mwh: 70, tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2024-01-01')`).run(newId('ALC'), ppa.id, psa.id);
});

describe('CC4 contract hold', () => {
  it('holds a PSA with a critical security shortfall from new bills until Management lifts it', async () => {
    // ₹30 lakh overdue on the PSA and no letter of credit at all.
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-06', total_amount: 3000000, due_date: '2026-07-31' });
    lock(ppa, '2026-08', 1000);
    const hold = (await get(`/api/contracts/${psa.id}/hold`)).body;
    expect(hold.on_hold).toBe(true);
    expect(hold.breaches[0]).toMatchObject({ code: 'SECURITY', critical: true });
    const r = await post('/api/invoices/generate', { contract_id: psa.id, period_month: '2026-08', invoice_type: 'FINAL' });
    expect(r.status).toBe(423);
    expect(r.body.error).toMatch(/is on hold, so a new bill is stopped/);
    expect((await post(`/api/contracts/${psa.id}/hold/override`, { reason: 'LC renewal with the bank this week', valid_until: day(10) })).status).toBe(403);
    const mgmt = tokenFor('MANAGEMENT');
    expect((await post(`/api/contracts/${psa.id}/hold/override`, { reason: 'LC renewal with the bank this week', valid_until: day(60) }, mgmt)).status).toBe(400);
    expect((await post(`/api/contracts/${psa.id}/hold/override`, { reason: 'LC renewal with the bank this week', valid_until: day(10) }, mgmt)).body.on_hold).toBe(false);
    expect((await post('/api/invoices/generate', { contract_id: psa.id, period_month: '2026-08', invoice_type: 'FINAL' })).status).toBe(201);
  });

  it('a hold put on by hand stops scheduling and bidding for the buyer', async () => {
    expect((await post(`/api/contracts/${psa.id}/hold`, { on: true, reason: 'short' })).status).toBe(400);
    expect((await post(`/api/contracts/${psa.id}/hold`, { on: true, reason: 'Buyer has disputed the PSA itself before CERC' })).body.on_hold).toBe(true);
    const gate = checkAdequacy({ buyerEntityId: buyerCo.id });
    expect(gate.adequate).toBe(false);
    expect(gate.error).toMatch(/is on hold/);
  });
});

describe('CC2 compliance request', () => {
  it('asks the paying side for what a breached check needs, once', async () => {
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-06', total_amount: 3000000, due_date: '2026-07-31' });
    const buyer = makeUser('BUYER', { linked_entity_id: buyerCo.id });
    const r = await post(`/api/contracts/${psa.id}/compliance-request`, { code: 'SECURITY' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ entity_id: buyerCo.id, document_type: 'PAYMENT_SECURITY', status: 'OPEN' });
    expect(db.prepare('SELECT message FROM notifications WHERE user_id = ?').all(buyer.id).map((n) => n.message).join(' ')).toMatch(/asked for a document/);
    expect((await post(`/api/contracts/${psa.id}/compliance-request`, { code: 'SECURITY' })).status).toBe(409);
  });
});

describe('Verification queue', () => {
  const ALL_CLEAR = [
    { key: 'REA_UPLOADED', status: 'VERIFIED' }, { key: 'ENERGY_VERIFIED', status: 'VERIFIED' },
    { key: 'TARIFF_VERIFIED', status: 'VERIFIED' }, { key: 'CAPACITY_VERIFIED', status: 'VERIFIED' },
    { key: 'CUF_COMPLIANCE', status: 'VERIFIED' }, { key: 'COD_COMPLIANCE', status: 'VERIFIED' },
    { key: 'CURTAILMENT_CHECKED', status: 'NA' }, { key: 'CHANGE_IN_LAW_VERIFIED', status: 'NA' },
  ];
  const raise = async (over = {}) => {
    const seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
    const r = await post('/api/invoices', { contract_id: ppa.id, billing_period: '2026-08', invoice_type: 'FINAL', energy_mwh: 8200, tariff_per_unit: 2.88, energy_charges: 23616000, ...over }, seller);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await post(`/api/invoices/${r.body.id}/submit-for-approval`);
    return r.body;
  };

  it('V1: sends a bill back with its failed checks, and the developer is told them', async () => {
    lock(ppa, '2026-08', 8200);
    const inv = await raise({ tariff_per_unit: 3.1, energy_charges: 25420000 });
    const r = await post(`/api/invoices/${inv.id}/send-back`, {}, checker);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('REJECTED');
    expect(r.body.sent_back.join(' ')).toMatch(/Tariff Verified/);
  });

  it('V2: shows each bill against its verification window', async () => {
    lock(ppa, '2026-08', 8200);
    const inv = await raise();
    db.prepare(`UPDATE invoices SET created_at = datetime('now', '-20 days') WHERE id = ?`).run(inv.id);
    const q = (await get('/api/reports/verification-queue')).body;
    expect(q.invoices.find((r) => r.invoice_id === inv.id).sla).toMatchObject({ window_days: 15, level: 'RED' });
    expect(q.totals.sla_red).toBeGreaterThanOrEqual(1);
  });

  it('V3: verifies the clean bills in one pass and leaves the rest', async () => {
    lock(ppa, '2026-08', 8200);
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, cuf_percent, status) VALUES (?, ?, '2026-07', 'FINAL', 'SEA', 8100, 22, 'LOCKED')`).run(newId('ENG'), ppa.id);
    const clean = await raise();
    const bad = await raise({ billing_period: '2026-07', energy_mwh: 8100, tariff_per_unit: 3.1, energy_charges: 25110000 });
    const r = await post('/api/invoices/verify-bulk', { invoice_ids: [clean.id, bad.id] });
    expect(r.body.verified.map((x) => x.invoice_id)).toEqual([clean.id]);
    expect(r.body.skipped[0]).toMatchObject({ invoice_id: bad.id });
    expect(db.prepare('SELECT verification_status FROM invoices WHERE id = ?').get(clean.id).verification_status).toBe('VERIFIED');
  });
});

describe('DSM desk', () => {
  it('DSM1 + DSM4: syncs a statement to the register, raises it in one click, and tracks the pool payment', async () => {
    const nj = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/NJHPS/T-${Math.random().toString(36).slice(2, 8)}` });
    const figures = { schedule_lu: 511.07, actual_lu: 517.2, devi_amt_lakh: -8.37312, sus_devi: null, sus_amount_lakh: null, add_devi_lakh: null, adj_lakh: 0, net_devi_lakh: -8.37312 };
    const acct = storeParsedDsa({
      header: { week_no: 40, financial_year: '2025-26', week_start: '2025-12-29', week_end: '2026-01-04', issued_date: '2026-01-14', due_date: '2026-01-24' },
      entities: [{ entity_name: 'NATHPA JHAKRI HEP', days: [{ entry_date: '2025-12-29', ...figures }], total: figures }],
      problems: [], warnings: [],
    }, { buffer: Buffer.from(`pdf-${Math.random()}`), sourceKind: 'ARCHIVE', weekCode: '291225-040126(WK-40)', createdBy: 'test' });
    let sync = (await get('/api/deviation/statement-sync')).body;
    let row = sync.rows.find((r) => r.contract_id === nj.id);
    expect(row).toMatchObject({ state: 'NOT_RAISED', statement_amount: 837312, billed_so_far: 0, delta: 837312 });
    const raised = await post('/api/deviation/raise-from-statement', { dsa_account_id: acct.account_id, contract_id: nj.id });
    expect(raised.status, JSON.stringify(raised.body)).toBe(201);
    sync = (await get('/api/deviation/statement-sync')).body;
    row = sync.rows.find((r) => r.contract_id === nj.id);
    expect(row).toMatchObject({ billed_so_far: 837312, delta: 0 });

    // The pool bill, presented: overdue since 24 Jan 2026, interest running.
    db.prepare(`UPDATE invoices SET status = 'SENT' WHERE invoice_no = ?`).run(raised.body.invoice_no);
    const t = (await get('/api/deviation/pool-tracker')).body;
    const p = t.rows.find((r) => r.invoice_no === raised.body.invoice_no);
    expect(p).toMatchObject({ flow: 'RECEIVABLE', amount: 837312, due_date: '2026-01-24', outstanding: 837312 });
    expect(p.days_late).toBeGreaterThan(0);
    expect(p.late_interest).toBe(Math.round(837312 * 0.0004 * p.days_late));
  });
});

describe('Secondary market', () => {
  const divert = (over = {}) => post('/api/power-diversion', { contract_id: psa.id, period_month: '2026-08', reason: 'PAYMENT_DEFAULT', quantum_mwh: 100, sale_rate_per_mwh: 3000, expenses: 0, ...over });
  const lc = (amount) => db.prepare(`INSERT INTO payment_security (id, contract_id, mechanism_type, instrument_no, limit_amount, utilized_amount, issue_date, validity_start, validity_end, status, verified_at)
    VALUES (?, ?, 'LC', ?, ?, 0, ?, ?, ?, 'ACTIVE', ?)`).run(newId('PSC'), psa.id, `LC/T/${Math.random().toString(36).slice(2, 7)}`, amount, day(-30), day(-30), day(300), day(-29));

  it('SM1: diverts for a payment default only once the LC cannot cover what is overdue', async () => {
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-06', total_amount: 1000000, due_date: '2026-07-31' });
    lc(5000000);
    let dash = (await get('/api/power-diversion/default-dashboard')).body.rows.find((r) => r.contract_id === psa.id);
    expect(dash).toMatchObject({ in_default: false, diversion_enabled: false });
    expect((await divert()).body.error).toMatch(/draw on the LC first/);
    db.prepare(`UPDATE payment_security SET utilized_amount = limit_amount, status = 'INVOKED' WHERE contract_id = ?`).run(psa.id);
    dash = (await get('/api/power-diversion/default-dashboard')).body.rows.find((r) => r.contract_id === psa.id);
    expect(dash).toMatchObject({ in_default: true, diversion_enabled: true });
    expect((await divert()).status).toBe(201);
  });

  it('SM5: the P&L register adds up gains, deficits and where they went', async () => {
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-06', total_amount: 1000000, due_date: '2026-07-31' });
    await divert({ quantum_mwh: 100, sale_rate_per_mwh: 3000, expenses: 50000 }); // +2.5 L
    await divert({ quantum_mwh: 10, sale_rate_per_mwh: 1000, expenses: 30000 }); // −20 k
    const p = (await get('/api/power-diversion/pnl')).body;
    const r = p.rows.find((x) => x.contract_id === psa.id);
    expect(r).toMatchObject({ diversions: 2, gains: 250000, deficits: 20000, net: 230000, deficit_unbilled: 20000 });
  });
});
