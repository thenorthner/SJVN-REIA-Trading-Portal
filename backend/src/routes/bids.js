import { Router } from 'express';
import { checkAdequacy } from '../paymentSecurityEngine.js';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { getParam } from '../mastersService.js';
import { placeOrder, getTradeResult, syncMarketRates, getIexConfig } from '../services/iexService.js';
import { checkBidCompliance, getClearance, clearancesNeedingAttention } from '../services/standingClearance.js';
import { refreshExchangeContractStatus } from '../services/exchangeSettlement.js';
import { insertBid, logBidEvent, rollUp, utilizedExposure } from '../services/bidWrite.js';
export { utilizedExposure };

const router = Router();
router.use(requireAuth);

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const PRODUCTS = ['DAM', 'HPDAM', 'TAM', 'GDAM', 'RTM', 'GTAM', 'REC', 'ESCERT', 'RPO'];

// OCF (Open Contract Forward) / carry-forward chains permitted across market segments.
// Covers the SOW-named flows: DAM->RTM, GDAM->DAM->RTM and GDAM->RTM.
// Configured in system_parameters so a route can be opened or closed without a
// code change; this constant is only the fallback if the parameter is missing.
const DEFAULT_OCF_CHAINS = {
  GDAM: ['DAM', 'RTM'],
  DAM: ['RTM'],
};

/**
 * Allowed carry-forward targets per source product.
 * A malformed parameter must not take bidding down, so anything that isn't a
 * clean {product: [product,...]} map falls back to the built-in chains.
 */
