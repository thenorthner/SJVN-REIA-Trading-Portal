import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParam } from '../mastersService.js';
import { inventoryPosition, sellableInventory, executeRecBid } from '../services/recTrading.js';

const router = Router();
router.use(requireAuth);

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const REC_TYPES = ['Solar REC', 'Non-Solar REC', 'Hydro REC', 'Non-Solar (Hydro)', 'Non-Solar (Non-Hydro)'];

function num(v, fallback = null) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function deriveSettlement(b) {
  const totalSold = num(b.total_recs_sold, 0) || 0;
  const discovered = num(b.discovered_rate, 0) || 0;
  const tradeObligation = b.trade_obligation != null && b.trade_obligation !== ''
    ? num(b.trade_obligation, 0)
    : Number((totalSold * discovered).toFixed(2));
  const gstTrade = num(b.gst_on_trade_obligation, 0) || 0;
  const fees = num(b.exchange_fees, 0) || 0;
  const gstFees = num(b.gst_on_exchange_fees, 0) || 0;
  const netRevenue = b.net_revenue != null && b.net_revenue !== ''
    ? num(b.net_revenue, 0)
    : Number((tradeObligation - gstTrade - fees - gstFees).toFixed(2));

  const base = num(b.base_amount, 0) || 0;
  const tax = b.tax_amount != null && b.tax_amount !== ''
    ? num(b.tax_amount, 0)
    : Number((base * 0.18).toFixed(2));
  const totalAmt = b.total_amount != null && b.total_amount !== ''
    ? num(b.total_amount, 0)
    : Number((base + tax).toFixed(2));

  return {
    trade_obligation: tradeObligation,
    gst_on_trade_obligation: gstTrade,
    exchange_fees: fees,
    gst_on_exchange_fees: gstFees,
    net_revenue: netRevenue,
    base_amount: base,
    tax_amount: tax,
    total_amount: totalAmt,
  };
}

/** Sample trade dates + volumes matching the ISET REC Order Report screenshot KPIs. */
export function seedRecOrders() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM rec_orders').get().c;
  if (count > 0) return;

  const samples = [
    { trade_date: '2026-04-08', total_recs_sold: 18500, discovered_rate: 2400, bid_rate: 2200, buyer_name: 'State DISCOM', invoice_no: 'REC/INV/2604/01' },
    { trade_date: '2026-02-25', total_recs_sold: 9200, discovered_rate: 1850, bid_rate: 1700, buyer_name: 'Green Buyer Co', invoice_no: 'REC/INV/2602/08' },
    { trade_date: '2025-12-31', total_recs_sold: 11200, discovered_rate: 980, bid_rate: 900, buyer_name: 'Northern Utility', invoice_no: 'REC/INV/2512/22' },
    { trade_date: '2025-11-12', total_recs_sold: 6400, discovered_rate: 115, bid_rate: 100, buyer_name: 'RPO Obligated Entity', invoice_no: 'REC/INV/2511/05' },
    { trade_date: '2025-08-28', total_recs_sold: 5100, discovered_rate: 450, bid_rate: 420, buyer_name: 'Industrial Captive', invoice_no: 'REC/INV/2508/14' },
    { trade_date: '2025-07-09', total_recs_sold: 4800, discovered_rate: 620, bid_rate: 580, buyer_name: 'Open Access Consumer', invoice_no: 'REC/INV/2507/03' },
    { trade_date: '2025-05-28', total_recs_sold: 3900, discovered_rate: 710, bid_rate: 650, buyer_name: 'State DISCOM', invoice_no: 'REC/INV/2505/19' },
    { trade_date: '2025-03-12', total_recs_sold: 2800, discovered_rate: 890, bid_rate: 850, buyer_name: 'Trading Client A', invoice_no: 'REC/INV/2503/11' },
    { trade_date: '2025-02-12', total_recs_sold: 2267, discovered_rate: 1050, bid_rate: 1000, buyer_name: 'Trading Client B', invoice_no: 'REC/INV/2502/07' },
    { trade_date: '2025-01-08', total_recs_sold: 2000, discovered_rate: 1200, bid_rate: 1100, buyer_name: 'State DISCOM', invoice_no: 'REC/INV/2501/02' },
  ];

  const insert = db.prepare(`
    INSERT INTO rec_orders (
      id, trade_date, rec_placed_for_sale, bid_rate, total_recs_sold, discovered_rate,
      trade_obligation, gst_on_trade_obligation, exchange_fees, gst_on_exchange_fees, net_revenue,
      buyer_name, invoice_no, recs_bought, base_amount, tax_amount, total_amount, status, created_by
    ) VALUES (
      @id, @trade_date, @rec_placed_for_sale, @bid_rate, @total_recs_sold, @discovered_rate,
      @trade_obligation, @gst_on_trade_obligation, @exchange_fees, @gst_on_exchange_fees, @net_revenue,
      @buyer_name, @invoice_no, @recs_bought, @base_amount, @tax_amount, @total_amount, 'SUBMITTED', NULL
    )
  `);

  const tx = db.transaction(() => {
    for (const s of samples) {
      const tradeObligation = Number((s.total_recs_sold * s.discovered_rate).toFixed(2));
      const exchangeFees = Number((tradeObligation * 0.002).toFixed(2));
      const gstFees = Number((exchangeFees * 0.18).toFixed(2));
      const gstTrade = 0;
      const netRevenue = Number((tradeObligation - gstTrade - exchangeFees - gstFees).toFixed(2));
      const base = tradeObligation;
      const tax = Number((base * 0.18).toFixed(2));
      insert.run({
        id: newId('RCO'),
        trade_date: s.trade_date,
        rec_placed_for_sale: s.total_recs_sold,
        bid_rate: s.bid_rate,
        total_recs_sold: s.total_recs_sold,
        discovered_rate: s.discovered_rate,
        trade_obligation: tradeObligation,
        gst_on_trade_obligation: gstTrade,
        exchange_fees: exchangeFees,
        gst_on_exchange_fees: gstFees,
        net_revenue: netRevenue,
        buyer_name: s.buyer_name,
        invoice_no: s.invoice_no,
        recs_bought: s.total_recs_sold,
        base_amount: base,
        tax_amount: tax,
        total_amount: Number((base + tax).toFixed(2)),
      });
    }
  });
  tx();
}

