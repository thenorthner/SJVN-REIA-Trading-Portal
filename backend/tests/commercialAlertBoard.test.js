import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import db from '../src/db/index.js';
import { signToken } from '../src/middleware/auth.js';
import { auth, makeUser } from './helpers/reia.js';

describe('Commercial Desk Notification Board', () => {
  let commercialAdmin;
  const as = (u) => auth(signToken(u));

  beforeEach(() => {
    commercialAdmin = makeUser('COMMERCIAL_ADMIN', { name: 'Sunil Commercial' });
  });

  it('allows COMMERCIAL_ADMIN to access the board with hydro & thermal scope', async () => {
    const res = await request(app).get('/api/alerts/board').set(as(commercialAdmin));
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('COMMERCIAL');
    expect(res.body.groups).toHaveProperty('HYDRO', 'Hydro & Thermal Stations');
    expect(Array.isArray(res.body.alerts)).toBe(true);
    expect(Array.isArray(res.body.broadcasts)).toBe(true);

    // Any hydro alert should link to /hydro-thermal
    for (const a of res.body.alerts) {
      if (a.link) {
        expect(a.link.startsWith('/hydro-thermal')).toBe(true);
      }
    }
  });

  it('allows COMMERCIAL_ADMIN to post a broadcast message to the board', async () => {
    const msg = await request(app)
      .post('/api/alerts/broadcasts')
      .set(as(commercialAdmin))
      .send({
        title: 'Hydro PAF Revision',
        message: 'NJHPS May revised availability filed with NRPC',
        severity: 'WARNING',
        audience: 'INTERNAL',
      });
    expect(msg.status).toBe(201);
    expect(msg.body.title).toBe('Hydro PAF Revision');

    const board = await request(app).get('/api/alerts/board').set(as(commercialAdmin));
    const posted = board.body.broadcasts.find((b) => b.id === msg.body.id);
    expect(posted).toBeDefined();
    expect(posted.title).toBe('Hydro PAF Revision');

    // Clean up
    await request(app).delete(`/api/alerts/broadcasts/${msg.body.id}`).set(as(commercialAdmin));
  });

  it('allows COMMERCIAL_ADMIN to manage alert preferences', async () => {
    const getRes = await request(app).get('/api/alerts/preferences').set(as(commercialAdmin));
    expect(getRes.status).toBe(200);

    const putRes = await request(app)
      .put('/api/alerts/preferences')
      .set(as(commercialAdmin))
      .send({ email_min: 'WARNING', sms_min: 'CRITICAL' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.email_min).toBe('WARNING');
    expect(putRes.body.sms_min).toBe('CRITICAL');
  });
});