function ocfChains() {
  const raw = getParam('ocf_carry_forward_chains', null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_OCF_CHAINS;
  const clean = {};
  for (const [from, targets] of Object.entries(raw)) {
    if (!PRODUCTS.includes(from) || !Array.isArray(targets)) continue;
    const valid = targets.filter((t) => PRODUCTS.includes(t) && t !== from);
    if (valid.length) clean[from] = valid;
  }
  return Object.keys(clean).length ? clean : DEFAULT_OCF_CHAINS;
}

/** Pre-fill premium for a FROM>TO transition, 0 when not configured. */
function ocfDefaultPremium(fromProduct, toProduct) {
  const map = getParam('ocf_default_premium', null);
  if (!map || typeof map !== 'object') return 0;
  const n = Number(map[`${fromProduct}>${toProduct}`]);
  return Number.isFinite(n) ? n : 0;
}

const withDetails = (bid) => {
  if (!bid) return bid;
  const client = db.prepare('SELECT name, exposure_limit FROM trading_clients WHERE id = ?').get(bid.client_id);
  bid.client_name = client?.name;
  bid.exposure_limit = client?.exposure_limit;
  bid.blocks = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ? ORDER BY time_block ASC').all(bid.id);
  bid.events = db.prepare('SELECT * FROM bid_events WHERE bid_id = ? ORDER BY created_at DESC').all(bid.id);
  bid.uncleared_mw = bid.blocks.reduce((a, b) => a + Math.max(0, b.quantum_mw - b.cleared_quantum_mw), 0);
  const targets = ocfChains()[bid.product] || [];
  bid.carry_forward_options = targets;
  // Let the UI pre-fill the configured premium for each permitted route.
  bid.carry_forward_defaults = targets.reduce(
    (acc, t) => ({ ...acc, [t]: ocfDefaultPremium(bid.product, t) }), {}
  );
  bid.carried_forward_to = db.prepare('SELECT id FROM bids WHERE carry_forward_from = ?').get(bid.id)?.id || null;
  return bid;
};

const checkGateClosure = (gate_closure_time) => {
  if (!gate_closure_time) return false;
  return new Date() > new Date(gate_closure_time);
};

// List all bids
router.get('/', (req, res) => {
  const { client_id, exchange, status, date, product, from, to } = req.query;
  let sql = 'SELECT * FROM bids WHERE 1=1';
  const params = [];
  if (client_id) { sql += ' AND client_id = ?'; params.push(client_id); }
  if (exchange) { sql += ' AND exchange = ?'; params.push(exchange); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (product) {
    const p = String(product).trim().toUpperCase();
    if (!PRODUCTS.includes(p)) return res.status(400).json({ error: `product must be one of: ${PRODUCTS.join(', ')}` });
    sql += ' AND product = ?';
    params.push(p);
  }
  if (date) { sql += ' AND bid_date = ?'; params.push(date); }
  if (from) { sql += ' AND delivery_date >= ?'; params.push(from); }
  if (to) { sql += ' AND delivery_date <= ?'; params.push(to); }
  sql += ' ORDER BY delivery_date DESC, created_at DESC';

  res.json(db.prepare(sql).all(...params).map(withDetails));
});

// Permitted OCF carry-forward transitions (declared before /:id so it is not captured).
// IEX connection state — which pulls are live and what is still stub.
// Clearance states across the desk — drives the compliance ticker and the
// clearance alerts on the notification bell. Declared before '/:id'.
router.get('/standing-clearance', (req, res) => {
  res.json(clearancesNeedingAttention());
});

// Standing clearance on record for a client, with its derived state. Declared
// before '/:id' so the literal path is not swallowed by the id route.
router.get('/standing-clearance/:clientId', (req, res) => {
  const clearance = getClearance(req.params.clientId);
  if (!clearance) return res.status(404).json({ error: 'Client not found' });
  res.json(clearance);
});

// Dry-run the clause 21-24/26 checks without writing a bid, so the bidding
// screen can show the same findings the API would enforce.
router.post('/compliance-check', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body || {};
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(b.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const result = checkBidCompliance({
    client, product: b.product, exchange: b.exchange, deliveryDate: b.delivery_date,
    type: b.type, blocks: Array.isArray(b.blocks) ? b.blocks : [], bidOn: b.bid_on,
    forcedOutage: !!b.forced_outage, excludeBidId: b.exclude_bid_id || null,
  });
  res.json({ ok: result.violations.length === 0, ...result });
});

router.get('/iex/status', (_req, res) => {
  const cfg = getIexConfig();
  res.json({
    enabled: cfg.enabled,
    live: cfg.live,
    base_url_set: !!cfg.baseUrl,
    token_set: !!cfg.token,
    login_user_id_set: !!cfg.loginUserId,
    participant_id: cfg.participantId || null,
    mode: cfg.live ? 'IEX' : 'STUB',
    capabilities: {
      cleared_results: cfg.live ? 'LIVE' : 'STUB',
      market_prices: cfg.live ? 'LIVE' : 'STUB',
      // Two-way and money-moving: stays manual until a controlled rollout.
      bid_submission: 'STUB',
    },
  });
});

// Pull a delivery date's market clearing prices into market_rates, so analytics
// runs on exchange observations rather than seeded data.
router.post('/iex/market-rates/sync', requireRole(...ROLE_GROUPS.TRADING_WRITE), async (req, res) => {
  const date = String(req.body?.date || '').trim();
  const product = String(req.body?.product || 'DAM').trim().toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date (YYYY-MM-DD) is required' });
  if (!PRODUCTS.includes(product)) return res.status(400).json({ error: `product must be one of: ${PRODUCTS.join(', ')}` });
  try {
    const result = await syncMarketRates(product, date, { exchange: String(req.body?.exchange || 'IEX').toUpperCase() });
    if (!result.ok) return res.status(502).json(result);
    if (result.rows_written) {
      secureLogAudit(req, { action: 'IEX_MARKET_RATES_SYNC', module: 'TRADING', entityType: 'market_rate', entityId: `${product}:${date}`, details: result });
    }
    res.json(result);
  } catch (err) {
    console.error('IEX market rates sync error:', err);
    res.status(500).json({ error: err.message || 'Market rates sync failed' });
  }
});

router.get('/ocf-chains', (_req, res) => res.json({
  chains: ocfChains(),
  default_premium: getParam('ocf_default_premium', {}) || {},
  configured_via: 'system_parameters: ocf_carry_forward_chains, ocf_default_premium',
}));

// CSV template for bulk bid upload.
router.get('/bulk-template', (_req, res) => {
  const lines = [
    'client_id,exchange,product,bid_date,delivery_date,gate_closure_time,time_block,quantum_mw,price_per_unit',
    'TC-001,IEX,DAM,2026-07-27,2026-07-28,2026-07-27T10:00,Block-1,50,4.25',
    'TC-001,IEX,DAM,2026-07-27,2026-07-28,2026-07-27T10:00,Block-2,45,4.10',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=bid_bulk_template.csv');
  res.send(lines.join('\n'));
});

// Get single bid
router.get('/:id', (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  res.json(withDetails(bid));
});

// Full OCF lineage for a bid — walks back to the original leg, then forward through carry-forwards.
router.get('/:id/chain', (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });

  // Walk back to the original leg, guarding against a malformed cycle.
  let root = bid;
  const ancestors = new Set([root.id]);
  while (root.carry_forward_from) {
    const parent = db.prepare('SELECT * FROM bids WHERE id = ?').get(root.carry_forward_from);
    if (!parent || ancestors.has(parent.id)) break;
    ancestors.add(parent.id);
    root = parent;
  }

  // Then walk forward through the carry-forward legs.
  const chain = [];
  const visited = new Set();
  let cursor = root;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.push(withDetails(cursor));
    cursor = db.prepare('SELECT * FROM bids WHERE carry_forward_from = ?').get(cursor.id);
  }
  res.json({ root_id: root.id, legs: chain });
});

