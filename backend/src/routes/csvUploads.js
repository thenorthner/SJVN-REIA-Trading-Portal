import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const KINDS = ['CHARGES', 'RLDC_SCHEDULE', 'REFUND', 'REFUND_LATEST', 'MMR_EXCEL'];

const CHARGES_TYPES = [
  'Exchange Fee',
  'Clearing Charges',
  'Transmission Charges',
  'Wheeling Charges',
  'SLDC Charges',
  'Other Charges',
];

const UPLOAD_TYPES = [
  'Implemented Schedule',
  'Revised Schedule',
  'Provisional Schedule',
  'Final Schedule',
];

const RLDCS = ['NRLDC', 'WRLDC', 'ERLDC', 'SRLDC', 'NERLDC'];

// Format examples for the uploader's "download sample" links. Illustrative
// values only — a template's job is to show the columns, and these downloads
// used to carry real portfolio ids, client names and application numbers off
// the live portal.
function sampleCsv(kind) {
  if (kind === 'CHARGES') {
    return 'date,portfolio_id,charge_head,amount_inr\n2026-04-01,PORTFOLIO01,Exchange Fee,1250.50\n2026-04-01,PORTFOLIO01,Clearing Charges,320.00\n';
  }
  if (kind === 'RLDC_SCHEDULE') {
    return 'block,from_time,to_time,mw\n1,00:00,00:15,25\n2,00:15,00:30,25\n';
  }
  if (kind === 'MMR_EXCEL') {
    return 'client_name,portfolio_id,energy_mwh,amount_inr\nSample Client A,PORTFOLIO01,1250.5,450000\nSample Client B,PORTFOLIO02,980.25,352000\n';
  }
  // refund / refund latest
  return 'application_id,refund_date,amount_inr,remarks\nAPP000000001,2024-12-15,15000.00,OA refund\nAPP000000002,2024-12-20,8200.50,SLDC fee refund\n';
}

router.get('/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  res.json({
    charges_types: CHARGES_TYPES,
    upload_types: UPLOAD_TYPES,
    rldcs: RLDCS,
  });
});

router.get('/sample/:kind', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const kind = String(req.params.kind || '').toUpperCase();
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind' });
  const body = sampleCsv(kind);
  const names = {
    CHARGES: 'charges-upload-sample.csv',
    RLDC_SCHEDULE: 'rldc-schedule-sample.csv',
    REFUND: 'refund-upload-sample.csv',
    REFUND_LATEST: 'latest-refund-upload-sample.csv',
    MMR_EXCEL: 'mmr-upload-sample.csv',
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${names[kind]}"`);
  res.send(body);
});

router.get('/', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { kind } = req.query;
  let sql = 'SELECT * FROM csv_uploads WHERE 1=1';
  const params = [];
  if (kind) {
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid kind' });
    sql += ' AND upload_kind = ?';
    params.push(kind);
  }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const kind = String(b.upload_kind || '').toUpperCase();
  const errors = [];

  if (!KINDS.includes(kind)) errors.push(`upload_kind must be one of: ${KINDS.join(', ')}`);
  if (!String(b.filename || '').trim()) errors.push('filename is required');
  const rowCount = Number(b.row_count);
  if (!Number.isFinite(rowCount) || rowCount < 0) errors.push('row_count must be a non-negative number');

  if (kind === 'CHARGES') {
    if (!b.start_date) errors.push('start_date is required');
    if (!b.end_date) errors.push('end_date is required');
    if (b.start_date && b.end_date && b.end_date < b.start_date) errors.push('end_date cannot be before start_date');
    if (!CHARGES_TYPES.includes(b.charges_type)) errors.push(`charges_type must be one of: ${CHARGES_TYPES.join(', ')}`);
  } else if (kind === 'RLDC_SCHEDULE') {
    if (!b.reading_date) errors.push('reading_date is required');
    if (!String(b.revision_no || '').trim()) errors.push('revision_no is required');
    if (!UPLOAD_TYPES.includes(b.upload_type)) errors.push(`upload_type must be one of: ${UPLOAD_TYPES.join(', ')}`);
  } else if (kind === 'REFUND' || kind === 'REFUND_LATEST') {
    if (!b.start_date) errors.push('start_date is required');
    if (!b.end_date) errors.push('end_date is required');
    if (b.start_date && b.end_date && b.end_date < b.start_date) errors.push('end_date cannot be before start_date');
    if (!RLDCS.includes(b.rldc)) errors.push(`rldc must be one of: ${RLDCS.join(', ')}`);
  } else if (kind === 'MMR_EXCEL') {
    const month = Number(b.month);
    const year = Number(b.year);
    if (!Number.isInteger(month) || month < 1 || month > 12) errors.push('month must be 1–12');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) errors.push('year is required');
    // Persist period as start_date = first of month for listing/filter.
    if (!errors.length) {
      b.start_date = `${year}-${String(month).padStart(2, '0')}-01`;
      b.end_date = b.start_date;
      b.revision_no = `${year}-${String(month).padStart(2, '0')}`;
    }
  }

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const id = newId('UPL');
  db.prepare(`
    INSERT INTO csv_uploads (
      id, upload_kind, start_date, end_date, reading_date, revision_no,
      charges_type, upload_type, rldc, filename, row_count, status, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)
  `).run(
    id,
    kind,
    b.start_date || null,
    b.end_date || null,
    b.reading_date || null,
    b.revision_no || null,
    b.charges_type || null,
    b.upload_type || null,
    b.rldc || null,
    String(b.filename).trim(),
    rowCount,
    b.notes || null,
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CSV_UPLOAD',
    module: 'TRADING',
    entityType: 'csv_upload',
    entityId: id,
    details: { upload_kind: kind, filename: b.filename, row_count: rowCount },
  });

  res.status(201).json(db.prepare('SELECT * FROM csv_uploads WHERE id = ?').get(id));
});

export default router;
