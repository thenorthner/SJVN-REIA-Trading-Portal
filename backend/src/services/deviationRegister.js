import db from '../db/index.js';
import { pushNotification } from '../util.js';
import { getParamNumber } from '../mastersService.js';

function filterSql({ bilateral_id, contract_ref, from, to }) {
  const where = ['1=1'];
  const params = [];
  if (bilateral_id) { where.push('bilateral_id = ?'); params.push(bilateral_id); }
  if (contract_ref) { where.push('contract_ref = ?'); params.push(contract_ref); }
  if (from) { where.push('schedule_date >= ?'); params.push(from); }
  if (to) { where.push('schedule_date <= ?'); params.push(to); }
  return { where: where.join(' AND '), params };
}

// Day-wise register, newest first. Only days where a side defaulted when
// onlyDeviations is set.
export function listDeviations(filters = {}) {
  const { where, params } = filterSql(filters);
  const extra = filters.only_deviations ? ' AND (buyer_default_mwh > 0 OR seller_default_mwh > 0)' : '';
  return db.prepare(`
    SELECT * FROM schedule_deviations
    WHERE ${where}${extra}
    ORDER BY schedule_date DESC
  `).all(...params);
}

// Headline performance for a period: how much was requested, how much actually
// scheduled, and how the shortfall splits between the two sides. Reliability is
// the share of requested energy that was actually delivered.
export function summary(filters = {}) {
  const { where, params } = filterSql(filters);
  const t = db.prepare(`
    SELECT
      COUNT(*)                              AS days,
      ROUND(SUM(availability_mwh), 3)       AS availability_mwh,
      ROUND(SUM(requested_mwh), 3)          AS requested_mwh,
      ROUND(SUM(scheduled_mwh), 3)          AS scheduled_mwh,
      ROUND(SUM(buyer_default_mwh), 3)      AS buyer_default_mwh,
      ROUND(SUM(seller_default_mwh), 3)     AS seller_default_mwh,
      SUM(CASE WHEN seller_default_mwh > 0 THEN 1 ELSE 0 END) AS seller_default_days,
      SUM(CASE WHEN buyer_default_mwh  > 0 THEN 1 ELSE 0 END) AS buyer_default_days
    FROM schedule_deviations WHERE ${where}
  `).get(...params);

  const requested = t.requested_mwh || 0;
  const sellerShortfallPct = requested ? (t.seller_default_mwh / requested) * 100 : 0;
  const buyerShortfallPct = requested ? (t.buyer_default_mwh / requested) * 100 : 0;
  return {
    ...t,
    seller_shortfall_pct: Number(sellerShortfallPct.toFixed(3)),
    buyer_shortfall_pct: Number(buyerShortfallPct.toFixed(3)),
    // Delivered share of what the buyer asked for.
    seller_reliability_pct: Number((100 - sellerShortfallPct).toFixed(3)),
    buyer_offtake_pct: Number((100 - buyerShortfallPct).toFixed(3)),
  };
}

// Per-counterparty scorecard. Grades on delivered share of requested energy:
// A >= 99.5, B >= 98, C >= 95, D below that.
export function scorecard(filters = {}) {
  const { where, params } = filterSql(filters);
  const rows = db.prepare(`
    SELECT
      sd.contract_ref,
      COALESCE(sd.counterparty, bt.counterparty, 'Unknown') AS counterparty,
      COUNT(*)                              AS days,
      ROUND(SUM(sd.requested_mwh), 3)       AS requested_mwh,
      ROUND(SUM(sd.scheduled_mwh), 3)       AS scheduled_mwh,
      ROUND(SUM(sd.seller_default_mwh), 3)  AS seller_default_mwh,
      ROUND(SUM(sd.buyer_default_mwh), 3)   AS buyer_default_mwh,
      SUM(CASE WHEN sd.seller_default_mwh > 0 THEN 1 ELSE 0 END) AS incident_days,
      ROUND(MAX(sd.seller_default_mwh), 3)  AS worst_shortfall_mwh
    FROM schedule_deviations sd
    LEFT JOIN bilateral_transactions bt ON bt.id = sd.bilateral_id
    WHERE ${where}
    GROUP BY sd.contract_ref, COALESCE(sd.counterparty, bt.counterparty, 'Unknown')
    ORDER BY seller_default_mwh DESC
  `).all(...params);

  return rows.map((r) => {
    const reliability = r.requested_mwh ? 100 - (r.seller_default_mwh / r.requested_mwh) * 100 : 100;
    const rel = Number(reliability.toFixed(3));
    const grade = rel >= 99.5 ? 'A' : rel >= 98 ? 'B' : rel >= 95 ? 'C' : 'D';
    return { ...r, seller_reliability_pct: rel, grade };
  });
}

// Notify on material shortfalls. A day is material when the side that defaulted
// missed more than the configured share of what was requested (default 5%).
// alerted_at is stamped so each incident is raised once rather than on every
// sweep, matching how the NOAR SLA alerts behave.
export function runDeviationAlerts() {
  const threshold = getParamNumber('deviation_alert_pct', 5);
  const rows = db.prepare(`
    SELECT * FROM schedule_deviations
    WHERE alerted_at IS NULL
      AND requested_mwh > 0
      AND (seller_default_mwh > 0 OR buyer_default_mwh > 0)
    ORDER BY schedule_date
  `).all();

  const stamp = db.prepare(`UPDATE schedule_deviations SET alerted_at = datetime('now') WHERE id = ?`);
  let sent = 0;
  for (const r of rows) {
    const sellerPct = (r.seller_default_mwh / r.requested_mwh) * 100;
    const buyerPct = (r.buyer_default_mwh / r.requested_mwh) * 100;
    const worstPct = Math.max(sellerPct, buyerPct);
    if (worstPct < threshold) {
      // Below the bar is still resolved, so it is not looked at again.
      stamp.run(r.id);
      continue;
    }
    const sellerSide = sellerPct >= buyerPct;
    const who = sellerSide ? (r.counterparty || 'Seller') : 'Buyer';
    const shortMwh = sellerSide ? r.seller_default_mwh : r.buyer_default_mwh;
    pushNotification({
      role: 'TRADING_USER',
      type: 'SCHEDULE_DEVIATION',
      message: `${who} short ${shortMwh.toFixed(3)} MWh on ${r.schedule_date} — ${worstPct.toFixed(1)}% of the ${r.requested_mwh.toFixed(3)} MWh requested`,
    });
    stamp.run(r.id);
    sent++;
  }
  return { checked: rows.length, alerted: sent, threshold_pct: threshold };
}

// The individual shortfall events, worst first — what an ops review looks at.
export function incidents(filters = {}) {
  const { where, params } = filterSql(filters);
  return db.prepare(`
    SELECT sd.*, COALESCE(sd.counterparty, bt.counterparty, 'Unknown') AS counterparty,
           ROUND(CASE WHEN sd.requested_mwh > 0
                      THEN (sd.seller_default_mwh / sd.requested_mwh) * 100 ELSE 0 END, 2) AS shortfall_pct
    FROM schedule_deviations sd
    LEFT JOIN bilateral_transactions bt ON bt.id = sd.bilateral_id
    WHERE ${where} AND (sd.seller_default_mwh > 0 OR sd.buyer_default_mwh > 0)
    ORDER BY (sd.seller_default_mwh + sd.buyer_default_mwh) DESC
  `).all(...params);
}