// Create a new Master Bid (Portfolio/Block Bid)
router.post('/', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;

  // ── Early input validation ────────────────────────────────────────────
  const VALID_EXCHANGES = ['IEX', 'PXIL', 'HPX'];

  if (!b.client_id) return res.status(400).json({ error: 'client_id is required' });

  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(b.client_id);
  if (!client) return res.status(400).json({ error: `Client '${b.client_id}' does not exist` });
  if (client.status === 'SUSPENDED') return res.status(403).json({ error: 'Client is suspended. Bidding not allowed.' });

  if (b.exchange && !VALID_EXCHANGES.includes(b.exchange)) {
    return res.status(400).json({ error: `exchange must be one of: ${VALID_EXCHANGES.join(', ')}` });
  }

  // Filing a bid under an exchange agreement is optional, but naming one that
  // does not exist — or that belongs to another client — would silently break
  // the settlement roll-up, so it is rejected here instead.
  if (b.contract_id) {
    const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(b.contract_id);
    if (!contract) return res.status(400).json({ error: `Exchange contract '${b.contract_id}' does not exist` });
    if (contract.client_id && contract.client_id !== b.client_id) {
      return res.status(400).json({ error: 'contract_id belongs to a different client' });
    }
    if (b.delivery_date && (b.delivery_date < contract.start_date || b.delivery_date > contract.end_date)) {
      return res.status(400).json({
        error: `delivery_date ${b.delivery_date} falls outside the contract window ${contract.start_date} to ${contract.end_date}`,
      });
    }
  }

  if (!Array.isArray(b.blocks) || b.blocks.length === 0) {
    return res.status(400).json({ error: 'At least one bid block is required' });
  }

  // Named up front rather than discovered one crash at a time. These are NOT
  // NULL on the table, so a payload missing any of them reached the insert and
  // came back as a 500 naming a column — three separate attempts to learn what a
  // bid needs.
  const missing = [
    ['product', b.product], ['bid_date', b.bid_date], ['delivery_date', b.delivery_date],
    ['quantum_mw', b.quantum_mw], ['price_per_unit', b.price_per_unit],
  ].filter(([, v]) => v === undefined || v === null || v === '').map(([k]) => k);
  const blockMissing = b.blocks.some((blk) => blk?.time_block === undefined || blk?.time_block === null);
  if (blockMissing) missing.push('blocks[].time_block');
  if (missing.length) {
    return res.status(400).json({ error: `A bid needs ${missing.join(', ')}.`, missing_fields: missing });
  }

  // Numeric floor checks — catch garbage before it reaches exposure arithmetic.
  const qty = Number(b.quantum_mw);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'quantum_mw must be a positive number' });
  }
  const price = Number(b.price_per_unit);
  if (!Number.isFinite(price) || price < 0) {
    return res.status(400).json({ error: 'price_per_unit must be a non-negative number' });
  }
  for (const blk of b.blocks) {
    const bq = Number(blk.quantum_mw);
    const bp = Number(blk.price_per_unit);
    if (!Number.isFinite(bq) || bq <= 0) {
      return res.status(400).json({ error: `Block ${blk.time_block}: quantum_mw must be a positive number` });
    }
    if (!Number.isFinite(bp) || bp < 0) {
      return res.status(400).json({ error: `Block ${blk.time_block}: price_per_unit must be a non-negative number` });
    }
  }

  // Payment security on the counterparty this bid creates exposure to. Adequacy
  // was computed and reported and consulted by nothing, so a bid could be placed
  // for a buyer whose cover stood at seven per cent of what it already owed —
  // the module measured the risk and had no way to act on it.
  if (client.entity_id) {
    const adequacy = checkAdequacy({ buyerEntityId: client.entity_id });
    if (!adequacy.adequate) {
      const override = String(b.security_override_reason || '').trim();
      if (!override) {
        const weak = (adequacy.weak || [])[0] || {};
        return res.status(400).json({
          error: `${client.name} does not hold adequate payment security — cover is ${weak.coverage_ratio ?? '?'}× its exposure. Replenish the security, or pass security_override_reason to take this exposure on anyway.`,
          adequacy,
        });
      }
    }
  }

  const totalExposure = rollUp(b.blocks, b.product).exposure;
  const currentUtilized = utilizedExposure(client.id);

  if ((currentUtilized + totalExposure) > client.exposure_limit) {
    return res.status(400).json({
      error: 'Exposure limit breached.',
      limit: client.exposure_limit,
      utilized: currentUtilized,
      requested: totalExposure,
    });
  }

  // SLDC standing clearance (clauses 21-24, 26). Enforced here as well as in the
  // bidding screen — these are the terms the clearance was granted under, so a
  // bid posted straight to the API has to satisfy them too.
  const compliance = checkBidCompliance({
    client, product: b.product, exchange: b.exchange, deliveryDate: b.delivery_date,
    type: b.type, blocks: b.blocks, bidOn: b.bid_on, forcedOutage: !!b.forced_outage,
  });
  if (compliance.violations.length) {
    return res.status(400).json({
      error: 'Standing clearance compliance check failed.',
      violations: compliance.violations,
      warnings: compliance.warnings,
    });
  }

  const { bidId } = insertBid(b, b.blocks, req.user.id);
  logBidEvent(bidId, req.user.id, 'CREATED', { totalExposure, complianceWarnings: compliance.warnings.map((w) => w.code) });

  secureLogAudit(req, { action: 'CREATE_BID', module: 'TRADING', entityType: 'bid', entityId: bidId, details: { totalExposure, complianceWarnings: compliance.warnings } });

  res.status(201).json({
    ...withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bidId)),
    compliance_warnings: compliance.warnings,
  });
});

