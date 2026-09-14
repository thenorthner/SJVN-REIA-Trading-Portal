import db from '../db/index.js';
import { computeActualCufPercent, resolveMinCufPercent } from './cufPenalty.js';
import { daysInMonth } from './cercHydroBilling.js';

/**
 * What each project actually generated, against what its contract expects.
 *
 * The platform holds the energy and the capacity and knows each contract's
 * minimum CUF, and computes a shortfall penalty when a bill is raised — but
 * nothing showed the performance itself. A desk asking "which projects are
 * underperforming, and since when" had to read invoices one at a time.
 *
 * One row per contract per month: the energy accounted, the CUF it works out to,
 * the CUF the contract requires, the gap, and the availability the meter data
 * reported. FINAL supersedes PROVISIONAL for the same month — a superseded
 * provisional figure is not a second month of generation.
 */

/** The energy on record for each contract-month, FINAL winning over PROVISIONAL. */
function energyRows({ from, to }) {
  const where = ['1=1'];
  const params = [];
  if (from) { where.push('e.period_month >= ?'); params.push(from); }
  if (to) { where.push('e.period_month <= ?'); params.push(to); }

  return db.prepare(`
    SELECT
      e.contract_id, e.period_month, e.energy_mwh, e.cuf_percent, e.availability_percent,
      e.data_type, e.status, e.source,
      c.contract_no, c.project_type, c.capacity_mw, c.commissioned_capacity_mw,
      c.min_cuf_percent, c.tariff_per_unit, c.status AS contract_status,
      s.name AS seller_name
    FROM energy_data e
    JOIN contracts c ON c.id = e.contract_id
    LEFT JOIN entities s ON s.id = c.seller_id
    WHERE ${where.join(' AND ')}
      AND e.status != 'DRAFT'
      -- A provisional figure that a final one has replaced is not a second month.
      AND NOT EXISTS (
        SELECT 1 FROM energy_data f
        WHERE f.contract_id = e.contract_id AND f.period_month = e.period_month
          AND f.data_type = 'FINAL' AND f.status != 'DRAFT' AND e.data_type = 'PROVISIONAL'
      )
    ORDER BY e.period_month DESC, c.contract_no
  `).all(...params);
}

export function generationPerformance({ from = null, to = null, contractId = null } = {}) {
  const rows = energyRows({ from, to })
    .filter((r) => !contractId || r.contract_id === contractId)
    .map((r) => {
      // Billing measures against what is commissioned, not what was contracted:
      // a 100 MW PPA with 60 MW built is not underperforming by 40 MW.
      const capacity = Number(r.commissioned_capacity_mw) > 0
        ? Number(r.commissioned_capacity_mw)
        : Number(r.capacity_mw) || 0;
      const actualCuf = computeActualCufPercent({
        energyMwh: r.energy_mwh,
        capacityMw: capacity,
        periodMonth: r.period_month,
        cufPercent: r.cuf_percent,
      });
      const minCuf = resolveMinCufPercent(r);
      const possibleMwh = capacity * 24 * daysInMonth(r.period_month);
      const shortfallPct = actualCuf == null ? null : Math.max(0, minCuf - actualCuf);
      return {
        contract_id: r.contract_id,
        contract_no: r.contract_no,
        seller_name: r.seller_name,
        project_type: r.project_type,
        period_month: r.period_month,
        data_type: r.data_type,
        source: r.source,
        status: r.status,
        capacity_mw: capacity,
        contracted_capacity_mw: Number(r.capacity_mw) || 0,
        energy_mwh: Number(r.energy_mwh) || 0,
        possible_mwh: Math.round(possibleMwh * 100) / 100,
        actual_cuf_percent: actualCuf == null ? null : Math.round(actualCuf * 100) / 100,
        min_cuf_percent: minCuf,
        cuf_shortfall_percent: shortfallPct == null ? null : Math.round(shortfallPct * 100) / 100,
        shortfall_mwh: shortfallPct == null ? 0 : Math.round(shortfallPct / 100 * possibleMwh * 100) / 100,
        availability_percent: r.availability_percent == null ? null : Number(r.availability_percent),
        meets_cuf: actualCuf == null ? null : actualCuf >= minCuf,
      };
    });

  // Per project, so the question "who is underperforming, and since when" has an
  // answer without reading every month.
  const byContract = new Map();
  for (const row of rows) {
    if (!byContract.has(row.contract_id)) {
      byContract.set(row.contract_id, {
        contract_id: row.contract_id,
        contract_no: row.contract_no,
        seller_name: row.seller_name,
        project_type: row.project_type,
        capacity_mw: row.capacity_mw,
        months: 0,
        energy_mwh: 0,
        possible_mwh: 0,
        months_below_cuf: 0,
        shortfall_mwh: 0,
        min_cuf_percent: row.min_cuf_percent,
        availability_sum: 0,
        availability_months: 0,
      });
    }
    const p = byContract.get(row.contract_id);
    p.months += 1;
    p.energy_mwh += row.energy_mwh;
    p.possible_mwh += row.possible_mwh;
    p.shortfall_mwh += row.shortfall_mwh;
    if (row.meets_cuf === false) p.months_below_cuf += 1;
    if (row.availability_percent != null) {
      p.availability_sum += row.availability_percent;
      p.availability_months += 1;
    }
  }

  const projects = [...byContract.values()].map((p) => ({
    ...p,
    energy_mwh: Math.round(p.energy_mwh * 100) / 100,
    possible_mwh: Math.round(p.possible_mwh * 100) / 100,
    shortfall_mwh: Math.round(p.shortfall_mwh * 100) / 100,
    // The CUF over the whole period, not the average of the monthly CUFs: a
    // short month and a long one do not carry equal weight.
    period_cuf_percent: p.possible_mwh > 0 ? Math.round(p.energy_mwh / p.possible_mwh * 10000) / 100 : null,
    avg_availability_percent: p.availability_months
      ? Math.round(p.availability_sum / p.availability_months * 100) / 100
      : null,
    availability_sum: undefined,
    availability_months: undefined,
  })).sort((a, b) => b.shortfall_mwh - a.shortfall_mwh);

  const totals = rows.reduce((acc, r) => ({
    months: acc.months + 1,
    energy_mwh: acc.energy_mwh + r.energy_mwh,
    possible_mwh: acc.possible_mwh + r.possible_mwh,
    shortfall_mwh: acc.shortfall_mwh + r.shortfall_mwh,
    months_below_cuf: acc.months_below_cuf + (r.meets_cuf === false ? 1 : 0),
  }), { months: 0, energy_mwh: 0, possible_mwh: 0, shortfall_mwh: 0, months_below_cuf: 0 });

  return {
    from,
    to,
    totals: {
      ...totals,
      energy_mwh: Math.round(totals.energy_mwh * 100) / 100,
      possible_mwh: Math.round(totals.possible_mwh * 100) / 100,
      shortfall_mwh: Math.round(totals.shortfall_mwh * 100) / 100,
      projects: projects.length,
      period_cuf_percent: totals.possible_mwh > 0
        ? Math.round(totals.energy_mwh / totals.possible_mwh * 10000) / 100
        : null,
    },
    projects,
    months: rows,
  };
}