// ─── REC Order (settlement) ─────────────────────────────────────────────────

router.get('/orders/report', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { from, to } = req.query;
  let sql = 'SELECT * FROM rec_orders WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND trade_date >= ?'; params.push(from); }
  if (to) { sql += ' AND trade_date <= ?'; params.push(to); }
  sql += ' ORDER BY trade_date DESC, created_at DESC';
  const rows = db.prepare(sql).all(...params);

  const totalRecSold = rows.reduce((s, r) => s + (Number(r.total_recs_sold) || 0), 0);
  const rates = rows.map((r) => Number(r.discovered_rate)).filter((n) => Number.isFinite(n));
  const totalSaleValue = rows.reduce((s, r) => s + (Number(r.trade_obligation) || 0), 0);

  const byDate = {};
  for (const r of rows) {
    if (!byDate[r.trade_date]) byDate[r.trade_date] = [];
    byDate[r.trade_date].push(r);
  }
  const tradeDates = Object.keys(byDate).sort((a, b) => (a < b ? 1 : -1)).map((d) => ({
    trade_date: d,
    order_count: byDate[d].length,
    total_recs_sold: byDate[d].reduce((s, r) => s + (Number(r.total_recs_sold) || 0), 0),
    sale_value: byDate[d].reduce((s, r) => s + (Number(r.trade_obligation) || 0), 0),
    orders: byDate[d],
  }));

  res.json({
    summary: {
      total_rec_sold: totalRecSold,
      min_discovered_price: rates.length ? Math.min(...rates) : null,
      max_discovered_price: rates.length ? Math.max(...rates) : null,
      total_sale_value: totalSaleValue,
    },
    trade_dates: tradeDates,
    orders: rows,
  });
});

router.get('/orders', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { trade_date } = req.query;
  let sql = 'SELECT * FROM rec_orders WHERE 1=1';
  const params = [];
  if (trade_date) { sql += ' AND trade_date = ?'; params.push(trade_date); }
  sql += ' ORDER BY trade_date DESC, created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

router.get('/orders/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const row = db.prepare('SELECT * FROM rec_orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'REC order not found' });
  res.json(row);
});

