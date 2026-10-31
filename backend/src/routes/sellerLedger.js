/**
 * A seller's account with SJVN, as a ledger.
 *
 * The seller's side of every bill it has raised: what was billed, what was
 * paid, what was held back at source or allowed as rebate, and what debit and
 * credit notes did to it — each as a line, with a running balance. From it:
 *
 *   statement   for any stretch of dates, with the balance brought forward,
 *               as a screen, a workbook or a PDF to hand to an auditor;
 *   ageing      what is still owed, by how long it has been overdue;
 *   advice      for one payment, what it settled and what was taken off it;
 *   Form 16A    the quarterly TDS certificates Finance has issued.
 *
 * A seller reads its own account. SJVN's finance and REIA desks read any
 * seller's, and Finance files the certificates.
 */
import { Router } from 'express';
import XLSX from 'xlsx';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, pushNotification } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { invoiceLpsAsOf } from '../services/invoiceLps.js';
import { supersededByDeveloperSql } from '../services/outstanding.js';
import {
  newDoc, header, kpiBand, sectionTitle, table, notes as footNotes, pageNumbers, M, CONTENT_W, INK, MUTED, nowLabel,
} from '../scripts/reportPdfKit.js';

const router = Router();
router.use(requireAuth);

const INTERNAL_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
// A seller's Form 16A is SJVN's as the deductor, and Finance files it. ROLE_GROUPS.FINANCE
// also holds the REIA maker, which let the desk's maker file one too.
const canFile = (user) => user?.role === 'FINANCE_USER';
/** Whoever deducted the tax issues the certificate: SJVN for a seller's bills, the buyer for its own. */
const mayFile = (user, side, partySide) => (partySide === 'BUYER' ? side === 'BUYER' && !/_L1$/.test(user?.role || '') : canFile(user));
const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try { res.json(fn()); } catch (err) {
    if (!err.status) console.error('[LEDGER]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dayOf = (v) => String(v || '').slice(0, 10);
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A developer's bill is owed once SJVN has accepted it: one still submitted or
// in approval is not (yet), and counting it showed Sunrise's July bill, under
// approval, as money SJVN owed (17-Oct-2026 audit).
const NOT_BILLED = ['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'REJECTED', 'CANCELLED'];

/**
 * Whose account is being read: the counterparty's own, or the one SJVN asked for.
 *
 * It began as the seller's ledger and the result is still called `seller`; a
 * buyer's account with SJVN is the same ledger read the other way round — what
 * SJVN billed it, what it paid — so `party_side` says which it is.
 */
function sellerFor(user, entityId) {
  const side = counterpartySide(user);
  let id = null;
  if (side) id = user.linked_entity_id;
  else if (INTERNAL_READ.includes(user?.role)) id = entityId;
  else throw fail(403, 'Access denied');
  const seller = id && db.prepare(`SELECT id, name, pan_no, gst_no, address, entity_type FROM entities WHERE id = ?`).get(String(id));
  if (!seller) throw fail(side ? 404 : 400, side ? 'Your login is not linked to a company' : 'Choose the company whose account to open');
  const partySide = side || (seller.entity_type === 'BUYER' ? 'BUYER' : 'SELLER');
  return { seller, side: side || 'SJVN', partySide };
}
/** The contract column and bill direction that make a bill this party's. */
const billsOfSide = (partySide) => (partySide === 'BUYER'
  ? { col: 'c.buyer_id', direction: 'SJVN_TO_BUYER', notBilled: ['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'REJECTED', 'CANCELLED'] }
  : { col: 'c.seller_id', direction: 'SELLER_TO_SJVN', notBilled: NOT_BILLED });

const rangeOf = (q) => {
  const from = q.from || null;
  const to = q.to || null;
  for (const [k, v] of [['from', from], ['to', to]]) if (v && !DAY.test(v)) throw fail(400, `${k} must be YYYY-MM-DD`);
  if (from && to && from > to) throw fail(400, 'from must not be after to');
  return { from, to };
};

/**
 * Every line of the account, oldest first. A debit raises what SJVN owes the
 * seller; a credit lowers it.
 */
function entriesOf(sellerId, contractId, partySide = 'SELLER') {
  const of = billsOfSide(partySide);
  const buyer = partySide === 'BUYER';
  const invoices = db.prepare(`
    SELECT i.*, c.contract_no FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE ${of.col} = ? AND i.direction = '${of.direction}'
      AND i.status NOT IN (${of.notBilled.map(() => '?').join(',')})
      -- SJVN's computed bill of a month is not owed once the developer's own
      -- invoice for it is accepted: both were lines, and Sunrise's October
      -- stood at twice its ₹2.36 crore.
      AND ${supersededByDeveloperSql('i')}
      -- A DSM bill settles with the NRPC pool, not with this party.
      AND i.invoice_no NOT LIKE 'DSM-%'
      ${contractId ? 'AND i.contract_id = ?' : ''}
  `).all(sellerId, ...of.notBilled, ...(contractId ? [contractId] : []));
  // Advances the party holds with SJVN (PM2): money received that no bill took
  // is a credit when it arrives and a debit if it is refunded; applying it to a
  // bill moves nothing on the account (the payment line it makes is left out).
  const advanceEvents = buyer ? db.prepare(`
    SELECT ev.*, r.receipt_no, r.contract_id, c.contract_no FROM unapplied_receipt_events ev
    JOIN unapplied_receipts r ON r.id = ev.receipt_id LEFT JOIN contracts c ON c.id = r.contract_id
    WHERE r.entity_id = ? AND ev.event_type IN ('RECEIVED', 'REFUNDED') ${contractId ? 'AND r.contract_id = ?' : ''}
  `).all(sellerId, ...(contractId ? [contractId] : [])) : [];
  if (!invoices.length && !advanceEvents.length) return { invoices, entries: [] };
  const marks = invoices.map(() => '?').join(',');
  const ids = invoices.map((i) => i.id);
  const payments = db.prepare(`SELECT * FROM payments WHERE invoice_id IN (${marks}) ORDER BY payment_date, rowid`).all(...ids);
  // A debit note bills as an invoice of its own; knowing which is which lets the line say so.
  const debitNotes = new Map(db.prepare(`
    SELECT supp_invoice_id, note_no, reason FROM debit_credit_notes WHERE supp_invoice_id IN (${marks}) AND status NOT IN ('DRAFT','REJECTED','CANCELLED')
  `).all(...ids).map((n) => [n.supp_invoice_id, n]));
  const byInvoice = new Map(invoices.map((i) => [i.id, i]));
  const entries = [];
  const add = (e) => entries.push({ debit: 0, credit: 0, ...e, debit_: undefined });

  for (const i of invoices) {
    const dn = debitNotes.get(i.id);
    add({
      date: dayOf(i.issued_at || i.created_at), type: dn ? 'DEBIT_NOTE' : 'INVOICE', ref: i.invoice_no, invoice_no: i.invoice_no, contract_no: i.contract_no,
      particulars: dn ? `Debit note ${dn.note_no}${dn.reason ? ` — ${dn.reason}` : ''}` : `${i.invoice_type === 'FINAL' ? 'Invoice' : `${i.invoice_type[0]}${i.invoice_type.slice(1).toLowerCase()} invoice`} for ${i.billing_period}`,
      debit: money(i.total_amount), invoice_id: i.id, order: 0,
    });
  }
  const rebateSeen = new Map();
  const lastPaid = new Map();
  for (const p of payments) {
    const i = byInvoice.get(p.invoice_id);
    const base = { date: dayOf(p.payment_date), invoice_no: i.invoice_no, contract_no: i.contract_no, invoice_id: i.id, payment_id: p.id };
    lastPaid.set(i.id, base.date);
    if (p.mode === 'ADVANCE') continue;
    if (p.mode === 'CREDIT_NOTE') {
      add({ ...base, type: 'CREDIT_NOTE', ref: p.reference, particulars: `Credit note ${p.reference} applied`, credit: money(p.deduction), order: 2 });
      continue;
    }
    if (Number(p.amount) > 0) {
      add({ ...base, type: 'PAYMENT', ref: p.reference || '—', particulars: `${buyer ? 'Payment made' : 'Payment received'}${p.release_source ? ` (${p.release_source.replace(/_/g, ' ').toLowerCase()})` : p.mode ? ` (${p.mode})` : ''}`, credit: money(p.amount), order: 1 });
    }
    const tds = money(p.tds_amount);
    const other = money((Number(p.deduction) || 0) - tds);
    if (tds > 0) add({ ...base, type: 'TDS', ref: p.reference || '—', particulars: 'Tax deducted at source', credit: tds, order: 3 });
    if (other > 0) add({ ...base, type: 'DEDUCTION', ref: p.reference || '—', particulars: p.deduction_note ? `Deduction — ${p.deduction_note}` : 'Deduction on payment', credit: other, order: 4 });
    const rebate = money(p.rebate_amount);
    if (rebate > 0) {
      add({ ...base, type: 'REBATE', ref: i.invoice_no, particulars: 'Early-payment rebate allowed', credit: rebate, order: 5 });
      rebateSeen.set(i.id, money((rebateSeen.get(i.id) || 0) + rebate));
    }
  }
  // Rebate and surcharge held on the bill itself and not yet told as lines of their own.
  for (const i of invoices) {
    const rest = money((Number(i.rebate) || 0) - (rebateSeen.get(i.id) || 0));
    const on = lastPaid.get(i.id) || dayOf(i.updated_at || i.created_at);
    const base = { date: on, ref: i.invoice_no, invoice_no: i.invoice_no, contract_no: i.contract_no, invoice_id: i.id };
    if (rest > 0) add({ ...base, type: 'REBATE', particulars: 'Early-payment rebate allowed', credit: rest, order: 5 });
    if (Number(i.lps) > 0) add({ ...base, type: 'LPS', particulars: 'Late payment surcharge', debit: money(i.lps), order: 6 });
  }
  for (const ev of advanceEvents) {
    const base = { date: dayOf(ev.created_at), ref: ev.reference || ev.receipt_no, contract_no: ev.contract_no, invoice_no: null, invoice_id: null };
    if (ev.event_type === 'RECEIVED') add({ ...base, type: 'ADVANCE', particulars: `Advance received (${ev.receipt_no})${ev.note ? ` — ${ev.note}` : ''}`, credit: money(ev.amount), order: 1 });
    else add({ ...base, type: 'ADVANCE_REFUND', particulars: `Advance refunded (${ev.receipt_no})`, debit: money(ev.amount), order: 7 });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || String(a.ref).localeCompare(String(b.ref)));
  return { invoices, entries };
}

/** What is still open on each bill, and how late it is. */
function outstandingOf(invoices) {
  const asOf = new Date();
  return invoices.map((i) => {
    const paid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id = ?').get(i.id).s;
    const balance = money(Math.max(0, (Number(i.total_amount) || 0) - (Number(i.rebate) || 0) + (Number(i.lps) || 0) - paid));
    if (balance <= 0.5) return null;
    const days = i.due_date ? Math.round((new Date(`${today()}T00:00:00Z`) - new Date(`${dayOf(i.due_date)}T00:00:00Z`)) / 86400000) : null;
    let accrued = 0;
    try { accrued = money(invoiceLpsAsOf(i, asOf).lps); } catch { /* shown as nil */ }
    return {
      invoice_id: i.id, invoice_no: i.invoice_no, contract_no: i.contract_no, billing_period: i.billing_period, status: i.status,
      due_date: i.due_date ? dayOf(i.due_date) : null, billed: money(i.total_amount), paid: money(paid), balance,
      disputed: money(i.disputed_amount), days_overdue: days !== null && days > 0 ? days : 0,
      // The surcharge this bill has earned to today, where it is running late.
      accrued_lps: Math.max(accrued, money(i.lps)),
    };
  }).filter(Boolean).sort((a, b) => b.days_overdue - a.days_overdue || String(a.due_date).localeCompare(String(b.due_date)));
}

const BUCKETS = [
  { key: 'NOT_DUE', label: 'Not yet due', test: (d) => d <= 0 },
  { key: 'D1_30', label: '1–30 days overdue', test: (d) => d >= 1 && d <= 30 },
  { key: 'D31_60', label: '31–60 days overdue', test: (d) => d >= 31 && d <= 60 },
  { key: 'D61_90', label: '61–90 days overdue', test: (d) => d >= 61 && d <= 90 },
  { key: 'D90', label: 'Over 90 days overdue', test: (d) => d > 90 },
];
const ageingOf = (outstanding) => BUCKETS.map((b) => {
  const rows = outstanding.filter((o) => b.test(o.days_overdue));
  return { key: b.key, label: b.label, invoices: rows.length, amount: money(rows.reduce((s, o) => s + o.balance, 0)), accrued_lps: money(rows.reduce((s, o) => s + o.accrued_lps, 0)) };
});

/** The account for a stretch of dates: the balance brought forward, the lines, and where it ends. */
function statementOf(user, query) {
  const { seller, side, partySide } = sellerFor(user, query.entity_id);
  const { from, to } = rangeOf(query);
  const { invoices, entries } = entriesOf(seller.id, query.contract_id || null, partySide);
  let balance = 0;
  let opening = 0;
  const shown = [];
  const totals = { billed: 0, received: 0, tds: 0, deductions: 0, rebate: 0, credit_notes: 0, debit_notes: 0, lps: 0, advances: 0, refunds: 0 };
  for (const e of entries) {
    if (to && e.date > to) break;
    balance = money(balance + e.debit - e.credit);
    if (from && e.date < from) { opening = balance; continue; }
    shown.push({ ...e, balance });
    if (e.type === 'INVOICE') totals.billed += e.debit;
    if (e.type === 'DEBIT_NOTE') totals.debit_notes += e.debit;
    if (e.type === 'LPS') totals.lps += e.debit;
    if (e.type === 'PAYMENT') totals.received += e.credit;
    if (e.type === 'TDS') totals.tds += e.credit;
    if (e.type === 'DEDUCTION') totals.deductions += e.credit;
    if (e.type === 'REBATE') totals.rebate += e.credit;
    if (e.type === 'CREDIT_NOTE') totals.credit_notes += e.credit;
    if (e.type === 'ADVANCE') totals.advances += e.credit;
    if (e.type === 'ADVANCE_REFUND') totals.refunds += e.debit;
  }
  for (const k of Object.keys(totals)) totals[k] = money(totals[k]);
  const outstanding = outstandingOf(invoices);
  return {
    seller, side, party_side: partySide, from, to, contract_id: query.contract_id || null,
    opening_balance: money(opening), closing_balance: money(balance), entries: shown, totals,
    outstanding, ageing: ageingOf(outstanding),
    outstanding_total: money(outstanding.reduce((s, o) => s + o.balance, 0)),
    overdue_total: money(outstanding.filter((o) => o.days_overdue > 0).reduce((s, o) => s + o.balance, 0)),
    accrued_lps_total: money(outstanding.reduce((s, o) => s + o.accrued_lps, 0)),
    // What falls due in the next thirty days.
    due_soon: outstanding.filter((o) => o.due_date && o.days_overdue === 0 && o.due_date <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)),
    generated_at: new Date().toISOString(),
  };
}

/** A party's account as SJVN's books show it, for a stretch of dates (R5 reads it). */
export function accountFor(entityId, { from = null, to = null } = {}) {
  return statementOf({ role: 'SJVN_ADMIN' }, { entity_id: entityId, from, to });
}

const TYPE_LABEL = { INVOICE: 'Invoice', DEBIT_NOTE: 'Debit note', CREDIT_NOTE: 'Credit note', PAYMENT: 'Payment', TDS: 'TDS', DEDUCTION: 'Deduction', REBATE: 'Rebate', LPS: 'LPS', ADVANCE: 'Advance', ADVANCE_REFUND: 'Refund' };
const closingText = (s) => (s.party_side === 'BUYER' ? 'Closing balance — payable to SJVN' : 'Closing balance — receivable from SJVN');
const partyWord = (s) => (s.party_side === 'BUYER' ? 'Buyer' : 'Seller');
const periodText = (s) => `${s.from || 'the beginning'} to ${s.to || today()}`;
const audit = (req, action, id, extra = {}) => {
  try { secureLogAudit(req, { action, module: 'REIA', entityType: 'ledger', entityId: id, ...extra }); } catch (err) { console.error('[LEDGER] audit failed', err.message); }
};

// GET /statement?from=&to=&contract_id=&entity_id=
router.get('/statement', (req, res) => send(res, () => statementOf(req.user, req.query)));

// GET /sellers — for SJVN: whose account to open.
router.get('/sellers', (req, res) => send(res, () => {
  if (counterpartySide(req.user) || !INTERNAL_READ.includes(req.user.role)) throw fail(403, 'Access denied');
  return db.prepare(`
    SELECT DISTINCT e.id, e.name FROM entities e JOIN contracts c ON c.seller_id = e.id ORDER BY e.name
  `).all();
}));

// GET /buyers — the same, for the buyers SJVN bills.
router.get('/buyers', (req, res) => send(res, () => {
  if (counterpartySide(req.user) || !INTERNAL_READ.includes(req.user.role)) throw fail(403, 'Access denied');
  return db.prepare(`
    SELECT DISTINCT e.id, e.name FROM entities e JOIN contracts c ON c.buyer_id = e.id ORDER BY e.name
  `).all();
}));

// GET /statement.xlsx — the same statement as a workbook.
router.get('/statement.xlsx', (req, res) => {
  try {
    const s = statementOf(req.user, req.query);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Statement of Account'], [partyWord(s), s.seller.name], ['PAN', s.seller.pan_no || ''], ['GSTIN', s.seller.gst_no || ''],
      ['With', 'SJVN Limited'], ['Period', periodText(s)], ['Generated', nowLabel()], [],
      ['Date', 'Type', 'Reference', 'Invoice', 'Contract', 'Particulars', 'Debit (Rs)', 'Credit (Rs)', 'Balance (Rs)'],
      [s.from || '', '', '', '', '', 'Opening balance', '', '', s.opening_balance],
      ...s.entries.map((e) => [e.date, TYPE_LABEL[e.type], e.ref, e.invoice_no, e.contract_no, e.particulars, e.debit || '', e.credit || '', e.balance]),
      [s.to || today(), '', '', '', '', closingText(s), '', '', s.closing_balance],
    ]), 'Statement');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Outstanding as on', today()], [],
      ['Invoice', 'Contract', 'Period', 'Due date', 'Billed (Rs)', 'Settled (Rs)', 'Balance (Rs)', 'Days overdue', 'LPS accrued (Rs)'],
      ...s.outstanding.map((o) => [o.invoice_no, o.contract_no, o.billing_period, o.due_date || '', o.billed, o.paid, o.balance, o.days_overdue, o.accrued_lps]),
      [], ['Ageing', 'Invoices', 'Amount (Rs)', 'LPS accrued (Rs)'],
      ...s.ageing.map((a) => [a.label, a.invoices, a.amount, a.accrued_lps]),
    ]), 'Outstanding & ageing');
    audit(req, 'STATEMENT_DOWNLOADED', s.seller.id, { details: { format: 'xlsx', from: s.from, to: s.to } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="statement-of-account-${s.from || 'all'}-to-${s.to || today()}.xlsx"`);
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

// GET /statement.pdf
router.get('/statement.pdf', (req, res) => {
  let s;
  try { s = statementOf(req.user, req.query); } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
  const title = 'Statement of Account';
  const sub = `${s.seller.name}  ·  ${periodText(s)}`;
  const ctx = { vertical: 'REIA', title, subtitle: sub };
  const doc = newDoc(res, `${title} — ${s.seller.name}`, `statement-of-account-${s.from || 'all'}-to-${s.to || today()}.pdf`);
  header(doc, { ...ctx, generatedAt: nowLabel() });
  let y = 84;
  doc.font('Helvetica').fontSize(8.5);
  for (const [k, v] of [[partyWord(s), s.seller.name], ['PAN / GSTIN', `${s.seller.pan_no || '—'}  /  ${s.seller.gst_no || '—'}`], ['Account with', 'SJVN Limited'], ['Period', periodText(s)]]) {
    doc.fillColor(MUTED).text(k, M, y, { width: 90 });
    doc.fillColor(INK).text(v, M + 95, y, { width: CONTENT_W - 95 });
    y += 14;
  }
  y = kpiBand(doc, y + 6, [
    { label: 'Opening balance', value: `Rs ${inr(s.opening_balance)}` },
    { label: 'Billed', value: `Rs ${inr(s.totals.billed + s.totals.debit_notes + s.totals.lps + s.totals.refunds)}` },
    { label: 'Paid & adjusted', value: `Rs ${inr(s.totals.received + s.totals.tds + s.totals.deductions + s.totals.rebate + s.totals.credit_notes + s.totals.advances)}` },
    { label: s.party_side === 'BUYER' ? 'Closing — payable' : 'Closing — receivable', value: `Rs ${inr(s.closing_balance)}` },
  ]);
  y = sectionTitle(doc, y, 'Ledger');
  y = table(doc, y, [
    { label: 'Date', w: 54, value: (r) => r.date },
    { label: 'Type', w: 52, value: (r) => r.type },
    { label: 'Reference', w: 92, value: (r) => r.ref },
    { label: 'Particulars', w: CONTENT_W - 54 - 52 - 92 - 210, value: (r) => r.particulars },
    { label: 'Debit', w: 70, align: 'right', value: (r) => r.debit },
    { label: 'Credit', w: 70, align: 'right', value: (r) => r.credit },
    { label: 'Balance', w: 70, align: 'right', value: (r) => r.balance },
  ], [
    { date: s.from || '', type: '', ref: '', particulars: 'Opening balance', debit: '', credit: '', balance: inr(s.opening_balance) },
    ...s.entries.map((e) => ({ date: e.date, type: TYPE_LABEL[e.type], ref: String(e.ref || ''), particulars: e.particulars, debit: e.debit ? inr(e.debit) : '', credit: e.credit ? inr(e.credit) : '', balance: inr(e.balance) })),
    { date: s.to || today(), type: '', ref: '', particulars: closingText(s), debit: '', credit: '', balance: inr(s.closing_balance) },
  ], ctx, { fontSize: 7, rowH: 15 });
  footNotes(doc, y + 10, [
    s.party_side === 'BUYER'
      ? 'A debit is an amount SJVN billed or an advance refunded; a credit is an amount paid, an advance received, deducted at source or adjusted by a credit note.'
      : 'A debit is an amount billed to SJVN; a credit is an amount paid, deducted at source, allowed as rebate or adjusted by a credit note.',
    'Generated from the SJVN portal. It reflects the records as they stood when it was generated and is not a signed confirmation of balance.',
  ]);
  pageNumbers(doc);
  doc.end();
  audit(req, 'STATEMENT_DOWNLOADED', s.seller.id, { details: { format: 'pdf', from: s.from, to: s.to } });
});

/** One payment, with its bill, if the caller may see it. */
function paymentFor(user, id) {
  const p = db.prepare(`
    SELECT p.*, i.invoice_no, i.billing_period, i.total_amount, i.rebate AS invoice_rebate, i.direction, i.contract_id,
           c.contract_no, c.seller_id, c.buyer_id
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN contracts c ON c.id = i.contract_id WHERE p.id = ?
  `).get(id);
  if (!p) throw fail(404, 'Payment not found');
  const buyerBill = p.direction === 'SJVN_TO_BUYER';
  const owner = buyerBill ? p.buyer_id : p.seller_id;
  const { seller } = sellerFor(user, owner);
  if (seller.id !== owner) throw fail(404, 'Payment not found');
  const tds = money(p.tds_amount);
  const other = money((Number(p.deduction) || 0) - tds);
  const settledBefore = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id = ? AND rowid < (SELECT rowid FROM payments WHERE id = ?)').get(p.invoice_id, p.id).s;
  return {
    id: p.id, seller, party_side: buyerBill ? 'BUYER' : 'SELLER', invoice_no: p.invoice_no, billing_period: p.billing_period, contract_no: p.contract_no, invoice_total: money(p.total_amount),
    payment_date: dayOf(p.payment_date), mode: p.mode, source: p.release_source, reference: p.reference, is_credit_note: p.mode === 'CREDIT_NOTE',
    gross_settled: money((Number(p.amount) || 0) + (Number(p.deduction) || 0)),
    tds_amount: tds, tds_section: p.tds_section || null, other_deduction: other, deduction_note: p.deduction_note || null,
    net_paid: money(p.amount), rebate_amount: money(p.rebate_amount),
    settled_before: money(settledBefore), settled_after: money(settledBefore + (Number(p.amount) || 0) + (Number(p.deduction) || 0)),
    // A payment recorded before deductions were itemised says only how much, not why.
    breakup_known: !(Number(p.deduction) > 0) || tds > 0 || !!p.deduction_note,
  };
}

// GET /payments/:id — the advice as data. GET /payments/:id/advice.pdf — as a document.
router.get('/payments/:id', (req, res) => send(res, () => paymentFor(req.user, req.params.id)));

router.get('/payments/:id/advice.pdf', (req, res) => {
  let p;
  try { p = paymentFor(req.user, req.params.id); } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
  const fromBuyer = p.party_side === 'BUYER';
  // To a seller it is SJVN's advice of what it paid; to a buyer, SJVN's receipt for what it was paid.
  const title = fromBuyer ? 'Payment Receipt' : 'Payment Advice';
  const ctx = { vertical: 'REIA', title, subtitle: `${p.invoice_no}  ·  ${p.payment_date}` };
  const doc = newDoc(res, `${title} ${p.invoice_no}`, `payment-${fromBuyer ? 'receipt' : 'advice'}-${p.invoice_no.replace(/[^A-Za-z0-9]+/g, '-')}-${p.payment_date}.pdf`);
  header(doc, { ...ctx, generatedAt: nowLabel() });
  let y = 86;
  doc.font('Helvetica').fontSize(9);
  for (const [k, v] of [
    [fromBuyer ? 'Received from' : 'Paid to', `${p.seller.name}${p.seller.pan_no ? `  ·  PAN ${p.seller.pan_no}` : ''}`],
    [fromBuyer ? 'Received by' : 'Paid by', 'SJVN Limited'],
    ['Against invoice', `${p.invoice_no}  (${p.billing_period})  ·  bill value Rs ${inr(p.invoice_total)}`],
    ['Contract', p.contract_no],
    ['Payment date', p.payment_date],
    ['UTR / reference', p.reference || '—'],
    ['Paid from', p.is_credit_note ? 'Adjustment by credit note' : (p.source ? p.source.replace(/_/g, ' ') : p.mode || '—')],
  ]) {
    doc.fillColor(MUTED).text(k, M, y, { width: 110 });
    doc.fillColor(INK).text(v, M + 115, y, { width: CONTENT_W - 115 });
    y += 16;
  }
  y = sectionTitle(doc, y + 8, 'How the payment is made up');
  const rows = [
    { label: 'Amount of the bill settled by this payment', value: inr(p.gross_settled) },
    { label: `Less: tax deducted at source${p.tds_section ? ` (section ${p.tds_section})` : ''}`, value: p.tds_amount ? `(${inr(p.tds_amount)})` : '—' },
    { label: `Less: other deductions${p.deduction_note ? ` — ${p.deduction_note}` : ''}`, value: p.other_deduction ? `(${inr(p.other_deduction)})` : '—' },
    { label: p.is_credit_note ? 'Adjusted, not paid in cash' : fromBuyer ? 'Net amount received in SJVN\'s bank account' : 'Net amount paid to your bank account', value: inr(p.net_paid) },
  ];
  y = table(doc, y, [
    { label: 'Particulars', w: CONTENT_W - 140, value: (r) => r.label },
    { label: 'Rs', w: 140, align: 'right', value: (r) => r.value },
  ], rows, ctx, { fontSize: 8.5, rowH: 18 });
  footNotes(doc, y + 12, [
    p.rebate_amount > 0 ? `Early-payment rebate of Rs ${inr(p.rebate_amount)} was allowed on this payment and reduces what remains payable on the bill.` : null,
    `Settled on this bill before this payment: Rs ${inr(p.settled_before)}; after it: Rs ${inr(p.settled_after)} of Rs ${inr(p.invoice_total)}.`,
    p.breakup_known ? null : 'This payment was recorded before deductions were itemised, so the deduction is shown as a single amount.',
    fromBuyer ? 'Recorded after SJVN Finance confirmed the payment against its bank statement.' : null,
    `System-generated ${fromBuyer ? 'receipt' : 'advice'} from the SJVN portal; it needs no signature.`,
  ].filter(Boolean));
  pageNumbers(doc);
  doc.end();
});

// ── TDS certificates (Form 16A) ─────────────────────────────────────────────

const QUARTERS = { Q1: 'Apr–Jun', Q2: 'Jul–Sep', Q3: 'Oct–Dec', Q4: 'Jan–Mar' };
const quarterOf = (date) => {
  const [y, m] = dayOf(date).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { fy: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, quarter: m >= 4 && m <= 6 ? 'Q1' : m <= 9 && m >= 7 ? 'Q2' : m >= 10 ? 'Q3' : 'Q4' };
};

/** Each quarter in which tax was deducted, with its certificate where one has been filed. */
function certificatesOf(seller, partySide = 'SELLER') {
  const of = billsOfSide(partySide);
  const certs = db.prepare(`
    SELECT t.*, v.file_name, u.name AS uploaded_by_name FROM tds_certificates t
    LEFT JOIN document_versions v ON v.id = t.version_id LEFT JOIN users u ON u.id = t.uploaded_by
    WHERE t.entity_id = ? ORDER BY t.financial_year DESC, t.quarter DESC
  `).all(seller.id);
  const deducted = new Map();
  for (const p of db.prepare(`
    SELECT p.payment_date, p.tds_amount FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN contracts c ON c.id = i.contract_id
    WHERE ${of.col} = ? AND i.direction = '${of.direction}' AND COALESCE(p.tds_amount, 0) > 0
  `).all(seller.id)) {
    const q = quarterOf(p.payment_date);
    const key = `${q.fy}|${q.quarter}`;
    deducted.set(key, money((deducted.get(key) || 0) + p.tds_amount));
  }
  const rows = certs.map((c) => ({ ...c, quarter_label: QUARTERS[c.quarter], tds_deducted: deducted.get(`${c.financial_year}|${c.quarter}`) || 0 }));
  const have = new Set(certs.map((c) => `${c.financial_year}|${c.quarter}`));
  // A quarter with tax deducted and no certificate yet is shown as awaited.
  for (const [key, amount] of deducted) {
    if (have.has(key)) continue;
    const [fy, quarter] = key.split('|');
    rows.push({ id: null, financial_year: fy, quarter, quarter_label: QUARTERS[quarter], tds_deducted: amount, awaited: true });
  }
  return rows.sort((a, b) => `${b.financial_year}${b.quarter}`.localeCompare(`${a.financial_year}${a.quarter}`));
}

// GET /tds-certificates?entity_id=
router.get('/tds-certificates', (req, res) => send(res, () => {
  const { seller, side, partySide } = sellerFor(req.user, req.query.entity_id);
  return { seller, party_side: partySide, can_file: mayFile(req.user, side, partySide), certificates: certificatesOf(seller, partySide) };
}));

// POST /tds-certificates { entity_id, financial_year, quarter, certificate_no, tds_amount, version_id }
router.post('/tds-certificates', (req, res) => send(res, () => {
  const { seller, side, partySide } = sellerFor(req.user, req.body.entity_id);
  if (!mayFile(req.user, side, partySide)) {
    throw fail(403, partySide === 'BUYER' ? 'The buyer that deducted the tax files its certificate — a checker, approver or the company admin' : 'Only Finance can file a TDS certificate');
  }
  const fy = String(req.body.financial_year || '').trim();
  if (!/^\d{4}-\d{2}$/.test(fy) || Number(fy.slice(5)) !== (Number(fy.slice(0, 4)) + 1) % 100) throw fail(400, 'financial_year must read like 2026-27');
  const quarter = String(req.body.quarter || '').toUpperCase();
  if (!QUARTERS[quarter]) throw fail(400, 'quarter must be Q1, Q2, Q3 or Q4');
  const amount = Number(req.body.tds_amount);
  if (!(amount >= 0)) throw fail(400, 'tds_amount must be a number');
  const v = db.prepare(`
    SELECT v.id FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.entity_id = ?
  `).get(String(req.body.version_id || ''), seller.id);
  if (!v) throw fail(400, 'Attach the certificate file first');
  const existing = db.prepare('SELECT id FROM tds_certificates WHERE entity_id = ? AND financial_year = ? AND quarter = ?').get(seller.id, fy, quarter);
  const id = existing?.id || newId('TDC');
  const certNo = String(req.body.certificate_no || '').trim().slice(0, 40) || null;
  if (existing) {
    db.prepare(`UPDATE tds_certificates SET certificate_no = ?, tds_amount = ?, version_id = ?, uploaded_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(certNo, money(amount), v.id, req.user.id, id);
  } else {
    db.prepare(`INSERT INTO tds_certificates (id, entity_id, financial_year, quarter, certificate_no, tds_amount, version_id, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, seller.id, fy, quarter, certNo, money(amount), v.id, req.user.id);
  }
  audit(req, existing ? 'TDS_CERTIFICATE_REPLACED' : 'TDS_CERTIFICATE_FILED', id, { afterValue: { entity_id: seller.id, financial_year: fy, quarter, tds_amount: money(amount) } });
  if (partySide === 'BUYER') {
    // The buyer deducted the tax, so the certificate comes from it to SJVN.
    for (const role of ['FINANCE_USER', 'REIA_MAKER']) pushNotification({ role, type: 'TDS_CERTIFICATE', message: `${seller.name} has filed its TDS certificate (Form 16A) for ${quarter} of FY ${fy}, for ${inr(amount)}.` });
  } else {
    for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(seller.id)) {
      pushNotification({ userId: u.id, type: 'TDS_CERTIFICATE', message: `Your TDS certificate (Form 16A) for ${quarter} of FY ${fy} is available under Payments & Ledger.` });
    }
  }
  return { seller, party_side: partySide, can_file: true, certificates: certificatesOf(seller, partySide) };
}));

export default router;
