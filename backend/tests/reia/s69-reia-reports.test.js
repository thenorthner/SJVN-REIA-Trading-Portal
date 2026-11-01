import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { newId } from '../../src/util.js';
import { receivablesOutstanding, payablesOutstanding } from '../../src/services/outstanding.js';
import { assign } from '../../src/services/projectScope.js';
import { makeUser, tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// REIA Reports tab (31-Oct-2026): predefined reports and a custom builder over
// a whitelist the server declares. These pin the three things a report can get
// wrong without anyone noticing on screen: what it lets a reader name (keys
// from the whitelist only), whose rows it returns (the screens' own scoping),
// and whether its figures add up (filters, subtotals, totals, the dashboard).

const run = (tok, spec, format = 'json') => request(app).get('/api/reports/reia/run')
  .query({ spec: JSON.stringify(spec), format }).set(auth(tok));
const nos = (body) => (body.rows || body.groups.flatMap((g) => g.rows)).map((r) => r.invoice_no).sort();

let F;
beforeAll(() => {
  resetReia();
  db.prepare('DELETE FROM report_templates').run();
  const sellerA = makeEntity('SELLER', { name: 'Surya Alpha Pvt Ltd' });
  const sellerB = makeEntity('SELLER', { name: 'Surya Beta Pvt Ltd' });
  const buyerX = makeEntity('BUYER', { name: 'Vitaran X Ltd' });
  const buyerY = makeEntity('BUYER', { name: 'Vitaran Y Ltd' });
  db.prepare("UPDATE entities SET state = 'Punjab' WHERE id = ?").run(buyerX.id);
  db.prepare("UPDATE entities SET state = 'Haryana' WHERE id = ?").run(buyerY.id);
  const hydro = makeEntity('SELLER', { name: 'Hydro Station Ltd' });

  const ppaA = makeContract({ contract_no: 'PPA/T/A', contract_type: 'PPA', seller_id: sellerA.id, buyer_id: null, project_type: 'Solar', trading_margin_per_mwh: 70 });
  const ppaB = makeContract({ contract_no: 'PPA/T/B', contract_type: 'PPA', seller_id: sellerB.id, buyer_id: null, project_type: 'Solar' });
  const psaX = makeContract({ contract_no: 'PSA/T/X', contract_type: 'PSA', seller_id: null, buyer_id: buyerX.id, project_type: 'Solar' });
  const psaY = makeContract({ contract_no: 'PSA/T/Y', contract_type: 'PSA', seller_id: null, buyer_id: buyerY.id, project_type: 'Solar' });
  const draftX = makeContract({ contract_no: 'PSA/T/X-DRAFT', contract_type: 'PSA', seller_id: null, buyer_id: buyerX.id, project_type: 'Solar', status: 'DRAFT' });
  const hyd = makeContract({ contract_no: 'PPA/T/HYDRO', contract_type: 'PPA', seller_id: hydro.id, buyer_id: buyerX.id, project_type: 'Hydro' });

  const sys = JSON.stringify({ computed: true });
  const inv = (o) => makeInvoice({ invoice_breakdown_json: sys, ...o });
  const invA1 = inv({ invoice_no: 'T-A1', contract_id: ppaA.id, direction: 'SELLER_TO_SJVN', billing_period: '2026-08', status: 'PAID', total_amount: 1000000, energy_mwh: 300, due_date: '2026-09-30', issued_at: '2026-09-01 10:00:00', created_by: 'Maker One' });
  const invA2 = inv({ invoice_no: 'T-A2', contract_id: ppaA.id, direction: 'SELLER_TO_SJVN', billing_period: '2026-09', status: 'DRAFT', total_amount: 1100000, energy_mwh: 320, due_date: '2026-10-30', created_by: 'Maker One' });
  const invB1 = inv({ invoice_no: 'T-B1', contract_id: ppaB.id, direction: 'SELLER_TO_SJVN', billing_period: '2026-09', status: 'APPROVED', total_amount: 2000000, energy_mwh: 600, due_date: '2099-12-31', issued_at: '2026-10-02 10:00:00', created_by: 'Maker Two' });
  const invX1 = inv({ invoice_no: 'T-X1', contract_id: psaX.id, direction: 'SJVN_TO_BUYER', billing_period: '2026-08', status: 'PARTIALLY_PAID', total_amount: 3000000, energy_mwh: 900, due_date: '2026-09-15', issued_at: '2026-08-20 10:00:00', created_by: 'Maker One' });
  const invX2 = inv({ invoice_no: 'T-X2', contract_id: psaX.id, direction: 'SJVN_TO_BUYER', billing_period: '2026-09', status: 'DRAFT', total_amount: 3100000, energy_mwh: 950, due_date: '2026-10-15', created_by: 'Maker Two' });
  const invY1 = inv({ invoice_no: 'T-Y1', contract_id: psaY.id, direction: 'SJVN_TO_BUYER', billing_period: '2026-09', status: 'PAID', total_amount: 4000000, energy_mwh: 1200, due_date: '2026-10-20', issued_at: '2026-09-25 10:00:00', created_by: 'Maker Two' });
  const invH1 = inv({ invoice_no: 'T-H1', contract_id: hyd.id, direction: 'SJVN_TO_BUYER', billing_period: '2026-09', status: 'APPROVED', total_amount: 9999999, due_date: '2026-10-20', issued_at: '2026-09-25 10:00:00' });

  const pay = (invoice, amount, date, mode = 'NEFT') => db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId('PAY'), invoice.id, amount, date, mode, `UTR-${invoice.invoice_no}`);
  pay(invA1, 1000000, '2026-09-20');
  pay(invX1, 500000, '2026-09-20');
  pay(invY1, 4000000, '2026-10-05', 'RTGS');
  pay(invH1, 1000, '2026-10-05');

  db.prepare(`INSERT INTO disputes (id, dispute_no, invoice_id, raised_by_role, reason_code, charge_line, issue_description, disputed_amount, status)
              VALUES (?, 'DSP-T-1', ?, 'BUYER', 'ENERGY_DATA_MISMATCH', 'energy_charges', 'meter reading', 100000, 'RAISED')`).run(newId('DSP'), invX1.id);
  db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, approver_name, status, acted_at) VALUES (?, ?, 3, 'Approver Three', 'APPROVED', '2026-09-01 09:00:00')`).run(newId('APR'), invA1.id);
  db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, approver_name, status, acted_at) VALUES (?, ?, 1, 'Maker One', 'APPROVED', '2026-08-19 09:00:00')`).run(newId('APR'), invX1.id);

  const sellerAUser = makeUser('SELLER', { linked_entity_id: sellerA.id });
  const buyerXUser = makeUser('BUYER_L3', { linked_entity_id: buyerX.id });
  const scoped = makeUser('REIA_MAKER', { name: 'Scoped Maker' });
  assign(scoped.id, [psaX.id], { scope: 'SELECTED' });

  F = {
    sellerA, sellerB, buyerX, buyerY, ppaA, ppaB, psaX, psaY, draftX, hyd, invA1, invA2, invB1, invX1, invX2, invY1, invH1,
    mgmt: tokenFor('MANAGEMENT', { name: 'Manager M' }),
    checker: tokenFor('REIA_CHECKER', { name: 'Checker C' }),
    maker: tokenFor('REIA_MAKER', { name: 'Maker Free' }),
    seller: signToken(sellerAUser),
    buyer: signToken(buyerXUser),
    scoped: signToken(scoped),
    trading: tokenFor('TRADING_USER'),
  };
});

