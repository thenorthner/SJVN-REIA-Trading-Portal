import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';

// The "September 2026" NRPC REA imported on 16 Oct 2026 was August's account
// with its page headers relabelled. The importer took the most-named month,
// filed August's energy as September's and auto-validated it: NJHPS
// 1,154,794.15 MWh / 106.452 % and RHPS 317,031.53 MWh / 109.963 % in both
// months, to the decimal. These tests hold the two checks that stop it:
// the account's own month must be the month it is filed under, and a month
// whose energy equals the month beside it is held, not validated.

// parsePdf shells out to python; the parser's output is stood in for here so
// the route can be tested without python or a PDF.
const script = vi.hoisted(() => ({ stdout: '' }));
vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    exec: (cmd, opts, cb) => {
      const done = typeof opts === 'function' ? opts : cb;
      done(null, /import pypdf/.test(cmd) ? '' : script.stdout, '');
    },
  };
});

const { checkAccountPeriod, isHeldAsSameAsAdjacent, shiftMonth } = await import('../src/services/reaMonthChecks.js');
const { reaScraper } = await import('../src/services/reaScraper.js');
const { app } = await import('../src/server.js');
const { default: db } = await import('../src/db/index.js');
const { tokenFor, auth } = await import('./helpers/reia.js');

const NJHPS_AUG = { station_id: 'NATHPA_JHAKRI', station_name: 'Nathpa Jhakri HEP', energy_mwh: 1154794.15, availability_percent: 106.452, free_energy_mwh: 138574.95 };

describe('checkAccountPeriod — the account\'s own month decides where it is filed', () => {
  it('passes an account filed under the month it names', () => {
    expect(checkAccountPeriod({ period: '2026-08', period_conflict: null }, '2026-08')).toBe('2026-08');
  });

  it('refuses an account filed under another month', () => {
    expect(() => checkAccountPeriod({ period: '2026-08' }, '2026-09')).toThrow(/is for 2026-08, not 2026-09/);
  });

  it('refuses an account that names no month, rather than trusting the request', () => {
    expect(() => checkAccountPeriod({ period: null }, '2026-09')).toThrow(/does not say which month/);
    expect(() => checkAccountPeriod({}, '2026-09')).toThrow(/does not say which month/);
  });

  it('refuses an account whose titles say another month than its headers — the relabelled September', () => {
    // What parse_rea.py reports for the relabelled file.
    const parsed = { period: '2026-09', periods_named: ['2026-09', '2026-08'], period_conflict: ['2026-08'] };
    expect(() => checkAccountPeriod(parsed, '2026-09')).toThrow(/headers say 2026-09 but its own titles say 2026-08/);
  });

  it('does not refuse a genuine account carrying one stray month beside its own (NRPC cover-letter typo)', () => {
    // May 2026's cover letter says "REA for the month of April, 2026".
    expect(checkAccountPeriod({ period: '2026-05', periods_named: ['2026-05', '2026-04'], period_conflict: null }, '2026-05')).toBe('2026-05');
  });

  it('shifts months across a year end', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});

// The parser itself, on text shaped like the real accounts. Needs python3 with
// pypdf (the module imports it); skipped where that is not installed.
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/scripts');
let pythonOk = false;
try { execFileSync('python3', ['-c', 'import pypdf'], { stdio: 'ignore' }); pythonOk = true; } catch { /* no python */ }

function parserOn(text) {
  const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(SCRIPTS)}); import parse_rea as p
