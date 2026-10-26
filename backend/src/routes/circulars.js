import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/index.js';
import { requireAuth, requireRole, PLATFORM_ADMINS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { unreadablePdf, UNREADABLE_PDF_MESSAGE } from '../services/fileChecks.js';

const router = Router();
// Same root that server.js serves at /uploads, so a stored '/uploads/circulars/x'
// is the file on disk whichever folder the server was started from.
const CIRCULAR_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'circulars');

if (!fs.existsSync(CIRCULAR_UPLOAD_DIR)) {
  fs.mkdirSync(CIRCULAR_UPLOAD_DIR, { recursive: true });
}

const ALLOWED_EXT = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.zip'];
const CATEGORIES = ['REIA_TENDER', 'CORRIGENDUM', 'CERC_FORM_IV', 'POWER_MARKET', 'REGULATORY_ORDER', 'GENERAL'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CIRCULAR_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `circular_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
  fileFilter: (_req, file, cb) => {
    // The extension decides, not the browser's mimetype: the file is served back
    // from /uploads by its name, so a '.html' labelled application/pdf would be
    // served as a page on the portal's own origin.
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF, Excel, Word or ZIP files are permitted for circulars.'));
  },
});

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (req.file && path.extname(req.file.filename) === '.pdf') {
      const head = Buffer.alloc(4);
      const fd = fs.openSync(req.file.path, 'r');
      fs.readSync(fd, head, 0, 4, 0);
      fs.closeSync(fd);
      if (head.toString('latin1') !== '%PDF' || unreadablePdf(req.file.path)) {
        removeStoredFile(`/uploads/circulars/${req.file.filename}`);
        return res.status(400).json({ error: `${req.file.originalname} ${UNREADABLE_PDF_MESSAGE}` });
      }
    }
    next();
  });
}

function removeStoredFile(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith('/uploads/circulars/')) return;
  const diskPath = path.join(CIRCULAR_UPLOAD_DIR, path.basename(fileUrl));
  try { if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath); } catch { /* the row matters more than the file */ }
}

// A link the public page renders as an <a href>, so only web addresses.
const isWebUrl = (u) => /^https?:\/\/[^\s]+$/i.test(u);
const isIsoDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const flag = (v) => (v === undefined ? undefined : (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0);

// Who publishes to the public website: the platform administrators (site content,
// like broadcasts) and the desk heads whose documents these are — REIA checker
// for tenders and corrigenda, trading admin for Form-IV returns, commercial admin
// for tariff orders.
const CIRCULAR_ADMIN_ROLES = [...PLATFORM_ADMINS, 'REIA_CHECKER', 'TRADING_ADMIN', 'COMMERCIAL_ADMIN'];
const gate = [requireAuth, requireRole(...CIRCULAR_ADMIN_ROLES)];

// The public endpoints return only what the public page shows.
const PUBLIC_COLUMNS = 'id, circular_no, title_en, title_hi, category, issue_date, file_url, file_name, file_size_bytes, is_pinned';

// =========================================================================
// PUBLIC ENDPOINTS (No login required - GIGW 3.0 Public Transparency)
// =========================================================================

/**
 * GET /api/circulars/banner
 * The pinned circular for the homepage disclosure bar, else the latest published one.
 */
router.get('/banner', (_req, res) => {
  try {
    const circular = db.prepare(`
      SELECT ${PUBLIC_COLUMNS} FROM public_circulars
      WHERE is_active = 1
      ORDER BY is_pinned DESC, issue_date DESC, created_at DESC
      LIMIT 1
    `).get();
    res.json({ circular: circular || null });
  } catch (err) {
    console.error('[CIRCULARS] Error fetching banner circular:', err);
    res.status(500).json({ error: 'Failed to fetch banner circular' });
  }
});

/**
 * GET /api/circulars/public
 * Published circulars with optional category filter and keyword search.
 */
router.get('/public', (req, res) => {
  try {
    const { category, search } = req.query;
    let query = `SELECT ${PUBLIC_COLUMNS} FROM public_circulars WHERE is_active = 1`;
    const params = [];

    if (category && category !== 'ALL') {
      query += ' AND category = ?';
      params.push(category);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const term = `%${search.trim()}%`;
      query += ' AND (circular_no LIKE ? OR title_en LIKE ? OR title_hi LIKE ?)';
      params.push(term, term, term);
    }

    query += ' ORDER BY is_pinned DESC, issue_date DESC, created_at DESC';
    res.json({ circulars: db.prepare(query).all(...params) });
  } catch (err) {
    console.error('[CIRCULARS] Error fetching public circulars:', err);
    res.status(500).json({ error: 'Failed to fetch circulars' });
  }
});

// =========================================================================
// ADMIN ENDPOINTS
// =========================================================================

router.get('/admin', ...gate, (_req, res) => {
  try {
    const circulars = db.prepare(`
      SELECT * FROM public_circulars
      ORDER BY is_pinned DESC, issue_date DESC, created_at DESC
    `).all();
    res.json({ circulars });
  } catch (err) {
    console.error('[CIRCULARS] Error fetching admin circulars:', err);
    res.status(500).json({ error: 'Failed to fetch circulars' });
  }
});

function validate(body, { partial = false } = {}) {
  const { circular_no, title_en, category, issue_date, external_url } = body;
  if (!partial && (!circular_no?.trim() || !title_en?.trim() || !category || !issue_date)) {
    return 'Circular reference number, English title, category, and issue date are required.';
  }
  if (category && !CATEGORIES.includes(category)) return `Unknown category ${category}.`;
  if (issue_date && !isIsoDate(issue_date)) return 'Issue date must be a date (YYYY-MM-DD).';
  if (external_url && !isWebUrl(external_url)) return 'External link must start with http:// or https://.';
  return null;
}

router.post('/admin', ...gate, uploadSingle, (req, res) => {
  const problem = validate(req.body);
  if (problem) {
    if (req.file) removeStoredFile(`/uploads/circulars/${req.file.filename}`);
    return res.status(400).json({ error: problem });
  }
  try {
    const { circular_no, title_en, title_hi, category, issue_date, external_url } = req.body;
    const id = `CIRC-${Date.now()}-${uuidv4().slice(0, 6)}`;
    const pinned = flag(req.body.is_pinned) ?? 0;
    const active = flag(req.body.is_active) ?? 1;
    const fileUrl = req.file ? `/uploads/circulars/${req.file.filename}` : (external_url || null);

    db.transaction(() => {
      // One circular on the homepage bar at a time.
      if (pinned) db.prepare('UPDATE public_circulars SET is_pinned = 0').run();
      db.prepare(`
        INSERT INTO public_circulars (
          id, circular_no, title_en, title_hi, category, issue_date,
          file_url, file_name, file_size_bytes, is_pinned, is_active, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, circular_no.trim(), title_en.trim(), title_hi?.trim() || null, category, issue_date,
        fileUrl, req.file?.originalname || null, req.file?.size || 0, pinned, active,
        req.user?.name || req.user?.email || null,
      );
    })();

    const created = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(id);
    logAudit({ req, action: active ? 'PUBLISH_CIRCULAR' : 'DRAFT_CIRCULAR', module: 'PUBLIC_PORTAL', entityType: 'public_circular', entityId: id, afterValue: created });
    res.status(201).json({ circular: created, message: 'Circular published successfully' });
  } catch (err) {
    console.error('[CIRCULARS] Error creating circular:', err);
    res.status(500).json({ error: 'Failed to create circular' });
  }
});

