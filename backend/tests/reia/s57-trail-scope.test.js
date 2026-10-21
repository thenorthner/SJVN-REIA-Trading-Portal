import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { signToken } from '../../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// The chain developer → SJVN → DISCOM is shown to both ends, each seeing only its own side's money (18-Oct-2026).
let seller, buyer, ppa, psa, sellerTok, buyerTok, otherTok, staffTok;
const trail = (contractId, tok) => request(app).get(`/api/billing-trail?contract_id=${contractId}&period_month=2026-10`).set(auth(tok));

beforeEach(() => {
  resetReia();
  seller = makeEntity('SELLER', { name: 'Trail Solar' });
  buyer = makeEntity('BUYER', { name: 'Trail DISCOM' });
  ppa = makeContract({ contract_type: 'PPA', seller_id: seller.id, buyer_id: null, tariff_per_unit: 2.88 });
  psa = makeContract({ contract_type: 'PSA', seller_id: null, buyer_id: buyer.id, tariff_per_unit: 2.95 });
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES ('CAL-T', ?, ?, 100, '2026-04-01')`).run(ppa.id, psa.id);
  makeInvoice({ contract_id: ppa.id, billing_period: '2026-10', direction: 'SELLER_TO_SJVN' });
  makeInvoice({ contract_id: psa.id, billing_period: '2026-10', direction: 'SJVN_TO_BUYER' });
  sellerTok = signToken(makeUser('SELLER', { linked_entity_id: seller.id }));
  buyerTok = signToken(makeUser('BUYER', { linked_entity_id: buyer.id }));
  otherTok = signToken(makeUser('SELLER', { linked_entity_id: makeEntity('SELLER').id }));
  staffTok = signToken(makeUser('REIA_ADMIN'));
});

describe('S57 Trail seen from each end', () => {
  it('shows a developer where its power goes, not the DISCOM tariff, SJVN margin or the DISCOM bills', async () => {
    const r = await trail(ppa.id, sellerTok);
    expect(r.status).toBe(200);
    expect(r.body.viewer).toBe('SELLER');
    const { psa: p, hub } = r.body.linked_topology;
    expect(p.buyer_name).toBe('Trail DISCOM');
    expect(p.tariff_per_unit).toBeUndefined();
    expect(p.invoices).toEqual([]);
    expect(hub.trading_margin_per_unit).toBeUndefined();
    expect(hub.spread_amount).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('2.95');
  });

  it('shows a DISCOM who generates its power, the PPA tariff and the margin, but not the developer\'s bills', async () => {
    const r = await trail(psa.id, buyerTok);
    expect(r.status).toBe(200);
    expect(r.body.viewer).toBe('BUYER');
    const { ppa: p, hub } = r.body.linked_topology;
    expect(p.seller_name).toBe('Trail Solar');
    expect(p.tariff_per_unit).toBe(2.88);
    expect(p.invoices).toEqual([]);
    expect(hub.trading_margin_per_unit).toBeDefined();
  });

  it('keeps one company out of another\'s trail', async () => {
    expect((await trail(ppa.id, otherTok)).status).toBe(404);
    expect((await trail(psa.id, sellerTok)).status).toBe(404);
  });

  it('shows SJVN staff both ends in full', async () => {
    const r = await trail(ppa.id, staffTok);
    expect(r.body.viewer).toBe('SJVN');
    expect(r.body.linked_topology.psa.tariff_per_unit).toBe(2.95);
  });

  it('lists the months a contract has something for', async () => {
    const r = await request(app).get(`/api/billing-trail/periods?contract_id=${ppa.id}`).set(auth(sellerTok));
    expect(r.body.periods).toContain('2026-10');
    expect((await request(app).get(`/api/billing-trail/periods?contract_id=${ppa.id}`).set(auth(otherTok))).status).toBe(404);
  });
});
