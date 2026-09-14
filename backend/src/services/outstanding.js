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

/**
 * Outstanding on one set of contracts, on the same formula as the totals above.
 *
 * The counterparty dashboards each did their own arithmetic — billed minus
 * paid — which ignores rebate, LPS and disputed amounts, so SJVN's receivable
 * and the buyer's "pending" disagreed on the same bills.
 */
export function outstandingForContracts(direction, contractIds = []) {
  if (!contractIds.length) return 0;
  const ph = contractIds.map(() => '?').join(',');
  return sum(`i.direction = ? AND ${OPEN} AND i.contract_id IN (${ph})`, [direction, ...contractIds]);
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

// ─────────────────────────────────────────────────────────────────────────────
// How old the outstanding is, and what surcharge it has earned.
//
// Both answer on the same OUTSTANDING_SQL as the totals above, so an ageing
// table can never add up to a different receivable than the KPI beside it.

/** Days past due → bucket name. `date('now')` is the cut, as everywhere else. */
const AGEING_BUCKETS = [
  { bucket: 'NOT_DUE', label: 'Not yet due', where: `(i.due_date IS NULL OR date(i.due_date) >= date('now'))` },
  { bucket: 'DAYS_0_30', label: '1–30 days', where: `date(i.due_date) < date('now') AND date(i.due_date) >= date('now','-30 days')` },
  { bucket: 'DAYS_31_60', label: '31–60 days', where: `date(i.due_date) < date('now','-30 days') AND date(i.due_date) >= date('now','-60 days')` },
  { bucket: 'DAYS_61_90', label: '61–90 days', where: `date(i.due_date) < date('now','-60 days') AND date(i.due_date) >= date('now','-90 days')` },
  { bucket: 'DAYS_90_PLUS', label: 'Over 90 days', where: `date(i.due_date) < date('now','-90 days')` },
];

/**
 * Outstanding in one direction, split by how long it has been due.
 *
 * Only bills with something left on them: a fully collected invoice whose status
 * has not caught up is not ageing debt.
 */
export function ageingBuckets(direction) {
  return AGEING_BUCKETS.map(({ bucket, label, where }) => {
    const row = db.prepare(`
      SELECT COUNT(*) invoices, COALESCE(SUM(${OUTSTANDING_SQL}), 0) amount
      FROM invoices i
      WHERE i.direction = ? AND ${OPEN} AND ${OUTSTANDING_SQL} > 0 AND ${where}
    `).get(direction);
    return { bucket, label, invoices: row.invoices, amount: row.amount };
  });
}

/** What is still open in one direction: how many bills, and how much of it is late. */
export function openPosition(direction) {
  const row = db.prepare(`
    SELECT COUNT(*) invoices, COALESCE(SUM(${OUTSTANDING_SQL}), 0) amount
    FROM invoices i WHERE i.direction = ? AND ${OPEN} AND ${OUTSTANDING_SQL} > 0
  `).get(direction);
  const late = db.prepare(`
    SELECT COUNT(*) invoices, COALESCE(SUM(${OUTSTANDING_SQL}), 0) amount
    FROM invoices i
    WHERE i.direction = ? AND ${OPEN} AND ${OUTSTANDING_SQL} > 0
      AND i.due_date IS NOT NULL AND date(i.due_date) < date('now')
  `).get(direction);
  const disputed = db.prepare(`
    SELECT COUNT(*) invoices, COALESCE(SUM(i.disputed_amount), 0) amount
    FROM invoices i WHERE i.direction = ? AND ${OPEN} AND COALESCE(i.disputed_amount, 0) > 0
  `).get(direction);
  return {
    invoices: row.invoices,
    outstanding: row.amount,
    overdue_invoices: late.invoices,
    overdue_amount: late.amount,
    disputed_invoices: disputed.invoices,
    disputed_amount: disputed.amount,
  };
}

/** Late payment surcharge already raised on bills, and what became of it. */
export function lpsBilled(direction) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(i.lps), 0) AS charged,
      COALESCE(SUM(CASE WHEN i.status = 'PAID' THEN i.lps ELSE 0 END), 0) AS recovered,
      COALESCE(SUM(CASE WHEN i.status NOT IN ('PAID','CANCELLED') THEN i.lps ELSE 0 END), 0) AS open_charged,
      COALESCE(SUM(CASE WHEN i.status = 'CANCELLED' THEN i.lps ELSE 0 END), 0) AS cancelled
    FROM invoices i WHERE i.direction = ?
  `).get(direction);
  return row;
}

/** The open bills a surcharge accrues on, with what each has already been charged. */
export function openOverdueInvoices(direction) {
  return db.prepare(`
    SELECT i.id, i.invoice_no, i.contract_id, i.direction, i.total_amount, i.disputed_amount,
           i.lps, i.due_date, i.status,
           COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid,
           ${OUTSTANDING_SQL} AS outstanding
    FROM invoices i
    WHERE i.direction = ? AND ${OPEN} AND ${OUTSTANDING_SQL} > 0
      AND i.due_date IS NOT NULL AND date(i.due_date) < date('now')
    ORDER BY i.due_date
  `).all(direction);
}
