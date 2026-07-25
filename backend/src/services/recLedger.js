/**
 * Renewable Energy Certificates — CERC (Terms and Conditions for Renewable
 * Energy Certificates) Regulations, 2022.
 *
 * Three provisions drive the model here:
 *  - One certificate represents one MWh injected, issued in multiples of the
 *    Certificate Multiplier assigned to the technology (cl. 12). Hydro carries
 *    1.5, so an SJVN hydro station earns half again as many certificates per
 *    MWh as a solar one.
 *  - Certificates are valid until redeemed — the 1095-day expiry is gone. The
 *    commercial risk is therefore holding cost and price drift, not lapse, so
 *    the module ages the unsold position instead of counting down to an expiry.
 *  - Floor and forbearance prices were withdrawn in December 2022; the price is
 *    whatever the exchange discovers. Nothing validates a sale price against a
 *    band, but each tranche keeps the price it actually cleared at.
 *
 * A lot is almost never cleared in a single session, so disposals live in
 * `rec_transactions` and the lot carries only the resulting position.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { getParam, getParamNumber } from '../mastersService.js';

const DEFAULT_MULTIPLIERS = {
  Solar: 1, Wind: 1, Hybrid: 1, Hydro: 1.5, PSP: 1.5,
  MSW: 2, Cogeneration: 2, Biomass: 2.5, Biofuel: 2.5,
};

const round = (v, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((Number(v) || 0) * f) / f;
};

/** Certificate Multiplier for a technology, falling back to the 1:1 default. */
export function multiplierFor(technology) {
  const map = getParam('rec_certificate_multipliers', null) || DEFAULT_MULTIPLIERS;
  if (!technology) return 1;
  const key = Object.keys(map).find((k) => k.toLowerCase() === String(technology).toLowerCase());
  return key ? Number(map[key]) || 1 : 1;
}

export function multiplierTable() {
  return getParam('rec_certificate_multipliers', null) || DEFAULT_MULTIPLIERS;
}

/**
 * Certificates earned by a quantum of injected energy.
 * Certificates are whole units; the regulations allow the fractional remainder
 * to be carried forward, so this floors rather than rounds.
 */
export function certificatesFor(energyMwh, technology) {
  const mwh = Number(energyMwh) || 0;
  if (mwh <= 0) return 0;
  return Math.floor(mwh * multiplierFor(technology));
}

export function issuanceFeePerRec() {
  return getParamNumber('rec_issuance_fee_per_rec', 4);
}

/**
 * REC trading sessions run on the 2nd and the last Wednesday of each month
 * (CERC order dated 8 October 2023, raising the frequency from monthly).
 */
export function tradingSessions(fromDate, count = 4) {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const sessions = [];

  for (let offset = 0; sessions.length < count && offset < 12; offset++) {
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth() + offset;
    const first = new Date(Date.UTC(y, m, 1));
    const last = new Date(Date.UTC(y, m + 1, 0));

    // 3 = Wednesday. Walk to the first one, then the second falls a week later.
    const firstWed = 1 + ((3 - first.getUTCDay() + 7) % 7);
    const secondWed = new Date(Date.UTC(y, m, firstWed + 7));
    const lastWed = new Date(Date.UTC(y, m, last.getUTCDate() - ((last.getUTCDay() - 3 + 7) % 7)));

    for (const d of [secondWed, lastWed]) {
      if (d >= start && sessions.length < count) sessions.push(d.toISOString().slice(0, 10));
    }
  }
  return sessions;
}

/**
 * Lot enriched with its position and realised economics.
 *
 * Issuance cost is charged against the certificates actually disposed of, so
 * `profit` is realised profit; the cost sitting in unsold inventory is reported
 * separately as `held_cost` rather than dragging realised profit negative.
 */
export function withPosition(lot) {
  if (!lot) return lot;

  // Until the Central Agency issues, `quantity` is only what was applied for —
  // nothing is actually held, so it must not land in the inventory position.
  const isIssued = !!lot.issuance_date && lot.status !== 'APPLIED';
  const applied = Number(lot.quantity) || 0;
  const issued = isIssued ? applied : 0;
  const sold = Number(lot.sold_qty) || 0;
  const redeemed = Number(lot.redeemed_qty) || 0;
  const held = Math.max(0, issued - sold - redeemed);
  const costPerRec = Number(lot.issue_cost_per_rec) || 0;

  const sales = db.prepare(`
    SELECT COALESCE(SUM(amount),0) revenue, COALESCE(SUM(quantity),0) qty
    FROM rec_transactions WHERE lot_id = ? AND txn_type = 'SALE'
  `).get(lot.id);

  const revenue = Number(sales.revenue) || 0;
  const soldQty = Number(sales.qty) || 0;

  let position = 'NOT_ISSUED';
  if (lot.status === 'CANCELLED') position = 'CANCELLED';
  else if (!isIssued) position = 'NOT_ISSUED';
  else if (held === 0) position = 'FULLY_DISPOSED';
  else if (sold > 0 || redeemed > 0) position = 'PARTIALLY_SOLD';
  else position = 'HELD';

  // Perpetual validity means the exposure is how long stock has sat unsold.
  let ageDays = null;
  if (held > 0 && lot.issuance_date) {
    ageDays = Math.floor((Date.now() - new Date(`${lot.issuance_date}T00:00:00Z`)) / 86400000);
  }

  return {
    ...lot,
    applied_qty: applied,
    issued_qty: issued,
    held_qty: held,
    position,
    realised_revenue: Math.round(revenue),
    avg_realisation: soldQty > 0 ? round(revenue / soldQty) : 0,
    issue_cost_total: Math.round(issued * costPerRec),
    held_cost: Math.round(held * costPerRec),
    profit: Math.round(revenue - (sold + redeemed) * costPerRec),
    holding_age_days: ageDays,
  };
}

