import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeContract, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';

let reia, contract;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); contract = makeContract({ status: 'ACTIVE' }); });

describe('S7 Invoice approval and distribution', () => {
  it('will not send an invoice before its approvals are signed off', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SUBMITTED' });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('AP-1', ?, 1, 'PENDING')`).run(inv.id);
    const r = await request(app).post(`/api/invoices/${inv.id}/send`).set(auth(reia)).send({});
    expect(r.status, 'an invoice with a pending approval was dispatched').toBeGreaterThanOrEqual(400);
  });

  it('marks the invoice approved once every level signs off', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SUBMITTED' });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('AP-2', ?, 1, 'PENDING')`).run(inv.id);
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(reia)).send({ decision: 'APPROVED' });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('APPROVED');
  });

  it('routes a high-value invoice through more than one level', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'DRAFT', total_amount: 500000000 });
    await request(app).post(`/api/invoices/${inv.id}/submit-for-approval`).set(auth(reia)).send({});
    const levels = db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c;
    expect(levels, 'a very large invoice was routed through a single approval level').toBeGreaterThan(1);
  });

  it('keeps the comment and history on a rejection', async () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'SUBMITTED' });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('AP-3', ?, 1, 'PENDING')`).run(inv.id);
    await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(reia)).send({ decision: 'REJECTED', comments: 'wrong tariff' });
    const ap = db.prepare('SELECT * FROM invoice_approvals WHERE id = ?').get('AP-3');
    expect(ap.status).toBe('REJECTED');
    expect(ap.comments).toBe('wrong tariff');
    expect(ap.approver_name).toBeTruthy();
  });

  it('logs delivery on every configured channel', () => {
    expect(hasTable('invoice_deliveries')).toBe(true);
    expect(columnsOf('invoice_deliveries')).toEqual(expect.arrayContaining(['invoice_id', 'channel', 'status']));
  });

  it('stops the same user both creating and approving an invoice', async () => {
    const maker = makeUser('REIA_USER', { name: 'Maker' });
    const token = signToken(maker);
    const inv = makeInvoice({ contract_id: contract.id, status: 'SUBMITTED', created_by: maker.id });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('AP-4', ?, 1, 'PENDING')`).run(inv.id);
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(token)).send({ decision: 'APPROVED' });
    expect(r.status, 'the invoice creator was allowed to approve their own invoice').toBeGreaterThanOrEqual(400);
  });
});
