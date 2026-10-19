/**
 * A real calendar day written YYYY-MM-DD.
 *
 * The pattern alone let 2026-02-30 through, and Date.parse reads it as
 * 2 March rather than refusing it — a payment, LC, statement or TDS entry was
 * recorded on a day that does not exist (Thermal QA runs 8, 12–14).
 */
export function isRealDay(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
