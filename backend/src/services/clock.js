// Asking the system what a date other than today looks like.
//
// Two different needs got conflated before this existed, and neither was served:
// end-to-end testing had no way to advance time, so a due date or an SLA could
// only be moved by writing to the database directly; and finance had no way to
// ask what a position becomes at a future date without waiting for it.
//
// They are answered separately here, because they carry different risk.
//
//   as_of   a read-only projection. Compute this figure as at that date and
//           change nothing. Safe anywhere, including production, and genuinely
//           useful — "what LPS will this buyer owe us at year end" is a real
//           question with no other way to ask it.
//
//   sandbox actually moving a record's dates so scheduled work sees them as
//           past due. This mutates, so it is refused unless the environment
//           opts in, and it is never on by default.

/** ISO date or datetime, so `as_of=2026-03-31` and a full timestamp both work. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;

/**
 * The date a request wants its figures computed as at, or now.
 *
 * Throws on a malformed value rather than silently falling back to today: a
 * mistyped as_of that quietly answers for the wrong date is worse than an error,
 * because the number still looks like an answer.
 */
export function asOfFrom(req) {
  const raw = req?.query?.as_of ?? req?.body?.as_of;
  if (raw === undefined || raw === null || raw === '') return new Date();
  const text = String(raw).trim();
  if (!ISO_DATE.test(text)) {
    const err = new Error(`as_of must be YYYY-MM-DD or a full timestamp, got "${text}"`);
    err.status = 400;
    throw err;
  }
  // Parsed as UTC. A date-only as_of is a calendar date, not an instant in the
  // reader's timezone: parsing "2027-06-30" as local midnight and reporting it
  // back through toISOString lands on the 29th anywhere east of Greenwich.
  const [y, m, d] = text.slice(0, 10).split('-').map(Number);
  const parsed = new Date(`${text.slice(0, 10)}T${text.length > 10 ? text.slice(11) : '00:00:00'}Z`);
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error(`as_of is not a real date: "${text}"`);
    err.status = 400;
    throw err;
  }
  // Date rolls 2026-02-31 forward to 3 March rather than refusing it, so a
  // typo'd day silently answers for a different date. Check it came back out
  // as the date that went in.
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) {
    const err = new Error(`as_of is not a real date: "${text}"`);
    err.status = 400;
    throw err;
  }
  return parsed;
}

/** Whether the caller asked for a date other than now. */
export function isProjection(req) {
  const raw = req?.query?.as_of ?? req?.body?.as_of;
  return raw !== undefined && raw !== null && raw !== '';
}

/**
 * Whether this deployment allows time to be moved rather than merely projected.
 *
 * Off unless SJVN_SANDBOX is set, and never on when NODE_ENV says production —
 * an env var set by accident on a live box should not be enough to let someone
 * backdate a real invoice into surcharge.
 */
export function sandboxEnabled() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.SJVN_SANDBOX === '1' || process.env.SJVN_SANDBOX === 'true';
}
