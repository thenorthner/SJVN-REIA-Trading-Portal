import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Asking the system about a date other than today.
//
// Before this there was no way to advance time, so testing that a surcharge
// accrues past a due date or that a dispute escalates on a lapsed SLA meant
// writing to the database directly — which proves nothing about the application.
// Two mechanisms answer that now, and the line between them is the point: a
// projection computes and changes nothing, sandbox aging mutates and is refused
// unless the deployment opts in.

let reia, contract, invoice;
beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  contract = makeContract({ status: 'ACTIVE', lps_annual_pct: 12, lps_grace_days: 0 });
  invoice = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 100000 });
  db.prepare(`UPDATE invoices SET due_date = date('now','-30 days') WHERE id = ?`).run(invoice.id);
});

describe('S17 as_of projects without changing anything', () => {
  it('reports a larger surcharge at a future date than today', async () => {
    const today = await request(app).get(`/api/invoices/${invoice.id}`).set(auth(reia));
    const later = await request(app).get(`/api/invoices/${invoice.id}?as_of=2027-06-30`).set(auth(reia));

    expect(today.status).toBe(200);
    expect(later.status).toBe(200);
    expect(later.body.days_overdue, 'a future as_of did not age the position')
      .toBeGreaterThan(today.body.days_overdue);
    expect(later.body.accrued_lps).toBeGreaterThan(today.body.accrued_lps);
    expect(later.body.projected_as_of).toBe('2027-06-30');
  });

  it('leaves the record untouched after projecting', async () => {
    const before = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
    await request(app).get(`/api/invoices/${invoice.id}?as_of=2030-01-01`).set(auth(reia));
    const after = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
    expect(after, 'a read-only projection wrote to the invoice').toEqual(before);
  });

  it('marks a plain read as not being a projection', async () => {
    const r = await request(app).get(`/api/invoices/${invoice.id}`).set(auth(reia));
    expect(r.body.projected_as_of).toBeUndefined();
  });

  it('refuses a malformed as_of rather than quietly answering for today', async () => {
    // A mistyped date that silently falls back to now is worse than an error,
    // because the number it returns still looks like an answer.
    const r = await request(app).get(`/api/invoices/${invoice.id}?as_of=next-tuesday`).set(auth(reia));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/as_of/i);
  });

  it('refuses a date that does not exist', async () => {
    const r = await request(app).get(`/api/invoices/${invoice.id}?as_of=2026-02-31`).set(auth(reia));
    expect(r.status).toBe(400);
  });
});

describe('S17 an SLA projection cannot escalate a live dispute', () => {
  let dispute;

  beforeEach(async () => {
    const buyer = tokenFor('BUYER', { linked_entity_id: contract.buyer_id });
    const r = await request(app).post('/api/disputes').set(auth(buyer)).send({
      invoice_id: invoice.id, reason_code: 'ENERGY_DATA_MISMATCH',
      charge_line: 'energy_charges', disputed_amount: 5000,
    });
    dispute = r.body;
  });

  it('reports what would breach by a future date without escalating it', async () => {
    const r = await request(app).post('/api/disputes/sla/check').set(auth(reia)).send({ as_of: '2030-01-01' });
    expect(r.status).toBe(200);
    expect(r.body.projection).toBe(true);
    expect(r.body.would_escalate, 'the projection saw nothing that would breach').toBeGreaterThan(0);

    const row = db.prepare('SELECT status, sla_breached_at FROM disputes WHERE id = ?').get(dispute.id);
    expect(row.status, 'asking about the future escalated a live dispute').not.toBe('ESCALATED');
    expect(row.sla_breached_at).toBeNull();
  });

  it('still escalates for real when the SLA has actually lapsed', async () => {
    db.prepare(`UPDATE disputes SET sla_resolve_due = datetime('now','-1 day') WHERE id = ?`).run(dispute.id);
    const r = await request(app).post('/api/disputes/sla/check').set(auth(reia)).send({});
    expect(r.body.escalated).toBeGreaterThan(0);
    expect(db.prepare('SELECT status FROM disputes WHERE id = ?').get(dispute.id).status).toBe('ESCALATED');
  });
});

describe('S17 sandbox aging is off unless the deployment opts in', () => {
  const priorSandbox = process.env.SJVN_SANDBOX;
  const priorEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.SJVN_SANDBOX = priorSandbox ?? '';
    process.env.NODE_ENV = priorEnv ?? '';
  });

  it('does not exist at all when the flag is unset', async () => {
    delete process.env.SJVN_SANDBOX;
    const r = await request(app).post('/api/sandbox/age').set(auth(reia))
      .send({ record: 'invoice', id: invoice.id, days: -60 });
    expect(r.status, 'date-shifting was reachable without opting in').toBe(404);
  });

  it('stays off in production even when the flag is set', async () => {
    process.env.SJVN_SANDBOX = '1';
    process.env.NODE_ENV = 'production';
    const r = await request(app).post('/api/sandbox/age').set(auth(reia))
      .send({ record: 'invoice', id: invoice.id, days: -60 });
    expect(r.status, 'a stray env var let someone backdate a live invoice').toBe(404);
  });

  it('ages an invoice into surcharge once enabled', async () => {
    process.env.SJVN_SANDBOX = '1';
    process.env.NODE_ENV = 'test';

    const before = (await request(app).get(`/api/invoices/${invoice.id}`).set(auth(reia))).body;
    const aged = await request(app).post('/api/sandbox/age').set(auth(reia))
      .send({ record: 'invoice', id: invoice.id, days: -100 });
    expect(aged.status).toBe(200);

    const after = (await request(app).get(`/api/invoices/${invoice.id}`).set(auth(reia))).body;
    expect(after.days_overdue, 'aging the invoice did not move the surcharge clock')
      .toBeGreaterThan(before.days_overdue);
  });

  it('shifts a named date directly', async () => {
    process.env.SJVN_SANDBOX = '1';
    process.env.NODE_ENV = 'test';
    const r = await request(app).post('/api/sandbox/age').set(auth(reia))
      .send({ record: 'invoice', id: invoice.id, fields: { due_date: '2026-01-15' } });
    expect(r.status).toBe(200);
    expect(db.prepare('SELECT due_date FROM invoices WHERE id = ?').get(invoice.id).due_date).toBe('2026-01-15');
  });

  it('refuses to shift a field that is not a date', async () => {
    process.env.SJVN_SANDBOX = '1';
    process.env.NODE_ENV = 'test';
    const r = await request(app).post('/api/sandbox/age').set(auth(reia))
      .send({ record: 'invoice', id: invoice.id, fields: { total_amount: 1 } });
    expect(r.status, 'the sandbox let a test rewrite an amount').toBe(400);
    expect(db.prepare('SELECT total_amount FROM invoices WHERE id = ?').get(invoice.id).total_amount).toBe(100000);
  });

  it('records who aged what, and from where to where', async () => {
    process.env.SJVN_SANDBOX = '1';
    process.env.NODE_ENV = 'test';
    await request(app).post('/api/sandbox/age').set(auth(reia))
      .send({ record: 'invoice', id: invoice.id, days: -10 });
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SANDBOX_AGE'`).get(invoice.id);
    expect(audit, 'a date shift left no audit trail').toBeTruthy();
    expect(audit.details).toMatch(/before|after/);
  });
});
