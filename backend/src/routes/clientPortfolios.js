import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

// Update Portfolio ID (ISET).
//
// Each client trades on an exchange under a portfolio the exchange assigned
// it. The desk records that id here so there is one place to read it from.
// One portfolio per client per exchange, and a portfolio belongs to exactly one
// client — both are enforced by the table as well as checked here, so a race
// between two saves still cannot map one portfolio to two clients.

const router = Router();
router.use(requireAuth);

const READ = [...ROLE_GROUPS.TRADING_ALL];
const WRITE = [...ROLE_GROUPS.TRADING_WRITE];

export const PORTFOLIO_EXCHANGES = ['IEX', 'PXIL', 'HPX', 'BILATERAL'];
// Exchange portfolio codes are short alphanumerics (N1HP0PTC0850, HPDC10110008);
// this admits those and the desk's own separators without admitting free text.
const PORTFOLIO_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_\-/]{2,39}$/;

const SELECT = `
  SELECT p.*, c.name AS client_name
  FROM client_exchange_portfolios p
  JOIN trading_clients c ON c.id = p.client_id
`;

/** The mappings on record, optionally for one client or one exchange. */
router.get('/', requireRole(...READ), (req, res) => {
  const { client_id, exchange } = req.query;
  let sql = `${SELECT} WHERE 1=1`;
  const params = [];
  if (client_id) { sql += ' AND p.client_id = ?'; params.push(String(client_id)); }
  if (exchange) { sql += ' AND p.exchange = ?'; params.push(String(exchange).toUpperCase()); }
  sql += ' ORDER BY c.name, p.exchange';
  res.json(db.prepare(sql).all(...params));
});

/** Set a client's portfolio on one exchange, replacing whatever was there. */
router.put('/', requireRole(...WRITE), (req, res) => {
  const b = req.body || {};
  const clientId = String(b.client_id || '').trim();
  const exchange = String(b.exchange || '').trim().toUpperCase();
  const portfolioId = String(b.portfolio_id || '').trim();
  const portfolioName = String(b.portfolio_name || '').trim();

  if (!clientId) return res.status(400).json({ error: 'Choose the client' });
  if (!PORTFOLIO_EXCHANGES.includes(exchange)) {
    return res.status(400).json({ error: `Exchange must be one of ${PORTFOLIO_EXCHANGES.join(', ')}` });
  }
  if (!PORTFOLIO_ID_RE.test(portfolioId)) {
    return res.status(400).json({ error: 'Portfolio Id must be 3 to 40 letters or digits (- _ / allowed after the first)' });
  }
  if (!portfolioName) return res.status(400).json({ error: 'Portfolio Name is required' });

  const client = db.prepare('SELECT id FROM trading_clients WHERE id = ?').get(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const taken = db.prepare(`
    SELECT c.name FROM client_exchange_portfolios p JOIN trading_clients c ON c.id = p.client_id
    WHERE p.exchange = ? AND p.portfolio_id = ? AND p.client_id <> ?
  `).get(exchange, portfolioId, clientId);
  if (taken) {
    return res.status(409).json({ error: `${exchange} portfolio ${portfolioId} is already mapped to ${taken.name}` });
  }

  const before = db.prepare('SELECT * FROM client_exchange_portfolios WHERE client_id = ? AND exchange = ?')
    .get(clientId, exchange);
  try {
    if (before) {
      db.prepare(`
        UPDATE client_exchange_portfolios
        SET portfolio_id = ?, portfolio_name = ?, updated_by = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(portfolioId, portfolioName, req.user.id, before.id);
    } else {
      db.prepare(`
        INSERT INTO client_exchange_portfolios (id, client_id, exchange, portfolio_id, portfolio_name, updated_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(newId('CEP'), clientId, exchange, portfolioId, portfolioName, req.user.id);
    }
  } catch (err) {
    // The check above and the write are separate statements; a concurrent save
    // can land between them, and the table's UNIQUE constraints are what stop it.
    if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: `${exchange} portfolio ${portfolioId} is already mapped to another client` });
    }
    throw err;
  }

  const row = db.prepare(`${SELECT} WHERE p.client_id = ? AND p.exchange = ?`).get(clientId, exchange);
  secureLogAudit(req, {
    action: before ? 'UPDATE_PORTFOLIO_ID' : 'CREATE_PORTFOLIO_ID',
    module: 'TRADING',
    entityType: 'client_exchange_portfolio',
    entityId: row.id,
    beforeValue: before || null,
    afterValue: row,
  });
  res.status(before ? 200 : 201).json(row);
});

export default router;
