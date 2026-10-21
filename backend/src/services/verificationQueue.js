import db from '../db/index.js';
import { contractIdInVerticalSql } from './verticals.js';
import { getParamNumber } from '../mastersService.js';
import { liveVerification, OPEN_FOR_VERIFICATION, DECIDED } from './invoiceVerification.js';
import { raisedBySellerSql } from './counterpartyScope.js';

/**
 * Every developer bill waiting to be verified, and what each one is waiting on.
 *
 * The checklist itself has existed for a while — technical items (REA, energy,
 * tariff, capacity, CUF, COD, curtailment, change-in-law) and the commercial
 * build-up — but only inside one invoice at a time. A desk with forty bills open
 * had to open forty of them to find out which two were stuck, and on what.
 *
 * The checklist here is the same template the invoice screen draws, merged with
 * whatever the verifier has saved, so the queue and the bill cannot disagree.
 */

const OUTSTANDING_SQL = `
  (
    COALESCE(i.total_amount, 0) - COALESCE(i.rebate, 0) + COALESCE(i.lps, 0)
    - COALESCE(i.disputed_amount, 0)
    - COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0)
  )
`;

// The queue is the developers' own bills that are with SJVN for a decision. It
// used to take every Seller → SJVN bill not closed: SJVN's computed bills (the
// twin of the developer's invoice for the same month) and DSM pool bills, whose
// zero tariff made every one of them "fail" the tariff check, so four of the
// seven rows — and the whole "Failed a check" count — were not developer bills.
/** V2: days a bill has been with SJVN against the verification window. */
function slaFor(invoice, state) {
  const window = Number(invoice.verification_window_days) > 0 ? Number(invoice.verification_window_days) : getParamNumber('verification_window_days', 15);
  const days = Number(invoice.days_since_raised) || 0;
  const done = state === 'VERIFIED';
  const level = done ? 'DONE' : days > window ? 'RED' : days >= Math.ceil(window * 0.7) ? 'AMBER' : 'GREEN';
  const dueOn = new Date(Date.parse(`${String(invoice.created_at).slice(0, 10)}T00:00:00Z`) + window * 86400000).toISOString().slice(0, 10);
  return { window_days: window, days, level, due_on: dueOn, days_left: window - days };
}

