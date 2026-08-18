import db from '../db/index.js';
import { hoursFromTimeBlock, parseMinutes } from './exchangeIsetToBids.js';
import { blockHours } from './bidWrite.js';

// 96-block energy schedule and daily obligation rows off live bid_blocks.
// The DAM/GDAM engine tabs previously rendered a Math.random() meter curve
// and fake IEX PDFs. There is no WBES/JMR feed, so this is the schedule the
// exchange actually cleared — bid MW vs cleared MW, priced at MCP.

const PRODUCTS = ['DAM', 'HPDAM', 'TAM', 'GDAM', 'RTM', 'GTAM', 'REC', 'ESCERT', 'RPO'];
const EXCHANGES = ['IEX', 'PXIL', 'HPX'];

const FILED = ['SUBMITTED', 'CLEARED', 'PARTIALLY_CLEARED'];
const SETTLED = ['CLEARED', 'PARTIALLY_CLEARED'];
const SLOTS = 96;
const KWH_PER_MWH = 1000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function isProduct(p) {
  return PRODUCTS.includes(String(p || '').toUpperCase());
}

export function isExchange(e) {
  return EXCHANGES.includes(String(e || '').toUpperCase());
}

/** 15-minute `HH:MM-HH:MM` covering a day. Last slot is 23:45-00:00. */
export function quarterLabels() {
  const out = [];
  for (let i = 0; i < SLOTS; i++) {
    const start = i * 15;
    const end = start + 15;
    const fmt = (m) => {
      const wrapped = m === 24 * 60 ? 0 : m;
      const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
      const min = String(wrapped % 60).padStart(2, '0');
      return `${h}:${min}`;
    };
    out.push(`${fmt(start)}-${fmt(end)}`);
  }
  return out;
}

const LABELS = quarterLabels();

/** Slot 0..95 from a `HH:MM-HH:MM` (or `HH:MM - HH:MM`) label, else null. */
export function slotFromLabel(label) {
  const start = parseMinutes(String(label || '').split('-')[0]);
  if (start == null || start < 0 || start >= 24 * 60 || start % 15 !== 0) return null;
  return start / 15;
}

function emptySlot(i) {
  return {
    block_no: i + 1,
    time_label: LABELS[i],
    bid_mw: 0,
    cleared_mw: 0,
    scheduled_mwh: 0,
    cleared_price: null,
    trade_value: 0,
    status: 'EMPTY',
  };
}

function bidFilter({ product, date, clientId, exchange, statuses }) {
  const where = ["b.is_no_bid = 0", `b.status IN (${statuses.map(() => '?').join(',')})`];
  const params = [...statuses];
  if (product) { where.push('b.product = ?'); params.push(product); }
  if (date) { where.push('b.delivery_date = ?'); params.push(date); }
  if (clientId) { where.push('b.client_id = ?'); params.push(clientId); }
  if (exchange) { where.push('b.exchange = ?'); params.push(exchange); }
  return { where: where.join(' AND '), params };
}

function loadBlocks({ product, date, clientId, exchange, statuses }) {
  const { where, params } = bidFilter({ product, date, clientId, exchange, statuses });
  return db.prepare(`
    SELECT
      b.id AS bid_id, b.client_id, b.exchange, b.product, b.delivery_date, b.status AS bid_status,
      b.contract_id, tc.name AS client_name,
      blk.time_block, blk.quantum_mw, blk.cleared_quantum_mw, blk.cleared_price,
      blk.price_per_unit, blk.status AS block_status
    FROM bids b
    JOIN bid_blocks blk ON blk.bid_id = b.id
    JOIN trading_clients tc ON tc.id = b.client_id
    WHERE ${where}
    ORDER BY b.delivery_date, blk.time_block
  `).all(...params);
}

function rollSlot(hours, acc, row) {
  const bidMw = num(row.quantum_mw);
  const clearedMw = num(row.cleared_quantum_mw);
  const price = row.cleared_price != null ? num(row.cleared_price) : num(row.price_per_unit);
  acc.bid_mw += bidMw;
  acc.cleared_mw += clearedMw;
  if (clearedMw > 0) {
    acc._pxMw += clearedMw;
    acc._pxVal += clearedMw * price;
    acc.trade_value += clearedMw * hours * KWH_PER_MWH * price;
  }
  if (acc.status === 'EMPTY' || acc.status === 'PENDING') {
    acc.status = row.block_status || row.bid_status;
  } else if (acc.status !== row.block_status && row.block_status) {
    acc.status = 'MIXED';
  }
}

function finaliseSlot(hours, acc) {
  acc.bid_mw = Number(acc.bid_mw.toFixed(4));
  acc.cleared_mw = Number(acc.cleared_mw.toFixed(4));
  acc.scheduled_mwh = Number((acc.cleared_mw * hours).toFixed(4));
  acc.cleared_price = acc._pxMw > 0 ? Number((acc._pxVal / acc._pxMw).toFixed(4)) : null;
  acc.trade_value = Math.round(acc.trade_value * 100) / 100;
  delete acc._pxMw;
  delete acc._pxVal;
  return acc;
}

/**
 * 96-block schedule for one delivery date / product, summed across matching bids.
 */
