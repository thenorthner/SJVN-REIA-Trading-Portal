import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, makeUser, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { readinessBoard } from '../../src/services/billingReadiness.js';
import { postingChecklist } from '../../src/services/monthClose.js';
import { paymentMonitoring } from '../../src/services/paymentMonitoring.js';
import { raiseRootCauseTask } from '../../src/services/deskTasks.js';

// What the September-2026 end-to-end run on a fresh copy of the live data
// turned up (17-Oct-2026).

let reia, sellerCo, buyerCo, ppa, psa;
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const istDay = (n = 0) => new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  sellerCo = makeEntity('SELLER');
  buyerCo = makeEntity('BUYER');
  ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.88, seller_id: sellerCo.id, buyer_id: buyerCo.id, status: 'ACTIVE', cod_date: '2024-01-01', tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
  psa = makeContract({ contract_type: 'PSA', project_type: 'Solar', seller_id: sellerCo.id, buyer_id: buyerCo.id, tariff_per_unit: 2.95, status: 'ACTIVE', tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2024-01-01')`).run(newId('ALC'), ppa.id, psa.id);
  db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-09', 'FINAL', 'JMR', 8000, 'LOCKED')`).run(newId('ENG'), ppa.id);
});

describe('A PSA reconciled on final source energy', () => {
  it('is on a final basis when every source PPA figure is final', async () => {
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-09', total_amount: 23600000, energy_mwh: 8000 });
    const r = await post('/api/reconciliation/run', { contract_id: psa.id, period_type: 'MONTHLY', period: '2026-09' }, tokenFor('SJVN_ADMIN'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = (await get(`/api/reconciliation/${r.body.id}`)).body;
    expect(d.data_basis).toBe('FINAL');
    expect(d.items.find((i) => i.item_type === 'ENERGY_THREE_WAY').notes).toMatch(/FINAL\/LOCKED/);
  });
});

describe('A root-cause task on a PSA bill', () => {
  it('names the source PPA whose energy record is to be corrected', () => {
    const inv = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-09', total_amount: 23600000 });
    const t = raiseRootCauseTask({ id: newId('DIS'), dispute_no: 'DSP/T/1', reason_code: 'ENERGY_DATA_MISMATCH' }, inv, { outcome: 'PARTIAL_CREDIT', accepted: 20000 });
    expect(t.title).toContain(ppa.contract_no);
    expect(t.title).toContain(`feeds ${psa.contract_no}`);
  });
});

describe('The developer\'s own invoice is the PPA\'s bill for the month', () => {
  it('shows the PPA as billed on the readiness board and leaves it off the month-close open items', () => {
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-09', total_amount: 23040000, invoice_breakdown_json: '' });
    const row = readinessBoard('2026-09').rows.find((r) => r.contract_id === ppa.id);
    expect(row.state).toBe('BILLED');
    expect(row.billed.own).toBe(true);
    expect(postingChecklist('2026-09').items.find((i) => i.key === 'ENERGY_UNBILLED').rows.map((r) => r.contract_no)).not.toContain(ppa.contract_no);
  });

  it('keeps hydro stations\' unlocked energy off REIA\'s month close', () => {
    const hydro = makeContract({ contract_type: 'PPA', project_type: 'Hydro' });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-09', 'PROVISIONAL', 'REA', 100000, 'VALIDATED')`).run(newId('ENG'), hydro.id);
    expect(postingChecklist('2026-09').items.find((i) => i.key === 'ENERGY_NOT_LOCKED').rows.map((r) => r.contract_no)).not.toContain(hydro.contract_no);
  });
});

describe('The buyer\'s "awaiting SJVN" total', () => {
  it('leaves out an intimation still with the buyer\'s own checker', async () => {
    const bill = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-09', total_amount: 5000000, due_date: istDay(30) });
    const maker = signToken(makeUser('BUYER_L1', { linked_entity_id: buyerCo.id }));
    const r = await post('/api/buyer-bills/intimations', { invoice_id: bill.id, amount: 1000000, payment_date: istDay(0), mode: 'RTGS', reference: 'UTR-CHECKER-1' }, maker);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('PENDING_CHECKER');
    const admin = signToken(makeUser('BUYER', { linked_entity_id: buyerCo.id }));
    const t = (await get('/api/buyer-bills', admin)).body.totals;
    expect(t).toMatchObject({ with_finance: 0, with_finance_count: 0, with_checker: 1000000, with_checker_count: 1 });
  });
});

describe('The seller\'s bill list', () => {
  it('tells what a credit note settled apart from money received', async () => {
    const bill = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'PAID', billing_period: '2026-08', total_amount: 300000 });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, 200000, '2026-09-10', 'NEFT'), (?, ?, 100000, '2026-09-12', 'CREDIT_NOTE')`).run(newId('PAY'), bill.id, newId('PAY'), bill.id);
    const seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
    const rows = (await get('/api/invoices', seller)).body;
    const row = (rows.rows || rows).find((x) => x.id === bill.id);
    expect(row).toMatchObject({ paid_total: 300000, credit_settled: 100000 });
  });
});

describe('Days to the due date', () => {
  it('counts whole days on India\'s calendar', () => {
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-09', total_amount: 100000, due_date: istDay(45) });
    const b = paymentMonitoring('RECEIVABLE').bills.find((x) => x.contract_no === psa.contract_no);
    expect(b.days_past_due).toBe(-45);
  });
});
