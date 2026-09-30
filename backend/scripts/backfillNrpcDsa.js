/**
 * Backfill the NRPC Deviation Settlement Account archive.
 *
 *   node scripts/backfillNrpcDsa.js [--limit N] [--delay MS]
 *
 * Walks the week codes offered by https://nrpc.gov.in/comm/dsa.html, oldest
 * first, and stores each week that is not already held. Safe to re-run and
 * safe to interrupt: a stored week is skipped by week code, and an identical
 * file is refused by its digest, so progress is never redone or duplicated.
 *
 * The archive runs from the week of 29-Mar-2021 to the week ending
 * 04-Jan-2026 and is no longer extended; later weeks have to be uploaded.
 *
 * A week that fails is reported and the run carries on, because one unreadable
 * statement in 2022 should not stop the other five hundred from landing.
 *
 * Run it while the platform is stopped, or accept that a server restarting
 * mid-run can hit SQLITE_BUSY during its startup migrations: this writes a
 * transaction per week for several hundred weeks, and the five-second busy
 * timeout is measured against a database that is being written to continuously.
 */

import { listArchiveWeeks, fetchArchiveWeek } from '../src/services/nrpcDsaIngest.js';
import db from '../src/db/index.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};

// Courtesy pause between downloads. This is a government web server being
// walked several hundred times in a row, and nothing here is urgent.
const DELAY_MS = arg('--delay', 1000);
const LIMIT = arg('--limit', Infinity);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const codes = (await listArchiveWeeks()).slice().reverse(); // oldest first
  const held = new Set(
    db.prepare('SELECT week_code FROM nrpc_dsa_accounts WHERE week_code IS NOT NULL').all().map((r) => r.week_code),
  );
  const todo = codes.filter((c) => !held.has(c)).slice(0, LIMIT);

  console.log(`[DSA backfill] archive lists ${codes.length} weeks; ${held.size} already held; fetching ${todo.length}`);

  let stored = 0; let duplicate = 0;
  const failures = [];

  for (const [i, code] of todo.entries()) {
    const n = `${i + 1}/${todo.length}`;
    try {
      const r = await fetchArchiveWeek(code, { createdBy: 'ARCHIVE_BACKFILL' });
      if (r.stored) {
        stored += 1;
        console.log(`[DSA backfill] ${n} ${code} — ${r.entities} entities, ${r.days} rows`
          + (r.superseded.length ? `, superseded ${r.superseded.length} earlier` : ''));
        for (const w of r.warnings) console.log(`[DSA backfill] ${n} ${code} — note: ${w}`);
      } else {
        duplicate += 1;
        console.log(`[DSA backfill] ${n} ${code} — already held (${r.reason})`);
      }
    } catch (e) {
      failures.push({ code, error: e.message, problems: e.problems });
      console.error(`[DSA backfill] ${n} ${code} — FAILED: ${e.message}`);
    }
    if (i < todo.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n[DSA backfill] done — stored ${stored}, duplicate ${duplicate}, failed ${failures.length}`);
  for (const f of failures) {
    console.log(`  ${f.code}: ${f.error}`);
    for (const p of (f.problems || []).slice(0, 3)) console.log(`      · ${p}`);
  }
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => { console.error('[DSA backfill] aborted:', e); process.exit(2); });
