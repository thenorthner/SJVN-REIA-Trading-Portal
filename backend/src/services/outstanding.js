import db from '../db/index.js';

// What is still owed, as opposed to what was once billed.
//
// Receivables and payables were SUM(total_amount) over invoices not marked PAID
// or CANCELLED. A part-paid invoice is neither, so it counted at full face
// value however much had already been collected against it — on this database a
// bill with 3.67 crore banked against 6.12 crore was still being reported at
// 6.12 crore, and the payables figure overstated by the whole 3.72 crore that
// had actually been disbursed.
//
// PARTIALLY_PAID is the status the payment routes set the moment a short
// payment lands, so the overstatement grows precisely as money comes in, which
// is the opposite of what a treasury figure is read for.
//
// The per-invoice definition here is the same one the invoice screen shows —
// payable_now less what has been paid — so a bill and the dashboard counting it
// cannot disagree.

/** Charges outstanding on an invoice: what is payable, less what has been paid. */
const OUTSTANDING_SQL = `
  (
    COALESCE(i.total_amount, 0)
    - COALESCE(i.rebate, 0)
    + COALESCE(i.lps, 0)
    - COALESCE(i.disputed_amount, 0)
    - COALESCE((
        SELECT SUM(p.amount + COALESCE(p.deduction, 0))
        FROM payments p WHERE p.invoice_id = i.id
      ), 0)
  )
`;

const OPEN = `i.status NOT IN ('PAID','CANCELLED')`;

function sum(where, params = []) {
  return db.prepare(`SELECT COALESCE(SUM(${OUTSTANDING_SQL}), 0) s FROM invoices i WHERE ${where}`).get(...params).s;
}

/** Still collectible from buyers. */
export function receivablesOutstanding() {
  return sum(`i.direction = 'SJVN_TO_BUYER' AND ${OPEN}`);
}

/** Still owed to generators. */
export function payablesOutstanding() {
  return sum(`i.direction = 'SELLER_TO_SJVN' AND ${OPEN}`);
}

/** Receivable that is already past its due date. */
export function overdueReceivable() {
  return sum(`i.direction = 'SJVN_TO_BUYER' AND ${OPEN} AND i.due_date IS NOT NULL AND i.due_date < date('now')`);
}

/**
 * Invoices past due and not settled.
 *
 * Counted rather than summed, and a bill whose balance has been cleared to zero
 * without the status catching up is not overdue for any amount.
 */
export function overdueCount() {
  return db.prepare(`
    SELECT COUNT(*) c FROM invoices i
    WHERE ${OPEN} AND i.due_date IS NOT NULL AND i.due_date < date('now')
      AND ${OUTSTANDING_SQL} > 0
  `).get().c;
}
