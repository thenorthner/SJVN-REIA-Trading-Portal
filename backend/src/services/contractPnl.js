import db from '../db/index.js';

// Per-deal profitability. Volume is the buyer's own approved energy across its
// open-access applications (the day-wise schedule is kept at contract level, so
// using it here would credit one buyer with the whole contract); a deal with a
// schedule of its own uses that instead. Revenue and cost of power are priced off
// the deal's sale and purchase rates, so contribution is the trading margin on
// that volume, less any open-access charges SJVN itself bears.
export function contractPnl({ from, to } = {}) {
  const deals = db.prepare(`
    SELECT b.id, b.counterparty, b.loi_contract_ref, b.quantum_mw, b.contracted_mwh,
           b.purchase_rate_per_unit, b.sale_rate_per_unit, b.trading_margin_per_unit,
           b.start_date, b.end_date, tc.name AS client_name
    FROM bilateral_transactions b
    LEFT JOIN trading_clients tc ON tc.id = b.client_id
    WHERE b.status != 'CANCELLED'
    ORDER BY b.start_date
  `).all();

  const volFor = db.prepare(`
    SELECT ROUND(COALESCE(SUM(scheduled_mwh), 0), 3) AS scheduled_mwh,
           ROUND(COALESCE(SUM(seller_default_mwh), 0), 3) AS shortfall_mwh,
           COUNT(*) AS days
    FROM schedule_deviations
    WHERE bilateral_id = ?
      AND (? IS NULL OR schedule_date >= ?)
      AND (? IS NULL OR schedule_date <= ?)
  `);
  const oaFor = db.prepare(`
    SELECT ROUND(COALESCE(SUM(seller_total), 0), 2) AS oa_borne
    FROM oa_charge_estimates WHERE bilateral_id = ?
  `);

  const rows = deals.map((d) => {
    const v = volFor.get(d.id, from || null, from || null, to || null, to || null);
    // Prefer a schedule attached to this deal; otherwise the buyer's approved
    // application volume.
    const scheduled = v.scheduled_mwh || d.contracted_mwh || 0;
    const volume_basis = v.scheduled_mwh ? 'SCHEDULE' : (d.contracted_mwh ? 'APPLICATIONS' : 'NONE');
    const sale = d.sale_rate_per_unit ?? 0;
    const purchase = d.purchase_rate_per_unit ?? 0;
    const margin = d.trading_margin_per_unit ?? 0;
    // Rates are per kWh; scheduled volume is in MWh.
    const kwh = scheduled * 1000;
    const revenue = Number((kwh * sale).toFixed(2));
    const cost_of_power = Number((kwh * purchase).toFixed(2));
    const trading_margin = Number((kwh * margin).toFixed(2));
    const oa_borne = oaFor.get(d.id)?.oa_borne || 0;
    const contribution = Number((trading_margin - oa_borne).toFixed(2));
    return {
      bilateral_id: d.id,
      client: d.client_name,
      counterparty: d.counterparty,
      contract_ref: d.loi_contract_ref,
      period: { from: d.start_date, to: d.end_date },
      schedule_days: v.days,
      volume_basis,
      scheduled_mwh: scheduled,
      shortfall_mwh: v.shortfall_mwh || 0,
      purchase_rate: purchase,
      sale_rate: sale,
      margin_rate: margin,
      revenue,
      cost_of_power,
      trading_margin,
      oa_charges_borne: oa_borne,
      contribution,
      margin_pct: revenue ? Number(((contribution / revenue) * 100).toFixed(3)) : 0,
    };
  });

  const totals = rows.reduce((a, r) => ({
    scheduled_mwh: a.scheduled_mwh + r.scheduled_mwh,
    revenue: a.revenue + r.revenue,
    cost_of_power: a.cost_of_power + r.cost_of_power,
    trading_margin: a.trading_margin + r.trading_margin,
    oa_charges_borne: a.oa_charges_borne + r.oa_charges_borne,
    contribution: a.contribution + r.contribution,
  }), { scheduled_mwh: 0, revenue: 0, cost_of_power: 0, trading_margin: 0, oa_charges_borne: 0, contribution: 0 });
  for (const k of Object.keys(totals)) totals[k] = Number(totals[k].toFixed(2));

  return { contracts: rows, totals };
}

// Portfolio P&L from money that actually moved, rather than from modelled rates:
// billed to the buyer less billed by the seller, with the TDS positions shown
// separately because they are timing, not cost.
export function realisedPnl({ from, to } = {}) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('COALESCE(invoice_date, due_date) >= ?'); params.push(from); }
  if (to) { where.push('COALESCE(invoice_date, due_date) <= ?'); params.push(to); }
  const w = where.join(' AND ');

  const leg = (direction, type) => {
    const extra = type === 'ENERGY' ? " AND invoice_type LIKE '%Energy%'"
      : type === 'OA' ? " AND invoice_type LIKE '%OA%'" : '';
    return db.prepare(`
      SELECT ROUND(COALESCE(SUM(gross_amount), 0), 2) AS gross,
             ROUND(COALESCE(SUM(tds_amount), 0), 2) AS tds,
             COUNT(*) AS invoices
      FROM cashflow_entries WHERE ${w} AND direction = ?${extra}
    `).get(...params, direction);
  };

  const salesEnergy = leg('INFLOW', 'ENERGY');
  const salesOa = leg('INFLOW', 'OA');
  const purchases = leg('OUTFLOW');

  const energy_margin = Number((salesEnergy.gross - purchases.gross).toFixed(2));
  const oa_recovered = salesOa.gross;
  const gross_profit = Number((energy_margin + oa_recovered).toFixed(2));

  return {
    energy_sales: salesEnergy,
    oa_recharges: salesOa,
    power_purchases: purchases,
    energy_margin,
    oa_recovered,
    gross_profit,
    tds_withheld_by_buyer: salesEnergy.tds + salesOa.tds,
    tds_withheld_from_seller: purchases.tds,
  };
}
