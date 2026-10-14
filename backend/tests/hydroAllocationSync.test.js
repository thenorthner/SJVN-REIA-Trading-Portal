import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileURLToPath } from 'url';

// What NRPC's Provisional REA for September 2026 says about the two stations —
// Table C1 (entitlement, %) and Table D2 (energy scheduled, LU) — exactly as
// parse_rea.py returns them. The parser needs python and pypdf, which a test
// machine need not have, so its output stands in for it here.
const SEPTEMBER = {
  success: true,
  mode: 'rea',
  period: '2026-09',
  data: [
    {
      station_id: 'NATHPA_JHAKRI',
      entitlement_pct: {
        CHANDIGARH: 1.716292, DELHI: 11.164703, 'HIMACHAL PRADESH': 36.47, HARYANA: 5.752865,
        'JAMMU AND KASHMIR': 7.423675, 'MADHYA PRADESH': 0.171351, PUNJAB: 12.206011,
        RAJASTHAN: 10.365103, 'UTTAR PRADESH': 14.73,
      },
      scheduled_lu: {
        CHANDIGARH: 150.66995, DELHI: 980.033575, 'GOHP NJHEP': 1053.3641, HARYANA: 504.990475,
        'HIMACHAL PRADESH': 2148.003175, 'JAMMU AND KASHMIR': 651.6415, 'MADHYA PRADESH': 15.0498,
        PUNJAB: 1071.437625, RAJASTHAN: 909.859125, 'UTTAR PRADESH': 1293.013175,
      },
    },
    {
      station_id: 'RAMPUR',
      entitlement_pct: {
        CHANDIGARH: 1.091914, DELHI: 1.559877, 'HIMACHAL PRADESH': 41.91, HARYANA: 5.514893,
        'JAMMU AND KASHMIR': 7.509969, 'MADHYA PRADESH': 0.157719, PUNJAB: 7.53085,
        RAJASTHAN: 10.384778, UTTARAKHAND: 10.58, 'UTTAR PRADESH': 13.76,
      },
      scheduled_lu: {
        CHANDIGARH: 26.3665, DELHI: 37.64395, 'GOHP RAMPUR': 313.83745, HARYANA: 133.14625,
        'HIMACHAL PRADESH': 697.9208, 'JAMMU AND KASHMIR': 181.291725, 'MADHYA PRADESH': 3.81885,
        PUNJAB: 181.79135, RAJASTHAN: 250.717175, 'UTTAR PRADESH': 332.16375, UTTARAKHAND: 255.426975,
      },
    },
  ],
};
// Delhi SLDC's State Energy Account, Annexure-2 table C, Nathpa Jhakri row.
const SEA_NJHPS = { total: 11.164703, BRPL: 5.853903, BYPL: 2.4054, TPDDL: 2.9054, NDMC: 0, MES: 0 };

const parser = vi.hoisted(() => ({ out: null }));
vi.mock('../src/services/reaScraper.js', () => ({
  reaScraper: { parsePdf: async () => parser.out },
}));

const { default: db } = await import('../src/db/index.js');
const { newId } = await import('../src/util.js');
const { seedNjhpsAllocations } = await import('../src/services/hydroStationBill.js');
const {
  buildMonthSheet, checkAgainstSchedule, describeChanges, parseShares, stateTotals,
  syncAllocationFromRea, confirmProvisionalDelhiSplits, forgetParsedAccounts,
} = await import('../src/services/hydroAllocationSync.js');
const { pickSeaForMonth } = await import('../src/services/delhiSldcSea.js');

const SHARES = parseShares('AJMER VVNL:27.09,JAIPUR VVNL:38.22,JODHPUR VVNL:34.69');
const contractOf = (no) => db.prepare(`
  SELECT c.*, e.name AS seller_name FROM contracts c LEFT JOIN entities e ON c.seller_id = e.id WHERE c.contract_no = ?
`).get(no);
const sheet = (contractId, from) => db.prepare(`
  SELECT * FROM hydro_beneficiary_allocations WHERE contract_id = ? AND effective_from = ? ORDER BY sr_no
`).all(contractId, from);
const pct = (rows, name) => rows.find((r) => r.beneficiary_name === name)?.pct_rea;

let njhps;
let rhps;
let april;
let aprilRhps;

