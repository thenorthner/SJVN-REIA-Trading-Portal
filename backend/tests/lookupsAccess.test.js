import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import { tokenFor, auth } from './helpers/reia.js';

// The Bilateral Desk fills its "NOAR rejected — reason" dropdown from the lookup
// master. A trading user was refused the list (403), so the people who record a
// rejection got an empty dropdown. Found by the role audit.

const lookups = (role) => request(app).get('/api/masters/lookups').query({ category: 'NOAR_REJECTION_REASON' }).set(auth(tokenFor(role)));

describe('Lookup lists', () => {
  it('are readable by the trading desk, which records NOAR rejections', async () => {
    const res = await lookups('TRADING_USER');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((r) => r.category === 'NOAR_REJECTION_REASON')).toBe(true);
  });

  it('stay closed to a counterparty', async () => {
    expect((await lookups('SELLER')).status).toBe(403);
  });

  it('can still only be changed by those who maintain the masters', async () => {
    const res = await request(app).post('/api/masters/lookups').set(auth(tokenFor('TRADING_USER')))
      .send({ category: 'NOAR_REJECTION_REASON', code: 'X', label: 'X' });
    expect(res.status).toBe(403);
  });
});
