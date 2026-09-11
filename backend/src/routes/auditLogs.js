import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { verifyLogIntegrity, detectSoDViolations, secureLogAudit } from '../auditEngine.js';
import { getMeta, setMeta } from '../db/meta.js';

const router = Router();
router.use(requireAuth);

const AUDITOR = ROLE_GROUPS.AUDITOR;

// Named slices of the trail an auditor reaches for first. Each is a plain
// condition over the stored columns, so a preset costs no more than a filter.
const SECURITY_ACTIONS = ['LOGIN_FAILED', 'LOGIN_BLOCKED', 'ACCESS_DENIED', 'INTEGRITY_CHECK'];
const EXPORT_ACTIONS = ['DATA_EXPORT', 'DOWNLOAD_INVOICE_PDF', 'DISTRIBUTE_MIS'];
const marks = (a) => a.map(() => '?').join(',');
const CATEGORIES = {
  security: { sql: `action IN (${marks(SECURITY_ACTIONS)})`, params: SECURITY_ACTIONS },
  exports: { sql: `(action IN (${marks(EXPORT_ACTIONS)}) OR action LIKE 'EXPORT%')`, params: EXPORT_ACTIONS },
  changes: { sql: '(before_value IS NOT NULL OR after_value IS NOT NULL)', params: [] },
};

const PAGE_DEFAULT = 100;
const PAGE_MAX = 500;
// Enough for any single review; past it the file is too big to read in a
// spreadsheet anyway, and the export says it stopped rather than trimming quietly.
const EXPORT_MAX = 50000;

const SEARCH_COLUMNS = ['user_name', 'user_role', 'action', 'entity_type', 'entity_id', 'trace_id', 'reason', 'details', 'ip_address'];
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * One WHERE clause for every view of the trail — the page of rows, the counts,
 * the chart and the CSV — so the numbers on screen, the rows under them and the
 * file an auditor takes away always describe the same set of events.
 */
function buildFilter(q) {
  const where = [];
  const params = [];
  const eq = (col, v) => { if (v) { where.push(`${col} = ?`); params.push(String(v)); } };
  eq('module', q.module);
  eq('user_id', q.user_id);
  eq('entity_id', q.entity_id);
  eq('entity_type', q.entity_type);
  eq('trace_id', q.trace_id);

  // `action_type` is the name the first version of this screen sent.
  const actions = splitList(q.action || q.action_type);
  if (actions.length) { where.push(`action IN (${marks(actions)})`); params.push(...actions); }

  const cat = CATEGORIES[q.category];
  if (cat) { where.push(cat.sql); params.push(...cat.params); }

  if (q.from_date) { where.push('created_at >= ?'); params.push(String(q.from_date)); }
  if (q.to_date) { where.push('created_at <= ?'); params.push(String(q.to_date)); }

  // Searched on the server, across the whole trail. Searching only the rows a
  // browser happened to have loaded answered "not found" for anything older.
  const text = String(q.q || '').trim();
  if (text) {
    const like = `%${likeEscape(text)}%`;
    where.push(`(${SEARCH_COLUMNS.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    params.push(...SEARCH_COLUMNS.map(() => like));
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

function filterOr400(req, res) {
  if (req.query.category && !CATEGORIES[req.query.category]) {
    res.status(400).json({ error: `category must be one of ${Object.keys(CATEGORIES).join(', ')}` });
    return null;
  }
  return buildFilter(req.query);
}

const andOrWhere = (sql) => (sql ? `${sql} AND ` : ' WHERE ');

/** A page of events, newest first, with the total the filters match. */
router.get('/', requireRole(...AUDITOR), (req, res) => {
  const f = filterOr400(req, res);
  if (!f) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_DEFAULT, 1), PAGE_MAX);
  // Paged by rowid rather than OFFSET: a cursor stays put while new events keep
  // arriving at the top, where an offset would shift and repeat rows.
  const before = parseInt(req.query.before, 10);
  const paged = Number.isFinite(before);
  const rows = db.prepare(
    `SELECT rowid AS _rowid, * FROM audit_logs${paged ? `${andOrWhere(f.sql)}rowid < ?` : f.sql} ORDER BY rowid DESC LIMIT ?`,
  ).all(...f.params, ...(paged ? [before] : []), limit + 1);

  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_logs${f.sql}`).get(...f.params).n;
  res.json({
    rows: page.map(({ _rowid, ...r }) => r),
    total,
    next_cursor: more ? page[page.length - 1]._rowid : null,
  });
});

/**
 * What the dropdowns can offer, with counts. Scoped to the date range only:
 * the lists show what exists in the period rather than what survives the other
 * filters, or choosing one would empty the others.
 */
router.get('/facets', requireRole(...AUDITOR), (req, res) => {
  const f = buildFilter({ from_date: req.query.from_date, to_date: req.query.to_date });
  const group = (col) => db.prepare(
    `SELECT ${col}, COUNT(*) AS n FROM audit_logs${andOrWhere(f.sql)}${col} IS NOT NULL GROUP BY ${col} ORDER BY n DESC`,
  ).all(...f.params);
  res.json({
    modules: group('module'),
    actions: group('action'),
    entity_types: group('entity_type'),
    users: db.prepare(`
      SELECT user_id, MAX(user_name) AS user_name, MAX(user_role) AS user_role, COUNT(*) AS n
      FROM audit_logs${andOrWhere(f.sql)}user_id IS NOT NULL
      GROUP BY user_id ORDER BY user_name COLLATE NOCASE
    `).all(...f.params),
  });
});

