import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, auditFor, resetReia } from '../helpers/reia.js';

// What the first end-to-end run of Billing & Invoicing through the browser found
// — as SJVN, as a seller and as a buyer — pinned so each stays fixed.

let reia, sellerCo, buyerCo, ppa, psa, seller, buyer;

const get = (path, who) => request(app).get(path).set(auth(who));
const post = (path, who, body = {}) => request(app).post(path).set(auth(who)).send(body);
const put = (path, who, body = {}) => request(app).put(path).set(auth(who)).send(body);
const row = (id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const lockEnergy = (contractId, period = '2026-04', mwh = 400) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status)
  VALUES (?, ?, ?, 'FINAL', 'SEA', ?, 'LOCKED')
`).run(newId('ENG'), contractId, period, mwh);
/** A bill SJVN computed itself: it carries its breakdown, which a seller's own bill never does. */
const systemBill = (contract, overrides = {}) => {
  const inv = makeInvoice({ contract_id: contract.id, direction: contract.contract_type === 'PSA' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN', ...overrides });
  db.prepare('UPDATE invoices SET invoice_breakdown_json = ? WHERE id = ?').run(JSON.stringify([{ code: 'TOTAL', label: 'Net Payable Amount', value: inv.total_amount }]), inv.id);
  return row(inv.id);
};

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  sellerCo = makeEntity('SELLER', { name: 'Sunrise Solar' });
  buyerCo = makeEntity('BUYER', { name: 'State Discom' });
  ppa = makeContract({ contract_type: 'PPA', seller_id: sellerCo.id, buyer_id: buyerCo.id });
  psa = makeContract({ contract_type: 'PSA', seller_id: sellerCo.id, buyer_id: buyerCo.id });
  seller = tokenFor('SELLER', { linked_entity_id: sellerCo.id });
  buyer = tokenFor('BUYER', { linked_entity_id: buyerCo.id });
});

describe('Generate Invoice says what is actually wrong', () => {
  it('names the missing allocation when a PSA is not linked to a PPA', async () => {
    // "No energy data found" sent people looking for a file that was never
    // missing: the PSA simply had no PPA to draw energy from.
    const r = await post('/api/invoices/generate', reia, { contract_id: psa.id, period_month: '2026-05' });
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('PSA_NOT_ALLOCATED');
    expect(r.body.error).toMatch(/not linked to any PPA/);
  });

  it('bills the PSA once it holds an allocation', async () => {
    lockEnergy(ppa.id, '2026-05', 1000);
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 80, '2026-04-01')`)
      .run(newId('ALC'), ppa.id, psa.id);
    const r = await post('/api/invoices/generate', reia, { contract_id: psa.id, period_month: '2026-05', invoice_type: 'FINAL' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.direction).toBe('SJVN_TO_BUYER');
    expect(r.body.energy_mwh).toBe(800);
  });

  it('refuses a month before the contract starts, where no COD is recorded', async () => {
    const r = await post('/api/invoices/generate', reia, { contract_id: ppa.id, period_month: '2023-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/only starts on 2026-04-01/);
  });

  it('raises one bill of a kind per contract and month', async () => {
    lockEnergy(ppa.id);
    const body = { contract_id: ppa.id, period_month: '2026-04', invoice_type: 'FINAL' };
    const first = await post('/api/invoices/generate', reia, body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const again = await post('/api/invoices/generate', reia, body);
    expect(again.status, 'the same month was billed twice').toBe(409);
    expect(again.body.error).toMatch(/already has a FINAL bill for 2026-04/);
    expect(again.body.existing_invoice_no).toBe(first.body.invoice_no);

    // Cancelled in error, it can be raised again.
    expect((await post(`/api/invoices/${first.body.id}/cancel`, reia, { reason: 'raised in error' })).status).toBe(200);
    expect((await post('/api/invoices/generate', reia, body)).status).toBe(201);
  });

  it('lets a month be billed again once its presented bill is wholly reversed by credit notes', async () => {
    // 17-Oct-2026: a premature bill already presented is reversed by a credit
    // note, not cancelled; the reversed bill must not block the clean one.
    lockEnergy(ppa.id);
    const body = { contract_id: ppa.id, period_month: '2026-04', invoice_type: 'FINAL' };
    const first = (await post('/api/invoices/generate', reia, body)).body;
    db.prepare(`UPDATE invoices SET status = 'SENT' WHERE id = ?`).run(first.id);
    const partial = newId('DCN');
    const note = (id, amt, status) => db.prepare(`INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month, reason_code, amount, taxable_amount, tax_amount, reason, status, model, created_by)
      VALUES (?, ?, 'CREDIT', ?, ?, '2026-04', 'OTHER', ?, ?, 0, 'reversal', ?, 'V2', 'x')`).run(id, `CN-${id}`, first.id, ppa.id, amt, amt, status);
    note(partial, 1000, 'ISSUED');
    expect((await post('/api/invoices/generate', reia, body)).status, 'a part credit does not free the month').toBe(409);
    note(newId('DCN'), first.total_amount - 1000, 'ISSUED');
    expect((await post('/api/invoices/generate', reia, body)).status).toBe(201);
  });
});

describe('Arrear and supplementary bills', () => {
  const arrear = (over = {}) => post('/api/invoices/arrear', reia, { contract_id: psa.id, arrear_period: '2026-04', amount: 125000, reason: 'CERC order of 30 May', ...over });

  it('will not raise a negative arrear', async () => {
    const r = await arrear({ amount: -100 });
    expect(r.status, 'a negative arrear bill was raised').toBe(400);
    expect(r.body.error).toMatch(/cannot be negative/);
    expect(db.prepare('SELECT COUNT(*) c FROM invoices').get().c).toBe(0);
  });

  it('will not raise the same arrear twice, and still raises a different one', async () => {
    expect((await arrear()).status).toBe(201);
    const twin = await arrear();
    expect(twin.status).toBe(409);
    expect(twin.body.error).toMatch(/already raised as ARR-/);
    // A reason that only begins the same way is a different claim.
    expect((await arrear({ reason: 'CERC order' })).status).toBe(201);
    expect((await arrear({ amount: 90000 })).status).toBe(201);
  });

  it('will not raise the same supplementary twice', async () => {
    const supp = () => post('/api/invoices/supplementary', reia, { contract_id: psa.id, billing_period: '2026-04', amount: 50000, reason_code: 'CHANGE_IN_LAW', reason: 'Clause 12.2 claim' });
    expect((await supp()).status).toBe(201);
    expect((await supp()).status).toBe(409);
  });
});

describe('What a seller sees', () => {
  it("is its own bills, and SJVN's computation of the month only once presented", async () => {
    // Both run Seller → SJVN. Listing on direction alone handed the seller
    // SJVN's draft as its own invoice, with "Send to checker" on it.
    const own = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED' });
    const draft = systemBill(ppa, { status: 'DRAFT' });
    const approved = systemBill(ppa, { status: 'APPROVED', billing_period: '2026-05' });

    const ids = (await get('/api/invoices?direction=SELLER_TO_SJVN', seller)).body.map((i) => i.id);
    expect(ids).toContain(own.id);
    expect(ids).toContain(approved.id);
    expect(ids, "SJVN's draft was listed to the seller").not.toContain(draft.id);
    expect((await get(`/api/invoices/${draft.id}`, seller)).status).toBe(404);
    expect((await get(`/api/invoices/${draft.id}/pdf`, seller)).status).toBe(404);
    expect((await get(`/api/invoice-compliance/${draft.id}`, seller)).status).toBe(404);
    // SJVN still sees all three.
    expect((await get('/api/invoices', reia)).body).toHaveLength(3);
  });
});

describe('Figures on a bill', () => {
  it('shows a list row as overdue when it is', async () => {
    // The list handed the row's index to the function that ages a bill, as its
    // as-of date — so every bill in every list was aged to 1970 and never late.
    const late = makeInvoice({ contract_id: psa.id, status: 'SENT', due_date: day(-40) });
    makeInvoice({ contract_id: psa.id, status: 'SENT', due_date: day(20), billing_period: '2026-05' });
    const list = (await get('/api/invoices', reia)).body;
    const got = list.find((i) => i.id === late.id);
    expect(got.days_past_due).toBe(40);
    expect(got.accrued_lps, 'an overdue bill in a list carried no surcharge').toBeGreaterThan(0);
    expect(list.find((i) => i.id !== late.id).days_past_due).toBe(0);
  });

  it('takes what has been paid off what is still payable', async () => {
    const inv = makeInvoice({ contract_id: psa.id, status: 'SENT', due_date: day(30), total_amount: 1200000 });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, deduction) VALUES (?, ?, 50000, ?, 500)`).run(newId('PAY'), inv.id, day(-1));
    // A credit note is a payment of nothing with a deduction.
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, deduction) VALUES (?, ?, 0, ?, 'CREDIT_NOTE', 500)`).run(newId('PAY'), inv.id, day(-1));
    const got = (await get(`/api/invoices/${inv.id}`, reia)).body;
    expect(got.paid_total).toBe(51000);
    expect(got.balance_due, 'payments were not taken off the amount payable').toBe(1149000);
    // The buyer's own screen has always said this; the two now agree.
    const mine = (await get('/api/buyer-bills', buyer)).body.bills.find((b) => b.id === inv.id);
    expect(mine.left).toBe(got.balance_due);
  });

  it('names the parent bill by its number', async () => {
    const parent = makeInvoice({ contract_id: psa.id, status: 'SENT', invoice_no: 'INV-PSA/2026/000777' });
    const supp = await post('/api/invoices/supplementary', reia, { contract_id: psa.id, billing_period: '2026-04', amount: 5000, reason_code: 'LPS', reason: 'surcharge for April', parent_invoice_id: parent.id });
    expect((await get(`/api/invoices/${supp.body.id}`, reia)).body.parent_invoice_no).toBe('INV-PSA/2026/000777');
  });
});