describe('S69 REIA reports — catalogue and whitelist', () => {
  it('offers SJVN every dataset, the audit trail only to governance readers', async () => {
    const m = await request(app).get('/api/reports/reia/catalog').set(auth(F.mgmt));
    expect(m.status).toBe(200);
    const keys = m.body.datasets.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['invoices', 'payments', 'outstanding', 'lps', 'rebates', 'disputes', 'notes', 'energy', 'allocations', 'contracts', 'security', 'reconciliation', 'approvals', 'audit', 'sap']));
    expect(m.body.presets.length).toBeGreaterThan(15);
    // Saved layouts are shared among SJVN's officers only.
    expect(m.body.can_share).toBe(true);

    const c = await request(app).get('/api/reports/reia/catalog').set(auth(F.checker));
    expect(c.body.datasets.map((d) => d.key)).not.toContain('audit');
    expect(c.body.presets.map((p) => p.id)).not.toContain('audit-users');
  });

  it('offers a counterparty its own datasets, without SJVN\'s columns or the other side', async () => {
    const s = await request(app).get('/api/reports/reia/catalog').set(auth(F.seller));
    expect(s.status).toBe(200);
    const keys = s.body.datasets.map((d) => d.key);
    expect(keys).not.toEqual(expect.arrayContaining(['approvals']));
    for (const k of ['approvals', 'audit', 'sap', 'notes', 'allocations']) expect(keys).not.toContain(k);
    const cols = s.body.datasets.find((d) => d.key === 'invoices').columns.map((c) => c.key);
    expect(cols).toContain('seller_name');
    for (const k of ['buyer_name', 'trading_margin', 'counterparty_name', 'created_by', 'approved_by', 'direction']) expect(cols).not.toContain(k);
    // A seller is not offered the buyers' side of the books.
    expect(s.body.presets.map((p) => p.id)).not.toContain('ageing-buyers');
    expect(s.body.presets.map((p) => p.id)).not.toContain('bills-psa');
    expect(s.body.can_share).toBe(false);
  });

  it('refuses anyone who is neither the REIA desk nor a counterparty', async () => {
    const r = await request(app).get('/api/reports/reia/catalog').set(auth(F.trading));
    expect(r.status).toBe(403);
  });

  it('refuses names that are not on the list — dataset, column, filter, grouping', async () => {
    expect((await run(F.mgmt, { dataset: 'users' })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: '__proto__' })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: 'invoices', columns: ['invoice_no', 'password_hash'] })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: 'invoices', columns: ['1; DROP TABLE invoices'] })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: 'invoices', filters: [{ key: 'i.status', op: 'in', value: ['PAID'] }] })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: 'invoices', filters: [{ key: 'status', op: 'raw', value: '1=1' }] })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: 'invoices', group_by: 'total_amount' })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: 'invoices', filters: [{ key: 'bill_date', op: 'between', value: ['2026-10-01', '2026-09-01'] }] })).status).toBe(400);
    expect((await run(F.mgmt, { dataset: 'invoices', filters: [{ key: 'bill_date', op: 'between', value: ["2026-09-01' OR '1'='1", null] }] })).status).toBe(400);
    // A filter value is a value, never SQL.
    const inj = await run(F.mgmt, { dataset: 'invoices', filters: [{ key: 'status', op: 'in', value: ["PAID') OR ('1'='1"] }] });
    expect(inj.status).toBe(200);
    expect(inj.body.count).toBe(0);
    // A seller cannot ask for a column it is not shown, or a dataset it is not offered.
    expect((await run(F.seller, { dataset: 'invoices', columns: ['invoice_no', 'trading_margin'] })).status).toBe(400);
    expect((await run(F.seller, { dataset: 'approvals' })).status).toBe(403);
    expect((await run(F.checker, { dataset: 'audit' })).status).toBe(403);
  });
});

