import db from '../db/index.js';
import { computeCufPenalty } from './cufPenalty.js';
import { daysInMonth } from './cercHydroBilling.js';
import { resolveTariff } from './tariffStructure.js';
import { lastCompleteMonth } from './energyRules.js';
import { billableCapacityMw } from '../util.js';
import { trueUpPosition } from './cufTrueUp.js';
import { contractYearBounds } from './cufPenalty.js';

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
 * reported. The monthly shortfall is an indicator: CUF is assessed over the
 * contract year and settled by the year-end true-up (cufTrueUp.js), whose
 * position for each contract year is listed alongside.
 *
 * Held to what billing does (17-Oct-2026 audit): a CUF obligation is a solar /
 * wind / hybrid PPA's, so hydro stations (124 of 129 rows, all judged against
 * the 22 % solar default and making 30 of the 31 "months below CUF") and a PSA's
 * own copy of its source PPA's energy are left out; one reading per month, the
 * one billing uses (locked first, then final, then the latest), so two
 * provisional readings are not two months; and a month not over yet is not
 * judged against a whole month's capacity.
 */

export const CUF_TYPES = ['Solar', 'Wind', 'Hybrid', 'FDRE'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Why a from/to pair cannot be read, or null. */
export function rangeProblem(from, to) {
  if (from && !MONTH.test(from)) return 'from must be a month, YYYY-MM';
  if (to && !MONTH.test(to)) return 'to must be a month, YYYY-MM';
  if (from && to && from > to) return `The range starts (${from}) after it ends (${to}).`;
  return null;
}

/** The reading billing would use for each contract-month of a CUF-bound PPA. */
function energyRows({ from, to, upTo }) {
  const where = [`c.contract_type = 'PPA'`, `c.project_type IN (${CUF_TYPES.map(() => '?').join(',')})`, 'e.period_month <= ?'];
  const params = [...CUF_TYPES, upTo];
  if (from) { where.push('e.period_month >= ?'); params.push(from); }
  if (to) { where.push('e.period_month <= ?'); params.push(to); }

  return db.prepare(`
    SELECT * FROM (
      SELECT
        e.contract_id, e.period_month, e.energy_mwh, e.cuf_percent, e.availability_percent,
        e.data_type, e.status, e.source,
        c.contract_no, c.contract_type, c.project_type, c.capacity_mw, c.commissioned_capacity_mw,
        c.min_cuf_percent, c.tariff_per_unit, c.tariff_type, c.tariff_structure_json, c.tenure_start,
        c.billing_cycle, c.annual_afc, c.status AS contract_status,
        s.name AS seller_name,
        ROW_NUMBER() OVER (
          PARTITION BY e.contract_id, e.period_month
          ORDER BY (e.status = 'LOCKED') DESC, (e.data_type = 'FINAL') DESC, e.created_at DESC
        ) AS pick
      FROM energy_data e
      JOIN contracts c ON c.id = e.contract_id
      LEFT JOIN entities s ON s.id = c.seller_id
      WHERE ${where.join(' AND ')}
        AND e.status NOT IN ('DRAFT', 'REJECTED')
    ) WHERE pick = 1
    ORDER BY period_month DESC, contract_no
  `).all(...params);
}

export function generationPerformance({ from = null, to = null, contractId = null } = {}) {
  const upTo = lastCompleteMonth();
  const rows = energyRows({ from, to, upTo })
    .filter((r) => !contractId || r.contract_id === contractId)
    .map((r) => {
      // Billing measures against what is commissioned, not what was contracted:
      // a 100 MW PPA with 60 MW built is not underperforming by 40 MW.
      const capacity = billableCapacityMw(r);
      const possibleMwh = capacity * 24 * daysInMonth(r.period_month);
      // The month's shortfall against the minimum, as an indicator only: nothing
      // is deducted for a month on its own.
      const cuf = computeCufPenalty({
        contract: r, periodMonth: r.period_month, energyMwh: Number(r.energy_mwh) || 0,
        capacityMw: capacity, cufPercent: r.cuf_percent,
        tariffPerUnit: resolveTariff(r, r.period_month).rate || r.tariff_per_unit,
      });
      const actualCuf = cuf.actualCuf;
      const minCuf = cuf.minCuf;
      const shortfallPct = actualCuf == null || minCuf == null ? null : Math.max(0, minCuf - actualCuf);
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
        shortfall_mwh: Math.round((cuf.shortfallMwh || 0) * 100) / 100,
        availability_percent: r.availability_percent == null ? null : Number(r.availability_percent),
        meets_cuf: actualCuf == null || minCuf == null ? null : actualCuf >= minCuf,
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
  })).sort((a, b) => b.shortfall_mwh - a.shortfall_mwh || a.contract_no.localeCompare(b.contract_no));

  const totals = rows.reduce((acc, r) => ({
    months: acc.months + 1,
    energy_mwh: acc.energy_mwh + r.energy_mwh,
    possible_mwh: acc.possible_mwh + r.possible_mwh,
    shortfall_mwh: acc.shortfall_mwh + r.shortfall_mwh,
    months_below_cuf: acc.months_below_cuf + (r.meets_cuf === false ? 1 : 0),
  }), { months: 0, energy_mwh: 0, possible_mwh: 0, shortfall_mwh: 0, months_below_cuf: 0 });

  // Each CUF-bound contract's contract years — the one in progress and the one
  // before it — with where the annual assessment stands: in progress, waiting
  // on energy, met, due for its true-up note, or raised.
  const yearRows = [];
  const cufContracts = db.prepare(`
    SELECT * FROM contracts WHERE project_type IN (${CUF_TYPES.map(() => '?').join(',')})
      AND contract_type IN ('PPA', 'PSA') AND status IN ('ACTIVE', 'AMENDED', 'NEARING_EXPIRY', 'RENEWED', 'EXPIRED')
      AND tenure_start IS NOT NULL
    ORDER BY contract_no
  `).all(...CUF_TYPES);
  for (const c of cufContracts) {
    if (contractId && c.id !== contractId) continue;
    const start = String(c.tenure_start).slice(0, 7);
    if (start > upTo) continue;
    const current = contractYearBounds(c, upTo).contract_year;
    for (const year of [current - 1, current]) {
      if (year < 1) continue;
      try {
        const y = trueUpPosition(c, year);
        if (y.assessed_from > y.year_end) continue; // commissioned after this year
        yearRows.push({
          contract_id: c.id, contract_no: c.contract_no, contract_type: c.contract_type, project_type: c.project_type,
          contract_year: y.contract_year, year_start: y.year_start, year_end: y.year_end,
          months_counted: y.months_counted, months_missing: y.months_missing,
          energy_mwh: y.energy_mwh, possible_mwh: y.possible_mwh,
          cuf_percent: y.cuf_percent, min_cuf_percent: y.min_cuf_percent,
          state: y.state, shortfall_mwh: y.shortfall_mwh, penalty: y.penalty,
          note: y.note, anchor_invoice: y.anchor_invoice,
        });
      } catch { /* a contract whose years cannot be counted is left out */ }
    }
  }
  const due = yearRows.filter((y) => y.state === 'DUE');

  return {
    from,
    to,
    contract_years: yearRows,
    // The latest month judged: the one in progress is not over, so a whole
    // month's capacity cannot be held against it yet.
    judged_up_to: upTo,
    totals: {
      ...totals,
      energy_mwh: Math.round(totals.energy_mwh * 100) / 100,
      possible_mwh: Math.round(totals.possible_mwh * 100) / 100,
      shortfall_mwh: Math.round(totals.shortfall_mwh * 100) / 100,
      projects: projects.length,
      true_up_due: due.length,
      true_up_due_amount: due.reduce((a, y) => a + y.penalty, 0),
      period_cuf_percent: totals.possible_mwh > 0
        ? Math.round(totals.energy_mwh / totals.possible_mwh * 10000) / 100
        : null,
    },
    projects,
    months: rows,
  };
}
