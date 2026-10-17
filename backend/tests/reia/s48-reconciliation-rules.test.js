import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';
import { buildContractReconItems } from '../../src/reconciliationEngine.js';

// Found by the browser audit of the reconciliation desk (17-Oct-2026): a month
// with no data (and one not yet over) came out 100 % matched and was sent to the
// developer to sign; Sunrise's October billed 16,368 MWh against 8,184 because
// its own invoice and SJVN's computed bill were both counted; a statement closed
// with two lines unexplained through an older signing route; another closed on
// SJVN's signature alone; a disputed statement could go nowhere; and a reopen
// was approved by the person who asked for it.

let reia, admin, sellerCo, seller, ppa;
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const energy = (contract, period, mwh, over = {}) => db.prepare(`
  INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, availability_percent, cuf_percent, status)
  VALUES (?, ?, ?, 'PROVISIONAL', 'SEA', ?, ?, ?, ?)`).run(`ENG-${Math.random().toString(36).slice(2, 9)}`, contract.id, period, mwh, 'availability' in over ? over.availability : 95, over.cuf ?? null, over.status ?? 'LOCKED');
const run = (contract, period) => post('/api/reconciliation/run', { contract_id: contract.id, period, period_type: 'MONTHLY' });
const line = (built, type) => built.items.find((i) => i.item_type === type);

