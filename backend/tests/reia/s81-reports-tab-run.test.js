import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import PDFDocument from 'pdfkit';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { columnWidths } from '../../src/scripts/reiaReportPdf.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Found by running every report of the REIA Reports tab for every role
// (2-Nov-2026): the bills registers added drafts and cancelled bills into their
// totals, the security report counted closed instruments as held and gave them
// an expiry to watch, a release to a developer read as a raw code, and a wide
// PDF broke its amounts over two lines.

const run = (tok, spec, format = 'json') => request(app).get('/api/reports/reia/run')
  .query({ spec: JSON.stringify(spec), format }).set(auth(tok));
const preset = async (tok, id) => (await request(app).get('/api/reports/reia/catalog').set(auth(tok))).body.presets.find((p) => p.id === id);
const nos = (body) => (body.rows || body.groups.flatMap((g) => g.rows));
const dayIst = (n) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);

let checker;
beforeAll(() => {
  resetReia();
  const seller = makeEntity('SELLER', { name: 'S81 Surya Ltd' });
  const buyer = makeEntity('BUYER', { name: 'S81 Vitaran Ltd' });
  const ppa = makeContract({ contract_no: 'PPA/S81', contract_type: 'PPA', seller_id: seller.id, buyer_id: null, project_type: 'Solar' });
  const psa = makeContract({ contract_no: 'PSA/S81', contract_type: 'PSA', seller_id: null, buyer_id: buyer.id, project_type: 'Solar' });
  for (const [no, status] of [['S81-PSA-SENT', 'SENT'], ['S81-PSA-PAID', 'PAID'], ['S81-PSA-DRAFT', 'DRAFT'], ['S81-PSA-CANCELLED', 'CANCELLED']]) {
    makeInvoice({ invoice_no: no, contract_id: psa.id, direction: 'SJVN_TO_BUYER', status, total_amount: 1000000, billing_period: '2026-09' });
  }
  for (const [no, status] of [['S81-PPA-SUBMITTED', 'SUBMITTED'], ['S81-PPA-APPROVAL', 'UNDER_APPROVAL'], ['S81-PPA-PAID', 'PAID'], ['S81-PPA-DRAFT', 'DRAFT'], ['S81-PPA-REJECTED', 'REJECTED']]) {
    makeInvoice({ invoice_no: no, contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status, total_amount: 900000, billing_period: '2026-09' });
  }
  const paid = db.prepare("SELECT * FROM invoices WHERE invoice_no = 'S81-PPA-PAID'").get();
  db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference) VALUES (?, ?, 900000, ?, 'RELEASE:OWN_FUND', 'UTR-S81')`)
    .run(newId('PAY'), paid.id, dayIst(-2));
  const lc = (no, status, days) => db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, entity_id, mechanism_type, limit_amount, available_amount, validity_start, validity_end, status)
    VALUES (?, ?, ?, ?, 'LC', 5000000, 5000000, '2026-04-01', ?, ?)`).run(newId('PS'), no, psa.id, buyer.id, dayIst(days), status);
  lc('S81-LC-LIVE', 'ACTIVE', 45);
  lc('S81-LC-CLOSED', 'CLOSED', 45);
  lc('S81-LC-RELEASED', 'RELEASED', 200);
  checker = tokenFor('REIA_CHECKER');
});

describe('S81 the bills registers', () => {
  it('list the bills SJVN issued, not its drafts or cancelled ones', async () => {
    const r = await run(checker, (await preset(checker, 'bills-psa')).spec);
    expect(nos(r.body).map((x) => x.invoice_no).sort()).toEqual(['S81-PSA-PAID', 'S81-PSA-SENT']);
    expect(r.body.totals.total_amount).toBe(2000000);
  });

  it("list the developers' bills SJVN has received, from submission on", async () => {
    const r = await run(checker, (await preset(checker, 'bills-ppa')).spec);
    expect(nos(r.body).map((x) => x.invoice_no).sort()).toEqual(['S81-PPA-APPROVAL', 'S81-PPA-PAID', 'S81-PPA-SUBMITTED']);
  });

  it('still show a draft to a desk that asks for it in a report of its own', async () => {
    const r = await run(checker, { dataset: 'invoices', filters: [{ key: 'status', op: 'in', value: ['DRAFT'] }] });
    expect(nos(r.body).map((x) => x.invoice_no).sort()).toEqual(['S81-PPA-DRAFT', 'S81-PSA-DRAFT']);
  });
});

