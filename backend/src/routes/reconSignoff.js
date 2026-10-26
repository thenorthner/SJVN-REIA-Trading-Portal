/**
 * What a reconciliation statement needs before it can be relied on.
 *
 * routes/reconciliation.js matches the lines and holds the statement. This is
 * the part around the signatures:
 *
 *   roll-forward   opening balance + billed − received − adjustments = closing
 *                  balance for the statement's period, with the bills carried
 *                  into it, so the figure being agreed can be traced.
 *   signing        each side signs once. The counterparty may agree outright,
 *                  or agree with exceptions — naming the amounts it does not
 *                  accept — so what is not in question is agreed and can be
 *                  paid while the rest is argued. A statement closes when both
 *                  have signed and no exception is open.
 *   evidence       an auditor's certificate with the counterparty's signature;
 *                  the statement as each side signed it with a digital
 *                  signature certificate; and the statement itself as a PDF or
 *                  workbook carrying both signatures.
 *
 * A signature here is a recorded electronic acknowledgement — who, when, from
 * where, and a fingerprint of what was agreed. It is not a certificate-based
 * digital signature; the signed copy is where one of those is attached.
 */
import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import XLSX from 'xlsx';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, pushNotification, invalidDecision } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParam, getParamNumber } from '../mastersService.js';
import { canAccessRecon, isReia, recordEvent, saveStatement } from './reconciliation.js';
import { noteFromException } from '../services/noteEngine.js';
import { inspectSignature } from './invoiceCompliance.js';
import {
  newDoc, header, kpiBand, sectionTitle, table, notes as footNotes, pageNumbers, eachPage, stamp, nowLabel,
  M, CONTENT_W, PAGE_W, PAGE_H, INK, MUTED,
} from '../scripts/reportPdfKit.js';

