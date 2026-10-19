/**
 * The Hydro / Thermal desk's dashboard, from the books as they stand.
 *
 * Every figure here used to be typed in: a billing trend, PAFM and energy
 * curves, a beneficiary table and a "Buxar" thermal station that exist nowhere
 * in the data, and pipeline counts that turned a zero into 1, 4 or 6 (Hydro QA
 * run 16). Now each comes from the bills and the ledger, and an empty month is
 * shown as empty.
 *
 *   billed     what the ledger charged for the month's bills: bills less the
 *              credits a lower restatement gave, reversals left out
 *   collected  money applied to those bills: payments and TDS, not credit
 *              notes (already netted out of billed) or rebates (a discount)
 *   PAFM, energy  the latest issued energy bill for each station-month
 */
import db from '../db/index.js';

const ENERGY_KINDS = ['PROVISIONAL', 'FINAL', 'REVISION'];
const NOT_CASH = ['CREDIT_NOTE', 'REBATE'];
const cr = (v) => Math.round((Number(v) || 0) / 1e5) / 100;
const round = (v, dp = 2) => (v == null ? null : Math.round(Number(v) * 10 ** dp) / 10 ** dp);
const PALETTE = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#14b8a6', '#6366f1', '#84cc16', '#a855f7'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** The months of the financial year so far, April first. */
function fyMonths(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  const out = [];
  for (let i = 0; i < 12; i += 1) {
    const mm = ((3 + i) % 12) + 1;
    const yy = start + (3 + i >= 12 ? 1 : 0);
    const key = `${yy}-${String(mm).padStart(2, '0')}`;
    if (key > today.slice(0, 7)) break;
    out.push(key);
  }
  return { months: out, financialYear: `${start}-${start + 1}` };
}

/** NJHPS, RHPS … from the contract number, for the per-station chart keys. */
const stationCode = (c) => (String(c.contract_no || '').split('/')[2] || c.id).toLowerCase();

