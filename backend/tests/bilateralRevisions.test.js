import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import { computeBilateralSettlement, buildBilateralInvoice } from '../src/services/bilateralSettlement.js';
import { raiseInvoice } from '../src/services/billingRegister.js';
import { addRateRevision, setBuyerSplit, removeRateRevision } from '../src/services/bilateralRevisions.js';
import { tokenFor, auth } from './helpers/reia.js';

// A bilateral deal partway through its term: a rate revised from a date, and
// power split between buyers (PT #19). A transaction carried one rate and one
// buyer for its whole life, so a rate amended from the 4th was billed at one
// rate or the other for the whole week, and a seller's power shared 60/40
// between two DISCOMs could only be billed to one of them.
//
// Every day below delivers one block at 100 MW: 25 MWh, 25,000 kWh.

const TX = 'BIL-REVISE-TEST';
const DAYS = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];

function makeTransaction(overrides = {}) {
  for (const t of ['view_bill_invoices', 'bilateral_rate_revisions', 'bilateral_buyer_splits', 'bilateral_schedules']) {
    db.prepare(`DELETE FROM ${t} WHERE ${t === 'view_bill_invoices' ? 'bilateral_id' : 'transaction_id'} = ?`).run(TX);
  }
  db.prepare('DELETE FROM bilateral_transactions WHERE id = ?').run(TX);
  const row = {
    id: TX,
    counterparty: 'New Delhi Municipal Council',
    quantum_mw: 100,
    tariff_per_unit: 4.5,
    purchase_rate_per_unit: 4.47,
    sale_rate_per_unit: 4.5,
    trading_margin_per_unit: 0.03,
    start_date: '2026-09-01',
    end_date: '2026-09-07',
    procurer_name: 'New Delhi Municipal Council',
    procurer_sldc: 'Delhi',
    supplier_sldc: 'West Bengal',
    open_access_status: 'APPROVED',
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO bilateral_transactions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  for (const date of DAYS) {
    db.prepare(`
      INSERT INTO bilateral_schedules (id, transaction_id, schedule_date, time_block, approved_mw, curtailed_mw, actual_mw, dsm_penalty_amount, status)
      VALUES (?, ?, ?, '00:00-00:15', 100, 0, 100, 0, 'APPROVED')
    `).run(newId('SCH'), TX, date);
  }
  return row;
}

const REVISION = { effective_from: '2026-09-04', sale_rate_per_unit: 4.8, purchase_rate_per_unit: 4.77, reason: 'Amendment No. 2 to the LoA, rate revised w.e.f. 4 Sep' };
const SPLIT = {
  effective_from: '2026-09-01',
  buyers: [
    { buyer_name: 'Delhi DISCOM A', drawal_state: 'Delhi', share_percent: 60 },
    { buyer_name: 'Haryana DISCOM B', drawal_state: 'Haryana', share_percent: 40 },
  ],
};

beforeEach(() => {
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  makeTransaction();
});

describe('A rate revised partway through the period', () => {
  it('prices each stretch at the rate that applied to it', () => {
    addRateRevision(TX, REVISION, 'Desk');
    const s = computeBilateralSettlement({ transaction_id: TX });

    expect(s.rate_segments.map((g) => [g.from, g.to, g.sale_rate_per_unit, g.delivered_mwh, g.sale_value])).toEqual([
      ['2026-09-01', '2026-09-03', 4.5, 75, 337500],
      ['2026-09-04', '2026-09-07', 4.8, 100, 480000],
    ]);
    expect(s.money).toMatchObject({ sale_value: 817500, trading_margin: 5250, purchase_value: 812250 });
    // The register's single rate is the energy-weighted average, and says so.
    expect(s.rates).toMatchObject({ sale_rate_per_unit: 4.6714, is_average: true });
  });

  it('bills both rates line by line, never a blended one', () => {
    addRateRevision(TX, REVISION, 'Desk');
    const bill = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' });
    expect(bill.line_items.map((l) => [l.description, l.quantity, l.rate, l.amount])).toEqual([
      ['Energy charges, 2026-09-01 to 2026-09-03', 75, 4.5, 337500],
      ['Energy charges, 2026-09-04 to 2026-09-07', 100, 4.8, 480000],
    ]);
    expect(bill.warnings.join(' ')).toMatch(/revised within the period/);
  });

  it('leaves a period before the revision at the contract rate', () => {
    addRateRevision(TX, REVISION, 'Desk');
    const s = computeBilateralSettlement({ transaction_id: TX, from: '2026-09-01', to: '2026-09-03' });
    expect(s.rate_segments).toHaveLength(1);
    expect(s.rates).toMatchObject({ sale_rate_per_unit: 4.5, is_average: false });
    expect(s.money.sale_value).toBe(337500);
  });

  it('settles a transaction with no revision exactly as before', () => {
    const s = computeBilateralSettlement({ transaction_id: TX });
    expect(s.money.sale_value).toBe(787500);
    expect(s.rate_segments).toHaveLength(1);
    expect(s.split).toBeNull();
    const bill = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' });
    expect(bill.line_items[0].description).toBe('Energy charges');
  });

  it('asks for what a revision cannot stand without', () => {
    const tryRev = (body) => { try { addRateRevision(TX, body, 'Desk'); return null; } catch (e) { return e; } };
    expect(tryRev({ ...REVISION, reason: '' }).message).toMatch(/Say why the rate changed/);
    expect(tryRev({ ...REVISION, purchase_rate_per_unit: 4.5, trading_margin_per_unit: 0.03 }).message).toMatch(/must equal trading_margin/);
    expect(tryRev({ ...REVISION, effective_from: '2026-10-01' }).message).toMatch(/outside the transaction's term/);
    expect(tryRev({ ...REVISION, effective_from: '2026-09-01' }).message).toMatch(/change the contract's rates instead/);
    addRateRevision(TX, REVISION, 'Desk');
    expect(tryRev(REVISION).status).toBe(409);
  });

  it('will not reach back into a period already billed FINAL, but a provisional bill does not stop it', () => {
    // Provisional: one block unmetered.
    db.prepare("UPDATE bilateral_schedules SET actual_mw = NULL WHERE transaction_id = ? AND schedule_date = '2026-09-07'").run(TX);
    raiseInvoice({ bill_type: 'BILATERAL_ENERGY', priced: buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' }), bilateral_id: TX });
    expect(() => addRateRevision(TX, REVISION, 'Desk')).not.toThrow();

    // Final: every block metered, bill raised, and the revision cannot then be taken back.
    db.prepare("UPDATE bilateral_schedules SET actual_mw = 100 WHERE transaction_id = ?").run(TX);
    raiseInvoice({ bill_type: 'BILATERAL_ENERGY', priced: buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' }), bilateral_id: TX });
    const revisionId = db.prepare('SELECT id FROM bilateral_rate_revisions WHERE transaction_id = ?').get(TX).id;
    let err;
    try { removeRateRevision(TX, revisionId); } catch (e) { err = e; }
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/billed FINAL/);
  });
});

describe('Power split between buyers', () => {
  it('gives each buyer its share of every day, and lists them beside the whole', () => {
    setBuyerSplit(TX, SPLIT, 'Desk');
    const whole = computeBilateralSettlement({ transaction_id: TX });
    expect(whole.money.sale_value).toBe(787500);
    expect(whole.split.buyers.map((b) => [b.buyer_name, b.delivered_mwh, b.sale_value, b.share_of_energy_percent])).toEqual([
      ['Delhi DISCOM A', 105, 472500, 60],
      ['Haryana DISCOM B', 70, 315000, 40],
    ]);

    const b = computeBilateralSettlement({ transaction_id: TX, buyer: 'Haryana DISCOM B' });
    expect(b).toMatchObject({ buyer: 'Haryana DISCOM B' });
    expect(b.energy.delivered_mwh).toBe(70);
    expect(b.money.sale_value).toBe(315000);
  });

  it('will not bill a split transaction whole, and bills each buyer its own energy and open access', () => {
    setBuyerSplit(TX, SPLIT, 'Desk');
    expect(() => buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY' })).toThrow(/split between Delhi DISCOM A, Haryana DISCOM B/);

    const energyB = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY', options: { buyer: 'Haryana DISCOM B' } });
    expect(energyB).toMatchObject({ client_name: 'Haryana DISCOM B', quantum_mwh: 70, subtotal: 315000 });

    // Open access at the buyer's own drawal state: Haryana STU at ₹268.50/MWh on its 70 MWh.
    const oaB = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_OA', options: { buyer: 'Haryana DISCOM B', include_ists: false } });
    expect(oaB.line_items.find((l) => l.description === 'Haryana STU')).toMatchObject({ quantity: 70, amount: 18795 });
    expect(oaB.line_items.some((l) => /Delhi/.test(l.description))).toBe(false);
  });

  it('lets both buyers be billed for the same period without either being taken for a duplicate', () => {
    setBuyerSplit(TX, SPLIT, 'Desk');
    const a = raiseInvoice({ bill_type: 'BILATERAL_ENERGY', priced: buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY', options: { buyer: 'Delhi DISCOM A' } }), bilateral_id: TX });
    const b = raiseInvoice({ bill_type: 'BILATERAL_ENERGY', priced: buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY', options: { buyer: 'Haryana DISCOM B' } }), bilateral_id: TX });
    expect([a.bilateral_buyer, b.bilateral_buyer]).toEqual(['Delhi DISCOM A', 'Haryana DISCOM B']);
    expect(a.invoice_amount + b.invoice_amount).toBe(787500);
    // The same buyer twice is still a duplicate.
    expect(() => raiseInvoice({ bill_type: 'BILATERAL_ENERGY', priced: buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_ENERGY', options: { buyer: 'Delhi DISCOM A' } }), bilateral_id: TX })).toThrow(/already bills/);
  });

  it('follows a split that changes partway through, day by day', () => {
    setBuyerSplit(TX, SPLIT, 'Desk');
    setBuyerSplit(TX, { effective_from: '2026-09-05', buyers: [{ buyer_name: 'Delhi DISCOM A', share_percent: 50 }, { buyer_name: 'Punjab DISCOM C', share_percent: 50 }] }, 'Desk');
    const whole = computeBilateralSettlement({ transaction_id: TX });
    expect(Object.fromEntries(whole.split.buyers.map((b) => [b.buyer_name, b.delivered_mwh]))).toEqual({
      'Delhi DISCOM A': 97.5, // 15 MWh on each of four days, then 12.5 on each of three
      'Haryana DISCOM B': 40,
      'Punjab DISCOM C': 37.5,
    });
    const b = computeBilateralSettlement({ transaction_id: TX, buyer: 'Haryana DISCOM B' });
    expect([b.energy.period_from, b.energy.period_to, b.energy.days]).toEqual(['2026-09-01', '2026-09-04', 4]);
    expect(() => computeBilateralSettlement({ transaction_id: TX, buyer: 'Punjab DISCOM C', to: '2026-09-04' })).toThrow(/holds no share/);
  });

  it('keeps the days before the first split with the transaction\'s own buyer', () => {
    setBuyerSplit(TX, { ...SPLIT, effective_from: '2026-09-04' }, 'Desk');
    const whole = computeBilateralSettlement({ transaction_id: TX });
    expect(Object.fromEntries(whole.split.buyers.map((b) => [b.buyer_name, b.delivered_mwh]))).toEqual({
      'New Delhi Municipal Council': 75,
      'Delhi DISCOM A': 60,
      'Haryana DISCOM B': 40,
    });
    // A period wholly before the split is not split at all.
    expect(computeBilateralSettlement({ transaction_id: TX, to: '2026-09-03' }).split).toBeNull();
  });

  it('prices a revision and a split together', () => {
    addRateRevision(TX, REVISION, 'Desk');
    setBuyerSplit(TX, SPLIT, 'Desk');
    const a = computeBilateralSettlement({ transaction_id: TX, buyer: 'Delhi DISCOM A' });
    const b = computeBilateralSettlement({ transaction_id: TX, buyer: 'Haryana DISCOM B' });
    // A: 45 MWh at 4.50 and 60 at 4.80; B: 30 at 4.50 and 40 at 4.80.
    expect(a.money.sale_value).toBe(490500);
    expect(b.money.sale_value).toBe(327000);
    expect(a.money.sale_value + b.money.sale_value).toBe(817500);
  });

  it('shares a lump sum agreed for the whole deal by each buyer\'s part of the energy', () => {
    db.prepare('UPDATE bilateral_transactions SET wheeling_charges = 10000 WHERE id = ?').run(TX);
    setBuyerSplit(TX, SPLIT, 'Desk');
    const oaA = buildBilateralInvoice({ transaction_id: TX, bill_type: 'BILATERAL_OA', options: { buyer: 'Delhi DISCOM A', include_ists: false } });
    const wheeling = oaA.line_items.find((l) => /Wheeling/.test(l.description));
    expect(wheeling).toMatchObject({ amount: 6000 });
    expect(wheeling.description).toMatch(/Delhi DISCOM A's 60% of the period's energy/);
  });

  it('refuses a split that does not add up, names a buyer twice, or has one buyer', () => {
    const trySplit = (body) => { try { setBuyerSplit(TX, body, 'Desk'); return null; } catch (e) { return e.message; } };
    expect(trySplit({ buyers: [{ buyer_name: 'A', share_percent: 60 }, { buyer_name: 'B', share_percent: 30 }] })).toMatch(/add up to 90%, not 100%/);
    expect(trySplit({ buyers: [{ buyer_name: 'A', share_percent: 50 }, { buyer_name: 'a', share_percent: 50 }] })).toMatch(/appears twice/);
    expect(trySplit({ buyers: [{ buyer_name: 'A', share_percent: 100 }] })).toMatch(/at least two buyers/);
  });
});

describe('On the API', () => {
  let trader, finance;
  beforeEach(() => {
    trader = tokenFor('TRADING_USER');
    finance = tokenFor('FINANCE_USER');
  });

  it('records a revision and a split, and raises a bill for one buyer into the register', async () => {
    const rev = await request(app).post(`/api/bilateral/${TX}/rate-revisions`).set(auth(trader)).send(REVISION);
    expect(rev.status).toBe(201);
    expect((await request(app).post(`/api/bilateral/${TX}/rate-revisions`).set(auth(finance)).send(REVISION)).status).toBe(403);
    expect((await request(app).get(`/api/bilateral/${TX}/rate-revisions`).set(auth(finance))).body).toHaveLength(1);

    const split = await request(app).put(`/api/bilateral/${TX}/buyer-splits`).set(auth(trader)).send(SPLIT);
    expect(split.status).toBe(200);
    expect(split.body.buyers.map((b) => b.share_percent)).toEqual([60, 40]);
    const bad = await request(app).put(`/api/bilateral/${TX}/buyer-splits`).set(auth(trader)).send({ buyers: [{ buyer_name: 'A', share_percent: 99 }, { buyer_name: 'B', share_percent: 99 }] });
    expect(bad.status).toBe(400);

    const preview = await request(app).get(`/api/bilateral/${TX}/settlement?buyer=${encodeURIComponent('Haryana DISCOM B')}`).set(auth(finance));
    expect(preview.body.money.sale_value).toBe(327000);

    const whole = await request(app).post(`/api/bilateral/${TX}/invoices`).set(auth(trader)).send({ bill_type: 'BILATERAL_ENERGY' });
    expect(whole.status).toBe(400);
    expect(whole.body.error).toMatch(/say which buyer/);

    const billed = await request(app).post(`/api/bilateral/${TX}/invoices`).set(auth(trader)).send({ bill_type: 'BILATERAL_ENERGY', buyer: 'Haryana DISCOM B' });
    expect(billed.status).toBe(201);
    expect(billed.body).toMatchObject({ bilateral_buyer: 'Haryana DISCOM B', client_name: 'Haryana DISCOM B', invoice_amount: 327000, quantum_mwh: 70 });
    expect(billed.body.line_items).toHaveLength(2);

    // Every block was metered, so that bill is FINAL: neither the split nor the
    // revision it was priced by can now be taken back from under it.
    const unsplit = await request(app).delete(`/api/bilateral/${TX}/buyer-splits/2026-09-01`).set(auth(trader));
    expect(unsplit.status).toBe(409);
    expect(unsplit.body.error).toMatch(/billed FINAL/);
    expect((await request(app).delete(`/api/bilateral/${TX}/rate-revisions/${rev.body.id}`).set(auth(trader))).status).toBe(409);
  });

  it('removes a split or a revision nothing final has been billed on', async () => {
    const rev = await request(app).post(`/api/bilateral/${TX}/rate-revisions`).set(auth(trader)).send(REVISION);
    await request(app).put(`/api/bilateral/${TX}/buyer-splits`).set(auth(trader)).send(SPLIT);
    expect((await request(app).delete(`/api/bilateral/${TX}/buyer-splits/2026-09-01`).set(auth(trader))).status).toBe(200);
    expect((await request(app).delete(`/api/bilateral/${TX}/rate-revisions/${rev.body.id}`).set(auth(trader))).status).toBe(200);
    expect((await request(app).get(`/api/bilateral/${TX}/settlement`).set(auth(finance))).body).toMatchObject({ split: null, money: { sale_value: 787500 } });
  });
});
