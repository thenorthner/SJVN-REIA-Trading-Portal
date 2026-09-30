import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// The scheduled draft is the REA run with nobody pressing the button, so what
// is worth testing is the decision to run at all: which months it picks up,
// what it does when there is nothing to do, that two runs cannot overlap, and
// that the desk can switch it off. The arithmetic is covered by
// hydroFromRea.test.js and is deliberately not repeated here.
//
// The energy is laid down the way the scraper's own cron lands it — rows in
// energy_data — so importReaMonth finds the provisional account already held
// and the run never touches the network. The final account is asked for first,
// as it always is, and answers 404.
const calls = [];

vi.mock('../src/services/reaScraper.js', () => ({
  reaScraper: {
    getStatus: () => ({}),
    getFetchLog: () => [],
    runFullCycle: async () => ({}),
    runAllSources: async () => [],
    triggerManual: async (rpc, month, type) => {
      calls.push({ rpc, month, type });
      throw new Error(`PDF not found (404) for ${rpc}/${month}`);
    },
  },
}));

const { app } = await import('../src/server.js');
const { default: db } = await import('../src/db/index.js');
const { newId } = await import('../src/util.js');
const { invalidateParamCache } = await import('../src/mastersService.js');
const { runReaAutoDraft } = await import('../src/routes/hydroBilling.js');
const { seedNjhpsAllocations } = await import('../src/services/hydroStationBill.js');
const { tokenFor, auth } = await import('./helpers/reia.js');

// NRPC's published NJHPS figures for April–June 2026, and a July the RPC has
// not accounted for yet.
const PUBLISHED = {
  '2026-04': { energy_mwh: 255110.25, availability_percent: 99.938, free_energy_mwh: 30613.23 },
  '2026-05': { energy_mwh: 459358.5, availability_percent: 100, free_energy_mwh: 55123.02 },
  '2026-06': { energy_mwh: 731158.75, availability_percent: 109.667, free_energy_mwh: 87739.035 },
};
// A fixed "now": the run's window is the last three months, and a test that
// drifts with the calendar would stop covering these months next quarter.
const NOW = new Date('2026-07-20T00:30:00Z');

const TOUCHED = ['PPA/SJVN/NJHPS/001', 'PPA/SJVN/RHPS/001'];
const COLS = ['annual_afc', 'annual_design_energy_mwh', 'normative_aux', 'free_energy_home_state',
  'napaf_percent', 'capacity_mw', 'capacity_charges_total', 'status'];
let snapshot = [];
let njhps;

const setParam = (key, value) => {
  db.prepare('UPDATE system_parameters SET param_value = ? WHERE param_key = ?').run(value, key);
  invalidateParamCache();
};

function clean() {
  db.prepare('DELETE FROM hydro_bill_approvals').run();
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  db.prepare(`DELETE FROM energy_data WHERE source = 'REA' AND contract_id IN
    (SELECT id FROM contracts WHERE contract_no IN ('PPA/SJVN/NJHPS/001','PPA/SJVN/RHPS/001'))`).run();
  db.prepare(`DELETE FROM notifications WHERE type = 'HYDRO_BILL_AUTO_DRAFT'`).run();
  db.prepare('DELETE FROM hydro_auto_draft_runs').run();
}

/** Land a month's account the way the scraper's scheduled run does. */
function landRea(month) {
  const acc = PUBLISHED[month];
  db.prepare(`
    INSERT INTO energy_data (id, contract_id, period_month, data_type, source, energy_mwh, availability_percent, free_energy_mwh, status)
    VALUES (?, ?, ?, 'PROVISIONAL', 'REA', ?, ?, ?, 'VALIDATED')
  `).run(newId('ENG'), njhps.id, month, acc.energy_mwh, acc.availability_percent, acc.free_energy_mwh);
}

const draft = (opts = {}) => runReaAutoDraft({ now: NOW, ...opts });
const bills = () => db.prepare(`
  SELECT * FROM hydro_station_bills WHERE contract_id = ? AND status <> 'CANCELLED' ORDER BY billing_month
`).all(njhps.id);
const autoNotes = () => db.prepare(`SELECT * FROM notifications WHERE type = 'HYDRO_BILL_AUTO_DRAFT' ORDER BY rowid`).all();
const runs = () => db.prepare('SELECT * FROM hydro_auto_draft_runs ORDER BY rowid').all();
const status = (role = 'REIA_USER') => request(app).get('/api/hydro-billing/from-rea/auto').set(auth(tokenFor(role)));

