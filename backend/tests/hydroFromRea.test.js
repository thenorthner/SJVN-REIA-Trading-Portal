import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import request from 'supertest';

// The REA run fetches and parses PDFs from the RPC website. Here the scraper is
// replaced by one that lays down the energy each month's account would have
// carried — the figures NRPC published for NJHPS, April to June 2026 — so the
// test is about what the run does with an account, not about the network.
const PUBLISHED = {
  '2026-04': { energy_mwh: 255110.25, availability_percent: 99.938, free_energy_mwh: 30613.23 },
  '2026-05': { energy_mwh: 459358.5, availability_percent: 100, free_energy_mwh: 55123.02 },
  '2026-06': { energy_mwh: 731158.75, availability_percent: 109.667, free_energy_mwh: 87739.035 },
};
const calls = [];

vi.mock('../src/services/reaScraper.js', async () => {
  const { default: db } = await import('../src/db/index.js');
  const { newId } = await import('../src/util.js');
  return {
    reaScraper: {
      getStatus: () => ({}),
      getFetchLog: () => [],
      runFullCycle: async () => ({}),
      runAllSources: async () => [],
      triggerManual: async (rpc, month, type, opts = {}) => {
        calls.push({ rpc, month, type, url: opts.url || null });
        const acc = PUBLISHED[month];
        if (!acc || type === 'FINAL') throw new Error(`PDF not found (404) for ${rpc}/${month}`);
        const c = db.prepare(`SELECT id FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
        db.prepare(`
          INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, availability_percent, free_energy_mwh, status)
          VALUES (?, ?, ?, 'PROVISIONAL', 'REA', ?, ?, ?, 'VALIDATED')
        `).run(newId('ENG'), c.id, month, acc.energy_mwh, acc.availability_percent, acc.free_energy_mwh);
        return { logId: 'LOG', records: 1, parsedStations: 2 };
      },
    },
  };
});

const { app } = await import('../src/server.js');
const { default: db } = await import('../src/db/index.js');
const { tokenFor, auth } = await import('./helpers/reia.js');
const { seedNjhpsAllocations } = await import('../src/services/hydroStationBill.js');

const TOUCHED = ['PPA/SJVN/NJHPS/001', 'PPA/SJVN/RHPS/001'];
const COLS = ['annual_afc', 'annual_design_energy_mwh', 'normative_aux', 'free_energy_home_state',
  'napaf_percent', 'capacity_mw', 'capacity_charges_total', 'status'];
let snapshot = [];
let reia;
let njhps;

function clean() {
  db.prepare('DELETE FROM hydro_bill_approvals').run();
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  db.prepare(`DELETE FROM energy_data WHERE source = 'REA' AND contract_id IN
    (SELECT id FROM contracts WHERE contract_no IN ('PPA/SJVN/NJHPS/001','PPA/SJVN/RHPS/001'))`).run();
}

beforeAll(() => {
  snapshot = TOUCHED.map((no) => db.prepare('SELECT * FROM contracts WHERE contract_no = ?').get(no)).filter(Boolean);
});

afterAll(() => {
  clean();
  const stmt = db.prepare(`UPDATE contracts SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`);
  for (const row of snapshot) stmt.run(...COLS.map((c) => row[c]), row.id);
});

beforeEach(() => {
  calls.length = 0;
  clean();
  seedNjhpsAllocations();
  njhps = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  db.prepare(`
    UPDATE contracts SET annual_afc = 14615741000, annual_design_energy_mwh = 6612000, normative_aux = 1.2,
      free_energy_home_state = 12, napaf_percent = 87, capacity_mw = 1500, status = 'ACTIVE'
    WHERE id = ?
  `).run(njhps.id);
  // Only NJHPS is billable in these tests: Rampur is left without an allocation.
  reia = tokenFor('REIA_USER');
});

const run = (body) => request(app).post('/api/hydro-billing/from-rea').set(auth(reia)).send(body);
const bill = (month) => db.prepare(`
  SELECT * FROM hydro_station_bills WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED'
`).get(njhps.id, month);

describe('POST /hydro-billing/from-rea', () => {
  it('drafts each month oldest first, carrying the year\'s cumulative, and matches the printed June bill', async () => {
    const res = await run({ from_month: '2026-04', to_month: '2026-06' });
    expect(res.status).toBe(200);
    const created = res.body.months.flatMap((m) => m.bills).filter((b) => b.contract_no === 'PPA/SJVN/NJHPS/001');
    expect(created.map((b) => b.status)).toEqual(['CREATED', 'CREATED', 'CREATED']);

    const june = bill('2026-06');
    expect(june.status).toBe('DRAFT');
    expect(june.bill_kind).toBe('PROVISIONAL');
    expect(june.rea_reference).toBe('NRPC Provisional REA 2026-06');
    // SJVN's June-2026 NJHPS bill: E2 from the REA's D2 free power, E4/E5
    // carried from April and May, total Rs 1,574,926,027.
    expect(june.e2_free_power_kwh).toBe(87739035);
    expect(june.e4_cum_scheduled_kwh).toBe(1445627500);
    expect(june.e5_cum_free_power_kwh).toBe(173475285);
    expect(Math.round(june.total_charges)).toBe(1574926027);
  });

  it('asks for the final account before the provisional, and passes a copied link through', async () => {
    const link = 'https://nrpc.gov.in/allfile/090920261746068677REA0626_P.pdf';
    await run({ from_month: '2026-06', rea_links: { '2026-06': link } });
    expect(calls).toEqual([{ rpc: 'NRPC', month: '2026-06', type: 'PROVISIONAL', url: link }]);

    calls.length = 0;
    clean(); seedNjhpsAllocations();
    await run({ from_month: '2026-05' });
    expect(calls.map((c) => c.type)).toEqual(['FINAL', 'PROVISIONAL']);
  });

  it('leaves a month that already has a live bill alone', async () => {
    await run({ from_month: '2026-04', to_month: '2026-04' });
    const first = bill('2026-04');
    const res = await run({ from_month: '2026-04', to_month: '2026-04' });
    const row = res.body.months[0].bills.find((b) => b.contract_no === 'PPA/SJVN/NJHPS/001');
    expect(row.status).toBe('EXISTS');
    expect(row.bill_no).toBe(first.bill_no);
    expect(db.prepare('SELECT COUNT(*) c FROM hydro_station_bills WHERE contract_id = ?').get(njhps.id).c).toBe(1);
  });

  it('does not bill a later month once an earlier one could not be, because its cumulative would be wrong', async () => {
    // March 2026 is not in the published set, so April onwards must not be drafted.
    const res = await run({ from_month: '2026-03', to_month: '2026-05' });
    const rows = res.body.months.map((m) => m.bills.find((b) => b.contract_no === 'PPA/SJVN/NJHPS/001'));
    expect(rows[0].status).toBe('SKIPPED');
    expect(rows[1].status).toBe('SKIPPED');
    expect(rows[1].reason).toMatch(/earlier month/);
    expect(bill('2026-04')).toBeUndefined();
  });

  it('refuses a month whose earlier months of the year are not billed, even across separate requests', async () => {
    // The page sends one month per request, so the guard cannot rely on the run.
    let res = await run({ from_month: '2026-05' });
    let row = res.body.months[0].bills.find((b) => b.contract_no === 'PPA/SJVN/NJHPS/001');
    expect(row.status).toBe('SKIPPED');
    expect(row.reason).toMatch(/2026-04/);
    expect(bill('2026-05')).toBeUndefined();

    await run({ from_month: '2026-04' });
    res = await run({ from_month: '2026-05' });
    row = res.body.months[0].bills.find((b) => b.contract_no === 'PPA/SJVN/NJHPS/001');
    expect(row.status).toBe('CREATED');
    expect(bill('2026-05').e4_cum_scheduled_kwh).toBe(714468750);
  });

  it('names the stations it could not bill and why', async () => {
    const res = await run({ from_month: '2026-04' });
    const rampur = res.body.stations_not_ready.find((s) => s.contract_no === 'PPA/SJVN/RHPS/001');
    if (rampur) expect(rampur.missing).toContain('Beneficiary allocation (REA)');
  });

  it('runs in the background when asked, so a slow REA cannot time out at a proxy', async () => {
    const start = await run({ from_month: '2026-04', to_month: '2026-06', background: true });
    expect(start.status).toBe(202);
    const id = start.body.job_id;
    let job;
    for (let i = 0; i < 50; i += 1) {
      job = (await request(app).get(`/api/hydro-billing/from-rea/jobs/${id}`).set(auth(reia))).body;
      if (job.status !== 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job.status).toBe('DONE');
    expect(job.months.map((m) => m.month)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(Math.round(bill('2026-06').total_charges)).toBe(1574926027);
  });

  it('says plainly when a background run is unknown', async () => {
    const res = await request(app).get('/api/hydro-billing/from-rea/jobs/NOPE').set(auth(reia));
    expect(res.status).toBe(404);
  });

  it('refuses a bad range', async () => {
    expect((await run({ from_month: 'June' })).status).toBe(400);
    expect((await run({ from_month: '2026-06', to_month: '2026-04' })).status).toBe(400);
    expect((await run({ from_month: '2025-01', to_month: '2026-06' })).status).toBe(400);
  });

  it('is closed to a read-only role', async () => {
    const res = await request(app).post('/api/hydro-billing/from-rea').set(auth(tokenFor('MANAGEMENT')))
      .send({ from_month: '2026-04' });
    expect(res.status).toBe(403);
  });
});
