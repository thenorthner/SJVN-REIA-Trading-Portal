import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import {
  TRADING_CLIENT_ROLES, TRADING_CLIENT_MAKER_ROLES, TRADING_CLIENT_CHECKER_ROLES,
  isTradingClient, tradingClientIdFor, clientScope, mayUseClient,
} from '../services/tradingClientScope.js';

/**
 * Bid requests a trading client raises for itself.
 *
 * The client portal could only read: a client that wanted power bought asked by
 * phone or mail, and nothing recorded who asked, who in the client's office
 * agreed, or what the desk did about it. A request is raised by the client's
 * maker, cleared by its checker — never by the same person, which is the point of
 * having two roles — and only an approved request is the desk's to act on. The
 * desk links the bid it actually placed, so the bid can be read back to the
 * request that asked for it.
 */
const router = Router();
router.use(requireAuth);
router.use(requireRole(...ROLE_GROUPS.TRADING_ALL, ...TRADING_CLIENT_ROLES));

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const SIDES = ['BUY', 'SELL'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `
  SELECT r.*, c.name AS client_name, b.status AS bid_status, b.cleared_quantum_mw
  FROM client_bid_requests r
  JOIN trading_clients c ON c.id = r.client_id
  LEFT JOIN bids b ON b.id = r.bid_id
`;

/** The request, or null when this caller has no business with it. */
function visibleRequest(user, id) {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id);
  if (!row) return null;
  if (isTradingClient(user) && !mayUseClient(user, row.client_id)) return null;
  return row;
}

