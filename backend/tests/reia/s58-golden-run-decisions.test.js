import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { newId } from '../../src/util.js';
import { tokenFor, auth, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// Decided after the September 2026 golden run (17-Oct-2026): empty statements
// the scheduler made are withdrawn, not left "ready for your sign-off"; and a
// buyer's bill is never held back for want of security, but its final approver
// acknowledges an under-secured buyer in so many words.

let reia, buyer, psa;
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const statement = (contract, period, over = {}) => {
  const id = newId('RCN');
  db.prepare(`INSERT INTO reconciliations (id, recon_no, contract_id, period, period_type, status, scope) VALUES (?, ?, ?, ?, 'MONTHLY', ?, 'REIA_CONTRACT')`)
    .run(id, `RCN/S58/${Math.random().toString(36).slice(2, 7)}`, contract.id, period, over.status || 'PENDING_SIGN_OFF');
  return id;
};

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM recon_items').run();
  db.prepare('DELETE FROM recon_events').run();
  db.prepare('DELETE FROM reconciliations').run();
  reia = tokenFor('REIA_USER');
  buyer = makeEntity('BUYER');
  psa = makeContract({ contract_type: 'PSA', buyer_id: buyer.id, tenure_start: '2026-04-01' });
});

describe('S58 Withdrawing a statement that should not exist', () => {
  it('withdraws an unsigned statement for a month with nothing to reconcile, with a reason', async () => {
    const id = statement(psa, '2026-09');
    expect((await post(`/api/reconciliation/${id}/withdraw`, { reason: 'empty' })).status).toBe(400);
    const r = await post(`/api/reconciliation/${id}/withdraw`, { reason: 'Made by the scheduler: no energy and no bill for September' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM reconciliations WHERE id = ?').get(id).n).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE action = 'RECON_WITHDRAWN' AND entity_id = ?`).get(id).n).toBe(1);
  });

  it('treats a PSA whose source plant has no energy as nothing to reconcile', async () => {
    const ppa = makeContract({ contract_type: 'PPA', tenure_start: '2026-04-01' });
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 40, '2026-04-01')`).run(newId('CAL'), ppa.id, psa.id);
    const run = await post('/api/reconciliation/run', { contract_id: psa.id, period: '2026-09', period_type: 'MONTHLY' });
    expect(run.status).toBe(400);
    expect(run.body.error).toMatch(/Nothing to reconcile/);
    const id = statement(psa, '2026-09');
    expect((await post(`/api/reconciliation/${id}/withdraw`, { reason: 'Made by the scheduler: no energy and no bill' })).status).toBe(200);
  });

  it('keeps one that is signed, or whose month now has something to reconcile', async () => {
    const signed = statement(psa, '2026-08', { status: 'CLOSED' });
    expect((await post(`/api/reconciliation/${signed}/withdraw`, { reason: 'Made by the scheduler by mistake' })).body.error).toMatch(/has been signed/);
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-07' });
    // R1: a month with its bill and its energy locked is one to reconcile.
    db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, '2026-07', 'FINAL', 'SEA', 1000, 'LOCKED')`).run(newId('ENG'), psa.id);
    const live = statement(psa, '2026-07', { status: 'NEEDS_REVIEW' });
    expect((await post(`/api/reconciliation/${live}/withdraw`, { reason: 'Made by the scheduler by mistake' })).body.error).toMatch(/regenerate/);
  });
});

describe('S58 Approving a buyer\'s bill when the buyer is under-secured', () => {
  const bill = () => {
    const inv = makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'UNDER_APPROVAL', billing_period: '2026-08', total_amount: 500000 });
    db.prepare(`INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, 'PENDING')`).run(newId('APR'), inv.id);
    return inv;
  };
  const approve = (inv, body = {}) => post(`/api/invoices/${inv.id}/approvals/1/act`, { decision: 'APPROVED', ...body }, tokenFor('REIA_ADMIN'));

  it('shows the position on the bill, and asks the final approver to say why it goes as it stands', async () => {
    const inv = bill();
    const detail = (await request(app).get(`/api/invoices/${inv.id}`).set(auth(reia))).body;
    expect(detail.security_position).toMatchObject({ adequate: false, available: 0 });
    const r = await approve(inv);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/under-secured/);
    const ok = await approve(inv, { security_ack: 'Supplied energy is billed; LC renewal chased with PSPCL' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(db.prepare('SELECT comments FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).comments).toMatch(/Approved under-secured: Supplied energy is billed/);
  });

  it('asks nothing where the security covers the bill', async () => {
    db.prepare(`INSERT INTO payment_security (id, instrument_no, entity_id, contract_id, mechanism_type, limit_amount, utilized_amount, available_amount, status, validity_start, validity_end)
      VALUES (?, 'LC-S58', ?, ?, 'LC', 5000000, 0, 5000000, 'ACTIVE', '2026-01-01', '2030-12-31')`).run(newId('PS'), buyer.id, psa.id);
    expect((await approve(bill())).status).toBe(200);
  });
});
