/**
 * /api/hydro-desk — the hydro desk's disputes, payment security, balance
 * confirmation and TDS, all working off the beneficiary ledger.
 */
import crypto from 'crypto';
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { secureLogAudit } from '../auditEngine.js';
import { pushNotification } from '../util.js';
import { stationScope, verticalOfContract } from '../services/stationScope.js';
import {
  DISPUTE_REASONS, listDisputes, getDispute, disputableShares, raiseDispute, moveDispute,
  listInstruments, securityPosition, addInstrument, amendInstrument, invokeInstrument, releaseInstrument, instrumentEvents,
  listReconciliations, getReconciliation, createReconciliation, moveReconciliation,
  TDS_SECTIONS, listTds, recordTds, updateTdsCertificate,
} from '../services/hydroDesk.js';
import {
  newDoc, header, sectionTitle, table, notes, pageNumbers, M, CONTENT_W, INK,
} from '../scripts/reportPdfKit.js';

const router = Router();
router.use(requireAuth);

// Shared by the hydro and thermal desks, each on its own stations.
const READ = [...new Set([...ROLE_GROUPS.HYDRO_THERMAL_ALL, ...ROLE_GROUPS.THERMAL_ALL, 'COMPLIANCE_AUDITOR'])];
const WRITE = [...new Set([...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE])];
stationScope(router);

/** Run a handler and turn a thrown { status, message } into the response. */
const handle = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
};
const audit = (req, action, entityType, entityId, extra = {}) => {
  try { secureLogAudit(req, { action, module: 'REIA', entityType, entityId, ...extra }); } catch { /* audit must not fail the action */ }
};
const need = (q, k) => {
  if (!q[k]) throw Object.assign(new Error(`${k} is required`), { status: 400 });
  return q[k];
};

// ── Disputes ────────────────────────────────────────────────────────────────
router.get('/disputes/reasons', requireRole(...READ), handle(() =>
  Object.entries(DISPUTE_REASONS).map(([value, label]) => ({ value, label }))));
router.get('/disputes/shares', requireRole(...READ), handle((req) =>
  disputableShares(need(req.query, 'contract_id'), need(req.query, 'beneficiary'))));
router.get('/disputes', requireRole(...READ), handle((req) =>
  listDisputes({ contractId: req.query.contract_id, status: req.query.status, beneficiaryName: req.query.beneficiary })));
router.get('/disputes/:id', requireRole(...READ), handle((req) => getDispute(req.params.id)));
router.post('/disputes', requireRole(...WRITE), handle((req) => {
  const d = raiseDispute(req.body || {}, req.user);
  audit(req, 'HYDRO_DISPUTE_RAISED', 'hydro_disputes', d.id, { afterValue: { dispute_no: d.dispute_no, amount: d.disputed_amount } });
  pushNotification({ role: verticalOfContract(d.contract_id) === 'THERMAL' ? 'THERMAL_ADMIN' : 'COMMERCIAL_ADMIN', type: 'HYDRO_DISPUTE', message: `Dispute ${d.dispute_no}: ${d.beneficiary_name} disputes ₹${d.disputed_amount.toLocaleString('en-IN')} on ${d.bill_no}.` });
  return d;
}));
router.post('/disputes/:id/move', requireRole(...WRITE), handle((req) => {
  const d = moveDispute(req.params.id, req.body || {}, req.user);
  audit(req, `HYDRO_DISPUTE_${d.status}`, 'hydro_disputes', d.id, { reason: req.body?.remarks });
  return d;
}));

router.get('/disputes/:id/comments', requireRole(...READ), handle((req) => {
  return db.prepare('SELECT * FROM hydro_dispute_comments WHERE dispute_id = ? ORDER BY created_at ASC').all(req.params.id);
}));
router.post('/disputes/:id/comments', requireRole(...WRITE), handle((req) => {
  const { body: text, is_internal } = req.body || {};
  if (!text?.trim()) throw Object.assign(new Error('Comment body is required'), { status: 400 });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO hydro_dispute_comments (id, dispute_id, body, is_internal, author_id, author_name) VALUES (?,?,?,?,?,?)').run(
    id, req.params.id, text.trim(), is_internal ? 1 : 0, req.user.id, req.user.name || req.user.email,
  );
  audit(req, 'HYDRO_DISPUTE_COMMENT', 'hydro_disputes', req.params.id, { reason: text.trim().slice(0, 120) });
  return db.prepare('SELECT * FROM hydro_dispute_comments WHERE id = ?').get(id);
}));

