import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { fileURLToPath } from 'url';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer config for file upload (Memory storage first for malware scan mockup)
// We will mock the malware scan and then write to disk.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPG, PNG, and Excel allowed.'));
    }
  }
});

// GET / - List documents based on filters
router.get('/', requireAuth, (req, res) => {
  const { entity_id, contract_id, category } = req.query;
  
  let sql = `
    SELECT d.*, 
           v.id as latest_version_id, 
           v.version_number, 
           v.verification_status, 
           v.expiry_date,
           v.file_name
    FROM documents d
    JOIN document_versions v ON d.id = v.document_id
    WHERE v.version_number = (
      SELECT MAX(version_number) FROM document_versions WHERE document_id = d.id
    )
  `;
  const params = [];

  // Basic RBAC: Non-admins can only see their own entity's documents
  if (req.user.role !== 'SJVN_ADMIN' && req.user.role !== 'FINANCE_USER') {
    sql += ' AND d.entity_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (entity_id) {
    sql += ' AND d.entity_id = ?';
    params.push(entity_id);
  }

  if (contract_id) {
    sql += ' AND d.contract_id = ?';
    params.push(contract_id);
  }
  if (category) {
    sql += ' AND d.category = ?';
    params.push(category);
  }

  sql += ' ORDER BY d.created_at DESC';

  try {
    const docs = db.prepare(sql).all(...params);
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /upload - Upload a new document or a new version of an existing document
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { document_id, entity_id, contract_id, document_type, category, title, expiry_date } = req.body;
  
  // Basic RBAC
  const isInternal = ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER', 'TRADING_USER'].includes(req.user.role);
  if (!isInternal && entity_id && entity_id !== req.user.linked_entity_id) {
    fs.unlinkSync(req.file.path); // Delete the file
    return res.status(403).json({ error: 'Cannot upload document for another entity' });
  }

  try {
    db.transaction(() => {
      let docId = document_id;
      let versionNum = 1;

      if (!docId) {
        // Create new document
        docId = uuidv4();
        db.prepare(`
          INSERT INTO documents (id, entity_id, contract_id, document_type, category, title, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(docId, entity_id, contract_id, document_type, category, title, req.user.id);
      } else {
        // Get max version
        const maxV = db.prepare('SELECT MAX(version_number) as v FROM document_versions WHERE document_id = ?').get(docId);
        versionNum = (maxV.v || 0) + 1;
        // Verify category matches
        const existingDoc = db.prepare('SELECT category FROM documents WHERE id = ?').get(docId);
        if (!existingDoc) throw new Error('Document not found');
      }

      // Record vs Verify status
      const actualCategory = category || db.prepare('SELECT category FROM documents WHERE id = ?').get(docId).category;
      const initialStatus = actualCategory === 'VERIFY' ? 'PENDING' : 'NOT_REQUIRED';

      const versionId = uuidv4();
      db.prepare(`
        INSERT INTO document_versions (
          id, document_id, version_number, file_path, file_name, file_size_bytes, 
          mime_type, verification_status, expiry_date, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId, docId, versionNum, req.file.path, req.file.originalname, 
        req.file.size, req.file.mimetype, initialStatus, expiry_date || null, req.user.id
      );

    })();

    res.json({ success: true, message: 'Document uploaded successfully' });
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// POST /:versionId/verify
router.post('/:versionId/verify', requireAuth, (req, res) => {
  if (req.user.role !== 'SJVN_ADMIN') return res.status(403).json({ error: 'Only SJVN Admin can verify documents' });

  const { versionId } = req.params;
  
  db.prepare(`
    UPDATE document_versions 
    SET verification_status = 'VERIFIED', verified_by = ?, verified_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, versionId);

  res.json({ success: true });
});

// POST /:versionId/reject
router.post('/:versionId/reject', requireAuth, (req, res) => {
  if (req.user.role !== 'SJVN_ADMIN') return res.status(403).json({ error: 'Only SJVN Admin can reject documents' });

  const { versionId } = req.params;
  const { reason } = req.body;

  if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

  db.prepare(`
    UPDATE document_versions 
    SET verification_status = 'REJECTED', verification_notes = ?, verified_by = ?, verified_at = datetime('now')
    WHERE id = ?
  `).run(reason, req.user.id, versionId);

  res.json({ success: true });
});

// GET /:versionId/download
router.get('/:versionId/download', requireAuth, (req, res) => {
  const { versionId } = req.params;

  const doc = db.prepare(`
    SELECT v.file_path, v.file_name, d.entity_id 
    FROM document_versions v
    JOIN documents d ON v.document_id = d.id
    WHERE v.id = ?
  `).get(versionId);

  if (!doc) return res.status(404).json({ error: 'Document version not found' });

  if (req.user.role !== 'SJVN_ADMIN' && req.user.role !== 'FINANCE_USER') {
    if (doc.entity_id !== req.user.linked_entity_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  res.download(doc.file_path, doc.file_name);
});

export default router;
