/**
 * A buyer's side of the bills SJVN raises on it.
 *
 * Two things were wrong. A buyer typed a UTR and the bill went to PAID on its
 * say-so — the outstanding, the surcharge and the security release all moved on
 * a number nobody at SJVN had matched to the bank. And the buyer could say only
 * how much it paid, not what it held back as tax, so a payment net of TDS left
 * a bill looking short.
 *
 *   intimation  the buyer tells SJVN it has paid: how much reached the bank,
 *               what was deducted at source and under which section, the UTR
 *               and the bank's advice. A maker's intimation goes to the
 *               company's checker first.
 *   confirm     SJVN Finance matches it to the bank statement. Only then is a
 *               payment recorded on the bill, on the date the money arrived.
 *   receipt     the buyer acknowledging that the bill reached it.
 *
 * Nothing a buyer enters here changes a bill. It changes when Finance confirms.
 */
import { Router } from 'express';
import { ZipArchive } from 'archiver';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, BUYER_ROLES, counterpartySide } from '../middleware/auth.js';
import { newId, pushNotification } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { payableNow } from '../disputesConstants.js';
import { invoiceLpsAsOf } from '../services/invoiceLps.js';
import { presentedSql, isPresented } from '../services/counterpartyScope.js';
import { generateInvoicePdfBuffer } from '../scripts/invoicePdf.js';
import { applyInvoicePayment } from './invoices.js';

const router = Router();
router.use(requireAuth);

