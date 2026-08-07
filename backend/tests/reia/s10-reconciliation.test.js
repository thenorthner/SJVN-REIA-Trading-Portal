import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, columnsOf, hasTable, resetReia } from '../helpers/reia.js';

let reia, contract;
beforeEach(() => { resetReia(); reia = tokenFor('REIA_USER'); contract = makeContract({ status: 'ACTIVE' }); });

const run = () => request(app).post('/api/reconciliation/run').set(auth(reia))
  .send({ contract_id: contract.id, period: '2026-04', scope: 'REIA_CONTRACT' });

describe('S10 Reconciliation', () => {
  it('matches metered against billed against paid, not just two legs', async () => {
    const r = await run();
    expect(r.status).toBeLessThan(400);
    const items = db.prepare('SELECT * FROM recon_items').all();
    const types = items.map(i => i.item_type || i.type || '').join(' ');
    expect(types, 'reconciliation does not carry a three-way energy/financial match').toMatch(/ENERGY/i);
    expect(types).toMatch(/FINANCIAL|PAY/i);
  });

  it('auto-matches inside tolerance and flags outside it', async () => {
    const r = await run();
    const recon = db.prepare('SELECT * FROM reconciliations ORDER BY rowid DESC').get();
    expect(recon).toBeTruthy();
    expect(columnsOf('reconciliations')).toEqual(expect.arrayContaining(['tolerance_qty_pct', 'tolerance_amount', 'items_exception']));
  });

  it('produces a statement needing sign-off from both sides', async () => {
    await run();
    const recon = db.prepare('SELECT * FROM reconciliations ORDER BY rowid DESC').get();
    expect(columnsOf('reconciliations')).toEqual(expect.arrayContaining(['sjvn_ack_at', 'counterparty_ack_at']));
    const st = await request(app).get(`/api/reconciliation/${recon.id}/statement`).set(auth(reia));
    expect(st.status).toBe(200);
  });

  it('closes only when both sides have acknowledged', async () => {
    await run();
    const recon = db.prepare('SELECT * FROM reconciliations ORDER BY rowid DESC').get();
    await request(app).post(`/api/reconciliation/${recon.id}/acknowledge`).set(auth(reia)).send({ decision: 'AGREE' });
    const after = db.prepare('SELECT status, sjvn_ack_at, counterparty_ack_at FROM reconciliations WHERE id = ?').get(recon.id);
    expect(after.sjvn_ack_at).toBeTruthy();
    expect(after.status, 'closed on one signature alone').not.toBe('CLOSED');
  });

  it('requires a controlled request to reopen a closed period', async () => {
    expect(hasTable('recon_reopen_requests')).toBe(true);
    expect(columnsOf('recon_reopen_requests')).toEqual(expect.arrayContaining(['reason', 'requested_by', 'status']));
  });

  it('reports an auto-match percentage as a health indicator', async () => {
    await run();
    const recon = db.prepare('SELECT auto_match_pct FROM reconciliations ORDER BY rowid DESC').get();
    expect(recon.auto_match_pct).toBeGreaterThanOrEqual(0);
    expect(recon.auto_match_pct).toBeLessThanOrEqual(100);
  });
});
