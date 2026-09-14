import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { financialYear } from '../../src/services/cercCompliance.js';

// Two desk-wide views that existed only one record at a time, or not at all:
// which developer bills are stuck in verification and on what, and which CERC
// returns are owed — including the periods nobody has started, which a register
// of prepared filings cannot show.

let reia, seller, contract;

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM cerc_form_iv').run();
  try { db.prepare('DELETE FROM bids').run(); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM bilateral_transactions').run(); } catch { /* ignore */ }
  reia = tokenFor('REIA_USER');
  seller = makeEntity('SELLER', { name: 'Test Solar Ltd' });
  contract = makeContract({
    seller_id: seller.id, status: 'ACTIVE', contract_no: 'PPA/VER/001',
    project_type: 'Solar', capacity_mw: 100, tariff_per_unit: 3, cod_date: '2026-01-01',
  });
});

const queue = (query = '') => request(app).get(`/api/reports/verification-queue${query}`).set(auth(reia));
const cerc = (query = '') => request(app).get(`/api/reports/cerc-compliance${query}`).set(auth(reia));

describe('S33 Verification queue', () => {
  it('lists developer bills with the checklist the invoice screen draws', async () => {
    const inv = makeInvoice({
      contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED',
      billing_period: '2026-08', total_amount: 500000, energy_charges: 500000, tariff_per_unit: 3,
    });
    const r = await queue();
    expect(r.status).toBe(200);
    const row = r.body.invoices.find((i) => i.invoice_id === inv.id);
    expect(row).toBeTruthy();
    expect(row).toMatchObject({ contract_no: 'PPA/VER/001', developer_name: 'Test Solar Ltd', billing_period: '2026-08' });
    expect(row.technical.map((t) => t.key)).toContain('TARIFF_VERIFIED');
    // The tariff matches the contract, so that check answers itself.
    expect(row.technical.find((t) => t.key === 'TARIFF_VERIFIED').status).toBe('VERIFIED');
  });

  it('names what each bill is stuck on', async () => {
    // Billed at a tariff the contract does not carry: the technical check fails.
    makeInvoice({
      contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED',
      billing_period: '2026-08', total_amount: 500000, tariff_per_unit: 9.9,
    });
    const { body } = await queue();
    const row = body.invoices[0];
    expect(row.verification_status).toBe('FAILED');
    expect(row.failed_checks).toContain('Tariff Verified');
    expect(body.totals.failed).toBe(1);
  });

  it('says which check is holding the most bills up', async () => {
    for (const period of ['2026-06', '2026-07', '2026-08']) {
      makeInvoice({
        contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED',
        billing_period: period, total_amount: 100000, tariff_per_unit: 9.9,
      });
    }
    const { body } = await queue();
    // Every one of the three fails on the tariff and on the missing REA, so both
    // are named with a count of three, worst first.
    const tariff = body.blockers.find((b) => b.label === 'Tariff Verified');
    expect(tariff).toMatchObject({ invoices_blocked: 3 });
    expect(body.blockers[0].invoices_blocked).toBe(3);
    const counts = body.blockers.map((b) => b.invoices_blocked);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('carries the commercial build-up and the gap to what was billed', async () => {
    const inv = makeInvoice({
      contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED',
      billing_period: '2026-08', total_amount: 600000, energy_charges: 500000, tariff_per_unit: 3,
    });
    const { body } = await queue();
    const row = body.invoices.find((i) => i.invoice_id === inv.id);
    expect(row.commercial.energy_charges).toBe(500000);
    // Raised for 6 lakh against a 5 lakh build-up: a lakh that has to be explained.
    expect(row.commercial_gap).toBe(-100000);
  });

  it('keeps a verifier’s saved answer rather than recomputing over it', async () => {
    const inv = makeInvoice({
      contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED',
      billing_period: '2026-08', total_amount: 500000, tariff_per_unit: 9.9,
    });
    const saved = await request(app).post(`/api/invoices/${inv.id}/verification`).set(auth(reia)).send({
      technical: [{ key: 'TARIFF_VERIFIED', status: 'VERIFIED', note: 'Revised tariff order 12/2026' }],
      commercial: {},
    });
    expect(saved.status).toBe(200);

    const { body } = await queue();
    const row = body.invoices.find((i) => i.invoice_id === inv.id);
    expect(row.technical.find((t) => t.key === 'TARIFF_VERIFIED').status).toBe('VERIFIED');
    expect(row.technical.find((t) => t.key === 'TARIFF_VERIFIED').note).toMatch(/Revised tariff order/);
  });

  it('leaves out bills nobody is waiting on, and buyer bills entirely', async () => {
    makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'PAID', billing_period: '2026-05', total_amount: 1 });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-05', total_amount: 1 });
    const { body } = await queue();
    expect(body.invoices).toHaveLength(0);
    // Asked for explicitly, a settled bill is still readable.
    const withClosed = await queue('?include_closed=true');
    expect(withClosed.body.invoices.length).toBeGreaterThan(0);
  });

  it('filters to one state and refuses one it does not have', async () => {
    makeInvoice({
      contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED',
      billing_period: '2026-08', total_amount: 500000, tariff_per_unit: 9.9,
    });
    expect((await queue('?status=FAILED')).body.invoices).toHaveLength(1);
    expect((await queue('?status=VERIFIED')).body.invoices).toHaveLength(0);
    const bad = await queue('?status=MAYBE');
    expect(bad.status).toBe(400);
  });

  it('is not a counterparty’s to read', async () => {
    const sellerUser = tokenFor('SELLER', { linked_entity_id: seller.id });
    expect((await request(app).get('/api/reports/verification-queue').set(auth(sellerUser))).status).toBe(403);
  });
});

