import db from '../db/index.js';

// What is still open on a contract that is being ended.
//
// Terminating one only set a status, a reason and a date. Nothing looked at
// whether money was still owed either way, and nothing touched the security
// instruments the contract had been running on — so a contract could be closed
// with a crore and a half unbilled against it and two live bank guarantees, and
// the record gave no sign that anything remained to be done.
//
// The position is computed rather than stored, so it is always the current answer
// and cannot drift from the invoices and instruments it describes.

/** Charges outstanding on an invoice: what is payable, less what has been paid. */
const OUTSTANDING = `
  (
    COALESCE(i.total_amount, 0) - COALESCE(i.rebate, 0) + COALESCE(i.lps, 0)
    - COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0)
  )
`;

/**
 * The settlement position on a contract.
 *
 * Reported by direction because the two are not the same conversation: money the
 * buyer still owes SJVN is a collection, money SJVN still owes the generator is a
 * payment, and netting them into one figure would hide whichever is smaller.
 */
export function settlementPosition(contractId) {
  const open = db.prepare(`
    SELECT i.id, i.invoice_no, i.direction, i.status, i.billing_period,
           ROUND(${OUTSTANDING}, 2) AS outstanding
    FROM invoices i
    WHERE i.contract_id = ? AND i.status NOT IN ('PAID','CANCELLED')
    ORDER BY i.billing_period
  `).all(contractId).filter((r) => Math.abs(r.outstanding) > 0.5);

  const receivable = open.filter((r) => r.direction === 'SJVN_TO_BUYER').reduce((a, r) => a + r.outstanding, 0);
  const payable = open.filter((r) => r.direction === 'SELLER_TO_SJVN').reduce((a, r) => a + r.outstanding, 0);

  let security = [];
  try {
    security = db.prepare(`
      SELECT id, instrument_no, mechanism_type, limit_amount, utilized_amount, status, validity_end
      FROM payment_security
      WHERE contract_id = ? AND status = 'ACTIVE'
    `).all(contractId);
  } catch {
    security = [];   // deployments without the payment-security tables
  }

  let openDisputes = 0;
  try {
    openDisputes = db.prepare(`
      SELECT COUNT(*) c FROM disputes d JOIN invoices i ON i.id = d.invoice_id
      WHERE i.contract_id = ? AND d.status NOT IN ('CLOSED','RESOLVED_ACCEPTED','RESOLVED_REJECTED')
    `).get(contractId).c;
  } catch {
    openDisputes = 0;
  }

  const outstandingInvoices = open.length;
  return {
    settled: outstandingInvoices === 0 && security.length === 0 && openDisputes === 0,
    receivable_from_buyer: Math.round(receivable),
    payable_to_generator: Math.round(payable),
    outstanding_invoices: open.map((r) => ({
      invoice_no: r.invoice_no, direction: r.direction, status: r.status,
      billing_period: r.billing_period, outstanding: Math.round(r.outstanding),
    })),
    active_security: security.map((s) => ({
      instrument_no: s.instrument_no, mechanism_type: s.mechanism_type,
      limit_amount: s.limit_amount, utilized_amount: s.utilized_amount, validity_end: s.validity_end,
    })),
    open_disputes: openDisputes,
  };
}

/**
 * What still has to happen before this contract can be closed, in words.
 *
 * Returned alongside the numbers because "two guarantees are still live" is the
 * part someone has to act on, and a bare amount does not say that.
 */
export function settlementActions(position) {
  const todo = [];
  if (position.payable_to_generator > 0) {
    todo.push(`Release or write back ₹${position.payable_to_generator.toLocaleString('en-IN')} still payable to the generator.`);
  }
  if (position.receivable_from_buyer > 0) {
    todo.push(`Recover ₹${position.receivable_from_buyer.toLocaleString('en-IN')} still receivable from the buyer, or draw on security.`);
  }
  if (position.open_disputes > 0) {
    todo.push(`Resolve ${position.open_disputes} open dispute(s) — the amount at stake is not final until they close.`);
  }
  for (const s of position.active_security) {
    todo.push(`Decide whether to release or forfeit ${s.mechanism_type} ${s.instrument_no ?? ''}`.trim() + '.');
  }
  return todo;
}