beforeEach(() => {
  resetReia();
  reia = tokenFor('REIA_USER');
  admin = tokenFor('SJVN_ADMIN');
  sellerCo = makeEntity('SELLER');
  seller = signToken(makeUser('SELLER', { linked_entity_id: sellerCo.id }));
  ppa = makeContract({ contract_type: 'PPA', project_type: 'Solar', capacity_mw: 50, tariff_per_unit: 2.88, seller_id: sellerCo.id, tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
});

describe('S48 Nothing to reconcile is not a match', () => {
  it('refuses a month with no energy and no bill, and one not yet over', async () => {
    const empty = await run(ppa, '2026-07');
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/Nothing to reconcile/);
    const future = await run(ppa, '2049-12');
    expect(future.status).toBe(400);
    expect(future.body.error).toMatch(/has not ended yet/);
  });

  it('does not take a missing availability as 100 %', () => {
    energy(ppa, '2026-07', 8184, { availability: null });
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-07', energy_mwh: 8184, due_date: '2099-12-31' });
    expect(line(buildContractReconItems({ contractId: ppa.id, period: '2026-07' }), 'PERFORMANCE').match_status).toBe('NOT_CONNECTED');
  });
});

describe('S48 What counts as billed', () => {
  it('leaves out drafts, and SJVN\'s computed bill once the developer\'s own invoice is approved', () => {
    energy(ppa, '2026-07', 8184);
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'SENT', billing_period: '2026-07', energy_mwh: 8184, total_amount: 23569920, invoice_type: 'PROVISIONAL', invoice_breakdown_json: '[{"code":"TOTAL"}]' });
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-07', energy_mwh: 8184, total_amount: 23569920, invoice_type: 'PROVISIONAL', invoice_breakdown_json: '' });
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'DRAFT', billing_period: '2026-07', energy_mwh: 9000, total_amount: 99, invoice_type: 'SUPPLEMENTARY' });
    const built = buildContractReconItems({ contractId: ppa.id, period: '2026-07' });
    expect(line(built, 'ENERGY_THREE_WAY')).toMatchObject({ metered_value: 8184, billed_value: 8184, match_status: 'EXACT' });
    expect(line(built, 'FINANCIAL_THREE_WAY').billed_value).toBe(23569920);
  });

  it('reads a PSA\'s energy off the PPAs that feed it', () => {
    const psa = makeContract({ contract_type: 'PSA', project_type: 'Solar', buyer_id: makeEntity('BUYER').id, tenure_start: '2024-01-01', tenure_end: '2040-12-31' });
    db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES ('CAL-S48', ?, ?, 40, '2024-01-01')`).run(ppa.id, psa.id);
    energy(ppa, '2026-07', 10000);
    makeInvoice({ contract_id: psa.id, direction: 'SJVN_TO_BUYER', status: 'SENT', billing_period: '2026-07', energy_mwh: 4000, total_amount: 11800000 });
    expect(line(buildContractReconItems({ contractId: psa.id, period: '2026-07' }), 'ENERGY_THREE_WAY')).toMatchObject({ metered_value: 4000, match_status: 'EXACT' });
  });

  it('expects no monthly CUF deduction — the shortfall is settled at the year end — not 1 % of the bill', () => {
    db.prepare('UPDATE contracts SET min_cuf_percent = 19 WHERE id = ?').run(ppa.id);
    energy(ppa, '2026-07', 2000, { availability: 99 }); // CUF 5.38 % on 50 MW
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-07', energy_mwh: 2000, energy_charges: 5760000, total_amount: 5760000, due_date: '2099-12-31' });
    const built = buildContractReconItems({ contractId: ppa.id, period: '2026-07' });
    const pen = line(built, 'PENALTY');
    expect(pen.paid_value).toBe(0);
    expect(pen.notes).toMatch(/contract year .* assessed at the year end/);
    expect(built.metrics.unreconciled_amount).toBe(0);
  });
});

describe('S48 Signing', () => {
  const statement = async () => {
    energy(ppa, '2026-07', 8184);
    // Billed short of the metered figure, so the energy line does not match.
    makeInvoice({ contract_id: ppa.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: '2026-07', energy_mwh: 8000, due_date: '2099-12-31' });
    const r = await run(ppa, '2026-07');
    return r.body;
  };

  it('lets the developer sign only after SJVN has explained every line', async () => {
    const st = await statement();
    expect(st.status).toBe('NEEDS_REVIEW');
    const early = await post(`/api/recon-signoff/${st.id}/sign`, { decision: 'AGREE' }, seller);
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/still under SJVN's review/);
  });

  it('has no side door: the older agree and resolve routes do not sign or close', async () => {
    const st = await statement();
    expect((await post(`/api/reconciliation/${st.id}/acknowledge`, { decision: 'AGREE' })).status).toBe(400);
    expect((await post(`/api/reconciliation/${st.id}/resolve`, { notes: 'x' })).status).toBe(404);
    expect(db.prepare('SELECT status, sjvn_ack_at FROM reconciliations WHERE id = ?').get(st.id)).toMatchObject({ status: 'NEEDS_REVIEW', sjvn_ack_at: null });
  });

  it('lets a disputed statement be reviewed again, setting aside the signatures on it', async () => {
    const st = await statement();
    const item = db.prepare(`SELECT id FROM recon_items WHERE reconciliation_id = ? AND match_status = 'EXCEPTION'`).get(st.id);
    await post(`/api/reconciliation/${st.id}/override`, { item_id: item.id, reason: 'bill raised next month' });
    expect((await post(`/api/recon-signoff/${st.id}/sign`, { decision: 'AGREE' })).status).toBe(200);
    expect((await post(`/api/reconciliation/${st.id}/acknowledge`, { decision: 'DISAGREE', note: 'our JMR differs' }, seller)).status).toBe(200);
    const again = await post(`/api/reconciliation/${st.id}/regenerate-statement`, {});
    expect(again.status, 'a disputed statement could go nowhere').toBe(200);
    expect(db.prepare('SELECT sjvn_ack_at, status FROM reconciliations WHERE id = ?').get(st.id).sjvn_ack_at).toBeNull();
  });

  it('drops an override when the figures under it change', async () => {
    const st = await statement();
    const item = db.prepare(`SELECT id FROM recon_items WHERE reconciliation_id = ? AND item_type = 'ENERGY_THREE_WAY'`).get(st.id);
    await post(`/api/reconciliation/${st.id}/override`, { item_id: item.id, reason: 'bill raised next month' });
    db.prepare(`UPDATE energy_data SET energy_mwh = 9000 WHERE contract_id = ?`).run(ppa.id);
    await post(`/api/reconciliation/${st.id}/regenerate-statement`, {});
    const now = db.prepare(`SELECT match_status, metered_value, notes FROM recon_items WHERE reconciliation_id = ? AND item_type = 'ENERGY_THREE_WAY'`).get(st.id);
    expect(now).toMatchObject({ match_status: 'EXCEPTION', metered_value: 9000 });
    expect(now.notes).toMatch(/override .* dropped/);
  });

  it('does not let the person who asked for a reopen grant it', async () => {
    const st = await statement();
    db.prepare(`UPDATE reconciliations SET status = 'CLOSED' WHERE id = ?`).run(st.id);
    const rr = (await post(`/api/reconciliation/${st.id}/reopen-request`, { reason: 'late credit note' }, admin)).body;
    expect((await post(`/api/reconciliation/reopen-requests/${rr.id}/act`, { decision: 'APPROVED' }, admin)).status).toBe(403);
    expect((await post(`/api/reconciliation/reopen-requests/${rr.id}/act`, { decision: 'APPROVED' }, tokenFor('FINANCE_USER'))).status).toBe(200);
  });
});
