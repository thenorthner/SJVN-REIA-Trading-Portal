/**
 * S2: an LC / BG invocation as a claim on the bank (Batch 5, 17-Oct-2026).
 *
 * Once SJVN lodges the claim, the bank has a fixed window to honour or refuse
 * it — `bank_response_days`, 7 by default, as letters of credit under UCP 600
 * and demand guarantees under URDG 758 allow a bank at most five banking days
 * to examine a demand. The tracker shows each lodged claim, its due date and
 * whether the bank is late; a late claim is flagged once to the security desk
 * and Finance. The bank's answer — the settlement or refusal letter — is filed
 * against the invocation.
 */
import db from '../db/index.js';
import { pushNotification, logAudit } from '../util.js';
import { getParamNumber } from '../mastersService.js';

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const fail = (status, message) => Object.assign(new Error(message), { status });

/** The claim details a move to CLAIMED must carry; returns the columns to set. */
export function claimFields(body = {}, today = istToday()) {
  const on = String(body.claim_submitted_on || today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > today) throw fail(400, 'The claim submission date must be a date not after today.');
  const ref = String(body.claim_reference || '').trim().slice(0, 120) || null;
  return { claim_submitted_on: on, claim_reference: ref, bank_response_due: addDays(on, getParamNumber('bank_response_days', 7)) };
}

/** The bank's answer date on FUNDS_RECEIVED / REJECTED after a claim. */
export function responseDate(inv, body = {}, today = istToday()) {
  const on = String(body.bank_responded_on || today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > today) throw fail(400, 'The bank\'s answer date must be a date not after today.');
  if (inv.claim_submitted_on && on < inv.claim_submitted_on) throw fail(400, `The bank cannot answer before the claim was lodged (${inv.claim_submitted_on}).`);
  return on;
}

function shape(i, today) {
  const waiting = i.status === 'CLAIMED';
  const answeredIn = i.bank_responded_on && i.claim_submitted_on ? days(i.claim_submitted_on, i.bank_responded_on) : null;
  return {
    id: i.id, invocation_no: i.invocation_no, contract_no: i.contract_no, instrument_no: i.instrument_no, mechanism_type: i.mechanism_type,
    amount: i.amount, status: i.status, claim_submitted_on: i.claim_submitted_on, claim_reference: i.claim_reference,
    bank_response_due: i.bank_response_due, bank_responded_on: i.bank_responded_on,
    days_waiting: waiting && i.claim_submitted_on ? days(i.claim_submitted_on, today) : null,
    days_to_due: waiting && i.bank_response_due ? days(today, i.bank_response_due) : null,
    bank_late: waiting ? !!i.bank_response_due && today > i.bank_response_due : answeredIn != null && i.bank_response_due ? i.bank_responded_on > i.bank_response_due : false,
    answered_in_days: answeredIn,
    letter: i.outcome_letter_file ? { name: i.outcome_letter_name } : null,
    letter_due: ['FUNDS_RECEIVED', 'REJECTED'].includes(i.status) && !!i.claim_submitted_on && !i.outcome_letter_file,
  };
}

export function claimTracker({ today = istToday() } = {}) {
  const rows = db.prepare(`
    SELECT si.*, c.contract_no, ps.instrument_no, ps.mechanism_type FROM security_invocations si
    JOIN contracts c ON c.id = si.contract_id LEFT JOIN payment_security ps ON ps.id = si.payment_security_id
    WHERE si.claim_submitted_on IS NOT NULL OR si.status = 'CLAIMED'
    ORDER BY (si.status = 'CLAIMED') DESC, si.bank_response_due, si.created_at DESC
  `).all().map((i) => shape(i, today));
  const open = rows.filter((r) => r.status === 'CLAIMED');
  return {
    response_days: getParamNumber('bank_response_days', 7),
    rows,
    totals: {
      awaiting_bank: open.length, late: open.filter((r) => r.bank_late).length,
      amount_awaiting: Math.round(open.reduce((a, r) => a + (Number(r.amount) || 0), 0)),
      letters_missing: rows.filter((r) => r.letter_due).length,
    },
  };
}

/** Flag each claim the bank has not answered in time, once. */
export function alertLateBankClaims({ today = istToday() } = {}) {
  let sent = 0;
  for (const i of db.prepare(`
    SELECT si.*, c.contract_no FROM security_invocations si JOIN contracts c ON c.id = si.contract_id
    WHERE si.status = 'CLAIMED' AND si.bank_response_due IS NOT NULL AND si.bank_response_due < ? AND si.bank_late_alerted_at IS NULL
  `).all(today)) {
    const msg = `${i.invocation_no} (${i.contract_no}): the bank has not honoured or refused the ₹${Number(i.amount).toLocaleString('en-IN')} claim lodged on ${i.claim_submitted_on} — its answer was due ${i.bank_response_due}. Chase the bank and record its letter.`;
    for (const role of ['REIA_ADMIN', 'REIA_USER', 'FINANCE_USER']) pushNotification({ role, type: 'SECURITY_CLAIM_LATE', message: msg });
    db.prepare(`UPDATE security_invocations SET bank_late_alerted_at = datetime('now') WHERE id = ?`).run(i.id);
    logAudit({ user: { id: null, name: 'system', role: 'SYSTEM' }, action: 'BANK_CLAIM_LATE', module: 'REIA', entityType: 'security_invocation', entityId: i.id, details: { due: i.bank_response_due } });
    sent += 1;
  }
  return { sent };
}
