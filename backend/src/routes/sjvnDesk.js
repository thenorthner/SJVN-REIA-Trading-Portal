/**
 * What is waiting on SJVN.
 *
 * A seller or buyer opens the portal to a list of what needs them. SJVN's own
 * desk opened to totals: how many contracts, how much billed. Yet nearly every
 * workflow a counterparty starts — a request, an extension, an intimation of
 * payment, a document, a dispute — ends up waiting on someone at SJVN, and that
 * person had to visit each screen to find out. This is the same list, from the
 * other side of the table, drawn from the same tables the working screens use.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { getParamNumber } from '../mastersService.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole(...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])));

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000);
const all = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch { return []; } };
const one = (sql, ...p) => { try { return db.prepare(sql).get(...p) || {}; } catch { return {}; } };
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const s = (n) => (n === 1 ? '' : 's');
const LEFT = `(COALESCE(i.total_amount, 0) - COALESCE(i.rebate, 0) + COALESCE(i.lps, 0) - COALESCE(i.disputed_amount, 0)
  - COALESCE((SELECT SUM(p.amount + COALESCE(p.deduction, 0)) FROM payments p WHERE p.invoice_id = i.id), 0))`;

function todo() {
  const out = [];
  const add = (item) => { if (item.count > 0) out.push(item); };

  // Money
  const pin = one(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) amt, MIN(created_at) first FROM payment_intimations WHERE status = 'SUBMITTED'`);
  add({ key: 'intimations', group: 'Payments', level: 'red', count: pin.n, title: `${pin.n} buyer payment${s(pin.n)} to confirm against the bank`, detail: `${inr(pin.amt)} reported as paid. The bills stay unpaid, and go on earning surcharge, until Finance confirms.`, link: '/reia/payment-monitoring' });

  const approve = one(`SELECT COUNT(*) n, COALESCE(SUM(total_amount), 0) amt FROM invoices WHERE direction = 'SELLER_TO_SJVN' AND status IN ('SUBMITTED','UNDER_APPROVAL')`);
  add({ key: 'invoice-approval', group: 'Billing', level: 'amber', count: approve.n, title: `${approve.n} seller invoice${s(approve.n)} waiting for approval`, detail: `${inr(approve.amt)} in all. The rebate window runs from the day a bill is presented.`, link: '/reia/invoices' });

  const payDue = one(`SELECT COUNT(*) n, COALESCE(SUM(${LEFT}), 0) amt, MIN(i.due_date) first FROM invoices i
    WHERE i.direction = 'SELLER_TO_SJVN' AND i.status IN ('APPROVED','SENT','PARTIALLY_PAID','DISPUTED') AND ${LEFT} > 0 AND i.due_date < date('now')`);
  add({ key: 'payables-overdue', group: 'Payments', level: 'red', count: payDue.n, title: `${payDue.n} seller bill${s(payDue.n)} SJVN has not paid by the due date`, detail: `${inr(payDue.amt)} overdue to sellers; late payment surcharge is accruing against SJVN.`, link: '/reia/payment-monitoring' });

  // Contracts
  const req = one(`SELECT COUNT(*) n FROM contract_requests WHERE status = 'PENDING'`);
  add({ key: 'requests', group: 'Contracts', level: 'amber', count: req.n, title: `${req.n} contract request${s(req.n)} to decide`, detail: 'Extensions, amendments and renewed guarantees counterparties have asked for.', link: '/reia/contracts' });
  const notices = one(`SELECT COUNT(*) n, MIN(response_due) first FROM contract_notices WHERE sent_by_side <> 'SJVN' AND acknowledged_at IS NULL`);
  add({ key: 'notices', group: 'Contracts', level: 'red', count: notices.n, title: `${notices.n} notice${s(notices.n)} from counterparties to acknowledge`, detail: notices.first ? `A response is due by ${notices.first}.` : 'Force majeure, default and other formal notices.', link: '/reia/contracts', due: notices.first });
  const confirm = one(`SELECT COUNT(*) n FROM contract_milestones WHERE reported_date IS NOT NULL AND achieved_date IS NULL`);
  add({ key: 'milestones', group: 'Contracts', level: 'amber', count: confirm.n, title: `${confirm.n} milestone${s(confirm.n)} reported as achieved, to confirm`, detail: 'Check the proof and confirm the date.', link: '/reia/contracts' });

  // Security
  const subs = one(`SELECT COUNT(*) n FROM payment_security WHERE status = 'DRAFT' AND submitted_by_side IS NOT NULL`);
  const amds = one(`SELECT COUNT(*) n FROM security_amendments WHERE status = 'PENDING'`);
  add({ key: 'security-accept', group: 'Security', level: 'amber', count: (subs.n || 0) + (amds.n || 0), title: `${(subs.n || 0) + (amds.n || 0)} guarantee submission${s((subs.n || 0) + (amds.n || 0))} to accept`, detail: `${subs.n || 0} new instrument${s(subs.n)} and ${amds.n || 0} extension${s(amds.n)} or amendment${s(amds.n)}. They count as security only once accepted.`, link: '/reia/payment-security' });
  const rel = one(`SELECT COUNT(*) n FROM security_releases WHERE status = 'PENDING'`);
  add({ key: 'security-release', group: 'Security', level: 'amber', count: rel.n, title: `${rel.n} release request${s(rel.n)} to decide`, detail: 'Check that nothing is owed and no dispute is open before releasing.', link: '/reia/payment-security' });
  const critical = getParamNumber('security_expiry_critical_days', 30);
  const lapsing = all(`SELECT ps.instrument_no, ps.validity_end FROM payment_security ps
    WHERE ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED') AND ps.validity_end IS NOT NULL AND julianday(ps.validity_end) - julianday('now') <= ?
      AND NOT EXISTS (SELECT 1 FROM security_amendments a WHERE a.payment_security_id = ps.id AND a.status = 'PENDING') ORDER BY ps.validity_end`, critical);
  add({ key: 'security-lapsing', group: 'Security', level: 'red', count: lapsing.length, title: `${lapsing.length} guarantee${s(lapsing.length)} within ${critical} days of expiry with no extension submitted`, detail: lapsing.length ? `${lapsing[0].instrument_no} expires on ${lapsing[0].validity_end}. Decide whether to invoke before it lapses.` : '', link: '/reia/payment-security', due: lapsing[0]?.validity_end });
  const lcs = all(`SELECT lc_no, validity_end FROM sjvn_lcs WHERE status = 'ACTIVE' AND validity_end IS NOT NULL AND julianday(validity_end) - julianday('now') <= ? ORDER BY validity_end`, getParamNumber('security_expiry_warn_days', 60));
  add({ key: 'own-lc', group: 'Security', level: 'amber', count: lcs.length, title: `${lcs.length} of SJVN's own LC${s(lcs.length)} to renew`, detail: lcs.length ? `${lcs[0].lc_no} in a seller's favour expires on ${lcs[0].validity_end}.` : '', link: '/reia/payment-security', due: lcs[0]?.validity_end });

  // Documents
  const docs = one(`SELECT COUNT(*) n FROM documents d JOIN document_versions v ON v.document_id = d.id
    WHERE d.status = 'ACTIVE' AND d.category = 'VERIFY' AND v.verification_status = 'PENDING'
      AND v.version_number = (SELECT MAX(version_number) FROM document_versions WHERE document_id = d.id)`);
  add({ key: 'documents', group: 'Documents', level: 'amber', count: docs.n, title: `${docs.n} document${s(docs.n)} to verify`, detail: 'KYC and contract documents uploaded by sellers and buyers.', link: '/reia/document-desk' });

  // Disputes
  const disp = all(`SELECT status, sla_resolve_due, resolution_response, escalation_outcome FROM disputes WHERE status <> 'CLOSED'`);
  const open = disp.filter((d) => ['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'ESCALATED'].includes(d.status));
  const late = open.filter((d) => d.sla_resolve_due && String(d.sla_resolve_due).slice(0, 10) < today());
  add({ key: 'disputes', group: 'Disputes', level: late.length ? 'red' : 'amber', count: open.length, title: late.length ? `${late.length} dispute${s(late.length)} past SJVN's time limit` : `${open.length} dispute${s(open.length)} to resolve`, detail: late.length ? `${open.length} open in all. The counterparty sees the overrun.` : 'Within the time limit so far.', link: '/reia/disputes' });
  const contested = disp.filter((d) => d.resolution_response === 'CONTESTED' && !d.escalation_outcome).length;
  add({ key: 'disputes-contested', group: 'Disputes', level: 'amber', count: contested, title: `${contested} resolution${s(contested)} not accepted and escalated`, detail: 'Record how each escalation ended.', link: '/reia/disputes' });

  // Energy and reconciliation
  const obj = one(`SELECT COUNT(*) n FROM energy_data WHERE response_status = 'OBJECTED' AND objection_outcome IS NULL`);
  add({ key: 'energy-objections', group: 'Energy', level: 'amber', count: obj.n, title: `${obj.n} objection${s(obj.n)} to energy data to answer`, detail: 'A counterparty does not accept the validated figure. Uphold it or correct the record before billing.', link: '/reia/energy-data' });
  const sign = one(`SELECT COUNT(*) n FROM reconciliations WHERE status = 'PENDING_SIGN_OFF' AND sjvn_ack_at IS NULL`);
  add({ key: 'recon-sign', group: 'Reconciliation', level: 'amber', count: sign.n, title: `${sign.n} reconciliation statement${s(sign.n)} awaiting SJVN's signature`, detail: 'The counterparty cannot close the period until both sides have signed.', link: '/reia/reconciliation' });
  const review = one(`SELECT COUNT(*) n FROM reconciliations WHERE status = 'NEEDS_REVIEW'`);
  add({ key: 'recon-review', group: 'Reconciliation', level: 'blue', count: review.n, title: `${review.n} reconciliation${s(review.n)} with exceptions to review`, detail: 'Lines that did not match automatically.', link: '/reia/reconciliation' });

  const rank = { red: 0, amber: 1, blue: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

function calendar(days = 30) {
  const until = addDays(today(), days);
  const out = [];
  for (const r of all(`SELECT i.invoice_no, i.due_date, ${LEFT} AS left_amt, e.name FROM invoices i JOIN contracts c ON c.id = i.contract_id LEFT JOIN entities e ON e.id = c.seller_id
    WHERE i.direction = 'SELLER_TO_SJVN' AND i.status IN ('APPROVED','SENT','PARTIALLY_PAID','DISPUTED') AND ${LEFT} > 0 AND i.due_date BETWEEN ? AND ?`, today(), until)) {
    out.push({ date: r.due_date, kind: 'PAYMENT', title: `Pay ${r.name || 'seller'} — ${r.invoice_no}`, detail: inr(r.left_amt), link: '/reia/payment-monitoring' });
  }
  for (const r of all(`SELECT i.invoice_no, i.due_date, ${LEFT} AS left_amt, e.name FROM invoices i JOIN contracts c ON c.id = i.contract_id LEFT JOIN entities e ON e.id = c.buyer_id
    WHERE i.direction = 'SJVN_TO_BUYER' AND i.status IN ('APPROVED','SENT','PARTIALLY_PAID','DISPUTED') AND ${LEFT} > 0 AND i.due_date BETWEEN ? AND ?`, today(), until)) {
    out.push({ date: r.due_date, kind: 'RECEIPT', title: `Due from ${r.name || 'buyer'} — ${r.invoice_no}`, detail: inr(r.left_amt), link: '/reia/payment-monitoring' });
  }
  for (const r of all(`SELECT ps.instrument_no, ps.bg_subtype, ps.mechanism_type, ps.validity_end, c.contract_no FROM payment_security ps JOIN contracts c ON c.id = ps.contract_id
    WHERE ps.status IN ('ACTIVE','PARTIALLY_UTILIZED','RENEWED') AND ps.validity_end BETWEEN ? AND ?`, today(), until)) {
    out.push({ date: r.validity_end, kind: 'SECURITY', title: `${r.bg_subtype || r.mechanism_type} ${r.instrument_no} expires`, detail: r.contract_no, link: '/reia/payment-security' });
  }
  for (const r of all(`SELECT lc_no, validity_end FROM sjvn_lcs WHERE status = 'ACTIVE' AND validity_end BETWEEN ? AND ?`, today(), until)) {
    out.push({ date: r.validity_end, kind: 'SECURITY', title: `SJVN's LC ${r.lc_no} expires`, detail: 'To be renewed by SJVN', link: '/reia/payment-security' });
  }
  for (const r of all(`SELECT m.label, m.due_date, c.contract_no FROM contract_milestones m JOIN contracts c ON c.id = m.contract_id
    WHERE m.achieved_date IS NULL AND m.due_date BETWEEN ? AND ?`, today(), until)) {
    out.push({ date: r.due_date, kind: 'MILESTONE', title: r.label, detail: r.contract_no, link: '/reia/contracts' });
  }
  for (const r of all(`SELECT n.subject, n.response_due, c.contract_no FROM contract_notices n JOIN contracts c ON c.id = n.contract_id
    WHERE n.sent_by_side <> 'SJVN' AND n.acknowledged_at IS NULL AND n.response_due BETWEEN ? AND ?`, today(), until)) {
    out.push({ date: r.response_due, kind: 'NOTICE', title: `SJVN's response due — ${r.subject}`, detail: r.contract_no, link: '/reia/contracts' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ ...e, days: daysUntil(e.date) }));
}

router.get('/', (req, res) => {
  try {
    const items = todo();
    res.json({ todo: items, calendar: calendar(), counts: { red: items.filter((i) => i.level === 'red').length, total: items.length }, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('[SJVN-DESK]', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

export default router;
