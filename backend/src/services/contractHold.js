/**
 * Contract hold (CC4) and compliance requests (CC2) — Batch 3, 17-Oct-2026.
 *
 * A live contract with a serious breach — payment security short on a live
 * contract, or its counterparty blacklisted or its statutory approvals lapsed —
 * is on hold: no new SJVN bill is generated on it and its buyer is not
 * scheduled or bid for. The desk may also put a contract on hold by hand. Only
 * Management lifts an automatic hold, with a reason, for at most 30 days; a
 * hold put on by hand is released by hand.
 *
 * From a breached or expiring item the desk asks the counterparty for the
 * document in one click (CC2), on the Document Desk request flow.
 */
import db from '../db/index.js';
import { newId, logAudit, pushNotification } from '../util.js';
import { contractCompliance } from './contractCompliance.js';

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const OVERRIDE_MAX_DAYS = 30;

/** Where a contract stands on hold, and why (worked out in the compliance register). */
export function holdStatus(contractId) {
  const row = contractCompliance({ contractId }).contracts[0];
  if (!row) return { on_hold: false, breaches: [] };
  return { contract_id: row.contract_id, contract_no: row.contract_no, ...row.hold };
}

/** Refuse an action on a contract that is on hold. */
export function assertNotOnHold(contractId, action) {
  const h = holdStatus(contractId);
  if (h.on_hold) {
    throw err(423, `${h.contract_no} is on hold, so ${action} is stopped: ${h.reason}. ${h.manual ? 'Release the hold' : 'Clear the breach, or Management may lift the hold for a stated time'} to go on.`, { hold: h });
  }
}

export function setManualHold(contractId, { on, reason, user, req = null }) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  if (!c) throw err(404, 'Contract not found');
  const why = String(reason || '').trim();
  if (why.length < 15) throw err(400, 'Give the reason in a sentence (at least 15 characters).');
  if (!!c.on_hold === !!on) throw err(400, `${c.contract_no} is ${on ? 'already' : 'not'} on hold by hand.`);
  db.prepare(`UPDATE contracts SET on_hold = ?, hold_reason = ?, hold_set_by = ?, hold_set_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(on ? 1 : 0, on ? why : null, on ? user.name : null, c.id);
  logAudit({ req, user, action: on ? 'CONTRACT_HOLD' : 'CONTRACT_HOLD_RELEASED', module: 'REIA', entityType: 'contract', entityId: c.id, reason: why });
  for (const role of ['REIA_MAKER', 'REIA_CHECKER', 'FINANCE_USER', 'MANAGEMENT']) {
    pushNotification({ role, type: 'CONTRACT_HOLD', message: `${c.contract_no} ${on ? 'put on hold' : 'released from hold'} by ${user.name}: ${why}` });
  }
  return holdStatus(c.id);
}

export function overrideHold(contractId, { reason, validUntil, user, req = null }) {
  const h = holdStatus(contractId);
  if (!h.breaches.length) throw err(400, 'There is no breach on this contract to override.');
  const why = String(reason || '').trim();
  if (why.length < 15) throw err(400, 'Give the reason in a sentence (at least 15 characters).');
  const latest = new Date(Date.now() + OVERRIDE_MAX_DAYS * 86400000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(validUntil || '')) || validUntil < today() || validUntil > latest) {
    throw err(400, `Give the date the override runs to — today to ${latest} at most.`);
  }
  const id = newId('CHO');
  db.prepare('INSERT INTO contract_hold_overrides (id, contract_id, reason, approved_by, approved_by_id, valid_until) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, contractId, why, user.name, user.id || null, validUntil);
  logAudit({ req, user, action: 'CONTRACT_HOLD_OVERRIDE', module: 'REIA', entityType: 'contract', entityId: contractId, reason: why, details: { valid_until: validUntil, breaches: h.breaches.map((b) => b.code) } });
  return holdStatus(contractId);
}

/** CC2: ask the counterparty for what a check needs, on the Document Desk. */
const REQUEST_FOR = {
  SECURITY: (c) => ({ document_type: 'PAYMENT_SECURITY', note: `${c.contract_no}: lodge or extend the payment security the contract requires (letter of credit / guarantee) and upload the bank's instrument.` }),
  APPROVALS: (c) => ({ document_type: 'REGULATORY_APPROVAL', note: `${c.contract_no}: renew or submit the statutory approvals listed as lapsed or missing, and upload them.` }),
  TENURE: (c) => ({ document_type: 'CONTRACT_EXTENSION', note: `${c.contract_no}: the contract term is ending — send the extension / renewal papers.` }),
};
export function requestFromCheck(contractId, code, { dueDate = null, user, req = null }) {
  const row = contractCompliance({ contractId }).contracts[0];
  if (!row) throw err(404, 'Contract not found');
  const check = row.checks.find((k) => k.code === code);
  if (!check) throw err(400, `${row.contract_no} has no ${code} check`);
  if (!['BREACH', 'DUE'].includes(check.state)) throw err(400, `${check.label} on ${row.contract_no} is in order — there is nothing to ask for.`);
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId);
  const entityId = c.contract_type === 'PPA' ? c.seller_id : c.buyer_id;
  const make = REQUEST_FOR[code] || ((x) => ({ document_type: code, note: `${x.contract_no}: ${check.label} — ${check.detail}` }));
  const { document_type: docType, note } = make(c);
  const open = db.prepare(`SELECT id FROM document_requests WHERE entity_id = ? AND document_type = ? AND status = 'OPEN' AND note LIKE ?`).get(entityId, docType, `${c.contract_no}:%`);
  if (open) throw err(409, `An open request for this is already with the counterparty (${open.id}).`);
  const due = dueDate || new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const id = `DRQ-${newId('X').slice(-12)}`;
  db.prepare('INSERT INTO document_requests (id, entity_id, document_type, note, due_date, requested_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, entityId, docType, `${note} (${check.detail})`.slice(0, 1000), due, user.id || null);
  for (const u of db.prepare('SELECT id FROM users WHERE linked_entity_id = ? AND is_active = 1').all(entityId)) {
    pushNotification({ userId: u.id, type: 'DOCUMENT_REQUEST', message: `SJVN has asked for a document on ${c.contract_no}: ${docType.replace(/_/g, ' ').toLowerCase()} — by ${due}. Upload it under My Documents.` });
  }
  logAudit({ req, user, action: 'COMPLIANCE_DOCUMENT_REQUESTED', module: 'REIA', entityType: 'contract', entityId: c.id, details: { code, document_type: docType, request_id: id } });
  return db.prepare('SELECT * FROM document_requests WHERE id = ?').get(id);
}
