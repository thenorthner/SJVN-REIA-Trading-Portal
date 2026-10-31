import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Found by the browser audit of power diversion and energy banking
// (17-Oct-2026): a diversion at a negative rate, or of 9 lakh MWh in a 50 MW
// month in 2030 (₹360 crore "gain"); recovery as two browser calls — a
// waterfall across every PSA of the buyer, then "mark recovered" with any
// figure, twice — and a recovered diversion cancelled after; 50,000 MWh banked
// on a PSA at a typed ₹30 into a closed cycle and paid out at once (₹112.5
// crore); and a sweep "as of 2099" cashing out a cycle still running.

let reia, checker, buyer, psa, otherPsa, ppa;
const post = (path, body, who = reia) => request(app).post(path).set(auth(who)).send(body);
const divert = (over = {}) => post('/api/power-diversion', {
  contract_id: psa.id, period_month: '2026-08', reason: 'PAYMENT_DEFAULT', quantum_mwh: 250, sale_rate_per_mwh: 4200, expenses: 25000, ...over,
});
const bank = (over = {}) => post('/api/energy-banking', {
  contract_id: ppa.id, cycle: 'FY2026-27', period_month: '2026-08', banked_mwh: 100, cycle_ends_on: '2027-03-31', ...over,
});

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  // Phase B.2: checking is the checker's.
  checker = tokenFor('REIA_CHECKER');
  buyer = makeEntity('BUYER');
  psa = makeContract({ contract_type: 'PSA', buyer_id: buyer.id, capacity_mw: 50, tenure_start: '2026-04-01' });
  otherPsa = makeContract({ contract_type: 'PSA', buyer_id: buyer.id, capacity_mw: 50, tenure_start: '2026-04-01' });
  ppa = makeContract({ contract_type: 'PPA', capacity_mw: 50, tariff_per_unit: 2.88, tenure_start: '2026-04-01', banking_cycle_basis: 'ANNUAL' });
  // An overdue bill on each PSA: ₹20 lakh on the defaulted one, ₹10 lakh on the other.
  makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-06', total_amount: 2000000, due_date: '2026-07-31' });
  makeInvoice({ contract_id: otherPsa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-05', total_amount: 1000000, due_date: '2026-06-30' });
  db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-08', 'FINAL', 'SEA', 8200, 'LOCKED')`).run(newId('ENG'), ppa.id);
});

describe('S54 Recording a diversion', () => {
  it('works out the sale and the gain: 250 MWh × ₹4,200 = ₹10,50,000, less ₹25,000', async () => {
    const r = await divert();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ sale_amount: 1050000, net_gain: 1025000, status: 'RECORDED' });
  });

  it('refuses a negative rate or expenses, a month not started, more than the PSA could deliver, and an unknown reason', async () => {
    expect((await divert({ sale_rate_per_mwh: -3000 })).status).toBe(400);
    expect((await divert({ expenses: -50000 })).status).toBe(400);
    expect((await divert({ period_month: '2030-01' })).body.error).toMatch(/has not started/);
    expect((await divert({ quantum_mwh: 900000 })).body.error).toMatch(/at most 37,200 MWh/);
    expect((await divert({ reason: 'WHATEVER' })).status).toBe(400);
    expect((await divert({ sale_rate_per_mwh: 42000 })).body.error).toMatch(/price ceiling/);
  });

  it('calls it a payment default only when a bill on the PSA is past its due date', async () => {
    db.prepare(`UPDATE invoices SET status = 'PAID' WHERE contract_id = ?`).run(psa.id);
    expect((await divert()).body.error).toMatch(/not in payment default/);
    // Not requisitioned needs the record that shows it (SM1).
    expect((await divert({ reason: 'NON_REQUISITION' })).status).toBe(400);
    expect((await divert({ reason: 'NON_REQUISITION', notes: 'SLDC schedule shows zero requisition for the month' })).status).toBe(201);
  });
});

