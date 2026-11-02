import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { costOfFundsPct } from '../../src/services/reiaReports.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Beneficiary profit and loss (2-Nov-2026): what SJVN made or lost on each
// buyer — the spread on the energy, surcharge and rebate both ways, notes, and
// the cost of paying the developer before the buyer paid. One beneficiary
// carries one of everything, so each figure is pinned to a number worked by hand.

const run = (tok, spec) => request(app).get('/api/reports/reia/run').query({ spec: JSON.stringify(spec) }).set(auth(tok));
const sys = JSON.stringify([{ code: 'ENERGY', value: 1 }]);
const pay = (invoice, amount, date, extra = {}) => db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, lps_component, rebate_amount)
  VALUES (?, ?, ?, ?, 'NEFT', ?, ?, ?)`).run(newId('PAY'), invoice.id, amount, date, `UTR-${invoice.invoice_no}`, extra.lps || 0, extra.rebate || 0);
const note = (invoice, type, amount, status = 'ISSUED') => db.prepare(`INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month, reason_code, amount, status, model)
  VALUES (?, ?, ?, ?, ?, ?, 'OTHER', ?, ?, 'V2')`).run(newId('DCN'), `N-${newId('X')}`, type, invoice.id, invoice.contract_id, invoice.billing_period, amount, status);
function setCostOfFunds(v) {
  db.prepare("DELETE FROM system_parameters WHERE param_key = 'reia_cost_of_funds_pct'").run();
  db.prepare(`INSERT INTO system_parameters (id, category, param_key, param_value, data_type, is_active, effective_from)
    VALUES (?, 'BILLING', 'reia_cost_of_funds_pct', ?, 'TEXT', 1, '2026-01-01')`).run(newId('PRM'), v);
}

let admin;
beforeAll(() => {
  resetReia();
  const seller = makeEntity('SELLER', { name: 'S80 Surya Ltd' });
  const buyerX = makeEntity('BUYER', { name: 'S80 Vitaran X' });
  const buyerY = makeEntity('BUYER', { name: 'S80 Vitaran Y' });
  db.prepare("UPDATE entities SET state = 'Punjab' WHERE id IN (?, ?)").run(buyerX.id, buyerY.id);

  const ppa = makeContract({ contract_no: 'PPA/S80/A', contract_type: 'PPA', seller_id: seller.id, buyer_id: null, project_type: 'Solar', tariff_per_unit: 3 });
  const psaX = makeContract({ contract_no: 'PSA/S80/X', contract_type: 'PSA', seller_id: null, buyer_id: buyerX.id, project_type: 'Solar', tariff_per_unit: 3.07, trading_margin_per_mwh: 70 });
  const psaY = makeContract({ contract_no: 'PSA/S80/Y', contract_type: 'PSA', seller_id: null, buyer_id: buyerY.id, project_type: 'Solar', trading_margin_per_mwh: 70 });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`)
    .run(newId('ALC'), ppa.id, psaX.id);

  // The developer's month: 1,000 MWh at ₹3, paid on 10 Sep with a 1.5% rebate
  // taken and ₹2,000 of surcharge paid on an earlier slip.
  const ppaBill = makeInvoice({ invoice_no: 'S80-PPA-08', contract_id: ppa.id, direction: 'SELLER_TO_SJVN', billing_period: '2026-08', invoice_type: 'FINAL',
    energy_mwh: 1000, tariff_per_unit: 3, energy_charges: 3000000, total_amount: 3000000, rebate: 45000, status: 'PAID', invoice_breakdown_json: sys });
  pay(ppaBill, 2957000, '2026-09-10', { rebate: 45000, lps: 2000 });

  // Buyer X: a provisional (rebate ₹10,000 on it) the final replaced, then the
  // final — 1,000 MWh, ₹70,000 margin — paid on 10 Oct with ₹12,000 surcharge,
  // and a ₹5,000 credit note from a dispute. A draft debit note counts for nothing.
  const prov = makeInvoice({ invoice_no: 'S80-X-PROV', contract_id: psaX.id, billing_period: '2026-08', invoice_type: 'PROVISIONAL',
    energy_mwh: 900, energy_charges: 2700000, trading_margin: 63000, total_amount: 2763000, rebate: 10000, status: 'PAID', invoice_breakdown_json: sys });
  pay(prov, 2753000, '2026-09-05', { rebate: 10000 });
  const fin = makeInvoice({ invoice_no: 'S80-X-FINAL', contract_id: psaX.id, billing_period: '2026-08', invoice_type: 'FINAL',
    energy_mwh: 1000, energy_charges: 3000000, trading_margin: 70000, total_amount: 3070000, status: 'PAID', invoice_breakdown_json: sys });
  pay(fin, 329000, '2026-10-10', { lps: 12000 });
  note(fin, 'CREDIT', 5000);
  note(fin, 'DEBIT', 99999, 'DRAFT');

  // Buyer Y: one bill with no source PPA on record (priced on its own
  // pass-through) and one wholly reversed by credit notes (no sale at all).
  const y1 = makeInvoice({ invoice_no: 'S80-Y-1', contract_id: psaY.id, billing_period: '2026-09', energy_mwh: 500, energy_charges: 1500000,
    trading_margin: 35000, total_amount: 1535000, status: 'SENT', due_date: '2099-01-01', invoice_breakdown_json: sys });
  const y2 = makeInvoice({ invoice_no: 'S80-Y-2', contract_id: psaY.id, billing_period: '2026-10', energy_mwh: 800, energy_charges: 2400000,
    trading_margin: 56000, total_amount: 2456000, status: 'PAID', invoice_breakdown_json: sys });
  note(y2, 'CREDIT', 2456000);
  // A draft is not in the books.
  makeInvoice({ invoice_no: 'S80-Y-DRAFT', contract_id: psaY.id, billing_period: '2026-11', energy_mwh: 100, energy_charges: 300000, trading_margin: 7000, total_amount: 307000, status: 'DRAFT' });
  void y1;

  admin = tokenFor('SJVN_ADMIN');
});

