import db from '../db/index.js';
import { accruedLpsTimeline, payableNow } from '../disputesConstants.js';
import { getParamNumber, getParam } from '../mastersService.js';
import { computeDueDate } from '../util.js';
import { payerStateForInvoice } from './workingCalendar.js';
import { isSurchargeBill } from './billReason.js';

// Late Payment Surcharge on an invoice, read off its own payments and debit
// notes. One helper, so the invoice screen, the payment that rolls LPS onto the
// bill, the buyer's outstanding waterfall, payment monitoring and the dashboard
// position cannot disagree about what a bill has earned.

/**
 * The LPS base rate for a day, from the masters' schedule: the rate in force on
 * 1 April of the financial year the day falls in (LPS Rules 2022 r.2(1)(b) —
 * SBI's one-year MCLR "as applicable on the 1st April of the financial year in
 * which the period lies", plus 5%). A row dated mid-year waits for the next
 * 1 April. With one master rate, changing it each April re-priced every day of
 * default on every bill still open, back to its due date (1-Nov-2026).
 * Returns null where the schedule has nothing for that year.
 */
export function lpsBaseRateSchedule() {
  const rows = getParam('lps_base_rate_schedule', []);
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.from)) && Number.isFinite(Number(r.pct)))
    .map((r) => ({ from: String(r.from), pct: Number(r.pct) }))
    .sort((a, b) => a.from.localeCompare(b.from));
}
/** A day → base rate function from the schedule, or null where none is kept. */
export function scheduledBaseRate(fallback) {
  return baseRateFromSchedule(lpsBaseRateSchedule(), fallback);
}
function baseRateFromSchedule(rows, fallback) {
  if (!rows.length) return null;
  const memo = new Map();
  return (t) => {
    const d = new Date(t);
    const fyStartYear = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    if (memo.has(fyStartYear)) return memo.get(fyStartYear);
    const april1 = `${fyStartYear}-04-01`;
    let pct = null;
    for (const r of rows) if (r.from <= april1) pct = r.pct;
    memo.set(fyStartYear, pct ?? fallback);
    return memo.get(fyStartYear);
  };
}

/** The contract's LPS terms, falling back to the masters. */
export function lpsTermsFor(contractId) {
  const c = db.prepare('SELECT lps_annual_pct, lps_grace_days FROM contracts WHERE id = ?').get(contractId);
  const masterPct = getParamNumber('lps_annual_pct', 15);
  // A contract's own rate is its own; the schedule replaces the master rate only.
  const own = c?.lps_annual_pct != null;
  return {
    annualPct: own ? c.lps_annual_pct : masterPct,
    baseRateOn: own ? null : scheduledBaseRate(masterPct),
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
 *
 * Credit agreed on a dispute about this bill counts from the bill's due date:
 * that part was never owed. Dated the day its note was approved, it charged a
 * buyer who won its dispute surcharge on the amount it won, for as long as the
 * dispute took (31-Oct-2026).
 */
export function invoicePayments(invoiceId) {
  return db.prepare(`
    SELECT p.amount + COALESCE(p.deduction, 0) - COALESCE(p.lps_component, 0) AS amount,
      CASE WHEN p.mode = 'CREDIT_NOTE' AND i.due_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM debit_credit_notes n JOIN disputes d ON d.resolution_note_id = n.id
        WHERE n.note_no = p.reference AND n.invoice_id = p.invoice_id AND d.invoice_id = p.invoice_id
      ) THEN MIN(p.payment_date, substr(i.due_date, 1, 10)) ELSE p.payment_date END AS date
    FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.invoice_id = ? AND p.payment_date IS NOT NULL
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
  // A surcharge bill is itself surcharge: it earns none (no surcharge on
  // surcharge) — the month's LPS bill, and a supplementary or debit note raised for it.
  if (isSurchargeBill(inv)) return { lps: 0, days_overdue: 0, base: 0 };
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
