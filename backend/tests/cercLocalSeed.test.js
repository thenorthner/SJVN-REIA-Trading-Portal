import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../src/db/index.js';

// Seeding "from disk" used to ask cercind.gov.in for every month first and write
// whatever came back over the committed report, falling back to the file only
// when the network failed. On 19 Sep 2026 a boot on an empty database replaced
// the tracked Sep-2025 report with CERC's revision of it. Seeding from disk now
// reads the file and nothing else; only a month with no report on disk is
// downloaded.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKED = path.join(__dirname, '../cerc_downloads');
const report = (root, period) => path.join(root, period, `MMC_Report_${period}.xlsx`);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const summary = (period) => db.prepare('SELECT id FROM cerc_monthly_summary WHERE report_period = ?').get(period);

const fetchStub = vi.fn();
let dir;
let cercScraper;

beforeAll(async () => {
  // A copy, so a regression rewrites a temp file rather than the tracked one.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sjvn-cerc-'));
  fs.mkdirSync(path.join(dir, '2025-09'));
  fs.copyFileSync(report(TRACKED, '2025-09'), report(dir, '2025-09'));
  // The scraper reads SJVN_CERC_DIR once, when it is loaded.
  process.env.SJVN_CERC_DIR = dir;
  vi.stubGlobal('fetch', fetchStub);
  ({ cercScraper } = await import('../src/services/cercScraper.js'));
});

afterAll(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fetchStub.mockReset();
  fetchStub.mockRejectedValue(new Error('the network is off in this test'));
});

describe('Seeding CERC reports from disk', () => {
  it('seeds a month from the report on disk without reaching CERC or rewriting the file', async () => {
    const before = sha(report(dir, '2025-09'));

    await cercScraper.autoSeedLocalReports();

    expect(summary('2025-09')).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) AS n FROM cerc_market_data WHERE report_period = '2025-09'").get().n).toBeGreaterThan(0);
    expect(db.prepare("SELECT status FROM cerc_fetch_log WHERE report_period = '2025-09'").all()).toEqual([{ status: 'PROCESSED' }]);
    expect(sha(report(dir, '2025-09'))).toBe(before);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('keeps the report on disk when CERC is serving a revised one', async () => {
    const before = sha(report(dir, '2025-09'));
    fetchStub.mockImplementation(async () => new Response('a revised report'));

    const result = await cercScraper.fetchCercReport('2025-09');

    expect(result.status).toBe('PROCESSED');
    expect(sha(report(dir, '2025-09'))).toBe(before);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('downloads a month that is missing on disk', async () => {
    const published = report(TRACKED, '2024-04');
    fetchStub.mockImplementation(async (url) => (String(url).endsWith('.xlsx')
      ? new Response(fs.readFileSync(published))
      : new Response('Not Found', { status: 404 })));

    const result = await cercScraper.fetchCercReport('2024-04');

    expect(result.status).toBe('PROCESSED');
    expect(fetchStub).toHaveBeenCalledWith(cercScraper.buildCercUrls('2024', '04').excelUrl);
    expect(sha(report(dir, '2024-04'))).toBe(sha(published));
    expect(summary('2024-04')).toBeTruthy();
  });
});