describe('S69 REIA reports — whose rows', () => {
  it('keeps the other desks\' bills out of every REIA report', async () => {
    const r = await run(F.mgmt, { dataset: 'invoices' });
    expect(nos(r.body)).toEqual(['T-A1', 'T-A2', 'T-B1', 'T-X1', 'T-X2', 'T-Y1']);
    const p = await run(F.mgmt, { dataset: 'payments', columns: ['invoice_no', 'amount'] });
    expect(nos(p.body)).not.toContain('T-H1');
  });

  it('shows a seller its presented bills only, as the invoice list does', async () => {
    const r = await run(F.seller, { dataset: 'invoices' });
    expect(r.status).toBe(200);
    expect(nos(r.body)).toEqual(['T-A1']);
    expect(r.body.scope_note).toMatch(/your company/i);
    const p = await run(F.seller, { dataset: 'payments', columns: ['invoice_no', 'amount'] });
    expect(nos(p.body)).toEqual(['T-A1']);
  });

  it('shows a buyer its presented bills, disputes and non-draft contracts only', async () => {
    const r = await run(F.buyer, { dataset: 'invoices' });
    expect(nos(r.body)).toEqual(['T-X1']);
    const d = await run(F.buyer, { dataset: 'disputes', columns: ['dispute_no', 'invoice_no'] });
    expect(d.body.rows.map((x) => x.dispute_no)).toEqual(['DSP-T-1']);
    const c = await run(F.buyer, { dataset: 'contracts', columns: ['contract_no'] });
    expect(c.body.rows.map((x) => x.contract_no)).toEqual(['PSA/T/X']);
    const s = await run(F.seller, { dataset: 'disputes', columns: ['dispute_no'] });
    expect(s.body.count).toBe(0);
  });

  it('gives a seller and a buyer every report of their side, in their own words, each on their own rows', async () => {
    for (const [tok, side, own] of [[F.seller, 'SELLER', ['T-A1']], [F.buyer, 'BUYER', ['T-X1']]]) {
      const cat = (await request(app).get('/api/reports/reia/catalog').set(auth(tok))).body;
      expect(cat.side).toBe(side);
      expect(cat.presets).toHaveLength(12);
      expect([...new Set(cat.presets.map((p) => p.group))]).toEqual(['Billing', 'Money', 'Disputes', 'Energy and contracts', 'Security and reconciliation']);
      // The ageing preset groups by SJVN's "Counterparty", which a counterparty is not shown;
      // its own version groups by contract instead of dropping out of the list.
      const ageing = cat.presets.find((p) => p.id === (side === 'SELLER' ? 'ageing-developers' : 'ageing-buyers'));
      expect(ageing.title).toBe(side === 'SELLER' ? 'What SJVN owes you, by age' : 'What you owe SJVN, by age');
      expect(ageing.spec.group_by).toBe('contract_no');
      expect(ageing.spec.columns).not.toContain('counterparty_name');
      // Its scope already runs one way, so the presets carry no direction filter in SJVN's words.
      expect(cat.presets.flatMap((p) => p.spec.filters || []).map((f) => f.key)).not.toContain('direction');
      for (const p of cat.presets) {
        const r = await run(tok, p.spec);
        expect(r.status, p.id).toBe(200);
        expect(r.body.title).toBe(p.title);
        for (const no of nos(r.body).filter(Boolean)) expect(own, `${p.id}: ${no}`).toContain(no);
      }
    }
    // SJVN's own list keeps SJVN's words.
    const m = (await request(app).get('/api/reports/reia/catalog').set(auth(F.mgmt))).body;
    expect(m.side).toBeNull();
    expect(m.presets.find((p) => p.id === 'ageing-buyers').title).toBe('Outstanding and ageing — buyers');
  });

  it('offers a counterparty only its own values in a filter dropdown', async () => {
    const f = await request(app).get('/api/reports/reia/facets').query({ dataset: 'invoices' }).set(auth(F.seller));
    expect(f.status).toBe(200);
    expect(f.body.seller_name.map((o) => o.value)).toEqual(['Surya Alpha Pvt Ltd']);
    expect(f.body.contract_no.map((o) => o.value)).toEqual(['PPA/T/A']);
    expect(f.body.buyer_name).toBeUndefined();
  });

  it('narrows a REIA officer on selected projects to those projects', async () => {
    const r = await run(F.scoped, { dataset: 'invoices' });
    expect(nos(r.body)).toEqual(['T-X1', 'T-X2']);
    expect(r.body.scope_note).toMatch(/assigned projects/i);
    const free = await run(F.maker, { dataset: 'invoices' });
    expect(free.body.count).toBe(6);
  });
});

