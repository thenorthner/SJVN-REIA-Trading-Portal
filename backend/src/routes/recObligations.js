/**
 * REC purchase and sale ledger, built from the exchange's obligation report.
 * See services/recObligationImport.js for what the file is and how it is read.
 */
import { Router } from 'express';
import multer from 'multer';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  importObligationReport, obligationLedger, obligationSummary, reconcile,
  hydrateLine, ObligationImportError,
} from '../services/recObligationImport.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.TRADING_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.TRADING_WRITE;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLATFORMS = ['IEX', 'PXIL', 'HPX'];

// Held in memory: the report is a session's worth of trades, not a bulk file,
// and nothing needs the bytes after they are parsed.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const parseUpload = (row) => (row ? {
  ...row,
  columns_mapped: JSON.parse(row.columns_mapped_json || '[]'),
  columns_ignored: JSON.parse(row.columns_ignored_json || '[]'),
  warnings: JSON.parse(row.warnings_json || '[]'),
  skipped: JSON.parse(row.skipped_json || '[]'),
} : row);

/** The columns the parser understands, and a template in that shape. */
router.get('/template', requireRole(...READ), (_req, res) => {
  const header = 'Trade Date,Instrument,Side,Quantity,Price,Trade Value,Exchange Fee,GST,Net Amount,Settlement Date,Reference No\n';
  const rows = [
    '11/03/2026,Non-Solar,Sell,500,350,175000,875,157.5,173967.5,13/03/2026,IEX-REC-0001\n',
    '11/03/2026,Solar,Buy,200,1000,200000,400,72,200472,13/03/2026,IEX-REC-0002\n',
  ].join('');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rec-obligation-template.csv"');
  res.send(header + rows);
});

/**
 * Upload a report. `dry_run` parses and reports without writing, which is how
 * the screen shows what a file contains before anyone commits it.
 */
router.post('/upload', requireRole(...WRITE), upload.single('file'), (req, res) => {
  if (!req.file?.buffer?.length) return res.status(400).json({ error: 'Attach the obligation report as "file".' });
  const platform = String(req.body?.platform || 'IEX').toUpperCase();
  if (!PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `platform must be one of: ${PLATFORMS.join(', ')}` });
  }
  const dryRun = req.body?.dry_run === true || req.body?.dry_run === 'true';

  try {
    const result = importObligationReport(req.file.buffer, {
      fileName: req.file.originalname,
      platform,
      dryRun,
      actor: req.user.name,
    });
    if (!dryRun) {
      secureLogAudit(req, {
        action: 'REC_OBLIGATION_UPLOAD',
        module: 'TRADING',
        entityType: 'rec_obligation_upload',
        entityId: result.upload_id,
        details: {
          file: req.file.originalname,
          platform,
          lines: result.lines_read,
          created: result.lines_created,
          updated: result.lines_updated,
          differences: result.reconciliation.length,
        },
      });
    }
    res.status(dryRun ? 200 : 201).json(result);
  } catch (err) {
    if (err instanceof ObligationImportError) return res.status(400).json({ error: err.message });
    console.error('REC obligation import failed:', err);
    res.status(500).json({ error: err.message || 'The obligation report could not be imported.' });
  }
});

/** Every report uploaded, newest first. */
router.get('/uploads', requireRole(...READ), (_req, res) => {
  res.json(db.prepare('SELECT * FROM rec_obligation_uploads ORDER BY created_at DESC').all().map(parseUpload));
});

/** The purchase and sale ledger, with the position it adds up to. */
router.get('/ledger', requireRole(...READ), (req, res) => {
  const { from, to, side, instrument, platform } = req.query;
  for (const [k, v] of Object.entries({ from, to })) {
    if (v && !DATE_RE.test(v)) return res.status(400).json({ error: `${k} must be YYYY-MM-DD` });
  }
  if (side && !['BUY', 'SELL'].includes(String(side).toUpperCase())) {
    return res.status(400).json({ error: 'side must be BUY or SELL' });
  }
  const filters = { from, to, side, instrument, platform };
  const lines = obligationLedger(filters);
  res.json({
    summary: obligationSummary(filters),
    reconciliation: reconcile(lines),
    lines,
  });
});

/** One upload: what it carried, how it was read, and where it disagrees. */
router.get('/uploads/:id', requireRole(...READ), (req, res) => {
  const row = parseUpload(db.prepare('SELECT * FROM rec_obligation_uploads WHERE id = ?').get(req.params.id));
  if (!row) return res.status(404).json({ error: 'No such upload' });
  const lines = db.prepare('SELECT * FROM rec_obligation_lines WHERE upload_id = ? ORDER BY row_no').all(row.id).map(hydrateLine);
  res.json({ upload: row, lines, reconciliation: reconcile(lines) });
});

/**
 * Withdraw a report uploaded in error.
 *
 * Lines a later report has since restated belong to that report and stay — only
 * what this upload is still the source of goes, so withdrawing yesterday's file
 * cannot silently delete today's corrections.
 */
router.delete('/uploads/:id', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM rec_obligation_uploads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No such upload' });
  const owned = db.prepare('SELECT COUNT(*) c FROM rec_obligation_lines WHERE upload_id = ?').get(row.id).c;
  db.transaction(() => {
    db.prepare('DELETE FROM rec_obligation_lines WHERE upload_id = ?').run(row.id);
    db.prepare('DELETE FROM rec_obligation_uploads WHERE id = ?').run(row.id);
  })();
  secureLogAudit(req, {
    action: 'REC_OBLIGATION_WITHDRAW',
    module: 'TRADING',
    entityType: 'rec_obligation_upload',
    entityId: row.id,
    details: { file: row.file_name, lines_removed: owned, reason: req.body?.reason || null },
  });
  res.json({ ok: true, lines_removed: owned });
});

export default router;
