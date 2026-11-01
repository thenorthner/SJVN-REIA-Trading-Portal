import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { invoiceLpsAsOf, invoiceBalance } from '../../src/services/invoiceLps.js';
import { rebateRateOn } from '../../src/routes/invoices.js';
import { buildTemplate, acceptSubmission } from '../../src/services/invoiceVerification.js';
import { supplementaryReason, isChangeInLawBill } from '../../src/services/billReason.js';

// Change in Law at its edges (31-Oct-2026). A claim reaches a bill three ways:
// a supplementary bill (reason CHANGE_IN_LAW), a debit or credit note against
// a bill, and the verifier's build-up of a developer's own bill. The Timely
// Recovery of Costs due to Change in Law Rules, 2021 recover the impact through
// the bill; once billed it is payable like any bill — surcharge if paid late
// (LPS Rules 2022) — but earns no early-payment rebate (note 5 on every bill).

const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const maker = () => tokenFor('REIA_MAKER');
const supp = (token, body) => request(app).post('/api/invoices/supplementary').set(auth(token)).send(body);
const perDay = (amount, pct) => (amount * pct) / 100 / 365;

let ppa;
let psa;
beforeEach(() => {
  resetReia();
  ppa = makeContract({ status: 'ACTIVE', contract_type: 'PPA' });
  psa = makeContract({ status: 'ACTIVE', contract_type: 'PSA' });
});
const claim = (over = {}) => ({
  contract_id: psa.id, billing_period: '2026-05', amount: 250000, reason_code: 'CHANGE_IN_LAW', law_effective_from: '2026-05-01',
  reason: 'Safeguard duty on modules, MoF notification of 1 May 2026', ...over,
});

describe('who raises a Change in Law bill', () => {
  it('is the REIA maker, and no one else', async () => {
    expect((await supp(maker(), claim())).status).toBe(201);
    for (const role of ['REIA_CHECKER', 'REIA_APPROVER', 'FINANCE_USER', 'SJVN_ADMIN', 'MANAGEMENT']) {
      expect((await supp(tokenFor(role), claim({ amount: 1000 + role.length }))).status, role).toBe(403);
    }
    expect((await supp(tokenFor('BUYER', { linked_entity_id: psa.buyer_id }), claim({ amount: 7 }))).status).toBe(403);
    expect((await supp(tokenFor('SELLER', { linked_entity_id: ppa.seller_id }), claim({ contract_id: ppa.id, amount: 8 }))).status).toBe(403);
  });
});

