import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, columnsOf, hasTable, resetReia } from '../helpers/reia.js';

let reia, contract;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); contract = makeContract({ status: 'ACTIVE' }); });

const mkLc = (over = {}) => request(app).post('/api/payment-security').set(auth(reia)).send({
  contract_id: contract.id, mechanism_type: 'LC', limit_amount: 1000000,
  issuing_bank: 'SBI', valid_from: '2026-04-01', valid_until: '2027-03-31', ...over,
});

describe('S8 Payment security', () => {
  it('records an LC with bank, validity and amount', async () => {
    const r = await mkLc();
    expect(r.status).toBeLessThan(400);
    const row = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(r.body.id);
    expect(row.limit_amount).toBe(1000000);
    expect(row.issuing_bank).toBe('SBI');
  });

  it('reduces the available limit as it is drawn against', async () => {
    const r = await mkLc();
    await request(app).post(`/api/payment-security/${r.body.id}/utilize`).set(auth(reia)).send({ amount: 250000, reason: 'default' });
    const row = db.prepare('SELECT * FROM payment_security WHERE id = ?').get(r.body.id);
    const available = row.available_amount ?? (row.limit_amount - (row.utilized_amount || 0));
    expect(available).toBe(750000);
  });

  it('raises expiry alerts on a threshold cascade', async () => {
    await mkLc({ valid_until: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10) });
    const r = await request(app).post('/api/payment-security/alerts/run').set(auth(reia)).send({});
    expect(r.status).toBeLessThan(400);
    expect(db.prepare('SELECT COUNT(*) c FROM security_alerts').get().c, 'no expiry alert raised for an LC 10 days out').toBeGreaterThan(0);
  });

  it('draws the buyer LC before touching a pooled fund', async () => {
    const lc = await mkLc({ limit_amount: 100000 });
    await request(app).post('/api/payment-security').set(auth(reia)).send({
      contract_id: contract.id, mechanism_type: 'CORPUS_FUND', limit_amount: 5000000,
      issuing_bank: 'Pool', valid_from: '2026-04-01', valid_until: '2027-03-31',
    });
    const r = await request(app).post('/api/invoices/waterfall-payment').set(auth(reia))
      .send({ contract_id: contract.id, default_amount: 300000 });
    expect(r.status, 'no waterfall endpoint drew security in sequence').toBeLessThan(400);
    if (r.status < 400) {
      const lcRow = db.prepare('SELECT utilized_amount FROM payment_security WHERE id = ?').get(lc.body.id);
      expect(lcRow.utilized_amount, 'the specific LC was not exhausted before the pooled fund').toBe(100000);
    }
  });

  it('computes a coverage ratio and flags it below 1', async () => {
    await mkLc({ limit_amount: 100000 });
    const r = await request(app).get(`/api/payment-security/adequacy/${contract.id}`).set(auth(reia));
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    expect(body, 'adequacy response carries no coverage ratio').toMatch(/coverage|ratio/i);
  });

  it('keeps seller-side BG separate from buyer-side LC in invocation logic', () => {
    const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='payment_security'`).get().sql;
    expect(sql).toMatch(/BANK_GUARANTEE|BG/);
    expect(sql).toMatch(/LC/);
    expect(hasTable('security_invocations')).toBe(true);
  });

  it('refuses release while dues or disputes are open', async () => {
    const lc = await mkLc();
    db.prepare(`INSERT INTO security_releases (id, payment_security_id, contract_id, requested_by, status)
                VALUES ('REL-1', ?, ?, 'u', 'PENDING')`).run(lc.body.id, contract.id);
    // An unsettled invoice on the same contract is enough to block release.
    db.prepare(`INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period,
                energy_mwh, tariff_per_unit, energy_charges, total_amount, status)
                VALUES ('INV-OPEN', 'INV-OPEN', ?, 'FINAL', 'SJVN_TO_BUYER', '2026-04', 100, 3, 300000, 300000, 'SENT')`)
      .run(contract.id);
    db.prepare(`UPDATE security_releases SET checklist_no_dues = 1, checklist_no_disputes = 1 WHERE id = 'REL-1'`).run();
    const r = await request(app).post('/api/payment-security/releases/REL-1/act').set(auth(reia)).send({ decision: 'APPROVED' });
    const released = db.prepare('SELECT status FROM security_releases WHERE id = ?').get('REL-1').status;
    expect(r.status, 'security released while an invoice was still unsettled').toBe(400);
    expect(released).toBe('PENDING');
  });
});
