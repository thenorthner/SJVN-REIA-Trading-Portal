/**
 * Move hydro ledger due dates that land on a closed day to the next working day.
 *
 *     node src/scripts/redateHydroDueDates.js           # shows what would change
 *     node src/scripts/redateHydroDueDates.js --apply   # changes it
 *
 * The one-off catch-up for bills posted before due dates followed the
 * beneficiary's working calendar — see services/hydroDueDateRedate.js for what
 * moves and what is left alone. Safe to run twice: a date already on a working
 * day is never touched. Writes one audit entry when it changes anything.
 */
import '../loadEnv.js';
import { planHydroDueDateRedate, applyHydroDueDateRedate } from '../services/hydroDueDateRedate.js';

const apply = process.argv.includes('--apply');
const r = apply ? applyHydroDueDateRedate() : planHydroDueDateRedate();

console.log(`Checked ${r.checked} bill(s): ${r.unchanged} already on a working day, ${r.changes.length} to move, ${r.skipped.length} left alone.`);
for (const c of r.changes) {
  console.log(`  ${c.doc_no}  ${c.beneficiary_name} (${c.state || 'national only'})  ${c.before} → ${c.after}  [${c.reason}]  LPS to date ${c.lps_before} → ${c.lps_after}`);
}
for (const s of r.skipped) {
  console.log(`  left: ${s.doc_no}  ${s.beneficiary_name}  ${s.before} (would be ${s.after}) — ${s.why}`);
}
console.log(apply ? `Applied: ${r.applied} due date(s) moved.` : 'Nothing written. Run with --apply to make these changes.');
