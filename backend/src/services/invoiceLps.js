import db from '../db/index.js';
import { accruedLpsTimeline } from '../disputesConstants.js';
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

/** Payments against an invoice, as dated amounts (deductions count as paid). */
export function invoicePayments(invoiceId) {
  return db.prepare(`
    SELECT amount + COALESCE(deduction, 0) AS amount, payment_date AS date
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
  return accruedLpsTimeline(inv, {
    ...lpsTermsFor(inv.contract_id),
    payments: invoicePayments(inv.id),
    notes: invoiceDebitNotes(inv),
    asOf,
    state: payerStateForInvoice(inv),
  });
}
