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

/** Whether a counterparty may see this contract, and so anything hanging off it. */
export function contractVisibleTo(user, contract) {
  if (!user || !contract) return false;
  const side = counterpartySide(user);
  if (side === null) return true;              // internal role, scoped by requireRole instead
  if (!user.linked_entity_id) return false;    // a counterparty with no entity is party to nothing
  if (side === 'SELLER') return contract.seller_id === user.linked_entity_id;
  if (side === 'BUYER') return contract.buyer_id === user.linked_entity_id;
  return false;
}

// Statuses at which a bill has actually been put in front of its counterparty.
// The send route has always used APPROVED as the bar for distribution; anything
// short of it is SJVN still working on the bill. CANCELLED stays visible because
// a withdrawn bill is one the counterparty did receive and should be able to see
// — it just cannot be disputed any more.
export const PRESENTED_STATUSES = ['APPROVED', 'SENT', 'DISPUTED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];

/** Whether a counterparty is entitled to see this invoice at all yet. */
export function invoicePresentedTo(user, invoice) {
  if (!invoice) return false;
  if (counterpartySide(user) === null) return true;   // SJVN sees its own drafts
  return PRESENTED_STATUSES.includes(invoice.status);
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
