import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';

const router = Router();
router.use(requireAuth);

const withDetails = (bid) => {
  if (!bid) return bid;
  const client = db.prepare('SELECT name, exposure_limit FROM trading_clients WHERE id = ?').get(bid.client_id);
  bid.client_name = client?.name;
  bid.exposure_limit = client?.exposure_limit;
  bid.blocks = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ? ORDER BY time_block ASC').all(bid.id);
  bid.events = db.prepare('SELECT * FROM bid_events WHERE bid_id = ? ORDER BY created_at DESC').all(bid.id);
  return bid;
};

// List all bids
router.get('/', (req, res) => {
  const { client_id, exchange, status, date } = req.query;
  let sql = 'SELECT * FROM bids WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  if (exchange) { sql += ' AND exchange = ?'; params.push(exchange); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (date) { sql += ' AND bid_date = ?'; params.push(date); }
  sql += ' ORDER BY created_at DESC';
  
  res.json(db.prepare(sql).all(...params).map(withDetails));
});

// Get single bid
router.get('/:id', (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  res.json(withDetails(bid));
});

// Check Gate Closure
const checkGateClosure = (gate_closure_time) => {
  if (!gate_closure_time) return false;
  return new Date() > new Date(gate_closure_time);
};

// Create a new Master Bid (Portfolio/Block Bid)
router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(b.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (client.status === 'SUSPENDED') return res.status(403).json({ error: 'Client is suspended. Bidding not allowed.' });

  // Calculate Exposure
  const totalExposure = b.blocks.reduce((acc, blk) => acc + (blk.quantum_mw * blk.price_per_unit), 0);
  
  // Check against Limits
  const currentUtilized = db.prepare(`
    SELECT COALESCE(SUM(blk.quantum_mw * blk.price_per_unit), 0) as u
    FROM bids b JOIN bid_blocks blk ON b.id = blk.bid_id
    WHERE b.client_id = ? AND b.status IN ('SUBMITTED', 'CLEARED')
  `).get(client.id).u;

  if ((currentUtilized + totalExposure) > client.exposure_limit) {
    return res.status(400).json({ 
      error: 'Exposure limit breached.', 
      limit: client.exposure_limit, 
      utilized: currentUtilized, 
      requested: totalExposure 
    });
  }

  const bidId = newId('BID');
  
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, gate_closure_time, is_no_bid, approval_status, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', 'DRAFT', ?)
  `).run(bidId, b.client_id, b.exchange, b.product, b.bid_date, b.delivery_date, b.gate_closure_time, req.user.id);

  const insertBlock = db.prepare(`INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit) VALUES (?, ?, ?, ?, ?)`);
  
  for (const blk of b.blocks) {
    insertBlock.run(newId('BLK'), bidId, blk.time_block, blk.quantum_mw, blk.price_per_unit);
  }

  db.prepare(`INSERT INTO bid_events (id, bid_id, actor_id, event_type, details) VALUES (?, ?, ?, ?, ?)`).run(
    newId('BEV'), bidId, req.user.id, 'CREATED', JSON.stringify({ totalExposure })
  );

  secureLogAudit(req, { action: 'CREATE_BID', module: 'TRADING', entityType: 'bid', entityId: bidId, details: { totalExposure }});
  
  res.status(201).json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bidId)));
});

// Submit Bid to Exchange (Simulated)
router.post('/:id/submit', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (bid.approval_status !== 'APPROVED') return res.status(400).json({ error: 'Bid must be approved before submission' });
  if (checkGateClosure(bid.gate_closure_time)) return res.status(400).json({ error: 'Gate closure time passed. Cannot submit.' });

  const receiptRef = `EXC-RCPT-${Date.now()}`;

  db.prepare(`UPDATE bids SET status = 'SUBMITTED', exchange_receipt_ref = ? WHERE id = ?`).run(receiptRef, bid.id);
  db.prepare(`INSERT INTO bid_events (id, bid_id, actor_id, event_type, details) VALUES (?, ?, ?, ?, ?)`).run(
    newId('BEV'), bid.id, req.user.id, 'SUBMITTED', JSON.stringify({ receiptRef })
  );

  secureLogAudit(req, { action: 'SUBMIT_BID', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: { receiptRef }});
  
  res.json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
});

// Approve/Reject Bid
router.post('/:id/approve', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const { status, reason } = req.body;
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  
  db.prepare(`UPDATE bids SET approval_status = ?, status = ? WHERE id = ?`).run(
    status, status === 'REJECTED' ? 'REJECTED' : bid.status, bid.id
  );
  
  db.prepare(`INSERT INTO bid_events (id, bid_id, actor_id, event_type, details) VALUES (?, ?, ?, ?, ?)`).run(
    newId('BEV'), bid.id, req.user.id, status, JSON.stringify({ reason })
  );

  secureLogAudit(req, { action: 'APPROVE_BID', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: { status, reason }});
  res.json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
});

// Explicit No-Bid Logging
router.post('/no-bid', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const bidId = newId('BID');
  
  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, is_no_bid, no_bid_reason, approval_status, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'APPROVED', 'NO_BID', ?)
  `).run(bidId, b.client_id, b.exchange, b.product, b.bid_date, b.delivery_date, b.reason, req.user.id);

  secureLogAudit(req, { action: 'LOG_NO_BID', module: 'TRADING', entityType: 'bid', entityId: bidId, details: b });
  res.json({ success: true, id: bidId });
});

export default router;
