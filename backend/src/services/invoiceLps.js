import db from '../db/index.js';
import { accruedLpsTimeline, payableNow } from '../disputesConstants.js';
import { getParamNumber } from '../mastersService.js';
import { computeDueDate } from '../util.js';
import { payerStateForInvoice } from './workingCalendar.js';

// Late Payment Surcharge on an invoice, read off its own payments and debit
// notes. One helper, so the invoice screen, the payment that rolls LPS onto the
// bill, the buyer's outstanding waterfall, payment monitoring and the dashboard
// position cannot disagree about what a bill has earned.

/** The contract's LPS terms, falling back to the masters. */
export function lpsTermsFor(contractId) {
  const c = db.prepare('SELECT lps_annual_pct, lps_grace_days FROM contracts WHERE id = ?').get(contractId);
  return {
    annualPct: c?.lps_annual_pct ?? getParamNumber('lps_annual_pct', 15),
    graceDays: c?.lps_grace_days ?? 0,
    monthlyStepPct: getParamNumber('lps_monthly_step_pct', 0.5),
    stepCapPct: getParamNumber('lps_step_cap_pct', 3),
  };
}

/**
 * Payments against an invoice, as dated amounts off what surcharge is charged
 * on (deductions count as paid). The part of a receipt that was applied to
 * surcharge itself is left out: it paid the surcharge, not the bill, so the
 * bill goes on earning on what is still unpaid of it.
 */
export function invoicePayments(invoiceId) {
  return db.prepare(`
    SELECT amount + COALESCE(deduction, 0) - COALESCE(lps_component, 0) AS amount, payment_date AS date
    FROM payments WHERE invoice_id = ? AND payment_date IS NOT NULL
  `).all(invoiceId);
}

/**
 * LEGACY debit notes on an invoice — the ones folded into its total — each with
 * the due date it carries itself: the contract's payment terms counted from the
 * note's issue. A V2 debit note is its own supplementary invoice and accrues
 * surcharge there, so it is not counted here.
 */
export function invoiceDebitNotes(inv) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'debit_credit_notes'`).get();
  if (!exists) return [];
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
  return db.prepare(`
    SELECT amount, issued_date FROM debit_credit_notes
    WHERE invoice_id = ? AND note_type = 'DEBIT' AND status <> 'CANCELLED' AND COALESCE(model, 'LEGACY') = 'LEGACY'
  `).all(inv.id).map((n) => ({
    amount: n.amount,
    due_date: n.issued_date ? computeDueDate(n.issued_date, contract) : inv.due_date,
  }));
}

/** LPS the invoice has earned as of `asOf`. */
export function invoiceLpsAsOf(inv, asOf = new Date()) {
  if (!inv) return { lps: 0, days_overdue: 0, base: 0 };
  // A surcharge bill is itself surcharge: it earns none (no surcharge on surcharge).
  if (String(inv.invoice_no || '').startsWith('LPS-')) return { lps: 0, days_overdue: 0, base: 0 };
  const t = accruedLpsTimeline(inv, {
    ...lpsTermsFor(inv.contract_id),
    payments: invoicePayments(inv.id),
    notes: invoiceDebitNotes(inv),
    asOf,
    state: payerStateForInvoice(inv),
  });
  // Surcharge already demanded on a separate LPS bill (PM5) is that bill's to
  // collect, not this one's: what this bill carries is the rest.
  const apart = Number(inv.lps_invoiced) || 0;
  if (!(apart > 0)) return t;
  return { ...t, lps: Math.max(0, Math.round(((Number(t.lps) || 0) - apart) * 100) / 100), lps_accrued_total: t.lps, lps_invoiced: apart };
}

/**
 * What is still owed on a bill today, and the pieces that figure is made of.
 *
 * payable_now is the whole bill as it stands — total, less rebate, plus
 * surcharge, less what is disputed — and does not come down as money arrives.
 * This does the rest: surcharge as the bill has earned it to `asOf` rather than
 * as it was frozen at the last payment, less everything recorded against the
 * bill (payments, deductions, credit notes). The invoice screens, the buyer's
 * "left to pay" and the notification board all read it from here, so they
 * cannot give three answers for one bill.
 */
export function invoiceBalance(inv, asOf = new Date()) {
  if (!inv) return { paid: 0, accrued: { days_overdue: 0, lps: 0, base: 0 }, lps_to_date: 0, balance: 0 };
  const paid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
  const closed = ['PAID', 'CANCELLED', 'DRAFT'].includes(inv.status);
  const accrued = closed ? { days_overdue: 0, lps: 0, base: 0 } : invoiceLpsAsOf(inv, asOf);
  const lpsToDate = closed ? (Number(inv.lps) || 0) : Math.max(Number(inv.lps) || 0, Number(accrued.lps) || 0);
  const gross = payableNow({ ...inv, lps: lpsToDate }).payable_now;
  const balance = ['PAID', 'CANCELLED'].includes(inv.status) ? 0 : Math.max(0, Math.round((gross - paid) * 100) / 100);
  return { paid, accrued, lps_to_date: lpsToDate, balance };
}
