import db from '../db/index.js';

export const REPORT_TYPES = ['DAM_SINGLE', 'DAM_BLOCK', 'RTM_SINGLE', 'RTM_BLOCK'];

const DAM_PRODUCTS = ['DAM', 'GDAM', 'HPDAM'];
const RTM_PRODUCTS = ['RTM'];
const VISIBLE_STATUSES = ['SUBMITTED', 'CLEARED', 'PARTIALLY_CLEARED', 'REJECTED', 'CANCELLED'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISET delivery dates read `12-Aug-2026`, not ISO. */
export function formatIexDate(iso) {
  const s = String(iso || '').slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

export function formatIexDateTime(isoOrSql) {
  const raw = String(isoOrSql || '').trim();
  if (!raw) return '';
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, '0');
  const mon = MONTHS[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}-${mon}-${yyyy} ${hh}:${mm}:${ss}`;
}

function parseMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function periodFromBlock(timeBlock) {
  const [from, to] = String(timeBlock || '').split('-');
  return { from: (from || '').trim(), to: (to || '').trim() };
}

export function spanFromBlocks(blocks) {
  let minStart = Number.MAX_SAFE_INTEGER;
  let maxEnd = -1;
  for (const blk of blocks) {
    const { from, to } = periodFromBlock(blk.time_block);
    const s = parseMinutes(from);
    const e = parseMinutes(to);
    if (s != null) minStart = Math.min(minStart, s);
    if (e != null) maxEnd = Math.max(maxEnd, e);
  }
  if (minStart === Number.MAX_SAFE_INTEGER || maxEnd < 0) return { from: '', to: '' };
  const label = (mins) => {
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
  };
  return { from: label(minStart), to: label(maxEnd) };
}

export function isBlockBid(contract, blocks) {
  const bt = String(contract?.bidding_type || '').toLowerCase();
  if (bt.includes('block')) return true;
  if (bt.includes('single') || bt.includes('differential')) return false;
  if (blocks.length <= 1) return false;
  const prices = new Set(blocks.map((b) => Number(b.price_per_unit).toFixed(4)));
  return prices.size === 1;
}

function rsPerMwh(kwh) {
  const n = Number(kwh);
  if (!Number.isFinite(n)) return '0.0';
  return (n * 1000).toFixed(1);
}

/** IEX bid book totals cleared MW per 15-min interval (MW summed across blocks). */
export function totalExecutedMwBlocks(blocks) {
  return blocks.reduce((sum, b) => sum + Number(b.cleared_quantum_mw || 0), 0);
}

export function weightedClearingPriceMwh(blocks) {
  let mw = 0;
  let value = 0;
  for (const b of blocks) {
    const cleared = Number(b.cleared_quantum_mw || 0);
    if (cleared <= 0) continue;
    const px = b.cleared_price != null ? Number(b.cleared_price) : Number(b.price_per_unit);
    mw += cleared;
    value += cleared * px * 1000;
  }
  return mw > 0 ? (value / mw).toFixed(1) : '0.0';
}

function orderStatus(bid, clearedMw, bidMw) {
  if (bid.status === 'REJECTED' || bid.approval_status === 'REJECTED') return 'Rejected';
  if (bid.status === 'CANCELLED') return 'Cancelled';
  if (bid.status === 'SUBMITTED') return 'Open';
  if (clearedMw <= 0) return bid.status === 'PARTIALLY_CLEARED' ? 'Partially Executed' : 'Open';
  if (clearedMw >= bidMw) return 'Executed';
  return 'Partially Executed';
}

function orderAction(status, product) {
  if (status === 'Open') return product === 'RTM' ? 'In session' : 'In market';
  if (status === 'Rejected') return 'Rejected';
  if (status === 'Cancelled') return 'Cancelled';
  if (status === 'Partially Executed') return product === 'RTM' ? 'Session closed' : 'Window closed';
  return product === 'RTM' ? 'Session closed' : 'Window closed';
}

function syntheticOrderId(bid) {
  if (bid.exchange_receipt_ref) return String(bid.exchange_receipt_ref);
  const digits = String(bid.id).replace(/\D/g, '');
  const prefix = bid.product === 'RTM' ? '226' : '126';
  return `${prefix}${digits.padStart(12, '0').slice(-12)}`;
}

function eventTime(bidId, type, fallback) {
  const row = db.prepare(`
    SELECT created_at FROM bid_events WHERE bid_id = ? AND event_type = ? ORDER BY created_at ASC LIMIT 1
  `).get(bidId, type);
  return formatIexDateTime(row?.created_at || fallback);
}

function rtmSession(fromPeriod) {
  const h = String(fromPeriod || '').slice(0, 2);
  return h && /^\d{2}$/.test(h) ? `RTM-S${h}` : '';
}

function sideLabel(contract) {
  return contract?.side === 'Seller' ? 'Sell' : 'Buy';
}

function signedQuantity(mw, side) {
  const n = Number(mw);
  if (!Number.isFinite(n)) return '0';
  return side === 'Sell' ? String(-Math.abs(n)) : String(Math.abs(n));
}

function matchesReport(reportType, product, blockBid) {
  const isDam = DAM_PRODUCTS.includes(product);
  const isRtm = RTM_PRODUCTS.includes(product);
  switch (reportType) {
    case 'DAM_SINGLE': return isDam && !blockBid;
    case 'DAM_BLOCK': return isDam && blockBid;
    case 'RTM_SINGLE': return isRtm && !blockBid;
    case 'RTM_BLOCK': return isRtm && blockBid;
    default: return false;
  }
}

/**
 * Build ISET Bid Book Request rows from live `bids` / `bid_blocks`.
 * One portfolio bid becomes one book line; block/single routing follows the
 * exchange contract's bidding type (or a uniform multi-block price band).
 */
export function generateIexBidBook(reportType) {
  if (!REPORT_TYPES.includes(reportType)) {
    throw new Error(`report_type must be one of: ${REPORT_TYPES.join(', ')}`);
  }

  const bids = db.prepare(`
    SELECT b.*,
           c.portfolio_id AS contract_portfolio_id,
           c.bidding_type AS contract_bidding_type,
           c.side AS contract_side,
           c.loa_no AS contract_loa_no,
           tc.name AS client_name
    FROM bids b
    LEFT JOIN exchange_contracts c ON c.id = b.contract_id
    LEFT JOIN trading_clients tc ON tc.id = b.client_id
    WHERE b.exchange = 'IEX'
      AND b.is_no_bid = 0
      AND b.status IN (${VISIBLE_STATUSES.map(() => '?').join(',')})
    ORDER BY b.delivery_date DESC, b.created_at DESC, b.id ASC
  `).all(...VISIBLE_STATUSES);

  const rows = [];
  for (const bid of bids) {
    const blocks = db.prepare('SELECT * FROM bid_blocks WHERE bid_id = ? ORDER BY time_block ASC').all(bid.id);
    if (!blocks.length) continue;

    const contract = {
      portfolio_id: bid.contract_portfolio_id,
      bidding_type: bid.contract_bidding_type,
      side: bid.contract_side,
    };
    const blockBid = isBlockBid(contract, blocks);
    if (!matchesReport(reportType, bid.product, blockBid)) continue;

    const span = spanFromBlocks(blocks);
    const clearedMw = totalExecutedMwBlocks(blocks);
    const bidMw = blocks.reduce((a, b) => a + Number(b.quantum_mw || 0), 0);
    const status = orderStatus(bid, clearedMw, bidMw);
    const action = orderAction(status, bid.product);
    const side = sideLabel(contract);
    const tradePrice = weightedClearingPriceMwh(blocks);
    const orderId = syntheticOrderId(bid);
    const participant = db.prepare(`
      SELECT registration_id FROM trading_client_exchanges
      WHERE client_id = ? AND exchange = 'IEX' AND is_active = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(bid.client_id)?.registration_id || 'N2DL0SJV0000';

    const createdAt = bid.created_at || `${bid.delivery_date} 10:05:00`;
    const orderEntry = eventTime(bid.id, 'CREATED', createdAt);
    const orderTime = eventTime(bid.id, 'SUBMITTED', orderEntry);
    const lastUpdated = eventTime(bid.id, 'RESULT_RECORDED',
      eventTime(bid.id, 'RESULT_SYNCED', orderTime));

    let ocfOpted = 'No';
    let premium = '0.0';
    let ocfCategory = '';
    let ocfSourceOrder = '0';
    if (bid.carry_forward_from) {
      ocfOpted = 'Yes';
      premium = String(Number(bid.premium_discount || 0).toFixed(2));
      const parent = db.prepare('SELECT * FROM bids WHERE id = ?').get(bid.carry_forward_from);
      if (parent) {
        ocfCategory = parent.product || '';
        ocfSourceOrder = syntheticOrderId(parent);
      }
    }

    const base = {
      id: bid.id,
      bid_id: bid.id,
      report_type: reportType,
      order_id: orderId,
      delivery_date: formatIexDate(bid.delivery_date),
      asset_id: 'INDIA',
      bid_area_id: 'N1',
      user_id: 'SJVA1',
      participant_id: participant,
      portfolio_id: contract.portfolio_id || 'IEXPORT001',
      order_time: orderTime,
      order_entry_time: orderEntry,
      from_period_id: span.from,
      to_period_id: span.to,
      buy_sell: side,
      transaction_serial_no: bid.ocf_leg ? String(bid.ocf_leg) : '1',
      initiated_by: 'SJVA1',
      order_entered_by: participant,
      last_updated_time: lastUpdated,
      total_executed_qty: String(Math.round(clearedMw)),
      ocf_opted: ocfOpted,
      premium_discount_price: premium,
      max_ocf_quantity: '0',
      ocf_source_bid_category: ocfCategory,
      ocf_source_order_id: ocfSourceOrder,
      error: status === 'Rejected' ? (bid.no_bid_reason || '') : '',
      order_status: status,
      action,
      created_at: bid.created_at,
    };

    if (reportType.endsWith('_BLOCK')) {
      rows.push({
        ...base,
        link_order_id: '0',
        order_type: 'Block Bid',
        price: rsPerMwh(bid.price_per_unit),
        quantity: signedQuantity(bid.quantum_mw, side),
        min_quantity: '0',
        no_sub_bids: '0',
        avg_trade_price: tradePrice,
        bid_ref: bid.id.replace(/^BID-/, '').slice(0, 12),
        linked_bid_ref: bid.carry_forward_from ? bid.carry_forward_from.replace(/^BID-/, '').slice(0, 12) : '',
        link_type: bid.carry_forward_from ? 'OCF' : '',
        session: bid.product === 'RTM' ? rtmSession(span.from) : '',
      });
    } else {
      rows.push({
        ...base,
        extreme_price_range: 'No',
        price_cutoff_missing: 'No',
        trade_price: tradePrice,
        session: bid.product === 'RTM' ? rtmSession(span.from) : '',
        bid_ref: bid.id.replace(/^BID-/, '').slice(0, 12),
      });
    }
  }

  return rows.map((r, i) => ({ ...r, sl_no: i + 1 }));
}
