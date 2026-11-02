import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { verifyLogIntegrity, detectSoDViolations, secureLogAudit } from '../auditEngine.js';
import { getMeta, setMeta } from '../db/meta.js';
import { REIA_BETA, betaHiddenIds } from '../services/reiaBeta.js';

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

/**
 * What kind of activity an event is, in words a reader filters by. The trail
 * holds well over a hundred action codes (HYDRO_BILL_APPROVAL_APPROVED,
 * RECON_FINANCE_CONCURRED, …); a dropdown of all of them is unusable, so each
 * code falls into the first kind whose patterns it matches (GLOB: `*` is any
 * run of characters, and the match is case-sensitive, as the codes are upper
 * case). First match wins, so every event has exactly one kind and the counts
 * on the activity filter add up to the total.
 */
const ACTIVITY_KINDS = [
  ['security', ['LOGIN_FAILED', 'LOGIN_BLOCKED', 'ACCESS_DENIED', 'CONCURRENT_LOGIN_ALERT', 'INTEGRITY_CHECK', '*OVERRIDE*', '*DATA_FIX*', 'ENTITY_BLACKLIST*']],
  ['exports', ['DATA_EXPORT', '*EXPORT*', '*DOWNLOAD*', 'DISTRIBUTE_MIS']],
  ['signin', ['LOGIN', 'LOGOUT', 'SESSION_*', 'PASSWORD_*']],
  ['views', ['VIEW_*', '*_VIEWED', '*_OPENED']],
  ['disputes', ['*DISPUTE*']],
  ['recon', ['*RECON*']],
  ['approvals', ['*APPROV*', '*REJECT*', 'SUBMIT*', 'RESUBMIT*', '*SENT_BACK*', 'VALIDATE*', '*VERIF*', '*CONCUR*', 'RELEASE*', '*ACCEPTED*', '*ACKNOWLEDGE*', 'LOCK', 'LOCK_*', '*SIGNED_OFF*', '*RECALLED*']],
  ['money', ['*PAYMENT*', '*FI_POSTING*', '*SAP*', '*TDS*', '*ADVANCE*', '*SECURITY*', 'INVOKE*', 'RECOVER*', '*LEDGER*', '*REFUND*']],
  ['billing', ['*BILL*', '*INVOICE*', '*NOTE*', 'GENERATE*', '*CHARGE*', 'ISSUE*', 'DISPATCH*', 'SEND', '*IRN*', '*DEFICIT*']],
  ['energy', ['*ENERGY*', '*BANK*', 'REA_*', '*_REA', '*_REA_*', '*ALLOCATION*']],
  ['documents', ['*DOCUMENT*', '*DECLARATION*', '*UPLOAD*']],
  ['admin', ['ROLE_*', 'STAFF_*', 'TEAM_*', 'USER_*', '*CIRCULAR*', 'PROJECT_SCOPE*', '*VERTICAL*', 'MAIL_*']],
  ['changes', ['CREATE*', 'UPDATE*', 'DELETE*', 'AMEND*', 'REVISE*', 'CANCEL*', 'STATUS_*', '*_CREATED', '*_ADDED', '*_CHANGED', '*_SET', '*_CANCELLED', '*_WITHDRAWN', '*_RAISED', '*HOLD*', '*_LINE']],
];
const ACTIVITY_KEYS = [...ACTIVITY_KINDS.map(([k]) => k), 'other'];
// Patterns are written into the SQL, not bound: they are constants above, and a
// CASE of bound GLOBs would need its parameters repeated in every statement.
const ACTIVITY_SQL = `(CASE ${ACTIVITY_KINDS.map(([k, globs]) => (
  `WHEN ${globs.map((g) => `action GLOB '${g}'`).join(' OR ')} THEN '${k}'`
)).join(' ')} ELSE 'other' END)`;

// Office hours are 09:00–18:00, Monday to Friday, on the viewer's clock. Work
// done outside them is not wrong, but it is the first thing an auditor samples.
const OFFICE_START = 9;
const OFFICE_END = 18;

/** The viewer's UTC offset as an SQLite date modifier ('+330 minutes' for IST). */
function tzShift(q) {
  const tz = Math.max(-840, Math.min(840, parseInt(q.tz_offset, 10) || 0));
  return `${tz >= 0 ? '+' : ''}${tz} minutes`;
}
const AFTER_HOURS_SQL = `(CAST(strftime('%H', created_at, ?) AS INTEGER) NOT BETWEEN ${OFFICE_START} AND ${OFFICE_END - 1}`
  + ` OR strftime('%w', created_at, ?) IN ('0', '6'))`;

