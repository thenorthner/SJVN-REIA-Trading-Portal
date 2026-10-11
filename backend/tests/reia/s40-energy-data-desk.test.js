import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, makeUser, makeEntity, makeContract, resetReia } from '../helpers/reia.js';

// The energy desk, as reading it for its first end-to-end test found it: a
// locked period that validating again unlocked, the same account recorded
// twice, any figure taken for energy, and every record open to anyone signed in.

let reia, contract;
const post = (path, body = {}, who = reia) => request(app).post(path).set(auth(who)).send(body);
const get = (path, who = reia) => request(app).get(path).set(auth(who));
const record = (over = {}) => post('/api/energy-data', { contract_id: contract.id, period_month: '2026-05', data_type: 'PROVISIONAL', source: 'JMR', energy_mwh: 14000, ...over });
const status = (id) => db.prepare('SELECT status FROM energy_data WHERE id = ?').get(id).status;

beforeEach(() => {
  resetReia();
  db.prepare('DELETE FROM energy_data').run();
  reia = tokenFor('REIA_USER');
  contract = makeContract({ status: 'ACTIVE', capacity_mw: 100 });
});

describe('Recording a period', () => {
  it('takes energy and percentages that can be real, for a month that has begun', async () => {
    expect((await record({ energy_mwh: -5 })).status).toBe(400);
    expect((await record({ energy_mwh: 'lots' })).status).toBe(400);
    expect((await record({ period_month: '2026-5' })).status).toBe(400);
    expect((await record({ period_month: '2099-01' })).body.error).toMatch(/not begun/);
    expect((await record({ cuf_percent: 140 })).body.error).toMatch(/between 0 and 100/);
    expect(db.prepare('SELECT COUNT(*) c FROM energy_data').get().c).toBe(0);
  });

  it('is not taken twice from the same source, and a draft is mended by recording it again', async () => {
    const first = await record();
    expect(first.status).toBe(201);
    // Still a draft: recording it again corrects it rather than adding a second row.
    const fixed = await record({ energy_mwh: 14500 });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ id: first.body.id, energy_mwh: 14500, status: 'DRAFT', replaced: true });
    expect(db.prepare('SELECT COUNT(*) c FROM energy_data').get().c).toBe(1);
    db.prepare(`UPDATE energy_data SET status = 'VALIDATED' WHERE id = ?`).run(first.body.id);
    const twin = await record();
    expect(twin.status, 'the same account was recorded twice').toBe(409);
    expect(twin.body.error).toMatch(/already has a provisional JMR figure/);
    expect((await record({ source: 'REA' })).status).toBe(201);
    expect((await record({ data_type: 'FINAL' })).status).toBe(201);
  });
});

describe('Validating and locking', () => {
  it('leaves a locked period locked', async () => {
    const row = (await record()).body;
    expect((await post(`/api/energy-data/${row.id}/lock`)).status, 'an unvalidated period was locked').toBe(400);
    await post(`/api/energy-data/${row.id}/validate`);
    if (status(row.id) !== 'VALIDATED') await post(`/api/energy-data/${row.id}/lock`, { override_reason: 'fixture' });
    else expect((await post(`/api/energy-data/${row.id}/lock`)).status).toBe(200);
    expect(status(row.id)).toBe('LOCKED');
    const again = await post(`/api/energy-data/${row.id}/validate`);
    expect(again.status, 'validating a locked period took it out of LOCKED').toBe(400);
    expect(status(row.id)).toBe('LOCKED');
  });

  it('says so when there is no capacity to validate against', async () => {
    db.prepare('UPDATE contracts SET capacity_mw = 0, commissioned_capacity_mw = 0 WHERE id = ?').run(contract.id);
    const row = (await record()).body;
    const r = await post(`/api/energy-data/${row.id}/validate`);
    expect(r.status, 'a deviation of NaN% passed as validated').toBe(400);
    expect(status(row.id)).toBe('DRAFT');
  });
});