router.get('/disputes/stats', requireRole(...READ), handle((req) => {
  const contractId = req.query.contract_id;
  const where = contractId ? 'WHERE contract_id = ?' : '';
  const params = contractId ? [contractId] : [];
  const all = db.prepare(`SELECT * FROM hydro_disputes ${where}`).all(...params);
  const open = all.filter((d) => !['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED', 'CLOSED'].includes(d.status));
  const today = new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.max(0, Math.floor((new Date(b) - new Date(a)) / 86400000));
  const openDays = open.map((d) => daysBetween(d.created_at.slice(0, 10), today));
  return {
    total: all.length,
    open: open.length,
    exposure: open.reduce((s, d) => s + d.disputed_amount, 0),
    sla_breached: open.filter((d) => d.resolve_due < today).length,
    resolved: all.filter((d) => d.status === 'RESOLVED_ACCEPTED' || d.status === 'RESOLVED_REJECTED').length,
    aging: {
      '0_7': openDays.filter((d) => d <= 7).length,
      '8_15': openDays.filter((d) => d > 7 && d <= 15).length,
      '16_30': openDays.filter((d) => d > 15 && d <= 30).length,
      '30_plus': openDays.filter((d) => d > 30).length,
    },
    by_reason: Object.entries(open.reduce((m, d) => { m[d.reason_code] = (m[d.reason_code] || 0) + 1; return m; }, {})).map(([code, count]) => ({ code, count })),
  };
}));

// ── Payment security ────────────────────────────────────────────────────────
router.get('/security', requireRole(...READ), handle((req) => {
  const contractId = need(req.query, 'contract_id');
  return { ...securityPosition(contractId), instruments: listInstruments(contractId) };
}));
router.get('/security/:id/events', requireRole(...READ), handle((req) => instrumentEvents(req.params.id)));
router.post('/security', requireRole(...WRITE), handle((req) => {
  const i = addInstrument(req.body || {}, req.user);
  audit(req, 'HYDRO_SECURITY_RECORDED', 'hydro_security_instruments', i.id, { afterValue: i });
  return i;
}));
router.post('/security/:id/amend', requireRole(...WRITE), handle((req) => {
  const i = amendInstrument(req.params.id, req.body || {}, req.user);
  audit(req, 'HYDRO_SECURITY_AMENDED', 'hydro_security_instruments', i.id, { afterValue: { amount: i.amount, valid_to: i.valid_to } });
  return i;
}));
router.post('/security/:id/invoke', requireRole(...WRITE), handle((req) => {
  const out = invokeInstrument(req.params.id, req.body || {}, req.user);
  audit(req, 'HYDRO_SECURITY_INVOKED', 'hydro_security_instruments', req.params.id, { reason: req.body?.remarks, afterValue: { amount: req.body?.amount, ledger_doc: out.ledger_doc.doc_no } });
  return out;
}));
router.post('/security/:id/release', requireRole(...WRITE), handle((req) => {
  const i = releaseInstrument(req.params.id, req.body || {}, req.user);
  audit(req, 'HYDRO_SECURITY_RELEASED', 'hydro_security_instruments', i.id, { reason: req.body?.remarks });
  return i;
}));

// ── Reconciliation ──────────────────────────────────────────────────────────
router.get('/reconciliations', requireRole(...READ), handle((req) => listReconciliations(need(req.query, 'contract_id'))));
router.get('/reconciliations/:id', requireRole(...READ), handle((req) => getReconciliation(req.params.id)));
router.post('/reconciliations', requireRole(...WRITE), handle((req) => {
  const r = createReconciliation(req.body || {}, req.user);
  audit(req, 'HYDRO_RECON_CREATED', 'hydro_reconciliations', r.id, { afterValue: { statement_no: r.statement_no, closing: r.closing_balance } });
  return r;
}));
router.post('/reconciliations/:id/move', requireRole(...WRITE), handle((req) => {
  const r = moveReconciliation(req.params.id, req.body || {}, req.user);
  audit(req, `HYDRO_RECON_${r.status}`, 'hydro_reconciliations', r.id, { reason: req.body?.remarks });
  return r;
}));

