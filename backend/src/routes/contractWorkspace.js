/**
 * What goes on around a contract once it is signed.
 *
 * The contract record itself — tariff, tenure, billing rules — is in
 * routes/contracts.js and changes only through an amendment. This is the
 * working side of it:
 *
 *   milestones  financial closure, SCOD, COD: what was due when, and whether it
 *               was met. The counterparty reports one achieved; SJVN confirms.
 *   requests    the counterparty asking SJVN for something — more time on a
 *               milestone, an amendment, a renewed performance guarantee to be
 *               taken on record. SJVN approves or refuses, with its reasons.
 *   notices     formal notices under the contract, either way: force majeure,
 *               default, cure, termination. A notice cannot be edited once
 *               sent; the other side acknowledges it and may reply.
 *
 * A PSA is SJVN selling on to a buyer: there is no plant behind it, so none of
 * the generator's side applies — no project milestones, no performance
 * guarantee, no extension of either. Its payment security (the buyer's LC or
 * corpus) is kept in the Payment Security module.
 *
 * A counterparty sees and acts on its own contracts only. Each request and
 * notice belongs to one side of the contract, so where a contract has both a
 * seller and a buyer, neither reads the other's correspondence with SJVN.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, pushNotification } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { contractVisibleTo, changedTermsForCounterparty } from '../services/counterpartyScope.js';
import { takeAmendmentOnRecord } from './securityDesk.js';

const router = Router();
router.use(requireAuth);

const INTERNAL_READ = [...new Set([...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'])];
const canManage = (user) => ROLE_GROUPS.REIA_WRITE.includes(user?.role);
// Phase B.2: the maker sets milestones and writes notices; the checker accepts
// a reported milestone, decides a counterparty's request and acknowledges a notice.
const canMake = (user) => ROLE_GROUPS.REIA_MAKE.includes(user?.role);
const canCheck = (user) => ROLE_GROUPS.REIA_CHECK.includes(user?.role);
/** Which side of the table the caller sits on: SJVN, SELLER or BUYER — or null for nobody. */
const sideOf = (user) => counterpartySide(user) || (INTERNAL_READ.includes(user?.role) ? 'SJVN' : null);