// Bulk bid upload — accepts parsed CSV/Excel/paste rows and groups them into portfolio bids.
// dry_run returns the same validation result without writing anything.
router.post('/bulk', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const dryRun = !!req.body.dry_run;
  if (rows.length === 0) return res.status(400).json({ error: 'No rows supplied' });

  const errors = [];
  const groups = new Map();
  const clientCache = new Map();

  rows.forEach((raw, idx) => {
    const line = idx + 1; // 1-based, matching the user's spreadsheet row
    const row = {
      client_id: String(raw.client_id ?? '').trim(),
      exchange: String(raw.exchange ?? '').trim().toUpperCase(),
      product: String(raw.product ?? '').trim().toUpperCase(),
      bid_date: String(raw.bid_date ?? '').trim(),
      delivery_date: String(raw.delivery_date ?? '').trim(),
      gate_closure_time: String(raw.gate_closure_time ?? '').trim(),
      time_block: String(raw.time_block ?? '').trim(),
      quantum_mw: Number(raw.quantum_mw),
      price_per_unit: Number(raw.price_per_unit),
    };

    const rowErrors = [];
    if (!row.client_id) rowErrors.push('client_id is required');
    if (!EXCHANGES.includes(row.exchange)) rowErrors.push(`exchange must be one of ${EXCHANGES.join('/')}`);
    if (!PRODUCTS.includes(row.product)) rowErrors.push(`product must be one of ${PRODUCTS.join('/')}`);
    if (!row.bid_date) rowErrors.push('bid_date is required');
    if (!row.delivery_date) rowErrors.push('delivery_date is required');
    if (!row.time_block) rowErrors.push('time_block is required');
    if (!Number.isFinite(row.quantum_mw) || row.quantum_mw <= 0) rowErrors.push('quantum_mw must be a positive number');
    if (!Number.isFinite(row.price_per_unit) || row.price_per_unit < 0) rowErrors.push('price_per_unit must be a non-negative number');

    if (row.client_id) {
      if (!clientCache.has(row.client_id)) {
        clientCache.set(row.client_id, db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(row.client_id));
      }
      const client = clientCache.get(row.client_id);
      if (!client) rowErrors.push(`client ${row.client_id} not found`);
      else if (client.status === 'SUSPENDED') rowErrors.push(`client ${client.name} is suspended`);
    }
    if (row.gate_closure_time && checkGateClosure(row.gate_closure_time)) {
      rowErrors.push('gate closure time has already passed');
    }

    if (rowErrors.length) { errors.push({ row: line, errors: rowErrors }); return; }

    const key = [row.client_id, row.exchange, row.product, row.bid_date, row.delivery_date, row.gate_closure_time].join('|');
    if (!groups.has(key)) {
      groups.set(key, { header: { ...row }, blocks: [], rows: [] });
    }
    const group = groups.get(key);
    if (group.blocks.some((b) => b.time_block === row.time_block)) {
      errors.push({ row: line, errors: [`duplicate time_block "${row.time_block}" for this bid`] });
      return;
    }
    group.blocks.push({ time_block: row.time_block, quantum_mw: row.quantum_mw, price_per_unit: row.price_per_unit });
    group.rows.push(line);
  });

  // Exposure is checked per client across everything in this upload plus what is already live.
  const perClient = new Map();
  for (const group of groups.values()) {
    const exposure = rollUp(group.blocks, group.header.product).exposure;
    perClient.set(group.header.client_id, (perClient.get(group.header.client_id) || 0) + exposure);
  }
  for (const [clientId, requested] of perClient) {
    const client = clientCache.get(clientId);
    if (!client) continue;
    const utilized = utilizedExposure(clientId);
    if (utilized + requested > client.exposure_limit) {
      errors.push({
        row: null,
        errors: [`Exposure limit breached for ${client.name}: limit ${client.exposure_limit}, utilized ${utilized}, this upload ${requested}`],
      });
    }
  }

  const preview = [...groups.values()].map((g) => ({
    client_id: g.header.client_id,
    client_name: clientCache.get(g.header.client_id)?.name,
    exchange: g.header.exchange,
    product: g.header.product,
    bid_date: g.header.bid_date,
    delivery_date: g.header.delivery_date,
    blocks: g.blocks.length,
    total_mw: rollUp(g.blocks, g.header.product).quantum_mw,
    exposure: rollUp(g.blocks, g.header.product).exposure,
    source_rows: g.rows,
  }));

  if (dryRun || errors.length) {
    return res.status(errors.length ? 400 : 200).json({
      dry_run: true, rows_received: rows.length, bids_to_create: preview.length, preview, errors,
    });
  }

  // All-or-nothing: a bad upload must not leave half the portfolio in the book.
  const created = db.transaction(() => {
    const ids = [];
    for (const group of groups.values()) {
      const { bidId } = insertBid(group.header, group.blocks, req.user.id);
      logBidEvent(bidId, req.user.id, 'CREATED', { source: 'BULK_UPLOAD', rows: group.rows });
      ids.push(bidId);
    }
    return ids;
  })();

  secureLogAudit(req, {
    action: 'BULK_UPLOAD_BIDS', module: 'TRADING', entityType: 'bid', entityId: created[0] || null,
    details: { rows: rows.length, bids_created: created.length },
  });

  res.status(201).json({ rows_received: rows.length, bids_created: created.length, bid_ids: created, preview, errors: [] });
});

