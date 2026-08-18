import db from '../db/index.js';
import { checkAdequacy } from '../paymentSecurityEngine.js';
import { checkBidCompliance } from './standingClearance.js';
import { insertBid, logBidEvent, rollUp, utilizedExposure, blockHours } from './bidWrite.js';

const BID_PRODUCTS = ['DAM', 'HPDAM', 'TAM', 'GDAM', 'RTM', 'GTAM', 'REC', 'ESCERT', 'RPO'];
const TERM_AHEAD = new Set(['Daily', 'Weekly', 'Monthly']);

/** ISET product labels that are not themselves DAM-desk products. */
export function mapIsetProduct(productType) {
  const raw = String(productType || '').trim();
  if (BID_PRODUCTS.includes(raw)) return raw;
  if (TERM_AHEAD.has(raw)) return 'TAM';
  return null;
}

/**
 * Bid `price_per_unit` is Rs/kWh. The classic ISET schedule is labelled
 * INR/MWh; Bidding Latest's rate field is unlabelled and historically mixed.
 * Values at or above 50 are treated as Rs/MWh (IEX DAM quotes ~2000–15000).
 */
export function rsPerKwh(price, unit = 'auto') {
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  if (unit === 'mwh') return n / 1000;
  if (unit === 'kwh') return n;
  return n >= 50 ? n / 1000 : n;
}

