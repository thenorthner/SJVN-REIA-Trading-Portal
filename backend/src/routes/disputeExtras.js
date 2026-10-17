/**
 * A dispute as a matter with money and time running on it.
 *
 * routes/disputes.js raises, reviews and resolves a dispute. This adds what
 * turns it from a ticket into a claim:
 *
 *   clock      whose move it is and how long they have — or by how much the
 *              time has run out;
 *   surcharge  what the amount in question is earning in late payment
 *              surcharge while it stays unsettled;
 *   answer     the submitter's reply to SJVN's resolution: accept it, which
 *              closes the dispute, or contest it and name the forum it goes to;
 *   group      several bills disputed for one cause, tied together;
 *   dossier    the whole file — bill, timeline, correspondence, evidence — as
 *              one indexed document with the evidence beside it.
 *
 * A counterparty sees and acts on disputes on its own bills only.
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import { ZipArchive } from 'archiver';
import db from '../db/index.js';
import { requireAuth, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { pushNotification, nextSeriesNo } from '../util.js';
import { notifyCounterparty, notifyDesk } from '../paymentSecurityEngine.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParamNumber } from '../mastersService.js';
import { OPEN_STATUSES, REASON_LABELS, CHARGE_LABELS } from '../disputesConstants.js';
import { billPresentedOn } from '../services/counterpartyScope.js';
import { canAccessDispute, recordEvent, setInvoiceOpenDispute, disputeUploadDir, raiseResolutionNote } from './disputes.js';
import {
  newDoc, header, kpiBand, sectionTitle, table, notes as footNotes, pageNumbers, stamp, nowLabel, M, CONTENT_W, INK, MUTED,
} from '../scripts/reportPdfKit.js';

const router = Router();
router.use(requireAuth);

const REIA_ROLES = ROLE_GROUPS.REIA_ALL;
const isSjvn = (user) => REIA_ROLES.includes(user?.role);
const canManage = (user) => ROLE_GROUPS.REIA_WRITE.includes(user?.role);
const fail = (status, message) => Object.assign(new Error(message), { status });
const send = (res, fn) => {
  try { res.json(fn()); } catch (err) {
    if (!err.status) console.error('[DISPUTE]', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
};
const audit = (req, action, id, extra = {}) => {
  try { secureLogAudit(req, { action, module: 'REIA', entityType: 'dispute', entityId: id, ...extra }); } catch (err) { console.error('[DISPUTE] audit failed', err.message); }
};
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const inr = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const at = (s) => (s ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`) : null);
const RESOLVED = ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'];
export const FORUMS = {
  SJVN_MANAGEMENT: 'SJVN senior management',
  LEGAL: 'Legal / conciliation under the contract',
  ARBITRATION: 'Arbitration',
  CERC: 'The Regulatory Commission',
};

const ROW = `
  SELECT d.*, i.invoice_no, i.total_amount AS invoice_total, i.billing_period, i.direction, i.contract_id, i.due_date AS invoice_due_date,
         i.created_at AS invoice_created_at, i.issued_at AS invoice_issued_at, i.status AS invoice_status,
         c.contract_no, c.seller_id, c.buyer_id, c.lps_annual_pct, es.name AS seller_name, eb.name AS buyer_name
  FROM disputes d
  JOIN invoices i ON i.id = d.invoice_id
  JOIN contracts c ON c.id = i.contract_id
  LEFT JOIN entities es ON es.id = c.seller_id
  LEFT JOIN entities eb ON eb.id = c.buyer_id
`;

function disputeFor(user, id) {
  const d = db.prepare(`${ROW} WHERE d.id = ?`).get(id);
  if (!d) throw fail(404, 'Dispute not found');
  if (!canAccessDispute(user, d)) throw fail(403, 'Not authorized');
  return d;
}
/** The side that raised it, signed in as itself. */
const isSubmitter = (user, d) => counterpartySide(user) === d.raised_by_role;

// ── The clock ───────────────────────────────────────────────────────────────