// Submit Bid to Exchange (Automated via IEX FO API)
router.post('/:id/submit', requireRole(...ROLE_GROUPS.TRADING_WRITE), async (req, res) => {
  try {
    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.approval_status !== 'APPROVED') return res.status(400).json({ error: 'Bid must be approved before submission' });
    if (checkGateClosure(bid.gate_closure_time)) return res.status(400).json({ error: 'Gate closure time passed. Cannot submit.' });

    const fullBid = withDetails(bid);

    // Re-check the clearance at the exchange boundary, not just at draft time.
    // The clearance can lapse between the two, and a competing bid on another
    // exchange only holds T-GNA capacity once it has itself been submitted.
    const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(bid.client_id);
    const compliance = checkBidCompliance({
      client, product: bid.product, exchange: bid.exchange, deliveryDate: bid.delivery_date,
      type: bid.type, blocks: fullBid.blocks, bidOn: bid.bid_on,
      forcedOutage: !!req.body?.forced_outage, excludeBidId: bid.id,
    });
    if (compliance.violations.length) {
      return res.status(400).json({
        error: 'Standing clearance compliance check failed — bid not sent to the exchange.',
        violations: compliance.violations,
        warnings: compliance.warnings,
      });
    }

    const response = await placeOrder(fullBid);
    const receiptRef = response.receiptRef || `EXC-RCPT-${Date.now()}`;

    db.prepare("UPDATE bids SET status = 'SUBMITTED', exchange_receipt_ref = ? WHERE id = ?").run(receiptRef, bid.id);
    logBidEvent(bid.id, req.user.id, 'SUBMITTED', { receiptRef });
    // A live bid on the exchange makes its agreement an active one.
    if (bid.contract_id) refreshExchangeContractStatus(bid.contract_id);

    secureLogAudit(req, { action: 'SUBMIT_BID', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: { receiptRef } });

    res.json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to submit to exchange' });
  }
});

