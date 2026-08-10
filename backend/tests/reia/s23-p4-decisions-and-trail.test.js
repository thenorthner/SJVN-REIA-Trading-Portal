import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { signToken } from '../../src/middleware/auth.js';
import { invalidDecision } from '../../src/util.js';

let reia;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); });

describe('S23 An approve/reject endpoint needs an actual decision', () => {
  // Every one of these branched as `if (decision === 'REJECTED') { reject }
  // else { approve }`, so anything that was not exactly that string approved —
  // a lowercase "rejected", a typo, a field left out of the body. Approving by
  // default is the wrong default for a control whose whole job is to be an
  // explicit act.

  it('names what it will accept', () => {
    expect(invalidDecision(undefined)).toMatch(/APPROVED, REJECTED/);
    expect(invalidDecision('rejected')).toMatch(/not a decision/);
    expect(invalidDecision('APPROVED')).toBeNull();
    expect(invalidDecision('AGREE', ['AGREE', 'DISAGREE'])).toBeNull();
  });

  describe('on an invoice approval', () => {
    let inv;
    beforeEach(() => {
      const maker = makeUser('REIA_USER', { name: 'Maker P4' });
      const c = makeContract({ status: 'ACTIVE' });
      inv = makeInvoice({ contract_id: c.id, status: 'SUBMITTED', created_by: maker.name, created_by_id: maker.id });
      db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES ('AP-P4', ?, 1, 'PENDING')`).run(inv.id);
    });
    const act = (body) => request(app).post(`/api/invoices/${inv.id}/approvals/1/act`).set(auth(reia)).send(body);
    const statusOf = () => db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status;

    it('does not approve a bill because the rejection was lowercase', async () => {
      const r = await act({ decision: 'rejected', comments: 'no' });
      expect(r.status, 'a mistyped rejection approved the invoice').toBe(400);
      expect(statusOf()).toBe('SUBMITTED');
    });

    it('does not approve a bill because the field was left out', async () => {
      const r = await act({ comments: 'oops' });
      expect(r.status).toBe(400);
      expect(statusOf()).toBe('SUBMITTED');
    });

    it('still approves on APPROVED', async () => {
      expect((await act({ decision: 'APPROVED' })).status).toBeLessThan(400);
      expect(statusOf()).toBe('APPROVED');
    });

    it('still rejects on REJECTED', async () => {
      expect((await act({ decision: 'REJECTED', comments: 'wrong tariff' })).status).toBeLessThan(400);
      expect(statusOf()).toBe('REJECTED');
    });
  });

  describe('on an entity approval', () => {
    let ent;
    beforeEach(() => { ent = makeEntity('SELLER', { status: 'PENDING' }); });
    const approve = (body) => request(app).post(`/api/entities/${ent.id}/approve`).set(auth(reia)).send(body);

    it('says what is wrong instead of returning a 500', async () => {
      // It wrote `status = decision`, so an omitted field tripped the NOT NULL
      // constraint and surfaced as a server error.
      const r = await approve({});
      expect(r.status, 'an omitted decision came back as a 500').toBe(400);
      expect(r.body.error).toMatch(/decision is required/);
      expect(db.prepare('SELECT status FROM entities WHERE id = ?').get(ent.id).status).toBe('PENDING');
    });

    it('refuses a decision it does not recognise', async () => {
      const r = await approve({ decision: 'MAYBE' });
      expect(r.status).toBe(400);
      expect(db.prepare('SELECT status FROM entities WHERE id = ?').get(ent.id).status).toBe('PENDING');
    });
  });
});

describe('S23 An amended contract carries its own history', () => {
  // The amendment was recorded only against the version it replaced, so opening
  // the version actually in force showed an empty audit trail and nothing to say
  // where it had come from.
  it('records how the new version came to exist', async () => {
    const seller = makeEntity('SELLER');
    const c = makeContract({ status: 'ACTIVE', seller_id: seller.id, tariff_per_unit: 3.0,
      tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
    const r = await request(app).post(`/api/contracts/${c.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 3.4, effective_from: '2027-04-01' });
    expect(r.status).toBe(201);

    const onNew = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ?').all(r.body.id);
    expect(onNew.length, 'the version in force had no audit trail at all').toBeGreaterThan(0);
    const created = onNew.find((a) => a.action === 'CREATED_BY_AMENDMENT');
    expect(created).toBeTruthy();
    expect(String(created.details)).toContain(c.id);
    expect(String(created.details)).toContain('2027-04-01');
  });

  it('still records the amendment against the version it replaced', async () => {
    const seller = makeEntity('SELLER');
    const c = makeContract({ status: 'ACTIVE', seller_id: seller.id, tariff_per_unit: 3.0,
      tenure_start: '2026-04-01', tenure_end: '2031-03-31' });
    await request(app).post(`/api/contracts/${c.id}/amend`).set(auth(reia))
      .send({ tariff_per_unit: 3.4, effective_from: '2027-04-01' });
    expect(db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'AMEND'`).get(c.id)).toBeTruthy();
  });
});
