import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// The flag is read when the modules load, so it is set before the imports.
vi.hoisted(() => { process.env.REIA_BETA = '1'; });

const { app } = await import('../../src/server.js');
const { default: db } = await import('../../src/db/index.js');
const { tokenFor, auth, makeEntity, makeContract, resetReia } = await import('../helpers/reia.js');

// The beta scrubs the stations' rows out of a GET, but not the counts and sums
// worked out beside them: the Compliance Desk counted the station contracts in
// its cards and Excel, and the DSM screen showed 7 weeks and ₹33.6 lakh payable
// over an empty list (1-Nov-2026). The totals are now worked out on the REIA
// rows alone.

const maker = () => tokenFor('REIA_MAKER');

function stationAndPlant() {
  const station = makeEntity('SELLER', { name: 'QA S78 Hydro Station' });
  db.prepare("UPDATE entities SET verticals = 'HYDRO' WHERE id = ?").run(station.id);
  const hydro = makeContract({ contract_type: 'PPA', contract_no: 'PPA/QA/S78-NJHPS', project_type: 'Hydro', seller_id: station.id, tenure_end: '2051-03-31' });
  const solar = makeContract({ contract_type: 'PPA', contract_no: 'PPA/QA/S78-SOLAR', project_type: 'Solar', tenure_end: '2051-03-31' });
  return { hydro, solar };
}

function week(contract, n, amount) {
  db.prepare(`INSERT INTO deviation_settlements (id, dsm_no, contract_id, period_month, week_no, week_date, entry_type, source,
      scheduled_mwh, actual_mwh, deviation_mwh, deviation_rate, deviation_amount, status, created_at, updated_at)
    VALUES (?, ?, ?, '2026-10', ?, '2026-10-05', 'PRIMARY', 'MANUAL', 1000, 950, -50, 4000, ?, 'CALCULATED', datetime('now'), datetime('now'))`)
    .run(`DSM-S78-${n}`, `DSM/S78/W${n}`, contract.id, n, amount);
}

beforeEach(() => {
  resetReia();
  db.prepare("DELETE FROM deviation_settlements WHERE id LIKE 'DSM-S78-%'").run();
});

describe('S78 totals in the REIA beta', () => {
  it('the Compliance Desk counts REIA contracts alone', async () => {
    const { hydro, solar } = stationAndPlant();
    const reg = (await request(app).get('/api/reports/contract-compliance').set(auth(maker()))).body;
    const ids = reg.contracts.map((c) => c.contract_id);
    expect(ids).toContain(solar.id);
    expect(ids).not.toContain(hydro.id);
    expect(reg.totals.contracts).toBe(reg.contracts.length);
    const states = reg.contracts.map((c) => c.state);
    expect(reg.totals.breach + reg.totals.due + reg.totals.ok + reg.totals.not_live).toBe(states.length);
  });

  it('DSM weeks and sums leave the stations out', async () => {
    const { hydro, solar } = stationAndPlant();
    week(hydro, 28, -3361000);
    week(solar, 29, -200000);
    const list = (await request(app).get('/api/deviation').set(auth(maker()))).body;
    expect(list.map((r) => r.contract_id)).toEqual([solar.id]);
    const sum = (await request(app).get('/api/deviation/summary').set(auth(maker()))).body;
    expect(sum).toMatchObject({ weeks: 1, net_amount: -200000, payable: -200000, estimated: 1 });
  });
});
