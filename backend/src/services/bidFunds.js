import db from '../db/index.js';
import { rollUp, normaliseBidType } from './bidWrite.js';

/**
 * Funds check for a buy bid.
 *
 * Exchange purchases are paid in advance, so a buyer's bids are limited to what
 * it has paid in (pre_payment_balance) plus whatever credit the trader has
 * chosen to extend (credit_limit), less what its other buy bids already hold.
 * A bid that does not fit is stopped before it reaches the exchange.
 *
 * Money already committed = buy bids that have gone out (SUBMITTED or part
 * cleared) plus approved drafts waiting to go. Cleared volume is left out: once
 * it is settled it comes off the balance through billing, and counting it here
 * as well would hold the same rupees twice. Bids with no stored side (placed
 * before the side was recorded) are not counted.
 */
const HELD_SQL = `
  SELECT b.id AS id, b.product AS product, blk.quantum_mw AS quantum_mw, blk.price_per_unit AS price_per_unit
  FROM bids b JOIN bid_blocks blk ON blk.bid_id = b.id
  WHERE b.client_id = ? AND b.bid_type = 'BUY' AND b.id != ?
    AND (b.status IN ('SUBMITTED','PARTIALLY_CLEARED') OR (b.status = 'DRAFT' AND b.approval_status = 'APPROVED'))
`;

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function committedFunds(clientId, excludeBidId = '') {
  return money(db.prepare(HELD_SQL).all(clientId, excludeBidId || '')
    .reduce((a, r) => a + rollUp([r], r.product).exposure, 0));
}

/** Where a client stands: what it has, what it may borrow, what is held, what is left. */
export function fundsPosition(client, excludeBidId = '') {
  const balance = money(client.pre_payment_balance);
  const credit = money(client.credit_limit);
  const committed = committedFunds(client.id, excludeBidId);
  return {
    pre_payment_balance: balance,
    credit_limit: credit,
    committed,
    available: money(balance + credit - committed),
  };
}

/**
 * @param {object} client trading_clients row
 * @param {string} type bid side as the caller spelled it
 * @param {number} requiredRs exposure of the bid (or the whole upload for the client)
 */
export function checkBidFunds({ client, type, requiredRs, excludeBidId = '' }) {
  const side = normaliseBidType(type);
  const position = fundsPosition(client, excludeBidId);
  const required = money(requiredRs);
  if (side !== 'BUY') return { applies: false, ok: true, required, ...position, shortfall: 0 };
  const shortfall = money(Math.max(0, required - position.available));
  return {
    applies: true,
    ok: shortfall === 0,
    required,
    ...position,
    shortfall,
    // True when the bid only fits because credit is being used.
    uses_credit: shortfall === 0 && required > money(position.pre_payment_balance - position.committed),
  };
}

export const fundsMessage = (client, f) =>
  `Insufficient funds for ${client.name}: this bid needs ₹${f.required.toLocaleString('en-IN')}, `
  + `available ₹${f.available.toLocaleString('en-IN')} `
  + `(pre-payment ₹${f.pre_payment_balance.toLocaleString('en-IN')} + credit limit ₹${f.credit_limit.toLocaleString('en-IN')} `
  + `− held by other buy bids ₹${f.committed.toLocaleString('en-IN')}). `
  + 'Add a pre-payment, raise the credit limit, or pass funds_override_reason to proceed anyway.';