const inr = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The statement sent to the beneficiary for confirmation.
router.get('/reconciliations/:id/pdf', requireRole(...READ), (req, res) => {
  try {
    const r = getReconciliation(req.params.id);
    const station = db.prepare(`SELECT COALESCE(e.name, c.contract_no) AS name FROM contracts c LEFT JOIN entities e ON e.id = c.seller_id WHERE c.id = ?`).get(r.contract_id)?.name;
    const doc = newDoc(res, `Balance confirmation ${r.statement_no}`, `${r.statement_no.replace(/[^\w.-]+/g, '_')}.pdf`);
    const ctx = {
      vertical: 'Commercial & System Operation Department',
      title: `Statement of account & balance confirmation — ${r.beneficiary_name}`,
      subtitle: `${r.statement_no}  ·  ${station}  ·  ${r.period_from} to ${r.period_to}`,
      generatedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    };
    header(doc, ctx);
    let y = 84;
    y = sectionTitle(doc, y, 'Summary');
    const m = r.summary.movements || {};
    y = table(doc, y, [
      { label: 'Particulars', w: CONTENT_W - 160, value: (x) => x.k },
      { label: 'Amount (Rs)', w: 160, align: 'right', value: (x) => inr(x.v) },
    ], [
      { k: `Opening balance as on ${r.period_from}`, v: r.opening_balance },
      { k: 'Add: bills raised', v: m.billed },
      { k: 'Add: debit notes', v: m.debit_notes },
      { k: 'Add: late payment surcharge', v: m.surcharge },
      { k: 'Less: payments received', v: m.received },
      { k: 'Less: early-payment rebate allowed', v: m.rebate },
      { k: 'Less: credit notes', v: m.credit_notes },
      { k: 'Less: TDS deducted by you', v: m.tds },
      { k: `Closing balance as on ${r.period_to} (payable by you)`, v: r.closing_balance },
    ], ctx, { fontSize: 7.5 });
    y += 10;
    y = sectionTitle(doc, y, 'Movements in the period');
    y = table(doc, y, [
      { label: 'Date', w: 60, value: (x) => x.doc_date },
      { label: 'Document', w: 110, value: (x) => x.doc_no },
      { label: 'Particulars', w: CONTENT_W - 410, value: (x) => x.info || x.kind },
      { label: 'Debit', w: 80, align: 'right', value: (x) => (x.debit ? inr(x.debit) : '') },
      { label: 'Credit', w: 80, align: 'right', value: (x) => (x.credit ? inr(x.credit) : '') },
      { label: 'Balance', w: 80, align: 'right', value: (x) => inr(x.balance) },
    ], r.summary.lines || [], ctx, { fontSize: 6.8, emptyMessage: 'No movement in the period.' });
    y += 10;
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(
      'Please confirm the closing balance above within 15 days of receipt. If your books show a different figure, '
      + 'send the reconciliation of the difference with this statement number. If no reply is received, the balance '
      + 'will be treated as confirmed.', M, y, { width: CONTENT_W },
    );
    notes(doc, doc.y + 8, ['Statement generated electronically from the beneficiary ledger; physical signature not required.']);
    pageNumbers(doc);
    doc.end();
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 400).json({ error: err.message });
  }
});

// ── TDS ─────────────────────────────────────────────────────────────────────
router.get('/tds/sections', requireRole(...READ), handle(() => TDS_SECTIONS));
router.get('/tds', requireRole(...READ), handle((req) =>
  listTds({ contractId: need(req.query, 'contract_id'), financialYear: req.query.financial_year, status: req.query.status })));
router.post('/tds', requireRole(...WRITE), handle((req) => {
  const out = recordTds(req.body || {}, req.user);
  audit(req, 'HYDRO_TDS_RECORDED', 'hydro_tds_entries', out.entry.id, { afterValue: { amount: out.entry.tds_amount, ledger_doc: out.ledger_doc.doc_no } });
  return out;
}));
router.post('/tds/:id/certificate', requireRole(...WRITE), handle((req) => {
  const t = updateTdsCertificate(req.params.id, req.body || {});
  audit(req, 'HYDRO_TDS_CERTIFICATE', 'hydro_tds_entries', t.id, { afterValue: { status: t.status, certificate_no: t.certificate_no, amount_26as: t.amount_26as } });
  return t;
}));

export default router;
