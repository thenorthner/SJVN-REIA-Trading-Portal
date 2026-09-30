/**
 * Ingest for NRPC weekly Deviation Settlement Accounts.
 *
 * Two ways in, one path through:
 *
 *   storeDsaPdf()      a PDF buffer the desk uploaded — the supported route for
 *                      current weeks, since NRPC's present site serves its
 *                      listing from an API that refuses unauthenticated calls
 *                      and names its PDFs by upload timestamp, so their URLs
 *                      cannot be derived from a week.
 *   fetchArchiveWeek() a week off the static archive at /comm/dsa.html, whose
 *                      URLs are built from the week code and need no auth. That
 *                      archive stops at the week ending 04-Jan-2026; anything
 *                      later has to be uploaded.
 *
 * Both parse first and store only on a clean parse. A statement whose sections
 * do not reconcile against their own printed Totals is rejected outright rather
 * than stored with a warning — a half-read week that sits in the database
 * looking like data is how a wrong number reaches a bill.
 *
 * Figures are stored exactly as published. See nrpcDsa.js on units and sign.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load as cheerioLoad } from 'cheerio';
import db from '../db/index.js';
import { newId } from '../util.js';
import { parseDsaPdf, FIGURE_FIELDS } from './nrpcDsa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where statement PDFs are kept.
 *
 * The digest proves a file has not changed; it does not let anyone read the
 * statement. A desk defending a bill needs the document the figure came from,
 * so the file itself is retained and served back from the account it belongs to.
 * Overridable so a throwaway database gets its own folder.
 */
const DSA_STORE_DIR = process.env.SJVN_DSA_DIR
  || path.join(__dirname, '../../dsa_statements');

const ARCHIVE_LISTING_URL = 'https://nrpc.gov.in/comm/dsa.html';
const ARCHIVE_PDF_URL = (weekCode) =>
  `https://nrpc.gov.in/comm/2021-22/dsa/${weekCode}/dsa.pdf`;

// The site answers 200 with its homepage for unknown paths, so a fetch that
// "succeeded" proves nothing on its own. Every download here is checked for
// being a PDF before it is handed to the parser.
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8',
};

const FETCH_TIMEOUT_MS = 60_000;
const PDF_MAGIC = '%PDF-';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * A week code as the archive dropdown spells it.
 *
 * Most are plain — 291225-040126(WK-40) — but well over half the archive is
 * reissues, and they carry a suffix: _R1, _R2, _R, _Corrigendum. Those are not
 * noise to be filtered out; they are the statements that actually settle, since
 * a revision replaces the week it revises. The suffix is captured so it can be
 * recorded, but which one wins is decided by the issue date inside the PDF,
 * not by the suffix or by the order weeks happen to be fetched in.
 */
export const WEEK_CODE_RE = /^(\d{6})-(\d{6})\((?:WK|Wk)-(\d{2})\)(_.+)?$/;

/** The revision marker in a week code, or null for an original statement. */
export function revisionOf(weekCode) {
  const m = WEEK_CODE_RE.exec(String(weekCode));
  return m?.[4] ? m[4].replace(/^_/, '') : null;
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), finalUrl: res.url || url };
}

/**
 * Refuse anything that is not a PDF before it reaches the parser.
 *
 * This matters more for the archive than it looks: nrpc.gov.in answers 200 with
 * its homepage for any unknown path, so a fetch can "succeed" and hand back
 * HTML. Checking the magic bytes is what turns that into a clear message rather
 * than a parse that finds no entities.
 */
function assertPdf(buffer, what, { fromArchive = false } = {}) {
  if (buffer.length >= 1024 && buffer.subarray(0, 5).toString('latin1') === PDF_MAGIC) return;
  const detail = fromArchive
    ? ' nrpc.gov.in answers 200 with its homepage for unknown paths, so this most '
      + 'likely means the week is not in the archive.'
    : '';
  throw new Error(`${what} is not a PDF (${buffer.length} bytes).${detail}`);
}

