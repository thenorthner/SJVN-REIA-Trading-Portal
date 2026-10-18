import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/server.js';
import { tokenFor, auth, makeContract } from '../helpers/reia.js';

// Hydro QA run 13 (18-Oct-2026): PTC sale bills.

let station, desk;
const ptc = (body) => request(app).post('/api/hydro-billing/ptc').set(auth(desk)).send({
  contract_id: station.id, billing_month: '2026-09', exchange_beneficiary: 'PTC India Ltd',
  from_date: '2026-09-01', to_date: '2026-09-15', energy_kwh: 1000000, gross_sale: 5000000, trading_expense: 25000, ...body,
});
beforeEach(() => {
  desk = tokenFor('COMMERCIAL_ADMIN');
  station = makeContract({ project_type: 'Hydro', contract_no: `PPA/SJVN/QA13-${Math.random().toString(36).slice(2, 8)}` });
});

describe('A PTC sale bill', () => {
  it('can be one of several trades in a month, but not over days already billed', async () => {
    expect((await ptc({})).body.net_amount).toBe(4975000);
    const second = await ptc({ from_date: '2026-09-16', to_date: '2026-09-30' });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await ptc({ from_date: '2026-09-10', to_date: '2026-09-20' })).status).toBe(409);
  });

  it('takes real dates, billed in the month the trade ends', async () => {
    expect((await ptc({ from_date: 'abc', to_date: 'abd' })).body.error).toMatch(/must be a date/);
    expect((await ptc({ from_date: '2025-01-01', to_date: '2025-01-31' })).body.error).toMatch(/is billed in 2025-01, not 2026-09/);
  });

  it('is raised on a station only', async () => {
    const solar = makeContract({ project_type: 'Solar' });
    expect((await ptc({ contract_id: solar.id })).status).toBe(400);
  });
});
