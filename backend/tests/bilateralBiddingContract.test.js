import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';

// Format generation → contract. The ISET application carries the parties, the
// corridor and the schedule but no commercial terms, so converting it is an
// explicit step that asks for the rate rather than inventing one.

let trader;

beforeEach(() => {
  db.prepare('DELETE FROM bilateral_applications').run();
  db.prepare('DELETE FROM bilateral_biddings').run();
  db.prepare('DELETE FROM bilateral_order_details').run();
  db.prepare('DELETE FROM bilateral_transactions').run();
  trader = tokenFor('TRADING_USER');
});

const biddingBody = (over = {}) => ({
  applicant: 'SJVN Limited',
  seller_name: 'Dikchu Hydro Electric Project',
  seller_sldc: 'West Bengal',
  seller_region: 'ER',
  seller_injecting_point: 'Dikchu Bus',
  seller_contract_id: 'SC-1',
  seller_contract_no: 'SELL/2026/001',
  buyer_name: 'New Delhi Municipal Council',
  buyer_sldc: 'Delhi',
  buyer_region: 'NR',
  buyer_drawal_point: 'NDMC Bus',
  buyer_contract_id: 'BC-1',
  buyer_contract_no: 'BUY/2026/001',
  under_gtam: 'No',
  access_type: 'T-GNA',
  accept_partial: 'No',
  application_type: 'Fresh',
  route: 'ER-NR corridor',
  generating_sources: ['Hydro'],
  declaration_accepted: true,
  schedule_details: [
    { date_from: '2026-09-01', date_to: '2026-09-03', time_from: '00:00', time_to: '24:00', capacity: 50 },
    { date_from: '2026-09-04', date_to: '2026-09-07', time_from: '00:00', time_to: '24:00', capacity: 80 },
  ],
  ...over,
});

async function makeBidding(over = {}) {
  const r = await request(app).post('/api/bilateral-bidding').set(auth(trader)).send(biddingBody(over));
  expect(r.status).toBe(201);
  return r.body;
}

describe('converting a format-generation application into a contract', () => {
  it('carries the parties, corridor and schedule span onto the contract', async () => {
    const bid = await makeBidding();
    const r = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader))
      .send({ sale_rate_per_unit: 4.5 });
    expect(r.status).toBe(201);
    const tx = r.body;
    expect(tx.counterparty).toBe('New Delhi Municipal Council');
    expect(tx.supplier_name).toBe('Dikchu Hydro Electric Project');
    expect(tx.supplier_sldc).toBe('West Bengal');
    expect(tx.procurer_sldc).toBe('Delhi');
    expect(tx.route).toBe('ER-NR corridor');
    // Spans the whole application and is sized to its peak block.
    expect(tx.start_date).toBe('2026-09-01');
    expect(tx.end_date).toBe('2026-09-07');
    expect(tx.quantum_mw).toBe(80);
  });

  it('derives the purchase rate from the sale rate and the margin', async () => {
    const bid = await makeBidding();
    const r = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader))
      .send({ sale_rate_per_unit: 4.5, trading_margin_per_unit: 0.03 });
    expect(r.body.sale_rate_per_unit).toBe(4.5);
    expect(r.body.purchase_rate_per_unit).toBe(4.47);
    expect(r.body.trading_margin_per_unit).toBe(0.03);
  });

  it('refuses to invent a rate the application does not carry', async () => {
    const bid = await makeBidding();
    const r = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader)).send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/sale_rate_per_unit is required/);
    expect(db.prepare('SELECT COUNT(*) n FROM bilateral_transactions').get().n).toBe(0);
  });

  it('rejects a margin larger than the rate it is taken out of', async () => {
    const bid = await makeBidding();
    const r = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader))
      .send({ sale_rate_per_unit: 4.5, trading_margin_per_unit: 5 });
    expect(r.status).toBe(400);
  });

  it('turns each application schedule row into an order-detail line', async () => {
    const bid = await makeBidding();
    const r = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader))
      .send({ sale_rate_per_unit: 4.5 });
    const rows = db.prepare('SELECT * FROM bilateral_order_details WHERE transaction_id = ? ORDER BY date_from').all(r.body.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].quantum).toBe(50);
    expect(rows[1].quantum).toBe(80);
  });

  it('links the bidding and its application to the contract they became', async () => {
    const bid = await makeBidding();
    const r = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader))
      .send({ sale_rate_per_unit: 4.5 });
    const linkedBid = db.prepare('SELECT * FROM bilateral_biddings WHERE id = ?').get(bid.id);
    expect(linkedBid.transaction_id).toBe(r.body.id);
    expect(linkedBid.status).toBe('APPROVED');
    const linkedApp = db.prepare('SELECT * FROM bilateral_applications WHERE bidding_id = ?').get(bid.id);
    expect(linkedApp.transaction_id).toBe(r.body.id);
  });

  it('will not convert the same application twice', async () => {
    const bid = await makeBidding();
    await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader)).send({ sale_rate_per_unit: 4.5 });
    const again = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader)).send({ sale_rate_per_unit: 4.5 });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already converted/);
    expect(db.prepare('SELECT COUNT(*) n FROM bilateral_transactions').get().n).toBe(1);
  });

  it('404s on an application that does not exist', async () => {
    const r = await request(app).post('/api/bilateral-bidding/BBD-nope/contract').set(auth(trader))
      .send({ sale_rate_per_unit: 4.5 });
    expect(r.status).toBe(404);
  });

  it('keeps a read-only role out of the conversion', async () => {
    const bid = await makeBidding();
    const r = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(tokenFor('MANAGEMENT')))
      .send({ sale_rate_per_unit: 4.5 });
    expect(r.status).toBe(403);
  });

  it('produces a contract the settlement chain can bill', async () => {
    const bid = await makeBidding();
    const created = await request(app).post(`/api/bilateral-bidding/${bid.id}/contract`).set(auth(trader))
      .send({ sale_rate_per_unit: 4.5 });
    const txId = created.body.id;

    // The converted contract walks the same lifecycle as a hand-created one.
    const sched = await request(app).post(`/api/bilateral/${txId}/schedules`).set(auth(trader))
      .send({ schedule_date: '2026-09-01', blocks: [{ time_block: '00:00-00:15', approved_mw: 80 }] });
    for (const s of ['FORMAT_D_PREPARED', 'CONTRACT_CREATED', 'SUBMITTED', 'APPROVED']) {
      await request(app).post(`/api/bilateral/${txId}/noar`).set(auth(trader)).send({ noar_status: s });
    }
    await request(app).post(`/api/bilateral/schedules/${sched.body.schedules[0].id}/actuals`).set(auth(trader))
      .send({ actual_mw: 80 });

    const bill = await request(app).post(`/api/bilateral/${txId}/invoices`).set(auth(trader))
      .send({ bill_type: 'BILATERAL_ENERGY' });
    expect(bill.status).toBe(201);
    expect(bill.body.invoice_amount).toBe(20 * 1000 * 4.5); // 80 MW x 0.25 h = 20 MWh
    expect(bill.body.bilateral_id).toBe(txId);
  });
});
