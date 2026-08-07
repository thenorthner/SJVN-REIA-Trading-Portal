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
