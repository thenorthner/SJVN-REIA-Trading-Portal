import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { logAudit } from '../util.js';
import { settledLakh, settlementRupees, luToMwh } from '../services/nrpcDsa.js';
import { storeDsaPdf, fetchArchiveWeek, pendingArchiveWeeks } from '../services/nrpcDsaIngest.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = ROLE_GROUPS.REIA_WRITE;

// Statements run a few hundred KB; the largest in the archive is under 2 MB.
// Held in memory because nothing needs the bytes once they are parsed — what
// is kept is the digest, so the same file cannot be counted twice.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// The sections of the statement that are SJVN's own stations.
const SJVN_STATIONS = ['NATHPA JHAKRI HEP', 'RAMPUR HEP', 'SJVN GREEN ENERGY'];

/**
 * Upload this week's Deviation Settlement Account.
 *
 * This is the supported way to bring in a current week. NRPC's present site
 * serves its document list from an API that refuses unauthenticated calls, and
 * names each PDF by its upload timestamp, so there is no URL to derive from a
 * week number. The desk downloads the PDF and posts it here.
 */
router.post('/upload', requireRole(...WRITE), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded — post the DSA PDF as "file".' });
  try {
    const result = await storeDsaPdf(req.file.buffer, {
      fileName: req.file.originalname,
      createdBy: req.user.name,
    });
    if (!result.stored) {
      return res.status(409).json({
        error: 'This exact statement is already held.',
        ...result,
      });
    }
    logAudit({
      req, user: req.user, action: 'IMPORT', module: 'REIA', entityType: 'nrpc_dsa_account',
      entityId: result.account_id,
      details: {
        file: req.file.originalname, week_no: result.week_no,
        financial_year: result.financial_year, entities: result.entities, days: result.days,
      },
    });
    res.status(201).json(result);
  } catch (err) {
    // A statement that does not reconcile against its own printed Totals is a
    // 422, not a 500: the file was read, and it is the file that is the problem.
    if (err.problems) {
      return res.status(422).json({ error: err.message, problems: err.problems });
    }
    console.error('DSA upload failed:', err);
    res.status(400).json({ error: err.message || 'Could not read this file as a DSA statement.' });
  }
});

/** Weeks held, newest first. Superseded statements are included but marked. */
router.get('/accounts', requireRole(...READ), (req, res) => {
  const { financial_year, status, include_superseded } = req.query;
  let sql = 'SELECT * FROM nrpc_dsa_accounts WHERE 1=1';
  const params = [];
  if (financial_year) { sql += ' AND financial_year = ?'; params.push(financial_year); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else if (include_superseded !== 'true') { sql += " AND status = 'ACTIVE'"; }
  sql += ' ORDER BY week_start DESC, issued_date DESC';
  res.json(db.prepare(sql).all(...params));
});

/** One statement, with its per-entity totals. */
router.get('/accounts/:id', requireRole(...READ), (req, res) => {
  const account = db.prepare('SELECT * FROM nrpc_dsa_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Statement not found' });
  // Each entity's week as the statement prints it, and beside it what a
  // settlement row raised from it would carry — converted by the same two
  // functions the row is, so the screen can show the figure before it is raised
  // without doing the arithmetic (or the sign) a second time.
  const totals = db.prepare(
    'SELECT * FROM nrpc_dsa_entity_totals WHERE account_id = ? ORDER BY entity_name',
  ).all(req.params.id).map((t) => ({
    ...t,
    settled_lakh: settledLakh(t),
    settlement_rupees: settlementRupees(t),
    schedule_mwh: luToMwh(t.schedule_lu),
    actual_mwh: luToMwh(t.actual_lu),
    sjvn_station: SJVN_STATIONS.includes(t.entity_name),
  }));
  // What has already been raised from this statement.
  const raised = db.prepare(`
    SELECT d.id, d.dsm_no, d.contract_id, d.dsa_entity_name, d.status, c.contract_no
    FROM deviation_settlements d LEFT JOIN contracts c ON c.id = d.contract_id
    WHERE d.dsa_account_id = ? AND d.status != 'CANCELLED'
  `).all(req.params.id);
  res.json({ ...account, has_pdf: !!(account.local_file_path && fs.existsSync(account.local_file_path)), totals, raised });
});

