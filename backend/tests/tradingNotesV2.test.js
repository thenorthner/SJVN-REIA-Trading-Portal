import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { auth, tokenFor } from './helpers/reia.js';
import { newId } from '../src/util.js';

// A trading debit or credit note is raised as a draft, issued by someone else,
// and — this is the point of it — carried on the client's ledger, so what the
// note says is owed shows up on the account rather than only in a register.

let maker; let checker; let clientId; let invoiceId;

beforeEach(() => {
  db.prepare('DELETE FROM trading_debit_credit_notes').run();
  db.prepare('DELETE FROM client_ledgers').run();
  db.prepare('DELETE FROM trading_invoices').run();
  db.prepare('DELETE FROM trading_clients').run();

  const entityId = newId('BUY');
  db.prepare(`INSERT INTO entities (id, entity_type, category, name, short_code, status)
              VALUES (?, 'BUYER', 'DISCOM', 'Bihar SPHCL', 'BSPHCL', 'APPROVED')`).run(entityId);
  clientId = newId('TCL');
  db.prepare(`INSERT INTO trading_clients (id, entity_id, name, client_type, status)
              VALUES (?, ?, 'Bihar SPHCL', 'DISCOM', 'ACTIVE')`).run(clientId, entityId);
  invoiceId = newId('TIN');
  db.prepare(`INSERT INTO trading_invoices (id, invoice_no, client_id, invoice_kind, billing_period, quantum_mwh, total_amount, status)
              VALUES (?, 'SJVN/ENERGY/BSPHCL/202609/1', ?, 'EXCHANGE', '2026-09', 100, 500000, 'SENT')`).run(invoiceId, clientId);

  maker = tokenFor('TRADING_USER');
  checker = tokenFor('FINANCE_USER');
});

const post = (url, body, who = maker) => request(app).post(url).set(auth(who)).send(body);
const get = (url, who = maker) => request(app).get(url).set(auth(who));
const raise = (o = {}) => post('/api/trading-notes', {
  client_id: clientId, trading_invoice_id: invoiceId, note_type: 'DEBIT', billing_period: '2026-09',
  amount: 10000, reason_code: 'SCHEDULE_SHORTFALL_PURCHASE', reason: 'Shortfall bought on the exchange', ...o,
});
const approve = (id, o = {}, who = checker) => post(`/api/trading-notes/${id}/approve`, { issued_date: '2026-09-10', ...o }, who);
const ledger = () => db.prepare('SELECT * FROM client_ledgers WHERE client_id = ? ORDER BY timestamp, rowid').all(clientId);
const balance = () => (ledger().at(-1)?.running_balance ?? 0);

describe('raising a trading note', () => {
  it('starts as a draft that is on no ledger and in no total', async () => {
    const r = await raise();
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('DRAFT');
    expect(r.body.note_no).toMatch(/^DRAFT-/);
    expect(r.body.signed_amount).toBe(0);
    expect(r.body.on_ledger).toBe(false);
    expect(ledger()).toHaveLength(0);
    const sum = (await get('/api/trading-notes/summary')).body;
    expect(sum.total_debit).toBe(0);
    expect(sum.awaiting_approval).toBe(1);
  });

  it('carries the tax on the note', async () => {
    const r = await raise({ taxable_amount: 10000, tax_amount: 1800, tax_label: 'IGST 18%' });
    expect(r.body.amount).toBe(11800);
    expect(r.body.taxable_amount).toBe(10000);
    expect(r.body.tax_amount).toBe(1800);
  });

  it('still refuses a note that hangs off no invoice', async () => {
    const r = await post('/api/trading-notes', {
      client_id: clientId, note_type: 'DEBIT', billing_period: '2026-09', amount: 100, reason: 'x',
    });
    expect(r.status).toBe(400);
  });
});

describe('issuing a trading note', () => {
  it('needs a second person', async () => {
    const n = (await raise()).body;
    expect((await approve(n.id, {}, maker)).status).toBe(403);
    expect(ledger()).toHaveLength(0);
  });

  it('numbers it for the financial year and debits the client ledger', async () => {
    const n = (await raise()).body;
    const r = await approve(n.id);
    expect(r.status).toBe(200);
    expect(r.body.note_no).toMatch(/^TDN\/2026-27\/\d{5}$/);
    expect(r.body.on_ledger).toBe(true);
    expect(r.body.signed_amount).toBe(10000);

    const rows = ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction_type).toBe('DEBIT_NOTE');
    expect(rows[0].debit).toBe(10000);
    expect(rows[0].reference_id).toBe(n.id);
    expect(balance()).toBe(10000);
  });

  it('credits the ledger for a credit note, and keeps the running balance', async () => {
    await approve((await raise()).body.id); // +10,000
    const credit = (await raise({ note_type: 'CREDIT', amount: 4000, reason_code: 'SCHEDULE_EXCESS_RETURN' })).body;
    await approve(credit.id);
    const rows = ledger();
    expect(rows.map((r) => r.transaction_type)).toEqual(['DEBIT_NOTE', 'CREDIT_NOTE']);
    expect(rows[1].credit).toBe(4000);
    expect(balance()).toBe(6000);
  });

  it('can be rejected with a reason, and a rejected note cannot be issued', async () => {
    const n = (await raise()).body;
    expect((await post(`/api/trading-notes/${n.id}/reject`, {}, checker)).status).toBe(400);
    const r = await post(`/api/trading-notes/${n.id}/reject`, { reason: 'Broker bill not received' }, checker);
    expect(r.body.status).toBe('REJECTED');
    expect(r.body.signed_amount).toBe(0);
    expect((await approve(n.id)).status).toBe(400);
    expect(ledger()).toHaveLength(0);
  });
});

describe('cancelling a trading note', () => {
  it('posts the opposite entry rather than rubbing the ledger out', async () => {
    const issued = (await approve((await raise()).body.id)).body;
    const r = await post(`/api/trading-notes/${issued.id}/cancel`, { reason: 'raised on the wrong client' });
    expect(r.body.status).toBe('CANCELLED');
    const rows = ledger();
    expect(rows).toHaveLength(2);
    expect(rows[1].credit).toBe(10000);
    expect(rows[1].description).toMatch(/Cancellation of debit note/);
    expect(balance()).toBe(0);
  });

  it('leaves the ledger alone when the note was only a draft', async () => {
    const n = (await raise()).body;
    const r = await post(`/api/trading-notes/${n.id}/cancel`, { reason: 'not needed' });
    expect(r.body.status).toBe('CANCELLED');
    expect(ledger()).toHaveLength(0);
  });

  it('still refuses to cancel a settled note', async () => {
    const issued = (await approve((await raise()).body.id)).body;
    await post(`/api/trading-notes/${issued.id}/settle`, { settled_date: '2026-09-20' });
    const r = await post(`/api/trading-notes/${issued.id}/cancel`, { reason: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/opposite note/);
  });
});

describe('the period summary', () => {
  it('counts only what has been issued', async () => {
    await approve((await raise()).body.id);
    await raise({ amount: 50000 }); // left as a draft
    const sum = (await get('/api/trading-notes/summary?billing_period=2026-09')).body;
    expect(sum.total_debit).toBe(10000);
    expect(sum.net_payable).toBe(10000);
    expect(sum.awaiting_approval).toBe(1);
  });
});