export function getTransactions(lotId) {
  return db.prepare('SELECT * FROM rec_transactions WHERE lot_id = ? ORDER BY trade_date ASC, created_at ASC').all(lotId);
}

/** Rebuild the lot's disposed quantities and lifecycle status from its tranches. */
export function refreshLot(lotId) {
  const lot = db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(lotId);
  if (!lot) return null;

  const agg = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN txn_type='SALE' THEN quantity ELSE 0 END),0) sold,
      COALESCE(SUM(CASE WHEN txn_type='REDEMPTION' THEN quantity ELSE 0 END),0) redeemed,
      COALESCE(SUM(CASE WHEN txn_type='SALE' THEN amount ELSE 0 END),0) revenue
    FROM rec_transactions WHERE lot_id = ?
  `).get(lotId);

  const sold = Number(agg.sold) || 0;
  const redeemed = Number(agg.redeemed) || 0;
  const held = (Number(lot.quantity) || 0) - sold - redeemed;

  // Status tracks the lifecycle stage; the quantities carry the position.
  // A lot only reads SOLD/REDEEMED once nothing is left to dispose of.
  let status = lot.status;
  if (status !== 'CANCELLED' && status !== 'APPLIED') {
    if (held <= 0 && sold + redeemed > 0) status = redeemed > sold ? 'REDEEMED' : 'SOLD';
    else if (sold + redeemed > 0) status = 'LISTED';
    else if (lot.issuance_date) status = 'ISSUED';
  }

  const lastSale = db.prepare(`
    SELECT rate_per_rec, trade_date, platform, buyer FROM rec_transactions
    WHERE lot_id = ? AND txn_type = 'SALE' ORDER BY trade_date DESC, created_at DESC LIMIT 1
  `).get(lotId);

  db.prepare(`
    UPDATE rec_ledger SET sold_qty=?, redeemed_qty=?, sale_amount=?, sale_rate_per_rec=?,
      trade_date=?, trade_platform=?, buyer=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    sold, redeemed, Math.round(Number(agg.revenue) || 0),
    sold > 0 ? round((Number(agg.revenue) || 0) / sold) : 0,
    lastSale?.trade_date || lot.trade_date,
    lastSale?.platform || lot.trade_platform,
    lastSale?.buyer || lot.buyer,
    status, lotId,
  );

  return withPosition(db.prepare('SELECT * FROM rec_ledger WHERE id = ?').get(lotId));
}

/**
 * Vintage months with validated injected energy that have not been fully
 * converted into a REC lot yet — the queue for the next issuance application.
 */
export function issuableEnergy(vintageMonth) {
  const params = [];
  let sql = `
    SELECT e.id, e.contract_id, e.period_month, e.energy_mwh, e.data_type, e.status,
           c.contract_no, c.project_type
    FROM energy_data e
    JOIN contracts c ON c.id = e.contract_id
    WHERE e.status IN ('VALIDATED','LOCKED')
  `;
  if (vintageMonth) { sql += ' AND e.period_month = ?'; params.push(vintageMonth); }
  sql += ' ORDER BY e.period_month DESC, c.contract_no ASC';

  // FINAL supersedes PROVISIONAL for the same contract-month; certificates are
  // issued against the settled injection figure.
  const best = new Map();
  for (const row of db.prepare(sql).all(...params)) {
    const key = `${row.contract_id}|${row.period_month}`;
    const existing = best.get(key);
    if (!existing || (row.data_type === 'FINAL' && existing.data_type !== 'FINAL')) best.set(key, row);
  }

  return [...best.values()].map((row) => {
    const claimed = db.prepare(`
      SELECT COALESCE(SUM(quantity),0) q FROM rec_ledger
      WHERE contract_id = ? AND vintage_month = ? AND status != 'CANCELLED'
    `).get(row.contract_id, row.period_month).q;

    const eligible = certificatesFor(row.energy_mwh, row.project_type);
    return {
      ...row,
      technology: row.project_type,
      certificate_multiplier: multiplierFor(row.project_type),
      eligible_recs: eligible,
      already_claimed: claimed,
      issuable_recs: Math.max(0, eligible - claimed),
    };
  }).filter((r) => r.issuable_recs > 0);
}