/** Whose move it is on a dispute, and how the time stands. */
export function slaOf(d, now = new Date()) {
  const left = (due) => {
    const ms = at(due) - now;
    return { due, days_left: Math.ceil(ms / 86400000), hours_left: Math.round(ms / 3600000), overdue: ms < 0 };
  };
  if (d.status === 'CLOSED') return { stage: 'DONE', owner: null, label: d.resolution_response === 'WITHDRAWN' ? 'Withdrawn' : 'Closed', breached: !!d.sla_breached_at };
  if (RESOLVED.includes(d.status)) {
    if (d.resolution_response === 'CONTESTED') {
      return { stage: 'CONTESTED', owner: 'SJVN', label: `Contested — taken to ${FORUMS[d.escalation_forum] || 'a higher forum'}`, breached: !!d.sla_breached_at };
    }
    const waited = Math.floor((now - at(d.resolved_at)) / 86400000);
    return { stage: 'RESPONSE', owner: 'SUBMITTER', waiting_days: waited, label: `SJVN has given its resolution — awaiting the ${d.raised_by_role.toLowerCase()}'s answer for ${waited} day${waited === 1 ? '' : 's'}`, breached: !!d.sla_breached_at };
  }
  const stage = d.status === 'RAISED' ? 'ACKNOWLEDGE' : 'RESOLVE';
  const due = stage === 'ACKNOWLEDGE' ? d.sla_ack_due : d.sla_resolve_due;
  if (!due) return { stage, owner: 'SJVN', label: 'No time limit recorded', breached: !!d.sla_breached_at };
  // While SJVN waits on the party the clock stands still: time left is what
  // was left when the question went out.
  const paused = d.status === 'INFO_REQUESTED' && d.info_requested_at;
  const t = paused ? (() => { const ms = at(due) - at(d.info_requested_at); return { due, days_left: Math.ceil(ms / 86400000), hours_left: Math.round(ms / 3600000), overdue: ms < 0 }; })() : left(due);
  const breached = !!d.sla_breached_at || t.overdue;
  const what = stage === 'ACKNOWLEDGE' ? 'acknowledge' : 'resolve';
  const span = (n) => (Math.abs(n) >= 48 ? `${Math.abs(Math.round(n / 24))} days` : `${Math.abs(n)} hour${Math.abs(n) === 1 ? '' : 's'}`);
  let label = breached
    ? `SJVN's time to ${what} ran out ${span(t.hours_left)} ago`
    : `SJVN has ${span(t.hours_left)} left to ${what}`;
  // The clock is SJVN's, but while it waits on the submitter the next move is theirs.
  if (d.status === 'INFO_REQUESTED') label = paused
    ? `SJVN is waiting for the ${d.raised_by_role.toLowerCase()}'s reply — its clock is paused with ${span(t.hours_left)} left to resolve`
    : `SJVN is waiting for the ${d.raised_by_role.toLowerCase()}'s reply — ${breached ? `time to resolve ran out ${span(t.hours_left)} ago` : `${span(t.hours_left)} left to resolve`}`;
  return { stage, owner: d.status === 'INFO_REQUESTED' ? 'SUBMITTER' : 'SJVN', ...t, breached, paused: !!paused, label };
}

// ── The surcharge ───────────────────────────────────────────────────────────

/**
 * What the amount in question has earned in late payment surcharge, were it
 * found to be due: simple interest at the contract's LPS rate from the bill's
 * due date. It runs while the dispute is open or contested, and stops at the
 * resolution for the part SJVN accepted. An estimate — the surcharge actually
 * payable follows the contract's own rules.
 */
export function lpsEstimateOf(d, now = new Date()) {
  const rate = Number(d.lps_annual_pct) > 0 ? Number(d.lps_annual_pct) : getParamNumber('lps_annual_pct', 15);
  const from = at(d.invoice_due_date ? `${String(d.invoice_due_date).slice(0, 10)}T00:00:00Z` : null)
    || at(billPresentedOn({ issued_at: d.invoice_issued_at, created_at: d.invoice_created_at }));
  let base;
  let to = now;
  let running = true;
  if (OPEN_STATUSES.includes(d.status)) base = Number(d.disputed_amount) || 0;
  else if (d.resolution_response === 'CONTESTED' && d.status !== 'CLOSED') base = Number(d.contested_amount) || 0;
  else { base = Number(d.accepted_amount) || 0; to = at(d.resolved_at) || now; running = false; }
  const days = from ? Math.max(0, Math.floor((to - from) / 86400000)) : 0;
  const perDay = money((base * rate) / 100 / 365);
  return {
    base: money(base), rate_pct: rate, from: from ? from.toISOString().slice(0, 10) : null, days,
    amount: money(perDay * days), per_day: running && days > 0 ? perDay : 0, running,
    not_yet_due: !!from && from > now,
  };
}