/**
 * Week codes currently offered by the archive listing, newest first.
 * Scraped from the dropdown; the page's own chLinks() builds the same URLs.
 */
export async function listArchiveWeeks() {
  const { buffer } = await fetchBuffer(ARCHIVE_LISTING_URL);
  const $ = cheerioLoad(buffer.toString('utf8'));
  const codes = [];
  $('select[name="wk"] option').each((_, el) => {
    const value = ($(el).attr('value') || '').trim();
    if (WEEK_CODE_RE.test(value)) codes.push(value);
  });
  if (!codes.length) {
    throw new Error(
      `No week codes found in the dropdown at ${ARCHIVE_LISTING_URL} — the page layout has changed.`,
    );
  }
  return codes;
}


/**
 * Which of two statements for the same week is the operative one.
 *
 * Revision rank leads, because it is definitional: an _R1 revises the original
 * it is named after, and a Corrigendum corrects whatever came before it. The
 * issue date only breaks ties within the same rank. Date alone would not do —
 * reissues are frequently published as data only, with no covering letter and
 * so no date at all, and comparing a missing date against a real one would put
 * every such revision behind the statement it replaces.
 *
 * Returns > 0 when `a` supersedes `b`.
 */
const REVISION_RANK = (revision) => {
  if (!revision) return 0;
  const m = /^R(\d*)$/i.exec(revision);
  if (m) return m[1] ? Number(m[1]) : 1;
  if (/corrigendum/i.test(revision)) return 100;
  return 1;
};

export function comparePrecedence(a, b) {
  const byRank = REVISION_RANK(a.revision) - REVISION_RANK(b.revision);
  if (byRank !== 0) return byRank;
  return String(a.issued_date || '').localeCompare(String(b.issued_date || ''));
}

/**
 * Fill in a week number and financial year the statement does not state.
 *
 * Data-only reissues carry neither. Two sources, in order of how little they
 * assume:
 *
 *   1. A statement already held for exactly the same dates — usually the
 *      original this one revises. Nothing is derived; the numbers are copied
 *      from a document that printed them.
 *   2. The archive week code, e.g. 160821-220821(WK-21)_R1, which carries the
 *      week number. The financial year is then taken from any statement held
 *      whose week falls in the same April-to-March window.
 *
 * If neither yields both, the caller refuses the file rather than guessing:
 * the DSA week numbering does not start on 1 April (WK-01 of 2021-22 begins on
 * 29 March 2021), so a financial year computed from the date alone would be
 * wrong at exactly the boundary where it matters.
 */
export function resolveWeekIdentity(header, weekCode) {
  let { week_no: weekNo, financial_year: fy } = header;
  if (weekNo && fy) return { week_no: weekNo, financial_year: fy };

  if (header.week_start && header.week_end) {
    const twin = db.prepare(`
      SELECT week_no, financial_year FROM nrpc_dsa_accounts
      WHERE week_start = ? AND week_end = ? AND week_no IS NOT NULL
      ORDER BY issued_date LIMIT 1
    `).get(header.week_start, header.week_end);
    if (twin) {
      weekNo = weekNo ?? twin.week_no;
      fy = fy || twin.financial_year;
    }
  }

  if (!weekNo && weekCode) {
    const m = WEEK_CODE_RE.exec(weekCode);
    if (m) weekNo = Number(m[3]);
  }

  if (!fy && header.week_start) {
    // Any held statement whose week sits within a few weeks either side will
    // name the same financial year.
    const near = db.prepare(`
      SELECT financial_year FROM nrpc_dsa_accounts
      WHERE financial_year IS NOT NULL
        AND week_start BETWEEN date(?, '-21 days') AND date(?, '+21 days')
      ORDER BY abs(julianday(week_start) - julianday(?)) LIMIT 1
    `).get(header.week_start, header.week_start, header.week_start);
    if (near) fy = near.financial_year;
  }

  return { week_no: weekNo || null, financial_year: fy || null };
}

