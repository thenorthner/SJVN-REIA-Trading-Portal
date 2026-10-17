import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { complianceCalendar } from '../../src/services/complianceCalendar.js';
import { developerScorecard } from '../../src/services/developerScorecard.js';
import { alertLateBankClaims } from '../../src/services/invocationClaims.js';

// Batch 5 (17-Oct-2026): CC1/CERC1/SM4 calendar, D4 root-cause tasks, G5
// scorecard, S2 bank claim tracker, L4 TDS vs 16A, R5 balance confirmation,
// CC5 compliance register export.

let reia;
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const day = (n) => new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86400000).toISOString().slice(0, 10);
const makePdf = (text) => new Promise((resolve) => {
  const doc = new PDFDocument(); const chunks = [];
  doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.fontSize(12).text(text); doc.end();
});
const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
});

describe('CC1/CERC1/SM4 90-day compliance calendar', () => {
  it('puts security expiries, contract ends, banking cycle ends and hearings on one timeline', async () => {
    const psa = makeContract({ contract_type: 'PSA', status: 'ACTIVE', tenure_start: '2020-01-01', tenure_end: day(40) });
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, limit_amount, validity_start, validity_end, status) VALUES (?, 'LC/CAL/1', ?, 'LC', 1000000, '2026-01-01', ?, 'ACTIVE')`).run(newId('PS'), psa.id, day(20));
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, limit_amount, validity_start, validity_end, status) VALUES (?, 'LC/CAL/2', ?, 'LC', 1000000, '2026-01-01', ?, 'ACTIVE')`).run(newId('PS'), psa.id, day(200));
    const ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar' });
    db.prepare(`INSERT INTO energy_banking (id, contract_id, cycle, period_month, banked_mwh, drawn_mwh, tariff_per_unit, cycle_ends_on, status) VALUES (?, ?, 'CAL', '2026-06', 50, 10, 2.5, ?, 'OPEN')`).run(newId('EB'), ppa.id, day(60));

    const cal = complianceCalendar({ days: 90 });
    const mine = cal.items.filter((i) => ['SECURITY_EXPIRY', 'CONTRACT_END', 'BANKING_CYCLE_END'].includes(i.kind));
    expect(mine.map((i) => i.kind)).toEqual(['SECURITY_EXPIRY', 'CONTRACT_END', 'BANKING_CYCLE_END']);
    expect(mine[0]).toMatchObject({ days_left: 20, overdue: false });
    expect(mine[2].detail).toMatch(/40 MWh still banked/);
    expect(cal.items.some((i) => i.title.includes('LC/CAL/2')), 'beyond the window').toBe(false);
    const api = (await get('/api/reports/compliance-calendar?days=90')).body;
    expect(api.totals.by_kind.SECURITY_EXPIRY).toBeGreaterThanOrEqual(1);
  });
});

describe('D4 dispute root-cause tasks', () => {
  const dispute = (reason) => {
    const ppa = makeContract({ contract_type: 'PPA' });
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SENT', billing_period: '2026-08', total_amount: 500000, energy_charges: 500000 });
    const id = newId('DIS');
    db.prepare(`INSERT INTO disputes (id, dispute_no, invoice_id, raised_by_role, reason_code, charge_line, issue_description, disputed_amount, status)
      VALUES (?, ?, ?, 'SELLER', ?, 'energy_charges', 'x', 20000, 'UNDER_REVIEW')`).run(id, `DSP/D4/${id}`, inv.id, reason);
    return id;
  };
  const resolve = (id, outcome) => post(`/api/disputes/${id}/resolve`, { outcome, accepted_amount: 10000, resolution_notes: 'Checked against the JMR' }, tokenFor('REIA_ADMIN'));

  it('sends an accepted energy mismatch to the Energy Data desk, and a tariff error to Contract Compliance', async () => {
    const energy = dispute('ENERGY_DATA_MISMATCH');
    expect((await resolve(energy, 'PARTIAL_CREDIT')).status).toBe(200);
    const tariff = dispute('TARIFF_RATE_ERROR');
    expect((await resolve(tariff, 'FULL_CREDIT')).status).toBe(200);
    const rejected = dispute('ENERGY_DATA_MISMATCH');
    expect((await resolve(rejected, 'REJECTED')).status).toBe(200);

    const ed = (await get('/api/desk-tasks?desk=ENERGY_DATA')).body;
    expect(ed.rows.map((t) => t.source_id)).toEqual([energy]);
    expect(ed.rows[0]).toMatchObject({ task_type: 'ENERGY_CORRECTION', period_month: '2026-08', status: 'OPEN' });
    const cc = (await get('/api/desk-tasks?desk=CONTRACT_COMPLIANCE')).body;
    expect(cc.rows.map((t) => t.task_type)).toEqual(['TARIFF_REVIEW']);

    expect((await post(`/api/desk-tasks/${ed.rows[0].id}/close`, { note: 'ok' })).status).toBe(400);
    const done = await post(`/api/desk-tasks/${ed.rows[0].id}/close`, { note: 'Locked figure superseded by the corrected SEA' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe('DONE');
    expect((await post(`/api/desk-tasks/${cc.rows[0].id}/close`, { note: 'Tariff master corrected to 2.88' })).status, 'not the user\'s desk').toBe(403);
  });
});

describe('G5 developer scorecard', () => {
  it('scores a plant on generation against target, disputes, payment cycle and compliance', () => {
    const dev = makeEntity('SELLER');
    const ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', capacity_mw: 10, seller_id: dev.id, cod_date: '2025-04-01', tenure_start: '2025-04-01', tenure_end: '2050-03-31', status: 'ACTIVE' });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-06', 'FINAL', 'SEA', 1584, 'LOCKED')`).run(newId('ENG'), ppa.id);
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'PAID', billing_period: '2026-06', total_amount: 100000 });
    db.prepare(`UPDATE invoices SET hardcopy_received_on = '2026-07-05' WHERE id = ?`).run(inv.id);
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date) VALUES (?, ?, 100000, '2026-08-04')`).run(newId('PAY'), inv.id);
    db.prepare(`INSERT INTO disputes (id, dispute_no, invoice_id, raised_by_role, reason_code, charge_line, issue_description, disputed_amount, status) VALUES (?, 'DSP/G5', ?, 'SELLER', 'OTHER', 'energy_charges', 'x', 1, 'RAISED')`).run(newId('DIS'), inv.id);

    const s = developerScorecard({ from: '2026-06', to: '2026-06' });
    const p = s.plants.find((x) => x.contract_id === ppa.id);
    // 10 MW × 720 h × min CUF → target; 1,584 MWh is 100% of a 22% CUF target.
    expect(p.target_mwh).toBeCloseTo(10 * 720 * p.min_cuf_percent / 100, 1);
    expect(p).toMatchObject({ disputes: 1, disputes_open: 1, paid_bills: 1, avg_payment_days: 30 });
    expect(p.score).toBeGreaterThan(0);
    expect(s.developers.find((d) => d.developer_id === dev.id).plants).toBe(1);
  });
});

