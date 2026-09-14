import db from '../db/index.js';
import { accruedLps } from '../disputesConstants.js';
import { payerStateForInvoice } from './workingCalendar.js';
import { getParamNumber } from '../mastersService.js';
import { ageingBuckets, openPosition } from './outstanding.js';

/**
 * Who owes what, how late it is, and what the lateness has earned.
 *
 * The scope asks for payment monitoring with delay days and LPS, developer
 * payments, and an outstanding ageing view (§2, §4, §5). They are one question
 * asked three ways, so this answers it once: every open bill in a direction, with
 * the days it is past due, what is still outstanding on it, the surcharge already
 * raised on it and the surcharge earned since — plus the same figures rolled up
 * per counterparty, which is how a treasury desk actually reads it.
 *
 * Every figure runs on the same outstanding definition as the dashboard KPIs, and
 * the surcharge uses the same helper the invoice screen shows, so no two screens
 * can disagree about one bill.
 */

const OUTSTANDING_SQL = `
  (
    COALESCE(i.total_amount, 0)
    - COALESCE(i.rebate, 0)
    + COALESCE(i.lps, 0)
    - COALESCE(i.disputed_amount, 0)
    - COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0)
  )
`;

const DIRECTIONS = {
  // What buyers owe SJVN, and what SJVN owes the generators.
  RECEIVABLE: 'SJVN_TO_BUYER',
  PAYABLE: 'SELLER_TO_SJVN',
};

/** The counterparty on the other side of a bill, by direction. */
const COUNTERPARTY_JOIN = `
  LEFT JOIN contracts c ON c.id = i.contract_id
  LEFT JOIN entities e ON e.id = CASE WHEN i.direction = 'SJVN_TO_BUYER' THEN c.buyer_id ELSE c.seller_id END
`;

function openBills(direction) {
  return db.prepare(`
    SELECT
      i.id, i.invoice_no, i.contract_id, i.direction, i.billing_period, i.invoice_type,
      i.total_amount, i.rebate, i.lps, i.disputed_amount, i.due_date, i.status,
      c.contract_no, c.lps_annual_pct, c.lps_grace_days,
      e.id AS counterparty_id, e.name AS counterparty_name,
      COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid,
      ${OUTSTANDING_SQL} AS outstanding,
      CASE
        WHEN i.due_date IS NULL THEN NULL
        ELSE CAST(julianday('now') - julianday(i.due_date) AS INTEGER)
      END AS days_past_due
    FROM invoices i
    ${COUNTERPARTY_JOIN}
    WHERE i.direction = ? AND i.status NOT IN ('PAID','CANCELLED') AND ${OUTSTANDING_SQL} > 0
    ORDER BY (i.due_date IS NULL), i.due_date
  `).all(direction);
}

/**
 * Payment monitoring for one direction.
 *
 * @param {'RECEIVABLE'|'PAYABLE'} side
 */
export function paymentMonitoring(side = 'RECEIVABLE') {
  const direction = DIRECTIONS[side] || DIRECTIONS.RECEIVABLE;
  const defaults = {
    annualPct: getParamNumber('lps_annual_pct', 15),
    monthlyStepPct: getParamNumber('lps_monthly_step_pct', 0),
    stepCapPct: getParamNumber('lps_step_cap_pct', 0),
  };

  const bills = openBills(direction).map((bill) => {
    const overdue = (bill.days_past_due ?? 0) > 0;
    const accrued = overdue
      ? accruedLps(bill, {
        annualPct: bill.lps_annual_pct ?? defaults.annualPct,
        graceDays: bill.lps_grace_days ?? 0,
        monthlyStepPct: defaults.monthlyStepPct,
        stepCapPct: defaults.stepCapPct,
        paid: bill.paid,
        state: payerStateForInvoice(bill),
      })
      : { lps: 0, days_overdue: 0 };
    return {
      ...bill,
      days_past_due: bill.days_past_due ?? null,
      // Days the surcharge is actually charged for, which is not the calendar
      // gap when the platform counts working days only.
      surcharge_days: accrued.days_overdue || 0,
      lps_charged: bill.lps || 0,
      lps_accrued_unbilled: Math.max(0, Math.round((accrued.lps || 0) - (bill.lps || 0))),
    };
  });

  // Per counterparty, because that is who gets chased.
  const byCounterparty = new Map();
  for (const bill of bills) {
    const key = bill.counterparty_id || '~unnamed~';
    if (!byCounterparty.has(key)) {
      byCounterparty.set(key, {
        counterparty_id: bill.counterparty_id,
        counterparty_name: bill.counterparty_name || 'Not linked to a counterparty',
        invoices: 0,
        outstanding: 0,
        overdue_invoices: 0,
        overdue_amount: 0,
        lps_charged: 0,
        lps_accrued_unbilled: 0,
        oldest_days_past_due: 0,
      });
    }
    const row = byCounterparty.get(key);
    row.invoices += 1;
    row.outstanding += bill.outstanding;
    row.lps_charged += bill.lps_charged;
    row.lps_accrued_unbilled += bill.lps_accrued_unbilled;
    if ((bill.days_past_due ?? 0) > 0) {
      row.overdue_invoices += 1;
      row.overdue_amount += bill.outstanding;
      row.oldest_days_past_due = Math.max(row.oldest_days_past_due, bill.days_past_due);
    }
  }

  const counterparties = [...byCounterparty.values()].sort((a, b) => b.outstanding - a.outstanding);
  const totals = bills.reduce((acc, b) => ({
    invoices: acc.invoices + 1,
    outstanding: acc.outstanding + b.outstanding,
    overdue_invoices: acc.overdue_invoices + ((b.days_past_due ?? 0) > 0 ? 1 : 0),
    overdue_amount: acc.overdue_amount + ((b.days_past_due ?? 0) > 0 ? b.outstanding : 0),
    lps_charged: acc.lps_charged + b.lps_charged,
    lps_accrued_unbilled: acc.lps_accrued_unbilled + b.lps_accrued_unbilled,
  }), { invoices: 0, outstanding: 0, overdue_invoices: 0, overdue_amount: 0, lps_charged: 0, lps_accrued_unbilled: 0 });

  return {
    side,
    direction,
    as_of: new Date().toISOString().slice(0, 10),
    annual_pct: defaults.annualPct,
    totals: { ...totals, ...openPosition(direction) },
    ageing: ageingBuckets(direction),
    counterparties,
    bills,
  };
}
