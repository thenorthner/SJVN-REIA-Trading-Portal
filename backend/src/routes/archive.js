import express from 'express';
import db from '../db/index.js';

/**
 * The schedule files the desk has actually received and parsed.
 *
 * This endpoint used to invent thirty of them — one per day going back a month,
 * with a filename built from a template and a status assigned by index ("the
 * sixth one is superseded") — so the archive showed a month of activity on a
 * platform where nobody had uploaded anything.
 *
 * It reads the upload register now: the same rows the CSV upload screens write.
 * Nothing uploaded means an empty archive, which is the truth about a desk that
 * has not uploaded anything.
 */
const router = express.Router();

// The kinds that are schedule files rather than, say, a charges sheet.
const SCHEDULE_KINDS = ['RLDC_SCHEDULE'];

router.get('/', (req, res) => {
  const { portfolio, kind, from, to } = req.query;
  const where = [];
  const params = [];

  if (kind) {
    where.push('upload_kind = ?');
    params.push(String(kind).toUpperCase());
  } else {
    where.push(`upload_kind IN (${SCHEDULE_KINDS.map(() => '?').join(',')})`);
    params.push(...SCHEDULE_KINDS);
  }
  // A portfolio is not a column on an upload, but it is in the filename the
  // exchange gives the file, which is how the desk searches for one.
  if (portfolio) { where.push('filename LIKE ?'); params.push(`%${portfolio}%`); }
  if (from) { where.push('date(COALESCE(reading_date, start_date, created_at)) >= date(?)'); params.push(String(from)); }
  if (to) { where.push('date(COALESCE(reading_date, start_date, created_at)) <= date(?)'); params.push(String(to)); }

  const rows = db.prepare(`
    SELECT id, upload_kind, filename, rldc, reading_date, start_date, end_date,
           revision_no, row_count, status, notes, created_by, created_at
    FROM csv_uploads
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(reading_date, start_date, created_at) DESC, created_at DESC
  `).all(...params);

  const archives = rows.map((r) => ({
    id: r.id,
    portfolio_id: portfolio || null,
    filename: r.filename,
    kind: r.upload_kind,
    rldc: r.rldc,
    // The day the schedule is for, and the day the file arrived.
    delivery_date: r.reading_date || r.start_date || null,
    period_from: r.start_date || null,
    period_to: r.end_date || null,
    revision_no: r.revision_no || null,
    trade_date: String(r.created_at || '').slice(0, 10),
    row_count: r.row_count,
    status: r.status,
    notes: r.notes || null,
    uploaded_by: r.created_by || null,
  }));

  res.json({
    archives,
    total: archives.length,
    note: archives.length === 0
      ? 'No schedule file has been uploaded yet. Files appear here once they are loaded on the CSV upload screens.'
      : null,
  });
});

export default router;
