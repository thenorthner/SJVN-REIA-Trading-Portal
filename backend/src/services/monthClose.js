/**
 * Month-close (Batch 2, 17-Oct-2026: R1, L2), extending the billing readiness
 * board (B5) to the whole close of a month:
 *   billing        — energy locked, PPA bill in, billed (B5)
 *   reconciliation — which contracts' months can be reconciled, and what each
 *                    waits on (R1), and where their statements stand
 *   posting        — the open items Finance should see before it books the
 *                    month (L2): bills still in approval, energy not locked,
 *                    energy locked but unbilled, developer bills not verified,
 *                    draft notes, open disputes, advances not applied
 * It reports; it does not stop Finance posting what is ready.
 */
import db from '../db/index.js';
import { readinessBoard } from './billingReadiness.js';
import { reconReadiness } from '../reconciliationEngine.js';
import { OPEN_STATUSES as OPEN_DISPUTES } from '../disputesConstants.js';

const money = (v) => Math.round(Number(v) || 0);
const IN_APPROVAL = ['DRAFT', 'SUBMITTED', 'PENDING_L2', 'UNDER_APPROVAL', 'REJECTED'];

export function postingChecklist(period) {
  const ph = (a) => a.map(() => '?').join(',');
  const inApproval = db.prepare(`
    SELECT i.id, i.invoice_no, i.status, i.total_amount, c.contract_no FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE i.billing_period = ? AND i.status IN (${ph(IN_APPROVAL)}) ORDER BY i.created_at
  `).all(period, ...IN_APPROVAL);
  const unlocked = db.prepare(`
    SELECT e.id, e.status, e.energy_mwh, c.contract_no FROM energy_data e JOIN contracts c ON c.id = e.contract_id
    WHERE e.period_month = ? AND e.status IN ('VALIDATED', 'DISPUTED')
      -- REIA's books: the hydro / thermal desks close their own months.
      AND COALESCE(c.project_type, '') NOT IN ('Hydro', 'HYDRO', 'PSP', 'Thermal', 'THERMAL')
      AND NOT EXISTS (SELECT 1 FROM energy_data l WHERE l.contract_id = e.contract_id AND l.period_month = e.period_month AND l.status = 'LOCKED')
  `).all(period);
  const board = readinessBoard(period);
  const unbilled = board.rows.filter((r) => r.state === 'READY').map((r) => ({ contract_no: r.contract_no, energy_mwh: r.energy.energy_mwh ?? null }));
  const unverified = db.prepare(`
    SELECT i.id, i.invoice_no, i.status, i.total_amount, c.contract_no, i.verification_status FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE i.billing_period = ? AND i.direction = 'SELLER_TO_SJVN' AND TRIM(COALESCE(i.invoice_breakdown_json, '')) = ''
      AND i.status IN ('SUBMITTED', 'UNDER_APPROVAL') AND COALESCE(i.verification_status, '') <> 'VERIFIED'
  `).all(period);
  const draftNotes = db.prepare(`
    SELECT n.id, n.note_type, n.amount, n.reason, i.invoice_no FROM debit_credit_notes n JOIN invoices i ON i.id = n.invoice_id
    WHERE COALESCE(n.period_month, i.billing_period) = ? AND n.status = 'DRAFT'
  `).all(period);
  const disputes = db.prepare(`
    SELECT d.id, d.dispute_no, d.status, d.disputed_amount, i.invoice_no FROM disputes d JOIN invoices i ON i.id = d.invoice_id
    WHERE i.billing_period = ? AND d.status IN (${ph(OPEN_DISPUTES)})
  `).all(period, ...OPEN_DISPUTES);
  const advances = db.prepare(`
    SELECT r.id, r.receipt_no, r.balance, e.name AS counterparty FROM unapplied_receipts r LEFT JOIN entities e ON e.id = r.entity_id
    WHERE r.status = 'OPEN' ORDER BY r.received_on
  `).all();

  const item = (key, label, rows, amountOf = null, hint = null) => ({
    key, label, count: rows.length, amount: amountOf ? money(rows.reduce((t, r) => t + (Number(amountOf(r)) || 0), 0)) : null,
    rows: rows.slice(0, 25), clear: rows.length === 0, hint,
  });
  const items = [
    item('BILLS_IN_APPROVAL', 'Bills for the month still in draft or approval', inApproval, (r) => r.total_amount, 'They are not booked until approved and presented.'),
    item('ENERGY_NOT_LOCKED', 'Energy recorded but not locked', unlocked, null, 'Nothing is billed on it until it is locked.'),
    item('ENERGY_UNBILLED', 'Energy locked but not billed', unbilled, null, 'Raise them from the readiness board.'),
    item('UNVERIFIED_DEV_BILLS', 'Developer bills not verified', unverified, (r) => r.total_amount, 'A purchase is booked once SJVN has accepted the bill.'),
    item('DRAFT_NOTES', 'Debit / credit notes awaiting approval', draftNotes, (r) => (r.note_type === 'CREDIT' ? -r.amount : r.amount), 'Approve or reject them, or they move to next month\'s books.'),
    item('OPEN_DISPUTES', 'Disputes open on the month\'s bills', disputes, (r) => r.disputed_amount, 'The disputed part is held out of what is receivable.'),
    item('UNAPPLIED_ADVANCES', 'Advances held, not applied', advances, (r) => r.balance, 'A liability to the counterparty until applied or refunded.'),
  ];
  return { period, clear: items.every((i) => i.clear), open_items: items.filter((i) => !i.clear).length, items };
}

export function reconStatus(period) {
  const board = readinessBoard(period);
  return board.rows.map((r) => {
    const ready = reconReadiness(r.contract_id, period);
    const stmt = db.prepare(`
      SELECT recon_no, status FROM reconciliations WHERE contract_id = ? AND period = ? AND period_type = 'MONTHLY'
      ORDER BY created_at DESC LIMIT 1
    `).get(r.contract_id, period);
    return { contract_id: r.contract_id, contract_no: r.contract_no, contract_type: r.contract_type, ready: ready.ready, missing: ready.missing, statement: stmt || null };
  });
}

export function monthCloseBoard(period) {
  const billing = readinessBoard(period);
  const p = billing.period;
  const recon = reconStatus(p);
  const posting = postingChecklist(p);
  return {
    period: p,
    month_open: billing.month_open,
    last_billable_month: billing.last_billable_month,
    billing,
    reconciliation: {
      rows: recon,
      totals: {
        ready: recon.filter((r) => r.ready && !r.statement).length,
        statements: recon.filter((r) => r.statement).length,
        closed: recon.filter((r) => r.statement?.status === 'CLOSED').length,
        waiting: recon.filter((r) => !r.ready).length,
      },
    },
    posting,
  };
}