// Sync result from IEX Back Office (BO) API
router.post('/:id/sync-result', requireRole(...ROLE_GROUPS.TRADING_WRITE), async (req, res) => {
  try {
    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (bid.status !== 'SUBMITTED') return res.status(400).json({ error: 'Only a submitted bid can be synced' });

    const fullBid = withDetails(bid);
    const response = await getTradeResult(fullBid);

    if (!response.success || !response.blocks) {
      return res.status(400).json({ error: response.message || 'Failed to sync result' });
    }

    const blocks = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ?').all(bid.id);
    const byBlock = new Map(blocks.map((b) => [String(b.time_block), b]));

    for (const r of response.blocks) {
      const block = byBlock.get(String(r.time_block));
      if (!block) continue;
      const cleared = Number(r.cleared_mw);
      const status = cleared === 0 ? 'UNCLEARED' : cleared >= block.quantum_mw ? 'CLEARED' : 'PARTIALLY_CLEARED';
      // cleared_price is Rs/kWh everywhere in this platform — the same scale as
      // price_per_unit, the CERC caps and the exposure formula. The service has
      // already converted from the exchange's Rs/MWh; writing an unconverted
      // figure here would be out by 1000x and poison P&L and exposure.
      const clearedPrice = r.cleared_price_rs_per_kwh ?? null;
      db.prepare('UPDATE bid_blocks SET cleared_quantum_mw = ?, cleared_price = ?, status = ? WHERE id = ?')
        .run(cleared, clearedPrice, status, block.id);
    }

    for (const b of blocks) {
      if (!response.blocks.find(r => String(r.time_block) === String(b.time_block))) {
        db.prepare('UPDATE bid_blocks SET cleared_quantum_mw = 0, status = ? WHERE id = ?').run('UNCLEARED', b.id);
      }
    }

    const updated = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ?').all(bid.id);
    const totalReq = updated.reduce((a, b) => a + b.quantum_mw, 0);
    const totalCleared = updated.reduce((a, b) => a + b.cleared_quantum_mw, 0);
    const clearedValue = updated.reduce((a, b) => a + (b.cleared_quantum_mw * (b.cleared_price ?? b.price_per_unit)), 0);
    const headerStatus = totalCleared === 0 ? 'REJECTED' : totalCleared >= totalReq ? 'CLEARED' : 'PARTIALLY_CLEARED';

    db.prepare('UPDATE bids SET cleared_quantum_mw = ?, cleared_price = ?, status = ? WHERE id = ?')
      .run(totalCleared, totalCleared > 0 ? clearedValue / totalCleared : null, headerStatus, bid.id);

    // Record which source the numbers came from — a stub clearing and a real
    // exchange result must never be indistinguishable after the fact.
    logBidEvent(bid.id, req.user.id, 'RESULT_SYNCED', { totalReq, totalCleared, headerStatus, source: response.mode || 'UNKNOWN' });
    secureLogAudit(req, { action: 'SYNC_BID_RESULT', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: { totalCleared, headerStatus, source: response.mode } });

    res.json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to sync exchange result' });
  }
});