describe('S69 REIA reports — filters, grouping and totals', () => {
  it('filters on direction, status, dates, months, amounts, users, states and text', async () => {
    const by = async (filters) => nos((await run(F.mgmt, { dataset: 'invoices', filters })).body);
    expect(await by([{ key: 'direction', op: 'in', value: ['SJVN_TO_BUYER'] }])).toEqual(['T-X1', 'T-X2', 'T-Y1']);
    expect(await by([{ key: 'status', op: 'in', value: ['PAID', 'APPROVED'] }])).toEqual(['T-A1', 'T-B1', 'T-Y1']);
    expect(await by([{ key: 'billing_period', op: 'between', value: ['2026-09', '2026-09'] }])).toEqual(['T-A2', 'T-B1', 'T-X2', 'T-Y1']);
    expect(await by([{ key: 'due_date', op: 'between', value: ['2026-09-01', '2026-09-30'] }])).toEqual(['T-A1', 'T-X1']);
    expect(await by([{ key: 'bill_date', op: 'between', value: ['2026-09-01', '2026-09-30'] }])).toEqual(['T-A1', 'T-Y1']);
    expect(await by([{ key: 'total_amount', op: 'between', value: [2000000, 3000000] }])).toEqual(['T-B1', 'T-X1']);
    expect(await by([{ key: 'total_amount', op: 'between', value: [3050000, null] }])).toEqual(['T-X2', 'T-Y1']);
    expect(await by([{ key: 'created_by', op: 'in', value: ['Maker Two'] }])).toEqual(['T-B1', 'T-X2', 'T-Y1']);
    expect(await by([{ key: 'approved_by', op: 'in', value: ['Approver Three'] }])).toEqual(['T-A1']);
    expect(await by([{ key: 'counterparty_state', op: 'in', value: ['Haryana'] }])).toEqual(['T-Y1']);
    expect(await by([{ key: 'buyer_name', op: 'in', value: ['Vitaran X Ltd'] }])).toEqual(['T-X1', 'T-X2']);
    expect(await by([{ key: 'seller_name', op: 'in', value: ['Surya Beta Pvt Ltd'] }])).toEqual(['T-B1']);
    expect(await by([{ key: 'contract_no', op: 'in', value: ['PPA/T/A'] }])).toEqual(['T-A1', 'T-A2']);
    expect(await by([{ key: 'invoice_no', op: 'contains', value: 'x' }])).toEqual(['T-X1', 'T-X2']);
    // A figure worked after the query (the bill screen's balance) filters too.
    expect(await by([{ key: 'balance_due', op: 'between', value: [1, null] }])).toEqual(['T-B1', 'T-X1']);
    // Payment date lives on the payments report.
    const p = await run(F.mgmt, { dataset: 'payments', columns: ['invoice_no', 'amount'], filters: [{ key: 'payment_date', op: 'between', value: ['2026-10-01', '2026-10-31'] }] });
    expect(nos(p.body)).toEqual(['T-Y1']);
  });

  it('says the filters in the words a reader uses, on screen and at the top of a file', async () => {
    const r = await run(F.mgmt, { dataset: 'invoices', group_by: 'buyer_name', filters: [
      { key: 'bill_date', op: 'between', value: ['2026-04-01', '2027-03-31'] },
      { key: 'total_amount', op: 'between', value: [5000000, null] },
      { key: 'billing_period', op: 'between', value: [null, '2026-09'] },
      { key: 'direction', op: 'in', value: ['SJVN_TO_BUYER'] },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.criteria).toEqual([
      'Bill date: 1 Apr 2026 to 31 Mar 2027',
      'Bill amount: from ₹50,00,000',
      'Billing period: up to Sep 2026',
      'Direction: SJVN → Buyer (PSA sale)',
      'Grouped by Buyer / beneficiary',
    ]);
  });

  it('adds up: subtotals per group, a grand total, sorted as asked', async () => {
    const r = await run(F.mgmt, {
      dataset: 'invoices', columns: ['invoice_no', 'total_amount', 'paid_total', 'energy_mwh'],
      group_by: 'direction', sort: [{ key: 'total_amount', dir: 'desc' }],
    });
    expect(r.status).toBe(200);
    const g = Object.fromEntries(r.body.groups.map((x) => [x.key, x]));
    expect(g.SJVN_TO_BUYER.subtotals.total_amount).toBe(10100000);
    expect(g.SJVN_TO_BUYER.rows.map((x) => x.invoice_no)).toEqual(['T-Y1', 'T-X2', 'T-X1']);
    expect(g.SELLER_TO_SJVN.subtotals.total_amount).toBe(4100000);
    expect(g.SELLER_TO_SJVN.label).toMatch(/PPA/);
    expect(r.body.totals).toEqual({ total_amount: 14200000, paid_total: 5500000, energy_mwh: 4270 });
    expect(r.body.count).toBe(6);
  });

  it('gives one line per group in a summary, with only figures that add up', async () => {
    const r = await run(F.mgmt, {
      dataset: 'invoices', columns: ['invoice_no', 'status', 'total_amount'],
      group_by: 'billing_period', summary: true, sort: [{ key: 'billing_period', dir: 'desc' }],
    });
    expect(r.body.columns.map((c) => c.key)).toEqual(['billing_period', 'total_amount']);
    expect(r.body.groups.map((x) => [x.key, x.count, x.subtotals.total_amount, x.rows.length]))
      .toEqual([['2026-09', 4, 10200000, 0], ['2026-08', 2, 4000000, 0]]);
  });

  it('ages what is owed on the dashboard\'s own formula', async () => {
    const r = await run(F.mgmt, { dataset: 'outstanding', columns: ['invoice_no', 'direction', 'outstanding', 'days_0_30', 'days_31_60', 'days_61_90', 'days_90_plus', 'not_due'] });
    const recv = r.body.rows.filter((x) => x.direction === 'SJVN_TO_BUYER').reduce((s, x) => s + x.outstanding, 0);
    const pay = r.body.rows.filter((x) => x.direction === 'SELLER_TO_SJVN').reduce((s, x) => s + x.outstanding, 0);
    expect(recv).toBe(receivablesOutstanding('REIA'));
    expect(pay).toBe(payablesOutstanding('REIA'));
    expect(nos(r.body)).toEqual(['T-B1', 'T-X1']);
    // Each bill's amount sits in exactly one age column.
    for (const row of r.body.rows) {
      expect(row.not_due + row.days_0_30 + row.days_31_60 + row.days_61_90 + row.days_90_plus).toBe(row.outstanding);
    }
  });

  it('runs every preset it offers', async () => {
    const cat = await request(app).get('/api/reports/reia/catalog').set(auth(F.mgmt));
    for (const p of cat.body.presets) {
      const r = await run(F.mgmt, p.spec);
      expect(r.status, p.id).toBe(200);
      expect(r.body.title).toBe(p.title);
    }
  });
});

describe('S69 REIA reports — exports', () => {
  it('downloads CSV, Excel and PDF of the same report, and records each', async () => {
    const spec = { dataset: 'invoices', columns: ['invoice_no', 'direction', 'total_amount'], group_by: 'direction' };
    const csv = await run(F.mgmt, spec, 'csv');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="SJVN_REIA_Bills_register_/);
    expect(csv.text).toContain('Bill no.,Direction,Bill amount');
    expect(csv.text).toContain('Total (6 rows),,14200000');

    const xlsx = await run(F.mgmt, spec, 'xlsx').buffer(true).parse((res, cb) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');

    const pdf = await run(F.mgmt, spec, 'pdf').buffer(true).parse((res, cb) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const logged = db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action = 'REPORT_EXPORTED' AND entity_id = 'invoices'`).get().c;
    expect(logged).toBe(3);
    expect((await run(F.mgmt, spec, 'docx')).status).toBe(400);
  });

  it('exports a counterparty only its own rows', async () => {
    const csv = await run(F.seller, { dataset: 'invoices', columns: ['invoice_no', 'total_amount'] }, 'csv');
    expect(csv.text).toContain('T-A1');
    for (const other of ['T-A2', 'T-B1', 'T-X1', 'T-Y1']) expect(csv.text).not.toContain(other);
  });
});

describe('S69 REIA reports — saved reports', () => {
  it('saves a layout, shares it with the desk, and only its owner removes it', async () => {
    const spec = { dataset: 'invoices', columns: ['invoice_no', 'total_amount'], filters: [{ key: 'status', op: 'in', value: ['PAID'] }] };
    const save = await request(app).post('/api/reports/reia/templates').set(auth(F.mgmt)).send({ name: 'Paid bills', spec, shared: true });
    expect(save.status).toBe(201);
    const again = await request(app).post('/api/reports/reia/templates').set(auth(F.mgmt)).send({ name: 'paid bills', spec: { ...spec, columns: ['invoice_no'] }, shared: true });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(save.body.id);

    const mine = await request(app).get('/api/reports/reia/templates').set(auth(F.mgmt));
    expect(mine.body.map((t) => t.name)).toEqual(['Paid bills']);
    expect(mine.body[0].spec.columns).toEqual(['invoice_no']);
    expect(mine.body[0].mine).toBe(true);

    const theirs = await request(app).get('/api/reports/reia/templates').set(auth(F.checker));
    expect(theirs.body.map((t) => [t.name, t.mine])).toEqual([['Paid bills', false]]);
    const seller = await request(app).get('/api/reports/reia/templates').set(auth(F.seller));
    expect(seller.body).toEqual([]);

    expect((await request(app).delete(`/api/reports/reia/templates/${save.body.id}`).set(auth(F.checker))).status).toBe(404);
    expect((await request(app).delete(`/api/reports/reia/templates/${save.body.id}`).set(auth(F.mgmt))).status).toBe(200);
    expect((await request(app).get('/api/reports/reia/templates').set(auth(F.mgmt))).body).toEqual([]);
  });

  it('keeps a seller\'s saved report to that seller, even when it asks to share', async () => {
    const spec = { dataset: 'invoices', columns: ['invoice_no', 'balance_due'] };
    const save = await request(app).post('/api/reports/reia/templates').set(auth(F.seller)).send({ name: 'My open bills', spec, shared: true });
    expect(save.status).toBe(201);

    const mine = await request(app).get('/api/reports/reia/templates').set(auth(F.seller));
    expect(mine.body.map((t) => [t.name, t.mine, t.shared])).toEqual([['My open bills', true, false]]);
    expect((await request(app).get('/api/reports/reia/templates').set(auth(F.buyer))).body).toEqual([]);
    expect((await request(app).get('/api/reports/reia/templates').set(auth(F.mgmt))).body).toEqual([]);

    expect((await request(app).delete(`/api/reports/reia/templates/${save.body.id}`).set(auth(F.buyer))).status).toBe(404);
    expect((await request(app).delete(`/api/reports/reia/templates/${save.body.id}`).set(auth(F.seller))).status).toBe(200);
  });

  it('refuses a layout with no name or with keys off the list', async () => {
    expect((await request(app).post('/api/reports/reia/templates').set(auth(F.mgmt)).send({ name: '', spec: { dataset: 'invoices' } })).status).toBe(400);
    expect((await request(app).post('/api/reports/reia/templates').set(auth(F.mgmt)).send({ name: 'x', spec: { dataset: 'invoices', columns: ['nope'] } })).status).toBe(400);
    expect((await request(app).post('/api/reports/reia/templates').set(auth(F.seller)).send({ name: 'x', spec: { dataset: 'audit' } })).status).toBe(403);
  });
});
