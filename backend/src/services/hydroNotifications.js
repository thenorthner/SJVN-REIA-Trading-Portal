/**
 * Notifications for hydro station billing.
 *
 * Until this existed the module told nobody anything. A bill went up for
 * approval and waited for the approver to notice it on a screen; it was issued,
 * couriered and surcharged without the beneficiary hearing a word between the
 * bill and the late-payment charge. One NJHPS bill is fifteen beneficiaries, so
 * "someone will see it" is fifteen people not seeing it.
 *
 * Every function here is fire-and-forget: gateway latency must never hold up a
 * billing API response, and a notification that fails is a notification, not a
 * failed bill. dispatch() records each attempt in notification_deliveries, so a
 * message that did not go out is visible afterwards rather than lost.
 *
 * The message bodies are fixed text plus variables, and they have to stay equal
 * to the DLT content templates registered for them — see
 * docs/SMS_Alerts_Single_List.md, rows 13 to 22. Changing a word here without
 * re-registering the template means the operator scrubs the message.
 */
import db from '../db/index.js';
import { dispatch } from './notificationService.js';
import { smsVar } from './smsService.js';

/** Rupees as the bills print them. */
const inr = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN');

/** Fire a dispatch without letting it touch the caller's response. */
function fire(event, payload) {
  dispatch({ event, ...payload })
    .catch((err) => console.error(`[NOTIFY] ${event} failed`, err.message));
}

/**
 * The beneficiaries on a bill that can actually be reached.
 *
 * A hydro beneficiary is a name out of the Regional Energy Account; only some
 * of them are registered entities on this platform, and only a registered
 * entity carries a corporate email or mobile. The rest are skipped rather than
 * guessed at — and the count of them is returned, so a caller (or a test) can
 * say plainly how much of the station is unreachable.
 */
export function reachableBeneficiaries(billId) {
  const lines = db.prepare(`
    SELECT beneficiary_name, beneficiary_id, total_charges, nrldc_fee
    FROM hydro_bill_lines WHERE bill_id = ? ORDER BY sr_no
  `).all(billId);
  const reachable = lines.filter((l) => l.beneficiary_id);
  return { lines, reachable, unreachable: lines.length - reachable.length };
}

/** Sent up the chain: the named approver has a bill waiting. */
export function notifyBillForApproval(bill, approverUserId) {
  if (!approverUserId) return;
  fire('HYDRO_BILL_FOR_APPROVAL', {
    userId: approverUserId,
    subject: `Hydro bill ${bill.bill_no} pending your approval`,
    message: `SJVN: Hydro bill ${bill.bill_no} for ${bill.billing_month} is pending your approval.`,
  });
}

/** The chain closed: the maker can issue it. */
export function notifyBillApproved(bill) {
  if (!bill.created_by) return;
  fire('HYDRO_BILL_APPROVED', {
    userId: bill.created_by,
    subject: `Hydro bill ${bill.bill_no} approved`,
    message: `SJVN: Hydro bill ${bill.bill_no} for ${bill.billing_month} has been approved and can be issued.`,
  });
}

/** Sent back: the maker has to raise a corrected bill. */
export function notifyBillRejected(bill, reason) {
  if (!bill.created_by) return;
  fire('HYDRO_BILL_REJECTED', {
    userId: bill.created_by,
    subject: `Hydro bill ${bill.bill_no} rejected in approval`,
    message: `SJVN: Hydro bill ${bill.bill_no} was rejected in approval. Reason: ${smsVar(reason || 'not stated')}`,
  });
}

/**
 * Issued — the point the bill becomes money each beneficiary owes.
 *
 * A revision carries its own message: it is billing the difference the restated
 * inputs make, and telling a DISCOM the full revised figure is "issued" would
 * read as a second month's bill.
 */
export function notifyBillIssued(bill) {
  const { reachable } = reachableBeneficiaries(bill.id);
  const isRevision = bill.bill_kind === 'REVISION';
  for (const line of reachable) {
    const share = inr(Number(line.total_charges) + Number(line.nrldc_fee || 0));
    fire(isRevision ? 'HYDRO_BILL_REVISED' : 'HYDRO_BILL_ISSUED', {
      entityId: line.beneficiary_id,
      subject: `Hydro bill ${bill.bill_no} — ${bill.billing_month}`,
      message: isRevision
        ? `SJVN: Hydro bill ${bill.bill_no} for ${bill.billing_month} has been revised. `
          + `Differential amount Rs ${inr(bill.differential_amount)}, due ${bill.due_date}.`
        : `SJVN: Hydro bill ${bill.bill_no} for ${bill.billing_month} is issued. `
          + `Your share is Rs ${share}, due ${bill.due_date}.`,
    });
  }
  return reachable.length;
}

/** The printed copy is on its way, with the courier reference to track it. */
export function notifyBillDespatched(bill, { dispatchDate, courierRef }) {
  const { reachable } = reachableBeneficiaries(bill.id);
  for (const line of reachable) {
    fire('HYDRO_BILL_DESPATCHED', {
      entityId: line.beneficiary_id,
      subject: `Hydro bill ${bill.bill_no} despatched`,
      message: `SJVN: Hydro bill ${bill.bill_no} was despatched on ${dispatchDate}. `
        + `Courier reference ${smsVar(courierRef || 'not recorded')}.`,
    });
  }
  return reachable.length;
}

/** Money in, and what is left on the account after it was applied. */
export function notifyPaymentReceived({ contractId, beneficiaryName, beneficiaryId, amount, billNo, outstanding }) {
  fire('HYDRO_PAYMENT_RECEIVED', {
    entityId: beneficiaryId || null,
    role: beneficiaryId ? undefined : 'FINANCE_USER',
    subject: `Payment received — ${smsVar(beneficiaryName)}`,
    message: `SJVN: Payment of Rs ${inr(amount)} received against hydro bill ${billNo || 'account'}. `
      + `Outstanding is now Rs ${inr(outstanding)}.`,
  });
}

/** Surcharge charged — the beneficiary should hear it from us, not find it. */
export function notifyLpsRaised({ beneficiaryName, beneficiaryId, amount, billNo, asOf }) {
  fire('HYDRO_LPS_RAISED', {
    entityId: beneficiaryId || null,
    role: beneficiaryId ? undefined : 'FINANCE_USER',
    subject: `Late payment surcharge — ${smsVar(beneficiaryName)}`,
    message: `SJVN: Late payment surcharge of Rs ${inr(amount)} charged on hydro bill ${billNo} as on ${asOf}.`,
  });
}

/** Withdrawn, and the ledger unwound with it. */
export function notifyBillCancelled(bill, reason) {
  const { reachable } = reachableBeneficiaries(bill.id);
  for (const line of reachable) {
    fire('HYDRO_BILL_CANCELLED', {
      entityId: line.beneficiary_id,
      subject: `Hydro bill ${bill.bill_no} cancelled`,
      message: `SJVN: Hydro bill ${bill.bill_no} for ${bill.billing_month} has been cancelled. `
        + `Reason: ${smsVar(reason)}`,
    });
  }
  return reachable.length;
}
