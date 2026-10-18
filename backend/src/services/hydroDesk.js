/**
 * The hydro desk's work after a bill is issued: disputes on it, the payment
 * security that stands behind it, balance confirmation with each beneficiary,
 * and the tax beneficiaries deduct when they pay.
 *
 * Everything here reads from and posts to the beneficiary ledger
 * (hydroLedger.js), so a dispute accepted, an LC invoked or TDS recorded is on
 * the Account Display the moment it is done — there is no second set of books.
 */
import db from '../db/index.js';
import { newId, nextSeriesNo } from '../util.js';
import { getParamNumber } from '../mastersService.js';
import {
  accountDisplay, outstandingOf, postSpecialCredit, ledgerStatement, openDebits,
} from './hydroLedger.js';
import { raiseNote } from './hydroNotes.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);
const fail = (status, message) => Object.assign(new Error(message), { status });
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

// ─────────────────────────────────────────────────────────────────────────────
// Disputes
// ─────────────────────────────────────────────────────────────────────────────

export const DISPUTE_REASONS = {
  REA_ENERGY_MISMATCH: 'Scheduled energy differs from the REA',
  ALLOCATION_PERCENT: 'Allocation percentage applied is wrong',
  PAFM_AVAILABILITY: 'Plant availability (PAFM) disputed',
  TARIFF_AFC_ECR: 'AFC / ECR / tariff figure disputed',
  BETA_INCENTIVE: 'Beta incentive disputed',
  FREE_POWER: 'Free power to the home state computed wrongly',
  NRLDC_FEES: 'NRLDC fees and charges disputed',
  REBATE_ERROR: 'Rebate not allowed / computed wrongly',
  LPS_ERROR: 'Late payment surcharge disputed',
  DUPLICATE_BILLING: 'Billed twice',
  OTHER: 'Other',
};

/** Days the desk has to acknowledge and to resolve, from the day the dispute arrived. */
const SLA_ACK_DAYS = 2;
const SLA_RESOLVE_DAYS = 15;

