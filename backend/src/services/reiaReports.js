/**
 * REIA reports: the predefined reports and the custom report builder.
 *
 * Every dataset a report can be drawn from is declared here — its tables, its
 * columns, which of them can be filtered, grouped and totalled — and a request
 * names keys from these lists and nothing else. No SQL, no column name and no
 * table name ever comes from the client: an unknown key is refused, and every
 * value is a bound parameter.
 *
 * Who sees what is the rule the desk's own screens already apply, applied here
 * once per dataset rather than left to the caller:
 *   - a seller or buyer sees only rows its own entity is a party to, on the
 *     same bar the invoice, dispute, energy, contract, security and
 *     reconciliation lists use, and never the columns SJVN keeps to itself or
 *     the other side of the trade (counterpartyScope.js);
 *   - a REIA officer working on SELECTED projects sees those projects only;
 *   - every dataset is cut to the REIA desk's contracts, and in the REIA beta
 *     the rows pass through the same filter as every other answer.
 * Totals are worked after all of that, so a total always adds up to the rows
 * the reader was shown.
 *
 * Figures are not re-derived: outstanding is the dashboard's formula
 * (outstanding.js), a bill's balance and surcharge are the invoice screen's
 * (invoiceLps.js). A report and the screen it summarises cannot disagree.
 */
import db from '../db/index.js';
import { ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { contractVerticalSql } from './verticals.js';
import { presentedSql, raisedBySellerSql } from './counterpartyScope.js';
import { OUTSTANDING_SQL, OPEN_INVOICE_SQL } from './outstanding.js';
import { invoiceBalance, invoiceLpsAsOf } from './invoiceLps.js';
import { projectsOf } from './projectScope.js';
import { REIA_BETA, betaRows } from './reiaBeta.js';
import { hasGrant } from './rolePowers.js';
import { REASON_LABELS } from '../disputesConstants.js';
import { newId } from '../util.js';
import { printed } from './reiaReportExport.js';

// The REIA report readers, as the existing REIA reports have them.
const REPORT_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
// Per-person activity is governance: the audit and activity reports' readers.
const ACTIVITY_READ = [...new Set([...ROLE_GROUPS.AUDITOR, 'MANAGEMENT'])];

export const MAX_ROWS = 50000;
const MARGIN_LABEL = REIA_BETA ? 'SJVN margin' : 'Trading margin';
const REIA = (alias = 'c') => contractVerticalSql('REIA', alias);

// ── Who is asking ────────────────────────────────────────────────────────────

/**
 * What the caller may read: a counterparty (its side and entity) or an SJVN
 * reader of the REIA desk, or null for anyone else.
 */
export function readerOf(user) {
  if (!user) return null;
  const side = counterpartySide(user);
  if (side) return { side, entityId: user.linked_entity_id || null, internal: false, governance: false, projects: null };
  const held = user.role_held || user.role;
  const internal = REPORT_READ.includes(user.role) || hasGrant(held, 'reports.view') || hasGrant(held, 'reia.view');
  if (!internal) return null;
  return {
    side: null,
    entityId: null,
    internal: true,
    governance: ACTIVITY_READ.includes(user.role) || hasGrant(held, 'audit.trail'),
    projects: projectsOf(user),
  };
}

const mayOpen = (ds, reader) => (ds.access === 'governance' ? reader.governance : ds.access === 'internal' ? reader.internal : true);

/** Whether this reader is shown this column at all. */
function shows(col, reader) {
  if (col.hidden) return false;
  if (reader.internal) return true;
  if (col.internal) return false;
  if (col.party && col.party !== reader.side) return false;
  return true;
}

// ── Scoping ──────────────────────────────────────────────────────────────────

/**
 * The invoice list's own rule (routes/invoices.js GET /): a seller sees the
 * bills it raised and the bills SJVN presented on its contracts, less SJVN's
 * computation of a month the seller has billed itself; a buyer sees the bills
 * presented to it.
 */
function invoiceScope(side, entityId, i = 'i', c = 'c') {
  if (side === 'SELLER') {
    return {
      sql: `${c}.seller_id = ? AND (${raisedBySellerSql(i)} OR (${presentedSql(i)} AND NOT EXISTS (
        SELECT 1 FROM invoices own WHERE own.contract_id = ${i}.contract_id AND own.billing_period = ${i}.billing_period
          AND own.id != ${i}.id AND ${raisedBySellerSql('own')} AND own.status != 'CANCELLED')))`,
      params: [entityId],
    };
  }
  if (side === 'BUYER') return { sql: `${c}.buyer_id = ? AND ${i}.direction = 'SJVN_TO_BUYER' AND ${presentedSql(i)}`, params: [entityId] };
  return null;
}

/** A party to the contract (the dispute, security and reconciliation lists' rule). */
function partyScope(side, entityId, c = 'c') {
  if (side === 'SELLER') return { sql: `${c}.seller_id = ?`, params: [entityId] };
  if (side === 'BUYER') return { sql: `${c}.buyer_id = ?`, params: [entityId] };
  return null;
}

// ── Columns ──────────────────────────────────────────────────────────────────

const col = (key, label, type, sql, extra = {}) => ({ key, label, type, sql, ...extra });
const NUMERIC = new Set(['money', 'mwh', 'number', 'int', 'percent', 'rate', 'mw', 'days']);

const DIRECTION = { SJVN_TO_BUYER: 'SJVN → Buyer (PSA sale)', SELLER_TO_SJVN: 'Seller → SJVN (PPA purchase)' };
const YES_NO = { YES: 'Yes', NO: 'No' };
const CONTRACT_TYPE = { PPA: 'PPA (seller side)', PSA: 'PSA (buyer side)' };
const AGEING = {
  NO_DUE_DATE: 'No due date set', NOT_DUE: 'Not yet due', DAYS_0_30: '1–30 days',
  DAYS_31_60: '31–60 days', DAYS_61_90: '61–90 days', DAYS_90_PLUS: 'Over 90 days',
};
const EXPIRY = {
  EXPIRED: 'Already expired', DAYS_0_30: 'Expires in 30 days', DAYS_31_60: 'Expires in 31–60 days',
  DAYS_61_90: 'Expires in 61–90 days', LATER: 'More than 90 days', NO_EXPIRY: 'No expiry recorded',
};
const CHARGE_LINE = (v) => (v === 'trading_margin' ? MARGIN_LABEL : String(v || '').replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase()));

const cpName = (i = 'i') => `CASE WHEN ${i}.direction = 'SJVN_TO_BUYER' THEN b.name ELSE s.name END`;
const cpState = (i = 'i') => `CASE WHEN ${i}.direction = 'SJVN_TO_BUYER' THEN b.state ELSE s.state END`;
const PAID_SQL = `COALESCE((SELECT SUM(px.amount + COALESCE(px.deduction, 0)) FROM payments px WHERE px.invoice_id = i.id), 0)`;
const LAST_PAID_SQL = `(SELECT MAX(px.payment_date) FROM payments px WHERE px.invoice_id = i.id)`;
const FINAL_APPROVER = (field) => `(SELECT a.${field} FROM invoice_approvals a WHERE a.invoice_id = i.id AND a.status = 'APPROVED' ORDER BY a.level DESC, a.acted_at DESC LIMIT 1)`;
const DAYS_LATE = (date) => `CAST(julianday(date('now')) - julianday(date(${date})) AS INTEGER)`;
const BILL_DATE = 'date(COALESCE(i.issued_at, i.created_at))';
const SELLER_JOIN = 'LEFT JOIN entities s ON s.id = c.seller_id';
const BUYER_JOIN = 'LEFT JOIN entities b ON b.id = c.buyer_id';
const INVOICE_FROM = `invoices i JOIN contracts c ON c.id = i.contract_id ${SELLER_JOIN} ${BUYER_JOIN}`;

/** The contract and its two parties, as every invoice-side dataset shows them. */
const contractCols = (c = 'c') => [
  col('contract_no', 'Contract', 'text', `${c}.contract_no`, { filter: true, group: true }),
  col('contract_type', 'Contract type', 'enum', `${c}.contract_type`, { filter: true, group: true, labels: CONTRACT_TYPE }),
  col('project_type', 'Technology', 'enum', `${c}.project_type`, { filter: true, group: true }),
  col('seller_name', 'Seller / generator', 'text', 's.name', { filter: true, group: true, party: 'SELLER' }),
  col('seller_state', 'Seller state', 'text', 's.state', { group: true, party: 'SELLER' }),
  col('buyer_name', 'Buyer / beneficiary', 'text', 'b.name', { filter: true, group: true, party: 'BUYER' }),
  col('buyer_state', 'Buyer state', 'text', 'b.state', { group: true, party: 'BUYER' }),
];
const counterpartyCols = (i = 'i') => [
  col('counterparty_name', 'Counterparty', 'text', cpName(i), { filter: true, group: true, internal: true }),
  col('counterparty_state', 'State', 'text', cpState(i), { filter: true, group: true, internal: true }),
];
// SJVN's column: a seller's or a buyer's rows all run one way, and the labels
// ("PPA purchase", "Receivable from buyer") are SJVN's words for that way.
const directionCol = (i = 'i', extra = {}) => col('direction', 'Direction', 'enum', `${i}.direction`, { filter: true, group: true, labels: DIRECTION, internal: true, ...extra });

// Heavy per-bill figures, worked once per row however many columns read them.
const memo = new WeakMap();
const invoiceRow = db.prepare('SELECT * FROM invoices WHERE id = ?');
function billFigures(row) {
  if (memo.has(row)) return memo.get(row);
  const inv = invoiceRow.get(row.invoice_id);
  const bal = inv ? invoiceBalance(inv) : { balance: 0, accrued: { lps: 0 } };
  const out = { inv, balance: bal.balance, paid: bal.paid };
  memo.set(row, out);
  return out;
}
/** LPS earned and not yet charged on a bill (lpsPosition.js's unbilledOn). */
function unbilledLps(row) {
  const { inv } = billFigures(row);
  if (!inv || !row._open || !(row._days_late > 0)) return 0;
  const accrued = invoiceLpsAsOf(inv, new Date());
  return Math.max(0, Math.round(((accrued.lps || 0) - (inv.lps || 0)) * 100) / 100);
}
function ageingOf(days, due) {
  if (!due) return 'NO_DUE_DATE';
  if (days <= 0) return 'NOT_DUE';
  if (days <= 30) return 'DAYS_0_30';
  if (days <= 60) return 'DAYS_31_60';
  if (days <= 90) return 'DAYS_61_90';
  return 'DAYS_90_PLUS';
}
const bucketCol = (key, label, bucket) => col(key, label, 'money', null, {
  agg: 'sum', compute: (r) => (ageingOf(r._days_late, r.due_date) === bucket ? r.outstanding : 0),
});
function expiryOf(days, end) {
  if (!end) return 'NO_EXPIRY';
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'DAYS_0_30';
  if (days <= 60) return 'DAYS_31_60';
  if (days <= 90) return 'DAYS_61_90';
  return 'LATER';
}
const tableExists = (name) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);

