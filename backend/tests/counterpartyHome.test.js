import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

// The landing page: what is waiting on the person, where the money stands,
// what is coming up — for their own company only.

let alpha, beta, discom, contract, psa, seller, maker, otherSeller, buyer, reia;
const as = (u) => auth(signToken(u));
const home = (u, q = '') => request(app).get(`/api/home${q}`).set(as(u));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const month = (k = 0) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return d.toISOString().slice(0, 7); };
const bill = (no, extra = {}) => makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', invoice_no: no, billing_period: month(1), total_amount: 1000000, energy_charges: 1000000, due_date: day(20), ...extra });
const pay = (inv, amount, date = day(-2)) => db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference) VALUES (?, ?, ?, ?, 'RTGS', 'UTR1')`).run(`PAY-${Math.random().toString(36).slice(2, 8)}`, inv.id, amount, date);

beforeEach(() => {
  resetReia();
  for (const t of ['contract_milestones', 'contract_notices', 'document_requests', 'security_amendments', 'mail_boxes']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* not on this database */ } }
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  beta = makeEntity('SELLER', { name: 'Beta Wind' });
  discom = makeEntity('BUYER', { name: 'North Discom' });
  contract = makeContract({ seller_id: alpha.id, capacity_mw: 50 });
  db.prepare('UPDATE contracts SET buyer_id = NULL WHERE id = ?').run(contract.id);
  psa = makeContract({ contract_type: 'PSA', buyer_id: discom.id, seller_id: beta.id });
  seller = makeUser('SELLER', { name: 'Asha Admin', linked_entity_id: alpha.id });
  maker = makeUser('SELLER_L1', { name: 'Mohan Maker', linked_entity_id: alpha.id });
  otherSeller = makeUser('SELLER', { name: 'Bina Beta', linked_entity_id: makeEntity('SELLER').id });
  buyer = makeUser('BUYER', { name: 'Dev Discom', linked_entity_id: discom.id });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
});

describe('where the money stands', () => {
  it('nets payments off, ages what is left and measures how long bills took to be paid', async () => {
    const paid = bill('A/1', { status: 'PAID', billing_period: month(2), due_date: day(-30) });
    db.prepare(`UPDATE invoices SET created_at = datetime('now', '-40 days') WHERE id = ?`).run(paid.id);
    pay(paid, 1000000, day(-10));
    const part = bill('A/2', { status: 'PARTIALLY_PAID', due_date: day(-45) });
    pay(part, 400000);
    bill('A/3');
    bill('A/4', { status: 'DRAFT' });
    bill('A/5', { status: 'CANCELLED' });

    const r = await home(seller, '?period=12M');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const k = r.body.kpis;
    expect(k).toMatchObject({ active_contracts: 1, capacity_mw: 50, billed: 3000000, billed_count: 3, received: 1400000, outstanding: 1600000, open_bills: 2, overdue: 600000, overdue_count: 1, avg_days_to_pay: 30, bills_settled: 1 });
    expect(r.body.ageing.map((b) => [b.label, b.amount])).toEqual([['Not yet due', 1000000], ['1–30 days', 0], ['31–60 days', 600000], ['61–90 days', 0], ['Over 90 days', 0]]);
    expect(r.body.months).toHaveLength(12);
    expect(r.body.months.find((m) => m.month === month(1))).toMatchObject({ billed: 2000000 });
    expect(r.body.months.reduce((t, m) => t + m.received, 0)).toBe(1400000);
    expect(r.body.contracts[0]).toMatchObject({ contract_no: contract.contract_no, billed: 3000000, received: 1400000, outstanding: 1600000, overdue: 600000 });
    expect(r.body.recent.payments).toHaveLength(2);
    expect(r.body.period).toMatchObject({ key: '12M', label: 'Last 12 months' });

    // Somebody else's company sees none of it.
    const other = (await home(otherSeller)).body;
    expect(other.kpis).toMatchObject({ billed: 0, outstanding: 0, active_contracts: 0 });
    expect(other.contracts).toEqual([]);
    expect((await home(reia)).status).toBe(403);
  });
});

describe('what is waiting', () => {
  it('lists the seller\'s open work, worst first, and words drafts by who is looking', async () => {
    bill('A/1', { status: 'DRAFT' });
    bill('A/2', { due_date: day(-5) });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES ('E1', ?, ?, 'FINAL', 'REA', 1200, 'VALIDATED')`).run(contract.id, month(1));
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, bg_subtype, limit_amount, validity_end, status) VALUES ('PS1', 'PS/PBG/1', ?, 'BANK_GUARANTEE', 'PBG', 500000, ?, 'ACTIVE')`).run(contract.id, day(12));
    db.prepare(`INSERT INTO document_requests (id, entity_id, document_type, due_date, status, requested_by) VALUES ('DR1', ?, 'GST_CERTIFICATE', ?, 'OPEN', ?)`).run(alpha.id, day(5), reia.id);

    const t = (await home(seller)).body;
    const keys = t.todo.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['drafts', 'overdue', 'energy', 'security', 'doc-requests']));
    expect(t.todo[0].level).toBe('red');
    expect(t.todo.map((x) => x.level)).toEqual([...t.todo.map((x) => x.level)].sort((a, b) => ({ red: 0, amber: 1, blue: 2 }[a] - { red: 0, amber: 1, blue: 2 }[b])));
    expect(t.todo.find((x) => x.key === 'drafts').title).toMatch(/waiting for your approval/);
    expect(t.todo.find((x) => x.key === 'security')).toMatchObject({ level: 'red', link: '/seller/payment-security', due: day(12) });
    expect((await home(maker)).body.todo.find((x) => x.key === 'drafts').title).toMatch(/in draft/);

    const cal = t.calendar.map((e) => [e.kind, e.date]);
    expect(cal).toEqual(expect.arrayContaining([['SECURITY', day(12)], ['DOCUMENT', day(5)]]));
    expect(t.calendar.map((e) => e.date)).toEqual([...t.calendar.map((e) => e.date)].sort());
    // An extension already with SJVN takes the guarantee off the list.
    db.prepare(`INSERT INTO security_amendments (id, payment_security_id, contract_id, status) VALUES ('AM1', 'PS1', ?, 'PENDING')`).run(contract.id);
    expect((await home(seller)).body.todo.map((x) => x.key)).not.toContain('security');
    expect((await home(otherSeller)).body.todo).toEqual([]);
  });

  it('shows a buyer the bills SJVN has presented, and what falls due', async () => {
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', invoice_no: 'S/1', billing_period: month(1), total_amount: 500000, energy_charges: 500000, due_date: day(4) });
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'DRAFT', invoice_no: 'S/2', billing_period: month(1), total_amount: 900000, energy_charges: 900000, due_date: day(30) });
    const b = (await home(buyer, '?period=ALL')).body;
    expect(b.side).toBe('BUYER');
    expect(b.kpis).toMatchObject({ billed: 500000, outstanding: 500000 });
    expect(b.todo.find((x) => x.key === 'bills-due')).toMatchObject({ link: '/buyer/invoices', due: day(4) });
    expect(b.calendar[0]).toMatchObject({ kind: 'PAYMENT', date: day(4), days: 4 });
  });
});

describe('the summary', () => {
  it('downloads as a PDF', async () => {
    bill('A/1');
    const r = await home(seller, '/summary.pdf').buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(r.status).toBe(200);
    expect(r.body.slice(0, 4).toString()).toBe('%PDF');
  });
});