const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try {
    res.json(fn());
  } catch (err) {
    if (!err.status) console.error('[CONTRACT]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (iso) => Math.round((new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) - new Date(`${today()}T00:00:00Z`)) / 86400000);
const WARNING_DAYS = 30;
const text = (v, max) => String(v ?? '').trim().slice(0, max);

export const MILESTONE_TYPES = {
  FINANCIAL_CLOSURE: 'Financial Closure',
  LAND_POSSESSION: 'Land Possession',
  CONNECTIVITY: 'Grid Connectivity / LTA',
  SCOD: 'Scheduled Commercial Operation Date (SCOD)',
  COD: 'Commercial Operation Date (COD)',
  OTHER: 'Other',
};
export const REQUEST_TYPES = {
  MILESTONE_EXTENSION: 'Extension of a milestone date',
  AMENDMENT: 'Amendment to the contract',
  PBG_RENEWAL: 'Renewed performance guarantee',
  OTHER: 'Other request',
};
export const REQUEST_GROUNDS = {
  FORCE_MAJEURE: 'Force majeure',
  GRID_DELAY: 'Delay in grid connectivity / evacuation',
  LAND_DELAY: 'Delay in land or clearances',
  CHANGE_IN_LAW: 'Change in law',
  COMMERCIAL: 'Commercial',
  OTHER: 'Other',
};
export const NOTICE_TYPES = {
  FORCE_MAJEURE: 'Force Majeure',
  DEFAULT: 'Event of Default',
  CURE: 'Cure / Rectification',
  CHANGE_IN_LAW: 'Change in Law',
  TERMINATION: 'Termination',
  GENERAL: 'General',
};

// The parts of a contract that only exist where there is a generating project behind it.
const GENERATOR_REQUESTS = ['MILESTONE_EXTENSION', 'PBG_RENEWAL'];
const GENERATOR_GROUNDS = ['GRID_DELAY', 'LAND_DELAY'];
const hasProject = (contract) => contract.contract_type !== 'PSA';

/** The requests this side may raise on this contract. */
function requestTypesFor(contract, side) {
  return Object.keys(REQUEST_TYPES).filter((k) => (hasProject(contract) || !GENERATOR_REQUESTS.includes(k))
    && (k !== 'PBG_RENEWAL' || side === 'SELLER'));
}
const requestGroundsFor = (contract) => Object.keys(REQUEST_GROUNDS).filter((k) => hasProject(contract) || !GENERATOR_GROUNDS.includes(k));

// ── Access ──────────────────────────────────────────────────────────────────

/** The contract, if the caller may see it; otherwise a 404, as for one that does not exist. */
function contractFor(user, id) {
  const side = sideOf(user);
  const c = side && db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
  if (!c || !contractVisibleTo(user, c)) throw fail(404, 'Contract not found');
  return { contract: c, side };
}

const audit = (req, action, entityType, entityId, extra = {}) => {
  try {
    secureLogAudit(req, { action, module: 'CONTRACTS', entityType, entityId, ...extra });
  } catch (err) {
    console.error('[CONTRACT] audit failed', err.message);
  }
};

/** Tell the other side's people. SJVN is told through the REIA desk's roles. */
function notify(contract, toSide, message) {
  try {
    if (toSide === 'SJVN') {
      for (const role of ROLE_GROUPS.REIA_WRITE) pushNotification({ role, type: 'CONTRACT', message });
      return;
    }
    const entityId = toSide === 'SELLER' ? contract.seller_id : contract.buyer_id;
    if (!entityId) return;
    for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(entityId)) {
      pushNotification({ userId: u.id, type: 'CONTRACT', message });
    }
  } catch { /* what was done stands; the bell is a courtesy */ }
}

/** The side of the contract SJVN is dealing with when it does not say: the only one there is. */
function counterpartyOf(contract, asked) {
  const sides = [contract.seller_id && 'SELLER', contract.buyer_id && 'BUYER'].filter(Boolean);
  const given = String(asked || '').toUpperCase();
  if (sides.includes(given)) return given;
  if (sides.length === 1) return sides[0];
  throw fail(400, sides.length ? 'Say whether this is for the seller or the buyer' : 'This contract has no counterparty on it');
}

/** A file already uploaded against this contract, to hang on a request or a notice. */
function attachmentOf(contract, versionId) {
  if (!versionId) return null;
  const v = db.prepare(`
    SELECT v.id FROM document_versions v JOIN documents d ON d.id = v.document_id
    WHERE v.id = ? AND d.contract_id = ?
  `).get(String(versionId), contract.id);
  if (!v) throw fail(400, 'The attached file is not one of this contract\'s documents');
  return v.id;
}

// ── Milestones ──────────────────────────────────────────────────────────────

/** Where a milestone stands, worked out from its dates. */
function milestoneView(m) {
  const due = m.due_date;
  let status = 'PENDING';
  if (m.achieved_date) status = 'ACHIEVED';
  else if (m.reported_date) status = 'REPORTED';
  else if (due && daysUntil(due) < 0) status = 'DELAYED';
  const days = due && !m.achieved_date ? daysUntil(due) : null;
  return {
    ...m,
    status,
    days_to_due: days,
    due_soon: status === 'PENDING' && days !== null && days <= WARNING_DAYS,
    // How late it was — or still is.
    delay_days: m.achieved_date && due ? Math.max(0, Math.round((new Date(m.achieved_date) - new Date(due)) / 86400000))
      : status === 'DELAYED' || (status === 'REPORTED' && days < 0) ? -days : 0,
    extended: !!m.original_due_date && m.original_due_date !== m.due_date,
  };
}

const milestonesOf = (contractId) => db.prepare(`
  SELECT * FROM contract_milestones WHERE contract_id = ?
  ORDER BY COALESCE(due_date, '9999'), sort_order, created_at
`).all(contractId).map(milestoneView);

function milestoneFor(user, id) {
  const m = db.prepare('SELECT * FROM contract_milestones WHERE id = ?').get(id);
  if (!m) throw fail(404, 'Milestone not found');
  return { milestone: m, ...contractFor(user, m.contract_id) };
}

function addMilestone(contract, { milestone_type, label, due_date, achieved_date = null, sort_order = 50 }, user) {
  if (!hasProject(contract)) throw fail(400, 'A PSA has no generating project behind it, so it has no project milestones');
  if (!MILESTONE_TYPES[milestone_type]) throw fail(400, `milestone_type must be one of ${Object.keys(MILESTONE_TYPES).join(', ')}`);
  if (due_date && !DAY.test(due_date)) throw fail(400, 'due_date must be YYYY-MM-DD');
  const name = text(label, 120) || MILESTONE_TYPES[milestone_type];
  if (milestone_type !== 'OTHER' && db.prepare('SELECT 1 FROM contract_milestones WHERE contract_id = ? AND milestone_type = ?').get(contract.id, milestone_type)) {
    throw fail(400, `${MILESTONE_TYPES[milestone_type]} is already on this contract`);
  }
  const id = newId('CMS');
  db.prepare(`
    INSERT INTO contract_milestones (id, contract_id, milestone_type, label, due_date, original_due_date, achieved_date, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, contract.id, milestone_type, name, due_date || null, due_date || null, achieved_date, sort_order, user.id);
  return id;
}

// ── Requests ────────────────────────────────────────────────────────────────

const requestsOf = (contractId, side) => db.prepare(`
  SELECT r.*, u.name AS raised_by_name, du.name AS decided_by_name, m.label AS milestone_label, m.due_date AS milestone_due_date,
         v.file_name AS attachment_name
  FROM contract_requests r
  LEFT JOIN users u ON u.id = r.raised_by
  LEFT JOIN users du ON du.id = r.decided_by
  LEFT JOIN contract_milestones m ON m.id = r.milestone_id
  LEFT JOIN document_versions v ON v.id = r.attachment_version_id
  WHERE r.contract_id = ? ${side === 'SJVN' ? '' : 'AND r.raised_by_side = ?'}
  ORDER BY (r.status = 'PENDING') DESC, r.created_at DESC
`).all(...(side === 'SJVN' ? [contractId] : [contractId, side]));

function requestFor(user, id) {
  const r = db.prepare('SELECT * FROM contract_requests WHERE id = ?').get(id);
  if (!r) throw fail(404, 'Request not found');
  const ctx = contractFor(user, r.contract_id);
  if (ctx.side !== 'SJVN' && ctx.side !== r.raised_by_side) throw fail(404, 'Request not found');
  return { request: r, ...ctx };
}

// ── Notices ─────────────────────────────────────────────────────────────────

const noticesOf = (contractId, side) => db.prepare(`
  SELECT n.*, u.name AS sent_by_name, au.name AS acknowledged_by_name, v.file_name AS attachment_name
  FROM contract_notices n
  LEFT JOIN users u ON u.id = n.sent_by
  LEFT JOIN users au ON au.id = n.acknowledged_by
  LEFT JOIN document_versions v ON v.id = n.attachment_version_id
  WHERE n.contract_id = ? ${side === 'SJVN' ? '' : 'AND n.counterparty_side = ?'}
  ORDER BY n.created_at DESC, n.rowid DESC
`).all(...(side === 'SJVN' ? [contractId] : [contractId, side])).map((n) => ({
  ...n,
  // A notice waits on the side it was sent to.
  awaiting: n.acknowledged_at ? null : (n.sent_by_side === 'SJVN' ? n.counterparty_side : 'SJVN'),
  response_overdue: !n.acknowledged_at && !!n.response_due && n.response_due < today(),
}));

// ── The performance guarantee ───────────────────────────────────────────────

function guaranteeOf(contract) {
  // A PSA's payment security is the buyer's LC or corpus, kept in the Payment Security module.
  if (!hasProject(contract)) return null;
  let instruments = [];
  try {
    instruments = db.prepare(`
      SELECT id, instrument_no, mechanism_type, bg_subtype, limit_amount, issuing_bank, validity_start, validity_end, status
      FROM payment_security
      WHERE contract_id IN (SELECT id FROM contracts WHERE id = ? OR parent_contract_id = ?)
        AND mechanism_type = 'BANK_GUARANTEE' AND status NOT IN ('CLOSED','RELEASED')
      ORDER BY validity_end
    `).all(contract.parent_contract_id || contract.id, contract.parent_contract_id || contract.id);
  } catch { /* no payment security on this database */ }
  const expiry = contract.pbg_expiry && DAY.test(String(contract.pbg_expiry).slice(0, 10)) ? String(contract.pbg_expiry).slice(0, 10) : null;
  const days = expiry ? daysUntil(expiry) : null;
  return {
    amount: contract.pbg_amount,
    type: contract.pbg_type,
    expiry,
    days_to_expiry: days,
    state: days === null ? null : days < 0 ? 'EXPIRED' : days <= WARNING_DAYS ? 'EXPIRING' : 'VALID',
    instruments: instruments.map((i) => ({ ...i, days_to_expiry: i.validity_end ? daysUntil(i.validity_end) : null })),
  };
}

/** What the contract has billed and what is still owed on it. */
function billingOf(contract) {
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS invoices, COALESCE(SUM(i.total_amount), 0) AS billed,
             COALESCE(SUM((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id)), 0) AS paid,
             SUM(CASE WHEN i.status IN ('SENT','APPROVED','PARTIALLY_PAID','DISPUTED') AND i.due_date IS NOT NULL AND date(i.due_date) < date('now') THEN 1 ELSE 0 END) AS overdue
      FROM invoices i WHERE i.contract_id = ? AND i.status NOT IN ('DRAFT','CANCELLED','REJECTED')
    `).get(contract.id);
    const disputes = db.prepare(`
      SELECT COUNT(*) AS n FROM disputes
      WHERE invoice_id IN (SELECT id FROM invoices WHERE contract_id = ?)
        AND status NOT IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED','CLOSED')
    `).get(contract.id).n;
    return { invoices: r.invoices, billed: r.billed, paid: r.paid, outstanding: Math.max(0, r.billed - r.paid), overdue: r.overdue || 0, open_disputes: disputes };
  } catch {
    return null;
  }
}