// ── Datasets ─────────────────────────────────────────────────────────────────

function buildDatasets() {
  const sapPushes = tableExists('reia_sap_pushes');
  return {
    invoices: {
      title: 'Bills register',
      blurb: 'Every REIA bill, seller side (PPA) and buyer side (PSA): charges, rebate, surcharge, payments and balance.',
      access: 'all',
      from: INVOICE_FROM,
      where: [REIA()],
      scope: invoiceScope,
      projectCols: ['i.contract_id'],
      defaultSort: [{ key: 'bill_date', dir: 'desc' }],
      columns: [
        col('invoice_id', '', 'text', 'i.id', { hidden: true }),
        col('contract_id', '', 'text', 'i.contract_id', { hidden: true }),
        col('invoice_no', 'Bill no.', 'text', 'i.invoice_no', { default: true, filter: 'search' }),
        col('invoice_type', 'Bill type', 'enum', 'i.invoice_type', { filter: true, group: true, default: true }),
        directionCol('i', { default: true }),
        ...contractCols().map((c) => (c.key === 'contract_no' ? { ...c, default: true } : c)),
        ...counterpartyCols().map((c) => (c.key === 'counterparty_name' ? { ...c, default: true } : c)),
        col('billing_period', 'Billing period', 'month', 'i.billing_period', { filter: true, group: true, default: true }),
        col('bill_date', 'Bill date', 'date', BILL_DATE, { filter: true, group: true, default: true, note: 'Date the bill was issued; a bill not yet issued shows the date it was drafted.' }),
        col('due_date', 'Due date', 'date', 'date(i.due_date)', { filter: true, default: true }),
        col('energy_mwh', 'Energy (MWh)', 'mwh', 'i.energy_mwh', { agg: 'sum', filter: true, default: true }),
        col('tariff_per_unit', 'Tariff (₹/kWh)', 'rate', 'i.tariff_per_unit'),
        col('energy_charges', 'Energy charges', 'money', 'i.energy_charges', { agg: 'sum', filter: true }),
        col('capacity_charges', 'Capacity charges', 'money', 'i.capacity_charges', { agg: 'sum' }),
        col('incentive_charges', 'Incentive', 'money', 'i.incentive_charges', { agg: 'sum' }),
        col('deemed_charges', 'Deemed generation charges', 'money', 'i.deemed_charges', { agg: 'sum' }),
        col('transmission_charges', 'Transmission charges', 'money', 'i.transmission_charges', { agg: 'sum' }),
        col('taxes', 'Taxes', 'money', 'i.taxes', { agg: 'sum' }),
        col('other_adjustments', 'Other adjustments', 'money', 'i.other_adjustments', { agg: 'sum' }),
        col('trading_margin', MARGIN_LABEL, 'money', 'i.trading_margin', { agg: 'sum', internal: true }),
        col('total_amount', 'Bill amount', 'money', 'i.total_amount', { agg: 'sum', filter: true, default: true }),
        col('rebate', 'Rebate', 'money', 'i.rebate', { agg: 'sum' }),
        col('lps', 'LPS on bill', 'money', 'i.lps', { agg: 'sum' }),
        col('disputed_amount', 'Disputed', 'money', 'i.disputed_amount', { agg: 'sum', filter: true }),
        col('paid_total', 'Paid / settled', 'money', PAID_SQL, { agg: 'sum', filter: true, default: true }),
        col('last_payment_date', 'Last payment', 'date', LAST_PAID_SQL, { filter: true }),
        // Owed only once approved and presented, and SJVN's computation of a
        // month the developer has billed itself is not owed twice (outstanding.js).
        col('_open', '', 'int', `CASE WHEN ${OPEN_INVOICE_SQL} THEN 1 ELSE 0 END`, { hidden: true }),
        col('balance_due', 'Balance due', 'money', null, {
          agg: 'sum', filter: true, default: true, compute: (r) => (r._open ? billFigures(r).balance : 0),
          note: 'Still owed today on an approved bill, surcharge earned to date included (the bill screen\'s figure). A draft, a bill in approval and a settled bill owe nothing.',
        }),
        col('_days_late', '', 'int', DAYS_LATE('i.due_date'), { hidden: true }),
        col('days_past_due', 'Days past due', 'days', null, {
          filter: true,
          compute: (r) => (!r._open || !r.due_date || billFigures(r).balance <= 0 ? 0 : Math.max(0, r._days_late || 0)),
        }),
        col('status', 'Status', 'enum', 'i.status', { filter: true, group: true, default: true }),
        col('issued_at', 'Issued on', 'datetime', 'i.issued_at'),
        col('created_by', 'Created by', 'text', 'i.created_by', { filter: true, group: true, internal: true, user: true }),
        col('approved_by', 'Final approver', 'text', FINAL_APPROVER('approver_name'), { filter: true, group: true, internal: true, user: true }),
        col('approved_at', 'Approved on', 'datetime', FINAL_APPROVER('acted_at'), { internal: true }),
        col('irn', 'IRN', 'text', 'i.irn'),
      ],
    },

    payments: {
      title: 'Payments and receipts',
      blurb: 'Money received from buyers and paid to developers, bill by bill, with TDS, rebate and the surcharge part of each receipt.',
      access: 'all',
      from: `payments p JOIN invoices i ON i.id = p.invoice_id JOIN contracts c ON c.id = i.contract_id ${SELLER_JOIN} ${BUYER_JOIN}`,
      where: [REIA()],
      scope: invoiceScope,
      projectCols: ['i.contract_id'],
      defaultSort: [{ key: 'payment_date', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'i.contract_id', { hidden: true }),
        col('payment_date', 'Payment date', 'date', 'date(p.payment_date)', { filter: true, group: true, default: true }),
        col('payment_month', 'Payment month', 'month', "strftime('%Y-%m', p.payment_date)", { filter: true, group: true }),
        directionCol('i', { default: true, labels: { SJVN_TO_BUYER: 'Receipt from buyer', SELLER_TO_SJVN: 'Payment to developer' } }),
        col('invoice_no', 'Bill no.', 'text', 'i.invoice_no', { default: true, filter: 'search' }),
        col('billing_period', 'Billing period', 'month', 'i.billing_period', { filter: true, group: true }),
        ...contractCols(),
        ...counterpartyCols().map((c) => (c.key === 'counterparty_name' ? { ...c, default: true } : c)),
        col('mode', 'Mode', 'enum', 'p.mode', { filter: true, group: true, default: true, labels: { CREDIT_NOTE: 'Credit note (adjustment, not cash)' } }),
        col('reference', 'Reference / UTR', 'text', 'p.reference', { default: true, filter: 'search' }),
        col('amount', 'Amount', 'money', 'p.amount', { agg: 'sum', filter: true, default: true }),
        col('deduction', 'Deduction', 'money', 'p.deduction', { agg: 'sum' }),
        col('settled', 'Total settled', 'money', 'p.amount + COALESCE(p.deduction, 0)', { agg: 'sum', default: true, note: 'Amount plus deductions: what the payment took off the bill.' }),
        col('tds_amount', 'TDS', 'money', 'p.tds_amount', { agg: 'sum' }),
        col('tds_section', 'TDS section', 'enum', 'p.tds_section', { filter: true }),
        col('rebate_amount', 'Rebate', 'money', 'p.rebate_amount', { agg: 'sum' }),
        col('lps_component', 'Of which LPS', 'money', 'p.lps_component', { agg: 'sum' }),
        col('deduction_note', 'Deduction note', 'text', 'p.deduction_note'),
        col('remarks', 'Remarks', 'text', 'p.remarks', { internal: true }),
        col('recorded_at', 'Recorded on', 'datetime', 'p.created_at'),
      ],
    },

    outstanding: {
      title: 'Outstanding and ageing',
      blurb: 'Open bills with something still owed, aged by days past due — the dashboard\'s "Outstanding by age", bill by bill.',
      access: 'all',
      from: INVOICE_FROM,
      where: [REIA(), OPEN_INVOICE_SQL, `${OUTSTANDING_SQL} > 0`],
      scope: invoiceScope,
      projectCols: ['i.contract_id'],
      defaultSort: [{ key: 'days_past_due', dir: 'desc' }],
      columns: [
        col('invoice_id', '', 'text', 'i.id', { hidden: true }),
        col('contract_id', '', 'text', 'i.contract_id', { hidden: true }),
        col('_open', '', 'int', '1', { hidden: true }),
        col('_days_late', '', 'int', DAYS_LATE('i.due_date'), { hidden: true }),
        ...counterpartyCols().map((c) => ({ ...c, default: true })),
        directionCol('i', { default: true, labels: { SJVN_TO_BUYER: 'Receivable from buyer', SELLER_TO_SJVN: 'Payable to developer' } }),
        col('invoice_no', 'Bill no.', 'text', 'i.invoice_no', { default: true, filter: 'search' }),
        ...contractCols(),
        col('billing_period', 'Billing period', 'month', 'i.billing_period', { filter: true, group: true }),
        col('bill_date', 'Bill date', 'date', BILL_DATE, { filter: true }),
        col('due_date', 'Due date', 'date', 'date(i.due_date)', { filter: true, default: true }),
        col('days_past_due', 'Days past due', 'days', null, { filter: true, default: true, compute: (r) => Math.max(0, r._days_late || 0) }),
        col('ageing_bucket', 'Age', 'enum', null, { filter: true, group: true, default: true, labels: AGEING, options: Object.keys(AGEING), compute: (r) => ageingOf(r._days_late, r.due_date) }),
        col('total_amount', 'Bill amount', 'money', 'i.total_amount', { agg: 'sum' }),
        col('outstanding', 'Outstanding', 'money', OUTSTANDING_SQL, { agg: 'sum', filter: true, default: true, note: 'Bill less rebate, plus LPS on the bill, less disputed and less what has been paid — the dashboard\'s formula.' }),
        bucketCol('not_due', 'Not yet due', 'NOT_DUE'),
        bucketCol('days_0_30', '1–30 days', 'DAYS_0_30'),
        bucketCol('days_31_60', '31–60 days', 'DAYS_31_60'),
        bucketCol('days_61_90', '61–90 days', 'DAYS_61_90'),
        bucketCol('days_90_plus', 'Over 90 days', 'DAYS_90_PLUS'),
        col('disputed_amount', 'Disputed (held back)', 'money', 'i.disputed_amount', { agg: 'sum' }),
        col('lps_accrued_unbilled', 'LPS accrued, not billed', 'money', null, { agg: 'sum', compute: unbilledLps }),
        col('status', 'Status', 'enum', 'i.status', { filter: true, group: true }),
      ],
    },

    lps: {
      title: 'Late payment surcharge',
      blurb: 'Surcharge charged on bills and on separate LPS bills, what was received, and what has accrued on overdue bills but not been billed.',
      access: 'all',
      from: INVOICE_FROM,
      where: [REIA(), "i.status <> 'DRAFT'"],
      scope: invoiceScope,
      projectCols: ['i.contract_id'],
      keep: (r) => r.lps_charged > 0 || r.lps_received > 0 || r.lps_accrued_unbilled > 0,
      needs: ['lps_charged', 'lps_received', 'lps_accrued_unbilled'],
      defaultSort: [{ key: 'due_date', dir: 'asc' }],
      columns: [
        col('invoice_id', '', 'text', 'i.id', { hidden: true }),
        col('contract_id', '', 'text', 'i.contract_id', { hidden: true }),
        col('_days_late', '', 'int', DAYS_LATE('i.due_date'), { hidden: true }),
        col('_open', '', 'int', `CASE WHEN ${OPEN_INVOICE_SQL} AND ${OUTSTANDING_SQL} > 0 THEN 1 ELSE 0 END`, { hidden: true }),
        col('invoice_no', 'Bill no.', 'text', 'i.invoice_no', { default: true, filter: 'search' }),
        col('bill_kind', 'Bill kind', 'enum', "CASE WHEN i.invoice_no LIKE 'LPS-%' THEN 'LPS_BILL' ELSE 'BILL' END", { filter: true, group: true, default: true, labels: { LPS_BILL: 'Separate LPS bill', BILL: 'LPS on the bill itself' } }),
        directionCol('i', { default: true, labels: { SJVN_TO_BUYER: 'Receivable from buyer', SELLER_TO_SJVN: 'Payable to developer' } }),
        ...counterpartyCols().map((c) => (c.key === 'counterparty_name' ? { ...c, default: true } : c)),
        ...contractCols(),
        col('billing_period', 'Billing period', 'month', 'i.billing_period', { filter: true, group: true }),
        col('due_date', 'Due date', 'date', 'date(i.due_date)', { filter: true, default: true }),
        col('days_past_due', 'Days past due', 'days', null, { compute: (r) => (r._open ? Math.max(0, r._days_late || 0) : 0) }),
        col('lps_rate', 'LPS rate (% a year)', 'percent', 'c.lps_annual_pct'),
        col('lps_charged', 'LPS charged', 'money', "CASE WHEN i.invoice_no LIKE 'LPS-%' THEN i.total_amount ELSE COALESCE(i.lps, 0) END", { agg: 'sum', filter: true, default: true }),
        col('lps_received', 'LPS received', 'money', 'COALESCE((SELECT SUM(px.lps_component) FROM payments px WHERE px.invoice_id = i.id), 0)', { agg: 'sum', default: true }),
        col('lps_accrued_unbilled', 'LPS accrued, not billed', 'money', null, { agg: 'sum', default: true, compute: unbilledLps, note: 'Earned on an overdue bill to today at the contract\'s rate, over and above what the bill already charges.' }),
        col('lps_status', 'Surcharge position', 'enum', null, {
          filter: true, group: true, default: true,
          labels: { RECOVERED: 'Recovered (bill settled)', BILLED_OPEN: 'Billed, still open', ACCRUING: 'Accruing, not billed', CANCELLED: 'Bill cancelled' },
          options: ['RECOVERED', 'BILLED_OPEN', 'ACCRUING', 'CANCELLED'],
          compute: (r) => (r.status === 'CANCELLED' ? 'CANCELLED' : r.status === 'PAID' ? 'RECOVERED' : (r.lps_charged > 0 ? 'BILLED_OPEN' : 'ACCRUING')),
        }),
        col('status', 'Bill status', 'enum', 'i.status', { filter: true, group: true }),
      ],
    },

    rebates: {
      title: 'Rebates',
      blurb: 'Prompt-payment rebate allowed to buyers and availed from developers, on the bill and as recorded with each payment.',
      access: 'all',
      from: INVOICE_FROM,
      where: [REIA(), "i.status NOT IN ('DRAFT','CANCELLED')"],
      scope: invoiceScope,
      projectCols: ['i.contract_id'],
      keep: (r) => r.rebate_on_bill > 0 || r.rebate_in_payments > 0,
      needs: ['rebate_on_bill', 'rebate_in_payments'],
      defaultSort: [{ key: 'billing_period', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'i.contract_id', { hidden: true }),
        col('invoice_no', 'Bill no.', 'text', 'i.invoice_no', { default: true, filter: 'search' }),
        directionCol('i', { default: true, labels: { SJVN_TO_BUYER: 'Allowed to buyer', SELLER_TO_SJVN: 'Availed from developer' } }),
        ...counterpartyCols().map((c) => (c.key === 'counterparty_name' ? { ...c, default: true } : c)),
        ...contractCols(),
        col('billing_period', 'Billing period', 'month', 'i.billing_period', { filter: true, group: true, default: true }),
        col('due_date', 'Due date', 'date', 'date(i.due_date)', { filter: true }),
        col('paid_on', 'Paid on', 'date', LAST_PAID_SQL, { filter: true, default: true }),
        col('rebate_pct', 'Rebate rate (%)', 'percent', 'c.rebate_pct'),
        col('total_amount', 'Bill amount', 'money', 'i.total_amount', { agg: 'sum', default: true }),
        col('rebate_on_bill', 'Rebate on the bill', 'money', 'COALESCE(i.rebate, 0)', { agg: 'sum', filter: true, default: true }),
        col('rebate_in_payments', 'Rebate recorded with payments', 'money', 'COALESCE((SELECT SUM(px.rebate_amount) FROM payments px WHERE px.invoice_id = i.id), 0)', { agg: 'sum', default: true }),
        col('status', 'Bill status', 'enum', 'i.status', { filter: true, group: true }),
      ],
    },

    disputes: {
      title: 'Disputes',
      blurb: 'Every dispute on a REIA bill: reason, amounts, SLA dates, escalation and outcome.',
      access: 'all',
      from: `disputes d JOIN invoices i ON i.id = d.invoice_id JOIN contracts c ON c.id = i.contract_id ${SELLER_JOIN} ${BUYER_JOIN}`,
      where: [REIA()],
      scope: (side, id) => partyScope(side, id),
      projectCols: ['i.contract_id'],
      defaultSort: [{ key: 'raised_on', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'i.contract_id', { hidden: true }),
        col('dispute_no', 'Dispute no.', 'text', 'd.dispute_no', { default: true, filter: 'search' }),
        col('invoice_no', 'Bill no.', 'text', 'i.invoice_no', { default: true, filter: 'search' }),
        directionCol(),
        ...contractCols(),
        ...counterpartyCols().map((c) => (c.key === 'counterparty_name' ? { ...c, default: true } : c)),
        col('billing_period', 'Billing period', 'month', 'i.billing_period', { filter: true, group: true }),
        col('raised_by_role', 'Raised by', 'enum', 'd.raised_by_role', { filter: true, group: true, default: true }),
        col('reason_code', 'Reason', 'enum', 'd.reason_code', { filter: true, group: true, default: true, labels: REASON_LABELS }),
        col('charge_line', 'Charge disputed', 'text', 'd.charge_line', { filter: true, group: true, format: CHARGE_LINE }),
        col('disputed_amount', 'Disputed amount', 'money', 'd.disputed_amount', { agg: 'sum', filter: true, default: true }),
        col('accepted_amount', 'Accepted', 'money', 'd.accepted_amount', { agg: 'sum' }),
        col('credit_amount', 'Credit given', 'money', 'd.credit_amount', { agg: 'sum' }),
        col('status', 'Status', 'enum', 'd.status', { filter: true, group: true, default: true }),
        col('raised_on', 'Raised on', 'date', 'date(d.created_at)', { filter: true, group: true, default: true }),
        col('sla_ack_due', 'Acknowledge by', 'date', 'date(d.sla_ack_due)'),
        col('sla_resolve_due', 'Resolve by', 'date', 'date(d.sla_resolve_due)', { filter: true }),
        col('sla_breached', 'SLA breached', 'enum', "CASE WHEN d.sla_breached_at IS NOT NULL THEN 'YES' ELSE 'NO' END", { filter: true, group: true, labels: YES_NO, default: true }),
        col('age_days', 'Age (days)', 'days', "CAST(julianday(COALESCE(d.resolved_at, datetime('now'))) - julianday(d.created_at) AS INTEGER)", { filter: true }),
        col('escalation_forum', 'Escalated to', 'enum', 'd.escalation_forum', { filter: true, group: true }),
        col('resolved_at', 'Resolved on', 'date', 'date(d.resolved_at)', { filter: true }),
        col('resolution_outcome', 'Outcome', 'enum', 'd.resolution_outcome', { filter: true, group: true }),
        col('assigned_to', 'Assigned to', 'text', 'd.assigned_to', { filter: true, group: true, internal: true, user: true }),
        col('resolved_by', 'Resolved by', 'text', 'd.resolved_by', { filter: true, group: true, internal: true, user: true }),
      ],
    },

    notes: {
      title: 'Debit and credit notes',
      blurb: 'Debit and credit notes on REIA bills: reason, amounts, how much has been applied, maker and approver.',
      // The notes list is the desk's and Finance's (routes/notes.js READ); a
      // counterparty reads a note as the supplementary bill it raised.
      access: 'internal',
      from: `debit_credit_notes n JOIN contracts c ON c.id = n.contract_id LEFT JOIN invoices i ON i.id = n.invoice_id ${SELLER_JOIN} ${BUYER_JOIN}`,
      where: [REIA()],
      scope: () => ({ sql: '0', params: [] }),
      projectCols: ['n.contract_id'],
      defaultSort: [{ key: 'created_on', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'n.contract_id', { hidden: true }),
        col('note_no', 'Note no.', 'text', 'n.note_no', { default: true, filter: 'search' }),
        col('note_type', 'Type', 'enum', 'n.note_type', { filter: true, group: true, default: true, labels: { DEBIT: 'Debit note', CREDIT: 'Credit note' } }),
        col('invoice_no', 'Against bill', 'text', 'i.invoice_no', { default: true, filter: 'search' }),
        directionCol(),
        ...contractCols(),
        col('counterparty_name', 'Counterparty', 'text', `COALESCE(${cpName('i')}, b.name, s.name)`, { filter: true, group: true, default: true }),
        col('counterparty_state', 'State', 'text', `COALESCE(${cpState('i')}, b.state, s.state)`, { filter: true, group: true }),
        col('period_month', 'Period', 'month', 'n.period_month', { filter: true, group: true, default: true }),
        col('reason_code', 'Reason', 'enum', 'n.reason_code', { filter: true, group: true, default: true }),
        col('reason', 'Reason detail', 'text', 'n.reason'),
        col('taxable_amount', 'Taxable', 'money', 'n.taxable_amount', { agg: 'sum' }),
        col('tax_amount', 'Tax', 'money', 'n.tax_amount', { agg: 'sum' }),
        col('amount', 'Amount', 'money', 'n.amount', { agg: 'sum', filter: true, default: true }),
        col('applied_amount', 'Applied', 'money', 'n.applied_amount', { agg: 'sum' }),
        col('status', 'Status', 'enum', 'n.status', { filter: true, group: true, default: true }),
        col('created_on', 'Created on', 'date', 'date(n.created_at)', { filter: true }),
        col('issued_date', 'Issued on', 'date', 'date(n.issued_date)', { filter: true, default: true }),
        col('settled_date', 'Settled on', 'date', 'date(n.settled_date)', { filter: true }),
        col('created_by', 'Prepared by', 'text', 'n.created_by', { filter: true, group: true, default: true, user: true }),
        col('approved_by', 'Approved by', 'text', 'n.approved_by', { filter: true, group: true, default: true, user: true }),
        col('approved_at', 'Approved on', 'datetime', 'n.approved_at'),
      ],
    },

    energy: {
      title: 'Energy accounts',
      blurb: 'Energy recorded for each contract and month — provisional and final, its source, CUF, availability and status.',
      access: 'all',
      from: `energy_data ed JOIN contracts c ON c.id = ed.contract_id ${SELLER_JOIN} ${BUYER_JOIN}`,
      where: [REIA()],
      // The energy list's rule: a counterparty sees a figure once SJVN has finished preparing it.
      scope: (side, id) => {
        const p = partyScope(side, id);
        return p && { sql: `${p.sql} AND ed.status != 'DRAFT' AND c.status NOT IN ('DRAFT','UNDER_NEGOTIATION')`, params: p.params };
      },
      projectCols: ['ed.contract_id'],
      defaultSort: [{ key: 'period_month', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'ed.contract_id', { hidden: true }),
        ...contractCols().map((c) => (['contract_no', 'contract_type'].includes(c.key) ? { ...c, default: true } : c)),
        col('period_month', 'Month', 'month', 'ed.period_month', { filter: true, group: true, default: true }),
        col('data_type', 'Provisional / final', 'enum', 'ed.data_type', { filter: true, group: true, default: true }),
        col('source', 'Source', 'enum', 'ed.source', { filter: true, group: true, default: true }),
        col('energy_mwh', 'Energy (MWh)', 'mwh', 'ed.energy_mwh', { agg: 'sum', filter: true, default: true }),
        col('deemed_generation_mwh', 'Deemed generation (MWh)', 'mwh', 'ed.deemed_generation_mwh', { agg: 'sum' }),
        col('free_energy_mwh', 'Free energy (MWh)', 'mwh', 'ed.free_energy_mwh', { agg: 'sum' }),
        col('cuf_percent', 'CUF (%)', 'percent', 'ed.cuf_percent', { default: true }),
        col('availability_percent', 'Availability (%)', 'percent', 'ed.availability_percent'),
        col('curtailment_hours', 'Curtailment (hours)', 'number', 'ed.curtailment_hours', { agg: 'sum' }),
        col('superseded', 'Replaced by a later figure', 'enum', `CASE WHEN (ed.data_type = 'PROVISIONAL' AND EXISTS (SELECT 1 FROM energy_data f WHERE f.contract_id = ed.contract_id AND f.period_month = ed.period_month AND f.data_type = 'FINAL'))
            OR EXISTS (SELECT 1 FROM energy_data n2 WHERE n2.supersedes_energy_id = ed.id) THEN 'YES' ELSE 'NO' END`, { filter: true, group: true, labels: YES_NO, default: true,
          note: 'A provisional figure a final one has since replaced, or a figure revised by a later one. Filter to "No" so a month is not counted twice.' }),
        col('status', 'Status', 'enum', 'ed.status', { filter: true, group: true, default: true }),
        col('locked_at', 'Locked on', 'datetime', 'ed.locked_at'),
      ],
    },

    allocations: {
      title: 'Energy allocated to beneficiaries',
      blurb: 'Each PPA\'s monthly energy split onto the PSAs it feeds, at the allocation share in force that month.',
      // The PPA–PSA routing is SJVN's own business (routes/contracts.js refuses it to counterparties).
      access: 'internal',
      from: `contract_allocations a
        JOIN contracts c ON c.id = a.ppa_id
        JOIN contracts q ON q.id = a.psa_id
        LEFT JOIN entities s ON s.id = c.seller_id
        LEFT JOIN entities b ON b.id = q.buyer_id
        JOIN energy_data ed ON ed.contract_id = a.ppa_id
          AND ed.period_month >= substr(a.effective_from, 1, 7)
          AND ed.period_month <= substr(COALESCE(a.effective_to, '9999-12-31'), 1, 7)`,
      where: [
        REIA(),
        // The figure that stands for the month: final over provisional, the latest revision.
        `(ed.data_type = 'FINAL' OR NOT EXISTS (SELECT 1 FROM energy_data f WHERE f.contract_id = ed.contract_id AND f.period_month = ed.period_month AND f.data_type = 'FINAL'))`,
        'NOT EXISTS (SELECT 1 FROM energy_data n2 WHERE n2.supersedes_energy_id = ed.id)',
      ],
      scope: () => ({ sql: '0', params: [] }),
      projectCols: ['a.ppa_id', 'a.psa_id'],
      defaultSort: [{ key: 'period_month', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'a.ppa_id', { hidden: true }),
        col('psa_contract_id', '', 'text', 'a.psa_id', { hidden: true }),
        col('period_month', 'Month', 'month', 'ed.period_month', { filter: true, group: true, default: true }),
        col('ppa_no', 'PPA', 'text', 'c.contract_no', { filter: true, group: true, default: true }),
        col('seller_name', 'Seller / generator', 'text', 's.name', { filter: true, group: true, default: true }),
        col('psa_no', 'PSA', 'text', 'q.contract_no', { filter: true, group: true, default: true }),
        col('buyer_name', 'Buyer / beneficiary', 'text', 'b.name', { filter: true, group: true, default: true }),
        col('buyer_state', 'Buyer state', 'text', 'b.state', { filter: true, group: true }),
        col('project_type', 'Technology', 'enum', 'c.project_type', { filter: true, group: true }),
        col('allocation_percent', 'Share (%)', 'percent', 'a.allocation_percent', { default: true }),
        col('allocated_capacity_mw', 'Allocated capacity (MW)', 'mw', 'ROUND(COALESCE(c.capacity_mw, 0) * a.allocation_percent / 100.0, 3)'),
        col('ppa_energy_mwh', 'PPA energy (MWh)', 'mwh', 'ed.energy_mwh', { default: true }),
        col('allocated_mwh', 'Allocated energy (MWh)', 'mwh', 'ROUND(COALESCE(ed.energy_mwh, 0) * a.allocation_percent / 100.0, 3)', { agg: 'sum', filter: true, default: true }),
        col('data_type', 'Provisional / final', 'enum', 'ed.data_type', { filter: true, group: true, default: true }),
        col('energy_status', 'Energy status', 'enum', 'ed.status', { filter: true, group: true }),
        col('effective_from', 'Share in force from', 'date', 'date(a.effective_from)'),
        col('effective_to', 'Share in force to', 'date', 'date(a.effective_to)'),
      ],
    },

    contracts: {
      title: 'Contracts register',
      blurb: 'Every REIA PPA and PSA: parties, capacity, tariff, tenure and the commercial terms billing runs on.',
      access: 'all',
      from: `contracts c ${SELLER_JOIN} ${BUYER_JOIN}`,
      where: [REIA()],
      scope: (side, id) => {
        const p = partyScope(side, id);
        return p && { sql: `${p.sql} AND c.status <> 'DRAFT'`, params: p.params };
      },
      projectCols: ['c.id'],
      defaultSort: [{ key: 'contract_no', dir: 'asc' }],
      columns: [
        col('contract_id', '', 'text', 'c.id', { hidden: true }),
        ...contractCols().map((c) => (['contract_no', 'contract_type', 'project_type', 'seller_name', 'buyer_name'].includes(c.key) ? { ...c, default: true } : c)),
        col('capacity_mw', 'Capacity (MW)', 'mw', 'c.capacity_mw', { agg: 'sum', filter: true, default: true }),
        col('commissioned_capacity_mw', 'Commissioned (MW)', 'mw', 'c.commissioned_capacity_mw', { agg: 'sum' }),
        col('cod_date', 'COD', 'date', 'date(c.cod_date)', { filter: true }),
        col('tariff_type', 'Tariff type', 'enum', 'c.tariff_type', { filter: true, group: true }),
        col('tariff_per_unit', 'Tariff (₹/kWh)', 'rate', 'c.tariff_per_unit', { filter: true, default: true }),
        col('tenure_start', 'Tenure from', 'date', 'date(c.tenure_start)', { filter: true, default: true }),
        col('tenure_end', 'Tenure to', 'date', 'date(c.tenure_end)', { filter: true, default: true }),
        col('days_to_end', 'Days to end of tenure', 'days', 'CAST(julianday(date(c.tenure_end)) - julianday(date(\'now\')) AS INTEGER)', { filter: true }),
        col('billing_cycle', 'Billing cycle', 'enum', 'c.billing_cycle', { filter: true, group: true }),
        col('payment_terms_days', 'Payment terms (days)', 'int', 'c.payment_terms_days'),
        col('rebate_pct', 'Rebate (%)', 'percent', 'c.rebate_pct'),
        col('lps_annual_pct', 'LPS (% a year)', 'percent', 'c.lps_annual_pct'),
        col('payment_security_type', 'Payment security', 'enum', 'c.payment_security_type', { filter: true, group: true }),
        col('trading_margin_per_mwh', `${MARGIN_LABEL} (₹/MWh)`, 'number', 'c.trading_margin_per_mwh', { internal: true }),
        col('status', 'Status', 'enum', 'c.status', { filter: true, group: true, default: true }),
        col('on_hold', 'On hold', 'enum', "CASE WHEN COALESCE(c.on_hold, 0) = 1 THEN 'YES' ELSE 'NO' END", { filter: true, group: true, labels: YES_NO }),
      ],
    },

    security: {
      title: 'Payment security (LC / BG)',
      blurb: 'Letters of credit and bank guarantees held against REIA contracts: limit, utilisation, validity and days to expiry.',
      access: 'all',
      from: `payment_security ps JOIN contracts c ON c.id = ps.contract_id ${SELLER_JOIN} ${BUYER_JOIN} LEFT JOIN entities e ON e.id = ps.entity_id`,
      where: [REIA()],
      scope: (side, id) => partyScope(side, id),
      projectCols: ['ps.contract_id'],
      defaultSort: [{ key: 'validity_end', dir: 'asc' }],
      columns: [
        col('contract_id', '', 'text', 'ps.contract_id', { hidden: true }),
        col('_days_left', '', 'int', "CAST(julianday(date(ps.validity_end)) - julianday(date('now')) AS INTEGER)", { hidden: true }),
        col('instrument_no', 'Instrument no.', 'text', 'ps.instrument_no', { default: true, filter: 'search' }),
        col('mechanism_type', 'Instrument', 'enum', 'ps.mechanism_type', { filter: true, group: true, default: true }),
        col('bg_subtype', 'BG kind', 'enum', 'ps.bg_subtype', { filter: true, group: true }),
        ...contractCols().map((c) => (c.key === 'contract_no' ? { ...c, default: true } : c)),
        col('lodged_by', 'Lodged by', 'text', 'e.name', { filter: true, group: true, internal: true, default: true }),
        col('issuing_bank', 'Issuing bank', 'text', 'ps.issuing_bank', { filter: true, group: true, default: true }),
        col('limit_amount', 'Limit', 'money', 'ps.limit_amount', { agg: 'sum', filter: true, default: true }),
        col('utilized_amount', 'Utilised', 'money', 'ps.utilized_amount', { agg: 'sum', default: true }),
        col('available_amount', 'Available', 'money', 'ps.available_amount', { agg: 'sum', default: true }),
        col('required_amount', 'Required by contract', 'money', 'ps.required_amount', { agg: 'sum' }),
        col('validity_start', 'Valid from', 'date', 'date(ps.validity_start)', { filter: true }),
        col('validity_end', 'Valid to', 'date', 'date(ps.validity_end)', { filter: true, default: true }),
        col('days_to_expiry', 'Days to expiry', 'days', null, { filter: true, default: true, compute: (r) => (r.validity_end ? r._days_left : null) }),
        col('expiry_bucket', 'Expiry', 'enum', null, { filter: true, group: true, default: true, labels: EXPIRY, options: Object.keys(EXPIRY), compute: (r) => expiryOf(r._days_left, r.validity_end) }),
        col('claim_deadline', 'Claim deadline', 'date', 'date(ps.claim_deadline)'),
        col('is_revolving', 'Revolving', 'enum', "CASE WHEN COALESCE(ps.is_revolving, 0) = 1 THEN 'YES' ELSE 'NO' END", { filter: true, labels: YES_NO }),
        col('status', 'Status', 'enum', 'ps.status', { filter: true, group: true, default: true }),
        col('renewal_status', 'Renewal', 'enum', 'ps.renewal_status', { filter: true, group: true }),
        col('invocation_status', 'Invocation', 'enum', 'ps.invocation_status', { filter: true, group: true }),
        col('verified_at', 'Verified on', 'date', 'date(ps.verified_at)'),
      ],
    },

    reconciliation: {
      title: 'Reconciliation statements',
      blurb: 'Reconciliation statements per contract and period: items matched, exceptions, unreconciled amount and sign-offs.',
      access: 'all',
      from: `reconciliations r JOIN contracts c ON c.id = r.contract_id ${SELLER_JOIN} ${BUYER_JOIN}`,
      where: [REIA(), "COALESCE(r.scope, 'CONTRACT') <> 'TRADING_CLIENT'"],
      scope: (side, id) => partyScope(side, id),
      projectCols: ['r.contract_id'],
      defaultSort: [{ key: 'period', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'r.contract_id', { hidden: true }),
        col('recon_no', 'Statement no.', 'text', 'r.recon_no', { default: true, filter: 'search' }),
        ...contractCols().map((c) => (c.key === 'contract_no' ? { ...c, default: true } : c)),
        col('counterparty_name', 'Counterparty', 'text', 'COALESCE(b.name, s.name)', { filter: true, group: true, internal: true, default: true }),
        col('period_type', 'Period type', 'enum', 'r.period_type', { filter: true, group: true, default: true }),
        col('period', 'Period', 'text', 'r.period', { filter: true, group: true, default: true }),
        col('status', 'Status', 'enum', 'r.status', { filter: true, group: true, default: true }),
        col('items_total', 'Items', 'int', 'r.items_total', { agg: 'sum' }),
        col('items_auto_matched', 'Matched', 'int', 'r.items_auto_matched', { agg: 'sum', default: true }),
        col('items_exception', 'Exceptions', 'int', 'r.items_exception', { agg: 'sum', default: true }),
        col('auto_match_pct', 'Matched (%)', 'percent', 'r.auto_match_pct'),
        col('unreconciled_amount', 'Unreconciled amount', 'money', 'r.unreconciled_amount', { agg: 'sum', filter: true, default: true }),
        col('energy_match', 'Energy agrees', 'enum', "CASE WHEN r.energy_match = 1 THEN 'YES' ELSE 'NO' END", { filter: true, labels: YES_NO }),
        col('payment_match', 'Payments agree', 'enum', "CASE WHEN r.payment_match = 1 THEN 'YES' ELSE 'NO' END", { filter: true, labels: YES_NO }),
        col('created_on', 'Prepared on', 'date', 'date(r.created_at)', { filter: true }),
        col('sjvn_ack_at', 'SJVN signed', 'date', 'date(r.sjvn_ack_at)', { default: true }),
        col('counterparty_ack_at', 'Counterparty signed', 'date', 'date(r.counterparty_ack_at)', { default: true }),
        col('finance_ack_at', 'Finance concurred', 'date', 'date(r.finance_ack_at)', { internal: true }),
        col('closed_at', 'Closed on', 'date', 'date(r.closed_at)', { filter: true }),
        col('created_by', 'Prepared by', 'text', 'r.created_by', { filter: true, group: true, internal: true, user: true }),
      ],
    },

    approvals: {
      title: 'Approvals (maker–checker)',
      blurb: 'Every approval step on REIA bills and on debit/credit notes: who prepared, who decided, at which level, and when.',
      access: 'internal',
      from: `(
        SELECT 'BILL' AS doc_kind, i.invoice_no AS doc_no, i.contract_id, i.direction, i.billing_period AS period,
               i.total_amount AS amount, i.created_by AS maker, a.level, a.approver_name AS decided_by,
               a.status AS decision, a.acted_at, a.comments
        FROM invoice_approvals a JOIN invoices i ON i.id = a.invoice_id
        UNION ALL
        SELECT 'NOTE', n.note_no, n.contract_id, inv.direction, n.period_month, n.amount, n.created_by, NULL,
               n.approved_by,
               CASE WHEN n.approved_at IS NOT NULL THEN 'APPROVED' WHEN n.rejected_reason IS NOT NULL THEN 'REJECTED' ELSE 'PENDING' END,
               COALESCE(n.approved_at, CASE WHEN n.rejected_reason IS NOT NULL THEN n.updated_at END),
               COALESCE(n.rejected_reason, n.cancel_reason)
        FROM debit_credit_notes n LEFT JOIN invoices inv ON inv.id = n.invoice_id
        WHERE n.status <> 'CANCELLED' OR n.approved_at IS NOT NULL
      ) x JOIN contracts c ON c.id = x.contract_id ${SELLER_JOIN} ${BUYER_JOIN}`,
      where: [REIA()],
      scope: () => ({ sql: '0', params: [] }),
      projectCols: ['x.contract_id'],
      defaultSort: [{ key: 'acted_at', dir: 'desc' }],
      columns: [
        col('contract_id', '', 'text', 'x.contract_id', { hidden: true }),
        col('acted_at', 'Decided on', 'datetime', 'x.acted_at', { filter: true, default: true }),
        col('doc_kind', 'Document', 'enum', 'x.doc_kind', { filter: true, group: true, default: true, labels: { BILL: 'Bill', NOTE: 'Debit / credit note' } }),
        col('doc_no', 'Document no.', 'text', 'x.doc_no', { default: true, filter: 'search' }),
        directionCol('x'),
        col('contract_no', 'Contract', 'text', 'c.contract_no', { filter: true, group: true }),
        col('counterparty_name', 'Counterparty', 'text', 'COALESCE(CASE WHEN x.direction = \'SJVN_TO_BUYER\' THEN b.name ELSE s.name END, b.name, s.name)', { filter: true, group: true }),
        col('period', 'Period', 'month', 'x.period', { filter: true, group: true }),
        col('amount', 'Document amount', 'money', 'x.amount', { filter: true }),
        col('level', 'Level', 'enum', "CASE x.level WHEN 1 THEN 'L1' WHEN 2 THEN 'L2' WHEN 3 THEN 'L3' ELSE CASE WHEN x.level IS NULL THEN 'NOTE' ELSE 'L' || x.level END END", {
          filter: true, group: true, default: true,
          labels: { L1: 'L1 — Checker', L2: 'L2 — Finance', L3: 'L3 — Approver', NOTE: 'Note approval' },
        }),
        col('maker', 'Prepared by (maker)', 'text', 'x.maker', { filter: true, group: true, default: true, user: true }),
        col('decided_by', 'Decided by', 'text', 'x.decided_by', { filter: true, group: true, default: true, user: true }),
        col('decision', 'Decision', 'enum', 'x.decision', { filter: true, group: true, default: true }),
        col('same_person', 'Maker also decided', 'enum', "CASE WHEN x.decided_by IS NOT NULL AND x.maker IS NOT NULL AND lower(trim(x.decided_by)) = lower(trim(x.maker)) THEN 'YES' ELSE 'NO' END", {
          filter: true, group: true, labels: YES_NO, default: true,
          note: 'The same name as maker and decider — a segregation-of-duties exception to look at.',
        }),
        col('comments', 'Comments', 'text', 'x.comments'),
      ],
    },

    audit: {
      title: 'Audit trail',
      blurb: 'Who did what on the REIA desk, when and from where — every recorded action, filterable by user.',
      access: 'governance',
      from: 'audit_logs l',
      // The REIA desk's trail: not the other desks' modules, users or records.
      where: [
        "COALESCE(l.module, '') NOT IN ('TRADING','HYDRO','THERMAL','COMMERCIAL')",
        "COALESCE(l.user_role, '') NOT GLOB 'TRADING*' AND COALESCE(l.user_role, '') NOT GLOB 'COMMERCIAL*' AND COALESCE(l.user_role, '') NOT GLOB 'THERMAL*' AND COALESCE(l.user_role, '') NOT GLOB 'HYDRO*'",
        "lower(COALESCE(l.entity_type, '')) NOT GLOB 'hydro*' AND lower(COALESCE(l.entity_type, '')) NOT GLOB 'thermal*' AND lower(COALESCE(l.entity_type, '')) NOT GLOB 'trading*'",
      ],
      scope: () => ({ sql: '0', params: [] }),
      projectCols: null,
      defaultSort: [{ key: 'created_at', dir: 'desc' }],
      columns: [
        col('created_at', 'When', 'datetime', 'l.created_at', { filter: true, default: true }),
        col('log_date', 'Day', 'date', 'date(l.created_at)', { group: true }),
        col('user_name', 'User', 'text', 'l.user_name', { filter: true, group: true, default: true, user: true }),
        col('user_role', 'Role', 'enum', 'l.user_role', { filter: true, group: true, default: true }),
        col('action', 'Action', 'enum', 'l.action', { filter: true, group: true, default: true }),
        col('module', 'Module', 'enum', 'l.module', { filter: true, group: true, default: true }),
        col('entity_type', 'Record type', 'enum', 'l.entity_type', { filter: true, group: true, default: true }),
        col('entity_id', 'Record', 'text', 'l.entity_id', { default: true, filter: 'search' }),
        col('reason', 'Reason', 'text', 'l.reason'),
        col('ip_address', 'IP address', 'text', 'l.ip_address', { filter: 'search' }),
        col('trace_id', 'Trace id', 'text', 'l.trace_id'),
      ],
    },

    sap: {
      title: 'SAP posting status',
      blurb: 'REIA postings prepared for SAP FI: the month and category booked, the amounts, the FI document and what SAP answered.',
      access: 'internal',
      from: 'reia_fi_postings f',
      where: [],
      scope: () => ({ sql: '0', params: [] }),
      projectCols: null,
      defaultSort: [{ key: 'period_month', dir: 'desc' }],
      columns: [
        col('posting_no', 'Posting no.', 'text', 'f.posting_no', { default: true, filter: 'search' }),
        col('period_month', 'Month', 'month', 'f.period_month', { filter: true, group: true, default: true }),
        col('category', 'Category', 'enum', 'f.category', { filter: true, group: true, default: true, labels: { SALE: 'Sales (PSA bills)', PURCHASE: 'Purchases (PPA bills)', CREDIT_NOTE: 'Credit notes', POOL: 'DSM pool' } }),
        col('docs_count', 'Documents', 'int', 'f.docs_count', { agg: 'sum', default: true }),
        col('energy_amount', 'Energy', 'money', 'f.energy_amount', { agg: 'sum' }),
        col('margin_amount', MARGIN_LABEL, 'money', 'f.margin_amount', { agg: 'sum' }),
        col('pass_through_amount', 'Pass-through', 'money', 'f.pass_through_amount', { agg: 'sum' }),
        col('tax_amount', 'Tax', 'money', 'f.tax_amount', { agg: 'sum' }),
        col('adjustment_amount', 'Adjustments', 'money', 'f.adjustment_amount', { agg: 'sum' }),
        col('total_amount', 'Total', 'money', 'f.total_amount', { agg: 'sum', filter: true, default: true }),
        col('status', 'Status', 'enum', 'f.status', { filter: true, group: true, default: true }),
        col('fi_document_no', 'FI document', 'text', 'f.fi_document_no', { default: true, filter: 'search' }),
        col('posted_at', 'Posted on', 'date', 'date(f.posted_at)', { filter: true, default: true }),
        col('posted_by', 'Posted by', 'text', 'f.posted_by', { filter: true, group: true, user: true }),
        col('created_by', 'Prepared by', 'text', 'f.created_by', { filter: true, group: true, user: true }),
        col('reversed_at', 'Reversed on', 'date', 'date(f.reversed_at)'),
        col('reversal_reason', 'Reversal reason', 'text', 'f.reversal_reason'),
        ...(sapPushes ? [
          col('sap_sent', 'Sent to SAP', 'int', "(SELECT COUNT(*) FROM reia_sap_pushes sp WHERE sp.posting_id = f.id AND sp.status IN ('SENT','BOOKED'))", { agg: 'sum', default: true }),
          col('sap_failed', 'Refused by SAP', 'int', "(SELECT COUNT(*) FROM reia_sap_pushes sp WHERE sp.posting_id = f.id AND sp.status = 'FAILED')", { agg: 'sum', default: true }),
          col('sap_unknown', 'Awaiting SAP answer', 'int', "(SELECT COUNT(*) FROM reia_sap_pushes sp WHERE sp.posting_id = f.id AND sp.status = 'UNKNOWN')", { agg: 'sum' }),
          col('sap_last_message', 'Last SAP message', 'text', "(SELECT COALESCE(sp.sap_message, sp.error) FROM reia_sap_pushes sp WHERE sp.posting_id = f.id ORDER BY sp.created_at DESC LIMIT 1)"),
        ] : []),
      ],
    },
  };
}

