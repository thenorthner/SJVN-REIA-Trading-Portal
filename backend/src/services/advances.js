/**
 * Advances / unapplied receipts (decided 17-Oct-2026).
 *
 * Money a counterparty has paid that no bill can take: a buyer paying more than
 * a bill has left, or a diversion surplus beyond what the buyer owes. It was
 * refused ("an excess is a separate advance") with nowhere for it to go, or
 * left with SJVN unrecorded. It is now held against the counterparty, and
 * Finance applies it to a later bill (as a payment with mode ADVANCE) or
 * refunds it. Every movement is an event.
 */
import db from '../db/index.js';
import { newId, nextSeriesNo } from '../util.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const err = (status, message) => Object.assign(new Error(message), { status });

function receiptNo() {
  const y = new Date().getFullYear();
  return `ADV/${y}/${String(nextSeriesNo('ADV', y)).padStart(5, '0')}`;
}

function event(receiptId, type, amount, { invoiceId = null, paymentId = null, reference = null, note = null, actor = null } = {}) {
  db.prepare(`
    INSERT INTO unapplied_receipt_events (id, receipt_id, event_type, amount, invoice_id, payment_id, reference, note, actor_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId('ARE'), receiptId, type, money(amount), invoiceId, paymentId, reference, note, actor);
}

/** Hold money as an advance against a counterparty. Returns the receipt row. */
export function recordAdvance({ entityId, contractId = null, source = 'EXCESS_PAYMENT', sourceRef = null, amount, receivedOn, reference = null, notes = null, user = null }) {
  const amt = money(amount);
  if (!(amt > 0)) throw err(400, 'An advance must be a positive amount');
  if (!entityId) throw err(400, 'An advance is held against a counterparty');
  const id = newId('ADV');
  db.prepare(`
    INSERT INTO unapplied_receipts (id, receipt_no, entity_id, contract_id, source, source_ref, amount, balance, received_on, reference, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, receiptNo(), entityId, contractId, source, sourceRef, amt, amt, receivedOn, reference, notes, user?.name || null);
  event(id, 'RECEIVED', amt, { reference, note: notes, actor: user?.name || null });
  return db.prepare('SELECT * FROM unapplied_receipts WHERE id = ?').get(id);
}

/** Take part or all of an advance off what it stands at. */
export function drawAdvance(receiptId, amount, type, { invoiceId = null, paymentId = null, reference = null, note = null, user = null } = {}) {
  const r = db.prepare('SELECT * FROM unapplied_receipts WHERE id = ?').get(receiptId);
  if (!r) throw err(404, 'Advance not found');
  if (r.status !== 'OPEN') throw err(400, `${r.receipt_no} is already ${r.status.toLowerCase()}`);
  const amt = money(amount);
  if (!(amt > 0)) throw err(400, 'The amount must be positive');
  if (amt > money(r.balance) + 0.005) throw err(400, `Only ₹${money(r.balance).toLocaleString('en-IN')} is left on ${r.receipt_no}`);
  const balance = money(r.balance - amt);
  const status = balance > 0.005 ? 'OPEN' : (type === 'REFUNDED' ? 'REFUNDED' : 'APPLIED');
  db.prepare(`UPDATE unapplied_receipts SET balance = ?, status = ?, updated_at = datetime('now') WHERE id = ?`).run(balance, status, r.id);
  event(r.id, type, amt, { invoiceId, paymentId, reference, note, actor: user?.name || null });
  return db.prepare('SELECT * FROM unapplied_receipts WHERE id = ?').get(r.id);
}

export function listAdvances({ entityId = null, status = null } = {}) {
  return db.prepare(`
    SELECT r.*, e.name AS counterparty, c.contract_no FROM unapplied_receipts r
    LEFT JOIN entities e ON e.id = r.entity_id
    LEFT JOIN contracts c ON c.id = r.contract_id
    WHERE (? IS NULL OR r.entity_id = ?) AND (? IS NULL OR r.status = ?)
    ORDER BY r.created_at DESC
  `).all(entityId, entityId, status, status);
}

export function advanceDetail(id) {
  const r = db.prepare(`
    SELECT r.*, e.name AS counterparty, c.contract_no FROM unapplied_receipts r
    LEFT JOIN entities e ON e.id = r.entity_id LEFT JOIN contracts c ON c.id = r.contract_id WHERE r.id = ?
  `).get(id);
  if (!r) return null;
  const events = db.prepare(`
    SELECT ev.*, i.invoice_no FROM unapplied_receipt_events ev LEFT JOIN invoices i ON i.id = ev.invoice_id
    WHERE ev.receipt_id = ? ORDER BY ev.created_at
  `).all(id);
  return { ...r, events };
}

/** What a counterparty holds with SJVN as advance, in total. */
export function openAdvanceBalance(entityId) {
  return money(db.prepare(`SELECT COALESCE(SUM(balance), 0) s FROM unapplied_receipts WHERE entity_id = ? AND status = 'OPEN'`).get(entityId).s);
}