describe('S81 payment security', () => {
  it('reports the instruments held, and their limit alone', async () => {
    const r = await run(checker, (await preset(checker, 'security')).spec);
    expect(nos(r.body).map((x) => x.instrument_no)).toEqual(['S81-LC-LIVE']);
    expect(r.body.totals.limit_amount).toBe(5000000);
  });

  it('gives a closed or released instrument no expiry to watch', async () => {
    const r = await run(checker, { dataset: 'security', columns: ['instrument_no', 'days_to_expiry', 'expiry_bucket'] });
    const by = Object.fromEntries(r.body.rows.map((x) => [x.instrument_no, x]));
    expect(by['S81-LC-LIVE']).toMatchObject({ expiry_bucket: 'DAYS_31_60', days_to_expiry: 45 });
    expect(by['S81-LC-CLOSED']).toMatchObject({ expiry_bucket: 'NOT_HELD', days_to_expiry: null });
    expect(by['S81-LC-RELEASED'].expiry_bucket).toBe('NOT_HELD');
    expect(r.body.columns.find((c) => c.key === 'expiry_bucket').labels.NOT_HELD).toBe('No longer held');
  });
});

describe('S81 how a payment was made', () => {
  it('names a release to a developer in words, on screen and in the CSV', async () => {
    const r = await run(checker, { dataset: 'payments', columns: ['invoice_no', 'mode'] });
    expect(r.body.columns.find((c) => c.key === 'mode').labels['RELEASE:OWN_FUND']).toBe('Release to developer — SJVN own fund');
    const csv = await run(checker, { dataset: 'payments', columns: ['invoice_no', 'mode'] }, 'csv');
    expect(csv.text).toContain('Release to developer — SJVN own fund');
    expect(csv.text).not.toContain('RELEASE:');
  });
});

describe('S81 a wide PDF', () => {
  it('gives each amount the room to print on one line', () => {
    // The shape of "Profit and loss, bill by bill": 17 columns, four of them
    // in crores, the rest lakhs or nothing.
    const doc = new PDFDocument({ layout: 'landscape', size: 'A4' });
    const big = ['sale', 'cost', 'net', 'after'];
    const small = ['spread', 'lps_in', 'rebate_out', 'rebate_in', 'lps_out', 'notes', 'funding'];
    const cols = [
      { key: 'invoice_no', label: 'Bill no.', type: 'text' },
      { key: 'period', label: 'Billing period', type: 'month' },
      { key: 'kind', label: 'Bill kind', type: 'enum' },
      { key: 'mwh', label: 'Energy sold (MWh)', type: 'mwh', agg: 'sum' },
      ...[...big, ...small].map((k) => ({ key: k, label: `${k} amount`, type: 'money', agg: 'sum' })),
      { key: 'basis', label: 'Purchase priced on', type: 'enum' },
      { key: 'days', label: 'Days SJVN funded', type: 'days' },
    ];
    const figures = (b, sm) => Object.fromEntries([...big.map((k) => [k, b]), ...small.map((k) => [k, sm])]);
    const row = { invoice_no: 'INV-PSA/2026/000003', period: '2026-09', kind: 'Energy bill', mwh: 7920, basis: "Developers' bills", days: 30, ...figures(22334400, 326700) };
    const total = { __kind: 'total', __label: 'Total (3)', mwh: 23760, ...figures(67003200, 795888) };
    const widths = columnWidths(doc, cols, [row, total], 6, 770);
    expect(Math.round(widths.reduce((a, b) => a + b, 0))).toBe(770);
    doc.font('Helvetica-Bold').fontSize(6);
    const fits = (i, text) => expect(widths[i], `${cols[i].key} fits "${text}"`).toBeGreaterThanOrEqual(doc.widthOfString(text) + 8);
    cols.forEach((c, i) => { if (big.includes(c.key)) fits(i, 'Rs 6,70,03,200'); });
    // A heading's longest word fits too ("funded", not "funde / d").
    fits(cols.length - 1, 'funded');
    fits(3, 'Energy');
  });
});