describe('S2 bank claim tracker', () => {
  it('starts the bank window on the claim, flags a late bank once, and files its letter', async () => {
    const psa = makeContract({ contract_type: 'PSA' });
    const ps = newId('PS');
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, limit_amount, validity_start, validity_end, status) VALUES (?, 'LC/S2/1', ?, 'LC', 1000000, '2026-01-01', '2027-12-31', 'ACTIVE')`).run(ps, psa.id);
    const inv = newId('SI');
    db.prepare(`INSERT INTO security_invocations (id, invocation_no, contract_id, payment_security_id, amount, status) VALUES (?, 'INV-S2/1', ?, ?, 300000, 'NOTICE_ISSUED')`).run(inv, psa.id, ps);

    expect((await post(`/api/payment-security/invocations/${inv}/transition`, { status: 'CLAIMED', claim_submitted_on: day(1) })).status).toBe(400);
    const r = await post(`/api/payment-security/invocations/${inv}/transition`, { status: 'CLAIMED', claim_submitted_on: day(-10), claim_reference: 'SBI/CLM/77' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const t = (await get('/api/payment-security/invocations/claim-tracker')).body;
    expect(t.rows[0]).toMatchObject({ claim_submitted_on: day(-10), bank_response_due: day(-3), bank_late: true, days_waiting: 10 });
    expect(t.totals).toMatchObject({ awaiting_bank: 1, late: 1, amount_awaiting: 300000 });
    expect(alertLateBankClaims().sent).toBe(1);
    expect(alertLateBankClaims().sent, 'once').toBe(0);

    expect((await post(`/api/payment-security/invocations/${inv}/transition`, { status: 'REJECTED', bank_responded_on: day(-1) })).status).toBe(200);
    const pdf = await makePdf('The bank refuses the claim.');
    const up = await request(app).post(`/api/payment-security/invocations/${inv}/letter`).set(auth(reia)).attach('file', pdf, 'refusal.pdf');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const after = (await get('/api/payment-security/invocations/claim-tracker')).body.rows[0];
    expect(after).toMatchObject({ status: 'REJECTED', bank_responded_on: day(-1), bank_late: true, answered_in_days: 9, letter: { name: 'refusal.pdf' }, letter_due: false });
    expect((await get(`/api/payment-security/invocations/${inv}/letter`)).status).toBe(200);
  });
});

describe('L4 TDS against Form 16A', () => {
  it('records the section with the receipt and reconciles the quarter against the certificate', async () => {
    const buyer = makeEntity('BUYER');
    const psa = makeContract({ contract_type: 'PSA', buyer_id: buyer.id });
    const bill = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-05', total_amount: 1000000, due_date: '2026-07-31' });
    const fin = tokenFor('FINANCE_USER');
    const pay = (body) => post(`/api/invoices/${bill.id}/payments`, { amount: 400000, payment_date: '2026-06-20', deduction: 400, ...body }, fin);
    expect((await pay({ tds_amount: 400 })).status, 'section required').toBe(400);
    expect((await pay({ tds_amount: 500, tds_section: '194Q' })).status, 'TDS is within the deduction').toBe(400);
    const ok = await pay({ tds_amount: 400, tds_section: '194Q' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(db.prepare('SELECT tds_amount, tds_section FROM payments WHERE invoice_id = ?').get(bill.id)).toEqual({ tds_amount: 400, tds_section: '194Q' });

    let row = (await get('/api/tds-recon?fy=2026-27', fin)).body.rows.find((r) => r.entity_id === buyer.id);
    expect(row).toMatchObject({ party_side: 'BUYER', quarter: 'Q1', deducted: 400, by_section: { '194Q': 400 }, state: 'OVERDUE', certificate_due: '2026-08-15' });
    db.prepare(`INSERT INTO tds_certificates (id, entity_id, financial_year, quarter, certificate_no, tds_amount) VALUES (?, ?, '2026-27', 'Q1', '16A/ABC/1', 300)`).run(newId('TDS'), buyer.id);
    row = (await get('/api/tds-recon?fy=2026-27', fin)).body.rows.find((r) => r.entity_id === buyer.id);
    expect(row).toMatchObject({ state: 'SHORT', difference: -100 });
    const mark = (body) => post('/api/tds-recon/mark', { entity_id: buyer.id, party_side: 'BUYER', financial_year: '2026-27', quarter: 'Q1', ...body }, fin);
    expect((await mark({ status: 'RECONCILED' })).status, 'a short 16A needs a reason').toBe(400);
    const m = await mark({ status: 'MISMATCH', note: 'Asked the buyer to revise the 26Q for ₹100' });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(m.body.recon_status).toBe('MISMATCH');
    expect((await mark({ status: 'RECONCILED', note: 'x' })).status).toBe(400);
    expect((await post('/api/tds-recon/mark', { entity_id: buyer.id, party_side: 'BUYER', financial_year: '2026-27', quarter: 'Q1', status: 'RECONCILED', note: 'Revised 26Q filed' }, reia)).status, 'Finance marks it').toBe(403);
  });
});

describe('R5 annual balance confirmation', () => {
  it('freezes the 31 March balance in a letter and records the reply with the auditor certificate', async () => {
    const buyer = makeEntity('BUYER');
    const psa = makeContract({ contract_type: 'PSA', buyer_id: buyer.id });
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2025-12', total_amount: 750000, due_date: '2026-02-15' });
    const fin = tokenFor('FINANCE_USER');
    expect((await post('/api/balance-confirmations', { entity_id: buyer.id, financial_year: '2026-27' }, fin)).status, 'year not closed').toBe(400);
    const issued = await post('/api/balance-confirmations', { entity_id: buyer.id, financial_year: '2025-26' }, fin);
    expect(issued.status, JSON.stringify(issued.body)).toBe(201);
    expect(issued.body).toMatchObject({ party_side: 'BUYER', period_to: '2026-03-31', status: 'ISSUED' });
    const pdf = await get(`/api/balance-confirmations/${issued.body.id}/letter.pdf`, fin);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);

    const closing = issued.body.closing_balance;
    const refused = await request(app).post(`/api/balance-confirmations/${issued.body.id}/response`).set(auth(fin)).field('status', 'CONFIRMED').field('confirmed_balance', String(closing - 5000));
    expect(refused.status).toBe(400);
    const cert = await makePdf('Balance certified by ABC & Co.');
    const r = await request(app).post(`/api/balance-confirmations/${issued.body.id}/response`).set(auth(fin))
      .field('status', 'DISPUTED').field('confirmed_balance', String(closing - 5000)).field('remarks', 'Buyer has not booked the December LPS').field('auditor_name', 'ABC & Co')
      .attach('file', cert, 'auditor-certificate.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'DISPUTED', difference: -5000, auditor_name: 'ABC & Co', certificate_name: 'auditor-certificate.pdf' });
    expect((await get(`/api/balance-confirmations/${issued.body.id}/certificate`, fin)).status).toBe(200);
    expect((await post('/api/balance-confirmations', { entity_id: buyer.id, financial_year: '2025-26' }, fin)).status, 'answered letters are not re-issued').toBe(409);
  });
});

describe('CC5 compliance register export', () => {
  it('exports every live contract with its checklist', async () => {
    const live = makeContract({ contract_type: 'PPA', status: 'ACTIVE', contract_no: 'PPA/CC5/LIVE' });
    makeContract({ contract_type: 'PPA', status: 'DRAFT', contract_no: 'PPA/CC5/DRAFT' });
    const res = await request(app).get('/api/reports/contract-compliance.xlsx').set(auth(reia)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = XLSX.read(res.body, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Register', 'Checklist']);
    const reg = XLSX.utils.sheet_to_json(wb.Sheets.Register, { header: 1 });
    const nos = reg.slice(3).map((r) => r[0]);
    expect(nos).toContain(live.contract_no);
    expect(nos).not.toContain('PPA/CC5/DRAFT');
    expect(reg[2]).toEqual(expect.arrayContaining(['Contract', 'Overall', 'Would be held']));
  });
});
