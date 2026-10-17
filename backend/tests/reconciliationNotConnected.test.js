/**
 * Lines the platform cannot check, and the percentage that must not count them.
 *
 * The tax and SAP lines had no system to compare against, so they compared the
 * platform's own figure with itself and reported an exact match every run —
 * two of six lines on every contract statement that were never able to fail,
 * quietly lifting the auto-match percentage a desk reads as agreement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth, makeContract, makeInvoice } from './helpers/reia.js';
import { summariseItems, NOT_CONNECTED } from '../src/reconciliationConstants.js';
import { buildContractReconItems } from '../src/reconciliationEngine.js';

let writer, contract;

beforeEach(() => {
  db.prepare('DELETE FROM recon_items').run();
  db.prepare('DELETE FROM reconciliations').run();
  writer = tokenFor('REIA_USER');
  contract = makeContract({ contract_type: 'PPA', project_type: 'Solar' });
  // A statement needs something to reconcile: the month's energy on record.
  for (const p of ['2026-01']) db.prepare(`INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, availability_percent, status) VALUES (?, ?, ?, 'PROVISIONAL', 'SEA', 100, 95, 'LOCKED')`).run(`ENG-T-${Math.random().toString(36).slice(2, 9)}`, contract.id, p);
  // R1: a month is reconciled once its bill is presented too.
  for (const p of ['2026-01']) makeInvoice({ contract_id: contract.id, direction: 'SELLER_TO_SJVN', status: 'APPROVED', billing_period: p, energy_mwh: 100, energy_charges: 300000, total_amount: 300000, due_date: '2099-12-31' });
});

const lineOf = (items, type) => items.find((i) => i.item_type === type);

describe('summariseItems', () => {
  it('counts a not-connected line as neither matched nor an exception', () => {
    const s = summariseItems([
      { match_status: 'EXACT', variance: 0 },
      { match_status: 'EXCEPTION', variance: 500 },
      { match_status: NOT_CONNECTED, variance: 0 },
    ]);
    expect(s.matched).toBe(1);
    expect(s.exceptions).toBe(1);
    expect(s.not_connected).toBe(1);
  });

  it('keeps not-connected lines out of the percentage', () => {
    // Two checkable lines, one matched: 50%. Counting the unchecked line as a
    // pass would read 66%, and counting it in the denominator only would read 33%.
    const s = summariseItems([
      { match_status: 'EXACT', variance: 0 },
      { match_status: 'EXCEPTION', variance: 500 },
      { match_status: NOT_CONNECTED, variance: 0 },
    ]);
    expect(s.checkable).toBe(2);
    expect(s.auto_match_pct).toBe(50);
  });

  it('reports nothing rather than everything when no line is checkable', () => {
    const s = summariseItems([{ match_status: NOT_CONNECTED, variance: 0 }]);
    expect(s.auto_match_pct).toBe(0);
    expect(s.checkable).toBe(0);
  });

  it('counts an overridden line as matched and a carried one as open', () => {
    const s = summariseItems([
      { match_status: 'OVERRIDDEN', variance: 900 },
      { match_status: 'CARRIED', variance: 400 },
    ]);
    expect(s.matched).toBe(1);
    expect(s.exceptions).toBe(1);
    expect(s.unreconciled_amount).toBe(400);
  });
});

describe('the tax and SAP lines', () => {
  it('report not connected when no figure is supplied to compare against', () => {
    const built = buildContractReconItems({ contractId: contract.id, period: '2026-01' });
    expect(lineOf(built.items, 'TAX').match_status).toBe(NOT_CONNECTED);
    expect(lineOf(built.items, 'INTERNAL_SAP').match_status).toBe(NOT_CONNECTED);
  });

  it('do not invent a figure to agree with', () => {
    const built = buildContractReconItems({ contractId: contract.id, period: '2026-01' });
    // The old behaviour mirrored the billed amount into the comparison column,
    // which is what made the match automatic.
    expect(lineOf(built.items, 'TAX').paid_value).toBeNull();
    expect(lineOf(built.items, 'INTERNAL_SAP').sap_reference_amount).toBeNull();
  });

  it('are compared properly once a figure is supplied', () => {
    const built = buildContractReconItems({
      contractId: contract.id,
      period: '2026-01',
      sapOverride: { tax_filed: 12345, sap_amount: 999999 },
    });
    const tax = lineOf(built.items, 'TAX');
    const sap = lineOf(built.items, 'INTERNAL_SAP');
    expect(tax.match_status).not.toBe(NOT_CONNECTED);
    expect(tax.paid_value).toBe(12345);
    expect(sap.match_status).not.toBe(NOT_CONNECTED);
    expect(sap.sap_reference_amount).toBe(999999);
  });

  it('stay out of the statement percentage', () => {
    const built = buildContractReconItems({ contractId: contract.id, period: '2026-01' });
    expect(built.metrics.items_not_connected).toBe(2);
    expect(built.metrics.items_total).toBeGreaterThan(built.metrics.items_not_connected);
    // Every line that could be checked, plus the two that could not.
    const checkable = built.metrics.items_auto_matched + built.metrics.items_exception;
    expect(checkable).toBe(built.metrics.items_total - 2);
  });

  it('do not block sign-off', () => {
    // Nothing to resolve on an unchecked line, so it must not hold the
    // statement in review the way a real exception does.
    const built = buildContractReconItems({ contractId: contract.id, period: '2026-01' });
    const openItems = built.items.filter((i) => ['EXCEPTION', 'CARRIED'].includes(i.match_status));
    if (!openItems.length) expect(built.status).toBe('PENDING_SIGN_OFF');
  });
});

describe('POST /api/reconciliation/run', () => {
  it('stores the not-connected lines and a percentage over the checkable ones', async () => {
    const res = await request(app).post('/api/reconciliation/run').set(auth(writer))
      .send({ contract_id: contract.id, period: '2026-01' });

    expect(res.status).toBe(201);
    const stored = res.body.items.filter((i) => i.match_status === NOT_CONNECTED);
    expect(stored).toHaveLength(2);

    const checkable = res.body.items_auto_matched + res.body.items_exception;
    expect(checkable).toBe(res.body.items_total - 2);
    const expectedPct = checkable
      ? Number(((res.body.items_auto_matched / checkable) * 100).toFixed(2))
      : 0;
    expect(res.body.auto_match_pct).toBe(expectedPct);
  });
});
