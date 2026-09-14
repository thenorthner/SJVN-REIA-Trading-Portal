import db from '../db/index.js';
import { accruedLps } from '../disputesConstants.js';
import { payerStateForInvoice } from './workingCalendar.js';
import { getParamNumber } from '../mastersService.js';
import { lpsBilled, openOverdueInvoices } from './outstanding.js';

// Late payment surcharge, as a position rather than a column.
//
// The dashboard could say what was billed and what was outstanding, but nothing
// said what the surcharge on it came to: LPS recovered against LPS still
// recoverable is one of the figures the scope asks the REIA dashboard for
// (CP-58-61), and it is the figure that says whether overdue bills are being
// charged for at all.
//
// Three numbers, kept apart because they answer different questions:
//   recovered           LPS on bills that have since been settled in full.
//   billed_outstanding  LPS already raised on a bill that is still open.
//   accrued_unbilled    LPS earned on overdue bills that no bill has charged yet.
//
// The last one is computed with exactly the helper the invoice screen uses —
// same contract rate, same grace days, same escalating MoP steps, same
// working-day count for the payer's state — so a bill and this figure cannot
// disagree about what it has earned.

/** LPS earned on an invoice as of now, over and above what has been charged on it. */
function unbilledOn(invoice, defaults) {
  const contract = db.prepare(
    'SELECT lps_annual_pct, lps_grace_days FROM contracts WHERE id = ?',
  ).get(invoice.contract_id);
  const accrued = accruedLps(invoice, {
    annualPct: contract?.lps_annual_pct ?? defaults.annualPct,
    graceDays: contract?.lps_grace_days ?? 0,
    monthlyStepPct: defaults.monthlyStepPct,
    stepCapPct: defaults.stepCapPct,
    paid: invoice.paid,
    state: payerStateForInvoice(invoice),
  });
  return Math.max(0, (accrued.lps || 0) - (invoice.lps || 0));
}

/**
 * The surcharge position in one direction.
 *
 * @param {'SJVN_TO_BUYER'|'SELLER_TO_SJVN'} direction
 */
export function lpsPosition(direction) {
  const billed = lpsBilled(direction);
  const defaults = {
    annualPct: getParamNumber('lps_annual_pct', 15),
    monthlyStepPct: getParamNumber('lps_monthly_step_pct', 0),
    stepCapPct: getParamNumber('lps_step_cap_pct', 0),
  };

  const overdue = openOverdueInvoices(direction);
  let unbilled = 0;
  let invoicesAccruing = 0;
  for (const invoice of overdue) {
    const extra = unbilledOn(invoice, defaults);
    if (extra > 0) {
      unbilled += extra;
      invoicesAccruing += 1;
    }
  }

  return {
    recovered: billed.recovered,
    billed_outstanding: billed.open_charged,
    accrued_unbilled: Math.round(unbilled),
    // What is still to come in, whether or not a bill has asked for it yet.
    recoverable: Math.round(billed.open_charged + unbilled),
    charged_ever: billed.charged,
    invoices_overdue: overdue.length,
    invoices_accruing_unbilled: invoicesAccruing,
    annual_pct: defaults.annualPct,
  };
}
