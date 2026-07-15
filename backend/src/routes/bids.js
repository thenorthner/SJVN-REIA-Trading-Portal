import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';
import { checkPortfolioAdequacy } from '../paymentSecurityEngine.js';

const router = Router();
router.use(requireAuth);

function withClient(bid) {
  if (!bid) return bid;
  const client = db.prepare('SELECT name FROM trading_clients WHERE id = ?').get(bid.client_id);
  return { ...bid, client_name: client?.name };
}

router.get('/', (req, res) => {
  const { client_id, exchange, product, status } = req.query;
  let sql = 'SELECT * FROM bids WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  if (exchange) { sql += ' AND exchange = ?'; params.push(exchange); }
  if (product) { sql += ' AND product = ?'; params.push(product); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withClient));
});

// Configurable bid validation: pre-payment balance, margin, NOC/PPA validity, quantum, time-block
function validateBid(client, body) {
  const errors = [];
  const estimatedValue = body.quantum_mw * body.price_per_unit * 4; // rough block-hours estimate
  if (client.pre_payment_balance < estimatedValue * 0.1) {
    errors.push('Insufficient pre-payment balance for this bid quantum.');
  }
  if (client.margin_available < estimatedValue * 0.05) {
    errors.push('Insufficient margin available for this bid.');
  }
  if (client.noc_valid_till && new Date(client.noc_valid_till) < new Date(body.delivery_date)) {
    errors.push('NOC/PPA is not valid for the requested delivery date.');
  }
  if (body.quantum_mw <= 0) errors.push('Quantum must be greater than zero.');
  if (!body.time_block) errors.push('Time-block is required for exchange bidding.');
  if (!['IEX', 'PXIL', 'HPX'].includes(body.exchange)) errors.push('Unsupported exchange.');
  const sec = checkPortfolioAdequacy();
  if (!sec.adequate) errors.push(sec.error);
  return errors;
}

router.post('/validate', (req, res) => {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(req.body.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const errors = validateBid(client, req.body);
  res.json({ valid: errors.length === 0, errors });
});

router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE, 'TRADING_CLIENT'), (req, res) => {
  const b = req.body;
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(b.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const isNoBid = !!b.no_bid;
  const errors = isNoBid ? [] : validateBid(client, b);
  if (errors.length && !b.force) {
    return res.status(400).json({ error: 'Bid validation failed', details: errors });
  }

  const id = newId('BID');
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, time_block, quantum_mw,
      price_per_unit, carry_forward_from, premium_discount, cleared_quantum_mw, cleared_price, status, created_by)
    VALUES (@id, @client_id, @exchange, @product, @bid_date, @delivery_date, @time_block, @quantum_mw,
      @price_per_unit, @carry_forward_from, @premium_discount, 0, NULL, @status, @created_by)
  `).run({
    id,
    client_id: b.client_id,
    exchange: b.exchange,
    product: b.product,
    bid_date: b.bid_date,
    delivery_date: b.delivery_date,
    time_block: b.time_block ?? null,
    quantum_mw: b.quantum_mw,
    price_per_unit: b.price_per_unit,
    carry_forward_from: b.carry_forward_from ?? null,
    premium_discount: b.premium_discount || 0,
    status: isNoBid ? 'NO_BID' : 'SUBMITTED',
    created_by: req.user.name,
  });
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: isNoBid ? 'NO_BID' : 'SUBMIT', module: 'TRADING', entityType: 'bid', entityId: id, details: b });
  res.status(201).json(withClient(db.prepare('SELECT * FROM bids WHERE id = ?').get(id)));
});

// Edit before exchange cut-off
router.put('/:id', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (!['DRAFT', 'SUBMITTED'].includes(bid.status)) return res.status(400).json({ error: 'Bid can no longer be edited' });
  const merged = { ...bid, ...req.body };
  db.prepare(`
    UPDATE bids SET quantum_mw=@quantum_mw, price_per_unit=@price_per_unit, time_block=@time_block,
      premium_discount=@premium_discount WHERE id=@id
  `).run(merged);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'EDIT', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: req.body });
  res.json(withClient(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
});

router.post('/:id/cancel', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (['CLEARED', 'PARTIALLY_CLEARED'].includes(bid.status)) return res.status(400).json({ error: 'Cleared bids cannot be cancelled' });
  db.prepare(`UPDATE bids SET status = 'CANCELLED' WHERE id = ?`).run(bid.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CANCEL', module: 'TRADING', entityType: 'bid', entityId: bid.id });
  res.json(withClient(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
});

router.delete('/:id', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (bid.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft bids can be deleted' });
  db.prepare('DELETE FROM bids WHERE id = ?').run(bid.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'DELETE', module: 'TRADING', entityType: 'bid', entityId: bid.id });
  res.status(204).send();
});

// Simulate exchange clearing (demo of obligation import)
router.post('/:id/clear', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  const { cleared_quantum_mw, cleared_price } = req.body;
  const status = cleared_quantum_mw >= bid.quantum_mw ? 'CLEARED' : (cleared_quantum_mw > 0 ? 'PARTIALLY_CLEARED' : 'REJECTED');
  db.prepare(`UPDATE bids SET cleared_quantum_mw = ?, cleared_price = ?, status = ? WHERE id = ?`)
    .run(cleared_quantum_mw, cleared_price, status, bid.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CLEAR_OBLIGATION', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: req.body });
  pushNotification({ role: 'TRADING_USER', type: 'BID_CLEARED', message: `Bid ${bid.id} on ${bid.exchange} ${status}` });
  res.json(withClient(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
});

// Bulk upload of bids (Excel/CSV simulation - accepts array of rows)
router.post('/bulk-upload', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const rows = req.body.rows || [];
  let inserted = 0;
  const insert = db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, time_block, quantum_mw,
      price_per_unit, status, created_by)
    VALUES (@id, @client_id, @exchange, @product, @bid_date, @delivery_date, @time_block, @quantum_mw,
      @price_per_unit, 'SUBMITTED', @created_by)
  `);
  const tx = db.transaction((items) => {
    for (const r of items) {
      insert.run({ id: newId('BID'), time_block: r.time_block ?? null, created_by: req.user.name, ...r });
      inserted += 1;
    }
  });
  tx(rows);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'BULK_UPLOAD', module: 'TRADING', entityType: 'bid', details: { count: inserted } });
  res.status(201).json({ inserted });
});

export default router;
