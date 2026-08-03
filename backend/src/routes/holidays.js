/**
 * Holiday calendar — national and per-state.
 *
 * Drives payment due dates and late-payment surcharge, and is also what SJVN
 * publishes to beneficiaries so they know which days their bills will not fall
 * due on. Because the same list does both jobs, an entry added here changes the
 * money as well as the notice.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  clearHolidayCache, isWorkingDay, nonWorkingReason, weeklyOffDays,
  computeDueDateWorking, dueDateMode, workingDaysBetween,
} from '../services/workingCalendar.js';

const router = Router();
router.use(requireAuth);

// Beneficiaries are told about these dates, so everyone who can see a bill can
// see the calendar behind it. Editing stays with the billing desk.
const READ = [...new Set([
  ...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.TRADING_ALL, ...ROLE_GROUPS.FINANCE,
  ...ROLE_GROUPS.SELLER_ACCESS, ...ROLE_GROUPS.BUYER_ACCESS, 'COMPLIANCE_AUDITOR',
])];
const WRITE = ROLE_GROUPS.REIA_WRITE;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['PUBLIC', 'RESTRICTED', 'BANK', 'LOCAL'];

// ── List / display ───────────────────────────────────────────────────────
router.get('/', requireRole(...READ), (req, res) => {
  const { year, state, scope, include_inactive } = req.query;
  let sql = 'SELECT * FROM holidays WHERE 1=1';
  const params = [];

  if (!include_inactive) sql += ' AND is_active = 1';
  if (year) { sql += " AND substr(holiday_date, 1, 4) = ?"; params.push(String(year)); }
  if (scope) { sql += ' AND scope = ?'; params.push(scope); }
  // A state's calendar is its own holidays plus every national one.
  if (state) { sql += " AND (scope = 'NATIONAL' OR state = ?)"; params.push(state); }

  sql += ' ORDER BY holiday_date ASC';
  res.json(db.prepare(sql).all(...params));
});

/** Which states have a calendar on record, for filters and pickers. */
router.get('/states', requireRole(...READ), (_req, res) => {
  const fromHolidays = db.prepare(
    "SELECT DISTINCT state FROM holidays WHERE scope = 'STATE' AND state IS NOT NULL AND state != ''"
  ).all().map((r) => r.state);
  const fromEntities = db.prepare(
    "SELECT DISTINCT state FROM entities WHERE state IS NOT NULL AND state != ''"
  ).all().map((r) => r.state);
  res.json([...new Set([...fromHolidays, ...fromEntities])].sort());
});

/**
 * Calendar settings in force, so a screen can explain a due date rather than
 * just printing one.
 */
router.get('/settings', requireRole(...READ), (_req, res) => {
  const offs = weeklyOffDays();
  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  res.json({
    due_date_counting_mode: dueDateMode(),
    weekly_off_days: offs,
    weekly_off_names: offs.map((d) => NAMES[d]),
  });
});

/** Is a given date a working day for a state, and if not, why not. */
router.get('/check', requireRole(...READ), (req, res) => {
  const { date, state } = req.query;
  if (!DATE_RE.test(String(date || ''))) {
    return res.status(400).json({ error: 'date is required as YYYY-MM-DD' });
  }
  const working = isWorkingDay(date, state || null);
  res.json({
    date, state: state || null, working,
    reason: working ? null : nonWorkingReason(date, state || null),
  });
});

/**
 * Preview a due date without writing anything — what the billing desk needs
 * before committing to terms, and what makes the counting mode legible.
 */
router.get('/due-date-preview', requireRole(...READ), (req, res) => {
  const { bill_date, terms_days, state } = req.query;
  if (!DATE_RE.test(String(bill_date || ''))) {
    return res.status(400).json({ error: 'bill_date is required as YYYY-MM-DD' });
  }
  const terms = Number(terms_days) || 45;
  const result = computeDueDateWorking(bill_date, terms, state || null);
  res.json({
    ...result,
    bill_date,
    calendar_days_taken: Math.round(
      (new Date(`${result.due_date}T00:00:00Z`) - new Date(`${bill_date}T00:00:00Z`)) / 86400000
    ),
    working_days_taken: workingDaysBetween(bill_date, result.due_date, state || null),
  });
});

