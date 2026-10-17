import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { runScheduledReconciliations } from '../../src/routes/reconciliation.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, resetReia } from '../helpers/reia.js';

// The reconciliation desk, as reading it for its first end-to-end test found
// it: a second statement raised beside an open one (by the hourly sweep, forty
// times over), SJVN signing past lines that had not matched, and "awaiting your
// signature" sent to every seller on the platform.

let reia, sellerCo, otherCo, contract, seller, other;
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const run = (over = {}) => post('/api/reconciliation/run', { contract_id: contract.id, period: '2026-04', scope: 'REIA_CONTRACT', ...over });
const notesFor = (u) => db.prepare('SELECT message FROM notifications WHERE user_id = ?').all(u.id).map((n) => n.message);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  sellerCo = makeEntity('SELLER');
  otherCo = makeEntity('SELLER');
  contract = makeContract({ status: 'ACTIVE', seller_id: sellerCo.id });
  seller = makeUser('SELLER', { linked_entity_id: sellerCo.id });
  other = makeUser('SELLER', { linked_entity_id: otherCo.id });
  // A statement needs something to reconcile: the month's energy on record.
  const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
  for (const p of ['2026-04', '2026-03', `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`]) db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, status) VALUES (?, ?, ?, 'PROVISIONAL', 'SEA', 100, 'LOCKED')`).run(`ENG-T-${Math.random().toString(36).slice(2, 9)}`, contract.id, p);
});

describe('One open statement for a period', () => {
  it('refuses a second run while the first is open, in words', async () => {
    const first = await run();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await run();
    expect(again.status, 'a second statement was raised beside the open one').toBe(409);
    expect(again.body.error).toContain(first.body.recon_no);
    expect(db.prepare('SELECT COUNT(*) c FROM reconciliations').get().c).toBe(1);
  });

  it('is not added to by the hourly sweep, whatever basis the open one is on', async () => {
    const prev = new Date(); prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
    const period = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const made = await run({ period });
    expect(made.status).toBe(201);
    db.prepare(`UPDATE reconciliations SET data_basis = 'PROVISIONAL' WHERE id = ?`).run(made.body.id);
    runScheduledReconciliations();
    runScheduledReconciliations();
    expect(db.prepare('SELECT COUNT(*) c FROM reconciliations WHERE contract_id = ? AND period = ?').get(contract.id, period).c).toBe(1);
  });

  it('holds a period to its shape', async () => {
    expect((await run({ period: 'May' })).status).toBe(400);
    expect((await run({ period: '2026-13' })).status).toBe(400);
    expect((await run({ period_type: 'QUARTERLY', period: '2026-04' })).body.error).toMatch(/YYYY-Qn/);
  });
});

describe('Signing and deciding', () => {
  const withException = async () => {
    const r = (await run()).body;
    db.prepare(`UPDATE recon_items SET match_status = 'EXCEPTION', dispute_id = NULL WHERE id = (SELECT id FROM recon_items WHERE reconciliation_id = ? LIMIT 1)`).run(r.id);
    db.prepare(`UPDATE reconciliations SET status = 'NEEDS_REVIEW', items_exception = 1 WHERE id = ?`).run(r.id);
    return r;
  };

  it('does not let SJVN sign past a line that has not matched', async () => {
    const r = await withException();
    const sign = await post(`/api/recon-signoff/${r.id}/sign`, { decision: 'AGREE' });
    expect(sign.status, 'SJVN signed a statement with an unexplained line').toBe(400);
    expect(sign.body.error).toMatch(/not matched/);
    const item = db.prepare(`SELECT id FROM recon_items WHERE reconciliation_id = ? AND match_status = 'EXCEPTION'`).get(r.id);
    expect((await post(`/api/reconciliation/${r.id}/override`, { item_id: item.id, reason: '  ' })).status).toBe(400);
    expect((await post(`/api/reconciliation/${r.id}/override`, { item_id: item.id, reason: 'metering rounding' })).status).toBe(200);
    expect((await post(`/api/reconciliation/${r.id}/override`, { item_id: item.id, reason: 'again' })).status, 'a matched line was overridden').toBe(400);
    expect((await post(`/api/recon-signoff/${r.id}/sign`, { decision: 'AGREE' })).status).toBe(200);
  });

  it('is the desk that signs for SJVN, and a signed statement keeps its figures', async () => {
    const r = (await run()).body;
    db.prepare(`UPDATE recon_items SET match_status = 'EXACT' WHERE reconciliation_id = ?`).run(r.id);
    db.prepare(`UPDATE reconciliations SET status = 'PENDING_SIGN_OFF', items_exception = 0 WHERE id = ?`).run(r.id);
    expect((await post(`/api/recon-signoff/${r.id}/sign`, { decision: 'AGREE' }, tokenFor('FINANCE_USER'))).status).toBe(403);
    expect((await post(`/api/recon-signoff/${r.id}/sign`, { decision: 'AGREE' })).status).toBe(200);
    const regen = await post(`/api/reconciliation/${r.id}/regenerate-statement`);
    expect(regen.status, 'a signed statement was recalculated').toBe(400);
    expect(regen.body.error).toMatch(/has been signed/);
  });

  it('tells the company on the statement, and no other', async () => {
    const r = await withException();
    const item = db.prepare(`SELECT id FROM recon_items WHERE reconciliation_id = ? AND match_status = 'EXCEPTION'`).get(r.id);
    await post(`/api/reconciliation/${r.id}/override`, { item_id: item.id, reason: 'ok' });
    db.prepare(`UPDATE reconciliations SET status = 'NEEDS_REVIEW', counterparty_role = 'SELLER' WHERE id = ?`).run(r.id);
    expect((await post(`/api/reconciliation/${r.id}/request-signoff`)).status).toBe(200);
    expect(notesFor(seller).join(' ')).toContain(r.recon_no);
    expect(notesFor(other), 'another seller was told to sign').toEqual([]);
    expect((await post(`/api/reconciliation/${r.id}/request-signoff`)).status, 'sign-off was asked for twice').toBe(400);
  });

  it('takes one reopen request at a time, and needs a reason to disagree', async () => {
    const r = (await run()).body;
    expect((await post(`/api/reconciliation/${r.id}/acknowledge`, { decision: 'DISAGREE' })).status).toBe(400);
    db.prepare(`UPDATE reconciliations SET status = 'CLOSED' WHERE id = ?`).run(r.id);
    expect((await post(`/api/reconciliation/${r.id}/reopen-request`, { reason: 'late credit note' }, signToken(seller))).status).toBe(201);
    const twin = await post(`/api/reconciliation/${r.id}/reopen-request`, { reason: 'again' }, signToken(seller));
    expect(twin.status).toBe(409);
  });

  it('is read by SJVN and the parties to it, and nobody else', async () => {
    await run();
    expect((await get('/api/reconciliation', tokenFor('COMPLIANCE_AUDITOR'))).body).toHaveLength(1);
    expect((await get('/api/reconciliation', signToken(seller))).body).toHaveLength(1);
    expect((await get('/api/reconciliation', signToken(other))).body).toHaveLength(0);
    expect((await get('/api/reconciliation', tokenFor('TRADING_CLIENT'))).body, 'a trading client was handed a contract statement').toHaveLength(0);
  });
});
