import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// The MIS pack asks for energy bought and sold, the margin on it, the net cash
// flow, and the payment security standing behind the book. The month table had
// the first two and what came in; it said nothing about what went out, what the
// two came to, or what security was held.

let reia, buyer, seller, buyerContract, sellerContract;

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM payment_security').run();
  reia = tokenFor('REIA_USER');
  buyer = makeEntity('BUYER', { name: 'Test Discom' });
  seller = makeEntity('SELLER', { name: 'Test Solar Ltd' });
  buyerContract = makeContract({ buyer_id: buyer.id, status: 'ACTIVE' });
  sellerContract = makeContract({ seller_id: seller.id, status: 'ACTIVE' });
});

const summary = (params = '') => request(app).get(`/api/reports/billing-summary${params}`).set(auth(reia));
const pay = (invoiceId, amount) =>
  db.prepare('INSERT INTO payments (id, invoice_id, amount, payment_date, mode) VALUES (?, ?, ?, ?, ?)')
    .run(newId('PAY'), invoiceId, amount, '2026-08-20', 'NEFT');

describe('S29 MIS summary', () => {
  it('reports what went out and what the month came to, not only what came in', async () => {
    const sale = makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-08', total_amount: 1000000 });
    const purchase = makeInvoice({ contract_id: sellerContract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', billing_period: '2026-08', total_amount: 800000 });
    pay(sale.id, 600000);
    pay(purchase.id, 500000);

    const r = await summary();
    expect(r.status).toBe(200);
    const august = r.body.months.find((m) => m.billing_period === '2026-08');
    expect(august).toMatchObject({ collected: 600000, paid_out: 500000, net_cash_flow: 100000 });
    expect(r.body.totals.net_cash_flow).toBe(100000);
  });

  it('shows a month that paid out more than it collected as negative', async () => {
    const purchase = makeInvoice({ contract_id: sellerContract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', billing_period: '2026-08', total_amount: 900000 });
    pay(purchase.id, 900000);
    const r = await summary();
    expect(r.body.months[0].net_cash_flow).toBe(-900000);
    expect(r.body.totals.net_cash_flow).toBe(-900000);
  });

  it('reports the security standing behind the book', async () => {
    const put = (id, limit, utilized, status, validityEnd) => db.prepare(`
      INSERT INTO payment_security (
        id, instrument_no, entity_id, contract_id, mechanism_type, limit_amount,
        utilized_amount, available_amount, status, validity_end
      ) VALUES (?, ?, ?, ?, 'BANK_GUARANTEE', ?, ?, ?, ?, ?)
    `).run(id, `BG-${id}`, buyer.id, buyerContract.id, limit, utilized, limit - utilized, status, validityEnd);

    put(newId('PS'), 5000000, 1000000, 'PARTIALLY_UTILIZED', '2027-03-31');
    put(newId('PS'), 2000000, 0, 'ACTIVE', '2026-10-01');       // inside sixty days
    put(newId('PS'), 9000000, 0, 'RELEASED', '2027-03-31');     // no longer standing behind anything

    const r = await summary();
    expect(r.body.payment_security).toMatchObject({
      held: 7000000, utilized: 1000000, available: 6000000, instruments: 2,
    });
    expect(r.body.payment_security.expiring_soon).toBeGreaterThanOrEqual(1);
  });

  it('answers with zeroes rather than nothing when no security is lodged', async () => {
    const r = await summary();
    expect(r.body.payment_security).toMatchObject({ held: 0, utilized: 0, available: 0, instruments: 0 });
  });

  it('still totals the columns it always did', async () => {
    makeInvoice({ contract_id: buyerContract.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-07', total_amount: 400000 });
    makeInvoice({ contract_id: sellerContract.id, direction: 'SELLER_TO_SJVN', status: 'SENT', billing_period: '2026-07', total_amount: 250000 });
    const r = await summary('?from=2026-07&to=2026-07');
    expect(r.body.totals).toMatchObject({ sales_billed: 400000, purchase_billed: 250000, gross_margin: 150000 });
  });
});