t = sys.stdin.read(); print(json.dumps({'period': p.account_period(t), 'conflict': p.account_period_conflict(t)}))`;
  return JSON.parse(execFileSync('python3', ['-c', code], { input: text }).toString());
}

const header = (m) => `Provisional REA for the Month of ${m}, 2026\n`;

describe.skipIf(!pythonOk)('parse_rea.py — month the account names', () => {
  it('reads a genuine account as its own month, with no conflict', () => {
    const text = 'Subject: ABT based Provisional REA for the month of August, 2026.\n'
      + header('AUGUST').repeat(40) + 'Provisional REA for the month of August 2026\n'.repeat(4);
    expect(parserOn(text)).toEqual({ period: '2026-08', conflict: null });
  });

  it('flags August\'s account with SEPTEMBER headers pasted in', () => {
    // The relabelled file: 478 SEPTEMBER headers, four titles still August, no cover letter.
    const text = header('SEPTEMBER').repeat(40) + 'Provisional REA for the month of August 2026\n'.repeat(4);
    expect(parserOn(text)).toEqual({ period: '2026-09', conflict: ['2026-08'] });
  });

  it('lets a cover-letter typo through when the titles also name the right month', () => {
    const text = 'Subject: ABT based Provisional REA for the month of May, 2026.\n'
      + 'ABT based Provisional REA for the month of April, 2026 prepared in accordance with CERC\n'
      + header('MAY').repeat(40) + 'Provisional REA for the month of May 2026\n';
    expect(parserOn(text)).toEqual({ period: '2026-05', conflict: null });
  });
});

describe('processAndSave — a month identical to the month beside it is held', () => {
  let contract;
  let snapshot;

  beforeAll(() => {
    contract = db.prepare(`SELECT * FROM contracts WHERE contract_no = 'PPA/SJVN/NJHPS/001'`).get();
    snapshot = { status: contract.status, tenure_start: contract.tenure_start, tenure_end: contract.tenure_end };
    db.prepare(`UPDATE contracts SET status = 'ACTIVE', tenure_start = '2020-01-01', tenure_end = '2060-12-31' WHERE id = ?`).run(contract.id);
  });
  afterAll(() => {
    db.prepare(`DELETE FROM energy_data WHERE source = 'REA' AND contract_id = ?`).run(contract.id);
    db.prepare(`UPDATE contracts SET status = ?, tenure_start = ?, tenure_end = ? WHERE id = ?`)
      .run(snapshot.status, snapshot.tenure_start, snapshot.tenure_end, contract.id);
  });
  beforeEach(() => {
    db.prepare(`DELETE FROM energy_data WHERE source = 'REA' AND contract_id = ?`).run(contract.id);
  });

  const save = (period, station) => reaScraper.processAndSave('LOG-TEST', [station], 'NRPC', period, 'PROVISIONAL');
  const row = (period) => db.prepare(`
    SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ? AND source = 'REA'
  `).get(contract.id, period);

  it('holds September as DISPUTED when its energy equals August\'s to the decimal', () => {
    const aug = save('2026-08', NJHPS_AUG);
    expect(aug.records[0].contract_id).toBe(contract.id);
    expect(isHeldAsSameAsAdjacent(row('2026-08'))).toBe(false);

    const sep = save('2026-09', NJHPS_AUG);
    const held = row('2026-09');
    expect(held.status).toBe('DISPUTED');
    expect(held.deviation_notes).toMatch(/identical to the 2026-08 PROVISIONAL REA/);
    expect(isHeldAsSameAsAdjacent(held)).toBe(true);
    expect(sep.records[0]).toMatchObject({ status: 'DISPUTED', same_as_month: '2026-08' });
  });

  it('also holds a month imported after the month that follows it', () => {
    save('2026-08', NJHPS_AUG);
    save('2026-07', NJHPS_AUG);
    expect(isHeldAsSameAsAdjacent(row('2026-07'))).toBe(true);
  });

  it('does not hold a month whose energy differs, however slightly', () => {
    save('2026-08', NJHPS_AUG);
    save('2026-09', { ...NJHPS_AUG, energy_mwh: NJHPS_AUG.energy_mwh + 0.01 });
    const sep = row('2026-09');
    expect(isHeldAsSameAsAdjacent(sep)).toBe(false);
    expect(sep.deviation_notes).toMatch(/Auto-validated by REA Scraper/);
  });

  it('does not compare with a month two away', () => {
    save('2026-07', NJHPS_AUG);
    save('2026-09', NJHPS_AUG);
    expect(isHeldAsSameAsAdjacent(row('2026-09'))).toBe(false);
  });
});

describe('POST /hydro-billing/upload-rea — the month comes from the account', () => {
  let token;
  beforeEach(() => { token = tokenFor('COMMERCIAL_ADMIN'); });

  const upload = (fields = {}, name = 'REA.pdf') => {
    let r = request(app).post('/api/hydro-billing/upload-rea').set(auth(token));
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', Buffer.from('%PDF-1.4 stand-in'), name);
  };
  const stored = (period) => db.prepare(`SELECT COUNT(*) c FROM energy_data WHERE period_month = ? AND source = 'REA'`).get(period).c
    + db.prepare(`SELECT COUNT(*) c FROM rea_fetch_log WHERE period_month = ?`).get(period).c;

  it('refuses the relabelled account and stores nothing', async () => {
    script.stdout = JSON.stringify({ success: true, mode: 'rea', period: '2026-09', periods_named: ['2026-09', '2026-08'], period_conflict: ['2026-08'], data: [NJHPS_AUG] });
    const before = stored('2026-09');
    const r = await upload();
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/titles say 2026-08/);
    expect(stored('2026-09')).toBe(before);
  });

  it('refuses an account whose month differs from the month asked for', async () => {
    script.stdout = JSON.stringify({ success: true, mode: 'rea', period: '2026-08', period_conflict: null, data: [NJHPS_AUG] });
    const r = await upload({ period_month: '2026-09' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/is for 2026-08, not 2026-09/);
  });

  it('refuses an account whose month differs from the NRPC file name', async () => {
    script.stdout = JSON.stringify({ success: true, mode: 'rea', period: '2026-08', period_conflict: null, data: [NJHPS_AUG] });
    const r = await upload({}, '011020261130REA0926_P.pdf');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/is for 2026-08, not 2026-09/);
  });

  it('does not fall back to the month asked for when the account names none', async () => {
    script.stdout = JSON.stringify({ success: true, mode: 'rea', period: null, data: [NJHPS_AUG] });
    const before = stored('2026-09');
    const r = await upload({ period_month: '2026-09' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Could not identify the month from the REA PDF itself/);
    expect(stored('2026-09')).toBe(before);
  });
});
