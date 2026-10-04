/**
 * A seller's or buyer's landing page.
 *
 * The dashboards were a grid of totals — how many invoices, how much billed —
 * that said nothing about what the person looking at it had to do. A company's
 * user opens the portal to find out three things: what is waiting on me, where
 * does my money stand, and what is coming up. This answers those from the same
 * tables the working screens use, so a figure here and the screen behind it
 * cannot disagree.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, SELLER_ROLES, BUYER_ROLES, counterpartySide } from '../middleware/auth.js';
import { OPEN_STATUSES } from '../disputesConstants.js';
import { PRESENTED_STATUSES } from '../services/counterpartyScope.js';
import { getParamNumber } from '../mastersService.js';
import { buildBoard } from '../services/alertBoard.js';
import {
  newDoc, header, kpiBand, sectionTitle, table, notes, pageNumbers, nowLabel, rs, RED, AMBER, GREEN, CONTENT_W,
} from '../scripts/reportPdfKit.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole(...SELLER_ROLES, ...BUYER_ROLES));

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000);
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const all = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch { return []; } };
const one = (sql, ...p) => { try { return db.prepare(sql).get(...p) || {}; } catch { return {}; } };

/** What is left on a bill — the same arithmetic as services/outstanding.js. */
const LEFT = `(COALESCE(i.total_amount, 0) - COALESCE(i.rebate, 0) + COALESCE(i.lps, 0) - COALESCE(i.disputed_amount, 0)
  - COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0))`;

/** A bill SJVN (or the buyer) is actually due to pay: accepted, and not yet settled. */
const PAYABLE = `('APPROVED','SENT','PARTIALLY_PAID','DISPUTED')`;
/** Rupees in full, as the screens show them. */
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

const PERIODS = { FY: 'This financial year', '12M': 'Last 12 months', ALL: 'Since the start' };

/** The window asked for, and the one before it to compare against. */
function windowOf(period) {
  const now = new Date();
  const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  if (period === 'ALL') return { key: 'ALL', label: PERIODS.ALL, from: '0000-00', to: '9999-12', prev: null };
  if (period === '12M') {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
    const pStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 12, 1));
    const pEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
    return {
      key: '12M', label: PERIODS['12M'], from: ym(start.getUTCFullYear(), start.getUTCMonth() + 1), to: ym(end.getUTCFullYear(), end.getUTCMonth() + 1),
      prev: { from: ym(pStart.getUTCFullYear(), pStart.getUTCMonth() + 1), to: ym(pEnd.getUTCFullYear(), pEnd.getUTCMonth() + 1), label: 'the 12 months before' },
    };
  }
  const fy = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    key: 'FY', label: `FY ${fy}-${String(fy + 1).slice(2)}`, from: ym(fy, 4), to: ym(fy + 1, 3),
    // Like for like: the same months of last year, not the whole of it.
    prev: { from: ym(fy - 1, 4), to: ym(now.getUTCMonth() >= 3 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 1, now.getUTCMonth() + 1), label: 'the same months last year' },
  };
}

function scopeOf(user) {
  const side = counterpartySide(user);
  const entityId = user.linked_entity_id;
  if (!entityId) throw Object.assign(new Error('Your account is not linked to a company. Contact SJVN.'), { status: 400 });
  const seller = side === 'SELLER';
  const contracts = seller
    ? all(`SELECT DISTINCT c.* FROM contracts c LEFT JOIN contract_projects cp ON cp.contract_id = c.id
           WHERE (c.seller_id = ? OR cp.project_entity_id = ?) AND c.status NOT IN ('DRAFT') ORDER BY c.contract_no`, entityId, entityId)
    : all(`SELECT * FROM contracts WHERE buyer_id = ? AND status NOT IN ('DRAFT') ORDER BY contract_no`, entityId);
  const level = /_L([123])$/.exec(user.role)?.[1];
  const tier = level ? `L${level}` : 'ADMIN';
  return {
    side, seller, entityId, tier, prefix: seller ? '/seller' : '/buyer',
    direction: seller ? 'SELLER_TO_SJVN' : 'SJVN_TO_BUYER',
    contracts, ids: contracts.map((c) => c.id),
    // A seller sees its own bills at every stage; a buyer only those SJVN has presented.
    billWhere: seller ? `i.status <> 'CANCELLED'` : `i.status IN (${PRESENTED_STATUSES.map((s) => `'${s}'`).join(',')}) AND i.status <> 'CANCELLED'`,
  };
}

