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

// Phase B.2: on the REIA desk the maker onboards and the checker clears, so
// the two are different people by role as well as by record. The station desks
// have no split yet: there one role does both, and four-eyes is by person.
describe.each([
  ['REIA', 'REIA_MAKER', 'REIA_CHECKER'],
  ['Hydro', 'COMMERCIAL_ADMIN', 'COMMERCIAL_ADMIN'],
  ['Thermal', 'THERMAL_ADMIN', 'THERMAL_ADMIN'],
])('S68 Onboarding four-eyes — %s desk', (_desk, makerRole, checkerRole) => {
  const split = makerRole !== checkerRole;

  it('records who onboarded the company', async () => {
    const maker = tokenFor(makerRole);
    const c = await onboard(maker);
    expect(c.status).toBe(201);
    expect(c.body.onboarded_by_user_id).toBeTruthy();
    if (split) expect((await onboard(tokenFor(checkerRole))).status).toBe(403);
  });

  it('refuses the onboarding officer’s own approval, and lets a second officer approve', async () => {
    const maker = tokenFor(makerRole);
    const id = (await onboard(maker)).body.id;
    clearGates(id);
    const own = await decide(maker, id, { decision: 'APPROVED' });
    expect(own.status).toBe(403);
    if (!split) expect(own.body.error).toMatch(/another officer/i);
    expect(statusOf(id)).toBe('PENDING');

    const ok = await decide(tokenFor(checkerRole), id, { decision: 'APPROVED' });
    expect(ok.status).toBe(200);
    expect(statusOf(id)).toBe('APPROVED');
  });

  it('refuses the onboarding administrator’s direct admission too', async () => {
    const maker = tokenFor(makerRole);
    const id = (await onboard(maker)).body.id;
    clearGates(id);
    const r = await decide(maker, id, { decision: 'APPROVED', admin_direct_admit: true });
    expect(r.status).toBe(403);
    expect(statusOf(id)).toBe('PENDING');
  });

  it('lets a reviewer reject — on a split desk the checker, otherwise the onboarding officer too', async () => {
    const maker = tokenFor(makerRole);
    const id = (await onboard(maker)).body.id;
    const r = await decide(split ? tokenFor(checkerRole) : maker, id, { decision: 'REJECTED', remarks: 'PAN card does not match the company name' });
    expect(r.status).toBe(200);
    expect(statusOf(id)).toBe('REJECTED');
  });
});