import { notifyCounterparty } from '../paymentSecurityEngine.js';
import { supersededByDeveloperSql } from '../services/outstanding.js';
const router = Router();
router.use(requireAuth);

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try { res.json(fn()); } catch (err) {
    if (!err.status) console.error('[RECON]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const dayOf = (v) => String(v || '').slice(0, 10);
const NOT_BILLED = ['DRAFT', 'PENDING_L2', 'SUBMITTED', 'UNDER_APPROVAL', 'REJECTED', 'CANCELLED'];
const SIGNABLE = ['PENDING_SIGN_OFF', 'AUTO_MATCHED', 'NEEDS_REVIEW'];
// The counterparty signs a statement SJVN has finished reviewing. Signing one
// still under review froze its figures before SJVN had explained them, and
// flipped it to "pending sign-off" with a line still open.
const COUNTERPARTY_SIGNABLE = ['PENDING_SIGN_OFF', 'AUTO_MATCHED'];

// A trading client signs its own side. When it signs on paper or by e-mail
// instead of on the portal, the trading desk attaches the client's signed copy
// and that is what stands as the client's signature (decided 19-Oct-2026,
// Target #2). The desk never signs for the client.
const TRADING_DESK = ['TRADING_USER', 'TRADING_ADMIN'];
const isTradingClientStatement = (recon) => recon.scope === 'TRADING_CLIENT' || recon.counterparty_role === 'TRADING_CLIENT';
const offlineDir = process.env.SJVN_RECON_DOC_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/recon-offline');
const offlineUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(offlineDir, { recursive: true }); cb(null, offlineDir); },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${String(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/** Both signed → closed (or agreed while an exception is open); otherwise awaiting the other side. */
function settleAfterSignature(reconId) {
  const now = db.prepare('SELECT * FROM reconciliations WHERE id = ?').get(reconId);
  const openExceptions = db.prepare(`SELECT COUNT(*) c FROM recon_exceptions WHERE reconciliation_id = ? AND status = 'OPEN'`).get(reconId).c;
  if (now.sjvn_ack_at && now.counterparty_ack_at) {
    // Both have signed. With an exception still open it is agreed but not finished.
    if (openExceptions) db.prepare(`UPDATE reconciliations SET status = 'AGREED', updated_at = datetime('now') WHERE id = ?`).run(reconId);
    else db.prepare(`UPDATE reconciliations SET status = 'CLOSED', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(reconId);
  } else {
    db.prepare(`UPDATE reconciliations SET status = 'PENDING_SIGN_OFF', updated_at = datetime('now') WHERE id = ?`).run(reconId);
  }
}

function reconFor(user, id) {
  const recon = db.prepare(`
    SELECT r.*, c.contract_no, c.seller_id, c.buyer_id FROM reconciliations r LEFT JOIN contracts c ON c.id = r.contract_id WHERE r.id = ?
  `).get(id);
  if (!recon) throw fail(404, 'Not found');
  if (!canAccessRecon(user, recon)) throw fail(403, 'Not authorized');
  return recon;
}
const sideOf = (user) => (isReia(user) ? 'SJVN' : 'COUNTERPARTY');
const audit = (req, action, id, extra = {}) => {
  try { secureLogAudit(req, { action, module: 'REIA', entityType: 'reconciliation', entityId: id, ...extra }); } catch (err) { console.error('[RECON] audit failed', err.message); }
};

/** Whether a statement is large enough to need Finance's concurrence, and why. */
export function financeConcurrenceNeeded(recon) {
  const limit = getParamNumber('recon_finance_signoff_above', 10000000);
  if (!(limit > 0)) return null;
  const rf = rollForward(recon);
  const billed = rf?.billed || 0;
  return billed > limit ? { billed, limit } : null;
}

// ── Roll-forward ────────────────────────────────────────────────────────────

/** The billing months a statement's period covers, as first and last YYYY-MM. */
export function periodWindow(period) {
  const p = String(period || '');
  let m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { from: p, to: p, label: p };
  // "2026-27": the financial year from April.
  if (m && Number(m[2]) === (Number(m[1]) + 1) % 100) return { from: `${m[1]}-04`, to: `${Number(m[1]) + 1}-03`, label: `FY ${p}` };
  m = /^(\d{4})-Q([1-4])$/i.exec(p);
  if (m) {
    const y = Number(m[1]);
    const q = Number(m[2]);
    const start = [4, 7, 10, 1][q - 1];
    const yy = q === 4 ? y + 1 : y;
    const mm = (n) => String(n).padStart(2, '0');
    return { from: `${yy}-${mm(start)}`, to: `${yy}-${mm(start + 2)}`, label: `Q${q} of FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` };
  }
  return null;
}
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

/**
 * Opening + billed − received − adjustments = closing, for the statement's
 * contract and period.
 *
 *   opening      what was still open, at the start of the period, on bills of
 *                earlier periods;
 *   billed       the bills of this period;
 *   received     cash against any of those bills, up to the period's end;
 *   adjustments  tax held back, other deductions, rebate and credit notes, to
 *                the period's end;
 *   since        what has been settled after the period closed, to today.
 */
export function rollForward(recon) {
  const win = recon.scope === 'REIA_CONTRACT' && recon.contract_id ? periodWindow(recon.period) : null;
  if (!win) return null;
  const direction = recon.counterparty_role === 'BUYER' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
  const start = `${win.from}-01`;
  const end = lastDay(win.to);
  // Bills presented to the counterparty: not DSM pool bills, and not SJVN's
  // computed bill of a month the developer has invoiced itself.
  const invoices = db.prepare(`
    SELECT * FROM invoices i WHERE i.contract_id = ? AND i.direction = ? AND i.billing_period <= ?
      AND i.status NOT IN (${NOT_BILLED.map(() => '?').join(',')})
      AND i.invoice_no NOT LIKE 'DSM-%' AND ${supersededByDeveloperSql('i')}
    ORDER BY i.billing_period, i.created_at
  `).all(recon.contract_id, direction, win.to, ...NOT_BILLED);
  const pays = invoices.length ? db.prepare(`
    SELECT * FROM payments WHERE invoice_id IN (${invoices.map(() => '?').join(',')})
  `).all(...invoices.map((i) => i.id)) : [];
  const byInvoice = new Map(invoices.map((i) => [i.id, []]));
  for (const p of pays) byInvoice.get(p.invoice_id).push(p);

  const out = { opening: 0, billed: 0, received: 0, tds: 0, deductions: 0, rebate: 0, credit_notes: 0, lps: 0, since_received: 0, since_adjusted: 0 };
  const carried = [];
  const billedNow = [];
  for (const i of invoices) {
    const inWindow = i.billing_period >= win.from;
    const list = byInvoice.get(i.id);
    const settled = (p) => (Number(p.amount) || 0) + (Number(p.deduction) || 0);
    if (!inWindow) {
      const before = list.filter((p) => dayOf(p.payment_date) < start).reduce((s, p) => s + settled(p), 0);
      const open = money((Number(i.total_amount) || 0) - before);
      if (open > 0.5) { out.opening += open; carried.push({ invoice_no: i.invoice_no, billing_period: i.billing_period, due_date: i.due_date ? dayOf(i.due_date) : null, balance: open }); }
      else if (open < -0.5) out.opening += open;
    } else {
      out.billed += Number(i.total_amount) || 0;
      billedNow.push({ invoice_no: i.invoice_no, billing_period: i.billing_period, amount: money(i.total_amount), status: i.status });
    }
    let rebateSeen = 0;
    for (const p of list) {
      const on = dayOf(p.payment_date);
      // A bill of an earlier period settled before this one began is already inside the opening balance.
      if (!inWindow && on < start) continue;
      const tds = Number(p.tds_amount) || 0;
      const other = (Number(p.deduction) || 0) - tds;
      const rebate = Number(p.rebate_amount) || 0;
      rebateSeen += rebate;
      if (on > end) {
        out.since_received += Number(p.amount) || 0;
        out.since_adjusted += (Number(p.deduction) || 0) + rebate;
        continue;
      }
      if (p.mode === 'CREDIT_NOTE') { out.credit_notes += Number(p.deduction) || 0; continue; }
      out.received += Number(p.amount) || 0;
      out.tds += tds;
      out.deductions += other;
      out.rebate += rebate;
    }
    // Rebate and surcharge held on the bill and not told payment by payment.
    const restRebate = Math.max(0, (Number(i.rebate) || 0) - rebateSeen);
    if (inWindow) { out.rebate += restRebate; out.lps += Number(i.lps) || 0; }
  }
  for (const k of Object.keys(out)) out[k] = money(out[k]);
  const adjustments = money(out.tds + out.deductions + out.rebate + out.credit_notes);
  const closing = money(out.opening + out.billed + out.lps - out.received - adjustments);
  return {
    window: win, as_at: end, direction,
    ...out, adjustments, closing,
    balance_today: money(closing - out.since_received - out.since_adjusted),
    carried_forward: carried, bills: billedNow,
  };
}

// ── What was signed ─────────────────────────────────────────────────────────

/** A fingerprint of the statement's substance: change a figure and it changes. */
function fingerprint(recon, items, exceptions) {
  const body = JSON.stringify({
    recon_no: recon.recon_no, version: recon.version, period: recon.period, contract_id: recon.contract_id,
    items: items.map((i) => [i.item_type, i.label, i.metered_value, i.billed_value, i.paid_value, i.variance, i.match_status]),
    exceptions: exceptions.map((e) => [e.label, e.amount]),
  });
  return crypto.createHash('sha256').update(body).digest('hex');
}

const itemsOf = (id) => db.prepare('SELECT * FROM recon_items WHERE reconciliation_id = ? ORDER BY created_at').all(id);
const exceptionsOf = (id) => db.prepare(`
  SELECT x.*, d.dispute_no, d.status AS dispute_status FROM recon_exceptions x LEFT JOIN disputes d ON d.id = x.dispute_id
  WHERE x.reconciliation_id = ? ORDER BY x.created_at, x.rowid
`).all(id);

const certRequiredFor = () => {
  const v = getParam('recon_auditor_certificate_required_for', '');
  return String(Array.isArray(v) ? v.join(',') : v || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
};

/** Everything around the signatures of one statement, for the side asking. */
function detailOf(user, recon) {
  const exceptions = exceptionsOf(recon.id);
  const side = sideOf(user);
  const mine = side === 'SJVN' ? recon.sjvn_ack_at : recon.counterparty_ack_at;
  const open = exceptions.filter((e) => e.status === 'OPEN');
  const rf = rollForward(recon);
  const invoice = recon.contract_id ? db.prepare(`
    SELECT id, invoice_no FROM invoices WHERE contract_id = ? AND billing_period = ? AND direction = ? AND status NOT IN (${NOT_BILLED.map(() => '?').join(',')})
    ORDER BY created_at DESC LIMIT 1
  `).get(recon.contract_id, recon.period, recon.counterparty_role === 'BUYER' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN', ...NOT_BILLED) : null;
  return {
    id: recon.id, recon_no: recon.recon_no, status: recon.status, period: recon.period, period_type: recon.period_type, contract_id: recon.contract_id,
    side,
    // The trading desk is not the client: it attaches the client's signed copy instead.
    can_sign: (side === 'SJVN' ? SIGNABLE : COUNTERPARTY_SIGNABLE).includes(recon.status) && !mine
      && !(side === 'SJVN' && !ROLE_GROUPS.REIA_CHECK.includes(user.role) && user.role !== 'FINANCE_USER')
      && !(side === 'COUNTERPARTY' && TRADING_DESK.includes(user.role)),
    can_attach_client_signed_copy: TRADING_DESK.includes(user.role) && isTradingClientStatement(recon)
      && COUNTERPARTY_SIGNABLE.includes(recon.status) && !recon.counterparty_ack_at,
    can_attach_certificate: side === 'COUNTERPARTY' && recon.scope === 'REIA_CONTRACT',
    // Phase B.2: signing for SJVN and settling an exception are the REIA checker's.
    can_resolve: side === 'SJVN' && ROLE_GROUPS.REIA_CHECK.includes(user.role),
    certificate_required: certRequiredFor().includes(recon.period_type),
    finance_concurrence: (() => {
      const need = financeConcurrenceNeeded(recon);
      return need ? { required: true, limit: need.limit, billed: need.billed, by: recon.finance_ack_by || null, at: recon.finance_ack_at || null } : { required: false };
    })(),
    rollforward: rf,
    exceptions,
    excepted_amount: money(open.reduce((s, e) => s + e.amount, 0)),
    // What is agreed and can be settled while the exceptions are argued.
    agreed_amount: rf ? money(Math.max(0, rf.billed - exceptions.reduce((s, e) => s + (e.status === 'OPEN' ? e.amount : 0), 0))) : null,
    signatures: { sjvn: parse(recon.sjvn_sign_json), counterparty: parse(recon.counterparty_sign_json) },
    same_content: (() => {
      const a = parse(recon.sjvn_sign_json)?.fingerprint;
      const b = parse(recon.counterparty_sign_json)?.fingerprint;
      return a && b ? a === b : null;
    })(),
    certificate: parse(recon.counterparty_cert_json),
    signed_copies: parse(recon.signed_copies_json) || {},
    period_invoice: invoice || null,
  };
}

// GET /:id
router.get('/:id', (req, res) => send(res, () => detailOf(req.user, reconFor(req.user, req.params.id))));

// POST /:id/sign { decision: AGREE | AGREE_WITH_EXCEPTIONS, remarks, exceptions: [{ item_id, label, amount, reason }], certificate: { version_id, auditor_name, firm_reg_no, udin } }
router.post('/:id/sign', (req, res) => send(res, () => {
  const bad = invalidDecision(req.body.decision, ['AGREE', 'AGREE_WITH_EXCEPTIONS']);
  if (bad) throw fail(400, bad);
  const recon = reconFor(req.user, req.params.id);
  if (!SIGNABLE.includes(recon.status)) throw fail(400, `Cannot sign in status ${recon.status}`);
  const side = sideOf(req.user);
  const partial = req.body.decision === 'AGREE_WITH_EXCEPTIONS';
  if (side === 'COUNTERPARTY') {
    const cs = counterpartySide(req.user);
    const ok = (cs !== null && (recon.counterparty_role == null || cs === recon.counterparty_role))
      || (recon.counterparty_role === 'TRADING_CLIENT' && req.user.role === 'TRADING_CLIENT');
    if (!ok && TRADING_DESK.includes(req.user.role) && isTradingClientStatement(recon)) {
      throw fail(403, 'The trading client signs its own side. If it signed outside the portal, attach its signed copy (offline sign-off) instead.');
    }
    if (!ok) throw fail(403, 'Only counterparty can acknowledge on this side');
    if (recon.counterparty_ack_at) throw fail(400, `This statement was already signed for your company by ${recon.counterparty_ack_by}`);
    // A company's maker prepares; its checker or admin signs. This rule lived
    // only on the older acknowledge route, so the sign-off panel let a maker sign.
    if (/_L1$/.test(String(req.user.role || ''))) {
      throw fail(403, 'Maker (Level 1) cannot execute final legal sign-off on balance reconciliation. Designated Checker (Level 2/3) or Company Admin authorization required.');
    }
    if (!COUNTERPARTY_SIGNABLE.includes(recon.status)) throw fail(400, `${recon.recon_no} is still under SJVN's review. It can be signed once SJVN has explained every line that did not match.`);
  } else {
    if (recon.sjvn_ack_at) throw fail(400, `This statement was already signed for SJVN by ${recon.sjvn_ack_by}`);
    // Finance concurs on a large statement before the desk signs it (decided
    // 17-Oct-2026): above recon_finance_signoff_above, money of that size is
    // not agreed with a counterparty on the desk's word alone.
    const needsFinance = financeConcurrenceNeeded(recon);
    if (req.user.role === 'FINANCE_USER') {
      if (!needsFinance) throw fail(403, `${recon.recon_no} is within the desk's limit — only the REIA desk signs it for SJVN`);
      if (recon.finance_ack_at) throw fail(400, `Finance already concurred, by ${recon.finance_ack_by}`);
      if (partial) throw fail(400, 'Exceptions are the counterparty\'s to raise');
      db.prepare(`UPDATE reconciliations SET finance_ack_at = datetime('now'), finance_ack_by = ?, updated_at = datetime('now') WHERE id = ?`).run(req.user.name, recon.id);
      recordEvent(recon.id, req.user, 'FINANCE_CONCURRED', { actor: req.user.name, remarks: String(req.body.remarks || '').trim().slice(0, 1000) || undefined });
      audit(req, 'RECON_FINANCE_CONCURRED', recon.id, { afterValue: { recon_no: recon.recon_no } });
      const fresh = db.prepare('SELECT r.*, c.contract_no, c.seller_id, c.buyer_id FROM reconciliations r LEFT JOIN contracts c ON c.id = r.contract_id WHERE r.id = ?').get(recon.id);
      return { success: true, side: 'SJVN', finance_concurred: true, message: `Finance has concurred. The REIA desk can now sign ${recon.recon_no} for SJVN.`, reconciliation: fresh, signoff: detailOf(req.user, fresh) };
    }
    if (!ROLE_GROUPS.REIA_CHECK.includes(req.user.role)) throw fail(403, 'The REIA checker signs a statement for SJVN');
    if (needsFinance && !recon.finance_ack_at) {
      throw fail(400, `${recon.recon_no} covers ${inr(needsFinance.billed)} billed, above the ${inr(needsFinance.limit)} limit. Finance concurs before SJVN signs.`);
    }
    // "Request sign-off" refuses a statement with a line still unexplained;
    // signing it outright went round that, and a second signature then closed it.
    const open = db.prepare(`SELECT COUNT(*) c FROM recon_items WHERE reconciliation_id = ? AND match_status IN ('EXCEPTION','CARRIED') AND dispute_id IS NULL`).get(recon.id).c;
    if (open > 0) throw fail(400, `${open} line${open === 1 ? ' has' : 's have'} not matched. Override ${open === 1 ? 'it' : 'each'} with the reason, or raise a dispute on it, before SJVN signs.`);
    if (partial) throw fail(400, 'Exceptions are the counterparty\'s to raise; SJVN signs the statement it issued');
  }
  const remarks = String(req.body.remarks || '').trim().slice(0, 1000);
  const rf = rollForward(recon);

  // The amounts the counterparty does not accept.
  const exceptions = [];
  if (partial) {
    const list = Array.isArray(req.body.exceptions) ? req.body.exceptions : [];
    if (!list.length) throw fail(400, 'Name at least one exception — the amount not agreed and why');
    const items = new Map(itemsOf(recon.id).map((i) => [i.id, i]));
    for (const [n, x] of list.entries()) {
      const amount = Number(x.amount);
      const reason = String(x.reason || '').trim().slice(0, 1000);
      const item = x.item_id ? items.get(String(x.item_id)) : null;
      if (x.item_id && !item) throw fail(400, `Exception ${n + 1}: that line is not on this statement`);
      const label = String(x.label || item?.label || '').trim().slice(0, 200);
      if (!(amount > 0)) throw fail(400, `Exception ${n + 1}: give the amount not agreed`);
      if (!label || !reason) throw fail(400, `Exception ${n + 1}: say what it is about and why`);
      exceptions.push({ item_id: item?.id || null, label, amount: money(amount), reason });
    }
    const total = exceptions.reduce((s, e) => s + e.amount, 0);
    if (rf && rf.billed > 0 && total > rf.billed + 0.5) throw fail(400, `The exceptions (${inr(total)}) come to more than was billed in the period (${inr(rf.billed)}). To reject the whole statement, disagree with it instead.`);
  }

  // The auditor's certificate that goes with the counterparty's signature.
  let cert = null;
  const c = req.body.certificate;
  if (c && c.version_id) {
    if (side !== 'COUNTERPARTY' || !recon.contract_id) throw fail(400, 'An auditor\'s certificate is attached by the counterparty to a contract statement');
    const v = db.prepare(`
      SELECT v.id, v.file_name FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.contract_id = ?
    `).get(String(c.version_id), recon.contract_id);
    if (!v) throw fail(400, 'The certificate is not one of this contract\'s documents');
    const udin = String(c.udin || '').trim().toUpperCase();
    if (udin && !/^[0-9A-Z]{18}$/.test(udin)) throw fail(400, 'A UDIN is 18 letters and digits');
    cert = {
      version_id: v.id, file_name: v.file_name, auditor_name: String(c.auditor_name || '').trim().slice(0, 120) || null,
      firm_reg_no: String(c.firm_reg_no || '').trim().slice(0, 40) || null, udin: udin || null, attached_by: req.user.name, attached_at: new Date().toISOString(),
    };
  }
  if (side === 'COUNTERPARTY' && !cert && certRequiredFor().includes(recon.period_type)) {
    throw fail(400, `An auditor's certificate is required to sign ${recon.period_type.toLowerCase()} statements`);
  }

  const items = itemsOf(recon.id);
  db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO recon_exceptions (id, reconciliation_id, item_id, label, amount, reason, raised_by, raised_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of exceptions) ins.run(newId('RXC'), recon.id, e.item_id, e.label, e.amount, e.reason, req.user.id, req.user.name);
    const sign = JSON.stringify({
      by: req.user.name, user_id: req.user.id, role: req.user.role, at: new Date().toISOString(), ip: req.ip || null,
      decision: req.body.decision, remarks: remarks || null,
      fingerprint: fingerprint(recon, items, exceptionsOf(recon.id)),
    });
    if (side === 'SJVN') {
      db.prepare(`UPDATE reconciliations SET sjvn_ack_at = datetime('now'), sjvn_ack_by = ?, sjvn_sign_json = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(req.user.name, sign, recon.id);
    } else {
      db.prepare(`
        UPDATE reconciliations SET counterparty_ack_at = datetime('now'), counterparty_ack_by = ?, counterparty_sign_json = ?,
          counterparty_cert_json = COALESCE(?, counterparty_cert_json), updated_at = datetime('now') WHERE id = ?
      `).run(req.user.name, sign, cert ? JSON.stringify(cert) : null, recon.id);
    }
    settleAfterSignature(recon.id);
  })();

  recordEvent(recon.id, req.user, partial ? 'ACKNOWLEDGE_WITH_EXCEPTIONS' : 'ACKNOWLEDGE', { side, actor: req.user.name, role: req.user.role, remarks, exceptions: exceptions.length, certificate: !!cert });
  audit(req, partial ? 'RECON_AGREED_WITH_EXCEPTIONS' : 'RECON_ACKNOWLEDGE', recon.id, {
    afterValue: { recon_no: recon.recon_no, side, exceptions: exceptions.map((e) => ({ label: e.label, amount: e.amount })), certificate: cert?.file_name || null },
  });
  const updated = db.prepare('SELECT r.*, c.contract_no, c.seller_id, c.buyer_id FROM reconciliations r LEFT JOIN contracts c ON c.id = r.contract_id WHERE r.id = ?').get(recon.id);
  saveStatement(updated, itemsOf(recon.id), req.user);
  const total = exceptions.reduce((s, e) => s + e.amount, 0);
  if (side === 'COUNTERPARTY') {
    for (const role of ROLE_GROUPS.REIA_WRITE) {
      pushNotification({ role, type: 'RECON_SIGN_OFF', message: partial
        ? `${recon.recon_no}: ${req.user.name} agreed with ${exceptions.length} exception(s) totalling Rs ${inr(total)}.`
        : `${recon.recon_no}: signed off by ${req.user.name}.` });
    }
  }
  const dual = !!(updated.sjvn_ack_at && updated.counterparty_ack_at);
  return {
    success: true, decision: req.body.decision, side, dual_signed: dual,
    message: updated.status === 'CLOSED' ? `Reconciliation ${recon.recon_no} is signed by both parties and closed.`
      : updated.status === 'AGREED' ? `Signed by both parties. ${recon.recon_no} stays open until the exceptions are settled.`
        : partial ? `Signed with ${exceptions.length} exception(s). The rest of the statement is agreed; SJVN has been told.`
          : `Signed for ${side === 'SJVN' ? 'SJVN' : 'your company'}. Awaiting the other party.`,
    reconciliation: updated,
    signoff: detailOf(req.user, updated),
  };
}));

// POST /:id/offline-counterparty-sign (multipart: file, signatory_name, signatory_designation, signed_on, remarks)
// The trading client's own signature, given outside the portal: the desk
// attaches the PDF the client signed. Recorded as the client's signature by the
// named signatory, with the desk officer who attached it — never as the desk's.
router.post('/:id/offline-counterparty-sign', offlineUpload.single('file'), (req, res) => send(res, () => {
  const drop = () => { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); };
  try {
    if (!TRADING_DESK.includes(req.user.role)) throw fail(403, 'Only the trading desk attaches a client\'s signed copy');
    const recon = reconFor(req.user, req.params.id);
    if (!isTradingClientStatement(recon)) throw fail(400, 'This is for a trading client\'s statement. A seller or buyer signs its own on the portal.');
    if (recon.counterparty_ack_at) throw fail(400, `This statement was already signed for the client by ${recon.counterparty_ack_by}`);
    if (!COUNTERPARTY_SIGNABLE.includes(recon.status)) throw fail(400, `${recon.recon_no} is ${String(recon.status).toLowerCase().replace(/_/g, ' ')} — the client signs once SJVN has finished its review`);
    const signatory = String(req.body.signatory_name || '').trim().slice(0, 120);
    if (signatory.length < 3) throw fail(400, 'Name the client\'s signatory who signed the copy');
    const designation = String(req.body.signatory_designation || '').trim().slice(0, 120) || null;
    const signedOn = String(req.body.signed_on || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signedOn) || Number.isNaN(Date.parse(signedOn))) throw fail(400, 'Give the date the client signed (YYYY-MM-DD)');
    if (signedOn > new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)) throw fail(400, 'The signing date cannot be in the future');
    if (!req.file) throw fail(400, 'Attach the PDF the client signed');
    const info = inspectSignature(req.file.path);
    if (!info.is_pdf) throw fail(400, 'The signed copy must be a PDF');
    const remarks = String(req.body.remarks || '').trim().slice(0, 1000) || null;

    const copy = {
      file_name: req.file.originalname, file_path: path.relative(process.cwd(), req.file.path), size: req.file.size,
      attached_by: req.user.name, attached_at: new Date().toISOString(), ...info,
    };
    const sign = JSON.stringify({
      by: signatory, designation, role: 'TRADING_CLIENT', mode: 'OFFLINE_SIGNED_COPY', signed_on: signedOn,
      attached_by: req.user.name, attached_by_id: req.user.id, at: new Date().toISOString(), ip: req.ip || null,
      decision: 'AGREE', remarks, fingerprint: fingerprint(recon, itemsOf(recon.id), exceptionsOf(recon.id)),
    });
    db.transaction(() => {
      const copies = parse(recon.signed_copies_json) || {};
      copies.counterparty = copy;
      db.prepare(`
        UPDATE reconciliations SET counterparty_ack_at = datetime('now'), counterparty_ack_by = ?, counterparty_sign_json = ?,
          signed_copies_json = ?, updated_at = datetime('now') WHERE id = ?
      `).run(`${signatory} (client, signed offline; copy attached by ${req.user.name})`, sign, JSON.stringify(copies), recon.id);
      settleAfterSignature(recon.id);
    })();
    recordEvent(recon.id, req.user, 'CLIENT_SIGNED_COPY_ATTACHED', { signatory, signed_on: signedOn, file: copy.file_name, signature_found: info.signed, attached_by: req.user.name });
    audit(req, 'RECON_CLIENT_SIGNED_OFFLINE', recon.id, { afterValue: { recon_no: recon.recon_no, signatory, signed_on: signedOn, file_name: copy.file_name, signature_found: info.signed } });
    for (const role of ROLE_GROUPS.REIA_WRITE) {
      pushNotification({ role, type: 'RECON_SIGN_OFF', message: `${recon.recon_no}: the client's signed copy (${signatory}, ${signedOn}) was attached by ${req.user.name}.` });
    }
    const updated = db.prepare('SELECT r.*, c.contract_no, c.seller_id, c.buyer_id FROM reconciliations r LEFT JOIN contracts c ON c.id = r.contract_id WHERE r.id = ?').get(recon.id);
    saveStatement(updated, itemsOf(recon.id), req.user);
    return detailOf(req.user, updated);
  } catch (err) {
    drop();
    throw err;
  }
}));

// POST /exceptions/:id/resolve { outcome: ACCEPTED | REJECTED, note, dispute_id }
router.post('/exceptions/:id/resolve', (req, res) => send(res, () => {
  const x = db.prepare('SELECT * FROM recon_exceptions WHERE id = ?').get(req.params.id);
  if (!x) throw fail(404, 'Exception not found');
  const recon = reconFor(req.user, x.reconciliation_id);
  if (!ROLE_GROUPS.REIA_CHECK.includes(req.user.role)) throw fail(403, 'Settling an exception is the REIA checker\'s');
  if (x.status !== 'OPEN') throw fail(400, 'This exception has already been settled');
  const outcome = String(req.body.outcome || '').toUpperCase();
  if (!['ACCEPTED', 'REJECTED'].includes(outcome)) throw fail(400, 'outcome must be ACCEPTED or REJECTED');
  const note = String(req.body.note || '').trim().slice(0, 1000);
  if (!note) throw fail(400, 'Give the reasons for the decision');
  db.prepare(`UPDATE recon_exceptions SET status = ?, resolution_note = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
    .run(outcome, note, req.user.name, x.id);
  // An exception SJVN accepts means the counterparty was right about money, so
  // the note that puts it right is drafted with it (R4, through the note engine)
  // and goes to Finance for approval. Where no bill can carry it yet, the
  // decision stands and the note can be drafted from the exception later.
  let drafted = null;
  let noteProblem = null;
  if (outcome === 'ACCEPTED' && recon.contract_id && Number(x.amount) > 0) {
    try { drafted = noteFromException({ kind: 'RECON_EXCEPTION', ref: x.id, user: req.user, req }); } catch (e) { if (!e.status) throw e; noteProblem = e.message; }
  }
  const left = db.prepare(`SELECT COUNT(*) c FROM recon_exceptions WHERE reconciliation_id = ? AND status = 'OPEN'`).get(recon.id).c;
  if (!left && recon.status === 'AGREED' && recon.sjvn_ack_at && recon.counterparty_ack_at) {
    db.prepare(`UPDATE reconciliations SET status = 'CLOSED', closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(recon.id);
    recordEvent(recon.id, req.user, 'CLOSED', { via: 'exceptions_settled' });
  }
  recordEvent(recon.id, req.user, 'EXCEPTION_SETTLED', { label: x.label, amount: x.amount, outcome, note });
  audit(req, `RECON_EXCEPTION_${outcome}`, recon.id, { afterValue: { label: x.label, amount: x.amount }, reason: note });
  // To the company that raised it — this went to every company with that role.
  const told = `${recon.recon_no}: your exception "${x.label}" (Rs ${inr(x.amount)}) was ${outcome === 'ACCEPTED' ? 'accepted' : 'not accepted'} — ${note}`;
  if (recon.contract_id && ['SELLER', 'BUYER'].includes(recon.counterparty_role)) notifyCounterparty(recon.contract_id, recon.counterparty_role, 'RECON_EXCEPTION', told);
  else pushNotification({ role: 'TRADING_USER', type: 'RECON_EXCEPTION', message: told });
  return {
    ...detailOf(req.user, db.prepare('SELECT r.*, c.contract_no, c.seller_id, c.buyer_id FROM reconciliations r LEFT JOIN contracts c ON c.id = r.contract_id WHERE r.id = ?').get(recon.id)),
    note_drafted: drafted ? { id: drafted.id, note_type: drafted.note_type, amount: drafted.amount } : null,
    note_problem: noteProblem,
  };
}));

// POST /:id/signed-copy { version_id } — the statement as this side signed it with a digital signature certificate.
router.post('/:id/signed-copy', (req, res) => send(res, () => {
  const recon = reconFor(req.user, req.params.id);
  if (!recon.contract_id) throw fail(400, 'A signed copy is attached to a contract statement');
  const side = sideOf(req.user);
  if (!(side === 'SJVN' ? recon.sjvn_ack_at : recon.counterparty_ack_at)) throw fail(400, 'Sign the statement here first, then attach the copy signed with your certificate');
  const v = db.prepare(`
    SELECT v.id, v.file_path, v.file_name FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.id = ? AND d.contract_id = ?
  `).get(String(req.body.version_id || ''), recon.contract_id);
  if (!v) throw fail(400, 'That file is not one of this contract\'s documents');
  const info = inspectSignature(v.file_path);
  if (!info.is_pdf) throw fail(400, 'The signed copy must be a PDF');
  const copies = parse(recon.signed_copies_json) || {};
  copies[side === 'SJVN' ? 'sjvn' : 'counterparty'] = { version_id: v.id, file_name: v.file_name, attached_by: req.user.name, attached_at: new Date().toISOString(), ...info };
  db.prepare(`UPDATE reconciliations SET signed_copies_json = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(copies), recon.id);
  recordEvent(recon.id, req.user, 'SIGNED_COPY_ATTACHED', { side, file: v.file_name, signature_found: info.signed });
  audit(req, 'RECON_SIGNED_COPY_ATTACHED', recon.id, { afterValue: { side, file_name: v.file_name, signature_found: info.signed, signer: info.signer || null } });
  return detailOf(req.user, { ...recon, signed_copies_json: JSON.stringify(copies) });
}));

// ── The statement as a document ─────────────────────────────────────────────

function documentOf(user, id) {
  const recon = reconFor(user, id);
  const party = recon.counterparty_role === 'BUYER' ? recon.buyer_id : recon.seller_id;
  const entity = party ? db.prepare('SELECT name, pan_no, gst_no FROM entities WHERE id = ?').get(party) : null;
  return { recon, entity, items: itemsOf(recon.id), d: detailOf(user, recon) };
}
const partyLabel = (recon) => (recon.counterparty_role === 'BUYER' ? 'Buyer' : recon.counterparty_role === 'SELLER' ? 'Seller' : 'Counterparty');
const standing = (recon) => (recon.status === 'CLOSED' ? 'RECONCILED — SIGNED BY BOTH PARTIES'
  : recon.status === 'AGREED' ? 'AGREED WITH EXCEPTIONS — SIGNED BY BOTH PARTIES'
    : recon.status === 'DISPUTED' ? 'DISPUTED' : 'NOT YET SIGNED BY BOTH PARTIES');
const rollRows = (rf) => [
  ['Opening balance — bills of earlier periods still open', rf.opening],
  ['Add: billed in the period', rf.billed],
  ...(rf.lps ? [['Add: late payment surcharge', rf.lps]] : []),
  ['Less: payments received', -rf.received],
  ...(rf.tds ? [['Less: tax deducted at source', -rf.tds]] : []),
  ...(rf.deductions ? [['Less: other deductions', -rf.deductions]] : []),
  ...(rf.rebate ? [['Less: early-payment rebate', -rf.rebate]] : []),
  ...(rf.credit_notes ? [['Less: credit notes', -rf.credit_notes]] : []),
  [`Closing balance as at ${rf.as_at}`, rf.closing],
];

router.get('/:id/statement.pdf', (req, res) => {
  let x;
  try { x = documentOf(req.user, req.params.id); } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
  const { recon, entity, items, d } = x;
  const title = 'Reconciliation Statement';
  const ctx = { vertical: 'REIA', title, subtitle: `${recon.recon_no}  ·  ${d.rollforward?.window.label || recon.period}` };
  const doc = newDoc(res, `${title} ${recon.recon_no}`, `reconciliation-${recon.recon_no.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`);
  header(doc, { ...ctx, generatedAt: nowLabel() });
  let y = 84;
  doc.font('Helvetica').fontSize(8.5);
  for (const [k, v] of [
    ['Between', `SJVN Limited  and  ${entity?.name || recon.contract_no || '—'}${entity?.pan_no ? `  (PAN ${entity.pan_no})` : ''}`],
    ['Contract', recon.contract_no || '—'],
    ['Period', `${d.rollforward?.window.label || recon.period}  ·  ${recon.data_basis.toLowerCase()} data  ·  statement version ${recon.version}`],
    ['Standing', standing(recon)],
  ]) {
    doc.fillColor(MUTED).text(k, M, y, { width: 70 });
    doc.fillColor(INK).text(v, M + 75, y, { width: CONTENT_W - 75 });
    y += 14;
  }
  const num = { label: 'Rs', w: 130, align: 'right', value: (r) => r.value };
  if (d.rollforward) {
    const rf = d.rollforward;
    y = kpiBand(doc, y + 6, [
      { label: 'Opening', value: `Rs ${inr(rf.opening)}` }, { label: 'Billed', value: `Rs ${inr(rf.billed)}` },
      { label: 'Received & adjusted', value: `Rs ${inr(rf.received + rf.adjustments)}` }, { label: 'Closing', value: `Rs ${inr(rf.closing)}` },
    ]);
    y = sectionTitle(doc, y, 'Balance roll-forward');
    y = table(doc, y, [{ label: 'Particulars', w: CONTENT_W - 130, value: (r) => r.label }, num],
      rollRows(rf).map(([label, v]) => ({ label, value: v < 0 ? `(${inr(-v)})` : inr(v) })), ctx, { fontSize: 8, rowH: 16 });
    if (rf.carried_forward.length) {
      y = sectionTitle(doc, y + 10, 'Bills carried into the period');
      y = table(doc, y, [
        { label: 'Invoice', w: CONTENT_W - 330, value: (r) => r.invoice_no }, { label: 'Period', w: 90, value: (r) => r.billing_period },
        { label: 'Due', w: 110, value: (r) => r.due_date || '—' }, { ...num, value: (r) => inr(r.balance) },
      ], rf.carried_forward, ctx, { fontSize: 8, rowH: 15 });
    }
  }
  y = sectionTitle(doc, y + 10, 'Line checks');
  y = table(doc, y, [
    { label: 'Line', w: CONTENT_W - 380, value: (r) => r.label },
    { label: 'Metered / basis', w: 90, align: 'right', value: (r) => r.metered_value ?? '—' },
    { label: 'Billed', w: 90, align: 'right', value: (r) => r.billed_value ?? '—' },
    { label: 'Paid', w: 80, align: 'right', value: (r) => r.paid_value ?? '—' },
    { label: 'Variance', w: 60, align: 'right', value: (r) => r.variance ?? '—' },
    { label: 'Result', w: 60, value: (r) => (r.match_status === 'NOT_CONNECTED' ? 'Not checked' : ['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'].includes(r.match_status) ? 'Matched' : 'Exception') },
  ], items, ctx, { fontSize: 7.5, rowH: 15 });
  if (d.exceptions.length) {
    y = sectionTitle(doc, y + 10, `${partyLabel(recon)}'s exceptions — not agreed`);
    y = table(doc, y, [
      { label: 'About', w: 150, value: (r) => r.label }, { label: 'Reason', w: CONTENT_W - 370, value: (r) => r.reason },
      { label: 'Amount (Rs)', w: 100, align: 'right', value: (r) => inr(r.amount) },
      { label: 'Standing', w: 120, value: (r) => (r.status === 'OPEN' ? 'Open' : `${r.status === 'ACCEPTED' ? 'Accepted' : 'Not accepted'} by ${r.resolved_by}`) },
    ], d.exceptions, ctx, { fontSize: 7.5, rowH: 15 });
  }
  y = sectionTitle(doc, y + 12, 'Sign-off');
  const sig = (label, s) => (s
    ? `${label}: ${s.by} (${String(s.role).replace(/_/g, ' ')}) on ${stamp(s.at.replace('T', ' ').slice(0, 19))}${s.decision === 'AGREE_WITH_EXCEPTIONS' ? ' — agreed with exceptions' : ''}. Fingerprint ${s.fingerprint.slice(0, 16)}…`
    : `${label}: not yet signed.`);
  const c = d.certificate;
  footNotes(doc, y, [
    sig('SJVN', d.signatures.sjvn),
    sig(partyLabel(recon), d.signatures.counterparty),
    d.same_content === true ? 'Both parties signed the same figures.' : d.same_content === false ? 'The figures changed between the two signatures — the fingerprints differ.' : null,
    d.agreed_amount != null && d.excepted_amount > 0 ? `Agreed and payable: Rs ${inr(d.agreed_amount)} of Rs ${inr(d.rollforward.billed)} billed. Under exception: Rs ${inr(d.excepted_amount)}.` : null,
    c ? `Auditor's certificate attached: ${c.file_name}${c.auditor_name ? ` — ${c.auditor_name}` : ''}${c.firm_reg_no ? `, FRN ${c.firm_reg_no}` : ''}${c.udin ? `, UDIN ${c.udin}` : ''}.` : null,
    'Each sign-off is an electronic acknowledgement recorded on the SJVN portal with the signatory, time and a fingerprint of the figures. It is not a certificate-based digital signature.',
  ].filter(Boolean));
  // Across every page, what the document is — so a single sheet cannot pass for a signed statement.
  const mark = standing(recon);
  eachPage(doc, () => {
    doc.save();
    doc.rotate(-32, { origin: [PAGE_W / 2, PAGE_H / 2] });
    doc.fillColor(recon.status === 'CLOSED' || recon.status === 'AGREED' ? '#0f766e' : '#b91c1c').fillOpacity(0.07).font('Helvetica-Bold').fontSize(34)
      .text(mark, 0, PAGE_H / 2 - 20, { width: PAGE_W, align: 'center', lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);
  });
  pageNumbers(doc);
  doc.end();
  audit(req, 'RECON_STATEMENT_DOWNLOADED', recon.id, { details: { format: 'pdf', status: recon.status } });
});

router.get('/:id/statement.xlsx', (req, res) => {
  try {
    const { recon, entity, items, d } = documentOf(req.user, req.params.id);
    const wb = XLSX.utils.book_new();
    const s = d.signatures;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Reconciliation Statement', recon.recon_no], ['Between', 'SJVN Limited', entity?.name || ''], ['Contract', recon.contract_no || ''],
      ['Period', d.rollforward?.window.label || recon.period], ['Standing', standing(recon)], ['Generated', nowLabel()], [],
      ...(d.rollforward ? [['Balance roll-forward', 'Rs'], ...rollRows(d.rollforward), ['Settled since the period closed', -(d.rollforward.since_received + d.rollforward.since_adjusted)], ['Balance today', d.rollforward.balance_today], []] : []),
      ['Sign-off'], ['SJVN', s.sjvn?.by || 'Not signed', s.sjvn?.at || '', s.sjvn?.fingerprint || ''],
      [partyLabel(recon), s.counterparty?.by || 'Not signed', s.counterparty?.at || '', s.counterparty?.fingerprint || ''],
    ]), 'Statement');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Line', 'Type', 'Metered / basis', 'Billed', 'Paid', 'Variance', 'Result', 'Notes'],
      ...items.map((i) => [i.label, i.item_type, i.metered_value, i.billed_value, i.paid_value, i.variance, i.match_status, i.notes || '']),
    ]), 'Line checks');
    if (d.exceptions.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['About', 'Reason', 'Amount (Rs)', 'Standing', 'Decision', 'Decided by'],
        ...d.exceptions.map((e) => [e.label, e.reason, e.amount, e.status, e.resolution_note || '', e.resolved_by || '']),
      ]), 'Exceptions');
    }
    if (d.rollforward?.carried_forward.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Invoice', 'Period', 'Due', 'Balance carried in (Rs)'],
        ...d.rollforward.carried_forward.map((b) => [b.invoice_no, b.billing_period, b.due_date || '', b.balance]),
      ]), 'Carried forward');
    }
    audit(req, 'RECON_STATEMENT_DOWNLOADED', recon.id, { details: { format: 'xlsx', status: recon.status } });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reconciliation-${recon.recon_no.replace(/[^A-Za-z0-9]+/g, '-')}.xlsx"`);
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
});

export default router;