export function buildDashboard({ desk = null, readiness = () => ({}) } = {}) {
  const today = todayIst();
  const { months, financialYear } = fyMonths(today);

  const types = desk === 'HYDRO' ? ['Hydro', 'PSP'] : desk === 'THERMAL' ? ['Thermal'] : ['Hydro', 'PSP', 'Thermal'];
  const contracts = db.prepare(`
    SELECT c.*, e.name AS seller_name FROM contracts c LEFT JOIN entities e ON c.seller_id = e.id
    WHERE c.contract_type = 'PPA' AND c.project_type IN (${types.map(() => '?').join(',')})
    ORDER BY c.contract_no
  `).all(...types);
  const ids = contracts.map((c) => c.id);
  const inIds = ids.length ? `(${ids.map(() => '?').join(',')})` : "('')";

  // The latest issued energy bill for each station-month: its PAFM and energy stand for the month.
  const basis = db.prepare(`
    SELECT b.* FROM hydro_station_bills b
    WHERE b.contract_id IN ${inIds} AND b.status = 'ISSUED' AND b.bill_kind IN ('PROVISIONAL','FINAL','REVISION')
      AND NOT EXISTS (
        SELECT 1 FROM hydro_station_bills x
        WHERE x.contract_id = b.contract_id AND x.billing_month = b.billing_month AND x.status = 'ISSUED'
          AND x.bill_kind IN ('PROVISIONAL','FINAL','REVISION')
          AND (COALESCE(x.issued_at, '') > COALESCE(b.issued_at, '')
            OR (COALESCE(x.issued_at, '') = COALESCE(b.issued_at, '') AND x.created_at > b.created_at))
      )
  `).all(...ids);
  const basisOf = (cid, m) => basis.find((b) => b.contract_id === cid && b.billing_month === m);

  const tariff = db.prepare('SELECT annual_afc, napaf_percent FROM hydro_station_tariffs WHERE contract_id = ? AND financial_year = ?');
  // A thermal station's AFC and NAPAF are on its own tariff table; the
  // contract carries neither, which read as a zero AFC.
  const thermalTariff = db.prepare('SELECT annual_afc, napaf_percent, gross_heat_rate, aux_pct FROM thermal_station_tariffs WHERE contract_id = ? AND financial_year = ?');
  const stations = contracts.map((c) => {
    const t = c.project_type === 'Thermal' ? thermalTariff.get(c.id, financialYear) : tariff.get(c.id, financialYear);
    const latest = basis.filter((b) => b.contract_id === c.id).sort((a, b) => b.billing_month.localeCompare(a.billing_month))[0];
    const napaf = Number(t?.napaf_percent || c.napaf_percent) || null;
    const pafm = latest ? round(latest.c1_pafm_pct) : null;
    return {
      id: c.id,
      contract_no: c.contract_no,
      station_name: c.seller_name || c.contract_no,
      project_type: c.project_type,
      capacity_mw: c.capacity_mw,
      annual_afc: Number(t?.annual_afc) || c.annual_afc,
      afc_source: t?.annual_afc ? `Tariff ${financialYear}` : 'Contract',
      annual_design_energy_mwh: c.annual_design_energy_mwh,
      napaf_percent: napaf,
      pafm_achieved: pafm,
      pafm_month: latest?.billing_month || null,
      pafm_below_napaf: pafm != null && napaf != null ? pafm < napaf : null,
      status: 'OPERATIONAL',
      monthly_afc: Math.round((Number(t?.annual_afc) || c.annual_afc || 0) / 12),
      free_energy_home_state: c.free_energy_home_state ?? null,
      // The state that takes the free energy, off the allocation's home-state row.
      home_state: db.prepare(`
        SELECT COALESCE(parent_state, beneficiary_name) AS s FROM hydro_beneficiary_allocations
        WHERE contract_id = ? AND is_home_state = 1 AND is_active = 1 ORDER BY effective_from DESC LIMIT 1
      `).get(c.id)?.s || null,
      code: stationCode(c),
      ...readiness(c),
    };
  });

  // What the ledger charged, and what was paid against it, per bill.
  const charged = db.prepare(`
    SELECT b.contract_id, b.billing_month, d.beneficiary_name,
      SUM(CASE WHEN d.doc_type = 'PB' THEN d.amount WHEN d.mode = 'CREDIT_NOTE' THEN -d.amount ELSE 0 END) AS billed
    FROM hydro_ledger_docs d JOIN hydro_station_bills b ON b.id = d.bill_id
    WHERE b.contract_id IN ${inIds} AND d.status <> 'REVERSED'
    GROUP BY b.contract_id, b.billing_month, d.beneficiary_name
  `).all(...ids);
  const paid = db.prepare(`
    SELECT b.contract_id, b.billing_month, deb.beneficiary_name, SUM(cl.amount) AS collected
    FROM hydro_ledger_clearings cl
    JOIN hydro_ledger_docs deb ON deb.id = cl.debit_doc_id
    JOIN hydro_ledger_docs cre ON cre.id = cl.credit_doc_id
    JOIN hydro_station_bills b ON b.id = deb.bill_id
    WHERE b.contract_id IN ${inIds} AND deb.status <> 'REVERSED' AND cre.status <> 'REVERSED'
      AND COALESCE(cre.mode, '') NOT IN (${NOT_CASH.map(() => '?').join(',')})
    GROUP BY b.contract_id, b.billing_month, deb.beneficiary_name
  `).all(...ids, ...NOT_CASH);
  const sum = (rows, field, fn) => rows.filter(fn).reduce((a, r) => a + (Number(r[field]) || 0), 0);

  // Each station's latest billed month, and what is past due on its account.
  const pastDue = db.prepare(`
    SELECT d.contract_id, SUM(d.amount - COALESCE((SELECT SUM(amount) FROM hydro_ledger_clearings WHERE debit_doc_id = d.id), 0)) AS due
    FROM hydro_ledger_docs d
    WHERE d.contract_id IN ${inIds} AND d.doc_type = 'PB' AND d.status = 'OPEN' AND d.due_date < ?
    GROUP BY d.contract_id
  `).all(...ids, today);
  for (const st of stations) {
    const billedMonths = charged.filter((r) => r.contract_id === st.id && Number(r.billed) > 0.5).map((r) => r.billing_month).sort();
    const m = billedMonths[billedMonths.length - 1] || null;
    const b = m ? basisOf(st.id, m) : null;
    st.latest_month = m;
    st.latest_billed_cr = m ? cr(sum(charged, 'billed', (r) => r.contract_id === st.id && r.billing_month === m)) : 0;
    st.latest_collected_cr = m ? cr(sum(paid, 'collected', (r) => r.contract_id === st.id && r.billing_month === m)) : 0;
    st.latest_scheduled_mu = b ? round((Number(b.e1_ex_bus_scheduled_kwh) || 0) / 1e6, 1) : 0;
    st.overdue_cr = cr(Math.max(0, Number(pastDue.find((r) => r.contract_id === st.id)?.due) || 0));
  }

  const monthlyBillingTrend = months.map((m) => {
    const row = {
      billing_period: monthLabel(m),
      month_key: m,
      capacity_charges: cr(stations.reduce((a, s) => a + (Number(basisOf(s.id, m)?.c5_total_capacity_charge) || 0), 0)),
      energy_charges: cr(stations.reduce((a, s) => {
        const b = basisOf(s.id, m);
        return a + (Number(b?.ee1_energy_charge) || 0) + (Number(b?.ee2_excess_energy_charge) || 0);
      }, 0)),
      total_billed: cr(sum(charged, 'billed', (r) => r.billing_month === m)),
      collected_amount: cr(sum(paid, 'collected', (r) => r.billing_month === m)),
    };
    for (const s of stations) row[`${s.code}_billed`] = cr(sum(charged, 'billed', (r) => r.billing_month === m && r.contract_id === s.id));
    return row;
  });

  const pafmTrend = months.map((m) => {
    const row = { period: monthLabel(m), target: stations[0]?.napaf_percent ?? null };
    for (const s of stations) row[s.code] = round(basisOf(s.id, m)?.c1_pafm_pct ?? null);
    return row;
  });

  const energyScheduledTrend = months.map((m) => {
    const bills = stations.map((s) => basisOf(s.id, m)).filter(Boolean);
    const mu = (fn) => round(bills.reduce((a, b) => a + fn(b), 0), 1);
    return {
      period: monthLabel(m),
      design_energy: mu((b) => (Number(b.a9_days_in_year) ? (Number(b.a5_ex_bus_design_energy_mwh) * Number(b.a8_days_in_month)) / Number(b.a9_days_in_year) / 1000 : 0)),
      scheduled_energy: mu((b) => (Number(b.e1_ex_bus_scheduled_kwh) || 0) / 1e6),
      free_power: mu((b) => (Number(b.e2_free_power_kwh) || 0) / 1e6),
      billed: bills.length > 0,
    };
  });

  // Thermal months: plant load factor, energy charge rate and the fuel it was
  // worked on, weighted by energy across the stations billed that month.
  const thermalStations = stations.filter((s) => s.project_type === 'Thermal');
  const thermalTrend = thermalStations.length ? months.map((m) => {
    let exBus = 0; let gross = 0; let capHours = 0; let energyCharge = 0; let gcvW = 0; let coalW = 0; let fuelKwh = 0;
    for (const s of thermalStations) {
      const b = basisOf(s.id, m);
      if (!b) continue;
      let inp = {};
      try { inp = JSON.parse(b.thermal_inputs_json || '{}'); } catch { inp = {}; }
      const aux = Number(inp.tariff?.aux_pct ?? b.a3_aux_pct) || 0;
      const e1 = Number(b.e1_ex_bus_scheduled_kwh) || 0;
      exBus += e1;
      gross += aux < 100 ? e1 / (1 - aux / 100) : 0;
      capHours += (Number(s.capacity_mw) || 0) * 1000 * 24 * (Number(b.a8_days_in_month) || 0);
      energyCharge += (Number(b.ee1_energy_charge) || 0) + (Number(b.ee2_excess_energy_charge) || 0);
      if (inp.fuel?.gcv_kcal_per_kg) {
        gcvW += inp.fuel.gcv_kcal_per_kg * e1; coalW += (inp.fuel.coal_rs_per_tonne || 0) * e1; fuelKwh += e1;
      }
    }
    return {
      period: monthLabel(m),
      month_key: m,
      billed: exBus > 0,
      plf: capHours > 0 && exBus > 0 ? round((gross / capHours) * 100) : null,
      ecr: exBus > 0 ? round(energyCharge / exBus, 4) : null,
      gcv: fuelKwh > 0 ? round(gcvW / fuelKwh, 0) : null,
      coal_rs_per_tonne: fuelKwh > 0 ? round(coalW / fuelKwh, 0) : null,
      scheduled_mu: round(exBus / 1e6, 1),
      gross_kwh: gross,
      capacity_kwh: capHours,
    };
  }) : [];

  // Beneficiaries: their share of the stations' capacity, and their account.
  const allocations = db.prepare(`
    SELECT contract_id, beneficiary_name, parent_state, pct_incl_free, pct_rea FROM hydro_beneficiary_allocations
    WHERE contract_id IN ${inIds} AND is_active = 1
      AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?)
  `).all(...ids, today, today);
  const overdue = new Set(db.prepare(`
    SELECT DISTINCT d.beneficiary_name FROM hydro_ledger_docs d
    WHERE d.contract_id IN ${inIds} AND d.doc_type = 'PB' AND d.status = 'OPEN' AND d.due_date < ?
      AND d.amount - COALESCE((SELECT SUM(amount) FROM hydro_ledger_clearings WHERE debit_doc_id = d.id), 0) > 0.5
  `).all(...ids, today).map((r) => r.beneficiary_name));
  const capacityOf = Object.fromEntries(stations.map((s) => [s.id, Number(s.capacity_mw) || 0]));
  const totalMw = stations.reduce((a, s) => a + (Number(s.capacity_mw) || 0), 0);
  const byName = new Map();
  for (const a of allocations) {
    const cur = byName.get(a.beneficiary_name) || { name: a.beneficiary_name, state: a.parent_state || '', mw: 0 };
    // A thermal allocation has no free-power column; its REA share is the whole share.
    cur.mw += ((Number(a.pct_incl_free ?? a.pct_rea) || 0) / 100) * capacityOf[a.contract_id];
    byName.set(a.beneficiary_name, cur);
  }
  const ranked = [...byName.values()].map((b) => {
    const billed = sum(charged, 'billed', (r) => r.beneficiary_name === b.name);
    const collected = sum(paid, 'collected', (r) => r.beneficiary_name === b.name);
    let status = 'Not billed';
    if (overdue.has(b.name)) status = 'Overdue';
    else if (billed > 0.5 && billed - collected <= 0.5) status = 'Settled';
    else if (billed > 0.5) status = 'Current';
    return {
      name: b.name, state: b.state,
      share_pct: totalMw ? round((b.mw / totalMw) * 100) : 0,
      mw_share: round(b.mw, 1),
      billed_cr: cr(billed), collected_cr: cr(collected), status,
    };
  }).sort((a, b) => b.mw_share - a.mw_share);
  // Ten slices read; the rest are summed into one so every MW is still on the chart.
  const top = ranked.slice(0, 9);
  const rest = ranked.slice(9);
  if (rest.length) {
    top.push({
      name: `Others (${rest.length})`, state: '',
      share_pct: round(rest.reduce((a, b) => a + b.share_pct, 0)),
      mw_share: round(rest.reduce((a, b) => a + b.mw_share, 0), 1),
      billed_cr: round(rest.reduce((a, b) => a + b.billed_cr, 0)),
      collected_cr: round(rest.reduce((a, b) => a + b.collected_cr, 0)),
      status: rest.some((b) => b.status === 'Overdue') ? 'Overdue' : 'Current',
    });
  }
  const beneficiaryBreakup = top.map((b, i) => ({ ...b, color: PALETTE[i % PALETTE.length] }));

  // Where the bills stand. Cancelled bills are not in the pipeline.
  const live = db.prepare(`
    SELECT status, approval_status, dispatched_at FROM hydro_station_bills
    WHERE contract_id IN ${inIds} AND status <> 'CANCELLED'
  `).all(...ids);
  const pipeline = {
    draft: live.filter((b) => b.status === 'DRAFT' && b.approval_status !== 'IN_APPROVAL').length,
    in_approval: live.filter((b) => b.approval_status === 'IN_APPROVAL').length,
    approved: live.filter((b) => b.approval_status === 'APPROVED' && b.status !== 'ISSUED').length,
    issued: live.filter((b) => b.status === 'ISSUED' && !b.dispatched_at).length,
    dispatched: live.filter((b) => b.status === 'ISSUED' && b.dispatched_at).length,
  };

  const recentBills = db.prepare(`
    SELECT * FROM hydro_station_bills WHERE contract_id IN ${inIds} AND status <> 'CANCELLED'
    ORDER BY billing_month DESC, created_at DESC LIMIT 6
  `).all(...ids).map((b) => ({
    id: b.id, bill_no: b.bill_no, station_name: b.station_name, billing_month: b.billing_month,
    bill_kind: b.bill_kind, status: b.status, approval_status: b.approval_status,
    capacity_charge: b.c5_total_capacity_charge,
    energy_charge: (Number(b.ee1_energy_charge) || 0) + (Number(b.ee2_excess_energy_charge) || 0),
    total_charges: b.total_charges, created_at: b.created_at,
  }));

  const billedCr = round(monthlyBillingTrend.reduce((a, m) => a + m.total_billed, 0));
  const collectedCr = round(monthlyBillingTrend.reduce((a, m) => a + m.collected_amount, 0));
  const pafms = stations.map((s) => s.pafm_achieved).filter((v) => v != null);
  const mwOf = (fn) => stations.filter(fn).reduce((a, s) => a + (Number(s.capacity_mw) || 0), 0);

  return {
    as_of: today,
    financial_year: financialYear,
    kpis: {
      totalCapacityMw: totalMw,
      operationalHydroMw: mwOf((s) => s.project_type !== 'Thermal'),
      thermalCommissioningMw: mwOf((s) => s.project_type === 'Thermal'),
      annualAfcCr: cr(stations.reduce((a, s) => a + (Number(s.annual_afc) || 0), 0)),
      cumulativeBilledCr: billedCr,
      cumulativeCollectedCr: collectedCr,
      realizationPct: billedCr > 0 ? round((collectedCr / billedCr) * 100, 1) : null,
      avgPafmPct: pafms.length ? round(pafms.reduce((a, v) => a + v, 0) / pafms.length, 1) : null,
      // The year's PLF is the year's energy over the year's capacity-hours, not
      // an average of monthly PLFs; it read 83.0 where Generation Performance
      // read 83.02 (Thermal QA run 10).
      plfYtdPct: (() => {
        const billed = thermalTrend.filter((m) => m.plf != null);
        const cap = billed.reduce((a, m) => a + m.capacity_kwh, 0);
        return cap > 0 ? round((billed.reduce((a, m) => a + m.gross_kwh, 0) / cap) * 100) : null;
      })(),
      avgEcr: (() => {
        const billed = thermalTrend.filter((m) => m.ecr != null);
        const e = billed.reduce((a, m) => a + m.scheduled_mu, 0);
        return e > 0 ? round(billed.reduce((a, m) => a + m.ecr * m.scheduled_mu, 0) / e, 4) : null;
      })(),
      overdueCr: round(stations.reduce((a, s) => a + (s.overdue_cr || 0), 0)),
      cumulativeEnergyMu: round(energyScheduledTrend.reduce((a, m) => a + m.scheduled_energy, 0), 1),
      activeStationsCount: stations.length,
      beneficiariesCount: byName.size,
      pendingApprovalsCount: pipeline.in_approval,
    },
    stations,
    monthlyBillingTrend,
    pafmTrend,
    energyScheduledTrend,
    thermalTrend,
    beneficiaryBreakup,
    pipeline,
    recentBills,
  };
}
