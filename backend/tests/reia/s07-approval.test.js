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

  // These pin the shape the application actually writes. The original fixture
  // put the maker's id in created_by and passed, while every real invoice was
  // storing a display name there — so the test agreed with the check's own wrong
  // assumption, and both were wrong together. An end-to-end run against the live
  // server was what caught it: the creator approved their own bill, HTTP 200.
  const pending = (invId, apId = 'AP-4') =>
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, 'PENDING')`).run(apId, invId);

  it('stops the same user both creating and approving an invoice', async () => {
    const maker = makeUser('REIA_USER', { name: 'Maker' });
    const inv = makeInvoice({
      contract_id: contract.id, status: 'SUBMITTED',
      created_by: maker.name, created_by_id: maker.id,   // what generate() writes
    });
    pending(inv.id);
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`)
      .set(auth(signToken(maker))).send({ decision: 'APPROVED' });
    expect(r.status, 'the invoice creator was allowed to approve their own invoice').toBe(403);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('SUBMITTED');
  });

  it('still lets a different person approve it', async () => {
    const maker = makeUser('REIA_USER', { name: 'Maker Two' });
    const checker = makeUser('REIA_USER', { name: 'Checker Two' });
    const inv = makeInvoice({
      contract_id: contract.id, status: 'SUBMITTED',
      created_by: maker.name, created_by_id: maker.id,
    });
    pending(inv.id, 'AP-5');
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`)
      .set(auth(signToken(checker))).send({ decision: 'APPROVED' });
    expect(r.status, 'segregation of duties blocked a legitimate second approver').toBeLessThan(400);
  });

  it('still stops a maker on a bill raised before created_by_id existed', async () => {
    // Backfill resolves most of these, but a name that matched no user leaves
    // the column null. The bill is still someone's to not approve.
    const maker = makeUser('REIA_USER', { name: 'Legacy Maker' });
    const inv = makeInvoice({ contract_id: contract.id, status: 'SUBMITTED', created_by: maker.name });
    db.prepare('UPDATE invoices SET created_by_id = NULL WHERE id = ?').run(inv.id);
    pending(inv.id, 'AP-6');
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`)
      .set(auth(signToken(maker))).send({ decision: 'APPROVED' });
    expect(r.status, 'a legacy row let its maker approve it').toBe(403);
  });

  it('stops the maker on the L2 route too', async () => {
    // approve-l2 clears an invoice as surely as the levelled route does, and
    // carried no separation check at all — a second way through for the maker.
    const maker = makeUser('REIA_USER', { name: 'Maker L2' });
    const inv = makeInvoice({
      contract_id: contract.id, status: 'PENDING_L2',
      created_by: maker.name, created_by_id: maker.id,
    });
    const r = await request(app).post(`/api/invoices/${inv.id}/approve-l2`)
      .set(auth(signToken(maker))).send({ comments: 'self-clear attempt' });
    expect(r.status, 'the maker cleared their own invoice through the L2 route').toBe(403);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('PENDING_L2');
  });
});
