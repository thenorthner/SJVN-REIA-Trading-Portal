import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { ageingBuckets, openPosition } from '../../src/services/outstanding.js';
import { lpsPosition } from '../../src/services/lpsPosition.js';

// What the scope asks the REIA dashboard for and it could not answer (CP-58-61):
// the surcharge overdue bills have earned, the pending money split between the
// developers SJVN owes and the buyers who owe SJVN, and how old that money is.
//
// Every figure here runs on the same outstanding definition as the receivable
// and payable KPIs, so the ageing table can never add up to a different total
// than the card above it.

const dayOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

let reia, contract;

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM cerc_form_iv').run();
  reia = tokenFor('REIA_USER');
  contract = makeContract({ status: 'ACTIVE', lps_annual_pct: 15, lps_grace_days: 0 });
});

const dashboard = () => request(app).get('/api/dashboard/reia').set(auth(reia));

describe('S23 REIA dashboard — surcharge, split and ageing', () => {
  it('splits the pending money between buyers and developers', async () => {
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 500000, due_date: dayOffset(10) });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 200000, due_date: dayOffset(-45) });
    makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 300000, due_date: dayOffset(-5) });
    makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'PAID', total_amount: 900000, due_date: dayOffset(-60) });

    const r = await dashboard();
    expect(r.status).toBe(200);
    expect(r.body.pendingSplit.buyer).toMatchObject({ invoices: 2, outstanding: 700000, overdue_invoices: 1, overdue_amount: 200000 });
    expect(r.body.pendingSplit.developer).toMatchObject({ invoices: 1, outstanding: 300000, overdue_invoices: 1 });
    // The KPI cards read the same figures.
    expect(r.body.kpis.buyerPending).toBe(700000);
    expect(r.body.kpis.developerPending).toBe(300000);
    // A settled bill is nobody's pending money.
    expect(r.body.pendingSplit.developer.invoices).toBe(1);
  });

  it('ages the outstanding by how long it has been due, and adds up to the receivable', async () => {
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: dayOffset(15) });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 200000, due_date: dayOffset(-10) });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 300000, due_date: dayOffset(-45) });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 400000, due_date: dayOffset(-75) });
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 500000, due_date: dayOffset(-200) });

    const buckets = ageingBuckets('SJVN_TO_BUYER');
    expect(buckets.map((b) => [b.bucket, b.amount])).toEqual([
      ['NOT_DUE', 100000],
      ['DAYS_0_30', 200000],
      ['DAYS_31_60', 300000],
      ['DAYS_61_90', 400000],
      ['DAYS_90_PLUS', 500000],
    ]);

    const r = await dashboard();
    const total = r.body.ageing.receivable.reduce((a, b) => a + b.amount, 0);
    expect(total, 'the ageing table and the receivable KPI disagree').toBe(r.body.kpis.receivables);
    expect(total).toBe(1500000);
  });

  it('leaves a fully collected bill out of the ageing even if its status lags', async () => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: dayOffset(-40) });
    db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, ?, ?, ?)')
      .run(newId('PAY'), inv.id, 100000, dayOffset(-1), 'NEFT');
    const buckets = ageingBuckets('SJVN_TO_BUYER');
    expect(buckets.every((b) => b.invoices === 0)).toBe(true);
    expect(openPosition('SJVN_TO_BUYER')).toMatchObject({ invoices: 0, outstanding: 0 });
  });

  it('separates surcharge recovered, surcharge billed and surcharge still accruing', async () => {
    // Settled with its surcharge collected.
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'PAID', total_amount: 100000, lps: 4000, due_date: dayOffset(-90) });
    // Open, surcharge already raised on the bill.
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, lps: 1000, due_date: dayOffset(-2) });
    // Open and long overdue with nothing charged: this is the figure nobody had.
    makeInvoice({ contract_id: contract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 1000000, lps: 0, due_date: dayOffset(-100) });

    const pos = lpsPosition('SJVN_TO_BUYER');
    expect(pos.recovered).toBe(4000);
    expect(pos.billed_outstanding).toBe(1000);
    expect(pos.accrued_unbilled).toBeGreaterThan(0);
    expect(pos.invoices_accruing_unbilled).toBeGreaterThanOrEqual(1);
    expect(pos.recoverable).toBe(pos.billed_outstanding + pos.accrued_unbilled);
    expect(pos.annual_pct).toBe(15);

    // 15% a year on 10 lakh, and `lps_day_count_mode` is WORKING_DAYS by
    // default, so the 100 calendar days are charged as roughly 71 working ones:
    // about 29,000, not the 41,000 a calendar count would give. The figure the
    // invoice screen shows for the same bill, which is the point of reusing its
    // helper here.
    expect(pos.accrued_unbilled).toBeGreaterThan(25000);
    expect(pos.accrued_unbilled).toBeLessThan(35000);

    const r = await dashboard();
    expect(r.body.kpis.lpsRecovered).toBe(4000);
    expect(r.body.kpis.lpsRecoverable).toBe(pos.recoverable + lpsPosition('SELLER_TO_SJVN').recoverable);
  });

  it('does not count surcharge on a bill that is not yet late', async () => {
    makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', total_amount: 500000, due_date: dayOffset(20) });
    const pos = lpsPosition('SELLER_TO_SJVN');
    expect(pos).toMatchObject({ accrued_unbilled: 0, invoices_overdue: 0, recoverable: 0 });
  });

  it('respects the grace days on the contract before any surcharge accrues', async () => {
    const lenient = makeContract({ status: 'ACTIVE', lps_annual_pct: 15, lps_grace_days: 30 });
    makeInvoice({ contract_id: lenient.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 500000, due_date: dayOffset(-10) });
    expect(lpsPosition('SJVN_TO_BUYER').accrued_unbilled).toBe(0);
  });

  it('says where the CERC Form-IV filings stand', async () => {
    const put = (period, status, dueDate, breaches = 0) => db.prepare(`
      INSERT INTO cerc_form_iv (id, form_no, period_type, period, status, due_date, breach_count)
      VALUES (?, ?, 'MONTHLY', ?, ?, ?, ?)
    `).run(newId('FIV'), `FIV-${period}`, period, status, dueDate, breaches);
    put('2026-06', 'SUBMITTED', dayOffset(-70));
    put('2026-07', 'PREPARED', dayOffset(-20), 2);
    put('2026-08', 'DRAFT', dayOffset(12));

    const r = await dashboard();
    expect(r.body.formIv).toMatchObject({
      total: 3, submitted: 1, pending: 2, overdue: 1, open_breaches: 2,
      latest_period: '2026-08', latest_status: 'DRAFT',
    });
    expect(r.body.kpis.formIvPending).toBe(2);
    expect(r.body.kpis.formIvOverdue).toBe(1);
  });

  it('answers with zeroes rather than nulls when nothing is on record', async () => {
    const r = await dashboard();
    expect(r.body.kpis.lpsRecovered).toBe(0);
    expect(r.body.kpis.lpsRecoverable).toBe(0);
    expect(r.body.formIv).toMatchObject({ total: 0, pending: 0, overdue: 0, latest_period: null });
    expect(r.body.ageing.payable.every((b) => b.amount === 0)).toBe(true);
  });
});
