import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import crypto from 'crypto';
import { ZipArchive } from 'archiver';
import { unreadablePdf } from '../services/fileChecks.js';
import { requireAuth, ROLE_GROUPS, SELLER_ROLES, BUYER_ROLES, PLATFORM_ADMINS } from '../middleware/auth.js';
import { pushNotification } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
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


// ── Who may do what ─────────────────────────────────────────────────────────
//
// A document belongs to a company (entity_id), to a contract, or to both.
// SJVN staff read all of them. A seller, buyer or trading client reads only
// what belongs to its own company or to a contract it is a party to — and a
// login linked to no company reads nothing, where it used to match every
// document that had no company on it.
//
// Verifying is the REIA desk's job, and never the uploader's own.

const EXTERNAL_ROLES = [...SELLER_ROLES, ...BUYER_ROLES, 'TRADING_CLIENT', 'TRADING_CLIENT_MAKER', 'TRADING_CLIENT_CHECKER'];
const isExternal = (user) => EXTERNAL_ROLES.includes(user?.role);
// The desks that onboard stakeholders — REIA, Commercial (hydro) and Thermal —
// each take in and verify their own stakeholders' papers.
// The administrators keep KYC intake and verification with onboarding (Target #2 Phase B).
const INTAKE_ROLES = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE, ...PLATFORM_ADMINS])];
const canVerify = (user) => INTAKE_ROLES.includes(user?.role);
const ADMIN_ROLES = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_CHECKER', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'];

// Each desk takes in and reviews its own vertical's papers. The Hydro desk
// rejected a REIA developer's PAN and the Thermal desk verified a hydro
// station's (Hydro QA run 15). Administrators across SJVN act on all.
const VERTICAL_LABELS = { REIA: 'REIA', HYDRO: 'Hydro Billing', THERMAL: 'Thermal Billing' };
function deskVerticals(user) {
  const role = user?.role;
  if (['THERMAL_ADMIN', 'THERMAL_USER'].includes(role)) return ['THERMAL'];
  if (['COMMERCIAL_ADMIN', 'COMMERCIAL', 'COMMERCIAL_USER'].includes(role)) return ['HYDRO'];
  if (['REIA_CHECKER', 'REIA_MAKER'].includes(role)) return ['REIA'];
  return null;
}
/** The verticals a document's owner sits in: its company's, else its contract's. */
function ownerVerticals({ entity_id: entityId, contract_id: contractId }) {
  if (entityId) {
    const e = db.prepare('SELECT verticals FROM entities WHERE id = ?').get(entityId);
    if (e) return String(e.verticals || 'REIA').split(',').map((v) => v.trim()).filter(Boolean);
  }
  if (contractId) {
    const c = db.prepare('SELECT project_type FROM contracts WHERE id = ?').get(contractId);
    if (c) return [c.project_type === 'Thermal' ? 'THERMAL' : ['Hydro', 'PSP'].includes(c.project_type) ? 'HYDRO' : 'REIA'];
  }
  return [];
}
/** Why this desk may not act on this document's owner, or null. */
function outsideDesk(user, owner) {
  const own = deskVerticals(user);
  if (!own) return null;
  const theirs = ownerVerticals(owner);
  if (!theirs.length || theirs.some((v) => own.includes(v))) return null;
  return `This is a ${theirs.map((v) => VERTICAL_LABELS[v] || v).join(' / ')} stakeholder's paper; your desk acts on ${own.map((v) => VERTICAL_LABELS[v]).join(', ')} stakeholders only.`;
}
/** The vertical a desk's lists are narrowed to: its own, whatever it asks for. */
function listVertical(user, asked) {
  const want = asked ? String(asked).replace(/[^A-Z_]/g, '') : '';
  const own = deskVerticals(user);
  if (!own) return { vf: want };
  if (want && !own.includes(want)) return { none: true };
  return { vf: want || own[0] };
}
const isDay = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** The entity ids an outside login stands for. A trading client's login may
 *  point at the client row or at the entity behind it; both are honoured. */
function ownEntityIds(user) {
  const linked = user?.linked_entity_id;
  if (!linked) return [];
  const ids = new Set([linked]);
  try {
    for (const t of db.prepare('SELECT id, entity_id FROM trading_clients WHERE id = ? OR entity_id = ?').all(linked, linked)) {
      if (t.id) ids.add(t.id);
      if (t.entity_id) ids.add(t.entity_id);
    }
  } catch { /* no trading clients on this database */ }
  return [...ids];
}

function ownContractIds(user) {
  const ids = ownEntityIds(user);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  return db.prepare(`SELECT id FROM contracts WHERE seller_id IN (${marks}) OR buyer_id IN (${marks})`)
    .all(...ids, ...ids).map((c) => c.id);
}