/**
 * Store a parsed statement.
 *
 * Returns `{ stored: false, reason: 'DUPLICATE' }` when this exact file is
 * already held, which is what makes a backfill safe to re-run.
 */
export function storeParsedDsa(parsed, { buffer, sourceKind, sourceUrl, fileName, weekCode, createdBy }) {
  if (parsed.problems.length) {
    const err = new Error(
      `Refusing to store this statement — ${parsed.problems.length} problem(s) found: `
      + parsed.problems.slice(0, 5).join('; '),
    );
    err.problems = parsed.problems;
    throw err;
  }
  const { header: rawHeader } = parsed;
  const resolved = resolveWeekIdentity(rawHeader, weekCode);
  if (!resolved.week_no || !resolved.financial_year) {
    const err = new Error(
      'This statement does not state its week number or financial year, and neither could be '
      + 'resolved from the week code or from a statement already held for the same dates. '
      + 'Import the original statement for this week first, or supply the week code.',
    );
    err.problems = [err.message];
    throw err;
  }
  const header = { ...rawHeader, ...resolved };

  const digest = sha256(buffer);
  const existing = db.prepare('SELECT id, week_no, financial_year FROM nrpc_dsa_accounts WHERE file_sha256 = ?').get(digest);
  if (existing) {
    return { stored: false, reason: 'DUPLICATE', account_id: existing.id, ...existing };
  }

  const { entities } = parsed;
  const id = newId('DSA');

  const run = db.transaction(() => {
    // A reissue for a week we already hold does not overwrite it; the earlier
    // statement stays, marked SUPERSEDED, so the record of what NRPC said and
    // when survives.
    //
    // Which statement is current is decided by the issue date printed in the
    // PDF, never by the order a backfill happens to fetch them in. So this
    // looks both ways: it supersedes the weeks it is newer than, and marks
    // itself superseded if something newer is already held.
    const siblings = db.prepare(`
      SELECT id, issued_date, revision FROM nrpc_dsa_accounts
      WHERE financial_year = ? AND week_no = ?
    `).all(header.financial_year, header.week_no);

    const mine = { issued_date: header.issued_date, revision: weekCode ? revisionOf(weekCode) : null };
    const newer = siblings.filter((r) => comparePrecedence(r, mine) > 0);
    const prior = siblings.filter((r) => comparePrecedence(r, mine) <= 0);

    db.prepare(`
      INSERT INTO nrpc_dsa_accounts (id, week_code, revision, week_no, financial_year, week_start, week_end,
        issued_date, due_date, source_kind, source_url, file_name, file_sha256, file_bytes,
        entity_count, status, created_by)
      VALUES (@id, @week_code, @revision, @week_no, @financial_year, @week_start, @week_end,
        @issued_date, @due_date, @source_kind, @source_url, @file_name, @file_sha256, @file_bytes,
        @entity_count, 'ACTIVE', @created_by)
    `).run({
      id,
      week_code: weekCode || null,
      revision: weekCode ? revisionOf(weekCode) : null,
      week_no: header.week_no,
      financial_year: header.financial_year,
      week_start: header.week_start,
      week_end: header.week_end,
      issued_date: header.issued_date,
      due_date: header.due_date,
      source_kind: sourceKind,
      source_url: sourceUrl || null,
      file_name: fileName || null,
      file_sha256: digest,
      file_bytes: buffer.length,
      entity_count: entities.length,
      created_by: createdBy || 'SYSTEM',
    });

    for (const p of prior) {
      db.prepare(`UPDATE nrpc_dsa_accounts SET status='SUPERSEDED', superseded_by=? WHERE id=?`).run(id, p.id);
    }
    if (newer.length) {
      // Backfilled out of order: a later statement for this week is already
      // held, so this one arrives already superseded.
      const latest = newer.sort((a, b) => comparePrecedence(b, a))[0];
      db.prepare(`UPDATE nrpc_dsa_accounts SET status='SUPERSEDED', superseded_by=? WHERE id=?`).run(latest.id, id);
    }

    // Driven off FIGURE_FIELDS so a column added to the parser cannot be
    // silently dropped on the way into the database.
    const cols = FIGURE_FIELDS.join(', ');
    const dayPlaceholders = FIGURE_FIELDS.map((f) => `@${f}`).join(', ');
    const insDay = db.prepare(`
      INSERT INTO nrpc_dsa_entity_days (id, account_id, entity_name, entry_date, ${cols})
      VALUES (@id, @account_id, @entity_name, @entry_date, ${dayPlaceholders})
    `);
    const insTotal = db.prepare(`
      INSERT INTO nrpc_dsa_entity_totals (id, account_id, entity_name, ${cols})
      VALUES (@id, @account_id, @entity_name, ${dayPlaceholders})
    `);
    const figuresOf = (o) => Object.fromEntries(FIGURE_FIELDS.map((f) => [f, o[f] ?? null]));
    for (const e of entities) {
      for (const d of e.days) {
        insDay.run({
          id: newId('DSAD'), account_id: id, entity_name: e.entity_name,
          entry_date: d.entry_date, ...figuresOf(d),
        });
      }
      if (e.total) {
        insTotal.run({
          id: newId('DSAT'), account_id: id, entity_name: e.entity_name, ...figuresOf(e.total),
        });
      }
    }
    return prior.map((p) => p.id);
  });

  const superseded = run();

  // Written after the row commits, and named by digest so a re-ingest of the
  // same statement cannot leave two copies. A failure here does not undo the
  // ingest: the figures are the point, and the file can be re-uploaded.
  let storedPath = null;
  try {
    fs.mkdirSync(DSA_STORE_DIR, { recursive: true });
    storedPath = path.join(DSA_STORE_DIR, `${digest}.pdf`);
    if (!fs.existsSync(storedPath)) fs.writeFileSync(storedPath, buffer);
    db.prepare('UPDATE nrpc_dsa_accounts SET local_file_path = ? WHERE id = ?').run(storedPath, id);
  } catch (e) {
    storedPath = null;
    console.error(`[NRPC DSA] Stored the statement but could not keep its PDF: ${e.message}`);
  }

  return {
    stored: true,
    account_id: id,
    week_no: header.week_no,
    financial_year: header.financial_year,
    week_start: header.week_start,
    week_end: header.week_end,
    entities: entities.length,
    days: entities.reduce((a, e) => a + e.days.length, 0),
    warnings: parsed.warnings || [],
    file_stored: !!storedPath,
    superseded,
  };
}