router.put('/admin/:id', ...gate, uploadSingle, (req, res) => {
  const existing = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) removeStoredFile(`/uploads/circulars/${req.file.filename}`);
    return res.status(404).json({ error: 'Circular not found' });
  }
  // The edit form sends back the stored link of an uploaded file unchanged.
  if (req.body.external_url === existing.file_url) delete req.body.external_url;
  const problem = validate(req.body, { partial: true });
  if (problem) {
    if (req.file) removeStoredFile(`/uploads/circulars/${req.file.filename}`);
    return res.status(400).json({ error: problem });
  }
  try {
    const { circular_no, title_en, title_hi, category, issue_date, external_url } = req.body;
    // A field the form did not send keeps its value — an edit never publishes a draft by omission.
    const pinned = flag(req.body.is_pinned) ?? existing.is_pinned;
    const active = flag(req.body.is_active) ?? existing.is_active;

    let fileUrl = existing.file_url;
    let fileName = existing.file_name;
    let fileSizeBytes = existing.file_size_bytes;
    if (req.file) {
      fileUrl = `/uploads/circulars/${req.file.filename}`;
      fileName = req.file.originalname;
      fileSizeBytes = req.file.size;
    } else if (external_url) {
      fileUrl = external_url;
      fileName = null;
      fileSizeBytes = 0;
    }

    db.transaction(() => {
      if (pinned && !existing.is_pinned) db.prepare('UPDATE public_circulars SET is_pinned = 0 WHERE id != ?').run(existing.id);
      db.prepare(`
        UPDATE public_circulars
        SET circular_no = ?, title_en = ?, title_hi = ?, category = ?, issue_date = ?,
            file_url = ?, file_name = ?, file_size_bytes = ?, is_pinned = ?, is_active = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        circular_no?.trim() || existing.circular_no,
        title_en?.trim() || existing.title_en,
        title_hi !== undefined ? (title_hi.trim() || null) : existing.title_hi,
        category || existing.category,
        issue_date || existing.issue_date,
        fileUrl, fileName, fileSizeBytes, pinned, active, existing.id,
      );
    })();
    if (fileUrl !== existing.file_url) removeStoredFile(existing.file_url);

    const updated = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(existing.id);
    logAudit({ req, action: 'EDIT_CIRCULAR', module: 'PUBLIC_PORTAL', entityType: 'public_circular', entityId: existing.id, beforeValue: existing, afterValue: updated });
    res.json({ circular: updated, message: 'Circular updated successfully' });
  } catch (err) {
    console.error('[CIRCULARS] Error updating circular:', err);
    res.status(500).json({ error: 'Failed to update circular' });
  }
});

router.post('/admin/:id/pin', ...gate, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Circular not found' });

    const nextPin = existing.is_pinned ? 0 : 1;
    db.transaction(() => {
      if (nextPin) db.prepare('UPDATE public_circulars SET is_pinned = 0').run();
      db.prepare("UPDATE public_circulars SET is_pinned = ?, updated_at = datetime('now') WHERE id = ?").run(nextPin, existing.id);
    })();
    const updated = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(existing.id);
    logAudit({ req, action: nextPin ? 'PIN_CIRCULAR' : 'UNPIN_CIRCULAR', module: 'PUBLIC_PORTAL', entityType: 'public_circular', entityId: existing.id });

    res.json({
      circular: updated,
      message: nextPin ? 'Circular pinned to Homepage Banner' : 'Circular unpinned from Homepage Banner',
    });
  } catch (err) {
    console.error('[CIRCULARS] Error pinning circular:', err);
    res.status(500).json({ error: 'Failed to toggle pin' });
  }
});

router.post('/admin/:id/toggle-active', ...gate, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Circular not found' });

    const nextActive = existing.is_active ? 0 : 1;
    db.prepare("UPDATE public_circulars SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(nextActive, existing.id);
    const updated = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(existing.id);
    logAudit({ req, action: nextActive ? 'PUBLISH_CIRCULAR' : 'UNPUBLISH_CIRCULAR', module: 'PUBLIC_PORTAL', entityType: 'public_circular', entityId: existing.id });

    res.json({
      circular: updated,
      message: nextActive ? 'Circular published' : 'Circular unpublished (draft mode)',
    });
  } catch (err) {
    console.error('[CIRCULARS] Error toggling circular status:', err);
    res.status(500).json({ error: 'Failed to toggle active status' });
  }
});

router.delete('/admin/:id', ...gate, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM public_circulars WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Circular not found' });

    db.prepare('DELETE FROM public_circulars WHERE id = ?').run(existing.id);
    removeStoredFile(existing.file_url);
    logAudit({ req, action: 'DELETE_CIRCULAR', module: 'PUBLIC_PORTAL', entityType: 'public_circular', entityId: existing.id, beforeValue: existing });
    res.json({ message: 'Circular deleted successfully' });
  } catch (err) {
    console.error('[CIRCULARS] Error deleting circular:', err);
    res.status(500).json({ error: 'Failed to delete circular' });
  }
});

export default router;