function view(user, d) {
  const sla = slaOf(d);
  const submitter = isSubmitter(user, d);
  const siblings = d.group_ref ? db.prepare(`
    SELECT d.id, d.dispute_no, d.status, d.disputed_amount, i.invoice_no, i.billing_period
    FROM disputes d JOIN invoices i ON i.id = d.invoice_id WHERE d.group_ref = ? ORDER BY i.billing_period
  `).all(d.group_ref) : [];
  const open = OPEN_STATUSES.includes(d.status);
  return {
    id: d.id, dispute_no: d.dispute_no, status: d.status, invoice_id: d.invoice_id, invoice_no: d.invoice_no, billing_period: d.billing_period,
    contract_no: d.contract_no, reason_code: d.reason_code, charge_line: d.charge_line, disputed_amount: d.disputed_amount,
    accepted_amount: d.accepted_amount, raised_by_role: d.raised_by_role, created_at: d.created_at, resolved_at: d.resolved_at,
    counterparty: d.raised_by_role === 'SELLER' ? d.seller_name : d.buyer_name,
    sla,
    lps_estimate: lpsEstimateOf(d),
    resolution: RESOLVED.includes(d.status) || d.status === 'CLOSED' ? {
      outcome: d.resolution_outcome, notes: d.resolution_notes, accepted_amount: d.accepted_amount, not_accepted: money((d.disputed_amount || 0) - (d.accepted_amount || 0)),
      response: d.resolution_response, response_by: d.resolution_response_by, response_at: d.resolution_response_at, response_note: d.resolution_response_note,
      forum: d.escalation_forum, forum_label: FORUMS[d.escalation_forum] || null, contested_amount: d.contested_amount, escalation_outcome: d.escalation_outcome,
    } : null,
    group: d.group_ref ? { ref: d.group_ref, title: d.group_title, disputes: siblings, total: money(siblings.reduce((s, x) => s + x.disputed_amount, 0)) } : null,
    can: {
      respond: submitter && RESOLVED.includes(d.status) && !d.resolution_response,
      withdraw: submitter && open,
      conclude: canManage(user) && RESOLVED.includes(d.status) && d.resolution_response === 'CONTESTED',
    },
    // What is waiting on the person asking.
    awaiting_me: isSjvn(user) ? (open && sla.owner === 'SJVN') || sla.stage === 'CONTESTED' : submitter && (d.status === 'INFO_REQUESTED' || sla.stage === 'RESPONSE'),
  };
}

// GET /meta
router.get('/meta', (_req, res) => res.json({ forums: FORUMS }));

// GET /overview — every dispute the caller can see, with its clock and surcharge, and the totals.
router.get('/overview', (req, res) => send(res, () => {
  const side = counterpartySide(req.user);
  if (!side && !isSjvn(req.user)) throw fail(403, 'Access denied');
  let sql = `${ROW} WHERE 1 = 1`;
  const params = [];
  if (side) {
    if (!req.user.linked_entity_id) return { disputes: [], totals: null };
    sql += ` AND c.${side === 'SELLER' ? 'seller_id' : 'buyer_id'} = ?`;
    params.push(req.user.linked_entity_id);
  }
  const rows = db.prepare(`${sql} ORDER BY d.created_at DESC`).all(...params).map((d) => view(req.user, d));
  const live = rows.filter((r) => r.status !== 'CLOSED');
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  return {
    disputes: rows,
    totals: {
      open: open.length,
      open_amount: money(open.reduce((s, r) => s + r.disputed_amount, 0)),
      breached: live.filter((r) => r.sla.breached && r.sla.stage !== 'RESPONSE').length,
      awaiting_me: rows.filter((r) => r.awaiting_me).length,
      contested: live.filter((r) => r.sla.stage === 'CONTESTED').length,
      lps_running: money(live.reduce((s, r) => s + (r.lps_estimate.running ? r.lps_estimate.amount : 0), 0)),
      lps_per_day: money(live.reduce((s, r) => s + r.lps_estimate.per_day, 0)),
    },
  };
}));

