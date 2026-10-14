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
    const inv = makeInvoice({ contract_id: contract.id, status: 'UNDER_APPROVAL' });
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
      contract_id: contract.id, status: 'UNDER_APPROVAL',
      created_by: maker.name, created_by_id: maker.id,   // what generate() writes
    });
    pending(inv.id);
    const r = await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`)
      .set(auth(signToken(maker))).send({ decision: 'APPROVED' });
    expect(r.status, 'the invoice creator was allowed to approve their own invoice').toBe(403);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('UNDER_APPROVAL');
  });

  it('still lets a different person approve it', async () => {
    const maker = makeUser('REIA_USER', { name: 'Maker Two' });
    const checker = makeUser('REIA_USER', { name: 'Checker Two' });
    const inv = makeInvoice({
      contract_id: contract.id, status: 'UNDER_APPROVAL',
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
    const inv = makeInvoice({ contract_id: contract.id, status: 'UNDER_APPROVAL', created_by: maker.name });
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
    const inv = makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'UNDER_APPROVAL', total_amount: 180000 });
    if (validation_status) db.prepare('UPDATE invoices SET validation_status = ? WHERE id = ?').run(validation_status, inv.id);
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, 'PENDING')`).run(`APV-${inv.id}`, inv.id);
    return inv;
  };
  const act = (inv, decision = 'APPROVED') =>
    request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(reia)).send({ decision, comments: 'x' });

  for (const status of ['PARTIAL', 'MISMATCH']) {
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

describe('S7 A bill is approved out of the approval stage, level by level', () => {
  // The level rows exist from the moment a bill is raised, and nothing looked at
  // where the bill stood: a draft nobody had submitted could be approved, on its
  // one creation-time level, whatever it was worth.
  const withLevels = (status, n = 1, extra = {}) => {
    const inv = makeInvoice({ contract_id: contract.id, status, ...extra });
    for (let l = 1; l <= n; l += 1) {
      db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, ?, 'PENDING')`).run(`AL-${inv.id}-${l}`, inv.id, l);
    }
    return inv;
  };
  const act = (inv, level, decision = 'APPROVED') =>
    request(app).post(`/api/invoices/${inv.id}/approvals/${level}/act`).set(auth(reia)).send({ decision, comments: 'x' });
  const statusOf = (inv) => db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status;

  for (const status of ['DRAFT', 'SUBMITTED', 'REJECTED', 'PENDING_L2']) {
    it(`will not approve a bill that is still ${status}`, async () => {
      const inv = withLevels(status);
      const r = await act(inv, 1);
      expect(r.status, `a ${status} bill was approved without being submitted for approval`).toBe(400);
      expect(r.body.error).toMatch(/submit it for approval first/);
      expect(statusOf(inv)).toBe(status);
    });
  }

  it('will not act again on a bill that is already approved', async () => {
    const inv = withLevels('APPROVED');
    expect((await act(inv, 1, 'REJECTED')).status).toBe(400);
    expect(statusOf(inv)).toBe('APPROVED');
  });

  it('lets the desk send a seller bill back as soon as it arrives', async () => {
    const inv = withLevels('SUBMITTED', 1, { direction: 'SELLER_TO_SJVN' });
    expect((await act(inv, 1, 'REJECTED')).status).toBe(200);
    expect(statusOf(inv)).toBe('REJECTED');
  });

  it('takes the levels in order', async () => {
    const inv = withLevels('UNDER_APPROVAL', 3);
    const skipped = await act(inv, 3);
    expect(skipped.status, 'level 3 signed before level 1').toBe(400);
    expect(skipped.body.error).toMatch(/Level 1 has to decide before level 3/);
    expect((await act(inv, 1)).status).toBe(200);
    expect(statusOf(inv)).toBe('UNDER_APPROVAL');
    expect((await act(inv, 1)).status, 'a level was decided twice').toBe(400);
    expect((await act(inv, 2)).status).toBe(200);
    expect((await act(inv, 3)).status).toBe(200);
    expect(statusOf(inv)).toBe('APPROVED');
  });

  it('sizes the chain by the amount even when a level already exists', async () => {
    // An arrear, a supplementary and every seller bill are given one level the
    // moment they are raised. The bands were only applied where none existed,
    // so a 12,00,000 arrear went to APPROVED on a single signature.
    const inv = withLevels('DRAFT', 1, { total_amount: 1200000 });
    const r = await request(app).post(`/api/invoices/${inv.id}/submit-for-approval`).set(auth(reia)).send({});
    expect(r.status).toBe(200);
    const rows = db.prepare('SELECT level, status FROM invoice_approvals WHERE invoice_id = ? ORDER BY level').all(inv.id);
    expect(rows.map((x) => x.level)).toEqual([1, 2, 3]);
    expect(rows.every((x) => x.status === 'PENDING')).toBe(true);
  });

  it('drops the levels a smaller bill no longer needs on resubmission', async () => {
    const inv = withLevels('REJECTED', 3, { total_amount: 50000 });
    await request(app).post(`/api/invoices/${inv.id}/submit-for-approval`).set(auth(reia)).send({});
    expect(db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c).toBe(1);
  });

  it('keeps the reason a bill was sent back after it is resubmitted', async () => {
    const inv = withLevels('UNDER_APPROVAL', 1);
    await request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(reia)).send({ decision: 'REJECTED', comments: 'wrong tariff' });
    await request(app).post(`/api/invoices/${inv.id}/submit-for-approval`).set(auth(reia)).send({});
    const got = await request(app).get(`/api/invoices/${inv.id}`).set(auth(reia));
    expect(got.body.approvals[0]).toMatchObject({ status: 'PENDING', comments: null });
    expect(got.body.approval_history).toHaveLength(1);
    expect(got.body.approval_history[0]).toMatchObject({ decision: 'REJECTED', level: 1, comments: 'wrong tariff' });
  });
});

describe('S7 A different person at each level, where SJVN asks for it', () => {
  // Several levels are several people's judgement. Without this, one approver
  // signed level 1 and was handed the button for level 2.
  const SWITCH = 'invoice_approval_distinct_approvers';
  const set = (v) => { db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(String(v), SWITCH); invalidateParamCache(); };
  afterEach(() => set(0));

  const threeLevels = () => {
    const inv = makeInvoice({ contract_id: contract.id, status: 'UNDER_APPROVAL', total_amount: 36494000 });
    for (let l = 1; l <= 3; l += 1) {
      db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, ?, 'PENDING')`).run(`DA-${inv.id}-${l}`, inv.id, l);
    }
    return inv;
  };
  const act = (inv, level, who, decision = 'APPROVED') =>
    request(app).post(`/api/invoices/${inv.id}/approvals/${level}/act`).set(auth(signToken(who))).send({ decision, comments: 'x' });

  it('is off unless switched on, so one approver can still clear a bill', async () => {
    const solo = makeUser('REIA_USER', { name: 'Only Approver' });
    const inv = threeLevels();
    for (const level of [1, 2, 3]) expect((await act(inv, level, solo)).status).toBe(200);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('APPROVED');
  });

  it('stops one person signing two levels once it is on', async () => {
    set(1);
    const a = makeUser('REIA_USER', { name: 'Approver A' });
    const b = makeUser('FINANCE_USER', { name: 'Approver B' });
    const c = makeUser('REIA_ADMIN', { name: 'Approver C' });
    const inv = threeLevels();

    expect((await act(inv, 1, a)).status).toBe(200);
    const again = await act(inv, 2, a);
    expect(again.status, 'the same person signed a second level').toBe(403);
    expect(again.body.error).toMatch(/You approved level 1/i);
    expect((await act(inv, 2, b)).status).toBe(200);
    expect((await act(inv, 3, a)).status).toBe(403);
    expect((await act(inv, 3, b)).status).toBe(403);
    expect((await act(inv, 3, c)).status).toBe(200);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('APPROVED');
    expect(db.prepare('SELECT approver_id FROM invoice_approvals WHERE invoice_id = ? ORDER BY level').all(inv.id).map((r) => r.approver_id))
      .toEqual([a.id, b.id, c.id]);
  });

  it('still lets someone who signed an earlier level send the bill back', async () => {
    set(1);
    const a = makeUser('REIA_USER', { name: 'Approver A2' });
    const inv = threeLevels();
    await act(inv, 1, a);
    expect((await act(inv, 2, a, 'REJECTED')).status).toBe(200);
    expect(db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status).toBe('REJECTED');
  });

  it('starts a resubmitted bill with nobody having signed', async () => {
    set(1);
    const a = makeUser('REIA_USER', { name: 'Approver A3' });
    const inv = threeLevels();
    await act(inv, 1, a);
    await act(inv, 2, a, 'REJECTED');
    await request(app).post(`/api/invoices/${inv.id}/submit-for-approval`).set(auth(reia)).send({});
    expect((await act(inv, 1, a)).status, 'a signature from the earlier round still counted').toBe(200);
    const got = await request(app).get(`/api/invoices/${inv.id}`).set(auth(reia));
    expect(got.body.approval_rules).toEqual({ distinct_approvers: true });
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