/** Parse and store an uploaded statement. */
export async function storeDsaPdf(buffer, { fileName, createdBy, sourceUrl } = {}) {
  assertPdf(buffer, fileName || 'The uploaded file');
  const parsed = await parseDsaPdf(buffer);
  return storeParsedDsa(parsed, {
    buffer, sourceKind: 'UPLOAD', sourceUrl: sourceUrl || null, fileName, createdBy,
  });
}

/** Download and store one archive week. */
export async function fetchArchiveWeek(weekCode, { createdBy } = {}) {
  if (!WEEK_CODE_RE.test(weekCode)) {
    throw new Error(`Not an archive week code: ${JSON.stringify(weekCode)} — expected e.g. 291225-040126(WK-40)`);
  }
  const url = ARCHIVE_PDF_URL(weekCode);
  const { buffer } = await fetchBuffer(url);
  assertPdf(buffer, url, { fromArchive: true });
  const parsed = await parseDsaPdf(buffer);
  return storeParsedDsa(parsed, {
    buffer, sourceKind: 'ARCHIVE', sourceUrl: url, fileName: `${weekCode}-dsa.pdf`, weekCode, createdBy,
  });
}

/** Week codes in the archive that we have not stored yet. */
export async function pendingArchiveWeeks() {
  const codes = await listArchiveWeeks();
  const held = new Set(
    db.prepare(`SELECT week_code FROM nrpc_dsa_accounts WHERE week_code IS NOT NULL`)
      .all().map((r) => r.week_code),
  );
  return codes.filter((c) => !held.has(c));
}