describe('A buyer receipt applied surcharge-first', () => {
  const outstanding = async () => (await get(`/api/invoices/buyer-outstanding?buyer_id=${buyerCo.id}`, reia)).body;

  it('pays the surcharge before the bill', async () => {
    // It took the whole receipt off principal and left the surcharge standing —
    // the reverse of PSA Art. 6.3 and of what the screen says it does.
    const inv = makeInvoice({ contract_id: psa.id, status: 'SENT', due_date: day(-60), total_amount: 3000000 });
    const before = await outstanding();
    expect(before.total_lps).toBeGreaterThan(1000);
    expect(before.total_principal).toBe(3000000);

    const part = await post('/api/invoices/waterfall-payment', reia, { buyer_id: buyerCo.id, amount: 1000, payment_date: day(0), reference: 'WF-1' });
    expect(part.status, JSON.stringify(part.body)).toBe(201);
    expect(part.body.allocations[0]).toMatchObject({ invoice_no: inv.invoice_no, to_lps: 1000, to_principal: 0, allocated: 1000 });

    const after = await outstanding();
    expect(after.total_lps, 'the receipt did not come off the surcharge').toBe(before.total_lps - 1000);
    expect(after.total_principal, 'the receipt came off principal instead').toBe(3000000);
    expect(db.prepare('SELECT lps_component FROM payments WHERE invoice_id = ?').get(inv.id).lps_component).toBe(1000);

    // The rest of the surcharge, then the bill.
    const rest = await post('/api/invoices/waterfall-payment', reia, { buyer_id: buyerCo.id, amount: after.total_lps + 500000, payment_date: day(0), reference: 'WF-2' });
    expect(rest.body.allocations[0]).toMatchObject({ to_lps: after.total_lps, to_principal: 500000 });
    const end = await outstanding();
    expect(end.total_lps).toBe(0);
    expect(end.total_principal).toBe(2500000);
    expect(row(inv.id).status).toBe('PARTIALLY_PAID');
  });

  it('refuses a receipt dated in the future', async () => {
    makeInvoice({ contract_id: psa.id, status: 'SENT', due_date: day(-60) });
    expect((await post('/api/invoices/waterfall-payment', reia, { buyer_id: buyerCo.id, amount: 1000, payment_date: day(5) })).status).toBe(400);
  });
});

