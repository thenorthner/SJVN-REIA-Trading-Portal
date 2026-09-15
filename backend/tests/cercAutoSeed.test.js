import { describe, it, expect, beforeEach } from 'vitest';
import db from '../src/db/index.js';
import { cercScraper } from '../src/services/cercScraper.js';

const { autoSeedDecision } = cercScraper;

function logAttempt(period, hoursAgo) {
  const when = new Date(Date.now() - hoursAgo * 36e5).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(`INSERT INTO cerc_fetch_log (id, report_period, report_year, report_month, status, fetched_at)
              VALUES (?, ?, 2024, 4, 'FAILED', ?)`).run(`LOG-${period}-${hoursAgo}-${Math.random()}`, period, when);
}

beforeEach(() => {
  db.prepare('DELETE FROM cerc_fetch_log').run();
  db.prepare('DELETE FROM cerc_monthly_summary').run();
});

describe('autoSeedDecision', () => {
  it('seeds a period never attempted before', () => {
    expect(autoSeedDecision('2024-04').seed).toBe(true);
  });

  it('skips a period already seeded', () => {
    db.prepare(`INSERT INTO cerc_monthly_summary (id, report_period) VALUES ('CMS-1', '2024-04')`).run();
    const d = autoSeedDecision('2024-04');
    expect(d.seed).toBe(false);
    expect(d.reason).toBe('already seeded');
  });

  it('keeps retrying while attempts are few', () => {
    logAttempt('2024-04', 1);
    logAttempt('2024-04', 2);
    expect(autoSeedDecision('2024-04').seed).toBe(true);
  });

  // Without this a month whose report simply lacks the tables this parser needs
  // would reach for the network on every single boot, forever.
  it('backs off once a period has failed repeatedly', () => {
    for (const h of [1, 2, 3]) logAttempt('2024-04', h);
    const d = autoSeedDecision('2024-04');
    expect(d.seed).toBe(false);
    expect(d.reason).toMatch(/failed attempt/);
  });

  it('retries again once the cooldown has passed', () => {
    for (const h of [200, 201, 202]) logAttempt('2024-04', h);   // over a week ago
    expect(autoSeedDecision('2024-04').seed).toBe(true);
  });

  it('keeps periods independent of each other', () => {
    for (const h of [1, 2, 3]) logAttempt('2024-04', h);
    expect(autoSeedDecision('2024-04').seed).toBe(false);
    expect(autoSeedDecision('2024-05').seed).toBe(true);
  });
});

describe('Table-1 volumes', () => {
  const { parseVolumeTable, repairLocalVolumes } = cercScraper;
  const T1 = [
    ['Table-1: VOLUME OF SHORT-TERM TRANSACTIONS OF ELECTRICITY AND DSM (ALL INDIA), AUGUST 2024'],
    ['Sr.No', 'Transaction', 'Volume  (MU)'],
    ['A', 'Short-term transactions'],
    [1, 'Bilateral* (Traders, PX, Direct)', 11534.3],
    [2, 'Through Power Exchanges', 9054.8],
    [null, '(i) IEX'],
    [null, '(a) DAM', 4712],
    [null, '(b) RTM', 3484.9],
    [null, '(c) GDAM', 851.5],
    [null, '(d) HP-DAM', 0],
    [null, '(ii)PXIL'],
    [null, '(a) DAM', 0],
    [null, '(b) RTM', 4.7],
    [null, '(c) GDAM', 0],
    [null, '(d) HP-DAM', 0],
    ['B', 'Through DSM', 3350],
    ['Total Short-term transaction and DSM', null, 23939.1],
    ['Total Generation', null, 132023.5],
    ['Source: NLDC'],
    ['* includes bilateral short-term transactions under GNA and T-GNA'],
  ];

  it('keeps GDAM and HP-DAM apart from DAM, which both contain', () => {
    const v = parseVolumeTable(T1);
    const get = (product, exchange) => v.marketData.filter((m) => m.product === product && m.exchange === exchange).map((m) => m.val);
    expect(get('DAM', 'IEX')).toEqual([4712]);
    expect(get('GDAM', 'IEX')).toEqual([851.5]);
    expect(get('HP-DAM', 'IEX')).toEqual([0]);
    expect(get('RTM', 'PXIL')).toEqual([4.7]);
    expect(get('PX_TOTAL', 'ALL')).toEqual([9054.8]);
    expect(get('DSM', 'GRID')).toEqual([3350]);
  });

  it('does not let a footnote mentioning "bilateral" wipe the month\'s bilateral volume', () => {
    const v = parseVolumeTable(T1);
    expect(v.bilateral_volume_mu).toBe(11534.3);
    expect(v.marketData.filter((m) => m.product === 'BILATERAL')).toHaveLength(1);
    expect(v.total_short_term_volume_mu).toBe(23939.1);
  });

  it('reads the older "DSM Volume" label', () => {
    const rows = T1.map((r) => (r[1] === 'Through DSM' ? ['B', 'DSM Volume', 2476.3] : r));
    expect(parseVolumeTable(rows).marketData.find((m) => m.product === 'DSM').val).toBe(2476.3);
  });

  it('re-reads a period seeded with GDAM filed as DAM, from the report on disk', () => {
    db.prepare('DELETE FROM cerc_market_data').run();
    db.prepare("INSERT INTO cerc_monthly_summary (id, report_period, bilateral_volume_mu) VALUES ('CMS-REPAIR', '2026-01', 0)").run();
    const mislabelled = db.prepare(`INSERT INTO cerc_market_data (id, report_period, data_category, product, exchange, metric_name, metric_value, metric_unit)
      VALUES (?, '2026-01', 'VOLUME', 'DAM', 'IEX', 'Volume', ?, 'MU')`);
    mislabelled.run('CMD-R1', 6125.7);
    mislabelled.run('CMD-R2', 808.99);
    expect(repairLocalVolumes()).toBeGreaterThanOrEqual(1);
    const vol = (product) => db.prepare("SELECT metric_value v FROM cerc_market_data WHERE report_period = '2026-01' AND data_category = 'VOLUME' AND product = ? AND exchange = 'IEX'").all(product).map((r) => Math.round(r.v));
    expect(vol('DAM')).toEqual([6126]);
    expect(vol('GDAM')).toEqual([809]);
    expect(Math.round(db.prepare("SELECT bilateral_volume_mu b FROM cerc_monthly_summary WHERE report_period = '2026-01'").get().b)).toBe(8879);
    // Already labelled: left alone.
    expect(repairLocalVolumes()).toBe(0);
  });
});