// The REIA beta never shows the other desks (see services/reiaBeta.js). The
// response scrubber drops their rows from a page, but not from the counts beside
// it, so "Showing 80 of 2,400" would give them away; they are left out here,
// in the one WHERE clause every view shares.
const OTHER_DESK_MODULES = ['HYDRO', 'THERMAL', 'TRADING', 'COMMERCIAL'];
const OTHER_DESK_GLOBS = ['TRADING*', 'COMMERCIAL*', 'THERMAL*', 'HYDRO*'];
const OTHER_DESK_ACTIONS = ['*HYDRO*', '*THERMAL*', '*TRADING*', '*STATION*', '*PTC*'];

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
  // Several people, roles or modules at once: "what did the checkers do", or
  // "the maker and the checker on this bill, side by side".
  const anyOf = (col, v) => {
    const list = splitList(v);
    if (list.length) { where.push(`${col} IN (${marks(list)})`); params.push(...list); }
  };
  anyOf('module', q.module);
  anyOf('user_id', q.user_id);
  anyOf('user_role', q.role);
  eq('entity_id', q.entity_id);
  eq('entity_type', q.entity_type);
  eq('trace_id', q.trace_id);

  // `action_type` is the name the first version of this screen sent.
  const actions = splitList(q.action || q.action_type);
  if (actions.length) { where.push(`action IN (${marks(actions)})`); params.push(...actions); }

  const cat = CATEGORIES[q.category];
  if (cat) { where.push(cat.sql); params.push(...cat.params); }

  const kinds = splitList(q.activity).filter((k) => ACTIVITY_KEYS.includes(k));
  if (kinds.length) { where.push(`${ACTIVITY_SQL} IN (${marks(kinds)})`); params.push(...kinds); }

  if (q.hours === 'after') {
    const shift = tzShift(q);
    where.push(AFTER_HOURS_SQL);
    params.push(shift, shift);
  }

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

  if (REIA_BETA) {
    where.push(`module NOT IN (${marks(OTHER_DESK_MODULES)})`);
    params.push(...OTHER_DESK_MODULES);
    for (const g of OTHER_DESK_GLOBS) { where.push("COALESCE(user_role, '') NOT GLOB ?"); params.push(g); }
    for (const g of OTHER_DESK_ACTIONS) { where.push('action NOT GLOB ?'); params.push(g); }
    const hidden = betaHiddenIds();
    if (hidden.length) {
      where.push(`COALESCE(user_id, '') NOT IN (${marks(hidden)}) AND COALESCE(entity_id, '') NOT IN (${marks(hidden)})`);
      params.push(...hidden, ...hidden);
    }
  }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

function filterOr400(req, res) {
  if (req.query.category && !CATEGORIES[req.query.category]) {
    res.status(400).json({ error: `category must be one of ${Object.keys(CATEGORIES).join(', ')}` });
    return null;
  }
  const badKind = splitList(req.query.activity).find((k) => !ACTIVITY_KEYS.includes(k));
  if (badKind) {
    res.status(400).json({ error: `activity must be among ${ACTIVITY_KEYS.join(', ')}` });
    return null;
  }
  if (req.query.hours && req.query.hours !== 'after') {
    res.status(400).json({ error: "hours must be 'after'" });
    return null;
  }
  return buildFilter(req.query);
}

const andOrWhere = (sql) => (sql ? `${sql} AND ` : ' WHERE ');

/**
 * A page of events, newest first (or oldest first with order=asc, to read a
 * record's story from the beginning), with the total the filters match.
 */