router.post('/orders', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];
  if (!String(b.trade_date || '').trim()) errors.push('trade_date is required');
  const totalSold = num(b.total_recs_sold);
  const discovered = num(b.discovered_rate);
  if (totalSold == null || totalSold < 0) errors.push('total_recs_sold is required');
  if (discovered == null || discovered < 0) errors.push('discovered_rate is required');
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const derived = deriveSettlement(b);
  const id = newId('RCO');
  db.prepare(`
    INSERT INTO rec_orders (
      id, trade_date, rec_placed_for_sale, bid_rate, total_recs_sold, discovered_rate,
      trade_obligation, gst_on_trade_obligation, exchange_fees, gst_on_exchange_fees, net_revenue,
      buyer_name, invoice_no, recs_bought, base_amount, tax_amount, total_amount, status, generated_from, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 'MANUAL', ?)
  `).run(
    id,
    String(b.trade_date).trim(),
    num(b.rec_placed_for_sale),
    num(b.bid_rate),
    totalSold,
    discovered,
    derived.trade_obligation,
    derived.gst_on_trade_obligation,
    derived.exchange_fees,
    derived.gst_on_exchange_fees,
    derived.net_revenue,
    b.buyer_name || null,
    b.invoice_no || null,
    num(b.recs_bought),
    derived.base_amount,
    derived.tax_amount,
    derived.total_amount,
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_REC_ORDER',
    module: 'TRADING',
    entityType: 'rec_order',
    entityId: id,
    details: { trade_date: b.trade_date, total_recs_sold: totalSold, discovered_rate: discovered },
  });

  res.status(201).json(db.prepare('SELECT * FROM rec_orders WHERE id = ?').get(id));
});

// ─── REC Bid Entry ──────────────────────────────────────────────────────────

router.get('/bids/meta', requireRole(...ROLE_GROUPS.TRADING_ALL), (_req, res) => {
  const bands = getParam('certificate_price_bands', { REC: {}, ESCERT: {} });
  res.json({
    exchanges: EXCHANGES,
    rec_types: REC_TYPES,
    price_band: bands?.REC || null,
    registry_available: Number(getParam('rec_registry_available', 85000)) || 85000,
  });
});

