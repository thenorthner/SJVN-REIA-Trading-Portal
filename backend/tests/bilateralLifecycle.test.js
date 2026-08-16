import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';
import { newId } from '../src/util.js';
import { seedRateMaster } from '../src/services/rateMaster.js';

// The bilateral desk end to end: a contract is created, schedules are punched,
// the four scheduling nodes clear them, NOAR grants open access, meters report,
// and the three bills are raised off the settled energy.

let trader;

beforeEach(() => {
  // Dependents first — several tables carry a foreign key onto a transaction.
  db.prepare('DELETE FROM view_bill_invoices').run();
  db.prepare('DELETE FROM bilateral_approvals').run();
  db.prepare('DELETE FROM bilateral_schedules').run();
  db.prepare('DELETE FROM noar_status_timeline').run();
  db.prepare('DELETE FROM oa_charge_estimates').run();
  db.prepare('DELETE FROM schedule_deviations').run();
  db.prepare('DELETE FROM bilateral_order_details').run();
  db.prepare('DELETE FROM bilateral_transactions').run();
  db.prepare('DELETE FROM rate_master').run();
  seedRateMaster();
  trader = tokenFor('TRADING_USER');
});

const contractBody = (over = {}) => ({
  counterparty: 'New Delhi Municipal Council',
  procurer_name: 'New Delhi Municipal Council',
  procurer_sldc: 'Delhi',
  supplier_sldc: 'West Bengal',
  quantum_mw: 100,
  sale_rate_per_unit: 4.5,
  trading_margin_per_unit: 0.03,
  start_date: '2026-09-01',
  end_date: '2026-09-07',
  oa_type: 'STOA',
  noar_region: 'NR',
  ...over,
});

async function createContract(over = {}) {
  const r = await request(app).post('/api/bilateral').set(auth(trader)).send(contractBody(over));
  expect(r.status).toBe(201);
  return r.body;
}

async function punchSchedule(txId, blocks) {
  const r = await request(app).post(`/api/bilateral/${txId}/schedules`).set(auth(trader))
    .send({ schedule_date: '2026-09-01', blocks });
  expect(r.status).toBe(201);
  return r.body;
}

async function clearAllNodes(schedId) {
  for (const node of ['INJECTION_SLDC', 'RLDC', 'NLDC', 'DRAWEE_SLDC']) {
    const r = await request(app).post(`/api/bilateral/schedules/${schedId}/approvals`).set(auth(trader))
      .send({ node_type: node, status: 'APPROVED' });
    expect(r.status).toBe(200);
  }
}

const txRow = (id) => db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(id);

describe('bilateral lifecycle status', () => {
  it('starts a fresh contract at DRAFT / PENDING', async () => {
    const tx = await createContract();
    expect(tx.schedule_status).toBe('DRAFT');
    expect(tx.open_access_status).toBe('PENDING');
  });

  it('moves the schedule to SUBMITTED when blocks are punched', async () => {
    const tx = await createContract();
    await punchSchedule(tx.id, [{ time_block: '00:00-00:15', approved_mw: 100 }]);
    expect(txRow(tx.id).schedule_status).toBe('SUBMITTED');
  });

  it('moves the schedule to APPROVED once every node has cleared it', async () => {
    const tx = await createContract();
    const after = await punchSchedule(tx.id, [{ time_block: '00:00-00:15', approved_mw: 100 }]);
    await clearAllNodes(after.schedules[0].id);
    expect(txRow(tx.id).schedule_status).toBe('APPROVED');
  });

  it('holds the schedule at SUBMITTED while a node is still pending', async () => {
    const tx = await createContract();
    const after = await punchSchedule(tx.id, [{ time_block: '00:00-00:15', approved_mw: 100 }]);
    await request(app).post(`/api/bilateral/schedules/${after.schedules[0].id}/approvals`).set(auth(trader))
      .send({ node_type: 'RLDC', status: 'APPROVED' });
    expect(txRow(tx.id).schedule_status).toBe('SUBMITTED');
  });

  it('grants open access when NOAR approves the application', async () => {
    const tx = await createContract();
    for (const s of ['FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED']) {
      await request(app).post(`/api/bilateral/${tx.id}/noar`).set(auth(trader)).send({ noar_status: s });
    }
    expect(txRow(tx.id).open_access_status).toBe('APPROVED');
  });

  it('refuses open access when NOAR rejects the application', async () => {
    const tx = await createContract();
    for (const s of ['FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED']) {
      await request(app).post(`/api/bilateral/${tx.id}/noar`).set(auth(trader)).send({ noar_status: s });
    }
    await request(app).post(`/api/bilateral/${tx.id}/noar`).set(auth(trader))
      .send({ noar_status: 'REJECTED', rejection_reason: 'Corridor unavailable' });
    expect(txRow(tx.id).open_access_status).toBe('REJECTED');
  });

  it('reads an approval with curtailed blocks as PARTIAL and REVISED', async () => {
    const tx = await createContract();
    const after = await punchSchedule(tx.id, [{ time_block: '00:00-00:15', approved_mw: 100 }]);
    for (const s of ['FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED']) {
      await request(app).post(`/api/bilateral/${tx.id}/noar`).set(auth(trader)).send({ noar_status: s });
    }
    await request(app).post(`/api/bilateral/schedules/${after.schedules[0].id}/curtail`).set(auth(trader))
      .send({ curtailed_mw: 30 });
    const row = txRow(tx.id);
    expect(row.schedule_status).toBe('REVISED');
    expect(row.open_access_status).toBe('PARTIAL');
  });
});

