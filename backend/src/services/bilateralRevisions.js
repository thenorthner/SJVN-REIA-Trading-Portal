/**
 * What a bilateral deal becomes partway through its supply period: a rate
 * revised from a date, and power split between several buyers.
 *
 * A transaction carried one sale rate, one purchase rate, one margin and one
 * buyer for its whole life, and settlement priced every block at them. A deal
 * whose rate was amended from the 16th was billed wholly at the old rate or
 * wholly at the new one; a seller's power shared 60/40 between two DISCOMs
 * could only be billed to one of them. (August 2026 scope, left out on purpose;
 * PT #19.)
 *
 * Quantum revisions need nothing here: NOAR's revised approvals already land
 * block by block in the schedule's approved MW, and settlement reads the blocks.
 *
 * RATES. A revision states all three rates from a date. The contract's own
 * rates apply until the first revision; each revision applies until the next.
 *
 * SPLITS. A split is a set of buyers and shares that applies from a date and
 * sums to 100%; a later set replaces it from its own date. A day is divided by
 * the set in force on it. A transaction with no set bills its one buyer, as
 * before. Each buyer in a split is taken to hold its own open-access approval,
 * so the per-day open-access charges apply to each buyer's bill.
 *
 * Neither may reach back into a period already billed FINAL: that bill states
 * what was settled, and changing the rules under it would leave the register
 * disagreeing with the settlement. A provisional bill does not block a change —
 * the final bill restates it.
 */
import db from '../db/index.js';
import { newId } from '../util.js';

export class RevisionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v) => typeof v === 'string' && DATE_RE.test(v)
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const num = (v) => (v === '' || v == null ? null : Number(v));
const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

function transactionOrThrow(transactionId) {
  const tx = db.prepare('SELECT * FROM bilateral_transactions WHERE id = ?').get(transactionId);
  if (!tx) throw new RevisionError(404, 'Bilateral transaction not found');
  return tx;
}

/**
 * The FINAL bill a change from `fromDate` would reach back into, if any. Only
 * the bills a revision or a split changes are checked: energy and open access.
 */
function finalBillCovering(transactionId, fromDate) {
  return db.prepare(`
    SELECT invoice_no, supply_from_date, supply_to_date, bill_type FROM view_bill_invoices
    WHERE bilateral_id = ? AND status = 'ACTIVE' AND settlement_basis = 'FINAL'
      AND bill_type IN ('BILATERAL_ENERGY', 'BILATERAL_OA')
      AND IFNULL(supply_to_date, '9999-12-31') >= ?
    ORDER BY supply_to_date LIMIT 1
  `).get(transactionId, fromDate);
}

function refuseIfBilledFinal(transactionId, fromDate, what) {
  const bill = finalBillCovering(transactionId, fromDate);
  if (bill) {
    throw new RevisionError(409, `${what} from ${fromDate} reaches into ${bill.invoice_no}, billed FINAL for `
      + `${bill.supply_from_date} to ${bill.supply_to_date}. Cancel that bill first, or date the change after it.`);
  }
}

function inTerm(tx, date) {
  if (date < tx.start_date || date > tx.end_date) {
    throw new RevisionError(400, `effective_from ${date} is outside the transaction's term, ${tx.start_date} to ${tx.end_date}.`);
  }
}

/* ─────────── Rate revisions ─────────── */

export function rateRevisions(transactionId) {
  return db.prepare(`
    SELECT * FROM bilateral_rate_revisions WHERE transaction_id = ? ORDER BY effective_from
  `).all(transactionId);
}

/**
 * The rate triangle a transaction was at over a period, as consecutive
 * segments. The first segment is the contract's own rates unless a revision
 * starts on or before the period's first day.
 */
