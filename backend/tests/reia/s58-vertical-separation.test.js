import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { signToken } from '../../src/middleware/auth.js';
import { auth, makeUser, makeEntity, makeContract, makeInvoice, resetReia } from '../helpers/reia.js';

// REIA, Hydro and Thermal share tables; each desk sees only its own book (18-Oct-2026).
let tok, solar, hydro, thermal;
const get = (url) => request(app).get(url).set(auth(tok));

beforeEach(() => {
  resetReia();
  const seller = makeEntity('SELLER', { name: 'Sep Solar' });
  solar = makeContract({ contract_type: 'PPA', seller_id: seller.id, project_type: 'Solar' });
  hydro = makeContract({ contract_type: 'PPA', seller_id: makeEntity('SELLER', { name: 'Sep Hydro' }).id, project_type: 'Hydro' });
  thermal = makeContract({ contract_type: 'PPA', seller_id: makeEntity('SELLER', { name: 'Sep Thermal' }).id, project_type: 'Thermal' });
  for (const c of [solar, hydro, thermal]) makeInvoice({ contract_id: c.id, billing_period: '2026-10', direction: 'SELLER_TO_SJVN' });
  tok = signToken(makeUser('REIA_MAKER')); // Target #2 Phase B: the REIA desk raises contracts, not the SJVN Administrator
});

describe('S58 Vertical separation', () => {
  it('lists only REIA contracts for the REIA desk', async () => {
    const ids = (await get('/api/contracts?vertical=REIA')).body.map((c) => c.id);
    expect(ids).toContain(solar.id);
    expect(ids).not.toContain(hydro.id);
    expect(ids).not.toContain(thermal.id);
  });

  it('lists only hydro or only thermal when asked', async () => {
    expect((await get('/api/contracts?vertical=HYDRO')).body.map((c) => c.id)).toEqual([hydro.id]);
    expect((await get('/api/contracts?vertical=THERMAL')).body.map((c) => c.id)).toEqual([thermal.id]);
  });

  it('cuts bills the same way', async () => {
    const ids = (await get('/api/invoices?vertical=REIA')).body.map((i) => i.contract_id);
    expect(ids).toEqual([solar.id]);
  });

  it('refuses an unknown vertical rather than returning everything', async () => {
    expect((await get('/api/contracts?vertical=SOLAR')).status).toBe(400);
  });

  it('keeps hydro and thermal out of the REIA dashboard', async () => {
    const r = await get('/api/dashboard/reia');
    expect(r.status).toBe(200);
    expect(r.body.kpis.totalInvoices).toBe(1);
    expect(r.body.byProjectType.map((p) => p.project_type)).not.toContain('Hydro');
  });
});

describe('S58 Reports and boards stay on the REIA book', () => {
  it('keeps hydro and thermal bills out of the billing, energy and contract reports', async () => {
    const billing = await get('/api/reports/billing-summary');
    expect(billing.status).toBe(200);
    const contracts = await get('/api/reports/contract-summary');
    const nos = JSON.stringify(contracts.body);
    expect(nos).toContain(solar.contract_no);
    expect(nos).not.toContain(hydro.contract_no);
    expect(nos).not.toContain(thermal.contract_no);
  });

  it('keeps hydro bills out of the REIA payment monitoring and verification queue', async () => {
    const r = await get('/api/reports/payment-monitoring?side=PAYABLE');
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(hydro.contract_no);
    expect((await get('/api/reports/verification-queue')).status).toBe(200);
  });
});

describe('S58 REIA contract rules', () => {
  const body = (extra) => ({
    contract_no: 'REIA/RULE/001', contract_type: 'PPA', seller_id: null, project_type: 'Solar', capacity_mw: 50,
    tariff_type: 'FLAT', tariff_per_unit: 2.9, tenure_start: '2026-04-01', tenure_end: '2051-03-31', billing_cycle: 'MONTHLY', ...extra,
  });
  const create = (extra) => request(app).post('/api/contracts').set(auth(tok)).send(body({ seller_id: solar.seller_id, ...extra }));

  it('refuses a two-part tariff and a hydro plant on a REIA contract', async () => {
    const two = await create({ tariff_type: 'TWO_PART' });
    expect(two.status).toBe(400);
    expect(JSON.stringify(two.body)).toMatch(/two-part/i);
    const hy = await create({ contract_no: 'REIA/RULE/002', project_type: 'Hydro' });
    expect(hy.status).toBe(400);
  });

  it('still takes a flat solar contract', async () => {
    const ok = await create({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});
