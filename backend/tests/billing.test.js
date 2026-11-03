import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';
import { billTypeCoverage } from '../src/services/billingRegister.js';

// The Bill section: one client-first way in to all six bills, plus the Bill of
// Supply register behind the supply-bill screens.

let trader, clientId;

beforeEach(() => {
  db.prepare('DELETE FROM bill_of_supply').run();
  db.prepare('DELETE FROM view_bill_invoices').run();
  db.prepare('DELETE FROM bilateral_approvals').run();
  db.prepare('DELETE FROM bilateral_schedules').run();
  db.prepare('DELETE FROM noar_status_timeline').run();
  db.prepare('DELETE FROM bilateral_order_details').run();
  db.prepare('DELETE FROM bilateral_transactions').run();
  db.prepare('DELETE FROM bid_blocks').run();
  db.prepare('DELETE FROM bid_events').run();
  db.prepare('DELETE FROM bids').run();
  db.prepare('DELETE FROM exchange_contracts').run();
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();

  clientId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, name, client_type, status, exposure_limit)
              VALUES (?, 'New Delhi Municipal Council', 'DISCOM', 'ACTIVE', 100000000)`).run(clientId);
  trader = tokenFor('TRADING_USER');
});

/** A bilateral contract taken to "open access granted, meters in". */
async function bilateralReady(over = {}) {
  const tx = await request(app).post('/api/bilateral').set(auth(trader)).send({
    counterparty: 'New Delhi Municipal Council',
    procurer_name: 'New Delhi Municipal Council',
    procurer_sldc: 'Delhi', supplier_sldc: 'West Bengal',
    client_id: clientId,
    quantum_mw: 100, sale_rate_per_unit: 4.5, trading_margin_per_unit: 0.03,
    start_date: '2026-09-01', end_date: '2026-09-07',
    oa_type: 'STOA', noar_region: 'NR', loa_no: 'BIL/LOA/001',
    ...over,
  });
  expect(tx.status).toBe(201);
  const sched = await request(app).post(`/api/bilateral/${tx.body.id}/schedules`).set(auth(trader))
    .send({ schedule_date: '2026-09-01', blocks: [{ time_block: '00:00-00:15', approved_mw: 100 }] });
  for (const s of ['FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED']) {
    await request(app).post(`/api/bilateral/${tx.body.id}/noar`).set(auth(trader)).send({ noar_status: s });
  }
  await request(app).post(`/api/bilateral/schedules/${sched.body.schedules[0].id}/actuals`).set(auth(trader))
    .send({ actual_mw: 100 });
  return tx.body;
}

async function exchangeContract() {
  const r = await request(app).post('/api/exchange-contracts').set(auth(trader)).send({
    portfolio_id: 'PF-1', loa_no: 'EXC/LOA/001',
    start_date: '2026-09-01', end_date: '2026-09-30',
    side: 'Buyer', client_id: clientId, product: 'DAM',
    bidding_type: 'Single', billing_type: 'Weekly', trading_margin: 0.03,
    is_renewable: 'No', carry_over: 'No',
    schedule_details: [{ date_from: '2026-09-01', date_to: '2026-09-30', time_from: '00:00', time_to: '24:00', rate: 4.2, quantum: 100 }],
  });
  expect(r.status).toBe(201);
  return r.body;
}

describe('the bill type registry', () => {
  it('covers exactly what the two engines raise', () => {
    const c = billTypeCoverage();
    expect(c.missing_from_registry).toEqual([]);
    expect(c.unknown_to_engines).toEqual([]);
  });

  it('tells the form what each bill type settles against', async () => {
    const r = await request(app).get('/api/billing/meta').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.bill_types).toHaveLength(6);
    const energy = r.body.bill_types.find((t) => t.code === 'BILATERAL_ENERGY');
    expect(energy.kind).toBe('BILATERAL');
    expect(energy.label).toBe('Bilateral Energy Settlement');
  });
});

describe('finding what to bill', () => {
  it('lists counterparties from both registers, not a hardcoded array', async () => {
    await bilateralReady();
    await exchangeContract();
    const r = await request(app).get('/api/billing/clients').set(auth(trader));
    expect(r.status).toBe(200);
    const ndmc = r.body.find((c) => c.name === 'New Delhi Municipal Council');
    expect(ndmc.kinds).toEqual(['BILATERAL', 'EXCHANGE']);
    expect(ndmc.client_id).toBe(clientId);
  });

  it('narrows contracts to the register the bill type settles against', async () => {
    await bilateralReady();
    await exchangeContract();
    const bil = await request(app).get('/api/billing/contracts')
      .query({ bill_type: 'BILATERAL_ENERGY', client_id: clientId }).set(auth(trader));
    expect(bil.body.every((c) => c.kind === 'BILATERAL')).toBe(true);
    const exc = await request(app).get('/api/billing/contracts')
      .query({ bill_type: 'TRADING_MARGIN', client_id: clientId }).set(auth(trader));
    expect(exc.body.every((c) => c.kind === 'EXCHANGE')).toBe(true);
  });

  it('says whether a contract can actually be billed yet', async () => {
    const tx = await bilateralReady();
    const r = await request(app).get('/api/billing/contracts')
      .query({ bill_type: 'BILATERAL_ENERGY', client_id: clientId }).set(auth(trader));
    const row = r.body.find((c) => c.contract_id === tx.id);
    expect(row.billable).toBe(true);
    expect(row.state).toMatch(/open access APPROVED/);
  });

  it('flags a contract whose open access has not been granted', async () => {
    const tx = await request(app).post('/api/bilateral').set(auth(trader)).send({
      counterparty: 'New Delhi Municipal Council', procurer_name: 'New Delhi Municipal Council',
      client_id: clientId, quantum_mw: 10, sale_rate_per_unit: 4.5, trading_margin_per_unit: 0.03,
      start_date: '2026-09-01', end_date: '2026-09-07',
    });
    const r = await request(app).get('/api/billing/contracts')
      .query({ bill_type: 'BILATERAL_ENERGY', client_id: clientId }).set(auth(trader));
    expect(r.body.find((c) => c.contract_id === tx.body.id).billable).toBe(false);
  });

  it('rejects a bill type it does not know', async () => {
    const r = await request(app).get('/api/billing/contracts').query({ bill_type: 'NONSENSE' }).set(auth(trader));
    expect(r.status).toBe(400);
  });

  it('lets the fee bills through before open access is granted, as the API does', async () => {
    const tx = await request(app).post('/api/bilateral').set(auth(trader)).send({
      counterparty: 'New Delhi Municipal Council', procurer_name: 'New Delhi Municipal Council',
      client_id: clientId, quantum_mw: 10, sale_rate_per_unit: 4.5, trading_margin_per_unit: 0.03,
      start_date: '2026-09-01', end_date: '2026-09-07',
    });
    for (const bill_type of ['BILATERAL_OA', 'BILATERAL_SLDC']) {
      const r = await request(app).get('/api/billing/contracts').query({ bill_type, client_id: clientId }).set(auth(trader));
      expect(r.body.find((c) => c.contract_id === tx.body.id).billable).toBe(true);
    }
  });
});

describe('previewing a bill', () => {
  it('prices it without writing anything', async () => {
    const tx = await bilateralReady();
    const r = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id });
    expect(r.status).toBe(200);
    expect(r.body.invoice_amount).toBe(25 * 1000 * 4.5);
    expect(r.body.objection).toBeNull();
    expect(db.prepare('SELECT COUNT(*) n FROM view_bill_invoices').get().n).toBe(0);
  });

  it('shows the numbers and the reason when a bill could not be raised', async () => {
    const tx = await bilateralReady();
    // Inside the contract's term, on days with no schedule.
    const r = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_OA', contract_id: tx.id, from: '2026-09-03', to: '2026-09-05' });
    expect(r.status).toBe(200);
    expect(r.body.objection.error).toMatch(/No volume settled/);
    expect(r.body.objection.would_bill).toBeGreaterThan(0);
  });

  it('refuses a period outside the contract term', async () => {
    const tx = await bilateralReady();
    const r = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_OA', contract_id: tx.id, from: '2027-01-01', to: '2027-01-31' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cannot run past it/);
  });

  it('refuses a date that does not exist', async () => {
    const tx = await bilateralReady();
    const r = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_OA', contract_id: tx.id, from: '2026-02-30' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/real date/);
  });

  it('rejects a malformed period', async () => {
    const tx = await bilateralReady();
    const r = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, from: '01-09-2026' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/YYYY-MM-DD/);
  });

  it('404s on a contract that does not exist', async () => {
    const r = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: 'BIL-nope' });
    expect(r.status).toBe(404);
  });
});

describe('generating a bill', () => {
  it('raises a bilateral bill through the unified route', async () => {
    const tx = await bilateralReady();
    const r = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, invoice_date: '2026-09-08' });
    expect(r.status).toBe(201);
    expect(r.body.bilateral_id).toBe(tx.id);
    expect(r.body.generated_from).toBe('SETTLEMENT');
    expect(r.body.invoice_no).toMatch(/^SJVN\/ENERGY\/NEW\/202609\/\d+$/);
  });

  it('raises an exchange bill through the same route', async () => {
    const c = await exchangeContract();
    const r = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'TRADING_MARGIN', contract_id: c.id, allow_zero_volume: true, invoice_date: '2026-09-08' });
    // Nothing cleared, so the margin bill has nothing in it at all.
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Nothing to bill/);
  });

  it('refuses to bill energy before open access is granted', async () => {
    const tx = await request(app).post('/api/bilateral').set(auth(trader)).send({
      counterparty: 'NDMC', procurer_name: 'NDMC', client_id: clientId,
      quantum_mw: 10, sale_rate_per_unit: 4.5, trading_margin_per_unit: 0.03,
      start_date: '2026-09-01', end_date: '2026-09-07',
    });
    const r = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.body.id });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Open access is PENDING/);
  });

  it('leaves LPS off unless the form asks for it', async () => {
    const tx = await bilateralReady({ late_payment_surcharge: 5000 });
    const plain = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id });
    expect(plain.body.line_items.some((l) => /Late payment/.test(l.description))).toBe(false);

    const withLps = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, lps: 'Yes' });
    const leg = withLps.body.line_items.find((l) => /Late payment/.test(l.description));
    expect(leg.amount).toBe(5000);
    expect(withLps.body.invoice_amount).toBe(plain.body.invoice_amount + 5000);
  });

  it('keeps a read-only role out of billing', async () => {
    const tx = await bilateralReady();
    const r = await request(app).post('/api/billing/generate').set(auth(tokenFor('MANAGEMENT')))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id });
    expect(r.status).toBe(403);
  });

  it('refuses a second bill for days an active bill already covers', async () => {
    const tx = await bilateralReady();
    const first = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, from: '2026-09-01', to: '2026-09-01' });
    expect(first.status).toBe(201);
    // The same day again is a duplicate; a wider period that takes it in is an overlap.
    const same = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, from: '2026-09-01', to: '2026-09-01' });
    expect(same.status).toBe(409);
    await request(app).post(`/api/bilateral/${tx.id}/schedules`).set(auth(trader))
      .send({ schedule_date: '2026-09-02', blocks: [{ time_block: '00:00-00:15', approved_mw: 100 }] });
    const wider = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, from: '2026-09-01', to: '2026-09-02' });
    expect(wider.status).toBe(409);
    expect(wider.body.error).toMatch(/would bill those days again/);
  });

  it('charges a one-off fee once per contract, not once per bill', async () => {
    const tx = await bilateralReady();
    const first = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_OA', contract_id: tx.id, from: '2026-09-01', to: '2026-09-01' });
    expect(first.status).toBe(201);
    expect(first.body.line_items.some((l) => l.description === 'NOAR Application Fee')).toBe(true);
    const later = await request(app).post('/api/billing/preview').set(auth(trader))
      .send({ bill_type: 'BILATERAL_OA', contract_id: tx.id, from: '2026-09-02', to: '2026-09-07' });
    expect(later.body.line_items.some((l) => l.description === 'NOAR Application Fee')).toBe(false);
    expect(later.body.warnings.join(' ')).toMatch(/billed once already/);
  });

  it('refuses an invoice date or credit period that cannot be right', async () => {
    const tx = await bilateralReady();
    const bad = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, invoice_date: 'yesterday' });
    expect(bad.status).toBe(400);
    const negative = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: tx.id, credit_days: -30 });
    expect(negative.status).toBe(400);
    expect(negative.body.error).toMatch(/credit_days/);
  });

  it('404s when the contract is not in the register the bill type settles against', async () => {
    const c = await exchangeContract();
    const r = await request(app).post('/api/billing/generate').set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', contract_id: c.id });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/No bilateral contract/);
  });
});

describe('bill of supply', () => {
  const base = (over = {}) => ({
    client_name: 'New Delhi Municipal Council',
    client_id: clientId,
    seller_name: 'Dikchu Hydro',
    buyer_name: 'New Delhi Municipal Council',
    contract_no: 'BIL/LOA/001',
    invoice_date: '2026-09-08',
    supply_from_date: '2026-09-01',
    supply_to_date: '2026-09-07',
    quantity: 500,
    unit: 'MWh',
    rate: 4500,
    rebate_percent: 2,
    ...over,
  });

  it('derives the amount and the rebate rather than trusting two typed figures', async () => {
    const r = await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base());
    expect(r.status).toBe(201);
    expect(r.body.amount).toBe(500 * 4500);
    expect(r.body.amount_after_rebate).toBe(2_250_000 * 0.98);
    expect(r.body.bill_no).toMatch(/^SJVN\/BOS\/202609\/\d{4}$/);
    // Electricity's HSN, defaulted so the operator does not have to know it.
    expect(r.body.hsn_code).toBe('27160000');
  });

  it('ignores a stated amount: the bill is always quantity times rate', async () => {
    const r = await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ amount: -2_000_000, rebate_percent: 0 }));
    expect(r.status).toBe(201);
    expect(r.body.amount).toBe(500 * 4500);
  });

  it('refuses the same client billed again for days an active bill covers', async () => {
    const first = await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base());
    const again = await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ supply_from_date: '2026-09-05', supply_to_date: '2026-09-10', invoice_date: '2026-09-11' }));
    expect(again.status).toBe(409);
    expect(again.body.existing_bill_no).toBe(first.body.bill_no);
  });

  it('refuses dates that cannot be right', async () => {
    const post = (over) => request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base(over));
    expect((await post({ supply_from_date: '2026-02-30', supply_to_date: '2026-02-31' })).status).toBe(400);
    expect((await post({ invoice_due_date: '2026-09-01' })).body.error).toMatch(/invoice_due_date cannot be before/);
    expect((await post({ invoice_date: '2026-08-01' })).body.error).toMatch(/before the supply period begins/);
    expect((await post({ unit: 'barrels' })).body.error).toMatch(/unit must be one of/);
    expect((await post({ client_id: 'TCL-nope' })).status).toBe(400);
  });

  it('keeps numbering past a number given by hand', async () => {
    const a = await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ bill_no: 'SJVN/BOS/202609/0002' }));
    expect(a.status).toBe(201);
    const b = await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ contract_no: 'BIL/LOA/002' }));
    expect(b.status).toBe(201);
    expect(b.body.bill_no).toBe('SJVN/BOS/202609/0003');
  });

  it('refuses a supply period that ends before it starts', async () => {
    const r = await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ supply_from_date: '2026-09-07', supply_to_date: '2026-09-01' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cannot be before/);
  });

  it('refuses a rebate outside 0-100', async () => {
    const r = await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ rebate_percent: 140 }));
    expect(r.status).toBe(400);
  });

  it('refuses a non-positive quantity', async () => {
    const r = await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base({ quantity: 0 }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/quantity must be a positive/);
  });

  it('refuses a duplicate bill number', async () => {
    await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base({ bill_no: 'BOS/1' }));
    const again = await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base({ bill_no: 'BOS/1' }));
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already exists/);
  });

  it('lists and searches the register', async () => {
    await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base());
    await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ client_name: 'Kreate Energy', invoice_date: '2026-09-09' }));
    const all = await request(app).get('/api/billing/bill-of-supply').set(auth(trader));
    expect(all.body).toHaveLength(2);
    const one = await request(app).get('/api/billing/bill-of-supply').query({ q: 'Kreate' }).set(auth(trader));
    expect(one.body).toHaveLength(1);
  });

  it('cancels with a reason, once, and keeps the number in the report but out of its totals', async () => {
    const created = await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base());
    const bare = await request(app).post(`/api/billing/bill-of-supply/${created.body.id}/cancel`).set(auth(trader)).send({});
    expect(bare.status).toBe(400);
    const done = await request(app).post(`/api/billing/bill-of-supply/${created.body.id}/cancel`).set(auth(trader))
      .send({ reason: 'Raised on the wrong contract' });
    expect(done.status).toBe(200);
    expect(done.body.cancel_reason).toBe('Raised on the wrong contract');
    const twice = await request(app).post(`/api/billing/bill-of-supply/${created.body.id}/cancel`).set(auth(trader))
      .send({ reason: 'again' });
    expect(twice.status).toBe(409);
    const list = await request(app).get('/api/billing/bill-of-supply').set(auth(trader));
    expect(list.body).toHaveLength(0);
    const report = await request(app).get('/api/billing/supply-bill-report').set(auth(trader));
    expect(report.body.rows).toHaveLength(1);
    expect(report.body.rows[0].status).toBe('CANCELLED');
    expect(report.body.summary).toMatchObject({ bills: 0, cancelled: 1, total_amount: 0 });
  });

  it('reports the register live, with its totals', async () => {
    await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base());
    // The second in MU: the report adds it as 200 MWh, not 0.2.
    await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ quantity: 0.2, unit: 'MU', rate: 4_000_000, rebate_percent: 0, contract_no: 'BIL/LOA/002' }));
    const r = await request(app).get('/api/billing/supply-bill-report').set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.summary.bills).toBe(2);
    expect(r.body.summary.total_energy_mwh).toBe(700);
    expect(r.body.summary.total_amount).toBe(2_250_000 * 0.98 + 800_000);
    expect(r.body.rows[0]).toHaveProperty('bill_no');
  });

  it('narrows the report to a date range', async () => {
    await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send(base({ invoice_date: '2026-09-08' }));
    await request(app).post('/api/billing/bill-of-supply').set(auth(trader))
      .send(base({ invoice_date: '2026-07-08', supply_from_date: '2026-07-01', supply_to_date: '2026-07-07' }));
    const r = await request(app).get('/api/billing/supply-bill-report')
      .query({ from: '2026-09-01', to: '2026-09-30' }).set(auth(trader));
    expect(r.body.summary.bills).toBe(1);
  });

  it('keeps a read-only role out of raising one', async () => {
    const r = await request(app).post('/api/billing/bill-of-supply').set(auth(tokenFor('MANAGEMENT'))).send(base());
    expect(r.status).toBe(403);
  });
});

describe('the ISET supply bill report screen', () => {
  it('reads the live register, not the pending-report samples', async () => {
    const r0 = await request(app).get('/api/iset-reports/supply-bill-report').set(auth(trader));
    expect(r0.body).toHaveLength(0);

    await request(app).post('/api/billing/bill-of-supply').set(auth(trader)).send({
      client_name: 'New Delhi Municipal Council', invoice_date: '2026-09-08',
      supply_from_date: '2026-09-01', supply_to_date: '2026-09-07',
      quantity: 500, rate: 4500, rebate_percent: 2,
    });
    const r = await request(app).get('/api/iset-reports/supply-bill-report').set(auth(trader));
    expect(r.body).toHaveLength(1);
    expect(r.body[0].client_name).toBe('New Delhi Municipal Council');
    expect(r.body[0].amount_rs).toBe(2_250_000 * 0.98);
  });
});

describe('the trading settlement register', () => {
  it('opens to every role the screen admits, and writes stay with the desk', async () => {
    for (const role of ['MANAGEMENT', 'TRADING_ADMIN', 'FINANCE_USER', 'SJVN_ADMIN']) {
      const r = await request(app).get('/api/billing-settlement/invoices').set(auth(tokenFor(role)));
      expect(r.status, role).toBe(200);
    }
    const mgmt = await request(app).post('/api/billing-settlement/invoices/generate').set(auth(tokenFor('MANAGEMENT')))
      .send({ client_id: clientId, invoice_kind: 'EXCHANGE', billing_period: '2026-09', sjvn_margin: 1000 });
    expect(mgmt.status).toBe(403);
    const admin = await request(app).post('/api/billing-settlement/invoices/generate').set(auth(tokenFor('TRADING_ADMIN')))
      .send({ client_id: clientId, invoice_kind: 'EXCHANGE', billing_period: '2026-09', sjvn_margin: 1000 });
    expect(admin.status).toBe(200);
  });
});