let cached = null;
const datasets = () => (cached = cached || buildDatasets());

// ── Predefined reports ───────────────────────────────────────────────────────

const ISSUED_BILL = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED', 'PAID'];

/**
 * One click each. A preset is only a saved spec over a dataset, so it is
 * scoped, filtered and exported exactly as a custom report is, and the builder
 * can open it to change.
 *
 * `cp` is the same report as a seller or a buyer reads it in its own portal:
 * named from its side of the contract, and without SJVN's columns (the
 * "Counterparty" column is SJVN's view of who the other party is).
 */
const AGEING_COLS = ['invoice_no', 'due_date', 'days_past_due', 'outstanding', 'not_due', 'days_0_30', 'days_31_60', 'days_61_90', 'days_90_plus', 'lps_accrued_unbilled'];
const MONTHLY_COLS = ['billing_period', 'energy_mwh', 'total_amount', 'rebate', 'lps', 'paid_total', 'balance_due'];
export const PRESETS = [
  { id: 'bills-psa', group: 'Billing', title: 'Bills register — buyer side (PSA)', blurb: 'Bills SJVN raised on buyers, with payments and balance.', counterparty: 'BUYER',
    cp: { BUYER: { title: 'Bills from SJVN (PSA)', blurb: 'Each bill SJVN raised on you, with what was paid and what is still due.' } },
    spec: { dataset: 'invoices', filters: [{ key: 'direction', op: 'in', value: ['SJVN_TO_BUYER'] }] } },
  { id: 'bills-ppa', group: 'Billing', title: 'Bills register — seller side (PPA)', blurb: 'Developers\' bills to SJVN, with payments and balance.', counterparty: 'SELLER',
    cp: { SELLER: { title: 'My bills to SJVN (PPA)', blurb: 'Each bill you raised on SJVN, with what was paid and what is still due.' } },
    spec: { dataset: 'invoices', filters: [{ key: 'direction', op: 'in', value: ['SELLER_TO_SJVN'] }] } },
  { id: 'billing-monthly-sales', group: 'Billing', title: 'Monthly sales billing (PSA)', blurb: 'Bills issued to buyers, totalled by billing month.', counterparty: 'BUYER',
    cp: { BUYER: { title: 'Monthly billing from SJVN (PSA)', blurb: 'The bills SJVN issued to you, totalled by billing month.' } },
    spec: { dataset: 'invoices', columns: MONTHLY_COLS,
      filters: [{ key: 'direction', op: 'in', value: ['SJVN_TO_BUYER'] }, { key: 'status', op: 'in', value: ISSUED_BILL }],
      group_by: 'billing_period', summary: true, sort: [{ key: 'billing_period', dir: 'desc' }] } },
  { id: 'billing-monthly-purchases', group: 'Billing', title: 'Monthly purchase billing (PPA)', blurb: 'Developers\' approved bills, totalled by billing month.', counterparty: 'SELLER',
    cp: { SELLER: { title: 'Monthly billing to SJVN (PPA)', blurb: 'Your bills SJVN approved, totalled by billing month.' } },
    spec: { dataset: 'invoices', columns: MONTHLY_COLS,
      filters: [{ key: 'direction', op: 'in', value: ['SELLER_TO_SJVN'] }, { key: 'status', op: 'in', value: ISSUED_BILL }],
      group_by: 'billing_period', summary: true, sort: [{ key: 'billing_period', dir: 'desc' }] } },
  { id: 'payments', group: 'Money', title: 'Payments and receipts', blurb: 'Every receipt from buyers and payment to developers.',
    cp: {
      SELLER: { title: 'Payments received from SJVN', blurb: 'Every payment SJVN made against your bills.' },
      BUYER: { title: 'Payments made to SJVN', blurb: 'Every payment recorded against SJVN\'s bills to you.' },
    },
    spec: { dataset: 'payments' } },
  { id: 'ageing-buyers', group: 'Money', title: 'Outstanding and ageing — buyers', blurb: 'What each buyer still owes, split by age.', counterparty: 'BUYER',
    cp: { BUYER: { title: 'What you owe SJVN, by age', blurb: 'Each SJVN bill not yet paid in full, by contract, split by how late it is.',
      spec: { columns: ['contract_no', ...AGEING_COLS], group_by: 'contract_no' } } },
    spec: { dataset: 'outstanding', columns: ['counterparty_name', ...AGEING_COLS],
      filters: [{ key: 'direction', op: 'in', value: ['SJVN_TO_BUYER'] }], group_by: 'counterparty_name' } },
  { id: 'ageing-developers', group: 'Money', title: 'Outstanding and ageing — developers', blurb: 'What SJVN still owes each developer, split by age.', counterparty: 'SELLER',
    cp: { SELLER: { title: 'What SJVN owes you, by age', blurb: 'Each of your bills SJVN has not yet paid in full, by contract, split by how late it is.',
      spec: { columns: ['contract_no', ...AGEING_COLS], group_by: 'contract_no' } } },
    spec: { dataset: 'outstanding', columns: ['counterparty_name', ...AGEING_COLS],
      filters: [{ key: 'direction', op: 'in', value: ['SELLER_TO_SJVN'] }], group_by: 'counterparty_name' } },
  { id: 'lps', group: 'Money', title: 'LPS accrued and billed', blurb: 'Surcharge charged, received and accruing unbilled, bill by bill.',
    spec: { dataset: 'lps', group_by: 'lps_status' } },
  { id: 'rebates', group: 'Money', title: 'Rebates allowed and availed', blurb: 'Prompt-payment rebate on each bill, both directions.',
    cp: {
      SELLER: { blurb: 'Prompt-payment rebate on each of your bills.', spec: { group_by: null } },
      BUYER: { blurb: 'Prompt-payment rebate on each SJVN bill you paid.', spec: { group_by: null } },
    },
    spec: { dataset: 'rebates', group_by: 'direction' } },
  { id: 'disputes', group: 'Disputes and notes', title: 'Disputes register', blurb: 'All disputes with amounts, SLA and outcome.',
    spec: { dataset: 'disputes' } },
  { id: 'disputes-open', group: 'Disputes and notes', title: 'Open disputes by reason', blurb: 'Disputes still open, grouped by reason.',
    spec: { dataset: 'disputes', filters: [{ key: 'status', op: 'in', value: ['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED'] }], group_by: 'reason_code' } },
  { id: 'notes', group: 'Disputes and notes', title: 'Debit and credit notes', blurb: 'Every note with maker, approver and amount applied.',
    spec: { dataset: 'notes', group_by: 'note_type' } },
  { id: 'energy-ppa', group: 'Energy and contracts', title: 'Energy accounts — generation (PPA)', blurb: 'Energy recorded on each PPA, month by month.', counterparty: 'SELLER',
    cp: { SELLER: { title: 'Energy accounts (PPA)', blurb: 'Energy recorded on each of your PPAs, month by month.' } },
    spec: { dataset: 'energy', filters: [{ key: 'contract_type', op: 'in', value: ['PPA'] }, { key: 'superseded', op: 'in', value: ['NO'] }], group_by: 'contract_no' } },
  { id: 'energy-psa', group: 'Energy and contracts', title: 'Energy supplied to beneficiaries (PSA)', blurb: 'Energy on each PSA, grouped by buyer.', counterparty: 'BUYER',
    cp: { BUYER: { title: 'Energy supplied to you (PSA)', blurb: 'Energy on each of your PSAs, month by month.', spec: { group_by: 'contract_no' } } },
    spec: { dataset: 'energy', filters: [{ key: 'contract_type', op: 'in', value: ['PSA'] }, { key: 'superseded', op: 'in', value: ['NO'] }], group_by: 'buyer_name' } },
  { id: 'allocations', group: 'Energy and contracts', title: 'Energy allocated by beneficiary', blurb: 'Each PPA\'s energy split onto the PSAs it feeds.',
    spec: { dataset: 'allocations', group_by: 'buyer_name' } },
  { id: 'contracts', group: 'Energy and contracts', title: 'Contracts register', blurb: 'All PPAs and PSAs with capacity, tariff and tenure.',
    cp: {
      SELLER: { title: 'My contracts (PPAs)', blurb: 'Your PPAs with SJVN: capacity, tariff and tenure.', spec: { group_by: null } },
      BUYER: { title: 'My contracts (PSAs)', blurb: 'Your PSAs with SJVN: capacity, tariff and tenure.', spec: { group_by: null } },
    },
    spec: { dataset: 'contracts', group_by: 'contract_type' } },
  { id: 'security', group: 'Security and reconciliation', title: 'Payment security and expiry', blurb: 'LCs and BGs held, nearest expiry first.',
    cp: {
      SELLER: { blurb: 'The security instruments on your contracts, nearest expiry first.' },
      BUYER: { blurb: 'The security instruments on your contracts, nearest expiry first.' },
    },
    spec: { dataset: 'security', group_by: 'expiry_bucket' } },
  { id: 'reconciliation', group: 'Security and reconciliation', title: 'Reconciliation statements', blurb: 'Statements, exceptions and sign-offs.',
    spec: { dataset: 'reconciliation' } },
  { id: 'approvals', group: 'Governance', title: 'Approvals and maker–checker activity', blurb: 'Every approval step, grouped by who decided.',
    spec: { dataset: 'approvals', group_by: 'decided_by' } },
  { id: 'audit-users', group: 'Governance', title: 'Audit trail by user', blurb: 'Every recorded action on the desk, grouped by user.',
    spec: { dataset: 'audit', group_by: 'user_name' } },
  { id: 'sap', group: 'Governance', title: 'SAP posting status', blurb: 'Postings prepared for SAP FI and what SAP answered.',
    spec: { dataset: 'sap' } },
];