/**
 * The statement PDF itself.
 *
 * Inline rather than as a download: this is opened to check a figure against
 * the document, which is a thing to read beside the screen, not a file to keep.
 */
router.get('/accounts/:id/pdf', requireRole(...READ), (req, res) => {
  const account = db.prepare('SELECT * FROM nrpc_dsa_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Statement not found' });
  if (!account.local_file_path || !fs.existsSync(account.local_file_path)) {
    return res.status(404).json({
      error: 'The PDF for this statement is not held. Statements imported before the file was '
        + 'retained have only their figures; re-upload the PDF to attach it.',
      week_no: account.week_no,
      financial_year: account.financial_year,
      source_url: account.source_url,
    });
  }
  const label = account.week_code || `${account.financial_year}-W${account.week_no}`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="DSA-${label.replace(/[^A-Za-z0-9.-]+/g, '-')}.pdf"`);
  fs.createReadStream(account.local_file_path).pipe(res);
});

/**
 * An entity's week-by-week history, from the statements currently in force.
 *
 * Figures stay in the document's units and sign — LU, Rs Lakh, positive means
 * payable to the pool — and `settled_lakh` names the column that settles.
 * Converting these into the units and sign that deviation_settlements uses is
 * deliberately not done here; that mapping is still open.
 */
router.get('/entities/:name/weeks', requireRole(...READ), (req, res) => {
  const { from, to } = req.query;
  let sql = `
    SELECT a.id AS account_id, a.week_no, a.financial_year, a.week_start, a.week_end,
           a.issued_date, a.due_date, a.revision,
           t.schedule_lu, t.actual_lu, t.devi_amt_lakh, t.adj_lakh, t.net_devi_lakh,
           t.sus_devi, t.sus_amount_lakh, t.add_devi_lakh
    FROM nrpc_dsa_entity_totals t
    JOIN nrpc_dsa_accounts a ON a.id = t.account_id
    WHERE t.entity_name = ? AND a.status = 'ACTIVE'`;
  const params = [req.params.name];
  if (from) { sql += ' AND a.week_start >= ?'; params.push(from); }
  if (to) { sql += ' AND a.week_end <= ?'; params.push(to); }
  sql += ' ORDER BY a.week_start DESC';
  const rows = db.prepare(sql).all(...params).map((r) => ({ ...r, settled_lakh: settledLakh(r) }));
  res.json(rows);
});

/** Entity names present in the store, for pointing a station at the right one. */
router.get('/entities', requireRole(...READ), (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `SELECT entity_name, COUNT(DISTINCT account_id) AS weeks
             FROM nrpc_dsa_entity_totals t
             JOIN nrpc_dsa_accounts a ON a.id = t.account_id AND a.status = 'ACTIVE'`;
  const params = [];
  if (q) { sql += ' WHERE entity_name LIKE ?'; params.push(`%${q}%`); }
  sql += ' GROUP BY entity_name ORDER BY entity_name';
  res.json(db.prepare(sql).all(...params));
});

/** Archive weeks not yet held — what a backfill would fetch. */
router.get('/archive/pending', requireRole(...WRITE), async (req, res) => {
  try {
    res.json({ pending: await pendingArchiveWeeks() });
  } catch (err) {
    res.status(502).json({ error: `Could not read the NRPC archive listing: ${err.message}` });
  }
});

/** Pull one archive week on demand. */
router.post('/archive/fetch', requireRole(...WRITE), async (req, res) => {
  const { week_code } = req.body || {};
  if (!week_code) return res.status(400).json({ error: 'week_code is required, e.g. 291225-040126(WK-40)' });
  try {
    const result = await fetchArchiveWeek(week_code, { createdBy: req.user.name });
    if (result.stored) {
      logAudit({
        req, user: req.user, action: 'IMPORT', module: 'REIA', entityType: 'nrpc_dsa_account',
        entityId: result.account_id, details: { week_code, ...result },
      });
    }
    res.status(result.stored ? 201 : 200).json(result);
  } catch (err) {
    if (err.problems) return res.status(422).json({ error: err.message, problems: err.problems });
    res.status(502).json({ error: err.message });
  }
});

export default router;
