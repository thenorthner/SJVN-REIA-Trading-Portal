import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeContract, makeEntity } from '../helpers/reia.js';

// Hydro QA run 1 (18-Oct-2026): the allocation sheet a station's bill is split on.

let hydro, thermal, station;
const post = (path, body, who = hydro) => request(app).post(`/api/hydro-billing${path}`).set(auth(who)).send(body);
const patch = (id, body, who = hydro) => request(app).patch(`/api/hydro-billing/allocations/${id}`).set(auth(who)).send(body);
const sheet = async (month) => (await request(app).get(`/api/hydro-billing/allocations?contract_id=${station.id}&month=${month}`).set(auth(hydro))).body;
const ROWS = [
  { beneficiary_name: 'HOME STATE', pct_rea: 40, is_home_state: 1 },
  { beneficiary_name: 'STATE A', pct_rea: 35 },
  { beneficiary_name: 'STATE B', pct_rea: 25 },
];

beforeEach(async () => {
  hydro = tokenFor('COMMERCIAL_ADMIN');
  thermal = tokenFor('THERMAL_USER');
  station = makeContract({ project_type: 'Hydro', free_energy_home_state: 12, contract_no: `PPA/SJVN/QA-${Math.random().toString(36).slice(2, 8)}` });
  const r = await post('/allocations/bulk', { contract_id: station.id, effective_from: '2026-04-01', rows: ROWS });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
});

const rowOf = (name) => db.prepare('SELECT * FROM hydro_beneficiary_allocations WHERE contract_id = ? AND beneficiary_name = ? ORDER BY effective_from DESC').get(station.id, name);

describe('A later sheet', () => {
  it('takes over from its date: the earlier sheet closes the day before', async () => {
    const r = await post('/allocations/bulk', { contract_id: station.id, effective_from: '2026-10-01', rows: ROWS });
    expect(r.status).toBe(200);
    const oct = await sheet('2026-10');
    expect(oct.rows).toHaveLength(3);
    expect(oct.rows.reduce((a, x) => a + x.pct_rea, 0)).toBeCloseTo(100, 6);
    expect((await sheet('2026-09')).rows).toHaveLength(3);
    expect(db.prepare(`SELECT effective_to FROM hydro_beneficiary_allocations WHERE contract_id = ? AND effective_from = '2026-04-01' LIMIT 1`).get(station.id).effective_to).toBe('2026-09-30');
  });

  it('a sheet laid in before a later one runs only until that one starts', async () => {
    await post('/allocations/bulk', { contract_id: station.id, effective_from: '2027-01-01', rows: ROWS });
    const r = await post('/allocations/bulk', { contract_id: station.id, effective_from: '2026-10-01', rows: ROWS });
    expect(r.body.effective_to).toBe('2026-12-31');
    expect((await sheet('2027-02')).rows).toHaveLength(3);
  });
});

describe('A single row', () => {
  it('cannot name a beneficiary twice or add a second home state', async () => {
    expect((await post('/allocations', { contract_id: station.id, beneficiary_name: 'state a', pct_rea: 1, effective_from: '2026-04-01' })).body.error).toMatch(/appear twice/);
    expect((await post('/allocations', { contract_id: station.id, beneficiary_name: 'HOME 2', pct_rea: 0, is_home_state: 1, effective_from: '2026-04-01' })).body.error).toMatch(/Only one beneficiary/);
    expect((await sheet('2026-09')).rows).toHaveLength(3);
  });

  it('is saved past 100% with a warning, which the bill then refuses', async () => {
    const r = await post('/allocations', { contract_id: station.id, beneficiary_name: 'STATE C', pct_rea: 5, effective_from: '2026-04-01' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sheet_total: 105 });
    expect(r.body.warning).toMatch(/not 100%/);
  });

  it('is only for a station, and links only a stakeholder of the station\'s vertical', async () => {
    const solar = makeContract({ project_type: 'Solar' });
    expect((await post('/allocations', { contract_id: solar.id, beneficiary_name: 'X', pct_rea: 1, effective_from: '2026-04-01' })).body.error).toMatch(/not a hydro or thermal station/);
    const reiaSeller = makeEntity('SELLER');
    expect((await post('/allocations', { contract_id: station.id, beneficiary_name: 'LINKED', beneficiary_id: reiaSeller.id, pct_rea: 0, effective_from: '2026-04-01' })).body.error).toMatch(/not registered as a hydro beneficiary/);
    expect((await post('/allocations', { contract_id: station.id, beneficiary_name: 'GHOST', beneficiary_id: 'NO-SUCH', pct_rea: 0, effective_from: '2026-04-01' })).body.error).toMatch(/not a registered stakeholder/);
    db.prepare(`UPDATE entities SET verticals = 'REIA,HYDRO' WHERE id = ?`).run(reiaSeller.id);
    expect((await post('/allocations', { contract_id: station.id, beneficiary_name: 'LINKED', beneficiary_id: reiaSeller.id, pct_rea: 0, effective_from: '2026-04-01' })).status).toBe(200);
  });
});

describe('An edit', () => {
  it('is checked like a sheet', async () => {
    const a = rowOf('STATE A');
    expect((await patch(a.id, { pct_rea: -3 })).body.error).toMatch(/between 0 and 100/);
    expect((await patch(a.id, { pct_rea: 'abc' })).body.error).toMatch(/between 0 and 100/);
    expect((await patch(a.id, { is_home_state: 1 })).body.error).toMatch(/Only one beneficiary/);
    expect((await patch(a.id, { effective_to: '2026-03-01' })).body.error).toMatch(/cannot end/);
    expect((await patch(a.id, { beneficiary_name: 'STATE B' })).body.error).toMatch(/appear twice/);
    expect(rowOf('STATE A')).toMatchObject({ pct_rea: 35, is_home_state: 0, effective_to: null });
  });

  it('is the station desk\'s own: the thermal desk cannot edit a hydro row', async () => {
    const r = await patch(rowOf('STATE A').id, { source_note: 'x' }, thermal);
    expect(r.status).toBe(403);
  });

  it('is filed under Hydro in the audit trail', async () => {
    await patch(rowOf('STATE A').id, { pct_rea: 30 });
    expect(db.prepare(`SELECT module FROM audit_logs WHERE action = 'HYDRO_ALLOCATION_UPDATED' ORDER BY rowid DESC LIMIT 1`).get().module).toBe('HYDRO');
  });
});