export function parseMinutes(hhmm) {
  const s = String(hhmm || '').trim();
  if (s === '24:00' || s === '24:00:00') return 24 * 60;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 24 * 60;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Duration of a `HH:MM-HH:MM` (or `HH:MM-24:00`) label, in hours.
 * TAM/GTAM often file a single 00:00-24:00 block; DAM is 15 minutes.
 */
export function hoursFromTimeBlock(label, product) {
  const raw = String(label || '');
  const dash = raw.indexOf('-');
  if (dash > 0) {
    const start = parseMinutes(raw.slice(0, dash));
    let end = parseMinutes(raw.slice(dash + 1));
    if (start != null && end != null) {
      if (end === 0 && start > 0) end = 24 * 60;
      if (end === start) end += 15;
      if (end < start) end += 24 * 60;
      const h = (end - start) / 60;
      if (h > 0 && h <= 24) return h;
    }
  }
  return blockHours(product);
}

function labelAt(minutes) {
  const wrapped = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const m = String(wrapped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

/** 15-minute `HH:MM-HH:MM` labels covering [from, to). */
export function expandQuarterHours(timeFrom, timeTo) {
  let start = parseMinutes(timeFrom);
  let end = parseMinutes(timeTo);
  if (start == null || end == null) return [];
  if (end === start) end = start + 15;
  if (end < start) return [];
  const out = [];
  for (let t = start; t < end; t += 15) {
    out.push(`${labelAt(t)}-${labelAt(t + 15)}`);
  }
  return out;
}

export function datesInclusive(from, to) {
  const start = String(from || '').slice(0, 10);
  const end = String(to || start).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  if (end < start) return [];
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    const [y, m, d] = cur.split('-').map(Number);
    cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  return out;
}

function addBlock(byDate, date, timeBlock, quantumMw, pricePerKwh) {
  if (!byDate.has(date)) byDate.set(date, new Map());
  const day = byDate.get(date);
  day.set(timeBlock, { time_block: timeBlock, quantum_mw: quantumMw, price_per_unit: pricePerKwh });
}

/**
 * Classic ISET schedule rows (date_from/to, time_from/to, price INR/MWh, capacity MW).
 */
export function planFromSchedule(schedule, { priceUnit = 'mwh' } = {}) {
  const byDate = new Map();
  const errors = [];
  for (const [i, row] of (schedule || []).entries()) {
    const dates = datesInclusive(row.date_from, row.date_to || row.date_from);
    if (!dates.length) errors.push(`schedule row ${i + 1}: invalid date range`);
    const labels = expandQuarterHours(row.time_from, row.time_to);
    if (!labels.length) errors.push(`schedule row ${i + 1}: hours from/to must span at least one 15-min block`);
    const price = rsPerKwh(row.price, priceUnit);
    if (price == null) errors.push(`schedule row ${i + 1}: price is not a number`);
    const mw = Number(row.capacity);
    if (!Number.isFinite(mw) || mw <= 0) errors.push(`schedule row ${i + 1}: capacity must be a positive MW`);
    if (!dates.length || !labels.length || price == null || !Number.isFinite(mw) || mw <= 0) continue;
    for (const date of dates) {
      for (const label of labels) addBlock(byDate, date, label, mw, price);
    }
  }
  return { byDate, errors };
}

/**
 * Bidding Latest details: from/to period + PQ rows.
 * Quantity is treated as MW (same as Capacity MW on the classic form), even
 * though the ISET label says MWh — that is how the desk actually fills it.
 */
export function planFromLatestDetails(details, deliveryDate, { priceUnit = 'auto' } = {}) {
  const byDate = new Map();
  const errors = [];
  const date = String(deliveryDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { byDate, errors: ['delivery_date is required'] };
  }
  for (const [i, d] of (details || []).entries()) {
    const labels = expandQuarterHours(d.from_period_id, d.to_period_id);
    if (!labels.length) errors.push(`bid detail ${i + 1}: from/to period must span at least one 15-min block`);
    const pq = Array.isArray(d.pq_data) ? d.pq_data : [];
    if (!pq.length) {
      errors.push(`bid detail ${i + 1}: add at least one PQData row`);
      continue;
    }
    const working = pq.reduce((best, p) => {
      const q = Number(p.quantity);
      if (!Number.isFinite(q)) return best;
      if (!best || q > Number(best.quantity)) return p;
      return best;
    }, null);
    const price = working ? rsPerKwh(working.rate, priceUnit) : null;
    const mw = working ? Number(working.quantity) : NaN;
    if (price == null) errors.push(`bid detail ${i + 1}: rate/price is not a number`);
    if (!Number.isFinite(mw) || mw <= 0) errors.push(`bid detail ${i + 1}: quantity must be a positive MW`);
    if (!labels.length || price == null || !Number.isFinite(mw) || mw <= 0) continue;
    for (const label of labels) addBlock(byDate, date, label, mw, price);
  }
  return { byDate, errors };
}

function placementError({ client, header, blocks, securityOverride }) {
  if (!client) return 'client_id does not exist';
  if (client.status === 'SUSPENDED') return 'Client is suspended. Bidding not allowed.';
  if (header.contract_id) {
    const contract = db.prepare('SELECT * FROM exchange_contracts WHERE id = ?').get(header.contract_id);
    if (!contract) return `Exchange contract '${header.contract_id}' does not exist`;
    if (contract.client_id && contract.client_id !== header.client_id) {
      return 'contract_id belongs to a different client';
    }
    if (header.delivery_date && (header.delivery_date < contract.start_date || header.delivery_date > contract.end_date)) {
      return `delivery_date ${header.delivery_date} falls outside the contract window ${contract.start_date} to ${contract.end_date}`;
    }
  }
  if (client.entity_id) {
    const adequacy = checkAdequacy({ buyerEntityId: client.entity_id });
    if (!adequacy.adequate) {
      const override = String(securityOverride || '').trim();
      if (!override) {
        const weak = (adequacy.weak || [])[0] || {};
        return `${client.name} does not hold adequate payment security — cover is ${weak.coverage_ratio ?? '?'}× its exposure. Replenish the security, or pass security_override_reason to take this exposure on anyway.`;
      }
    }
  }
  const totalExposure = rollUp(blocks, header.product).exposure;
  const currentUtilized = utilizedExposure(client.id);
  if ((currentUtilized + totalExposure) > client.exposure_limit) {
    return 'Exposure limit breached.';
  }
  const compliance = checkBidCompliance({
    client, product: header.product, exchange: header.exchange, deliveryDate: header.delivery_date,
    blocks, bidOn: header.bid_on,
  });
  if (compliance.violations.length) {
    return `Standing clearance compliance check failed: ${compliance.violations.map((v) => v.message || v.code).join('; ')}`;
  }
  return null;
}

/**
 * Write one DAM-desk bid per delivery date from an ISET plan.
 * Caller must already have validated the ISET form; this throws on placement errors.
 */
export function materialiseIsetBids({
  clientId, exchange, product, contractId, actorId, sourceKind, sourceId,
  byDate, bidDate, premiumDiscount = 0, securityOverride = null,
}) {
  const client = db.prepare('SELECT * FROM trading_clients WHERE id = ?').get(clientId);
  const days = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  if (!days.length) throw new Error('No 15-minute blocks could be derived from the bid');

  for (const [date, blockMap] of days) {
    const blocks = [...blockMap.values()].sort((a, b) => a.time_block.localeCompare(b.time_block));
    const header = {
      client_id: clientId,
      exchange,
      product,
      bid_date: bidDate || date,
      delivery_date: date,
      contract_id: contractId || null,
      premium_discount: premiumDiscount,
      source_kind: sourceKind,
      source_id: sourceId,
    };
    const err = placementError({ client, header, blocks, securityOverride });
    if (err) throw new Error(err);
  }

  const bidIds = [];
  for (const [date, blockMap] of days) {
    const blocks = [...blockMap.values()].sort((a, b) => a.time_block.localeCompare(b.time_block));
    const { bidId } = insertBid({
      client_id: clientId,
      exchange,
      product,
      bid_date: bidDate || date,
      delivery_date: date,
      contract_id: contractId || null,
      premium_discount: premiumDiscount,
      source_kind: sourceKind,
      source_id: sourceId,
    }, blocks, actorId);
    logBidEvent(bidId, actorId, 'CREATED', { source: sourceKind, source_id: sourceId, blocks: blocks.length });
    bidIds.push(bidId);
  }
  return bidIds;
}

export function parseBidIds(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

export { BID_PRODUCTS };
