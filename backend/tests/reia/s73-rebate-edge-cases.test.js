import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { invalidateParamCache, getParam } from '../../src/mastersService.js';
import { tieredRebatePct } from '../../src/disputesConstants.js';
import { rebateRateOn, applyInvoicePayment } from '../../src/routes/invoices.js';
import { raiseLpsBills } from '../../src/services/lpsBills.js';
import { isWorkingDay } from '../../src/services/workingCalendar.js';

// The early-payment rebate at its edges (31-Oct-2026). The masters carry
// CERC's tiers — 1.5% within 5 days of presentation, 1% within 30 — for a
// developer's bill to SJVN; a buyer gets one only where its PSA grants it
// (decided 17-Oct-2026). A window that ends on the payer's closed day runs on
// to its next working day. The bill's own terms (note 5) give no rebate on
// taxes, duties, levies or change-in-law amounts, and the engine none on surcharge.

const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const setParam = (key, value) => {
  db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(value, key);
  invalidateParamCache();
};
const on = (d) => new Date(`${d}T00:00:00Z`);

let ppa;
let tiersBefore;
beforeEach(() => {
  resetReia();
  ppa = makeContract({ status: 'ACTIVE', contract_type: 'PPA' });
  tiersBefore = JSON.stringify(getParam('early_payment_rebate_tiers', null));
});
afterEach(() => setParam('early_payment_rebate_tiers', tiersBefore));

// A developer's bill presented on Monday 2 March 2026. Day 5 is Saturday 7th,
// so the 1.5% window runs to Monday 9th; day 30 is Wednesday 1 April.
const sellerBill = (over = {}) => makeInvoice({
  contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 100000, energy_charges: 100000,
  billing_period: '2026-02', created_at: '2026-03-02 05:00:00', issued_at: '2026-03-02 05:00:00', due_date: '2026-04-01', ...over,
});

describe('the master tiers on a developer\'s bill', () => {
  it('has working days where the windows end, so the edges below are the tiers\' own', () => {
    for (const d of ['2026-03-06', '2026-03-09', '2026-03-10', '2026-04-01', '2026-04-02']) expect(isWorkingDay(d, null)).toBe(true);
  });

  it('gives 1.5% to day 5, running on past a weekend, then 1% to day 30, then nothing', () => {
    const inv = sellerBill();
    expect(rebateRateOn(inv, on('2026-03-06'))).toBeCloseTo(0.015, 10);
    expect(rebateRateOn(inv, on('2026-03-09'))).toBeCloseTo(0.015, 10); // day 5 was Saturday
    expect(rebateRateOn(inv, on('2026-03-10'))).toBeCloseTo(0.01, 10);
    expect(rebateRateOn(inv, on('2026-04-01'))).toBeCloseTo(0.01, 10);
    expect(rebateRateOn(inv, on('2026-04-02'))).toBe(0);
  });

  it('counts from presentation, not from when the draft was made', () => {
    const inv = sellerBill({ created_at: '2026-02-01 05:00:00' });
    expect(rebateRateOn(inv, on('2026-03-06'))).toBeCloseTo(0.015, 10);
  });

  it('gives the top tier to a payment made before the bill was presented', () => {
    expect(rebateRateOn(sellerBill(), on('2026-02-27'))).toBeCloseTo(0.015, 10);
  });

  it('reads tiers in any order and skips a malformed one', () => {
    const tiers = [{ within_days: 30, pct: 1 }, { within_days: 'x', pct: 2 }, { within_days: 5, pct: 1.5 }];
    expect(tieredRebatePct(5, tiers)).toBe(1.5);
    expect(tieredRebatePct(6, tiers)).toBe(1);
    expect(tieredRebatePct(31, tiers)).toBe(0);
    expect(tieredRebatePct(3, [])).toBeNull();
  });

  it('falls back to the flat rate up to the due date when no tiers are set', () => {
    setParam('early_payment_rebate_tiers', '[]');
    const flat = Number(getParam('early_payment_rebate_pct', 2)) / 100;
    const inv = sellerBill();
    expect(rebateRateOn(inv, on('2026-04-01'))).toBeCloseTo(flat, 10);
    expect(rebateRateOn(inv, on('2026-04-02'))).toBe(0);
  });
});

describe('the contract\'s own rebate', () => {
  it('replaces the master tiers on a PPA that sets one, by bill date', () => {
    const own = makeContract({ status: 'ACTIVE', contract_type: 'PPA', rebate_pct: 2, rebate_days: 7, rebate_basis: 'BILL_DATE' });
    const inv = sellerBill({ contract_id: own.id });
    expect(rebateRateOn(inv, on('2026-03-09'))).toBeCloseTo(0.02, 10);
    expect(rebateRateOn(inv, on('2026-03-10'))).toBe(0); // not the master 1%
  });

  it('counts from the due date where the contract says so', () => {
    const own = makeContract({ status: 'ACTIVE', contract_type: 'PPA', rebate_pct: 2, rebate_days: 0, rebate_basis: 'DUE_DATE' });
    const inv = sellerBill({ contract_id: own.id, due_date: '2026-03-31' });
    expect(rebateRateOn(inv, on('2026-03-31'))).toBeCloseTo(0.02, 10);
    expect(rebateRateOn(inv, on('2026-04-01'))).toBe(0);
  });

  it('gives a buyer nothing unless its PSA grants a rebate', () => {
    const plain = makeContract({ status: 'ACTIVE', contract_type: 'PSA' });
    const granted = makeContract({ status: 'ACTIVE', contract_type: 'PSA', rebate_pct: 1.5, rebate_days: 5, rebate_basis: 'BILL_DATE' });
    const bill = (c) => sellerBill({ contract_id: c.id, direction: 'SJVN_TO_BUYER', status: 'SENT' });
    expect(rebateRateOn(bill(plain), on('2026-03-03'))).toBe(0);
    expect(rebateRateOn(bill(granted), on('2026-03-03'))).toBeCloseTo(0.015, 10);
  });
});