router.get('/', (req, res) => {
  const { status, client_id, from, to } = req.query;
  let sql = `${SELECT} WHERE 1=1`;
  const params = [];

  const scope = clientScope(req.user, 'r.client_id');
  if (scope.restricted) { sql += scope.sql; params.push(...scope.params); }
  else if (client_id) { sql += ' AND r.client_id = ?'; params.push(String(client_id)); }

  if (status) {
    const wanted = String(status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    sql += ` AND r.status IN (${wanted.map(() => '?').join(',')})`;
    params.push(...wanted);
  }
  if (from) { sql += ' AND date(r.delivery_date) >= date(?)'; params.push(String(from)); }
  if (to) { sql += ' AND date(r.delivery_date) <= date(?)'; params.push(String(to)); }

  sql += ' ORDER BY r.delivery_date DESC, r.raised_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const row = visibleRequest(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  res.json(row);
});

/** The client's maker asks the desk for a bid. */
router.post('/', requireRole(...TRADING_CLIENT_MAKER_ROLES), (req, res) => {
  const clientId = tradingClientIdFor(req.user);
  if (!clientId) {
    return res.status(400).json({ error: 'This login is not linked to a trading client, so it has no account to raise a request for.' });
  }

  const b = req.body || {};
  const row = {
    side: String(b.side || '').trim().toUpperCase(),
    exchange: String(b.exchange || '').trim().toUpperCase(),
    product: String(b.product || '').trim().toUpperCase(),
    delivery_date: String(b.delivery_date || '').trim(),
    quantum_mw: Number(b.quantum_mw),
    price_limit_per_unit: b.price_limit_per_unit === '' || b.price_limit_per_unit == null ? null : Number(b.price_limit_per_unit),
    notes: String(b.notes || '').trim() || null,
  };

  const errors = [];
  if (!SIDES.includes(row.side)) errors.push(`side must be ${SIDES.join(' or ')}`);
  if (!EXCHANGES.includes(row.exchange)) errors.push(`exchange must be one of ${EXCHANGES.join('/')}`);
  if (!row.product) errors.push('product is required');
  if (!ISO_DATE.test(row.delivery_date)) errors.push('delivery_date must be YYYY-MM-DD');
  if (!Number.isFinite(row.quantum_mw) || row.quantum_mw <= 0) errors.push('quantum_mw must be a positive number');
  if (row.price_limit_per_unit != null && (!Number.isFinite(row.price_limit_per_unit) || row.price_limit_per_unit < 0)) {
    errors.push('price_limit_per_unit must be a non-negative number');
  }
  if (errors.length) return res.status(400).json({ error: errors.join('; '), errors });

  const id = newId('CBR');
  db.prepare(`
    INSERT INTO client_bid_requests (
      id, client_id, side, exchange, product, delivery_date, quantum_mw, price_limit_per_unit, notes,
      status, raised_by, raised_by_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_CHECK', ?, ?)
  `).run(id, clientId, row.side, row.exchange, row.product, row.delivery_date,
    row.quantum_mw, row.price_limit_per_unit, row.notes, req.user.id, req.user.name);

  secureLogAudit(req, {
    action: 'RAISE_CLIENT_BID_REQUEST', module: 'TRADING',
    entityType: 'client_bid_request', entityId: id, afterValue: row,
  });

  res.status(201).json(visibleRequest(req.user, id));
});

/** The client's checker clears it, or sends it back. Never the person who raised it. */
router.post('/:id/check', requireRole(...TRADING_CLIENT_CHECKER_ROLES), (req, res) => {
  const row = visibleRequest(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.status !== 'PENDING_CHECK') {
    return res.status(400).json({ error: `This request is ${row.status}; only a request pending check can be cleared.` });
  }
  // Four eyes. A checker who also raised it is one pair.
  if (row.raised_by && row.raised_by === req.user.id) {
    return res.status(403).json({ error: 'A request cannot be cleared by the person who raised it.' });
  }

  const decision = String(req.body?.decision || '').trim().toUpperCase();
  if (!['APPROVE', 'REJECT'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be APPROVE or REJECT' });
  }
  const remarks = String(req.body?.remarks || '').trim() || null;
  if (decision === 'REJECT' && !remarks) {
    return res.status(400).json({ error: 'Say why it is being sent back — remarks are required on a rejection.' });
  }

  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  db.prepare(`
    UPDATE client_bid_requests
    SET status = ?, checked_by = ?, checked_by_name = ?, checked_at = datetime('now'),
        check_remarks = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, req.user.id, req.user.name, remarks, row.id);

  secureLogAudit(req, {
    action: decision === 'APPROVE' ? 'APPROVE_CLIENT_BID_REQUEST' : 'REJECT_CLIENT_BID_REQUEST',
    module: 'TRADING', entityType: 'client_bid_request', entityId: row.id,
    beforeValue: { status: row.status }, afterValue: { status }, reason: remarks,
  });

  res.json(visibleRequest(req.user, row.id));
});

/** The client withdraws its own request, while the desk has not acted on it. */
router.post('/:id/withdraw', requireRole(...TRADING_CLIENT_MAKER_ROLES, ...TRADING_CLIENT_CHECKER_ROLES), (req, res) => {
  const row = visibleRequest(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.status === 'PLACED') {
    return res.status(400).json({ error: 'The desk has already placed a bid against this request; it cannot be withdrawn.' });
  }
  if (row.status === 'WITHDRAWN') return res.json(row);

  db.prepare(`
    UPDATE client_bid_requests SET status = 'WITHDRAWN', updated_at = datetime('now') WHERE id = ?
  `).run(row.id);
  secureLogAudit(req, {
    action: 'WITHDRAW_CLIENT_BID_REQUEST', module: 'TRADING',
    entityType: 'client_bid_request', entityId: row.id,
    beforeValue: { status: row.status }, afterValue: { status: 'WITHDRAWN' },
    reason: String(req.body?.reason || '').trim() || null,
  });
  res.json(visibleRequest(req.user, row.id));
});

/**
 * The desk records the bid it placed against an approved request.
 *
 * Only a bid of that client's own, so a request cannot be closed off against
 * somebody else's position.
 */
router.post('/:id/place', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const row = visibleRequest(req.user, req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found' });
  if (row.status !== 'APPROVED') {
    return res.status(400).json({ error: `This request is ${row.status}; only an approved request can be acted on.` });
  }

  const bidId = String(req.body?.bid_id || '').trim();
  if (!bidId) return res.status(400).json({ error: 'bid_id is required — name the bid that was placed.' });
  const bid = db.prepare('SELECT id, client_id FROM bids WHERE id = ?').get(bidId);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (bid.client_id !== row.client_id) {
    return res.status(400).json({ error: "That bid belongs to another client, so it cannot answer this client's request." });
  }

  db.prepare(`
    UPDATE client_bid_requests
    SET status = 'PLACED', bid_id = ?, placed_by = ?, placed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(bid.id, req.user.id, row.id);

  secureLogAudit(req, {
    action: 'PLACE_CLIENT_BID_REQUEST', module: 'TRADING',
    entityType: 'client_bid_request', entityId: row.id,
    beforeValue: { status: row.status }, afterValue: { status: 'PLACED', bid_id: bid.id },
  });

  res.json(visibleRequest(req.user, row.id));
});

export default router;
