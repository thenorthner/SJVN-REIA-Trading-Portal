/**
 * Timestamp handling for values coming out of SQLite.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ------------------------------
 * The schema defaults every `created_at` to SQLite's `datetime('now')`, which
 * returns **UTC** formatted as "YYYY-MM-DD HH:MM:SS" — with no timezone
 * marker and a space instead of the ISO 'T'.
 *
 * That form is not valid ISO-8601, so browsers fall back to implementation
 * defined parsing and treat it as **local** time. The UTC instant is then
 * rendered as if it were already local, shifting every timestamp in the app
 * by the viewer's offset. For IST (UTC+5:30) an action taken at 11:30 AM
 * displays as 06:00 AM.
 *
 * Always parse DB timestamps through `parseTimestamp` before formatting.
 */

/** Parse a DB timestamp into a real Date, treating naive values as UTC. */
export function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value;

  const s = String(value).trim();

  // Already carries timezone information (trailing Z or ±HH:MM) — trust it.
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // "YYYY-MM-DD HH:MM[:SS]" or "YYYY-MM-DDTHH:MM[:SS]" -> pin to UTC.
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/.exec(s);
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}${m[3] || ':00'}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Date-only ("YYYY-MM-DD") is a calendar date, not an instant — keep it
  // local so it doesn't shift a day backwards in positive-offset timezones.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "21 Jul 2026, 11:30" in the viewer's timezone. */
export function fmtDateTime(value, fallback = '—') {
  const d = parseTimestamp(value);
  if (!d) return fallback;
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/** "21 Jul 2026" in the viewer's timezone. */
export function fmtDate(value, fallback = '—') {
  const d = parseTimestamp(value);
  if (!d) return fallback;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "11:30" in the viewer's timezone. */
export function fmtTime(value, fallback = '') {
  const d = parseTimestamp(value);
  if (!d) return fallback;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Local calendar-day key (YYYY-MM-DD) used for grouping by date. */
export function localDayKey(value) {
  const d = parseTimestamp(value);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Format a Date as the "YYYY-MM-DD HH:MM:SS" UTC string the DB stores. */
function toSqlUtc(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/**
 * Convert a date picked in the UI (a local calendar day) into the UTC bounds
 * the API needs. Passing the raw "YYYY-MM-DD" straight through compares a
 * local day against UTC timestamps — an IST user filtering for "today" would
 * silently lose everything before 05:30.
 */
export function localDayStartUtc(dateStr) {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  return toSqlUtc(new Date(y, m - 1, d, 0, 0, 0));
}

export function localDayEndUtc(dateStr) {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  return toSqlUtc(new Date(y, m - 1, d, 23, 59, 59));
}

/** "Today" / "Yesterday" / "21 Jul 2026", based on the viewer's calendar. */
export function relativeDayLabel(value) {
  const d = parseTimestamp(value);
  if (!d) return '—';

  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return fmtDate(value);
}
