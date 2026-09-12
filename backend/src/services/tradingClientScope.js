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
 * The portal role a counterparty trading company logs in with.
 *
 * One role, because that is what exists: the CHECK on users.role accepts
 * 'TRADING_CLIENT' and nothing else on this side. The frontend carried four
 * more — ADMIN, MAKER, CHECKER, VIEWER — that no screen could create and the
 * database would refuse. Giving the client company a maker and a checker, as
 * sellers and buyers have, means adding them here, in frontend roles.js, and
 * to that CHECK together.
 */
export const TRADING_CLIENT_ROLES = ['TRADING_CLIENT'];

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