// ── What is waiting on this person ──────────────────────────────────────────

function todoOf(user, s) {
  const out = [];
  const add = (item) => { if (item.count > 0) out.push(item); };
  const ph = s.ids.map(() => '?').join(',') || `''`;
  const P = s.prefix;

  if (s.seller) {
    const drafts = one(`SELECT COUNT(*) n, COALESCE(SUM(total_amount), 0) amt FROM invoices i WHERE i.contract_id IN (${ph}) AND i.direction = 'SELLER_TO_SJVN' AND i.status = 'DRAFT'`, ...s.ids);
    add(s.tier === 'L1'
      ? { key: 'drafts', level: 'blue', count: drafts.n, title: `${drafts.n} invoice${drafts.n === 1 ? '' : 's'} in draft`, detail: 'Finish them and send them to your checker.', link: `${P}/invoices` }
      : { key: 'drafts', level: 'amber', count: drafts.n, title: `${drafts.n} invoice${drafts.n === 1 ? '' : 's'} waiting for your approval`, detail: `Prepared by a maker — ${inr(drafts.amt)} in all. Approve and submit to SJVN.`, link: `${P}/invoices` });
  } else {
    const due = one(`SELECT COUNT(*) n, COALESCE(SUM(${LEFT}), 0) amt, MIN(i.due_date) first FROM invoices i
      WHERE i.contract_id IN (${ph}) AND i.direction = 'SJVN_TO_BUYER' AND i.status IN ${PAYABLE} AND ${LEFT} > 0
        AND i.due_date BETWEEN date('now') AND date('now', '+10 days')`, ...s.ids);
    add({ key: 'bills-due', level: 'amber', count: due.n, title: `${due.n} bill${due.n === 1 ? '' : 's'} due within 10 days`, detail: `${inr(due.amt)} to pay; the first falls due on ${due.first}. A bill paid after its due date attracts late payment surcharge.`, link: `${P}/invoices`, due: due.first });
  }

  if (!s.seller) {
    const pin = all(`SELECT status, COUNT(*) n, COALESCE(SUM(amount), 0) amt FROM payment_intimations WHERE entity_id = ? AND (status = 'PENDING_CHECKER' OR (status = 'REJECTED' AND decided_at >= datetime('now', '-14 days'))) GROUP BY status`, s.entityId);
    const waiting = pin.find((p) => p.status === 'PENDING_CHECKER');
    const refused = pin.find((p) => p.status === 'REJECTED');
    if (waiting) {
      add(s.tier === 'L1'
        ? { key: 'intimations-checker', level: 'blue', count: waiting.n, title: `${waiting.n} payment intimation${waiting.n === 1 ? '' : 's'} with your checker`, detail: 'SJVN is told only once a checker passes it on.', link: `${P}/invoices` }
        : { key: 'intimations-checker', level: 'amber', count: waiting.n, title: `${waiting.n} payment intimation${waiting.n === 1 ? '' : 's'} waiting for your approval`, detail: `Prepared by a maker — ${inr(waiting.amt)} in all. Check the UTR and pass it on to SJVN.`, link: `${P}/invoices` });
    }
    if (refused) add({ key: 'intimations-rejected', level: 'red', count: refused.n, title: `SJVN Finance could not confirm ${refused.n} payment${refused.n === 1 ? '' : 's'}`, detail: 'The bill stands unpaid. See the reason and send the correct details.', link: `${P}/invoices` });
  }

  const overdue = one(`SELECT COUNT(*) n, COALESCE(SUM(${LEFT}), 0) amt FROM invoices i
    WHERE i.contract_id IN (${ph}) AND i.direction = ? AND i.status IN ${PAYABLE} AND ${LEFT} > 0 AND i.due_date < date('now')`, ...s.ids, s.direction);
  add(s.seller
    ? { key: 'overdue', level: 'red', count: overdue.n, title: `${overdue.n} of your bills ${overdue.n === 1 ? 'is' : 'are'} past the due date`, detail: `${inr(overdue.amt)} is overdue from SJVN. Late payment surcharge is accruing.`, link: `${P}/payments` }
    : { key: 'overdue', level: 'red', count: overdue.n, title: `${overdue.n} bill${overdue.n === 1 ? ' is' : 's are'} overdue`, detail: `${inr(overdue.amt)} is past its due date and attracting late payment surcharge.`, link: `${P}/invoices` });

  const energy = one(`SELECT COUNT(*) n FROM energy_data e WHERE e.contract_id IN (${ph}) AND e.status = 'VALIDATED' AND e.response_status IS NULL
    AND NOT EXISTS (SELECT 1 FROM energy_data n WHERE n.supersedes_energy_id = e.id)`, ...s.ids);
  add({ key: 'energy', level: 'amber', count: energy.n, title: `${energy.n} month${energy.n === 1 ? '' : 's'} of energy data to confirm`, detail: 'SJVN has validated the figures. Accept them, or object before they are billed.', link: `${P}/energy-data` });

  const myDisputes = all(`SELECT d.status, d.resolution_response FROM disputes d JOIN invoices i ON i.id = d.invoice_id
    WHERE i.contract_id IN (${ph}) AND d.raised_by_role LIKE ?`, ...s.ids, `${s.side}%`);
  const answer = myDisputes.filter((d) => /^RESOLVED/.test(d.status) && !d.resolution_response).length;
  const info = myDisputes.filter((d) => d.status === 'INFO_REQUESTED').length;
  add({ key: 'dispute-answer', level: 'amber', count: answer, title: `${answer} dispute resolution${answer === 1 ? '' : 's'} awaiting your answer`, detail: 'SJVN has given its resolution. Accept it, or escalate what you do not accept.', link: `${P}/disputes` });
  add({ key: 'dispute-info', level: 'amber', count: info, title: `SJVN has asked for more information on ${info} dispute${info === 1 ? '' : 's'}`, detail: 'The clock is stopped until you reply.', link: `${P}/disputes` });

  const recon = one(`SELECT COUNT(*) n FROM reconciliations r WHERE r.contract_id IN (${ph}) AND r.status = 'PENDING_SIGN_OFF' AND r.counterparty_ack_at IS NULL`, ...s.ids);
  add({ key: 'recon', level: 'amber', count: recon.n, title: `${recon.n} reconciliation statement${recon.n === 1 ? '' : 's'} to sign`, detail: 'Check the figures against your books and sign, or record the items you do not agree.', link: `${P}/reconciliation` });

  const requests = one(`SELECT COUNT(*) n, MIN(due_date) first FROM document_requests WHERE entity_id = ? AND status = 'OPEN'`, s.entityId);
  add({ key: 'doc-requests', level: requests.first && requests.first < today() ? 'red' : 'amber', count: requests.n, title: `SJVN has asked for ${requests.n} document${requests.n === 1 ? '' : 's'}`, detail: requests.first ? `The earliest is wanted by ${requests.first}.` : 'Upload them under My Documents & KYC.', link: `${P}/documents`, due: requests.first });

  const rejected = one(`SELECT COUNT(*) n FROM documents d JOIN document_versions v ON v.document_id = d.id
    WHERE d.entity_id = ? AND d.status = 'ACTIVE' AND v.verification_status = 'REJECTED'
      AND v.version_number = (SELECT MAX(version_number) FROM document_versions WHERE document_id = d.id)`, s.entityId);
  add({ key: 'doc-rejected', level: 'red', count: rejected.n, title: `${rejected.n} document${rejected.n === 1 ? ' was' : 's were'} rejected by SJVN`, detail: 'See the reason and upload a corrected copy.', link: `${P}/documents` });

  const warn = getParamNumber('security_expiry_warn_days', 60);
  const bgs = all(`SELECT ps.instrument_no, ps.validity_end FROM payment_security ps
    WHERE ps.contract_id IN (${ph}) AND ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED') AND ps.validity_end IS NOT NULL
      AND julianday(ps.validity_end) - julianday('now') <= ?
      AND NOT EXISTS (SELECT 1 FROM security_amendments a WHERE a.payment_security_id = ps.id AND a.status = 'PENDING')
    ORDER BY ps.validity_end`, ...s.ids, warn);
  add({ key: 'security', level: bgs.some((b) => daysUntil(b.validity_end) <= getParamNumber('security_expiry_critical_days', 30)) ? 'red' : 'amber', count: bgs.length,
    title: `${bgs.length} ${s.seller ? 'guarantee' : 'letter of credit'}${bgs.length === 1 ? '' : 's'} need${bgs.length === 1 ? 's' : ''} an extension`,
    detail: bgs.length ? `${bgs[0].instrument_no} expires on ${bgs[0].validity_end}. Submit the bank's extension before it lapses.` : '', link: `${P}/payment-security`, due: bgs[0]?.validity_end });

  const milestones = all(`SELECT m.label, m.due_date FROM contract_milestones m WHERE m.contract_id IN (${ph}) AND m.achieved_date IS NULL AND m.reported_date IS NULL
    AND m.due_date IS NOT NULL AND m.due_date <= date('now', '+30 days') ORDER BY m.due_date`, ...s.ids);
  const late = milestones.filter((m) => m.due_date < today()).length;
  add({ key: 'milestones', level: late ? 'red' : 'amber', count: milestones.length,
    title: late ? `${late} contract milestone${late === 1 ? ' is' : 's are'} overdue` : `${milestones.length} milestone${milestones.length === 1 ? '' : 's'} due within 30 days`,
    detail: milestones.length ? `${milestones[0].label} — due ${milestones[0].due_date}. Report it achieved, or ask for more time.` : '', link: `${P}/contracts`, due: milestones[0]?.due_date });

  const notices = one(`SELECT COUNT(*) n, MIN(response_due) first FROM contract_notices n WHERE n.contract_id IN (${ph}) AND n.sent_by_side = 'SJVN' AND n.counterparty_side = ? AND n.acknowledged_at IS NULL`, ...s.ids, s.side);
  add({ key: 'notices', level: 'red', count: notices.n, title: `${notices.n} notice${notices.n === 1 ? '' : 's'} from SJVN to acknowledge`, detail: notices.first ? `A response is due by ${notices.first}.` : 'Open the contract to read and acknowledge.', link: `${P}/contracts`, due: notices.first });

  const mail = one(`SELECT COUNT(*) n FROM mail_boxes WHERE user_id = ? AND box = 'INBOX' AND read_at IS NULL AND deleted_at IS NULL AND archived_at IS NULL`, user.id);
  add({ key: 'mail', level: 'blue', count: mail.n, title: `${mail.n} unread message${mail.n === 1 ? '' : 's'}`, detail: 'In your portal mailbox.', link: '/mail' });

  const rank = { red: 0, amber: 1, blue: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ── What is coming up ───────────────────────────────────────────────────────

function calendarOf(s, days = 60) {
  const ph = s.ids.map(() => '?').join(',') || `''`;
  const until = addDays(today(), days);
  const out = [];
  for (const r of all(`SELECT i.invoice_no, i.due_date, ${LEFT} AS left_amt FROM invoices i
    WHERE i.contract_id IN (${ph}) AND i.direction = ? AND i.status IN ${PAYABLE} AND ${LEFT} > 0
      AND i.due_date BETWEEN ? AND ?`, ...s.ids, s.direction, today(), until)) {
    out.push({ date: r.due_date, kind: 'PAYMENT', title: s.seller ? `Payment due from SJVN — ${r.invoice_no}` : `Payment due to SJVN — ${r.invoice_no}`, detail: inr(r.left_amt), link: `${s.prefix}/${s.seller ? 'payments' : 'invoices'}` });
  }
  for (const r of all(`SELECT instrument_no, bg_subtype, mechanism_type, validity_end FROM payment_security WHERE contract_id IN (${ph})
    AND status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED') AND validity_end BETWEEN ? AND ?`, ...s.ids, today(), until)) {
    out.push({ date: r.validity_end, kind: 'SECURITY', title: `${r.bg_subtype || r.mechanism_type} ${r.instrument_no} expires`, detail: 'Extend it before this date', link: `${s.prefix}/payment-security` });
  }
  if (s.seller) {
    for (const r of all(`SELECT lc_no, validity_end FROM sjvn_lcs WHERE contract_id IN (${ph}) AND status = 'ACTIVE' AND validity_end BETWEEN ? AND ?`, ...s.ids, today(), until)) {
      out.push({ date: r.validity_end, kind: 'SECURITY', title: `SJVN's LC ${r.lc_no} in your favour expires`, detail: 'SJVN is to renew it', link: `${s.prefix}/payment-security` });
    }
  }
  for (const r of all(`SELECT m.label, m.due_date, c.contract_no FROM contract_milestones m JOIN contracts c ON c.id = m.contract_id
    WHERE m.contract_id IN (${ph}) AND m.achieved_date IS NULL AND m.due_date BETWEEN ? AND ?`, ...s.ids, today(), until)) {
    out.push({ date: r.due_date, kind: 'MILESTONE', title: r.label, detail: r.contract_no, link: `${s.prefix}/contracts` });
  }
  for (const r of all(`SELECT n.subject, n.response_due FROM contract_notices n WHERE n.contract_id IN (${ph}) AND n.sent_by_side = 'SJVN' AND n.counterparty_side = ?
    AND n.acknowledged_at IS NULL AND n.response_due BETWEEN ? AND ?`, ...s.ids, s.side, today(), until)) {
    out.push({ date: r.response_due, kind: 'NOTICE', title: `Response due — ${r.subject}`, detail: 'Notice from SJVN', link: `${s.prefix}/contracts` });
  }
  for (const r of all(`SELECT document_type, due_date FROM document_requests WHERE entity_id = ? AND status = 'OPEN' AND due_date BETWEEN ? AND ?`, s.entityId, today(), until)) {
    out.push({ date: r.due_date, kind: 'DOCUMENT', title: `Document wanted — ${String(r.document_type).replace(/_/g, ' ').toLowerCase()}`, detail: 'Requested by SJVN', link: `${s.prefix}/documents` });
  }
  for (const c of s.contracts) {
    if (c.tenure_end && c.tenure_end >= today() && c.tenure_end <= until) out.push({ date: c.tenure_end, kind: 'CONTRACT', title: `${c.contract_no} reaches the end of its term`, detail: '', link: `${s.prefix}/contracts` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ ...e, days: daysUntil(e.date) }));
}

// ── Where the money and the energy stand ────────────────────────────────────

function build(user, periodKey) {
  const s = scopeOf(user);
  const w = windowOf(PERIODS[periodKey] ? periodKey : 'FY');
  const ph = s.ids.map(() => '?').join(',') || `''`;
  const bills = `FROM invoices i WHERE i.contract_id IN (${ph}) AND i.direction = '${s.direction}' AND ${s.billWhere}${s.seller ? ` AND i.status <> 'DRAFT'` : ''}`;

  const billedIn = (from, to) => one(`SELECT COALESCE(SUM(i.total_amount), 0) v, COUNT(*) n, COALESCE(SUM(i.energy_mwh), 0) mwh ${bills} AND i.billing_period BETWEEN ? AND ?`, ...s.ids, from, to);
  const paidIn = (from, to) => one(`SELECT COALESCE(SUM(p.amount), 0) v, COALESCE(SUM(p.tds_amount), 0) tds, COALESCE(SUM(p.rebate_amount), 0) rebate FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.contract_id IN (${ph}) AND i.direction = ? AND COALESCE(p.mode, '') <> 'CREDIT_NOTE' AND substr(p.payment_date, 1, 7) BETWEEN ? AND ?`, ...s.ids, s.direction, from, to);
  const billed = billedIn(w.from, w.to);
  const paid = paidIn(w.from, w.to);
  const prevBilled = w.prev ? billedIn(w.prev.from, w.prev.to).v : null;

  const open = all(`SELECT i.id, i.invoice_no, i.contract_id, i.billing_period, i.due_date, i.status, ${LEFT} AS left_amt ${bills} AND i.status NOT IN ('PAID') AND ${LEFT} > 0`, ...s.ids);
  const outstanding = open.reduce((t, r) => t + r.left_amt, 0);
  const overdue = open.filter((r) => r.due_date && r.due_date < today() && ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED'].includes(r.status));
  const buckets = [['Not yet due', (d) => d <= 0], ['1–30 days', (d) => d > 0 && d <= 30], ['31–60 days', (d) => d > 30 && d <= 60], ['61–90 days', (d) => d > 60 && d <= 90], ['Over 90 days', (d) => d > 90]]
    .map(([label, test]) => {
      const rows = open.filter((r) => test(r.due_date ? -daysUntil(r.due_date) : 0));
      return { label, count: rows.length, amount: money(rows.reduce((t, r) => t + r.left_amt, 0)) };
    });

  // How long a bill takes to be paid in full: from the day it was presented to the last payment on it.
  const settled = one(`SELECT AVG(julianday(date(x.last_paid)) - julianday(date(x.presented))) d, COUNT(*) n FROM (
      SELECT COALESCE(i.issued_at, i.created_at) presented, (SELECT MAX(p.payment_date) FROM payments p WHERE p.invoice_id = i.id) last_paid
      ${bills} AND i.status = 'PAID' AND i.billing_period BETWEEN ? AND ?
    ) x WHERE x.last_paid IS NOT NULL`, ...s.ids, w.from, w.to);

  const disputes = one(`SELECT COUNT(*) n, COALESCE(SUM(d.disputed_amount), 0) amt FROM disputes d JOIN invoices i ON i.id = d.invoice_id
    WHERE i.contract_id IN (${ph}) AND d.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`, ...s.ids, ...OPEN_STATUSES);

  // Twelve months, whatever the period: the trend is read as a year.
  const months = [];
  const now = new Date();
  for (let k = 11; k >= 0; k -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    months.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, billed: 0, received: 0, energy_mwh: 0, cuf: null });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const r of all(`SELECT i.billing_period m, SUM(i.total_amount) v ${bills} AND i.billing_period >= ? GROUP BY i.billing_period`, ...s.ids, months[0].month)) {
    if (byMonth.has(r.m)) byMonth.get(r.m).billed = money(r.v);
  }
  for (const r of all(`SELECT substr(p.payment_date, 1, 7) m, SUM(p.amount) v FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.contract_id IN (${ph}) AND i.direction = ? AND COALESCE(p.mode, '') <> 'CREDIT_NOTE' AND p.payment_date >= ? GROUP BY 1`, ...s.ids, s.direction, `${months[0].month}-01`)) {
    if (byMonth.has(r.m)) byMonth.get(r.m).received = money(r.v);
  }
  for (const r of all(`SELECT e.period_month m, SUM(e.energy_mwh) mwh, AVG(e.cuf_percent) cuf FROM energy_data e
    WHERE e.contract_id IN (${ph}) AND e.period_month >= ? AND e.status IN ('VALIDATED','LOCKED')
      AND NOT EXISTS (SELECT 1 FROM energy_data n WHERE n.supersedes_energy_id = e.id) GROUP BY e.period_month`, ...s.ids, months[0].month)) {
    if (byMonth.has(r.m)) Object.assign(byMonth.get(r.m), { energy_mwh: money(r.mwh), cuf: r.cuf != null ? Math.round(r.cuf * 10) / 10 : null });
  }

  const contracts = s.contracts.map((c) => {
    const b = one(`SELECT COALESCE(SUM(i.total_amount), 0) v, COUNT(*) n ${bills.replace(`i.contract_id IN (${ph})`, 'i.contract_id = ?')}`, c.id);
    const r = one(`SELECT COALESCE(SUM(p.amount), 0) v FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.contract_id = ? AND i.direction = ? AND COALESCE(p.mode, '') <> 'CREDIT_NOTE'`, c.id, s.direction);
    const e = one(`SELECT period_month, energy_mwh, cuf_percent FROM energy_data WHERE contract_id = ? AND status IN ('VALIDATED','LOCKED') ORDER BY period_month DESC, created_at DESC LIMIT 1`, c.id);
    const mine = open.filter((o) => o.contract_id === c.id);
    const sec = one(`SELECT COUNT(*) n, MIN(validity_end) first FROM payment_security WHERE contract_id = ? AND status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED')`, c.id);
    return {
      id: c.id, contract_no: c.contract_no, contract_type: c.contract_type, project_type: c.project_type, status: c.status,
      capacity_mw: c.capacity_mw, tariff_per_unit: c.tariff_per_unit, tenure_end: c.tenure_end,
      billed: money(b.v), invoices: b.n, received: money(r.v),
      outstanding: money(mine.reduce((t, o) => t + o.left_amt, 0)),
      overdue: money(mine.filter((o) => overdue.includes(o)).reduce((t, o) => t + o.left_amt, 0)),
      last_energy_month: e.period_month || null, last_energy_mwh: e.energy_mwh ?? null, last_cuf: e.cuf_percent ?? null,
      security_count: sec.n || 0, security_next_expiry: sec.first || null,
    };
  });

  const recentPayments = all(`SELECT p.id, p.amount, p.payment_date, p.mode, p.reference, p.tds_amount, i.invoice_no FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.contract_id IN (${ph}) AND i.direction = ? AND COALESCE(p.mode, '') <> 'CREDIT_NOTE' ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 5`, ...s.ids, s.direction);
  const recentInvoices = all(`SELECT i.id, i.invoice_no, i.billing_period, i.total_amount, i.status, i.due_date, ${LEFT} AS left_amt ${bills} ORDER BY i.created_at DESC LIMIT 6`, ...s.ids);
  const news = all(`SELECT id, type, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 8`, user.id);

  let alerts = { critical: 0, warning: 0, info: 0 };
  try { alerts = buildBoard(user).summary; } catch { /* the board is a courtesy here */ }

  const entity = one('SELECT id, name, status, entity_type FROM entities WHERE id = ?', s.entityId);
  const logins = all(`SELECT created_at FROM audit_logs WHERE action = 'LOGIN' AND entity_id = ? ORDER BY created_at DESC LIMIT 2`, user.id);
  const active = s.contracts.filter((c) => c.status === 'ACTIVE');

  return {
    side: s.side, tier: s.tier, prefix: s.prefix,
    me: { name: user.name, entity_name: entity.name || '', kyc_status: entity.status || null, previous_sign_in: logins[1]?.created_at || null },
    period: { key: w.key, label: w.label, compare_label: w.prev?.label || null, options: PERIODS },
    kpis: {
      active_contracts: active.length,
      capacity_mw: active.reduce((t, c) => t + (c.capacity_mw || 0), 0),
      billed: money(billed.v), billed_count: billed.n, billed_prev: prevBilled != null ? money(prevBilled) : null,
      billed_change_pct: prevBilled ? Math.round(((billed.v - prevBilled) / prevBilled) * 1000) / 10 : null,
      energy_mwh: money(billed.mwh),
      received: money(paid.v), tds: money(paid.tds), rebate: money(paid.rebate),
      outstanding: money(outstanding), open_bills: open.length,
      overdue: money(overdue.reduce((t, r) => t + r.left_amt, 0)), overdue_count: overdue.length,
      avg_days_to_pay: settled.n ? Math.round(settled.d) : null, bills_settled: settled.n || 0,
      open_disputes: disputes.n || 0, disputed_amount: money(disputes.amt),
      collection_pct: billed.v > 0 ? Math.min(100, Math.round((paid.v / billed.v) * 1000) / 10) : null,
    },
    todo: todoOf(user, s),
    calendar: calendarOf(s),
    months, ageing: buckets, contracts,
    recent: { payments: recentPayments, invoices: recentInvoices.map((r) => ({ ...r, left_amt: money(r.left_amt) })), news },
    alerts,
    generated_at: new Date().toISOString(),
  };
}

const guard = (res, fn) => {
  try {
    return fn();
  } catch (err) {
    if (!err.status) console.error('[HOME]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
    return undefined;
  }
};

router.get('/', (req, res) => {
  const data = guard(res, () => build(req.user, String(req.query.period || 'FY').toUpperCase()));
  if (data) res.json(data);
});

// GET /summary.pdf — the same page as a two-minute read for someone who does not sign in.
router.get('/summary.pdf', (req, res) => {
  const d = guard(res, () => build(req.user, String(req.query.period || 'FY').toUpperCase()));
  if (!d) return;
  const seller = d.side === 'SELLER';
  const title = 'Account Summary';
  const ctx = { vertical: 'REIA', title, subtitle: `${d.me.entity_name}  ·  ${d.period.label}` };
  const doc = newDoc(res, `${title} — ${d.me.entity_name}`, `account-summary-${today()}.pdf`);
  header(doc, { ...ctx, generatedAt: nowLabel() });
  let y = 84;
  const k = d.kpis;
  y = kpiBand(doc, y, [
    { label: seller ? 'Billed to SJVN' : 'Billed by SJVN', value: rs(k.billed) },
    { label: seller ? 'Received' : 'Paid', value: rs(k.received), tone: GREEN },
    { label: 'Outstanding now', value: rs(k.outstanding), tone: k.outstanding > 0 ? AMBER : GREEN },
    { label: 'Overdue', value: rs(k.overdue), tone: k.overdue > 0 ? RED : GREEN },
  ]);
  y = notes(doc, y, [
    `${k.active_contracts} active contract${k.active_contracts === 1 ? '' : 's'}, ${k.capacity_mw} MW. ${k.billed_count} bill${k.billed_count === 1 ? '' : 's'} in ${d.period.label}${k.billed_change_pct != null ? ` (${k.billed_change_pct > 0 ? '+' : ''}${k.billed_change_pct}% against ${d.period.compare_label})` : ''}.`,
    k.avg_days_to_pay != null ? `Bills settled in the period were paid in ${k.avg_days_to_pay} days on average.` : 'No bill has been settled in full in the period.',
    `${k.open_disputes} open dispute${k.open_disputes === 1 ? '' : 's'}${k.open_disputes ? `, ${rs(k.disputed_amount)} in question` : ''}.`,
  ]);

  // Rows are plain arrays; each column reads its own position.
  const cols = (...defs) => defs.map(([label, w, align], i) => ({ label, w, align, value: (r) => r[i] }));

  y = sectionTitle(doc, y + 10, 'Waiting on you');
  if (!d.todo.length) y = notes(doc, y, ['Nothing is waiting on you.']);
  else y = table(doc, y, cols(['What', 220], ['Detail', CONTENT_W - 220]), d.todo.map((t) => [t.title, t.detail || '']), ctx);

  y = sectionTitle(doc, y + 10, 'Outstanding by age');
  y = table(doc, y, cols(['How long past due', 220], ['Bills', 100, 'right'], ['Amount', CONTENT_W - 320, 'right']),
    d.ageing.map((b) => [b.label, String(b.count), rs(b.amount)]), ctx);

  y = sectionTitle(doc, y + 10, 'By contract');
  y = table(doc, y, cols(['Contract', 170], ['MW', 45, 'right'], ['Billed', 100, 'right'], [seller ? 'Received' : 'Paid', 100, 'right'], ['Outstanding', CONTENT_W - 415, 'right']),
    d.contracts.map((c) => [c.contract_no, String(c.capacity_mw ?? ''), rs(c.billed), rs(c.received), rs(c.outstanding)]), ctx);

  y = sectionTitle(doc, y + 10, 'Coming up in the next 60 days');
  if (!d.calendar.length) notes(doc, y, ['Nothing falls due in the next 60 days.']);
  else table(doc, y, cols(['Date', 70], ['What', 300], ['Detail', CONTENT_W - 370]), d.calendar.slice(0, 20).map((e) => [e.date, e.title, e.detail || '']), ctx);

  pageNumbers(doc);
  doc.end();
});

export default router;