/** Take a contract all the way to "open access granted, meters in". */
async function readyToBill(over = {}) {
  const tx = await createContract(over);
  const after = await punchSchedule(tx.id, [
    { time_block: '00:00-00:15', approved_mw: 100 },
    { time_block: '00:15-00:30', approved_mw: 100 },
  ]);
  for (const s of ['FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED']) {
    await request(app).post(`/api/bilateral/${tx.id}/noar`).set(auth(trader)).send({ noar_status: s });
  }
  for (const sched of after.schedules) {
    await request(app).post(`/api/bilateral/schedules/${sched.id}/actuals`).set(auth(trader))
      .send({ actual_mw: 100 });
  }
  return tx;
}

describe('bilateral settlement endpoint', () => {
  it('returns the settled position for the supply period', async () => {
    const tx = await readyToBill();
    const r = await request(app).get(`/api/bilateral/${tx.id}/settlement`).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.energy.delivered_mwh).toBe(50); // 2 blocks x 100 MW x 0.25 h
    expect(r.body.money.sale_value).toBe(225000);
  });

  it('prices a named bill without writing one', async () => {
    const tx = await readyToBill();
    const r = await request(app).get(`/api/bilateral/${tx.id}/settlement`)
      .query({ bill_type: 'BILATERAL_ENERGY' }).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body.invoice_amount).toBe(225000);
    expect(db.prepare('SELECT COUNT(*) n FROM view_bill_invoices').get().n).toBe(0);
  });

  it('rejects a bill type it does not raise', async () => {
    const tx = await readyToBill();
    const r = await request(app).get(`/api/bilateral/${tx.id}/settlement`)
      .query({ bill_type: 'NONSENSE' }).set(auth(trader));
    expect(r.status).toBe(400);
  });

  it('404s for a transaction that does not exist', async () => {
    const r = await request(app).get('/api/bilateral/BIL-nope/settlement').set(auth(trader));
    expect(r.status).toBe(404);
  });
});