// ── Catalogue ────────────────────────────────────────────────────────────────

const OPS = (c) => {
  if (!c.filter) return [];
  if (c.filter === 'search') return ['contains'];
  if (NUMERIC.has(c.type) || ['date', 'datetime', 'month'].includes(c.type)) return ['between'];
  return ['in'];
};
const publicCol = (c) => ({
  key: c.key, label: c.label, type: c.type, ops: OPS(c), group: !!c.group, agg: c.agg || null,
  default: !!c.default, labels: c.labels || null, note: c.note || null, user: !!c.user,
});

/** What this reader may build reports from, and the presets it may run. */
export function catalogFor(user) {
  const reader = readerOf(user);
  if (!reader) return null;
  const all = datasets();
  const out = [];
  for (const [key, ds] of Object.entries(all)) {
    if (!mayOpen(ds, reader)) continue;
    const cols = ds.columns.filter((c) => shows(c, reader));
    out.push({
      key, title: ds.title, blurb: ds.blurb,
      columns: cols.map(publicCol),
      default_sort: ds.defaultSort,
    });
  }
  const open = new Set(out.map((d) => d.key));
  const presets = PRESETS
    .filter((p) => open.has(p.spec.dataset))
    // A counterparty reads its own side's ageing, not the other side's.
    .filter((p) => reader.internal || !p.counterparty || p.counterparty === reader.side)
    .map((p) => {
      const own = reader.internal ? null : p.cp?.[reader.side];
      const title = own?.title || p.title;
      // Debit and credit notes are SJVN's own book, so a counterparty's group is disputes alone.
      const group = !reader.internal && p.group === 'Disputes and notes' ? 'Disputes' : p.group;
      const spec = { ...p.spec, ...own?.spec, title };
      // A counterparty's rows all run one way already; "Receivable from buyer" is SJVN's word for them.
      if (!reader.internal && spec.filters) spec.filters = spec.filters.filter((f) => f.key !== 'direction');
      return { id: p.id, group, title, blurb: own?.blurb || p.blurb, spec };
    })
    .filter((p) => {
      try { normalise(p.spec, reader); return true; } catch { return false; }
    });
  return {
    datasets: out,
    presets,
    scope_note: scopeNote(reader),
    max_rows: MAX_ROWS,
    // Saved layouts are shared among SJVN's officers only (see saveTemplate).
    can_share: reader.internal,
    // Whose screen this is: null for SJVN, else the counterparty's side.
    side: reader.side,
  };
}