router.get('/bids', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const { status, client_id } = req.query;
  let sql = 'SELECT * FROM rec_bids WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

router.post('/bids', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const errors = [];

  if (!String(b.entity_name || b.client_id || '').trim()) errors.push('entity_name is required');
  if (!EXCHANGES.includes(b.exchange)) errors.push(`exchange must be one of: ${EXCHANGES.join(', ')}`);
  if (!String(b.portfolio_code || '').trim()) errors.push('portfolio_code is required');
  if (!REC_TYPES.includes(b.rec_type)) errors.push(`rec_type must be one of: ${REC_TYPES.join(', ')}`);
  if (!['Buy', 'Sell'].includes(b.side)) errors.push('side must be Buy or Sell');

  const price = Number(b.price);
  const quantity = Number(b.quantity);
  if (!Number.isFinite(price) || price < 0) errors.push('price must be a non-negative number');
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
    errors.push('quantity must be a positive whole number');
  }

  let entityName = String(b.entity_name || '').trim();
  let entityId = b.entity_id || b.client_id || null;
  if (b.client_id) {
    const client = db.prepare('SELECT id, name, status FROM trading_clients WHERE id = ?').get(b.client_id);
    if (!client) errors.push('client_id does not exist');
    else if (client.status === 'SUSPENDED') errors.push('Client is suspended. Bidding not allowed.');
    else {
      if (!entityName) entityName = client.name;
      entityId = client.id;
    }
  }

  const bands = getParam('certificate_price_bands', { REC: {}, ESCERT: {} });
  const band = bands?.REC || {};
  const floor = Number(band.floor);
  const ceiling = band.forbearance == null ? null : Number(band.forbearance);
  if (Number.isFinite(floor) && Number.isFinite(price) && price < floor) {
    errors.push(`Price ₹${price} is below the REC floor of ₹${floor}`);
  }
  if (ceiling != null && Number.isFinite(ceiling) && Number.isFinite(price) && price > ceiling) {
    errors.push(`Price ₹${price} exceeds the REC forbearance ceiling of ₹${ceiling}`);
  }

  if (b.side === 'Sell') {
    // The binding constraint is the ledger, not the registry parameter. That
    // parameter is a static figure that does not move when certificates are
    // issued or sold, so checking it let a sale be bid for stock the desk does
    // not hold — and the mismatch only surfaced at execution, with the bid
    // already sitting on the exchange. Certificates committed to other open
    // sell bids are unavailable too, even though they have not been drawn yet.
    const position = sellableInventory(b.rec_type);
    if (quantity > position.sellable_qty) {
      errors.push(
        `Insufficient certificates: bidding to sell ${quantity} ${b.rec_type}, but only `
        + `${position.sellable_qty} are sellable (${position.held_qty} held, ${position.committed_qty} committed to open bids)`,
      );
    }
    // The registry balance is a separate ceiling — the Central Agency's own view
    // of the account — so it is still checked, just no longer as the only one.
    const registry = Number(getParam('rec_registry_available', 85000)) || 85000;
    if (quantity > registry) {
      errors.push(`Insufficient registry balance: selling ${quantity} but only ${registry} RECs available`);
    }
  }

  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const id = newId('RCB');
  const notional = Number((price * quantity).toFixed(2));
  db.prepare(`
    INSERT INTO rec_bids (
      id, client_id, entity_name, entity_id, exchange, portfolio_code, rec_type,
      price, quantity, side, status, notional, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?)
  `).run(
    id,
    b.client_id || null,
    entityName,
    entityId,
    b.exchange,
    String(b.portfolio_code).trim(),
    b.rec_type,
    price,
    quantity,
    b.side,
    notional,
    req.user?.id || null,
  );

  secureLogAudit(req, {
    action: 'CREATE_REC_BID',
    module: 'TRADING',
    entityType: 'rec_bid',
    entityId: id,
    details: { exchange: b.exchange, side: b.side, quantity, price, rec_type: b.rec_type },
  });

  res.status(201).json(db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(id));
});

/* ─────────── Bid lifecycle and certificate movement ───────────
 *
 * A REC bid used to stop at SUBMITTED: the rest of its status vocabulary was
 * unreachable, and nothing ever took certificates out of the ledger when one
 * cleared. These four steps close that — approve, execute (which moves the
 * stock), settle, or cancel.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const getBid = (id) => db.prepare('SELECT * FROM rec_bids WHERE id = ?').get(id);

/**
 * Sellable position, so the desk can see what it may bid before bidding it —
 * held certificates less those already committed to open sell bids.
 */
router.get('/inventory', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  res.json(sellableInventory(req.query.rec_type || null));
});

router.get('/bids/:id', requireRole(...ROLE_GROUPS.TRADING_ALL), (req, res) => {
  const bid = getBid(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...bid,
    transactions: db.prepare('SELECT * FROM rec_transactions WHERE bid_id = ? ORDER BY created_at').all(bid.id),
    rec_order: bid.rec_order_id ? db.prepare('SELECT * FROM rec_orders WHERE id = ?').get(bid.rec_order_id) : null,
  });
});

/**
 * Clear the bid for the exchange. Maker-checker: the desk member who raised it
 * cannot be the one who approves it, matching how power bids are handled.
 */