/** May this person read a document with this owner? */
function canRead(user, doc) {
  if (!isExternal(user)) return true;
  if (doc.entity_id && ownEntityIds(user).includes(doc.entity_id)) return true;
  if (doc.contract_id && ownContractIds(user).includes(doc.contract_id)) return true;
  return false;
}

const audit = (req, action, versionId, extra = {}) => {
  try {
    secureLogAudit(req, { action, module: 'DOCUMENTS', entityType: 'document_versions', entityId: versionId, ...extra });
  } catch (err) {
    console.error('[DOCUMENTS] audit failed', err.message);
  }
};

const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((new Date(`${iso.slice(0, 10)}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000);
export const EXPIRY_WARNING_DAYS = 30;

/** Where a dated document stands: expired, expiring within the warning window, or neither. */
function expiryOf(row) {
  if (!row.expiry_date) return { days_to_expiry: null, expiry_state: null };
  const days = daysUntil(row.expiry_date);
  return { days_to_expiry: days, expiry_state: days < 0 ? 'EXPIRED' : days <= EXPIRY_WARNING_DAYS ? 'EXPIRING' : null };
}

const parseJson = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

/** A verified document whose date has passed is no longer proof of anything. */
const decorate = (row) => {
  const exp = expiryOf(row);
  return {
    ...row,
    ...exp,
    extracted: parseJson(row.extracted_json),
    extracted_json: undefined,
    effective_status: row.verification_status === 'VERIFIED' && exp.expiry_state === 'EXPIRED' ? 'EXPIRED' : row.verification_status,
  };
};

// Why a document is sent back. A fixed list so the reasons can be counted; the
// reviewer's own words go alongside.
export const REJECTION_REASONS = {
  NOT_LEGIBLE: 'Not legible — blurred, cropped or too dark',
  EXPIRED: 'The document has expired',
  WRONG_DOCUMENT: 'Not the document asked for',
  DETAILS_MISMATCH: 'Name or number does not match the company record',
  INCOMPLETE: 'Pages missing or incomplete',
  NOT_SIGNED: 'Not signed, stamped or attested',
  OTHER: 'Other',
};

// ── Reading what a file says ────────────────────────────────────────────────

const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const GSTIN_RE = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

/**
 * The PAN and GSTIN printed in a PDF, and whether they are the company's.
 *
 * This reads the text a PDF carries. A scan — a photograph of the page saved
 * as a PDF or an image — carries none, and comes back as "no text"; reading
 * those needs OCR, which is not done here.
 */
async function extractIdentifiers(filePath, mime, entity) {
  const out = { readable: false, pan: [], gstin: [], checks: [] };
  if (mime !== 'application/pdf') return out;
  let text = '';
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
    try { ({ text } = await parser.getText()); } finally { await parser.destroy?.(); }
  } catch {
    return out;
  }
  const upper = String(text || '').toUpperCase();
  if (upper.replace(/\s/g, '').length < 20) return out;
  out.readable = true;
  out.gstin = [...new Set(upper.match(GSTIN_RE) || [])].slice(0, 5);
  // A GSTIN carries a PAN inside it; that one is not a separate finding.
  const inGst = new Set(out.gstin.map((g) => g.slice(2, 12)));
  out.pan = [...new Set(upper.match(PAN_RE) || [])].filter((p) => !inGst.has(p)).slice(0, 5);

  const pan = String(entity?.pan_no || '').toUpperCase().trim();
  const gst = String(entity?.gst_no || '').toUpperCase().trim();
  const allPans = [...out.pan, ...inGst];
  if (allPans.length && pan) {
    out.checks.push(allPans.includes(pan)
      ? { ok: true, text: `PAN in the file (${pan}) matches the company record` }
      : { ok: false, text: `PAN in the file (${allPans.join(', ')}) is not the company's PAN on record (${pan})` });
  }
  if (out.gstin.length && gst) {
    out.checks.push(out.gstin.includes(gst)
      ? { ok: true, text: `GSTIN in the file (${gst}) matches the company record` }
      : { ok: false, text: `GSTIN in the file (${out.gstin.join(', ')}) is not the company's GSTIN on record (${gst})` });
  }
  if (gst && pan && gst.length === 15 && gst.slice(2, 12) !== pan) {
    out.checks.push({ ok: false, text: `The company's GSTIN on record (${gst}) does not contain its PAN on record (${pan})` });
  }
  return out;
}

const hashFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

// ── Lists ───────────────────────────────────────────────────────────────────

const LATEST = `
  SELECT d.*, e.name AS entity_name, c.contract_no,
         v.id AS latest_version_id, v.version_number, v.verification_status, v.verification_notes,
         v.rejection_code, v.verified_at, vu.name AS verified_by_name, v.expiry_date, v.file_name,
         v.file_size_bytes, v.created_at AS uploaded_at, uu.name AS uploaded_by_name, v.extracted_json,
         (SELECT COUNT(*) FROM document_versions x WHERE x.document_id = d.id) AS version_count
  FROM documents d
  JOIN document_versions v ON d.id = v.document_id
  LEFT JOIN entities e ON e.id = d.entity_id
  LEFT JOIN contracts c ON c.id = d.contract_id
  LEFT JOIN users vu ON vu.id = v.verified_by
  LEFT JOIN users uu ON uu.id = v.created_by
  WHERE v.version_number = (SELECT MAX(version_number) FROM document_versions WHERE document_id = d.id)
`;

/** The WHERE clause that keeps an outside login to its own documents. */
function ownScope(user) {
  const entities = ownEntityIds(user);
  const contracts = ownContractIds(user);
  const parts = [];
  if (entities.length) parts.push(`d.entity_id IN (${entities.map(() => '?').join(',')})`);
  if (contracts.length) parts.push(`d.contract_id IN (${contracts.map(() => '?').join(',')})`);
  return { sql: parts.length ? ` AND (${parts.join(' OR ')})` : ' AND 1 = 0', params: [...entities, ...contracts] };
}

function listDocuments(user, { entity_id, contract_id, category } = {}) {
  let sql = LATEST;
  const params = [];
  if (isExternal(user)) {
    const scope = ownScope(user);
    sql += scope.sql;
    params.push(...scope.params);
  }
  if (entity_id) { sql += ' AND d.entity_id = ?'; params.push(entity_id); }
  if (contract_id) { sql += ' AND d.contract_id = ?'; params.push(contract_id); }
  if (category) { sql += ' AND d.category = ?'; params.push(category); }
  sql += ' ORDER BY d.created_at DESC';
  return db.prepare(sql).all(...params).map(decorate);
}

// GET / - List documents based on filters
router.get('/', requireAuth, (req, res) => {
  try {
    res.json(listDocuments(req.user, req.query));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /reject-reasons — the fixed list a reviewer picks from.
router.get('/reject-reasons', requireAuth, (_req, res) => {
  res.json(Object.entries(REJECTION_REASONS).map(([code, label]) => ({ code, label })));
});

// GET /queue — everything waiting on the desk, longest-waiting first.
// ?vertical=HYDRO|THERMAL narrows to entities in that vertical.
router.get('/queue', requireAuth, (req, res) => {
  if (!canVerify(req.user)) return res.status(403).json({ error: 'The verification queue is for the billing desk' });
  const scope = listVertical(req.user, req.query.vertical);
  if (scope.none) return res.json([]);
  const verticalFilter = scope.vf ? ` AND e.verticals LIKE '%${scope.vf}%'` : '';
  const rows = db.prepare(`${LATEST} AND d.category = 'VERIFY' AND v.verification_status = 'PENDING'${verticalFilter} ORDER BY v.created_at ASC`).all()
    .map(decorate)
    .map((r) => ({ ...r, waiting_days: Math.max(0, -daysUntil(String(r.uploaded_at).slice(0, 10))) }));
  res.json(rows);
});

// GET /kyc-report — one row per company: where its documents stand.
// ?vertical=HYDRO|THERMAL narrows to entities in that vertical.
router.get('/kyc-report', requireAuth, (req, res) => {
  if (isExternal(req.user)) return res.status(403).json({ error: 'Access denied' });
  const scope = listVertical(req.user, req.query.vertical);
  if (scope.none) return res.json([]);
  const vf = scope.vf;
  const verticalFilter = vf ? ` AND e.verticals LIKE '%${vf}%'` : '';
  const docs = db.prepare(`${LATEST} AND d.entity_id IS NOT NULL AND d.category = 'VERIFY'${verticalFilter}`).all().map(decorate);
  const by = new Map();
  for (const d of docs) {
    if (!by.has(d.entity_id)) by.set(d.entity_id, []);
    by.get(d.entity_id).push(d);
  }
  let approvals = [];
  try {
    approvals = db.prepare(`
      SELECT entity_id, COUNT(*) AS total, SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified
      FROM entity_regulatory_approvals WHERE is_mandatory = 1 AND status <> 'NOT_APPLICABLE' GROUP BY entity_id
    `).all();
  } catch { /* checklist not on this database */ }
  const mandatory = new Map(approvals.map((a) => [a.entity_id, a]));
  const count = (list, fn) => list.filter(fn).length;
  const entitiesWhere = vf ? `WHERE verticals LIKE '%${vf}%'` : '';
  const rows = db.prepare(`SELECT id, name, entity_type, status FROM entities ${entitiesWhere} ORDER BY name`).all().map((e) => {
    const list = by.get(e.id) || [];
    const m = mandatory.get(e.id) || { total: 0, verified: 0 };
    const dated = list.filter((d) => d.expiry_date && d.expiry_state !== 'EXPIRED').map((d) => d.expiry_date).sort();
    return {
      entity_id: e.id, name: e.name, entity_type: e.entity_type, onboarding_status: e.status,
      mandatory_total: m.total, mandatory_verified: m.verified,
      progress_pct: m.total ? Math.round((m.verified / m.total) * 100) : null,
      documents: list.length,
      verified: count(list, (d) => d.effective_status === 'VERIFIED'),
      pending: count(list, (d) => d.verification_status === 'PENDING'),
      draft: count(list, (d) => d.verification_status === 'DRAFT'),
      rejected: count(list, (d) => d.verification_status === 'REJECTED'),
      // A rejected document's date is beside the point: it has to be sent again anyway.
      expiring: count(list, (d) => d.expiry_state === 'EXPIRING' && d.verification_status !== 'REJECTED'),
      expired: count(list, (d) => d.expiry_state === 'EXPIRED' && d.verification_status !== 'REJECTED'),
      next_expiry: dated[0] || null,
    };
  });
  res.json(rows);
});

// GET /zip?entity_id=&contract_id=&verified=1 — the latest version of each
// document the caller may read, in one file.
router.get('/zip', requireAuth, (req, res) => {
  if (!req.query.entity_id && !req.query.contract_id) return res.status(400).json({ error: 'entity_id or contract_id is required' });
  let docs = listDocuments(req.user, req.query);
  if (req.query.verified === '1') docs = docs.filter((d) => d.effective_status === 'VERIFIED');
  const rows = docs
    .map((d) => ({ ...d, file_path: db.prepare('SELECT file_path FROM document_versions WHERE id = ?').get(d.latest_version_id)?.file_path }))
    .filter((d) => d.file_path && fs.existsSync(d.file_path));
  if (!rows.length) return res.status(404).json({ error: 'There are no documents to download' });

  const owner = (rows[0].entity_name || 'documents').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${owner}_documents_${today()}.zip"`);
  const zip = new ZipArchive({ zlib: { level: 6 } });
  zip.on('error', (err) => { console.error('[DOCUMENTS] zip failed', err.message); res.destroy(err); });
  zip.pipe(res);
  const used = new Set();
  const index = ['Type,Title,Version,Status,Expiry,Verified by,Verified at,File'];
  const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const d of rows) {
    const clean = String(d.file_name || 'document').replace(/[\\/:*?"<>|\r\n]/g, '_');
    let name = `${d.document_type}/${clean}`;
    for (let i = 2; used.has(name); i += 1) name = `${d.document_type}/${i}_${clean}`;
    used.add(name);
    zip.file(d.file_path, { name });
    index.push([d.document_type, d.title, `v${d.version_number}`, d.effective_status, d.expiry_date || '', d.verified_by_name || '', d.verified_at || '', name].map(csv).join(','));
  }
  zip.append(`${index.join('\n')}\n`, { name: 'index.csv' });
  zip.finalize();
  audit(req, 'DOCUMENTS_ZIP_DOWNLOADED', req.query.entity_id || req.query.contract_id, { details: { files: rows.length, verified_only: req.query.verified === '1' } });
});

// ── Requests: SJVN asking a company for a document ──────────────────────────

const requestRows = (where, ...params) => db.prepare(`
  SELECT r.*, e.name AS entity_name, u.name AS requested_by_name
  FROM document_requests r
  LEFT JOIN entities e ON e.id = r.entity_id
  LEFT JOIN users u ON u.id = r.requested_by
  WHERE ${where}
  ORDER BY (r.status = 'OPEN') DESC, COALESCE(r.due_date, '9999') ASC, r.created_at DESC
`).all(...params).map((r) => ({ ...r, overdue: r.status === 'OPEN' && !!r.due_date && r.due_date < today() }));

// GET /requests?entity_id=&status=
router.get('/requests', requireAuth, (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (isExternal(req.user)) {
    const ids = ownEntityIds(req.user);
    if (!ids.length) return res.json([]);
    where.push(`r.entity_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  } else if (req.query.entity_id) {
    where.push('r.entity_id = ?'); params.push(req.query.entity_id);
  }
  if (req.query.status) { where.push('r.status = ?'); params.push(String(req.query.status).toUpperCase()); }
  res.json(requestRows(where.join(' AND '), ...params));
});

// POST /requests { entity_id, document_type, note, due_date }
router.post('/requests', requireAuth, (req, res) => {
  if (!canVerify(req.user)) return res.status(403).json({ error: 'Only the REIA desk can ask for a document' });
  const { entity_id, document_type, note, due_date } = req.body;
  const entity = entity_id && db.prepare('SELECT id, name FROM entities WHERE id = ?').get(entity_id);
  if (!entity) return res.status(400).json({ error: 'Choose the company to ask' });
  const outsideAsk = outsideDesk(req.user, { entity_id: entity.id });
  if (outsideAsk) return res.status(403).json({ error: outsideAsk });
  if (!document_type) return res.status(400).json({ error: 'Say which document is needed' });
  if (due_date && !isDay(due_date)) return res.status(400).json({ error: 'due_date must be a real date, YYYY-MM-DD' });
  const id = `DRQ-${uuidv4().slice(0, 12)}`;
  db.prepare(`
    INSERT INTO document_requests (id, entity_id, document_type, note, due_date, requested_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, entity.id, String(document_type), note ? String(note).slice(0, 1000) : null, due_date || null, req.user.id);
  for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(entity.id)) {
    pushNotification({ userId: u.id, type: 'DOCUMENT_REQUEST', message: `SJVN has asked for a document: ${document_type}${due_date ? ` — by ${due_date}` : ''}. Upload it under My Documents.` });
  }
  audit(req, 'DOCUMENT_REQUESTED', id, { details: { entity_id: entity.id, document_type, due_date: due_date || null } });
  res.status(201).json(requestRows('r.id = ?', id)[0]);
});

// POST /requests/:id/cancel
router.post('/requests/:id/cancel', requireAuth, (req, res) => {
  if (!canVerify(req.user)) return res.status(403).json({ error: 'Only the REIA desk can withdraw a request' });
  const r = db.prepare(`SELECT * FROM document_requests WHERE id = ?`).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  const outsideCancel = outsideDesk(req.user, { entity_id: r.entity_id });
  if (outsideCancel) return res.status(403).json({ error: outsideCancel });
  if (r.status !== 'OPEN') return res.status(400).json({ error: 'Only an open request can be withdrawn' });
  db.prepare(`UPDATE document_requests SET status = 'CANCELLED', closed_at = datetime('now') WHERE id = ?`).run(r.id);
  audit(req, 'DOCUMENT_REQUEST_CANCELLED', r.id);
  res.json(requestRows('r.id = ?', r.id)[0]);
});

// ── Upload ──────────────────────────────────────────────────────────────────

// POST /upload - Upload a new document or a new version of an existing document
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const drop = () => { try { fs.unlinkSync(req.file.path); } catch { /* already gone */ } };
  const refuse = (status, error) => { drop(); return res.status(status).json({ error }); };

  const { document_id, entity_id, contract_id, document_type, category, title, expiry_date } = req.body;
  const external = isExternal(req.user);

  // A new version goes onto a document the caller may already read; a new
  // document goes under the caller's own company or one of its contracts.
  const existing = document_id ? db.prepare('SELECT * FROM documents WHERE id = ?').get(document_id) : null;
  if (document_id && !existing) return refuse(404, 'Document not found');
  const owner = existing || { entity_id: entity_id || null, contract_id: contract_id || null };
  if (external && !canRead(req.user, owner)) return refuse(403, 'Cannot upload document for another entity');
  if (!existing && (!document_type || !title || !['VERIFY', 'RECORD'].includes(category))) {
    return refuse(400, 'document_type, title and category are required');
  }
  if (expiry_date && !isDay(expiry_date)) return refuse(400, 'expiry_date must be a real date, YYYY-MM-DD');
  // A company or contract that does not exist came back as a raw foreign-key 500.
  if (!existing && entity_id && !db.prepare('SELECT 1 FROM entities WHERE id = ?').get(entity_id)) return refuse(400, 'That company is not on record');
  if (!existing && contract_id && !db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(contract_id)) return refuse(400, 'That contract is not on record');
  if (!external) {
    const outsideUp = outsideDesk(req.user, owner);
    if (outsideUp) return refuse(403, outsideUp);
  }

  // Physical document submission policy:
  // Counterparties submit physical documents directly to SJVN REIA office.
  // SJVN Admin and REIA desk officers scan, upload, and intake compliance/KYC documents on behalf of stakeholders.
  const actualCategory = existing ? existing.category : category;
  const canAdminUpload = INTAKE_ROLES.includes(req.user.role);
  if (external && actualCategory === 'VERIFY') {
    return refuse(403, 'KYC and Regulatory compliance documents must be submitted physically to the SJVN office for administrative intake and verification.');
  }
  if (!external && !canAdminUpload && actualCategory === 'VERIFY') {
    return refuse(403, 'VERIFY-category documents must be uploaded by SJVN Admin or REIA Desk officers.');
  }

  if (unreadablePdf(req.file.path)) {
    return refuse(400, 'This PDF cannot be opened — it is empty, cut short or damaged. Export or scan it again and upload the new file.');
  }

  try {
    const fileHash = hashFile(req.file.path);
    // The same file sent back after it was turned down is still the file that was turned down.
    if (existing) {
      const rejected = db.prepare(`
        SELECT version_number, verification_notes FROM document_versions
        WHERE document_id = ? AND file_hash = ? AND verification_status = 'REJECTED'
      `).get(existing.id, fileHash);
      if (rejected) {
        return refuse(400, `This is the same file that was rejected as version ${rejected.version_number}${rejected.verification_notes ? ` (“${rejected.verification_notes}”)` : ''}. Upload a corrected copy.`);
      }
    }

    const entity = owner.entity_id ? db.prepare('SELECT id, name, pan_no, gst_no FROM entities WHERE id = ?').get(owner.entity_id) : null;
    const extracted = actualCategory === 'VERIFY'
      ? await extractIdentifiers(req.file.path, sniffFileType(req.file.path) || req.file.mimetype, entity)
      : null;
    if (extracted) {
      // The identical file under another company is for the reviewer to see, not for the uploader.
      const elsewhere = db.prepare(`
        SELECT DISTINCT e.name FROM document_versions v
        JOIN documents d ON d.id = v.document_id LEFT JOIN entities e ON e.id = d.entity_id
        WHERE v.file_hash = ? AND d.entity_id IS NOT NULL AND d.entity_id <> ?
      `).all(fileHash, owner.entity_id || '').map((r) => r.name).filter(Boolean);
      if (elsewhere.length) {
        extracted.checks.push({ ok: false, text: `The identical file is also on record for: ${elsewhere.join(', ')}` });
      }
    }

    let versionId;
    let docId = existing?.id;
    db.transaction(() => {
      let versionNum = 1;
      if (!docId) {
        docId = uuidv4();
        db.prepare(`
          INSERT INTO documents (id, entity_id, contract_id, document_type, category, title, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(docId, entity_id || null, contract_id || null, document_type, category, title, req.user.id);
      } else {
        const maxV = db.prepare('SELECT MAX(version_number) as v FROM document_versions WHERE document_id = ?').get(docId);
        versionNum = (maxV.v || 0) + 1;
      }

      // Record vs Verify status
      let initialStatus = actualCategory === 'VERIFY' ? 'PENDING' : 'NOT_REQUIRED';
      if (actualCategory === 'VERIFY' && (req.user.role === 'SELLER_L1' || req.user.role === 'BUYER_L1')) {
        initialStatus = 'DRAFT';
      }
      // Scanning a paper in and verifying it are two people's work: the desk
      // screen sent auto_verify on every intake, so whoever scanned a document
      // also verified it — expired or not, its PAN matching or not. Only an
      // administrator, as with direct admission, may admit a current paper as verified.
      const shouldAutoVerify = ADMIN_ROLES.includes(req.user.role)
        && (req.body.auto_verify === 'true' || req.body.auto_verify === true)
        && !(expiry_date && daysUntil(expiry_date) < 0);
      if (shouldAutoVerify && actualCategory === 'VERIFY') {
        initialStatus = 'VERIFIED';
      }

      versionId = uuidv4();
      db.prepare(`
        INSERT INTO document_versions (
          id, document_id, version_number, file_path, file_name, file_size_bytes,
          mime_type, verification_status, expiry_date, created_by, file_hash, extracted_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        versionId, docId, versionNum, req.file.path, req.file.originalname,
        req.file.size, req.file.mimetype, initialStatus, expiry_date || null, req.user.id,
        fileHash, extracted ? JSON.stringify(extracted) : null,
      );

      // What SJVN asked for has now arrived.
      if (owner.entity_id) {
        db.prepare(`
          UPDATE document_requests SET status = 'FULFILLED', fulfilled_version_id = ?, closed_at = datetime('now')
          WHERE entity_id = ? AND document_type = ? AND status = 'OPEN'
        `).run(versionId, owner.entity_id, existing ? existing.document_type : document_type);

        if (shouldAutoVerify) {
          try {
            db.prepare(`
              UPDATE entity_regulatory_approvals
              SET status = 'VERIFIED', document_id = ?, verified_by = ?, verified_at = datetime('now'), updated_at = datetime('now')
              WHERE entity_id = ? AND approval_code = ?
            `).run(docId, req.user.name || 'SJVN Admin', owner.entity_id, existing ? existing.document_type : document_type);
          } catch { /* ignore if not a regulatory approval code */ }
        }
      }
    })();

    audit(req, 'DOCUMENT_UPLOADED', versionId, {
      afterValue: { document_id: docId, entity_id: owner.entity_id, contract_id: owner.contract_id, file_name: req.file.originalname, new_version: !!existing },
    });
    res.json({ success: true, message: 'Document uploaded successfully', document_id: docId, version_id: versionId, extracted });
  } catch (error) {
    drop();
    res.status(500).json({ error: error.message });
  }
});

// ── Review ──────────────────────────────────────────────────────────────────

/** The version being reviewed, if it is one that can be: the latest, and waiting. */
function reviewable(req, res, action = 'review') {
  if (!canVerify(req.user)) { res.status(403).json({ error: 'Only the REIA desk can review documents' }); return null; }
  const v = db.prepare(`
    SELECT v.*, d.title, d.document_type, d.category, d.entity_id, d.contract_id,
           (SELECT MAX(version_number) FROM document_versions WHERE document_id = d.id) AS latest
    FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ?
  `).get(req.params.versionId);
  if (!v) { res.status(404).json({ error: 'Document version not found' }); return null; }
  const outsideReview = outsideDesk(req.user, { entity_id: v.entity_id, contract_id: v.contract_id });
  if (outsideReview) { res.status(403).json({ error: outsideReview }); return null; }
  if (v.category !== 'VERIFY') { res.status(400).json({ error: 'This document is kept for the record and is not verified' }); return null; }
  if (v.version_number !== v.latest) { res.status(400).json({ error: 'A newer version has been uploaded. Review that one.' }); return null; }
  if (v.created_by && v.created_by === req.user.id) {
    res.status(403).json({ error: 'You scanned this document in, so another officer reviews it.' });
    return null;
  }
  if (v.verification_status !== 'PENDING') {
    res.status(400).json({ error: v.verification_status === 'DRAFT'
      ? 'This document has not been submitted to SJVN yet'
      : `This document has already been ${v.verification_status.toLowerCase()}` });
    return null;
  }
  return v;
}

// The review reaches whoever uploaded the file and the company it belongs to.
// Under physical intake the uploader is an SJVN officer, so a rejection told
// the desk and never the company that has to bring a corrected copy.
const tellUploader = (v, message) => {
  const to = new Set(v.created_by ? [v.created_by] : []);
  if (v.entity_id) {
    for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND COALESCE(is_active, 1) = 1').all(v.entity_id)) to.add(u.id);
  }
  for (const userId of to) {
    try { pushNotification({ userId, type: 'DOCUMENT_REVIEW', message }); } catch { /* the review stands either way */ }
  }
};

// POST /:versionId/verify
router.post('/:versionId/verify', requireAuth, (req, res) => {
  const v = reviewable(req, res, 'verify');
  if (!v) return;
  if (v.expiry_date && daysUntil(v.expiry_date) < 0) {
    return res.status(400).json({ error: `This document expired on ${v.expiry_date} and cannot be verified. Reject it and ask for a current one.` });
  }
  db.prepare(`
    UPDATE document_versions
    SET verification_status = 'VERIFIED', verification_notes = NULL, rejection_code = NULL, verified_by = ?, verified_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, v.id);

  if (v.entity_id) {
    try {
      db.prepare(`
        UPDATE entity_regulatory_approvals
        SET status = 'VERIFIED', document_id = ?, verified_by = ?, verified_at = datetime('now'), updated_at = datetime('now')
        WHERE entity_id = ? AND approval_code = ?
      `).run(v.document_id, req.user.name || 'SJVN Admin', v.entity_id, v.document_type);
    } catch { /* ignore if not a regulatory approval code */ }
  }

  audit(req, 'DOCUMENT_VERIFIED', v.id, { beforeValue: { status: 'PENDING' }, afterValue: { status: 'VERIFIED', document_type: v.document_type, entity_id: v.entity_id } });
  tellUploader(v, `Your document "${v.title}" has been verified by SJVN.`);
  res.json({ success: true });
});

// POST /:versionId/reject { reason, reason_code }
router.post('/:versionId/reject', requireAuth, (req, res) => {
  const reason = String(req.body.reason || '').trim();
  const code = req.body.reason_code || 'OTHER';
  if (!REJECTION_REASONS[code]) return res.status(400).json({ error: 'Unknown rejection reason' });
  // "Other" explains itself only in the reviewer's own words.
  if (!reason && code === 'OTHER') return res.status(400).json({ error: 'Rejection reason is required' });
  const v = reviewable(req, res, 'reject');
  if (!v) return;
  const notes = reason || REJECTION_REASONS[code];
  db.prepare(`
    UPDATE document_versions
    SET verification_status = 'REJECTED', verification_notes = ?, rejection_code = ?, verified_by = ?, verified_at = datetime('now')
    WHERE id = ?
  `).run(notes, code, req.user.id, v.id);
  audit(req, 'DOCUMENT_REJECTED', v.id, { beforeValue: { status: 'PENDING' }, afterValue: { status: 'REJECTED', reason_code: code, document_type: v.document_type, entity_id: v.entity_id }, reason: notes });
  tellUploader(v, `Your document "${v.title}" was rejected by SJVN: ${notes}. ${v.category === 'VERIFY'
    ? 'Submit a corrected copy to the SJVN office; KYC papers are taken there and scanned in by the desk.'
    : 'Upload a corrected copy under My Documents.'}`);
  res.json({ success: true });
});

// GET /history/:documentId — every version of one document, newest first.
router.get('/history/:documentId', requireAuth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.documentId);
  if (!doc || !canRead(req.user, doc)) return res.status(404).json({ error: 'Document not found' });
  const versions = db.prepare(`
    SELECT v.id, v.version_number, v.file_name, v.file_size_bytes, v.verification_status, v.verification_notes,
           v.rejection_code, v.verified_at, v.expiry_date, v.created_at, v.extracted_json,
           uu.name AS uploaded_by_name, vu.name AS verified_by_name
    FROM document_versions v
    LEFT JOIN users uu ON uu.id = v.created_by
    LEFT JOIN users vu ON vu.id = v.verified_by
    WHERE v.document_id = ? ORDER BY v.version_number DESC
  `).all(doc.id).map(decorate);
  res.json({ document: doc, versions });
});

/**
 * Detect a file's real type by reading its magic bytes.
 *
 * The filename and the stored mime_type are both unreliable — users upload
 * files with the wrong extension (a PNG saved as "invoice.pdf"), and legacy
 * rows have missing/incorrect mime types. The file's own signature is the
 * only trustworthy source, so it takes priority over both.
 *
 * Returns a mime type string, or null if the signature isn't recognised.
 */
function sniffFileType(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < 4) return null;

    if (buf.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
    if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }
  }
}

// Fallback extension -> mime map, used only if sniffing is inconclusive and
// the mime_type captured at upload time is missing from the DB record.
const EXT_MIME_FALLBACK = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// GET /:versionId/download
router.get('/:versionId/download', requireAuth, (req, res) => {
  const { versionId } = req.params;

  const doc = db.prepare(`
    SELECT v.file_path, v.file_name, v.mime_type, d.entity_id, d.contract_id
    FROM document_versions v
    JOIN documents d ON v.document_id = d.id
    WHERE v.id = ?
  `).get(versionId);

  if (!doc) return res.status(404).json({ error: 'Document version not found' });
  if (!canRead(req.user, doc)) return res.status(403).json({ error: 'Access denied' });

  if (!fs.existsSync(doc.file_path)) {
    return res.status(404).json({ error: 'File is missing from storage' });
  }

  // Determine Content-Type from the file's actual bytes first. Neither the
  // extension (what res.download()/express.static() use) nor the stored
  // mime_type can be trusted: files get uploaded with the wrong extension,
  // and some upload paths don't preserve extensions on disk at all. Serving
  // a PNG as application/pdf makes the browser open its PDF viewer, which
  // then fails with "Failed to load PDF document".
  const ext = path.extname(doc.file_name || '').toLowerCase();
  const contentType =
    sniffFileType(doc.file_path) ||
    doc.mime_type ||
    EXT_MIME_FALLBACK[ext] ||
    'application/octet-stream';
  const safeName = (doc.file_name || 'document').replace(/["\r\n]/g, '');

  // Who opened which KYC document, and when.
  audit(req, 'DOCUMENT_OPENED', versionId, { details: { file_name: doc.file_name, entity_id: doc.entity_id } });

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  fs.createReadStream(doc.file_path).pipe(res);
});

// POST /:versionId/submit-l2
router.post('/:versionId/submit-l2', requireAuth, (req, res) => {
  const { versionId } = req.params;

  try {
    const doc = db.prepare(`
      SELECT v.verification_status, d.entity_id 
      FROM document_versions v
      JOIN documents d ON v.document_id = d.id
      WHERE v.id = ?
    `).get(versionId);

    if (!doc) return res.status(404).json({ error: 'Document version not found' });
    if (doc.verification_status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only DRAFT documents can be submitted to SJVN.' });
    }

    // Role check: Only SELLER (admin), SELLER_L2, SELLER_L3 (or buyers) can submit.
    const allowed = ['SELLER', 'SELLER_L2', 'SELLER_L3', 'BUYER', 'BUYER_L2', 'BUYER_L3'];
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Only an L2 Checker or Admin can submit this document to SJVN.' });
    }
    if (!doc.entity_id || !ownEntityIds(req.user).includes(doc.entity_id)) {
      return res.status(403).json({ error: 'Access denied to this entity.' });
    }

    db.prepare('UPDATE document_versions SET verification_status = ? WHERE id = ?')
      .run('PENDING', versionId);
    audit(req, 'DOCUMENT_SUBMITTED', versionId, { beforeValue: { status: 'DRAFT' }, afterValue: { status: 'PENDING' } });

    res.json({ success: true, message: 'Document submitted to SJVN successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