describe('Pass-through charges', () => {
  const charges = (inv) => post(`/api/invoices/${inv.id}/other-charges`, reia, { charges: [{ type: 'TRANSMISSION', amount: 10000 }] });

  it('can be set on a bill before it goes for approval', async () => {
    const inv = makeInvoice({ contract_id: psa.id, status: 'DRAFT' });
    const r = await charges(inv);
    expect(r.status).toBe(200);
    expect(r.body.total_amount).toBe(3010000);
  });

  for (const status of ['UNDER_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_PAID']) {
    it(`cannot re-price a bill that is ${status}`, async () => {
      const inv = makeInvoice({ contract_id: psa.id, status });
      const r = await charges(inv);
      expect(r.status, `the total of a ${status} bill was changed without approval`).toBe(400);
      expect(row(inv.id).total_amount).toBe(3000000);
    });
  }
});

describe("The seller's own invoice form", () => {
  const body = (over = {}) => ({ contract_id: ppa.id, billing_period: '2026-08', energy_mwh: 10, tariff_per_unit: 3, energy_charges: 30000, ...over });

  it('answers a repeated reference in words, not with the database error', async () => {
    expect((await post('/api/invoices', seller, body({ invoice_no: 'SS/2026/08/001' }))).status).toBe(201);
    const r = await post('/api/invoices', seller, body({ invoice_no: 'SS/2026/08/001', billing_period: '2026-09' }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/SS\/2026\/08\/001 is already on record/);
  });

  it('raises one FINAL bill per contract and month, as the sheet upload does', async () => {
    expect((await post('/api/invoices', seller, body())).status).toBe(201);
    const second = await post('/api/invoices', seller, body());
    expect(second.status, 'a second FINAL bill was raised for the same month').toBe(409);
    expect(second.body.error).toMatch(/already billed by/);
    expect((await post('/api/invoices', seller, body({ invoice_type: 'SUPPLEMENTARY' }))).status).toBe(201);
  });

  it("is not blocked by SJVN's own computation of the month", async () => {
    systemBill(ppa, { status: 'DRAFT', billing_period: '2026-08' });
    expect((await post('/api/invoices', seller, body())).status).toBe(201);
  });

  it('asks what an adjustment is for, and keeps the answer', async () => {
    expect((await post('/api/invoices', seller, body({ other_adjustments: 500 }))).status).toBe(400);
    const r = await post('/api/invoices', seller, body({ other_adjustments: 500, adjustment_remarks: 'Metering correction' }));
    expect(r.status).toBe(201);
    expect(row(r.body.id).adjustment_remarks).toBe('Metering correction');
    expect(r.body.total_amount).toBe(30500);
  });

  it('refuses a bill that totals nothing', async () => {
    expect((await post('/api/invoices', seller, body({ energy_charges: 0 }))).status).toBe(400);
  });
});

describe('Revising a bill SJVN has sent back', () => {
  let rejected;
  beforeEach(() => {
    rejected = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'REJECTED', energy_mwh: 17100, tariff_per_unit: 2.57, energy_charges: 43947, total_amount: 43947 });
  });

  it('lets the seller correct the figures before resubmitting', async () => {
    // "Revise & Resubmit" resubmitted and revised nothing.
    const r = await put(`/api/invoices/${rejected.id}/revise`, seller, { energy_charges: 43947000, taxes: 1000 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.total_amount).toBe(43948000);
    expect(r.body.status).toBe('REJECTED');           // sending it on is a separate act
    expect(row(rejected.id).version).toBe(2);
    const audit = auditFor(rejected.id).find((a) => a.action === 'REVISE');
    expect(JSON.parse(audit.before_value).total_amount).toBe(43947);
    expect(JSON.parse(audit.after_value).total_amount).toBe(43948000);

    expect((await post(`/api/invoices/${rejected.id}/submit-for-approval`, seller)).status).toBe(200);
    expect(row(rejected.id).status).toBe('UNDER_APPROVAL');
  });

  it('is only for a draft or a rejected bill, and only for its own seller', async () => {
    const submitted = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', billing_period: '2026-05' });
    expect((await put(`/api/invoices/${submitted.id}/revise`, seller, { taxes: 1 })).status).toBe(400);

    const other = tokenFor('SELLER', { linked_entity_id: makeEntity('SELLER').id });
    expect((await put(`/api/invoices/${rejected.id}/revise`, other, { taxes: 1 })).status).toBe(404);

    const sjvns = systemBill(ppa, { status: 'REJECTED', billing_period: '2026-06' });
    expect((await put(`/api/invoices/${sjvns.id}/revise`, seller, { taxes: 1 })).status).toBe(404);
    expect((await put(`/api/invoices/${rejected.id}/revise`, reia, { taxes: 1 })).status).toBe(403);
  });

  it('holds a revision to the rules the form holds a new bill to', async () => {
    expect((await put(`/api/invoices/${rejected.id}/revise`, seller, { energy_charges: -5 })).status).toBe(400);
    expect((await put(`/api/invoices/${rejected.id}/revise`, seller, { other_adjustments: 250 })).status).toBe(400);
    expect((await put(`/api/invoices/${rejected.id}/revise`, seller, { other_adjustments: 250, adjustment_remarks: 'Rounding' })).status).toBe(200);
    expect(row(rejected.id).total_amount).toBe(44197);
  });
});