router.post('/bids/:id/approve', requireRole(...ROLE_GROUPS.TRADING_CHECKER), (req, res) => {
  const bid = getBid(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Not found' });
  if (bid.status !== 'SUBMITTED') {
    return res.status(400).json({ error: `Only a SUBMITTED bid can be approved (currently ${bid.status})` });
  }
  const status = req.body?.status === 'REJECTED' ? 'REJECTED' : 'APPROVED';
  const reason = String(req.body?.reject_reason ?? '').trim();
  if (status === 'REJECTED' && !reason) {
    return res.status(400).json({ error: 'reject_reason is required when rejecting a bid' });
  }
  if (bid.created_by && bid.created_by === req.user?.id) {
    return res.status(400).json({ error: 'Maker-checker: you raised this bid, so it must be approved by someone else.' });
  }

  db.prepare('UPDATE rec_bids SET status = ?, approved_by = ?, reject_reason = ? WHERE id = ?')
    .run(status, req.user?.id || null, status === 'REJECTED' ? reason : null, bid.id);

  secureLogAudit(req, {
    action: status === 'REJECTED' ? 'REJECT_REC_BID' : 'APPROVE_REC_BID',
    module: 'TRADING', entityType: 'rec_bid', entityId: bid.id,
    details: { status, reject_reason: reason || undefined },
  });
  res.json(getBid(bid.id));
});

/**
 * Record what the session cleared, and move the certificates.
 *
 * On a sell this draws the executed quantity out of the ledger oldest-vintage
 * first and books a sale tranche against every lot it came from; on a buy the
 * certificates enter as a new issued lot. Either way the bid and the inventory
 * move together or not at all.
 */
router.post('/bids/:id/execute', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = getBid(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Not found' });
  if (bid.status !== 'APPROVED') {
    return res.status(400).json({ error: `Only an APPROVED bid can be executed (currently ${bid.status})` });
  }
  const b = req.body || {};
  const tradeDate = b.trade_date || new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(tradeDate)) return res.status(400).json({ error: 'trade_date must be YYYY-MM-DD' });

  let result;
  try {
    result = executeRecBid({
      bid,
      executed_quantity: b.executed_quantity ?? bid.quantity,
      discovered_rate: b.discovered_rate ?? bid.price,
      trade_date: tradeDate,
      buyer: b.buyer || null,
      actor: req.user?.id || null,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message, available: err.available });
  }

  // A sell settles into the REC Order register, which is where the desk reads
  // realised revenue from. A buy has no sale to settle.
  let order = null;
  if (bid.side === 'Sell') {
    const s = result.settlement;
    const orderId = newId('RCO');
    db.prepare(`
      INSERT INTO rec_orders (
        id, trade_date, rec_placed_for_sale, bid_rate, total_recs_sold, discovered_rate,
        trade_obligation, gst_on_trade_obligation, exchange_fees, gst_on_exchange_fees, net_revenue,
        buyer_name, recs_bought, base_amount, tax_amount, total_amount, status, generated_from, bid_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 'SUBMITTED', 'SETTLEMENT', ?, ?)
    `).run(
      orderId, tradeDate, bid.quantity, bid.price,
      s.total_recs_sold, s.discovered_rate,
      s.trade_obligation, s.gst_on_trade_obligation, s.exchange_fees, s.gst_on_exchange_fees, s.net_revenue,
      b.buyer || null, bid.id, req.user?.id || null,
    );
    db.prepare('UPDATE rec_bids SET rec_order_id = ? WHERE id = ?').run(orderId, bid.id);
    order = db.prepare('SELECT * FROM rec_orders WHERE id = ?').get(orderId);
  }

  secureLogAudit(req, {
    action: 'EXECUTE_REC_BID',
    module: 'TRADING', entityType: 'rec_bid', entityId: bid.id,
    details: {
      side: bid.side, executed_quantity: result.executed_quantity, discovered_rate: result.discovered_rate,
      lots_drawn: result.allocations.length, lot_created: result.lot_created, net_revenue: result.settlement.net_revenue,
    },
  });

  res.status(201).json({ ...result, bid: getBid(bid.id), rec_order: order });
});

/** Withdraw a bid that has not yet traded. */
router.post('/bids/:id/cancel', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = getBid(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Not found' });
  if (bid.status === 'EXECUTED') {
    return res.status(400).json({ error: 'An executed bid cannot be cancelled — reverse its transactions instead' });
  }
  if (bid.status === 'CANCELLED') return res.json(bid);

  db.prepare("UPDATE rec_bids SET status = 'CANCELLED' WHERE id = ?").run(bid.id);
  secureLogAudit(req, { action: 'CANCEL_REC_BID', module: 'TRADING', entityType: 'rec_bid', entityId: bid.id });
  res.json(getBid(bid.id));
});

export default router;
