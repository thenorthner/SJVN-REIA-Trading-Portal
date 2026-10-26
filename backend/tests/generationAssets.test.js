import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { tokenFor, auth } from './helpers/reia.js';

// The plants on the public map: kept by the administrators like every master,
// read by the desks, and shown to the public without anything about who keeps them.

const plant = (over = {}) => ({
  id: `TEST_PLANT_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  name: 'Test Hydro Station', type: 'HYDRO', capacity_num: 120, state: 'Himachal Pradesh', state_code: 'HP',
  status_category: 'UNDER_CONSTRUCTION', coords_x: 220, coords_y: 150, ...over,
});
const post = (token, body) => request(app).post('/api/masters/generation-assets').set(auth(token)).send(body);
const made = [];

afterAll(() => {
  for (const id of made) db.prepare('DELETE FROM generation_assets WHERE id = ?').run(id);
});

describe('the generation assets master', () => {
  it('is written by the SJVN and IT administrators only, and read by the desks', async () => {
    for (const role of ['REIA_MAKER', 'REIA_CHECKER', 'MANAGEMENT', 'FINANCE_USER']) {
      expect((await post(tokenFor(role), plant())).status, `${role} added a plant`).toBe(403);
    }
    expect((await request(app).get('/api/masters/generation-assets').set(auth(tokenFor('REIA_MAKER')))).status).toBe(200);
    for (const role of ['SJVN_ADMIN', 'IT_SUPER_ADMIN']) {
      const body = plant();
      const r = await post(tokenFor(role), body);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      made.push(body.id);
    }
  });

  it('says what is wrong instead of failing on the database', async () => {
    const admin = tokenFor('SJVN_ADMIN');
    expect((await post(admin, plant({ type: 'NUCLEAR' }))).body.error).toMatch(/Type must be one of/);
    expect((await post(admin, plant({ status_category: 'SOMEDAY' }))).body.error).toMatch(/Stage must be one of/);
    expect((await post(admin, plant({ capacity_num: 0, capacity: '' }))).body.error).toMatch(/Capacity in MW/);
    expect((await post(admin, plant({ coords_x: '', coords_y: 150 }))).body.error).toMatch(/Map position/);
    expect((await post(admin, plant({ coords_x: 5000 }))).body.error).toMatch(/Map position/);
    const body = plant();
    expect((await post(admin, body)).status).toBe(201);
    made.push(body.id);
    const again = await post(admin, body);
    expect(again.status).toBe(409);
  });

  it('keeps the shown capacity and the counted one the same', async () => {
    const admin = tokenFor('SJVN_ADMIN');
    const body = plant({ capacity_num: 66 });
    const r = await post(admin, body);
    made.push(body.id);
    expect(r.body).toMatchObject({ capacity: '66 MW', capacity_num: 66 });
    const up = await request(app).put(`/api/masters/generation-assets/${body.id}`).set(auth(admin)).send({ capacity: '69.5 MW' });
    expect(up.body).toMatchObject({ capacity: '69.5 MW', capacity_num: 69.5 });
  });

  it('records the plant before and after a change, and the whole of a removed one', async () => {
    const admin = tokenFor('SJVN_ADMIN');
    const body = plant();
    await post(admin, body);
    await request(app).put(`/api/masters/generation-assets/${body.id}`).set(auth(admin)).send({ status_category: 'OPERATIONAL' });
    await request(app).delete(`/api/masters/generation-assets/${body.id}`).set(auth(admin));
    const trail = db.prepare(`SELECT action, before_value FROM audit_logs WHERE entity_type = 'generation_assets' AND entity_id = ? ORDER BY rowid`).all(body.id);
    expect(trail.map((t) => t.action)).toEqual(['CREATE', 'UPDATE', 'DELETE']);
    expect(JSON.parse(trail[2].before_value)).toMatchObject({ id: body.id, name: 'Test Hydro Station' });
  });

  it('shows the public only the visible plants, and not who keeps them', async () => {
    const admin = tokenFor('SJVN_ADMIN');
    const hidden = plant({ is_active: 0 });
    await post(admin, hidden);
    made.push(hidden.id);
    const r = await request(app).get('/api/public/generation-assets');
    expect(r.status).toBe(200);
    expect(r.body.find((a) => a.id === hidden.id)).toBeUndefined();
    expect(r.body.every((a) => !('created_by' in a))).toBe(true);
    expect(r.body.find((a) => a.id === 'JAISALMER_WIND')).toBeUndefined();
  });
});
