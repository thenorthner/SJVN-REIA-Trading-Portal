import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';

let finance, reia, contract;
beforeEach(() => { resetReia(); finance = tokenFor('FINANCE_USER'); reia = tokenFor('REIA_USER'); contract = makeContract({ status: 'ACTIVE' }); });

describe('S9 Settlement and financial tracking', () => {
  it('tracks a partial payment as partial with a balance still outstanding', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 1000000 });
    const r = await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance))
      .send({ amount: 400000, payment_date: '2026-05-10' });
    expect(r.status).toBeLessThan(400);
    const after = db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id);
    expect(after.status).toBe('PARTIALLY_PAID');
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
    expect(inv.total_amount - paid).toBe(600000);
  });

  it('marks an invoice paid once the balance clears', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 100000 });
    await request(app).post(`/api/invoices/${inv.id}/payments`).set(auth(finance)).send({ amount: 100000, payment_date: '2026-05-10' });
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('PAID');
  });

  it('keeps a running ledger of every movement', () => {
    expect(hasTable('payments')).toBe(true);
    expect(columnsOf('payments')).toEqual(expect.arrayContaining(['invoice_id', 'amount', 'payment_date']));
  });

  it('nets a payable against a receivable while keeping the gross visible', async () => {
    const r = await request(app).post('/api/reconciliation/run').set(auth(reia)).send({ contract_id: contract.id, period: '2026-04' });
    const netting = hasTable('invoice_mapping') || hasTable('debit_credit_notes');
    expect(netting, 'no set-off model exists to net payables against receivables').toBe(true);
    expect(r.status).toBeLessThan(500);
  });
});
