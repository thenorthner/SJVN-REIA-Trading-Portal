import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import db from './db/index.js';

export const newId = (prefix) => `${prefix}-${uuidv4().slice(0, 8)}`;

// ── Invoice verification (QR-code authenticity) ──────────────────────────────
// A short HMAC of the invoice id. Printed into the QR so the public /verify
// page can prove the scanned bill was genuinely issued by this platform and
// was not forged. Uses the same secret as auth tokens.
const VERIFY_SECRET = process.env.JWT_SECRET || 'sjvn-dev-secret-change-me';

export function invoiceVerifyToken(invoiceId) {
  return crypto.createHmac('sha256', VERIFY_SECRET).update(`invoice:${invoiceId}`).digest('hex').slice(0, 16);
}

export function verifyInvoiceToken(invoiceId, token) {
  if (!token) return false;
  const expected = invoiceVerifyToken(invoiceId);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');

import { secureLogAudit } from './auditEngine.js';

export function logAudit({ req, user, action, module, entityType, entityId, beforeValue, afterValue, reason, details }) {
  secureLogAudit(req || { user }, {
    action,
    module,
    entityType,
    entityId,
    beforeValue,
    afterValue,
    reason,
    details
  });
}

export function pushNotification({ userId = null, role = null, type, message }) {
  const stmt = db.prepare(`
    INSERT INTO notifications (id, user_id, role, type, message)
    VALUES (@id, @userId, @role, @type, @message)
  `);
  stmt.run({ id: newId('NTF'), userId, role, type, message });
}

export function genInvoiceNo(prefix = 'INV') {
  const rand = Math.floor(100000 + Math.random() * 900000);
  const year = new Date().getFullYear();
  return `${prefix}/${year}/${rand}`;
}

/** Sanitize contract_no for use inside Billing Family Reference paths. */
export function sanitizeContractNo(contractNo) {
  return String(contractNo || 'UNKNOWN')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase() || 'UNKNOWN';
}

/** Map invoice direction to BFR suffix. */
export function directionCode(direction) {
  return direction === 'SJVN_TO_BUYER' ? 'S2B' : 'S2S';
}

/**
 * Stable Billing Family Reference linking provisional energy → invoice → payments → final.
 * Format: BFR/{CONTRACT_NO}/{YYYY-MM}/{S2S|S2B}
 */
export function buildBillingFamilyRef(contractNo, periodMonth, direction = 'SELLER_TO_SJVN') {
  return `BFR/${sanitizeContractNo(contractNo)}/${periodMonth}/${directionCode(direction)}`;
}

/** Direction implied by contract type (PPA = seller bills, PSA = SJVN→buyer). */
export function directionForContract(contract) {
  return contract?.contract_type === 'PSA' ? 'SJVN_TO_BUYER' : 'SELLER_TO_SJVN';
}

/* ─────────── Structured billing-rule helpers ───────────
 * The contract carries machine-readable fields (payment_terms_days, rebate_pct,
 * rebate_days, rebate_basis, lps_annual_pct, lps_grace_days). These helpers turn
 * them into due dates, rebate eligibility and human-readable strings so the
 * billing engine and the UI stay in sync.
 */

/** Payment-terms days: structured field → legacy text regex → default (30). */
export function resolvePaymentTermsDays(contract, fallback = 30) {
  if (contract?.payment_terms_days != null && contract.payment_terms_days !== '') {
    return Number(contract.payment_terms_days);
  }
  const m = String(contract?.payment_terms || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : fallback;
}

/** Add whole days to a date and return an ISO YYYY-MM-DD string. */
export function addDays(baseDate, days) {
  const d = baseDate ? new Date(baseDate) : new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().split('T')[0];
}

/** Due date = bill date + payment terms. */
export function computeDueDate(billDate, contract, fallback = 30) {
  return addDays(billDate, resolvePaymentTermsDays(contract, fallback));
}

/**
 * Early-payment rebate % this contract grants if paid by `payDate`.
 * Deadline = (rebate_basis === 'DUE_DATE' ? dueDate : billDate) + rebate_days.
 * Returns null when the contract defines no structured rebate (caller can fall
 * back to global master params).
 */
export function contractRebatePct(contract, { billDate, dueDate, payDate }) {
  const pct = Number(contract?.rebate_pct);
  if (!pct || pct <= 0) return null;
  const days = Number(contract?.rebate_days || 0);
  const ref = contract?.rebate_basis === 'DUE_DATE' ? dueDate : billDate;
  if (!ref) return null;
  const deadline = new Date(addDays(ref, days) + 'T23:59:59');
  return new Date(payDate) <= deadline ? pct : 0;
}

/** Human strings kept in sync with the structured fields (for display / PDF). */
export function humanizePaymentTerms(days) {
  return days ? `Net ${days} days from bill date` : '';
}
export function humanizeRebateRule({ rebate_pct, rebate_days, rebate_basis }) {
  if (!rebate_pct) return '';
  const ref = rebate_basis === 'DUE_DATE' ? 'due date' : 'bill date';
  return `${rebate_pct}% if paid within ${rebate_days || 0} days from ${ref}`;
}
export function humanizeLpsRule({ lps_annual_pct, lps_grace_days }) {
  if (!lps_annual_pct) return '';
  const grace = lps_grace_days ? `, ${lps_grace_days}-day grace` : '';
  return `${lps_annual_pct}% per annum on overdue amount${grace}`;
}
