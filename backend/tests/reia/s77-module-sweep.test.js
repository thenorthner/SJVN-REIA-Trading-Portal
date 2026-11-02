import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Found by the module-by-module run of the REIA desk's "Others" screens
// (1-Nov-2026): a release to a generator went through with no UTR and a payment
// date next year (and its rebate was judged on that date), and asking a
// counterparty from an approvals check sent two requests where one lacked both
// the counterparty's standing and its statutory approvals.

const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const dayIst = (n) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM document_requests').run();
});

describe('S77 a release to the generator', () => {
  let finance, bill;
  beforeEach(() => {
    finance = tokenFor('FINANCE_USER');
    const seller = makeEntity('SELLER');
    db.prepare('UPDATE entities SET is_penny_drop_verified = 1, pending_bank_json = NULL WHERE id = ?').run(seller.id);
    const ppa = makeContract({ contract_type: 'PPA', seller_id: seller.id });
    bill = makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', total_amount: 1000000, billing_period: '2026-09', invoice_breakdown_json: '', invoice_type: 'PROVISIONAL' });
  });
  const release = (body) => request(app).post(`/api/invoices/${bill.id}/release-to-generator`).set(auth(finance)).send({ amount: 1000, source: 'OWN_FUND', ...body });

  it('needs the bank\'s UTR', async () => {
    for (const reference of [undefined, '', '  ', 'AB1']) {
      const r = await release({ reference });
      expect(r.status, String(reference)).toBe(400);
      expect(r.body.error).toMatch(/UTR/);
    }
    expect(db.prepare('SELECT COUNT(*) n FROM payments WHERE invoice_id = ?').get(bill.id).n).toBe(0);
  });

  it('takes a payment date up to today, never after it', async () => {
    for (const payment_date of [dayIst(1), '2026-02-30', 'soon']) {
      const r = await release({ reference: 'UTR-S77', payment_date });
      expect(r.status, payment_date).toBe(400);
      expect(r.body.error).toMatch(/not after today/);
    }
    const ok = await release({ reference: ' UTR-S77 ' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(db.prepare('SELECT payment_date, reference FROM payments WHERE invoice_id = ?').get(bill.id))
      .toEqual({ payment_date: todayIst(), reference: 'UTR-S77' });
  });
});

describe('S77 asking the counterparty from the Compliance Desk', () => {
  it('asks once for all an approvals check lacks', async () => {
    const dev = makeEntity('SELLER', { status: 'PENDING', name: 'QA S77 Solar' });
    db.prepare(`INSERT INTO entity_regulatory_approvals (id, entity_id, approval_code, label, is_mandatory, applies_to, status, sort_order, created_at, updated_at)
      VALUES ('ERA-S77', ?, 'CEIG', 'CEIG safety clearance', 1, 'SELLER', 'NOT_STARTED', 1, datetime('now'), datetime('now'))`).run(dev.id);
    const ppa = makeContract({ contract_type: 'PPA', seller_id: dev.id, contract_no: 'PPA/QA/S77' });
    const maker = tokenFor('REIA_MAKER');
    const ask = () => request(app).post(`/api/contracts/${ppa.id}/compliance-request`).set(auth(maker)).send({ code: 'APPROVALS' });

    const r = await ask();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.note).toMatch(/Counterparty standing: .*onboarding is pending.*; Statutory approvals: 1 of 1 not provided: CEIG safety clearance/);
    expect((await ask()).status, 'one open request covers both').toBe(409);
    expect(db.prepare('SELECT COUNT(*) n FROM document_requests WHERE entity_id = ?').get(dev.id).n).toBe(1);
  });

  it('says there is nothing to ask for when the check is in order', async () => {
    const ppa = makeContract({ contract_type: 'PPA', contract_no: 'PPA/QA/S77B' });
    const r = await request(app).post(`/api/contracts/${ppa.id}/compliance-request`).set(auth(tokenFor('REIA_MAKER'))).send({ code: 'APPROVALS' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing to ask for/);
  });
});