export function verificationQueue({ status = null, contractId = null, includeClosed = false } = {}) {
  const where = [raisedBySellerSql('i'), contractIdInVerticalSql('REIA', 'i.contract_id')];
  const params = [];
  if (!includeClosed) {
    where.push(`i.status IN (${OPEN_FOR_VERIFICATION.map(() => '?').join(',')})`);
    params.push(...OPEN_FOR_VERIFICATION);
  }
  if (contractId) { where.push('i.contract_id = ?'); params.push(contractId); }

  const invoices = db.prepare(`
    SELECT
      i.*, c.contract_no, c.project_type, c.capacity_mw, c.verification_window_days,
      e.name AS developer_name,
      ${OUTSTANDING_SQL} AS outstanding,
      CAST(julianday('now') - julianday(i.created_at) AS INTEGER) AS days_since_raised
    FROM invoices i
    LEFT JOIN contracts c ON c.id = i.contract_id
    LEFT JOIN entities e ON e.id = c.seller_id
    WHERE ${where.join(' AND ')}
    ORDER BY i.created_at DESC
  `).all(...params);

  const rows = invoices.map((invoice) => {
    // Worked out from the figures as they stand, not read off the stored status.
    const checklist = liveVerification(invoice);
    const state = checklist.verification_status;

    const failed = checklist.technical.filter((t) => t.status === 'FAILED');
    const pending = checklist.technical.filter((t) => t.status === 'PENDING');

    // What the commercial build-up says the bill should come to, against what it
    // was raised for. A gap here is the thing the commercial check exists to find.
    const commercialNet = Number(checklist.commercial?.net_invoice) || 0;
    const raised = Number(invoice.total_amount) || 0;
    const commercialGap = checklist.commercial_gap;

    return {
      invoice_id: invoice.id,
      invoice_no: invoice.invoice_no,
      contract_id: invoice.contract_id,
      contract_no: invoice.contract_no,
      developer_name: invoice.developer_name,
      project_type: invoice.project_type,
      billing_period: invoice.billing_period,
      invoice_type: invoice.invoice_type,
      status: invoice.status,
      total_amount: raised,
      outstanding: invoice.outstanding,
      energy_mwh: invoice.energy_mwh,
      validation_status: invoice.validation_status,
      verification_status: state,
      verified_by: state === 'VERIFIED' ? invoice.verified_by : null,
      verified_at: state === 'VERIFIED' ? invoice.verified_at : null,
      started: checklist.started,
      days_since_raised: invoice.days_since_raised,
      technical: checklist.technical,
      commercial: checklist.commercial,
      failed_checks: [...failed.map((t) => t.label), ...(commercialGap ? ['Commercial build-up'] : [])],
      pending_checks: pending.map((t) => t.label),
      commercial_net: commercialNet,
      commercial_gap: commercialGap,
      // V2: the verification window — the PPA's, else the master — and where
      // the bill stands in it.
      sla: slaFor(invoice, state),
    };
  }).filter((r) => !status || r.verification_status === status);

  // Worst first: a failed check is a bill that cannot be paid as it stands, then
  // whatever has been waiting longest.
  const order = { FAILED: 0, IN_PROGRESS: 1, PENDING: 2, VERIFIED: 3 };
  rows.sort((a, b) => (order[a.verification_status] ?? 9) - (order[b.verification_status] ?? 9)
    || (b.days_since_raised ?? 0) - (a.days_since_raised ?? 0));

  const counts = rows.reduce((acc, r) => {
    acc[r.verification_status] = (acc[r.verification_status] || 0) + 1;
    return acc;
  }, {});

  // Which check is holding the most bills up — the one worth fixing first.
  const byCheck = new Map();
  for (const row of rows) {
    for (const label of row.failed_checks) {
      byCheck.set(label, (byCheck.get(label) || 0) + 1);
    }
  }
  const blockers = [...byCheck.entries()]
    .map(([label, invoices_blocked]) => ({ label, invoices_blocked }))
    .sort((a, b) => b.invoices_blocked - a.invoices_blocked);

  // Bills already approved, sent or paid with no completed verification —
  // before the approval gate existed, or by any route around it.
  const decidedUnverified = db.prepare(`
    SELECT i.id AS invoice_id, i.invoice_no, i.total_amount, i.status, i.verification_status FROM invoices i
    WHERE ${raisedBySellerSql('i')} AND i.status IN (${DECIDED.map(() => '?').join(',')})
      AND COALESCE(i.verification_status, '') <> 'VERIFIED'
      ${contractId ? 'AND i.contract_id = ?' : ''}
    ORDER BY i.created_at
  `).all(...DECIDED, ...(contractId ? [contractId] : []));

  return {
    totals: {
      invoices: rows.length,
      failed: counts.FAILED || 0,
      in_progress: counts.IN_PROGRESS || 0,
      pending: counts.PENDING || 0,
      verified: counts.VERIFIED || 0,
      value_awaiting: rows
        .filter((r) => r.verification_status !== 'VERIFIED')
        .reduce((a, r) => a + r.total_amount, 0),
      oldest_days: rows
        .filter((r) => r.verification_status !== 'VERIFIED')
        .reduce((a, r) => Math.max(a, r.days_since_raised || 0), 0),
      approved_unverified: decidedUnverified.length,
      sla_red: rows.filter((r) => r.sla.level === 'RED').length,
      sla_amber: rows.filter((r) => r.sla.level === 'AMBER').length,
      approved_unverified_value: decidedUnverified.reduce((a, r) => a + (Number(r.total_amount) || 0), 0),
    },
    approved_unverified: decidedUnverified,
    blockers,
    invoices: rows,
  };
}