// Record the exchange clearing result block-wise. Whatever does not clear becomes
// the uncleared quantum available for OCF carry-forward.
router.post('/:id/result', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (bid.status !== 'SUBMITTED') return res.status(400).json({ error: 'Only a submitted bid can receive an exchange result' });

  const results = Array.isArray(req.body.blocks) ? req.body.blocks : [];
  const blocks = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ?').all(bid.id);
  const byBlock = new Map(blocks.map((b) => [b.time_block, b]));

  for (const r of results) {
    const block = byBlock.get(String(r.time_block));
    if (!block) return res.status(400).json({ error: `Unknown time_block "${r.time_block}" for this bid` });
    const cleared = Number(r.cleared_quantum_mw);
    if (!Number.isFinite(cleared) || cleared < 0 || cleared > block.quantum_mw) {
      return res.status(400).json({ error: `cleared_quantum_mw for ${block.time_block} must be between 0 and ${block.quantum_mw}` });
    }
    const status = cleared === 0 ? 'UNCLEARED' : cleared >= block.quantum_mw ? 'CLEARED' : 'PARTIALLY_CLEARED';
    db.prepare('UPDATE bid_blocks SET cleared_quantum_mw = ?, cleared_price = ?, status = ? WHERE id = ?')
      .run(cleared, r.cleared_price ?? null, status, block.id);
  }

  const updated = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ?').all(bid.id);
  const totalReq = updated.reduce((a, b) => a + b.quantum_mw, 0);
  const totalCleared = updated.reduce((a, b) => a + b.cleared_quantum_mw, 0);
  const clearedValue = updated.reduce((a, b) => a + b.cleared_quantum_mw * (b.cleared_price ?? b.price_per_unit), 0);
  const headerStatus = totalCleared === 0 ? 'REJECTED' : totalCleared >= totalReq ? 'CLEARED' : 'PARTIALLY_CLEARED';

  db.prepare('UPDATE bids SET cleared_quantum_mw = ?, cleared_price = ?, status = ? WHERE id = ?')
    .run(totalCleared, totalCleared > 0 ? clearedValue / totalCleared : null, headerStatus, bid.id);

  if (bid.contract_id) refreshExchangeContractStatus(bid.contract_id);
  logBidEvent(bid.id, req.user.id, 'RESULT_RECORDED', { totalReq, totalCleared, headerStatus });
  secureLogAudit(req, { action: 'RECORD_BID_RESULT', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: { totalCleared, headerStatus } });

  res.json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
});

