import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeContract, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { invalidateParamCache } from '../../src/mastersService.js';

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

describe('S7 A found validation problem blocks approval', () => {
  // Comparing a seller's bill against the system's own figure produced a result,
  // recorded it, and let the invoice through approval regardless. A bill
  // claiming 1,80,000 against a computed 1,75,000 was flagged PARTIAL and
  // approved with the flag still on it. Waiving existed and demanded a reason —
  // it just was not required for anything.

  const submitted = (validation_status) => {
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'SUBMITTED', total_amount: 180000 });
    if (validation_status) db.prepare('UPDATE invoices SET validation_status = ? WHERE id = ?').run(validation_status, inv.id);
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, 'PENDING')`).run(`APV-${inv.id}`, inv.id);
    return inv;
  };
  const act = (inv, decision = 'APPROVED') =>
    request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(reia)).send({ decision, comments: 'x' });

  for (const status of ['PARTIAL', 'MISMATCH', 'NO_COUNTERPART']) {
    it(`refuses to clear one flagged ${status}`, async () => {
      const inv = submitted(status);
      const r = await act(inv);
      expect(r.status, `a ${status} invoice was approved with the flag still on it`).toBe(400);
      expect(r.body.validation_status).toBe(status);
      expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).not.toBe('APPROVED');
    });
  }

  it('clears one that matched', async () => {
    const r = await act(submitted('MATCHED'));
    expect(r.status).toBeLessThan(400);
  });

  it('clears one whose mismatch was waived with a reason', async () => {
    const r = await act(submitted('WAIVED'));
    expect(r.status, 'waiving did not actually unblock approval').toBeLessThan(400);
  });

  it('leaves an invoice validation never ran on alone', async () => {
    // Every system-generated PPA bill. Requiring validation on those is a
    // different decision from honouring a result that already exists.
    const r = await act(submitted(null));
    expect(r.status).toBeLessThan(400);
  });

  it('still lets a flagged invoice be rejected back', async () => {
    const r = await act(submitted('PARTIAL'), 'REJECTED');
    expect(r.status, 'a flagged invoice could not even be sent back').toBeLessThan(400);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(r.body.id ?? '').status ?? 'REJECTED').toBeTruthy();
  });
});

describe('S7 Approval levels follow the amount', () => {
  // Two levels were inserted unconditionally, so a 3,500 bill and a 1.75 crore
  // bill were routed identically.

  // system_parameters survives resetReia, so a test that retunes the bands puts
  // them back rather than leaving them for whatever runs next.
  const DEFAULT_BANDS = JSON.stringify([{ above: 1000000, levels: 3 }, { above: 100000, levels: 2 }]);
  afterEach(() => {
    db.prepare(`UPDATE system_parameters SET param_value = ? WHERE param_key = 'invoice_approval_levels'`).run(DEFAULT_BANDS);
    invalidateParamCache();
  });
  const levelsFor = async (total_amount) => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'DRAFT', total_amount });
    await request(app).post(`/api/invoices/${inv.id}/submit-for-approval`).set(auth(reia)).send({});
    return db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c;
  };

  it('routes a small bill through fewer levels than a large one', async () => {
    const small = await levelsFor(3500);
    const large = await levelsFor(17500000);
    expect(small, 'a small bill still needed the full chain').toBeLessThan(large);
  });

  it('applies the configured bands', async () => {
    expect(await levelsFor(50000)).toBe(1);        // at or below the lowest band
    expect(await levelsFor(500000)).toBe(2);       // above 1,00,000
    expect(await levelsFor(17500000)).toBe(3);     // above 10,00,000
  });

  it('reads the bands from masters rather than hard-coding them', async () => {
    db.prepare(`UPDATE system_parameters SET param_value = ? WHERE param_key = 'invoice_approval_levels'`)
      .run(JSON.stringify([{ above: 5000, levels: 4 }]));
    invalidateParamCache();   // the masters route does this on write
    expect(await levelsFor(6000), 'changing the master did not change the routing').toBe(4);
  });

  it('sizes a credit note by what it is worth, not its sign', async () => {
    expect(await levelsFor(-17500000)).toBe(3);
  });
});
