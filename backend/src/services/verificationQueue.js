import db from '../db/index.js';
import { buildTemplate, mergeSaved, rollupStatus } from './invoiceVerification.js';

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

// A bill nobody is waiting on any more.
const CLOSED = ['PAID', 'CANCELLED', 'REJECTED'];

const OUTSTANDING_SQL = `
  (
    COALESCE(i.total_amount, 0) - COALESCE(i.rebate, 0) + COALESCE(i.lps, 0)
    - COALESCE(i.disputed_amount, 0)
    - COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0)
  )
`;

export function verificationQueue({ status = null, contractId = null, includeClosed = false } = {}) {
  const where = ["i.direction = 'SELLER_TO_SJVN'"];
  const params = [];
  if (!includeClosed) {
    where.push(`i.status NOT IN (${CLOSED.map(() => '?').join(',')})`);
    params.push(...CLOSED);
  }
  if (contractId) { where.push('i.contract_id = ?'); params.push(contractId); }

  const invoices = db.prepare(`
    SELECT
      i.*, c.contract_no, c.project_type, c.capacity_mw,
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
    let saved = null;
    try { saved = invoice.verification_json ? JSON.parse(invoice.verification_json) : null; } catch { /* ignore */ }
    const checklist = mergeSaved(buildTemplate(invoice), saved);
    const state = invoice.verification_status || rollupStatus(checklist.technical);

    const failed = checklist.technical.filter((t) => t.status === 'FAILED');
    const pending = checklist.technical.filter((t) => t.status === 'PENDING');

    // What the commercial build-up says the bill should come to, against what it
    // was raised for. A gap here is the thing the commercial check exists to find.
    const commercialNet = Number(checklist.commercial?.net_invoice) || 0;
    const raised = Number(invoice.total_amount) || 0;
    const commercialGap = Math.round(commercialNet - raised);

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
      verified_by: invoice.verified_by,
      verified_at: invoice.verified_at,
      days_since_raised: invoice.days_since_raised,
      technical: checklist.technical,
      commercial: checklist.commercial,
      failed_checks: failed.map((t) => t.label),
      pending_checks: pending.map((t) => t.label),
      commercial_net: commercialNet,
      commercial_gap: commercialGap,
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
      oldest_days: rows.reduce((a, r) => Math.max(a, r.days_since_raised || 0), 0),
    },
    blockers,
    invoices: rows,
  };
}