// OCF carry-forward: roll the uncleared quantum into the next market segment,
// applying a configurable premium (+) or discount (-) in Rs/unit on the bid price.
router.post('/:id/carry-forward', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const source = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Bid not found' });

  const toProduct = String(req.body.to_product ?? '').trim().toUpperCase();
  // Omitting the premium applies the configured default for this route;
  // an explicit value (including 0) always wins.
  const supplied = req.body.premium_discount;
  const premium = supplied === undefined || supplied === null || supplied === ''
    ? ocfDefaultPremium(source.product, toProduct)
    : Number(supplied);
  if (!Number.isFinite(premium)) return res.status(400).json({ error: 'premium_discount must be a number' });

  const allowed = ocfChains()[source.product] || [];
  if (!allowed.includes(toProduct)) {
    return res.status(400).json({ error: `Carry-forward from ${source.product} is only allowed to: ${allowed.join(', ') || 'none'}` });
  }
  if (!['PARTIALLY_CLEARED', 'REJECTED'].includes(source.status)) {
    return res.status(400).json({ error: 'Record the exchange result first — only uncleared quantum can be carried forward' });
  }
  const existing = db.prepare('SELECT id FROM bids WHERE carry_forward_from = ?').get(source.id);
  if (existing) return res.status(400).json({ error: `This bid was already carried forward as ${existing.id}` });

  const srcBlocks = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ? ORDER BY time_block ASC').all(source.id);
  const blocks = srcBlocks
    .map((b) => ({
      time_block: b.time_block,
      quantum_mw: Math.max(0, b.quantum_mw - b.cleared_quantum_mw),
      // Exchange bids are quoted to paise precision.
      price_per_unit: Math.max(0, Math.round((b.price_per_unit + premium) * 100) / 100),
    }))
    .filter((b) => b.quantum_mw > 0);

  if (blocks.length === 0) return res.status(400).json({ error: 'Nothing left to carry forward — the bid cleared fully' });

  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(source.client_id);
  if (client?.status === 'SUSPENDED') return res.status(403).json({ error: 'Client is suspended. Bidding not allowed.' });

  const exposure = rollUp(blocks, toProduct).exposure;
  const utilized = utilizedExposure(source.client_id);
  if (utilized + exposure > client.exposure_limit) {
    return res.status(400).json({ error: 'Exposure limit breached.', limit: client.exposure_limit, utilized, requested: exposure });
  }

  const header = {
    client_id: source.client_id,
    exchange: req.body.exchange || source.exchange,
    product: toProduct,
    bid_date: req.body.bid_date || source.bid_date,
    delivery_date: req.body.delivery_date || source.delivery_date,
    gate_closure_time: req.body.gate_closure_time || null,
    // The leg trades under the same client agreement as the bid it came from.
    // Carrying the link matters because the leg changes product — DAM volume
    // rolled into RTM — so the settlement's fallback match on client+product
    // would not find it, and the volume it eventually clears would drop out of
    // the contract's settlement entirely.
    contract_id: source.contract_id || null,
    carry_forward_from: source.id,
    ocf_leg: (source.ocf_leg || 0) + 1,
    premium_discount: premium,
  };

  const { bidId, roll } = insertBid(header, blocks, req.user.id);
  logBidEvent(bidId, req.user.id, 'CARRY_FORWARD_IN', { from: source.id, from_product: source.product, premium, carried_mw: roll.quantum_mw });
  logBidEvent(source.id, req.user.id, 'CARRY_FORWARD_OUT', { to: bidId, to_product: toProduct, premium, carried_mw: roll.quantum_mw });

  secureLogAudit(req, {
    action: 'CARRY_FORWARD_BID', module: 'TRADING', entityType: 'bid', entityId: bidId,
    details: { from: source.id, from_product: source.product, to_product: toProduct, premium, carried_mw: roll.quantum_mw },
  });

  res.status(201).json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bidId)));
});

// Approve/Reject Bid
router.post('/:id/approve', requireRole(...ROLE_GROUPS.TRADING_CHECKER), (req, res) => {
  const { status, reason } = req.body;
  const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Bid not found' });

  // Previously any string was written straight through, so a typo could park a
  // bid in a status nothing else recognises.
  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: "status must be 'APPROVED' or 'REJECTED'" });
  }
  if (bid.approval_status !== 'PENDING') {
    return res.status(409).json({ error: `Bid is already ${bid.approval_status}` });
  }
  // Maker-checker: the person who raised the bid cannot be the one who clears
  // it. Configurable because a single-trader desk would otherwise be unable to
  // approve anything at all — but it defaults on, and turning it off is a
  // deliberate, audited change rather than a control that never existed.
  if (getParam('trading_enforce_maker_checker', 'true') !== 'false' && bid.created_by === req.user.id) {
    return res.status(403).json({
      error: 'Maker-checker: you raised this bid, so it must be approved by someone else.',
    });
  }

  db.prepare('UPDATE bids SET approval_status = ?, status = ? WHERE id = ?').run(
    status, status === 'REJECTED' ? 'REJECTED' : bid.status, bid.id
  );

  logBidEvent(bid.id, req.user.id, status, { reason });

  secureLogAudit(req, { action: 'APPROVE_BID', module: 'TRADING', entityType: 'bid', entityId: bid.id, details: { status, reason } });
  res.json(withDetails(db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.id)));
});

// Explicit No-Bid Logging
router.post('/no-bid', requireRole(...ROLE_GROUPS.TRADING_WRITE), (req, res) => {
  const b = req.body;
  const bidId = newId('BID');

  db.prepare(`
    INSERT INTO bids (id, client_id, exchange, product, bid_date, delivery_date, quantum_mw, price_per_unit, is_no_bid, no_bid_reason, approval_status, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?, 'APPROVED', 'NO_BID', ?)
  `).run(bidId, b.client_id, b.exchange, b.product, b.bid_date, b.delivery_date, b.reason, req.user.id);

  secureLogAudit(req, { action: 'LOG_NO_BID', module: 'TRADING', entityType: 'bid', entityId: bidId, details: b });
  res.json({ success: true, id: bidId });
});

export default router;
