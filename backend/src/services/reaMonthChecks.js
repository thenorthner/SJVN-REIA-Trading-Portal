/**
 * Checks that keep one month's Regional Energy Account from being filed as
 * another's. Pure functions, so the bill run and the importer share them
 * without either reaching into the other.
 *
 * Why they exist: the "September 2026" NRPC REA imported on 16 Oct 2026 was
 * August's account with its page headers relabelled (478 headers said
 * SEPTEMBER, four sub-table titles still said "for the month of August 2026").
 * It sat in the local REA cache (rea_downloads/NRPC/2026-09), which the
 * importer reads in place of NRPC's site; the importer took the most-named
 * month, filed August's energy as September's
 * and auto-validated it — NJHPS 1,154,794.15 MWh and RHPS 317,031.53 MWh in
 * both months, to the decimal.
 */

/**
 * The account names its own month, and that is the month it is stored under —
 * never the one the request, the cache folder or the file name says. Refused:
 * an account that names no month, one that names another month, and one whose
 * own titles name only some other month than its page headers do
 * (`period_conflict`, from parse_rea.py — an edited copy of another month's
 * account). A single stray month beside the right one is not refused: NRPC's
 * own cover letters carry that typo.
 */
export function checkAccountPeriod(parsed, period) {
  const own = parsed?.period || null;
  if (!own) {
    throw new Error(`This REA does not say which month it is for, so it cannot be filed under ${period}`);
  }
  const conflict = Array.isArray(parsed.period_conflict) ? parsed.period_conflict : [];
  if (conflict.length) {
    throw new Error(`This REA's page headers say ${own} but its own titles say ${conflict.join(', ')} — it looks like another month's account relabelled; not filed under ${period}`);
  }
  if (own !== period) {
    throw new Error(`This REA is for ${own}, not ${period} — check the link`);
  }
  return own;
}

/** `period` (YYYY-MM) moved by `by` months. */
export function shiftMonth(period, by) {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// A month's energy matching the month beside it to the last decimal is not a
// coincidence: it is the other month's account read twice. Such a row is held
// as DISPUTED with a note starting so, and the hydro bill run does not bill on it.
export const SAME_AS_ADJACENT_NOTE = 'Held: energy identical to';

/** Whether an energy row was held by the identical-energy check. */
export function isHeldAsSameAsAdjacent(row) {
  return row?.status === 'DISPUTED' && String(row.deviation_notes || '').startsWith(SAME_AS_ADJACENT_NOTE);
}
