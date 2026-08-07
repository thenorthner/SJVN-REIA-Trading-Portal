import db from '../db/index.js';

function range({ from, to }) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('COALESCE(invoice_date, due_date) >= ?'); params.push(from); }
  if (to) { where.push('COALESCE(invoice_date, due_date) <= ?'); params.push(to); }
  return { where: where.join(' AND '), params };
}

// Net cash position: what the buyer owes SJVN against what SJVN owes the seller,
// each split into billed / collected / outstanding. The float is the gap between
// the two legs — the working capital the desk is carrying.
export function position(filters = {}) {
  const { where, params } = range(filters);
  const leg = (direction) => {
    const r = db.prepare(`
      SELECT COUNT(*) AS invoices,
             ROUND(COALESCE(SUM(gross_amount), 0), 2) AS gross,
             ROUND(COALESCE(SUM(tds_amount), 0), 2)   AS tds,
             ROUND(COALESCE(SUM(net_amount), 0), 2)   AS net,
             ROUND(COALESCE(SUM(paid_amount), 0), 2)  AS settled,
             SUM(CASE WHEN status != 'SETTLED' THEN 1 ELSE 0 END) AS open_invoices,
             ROUND(COALESCE(SUM(CASE WHEN status != 'SETTLED' THEN net_amount - paid_amount ELSE 0 END), 0), 2) AS outstanding
      FROM cashflow_entries WHERE ${where} AND direction = ?
    `).get(...params, direction);
    return r;
  };
  const inflow = leg('INFLOW');
  const outflow = leg('OUTFLOW');
  return {
    receivable: inflow,
    payable: outflow,
    net_settled: Number((inflow.settled - outflow.settled).toFixed(2)),
    net_outstanding: Number((inflow.outstanding - outflow.outstanding).toFixed(2)),
    // Gross margin realised in cash terms across the two legs.
    gross_spread: Number((inflow.gross - outflow.gross).toFixed(2)),
    tds_withheld_on_sales: inflow.tds,
    tds_withheld_on_purchases: outflow.tds,
  };
}

// Day-by-day movement and the running balance, so the cash curve can be plotted.
export function timeline(filters = {}) {
  const { where, params } = range(filters);
  const rows = db.prepare(`
    SELECT COALESCE(payment_date, due_date, invoice_date) AS d,
           direction,
           ROUND(SUM(CASE WHEN paid_amount > 0 THEN paid_amount ELSE net_amount END), 2) AS amount
    FROM cashflow_entries
    WHERE ${where} AND COALESCE(payment_date, due_date, invoice_date) IS NOT NULL
    GROUP BY d, direction
    ORDER BY d
  `).all(...params);

  const byDate = new Map();
  for (const r of rows) {
    const e = byDate.get(r.d) || { date: r.d, inflow: 0, outflow: 0 };
    if (r.direction === 'INFLOW') e.inflow += r.amount; else e.outflow += r.amount;
    byDate.set(r.d, e);
  }
  let running = 0;
  return [...byDate.values()].map((e) => {
    const net = e.inflow - e.outflow;
    running += net;
    return { ...e, net: Number(net.toFixed(2)), running_balance: Number(running.toFixed(2)) };
  });
}

// Unsettled invoices bucketed by how far past due they are.
export function ageing(asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT id, direction, invoice_no, party, due_date,
           ROUND(net_amount - paid_amount, 2) AS outstanding,
           CAST(julianday(?) - julianday(due_date) AS INTEGER) AS days_overdue
    FROM cashflow_entries
    WHERE status != 'SETTLED' AND due_date IS NOT NULL
    ORDER BY days_overdue DESC
  `).all(today);

  const buckets = { current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60_plus: 0 };
  for (const r of rows) {
    const o = r.outstanding || 0;
    if (r.days_overdue <= 0) buckets.current += o;
    else if (r.days_overdue <= 15) buckets.d1_15 += o;
    else if (r.days_overdue <= 30) buckets.d16_30 += o;
    else if (r.days_overdue <= 60) buckets.d31_60 += o;
    else buckets.d60_plus += o;
  }
  for (const k of Object.keys(buckets)) buckets[k] = Number(buckets[k].toFixed(2));
  return { as_of: today, buckets, items: rows };
}

// How quickly each side actually pays, measured invoice date to payment date.
export function settlementSpeed(filters = {}) {
  const { where, params } = range(filters);
  return db.prepare(`
    SELECT direction,
           COUNT(*) AS settled_invoices,
           ROUND(AVG(julianday(payment_date) - julianday(invoice_date)), 2) AS avg_days_to_pay,
           MIN(CAST(julianday(payment_date) - julianday(invoice_date) AS INTEGER)) AS fastest_days,
           MAX(CAST(julianday(payment_date) - julianday(invoice_date) AS INTEGER)) AS slowest_days,
           SUM(CASE WHEN julianday(payment_date) > julianday(due_date) THEN 1 ELSE 0 END) AS paid_late
    FROM cashflow_entries
    WHERE ${where} AND payment_date IS NOT NULL AND invoice_date IS NOT NULL
    GROUP BY direction
  `).all(...params);
}

export function listEntries(filters = {}) {
  const { where, params } = range(filters);
  const extra = filters.direction ? ' AND direction = ?' : '';
  const p = filters.direction ? [...params, filters.direction] : params;
  return db.prepare(`
    SELECT * FROM cashflow_entries WHERE ${where}${extra}
    ORDER BY COALESCE(invoice_date, due_date) DESC
  `).all(...p);
}