const INTERNAL_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
import { dayInWords } from '../paymentSecurityConstants.js';
const canConfirm = (user) => ROLE_GROUPS.FINANCE.includes(user?.role);
const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    if (!err.status) console.error('[BUYER-BILLS]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const audit = (req, action, entityType, entityId, extra = {}) => {
  try {
    secureLogAudit(req, { action, module: 'REIA', entityType, entityId, ...extra });
  } catch (err) {
    console.error('[BUYER-BILLS] audit failed', err.message);
  }
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const dayOf = (v) => String(v || '').slice(0, 10);

/** A bill a payment can be made against: presented, and not settled or withdrawn. */
const PAYABLE = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED'];
const OPEN = ['PENDING_CHECKER', 'SUBMITTED'];
export const MODES = ['RTGS', 'NEFT', 'IMPS', 'CHEQUE', 'OTHER'];
export const TDS_SECTIONS = ['194Q', '194C', '194J', '194A', 'OTHER'];
const tierOf = (role) => (/_L([123])$/.exec(role || '') ? `L${/_L([123])$/.exec(role)[1]}` : 'ADMIN');

function scopeOf(user) {
  const side = counterpartySide(user);
  if (side === 'BUYER') {
    if (!user.linked_entity_id) throw fail(403, 'Your account is not linked to a company');
    return { side, entityId: user.linked_entity_id };
  }
  if (!side && INTERNAL_READ.includes(user?.role)) return { side: 'SJVN', entityId: null };
  throw fail(403, 'Not authorized');
}

/** One of the buyer's own bills, as SJVN presented it. */
function billFor(user, id) {
  const scope = scopeOf(user);
  const inv = db.prepare(`
    SELECT i.*, c.contract_no, c.buyer_id, c.seller_id FROM invoices i JOIN contracts c ON c.id = i.contract_id WHERE i.id = ?
  `).get(String(id || ''));
  if (!inv || inv.direction !== 'SJVN_TO_BUYER') throw fail(404, 'Bill not found');
  if (scope.side === 'BUYER' && (inv.buyer_id !== scope.entityId || !isPresented(inv))) throw fail(404, 'Bill not found');
  return { inv, scope };
}

/** What is left on a bill today: payable, surcharge earned to date, less what Finance has recorded. */
function leftOn(inv, asOf = new Date()) {
  const paid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
  let accrued = Number(inv.lps) || 0;
  try { accrued = Math.max(accrued, invoiceLpsAsOf(inv, asOf).lps || 0); } catch { /* the surcharge on record stands */ }
  const payable = payableNow({ ...inv, lps: accrued }).payable_now;
  return { paid: money(paid), accrued_lps: money(accrued), payable: money(payable), left: money(Math.max(0, payable - paid)) };
}

function intimationView(r) {
  const gross = money((Number(r.amount) || 0) + (Number(r.tds_amount) || 0) + (Number(r.other_deduction) || 0));
  return {
    ...r, gross_settled: gross,
    proof: r.proof_version_id ? { version_id: r.proof_version_id, file_name: r.proof_name || null } : null,
    with: r.status === 'PENDING_CHECKER' ? 'Your checker' : r.status === 'SUBMITTED' ? 'SJVN Finance' : null,
  };
}

const INTIMATION_SQL = `
  SELECT pi.*, i.invoice_no, i.billing_period, i.total_amount AS invoice_total, i.status AS invoice_status, i.due_date,
         c.contract_no, e.name AS buyer_name, v.file_name AS proof_name,
         up.name AS prepared_by_name, ua.name AS approved_by_name, ud.name AS decided_by_name
  FROM payment_intimations pi
  JOIN invoices i ON i.id = pi.invoice_id JOIN contracts c ON c.id = i.contract_id
  LEFT JOIN entities e ON e.id = pi.entity_id LEFT JOIN document_versions v ON v.id = pi.proof_version_id
  LEFT JOIN users up ON up.id = pi.prepared_by LEFT JOIN users ua ON ua.id = pi.approved_by LEFT JOIN users ud ON ud.id = pi.decided_by
`;
const intimation = (id) => {
  const r = db.prepare(`${INTIMATION_SQL} WHERE pi.id = ?`).get(id);
  return r ? intimationView(r) : null;
};

function notifyBuyer(entityId, message, onlyApprovers = false) {
  try {
    for (const u of db.prepare('SELECT id, role FROM users WHERE linked_entity_id = ? AND is_active = 1').all(entityId)) {
      if (!BUYER_ROLES.includes(u.role)) continue;
      if (onlyApprovers && tierOf(u.role) === 'L1') continue;
      pushNotification({ userId: u.id, type: 'PAYMENT', message });
    }
  } catch { /* the record stands; the bell is a courtesy */ }
}
const notifyFinance = (message) => {
  try { for (const role of new Set(['FINANCE_USER', 'REIA_USER'])) pushNotification({ role, type: 'PAYMENT', message }); } catch { /* as above */ }
};

// ── The buyer's bills ───────────────────────────────────────────────────────

function billsOf(user, q = {}) {
  const scope = scopeOf(user);
  if (scope.side !== 'BUYER') throw fail(400, 'This is the buyer\'s own view of its bills');
  // Presented bills only — and a cancelled one only if it had been issued, so a
  // draft SJVN threw away is not shown to the buyer as a bill it once received.
  const where = [`c.buyer_id = ?`, `i.direction = 'SJVN_TO_BUYER'`, presentedSql('i')];
  const params = [scope.entityId];
  if (q.contract_id) { where.push('i.contract_id = ?'); params.push(String(q.contract_id)); }
  if (q.billing_period) { where.push('i.billing_period = ?'); params.push(String(q.billing_period)); }
  const rows = db.prepare(`
    SELECT i.*, c.contract_no FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE ${where.join(' AND ')} ORDER BY i.billing_period DESC, i.created_at DESC
  `).all(...params);
  const pending = new Map();
  for (const p of db.prepare(`
    SELECT pi.invoice_id, pi.status, SUM(pi.amount + COALESCE(pi.tds_amount, 0) + COALESCE(pi.other_deduction, 0)) s, COUNT(*) n
    FROM payment_intimations pi WHERE pi.entity_id = ? AND pi.status IN ('PENDING_CHECKER','SUBMITTED') GROUP BY pi.invoice_id, pi.status
  `).all(scope.entityId)) {
    const cur = pending.get(p.invoice_id) || { amount: 0, count: 0, with_checker: 0, with_finance: 0 };
    cur.amount = money(cur.amount + p.s); cur.count += p.n;
    if (p.status === 'PENDING_CHECKER') cur.with_checker += p.n; else cur.with_finance += p.n;
    pending.set(p.invoice_id, cur);
  }
  const bills = rows.map((i) => {
    const open = PAYABLE.includes(i.status);
    const l = open ? leftOn(i) : { paid: money(db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) s FROM payments WHERE invoice_id = ?').get(i.id).s), accrued_lps: money(i.lps), payable: 0, left: 0 };
    const due = i.due_date ? dayOf(i.due_date) : null;
    const days = due ? Math.round((new Date(`${due}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000) : null;
    const pend = pending.get(i.id) || null;
    return {
      id: i.id, invoice_no: i.invoice_no, contract_id: i.contract_id, contract_no: i.contract_no, billing_period: i.billing_period,
      invoice_type: i.invoice_type, energy_mwh: i.energy_mwh, total_amount: money(i.total_amount), disputed_amount: money(i.disputed_amount),
      status: i.status, due_date: due, issued_on: dayOf(i.issued_at || i.created_at),
      settled: l.paid, accrued_lps: l.accrued_lps, left: l.left,
      days_to_due: open && l.left > 0 ? days : null,
      overdue: open && l.left > 0 && days !== null && days < 0,
      pending_intimation: pend,
      // What may still be notified: what is left, less what is already on its way to Finance.
      can_notify: open && l.left > 0,
      acknowledged_at: i.buyer_ack_at || null, acknowledged_by: i.buyer_ack_by || null,
      has_irn: !!i.irn, has_signed_copy: !!i.signed_version_id,
    };
  });
  const open = bills.filter((b) => b.left > 0);
  return {
    bills,
    totals: {
      to_pay: money(open.reduce((s, b) => s + b.left, 0)), open_bills: open.length,
      overdue: money(open.filter((b) => b.overdue).reduce((s, b) => s + b.left, 0)), overdue_bills: open.filter((b) => b.overdue).length,
      due_soon: money(open.filter((b) => !b.overdue && b.days_to_due !== null && b.days_to_due <= 10).reduce((s, b) => s + b.left, 0)),
      due_soon_bills: open.filter((b) => !b.overdue && b.days_to_due !== null && b.days_to_due <= 10).length,
      accrued_lps: money(open.reduce((s, b) => s + b.accrued_lps, 0)),
      with_finance: money([...pending.values()].reduce((s, p) => s + p.amount, 0)),
      with_finance_count: [...pending.values()].reduce((s, p) => s + p.count, 0),
      unacknowledged: bills.filter((b) => !b.acknowledged_at && b.status !== 'CANCELLED').length,
    },
    my_tier: tierOf(user.role),
    modes: MODES, tds_sections: TDS_SECTIONS,
  };
}

router.get('/', (req, res) => send(res, () => billsOf(req.user, req.query)));

// GET /export.csv — the bills as a sheet.
router.get('/export.csv', (req, res) => {
  try {
    const { bills } = billsOf(req.user, req.query);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Invoice', 'PSA', 'Period', 'Type', 'Energy (MWh)', 'Bill amount', 'In dispute', 'Settled', 'Surcharge to date', 'Left to pay', 'Due date', 'Status', 'With Finance for confirmation', 'Receipt acknowledged'].map(cell).join(',')];
    for (const b of bills) {
      lines.push([b.invoice_no, b.contract_no, b.billing_period, b.invoice_type, b.energy_mwh, b.total_amount, b.disputed_amount, b.settled, b.accrued_lps, b.left,
        b.due_date || '', b.status, b.pending_intimation?.amount || '', b.acknowledged_at ? dayOf(b.acknowledged_at) : ''].map(cell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payable-bills-${today()}.csv"`);
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (err) {
    if (!err.status) console.error('[BUYER-BILLS]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

// POST /download.zip { ids } — several bills as PDFs in one file.
router.post('/download.zip', async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String))].slice(0, 50);
    if (!ids.length) throw fail(400, 'Choose the bills to download');
    const picked = ids.map((id) => billFor(req.user, id).inv);
    const zip = new ZipArchive({ zlib: { level: 6 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="bills-${today()}.zip"`);
    zip.pipe(res);
    for (const inv of picked) {
      const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
      const seller = contract.seller_id ? db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.seller_id) : null;
      const buyer = contract.buyer_id ? db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.buyer_id) : null;
      // eslint-disable-next-line no-await-in-loop
      const pdf = await generateInvoicePdfBuffer(inv, contract, seller, buyer, []);
      zip.append(pdf, { name: `${inv.invoice_no.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf` });
    }
    audit(req, 'BILLS_DOWNLOADED', 'invoice', picked[0].id, { details: { count: picked.length } });
    await zip.finalize();
  } catch (err) {
    if (!err.status) console.error('[BUYER-BILLS]', err);
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
    else res.end();
  }
});

// POST /:id/acknowledge — the buyer saying the bill reached it.
router.post('/:id/acknowledge', (req, res) => send(res, () => {
  const { inv, scope } = billFor(req.user, req.params.id);
  if (scope.side !== 'BUYER') throw fail(403, 'Only the buyer acknowledges receipt of its bill');
  if (inv.status === 'CANCELLED') throw fail(400, 'This bill was withdrawn');
  if (inv.buyer_ack_at) throw fail(400, 'Receipt of this bill has already been acknowledged');
  db.prepare(`UPDATE invoices SET buyer_ack_at = datetime('now'), buyer_ack_by = ? WHERE id = ?`).run(req.user.name, inv.id);
  audit(req, 'BILL_RECEIPT_ACKNOWLEDGED', 'invoice', inv.id, {});
  return { id: inv.id, acknowledged_at: db.prepare('SELECT buyer_ack_at a FROM invoices WHERE id = ?').get(inv.id).a, acknowledged_by: req.user.name };
}));

// ── Telling SJVN a payment has been made ────────────────────────────────────

/**
 * Record a buyer's intimation. Also what the older POST /invoices/:id/payments
 * does for a buyer now, so no door is left by which a buyer settles its own bill.
 */
export function createIntimation(req, invoiceId, body) {
  const user = req.user;
  const { inv, scope } = billFor(user, invoiceId);
  if (scope.side !== 'BUYER') throw fail(403, 'Finance records a payment directly; an intimation is the buyer\'s');
  if (!PAYABLE.includes(inv.status)) throw fail(400, inv.status === 'PAID' ? 'This bill is already settled' : `Nothing can be paid against a bill that is ${inv.status.toLowerCase()}`);
  const b = body || {};
  const amount = money(b.amount);
  if (!(amount > 0)) throw fail(400, 'Enter the amount that reached SJVN\'s bank account');
  const tds = money(b.tds_amount);
  const other = money(b.other_deduction);
  if (tds < 0 || other < 0) throw fail(400, 'A deduction cannot be negative');
  const section = tds > 0 ? (TDS_SECTIONS.includes(String(b.tds_section || '').toUpperCase()) ? String(b.tds_section).toUpperCase() : null) : null;
  if (tds > 0 && !section) throw fail(400, 'Say under which section the tax was deducted');
  const note = text(b.deduction_note, 300);
  if (other > 0 && !note) throw fail(400, 'Say what the other deduction is for');
  const date = text(b.payment_date, 10);
  if (!DAY.test(date)) throw fail(400, 'Enter the date of payment');
  if (date > today()) throw fail(400, 'The payment date cannot be in the future');
  const mode = MODES.includes(String(b.mode || '').toUpperCase()) ? String(b.mode).toUpperCase() : (b.mode === 'UPI' ? 'OTHER' : null);
  if (!mode) throw fail(400, 'Choose how the payment was made');
  const reference = text(b.reference, 60);
  if (reference.length < 4) throw fail(400, 'Enter the UTR or reference number of the payment');
  // One transfer may settle several bills, so a UTR may repeat across bills — never on the same one.
  if (db.prepare('SELECT 1 FROM payments WHERE invoice_id = ? AND reference = ?').get(inv.id, reference)
    || db.prepare(`SELECT 1 FROM payment_intimations WHERE invoice_id = ? AND reference = ? AND status IN ('PENDING_CHECKER','SUBMITTED')`).get(inv.id, reference)) {
    throw fail(409, `${reference} is already on record against this bill`);
  }
  let proof = null;
  if (b.proof_version_id) {
    proof = db.prepare(`SELECT v.id FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.contract_id = ?`).get(String(b.proof_version_id), inv.contract_id)?.id;
    if (!proof) throw fail(400, 'The attached advice is not one of this contract\'s documents');
  }
  const { left } = leftOn(inv, new Date(`${date}T00:00:00Z`));
  const onTheWay = db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(tds_amount, 0) + COALESCE(other_deduction, 0)), 0) s FROM payment_intimations WHERE invoice_id = ? AND status IN ('PENDING_CHECKER','SUBMITTED')`).get(inv.id).s;
  const gross = money(amount + tds + other);

  const maker = tierOf(user.role) === 'L1';
  const id = newId('PIN');
  db.prepare(`
    INSERT INTO payment_intimations (id, invoice_id, contract_id, entity_id, amount, tds_amount, tds_section, other_deduction, deduction_note,
      payment_date, mode, reference, proof_version_id, remarks, status, prepared_by, approved_by, approved_at, exceeds_balance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, inv.id, inv.contract_id, scope.entityId, amount, tds, section, other, note || null, date, mode, reference, proof, text(b.remarks, 500) || null,
    maker ? 'PENDING_CHECKER' : 'SUBMITTED', user.id, maker ? null : user.id, maker ? null : new Date().toISOString().replace('T', ' ').slice(0, 19),
    gross > left - onTheWay + 1 ? 1 : 0);
  audit(req, 'PAYMENT_INTIMATED', 'payment_intimation', id, { afterValue: { invoice_no: inv.invoice_no, amount, tds_amount: tds, other_deduction: other, reference, payment_date: date } });
  if (maker) notifyBuyer(scope.entityId, `${user.name} has prepared a payment intimation of ${rupees(gross)} against ${inv.invoice_no}. It needs a checker's approval before it goes to SJVN.`, true);
  else notifyFinance(`${inv.contract_no}: the buyer reports a payment of ${rupees(amount)}${tds > 0 ? ` (plus TDS ${rupees(tds)})` : ''} against ${inv.invoice_no}, UTR ${reference}, dated ${dayInWords(date)}. Confirm it against the bank statement.`);
  return intimation(id);
}

router.post('/intimations', (req, res) => {
  try {
    res.status(201).json(createIntimation(req, req.body?.invoice_id, req.body));
  } catch (err) {
    if (!err.status) console.error('[BUYER-BILLS]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

// GET /intimations?status=&invoice_id= — the buyer's own, or for SJVN everyone's.
router.get('/intimations', (req, res) => send(res, () => {
  const scope = scopeOf(req.user);
  const where = ['1 = 1'];
  const params = [];
  if (scope.side === 'BUYER') { where.push('pi.entity_id = ?'); params.push(scope.entityId); }
  // A maker's draft still with its own checker is not SJVN's to see.
  else where.push(`pi.status <> 'PENDING_CHECKER'`);
  if (req.query.status) { where.push('pi.status = ?'); params.push(String(req.query.status).toUpperCase()); }
  if (req.query.invoice_id) { where.push('pi.invoice_id = ?'); params.push(String(req.query.invoice_id)); }
  const rows = db.prepare(`${INTIMATION_SQL} WHERE ${where.join(' AND ')} ORDER BY CASE pi.status WHEN 'SUBMITTED' THEN 0 WHEN 'PENDING_CHECKER' THEN 1 ELSE 2 END, pi.created_at DESC LIMIT 300`).all(...params)
    .map((r) => {
      const v = intimationView(r);
      if (scope.side === 'SJVN' && r.status === 'SUBMITTED') {
        const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.invoice_id);
        v.left_on_bill = leftOn(inv, new Date(`${r.payment_date}T00:00:00Z`)).left;
      }
      return v;
    });
  return {
    intimations: rows, side: scope.side, can_confirm: canConfirm(req.user), my_tier: scope.side === 'BUYER' ? tierOf(req.user.role) : null, my_id: req.user.id,
    totals: {
      awaiting_finance: rows.filter((r) => r.status === 'SUBMITTED').length,
      awaiting_finance_amount: money(rows.filter((r) => r.status === 'SUBMITTED').reduce((s, r) => s + r.amount, 0)),
      awaiting_checker: rows.filter((r) => r.status === 'PENDING_CHECKER').length,
      rejected: rows.filter((r) => r.status === 'REJECTED').length,
    },
  };
}));

function intimationFor(user, id) {
  const scope = scopeOf(user);
  const r = db.prepare('SELECT * FROM payment_intimations WHERE id = ?').get(String(id || ''));
  if (!r || (scope.side === 'BUYER' && r.entity_id !== scope.entityId)) throw fail(404, 'Intimation not found');
  return { r, scope };
}

// POST /intimations/:id/approve — the buyer's checker passes a maker's intimation on to SJVN.
router.post('/intimations/:id/approve', (req, res) => send(res, () => {
  const { r, scope } = intimationFor(req.user, req.params.id);
  if (scope.side !== 'BUYER') throw fail(403, 'Not authorized');
  if (r.status !== 'PENDING_CHECKER') throw fail(400, 'This intimation is not awaiting a checker');
  if (tierOf(req.user.role) === 'L1') throw fail(403, 'A checker or approver passes an intimation on to SJVN');
  if (r.prepared_by === req.user.id) throw fail(403, 'An intimation cannot be approved by the person who prepared it');
  db.prepare(`UPDATE payment_intimations SET status = 'SUBMITTED', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(req.user.id, r.id);
  audit(req, 'PAYMENT_INTIMATION_APPROVED', 'payment_intimation', r.id, { beforeValue: { status: 'PENDING_CHECKER' }, afterValue: { status: 'SUBMITTED' } });
  const v = intimation(r.id);
  notifyFinance(`${v.contract_no}: the buyer reports a payment of ${rupees(v.amount)}${v.tds_amount > 0 ? ` (plus TDS ${rupees(v.tds_amount)})` : ''} against ${v.invoice_no}, UTR ${v.reference}, dated ${dayInWords(v.payment_date)}. Confirm it against the bank statement.`);
  return v;
}));

// POST /intimations/:id/withdraw — by the buyer, while SJVN has not decided.
router.post('/intimations/:id/withdraw', (req, res) => send(res, () => {
  const { r, scope } = intimationFor(req.user, req.params.id);
  if (scope.side !== 'BUYER') throw fail(403, 'Only the buyer withdraws its intimation');
  if (!OPEN.includes(r.status)) throw fail(400, `This intimation has already been ${r.status.toLowerCase()}`);
  if (r.status === 'SUBMITTED' && tierOf(req.user.role) === 'L1') throw fail(403, 'Once it is with SJVN, a checker or approver withdraws it');
  const note = text(req.body?.note, 300);
  db.prepare(`UPDATE payment_intimations SET status = 'WITHDRAWN', decision_note = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(note || null, req.user.id, r.id);
  audit(req, 'PAYMENT_INTIMATION_WITHDRAWN', 'payment_intimation', r.id, { reason: note || undefined });
  return intimation(r.id);
}));

// POST /intimations/:id/confirm { payment_date?, note? } — Finance has found the money in the bank.
router.post('/intimations/:id/confirm', (req, res) => send(res, () => {
  if (!canConfirm(req.user)) throw fail(403, 'Only SJVN Finance confirms a payment');
  const { r } = intimationFor(req.user, req.params.id);
  if (r.status !== 'SUBMITTED') throw fail(400, r.status === 'PENDING_CHECKER' ? 'The buyer\'s checker has not yet passed this on' : `This intimation has already been ${r.status.toLowerCase()}`);
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.invoice_id);
  if (!inv || !PAYABLE.includes(inv.status)) throw fail(400, `The bill is ${String(inv?.status || 'missing').toLowerCase()}, so a payment cannot be recorded on it. Reject the intimation with the reason.`);
  // The date the money actually arrived, where it differs from the one the buyer gave.
  const valueDate = req.body?.payment_date ? text(req.body.payment_date, 10) : r.payment_date;
  if (!DAY.test(valueDate) || valueDate > today()) throw fail(400, 'The value date must be a date not in the future');
  const note = text(req.body?.note, 300);
  if (valueDate !== r.payment_date && !note) throw fail(400, 'Say why the value date differs from the date the buyer gave');

  const paymentId = db.transaction(() => {
    const before = db.prepare('SELECT COALESCE(MAX(rowid), 0) m FROM payments').get().m;
    applyInvoicePayment(inv, {
      amount: r.amount, payment_date: valueDate, mode: r.mode, reference: r.reference,
      deduction: money((Number(r.tds_amount) || 0) + (Number(r.other_deduction) || 0)),
      breakup: { tds_amount: r.tds_amount || null, tds_section: r.tds_section || null, deduction_note: r.deduction_note || null },
    }, req);
    const pid = db.prepare('SELECT id FROM payments WHERE invoice_id = ? AND rowid > ? ORDER BY rowid DESC LIMIT 1').get(inv.id, before)?.id || null;
    db.prepare(`UPDATE payment_intimations SET status = 'CONFIRMED', confirmed_date = ?, decision_note = ?, decided_by = ?, decided_at = datetime('now'), payment_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(valueDate, note || null, req.user.id, pid, r.id);
    return pid;
  })();
  const after = db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id).status;
  audit(req, 'PAYMENT_INTIMATION_CONFIRMED', 'payment_intimation', r.id, { beforeValue: { status: 'SUBMITTED', invoice_status: inv.status }, afterValue: { status: 'CONFIRMED', invoice_status: after, payment_id: paymentId, value_date: valueDate }, reason: note || undefined });
  notifyBuyer(r.entity_id, `SJVN Finance has confirmed your payment of ${rupees(r.amount)} against ${inv.invoice_no} (UTR ${r.reference})${valueDate !== r.payment_date ? `, with value date ${dayInWords(valueDate)}` : ''}. The bill is now ${after.replace(/_/g, ' ').toLowerCase()}.`);
  return intimation(r.id);
}));

// POST /intimations/:id/reject { note } — the money is not there, or the details are wrong.
router.post('/intimations/:id/reject', (req, res) => send(res, () => {
  if (!canConfirm(req.user)) throw fail(403, 'Only SJVN Finance decides a payment intimation');
  const { r } = intimationFor(req.user, req.params.id);
  if (r.status !== 'SUBMITTED') throw fail(400, `This intimation has already been ${r.status.toLowerCase()}`);
  const note = text(req.body?.note, 300);
  if (!note) throw fail(400, 'Say why the intimation is not accepted');
  db.prepare(`UPDATE payment_intimations SET status = 'REJECTED', decision_note = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(note, req.user.id, r.id);
  audit(req, 'PAYMENT_INTIMATION_REJECTED', 'payment_intimation', r.id, { beforeValue: { status: 'SUBMITTED' }, afterValue: { status: 'REJECTED' }, reason: note });
  const v = intimation(r.id);
  notifyBuyer(r.entity_id, `SJVN Finance could not confirm your payment of ${rupees(r.amount)} against ${v.invoice_no} (UTR ${r.reference}) — ${note}. The bill stands as it was.`);
  return v;
}));

export default router;
