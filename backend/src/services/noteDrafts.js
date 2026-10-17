/**
 * A debit or credit note drafted by the platform itself, for a person to
 * approve on the notes desk (decided 17-Oct-2026). Used where an outcome
 * already agreed changes money — an exception SJVN accepts on a reconciliation,
 * a diversion deficit the buyer owes — so that the agreement does not stop at
 * words and leave the books where they were.
 *
 * Same shape as a dispute's resolution note: V2, DRAFT, maker recorded so the
 * maker cannot approve it, Finance told.
 */
import db from '../db/index.js';
import { newId, pushNotification } from '../util.js';

const err = (status, message) => Object.assign(new Error(message), { status });

export function draftNote({ noteType, invoice, amount, reason, reasonCode = 'OTHER', user, sourceKind = null, sourceRef = null }) {
  if (!['DEBIT', 'CREDIT'].includes(noteType)) throw err(400, 'noteType must be DEBIT or CREDIT');
  const total = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(total > 0)) throw err(400, 'A note is for a positive amount');
  if (!invoice) throw err(400, 'A note is raised against a bill');
  if (noteType === 'CREDIT') {
    const live = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) s FROM debit_credit_notes
      WHERE invoice_id = ? AND note_type = 'CREDIT' AND status IN ('DRAFT', 'ISSUED', 'SETTLED') AND model = 'V2'
    `).get(invoice.id).s;
    if (total + live > (Number(invoice.total_amount) || 0) + 0.005) {
      throw err(400, `Credits on ${invoice.invoice_no} would come to ₹${(total + live).toLocaleString('en-IN')}, more than the bill's ₹${Number(invoice.total_amount).toLocaleString('en-IN')}.`);
    }
  }
  const id = newId('DCN');
  db.prepare(`
    INSERT INTO debit_credit_notes (id, note_no, note_type, invoice_id, contract_id, period_month,
      reason_code, amount, taxable_amount, tax_amount, tax_label, reason, status, model, created_by, created_by_id, source_kind, source_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 'DRAFT', 'V2', ?, ?, ?, ?)
  `).run(id, `DRAFT-${id}`, noteType, invoice.id, invoice.contract_id, invoice.billing_period, reasonCode, total, total, reason, user?.name || 'system', user?.id || null, sourceKind, sourceRef);
  pushNotification({
    role: 'FINANCE_USER', type: 'DC_NOTE_FOR_APPROVAL',
    message: `${noteType === 'DEBIT' ? 'Debit' : 'Credit'} note of Rs.${total.toLocaleString('en-IN')} on ${invoice.invoice_no} awaits approval — ${reason}`,
  });
  return db.prepare('SELECT * FROM debit_credit_notes WHERE id = ?').get(id);
}