describe('bilateral invoice generation', () => {
  it('raises an energy bill into the View Bills register', async () => {
    const tx = await readyToBill();
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', invoice_date: '2026-09-08' });
    expect(r.status).toBe(201);
    expect(r.body.invoice_amount).toBe(225000);
    expect(r.body.bilateral_id).toBe(tx.id);
    expect(r.body.quantum_mwh).toBe(50);
    expect(r.body.settlement_basis).toBe('FINAL');
    expect(r.body.generated_from).toBe('SETTLEMENT');
    // No linked trading client, so the code falls back to the derived one.
    expect(r.body.invoice_no).toMatch(/^SJVN\/ENERGY\/NEW\/202609\/\d+$/);
    // It shows up on the ISET screen that reads the register.
    const list = await request(app).get('/api/view-bill-invoices')
      .query({ bill_type: 'BILATERAL_ENERGY' }).set(auth(trader));
    expect(list.body.map((i) => i.id)).toContain(r.body.id);
  });

  it('refuses to bill energy before open access is granted', async () => {
    const tx = await createContract();
    await punchSchedule(tx.id, [{ time_block: '00:00-00:15', approved_mw: 100 }]);
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Open access is PENDING/);
  });

  it('marks a bill provisional while blocks are still unmetered', async () => {
    const tx = await createContract();
    const after = await punchSchedule(tx.id, [
      { time_block: '00:00-00:15', approved_mw: 100 },
      { time_block: '00:15-00:30', approved_mw: 100 },
    ]);
    for (const s of ['FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED']) {
      await request(app).post(`/api/bilateral/${tx.id}/noar`).set(auth(trader)).send({ noar_status: s });
    }
    await request(app).post(`/api/bilateral/schedules/${after.schedules[0].id}/actuals`).set(auth(trader))
      .send({ actual_mw: 90 });
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY' });
    expect(r.status).toBe(201);
    expect(r.body.settlement_basis).toBe('PROVISIONAL');
  });

  it('numbers the open-access and SLDC bills under their own registers', async () => {
    const tx = await readyToBill();
    const oa = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_OA', invoice_date: '2026-09-08' });
    expect(oa.status).toBe(201);
    expect(oa.body.invoice_no).toMatch(/^SJVN\/BILAT\/OA\/NEW\/202609\/\d+$/);

    const sldc = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_SLDC', invoice_date: '2026-09-08' });
    expect(sldc.status).toBe(201);
    expect(sldc.body.invoice_amount).toBe(5000);
    expect(sldc.body.invoice_no).toMatch(/^SJVN\/BILAT\/SLDC\/NEW\/202609\/\d+$/);
  });

  it('bills under the trading client short code when the contract is linked to one', async () => {
    // The desk calls this counterparty NDMC, which is what its ledger numbers read.
    const entityId = newId('BUY');
    db.prepare(`INSERT INTO entities (id, entity_type, category, name, short_code, status)
                VALUES (?, 'BUYER', 'DISCOM', 'New Delhi Municipal Council', 'NDMC', 'APPROVED')`).run(entityId);
    const clientId = newId('TCL');
    db.prepare(`INSERT INTO trading_clients (id, name, entity_id, client_type) VALUES (?, ?, ?, 'DISCOM')`)
      .run(clientId, 'New Delhi Municipal Council', entityId);

    const tx = await readyToBill({ client_id: clientId });
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', invoice_date: '2026-09-08' });
    expect(r.status).toBe(201);
    expect(r.body.invoice_no).toMatch(/^SJVN\/ENERGY\/NDMC\/202609\/\d+$/);
  });

  it('stores the breakup so a bill can be read back to its blocks', async () => {
    const tx = await readyToBill();
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY' });
    const breakup = JSON.parse(db.prepare('SELECT breakup_json FROM view_bill_invoices WHERE id = ?').get(r.body.id).breakup_json);
    expect(breakup.line_items[0].description).toBe('Energy charges');
    expect(breakup.settlement.energy.blocks).toBe(2);
  });

  it('lists the bills raised against the transaction', async () => {
    const tx = await readyToBill();
    await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader)).send({ bill_type: 'BILATERAL_ENERGY' });
    await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader)).send({ bill_type: 'BILATERAL_SLDC' });
    const r = await request(app).get(`/api/bilateral/${tx.id}/invoices`).set(auth(trader));
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
  });

  it('sets the due date from the credit period', async () => {
    const tx = await readyToBill();
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', invoice_date: '2026-09-08', credit_days: 30 });
    expect(r.body.invoice_due_date).toBe('2026-10-08');
  });

  it('refuses a period whose end precedes its start', async () => {
    const tx = await readyToBill();
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', from: '2026-09-05', to: '2026-09-01' });
    expect(r.status).toBe(400);
  });

  it('refuses to raise an empty bill for a period with nothing in it', async () => {
    const tx = await readyToBill();
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY', from: '2027-01-01', to: '2027-01-31' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Nothing to bill/);
  });

  it('will not bill open-access fees for a period with no settled energy', async () => {
    // The NOAR fee and the RLDC/SLDC day charges price to a real amount with no
    // energy behind them, so the bill has to be asked for explicitly.
    const tx = await readyToBill();
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_OA', from: '2027-01-01', to: '2027-01-31' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/No volume settled/);
    expect(r.body.would_bill).toBeGreaterThan(0);
  });

  it('bills the consent fee for an empty period when explicitly asked to', async () => {
    const tx = await readyToBill();
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_SLDC', from: '2027-01-01', to: '2027-01-31', allow_zero_volume: true });
    expect(r.status).toBe(201);
    expect(r.body.invoice_amount).toBe(5000);
  });

  it('records the settled volume back onto the transaction', async () => {
    const tx = await readyToBill();
    await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(trader)).send({ bill_type: 'BILATERAL_ENERGY' });
    expect(txRow(tx.id).contracted_mwh).toBe(50);
  });

  it('keeps a read-only role out of the billing run', async () => {
    const tx = await readyToBill();
    const viewer = tokenFor('MANAGEMENT');
    const r = await request(app).post(`/api/bilateral/${tx.id}/invoices`).set(auth(viewer))
      .send({ bill_type: 'BILATERAL_ENERGY' });
    expect(r.status).toBe(403);
  });
});
