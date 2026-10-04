import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from './helpers/reia.js';

// What is waiting on SJVN, gathered from every desk into one list.

let reia, seller, alpha, discom, ppa, psa;
const as = (u) => auth(signToken(u));
const desk = (u) => request(app).get('/api/sjvn-desk').set(as(u));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeEach(() => {
  resetReia();
  for (const t of ['contract_milestones', 'contract_notices', 'contract_requests', 'document_requests']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* not on this database */ } }
  alpha = makeEntity('SELLER', { name: 'Alpha Solar' });
  discom = makeEntity('BUYER', { name: 'North Discom' });
  ppa = makeContract({ seller_id: alpha.id });
  psa = makeContract({ contract_type: 'PSA', buyer_id: discom.id });
  reia = makeUser('REIA_USER', { name: 'Riya REIA' });
  seller = makeUser('SELLER', { name: 'Arun Alpha', linked_entity_id: alpha.id });
});

describe('the desk', () => {
  it('is empty when nothing is waiting, and closed to counterparties', async () => {
    const r = await desk(reia);
    expect(r.status).toBe(200);
    expect(r.body.todo).toEqual([]);
    expect((await desk(seller)).status).toBe(403);
  });

  it('lists what each desk is holding, the pressing first, and what falls due', async () => {
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', invoice_no: 'A/1', total_amount: 500000 });
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', invoice_no: 'A/2', total_amount: 300000, due_date: day(-4) });
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', invoice_no: 'A/3', total_amount: 200000, due_date: day(9) });
    const bill = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', invoice_no: 'S/1', total_amount: 800000, due_date: day(12) });
    db.prepare(`INSERT INTO payment_intimations (id, invoice_id, contract_id, entity_id, amount, payment_date, reference, status) VALUES ('PI1', ?, ?, ?, 800000, ?, 'UTR1', 'SUBMITTED')`).run(bill.id, psa.id, discom.id, day(-1));
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, bg_subtype, limit_amount, validity_end, status, submitted_by_side) VALUES ('PS1', 'PS/PBG/1', ?, 'BANK_GUARANTEE', 'PBG', 500000, ?, 'DRAFT', 'SELLER')`).run(ppa.id, day(300));
    db.prepare(`INSERT INTO payment_security (id, instrument_no, contract_id, mechanism_type, bg_subtype, limit_amount, validity_end, status) VALUES ('PS2', 'PS/PBG/2', ?, 'BANK_GUARANTEE', 'PBG', 500000, ?, 'ACTIVE')`).run(ppa.id, day(8));
    db.prepare(`INSERT INTO contract_requests (id, contract_id, request_type, subject, description, status, raised_by, raised_by_side) VALUES ('R1', ?, 'OTHER', 'Change of bank account', 'New account details attached', 'PENDING', ?, 'SELLER')`).run(ppa.id, seller.id);

    const d = (await desk(reia)).body;
    const by = Object.fromEntries(d.todo.map((t) => [t.key, t]));
    expect(by.intimations).toMatchObject({ count: 1, level: 'red', link: '/reia/payment-monitoring' });
    expect(by['invoice-approval']).toMatchObject({ count: 1 });
    expect(by['payables-overdue']).toMatchObject({ count: 1, level: 'red' });
    expect(by['payables-overdue'].detail).toMatch(/₹3,00,000/);
    expect(by.requests).toMatchObject({ count: 1 });
    expect(by['security-accept']).toMatchObject({ count: 1 });
    expect(by['security-lapsing']).toMatchObject({ count: 1, due: day(8) });
    expect(d.todo.map((t) => t.level)).toEqual([...d.todo.map((t) => t.level)].sort((a, b) => ({ red: 0, amber: 1, blue: 2 }[a] - { red: 0, amber: 1, blue: 2 }[b])));
    expect(d.counts).toMatchObject({ red: 3 });

    expect(d.calendar.map((e) => [e.kind, e.date])).toEqual([['SECURITY', day(8)], ['PAYMENT', day(9)], ['RECEIPT', day(12)]]);
    expect(d.calendar[1].title).toMatch(/Pay Alpha Solar — A\/3/);
    // An extension submitted takes the guarantee off the lapsing list.
    db.prepare(`INSERT INTO security_amendments (id, payment_security_id, contract_id, status) VALUES ('AM1', 'PS2', ?, 'PENDING')`).run(ppa.id);
    const after = Object.fromEntries((await desk(reia)).body.todo.map((t) => [t.key, t]));
    expect(after['security-lapsing']).toBeUndefined();
    expect(after['security-accept'].count).toBe(2);
  });
});
