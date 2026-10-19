import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import db from '../../src/db/index.js';
import { tokenFor, auth, resetReia } from '../helpers/reia.js';

// Four-eyes on onboarding (thermal QA run 18, 19-Oct-2026): the officer who
// onboarded a company could approve it themself. Bills, notes and KYC papers
// already kept maker and checker apart; onboarding now does too, on every desk,
// administrators included.
let seq = 2000;
const company = () => {
  const n = String(seq++).padStart(4, '0');
  return { entity_type: 'SELLER', category: 'RE Generator', name: `Four Eyes ${n}`, capacity_mw: 40,
           pan_no: `AAACF${n}E`, gst_no: `24AAACF${n}E1ZQ` };
};
const onboard = (tok) => request(app).post('/api/entities').set(auth(tok)).send(company());
const decide = (tok, id, body) => request(app).post(`/api/entities/${id}/approve`).set(auth(tok)).send(body);
const clearGates = (id) => {
  db.prepare(`UPDATE entity_regulatory_approvals SET status = 'VERIFIED' WHERE entity_id = ?`).run(id);
  db.prepare('UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?').run(id);
};
const statusOf = (id) => db.prepare('SELECT status FROM entities WHERE id = ?').get(id).status;

beforeEach(() => resetReia());

describe.each([
  ['REIA', 'REIA_ADMIN'],
  ['Hydro', 'COMMERCIAL_ADMIN'],
  ['Thermal', 'THERMAL_ADMIN'],
])('S68 Onboarding four-eyes — %s desk', (_desk, role) => {
  it('records who onboarded the company', async () => {
    const maker = tokenFor(role);
    const c = await onboard(maker);
    expect(c.status).toBe(201);
    expect(c.body.onboarded_by_user_id).toBeTruthy();
  });

  it('refuses the onboarding officer’s own approval, and lets a second officer approve', async () => {
    const maker = tokenFor(role);
    const id = (await onboard(maker)).body.id;
    clearGates(id);
    const own = await decide(maker, id, { decision: 'APPROVED' });
    expect(own.status).toBe(403);
    expect(own.body.error).toMatch(/another officer/i);
    expect(statusOf(id)).toBe('PENDING');

    const ok = await decide(tokenFor(role), id, { decision: 'APPROVED' });
    expect(ok.status).toBe(200);
    expect(statusOf(id)).toBe('APPROVED');
  });

  it('refuses the onboarding administrator’s direct admission too', async () => {
    const maker = tokenFor(role);
    const id = (await onboard(maker)).body.id;
    clearGates(id);
    const r = await decide(maker, id, { decision: 'APPROVED', admin_direct_admit: true });
    expect(r.status).toBe(403);
    expect(statusOf(id)).toBe('PENDING');
  });

  it('still lets the onboarding officer reject', async () => {
    const maker = tokenFor(role);
    const id = (await onboard(maker)).body.id;
    const r = await decide(maker, id, { decision: 'REJECTED', remarks: 'PAN card does not match the company name' });
    expect(r.status).toBe(200);
    expect(statusOf(id)).toBe('REJECTED');
  });
});
