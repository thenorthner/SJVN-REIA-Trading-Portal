import db from '../db/index.js';
import { computeOaCharges } from './oaCharges.js';

// Reconcile what an application was actually charged against what the calculator
// would have estimated for it. A clean run proves the rate master reflects what
// Grid India actually bills; a drift points at either a stale rate or a charge
// raised on a basis the master does not know about.
const TOLERANCE = 1;   // rupees — the ledger rounds charges to whole rupees

function range({ from, to }) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('application_date >= ?'); params.push(from); }
  if (to) { where.push('application_date <= ?'); params.push(to); }
  return { where: where.join(' AND '), params };
}

export function reconcileOaCharges(filters = {}) {
  const { where, params } = range(filters);
  const actuals = db.prepare(`
    SELECT * FROM oa_application_charges WHERE ${where} ORDER BY application_date, application_no
  `).all(...params);

  // The RLDC operating charge is levied per day, so the fee actually billed says
  // how many days the application ran — most are single-day, but a few run longer
  // (one carries 8,000, i.e. eight days). Reading the duration back from the fee
  // avoids treating a legitimately longer application as a pricing drift.
  const rldcDayRate = db.prepare(`
    SELECT rate_value FROM rate_master WHERE charge_name = 'RLDC Fee' AND is_active = 1 LIMIT 1
  `).get()?.rate_value || 1000;

  const rows = actuals.map((a) => {
    // Price the same application the way the calculator would: ISTS on the rate
    // in force that day for its corridor, the flat NOAR fee, and the RLDC charge
    // over the application's own duration. These carry no STU/SLDC legs.
    // The corridor is encoded in the application number (SJVN<DDMMYY><REGION><SEQ>).
    const region = (String(a.application_no).match(/SJVN\d{6}([A-Z]{2})/) || [])[1] || null;
    const days = Math.max(1, Math.round((a.rldc_fee_actual || 0) / rldcDayRate) || 1);
    const est = computeOaCharges({
      quantum_mwh: a.approved_mwh,
      days,
      on_date: a.application_date,
      region,
    });
    const line = (name) => est.line_items.find((i) => i.charge === name)?.amount ?? 0;
    const istsEst = line('ISTS');
    const feeEst = line('NOAR Application Fee');
    const rldcEst = line('RLDC Fee');
    const totalEst = istsEst + feeEst + rldcEst;
    const drift = Number((totalEst - a.total_actual).toFixed(2));
    return {
      application_no: a.application_no,
      region,
      days,
      application_date: a.application_date,
      buyer: a.buyer,
      approved_mwh: a.approved_mwh,
      ists_actual: a.ists_actual, ists_estimated: istsEst, ists_drift: Number((istsEst - a.ists_actual).toFixed(2)),
      fee_actual: a.application_fee_actual, fee_estimated: feeEst,
      rldc_actual: a.rldc_fee_actual, rldc_estimated: rldcEst,
      total_actual: a.total_actual, total_estimated: totalEst,
      drift,
      matched: Math.abs(drift) <= TOLERANCE,
    };
  });

  const mismatches = rows.filter((r) => !r.matched);
  const totalActual = rows.reduce((s, r) => s + r.total_actual, 0);
  const totalEstimated = rows.reduce((s, r) => s + r.total_estimated, 0);

  return {
    applications: rows.length,
    matched: rows.length - mismatches.length,
    mismatched: mismatches.length,
    match_pct: rows.length ? Number(((1 - mismatches.length / rows.length) * 100).toFixed(3)) : 100,
    total_actual: Number(totalActual.toFixed(2)),
    total_estimated: Number(totalEstimated.toFixed(2)),
    total_drift: Number((totalEstimated - totalActual).toFixed(2)),
    mismatches: mismatches.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift)),
    rows,
  };
}

// Actual charges rolled up by month, which is how the OA cost line is reviewed.
export function actualsByMonth(filters = {}) {
  const { where, params } = range(filters);
  return db.prepare(`
    SELECT substr(application_date, 1, 7) AS month,
           COUNT(*) AS applications,
           ROUND(SUM(approved_mwh), 3) AS approved_mwh,
           ROUND(SUM(ists_actual), 2) AS ists,
           ROUND(SUM(application_fee_actual), 2) AS application_fees,
           ROUND(SUM(rldc_fee_actual), 2) AS rldc_fees,
           ROUND(SUM(total_actual), 2) AS total
    FROM oa_application_charges
    WHERE ${where}
    GROUP BY month ORDER BY month
  `).all(...params);
}
