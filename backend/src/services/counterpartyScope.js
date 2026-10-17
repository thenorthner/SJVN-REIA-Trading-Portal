import { counterpartySide } from '../middleware/auth.js';

// Who a counterparty is allowed to read.
//
// The list endpoints have always scoped by the caller's own entity, and the
// invoice PDF route refuses a counterparty someone else's bill. The detail
// routes did neither: any authenticated user could fetch any invoice, contract
// or entity by id. Being able to list only your own rows means little when the
// id in the URL is the only thing standing between a competing DISCOM and a
// counterparty's tariff, billed totals and open disputes.
//
// The rule these share: an internal SJVN role sees everything, and a seller or
// buyer sees only what its own entity is a party to. Anything the caller is not
// a party to answers 404 rather than 403 — a 403 confirms the record exists,
// which is itself worth something to someone enumerating ids.

/** True when the caller is a seller/buyer counterparty rather than SJVN staff. */
export function isCounterparty(user) {
  return counterpartySide(user) !== null;
}

/**
 * Whether a counterparty may see this contract, and so anything hanging off it.
 *
 * Not a DRAFT: that is SJVN's working copy, still being keyed in, and its
 * tariff is not one anybody has agreed to. The counterparty home already left
 * drafts out; the contract list and detail showed a buyer a draft PSA at a
 * tariff nobody had offered it.
 */
export function contractVisibleTo(user, contract) {
  if (!user || !contract) return false;
  const side = counterpartySide(user);
  if (side === null) return true;              // internal role, scoped by requireRole instead
  if (!user.linked_entity_id) return false;    // a counterparty with no entity is party to nothing
  if (contract.status === 'DRAFT') return false;
  if (side === 'SELLER') return contract.seller_id === user.linked_entity_id;
  if (side === 'BUYER') return contract.buyer_id === user.linked_entity_id;
  return false;
}

// What SJVN keeps to itself on a contract it shows a counterparty: its own
// margin on the trade, and the desk's remarks (which say things like "carved
// out from the 250 MW Solar PPA"). Each side contracts with SJVN, not with the
// other, so a seller is not told who buys its power and a buyer is not told
// whose plant it comes from — the PPA→PSA routing is SJVN's own business.
const SJVN_ONLY_TERMS = ['trading_margin_per_mwh', 'remarks'];
const OTHER_SIDE = {
  SELLER: ['buyer_id', 'buyer_name'],
  BUYER: ['seller_id', 'seller_name', 'projects'],
};

/** A contract as a counterparty may read it. SJVN gets it whole. */
export function contractForCounterparty(user, contract) {
  const side = counterpartySide(user);
  if (side === null || !contract) return contract;
  const out = { ...contract };
  for (const k of [...SJVN_ONLY_TERMS, ...OTHER_SIDE[side]]) delete out[k];
  return out;
}

/** An amendment's changed terms, without the ones SJVN keeps to itself. */
export function changedTermsForCounterparty(user, changed) {
  if (counterpartySide(user) === null || !changed || typeof changed !== 'object') return changed;
  return Object.fromEntries(Object.entries(changed).filter(([k]) => !SJVN_ONLY_TERMS.includes(k)));
}

// Statuses at which a bill has actually been put in front of its counterparty.
// The send route has always used APPROVED as the bar for distribution; anything
// short of it is SJVN still working on the bill. CANCELLED stays in the list
// because a withdrawn bill is one the counterparty did receive and should be
// able to see — it just cannot be disputed any more. Whether a particular
// cancelled bill ever was received is a separate question, answered below.
export const PRESENTED_STATUSES = ['APPROVED', 'SENT', 'DISPUTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
const LIVE_PRESENTED = PRESENTED_STATUSES.filter((s) => s !== 'CANCELLED');

/**
 * Whether a bill has been presented, as SQL over an invoices alias.
 *
 * A status alone cannot say it for a cancelled bill. Cancelling is only allowed
 * before approval, so almost every CANCELLED row is a draft SJVN threw away —
 * and listing those to the buyer showed it bills it was never sent, a negative
 * test arrear among them. A cancelled bill is the counterparty's to see only if
 * it had been issued first, which issued_at records.
 */
export function presentedSql(alias = 'i') {
  // A DSM bill settles with the NRPC pool, not with the contract's seller or
  // buyer, so it is never presented to them (decided 17-Oct-2026).
  return `((${alias}.status IN (${LIVE_PRESENTED.map((s) => `'${s}'`).join(',')})`
    + ` OR (${alias}.status = 'CANCELLED' AND ${alias}.issued_at IS NOT NULL))`
    + ` AND ${alias}.invoice_no NOT LIKE 'DSM-%')`;
}

/** The same rule for one invoice row. */
export function isPresented(invoice) {
  if (!invoice) return false;
  if (String(invoice.invoice_no || '').startsWith('DSM-')) return false;
  if (invoice.status === 'CANCELLED') return !!invoice.issued_at;
  return LIVE_PRESENTED.includes(invoice.status);
}

/** Whether a counterparty is entitled to see this invoice at all yet. */
export function invoicePresentedTo(user, invoice) {
  if (!invoice) return false;
  if (counterpartySide(user) === null) return true;   // SJVN sees its own drafts
  return isPresented(invoice);
}

/**
 * Whether a bill on a PPA is the seller's own, as against SJVN's computation of
 * the same period.
 *
 * Both run Seller → SJVN, so direction cannot tell them apart. What can: every
 * bill SJVN raises (generated, arrear, supplementary, debit note) carries the
 * line-by-line breakdown it was computed from, and a bill a seller keys in or
 * loads from its sheet never does. findSystemCounterpart reads the same mark.
 */
export function raisedBySeller(invoice) {
  return !!invoice && invoice.direction === 'SELLER_TO_SJVN' && !String(invoice.invoice_breakdown_json || '').trim();
}

/** raisedBySeller as SQL over an invoices alias. */
export function raisedBySellerSql(alias = 'i') {
  return `(${alias}.direction = 'SELLER_TO_SJVN' AND TRIM(COALESCE(${alias}.invoice_breakdown_json, '')) = '')`;
}

/**
 * Whether the caller wrote this bill.
 *
 * A seller's own invoice to SJVN is the seller's document from the moment it is
 * saved; the presented bar above is for bills SJVN issues to a counterparty.
 * Applied to both, it hid a seller's submitted and rejected invoices from the
 * seller that raised them. Ownership is checked separately, by contractVisibleTo.
 *
 * It used to answer yes for anything Seller → SJVN, which handed the seller
 * SJVN's own draft of the period — listed as the seller's invoice, with "Send
 * to checker" on it.
 */
export function authoredBy(user, invoice) {
  return counterpartySide(user) === 'SELLER' && raisedBySeller(invoice);
}

/**
 * The date a bill's dispute window runs from.
 *
 * PSA Art. 6.7.1 measures the window from presentation. Nothing recorded
 * presentation, so it was measured from row creation — a bill that sat in draft
 * for three weeks reached its counterparty already conclusive.
 */
export function billPresentedOn(invoice) {
  return invoice?.issued_at || invoice?.created_at || null;
}

/**
 * Whether a counterparty may see this entity record.
 *
 * Its own, and no one else's. In REIA both sides contract with SJVN rather than
 * with each other, so a seller has no reason to read a buyer's PAN, bank details
 * or regulatory file — and the invoice payloads already carry the counterparty
 * names that a screen legitimately needs.
 */
export function entityVisibleTo(user, entityId) {
  if (!user || !entityId) return false;
  if (counterpartySide(user) === null) return true;
  return entityId === user.linked_entity_id;
}