export function rateSegments(tx, from, to) {
  const start = from || tx.start_date;
  const end = to || tx.end_date;
  const contract = {
    source: 'CONTRACT',
    revision_id: null,
    reason: null,
    sale_rate_per_unit: Number(tx.sale_rate_per_unit ?? tx.tariff_per_unit) || 0,
    trading_margin_per_unit: Number(tx.trading_margin_per_unit) || 0,
    purchase_rate_per_unit: tx.purchase_rate_per_unit != null
      ? Number(tx.purchase_rate_per_unit)
      : Number(((Number(tx.sale_rate_per_unit ?? tx.tariff_per_unit) || 0) - (Number(tx.trading_margin_per_unit) || 0)).toFixed(4)),
  };
  const revisions = rateRevisions(tx.id).map((r) => ({
    source: 'REVISION',
    revision_id: r.id,
    reason: r.reason,
    effective_from: r.effective_from,
    sale_rate_per_unit: r.sale_rate_per_unit,
    purchase_rate_per_unit: r.purchase_rate_per_unit,
    trading_margin_per_unit: r.trading_margin_per_unit,
  }));

  // What applies on the period's first day: the latest revision on or before it.
  let current = contract;
  for (const r of revisions) if (r.effective_from <= start) current = r;
  const segments = [];
  let segFrom = start;
  for (const r of revisions) {
    if (r.effective_from <= start || r.effective_from > end) continue;
    segments.push({ ...current, from: segFrom, to: dayBefore(r.effective_from) });
    current = r;
    segFrom = r.effective_from;
  }
  segments.push({ ...current, from: segFrom, to: end });
  return segments.map(({ effective_from: _drop, ...s }) => s);
}