describe('S33 CERC filing calendar', () => {
  const putFiling = (period, status, over = {}) => db.prepare(`
    INSERT INTO cerc_form_iv (id, form_no, period_type, period, status, due_date, breach_count, total_volume_mu, submission_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId('FIV'), `FIV-${period}-${status}`, over.period_type || 'MONTHLY', period, status,
    over.due_date || null, over.breach_count ?? 0, over.total_volume_mu ?? 0, over.submission_date || null);

  const mkBid = (deliveryDate) => {
    const clientId = newId('TCL');
    db.prepare("INSERT INTO trading_clients (id, name, client_type, status) VALUES (?, 'Cal Client', 'DISCOM', 'ACTIVE')").run(clientId);
    db.prepare(`
      INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, status)
      VALUES (?, ?, 'IEX', 'DAM', ?, ?, 10, 4, 'CLEARED')
    `).run(newId('BID'), clientId, deliveryDate, deliveryDate);
  };

  it('names the financial year a month belongs to', () => {
    expect(financialYear('2026-04')).toBe('2026-27');
    expect(financialYear('2027-03')).toBe('2026-27');
    expect(financialYear('2026-03')).toBe('2025-26');
  });

  it('walks the calendar from the first traded month, so a month nobody started shows as missing', async () => {
    mkBid('2026-06-10');
    putFiling('2026-06', 'SUBMITTED', { submission_date: '2026-07-20' });

    const r = await cerc();
    expect(r.status).toBe(200);
    const june = r.body.monthly.find((m) => m.period === '2026-06');
    const july = r.body.monthly.find((m) => m.period === '2026-07');
    expect(june).toMatchObject({ status: 'SUBMITTED', overdue: false });
    // Nobody prepared July: a register of filings would have shown nothing at all.
    expect(july).toMatchObject({ status: 'MISSING' });
    expect(r.body.totals.missing).toBeGreaterThanOrEqual(1);
  });

  it('works out each period’s deadline and whether it has passed', async () => {
    mkBid('2026-06-10');
    const { body } = await cerc();
    const june = body.monthly.find((m) => m.period === '2026-06');
    // Period end plus the configured grace days (30 by default).
    expect(june.period_to).toBe('2026-06-30');
    expect(june.due_date).toBe('2026-07-30');
    expect(june.overdue).toBe(true);
    expect(june.days_past_due).toBeGreaterThan(0);
  });

  it('does not call the current month late before it has ended', async () => {
    mkBid('2026-06-10');
    const { body } = await cerc();
    const thisMonth = new Date().toISOString().slice(0, 7);
    expect(body.monthly.some((m) => m.period === thisMonth)).toBe(false);
  });

  it('counts margin breaches on a filing that was submitted on time', async () => {
    mkBid('2026-06-10');
    putFiling('2026-06', 'SUBMITTED', { breach_count: 3, submission_date: '2026-07-01' });
    const { body } = await cerc();
    expect(body.totals.open_breaches).toBe(3);
    expect(body.monthly.find((m) => m.period === '2026-06').breach_count).toBe(3);
  });

  it('owes an annual return once the financial year has ended', async () => {
    mkBid('2024-06-10');
    const { body } = await cerc();
    // FY 2024-25 ended well before today, so it is owed and nobody filed it.
    const fy = body.annual.find((a) => a.period === '2024-25');
    expect(fy).toMatchObject({ period_type: 'ANNUAL', status: 'MISSING', period_from: '2024-04-01', period_to: '2025-03-31' });
  });

  it('answers for a window the desk asks for', async () => {
    mkBid('2026-01-10');
    const { body } = await cerc('?from=2026-05&to=2026-07');
    expect(body.monthly.map((m) => m.period).sort()).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('says nothing is owed when nothing has been traded', async () => {
    const { body } = await cerc();
    expect(body.monthly).toEqual([]);
    expect(body.note).toMatch(/Nothing has been traded yet/);
  });

  it('is not a counterparty’s to read', async () => {
    const sellerUser = tokenFor('SELLER', { linked_entity_id: seller.id });
    expect((await request(app).get('/api/reports/cerc-compliance').set(auth(sellerUser))).status).toBe(403);
  });
});
