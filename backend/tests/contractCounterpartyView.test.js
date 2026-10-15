import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { newId } from '../src/util.js';
import { auth, makeUser, makeEntity, makeContract } from './helpers/reia.js';

// What a seller and a buyer read of the contracts they are party to. Each
// contracts with SJVN, not with the other: the seller is not told who buys its
// power or at what tariff, the buyer is not told whose plant it comes from or
// what SJVN pays for it, and neither sees SJVN's margin or its drafts.

let reia, seller, buyer, solar, discom, ppa, psa, draftPsa;
const as = (u) => auth(signToken(u));
const get = (u, path) => request(app).get(`/api${path}`).set(as(u));

beforeEach(() => {
  solar = makeEntity('SELLER', { name: 'Sunrise Solar' });
  discom = makeEntity('BUYER', { name: 'Punjab DISCOM' });
  ppa = makeContract({ contract_type: 'PPA', seller_id: solar.id, tariff_per_unit: 2.88, trading_margin_per_mwh: 70, remarks: 'Feeds PSA/PUNJAB/1' });
  psa = makeContract({ contract_type: 'PSA', buyer_id: discom.id, tariff_per_unit: 2.95, trading_margin_per_mwh: 70, remarks: 'Carved out of PPA from Sunrise Solar' });
  draftPsa = makeContract({ contract_type: 'PSA', buyer_id: discom.id, tariff_per_unit: 3.22, status: 'DRAFT' });
  // A PPA has no buyer and a PSA no seller.
  db.prepare('UPDATE contracts SET buyer_id = NULL WHERE id = ?').run(ppa.id);
  db.prepare('UPDATE contracts SET seller_id = NULL WHERE id IN (?, ?)').run(psa.id, draftPsa.id);
  db.prepare(`INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from) VALUES (?, ?, ?, 100, '2026-04-01')`)
    .run(newId('CAL'), ppa.id, psa.id);
  reia = makeUser('REIA_USER');
  seller = makeUser('SELLER', { linked_entity_id: solar.id });
  buyer = makeUser('BUYER', { linked_entity_id: discom.id });
});

const SJVN_ONLY = ['trading_margin_per_mwh', 'remarks'];

describe('the contract list and detail', () => {
  it('keep SJVN’s margin and remarks from the seller and the buyer', async () => {
    for (const [u, c] of [[seller, ppa], [buyer, psa]]) {
      const [row] = (await get(u, '/contracts')).body;
      expect(row.id).toBe(c.id);
      for (const k of SJVN_ONLY) expect(row).not.toHaveProperty(k);
      const detail = (await get(u, `/contracts/${c.id}`)).body;
      for (const k of SJVN_ONLY) expect(detail).not.toHaveProperty(k);
    }
    // SJVN still reads them.
    expect((await get(reia, `/contracts/${psa.id}`)).body).toMatchObject({ trading_margin_per_mwh: 70, remarks: expect.any(String) });
  });

  it('do not name the other side', async () => {
    const mine = (await get(seller, `/contracts/${ppa.id}`)).body;
    expect(mine).not.toHaveProperty('buyer_name');
    expect(mine).not.toHaveProperty('buyer_id');
    const theirs = (await get(buyer, `/contracts/${psa.id}`)).body;
    expect(theirs).not.toHaveProperty('seller_name');
    expect(theirs).not.toHaveProperty('projects');
    // Nor can the other side's name be tested for through the search box.
    expect((await get(seller, '/contracts?q=Punjab')).body).toEqual([]);
    expect((await get(buyer, '/contracts?q=Sunrise')).body).toEqual([]);
    expect((await get(reia, '/contracts?q=Sunrise')).body.map((c) => c.id)).toContain(ppa.id);
  });

  it('leave out SJVN’s drafts', async () => {
    expect((await get(buyer, '/contracts')).body.map((c) => c.id)).toEqual([psa.id]);
    expect((await get(buyer, `/contracts/${draftPsa.id}`)).status).toBe(404);
    expect((await get(buyer, `/contract-workspace/${draftPsa.id}`)).status).toBe(404);
    expect((await get(buyer, '/contract-workspace/summary')).body.map((s) => s.contract_id)).toEqual([psa.id]);
    expect((await get(reia, `/contracts/${draftPsa.id}`)).status).toBe(200);
  });

  it('show every version the counterparty signed, without SJVN’s own amended terms', async () => {
    const v2 = makeContract({ contract_type: 'PPA', seller_id: solar.id, version: 2, parent_contract_id: ppa.id, status: 'PENDING_REGULATORY_APPROVAL', tariff_per_unit: 2.9 });
    db.prepare('UPDATE contracts SET buyer_id = NULL WHERE id = ?').run(v2.id);
    db.prepare(`INSERT INTO contract_amendments (id, contract_id, version, changed_fields_json, approved_by, effective_from, new_contract_id) VALUES (?, ?, 1, ?, 'REIA', '2026-10-01', ?)`)
      .run(newId('CMA'), ppa.id, JSON.stringify({ tariff_per_unit: { old: 2.88, new: 2.9 }, trading_margin_per_mwh: { old: 70, new: 80 } }), v2.id);

    const detail = (await get(seller, `/contracts/${v2.id}`)).body;
    expect(detail.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(JSON.parse(detail.amendments[0].changed_fields_json)).toEqual({ tariff_per_unit: { old: 2.88, new: 2.9 } });
    const file = (await get(seller, `/contract-workspace/${v2.id}`)).body;
    expect(file.amendments[0].changed).toEqual({ tariff_per_unit: { old: 2.88, new: 2.9 } });
    expect((await get(reia, `/contract-workspace/${v2.id}`)).body.amendments[0].changed).toHaveProperty('trading_margin_per_mwh');
  });
});

describe('the PPA–PSA allocation', () => {
  it('is SJVN’s alone: it names the other side and puts both tariffs side by side', async () => {
    expect((await get(seller, `/contracts/${ppa.id}/allocations`)).status).toBe(403);
    expect((await get(buyer, `/contracts/${psa.id}/allocations`)).status).toBe(403);
    // Someone else's contract is still simply not there.
    expect((await get(seller, `/contracts/${psa.id}/allocations`)).status).toBe(404);
    const [a] = (await get(reia, `/contracts/${ppa.id}/allocations`)).body;
    expect(a).toMatchObject({ psa_id: psa.id, psa_tariff: 2.95, ppa_tariff: 2.88 });
  });
});

describe('the contract register PDF', () => {
  it('is not open to a counterparty', async () => {
    expect((await get(seller, '/reports/contract-summary/pdf')).status).toBe(403);
    expect((await get(buyer, '/reports/contract-summary/pdf?contract_type=PSA')).status).toBe(403);
  });
});