// GET /:id
// ── D5: forum tracker ───────────────────────────────────────────────────────
// Every dispute taken to a forum: its case number, the hearings held and the
// next one, and what SJVN stands to lose if it goes against it. The award is
// recorded with "Record how it ended", which closes the dispute and raises the
// note for the amount awarded.
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
router.get('/forum-tracker', (req, res) => send(res, () => {
  if (!canManage(req.user) && !['FINANCE_USER', 'MANAGEMENT', 'SJVN_ADMIN'].includes(req.user.role)) throw fail(403, 'Not authorized');
  const rows = db.prepare(`
    SELECT d.*, i.invoice_no, c.contract_no FROM disputes d JOIN invoices i ON i.id = d.invoice_id JOIN contracts c ON c.id = i.contract_id
    WHERE d.resolution_response = 'CONTESTED' ORDER BY (d.status = 'CLOSED'), d.next_hearing IS NULL, d.next_hearing, d.escalated_at
  `).all().map((d) => {
    const hearings = db.prepare('SELECT * FROM dispute_hearings WHERE dispute_id = ? ORDER BY hearing_date').all(d.id);
    const exposure = d.status === 'CLOSED' ? 0 : Number(d.expected_exposure ?? d.contested_amount) || 0;
    return {
      id: d.id, dispute_no: d.dispute_no, invoice_no: d.invoice_no, contract_no: d.contract_no, raised_by_role: d.raised_by_role,
      forum: d.escalation_forum, forum_label: FORUMS[d.escalation_forum] || d.escalation_forum, case_no: d.forum_case_no || null, filed_on: d.forum_filed_on || null,
      contested_amount: d.contested_amount, expected_exposure: exposure, next_hearing: d.next_hearing || null,
      days_to_hearing: d.next_hearing ? Math.floor((Date.parse(`${d.next_hearing}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000) : null,
      hearings, status: d.status === 'CLOSED' ? 'DECIDED' : 'PENDING', outcome: d.escalation_outcome, awarded_amount: d.awarded_amount,
    };
  });
  return { rows, totals: { pending: rows.filter((r) => r.status === 'PENDING').length, exposure: Math.round(rows.reduce((t, r) => t + r.expected_exposure, 0)), hearings_in_7_days: rows.filter((r) => r.days_to_hearing != null && r.days_to_hearing >= 0 && r.days_to_hearing <= 7).length } };
}));

router.post('/:id/forum', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk keeps the forum record');
  const d = disputeFor(req.user, req.params.id);
  if (d.resolution_response !== 'CONTESTED') throw fail(400, 'This dispute has not been taken to a forum');
  const b = req.body || {};
  const caseNo = String(b.case_no || '').trim().slice(0, 80);
  if (!caseNo) throw fail(400, 'Give the case / petition number');
  const filed = b.filed_on ? String(b.filed_on) : null;
  if (filed && (!/^\d{4}-\d{2}-\d{2}$/.test(filed) || filed > today())) throw fail(400, 'The filing date must be a date not in the future');
  const exposure = b.expected_exposure === undefined || b.expected_exposure === '' ? null : Number(b.expected_exposure);
  if (exposure != null && (!Number.isFinite(exposure) || exposure < 0 || exposure > (Number(d.contested_amount) || 0) + 0.01)) throw fail(400, `The expected exposure is between 0 and the ₹${inr(d.contested_amount)} contested`);
  db.prepare(`UPDATE disputes SET forum_case_no = ?, forum_filed_on = COALESCE(?, forum_filed_on), expected_exposure = COALESCE(?, expected_exposure), updated_at = datetime('now') WHERE id = ?`).run(caseNo, filed, exposure, d.id);
  recordEvent(d.id, req.user, 'FORUM_RECORDED', d.status, d.status, { case_no: caseNo, filed_on: filed, expected_exposure: exposure });
  audit(req, 'DISPUTE_FORUM_RECORDED', d.id, { afterValue: { case_no: caseNo, filed_on: filed, expected_exposure: exposure } });
  return view(req.user, disputeFor(req.user, d.id));
}));

router.post('/:id/hearings', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk keeps the forum record');
  const d = disputeFor(req.user, req.params.id);
  if (d.resolution_response !== 'CONTESTED' || d.status === 'CLOSED') throw fail(400, 'This dispute is not pending before a forum');
  const b = req.body || {};
  const date = String(b.hearing_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, 'Give the hearing date');
  const next = b.next_date ? String(b.next_date) : null;
  if (next && (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next <= date)) throw fail(400, 'The next date comes after this hearing');
  const id = `HRG-${Math.random().toString(36).slice(2, 12)}`;
  db.prepare('INSERT INTO dispute_hearings (id, dispute_id, hearing_date, purpose, notes, next_date, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, d.id, date, String(b.purpose || '').slice(0, 200) || null, String(b.notes || '').slice(0, 1000) || null, next, req.user.name);
  // The next hearing is the latest date known: a hearing in the future, or the next date a past one fixed.
  const upcoming = date >= today() ? date : next;
  db.prepare(`UPDATE disputes SET next_hearing = ?, updated_at = datetime('now') WHERE id = ?`).run(upcoming || null, d.id);
  recordEvent(d.id, req.user, 'HEARING_RECORDED', d.status, d.status, { hearing_date: date, next_date: next });
  return view(req.user, disputeFor(req.user, d.id));
}));

router.get('/:id', (req, res) => send(res, () => view(req.user, disputeFor(req.user, req.params.id))));

// POST /:id/respond { response: ACCEPT | ESCALATE, forum, note, contested_amount }
router.post('/:id/respond', (req, res) => send(res, () => {
  const d = disputeFor(req.user, req.params.id);
  if (!isSubmitter(req.user, d)) throw fail(403, 'Only the party that raised the dispute answers its resolution');
  if (!RESOLVED.includes(d.status)) throw fail(400, 'SJVN has not given a resolution on this dispute yet');
  if (d.resolution_response) throw fail(400, 'The resolution has already been answered');
  const response = String(req.body.response || '').toUpperCase();
  const note = String(req.body.note || '').trim().slice(0, 2000);
  if (response === 'ACCEPT') {
    db.prepare(`
      UPDATE disputes SET status = 'CLOSED', resolution_response = 'ACCEPTED', resolution_response_by = ?, resolution_response_at = datetime('now'),
        resolution_response_note = ?, updated_at = datetime('now') WHERE id = ?
    `).run(req.user.name, note || null, d.id);
    setInvoiceOpenDispute(d.invoice_id);
    recordEvent(d.id, req.user, 'RESOLUTION_ACCEPTED', d.status, 'CLOSED', note ? { note } : null);
    audit(req, 'DISPUTE_RESOLUTION_ACCEPTED', d.id);
    notifyDesk('DISPUTE', `${d.dispute_no}: ${req.user.name} accepted the resolution — closed.`);
  } else if (response === 'ESCALATE') {
    const forum = String(req.body.forum || '').toUpperCase();
    if (!FORUMS[forum]) throw fail(400, `forum must be one of ${Object.keys(FORUMS).join(', ')}`);
    if (!note) throw fail(400, 'Say why the resolution is not accepted');
    const notAccepted = money((d.disputed_amount || 0) - (d.accepted_amount || 0));
    if (notAccepted <= 0) throw fail(400, 'SJVN accepted the whole claim; there is nothing left to contest');
    const amount = req.body.contested_amount === undefined || req.body.contested_amount === '' ? notAccepted : Number(req.body.contested_amount);
    if (!(amount > 0) || amount > notAccepted + 0.01) throw fail(400, `The amount contested must be between 0 and what was not accepted (${inr(notAccepted)})`);
    db.prepare(`
      UPDATE disputes SET resolution_response = 'CONTESTED', resolution_response_by = ?, resolution_response_at = datetime('now'),
        resolution_response_note = ?, escalation_forum = ?, contested_amount = ?, escalated_at = COALESCE(escalated_at, datetime('now')), updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.name, note, forum, money(amount), d.id);
    setInvoiceOpenDispute(d.invoice_id);
    recordEvent(d.id, req.user, 'RESOLUTION_CONTESTED', d.status, d.status, { forum, contested_amount: money(amount), note });
    audit(req, 'DISPUTE_RESOLUTION_CONTESTED', d.id, { afterValue: { forum, contested_amount: money(amount) }, reason: note });
    for (const role of [...new Set([...ROLE_GROUPS.REIA_WRITE, 'MANAGEMENT'])]) {
      pushNotification({ role, type: 'DISPUTE', message: `${d.dispute_no}: ${req.user.name} does not accept the resolution and is taking Rs ${inr(amount)} to ${FORUMS[forum]}.` });
    }
  } else {
    throw fail(400, 'response must be ACCEPT or ESCALATE');
  }
  return view(req.user, disputeFor(req.user, d.id));
}));

// POST /:id/conclude { note } — SJVN recording how a contested dispute ended.
router.post('/:id/conclude', (req, res) => send(res, () => {
  if (!canManage(req.user)) throw fail(403, 'Only the REIA desk records the outcome of an escalation');
  const d = disputeFor(req.user, req.params.id);
  if (!RESOLVED.includes(d.status) || d.resolution_response !== 'CONTESTED') throw fail(400, 'This dispute is not under escalation');
  const note = String(req.body.note || '').trim().slice(0, 2000);
  if (!note) throw fail(400, 'Record how it ended — the order, award or settlement');
  // What the forum awarded the party, if anything. It was recorded as words
  // only, so an order allowing the claim moved no money.
  const awarded = req.body.awarded_amount === undefined || req.body.awarded_amount === '' ? 0 : Number(req.body.awarded_amount);
  if (!Number.isFinite(awarded) || awarded < 0 || awarded > (Number(d.contested_amount) || 0) + 0.01) {
    throw fail(400, `The amount awarded must be between 0 and the ₹${inr(d.contested_amount)} contested`);
  }
  db.transaction(() => {
    db.prepare(`UPDATE disputes SET status = 'CLOSED', escalation_outcome = ?, awarded_amount = ?, updated_at = datetime('now') WHERE id = ?`).run(note, money(awarded), d.id);
    if (awarded > 0) {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(d.invoice_id);
      const prior = d.resolution_note_id;
      raiseResolutionNote(d, invoice, money(awarded), 0, req.user, `awarded on escalation (${note.slice(0, 120)})`);
      // The resolution's own note, if any, stays on record against the dispute's events.
      if (prior) recordEvent(d.id, req.user, 'NOTE_REPLACED', d.status, d.status, { previous_note_id: prior });
    }
  })();
  setInvoiceOpenDispute(d.invoice_id);
  recordEvent(d.id, req.user, 'ESCALATION_CONCLUDED', d.status, 'CLOSED', { note });
  audit(req, 'DISPUTE_ESCALATION_CONCLUDED', d.id, { reason: note });
  if (['SELLER', 'BUYER'].includes(d.raised_by_role)) notifyCounterparty(d.contract_id, d.raised_by_role, 'DISPUTE', `${d.dispute_no}: the escalation has been concluded — ${note}`);
  return view(req.user, disputeFor(req.user, d.id));
}));

// POST /:id/withdraw { note } — the submitter dropping a dispute that is still open.
router.post('/:id/withdraw', (req, res) => send(res, () => {
  const d = disputeFor(req.user, req.params.id);
  if (!isSubmitter(req.user, d)) throw fail(403, 'Only the party that raised the dispute can withdraw it');
  if (!OPEN_STATUSES.includes(d.status)) throw fail(400, 'Only a dispute that is still open can be withdrawn');
  const note = String(req.body.note || '').trim().slice(0, 1000);
  if (!note) throw fail(400, 'Say why it is being withdrawn');
  db.prepare(`
    UPDATE disputes SET status = 'CLOSED', resolution_response = 'WITHDRAWN', resolution_response_by = ?, resolution_response_at = datetime('now'),
      resolution_response_note = ?, updated_at = datetime('now') WHERE id = ?
  `).run(req.user.name, note, d.id);
  // The amount is no longer in question, so it is payable again.
  setInvoiceOpenDispute(d.invoice_id);
  recordEvent(d.id, req.user, 'WITHDRAWN', d.status, 'CLOSED', { note });
  audit(req, 'DISPUTE_WITHDRAWN', d.id, { reason: note });
  notifyDesk('DISPUTE', `${d.dispute_no} withdrawn by ${req.user.name}: ${note}`);
  return view(req.user, disputeFor(req.user, d.id));
}));

// POST /link { ids: [...], title } — tie several disputes raised for one cause together.
router.post('/link', (req, res) => send(res, () => {
  const ids = [...new Set(Array.isArray(req.body.ids) ? req.body.ids.map(String) : [])];
  if (ids.length < 2) throw fail(400, 'Choose at least two disputes to link');
  if (ids.length > 60) throw fail(400, 'At most 60 disputes in one group');
  const title = String(req.body.title || '').trim().slice(0, 200);
  if (!title) throw fail(400, 'Give the group a title — what the disputes have in common');
  const rows = ids.map((id) => disputeFor(req.user, id));
  if (!isSjvn(req.user) && rows.some((d) => !isSubmitter(req.user, d))) throw fail(403, 'You can link only disputes your company raised');
  if (new Set(rows.map((d) => `${d.raised_by_role}|${d.raised_by_role === 'SELLER' ? d.seller_id : d.buyer_id}`)).size > 1) throw fail(400, 'A group holds one company\'s disputes');
  // Joining a group that one of them is already in keeps that group's reference.
  const existing = rows.find((d) => d.group_ref)?.group_ref;
  if (new Set(rows.map((d) => d.group_ref).filter(Boolean)).size > 1) throw fail(400, 'These disputes are already in different groups');
  const year = new Date().getFullYear();
  const ref = existing || `DSG/${year}/${String(nextSeriesNo('DSG', year)).padStart(4, '0')}`;
  db.transaction(() => {
    for (const d of rows) {
      db.prepare(`UPDATE disputes SET group_ref = ?, group_title = ?, updated_at = datetime('now') WHERE id = ?`).run(ref, title, d.id);
      recordEvent(d.id, req.user, 'LINKED', d.status, d.status, { group_ref: ref, title });
    }
    db.prepare('UPDATE disputes SET group_title = ? WHERE group_ref = ?').run(title, ref);
  })();
  audit(req, 'DISPUTES_LINKED', ref, { afterValue: { disputes: rows.map((d) => d.dispute_no), title } });
  return view(req.user, disputeFor(req.user, rows[0].id)).group;
}));

// ── The dossier ─────────────────────────────────────────────────────────────

const docsOf = (d) => { try { return d.supporting_docs ? JSON.parse(d.supporting_docs) : []; } catch { return []; } };

/** The dispute's whole file as one indexed PDF, built in memory. */
function dossierPdf(user, d) {
  const v = view(user, d);
  const events = db.prepare('SELECT * FROM dispute_events WHERE dispute_id = ? ORDER BY created_at, rowid').all(d.id);
  // Notes SJVN made for itself are not part of what the parties exchanged.
  const comments = db.prepare('SELECT * FROM dispute_comments WHERE dispute_id = ? AND is_internal = 0 ORDER BY created_at, rowid').all(d.id);
  const docs = docsOf(d).map((x, n) => ({ ...x, ref: `E-${String(n + 1).padStart(2, '0')}` }));

  const chunks = [];
  const sink = new PassThrough();
  sink.on('data', (c) => chunks.push(c));
  sink.setHeader = () => {};
  const done = new Promise((resolve) => sink.on('end', () => resolve(Buffer.concat(chunks))));
  const title = 'Dispute Dossier';
  const ctx = { vertical: 'REIA', title, subtitle: `${d.dispute_no}  ·  ${d.invoice_no}` };
  const doc = newDoc(sink, `${title} ${d.dispute_no}`, 'dossier.pdf');
  header(doc, { ...ctx, generatedAt: nowLabel() });
  let y = 84;
  const pair = (rows) => {
    doc.font('Helvetica').fontSize(8.5);
    for (const [k, val] of rows) {
      doc.fillColor(MUTED).text(k, M, y, { width: 110 });
      const h = doc.heightOfString(String(val), { width: CONTENT_W - 115 });
      doc.fillColor(INK).text(String(val), M + 115, y, { width: CONTENT_W - 115 });
      y += Math.max(14, h + 3);
    }
  };
  y = sectionTitle(doc, y, 'Contents');
  footNotes(doc, y, ['1. The dispute', '2. The bill it concerns', '3. Resolution and what followed', '4. Timeline of events', '5. Correspondence between the parties', `6. Evidence index (${docs.length} file${docs.length === 1 ? '' : 's'}, in the evidence folder beside this document)`]);
  y += 6 * 12 + 10;

  y = sectionTitle(doc, y, '1. The dispute');
  pair([
    ['Dispute no.', d.dispute_no], ['Raised by', `${v.counterparty || d.raised_by_role} (${d.raised_by_role.toLowerCase()}) on ${stamp(d.created_at)}`],
    ['Against', 'SJVN Limited'], ['Category', REASON_LABELS[d.reason_code] || d.reason_code], ['Charge line', CHARGE_LABELS[d.charge_line] || d.charge_line],
    ['Amount disputed', `Rs ${inr(d.disputed_amount)}`], ['Standing', `${d.status.replace(/_/g, ' ')} — ${v.sla.label}`],
    ['Statement of the issue', d.issue_description || '—'],
    ...(v.group ? [['Linked disputes', `${v.group.ref} — ${v.group.title}: ${v.group.disputes.map((x) => `${x.dispute_no} (${x.invoice_no}, Rs ${inr(x.disputed_amount)})`).join('; ')}. Total Rs ${inr(v.group.total)}.`]] : []),
  ]);
  y = sectionTitle(doc, y + 8, '2. The bill it concerns');
  pair([
    ['Invoice', `${d.invoice_no}  ·  period ${d.billing_period}  ·  ${d.direction === 'SELLER_TO_SJVN' ? 'seller to SJVN' : 'SJVN to buyer'}`],
    ['Contract', d.contract_no], ['Bill value', `Rs ${inr(d.invoice_total)}`], ['Due date', d.invoice_due_date ? String(d.invoice_due_date).slice(0, 10) : '—'],
    ['Surcharge on the amount', v.lps_estimate.from ? `Rs ${inr(v.lps_estimate.amount)} on Rs ${inr(v.lps_estimate.base)} at ${v.lps_estimate.rate_pct}% a year for ${v.lps_estimate.days} day(s) from ${v.lps_estimate.from} — an estimate at simple interest` : '—'],
  ]);
  y = sectionTitle(doc, y + 8, '3. Resolution and what followed');
  const r = v.resolution;
  pair(r && r.outcome ? [
    ['SJVN\'s resolution', `${String(r.outcome).replace(/_/g, ' ')} by ${d.resolved_by || 'SJVN'} on ${stamp(d.resolved_at)} — accepted Rs ${inr(r.accepted_amount)}, not accepted Rs ${inr(r.not_accepted)}`],
    ['Reasons', r.notes || '—'],
    ['Submitter\'s answer', r.response ? `${r.response === 'ACCEPTED' ? 'Accepted' : r.response === 'CONTESTED' ? `Contested — Rs ${inr(r.contested_amount)} taken to ${r.forum_label}` : 'Withdrawn'} by ${r.response_by} on ${stamp(r.response_at)}${r.response_note ? `: ${r.response_note}` : ''}` : 'Not yet given'],
    ...(r.escalation_outcome ? [['How the escalation ended', r.escalation_outcome]] : []),
  ] : [['Resolution', r?.response === 'WITHDRAWN' ? `Withdrawn by ${r.response_by} on ${stamp(r.response_at)}: ${r.response_note}` : 'Not yet resolved']]);

  y = sectionTitle(doc, y + 8, '4. Timeline of events');
  y = table(doc, y, [
    { label: 'When', w: 100, value: (e) => stamp(e.created_at) }, { label: 'By', w: 120, value: (e) => e.actor_name },
    { label: 'Event', w: 130, value: (e) => e.event_type.replace(/_/g, ' ') },
    { label: 'Detail', w: CONTENT_W - 350, value: (e) => [e.from_status && e.to_status && e.from_status !== e.to_status ? `${e.from_status} → ${e.to_status}` : '', (() => { try { const x = JSON.parse(e.details || 'null'); return x?.note || x?.filename || x?.title || ''; } catch { return ''; } })()].filter(Boolean).join(' · ') },
  ], events, ctx, { fontSize: 7, rowH: 14 });
  y = sectionTitle(doc, y + 10, '5. Correspondence between the parties');
  if (!comments.length) { footNotes(doc, y, ['No messages were exchanged on this dispute.']); y += 16; }
  else {
    y = table(doc, y, [
      { label: 'When', w: 100, value: (c) => stamp(c.created_at) }, { label: 'From', w: 130, value: (c) => `${c.user_name} (${String(c.role).replace(/_/g, ' ').toLowerCase()})` },
      { label: 'Message', w: CONTENT_W - 230, value: (c) => c.body },
    ], comments, ctx, { fontSize: 7, rowH: 14 });
  }
  y = sectionTitle(doc, y + 10, '6. Evidence index');
  if (!docs.length) footNotes(doc, y, ['No evidence was filed on this dispute.']);
  else {
    table(doc, y, [
      { label: 'Ref', w: 40, value: (x) => x.ref }, { label: 'File', w: CONTENT_W - 300, value: (x) => x.original_name || x.filename },
      { label: 'Filed by', w: 120, value: (x) => x.uploaded_by || '—' }, { label: 'On', w: 90, value: (x) => String(x.uploaded_at || '').slice(0, 10) },
      { label: 'Size', w: 50, align: 'right', value: (x) => `${Math.max(1, Math.round((x.size || 0) / 1024))} KB` },
    ], docs, ctx, { fontSize: 7.5, rowH: 14 });
  }
  pageNumbers(doc);
  doc.end();
  return { done, docs };
}

async function sendDossier(req, res, zipped) {
  let d;
  try { d = disputeFor(req.user, req.params.id); } catch (err) {
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong' });
  }
  try {
    const { done, docs } = dossierPdf(req.user, d);
    const pdf = await done;
    const name = d.dispute_no.replace(/[^A-Za-z0-9]+/g, '-');
    audit(req, 'DISPUTE_DOSSIER_EXPORTED', d.id, { details: { format: zipped ? 'zip' : 'pdf', evidence_files: docs.length } });
    if (!zipped) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="dossier-${name}.pdf"`);
      return res.send(pdf);
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="dossier-${name}.zip"`);
    const zip = new ZipArchive({ zlib: { level: 6 } });
    zip.on('error', (err) => { console.error('[DISPUTE] dossier zip failed', err.message); res.destroy(err); });
    zip.pipe(res);
    zip.append(pdf, { name: `dossier-${name}.pdf` });
    const missing = [];
    for (const x of docs) {
      const file = path.join(disputeUploadDir, path.basename(x.filename));
      const label = `evidence/${x.ref}_${String(x.original_name || x.filename).replace(/[\\/:*?"<>|\r\n]/g, '_')}`;
      if (fs.existsSync(file)) zip.file(file, { name: label });
      else missing.push(`${x.ref} ${x.original_name || x.filename}`);
    }
    if (missing.length) zip.append(`These evidence files are listed in the dossier but are no longer on the server:\n${missing.join('\n')}\n`, { name: 'evidence/MISSING.txt' });
    return zip.finalize();
  } catch (err) {
    console.error('[DISPUTE] dossier failed', err);
    return res.status(500).json({ error: 'The dossier could not be prepared' });
  }
}

router.get('/:id/dossier.pdf', (req, res) => sendDossier(req, res, false));
router.get('/:id/dossier.zip', (req, res) => sendDossier(req, res, true));

export default router;
