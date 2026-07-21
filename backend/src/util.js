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
