import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { TRADING_CLIENT_ROLES, tradingClientIdFor, mayUseClient } from '../services/tradingClientScope.js';

/**
 * The trading client's own view of its account.
 *
 * Its home screen showed a fixed table of another company's trades — the desk's
 * sample rows — so nothing on it was the client's and none of it agreed with
 * the rest of the portal. These figures come from the same tables the desk
 * reads, filtered to the client the caller belongs to.
 */
const router = Router();
router.use(requireAuth);
router.use(requireRole(...TRADING_CLIENT_ROLES, ...ROLE_GROUPS.TRADING_ALL));

/** Resolve which client the summary is about: a client sees only its own. */
function resolveClientId(req, res) {
  const asked = req.query.client_id ? String(req.query.client_id) : null;
  const own = tradingClientIdFor(req.user);
  if (own) {
    if (asked && asked !== own) {
      res.status(403).json({ error: 'You can only see your own account' });
      return null;
    }
    return own;
  }
  if (TRADING_CLIENT_ROLES.includes(req.user.role)) {
    res.status(400).json({ error: 'Your login is not linked to a trading client yet — ask the SJVN trading desk to link it.' });
    return null;
  }
  if (!asked) {
    res.status(400).json({ error: 'client_id is required' });
    return null;
  }
  if (!mayUseClient(req.user, asked)) {
    res.status(403).json({ error: 'You can only see your own account' });
    return null;
  }
  return asked;
}

router.get('/summary', (req, res) => {
  const clientId = resolveClientId(req, res);
  if (!clientId) return;

  const client = db.prepare('SELECT id, name, client_type, status, exposure_limit, margin_available FROM trading_clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Trading client not found' });

  const bids = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'SUBMITTED' THEN 1 ELSE 0 END), 0) AS submitted,
      COALESCE(SUM(CASE WHEN status IN ('CLEARED','PARTIALLY_CLEARED') THEN 1 ELSE 0 END), 0) AS cleared,
      COALESCE(SUM(quantum_mw), 0) AS quantum_mw,
      COALESCE(SUM(cleared_quantum_mw), 0) AS cleared_mw
    FROM bids WHERE client_id = ?
  `).get(clientId);

  const contracts = db.prepare(`
    SELECT COUNT(*) AS exchange_contracts FROM exchange_contracts WHERE client_id = ?
  `).get(clientId);
  const bilateral = db.prepare(`
    SELECT COUNT(*) AS bilateral_deals FROM bilateral_transactions WHERE client_id = ?
  `).get(clientId);

  const invoices = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(total_amount), 0) AS billed,
      COALESCE(SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END), 0) AS paid_count,
      COALESCE(SUM(CASE WHEN status IN ('PAID','CANCELLED') THEN 0 ELSE COALESCE(net_payable, total_amount) END), 0) AS outstanding
    FROM trading_invoices WHERE client_id = ?
  `).get(clientId);

  const ledger = db.prepare(`
    SELECT running_balance, timestamp FROM client_ledgers WHERE client_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1
  `).get(clientId) || null;

  const recent = db.prepare(`
    SELECT id, invoice_no, invoice_kind, status, total_amount, net_payable, created_at
    FROM trading_invoices WHERE client_id = ? ORDER BY created_at DESC LIMIT 10
  `).all(clientId);

  res.json({
    client,
    bids,
    contracts: { ...contracts, ...bilateral },
    invoices,
    ledger_balance: ledger?.running_balance ?? 0,
    ledger_as_of: ledger?.timestamp ?? null,
    recent_invoices: recent,
  });
});

export default router;