function scopeNote(reader) {
  if (!reader.internal) return 'Rows your company is a party to, as your other screens show them.';
  if (reader.projects) return 'Your assigned projects only.';
  return null;
}

// ── The spec ─────────────────────────────────────────────────────────────────

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * A request checked against the dataset's declared lists, and filled in with
 * defaults. Anything not declared — a dataset, a column, an operator — is
 * refused rather than ignored, so a mistyped filter is never an unfiltered report.
 */
export function normalise(spec, reader) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw bad('The report needs a dataset');
  const ds = Object.prototype.hasOwnProperty.call(datasets(), spec.dataset) ? datasets()[spec.dataset] : null;
  if (!ds) throw bad(`Unknown dataset "${spec.dataset}"`);
  if (!mayOpen(ds, reader)) throw Object.assign(new Error('This report is not available to your role'), { status: 403 });
  const visible = new Map(ds.columns.filter((c) => shows(c, reader)).map((c) => [c.key, c]));

  let columns = Array.isArray(spec.columns) && spec.columns.length ? spec.columns.map(String) : ds.columns.filter((c) => c.default && shows(c, reader)).map((c) => c.key);
  columns = [...new Set(columns)];
  const unknown = columns.filter((k) => !visible.has(k));
  if (unknown.length) throw bad(`Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  if (columns.length > 40) throw bad('A report can show at most 40 columns');

  const filters = [];
  for (const f of Array.isArray(spec.filters) ? spec.filters : []) {
    const c = visible.get(String(f?.key));
    if (!c) throw bad(`Unknown filter "${f?.key}"`);
    const op = String(f.op || '');
    if (!OPS(c).includes(op)) throw bad(`"${c.label}" cannot be filtered with "${op}"`);
    if (op === 'in') {
      const vals = (Array.isArray(f.value) ? f.value : [f.value]).filter((v) => v !== null && v !== undefined && v !== '').map(String);
      if (!vals.length) continue;
      if (vals.length > 200) throw bad(`Too many values for "${c.label}"`);
      filters.push({ key: c.key, op, value: vals });
    } else if (op === 'contains') {
      const v = String(f.value ?? '').trim();
      if (!v) continue;
      if (v.length > 100) throw bad(`The search for "${c.label}" is too long`);
      filters.push({ key: c.key, op, value: v });
    } else {
      const [lo, hi] = Array.isArray(f.value) ? f.value : [];
      const isBlank = (v) => v === null || v === undefined || v === '';
      if (isBlank(lo) && isBlank(hi)) continue;
      let from = isBlank(lo) ? null : lo;
      let to = isBlank(hi) ? null : hi;
      if (c.type === 'month') {
        if ((from && !MONTH_RE.test(from)) || (to && !MONTH_RE.test(to))) throw bad(`"${c.label}" takes months as YYYY-MM`);
      } else if (c.type === 'date' || c.type === 'datetime') {
        if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw bad(`"${c.label}" takes dates as YYYY-MM-DD`);
      } else {
        from = from === null ? null : Number(from);
        to = to === null ? null : Number(to);
        if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to))) throw bad(`"${c.label}" takes numbers`);
      }
      if (from !== null && to !== null && from > to) throw bad(`"${c.label}": the "from" value is after the "to" value`);
      filters.push({ key: c.key, op, value: [from, to] });
    }
  }

  let groupBy = spec.group_by ? String(spec.group_by) : null;
  if (groupBy) {
    const g = visible.get(groupBy);
    if (!g || !g.group) throw bad(`A report cannot be grouped by "${groupBy}"`);
  }
  const sort = (Array.isArray(spec.sort) && spec.sort.length ? spec.sort : ds.defaultSort)
    .slice(0, 3)
    .map((s) => ({ key: String(s?.key), dir: s?.dir === 'desc' ? 'desc' : 'asc' }))
    .filter((s) => visible.has(s.key));
  const summary = !!spec.summary && !!groupBy;
  // A name for the report (a preset's or a saved one's), shown and printed as text.
  const title = typeof spec.title === 'string' ? spec.title.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  return { dataset: spec.dataset, title, columns, filters, group_by: groupBy, sort, summary, ds, visible };
}

// ── Running a report ─────────────────────────────────────────────────────────

const round2 = (v) => Math.round(Number(v) * 100) / 100;

function compare(a, b, type) {
  const na = a === null || a === undefined || a === '';
  const nb = b === null || b === undefined || b === '';
  if (na || nb) return na === nb ? 0 : na ? 1 : -1;  // blanks last either way
  if (NUMERIC.has(type)) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true });
}

function matches(row, f, c) {
  const v = row[c.key];
  if (f.op === 'in') return f.value.includes(v === null || v === undefined ? '' : String(v));
  if (f.op === 'contains') return String(v ?? '').toLowerCase().includes(f.value.toLowerCase());
  const [lo, hi] = f.value;
  if (v === null || v === undefined || v === '') return false;
  const x = NUMERIC.has(c.type) ? Number(v) : String(v).slice(0, c.type === 'month' ? 7 : 10);
  if (lo !== null && x < lo) return false;
  if (hi !== null && x > hi) return false;
  return true;
}

function sqlFilter(f, c) {
  const e = c.sql;
  if (f.op === 'in') return { sql: `CAST(${e} AS TEXT) IN (${f.value.map(() => '?').join(',')})`, params: f.value };
  if (f.op === 'contains') return { sql: `lower(COALESCE(${e}, '')) LIKE ? ESCAPE '\\'`, params: [`%${f.value.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`] };
  const [lo, hi] = f.value;
  const left = c.type === 'date' || c.type === 'datetime' ? `date(${e})` : c.type === 'month' ? `substr(${e}, 1, 7)` : e;
  const parts = [];
  const params = [];
  if (lo !== null) { parts.push(`${left} >= ?`); params.push(lo); }
  if (hi !== null) { parts.push(`${left} <= ?`); params.push(hi); }
  return { sql: parts.join(' AND '), params };
}

/** The base WHERE every query on this dataset carries for this reader. */
function baseWhere(ds, reader) {
  const where = [...ds.where];
  const params = [];
  if (!reader.internal) {
    const s = ds.scope(reader.side, reader.entityId);
    if (!s) where.push('0');
    else { where.push(s.sql); params.push(...s.params); }
  }
  if (reader.projects && ds.projectCols) {
    const ids = [...reader.projects];
    if (!ids.length) where.push('0');
    else {
      const ph = ids.map(() => '?').join(',');
      where.push(`(${ds.projectCols.map((pc) => `${pc} IN (${ph})`).join(' OR ')})`);
      for (let k = 0; k < ds.projectCols.length; k += 1) params.push(...ids);
    }
  }
  return { where, params };
}

// The other desks' officers, by the names the tables record them under. In the
// beta a row naming one of them is not a REIA row to show.
function otherDeskNames() {
  if (!REIA_BETA) return null;
  return new Set(db.prepare('SELECT name, role FROM users').all()
    .filter((u) => /^(TRADING|COMMERCIAL|THERMAL|HYDRO)/.test(u.role || ''))
    .map((u) => String(u.name || '').toLowerCase()));
}
function betaCut(rows, ds) {
  if (!REIA_BETA) return rows;
  const names = otherDeskNames();
  const userCols = ds.columns.filter((c) => c.user).map((c) => c.key);
  return betaRows(rows).filter((r) => !userCols.some((k) => r[k] && names.has(String(r[k]).toLowerCase())));
}

function fetchRows(n, reader, needed) {
  const { ds } = n;
  const { where, params } = baseWhere(ds, reader);
  const jsFilters = [];
  for (const f of n.filters) {
    const c = ds.columns.find((x) => x.key === f.key);
    if (c.sql) {
      const s = sqlFilter(f, c);
      where.push(s.sql);
      params.push(...s.params);
    } else {
      jsFilters.push([f, c]);
    }
  }
  const selected = ds.columns.filter((c) => c.sql);
  const sql = `SELECT ${selected.map((c) => `${c.sql} AS "${c.key}"`).join(',\n  ')}
    FROM ${ds.from}
    ${where.length ? `WHERE ${where.map((w) => `(${w})`).join(' AND ')}` : ''}`;
  let rows = db.prepare(sql).all(...params);
  // Computed figures, only the ones this report reads.
  const computed = ds.columns.filter((c) => c.compute && needed.has(c.key));
  if (computed.length) {
    for (const r of rows) for (const c of computed) r[c.key] = c.compute(r);
  }
  for (const [f, c] of jsFilters) rows = rows.filter((r) => matches(r, f, c));
  if (ds.keep) rows = rows.filter(ds.keep);
  return betaCut(rows, ds);
}

const display = (c, v) => {
  if (v === null || v === undefined) return v;
  if (c.labels && Object.prototype.hasOwnProperty.call(c.labels, v)) return c.labels[v];
  if (c.format) return c.format(v);
  // A status code reads as the badges on the screens write it: PARTIALLY PAID.
  if (c.type === 'enum') return String(v).replace(/_/g, ' ');
  return v;
};

function totalsOf(rows, cols) {
  const t = {};
  for (const c of cols) {
    if (c.agg !== 'sum') continue;
    let s = 0;
    for (const r of rows) s += Number(r[c.key]) || 0;
    t[c.key] = c.type === 'money' ? round2(s) : Math.round(s * 1000) / 1000;
  }
  return t;
}

/**
 * Run a report for a reader. Returns the columns shown, the rows (or groups
 * of rows with their subtotals) and the grand totals.
 */
export function runReport(spec, user) {
  const reader = readerOf(user);
  if (!reader) throw Object.assign(new Error('Reports are not available to your role'), { status: 403 });
  const n = normalise(spec, reader);
  const { ds } = n;
  const needed = new Set([...n.columns, ...n.filters.map((f) => f.key), ...n.sort.map((s) => s.key), ...(n.group_by ? [n.group_by] : []), ...(ds.needs || [])]);
  let rows = fetchRows(n, reader, needed);

  const truncated = rows.length > MAX_ROWS;
  const total = rows.length;
  let colDefs = n.columns.map((k) => n.visible.get(k));
  // Subtotals only: one line per group, so the group and the figures that add up.
  if (n.summary) {
    const g = n.visible.get(n.group_by);
    colDefs = [g, ...colDefs.filter((c) => c.agg === 'sum' && c.key !== g.key)];
  }
  const sortDefs = n.sort.map((s) => ({ ...s, type: n.visible.get(s.key).type }));
  rows.sort((a, b) => {
    for (const s of sortDefs) {
      const d = compare(a[s.key], b[s.key], s.type);
      if (d) return s.dir === 'desc' ? -d : d;
    }
    return 0;
  });
  if (truncated) rows = rows.slice(0, MAX_ROWS);

  // Money to the paisa, energy to three places; nothing a reader is not shown.
  const out = rows.map((r) => {
    const o = {};
    for (const c of colDefs) {
      const v = r[c.key];
      o[c.key] = v === null || v === undefined ? null : c.type === 'money' ? round2(v) : c.format ? c.format(v) : v;
    }
    if (n.group_by && !n.columns.includes(n.group_by)) o[n.group_by] = r[n.group_by];
    return o;
  });

  let groups = null;
  if (n.group_by) {
    const g = n.visible.get(n.group_by);
    const byKey = new Map();
    for (const r of out) {
      const k = r[n.group_by] === null || r[n.group_by] === undefined ? '' : String(r[n.group_by]);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
    const sortOnGroup = n.sort.find((s) => s.key === n.group_by);
    groups = [...byKey.entries()]
      .sort((a, b) => {
        const d = compare(a[0], b[0], g.type);
        return sortOnGroup?.dir === 'desc' ? -d : d;
      })
      .map(([key, list]) => ({
        key,
        label: key === '' ? '(blank)' : String(display(g, key)),
        count: list.length,
        subtotals: totalsOf(list, colDefs),
        rows: n.summary ? [] : list,
      }));
    if (!n.columns.includes(n.group_by)) for (const r of out) delete r[n.group_by];
  }

  return {
    dataset: n.dataset,
    title: n.title || ds.title,
    dataset_title: ds.title,
    spec: { dataset: n.dataset, title: n.title || undefined, columns: n.columns, filters: n.filters, group_by: n.group_by, sort: n.sort, summary: n.summary },
    columns: colDefs.map(publicCol),
    group_column: n.group_by ? publicCol(n.visible.get(n.group_by)) : null,
    rows: groups ? null : out,
    groups,
    totals: totalsOf(out, colDefs),
    count: total,
    truncated,
    criteria: criteriaText(n),
    scope_note: scopeNote(reader),
    generated_at: new Date().toISOString(),
    generated_by: user?.name || user?.email || null,
  };
}

// A bound as a reader writes it: "1 Apr 2026", "Apr 2026", "₹50,00,000".
const bound = (c, v) => (c.type === 'money'
  ? `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
  : printed({ type: c.type === 'datetime' ? 'date' : c.type }, v));

/** The filters in words, for the top of an export and the PDF band. */
export function criteriaText(n) {
  const parts = n.filters.map((f) => {
    const c = n.visible.get(f.key);
    if (f.op === 'in') return `${c.label}: ${f.value.map((v) => display(c, v)).join(', ')}`;
    if (f.op === 'contains') return `${c.label} contains "${f.value}"`;
    const [lo, hi] = f.value.map((v) => (v === null ? null : bound(c, v)));
    if (lo !== null && hi !== null) return `${c.label}: ${lo} to ${hi}`;
    return lo !== null ? `${c.label}: from ${lo}` : `${c.label}: up to ${hi}`;
  });
  if (n.group_by) parts.push(`Grouped by ${n.visible.get(n.group_by).label}${n.summary ? ' (subtotals only)' : ''}`);
  return parts;
}

/**
 * The values a filter can take, from the rows this reader can see — so a
 * dropdown never offers a value that matches nothing, nor one from a record
 * the reader is not allowed.
 */
export function facetsFor(datasetKey, user) {
  const reader = readerOf(user);
  if (!reader) throw Object.assign(new Error('Reports are not available to your role'), { status: 403 });
  const n = normalise({ dataset: datasetKey }, reader);
  const { ds } = n;
  const out = {};
  const { where, params } = baseWhere(ds, reader);
  const whereSql = where.length ? `WHERE ${where.map((w) => `(${w})`).join(' AND ')}` : '';
  const names = otherDeskNames();
  for (const c of n.visible.values()) {
    if (!OPS(c).includes('in')) continue;
    let values;
    if (c.options) values = c.options;
    else if (c.sql) {
      values = db.prepare(`SELECT DISTINCT CAST(${c.sql} AS TEXT) AS v FROM ${ds.from} ${whereSql} ORDER BY v LIMIT 500`).all(...params)
        .map((r) => r.v).filter((v) => v !== null && v !== '');
    } else continue;
    let opts = values.map((v) => ({ value: v, label: String(display(c, v)) }));
    if (REIA_BETA) {
      opts = betaRows(opts.map((o) => ({ ...o, [c.key]: o.value }))).map(({ value, label }) => ({ value, label }));
      if (c.user) opts = opts.filter((o) => !names.has(String(o.value).toLowerCase()));
    }
    out[c.key] = opts;
  }
  return out;
}

// ── Saved reports ────────────────────────────────────────────────────────────

/** A user's saved layouts, and the ones colleagues shared with the desk. */
export function listTemplates(user) {
  const reader = readerOf(user);
  if (!reader) return [];
  const rows = db.prepare(`
    SELECT * FROM report_templates
    WHERE retired_at IS NULL AND (owner_id = ? OR (shared = 1 AND ? = 1))
    ORDER BY lower(name)
  `).all(user.id, reader.internal ? 1 : 0);
  return rows
    .map((t) => ({ ...t, spec: JSON.parse(t.spec_json), mine: t.owner_id === user.id, shared: !!t.shared }))
    .filter((t) => {
      try { normalise(t.spec, reader); return true; } catch { return false; }
    })
    .map(({ spec_json: _s, ...t }) => t);
}

export function saveTemplate(user, { name, spec, shared }) {
  const reader = readerOf(user);
  if (!reader) throw Object.assign(new Error('Reports are not available to your role'), { status: 403 });
  const label = String(name || '').trim();
  if (!label) throw bad('Give the report a name');
  if (label.length > 80) throw bad('Keep the name under 80 characters');
  const n = normalise(spec, reader);
  const clean = { dataset: n.dataset, title: label, columns: n.columns, filters: n.filters, group_by: n.group_by, sort: n.sort, summary: n.summary };
  // Sharing is among SJVN's own officers; a counterparty keeps its layouts to itself.
  const share = reader.internal && !!shared ? 1 : 0;
  const same = db.prepare('SELECT id FROM report_templates WHERE owner_id = ? AND lower(name) = lower(?) AND retired_at IS NULL').get(user.id, label);
  if (same) {
    db.prepare(`UPDATE report_templates SET dataset = ?, spec_json = ?, shared = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(n.dataset, JSON.stringify(clean), share, same.id);
    return { id: same.id, replaced: true };
  }
  const id = newId('RPT');
  db.prepare(`INSERT INTO report_templates (id, owner_id, owner_name, name, dataset, spec_json, shared) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, user.id, user.name || user.email || null, label, n.dataset, JSON.stringify(clean), share);
  return { id, replaced: false };
}

/** Only the owner removes a saved report; it is retired, not deleted. */
export function retireTemplate(user, id) {
  const t = db.prepare('SELECT * FROM report_templates WHERE id = ? AND retired_at IS NULL').get(String(id));
  if (!t || t.owner_id !== user.id) throw Object.assign(new Error('Saved report not found'), { status: 404 });
  db.prepare(`UPDATE report_templates SET retired_at = datetime('now') WHERE id = ?`).run(t.id);
  return { id: t.id };
}

/** For tests: forget the dataset list so a schema change is seen. */
export const forgetDatasets = () => { cached = null; };
