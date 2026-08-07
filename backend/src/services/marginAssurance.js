import db from '../db/index.js';

// The desk's core commercial rule: SJVN buys and sells the same energy on the
// same day, and the gap between the two rates is the trading margin. It should be
// the contract's margin on every single day — the ISET ledger holds it at exactly
// 0.03 on all 76 settled days. Anything else is either a pricing error or a deal
// struck off-contract, and is worth surfacing rather than averaging away.
const TOLERANCE = 0.0005;   // half a paise, to absorb rounding in the source

function expectedMargin(contractRef) {
  const row = db.prepare(`
    SELECT trading_margin_per_unit FROM bilateral_transactions
    WHERE loi_contract_ref = ? AND trading_margin_per_unit IS NOT NULL
    LIMIT 1
  `).get(contractRef);
  return row?.trading_margin_per_unit ?? 0.03;
}

function range({ from, to }) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('settlement_date >= ?'); params.push(from); }
  if (to) { where.push('settlement_date <= ?'); params.push(to); }
  return { where: where.join(' AND '), params };
}

// Every settled day with its margin, flagged against the contract's expected one.
export function marginCheck(filters = {}) {
  const { where, params } = range(filters);
  const rows = db.prepare(`
    SELECT * FROM energy_settlements WHERE ${where} ORDER BY settlement_date
  `).all(...params);

  const checked = rows.map((r) => {
    const expected = expectedMargin(r.contract_ref);
    const drift = Number(((r.margin_rate ?? 0) - expected).toFixed(4));
    return {
      settlement_date: r.settlement_date,
      contract_ref: r.contract_ref,
      energy_kwh: r.energy_kwh,
      purchase_rate: r.purchase_rate,
      sale_rate: r.sale_rate,
      margin_rate: r.margin_rate,
      expected_margin: expected,
      drift,
      margin_amount: r.margin_amount,
      ok: Math.abs(drift) <= TOLERANCE,
    };
  });

  const breaches = checked.filter((c) => !c.ok);
  const totalEnergy = checked.reduce((s, c) => s + (c.energy_kwh || 0), 0);
  const totalMargin = checked.reduce((s, c) => s + (c.margin_amount || 0), 0);

  return {
    days: checked.length,
    days_ok: checked.length - breaches.length,
    days_breached: breaches.length,
    compliance_pct: checked.length ? Number(((1 - breaches.length / checked.length) * 100).toFixed(3)) : 100,
    total_energy_kwh: Number(totalEnergy.toFixed(3)),
    total_margin: Number(totalMargin.toFixed(2)),
    // The margin actually realised across the period, which should land on the
    // contract rate when every day complies.
    effective_margin_rate: totalEnergy ? Number((totalMargin / totalEnergy).toFixed(5)) : 0,
    breaches,
    days_detail: checked,
  };
}

// Rate movement over the period — the purchase rate floats daily while the margin
// stays fixed, so this is what a rate-trend chart plots.
export function rateTrend(filters = {}) {
  const { where, params } = range(filters);
  return db.prepare(`
    SELECT settlement_date, purchase_rate, sale_rate, margin_rate, energy_kwh, margin_amount
    FROM energy_settlements WHERE ${where} ORDER BY settlement_date
  `).all(...params);
}

// Where the receipt did not match what was billed. The ledger carries small
// differences (a 5,000 TDS adjustment, a 635 bank rounding) that were never
// chased; this is the list to work through.
export function receiptExceptions(filters = {}, minAbs = 1) {
  const { where, params } = range(filters);
  return db.prepare(`
    SELECT settlement_date, net_receivable, actual_receipt, receipt_difference, receipt_date
    FROM energy_settlements
    WHERE ${where} AND ABS(receipt_difference) >= ?
    ORDER BY ABS(receipt_difference) DESC
  `).all(...params, minAbs);
}