beforeEach(() => {
  db.prepare('DELETE FROM hydro_bill_lines').run();
  db.prepare('DELETE FROM hydro_station_bills').run();
  db.prepare('DELETE FROM hydro_beneficiary_allocations').run();
  db.prepare(`DELETE FROM rea_fetch_log WHERE rpc_source = 'NRPC'`).run();
  seedNjhpsAllocations();
  njhps = contractOf('PPA/SJVN/NJHPS/001');
  rhps = contractOf('PPA/SJVN/RHPS/001');
  april = sheet(njhps.id, '2026-04-01');
  aprilRhps = sheet(rhps.id, '2026-04-01');
  parser.out = SEPTEMBER;
  forgetParsedAccounts();
  // The sync re-reads the account the bill run fetched; any file that exists
  // will do, since the parser is stood in for.
  db.prepare(`
    INSERT INTO rea_fetch_log (id, rpc_source, period_month, data_type, pdf_url, local_file_path, status)
    VALUES (?, 'NRPC', '2026-09', 'PROVISIONAL', 'https://nrpc.gov.in/allfile/x.pdf', ?, 'PROCESSED')
  `).run(newId('REA'), fileURLToPath(import.meta.url));
});

describe('the month\'s sheet, derived from Table C1', () => {
  it('moves Uttarakhand\'s share of Nathpa Jhakri to Punjab, as September 2026 did', () => {
    const { rows, problems } = buildMonthSheet({
      prevRows: april, entitlement: SEPTEMBER.data[0].entitlement_pct, delhiSea: SEA_NJHPS, rajasthanShares: SHARES,
    });
    expect(problems).toEqual([]);
    expect(pct(rows, 'UTTARAKHAND')).toBeUndefined();
    expect(pct(rows, 'PUNJAB')).toBe(12.206011);
    expect(rows).toHaveLength(14);
    expect(Math.round(rows.reduce((a, r) => a + r.pct_rea, 0) * 1e6)).toBe(100000000);
  });

  it('divides Delhi as Delhi SLDC\'s account does — fixed shares for TPDDL and BYPL, the balance to BRPL', () => {
    const { rows, provisional } = buildMonthSheet({
      prevRows: april, entitlement: SEPTEMBER.data[0].entitlement_pct, delhiSea: SEA_NJHPS, rajasthanShares: SHARES,
    });
    expect(provisional).toBe(false);
    expect(pct(rows, 'TPDDL')).toBe(2.9054);
    expect(pct(rows, 'BSES YAMUNA POWER')).toBe(2.4054);
    expect(pct(rows, 'BSES RAJDHANI POWER')).toBe(5.853903);
  });

  it('carries the fixed Delhi shares and marks the split provisional while the account is not out', () => {
    const { rows, provisional } = buildMonthSheet({
      prevRows: april, entitlement: SEPTEMBER.data[0].entitlement_pct, delhiSea: null, rajasthanShares: SHARES,
    });
    expect(provisional).toBe(true);
    // Not scaled in proportion (which gives 2.906047 / 5.852720 / 2.405936).
    expect([pct(rows, 'TPDDL'), pct(rows, 'BSES RAJDHANI POWER'), pct(rows, 'BSES YAMUNA POWER')])
      .toEqual([2.9054, 5.853903, 2.4054]);
  });

  it('does not use a Delhi account whose total is not the REA\'s', () => {
    const { provisional, notes } = buildMonthSheet({
      prevRows: april,
      entitlement: SEPTEMBER.data[0].entitlement_pct,
      delhiSea: { ...SEA_NJHPS, total: 11.162216, BRPL: 5.851416 },
      rajasthanShares: SHARES,
    });
    expect(provisional).toBe(true);
    expect(notes.join(' ')).toMatch(/11\.162216% of the station against the REA's 11\.164703%/);
  });

  it('divides Rajasthan on the state\'s discom shares, the rounding on the largest', () => {
    const { rows } = buildMonthSheet({
      prevRows: april, entitlement: SEPTEMBER.data[0].entitlement_pct, delhiSea: SEA_NJHPS, rajasthanShares: SHARES,
    });
    expect([pct(rows, 'AJMER VVNL'), pct(rows, 'JAIPUR VVNL'), pct(rows, 'JODHPUR VVNL')])
      .toEqual([2.807906, 3.961543, 3.595654]);
  });

  it('reproduces the sheets SJVN billed on when given the totals they were made from', () => {
    // The rule has to give back the figures on the station's own sheets, to the
    // sixth decimal, or it is not the rule.
    for (const rows of [april, aprilRhps]) {
      const built = buildMonthSheet({ prevRows: rows, entitlement: stateTotals(rows), delhiSea: null, rajasthanShares: SHARES });
      expect(built.problems).toEqual([]);
      expect(describeChanges(rows, built.rows)).toEqual([]);
    }
  });

  it('holds the home state at its free and equity power and gives the rest of the state\'s share to HPSEBL', () => {
    const { rows } = buildMonthSheet({
      prevRows: april, entitlement: SEPTEMBER.data[0].entitlement_pct, delhiSea: SEA_NJHPS, rajasthanShares: SHARES,
    });
    const gohp = rows.find((r) => r.beneficiary_name === 'GoHP');
    expect(gohp).toMatchObject({ pct_rea: 34, pct_incl_free: 36.47, is_home_state: 1 });
    expect(pct(rows, 'HPSEB')).toBe(2.47);

    // A month in which Himachal Pradesh's entitlement moves: GoHP's 12% free
    // and 22% equity stay, and HPSEBL takes the difference.
    const e = SEPTEMBER.data[0].entitlement_pct;
    const moved = buildMonthSheet({
      prevRows: april,
      entitlement: { ...e, 'HIMACHAL PRADESH': 37.47, PUNJAB: 11.206011 },
      delhiSea: SEA_NJHPS,
      rajasthanShares: SHARES,
    });
    expect(moved.problems).toEqual([]);
    expect(pct(moved.rows, 'GoHP')).toBe(34);
    expect(pct(moved.rows, 'HPSEB')).toBe(3.47);
  });

  it('refuses a share nobody on the sheet can be billed for', () => {
    const { problems } = buildMonthSheet({
      prevRows: april,
      entitlement: { ...SEPTEMBER.data[0].entitlement_pct, PUNJAB: 11.206011, 'SURRENDERED POWER': 1 },
      delhiSea: SEA_NJHPS,
      rajasthanShares: SHARES,
    });
    expect(problems.join(' ')).toMatch(/SURRENDERED POWER/);
  });
});

describe('Table C1 against Table D2', () => {
  it('passes the published account', () => {
    for (const s of SEPTEMBER.data) expect(checkAgainstSchedule(s.entitlement_pct, s.scheduled_lu)).toEqual([]);
  });

  it('catches figures read one column along', () => {
    const e = SEPTEMBER.data[0].entitlement_pct;
    const shifted = { ...e, PUNJAB: e.RAJASTHAN, RAJASTHAN: e.PUNJAB };
    expect(checkAgainstSchedule(shifted, SEPTEMBER.data[0].scheduled_lu).join(' ')).toMatch(/PUNJAB.*RAJASTHAN/);
  });
});

describe('Delhi SLDC\'s listing', () => {
  it('takes the newest provisional account for the month, amendments included, and nothing else', () => {
    const rows = [
      { EA_ID: '1', EA_FILENAME: '17-Sep-2026_REA August 2026 (Amended).pdf', EA_DURATION: '2026-09-16T18:30:00.000Z', EA_FOR: 'Provisional State Energy Account for August 2026 (Amended)', EA_MONTH: 'August 2026' },
      { EA_ID: '2', EA_FILENAME: '10-Sep-2026_Final ISOA SEA.pdf', EA_DURATION: '2026-09-09T18:30:00.000Z', EA_FOR: 'ISOA State Energy Account for August-2026', EA_MONTH: 'August 2026' },
      { EA_ID: '3', EA_FILENAME: '03-Sep-2026_REA August 2026.pdf', EA_DURATION: '2026-09-02T18:30:00.000Z', EA_FOR: 'Provisional State Energy Account for August 2026', EA_MONTH: 'August 2026' },
    ];
    expect(pickSeaForMonth(rows, '2026-08').EA_ID).toBe('1');
    expect(pickSeaForMonth(rows, '2026-09')).toBeNull();
  });
});

describe('bringing a station\'s sheet into line with the REA', () => {
  const noSea = async () => null;
  const withSea = async () => ({ month: '2026-09', title: 'Provisional State Energy Account for September 2026', stations: { NATHPA_JHAKRI: SEA_NJHPS } });

  it('puts September\'s sheet in force and closes April\'s the day before', async () => {
    const r = await syncAllocationFromRea(njhps, '2026-09', { fetchDelhiSea: withSea });
    expect(r.status).toBe('WRITTEN');
    expect(r.provisional).toBe(false);
    expect(r.changes.join(' ')).toMatch(/PUNJAB 11\.356856 → 12\.206011/);
    expect(r.changes.join(' ')).toMatch(/UTTARAKHAND dropped/);

    const september = sheet(njhps.id, '2026-09-01');
    expect(september).toHaveLength(14);
    expect(september[0].source_note).toMatch(/^AUTO: NRPC Provisional REA 2026-09, Table C1; Delhi split per Delhi SLDC/);
    expect(sheet(njhps.id, '2026-04-01').every((x) => x.effective_to === '2026-08-31')).toBe(true);
  });

  it('leaves a station whose sheet already says what the account says', async () => {
    const r = await syncAllocationFromRea(rhps, '2026-09', { fetchDelhiSea: noSea });
    expect(r.status).toBe('UNCHANGED');
    expect(sheet(rhps.id, '2026-09-01')).toHaveLength(0);
    expect(sheet(rhps.id, '2026-04-01').every((x) => x.effective_to == null)).toBe(true);
  });

  it('never replaces a sheet the desk entered for the month, and says where it disagrees', async () => {
    db.prepare(`UPDATE hydro_beneficiary_allocations SET effective_from = '2026-09-01' WHERE contract_id = ?`).run(njhps.id);
    const r = await syncAllocationFromRea(njhps, '2026-09', { fetchDelhiSea: noSea });
    expect(r.status).toBe('DESK_SHEET');
    expect(r.warnings.join(' ')).toMatch(/UTTARAKHAND: sheet 0\.846108%, NRPC Provisional REA 2026-09, Table C1 0\.000000%/);
    expect(pct(sheet(njhps.id, '2026-09-01'), 'PUNJAB')).toBe(11.356856);
  });

  it('refuses an account whose entitlements do not sit with the energy scheduled', async () => {
    const e = SEPTEMBER.data[0].entitlement_pct;
    parser.out = { ...SEPTEMBER, data: [{ ...SEPTEMBER.data[0], entitlement_pct: { ...e, PUNJAB: e.RAJASTHAN, RAJASTHAN: e.PUNJAB } }] };
    forgetParsedAccounts();
    const r = await syncAllocationFromRea(njhps, '2026-09', { fetchDelhiSea: noSea });
    expect(r.status).toBe('REFUSED');
    expect(sheet(njhps.id, '2026-09-01')).toHaveLength(0);
  });

  it('stands aside when there is no account on file, as before', async () => {
    const r = await syncAllocationFromRea(njhps, '2026-10', { fetchDelhiSea: noSea });
    expect(r.status).toBe('NO_ACCOUNT');
  });

  it('confirms a carried Delhi split once Delhi SLDC publishes the same figures', async () => {
    const first = await syncAllocationFromRea(njhps, '2026-09', { fetchDelhiSea: noSea });
    expect(first).toMatchObject({ status: 'WRITTEN', provisional: true });
    expect(sheet(njhps.id, '2026-09-01')[0].source_note).toMatch(/Delhi split provisional/);

    expect(await confirmProvisionalDelhiSplits({ fetchDelhiSea: noSea })).toEqual([
      { contract_no: 'PPA/SJVN/NJHPS/001', month: '2026-09', status: 'WAITING' },
    ]);
    const settled = await confirmProvisionalDelhiSplits({ fetchDelhiSea: withSea });
    expect(settled).toEqual([{ contract_no: 'PPA/SJVN/NJHPS/001', month: '2026-09', status: 'CONFIRMED' }]);
    expect(sheet(njhps.id, '2026-09-01')[0].source_note).not.toMatch(/provisional/);
    expect(await confirmProvisionalDelhiSplits({ fetchDelhiSea: withSea })).toEqual([]);
  });

  it('corrects a carried Delhi split that Delhi SLDC publishes differently', async () => {
    await syncAllocationFromRea(njhps, '2026-09', { fetchDelhiSea: noSea });
    const moved = async () => ({
      month: '2026-09',
      title: 'Provisional State Energy Account for September 2026',
      stations: { NATHPA_JHAKRI: { total: 11.164703, BRPL: 5.753903, BYPL: 2.5054, TPDDL: 2.9054, NDMC: 0, MES: 0 } },
    });
    const [r] = await confirmProvisionalDelhiSplits({ fetchDelhiSea: moved });
    expect(r.status).toBe('CORRECTED');
    expect(r.changes).toEqual(['BSES RAJDHANI POWER 5.853903 → 5.753903', 'BSES YAMUNA POWER 2.405400 → 2.505400']);
    expect(pct(sheet(njhps.id, '2026-09-01'), 'BSES YAMUNA POWER')).toBe(2.5054);
  });
});