export const DISPUTE_TRANSITIONS = {
  RAISED: ['ACKNOWLEDGED', 'UNDER_REVIEW', 'ESCALATED'],
  ACKNOWLEDGED: ['UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED'],
  UNDER_REVIEW: ['INFO_REQUESTED', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED', 'ESCALATED'],
  INFO_REQUESTED: ['UNDER_REVIEW', 'ESCALATED'],
  ESCALATED: ['UNDER_REVIEW', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'],
  RESOLVED_ACCEPTED: ['CLOSED'],
  RESOLVED_REJECTED: ['CLOSED'],
  CLOSED: [],
};
const OPEN = ['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED'];

function logDisputeEvent(disputeId, from, to, remarks, actor) {
  db.prepare(`
    INSERT INTO hydro_dispute_events (id, dispute_id, from_status, to_status, remarks, actor)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId('HDE'), disputeId, from, to, remarks || null, actor || null);
}

function decorateDispute(d) {
  const t = today();
  const open = OPEN.includes(d.status);
  return {
    ...d,
    reason_label: DISPUTE_REASONS[d.reason_code] || d.reason_code,
    is_open: open,
    ack_overdue: d.status === 'RAISED' && t > d.ack_due,
    resolve_overdue: open && t > d.resolve_due,
    age_days: daysBetween(d.received_on, t),
    allowed_next: DISPUTE_TRANSITIONS[d.status] || [],
  };
}

export function listDisputes({ contractId = null, status = null, beneficiaryName = null } = {}) {
  let sql = `
    SELECT d.*, b.bill_no, b.billing_month, b.bill_kind, n.note_no AS credit_note_no, n.status AS credit_note_status
    FROM hydro_disputes d
    JOIN hydro_station_bills b ON b.id = d.bill_id
    LEFT JOIN hydro_notes n ON n.id = d.credit_note_id
    WHERE 1=1`;
  const params = [];
  if (contractId) { sql += ' AND d.contract_id = ?'; params.push(contractId); }
  if (beneficiaryName) { sql += ' AND d.beneficiary_name = ?'; params.push(beneficiaryName); }
  if (status === 'OPEN') sql += ` AND d.status IN (${OPEN.map(() => '?').join(',')})`;
  else if (status) { sql += ' AND d.status = ?'; params.push(status); }
  if (status === 'OPEN') params.push(...OPEN);
  sql += ' ORDER BY d.created_at DESC';
  return db.prepare(sql).all(...params).map(decorateDispute);
}

export function getDispute(id) {
  const d = listDisputes().find((x) => x.id === id);
  if (!d) throw fail(404, 'Dispute not found');
  return { ...d, events: db.prepare('SELECT * FROM hydro_dispute_events WHERE dispute_id = ? ORDER BY created_at').all(id) };
}

/** The share of an issued bill a beneficiary can dispute: its open PB on that bill. */
export function disputableShares(contractId, beneficiaryName) {
  return db.prepare(`
    SELECT d.id AS ledger_doc_id, d.doc_no, d.amount, d.due_date, b.id AS bill_id, b.bill_no, b.billing_month, b.bill_kind
    FROM hydro_ledger_docs d JOIN hydro_station_bills b ON b.id = d.bill_id
    WHERE d.contract_id = ? AND d.beneficiary_name = ? AND d.doc_type = 'PB' AND d.status = 'OPEN'
    ORDER BY b.billing_month DESC, d.doc_date DESC
  `).all(contractId, beneficiaryName).map((r) => ({ ...r, outstanding: outstandingOf(r.ledger_doc_id) }));
}

export function raiseDispute(body, user) {
  if (!DISPUTE_REASONS[body.reason_code]) throw fail(400, `reason_code must be one of: ${Object.keys(DISPUTE_REASONS).join(', ')}`);
  const description = String(body.description || '').trim();
  if (description.length < 10) throw fail(400, 'Describe what is disputed (at least 10 characters).');
  const doc = db.prepare(`
    SELECT d.*, b.status AS bill_status FROM hydro_ledger_docs d JOIN hydro_station_bills b ON b.id = d.bill_id
    WHERE d.id = ? AND d.doc_type = 'PB' AND d.status = 'OPEN'
  `).get(body.ledger_doc_id);
  if (!doc) throw fail(400, 'Choose the beneficiary\'s share of an issued bill — a dispute is raised against a bill that has been issued to it.');
  const amount = money(body.disputed_amount);
  if (!(amount > 0)) throw fail(400, 'The disputed amount must be greater than zero.');
  if (amount > doc.amount + 0.005) throw fail(400, `The share billed on ${doc.doc_no} is ₹${doc.amount.toLocaleString('en-IN')}; more than that cannot be disputed.`);
  const already = db.prepare(`
    SELECT COALESCE(SUM(disputed_amount), 0) s FROM hydro_disputes
    WHERE ledger_doc_id = ? AND status IN (${OPEN.map(() => '?').join(',')})
  `).get(doc.id, ...OPEN).s;
  if (already + amount > doc.amount + 0.005) {
    throw fail(400, `₹${already.toLocaleString('en-IN')} of ${doc.doc_no} is already under open dispute; together they would exceed the share billed.`);
  }
  const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.received_on || '')) ? body.received_on : today();
  if (receivedOn > today()) throw fail(400, 'The date the dispute was received cannot be in the future.');

  const year = new Date().getFullYear();
  const disputeNo = `HDSP/${year}/${String(nextSeriesNo('HDSP', year)).padStart(4, '0')}`;
  const id = newId('HDS');
  db.transaction(() => {
    db.prepare(`
      INSERT INTO hydro_disputes (id, dispute_no, contract_id, bill_id, ledger_doc_id, beneficiary_name, reason_code,
        description, billed_amount, disputed_amount, letter_ref, received_on, ack_due, resolve_due, raised_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, disputeNo, doc.contract_id, doc.bill_id, doc.id, doc.beneficiary_name, body.reason_code, description,
      doc.amount, amount, body.letter_ref || null, receivedOn, addDays(receivedOn, SLA_ACK_DAYS), addDays(receivedOn, SLA_RESOLVE_DAYS),
      user?.name || null);
    logDisputeEvent(id, null, 'RAISED', description, user?.name);
  })();
  return getDispute(id);
}

/**
 * Move a dispute on. Accepting it (in full or in part) raises a DRAFT credit
 * note for the accepted amount against the disputed bill, which then needs a
 * second officer's approval like any note before the account changes.
 */
export function moveDispute(id, { to, remarks, accepted_amount }, user) {
  const d = db.prepare('SELECT * FROM hydro_disputes WHERE id = ?').get(id);
  if (!d) throw fail(404, 'Dispute not found');
  const allowed = DISPUTE_TRANSITIONS[d.status] || [];
  if (!allowed.includes(to)) throw fail(400, `A dispute that is ${d.status} can move to ${allowed.join(', ') || 'nothing further'}, not ${to}.`);
  const why = String(remarks || '').trim();
  if (['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED', 'INFO_REQUESTED', 'ESCALATED'].includes(to) && why.length < 5) {
    throw fail(400, 'Record the remarks for this step — they go to the beneficiary.');
  }
  // An accepted dispute is closed once its credit has reached the account: a
  // dispute was closed with its credit note still a draft, or rejected, so the
  // beneficiary was told "accepted" and never credited (Hydro QA run 7).
  if (to === 'CLOSED' && d.status === 'RESOLVED_ACCEPTED' && d.credit_note_id) {
    const n = db.prepare('SELECT note_no, status FROM hydro_notes WHERE id = ?').get(d.credit_note_id);
    if (n && n.status !== 'APPROVED') {
      throw fail(400, `Credit note ${n.note_no} for this dispute is ${n.status.toLowerCase()} — the dispute is closed once the note is approved and the credit is on the account.`);
    }
  }
  let accepted = null;
  let noteId = null;
  if (to === 'RESOLVED_ACCEPTED') {
    accepted = money(accepted_amount ?? d.disputed_amount);
    if (!(accepted > 0) || accepted > d.disputed_amount + 0.005) {
      throw fail(400, `The accepted amount must be more than zero and at most the ₹${d.disputed_amount.toLocaleString('en-IN')} disputed.`);
    }
    const open = d.ledger_doc_id ? outstandingOf(d.ledger_doc_id) : 0;
    const note = raiseNote({
      note_type: 'CREDIT',
      contract_id: d.contract_id,
      beneficiary_name: d.beneficiary_name,
      // Against the bill if it still owes that much; otherwise to the account.
      against_doc_id: open >= accepted ? d.ledger_doc_id : null,
      amount: accepted,
      reason: 'BILLING_ERROR',
      remarks: `Dispute ${d.dispute_no} accepted: ${why}`,
    }, user);
    noteId = note.id;
  }
  db.transaction(() => {
    db.prepare(`
      UPDATE hydro_disputes SET status = ?, accepted_amount = COALESCE(?, accepted_amount),
        resolution = CASE WHEN ? IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED') THEN ? ELSE resolution END,
        credit_note_id = COALESCE(?, credit_note_id),
        resolved_by = CASE WHEN ? IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED') THEN ? ELSE resolved_by END,
        resolved_at = CASE WHEN ? IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED') THEN datetime('now') ELSE resolved_at END,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(to, accepted, to, why, noteId, to, user?.name || null, to, id);
    logDisputeEvent(id, d.status, to, why || null, user?.name);
  })();
  return getDispute(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment security (LC / BG)
// ─────────────────────────────────────────────────────────────────────────────

/** Cover a beneficiary is asked to keep, as a % of its average monthly billing. */
export const coverPct = () => getParamNumber('hydro_lc_cover_pct', 105);

function averageMonthlyBilling(contractId, beneficiaryName) {
  // The last twelve months of bills on the account, debit notes and surcharge excluded.
  const since = addDays(today(), -365);
  const r = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) total, COUNT(DISTINCT substr(doc_date, 1, 7)) months
    FROM hydro_ledger_docs
    WHERE contract_id = ? AND beneficiary_name = ? AND doc_type = 'PB' AND status = 'OPEN'
      AND COALESCE(mode, '') <> 'DEBIT_NOTE' AND doc_date >= ?
  `).get(contractId, beneficiaryName, since);
  return r.months ? money(r.total / r.months) : 0;
}

function decorateInstrument(i) {
  const t = today();
  const live = i.status === 'ACTIVE' && i.valid_to >= t;
  const daysLeft = daysBetween(t, i.valid_to);
  return {
    ...i,
    effective_status: i.status === 'ACTIVE' && i.valid_to < t ? 'EXPIRED' : i.status,
    available: live ? money(i.amount - i.invoked_amount) : 0,
    days_to_expiry: daysLeft,
    expiring_soon: live && daysLeft <= 30,
  };
}

export function listInstruments(contractId) {
  return db.prepare(`
    SELECT * FROM hydro_security_instruments WHERE contract_id = ? ORDER BY beneficiary_name, valid_to DESC
  `).all(contractId).map(decorateInstrument);
}

/** Per beneficiary: the cover required, what is live, and the shortfall. */
export function securityPosition(contractId) {
  const names = db.prepare(`
    SELECT DISTINCT beneficiary_name FROM hydro_ledger_docs WHERE contract_id = ?
    UNION SELECT DISTINCT beneficiary_name FROM hydro_security_instruments WHERE contract_id = ?
    ORDER BY 1
  `).all(contractId, contractId).map((r) => r.beneficiary_name);
  const instruments = listInstruments(contractId);
  const pct = coverPct();
  return {
    cover_pct: pct,
    rows: names.map((name) => {
      const avg = averageMonthlyBilling(contractId, name);
      const required = money((avg * pct) / 100);
      const mine = instruments.filter((i) => i.beneficiary_name === name);
      const live = money(mine.reduce((a, i) => a + i.available, 0));
      return {
        beneficiary_name: name,
        average_monthly_billing: avg,
        required,
        live_cover: live,
        shortfall: money(Math.max(0, required - live)),
        status: required === 0 ? (live > 0 ? 'COVERED' : 'NOT_DUE') : live >= required ? 'COVERED' : live > 0 ? 'SHORT' : 'NONE',
        expiring_soon: mine.filter((i) => i.expiring_soon).map((i) => i.instrument_no),
        outstanding: money(openDebits(contractId, name).reduce((a, d) => a + d.outstanding, 0)),
      };
    }),
  };
}

export function addInstrument(body, user) {
  const type = String(body.instrument_type || 'LC').toUpperCase();
  if (!['LC', 'BG', 'ESCROW', 'OTHER'].includes(type)) throw fail(400, 'instrument_type must be LC, BG, ESCROW or OTHER');
  const amount = money(body.amount);
  if (!(amount > 0)) throw fail(400, 'The instrument amount must be greater than zero.');
  for (const k of ['contract_id', 'beneficiary_name', 'instrument_no', 'issuing_bank']) {
    if (!String(body[k] || '').trim()) throw fail(400, `${k.replace(/_/g, ' ')} is required`);
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(body.valid_from || '') || !iso.test(body.valid_to || '')) throw fail(400, 'valid_from and valid_to must be dates (YYYY-MM-DD)');
  if (body.valid_to <= body.valid_from) throw fail(400, 'The instrument must be valid to a date after it is valid from.');
  if (db.prepare('SELECT 1 FROM hydro_security_instruments WHERE contract_id = ? AND instrument_no = ?').get(body.contract_id, body.instrument_no.trim())) {
    throw fail(409, `${body.instrument_no} is already recorded on this station.`);
  }
  const id = newId('HSI');
  db.prepare(`
    INSERT INTO hydro_security_instruments (id, contract_id, beneficiary_name, instrument_type, instrument_no, issuing_bank,
      amount, valid_from, valid_to, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, body.contract_id, body.beneficiary_name, type, body.instrument_no.trim(), body.issuing_bank.trim(),
    amount, body.valid_from, body.valid_to, body.remarks || null, user?.name || null);
  db.prepare('INSERT INTO hydro_security_events (id, instrument_id, event, amount, actor) VALUES (?, ?, ?, ?, ?)')
    .run(newId('HSE'), id, 'RECORDED', amount, user?.name || null);
  return decorateInstrument(db.prepare('SELECT * FROM hydro_security_instruments WHERE id = ?').get(id));
}

/** Extend or enhance an instrument — the bank's amendment. */
export function amendInstrument(id, { amount, valid_to, remarks }, user) {
  const i = db.prepare('SELECT * FROM hydro_security_instruments WHERE id = ?').get(id);
  if (!i) throw fail(404, 'Instrument not found');
  if (i.status !== 'ACTIVE') throw fail(400, `${i.instrument_no} is ${i.status} and cannot be amended.`);
  const newAmount = amount != null && amount !== '' ? money(amount) : i.amount;
  const newTo = valid_to || i.valid_to;
  if (!(newAmount > i.invoked_amount)) throw fail(400, 'The amount cannot fall to or below what has already been invoked.');
  if (newTo <= i.valid_from) throw fail(400, 'valid_to must be after valid_from.');
  db.prepare(`UPDATE hydro_security_instruments SET amount = ?, valid_to = ?, remarks = COALESCE(?, remarks), updated_at = datetime('now') WHERE id = ?`)
    .run(newAmount, newTo, remarks || null, id);
  db.prepare('INSERT INTO hydro_security_events (id, instrument_id, event, amount, remarks, actor) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId('HSE'), id, 'AMENDED', newAmount, `valid to ${newTo}${remarks ? ` — ${remarks}` : ''}`, user?.name || null);
  return decorateInstrument(db.prepare('SELECT * FROM hydro_security_instruments WHERE id = ?').get(id));
}

/**
 * Invoke an instrument for unpaid bills. What the bank pays is money received
 * from the beneficiary's side, so it goes onto the account as a credit and
 * clears the overdue bills, oldest first.
 */
export function invokeInstrument(id, { amount, invoked_on, remarks }, user) {
  const i = decorateInstrument(db.prepare('SELECT * FROM hydro_security_instruments WHERE id = ?').get(id) || {});
  if (!i.id) throw fail(404, 'Instrument not found');
  if (i.effective_status !== 'ACTIVE') throw fail(400, `${i.instrument_no} is ${i.effective_status} — only a live instrument can be invoked.`);
  const amt = money(amount);
  if (!(amt > 0) || amt > i.available + 0.005) throw fail(400, `Up to ₹${i.available.toLocaleString('en-IN')} can be invoked on ${i.instrument_no}.`);
  const overdue = openDebits(i.contract_id, i.beneficiary_name).filter((d) => d.due_date && d.due_date < today());
  const overdueTotal = money(overdue.reduce((a, d) => a + d.outstanding, 0));
  if (amt > overdueTotal + 0.005) {
    throw fail(400, `${i.beneficiary_name} has ₹${overdueTotal.toLocaleString('en-IN')} overdue; an instrument is invoked for overdue bills only.`);
  }
  const why = String(remarks || '').trim();
  if (why.length < 5) throw fail(400, 'Record why the instrument is invoked.');
  const on = invoked_on || today();
  let posted;
  db.transaction(() => {
    posted = postSpecialCredit({
      contractId: i.contract_id, beneficiaryName: i.beneficiary_name, amount: amt, onDate: on,
      mode: 'LC_INVOCATION', reference: i.instrument_no,
      info: `${i.instrument_type} ${i.instrument_no} (${i.issuing_bank}) invoked: ${why}`,
      createdBy: user?.id || null, targetDebitIds: overdue.map((d) => d.id),
    });
    const invoked = money(i.invoked_amount + amt);
    db.prepare(`UPDATE hydro_security_instruments SET invoked_amount = ?, status = CASE WHEN ? >= amount - 0.005 THEN 'INVOKED' ELSE status END, updated_at = datetime('now') WHERE id = ?`)
      .run(invoked, invoked, id);
    db.prepare('INSERT INTO hydro_security_events (id, instrument_id, event, amount, ledger_doc_id, remarks, actor) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('HSE'), id, 'INVOKED', amt, posted.doc.id, why, user?.name || null);
  })();
  return { instrument: decorateInstrument(db.prepare('SELECT * FROM hydro_security_instruments WHERE id = ?').get(id)), ledger_doc: posted.doc, cleared: posted.applied };
}

export function releaseInstrument(id, { remarks }, user) {
  const i = db.prepare('SELECT * FROM hydro_security_instruments WHERE id = ?').get(id);
  if (!i) throw fail(404, 'Instrument not found');
  if (i.status !== 'ACTIVE') throw fail(400, `${i.instrument_no} is already ${i.status}.`);
  const why = String(remarks || '').trim();
  if (why.length < 5) throw fail(400, 'Record why the instrument is being released.');
  db.prepare(`UPDATE hydro_security_instruments SET status = 'RELEASED', updated_at = datetime('now') WHERE id = ?`).run(id);
  db.prepare('INSERT INTO hydro_security_events (id, instrument_id, event, remarks, actor) VALUES (?, ?, ?, ?, ?)')
    .run(newId('HSE'), id, 'RELEASED', why, user?.name || null);
  return decorateInstrument(db.prepare('SELECT * FROM hydro_security_instruments WHERE id = ?').get(id));
}

export function instrumentEvents(id) {
  return db.prepare('SELECT * FROM hydro_security_events WHERE instrument_id = ? ORDER BY created_at').all(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation (balance confirmation)
// ─────────────────────────────────────────────────────────────────────────────

export const RECON_TRANSITIONS = {
  DRAFT: ['SENT'],
  SENT: ['CONFIRMED', 'DISPUTED'],
  DISPUTED: ['SENT', 'CONFIRMED'],
  CONFIRMED: ['SIGNED_OFF'],
  SIGNED_OFF: [],
};

function decorateRecon(r) {
  return { ...r, summary: JSON.parse(r.summary_json || '{}'), allowed_next: RECON_TRANSITIONS[r.status] || [] };
}

export function listReconciliations(contractId) {
  return db.prepare('SELECT * FROM hydro_reconciliations WHERE contract_id = ? ORDER BY period_to DESC, created_at DESC')
    .all(contractId).map(decorateRecon);
}

export function getReconciliation(id) {
  const r = db.prepare('SELECT * FROM hydro_reconciliations WHERE id = ?').get(id);
  if (!r) throw fail(404, 'Reconciliation not found');
  return decorateRecon(r);
}

/** Draw up a balance confirmation statement for a beneficiary and a period. */
export function createReconciliation(body, user) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!body.contract_id || !body.beneficiary_name) throw fail(400, 'contract_id and beneficiary_name are required');
  if (!iso.test(body.period_from || '') || !iso.test(body.period_to || '')) throw fail(400, 'period_from and period_to must be dates');
  if (body.period_to < body.period_from) throw fail(400, 'period_to is before period_from');
  if (body.period_to > today()) throw fail(400, 'A balance can only be confirmed up to today.');
  const has = db.prepare('SELECT 1 FROM hydro_ledger_docs WHERE contract_id = ? AND beneficiary_name = ? LIMIT 1').get(body.contract_id, body.beneficiary_name);
  if (!has) throw fail(400, `${body.beneficiary_name} has no account on this station.`);
  const clash = db.prepare(`
    SELECT statement_no FROM hydro_reconciliations
    WHERE contract_id = ? AND beneficiary_name = ? AND period_from = ? AND period_to = ? AND status <> 'SIGNED_OFF'
  `).get(body.contract_id, body.beneficiary_name, body.period_from, body.period_to);
  if (clash) throw fail(409, `${clash.statement_no} already covers this period and is still open.`);

  const st = ledgerStatement(body.contract_id, body.beneficiary_name, body.period_from, body.period_to);
  const year = new Date().getFullYear();
  const no = `HREC/${year}/${String(nextSeriesNo('HREC', year)).padStart(4, '0')}`;
  const id = newId('HRC');
  db.prepare(`
    INSERT INTO hydro_reconciliations (id, statement_no, contract_id, beneficiary_name, period_from, period_to,
      opening_balance, closing_balance, summary_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, no, body.contract_id, body.beneficiary_name, body.period_from, body.period_to,
    st.opening_balance, st.closing_balance, JSON.stringify(st), user?.name || null);
  return getReconciliation(id);
}

export function moveReconciliation(id, { to, beneficiary_balance, remarks }, user) {
  const r = db.prepare('SELECT * FROM hydro_reconciliations WHERE id = ?').get(id);
  if (!r) throw fail(404, 'Reconciliation not found');
  const allowed = RECON_TRANSITIONS[r.status] || [];
  if (!allowed.includes(to)) throw fail(400, `A statement that is ${r.status} can move to ${allowed.join(', ') || 'nothing further'}, not ${to}.`);
  let theirs = r.beneficiary_balance;
  let diff = r.difference;
  if (to === 'CONFIRMED' || to === 'DISPUTED') {
    if (beneficiary_balance === undefined || beneficiary_balance === '' || !Number.isFinite(Number(beneficiary_balance))) {
      throw fail(400, 'Enter the closing balance the beneficiary confirmed in its reply.');
    }
    theirs = money(beneficiary_balance);
    diff = money(r.closing_balance - theirs);
    if (to === 'CONFIRMED' && Math.abs(diff) > 1) {
      throw fail(400, `The beneficiary's balance differs from ours by ₹${diff.toLocaleString('en-IN')} — record it as DISPUTED, not confirmed.`);
    }
    if (to === 'DISPUTED' && String(remarks || '').trim().length < 5) {
      throw fail(400, 'Record what the beneficiary says the difference is made of.');
    }
  }
  db.prepare(`
    UPDATE hydro_reconciliations SET status = ?, beneficiary_balance = ?, difference = ?,
      beneficiary_remarks = COALESCE(?, beneficiary_remarks),
      sent_on = CASE WHEN ? = 'SENT' THEN date('now') ELSE sent_on END,
      signed_off_by = CASE WHEN ? = 'SIGNED_OFF' THEN ? ELSE signed_off_by END,
      signed_off_at = CASE WHEN ? = 'SIGNED_OFF' THEN datetime('now') ELSE signed_off_at END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(to, theirs ?? null, diff ?? null, remarks || null, to, to, user?.name || null, to, id);
  return getReconciliation(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// TDS deducted by beneficiaries
// ─────────────────────────────────────────────────────────────────────────────

export const TDS_SECTIONS = ['194Q', '194C', '194J', '194H', 'OTHER'];

function fyQuarter(iso) {
  const [y, m] = iso.slice(0, 7).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  const q = m >= 4 && m <= 6 ? 'Q1' : m >= 7 && m <= 9 ? 'Q2' : m >= 10 && m <= 12 ? 'Q3' : 'Q4';
  return { financial_year: `${start}-${String((start + 1) % 100).padStart(2, '0')}`, quarter: q };
}

export function listTds({ contractId, financialYear = null, status = null } = {}) {
  let sql = `
    SELECT t.*, d.doc_no AS ledger_doc_no FROM hydro_tds_entries t
    LEFT JOIN hydro_ledger_docs d ON d.id = t.ledger_doc_id WHERE t.contract_id = ?`;
  const params = [contractId];
  if (financialYear) { sql += ' AND t.financial_year = ?'; params.push(financialYear); }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  sql += ' ORDER BY t.deduction_date DESC, t.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  const byQuarter = {};
  for (const r of rows) {
    if (r.status === 'REVERSED') continue;
    const k = `${r.financial_year} ${r.quarter}`;
    byQuarter[k] ||= { period: k, deducted: 0, certificates_pending: 0, matched: 0 };
    byQuarter[k].deducted = money(byQuarter[k].deducted + r.tds_amount);
    if (r.status === 'PENDING_CERTIFICATE') byQuarter[k].certificates_pending += 1;
    if (r.status === 'MATCHED_26AS') byQuarter[k].matched += 1;
  }
  return { rows, by_quarter: Object.values(byQuarter) };
}

/**
 * Record TDS a beneficiary deducted from a payment. It settles that much of
 * the beneficiary's bills — the tax was paid to government on SJVN's account —
 * so it is posted to the ledger as a credit, but kept apart from money received.
 */
export function recordTds(body, user) {
  const amount = money(body.tds_amount);
  if (!(amount > 0)) throw fail(400, 'The TDS amount must be greater than zero.');
  if (!TDS_SECTIONS.includes(body.section)) throw fail(400, `section must be one of ${TDS_SECTIONS.join(', ')}`);
  if (!body.contract_id || !body.beneficiary_name) throw fail(400, 'contract_id and beneficiary_name are required');
  const on = /^\d{4}-\d{2}-\d{2}$/.test(String(body.deduction_date || '')) ? body.deduction_date : null;
  if (!on) throw fail(400, 'deduction_date is required (YYYY-MM-DD)');
  if (on > today()) throw fail(400, 'The deduction date cannot be in the future.');
  if (body.deductor_tan && !/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(String(body.deductor_tan).toUpperCase())) {
    throw fail(400, 'The deductor TAN must be 4 letters, 5 digits and a letter (e.g. DELA12345B).');
  }
  const has = db.prepare('SELECT 1 FROM hydro_ledger_docs WHERE contract_id = ? AND beneficiary_name = ? LIMIT 1').get(body.contract_id, body.beneficiary_name);
  if (!has) throw fail(400, `${body.beneficiary_name} has no account on this station.`);

  const { financial_year, quarter } = fyQuarter(on);
  const id = newId('HTD');
  let posted;
  db.transaction(() => {
    posted = postSpecialCredit({
      contractId: body.contract_id, beneficiaryName: body.beneficiary_name, amount, onDate: on, mode: 'TDS',
      reference: body.reference || null,
      info: `TDS u/s ${body.section} deducted by ${body.beneficiary_name}${body.reference ? ` on ${body.reference}` : ''}`,
      createdBy: user?.id || null,
    });
    db.prepare(`
      INSERT INTO hydro_tds_entries (id, contract_id, beneficiary_name, ledger_doc_id, section, tds_amount, deduction_date,
        financial_year, quarter, deductor_tan, reference, remarks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, body.contract_id, body.beneficiary_name, posted.doc.id, body.section, amount, on, financial_year, quarter,
      body.deductor_tan ? String(body.deductor_tan).toUpperCase() : null, body.reference || null, body.remarks || null, user?.name || null);
  })();
  return { entry: db.prepare('SELECT * FROM hydro_tds_entries WHERE id = ?').get(id), ledger_doc: posted.doc, cleared: posted.applied };
}

/** Form 16A received, or the 26AS checked. */
export function updateTdsCertificate(id, body) {
  const t = db.prepare('SELECT * FROM hydro_tds_entries WHERE id = ?').get(id);
  if (!t) throw fail(404, 'TDS entry not found');
  if (t.status === 'REVERSED') throw fail(400, 'This entry was reversed.');
  if (body.amount_26as !== undefined && body.amount_26as !== '') {
    const a = money(body.amount_26as);
    const status = Math.abs(a - t.tds_amount) <= 1 ? 'MATCHED_26AS' : 'MISMATCH_26AS';
    db.prepare(`UPDATE hydro_tds_entries SET amount_26as = ?, status = ?, remarks = COALESCE(?, remarks), updated_at = datetime('now') WHERE id = ?`)
      .run(a, status, body.remarks || null, id);
  } else {
    if (!String(body.certificate_no || '').trim()) throw fail(400, 'Enter the Form 16A certificate number.');
    db.prepare(`
      UPDATE hydro_tds_entries SET certificate_no = ?, certificate_date = ?,
        status = CASE WHEN status = 'PENDING_CERTIFICATE' THEN 'CERTIFICATE_RECEIVED' ELSE status END,
        updated_at = datetime('now') WHERE id = ?
    `).run(body.certificate_no.trim(), body.certificate_date || today(), id);
  }
  return db.prepare('SELECT * FROM hydro_tds_entries WHERE id = ?').get(id);
}

export { accountDisplay };
