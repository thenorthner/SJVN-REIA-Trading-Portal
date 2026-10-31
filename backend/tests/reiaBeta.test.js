import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// The flag is read when the module loads, so it is set before the imports.
vi.hoisted(() => { process.env.REIA_BETA = '1'; });

const { app } = await import('../src/server.js');
const { default: db } = await import('../src/db/index.js');
const { signToken } = await import('../src/middleware/auth.js');
const { auth, makeUser, makeEntity, makeContract, resetReia } = await import('./helpers/reia.js');

// The REIA beta: the API keeps the hydro and thermal stations, which share
// REIA's entities and contracts tables, and the other desks' users out of
// every list a beta tester is sent. Roles and permissions are unchanged.

let admin, solar, station, mixedBuyer, reiaPpa, stationPpa;
const get = (path) => request(app).get(path).set(auth(signToken(admin)));

beforeEach(() => {
  resetReia();
  admin = makeUser('SJVN_ADMIN', { name: 'Asha Admin' });
  solar = makeEntity('SELLER', { name: 'Bright Solar Pvt Ltd' });
  station = makeEntity('SELLER', { name: 'SJVN Upper Valley HEP' });
  db.prepare("UPDATE entities SET verticals = 'HYDRO' WHERE id = ?").run(station.id);
  mixedBuyer = makeEntity('BUYER', { name: 'State Discom Ltd' });
  db.prepare("UPDATE entities SET verticals = 'REIA,THERMAL' WHERE id = ?").run(mixedBuyer.id);
  reiaPpa = makeContract({ seller_id: solar.id, buyer_id: mixedBuyer.id, contract_no: 'PPA/REIA/BETA/001' });
  stationPpa = makeContract({ seller_id: station.id, buyer_id: mixedBuyer.id, contract_no: 'PPA/SJVN/UVHEP/001', project_type: 'Hydro' });
});

describe('REIA beta lists', () => {
  it('leave out the stations, and show a shared buyer as REIA only', async () => {
    const r = await get('/api/entities');
    expect(r.status).toBe(200);
    const names = r.body.map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['Bright Solar Pvt Ltd', 'State Discom Ltd']));
    expect(names).not.toContain('SJVN Upper Valley HEP');
    expect(r.body.find((e) => e.id === mixedBuyer.id).verticals).toBe('REIA');
  });

  it('leave out a station contract', async () => {
    const r = await get('/api/contracts');
    expect(r.status).toBe(200);
    const list = Array.isArray(r.body) ? r.body : r.body.contracts || r.body.rows || [];
    const ids = list.map((c) => c.id);
    expect(ids).toContain(reiaPpa.id);
    expect(ids).not.toContain(stationPpa.id);
  });

  it('leave out the other desks\' users and their role codes', async () => {
    makeUser('TRADING_USER', { name: 'Tara Trader' });
    makeUser('THERMAL_ADMIN', { name: 'Tanvi Thermal' });
    makeUser('REIA_MAKER', { name: 'Ravi Maker' });
    const r = await get('/api/staff');
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).toContain('Ravi Maker');
    expect(text).not.toMatch(/Tara Trader|Tanvi Thermal|TRADING_USER|THERMAL_ADMIN/);
  });

  it('leave out another desk\'s alerts', async () => {
    const add = db.prepare('INSERT INTO notifications (id, user_id, type, message, link) VALUES (?, ?, ?, ?, ?)');
    add.run('NTF-BETA-HYDRO', admin.id, 'HYDRO_BILL_APPROVED', 'Hydro bill HB/2026/000008 approved', '/hydro-thermal/hydro-billing');
    add.run('NTF-BETA-REIA', admin.id, 'INVOICE_APPROVED', 'REIA invoice INV/2026/0001 approved', '/reia/invoices');
    const r = await get('/api/notifications');
    expect(r.status).toBe(200);
    const ids = JSON.stringify(r.body);
    expect(ids).toContain('NTF-BETA-REIA');
    expect(ids).not.toContain('NTF-BETA-HYDRO');
  });

  it('leave the other desks\' users out of the audit facets', async () => {
    const thermal = makeUser('THERMAL_USER', { name: 'Tanvi Thermal' });
    const add = db.prepare('INSERT INTO audit_logs (id, user_id, user_name, user_role, action, module) VALUES (?, ?, ?, ?, ?, ?)');
    add.run('AUD-BETA-1', thermal.id, 'Tanvi Thermal', 'THERMAL_USER', 'UPDATE', 'ENTITIES');
    add.run('AUD-BETA-2', admin.id, 'Asha Admin', 'SJVN_ADMIN', 'UPDATE', 'ENTITIES');
    const r = await get('/api/audit-logs/facets');
    expect(r.status).toBe(200);
    const names = (r.body.users || []).map((u) => u.user_name);
    expect(names).toContain('Asha Admin');
    expect(names).not.toContain('Tanvi Thermal');
  });

  it('leave the other desks\' master settings out, and word the REIA margin as SJVN\'s', async () => {
    const params = await get('/api/masters/parameters');
    expect(params.status).toBe(200);
    const list = Array.isArray(params.body) ? params.body : Object.values(params.body).find(Array.isArray);
    const keys = list.map((p) => p.param_key);
    expect(keys).not.toEqual(expect.arrayContaining(['hydro_rea_auto_draft']));
    expect(keys.filter((k) => /hydro|thermal|^cerc_licen|^market_price_cap$/.test(k))).toEqual([]);
    expect(JSON.stringify(list)).not.toMatch(/trading clients|\b[Tt]rading margin\b(?!\) Regulations)/);

    const docTypes = await get('/api/masters/document-types');
    expect(docTypes.status).toBe(200);
    const modules = (Array.isArray(docTypes.body) ? docTypes.body : Object.values(docTypes.body).find(Array.isArray)).map((d) => d.module_name);
    expect(modules).not.toEqual(expect.arrayContaining(['BILATERAL']));
    expect(modules.filter((m) => /TRADING/.test(m))).toEqual([]);
  });

  it('name no exchange for a diverted sale', async () => {
    const { scrub } = await import('../src/services/reiaBeta.js');
    const out = scrub([{ diversion_no: 'PDV/2026-09/001', exchange_platform: 'IEX',
      message: '120 MWh of PSA/REIA/BETA/001 for 2026-09 was sold on the exchange (payment default).' }], { ids: new Set(), words: [] });
    expect(out[0]).not.toHaveProperty('exchange_platform');
    expect(out[0].message).toBe('120 MWh of PSA/REIA/BETA/001 for 2026-09 was sold to a third party (payment default).');
  });

  it('do not change what a write may do', async () => {
    const r = await request(app).post('/api/contracts').set(auth(signToken(makeUser('SELLER', { linked_entity_id: solar.id })))).send({});
    // A seller still may not raise a contract: the beta filters answers, not permissions.
    expect([401, 403]).toContain(r.status);
  });
});