beforeAll(() => {
  snapshot = TOUCHED.map((no) => db.prepare('SELECT * FROM contracts WHERE contract_no = ?').get(no)).filter(Boolean);
});

afterAll(() => {
  clean();
  setParam('hydro_rea_auto_draft', 'true');
  const stmt = db.prepare(`UPDATE contracts SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`);
  for (const row of snapshot) stmt.run(...COLS.map((c) => row[c]), row.id);
});

beforeEach(() => {
  calls.length = 0;
  clean();
  setParam('hydro_rea_auto_draft', 'true');
  seedNjhpsAllocations();
  njhps = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
  db.prepare(`
    UPDATE contracts SET annual_afc = 14615741000, annual_design_energy_mwh = 6612000, normative_aux = 1.2,
      free_energy_home_state = 12, napaf_percent = 87, capacity_mw = 1500, status = 'ACTIVE'
    WHERE id = ?
  `).run(njhps.id);
});

describe('runReaAutoDraft', () => {
  it('drafts every month whose account has landed, oldest first, and tells the desk', async () => {
    for (const m of ['2026-04', '2026-05', '2026-06']) landRea(m);

    const r = await draft({ lookbackMonths: 3 });
    expect(r.skipped).toBeUndefined();
    expect(r.from_month).toBe('2026-04');
    expect(r.to_month).toBe('2026-06');
    expect(r.created).toHaveLength(3);

    const saved = bills();
    expect(saved.map((b) => b.billing_month)).toEqual(['2026-04', '2026-05', '2026-06']);
    // Drafted, not issued: the point of the whole thing is that a person still
    // reviews it.
    expect(saved.every((b) => b.status === 'DRAFT')).toBe(true);
    expect(saved.every((b) => b.bill_kind === 'PROVISIONAL')).toBe(true);
    // The cumulative is carried, which is what running oldest first buys.
    expect(saved[2].e4_cum_scheduled_kwh).toBe(1445627500);

    const note = autoNotes();
    expect(note[0].role).toBe('REIA_USER');
    expect(note[0].message).toContain(saved[0].bill_no);
    // Rampur has no line in this account, so it is named once — not once a
    // month for as long as the run keeps reaching back over it.
    expect(note[1].message).toMatch(/PPA\/SJVN\/RHPS\/001/);
    expect(note[1].message.match(/RHPS/g)).toHaveLength(1);
    expect(note).toHaveLength(2);
  });

  it('records the bills as the platform\'s work, not the last person to sign in', async () => {
    landRea('2026-04');
    await draft({ lookbackMonths: 3 });
    const bill = bills()[0];
    expect(bill.prepared_by).toBe('REA auto-draft');
    expect(bill.created_by).toBeNull();
    const audit = db.prepare(`
      SELECT * FROM audit_logs WHERE action = 'HYDRO_BILLS_FROM_REA' ORDER BY rowid DESC LIMIT 1
    `).get();
    expect(audit.user_name).toBe('REA auto-draft');
  });

  it('does nothing, and fetches nothing, once every landed month is billed', async () => {
    landRea('2026-04');
    await draft({ lookbackMonths: 3 });
    calls.length = 0;

    const again = await draft({ lookbackMonths: 3 });
    expect(again.skipped).toMatch(/unbilled account/);
    // The scraper was never asked for a PDF — the sweep costs one query on the
    // days the RPC has published nothing new.
    expect(calls).toEqual([]);
    expect(bills()).toHaveLength(1);
  });

  it('leaves a month outside the window alone', async () => {
    landRea('2026-04');
    // A one-month window from 20 July reaches back to June only.
    const r = await draft({ lookbackMonths: 1 });
    expect(r.skipped).toMatch(/unbilled account/);
    expect(bills()).toEqual([]);
  });

  it('will not start a second run over the same months', async () => {
    for (const m of ['2026-04', '2026-05']) landRea(m);
    const first = draft({ lookbackMonths: 3 });
    const second = await draft({ lookbackMonths: 3 });
    expect(second.skipped).toMatch(/already in progress/);
    const r = await first;
    expect(r.created).toHaveLength(2);
  });

  it('is off when the desk switches it off', async () => {
    landRea('2026-04');
    setParam('hydro_rea_auto_draft', 'false');
    const r = await draft({ lookbackMonths: 3 });
    expect(r.skipped).toMatch(/switched off/);
    expect(bills()).toEqual([]);
  });

  it('says so when an account landed and the bill still could not be drafted', async () => {
    landRea('2026-05'); // April is missing, so May's cumulative would be wrong.
    const r = await draft({ lookbackMonths: 3 });
    expect(r.created).toEqual([]);
    expect(bills()).toEqual([]);
    expect(r.blocked.map((b) => b.contract_no)).toContain('PPA/SJVN/NJHPS/001');
    expect(r.blocked[0].reason).toMatch(/2026-04/);
    // Silence would read as "the bills are drafted", which is the one thing it
    // must not mean.
    const note = autoNotes();
    expect(note).toHaveLength(1);
    expect(note[0].role).toBe('REIA_USER');
    expect(note[0].message).toMatch(/unbilled/);
    expect(note[0].message).toMatch(/2026-05 PPA\/SJVN\/NJHPS\/001/);
  });

  it('does not repeat the same blockage every morning', async () => {
    landRea('2026-05');
    await draft({ lookbackMonths: 3 });
    await draft({ lookbackMonths: 3 });
    await draft({ lookbackMonths: 3 });
    expect(autoNotes()).toHaveLength(1);
  });
});

