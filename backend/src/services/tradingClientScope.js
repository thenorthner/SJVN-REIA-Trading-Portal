/**
 * Who a trading-client user is, and what it may see.
 *
 * The client portal had no settled answer to either question. billingSettlement
 * filtered by `req.user.linked_entity_id` under a comment saying it assumed
 * that column held a trading_clients id "for this demo"; the ledger and the
 * statement of account took a client id from the URL, or none at all, and
 * answered for whoever asked. Everything client-facing resolves the caller
 * through here instead, so one rule decides it.
 */
import db from '../db/index.js';

/**
 * The portal roles a counterparty trading company logs in with.
 *
 * Three: the read-only login, and the maker and checker the client's own office
 * uses to raise a request to the desk and clear it. The frontend once listed four
 * others — ADMIN, MAKER, CHECKER, VIEWER — that no screen could create because
 * the CHECK on users.role refused them; the two that were wanted are in that
 * CHECK now, added here and in frontend roles.js at the same time, and
 * roleGroupsParity.test.js fails if the three lists ever drift apart again.
 */
export const TRADING_CLIENT_ROLES = ['TRADING_CLIENT', 'TRADING_CLIENT_MAKER', 'TRADING_CLIENT_CHECKER'];

// Inside the client's own office: the maker raises a request to the desk, the
// checker clears it, and the plain login only reads. Same separation the desk
// has between bidding and approving a bid, on the other side of the table.
export const TRADING_CLIENT_MAKER_ROLES = ['TRADING_CLIENT_MAKER'];
export const TRADING_CLIENT_CHECKER_ROLES = ['TRADING_CLIENT_CHECKER'];

export const isTradingClient = (user) => !!user && TRADING_CLIENT_ROLES.includes(user.role);

/**
 * The trading_clients row this user belongs to, or null.
 *
 * A user's linked_entity_id may hold either the trading client's own id or the
 * id of the entity behind it — both conventions exist in the data — so both are
 * accepted rather than guessed at.
 */
export function tradingClientIdFor(user) {
  if (!isTradingClient(user)) return null;
  const key = user.linked_entity_id;
  if (!key) return null;
  const row = db.prepare('SELECT id FROM trading_clients WHERE id = ? OR entity_id = ?').get(key, key);
  return row?.id || null;
}

/**
 * Add "and only this client's rows" to a query, for callers that are clients.
 * Returns null for an internal user (no restriction) and refuses a client whose
 * account is not linked to any trading client, which would otherwise read as
 * "no filter" and hand them the whole desk.
 */
export function clientScope(user, column = 'client_id') {
  if (!isTradingClient(user)) return { restricted: false, sql: '', params: [] };
  const id = tradingClientIdFor(user);
  // An unlinked client matches nothing rather than everything.
  return { restricted: true, clientId: id, sql: ` AND ${column} = ?`, params: [id || '~unlinked~'] };
}

/** Whether a client user may act on rows belonging to `clientId`. */
export function mayUseClient(user, clientId) {
  if (!isTradingClient(user)) return true;
  const own = tradingClientIdFor(user);
  return !!own && own === clientId;
}
