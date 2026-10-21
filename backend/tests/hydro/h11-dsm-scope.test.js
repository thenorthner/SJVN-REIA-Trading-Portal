import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { tokenFor, auth, makeContract } from '../helpers/reia.js';

// Hydro QA run 11 (18-Oct-2026): each desk works its own stations' DSM weeks
// on every step, not only when a week is raised.

describe('A solar plant\'s DSM week', () => {
  it('is not edited, billed, linked or deleted by the Hydro or Thermal desk', async () => {
    const solar = makeContract({ project_type: 'Solar', contract_no: `PPA/REIA/QA11-${Math.random().toString(36).slice(2, 8)}` });
    const made = await request(app).post('/api/deviation').set(auth(tokenFor('REIA_MAKER')))
      .send({ contract_id: solar.id, period_month: '2026-08', week_no: 19, entry_type: 'PRIMARY', scheduled_mwh: 1000, actual_mwh: 1010, deviation_rate: 300 });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    for (const role of ['COMMERCIAL', 'THERMAL_USER']) {
      const who = auth(tokenFor(role));
      expect((await request(app).put(`/api/deviation/${made.body.id}`).set(who).send({ scheduled_mwh: 1000, actual_mwh: 1999, deviation_rate: 300 })).status).toBe(403);
      expect((await request(app).post(`/api/deviation/${made.body.id}/dispatch`).set(who).send({})).status).toBe(403);
      expect((await request(app).post(`/api/deviation/${made.body.id}/link-invoice`).set(who).send({ invoice_id: 'X' })).status).toBe(403);
      expect((await request(app).delete(`/api/deviation/${made.body.id}`).set(who)).status).toBe(403);
    }
    expect((await request(app).delete(`/api/deviation/${made.body.id}`).set(auth(tokenFor('REIA_USER')))).status).toBe(200);
  });
});
