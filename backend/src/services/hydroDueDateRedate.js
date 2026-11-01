/**
 * Bring hydro ledger due dates already on the books onto the working calendar.
 *
 * Until 30-Oct-2026 a station bill fell due on bill date + terms in bare
 * calendar days, so a beneficiary's bill could fall due on a Sunday, Diwali or
 * its own state's holiday, and surcharge ran from that day. New bills roll the
 * last day to the beneficiary's next working day (postBillToLedger); this does
 * the same for the bills posted before that.
 *
 * Only a date that lands on a closed day moves, and only forward, to the next
 * working day on the beneficiary's calendar — what a fresh posting would give
 * for a date taken from the bill. A date that is already a working day is left
 * as it is, so running this twice changes nothing the second time.
 *
 * Left alone, and reported:
 *   - reversed bills: history, not money anyone owes;
 *   - a bill with surcharge already posted on it: that LPS document was worked
 *     out from the old date, and moving the date under it would leave booked
 *     money with no basis;
 *   - a bill whose rebate was booked under a rebate counted from the due date:
 *     moving the date would change the rebate already allowed.
 */
import db from '../db/index.js';
import { logAudit } from '../util.js';
import { rollForwardToWorkingDay, nonWorkingReason } from './workingCalendar.js';
import { beneficiaryState, lpsOnBill, lpsOptionsFor } from './hydroLedger.js';

const day = (d) => String(d).slice(0, 10);

/** What re-dating would do, without writing anything. */
export function planHydroDueDateRedate({ asOf = new Date() } = {}) {
  const bills = db.prepare(`
    SELECT d.*, c.contract_no, c.rebate_basis
    FROM hydro_ledger_docs d LEFT JOIN contracts c ON c.id = d.contract_id
    WHERE d.doc_type = 'PB' AND d.due_date IS NOT NULL
    ORDER BY d.due_date, d.doc_no
  `).all();

  const lpsPosted = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) s FROM hydro_ledger_docs
    WHERE doc_type = 'LPS' AND status = 'OPEN' AND bill_id IS ? AND beneficiary_name = ?
  `);
  const rebateBooked = db.prepare(`
    SELECT COALESCE(SUM(c.amount), 0) s FROM hydro_ledger_clearings c
    JOIN hydro_ledger_docs r ON r.id = c.credit_doc_id
    WHERE c.debit_doc_id = ? AND r.mode = 'REBATE' AND r.status = 'OPEN'
  `);

  const changes = [];
  const skipped = [];
  let unchanged = 0;
  for (const b of bills) {
    const state = beneficiaryState(b);
    const before = day(b.due_date);
    const after = rollForwardToWorkingDay(before, state);
    if (after === before) { unchanged += 1; continue; }

    const row = {
      id: b.id, doc_no: b.doc_no, contract_no: b.contract_no, beneficiary_name: b.beneficiary_name,
      state, before, after, reason: nonWorkingReason(before, state),
    };
    if (b.status !== 'OPEN') { skipped.push({ ...row, why: 'reversed bill' }); continue; }
    if (b.bill_id && lpsPosted.get(b.bill_id, b.beneficiary_name).s > 0) {
      skipped.push({ ...row, why: 'surcharge already posted on it from the old date' });
      continue;
    }
    if (b.rebate_basis === 'DUE_DATE' && rebateBooked.get(b.id).s > 0) {
      skipped.push({ ...row, why: 'rebate already booked, counted from the due date' });
      continue;
    }

    const opts = lpsOptionsFor(b.contract_id, asOf);
    row.lps_before = lpsOnBill({ ...b, due_date: before }, opts).lps;
    row.lps_after = lpsOnBill({ ...b, due_date: after }, opts).lps;
    changes.push(row);
  }
  return { checked: bills.length, unchanged, changes, skipped };
}

/** Re-date the bills the plan moves, in one transaction, with an audit entry. */
export function applyHydroDueDateRedate({ asOf = new Date(), user = null } = {}) {
  const plan = planHydroDueDateRedate({ asOf });
  if (!plan.changes.length) return { ...plan, applied: 0 };

  const update = db.prepare('UPDATE hydro_ledger_docs SET due_date = ? WHERE id = ? AND due_date = ?');
  let applied = 0;
  db.transaction(() => {
    for (const c of plan.changes) applied += update.run(c.after, c.id, c.before).changes;
  })();

  logAudit({
    user: user || { id: null, name: 'SYSTEM', role: 'SYSTEM' },
    action: 'REDATE_HYDRO_DUE_DATES',
    module: 'HYDRO',
    entityType: 'hydro_ledger_docs',
    entityId: null,
    beforeValue: plan.changes.map((c) => ({ doc_no: c.doc_no, due_date: c.before })),
    afterValue: plan.changes.map((c) => ({ doc_no: c.doc_no, due_date: c.after })),
    reason: 'Due dates landing on a beneficiary\'s weekly off or holiday moved to its next working day (working-calendar rule of 30-Oct-2026)',
    details: {
      applied,
      skipped: plan.skipped.map((s) => ({ doc_no: s.doc_no, why: s.why })),
      lps_before: plan.changes.reduce((a, c) => a + c.lps_before, 0),
      lps_after: plan.changes.reduce((a, c) => a + c.lps_after, 0),
    },
  });
  return { ...plan, applied };
}