beforeEach(() => setCostOfFunds('9'));

describe('S80 beneficiary profit and loss', () => {
  it('works each figure for a beneficiary by hand', async () => {
    const r = await run(admin, { dataset: 'beneficiary_pnl', group_by: 'buyer_name', summary: true });
    expect(r.status).toBe(200);
    const x = r.body.groups.find((g) => g.label === 'S80 Vitaran X').subtotals;
    // 30 days funded (10 Sep → 10 Oct) on ₹30 lakh at 9%: ₹22,191.78.
    const funding = Math.round(3000000 * 30 * 0.09 / 365 * 100) / 100;
    expect(x).toMatchObject({
      energy_mwh: 1000,              // the provisional's 900 MWh are in the final
      sale_value: 3070000,
      cost_of_power: 3000000,        // the developer's bill: 1,000 MWh at ₹3,000/MWh
      energy_spread: 70000,
      lps_from_buyer: 12000,
      rebate_to_buyer: 10000,        // given on the provisional, so it still counts
      rebate_from_developer: 45000,
      lps_to_developer: 2000,
      notes_net: -5000,              // the credit note; the draft debit note is not issued
      net_gain: 110000,              // 70,000 + 12,000 + 45,000 − 10,000 − 2,000 − 5,000
      outstanding: 0,
      funding_cost: funding,
      net_after_funding: Math.round((110000 - funding) * 100) / 100,
    });
  });

  it('prices a bill with no developer bill on its pass-through, and leaves out a reversed bill and a draft', async () => {
    const r = await run(admin, { dataset: 'beneficiary_pnl', columns: ['invoice_no', 'bill_kind', 'cost_basis', 'energy_spread', 'margin_billed', 'outstanding', 'funded_days'] });
    const rows = Object.fromEntries(r.body.rows.map((x) => [x.invoice_no, x]));
    expect(Object.keys(rows).sort()).toEqual(['S80-X-FINAL', 'S80-X-PROV', 'S80-Y-1']);
    expect(rows['S80-X-PROV']).toMatchObject({ bill_kind: 'PROVISIONAL_SUPERSEDED', energy_spread: 0 });
    expect(rows['S80-X-FINAL']).toMatchObject({ bill_kind: 'ENERGY', cost_basis: 'PPA_BILLS', funded_days: 30 });
    expect(rows['S80-Y-1']).toMatchObject({ cost_basis: 'PASS_THROUGH', energy_spread: 35000, margin_billed: 35000, outstanding: 1535000, funded_days: 0 });
    // The codes read as words on screen and in the files.
    const kind = r.body.columns.find((c) => c.key === 'bill_kind');
    expect(kind.labels.PROVISIONAL_SUPERSEDED).toBe('Provisional (final raised)');
  });

  it('totals by month and by state to the same net', async () => {
    const byBuyer = (await run(admin, { dataset: 'beneficiary_pnl', group_by: 'buyer_name', summary: true })).body.totals.net_gain;
    const byMonth = await run(admin, { dataset: 'beneficiary_pnl', group_by: 'billing_period', summary: true });
    const byState = await run(admin, { dataset: 'beneficiary_pnl', group_by: 'buyer_state', summary: true });
    expect(byMonth.body.totals.net_gain).toBe(byBuyer);
    expect(byState.body.totals.net_gain).toBe(byBuyer);
    expect(byState.body.groups.map((g) => g.label)).toEqual(['Punjab']);
    // Newest month first, as the dataset sorts.
    expect(byMonth.body.groups.map((g) => g.key)).toEqual(['2026-09', '2026-08']);
    const fy = await run(admin, { dataset: 'beneficiary_pnl', group_by: 'financial_year', summary: true });
    expect(fy.body.groups.map((g) => g.key)).toEqual(['2026-27']);
  });

  it("takes SJVN's cost of funds from the master, or SBI MCLR (LPS base less 5%) when it is blank", async () => {
    setCostOfFunds('');
    const lps = Number(db.prepare("SELECT param_value FROM system_parameters WHERE param_key = 'lps_annual_pct'").get()?.param_value ?? 15);
    expect(costOfFundsPct()).toBe(Math.max(0, lps - 5));
    setCostOfFunds('7.25');
    expect(costOfFundsPct()).toBe(7.25);
  });

  it('is SJVN\'s book: offered to the desk as presets, never to a buyer or seller', async () => {
    const cat = (await request(app).get('/api/reports/reia/catalog').set(auth(admin))).body;
    expect(cat.presets.filter((p) => p.group === 'Profit and loss').map((p) => p.id))
      .toEqual(['pnl-beneficiary', 'pnl-monthly', 'pnl-state', 'pnl-bills']);
    const buyer = tokenFor('BUYER', { linked_entity_id: db.prepare("SELECT id FROM entities WHERE name = 'S80 Vitaran X'").get().id });
    const asBuyer = await run(buyer, { dataset: 'beneficiary_pnl' });
    expect(asBuyer.status).toBe(403);
    const buyerCat = (await request(app).get('/api/reports/reia/catalog').set(auth(buyer))).body;
    expect(buyerCat.datasets.map((d) => d.key)).not.toContain('beneficiary_pnl');
  });
});