export function addRateRevision(transactionId, body = {}, actor = null) {
  const tx = transactionOrThrow(transactionId);
  const effectiveFrom = String(body.effective_from || '');
  if (!isDate(effectiveFrom)) throw new RevisionError(400, 'effective_from must be a valid YYYY-MM-DD date.');
  inTerm(tx, effectiveFrom);
  if (effectiveFrom === tx.start_date) {
    throw new RevisionError(400, 'A revision from the first day of the term is not a revision — change the contract\'s rates instead.');
  }
  const reason = String(body.reason || '').trim();
  if (!reason) throw new RevisionError(400, 'Say why the rate changed (the amendment, letter or order behind it).');

  // Any two of the three rates give the third, as on the transaction itself.
  let sale = num(body.sale_rate_per_unit);
  let purchase = num(body.purchase_rate_per_unit);
  let margin = num(body.trading_margin_per_unit);
  if (margin == null && sale != null && purchase != null) margin = Number((sale - purchase).toFixed(4));
  if (margin == null) margin = Number(tx.trading_margin_per_unit) || 0;
  if (purchase == null && sale != null) purchase = Number((sale - margin).toFixed(4));
  if (sale == null && purchase != null) sale = Number((purchase + margin).toFixed(4));
  for (const [name, v] of [['sale_rate_per_unit', sale], ['purchase_rate_per_unit', purchase], ['trading_margin_per_unit', margin]]) {
    if (v == null || !Number.isFinite(v) || v < 0) throw new RevisionError(400, `${name} must be a non-negative number.`);
  }
  if (Math.abs(sale - purchase - margin) > 0.001) {
    throw new RevisionError(400, `sale_rate (${sale}) - purchase_rate (${purchase}) must equal trading_margin (${margin}).`);
  }
  if (db.prepare('SELECT 1 FROM bilateral_rate_revisions WHERE transaction_id = ? AND effective_from = ?').get(tx.id, effectiveFrom)) {
    throw new RevisionError(409, `A revision from ${effectiveFrom} is already recorded; remove it first to restate it.`);
  }
  refuseIfBilledFinal(tx.id, effectiveFrom, 'A rate revision');

  const id = newId('BRR');
  db.prepare(`
    INSERT INTO bilateral_rate_revisions (id, transaction_id, effective_from, sale_rate_per_unit, purchase_rate_per_unit,
      trading_margin_per_unit, reason, reference, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tx.id, effectiveFrom, sale, purchase, margin, reason, body.reference ? String(body.reference).trim() : null, actor);
  return db.prepare('SELECT * FROM bilateral_rate_revisions WHERE id = ?').get(id);
}

export function removeRateRevision(transactionId, revisionId) {
  const row = db.prepare('SELECT * FROM bilateral_rate_revisions WHERE id = ? AND transaction_id = ?').get(revisionId, transactionId);
  if (!row) throw new RevisionError(404, 'Rate revision not found');
  refuseIfBilledFinal(transactionId, row.effective_from, 'Removing the rate revision');
  db.prepare('DELETE FROM bilateral_rate_revisions WHERE id = ?').run(row.id);
  return row;
}

/* ─────────── Buyer splits ─────────── */

/** Each split set, oldest first, with the buyers in it. */
export function splitSets(transactionId) {
  const rows = db.prepare(`
    SELECT * FROM bilateral_buyer_splits WHERE transaction_id = ? ORDER BY effective_from, share_percent DESC, buyer_name
  `).all(transactionId);
  const sets = new Map();
  for (const r of rows) {
    if (!sets.has(r.effective_from)) sets.set(r.effective_from, { effective_from: r.effective_from, buyers: [] });
    sets.get(r.effective_from).buyers.push({
      buyer_name: r.buyer_name, client_id: r.client_id, drawal_state: r.drawal_state, share_percent: r.share_percent,
    });
  }
  return [...sets.values()];
}

/** The buyers and their shares on a date, or null where no split applies. */
export function sharesOn(sets, date) {
  let current = null;
  for (const s of sets) if (s.effective_from <= date) current = s;
  return current ? current.buyers : null;
}

/** Every buyer that holds a share on any day of a period. */
export function buyersInPeriod(sets, from, to) {
  if (!sets.length) return [];
  const names = new Map();
  for (let i = 0; i < sets.length; i += 1) {
    const setFrom = sets[i].effective_from;
    const setTo = sets[i + 1] ? dayBefore(sets[i + 1].effective_from) : '9999-12-31';
    if (setTo < (from || '0000-01-01') || setFrom > (to || '9999-12-31')) continue;
    for (const b of sets[i].buyers) if (!names.has(b.buyer_name)) names.set(b.buyer_name, b);
  }
  return [...names.values()];
}

export function setBuyerSplit(transactionId, body = {}, actor = null) {
  const tx = transactionOrThrow(transactionId);
  const effectiveFrom = String(body.effective_from || tx.start_date);
  if (!isDate(effectiveFrom)) throw new RevisionError(400, 'effective_from must be a valid YYYY-MM-DD date.');
  inTerm(tx, effectiveFrom);

  const buyers = Array.isArray(body.buyers) ? body.buyers : [];
  if (buyers.length < 2) {
    throw new RevisionError(400, 'A split needs at least two buyers; a transaction with one buyer is billed to it without one.');
  }
  const seen = new Set();
  let total = 0;
  const clean = buyers.map((b, i) => {
    const name = String(b?.buyer_name || '').trim();
    if (!name) throw new RevisionError(400, `Buyer ${i + 1} has no name.`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new RevisionError(400, `${name} appears twice in the split.`);
    seen.add(key);
    const share = Number(b.share_percent);
    if (!Number.isFinite(share) || share <= 0 || share > 100) {
      throw new RevisionError(400, `${name}'s share must be more than 0 and at most 100 percent.`);
    }
    if (b.client_id && !db.prepare('SELECT 1 FROM trading_clients WHERE id = ?').get(b.client_id)) {
      throw new RevisionError(400, `client_id ${b.client_id} does not exist.`);
    }
    total += share;
    return { buyer_name: name, client_id: b.client_id || null, drawal_state: b.drawal_state ? String(b.drawal_state).trim() : null, share_percent: share };
  });
  if (Math.abs(total - 100) > 0.01) {
    throw new RevisionError(400, `The shares add up to ${Number(total.toFixed(4))}%, not 100% — every unit delivered has to be billed to someone.`);
  }
  refuseIfBilledFinal(tx.id, effectiveFrom, 'A buyer split');

  db.transaction(() => {
    db.prepare('DELETE FROM bilateral_buyer_splits WHERE transaction_id = ? AND effective_from = ?').run(tx.id, effectiveFrom);
    const insert = db.prepare(`
      INSERT INTO bilateral_buyer_splits (id, transaction_id, effective_from, buyer_name, client_id, drawal_state, share_percent, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of clean) insert.run(newId('BBS'), tx.id, effectiveFrom, b.buyer_name, b.client_id, b.drawal_state, b.share_percent, actor);
  })();
  return splitSets(tx.id).find((s) => s.effective_from === effectiveFrom);
}

export function removeBuyerSplit(transactionId, effectiveFrom) {
  transactionOrThrow(transactionId);
  const n = db.prepare('SELECT COUNT(*) AS n FROM bilateral_buyer_splits WHERE transaction_id = ? AND effective_from = ?').get(transactionId, effectiveFrom).n;
  if (!n) throw new RevisionError(404, `No buyer split starts on ${effectiveFrom}.`);
  refuseIfBilledFinal(transactionId, effectiveFrom, 'Removing the buyer split');
  db.prepare('DELETE FROM bilateral_buyer_splits WHERE transaction_id = ? AND effective_from = ?').run(transactionId, effectiveFrom);
  return { removed: n, effective_from: effectiveFrom };
}