export function buildEnergySchedule({
  date, product, client_id = null, exchange = null,
} = {}) {
  const prod = String(product || 'DAM').toUpperCase();
  if (!isProduct(prod)) throw new Error(`product must be one of: ${PRODUCTS.join(', ')}`);
  const day = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('date (YYYY-MM-DD) is required');
  if (exchange && !isExchange(exchange)) throw new Error(`exchange must be one of: ${EXCHANGES.join(', ')}`);

  const hours = blockHours(prod);
  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const s = emptySlot(i);
    s._pxMw = 0;
    s._pxVal = 0;
    return s;
  });

  const rows = loadBlocks({
    product: prod, date: day, clientId: client_id || null,
    exchange: exchange || null, statuses: FILED,
  });
  const bids = new Map();
  for (const row of rows) {
    bids.set(row.bid_id, {
      id: row.bid_id, client_id: row.client_id, client_name: row.client_name,
      exchange: row.exchange, status: row.bid_status, contract_id: row.contract_id,
    });
    const i = slotFromLabel(row.time_block);
    if (i == null) continue;
    rollSlot(hours, slots[i], row);
  }

  const blocks = slots.map((s) => finaliseSlot(hours, s));
  const bid_mwh = Number(blocks.reduce((a, b) => a + b.bid_mw * hours, 0).toFixed(4));
  const cleared_mwh = Number(blocks.reduce((a, b) => a + b.scheduled_mwh, 0).toFixed(4));
  const cleared_value = Math.round(blocks.reduce((a, b) => a + b.trade_value, 0) * 100) / 100;

  return {
    date: day,
    product: prod,
    client_id: client_id || null,
    exchange: exchange || null,
    source: 'bids',
    bids: [...bids.values()],
    summary: {
      bids: bids.size,
      bid_mwh,
      cleared_mwh,
      cleared_value,
    },
    blocks,
  };
}

/**
 * One obligation row per delivery date × client × exchange, from settled blocks.
 */
export function listObligations({
  product, from = null, to = null, client_id = null, exchange = null,
} = {}) {
  const prod = String(product || 'DAM').toUpperCase();
  if (!isProduct(prod)) throw new Error(`product must be one of: ${PRODUCTS.join(', ')}`);
  if (exchange && !isExchange(exchange)) throw new Error(`exchange must be one of: ${EXCHANGES.join(', ')}`);

  const where = ["b.is_no_bid = 0", `b.status IN (${SETTLED.map(() => '?').join(',')})`, 'b.product = ?'];
  const params = [...SETTLED, prod];
  if (from) { where.push('b.delivery_date >= ?'); params.push(from); }
  if (to) { where.push('b.delivery_date <= ?'); params.push(to); }
  if (client_id) { where.push('b.client_id = ?'); params.push(client_id); }
  if (exchange) { where.push('b.exchange = ?'); params.push(exchange); }

  const rows = db.prepare(`
    SELECT
      b.id AS bid_id, b.client_id, tc.name AS client_name, b.exchange, b.delivery_date,
      b.status AS bid_status, b.contract_id,
      blk.time_block, blk.quantum_mw, blk.cleared_quantum_mw, blk.cleared_price, blk.price_per_unit
    FROM bids b
    JOIN bid_blocks blk ON blk.bid_id = b.id
    JOIN trading_clients tc ON tc.id = b.client_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.delivery_date DESC, tc.name
  `).all(...params);

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.delivery_date}|${row.client_id}|${row.exchange}`;
    if (!groups.has(key)) {
      groups.set(key, {
        delivery_date: row.delivery_date,
        client_id: row.client_id,
        client_name: row.client_name,
        exchange: row.exchange,
        product: prod,
        contract_id: row.contract_id,
        bid_ids: new Set(),
        bid_mw: 0,
        cleared_mw: 0,
        cleared_mwh: 0,
        trade_value: 0,
        _pxMw: 0,
        _pxVal: 0,
        statuses: new Set(),
      });
    }
    const g = groups.get(key);
    g.bid_ids.add(row.bid_id);
    g.statuses.add(row.bid_status);
    const hoursBlk = hoursFromTimeBlock(row.time_block, prod);
    const bidMw = num(row.quantum_mw);
    const clearedMw = num(row.cleared_quantum_mw);
    const price = row.cleared_price != null ? num(row.cleared_price) : num(row.price_per_unit);
    g.bid_mw += bidMw;
    g.cleared_mw += clearedMw;
    g.cleared_mwh += clearedMw * hoursBlk;
    if (clearedMw > 0) {
      g._pxMw += clearedMw;
      g._pxVal += clearedMw * price;
      g.trade_value += clearedMw * hoursBlk * KWH_PER_MWH * price;
    }
  }

  const list = [...groups.values()].map((g) => {
    const statuses = [...g.statuses];
    return {
      delivery_date: g.delivery_date,
      client_id: g.client_id,
      client_name: g.client_name,
      exchange: g.exchange,
      product: g.product,
      contract_id: g.contract_id,
      bid_ids: [...g.bid_ids],
      bid_mw: Number(g.bid_mw.toFixed(4)),
      cleared_mw: Number(g.cleared_mw.toFixed(4)),
      cleared_mwh: Number(g.cleared_mwh.toFixed(4)),
      avg_price: g._pxMw > 0 ? Number((g._pxVal / g._pxMw).toFixed(4)) : null,
      trade_value: Math.round(g.trade_value * 100) / 100,
      status: statuses.length === 1 ? statuses[0] : 'MIXED',
    };
  });

  return {
    product: prod,
    from: from || null,
    to: to || null,
    source: 'bids',
    rows: list,
  };
}