/** Counts and a per-day series for whatever the filters select. */
router.get('/summary', requireRole(...AUDITOR), (req, res) => {
  const f = filterOr400(req, res);
  if (!f) return;
  // The viewer's UTC offset in minutes, so a bar on the chart is the viewer's
  // calendar day rather than UTC's — the two are 5:30 apart for IST.
  const tz = Math.max(-840, Math.min(840, parseInt(req.query.tz_offset, 10) || 0));
  const shift = `${tz >= 0 ? '+' : ''}${tz} minutes`;
  const within = (cat) => db.prepare(`SELECT COUNT(*) AS n FROM audit_logs${andOrWhere(f.sql)}${cat.sql}`)
    .get(...f.params, ...cat.params).n;

  const head = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM audit_logs${f.sql}`).get(...f.params);
  const byDay = db.prepare(`
    SELECT date(created_at, ?) AS day, COUNT(*) AS n FROM audit_logs${f.sql}
    GROUP BY day ORDER BY day DESC LIMIT 90
  `).all(shift, ...f.params).reverse();

  res.json({
    total: head.n,
    users: head.users,
    security: within(CATEGORIES.security),
    exports: within(CATEGORIES.exports),
    changes: within(CATEGORIES.changes),
    by_day: byDay,
  });
});

const CSV_COLUMNS = [
  ['created_at_utc', 'created_at'], ['user_name', 'user_name'], ['user_role', 'user_role'],
  ['user_id', 'user_id'], ['action', 'action'], ['module', 'module'],
  ['entity_type', 'entity_type'], ['entity_id', 'entity_id'], ['reason', 'reason'],
  ['before_value', 'before_value'], ['after_value', 'after_value'], ['details', 'details'],
  ['trace_id', 'trace_id'], ['ip_address', 'ip_address'], ['audit_id', 'id'], ['record_hash', 'curr_hash'],
];

// A cell starting with = + - @ (or a tab or carriage return) is run by Excel as
// a formula. An audit export is exactly the file someone opens in Excel, and
// its cells carry text users typed, so such a cell gets a leading quote.
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The filtered events as a CSV. The export is written to the trail before the
 * file leaves, so taking a copy of the audit log is itself on record.
 */
router.get('/export.csv', requireRole(...AUDITOR), (req, res) => {
  const f = filterOr400(req, res);
  if (!f) return;
  const rows = db.prepare(`SELECT * FROM audit_logs${f.sql} ORDER BY rowid DESC LIMIT ?`).all(...f.params, EXPORT_MAX + 1);
  const truncated = rows.length > EXPORT_MAX;
  const out = truncated ? rows.slice(0, EXPORT_MAX) : rows;

  const filters = Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '' && v != null));
  secureLogAudit(req, {
    action: 'DATA_EXPORT',
    module: 'SYSTEM',
    entityType: 'audit_logs',
    reason: 'Audit trail exported to CSV.',
    details: { rows: out.length, truncated, filters },
  });

  const header = CSV_COLUMNS.map(([h]) => h).join(',');
  const body = out.map((r) => CSV_COLUMNS.map(([, k]) => csvCell(r[k])).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="SJVN_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('X-Export-Rows', String(out.length));
  if (truncated) res.setHeader('X-Export-Truncated', String(EXPORT_MAX));
  // The BOM makes Excel read the file as UTF-8 (₹, Devanagari names) rather than ANSI.
  res.send(`\uFEFF${header}\r\n${body}${body ? '\r\n' : ''}`);
});

const LAST_VERIFICATION = 'audit_last_verification';

/** The most recent full verification, so the screen need not rerun it to say how things stand. */
router.get('/integrity', requireRole(...AUDITOR), (req, res) => {
  let last = null;
  try { last = JSON.parse(getMeta(LAST_VERIFICATION) || 'null'); } catch { last = null; }
  res.json({ last });
});

/** Walk the whole hash chain, record that it was done, and remember the result. */
router.post('/verify-integrity', requireRole(...AUDITOR), (req, res) => {
  const result = verifyLogIntegrity();
  const checked = db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;

  secureLogAudit(req, {
    action: 'INTEGRITY_CHECK',
    module: 'SYSTEM',
    reason: 'Manual execution of cryptographic integrity check.',
    details: { result },
  });

  const record = { ...result, checked, at: new Date().toISOString(), by: req.user?.name || null };
  setMeta(LAST_VERIFICATION, JSON.stringify(record));
  res.json(record);
});

/** Records the same person both created and approved. */
router.get('/violations/sod', requireRole(...AUDITOR), (req, res) => {
  res.json(detectSoDViolations());
});

/** Record an export made by another screen (the audit trail's own CSV records itself). */
router.post('/log-export', (req, res) => {
  const { module, details } = req.body;
  secureLogAudit(req, {
    action: 'DATA_EXPORT',
    module: module || 'SYSTEM',
    reason: 'User exported data to local device.',
    details,
  });
  res.json({ success: true });
});

// Last, so the named views above are never read as a record id.
router.get('/:id', requireRole(...AUDITOR), (req, res) => {
  const log = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Audit log not found' });
  res.json(log);
});

export default router;