// ── Add ──────────────────────────────────────────────────────────────────
router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body || {};
  const date = String(b.holiday_date || '').slice(0, 10);
  const scope = b.scope === 'STATE' ? 'STATE' : 'NATIONAL';
  const state = scope === 'STATE' ? String(b.state || '').trim() : null;
  const type = TYPES.includes(b.holiday_type) ? b.holiday_type : 'PUBLIC';

  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'holiday_date must be YYYY-MM-DD' });
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name is required' });
  if (scope === 'STATE' && !state) {
    return res.status(400).json({ error: 'state is required for a state holiday' });
  }

  // A weekly off is already non-working; adding it again would only confuse the
  // published calendar.
  if (weeklyOffDays().includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
    return res.status(400).json({
      error: `${date} is already a weekly off, so it does not need a holiday entry.`,
    });
  }

  const existing = db.prepare(
    "SELECT id, name FROM holidays WHERE holiday_date = ? AND scope = ? AND COALESCE(state,'') = COALESCE(?,'')"
  ).get(date, scope, state);
  if (existing) {
    return res.status(409).json({
      error: `${date} is already recorded${state ? ` for ${state}` : ''} as "${existing.name}".`,
      existing_id: existing.id,
    });
  }

  const id = newId('HOL');
  db.prepare(`
    INSERT INTO holidays (id, holiday_date, name, scope, state, holiday_type, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, date, String(b.name).trim(), scope, state, type, b.remarks || null, req.user.id);

  clearHolidayCache();
  secureLogAudit(req, {
    action: 'ADD_HOLIDAY', module: 'MASTERS', entityType: 'holiday', entityId: id,
    afterValue: { holiday_date: date, name: b.name, scope, state, holiday_type: type },
  });
  res.status(201).json(db.prepare('SELECT * FROM holidays WHERE id = ?').get(id));
});

// ── Withdraw ─────────────────────────────────────────────────────────────
// Deactivated rather than deleted: a bill already raised was dated against this
// calendar, and the row is the evidence for why its due date is what it is.
router.post('/:id/deactivate', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Holiday not found' });

  db.prepare('UPDATE holidays SET is_active = 0 WHERE id = ?').run(row.id);
  clearHolidayCache();
  secureLogAudit(req, {
    action: 'WITHDRAW_HOLIDAY', module: 'MASTERS', entityType: 'holiday', entityId: row.id,
    beforeValue: { is_active: 1 }, afterValue: { is_active: 0 },
    reason: req.body?.reason || null,
  });
  res.json({ ok: true, id: row.id });
});

router.post('/:id/reactivate', requireRole(...WRITE), (req, res) => {
  const row = db.prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Holiday not found' });
  db.prepare('UPDATE holidays SET is_active = 1 WHERE id = ?').run(row.id);
  clearHolidayCache();
  secureLogAudit(req, {
    action: 'REINSTATE_HOLIDAY', module: 'MASTERS', entityType: 'holiday', entityId: row.id,
    beforeValue: { is_active: 0 }, afterValue: { is_active: 1 },
  });
  res.json({ ok: true, id: row.id });
});

// ── Bulk add ─────────────────────────────────────────────────────────────
// A year's list arrives as one notification, so it should go in as one paste.
router.post('/bulk', requireRole(...WRITE), (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No rows supplied' });

  const added = [];
  const skipped = [];

  const insert = db.prepare(`
    INSERT INTO holidays (id, holiday_date, name, scope, state, holiday_type, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const dupe = db.prepare(
    "SELECT id FROM holidays WHERE holiday_date = ? AND scope = ? AND COALESCE(state,'') = COALESCE(?,'')"
  );

  db.transaction(() => {
    rows.forEach((raw, i) => {
      const line = i + 1;
      const date = String(raw.holiday_date || '').slice(0, 10);
      const name = String(raw.name || '').trim();
      const scope = raw.scope === 'STATE' ? 'STATE' : 'NATIONAL';
      const state = scope === 'STATE' ? String(raw.state || '').trim() : null;
      const type = TYPES.includes(raw.holiday_type) ? raw.holiday_type : 'PUBLIC';

      if (!DATE_RE.test(date)) return skipped.push({ line, date, reason: 'date must be YYYY-MM-DD' });
      if (!name) return skipped.push({ line, date, reason: 'name is required' });
      if (scope === 'STATE' && !state) return skipped.push({ line, date, reason: 'state is required' });
      if (weeklyOffDays().includes(new Date(`${date}T00:00:00Z`).getUTCDay())) {
        return skipped.push({ line, date, reason: 'already a weekly off' });
      }
      if (dupe.get(date, scope, state)) return skipped.push({ line, date, reason: 'already on the calendar' });

      const id = newId('HOL');
      insert.run(id, date, name, scope, state, type, raw.remarks || null, req.user.id);
      added.push({ id, date, name, scope, state });
    });
  })();

  clearHolidayCache();
  if (added.length) {
    secureLogAudit(req, {
      action: 'BULK_ADD_HOLIDAYS', module: 'MASTERS', entityType: 'holiday', entityId: null,
      afterValue: { added: added.length, skipped: skipped.length },
    });
  }
  res.status(added.length ? 201 : 400).json({ added_count: added.length, added, skipped });
});

export default router;