describe('what the rebate is earned on', () => {
  it('leaves taxes out of the base, and settles the bill at the bill less the rebate', () => {
    const inv = sellerBill({ total_amount: 118000, taxes: 18000 });
    expect(rebateRateOn(inv, on('2026-03-04'))).toBeCloseTo(0.015 * (100000 / 118000), 10);
    const after = applyInvoicePayment(inv, { amount: 116500, payment_date: '2026-03-04', mode: 'NEFT' }, null);
    expect(after).toMatchObject({ rebate: 1500, status: 'PAID' });
  });

  it('earns on the early part only when the rest comes late', () => {
    const inv = sellerBill();
    applyInvoicePayment(inv, { amount: 49250, payment_date: '2026-03-04', mode: 'NEFT' }, null); // settles 50,000 at 1.5%
    const after = applyInvoicePayment(row(inv.id), { amount: 50000, payment_date: '2026-04-10', mode: 'NEFT' }, null);
    expect(after.rebate).toBe(750);
  });

  it('earns nothing on the part in dispute', () => {
    const psa = makeContract({ status: 'ACTIVE', contract_type: 'PSA', rebate_pct: 1.5, rebate_days: 5, rebate_basis: 'BILL_DATE' });
    const inv = sellerBill({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'DISPUTED', disputed_amount: 20000 });
    applyInvoicePayment(inv, { amount: 78800, payment_date: '2026-03-04', mode: 'NEFT' }, null);
    const after = applyInvoicePayment(row(inv.id), { amount: 20000, payment_date: '2026-03-05', mode: 'NEFT' }, null);
    expect(after.rebate).toBe(1200);
  });

  it('earns nothing on money beyond what the bill had open', () => {
    const after = applyInvoicePayment(sellerBill(), { amount: 200000, payment_date: '2026-03-04', mode: 'NEFT' }, null);
    expect(after.rebate).toBe(1500);
  });
});

describe('bills that earn no rebate', () => {
  const rebatePsa = () => makeContract({ status: 'ACTIVE', contract_type: 'PSA', rebate_pct: 1.5, rebate_days: 5, rebate_basis: 'BILL_DATE' });
  const presentNow = (id) => {
    db.prepare(`UPDATE invoices SET status = 'SENT', issued_at = datetime('now') WHERE id = ?`).run(id);
    return row(id);
  };
  const supplementary = (contract, reason_code) => request(app).post('/api/invoices/supplementary').set(auth(tokenFor('REIA_MAKER')))
    .send({ contract_id: contract.id, billing_period: '2026-05', amount: 50000, reason_code, law_effective_from: '2026-05-01', reason: `${reason_code} claim for May 2026` });

  it('gives none on the month\'s LPS bill, even under a PSA that grants a rebate', () => {
    const psa = rebatePsa();
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-08-01' });
    const { raised } = raiseLpsBills({ period: '2026-08', user: { name: 'maker' } });
    expect(rebateRateOn(presentNow(raised[0].invoice_id), new Date())).toBe(0);
  });

  it('gives none on a supplementary raised for Change in Law or for surcharge', async () => {
    for (const code of ['CHANGE_IN_LAW', 'LPS']) {
      const r = await supplementary(ppa, code);
      expect(r.status).toBe(201);
      expect(rebateRateOn(presentNow(r.body.id), new Date())).toBe(0);
    }
  });

  it('still gives the tiers on a supplementary that trues up energy', async () => {
    const r = await supplementary(ppa, 'REVISED_REA');
    expect(rebateRateOn(presentNow(r.body.id), new Date())).toBeCloseTo(0.015, 10);
  });

  it('gives none on a debit note raised for Change in Law', async () => {
    const psa = rebatePsa();
    const parent = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-06-01' });
    const dn = await request(app).post('/api/notes').set(auth(tokenFor('REIA_MAKER')))
      .send({ invoice_id: parent.id, note_type: 'DEBIT', reason_code: 'CHANGE_IN_LAW', amount: 40000, reason: 'Safeguard duty notified 1 May 2026' });
    const ok = await request(app).post(`/api/notes/${dn.body.id}/approve`).set(auth(tokenFor('REIA_CHECKER'))).send({});
    expect(ok.status).toBe(200);
    expect(rebateRateOn(row(ok.body.supp_invoice_id), new Date())).toBe(0);
  });

  it('recognises a Change in Law supplementary raised before the line carried its code', () => {
    const inv = sellerBill({
      invoice_type: 'SUPPLEMENTARY',
      invoice_breakdown_json: JSON.stringify([{ code: 'SUPP', label: 'Change in Law — GST rate change', value: 100000 }, { code: 'TOTAL', value: 100000 }]),
    });
    expect(rebateRateOn(inv, on('2026-03-04'))).toBe(0);
  });
});
