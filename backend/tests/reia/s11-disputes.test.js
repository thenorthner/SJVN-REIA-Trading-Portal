import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice, columnsOf, hasTable, resetReia } from '../helpers/reia.js';
import { readFileSync } from 'fs';

let reia, contract, invoice;
beforeEach(() => {
  resetReia(); reia = tokenFor('REIA_USER');
  contract = makeContract({ status: 'ACTIVE' });
  invoice = makeInvoice({ contract_id: contract.id, status: 'SENT', total_amount: 400000, due_date: '2026-05-31' });
});

const latestDisputeId = () => db.prepare('SELECT id FROM disputes ORDER BY rowid DESC LIMIT 1').get()?.id;
const raise = (amount = 50000) => request(app).post('/api/disputes').set(auth(reia))
  .send({ invoice_id: invoice.id, reason_code: 'ENERGY_DATA_MISMATCH', charge_line: 'energy_charges',
          issue_description: 'metering gap', disputed_amount: amount, raised_by: 'test-user', raised_by_role: 'BUYER' });

describe('S11 Dispute management', () => {
  it('leaves the undisputed balance payable on its original due date', async () => {
    const r = await raise(50000);
    expect(r.status).toBeLessThan(400);
    const inv = db.prepare('SELECT total_amount, disputed_amount, due_date, status FROM invoices WHERE id = ?').get(invoice.id);
    expect(inv.disputed_amount).toBe(50000);
    expect(inv.total_amount - inv.disputed_amount).toBe(350000);
    expect(inv.due_date).toBe('2026-05-31');
    expect(inv.status).not.toBe('ON_HOLD');
  });

  it('walks the dispute lifecycle', async () => {
    const r = await raise();
    const id = r.body.id || latestDisputeId();
    const ack = await request(app).post(`/api/disputes/${id}/transition`).set(auth(reia)).send({ status: 'ACKNOWLEDGED' });
    expect(ack.status).toBeLessThan(400);
    expect(db.prepare('SELECT status FROM disputes WHERE id = ?').get(id).status).toBe('ACKNOWLEDGED');
  });

  it('blocks an illegal jump straight from raised to closed', async () => {
    const r = await raise();
    const bad = await request(app).post(`/api/disputes/${r.body.id || latestDisputeId()}/transition`).set(auth(reia)).send({ status: 'CLOSED' });
    expect(bad.status, 'a dispute jumped straight from RAISED to CLOSED').toBeGreaterThanOrEqual(400);
  });

  it('does not accrue LPS on the disputed portion', () => {
    expect(columnsOf('invoices')).toEqual(expect.arrayContaining(['disputed_amount', 'lps']));
    const lpsSrc = readFileSync('src/util.js', 'utf-8') + readFileSync('src/routes/invoices.js', 'utf-8');
    expect(lpsSrc, 'LPS calculation never excludes the disputed amount').toMatch(/disputed_amount/);
  });

  it('escalates a dispute past its resolution SLA', async () => {
    const r = await raise();
    db.prepare(`UPDATE disputes SET sla_resolve_due = '2020-01-01' WHERE id = ?`).run(r.body.id || latestDisputeId());
    const sweep = await request(app).post('/api/disputes/sla/check').set(auth(reia)).send({});
    expect(sweep.status).toBeLessThan(400);
    expect(db.prepare('SELECT status FROM disputes WHERE id = ?').get(r.body.id || latestDisputeId()).status).toBe('ESCALATED');
  });

  it('raises a supplementary invoice when resolution changes the amount', async () => {
    const r = await raise();
    await request(app).post(`/api/disputes/${r.body.id || latestDisputeId()}/transition`).set(auth(reia)).send({ status: 'ACKNOWLEDGED' });
    await request(app).post(`/api/disputes/${r.body.id || latestDisputeId()}/transition`).set(auth(reia)).send({ status: 'UNDER_REVIEW' });
    const res = await request(app).post(`/api/disputes/${r.body.id || latestDisputeId()}/resolve`).set(auth(reia))
      .send({ decision: 'RESOLVED_ACCEPTED', approved_amount: 30000, remarks: 'partly upheld' });
    expect(res.status).toBeLessThan(400);
    const supp = db.prepare(`SELECT COUNT(*) c FROM invoices WHERE invoice_type = 'SUPPLEMENTARY'`).get().c;
    expect(supp, 'resolving a dispute did not raise a supplementary invoice').toBeGreaterThan(0);
  });

  it('keeps the comment thread and event history', async () => {
    const r = await raise();
    await request(app).post(`/api/disputes/${r.body.id || latestDisputeId()}/comments`).set(auth(reia)).send({ comment: 'evidence attached' });
    expect(db.prepare('SELECT COUNT(*) c FROM dispute_comments WHERE dispute_id = ?').get(r.body.id || latestDisputeId()).c).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) c FROM dispute_events WHERE dispute_id = ?').get(r.body.id || latestDisputeId()).c).toBeGreaterThan(0);
  });
});