/** What needs someone's attention on a contract, counted for the side asking. */
function attentionOf(contract, side) {
  const milestones = milestonesOf(contract.id);
  const requests = requestsOf(contract.id, side);
  const notices = noticesOf(contract.id, side);
  // The performance guarantee is between the seller and SJVN; the buyer is not shown it.
  const pbg = (side !== 'BUYER' && guaranteeOf(contract)) || { state: null, days_to_expiry: null, expiry: null };
  const next = milestones.find((m) => m.status === 'PENDING' || m.status === 'DELAYED');
  return {
    contract_id: contract.id,
    milestones_delayed: milestones.filter((m) => m.status === 'DELAYED').length,
    milestones_due_soon: milestones.filter((m) => m.due_soon).length,
    milestones_to_confirm: milestones.filter((m) => m.status === 'REPORTED').length,
    next_milestone: next ? { label: next.label, due_date: next.due_date, days_to_due: next.days_to_due, status: next.status } : null,
    requests_pending: requests.filter((r) => r.status === 'PENDING').length,
    notices_awaiting_me: notices.filter((n) => n.awaiting === side).length,
    pbg_state: pbg.state,
    pbg_days_to_expiry: pbg.days_to_expiry,
    pbg_expiry: pbg.expiry,
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

// GET /meta — the fixed lists the forms offer.
router.get('/meta', (_req, res) => {
  res.json({ milestone_types: MILESTONE_TYPES, request_types: REQUEST_TYPES, request_grounds: REQUEST_GROUNDS, notice_types: NOTICE_TYPES, warning_days: WARNING_DAYS });
});

// GET /summary — for every contract the caller can see: what needs attention.
router.get('/summary', (req, res) => send(res, () => {
  const side = sideOf(req.user);
  if (!side) throw fail(403, 'Access denied');
  let sql = 'SELECT * FROM contracts';
  const params = [];
  if (side !== 'SJVN') {
    if (!req.user.linked_entity_id) return [];
    sql += ` WHERE ${side === 'SELLER' ? 'seller_id' : 'buyer_id'} = ?`;
    params.push(req.user.linked_entity_id);
  }
  return db.prepare(sql).all(...params).filter((c) => contractVisibleTo(req.user, c))
    .map((c) => ({ contract_no: c.contract_no, ...attentionOf(c, side) }));
}));

// GET /pending — SJVN's desk: everything across contracts that is waiting on SJVN.
router.get('/pending', (req, res) => send(res, () => {
  if (sideOf(req.user) !== 'SJVN') throw fail(403, 'Access denied');
  const withContract = `c.id AS contract_id, c.contract_no, COALESCE(es.name, eb.name) AS counterparty`;
  const joins = `JOIN contracts c ON c.id = x.contract_id LEFT JOIN entities es ON es.id = c.seller_id LEFT JOIN entities eb ON eb.id = c.buyer_id`;
  return {
    requests: db.prepare(`SELECT x.id, x.request_type, x.subject, x.created_at, ${withContract} FROM contract_requests x ${joins} WHERE x.status = 'PENDING' ORDER BY x.created_at`).all(),
    notices: db.prepare(`SELECT x.id, x.notice_no, x.notice_type, x.subject, x.response_due, x.created_at, ${withContract} FROM contract_notices x ${joins} WHERE x.sent_by_side <> 'SJVN' AND x.acknowledged_at IS NULL ORDER BY x.created_at`).all(),
    milestones_to_confirm: db.prepare(`SELECT x.id, x.label, x.reported_date, ${withContract} FROM contract_milestones x ${joins} WHERE x.reported_date IS NOT NULL AND x.achieved_date IS NULL ORDER BY x.reported_at`).all(),
    milestones_delayed: db.prepare(`SELECT x.id, x.label, x.due_date, ${withContract} FROM contract_milestones x ${joins} WHERE x.achieved_date IS NULL AND x.reported_date IS NULL AND x.due_date IS NOT NULL AND date(x.due_date) < date('now') ORDER BY x.due_date`).all()
      .map((m) => ({ ...m, delay_days: -daysUntil(m.due_date) })),
  };
}));

// GET /:contractId — the whole working file of one contract.
router.get('/:contractId', (req, res) => send(res, () => {
  const { contract, side } = contractFor(req.user, req.params.contractId);
  const amendments = db.prepare('SELECT id, version, changed_fields_json, approved_by, created_at FROM contract_amendments WHERE contract_id = ? OR new_contract_id = ? ORDER BY version DESC').all(contract.id, contract.id)
    .map((a) => { let changed = {}; try { changed = JSON.parse(a.changed_fields_json); } catch { /* shown as empty */ } return { ...a, changed: changedTermsForCounterparty(req.user, changed), changed_fields_json: undefined }; });
  return {
    contract: { id: contract.id, contract_no: contract.contract_no, contract_type: contract.contract_type, status: contract.status, cod_date: contract.cod_date, tenure_end: contract.tenure_end, has_seller: !!contract.seller_id, has_buyer: !!contract.buyer_id },
    side,
    can_manage: canManage(req.user),
    can_make: canMake(req.user),
    can_check: canCheck(req.user),
    // What this contract has room for, so the screen offers only that.
    has_project: hasProject(contract),
    request_types: side === 'SJVN' ? [] : requestTypesFor(contract, side),
    request_grounds: requestGroundsFor(contract),
    milestones: milestonesOf(contract.id),
    guarantee: side === 'BUYER' ? null : guaranteeOf(contract),
    requests: requestsOf(contract.id, side),
    notices: noticesOf(contract.id, side),
    billing: billingOf(contract),
    amendments,
    attention: attentionOf(contract, side),
  };
}));

// POST /:contractId/milestones/standard — the usual three, for SJVN to put dates on.
router.post('/:contractId/milestones/standard', (req, res) => send(res, () => {
  if (!canMake(req.user)) throw fail(403, 'Setting milestones is the REIA maker\'s');
  const { contract } = contractFor(req.user, req.params.contractId);
  const have = new Set(milestonesOf(contract.id).map((m) => m.milestone_type));
  const cod = contract.cod_date && DAY.test(contract.cod_date) ? contract.cod_date : null;
  db.transaction(() => {
    [['FINANCIAL_CLOSURE', 10, null], ['SCOD', 20, null], ['COD', 30, cod]].forEach(([type, order, achieved]) => {
      if (!have.has(type)) addMilestone(contract, { milestone_type: type, sort_order: order, achieved_date: achieved }, req.user);
    });
  })();
  audit(req, 'MILESTONES_ADDED', 'contracts', contract.id);
  return milestonesOf(contract.id);
}));

// POST /:contractId/milestones { milestone_type, label, due_date }
router.post('/:contractId/milestones', (req, res) => send(res, () => {
  if (!canMake(req.user)) throw fail(403, 'Setting milestones is the REIA maker\'s');
  const { contract } = contractFor(req.user, req.params.contractId);
  const id = addMilestone(contract, req.body, req.user);
  audit(req, 'MILESTONE_ADDED', 'contract_milestones', id, { afterValue: { contract_id: contract.id, milestone_type: req.body.milestone_type, due_date: req.body.due_date || null } });
  return milestonesOf(contract.id);
}));

// PATCH /milestones/:id { due_date, achieved_date, remarks } — SJVN setting the dates.
router.patch('/milestones/:id', (req, res) => send(res, () => {
  if (!canMake(req.user)) throw fail(403, 'Changing a milestone is the REIA maker\'s');
  const { milestone: m, contract } = milestoneFor(req.user, req.params.id);
  const next = { due_date: m.due_date, achieved_date: m.achieved_date, remarks: m.remarks };
  for (const k of ['due_date', 'achieved_date']) {
    if (req.body[k] === undefined) continue;
    if (req.body[k] && !DAY.test(req.body[k])) throw fail(400, `${k} must be YYYY-MM-DD`);
    next[k] = req.body[k] || null;
  }
  if (next.achieved_date && next.achieved_date > today()) throw fail(400, 'A milestone cannot be achieved on a date still to come');
  if (req.body.remarks !== undefined) next.remarks = text(req.body.remarks, 1000) || null;
  db.prepare(`
    UPDATE contract_milestones
    SET due_date = ?, original_due_date = COALESCE(original_due_date, ?), achieved_date = ?, remarks = ?,
        confirmed_by = CASE WHEN ? IS NOT NULL THEN ? ELSE NULL END, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.due_date, next.due_date, next.achieved_date, next.remarks, next.achieved_date, req.user.id, m.id);
  audit(req, 'MILESTONE_UPDATED', 'contract_milestones', m.id, {
    beforeValue: { due_date: m.due_date, achieved_date: m.achieved_date },
    afterValue: { due_date: next.due_date, achieved_date: next.achieved_date },
  });
  if (next.achieved_date && !m.achieved_date) {
    for (const s of ['SELLER', 'BUYER']) notify(contract, s, `${contract.contract_no}: ${m.label} recorded as achieved on ${next.achieved_date}.`);
  }
  return milestonesOf(contract.id);
}));

// DELETE /milestones/:id — only one nothing has happened on yet.
router.delete('/milestones/:id', (req, res) => send(res, () => {
  if (!canMake(req.user)) throw fail(403, 'Removing a milestone is the REIA maker\'s');
  const { milestone: m, contract } = milestoneFor(req.user, req.params.id);
  if (m.achieved_date || m.reported_date) throw fail(400, 'A milestone that has been reported or achieved stays on record');
  if (db.prepare('SELECT 1 FROM contract_requests WHERE milestone_id = ?').get(m.id)) throw fail(400, 'A request has been raised against this milestone, so it stays on record');
  db.prepare('DELETE FROM contract_milestones WHERE id = ?').run(m.id);
  audit(req, 'MILESTONE_REMOVED', 'contract_milestones', m.id, { beforeValue: { contract_id: contract.id, label: m.label, due_date: m.due_date } });
  return milestonesOf(contract.id);
}));

// POST /milestones/:id/report { achieved_date, note } — the counterparty saying it is done.
router.post('/milestones/:id/report', (req, res) => send(res, () => {
  const { milestone: m, contract, side } = milestoneFor(req.user, req.params.id);
  if (side === 'SJVN') throw fail(400, 'SJVN records a milestone directly rather than reporting it');
  if (m.achieved_date) throw fail(400, 'This milestone is already recorded as achieved');
  const date = req.body.achieved_date;
  if (!date || !DAY.test(date)) throw fail(400, 'Give the date it was achieved, as YYYY-MM-DD');
  if (date > today()) throw fail(400, 'A milestone cannot be achieved on a date still to come');
  db.prepare(`
    UPDATE contract_milestones SET reported_date = ?, reported_note = ?, reported_by = ?, reported_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(date, text(req.body.note, 1000) || null, req.user.id, m.id);
  audit(req, 'MILESTONE_REPORTED', 'contract_milestones', m.id, { afterValue: { reported_date: date } });
  notify(contract, 'SJVN', `${contract.contract_no}: ${m.label} reported as achieved on ${date} — to be confirmed.`);
  return milestonesOf(contract.id);
}));

// POST /milestones/:id/confirm { accept, achieved_date, note } — SJVN accepting the report, or not.
router.post('/milestones/:id/confirm', (req, res) => send(res, () => {
  if (!canCheck(req.user)) throw fail(403, 'Confirming a milestone is the REIA checker\'s');
  const { milestone: m, contract } = milestoneFor(req.user, req.params.id);
  if (!m.reported_date || m.achieved_date) throw fail(400, 'There is nothing reported on this milestone to confirm');
  const accept = req.body.accept !== false;
  const note = text(req.body.note, 1000) || null;
  if (!accept && !note) throw fail(400, 'Say why the report is not accepted');
  const date = req.body.achieved_date || m.reported_date;
  if (accept && (!DAY.test(date) || date > today())) throw fail(400, 'achieved_date must be a past date, as YYYY-MM-DD');
  if (accept) {
    db.prepare(`UPDATE contract_milestones SET achieved_date = ?, confirmed_by = ?, remarks = COALESCE(?, remarks), updated_at = datetime('now') WHERE id = ?`)
      .run(date, req.user.id, note, m.id);
  } else {
    db.prepare(`UPDATE contract_milestones SET reported_date = NULL, reported_note = NULL, reported_by = NULL, reported_at = NULL, remarks = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(`Report of ${m.reported_date} not accepted: ${note}`, m.id);
  }
  audit(req, accept ? 'MILESTONE_CONFIRMED' : 'MILESTONE_REPORT_REFUSED', 'contract_milestones', m.id, { afterValue: { achieved_date: accept ? date : null }, reason: note });
  for (const s of ['SELLER', 'BUYER']) {
    notify(contract, s, accept
      ? `${contract.contract_no}: SJVN has confirmed ${m.label} as achieved on ${date}.`
      : `${contract.contract_no}: SJVN has not accepted the report of ${m.label}: ${note}`);
  }
  return milestonesOf(contract.id);
}));

// POST /:contractId/requests — the counterparty asking SJVN for something.
router.post('/:contractId/requests', (req, res) => send(res, () => {
  const { contract, side } = contractFor(req.user, req.params.contractId);
  if (side === 'SJVN') throw fail(400, 'A request is raised by the counterparty. SJVN writes to them with a notice.');
  const b = req.body;
  if (b.request_type === 'PBG_RENEWAL' && side !== 'SELLER') throw fail(400, 'The performance guarantee is the seller\'s to renew');
  const types = requestTypesFor(contract, side);
  if (REQUEST_TYPES[b.request_type] && !types.includes(b.request_type)) {
    throw fail(400, 'A PSA has no project milestones or performance guarantee to ask about — raise an amendment or another request');
  }
  if (!REQUEST_TYPES[b.request_type]) throw fail(400, `request_type must be one of ${types.join(', ')}`);
  const ground = b.ground || 'OTHER';
  if (!REQUEST_GROUNDS[ground]) throw fail(400, 'Unknown ground');
  if (!requestGroundsFor(contract).includes(ground)) throw fail(400, `${REQUEST_GROUNDS[ground]} is a ground for a generating project, which a PSA does not have`);
  const description = text(b.description, 4000);
  if (!description) throw fail(400, 'Explain what is being asked for, and why');
  if (b.requested_date && !DAY.test(b.requested_date)) throw fail(400, 'requested_date must be YYYY-MM-DD');
  const attachment = attachmentOf(contract, b.attachment_version_id);

  let milestoneId = null;
  let subject = text(b.subject, 200);
  if (b.request_type === 'MILESTONE_EXTENSION') {
    const m = db.prepare('SELECT * FROM contract_milestones WHERE id = ? AND contract_id = ?').get(String(b.milestone_id || ''), contract.id);
    if (!m) throw fail(400, 'Choose the milestone to be extended');
    if (m.achieved_date) throw fail(400, 'That milestone has already been achieved');
    if (!b.requested_date) throw fail(400, 'Give the new date being asked for');
    if (m.due_date && b.requested_date <= m.due_date) throw fail(400, `The new date must be after the present one (${m.due_date})`);
    if (db.prepare(`SELECT 1 FROM contract_requests WHERE milestone_id = ? AND status = 'PENDING'`).get(m.id)) throw fail(400, 'An extension of this milestone is already waiting on SJVN');
    milestoneId = m.id;
    subject = subject || `Extension of ${m.label} to ${b.requested_date}`;
  }
  if (b.request_type === 'PBG_RENEWAL') {
    if (!b.requested_date) throw fail(400, 'Give the new guarantee\'s expiry date');
    if (b.requested_date <= today()) throw fail(400, 'The renewed guarantee must be valid beyond today');
    if (!attachment) throw fail(400, 'Attach the renewed guarantee');
    if (b.amount != null && b.amount !== '' && !(Number(b.amount) > 0)) throw fail(400, 'amount must be a positive number');
    subject = subject || `Renewed performance guarantee, valid to ${b.requested_date}`;
  }
  if (!subject) throw fail(400, 'Give the request a subject');

  const id = newId('CRQ');
  db.prepare(`
    INSERT INTO contract_requests
      (id, contract_id, request_type, ground, subject, description, milestone_id, requested_date, amount, bank,
       attachment_version_id, raised_by, raised_by_side)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, contract.id, b.request_type, ground, subject, description, milestoneId, b.requested_date || null,
    b.amount ? Number(b.amount) : null, text(b.bank, 120) || null, attachment, req.user.id, side);
  audit(req, 'CONTRACT_REQUEST_RAISED', 'contract_requests', id, { afterValue: { contract_id: contract.id, request_type: b.request_type, requested_date: b.requested_date || null } });
  notify(contract, 'SJVN', `${contract.contract_no}: request from ${req.user.name} — ${subject}.`);
  return requestsOf(contract.id, side);
}));

// POST /requests/:id/decide { decision: APPROVED|REJECTED, note, approved_date }
router.post('/requests/:id/decide', (req, res) => send(res, () => {
  if (!canCheck(req.user)) throw fail(403, 'Deciding a request is the REIA checker\'s');
  const { request: r, contract } = requestFor(req.user, req.params.id);
  if (r.status !== 'PENDING') throw fail(400, `This request has already been ${r.status.toLowerCase()}`);
  if (r.raised_by === req.user.id) throw fail(403, 'A request cannot be decided by the person who raised it');
  const decision = String(req.body.decision || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw fail(400, 'decision must be APPROVED or REJECTED');
  const note = text(req.body.note, 2000);
  if (decision === 'REJECTED' && !note) throw fail(400, 'Say why the request is refused');
  // SJVN may grant a different date from the one asked for.
  const granted = req.body.approved_date || r.requested_date;
  if (decision === 'APPROVED' && ['MILESTONE_EXTENSION', 'PBG_RENEWAL'].includes(r.request_type)) {
    if (!granted || !DAY.test(granted)) throw fail(400, 'approved_date must be YYYY-MM-DD');
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE contract_requests SET status = ?, decision_note = ?, approved_date = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?
    `).run(decision, note || null, decision === 'APPROVED' ? granted || null : null, req.user.id, r.id);
    if (decision !== 'APPROVED') return;
    if (r.request_type === 'MILESTONE_EXTENSION') {
      db.prepare(`
        UPDATE contract_milestones SET original_due_date = COALESCE(original_due_date, due_date), due_date = ?, updated_at = datetime('now') WHERE id = ?
      `).run(granted, r.milestone_id);
    }
    if (r.request_type === 'PBG_RENEWAL') {
      // The guarantee on record is now the renewed one.
      db.prepare(`UPDATE contracts SET pbg_expiry = ?, pbg_amount = COALESCE(?, pbg_amount), updated_at = datetime('now') WHERE id = ?`)
        .run(granted, r.amount, contract.id);
      try {
        const held = db.prepare(`
          SELECT * FROM payment_security
          WHERE contract_id = ? AND mechanism_type = 'BANK_GUARANTEE' AND bg_subtype = 'PBG' AND status IN ('ACTIVE','PARTIALLY_UTILIZED','EXPIRED')
        `).all(contract.id);
        // Into the instrument's amendment chain, so the renewal shows as one.
        for (const ps of held) {
          if (ps.validity_end === granted) continue;
          takeAmendmentOnRecord(ps, {
            newValidityEnd: granted, newLimit: r.amount && Number(r.amount) !== Number(ps.limit_amount) ? r.amount : null, reason: r.subject || 'Renewed performance guarantee', documentVersionId: r.attachment_version_id || null,
            user: req.user, side: 'SJVN',
          });
        }
      } catch { /* no instrument held for it */ }
    }
  })();

  audit(req, `CONTRACT_REQUEST_${decision}`, 'contract_requests', r.id, {
    beforeValue: { status: 'PENDING' }, afterValue: { status: decision, approved_date: decision === 'APPROVED' ? granted || null : null }, reason: note || undefined,
  });
  notify(contract, r.raised_by_side, `${contract.contract_no}: your request "${r.subject}" has been ${decision === 'APPROVED' ? 'approved' : 'refused'} by SJVN${note ? ` — ${note}` : ''}.`);
  return requestsOf(contract.id, 'SJVN');
}));

// POST /requests/:id/withdraw — by the side that raised it, while it is still open.
router.post('/requests/:id/withdraw', (req, res) => send(res, () => {
  const { request: r, contract, side } = requestFor(req.user, req.params.id);
  if (side !== r.raised_by_side) throw fail(403, 'Only the side that raised a request can withdraw it');
  if (r.status !== 'PENDING') throw fail(400, 'Only a request still waiting on SJVN can be withdrawn');
  db.prepare(`UPDATE contract_requests SET status = 'WITHDRAWN', decided_at = datetime('now') WHERE id = ?`).run(r.id);
  audit(req, 'CONTRACT_REQUEST_WITHDRAWN', 'contract_requests', r.id);
  notify(contract, 'SJVN', `${contract.contract_no}: the request "${r.subject}" has been withdrawn.`);
  return requestsOf(contract.id, side);
}));

// POST /:contractId/notices — a formal notice, from either side to the other.
router.post('/:contractId/notices', (req, res) => send(res, () => {
  const { contract, side } = contractFor(req.user, req.params.contractId);
  if (side === 'SJVN' && !canMake(req.user)) throw fail(403, 'A notice for SJVN is written by the REIA maker');
  const b = req.body;
  if (!NOTICE_TYPES[b.notice_type]) throw fail(400, `notice_type must be one of ${Object.keys(NOTICE_TYPES).join(', ')}`);
  const subject = text(b.subject, 200);
  const body = text(b.body, 8000);
  if (!subject || !body) throw fail(400, 'A notice needs a subject and its text');
  for (const k of ['event_date', 'response_due']) {
    if (b[k] && !DAY.test(b[k])) throw fail(400, `${k} must be YYYY-MM-DD`);
  }
  if (b.response_due && b.response_due < today()) throw fail(400, 'The reply-by date cannot be in the past');
  const counterparty = side === 'SJVN' ? counterpartyOf(contract, b.to_side) : side;
  const attachment = attachmentOf(contract, b.attachment_version_id);

  let parentId = null;
  if (b.reply_to) {
    const parent = db.prepare('SELECT * FROM contract_notices WHERE id = ? AND contract_id = ?').get(String(b.reply_to), contract.id);
    if (!parent || parent.counterparty_side !== counterparty) throw fail(400, 'The notice being replied to is not on this contract');
    if (parent.sent_by_side === side) throw fail(400, 'A reply is to the other side\'s notice');
    parentId = parent.id;
  }

  const id = newId('CNT');
  const seq = db.prepare('SELECT COUNT(*) AS n FROM contract_notices WHERE contract_id = ?').get(contract.id).n + 1;
  const noticeNo = `${contract.contract_no}/N/${String(seq).padStart(3, '0')}`;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO contract_notices
        (id, contract_id, notice_no, notice_type, subject, body, event_date, response_due, attachment_version_id,
         parent_notice_id, sent_by, sent_by_side, counterparty_side)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, contract.id, noticeNo, b.notice_type, subject, body, b.event_date || null, b.response_due || null, attachment,
      parentId, req.user.id, side, counterparty);
    // Answering a notice is the fullest acknowledgement of it there is.
    if (parentId) {
      db.prepare(`UPDATE contract_notices SET acknowledged_at = COALESCE(acknowledged_at, datetime('now')), acknowledged_by = COALESCE(acknowledged_by, ?) WHERE id = ?`)
        .run(req.user.id, parentId);
    }
  })();
  // What was said in a notice is the parties' own; the trail records that it was sent.
  audit(req, 'CONTRACT_NOTICE_SENT', 'contract_notices', id, { afterValue: { contract_id: contract.id, notice_no: noticeNo, notice_type: b.notice_type, from: side, to: side === 'SJVN' ? counterparty : 'SJVN' } });
  notify(contract, side === 'SJVN' ? counterparty : 'SJVN', `${contract.contract_no}: ${NOTICE_TYPES[b.notice_type]} notice ${noticeNo} — ${subject}.`);
  return noticesOf(contract.id, side);
}));

// POST /notices/:id/acknowledge — the receiving side saying it has it.
router.post('/notices/:id/acknowledge', (req, res) => send(res, () => {
  const n = db.prepare('SELECT * FROM contract_notices WHERE id = ?').get(req.params.id);
  if (!n) throw fail(404, 'Notice not found');
  const { contract, side } = contractFor(req.user, n.contract_id);
  if (side !== 'SJVN' && side !== n.counterparty_side) throw fail(404, 'Notice not found');
  const receiver = n.sent_by_side === 'SJVN' ? n.counterparty_side : 'SJVN';
  if (side !== receiver) throw fail(400, 'A notice is acknowledged by the side it was sent to');
  if (side === 'SJVN' && !canCheck(req.user)) throw fail(403, 'A notice to SJVN is acknowledged by the REIA checker');
  if (n.acknowledged_at) throw fail(400, 'This notice has already been acknowledged');
  db.prepare(`UPDATE contract_notices SET acknowledged_at = datetime('now'), acknowledged_by = ? WHERE id = ?`).run(req.user.id, n.id);
  audit(req, 'CONTRACT_NOTICE_ACKNOWLEDGED', 'contract_notices', n.id);
  notify(contract, n.sent_by_side, `${contract.contract_no}: notice ${n.notice_no} has been acknowledged by ${req.user.name}.`);
  return noticesOf(contract.id, side);
}));

export default router;