describe('An objection SJVN upheld', () => {
  it('stops the unchanged figure being locked without a reason', async () => {
    const row = (await record()).body;
    db.prepare(`UPDATE energy_data SET status = 'VALIDATED', response_status = 'OBJECTED', response_note = 'check meter reads less', objection_outcome = 'UPHELD' WHERE id = ?`).run(row.id);
    const plain = await post(`/api/energy-data/${row.id}/lock`);
    expect(plain.status, 'a figure SJVN agreed was wrong was locked as it stood').toBe(400);
    expect(plain.body.hint).toBeTruthy();
    expect((await post(`/api/energy-data/${row.id}/lock`, { override_reason: 'difference adjusted in next bill' })).status).toBe(200);
    expect(db.prepare('SELECT lock_override_reason r FROM energy_data WHERE id = ?').get(row.id).r).toMatch(/next bill/);
  });
});

describe('Who may read the records', () => {
  it('is SJVN and the parties, and the whole desk may start a fetch', async () => {
    await record();
    expect((await get('/api/energy-data', tokenFor('TRADING_CLIENT'))).status, 'a trading client was handed every energy record').toBe(403);
    expect((await get('/api/energy-data', tokenFor('COMPLIANCE_AUDITOR'))).body).toHaveLength(1);
    // Offered to REIA Admin on the screen, and refused it by the route.
    const fetchIt = await post('/api/energy-data/rea-trigger', { period_month: '2026-05' }, tokenFor('REIA_ADMIN'));
    expect(fetchIt.status).toBe(400);            // asks for the RPC — not a 403
  });
});

describe('What the first end-to-end run found', () => {
  it("measures a month by its own days, and a pair of sources by one gap", async () => {
    const feb = (await record({ period_month: '2026-07', energy_mwh: 13000 })).body;
    const note = (await post(`/api/energy-data/${feb.id}/validate`)).body.deviation_notes;
    expect(note, 'July was held to a 30-day month').toMatch(/over 31 days/);

    const jmr = (await record({ period_month: '2026-06', energy_mwh: 13000 })).body;
    const rea = (await record({ period_month: '2026-06', energy_mwh: 14500, source: 'REA' })).body;
    const a = (await post(`/api/energy-data/${jmr.id}/validate`)).body.deviation_notes;
    const b = (await post(`/api/energy-data/${rea.id}/validate`)).body.deviation_notes;
    expect(a).toMatch(/10\.3% apart/);
    expect(b, 'one pair of figures was two different gaps').toMatch(/10\.3% apart/);
  });

  it('shows the locked figure on the trail, not the one validation threw out', async () => {
    const jmr = (await record({ period_month: '2026-06', energy_mwh: 13000 })).body;
    const rea = (await record({ period_month: '2026-06', energy_mwh: 14500, source: 'REA' })).body;
    await post(`/api/energy-data/${jmr.id}/validate`);
    await post(`/api/energy-data/${rea.id}/validate`);
    expect((await post(`/api/energy-data/${rea.id}/lock`, { override_reason: 'REA is the settled figure' })).status).toBe(200);
    const trail = (await get(`/api/billing-trail?energy_id=${jmr.id}`)).body;
    expect(trail.provisional_energy).toMatchObject({ id: rea.id, status: 'LOCKED', energy_mwh: 14500 });
  });

  it('keeps energy inside the contract, tells the seller of a lock it never answered, and leaves changes to the desk', async () => {
    expect((await record({ period_month: '2026-01' })).body.error).toMatch(/outside it/);

    const co = makeEntity('SELLER');
    db.prepare('UPDATE contracts SET seller_id = ? WHERE id = ?').run(co.id, contract.id);
    const seller = makeUser('SELLER', { linked_entity_id: co.id });
    const row = (await record({ period_month: '2026-06', energy_mwh: 14000 })).body;
    await post(`/api/energy-data/${row.id}/validate`);
    db.prepare(`UPDATE energy_data SET status = 'VALIDATED' WHERE id = ?`).run(row.id);
    await post(`/api/energy-data/${row.id}/lock`);
    const told = db.prepare('SELECT message FROM notifications WHERE user_id = ?').all(seller.id).map((n) => n.message).join(' ');
    expect(told, 'the seller was left with "ready for your confirmation" on a locked figure').toMatch(/locked .* without waiting for your confirmation/);

    expect((await get(`/api/energy-records/${row.id}`)).body.can_manage).toBe(true);
    expect((await get(`/api/energy-records/${row.id}`, tokenFor('FINANCE_USER'))).body.can_manage, 'Finance was offered Attach and Load blocks').toBe(false);
  });
});
