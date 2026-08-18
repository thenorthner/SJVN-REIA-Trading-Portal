import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam } from '../mastersService.js';

// Shared bid insert used by the DAM desk, bulk upload, OCF carry-forward, and
// the ISET Exchange Bidding forms. Those screens used to write their own
// tables and leave `bids` empty, so settlement never saw the trade.

const DEFAULT_BLOCK_HOURS = { DAM: 0.25, GDAM: 0.25, GTAM: 0.25, RTM: 0.5 };

export function blockHours(product) {
  const map = getParam('bid_block_duration_hours', null);
  const n = Number(map && typeof map === 'object' ? map[product] : undefined);
  return Number.isFinite(n) && n > 0 ? n : (DEFAULT_BLOCK_HOURS[product] ?? 0.25);
}

export const blockValue = (block, product) =>
  Number(block.quantum_mw || 0) * 1000 * blockHours(product) * Number(block.price_per_unit || 0);

export const rollUp = (blocks, product) => {
  const mw = blocks.reduce((a, b) => a + Number(b.quantum_mw || 0), 0);
  const priceWeighted = blocks.reduce((a, b) => a + Number(b.quantum_mw || 0) * Number(b.price_per_unit || 0), 0);
  const exposure = blocks.reduce((a, b) => a + blockValue(b, product), 0);
  return { quantum_mw: mw, price_per_unit: mw > 0 ? priceWeighted / mw : 0, exposure };
};

const LIVE_BID_STATUSES = ['SUBMITTED', 'CLEARED', 'PARTIALLY_CLEARED'];

export const utilizedExposure = (clientId) => db.prepare(`
  SELECT b.product AS product, blk.quantum_mw AS quantum_mw, blk.price_per_unit AS price_per_unit
  FROM bids b JOIN bid_blocks blk ON b.id = blk.bid_id
  WHERE b.client_id = ? AND b.status IN (${LIVE_BID_STATUSES.map(() => '?').join(',')})
`).all(clientId, ...LIVE_BID_STATUSES).reduce((a, r) => a + blockValue(r, r.product), 0);

export function logBidEvent(bidId, actorId, eventType, details) {
  db.prepare('INSERT INTO bid_events (id, bid_id, actor_id, event_type, details) VALUES (?, ?, ?, ?, ?)')
    .run(newId('BEV'), bidId, actorId, eventType, JSON.stringify(details ?? {}));
}

/**
 * Insert a bid header + its 15-minute blocks. Always lands as DRAFT / PENDING
 * approval — ISET "Submit" still goes through maker-checker on the DAM desk.
 */
export function insertBid(header, blocks, actorId) {
  const bidId = header.id || newId('BID');
  const roll = rollUp(blocks, header.product);
  const sourceKind = header.source_kind || 'DESK';
  const sourceId = header.source_id || null;

  db.prepare(`
    INSERT INTO bids (
      id, client_id, exchange, product, bid_date, delivery_date, gate_closure_time,
      quantum_mw, price_per_unit, bid_on, contract_id, carry_forward_from, ocf_leg, premium_discount,
      is_no_bid, approval_status, status, created_by, source_kind, source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', 'DRAFT', ?, ?, ?)
  `).run(
    bidId, header.client_id, header.exchange, header.product, header.bid_date, header.delivery_date,
    header.gate_closure_time || null, roll.quantum_mw, roll.price_per_unit,
    header.bid_on === 'PERIPHERY' ? 'PERIPHERY' : 'EX-BUS',
    header.contract_id || null,
    header.carry_forward_from || null, header.ocf_leg || 0, header.premium_discount || 0, actorId,
    sourceKind, sourceId,
  );

  const insertBlock = db.prepare(
    'INSERT INTO bid_blocks (id, bid_id, time_block, quantum_mw, price_per_unit) VALUES (?, ?, ?, ?, ?)',
  );
  for (const blk of blocks) {
    insertBlock.run(newId('BLK'), bidId, blk.time_block, Number(blk.quantum_mw), Number(blk.price_per_unit));
  }
  return { bidId, roll };
}
