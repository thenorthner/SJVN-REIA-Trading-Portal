import db from '../db/index.js';

// What a supplementary bill was raised for, read the same way by the surcharge
// and the rebate (31-Oct-2026). Neither looked: a supplementary raised for
// surcharge earned surcharge on itself, and one raised for Change in Law or
// surcharge earned the early-payment rebate the bill's own terms rule out.

// The labels the supplementary route wrote before its line carried the code.
const LEGACY_LABEL = {
  'Change in Law': 'CHANGE_IN_LAW',
  'Late Payment Surcharge': 'LPS',
  'LPS adjustment': 'LPS_ADJUSTMENT',
};

/**
 * The reason code of a supplementary bill: from the line the supplementary
 * route writes, or from the debit note it was issued as. null for any other bill.
 */
export function supplementaryReason(inv) {
  if (!inv || inv.invoice_type !== 'SUPPLEMENTARY') return null;
  let lines = [];
  try { lines = JSON.parse(inv.invoice_breakdown_json || '[]'); } catch { lines = []; }
  const supp = Array.isArray(lines) ? lines.find((l) => l && l.code === 'SUPP') : null;
  if (supp?.reason_code) return supp.reason_code;
  if (supp?.label) {
    const hit = Object.keys(LEGACY_LABEL).find((label) => String(supp.label).startsWith(`${label} — `));
    if (hit) return LEGACY_LABEL[hit];
  }
  if (!inv.id) return null;
  const note = db.prepare(`SELECT reason_code FROM debit_credit_notes WHERE supp_invoice_id = ? AND note_type = 'DEBIT'`).get(inv.id);
  return note?.reason_code || null;
}

/** A bill that is itself surcharge: the month's LPS bill, or a supplementary or debit note raised for it. */
export function isSurchargeBill(inv) {
  if (String(inv?.invoice_no || '').startsWith('LPS-')) return true;
  return ['LPS', 'LPS_ADJUSTMENT'].includes(supplementaryReason(inv));
}

/** A bill raised for a Change in Law claim. */
export function isChangeInLawBill(inv) {
  return supplementaryReason(inv) === 'CHANGE_IN_LAW';
}