describe('A seller disputing its own bill', () => {
  const dispute = (inv) => post('/api/disputes', seller, {
    invoice_id: inv.id, raised_by_role: 'SELLER', reason_code: 'ENERGY_DATA_MISMATCH', charge_line: 'energy_charges', disputed_amount: 1000,
  });

  it('is told why when SJVN has not approved the bill yet', async () => {
    // It answered "Invoice not found" about a bill the seller had open.
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED' });
    const r = await dispute(inv);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/still SUBMITTED/);
    expect(r.body.error).toMatch(/once SJVN has approved/);
  });

  it('can dispute it once approved', async () => {
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED' });
    expect((await dispute(inv)).status).toBe(201);
  });

  it("still cannot see another seller's bill exists", async () => {
    const theirs = makeInvoice({ contract_id: makeContract({ contract_type: 'PPA' }).id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED' });
    expect((await dispute(theirs)).status).toBe(404);
  });
});

describe('The TDS estimate on a seller bill', () => {
  it('counts what was billed before the bill, not after it', async () => {
    db.prepare(`UPDATE entities SET pan_no = 'ABCDE1234F' WHERE id = ?`).run(sellerCo.id);
    const first = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', billing_period: '2026-06', total_amount: 3000000 });
    const second = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', billing_period: '2026-07', total_amount: 3000000 });
    // Raising the second used to put 30 lakh "billed earlier" on the first.
    expect((await get(`/api/invoice-compliance/${first.id}`, seller)).body.tds.billed_before).toBe(0);
    expect((await get(`/api/invoice-compliance/${second.id}`, seller)).body.tds.billed_before).toBe(3000000);
  });
});

describe('The settlement trail', () => {
  it('counts what has been paid on the period and says when a PSA has no PPA', async () => {
    const inv = systemBill(psa, { status: 'PARTIALLY_PAID', invoice_type: 'FINAL' });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, deduction) VALUES (?, ?, 700000, ?, 0)`).run(newId('PAY'), inv.id, day(-3));
    const trail = (await get(`/api/billing-trail?invoice_id=${inv.id}`, reia)).body;
    expect(trail.already_paid).toBe(0);              // nothing was paid on a provisional
    expect(trail.paid_on_period, 'a paid final bill read as unpaid').toBe(700000);
    expect(trail.net_due).toBe(3000000);
    expect(trail.psa_unallocated).toBe(true);
    expect(trail.final_invoices[0].paid_total).toBe(700000);
  });

  it("is not open to another company's user", async () => {
    const inv = systemBill(psa, { status: 'SENT' });
    const stranger = tokenFor('BUYER', { linked_entity_id: makeEntity('BUYER').id });
    expect((await get(`/api/billing-trail?invoice_id=${inv.id}`, stranger)).status).toBe(404);
    expect((await get(`/api/billing-trail?invoice_id=${inv.id}`, buyer)).status).toBe(200);
  });
});

describe('The settlement trail on a PPA month both sides have billed', () => {
  it("gives SJVN's bill SJVN's net due, not the seller's", async () => {
    // The seller's old invoice came first in the family, so SJVN's 3.65 crore
    // bill was shown a "net due (final)" of 36,494.
    const sellers = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', invoice_type: 'FINAL', billing_period: '2026-06', total_amount: 36494, invoice_no: 'SS/2026/06' });
    db.prepare(`UPDATE invoices SET created_at = datetime('now', '-30 days') WHERE id = ?`).run(sellers.id);
    const sjvns = systemBill(ppa, { status: 'UNDER_APPROVAL', invoice_type: 'FINAL', billing_period: '2026-06', total_amount: 36494000, invoice_no: 'INV-PPA/2026/000004' });

    const fromSjvns = (await get(`/api/billing-trail?invoice_id=${sjvns.id}`, reia)).body;
    expect(fromSjvns.net_due, "SJVN's bill was given the seller's figure").toBe(36494000);
    expect(fromSjvns.net_due_invoice_no).toBe('INV-PPA/2026/000004');

    const fromSellers = (await get(`/api/billing-trail?invoice_id=${sellers.id}`, reia)).body;
    expect(fromSellers.net_due).toBe(36494);
    expect(fromSellers.net_due_invoice_no).toBe('SS/2026/06');

    // By the family reference alone it speaks for SJVN's computation.
    const byFamily = (await get(`/api/billing-trail?contract_id=${ppa.id}&period_month=2026-06`, reia)).body;
    expect(byFamily.net_due).toBe(36494000);
    expect(byFamily.final_invoices.map((i) => [i.invoice_no, i.raised_by_seller])).toEqual([['SS/2026/06', true], ['INV-PPA/2026/000004', false]]);
  });
});

describe('The notification board on billing', () => {
  const board = (who) => request(app).get('/api/alerts/board').set(auth(who)).then((r) => r.body);
  const alertOn = (b, key) => (b.alerts || []).find((a) => a.id === key);

  it('counts what is still owed on an overdue bill, not what was billed', async () => {
    // A bill with 3.83 crore banked against 3.91 crore read as 3.91 crore overdue.
    const part = makeInvoice({ contract_id: psa.id, status: 'PARTIALLY_PAID', due_date: day(-26), total_amount: 39072000 });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, deduction) VALUES (?, ?, 38290560, ?, 0)`).run(newId('PAY'), part.id, day(-30));
    // Settled in full but for the status, and a credit bill: neither is overdue.
    const cleared = makeInvoice({ contract_id: psa.id, status: 'SENT', due_date: day(-10), total_amount: 500000, billing_period: '2026-05' });
    db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, deduction) VALUES (?, ?, 500000, ?, 0)`).run(newId('PAY'), cleared.id, day(-12));
    makeInvoice({ contract_id: psa.id, status: 'APPROVED', due_date: day(-2), total_amount: -8000, billing_period: '2026-06' });

    const mine = (await get('/api/buyer-bills', buyer)).body.bills.find((b) => b.id === part.id);
    const card = alertOn(await board(buyer), 'overdue-payments');
    expect(card.count).toBe(1);
    expect(card.detail).toBe(`1 invoice(s) past due · ₹${Math.round(mine.left).toLocaleString('en-IN')} outstanding`);
    expect(mine.left).toBeLessThan(1000000);
  });

  it('does not tell a buyer about a bill still in approval, nor a seller about SJVN\'s own', async () => {
    makeInvoice({ contract_id: psa.id, status: 'UNDER_APPROVAL' });                              // SJVN's bill on the buyer
    systemBill(ppa, { status: 'UNDER_APPROVAL', billing_period: '2026-05' });                    // SJVN's computation on the PPA
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', billing_period: '2026-06' }); // the seller's own

    expect(alertOn(await board(buyer), 'invoice-approvals')).toBeUndefined();
    expect(alertOn(await board(seller), 'invoice-approvals').count).toBe(1);
    expect(alertOn(await board(reia), 'invoice-approvals').count).toBe(3);
  });
});

describe('The bill as a PDF', () => {
  const binary = (res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); };
  const pdfText = async (path, who) => {
    const res = await request(app).get(path).set(auth(who)).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(res.body) });
    try { return { text: (await parser.getText()).text, disposition: res.headers['content-disposition'] }; } finally { await parser.destroy?.(); }
  };

  it('prints the total the screen shows, under a file name without slashes', async () => {
    const inv = makeInvoice({ contract_id: psa.id, status: 'SENT', invoice_no: 'ARR-PSA/2026/000003', total_amount: 1200000, energy_charges: 1200000, energy_mwh: 0, tariff_per_unit: 0 });
    const { text, disposition } = await pdfText(`/api/invoices/${inv.id}/pdf`, reia);
    expect(disposition).toContain('Invoice_ARR-PSA_2026_000003.pdf');
    expect(text).toContain('ARR-PSA/2026/000003');
    // "Total amount to be paid (A+B)" is the bill's total, less rebate, plus surcharge.
    expect(text.replace(/\s+/g, ' ')).toMatch(/Total amount to be paid[^0-9]*12,00,000\.00/);
  });

  it('carries the rebate and the surcharge into that total', async () => {
    const inv = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'PARTIALLY_PAID', invoice_no: 'SS/2026/08/009', total_amount: 45447, energy_charges: 43947, energy_mwh: 17.1, tariff_per_unit: 2.57 });
    db.prepare('UPDATE invoices SET taxes = 1000, other_adjustments = 500, rebate = 151, lps = 0 WHERE id = ?').run(inv.id);
    const { text } = await pdfText(`/api/invoices/${inv.id}/pdf`, reia);
    expect(text.replace(/\s+/g, ' ')).toMatch(/Total amount to be paid[^0-9]*45,296\.00/);
  });
});