describe('S54 Recovering a diversion', () => {
  it('sets the gain against this PSA\'s dues only, in one step, once, and reports what it could not place', async () => {
    const d = (await divert({ quantum_mwh: 1000, sale_rate_per_mwh: 3000, expenses: 0 })).body; // ₹30 lakh gain
    const r = await post(`/api/power-diversion/${d.id}/recover`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // Surcharge first (the bill has been overdue since 31 July), then the ₹20 lakh principal.
    const lps = r.body.allocations[0].to_lps;
    expect(lps).toBeGreaterThan(0);
    expect(r.body).toMatchObject({ status: 'RECOVERED', applied_amount: 2000000 + Math.round(lps) });
    // What the dues could not take is held as the buyer's advance (17-Oct-2026).
    expect(r.body.unapplied).toBe(0);
    expect(r.body.applied_amount + r.body.held_as_advance).toBe(3000000);
    const adv = db.prepare(`SELECT * FROM unapplied_receipts WHERE source_ref = ?`).get(d.diversion_no);
    expect(adv).toMatchObject({ source: 'DIVERSION_SURPLUS', status: 'OPEN', balance: r.body.held_as_advance });
    // The other PSA's bill is untouched.
    expect(db.prepare(`SELECT COUNT(*) n FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.contract_id = ?`).get(otherPsa.id).n).toBe(0);
    const pay = db.prepare(`SELECT p.* FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.contract_id = ?`).all(psa.id);
    expect(pay.map((p) => [p.mode, p.reference, p.lps_component])).toEqual([['POWER_DIVERSION', d.diversion_no, lps]]);

    expect((await post(`/api/power-diversion/${d.id}/recover`, {})).status, 'recovered twice').toBe(400);
    expect((await request(app).delete(`/api/power-diversion/${d.id}`).set(auth(reia))).status, 'cancelled after recovery').toBe(400);
    expect((await post(`/api/power-diversion/${d.id}/mark-recovered`, { applied_amount: 999999999999 })).status).toBe(404);
  });

  it('has nothing to recover from a deficit', async () => {
    const d = (await divert({ quantum_mwh: 100, sale_rate_per_mwh: 2000, expenses: 250000 })).body;
    expect(d.net_gain).toBe(-50000);
    expect((await post(`/api/power-diversion/${d.id}/recover`, {})).body.error).toMatch(/no net gain/);
  });
});

describe('S54 Energy banking', () => {
  it('banks a PPA\'s locked generation at the contract tariff into an open cycle', async () => {
    const r = await bank();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ banked_mwh: 100, tariff_per_unit: 2.88, cycle_ends_on: '2027-03-31' });
  });

  it('refuses a PSA, a closed cycle, a typed tariff, more than the month generated, and an unlocked month', async () => {
    expect((await bank({ contract_id: psa.id })).body.error).toMatch(/banked to the generator under its PPA/);
    expect((await bank({ cycle_ends_on: '2026-01-01' })).body.error).toMatch(/annual basis: 2026-08 falls in cycle FY2026-27, ending 2027-03-31/);
    expect((await bank({ tariff_per_unit: 30 })).body.error).toMatch(/contract's tariff/);
    expect((await bank({ banked_mwh: 50000 })).body.error).toMatch(/generated 8200 MWh/);
    expect((await bank({ period_month: '2026-07' })).body.error).toMatch(/no locked energy/);
    expect((await bank({ cycle_ends_on: '2028-03-31' })).body.error).toMatch(/annual basis/);
  });

  it('settles only cycles that have closed: a future "as of" is refused', async () => {
    await bank();
    const r = await post('/api/energy-banking/settle', { as_of: '2099-01-01' }, checker);
    expect(r.status).toBe(400);
    expect(db.prepare(`SELECT status FROM energy_banking WHERE contract_id = ?`).get(ppa.id).status).toBe('OPEN');
    expect((await post('/api/energy-banking/settle', {}, checker)).body.settled).toBe(0);
  });

  it('stops drawing once the cycle and its month of entries have closed, whatever the request says the date is', async () => {
    await bank();
    db.prepare(`UPDATE energy_banking SET cycle_ends_on = '2026-08-31' WHERE contract_id = ?`).run(ppa.id);
    const r = await post('/api/energy-banking/draw', { contract_id: ppa.id, cycle: 'FY2026-27', draw_mwh: 10, asOf: '2026-01-01' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/closed on 2026-08-31 and took entries until 2026-09-30/);
  });

  it('is SJVN\'s only', async () => {
    const seller = signToken(makeUser('SELLER', { linked_entity_id: makeEntity('SELLER').id }));
    expect((await request(app).get(`/api/energy-banking/${ppa.id}`).set(auth(seller))).status).toBe(403);
    expect((await request(app).get('/api/power-diversion').set(auth(seller))).status).toBe(403);
  });
});

// Banked energy is paid for once (decided 17-Oct-2026): the month's bill leaves
// it out, a draw is billed at the full tariff, and what lapses is billed at the
// settlement percentage when the cycle closes — each a supplementary bill from
// the generator. Settlement used to be a figure on the banking row, payable by
// nobody, while the month's bill had already paid for the same energy in full.
describe('S54 Paying for banked energy', () => {
  it('leaves banked energy out of the month\'s bill: (8,200 − 100) MWh × ₹2,880', async () => {
    expect((await bank()).status).toBe(201);
    const r = await post('/api/invoices/generate', { contract_id: ppa.id, period_month: '2026-08', invoice_type: 'FINAL' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ energy_mwh: 8100, energy_charges: 8100 * 2880 });
    expect(JSON.parse(r.body.invoice_breakdown_json).find((l) => l.code === 'BNK')).toMatchObject({ value: -100 });
    // And once the month is billed, nothing more can be banked from it.
    expect((await bank({ banked_mwh: 10 })).body.error).toMatch(/already billed/);
  });

  it('bills a draw at the full banked tariff: 40 MWh × ₹2,880 = ₹1,15,200', async () => {
    await bank();
    const r = await post('/api/energy-banking/draw', { contract_id: ppa.id, cycle: 'FY2026-27', draw_mwh: 40 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.body.invoice.id);
    expect(inv).toMatchObject({ invoice_type: 'SUPPLEMENTARY', direction: 'SELLER_TO_SJVN', status: 'DRAFT', energy_mwh: 40, total_amount: 115200 });
    expect(db.prepare('SELECT COUNT(*) n FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).n).toBe(1);
  });

  it('bills what lapses at 75 %: 60 MWh × ₹2.16 = ₹1,29,600, linked from the banking row', async () => {
    await bank();
    await post('/api/energy-banking/draw', { contract_id: ppa.id, cycle: 'FY2026-27', draw_mwh: 40 });
    const { settleExpiredBanking } = await import('../../src/services/energyBanking.js');
    const res = settleExpiredBanking('2027-05-01');
    expect(res.items[0]).toMatchObject({ unused_mwh: 60, settlement_amount: 129600 });
    const row = db.prepare('SELECT * FROM energy_banking WHERE contract_id = ?').get(ppa.id);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(row.settlement_invoice_id);
    expect(inv).toMatchObject({ invoice_type: 'SUPPLEMENTARY', direction: 'SELLER_TO_SJVN', status: 'DRAFT', billing_period: '2027-03', total_amount: 129600, energy_mwh: 60 });
    expect(inv.invoice_no).toMatch(/^BNK-PPA\//);
    const pos = (await request(app).get(`/api/energy-banking/${ppa.id}`).set(auth(reia))).body[0];
    expect(pos.settlement_invoice_no).toBe(inv.invoice_no);
  });

  it('banks only solar, wind and hybrid generation', async () => {
    const hydro = makeContract({ contract_type: 'PPA', project_type: 'Hydro', capacity_mw: 100, tenure_start: '2026-04-01' });
    expect((await bank({ contract_id: hydro.id })).body.error).toMatch(/banking is for solar, wind and hybrid/);
  });
});

// The buyer's side (decided 17-Oct-2026): a PSA's month bill leaves out its
// share of what the source generator banked, and when that energy is drawn back
// the buyer is billed its share then, at its own tariff.
describe('S54 Banked energy and the buyer', () => {
  const allocate = (pct) => db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, ?, '2026-04-01')`)
    .run(newId('CAL'), ppa.id, psa.id, pct);

  it('leaves the PSA\'s share of banked energy out of its month bill: 40 % of (8,200 − 100)', async () => {
    allocate(40);
    expect((await bank()).status).toBe(201);
    // The PSA holds no security against its overdue bills, so it is on hold
    // (CC4); Management has lifted it for the month's billing.
    db.prepare(`INSERT INTO contract_hold_overrides (id, contract_id, reason, approved_by, valid_until) VALUES ('CHO-T', ?, 'LC renewal with the bank, billing to continue', 'Management', date('now', '+10 days'))`).run(psa.id);
    const r = await post('/api/invoices/generate', { contract_id: psa.id, period_month: '2026-08', invoice_type: 'FINAL' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.energy_mwh).toBe(3240);
    expect(JSON.parse(r.body.invoice_breakdown_json).find((l) => l.code === 'BNK')).toMatchObject({ value: -40 });
  });

  it('bills the buyer its share when the energy is drawn: 40 % of 40 MWh × ₹3.00 = ₹48,000', async () => {
    allocate(40);
    await bank();
    const r = await post('/api/energy-banking/draw', { contract_id: ppa.id, cycle: 'FY2026-27', draw_mwh: 40 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.buyer_invoices).toHaveLength(1);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.body.buyer_invoices[0].id);
    expect(inv).toMatchObject({ contract_id: psa.id, invoice_type: 'SUPPLEMENTARY', direction: 'SJVN_TO_BUYER', status: 'DRAFT', energy_mwh: 16, total_amount: 48000 });
    expect(inv.invoice_no).toMatch(/^BNK-PSA\//);
  });

  it('passes the lapse on to the buyer: 40 % of 60 MWh × 75 % of ₹3.00 = ₹54,000', async () => {
    allocate(40);
    await bank();
    await post('/api/energy-banking/draw', { contract_id: ppa.id, cycle: 'FY2026-27', draw_mwh: 40 });
    const { settleExpiredBanking } = await import('../../src/services/energyBanking.js');
    const res = settleExpiredBanking('2027-05-01');
    expect(res.items[0].settlement_amount).toBe(129600); // the generator's lapse bill, as before
    expect(res.buyer_invoices).toHaveLength(1);
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(res.buyer_invoices[0].id);
    expect(inv).toMatchObject({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', invoice_type: 'SUPPLEMENTARY', status: 'DRAFT', billing_period: '2027-03', energy_mwh: 24, total_amount: 54000 });
    expect(inv.invoice_no).toMatch(/^BNK-PSA\//);
    expect(JSON.parse(inv.invoice_breakdown_json)[0].label).toMatch(/lapsed unused.*40% share, 24 MWh × ₹2.25\/unit \(75% of ₹3\)/);
  });

  it('refuses to bank a month the buyer has already been billed for', async () => {
    allocate(40);
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-08', invoice_type: 'PROVISIONAL' });
    expect((await bank()).body.error).toMatch(/buyer has already been billed for 2026-08/);
  });
});

// A monthly cycle (the master default) closed on the month's last day, but the
// month's energy locks only after the month: every Bank Energy was refused
// (31-Oct-2026). A cycle now takes entries until the end of the month after
// it ends, and settles after that.
describe('S54 Monthly banking cycle', () => {
  let mppa;
  beforeEach(() => {
    mppa = makeContract({ contract_type: 'PPA', capacity_mw: 50, tariff_per_unit: 2.88, tenure_start: '2026-04-01' });
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-09', 'FINAL', 'SEA', 7000, 'LOCKED')`).run(newId('ENG'), mppa.id);
  });

  it('closes a cycle\'s entries at the end of the month after it', async () => {
    const { entriesCloseOn } = await import('../../src/services/energyBanking.js');
    expect(entriesCloseOn('2026-09-30')).toBe('2026-10-31');
    expect(entriesCloseOn('2026-12-31')).toBe('2027-01-31');
    expect(entriesCloseOn('2027-01-31')).toBe('2027-02-28');
    expect(entriesCloseOn('2027-03-31')).toBe('2027-04-30');
  });

  it('banks September\'s locked energy in October into cycle M2026-09, with nothing typed for the cycle', async () => {
    const { bankEnergy } = await import('../../src/services/energyBanking.js');
    const row = bankEnergy({ contract_id: mppa.id, period_month: '2026-09', banked_mwh: 100, asOf: '2026-10-12' });
    expect(row).toMatchObject({ cycle: 'M2026-09', cycle_ends_on: '2026-09-30', banked_mwh: 100, tariff_per_unit: 2.88, status: 'OPEN' });
    // The last day of October still takes it; November does not.
    expect(bankEnergy({ contract_id: mppa.id, period_month: '2026-09', banked_mwh: 10, asOf: '2026-10-31' }).cycle).toBe('M2026-09');
    expect(() => bankEnergy({ contract_id: mppa.id, period_month: '2026-09', banked_mwh: 10, asOf: '2026-11-01' }))
      .toThrow(/ended on 2026-09-30 and took entries until 2026-10-31/);
    // A financial-year cycle typed on a monthly PPA is refused, not taken.
    expect(() => bankEnergy({ contract_id: mppa.id, cycle: 'FY2026-27', cycle_ends_on: '2027-03-31', period_month: '2026-09', banked_mwh: 10, asOf: '2026-10-12' }))
      .toThrow(/monthly basis: 2026-09 falls in cycle M2026-09, ending 2026-09-30/);
  });

  it('draws in October and bills it for September; refuses a draw in November', async () => {
    const { bankEnergy, drawBanked } = await import('../../src/services/energyBanking.js');
    bankEnergy({ contract_id: mppa.id, period_month: '2026-09', banked_mwh: 100, asOf: '2026-10-12' });
    const r = drawBanked({ contract_id: mppa.id, cycle: 'M2026-09', draw_mwh: 40, asOf: '2026-10-20' });
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.invoice.id);
    expect(inv).toMatchObject({ billing_period: '2026-09', energy_mwh: 40, total_amount: 115200, invoice_type: 'SUPPLEMENTARY', status: 'DRAFT' });
    expect(() => drawBanked({ contract_id: mppa.id, cycle: 'M2026-09', draw_mwh: 10, asOf: '2026-11-01' }))
      .toThrow(/closed on 2026-09-30 and took entries until 2026-10-31/);
  });

  it('settles what is left once October is over, billed for September: 60 MWh × ₹2.16', async () => {
    const { bankEnergy, drawBanked, settleExpiredBanking } = await import('../../src/services/energyBanking.js');
    bankEnergy({ contract_id: mppa.id, period_month: '2026-09', banked_mwh: 100, asOf: '2026-10-12' });
    drawBanked({ contract_id: mppa.id, cycle: 'M2026-09', draw_mwh: 40, asOf: '2026-10-20' });
    expect(settleExpiredBanking('2026-10-31').settled, 'entries still open').toBe(0);
    const res = settleExpiredBanking('2026-11-01');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ cycle: 'M2026-09', unused_mwh: 60, settlement_amount: 129600 });
    const row = db.prepare('SELECT * FROM energy_banking WHERE contract_id = ?').get(mppa.id);
    expect(db.prepare('SELECT billing_period FROM invoices WHERE id = ?').get(row.settlement_invoice_id).billing_period).toBe('2026-09');
  });

  it('banks the last month of an annual cycle in the month after: March into FY2026-27 in April', async () => {
    const { bankEnergy } = await import('../../src/services/energyBanking.js');
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2027-03', 'FINAL', 'SEA', 6000, 'LOCKED')`).run(newId('ENG'), ppa.id);
    expect(bankEnergy({ contract_id: ppa.id, period_month: '2027-03', banked_mwh: 50, asOf: '2027-04-10' })).toMatchObject({ cycle: 'FY2026-27', cycle_ends_on: '2027-03-31' });
  });

  it('tells the form the cycle a month falls in, and when its entries close', async () => {
    const r = await request(app).get(`/api/energy-banking/${mppa.id}/cycle?period=2026-09`).set(auth(reia));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ basis: 'MONTHLY', cycle: 'M2026-09', ends: '2026-09-30', entries_close_on: '2026-10-31' });
    expect((await request(app).get(`/api/energy-banking/${ppa.id}/cycle?period=2026-09`).set(auth(reia))).body)
      .toMatchObject({ basis: 'ANNUAL', cycle: 'FY2026-27', ends: '2027-03-31', entries_close_on: '2027-04-30' });
    expect((await request(app).get(`/api/energy-banking/${mppa.id}/cycle?period=2026-13`).set(auth(reia))).status).toBe(400);
    const seller = signToken(makeUser('SELLER', { linked_entity_id: makeEntity('SELLER').id }));
    expect((await request(app).get(`/api/energy-banking/${mppa.id}/cycle?period=2026-09`).set(auth(seller))).status).toBe(403);
  });

  it('shows on the position when a cycle\'s entries close', async () => {
    const { bankEnergy } = await import('../../src/services/energyBanking.js');
    bankEnergy({ contract_id: mppa.id, period_month: '2026-09', banked_mwh: 100, asOf: '2026-10-12' });
    const pos = (await request(app).get(`/api/energy-banking/${mppa.id}`).set(auth(reia))).body;
    expect(pos[0]).toMatchObject({ cycle: 'M2026-09', cycle_ends_on: '2026-09-30', entries_close_on: '2026-10-31', available_mwh: 100 });
  });
});