router.get('/', requireRole(...AUDITOR), (req, res) => {
  const f = filterOr400(req, res);
  if (!f) return;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE_DEFAULT, 1), PAGE_MAX);
  const asc = req.query.order === 'asc';
  // Paged by rowid rather than OFFSET: a cursor stays put while new events keep
  // arriving at the top, where an offset would shift and repeat rows.
  const cursor = parseInt(req.query.before, 10);
  const paged = Number.isFinite(cursor);
  const rows = db.prepare(
    `SELECT rowid AS _rowid, *, ${ACTIVITY_SQL} AS activity FROM audit_logs`
    + `${paged ? `${andOrWhere(f.sql)}rowid ${asc ? '>' : '<'} ?` : f.sql} ORDER BY rowid ${asc ? 'ASC' : 'DESC'} LIMIT ?`,
  ).all(...f.params, ...(paged ? [cursor] : []), limit + 1);

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
  const actions = db.prepare(
    `SELECT action, ${ACTIVITY_SQL} AS activity, COUNT(*) AS n FROM audit_logs${f.sql} GROUP BY action ORDER BY n DESC`,
  ).all(...f.params);
  const byKind = new Map();
  for (const a of actions) byKind.set(a.activity, (byKind.get(a.activity) || 0) + a.n);
  res.json({
    modules: group('module'),
    actions,
    // In the fixed order of ACTIVITY_KINDS, so the filter reads the same every day.
    activities: ACTIVITY_KEYS.filter((k) => byKind.has(k)).map((k) => ({ activity: k, n: byKind.get(k) })),
    roles: group('user_role'),
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
  const shift = tzShift(req.query);
  const within = (cat) => db.prepare(`SELECT COUNT(*) AS n FROM audit_logs${andOrWhere(f.sql)}${cat.sql}`)
    .get(...f.params, ...cat.params).n;

  const head = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM audit_logs${f.sql}`).get(...f.params);
  const byKindFilter = buildFilter({ ...req.query, activity: '' });
  const byDay = db.prepare(`
    SELECT date(created_at, ?) AS day, COUNT(*) AS n FROM audit_logs${f.sql}
    GROUP BY day ORDER BY day DESC LIMIT 90
  `).all(shift, ...f.params).reverse();

  // Counted as the activity kinds a card opens, so clicking "Security" lists
  // exactly the number it showed.
  const kind = (k) => within({ sql: `${ACTIVITY_SQL} = ?`, params: [k] });
  res.json({
    total: head.n,
    users: head.users,
    security: kind('security'),
    exports: kind('exports'),
    changes: within(CATEGORIES.changes),
    after_hours: within({ sql: AFTER_HOURS_SQL, params: [shift, shift] }),
    by_day: byDay,
    // Each kind of activity under every filter but the activity one, so the
    // chips read "Meera: 30 approvals, 55 changes" and picking one keeps the
    // others' counts in view.
    by_activity: db.prepare(`SELECT ${ACTIVITY_SQL} AS activity, COUNT(*) AS n FROM audit_logs${byKindFilter.sql} GROUP BY activity`)
      .all(...byKindFilter.params),
  });
});

const PEOPLE_MAX = 300;

/**
 * Who did what, one line per person, for whatever the filters select: how
 * much, when they started and stopped, what kinds of work, and how much of it
 * was a security event or out of hours. The "People" view of the screen.
 */
router.get('/people', requireRole(...AUDITOR), (req, res) => {
  const f = filterOr400(req, res);
  if (!f) return;
  const shift = tzShift(req.query);
  const sec = { sql: `${ACTIVITY_SQL} = ?`, params: ['security'] };
  const people = db.prepare(`
    SELECT user_id, MAX(user_name) AS user_name, MAX(user_role) AS user_role, COUNT(*) AS n,
           MIN(created_at) AS first_at, MAX(created_at) AS last_at,
           COUNT(DISTINCT date(created_at, ?)) AS active_days,
           SUM(CASE WHEN ${sec.sql} THEN 1 ELSE 0 END) AS security,
           SUM(CASE WHEN ${AFTER_HOURS_SQL} THEN 1 ELSE 0 END) AS after_hours
    FROM audit_logs${f.sql}
    GROUP BY COALESCE(user_id, '') ORDER BY n DESC LIMIT ?
  `).all(shift, ...sec.params, shift, shift, ...f.params, PEOPLE_MAX);

  const kinds = db.prepare(`
    SELECT COALESCE(user_id, '') AS uid, ${ACTIVITY_SQL} AS activity, COUNT(*) AS n
    FROM audit_logs${f.sql} GROUP BY uid, activity ORDER BY n DESC
  `).all(...f.params);
  const byUser = new Map();
  for (const k of kinds) {
    if (!byUser.has(k.uid)) byUser.set(k.uid, []);
    byUser.get(k.uid).push({ activity: k.activity, n: k.n });
  }
  res.json({
    people: people.map((p) => ({ ...p, activities: byUser.get(p.user_id || '') || [] })),
    truncated: people.length === PEOPLE_MAX,
  });
});

const CSV_COLUMNS = [
  ['created_at_utc', 'created_at'], ['user_name', 'user_name'], ['user_role', 'user_role'],
  ['user_id', 'user_id'], ['action', 'action'], ['activity', 'activity'], ['module', 'module'],
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
  const asc = req.query.order === 'asc';
  const rows = db.prepare(`SELECT *, ${ACTIVITY_SQL} AS activity FROM audit_logs${f.sql} ORDER BY rowid ${asc ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...f.params, EXPORT_MAX + 1);
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

// Whoever is signed in could write a DATA_EXPORT entry here, with any module
// and any payload — a way to put noise, or a false trail, into the chain. The
// screens that call it are SJVN's own.
const EXPORT_LOGGERS = [
  'SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_CHECKER', 'REIA_MAKER',
  'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT', 'COMPLIANCE_AUDITOR',
];

/** Record an export made by another screen (the audit trail's own CSV records itself). */
router.post('/log-export', requireRole(...EXPORT_LOGGERS), (req, res) => {
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