// A desk that arrives to an empty bills list has to be able to tell a sweep
// that ran and found nothing from a sweep that never ran — so every sweep is
// written down, including the ones that did nothing.
describe('the record of the sweeps', () => {
  it('writes a row for a run that drafted, naming the bills', async () => {
    landRea('2026-04');
    await draft({ lookbackMonths: 3 });
    const [row] = runs();
    expect(row.outcome).toBe('DRAFTED');
    expect(row.from_month).toBe('2026-04');
    expect(row.bills_created).toBe(1);
    expect(row.bill_nos).toBe(bills()[0].bill_no);
    expect(row.finished_at).toBeTruthy();
  });

  it('writes a row for a quiet morning too', async () => {
    const r = await draft({ lookbackMonths: 3 });
    expect(r.skipped).toBeTruthy();
    expect(runs().map((x) => x.outcome)).toEqual(['NOTHING_TO_DO']);
  });

  it('writes a row saying it is switched off', async () => {
    setParam('hydro_rea_auto_draft', 'false');
    await draft({ lookbackMonths: 3 });
    expect(runs()[0].outcome).toBe('OFF');
  });

  it('keeps what a blocked run left, so the page can name it', async () => {
    landRea('2026-05');
    await draft({ lookbackMonths: 3 });
    const [row] = runs();
    expect(row.outcome).toBe('BLOCKED');
    expect(row.bills_created).toBe(0);
    expect(JSON.parse(row.blocked)[0]).toMatchObject({ month: '2026-05', contract_no: 'PPA/SJVN/NJHPS/001' });
  });

  it('does not record a sweep that stood aside for a run already going', async () => {
    landRea('2026-04');
    const first = draft({ lookbackMonths: 3 });
    const second = await draft({ lookbackMonths: 3 });
    expect(second.skipped).toMatch(/already in progress/);
    await first;
    expect(runs()).toHaveLength(1);
  });
});

describe('GET /hydro-billing/from-rea/auto', () => {
  it('answers with the switch, the last sweep and the ones before it', async () => {
    landRea('2026-04');
    await draft({ lookbackMonths: 3 });
    const res = await status();
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.running).toBe(false);
    expect(res.body.last.outcome).toBe('DRAFTED');
    expect(res.body.last.bill_nos).toEqual([bills()[0].bill_no]);
    // Drafted one and left one: Rampur has no line in this account, and the
    // page has to be able to say so rather than just showing the one bill.
    expect(res.body.last.blocked).toEqual([
      { month: '2026-04', contract_no: 'PPA/SJVN/RHPS/001', reason: 'station not found in the PROVISIONAL REA' },
    ]);
    expect(res.body.recent).toHaveLength(1);
  });

  it('says plainly that nothing has run yet', async () => {
    const res = await status();
    expect(res.body.last).toBeNull();
    expect(res.body.recent).toEqual([]);
  });

  it('reports the switch being off without needing a sweep to have run', async () => {
    setParam('hydro_rea_auto_draft', 'false');
    expect((await status()).body.enabled).toBe(false);
  });

  it('is open to the desk roles that read the bills list', async () => {
    expect((await status('MANAGEMENT')).status).toBe(200);
  });
});
