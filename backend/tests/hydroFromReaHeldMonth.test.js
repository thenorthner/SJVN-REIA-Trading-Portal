import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import request from 'supertest';

// A month whose REA energy equals the month beside it to the decimal is held
// by the importer as DISPUTED (see services/reaMonthChecks.js). The bill run
// must not draft a bill on it: in Oct 2026 August's NJHPS energy, re-read as
// September's, would have billed the beneficiaries for August twice.
//
// As in hydroFromRea.test.js, the scraper is replaced by one that lays down
// what each month's account carried — here May arrives already held.
const APRIL = { energy_mwh: 255110.25, availability_percent: 99.938, free_energy_mwh: 30613.23 };

vi.mock('../src/services/reaScraper.js', async () => {
  const { default: db } = await import('../src/db/index.js');
  const { newId } = await import('../src/util.js');
  const { SAME_AS_ADJACENT_NOTE } = await import('../src/services/reaMonthChecks.js');
  return {
    reaScraper: {
      getStatus: () => ({}),
      getFetchLog: () => [],
      runFullCycle: async () => ({}),
      runAllSources: async () => [],
      triggerManual: async (rpc, month, type) => {
        if (type === 'FINAL' || !['2026-04', '2026-05'].includes(month)) throw new Error(`PDF not found (404) for ${rpc}/${month}`);
        const c = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
        const held = month === '2026-05';
        db.prepare(`
          INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, availability_percent, free_energy_mwh, status, deviation_notes)
          VALUES (?, ?, ?, 'PROVISIONAL', 'REA', ?, ?, ?, ?, ?)
        `).run(newId('ENG'), c.id, month, APRIL.energy_mwh, APRIL.availability_percent, APRIL.free_energy_mwh,
          held ? 'DISPUTED' : 'VALIDATED',
          held ? `${SAME_AS_ADJACENT_NOTE} the 2026-04 PROVISIONAL REA (${APRIL.energy_mwh} MWh) — likely that month's account read again. Check the 2026-05 PDF before this is used.` : null);
        return { logId: 'LOG', records: 1, parsedStations: 2 };
      },
    },
  };
});

const { app } = await import('../src/server.js');
const { default: db } = await import('../src/db/index.js');
const { tokenFor, auth } = await import('./helpers/reia.js');
const { seedNjhpsAllocations } = await import('../src/services/hydroStationBill.js');

const COLS = ['annual_afc', 'annual_design_energy_mwh', 'normative_aux', 'free_energy_home_state',
  'napaf_percent', 'capacity_mw', 'status'];
let snapshot;
let njhps;
let token;

function clean() {
  db.prepare('DELETE FROM hydro_bill_approvals').run();
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  db.prepare(`DELETE FROM energy_data WHERE source = 'REA' AND contract_id IN
    (SELECT id FROM contracts WHERE contract_no IN ('PPA/SJVN/NJHPS/001','PPA/SJVN/RHPS/001'))`).run();
}

beforeAll(() => {
  snapshot = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
});
afterAll(() => {
  clean();
  db.prepare(`UPDATE contracts SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...COLS.map((c) => snapshot[c]), snapshot.id);
});
beforeEach(() => {
  clean();
  seedNjhpsAllocations();
  njhps = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  db.prepare(`
    UPDATE contracts SET annual_afc = 14615741000, annual_design_energy_mwh = 6612000, normative_aux = 1.2,
      free_energy_home_state = 12, napaf_percent = 87, capacity_mw = 1500, status = 'ACTIVE'
    WHERE id = ?
  `).run(njhps.id);
  token = tokenFor('COMMERCIAL_ADMIN');
});

describe('POST /hydro-billing/from-rea on a month held as identical to the one before', () => {
  it('drafts the genuine month, skips the held one and says why', async () => {
    const res = await request(app).post('/api/hydro-billing/from-rea').set(auth(token))
      .send({ from_month: '2026-04', to_month: '2026-05' });
    expect(res.status).toBe(200);
    const njhpsBills = res.body.months.map((m) => m.bills.find((b) => b.contract_no === 'PPA/SJVN/NJHPS/001'));
    expect(njhpsBills[0].status).toBe('CREATED');
    expect(njhpsBills[1].status).toBe('SKIPPED');
    expect(njhpsBills[1].reason).toMatch(/identical to the 2026-04 PROVISIONAL REA/);

    const mayBill = db.prepare(`
      SELECT 1 FROM hydro_station_bills WHERE contract_id = ? AND billing_month = '2026-05' AND status <> 'CANCELLED'
    `).get(njhps.id);
    expect(mayBill).toBeUndefined();
  });
});