describe('what a Change in Law bill must say', () => {
  it('refuses no amount, a zero, or one that is not a number', async () => {
    for (const amount of [undefined, 0, 'abc', null]) {
      expect((await supp(maker(), claim({ amount }))).status, String(amount)).toBe(400);
    }
  });

  it('refuses a claim with no description of the law', async () => {
    expect((await supp(maker(), claim({ reason: '   ' }))).status).toBe(400);
  });

  it('refuses a malformed month, one before the contract began, after it ended, or not yet come', async () => {
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
    for (const billing_period of ['2026-5', '2026-13', '2026-03', '2027-04', nextMonth]) {
      const r = await supp(maker(), claim({ billing_period }));
      expect(r.status, billing_period).toBe(400);
    }
  });

  it('refuses the same claim twice, but takes a different one for the same month', async () => {
    expect((await supp(maker(), claim())).status).toBe(201);
    const twice = await supp(maker(), claim());
    expect(twice.status).toBe(409);
    expect(twice.body.existing_invoice_no).toMatch(/^SUPP-PSA\//);
    expect((await supp(maker(), claim({ reason: 'GST on modules raised from 5% to 12%, notified 30 Sep 2021' }))).status).toBe(201);
  });

  it('refuses a parent bill from another contract', async () => {
    const other = makeInvoice({ contract_id: ppa.id, status: 'SENT' });
    expect((await supp(maker(), claim({ parent_invoice_id: other.id }))).status).toBe(400);
  });

  it('carries GST on the claim as tax, and records why it was raised on the bill', async () => {
    const r = await supp(maker(), claim({ amount: 100000, taxes: 18000 }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ invoice_type: 'SUPPLEMENTARY', status: 'DRAFT', energy_charges: 100000, taxes: 18000, total_amount: 118000 });
    expect(supplementaryReason(r.body)).toBe('CHANGE_IN_LAW');
    expect(isChangeInLawBill(r.body)).toBe(true);
  });
});

describe('a Change in Law bill once presented', () => {
  async function presented(over = {}) {
    const r = await supp(maker(), claim(over));
    db.prepare(`UPDATE invoices SET status = 'SENT', issued_at = '2026-05-02 10:00:00', due_date = '2026-06-01' WHERE id = ?`).run(r.body.id);
    return row(r.body.id);
  }

  it('earns surcharge from its due date like any bill', async () => {
    const inv = await presented();
    expect(invoiceLpsAsOf(inv, new Date('2026-07-01')).lps).toBe(Math.round(perDay(250000, 15) * 30));
  });

  it('earns no early-payment rebate, on the PPA side or the PSA side', async () => {
    const onPsa = await presented();
    const onPpa = await presented({ contract_id: ppa.id });
    expect(rebateRateOn(onPsa, new Date('2026-05-03'))).toBe(0);
    expect(rebateRateOn(onPpa, new Date('2026-05-03'))).toBe(0);
  });

  it('as a credit (the law lowered the cost) owes nothing and earns nothing', async () => {
    const inv = await presented({ amount: -60000 });
    expect(inv.total_amount).toBe(-60000);
    expect(invoiceLpsAsOf(inv, new Date('2026-09-01')).lps).toBe(0);
    expect(invoiceBalance(inv, new Date('2026-09-01')).balance).toBe(0);
    expect(rebateRateOn(inv, new Date('2026-05-03'))).toBe(0);
  });
});

describe('Change in Law by debit and credit note', () => {
  const note = (body) => request(app).post('/api/notes').set(auth(maker())).send(body);
  const approve = (id) => request(app).post(`/api/notes/${id}/approve`).set(auth(tokenFor('REIA_CHECKER'))).send({ issued_date: '2026-07-01' });

  it('bills a debit note as its own bill, due on its own terms, earning surcharge from that date', async () => {
    const parent = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-05-01' });
    const dn = await note({ invoice_id: parent.id, note_type: 'DEBIT', reason_code: 'CHANGE_IN_LAW', taxable_amount: 40000, tax_amount: 7200, reason: 'Safeguard duty notified 1 May 2026' });
    expect(dn.status).toBe(201);
    const ok = await approve(dn.body.id);
    expect(ok.status).toBe(200);
    const bill = row(ok.body.supp_invoice_id);
    expect(bill).toMatchObject({ invoice_type: 'SUPPLEMENTARY', total_amount: 47200, taxes: 7200, parent_invoice_id: parent.id });
    expect(bill.due_date > '2026-07-01').toBe(true);
    expect(isChangeInLawBill(bill)).toBe(true);
    // Nothing before its own due date, though the parent was due on 1 May.
    const dayBefore = new Date(new Date(`${bill.due_date.slice(0, 10)}T00:00:00Z`).getTime());
    expect(invoiceLpsAsOf(bill, dayBefore).lps).toBe(0);
  });

  it('takes a credit note for a lower cost off the bill, never past its total', async () => {
    const parent = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000, due_date: '2026-05-01' });
    expect((await note({ invoice_id: parent.id, note_type: 'CREDIT', reason_code: 'CHANGE_IN_LAW', amount: 100001, reason: 'GST rate cut notified' })).status).toBe(400);
    const cn = await note({ invoice_id: parent.id, note_type: 'CREDIT', reason_code: 'CHANGE_IN_LAW', amount: 30000, reason: 'GST rate cut notified' });
    expect(cn.status).toBe(201);
    expect((await approve(cn.body.id)).status).toBe(200);
    expect(invoiceBalance(row(parent.id), new Date('2026-05-01')).balance).toBe(70000);
  });

  it('refuses a reason it does not know rather than filing it as something else', async () => {
    const parent = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', total_amount: 100000 });
    const r = await note({ invoice_id: parent.id, note_type: 'DEBIT', reason_code: 'CHANGE_IN_LAWS', amount: 5000, reason: 'Safeguard duty notified 1 May 2026' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/reason/i);
  });
});

describe('Change in Law in the verifier\'s build-up', () => {
  const template = () => buildTemplate(makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', total_amount: 3250000, energy_charges: 3000000 }));
  const cil = (status) => ({ key: 'CHANGE_IN_LAW_VERIFIED', status, note: 'per the claim' });

  it('lets a bill with no claim mark the check not applicable', () => {
    expect(acceptSubmission(template(), { technical: [cil('NA')], commercial: {} }).error).toBeUndefined();
  });

  it('does not let a bill that carries a claim mark it not applicable', () => {
    const r = acceptSubmission(template(), { technical: [cil('NA')], commercial: { change_in_law: 250000 } });
    expect(r.error).toMatch(/change.in.law/i);
    expect(acceptSubmission(template(), { technical: [cil('VERIFIED')], commercial: { change_in_law: 250000 } }).error).toBeUndefined();
  });

  it('takes a negative claim (the law lowered the cost) as a claim too', () => {
    expect(acceptSubmission(template(), { technical: [cil('NA')], commercial: { change_in_law: -40000 } }).error).toMatch(/change.in.law/i);
  });
});
