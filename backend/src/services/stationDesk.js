/**
 * The desk-wide views the REIA desk has and the station desks did not: closing
 * a month, one approvals queue, the advances sitting unapplied, and how each
 * station performed against its tariff norms.
 *
 * Nothing here holds data of its own. Every figure is read off the station
 * bills, the beneficiary ledger, the notes, disputes and FI postings, so these
 * screens cannot drift from the screens that do the work.
 */
import db from '../db/index.js';
import { openCredits, openDebits, receivablesAgeing } from './hydroLedger.js';
import { getParamNumber } from '../mastersService.js';
import { bookableBills, bookableNotes } from './hydroFiPosting.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const fail = (status, message) => Object.assign(new Error(message), { status });

const TYPES = { HYDRO: ['Hydro', 'PSP'], THERMAL: ['Thermal'] };

/** Today on India's calendar, as YYYY-MM-DD. */
function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** The latest month that has ended — the one a desk is closing. */
export function lastClosedMonth(today = istToday()) {
  const [y, m] = today.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function normalizeVertical(v) {
  return v === 'THERMAL' ? 'THERMAL' : 'HYDRO';
}

/** The station contracts of a vertical. */
export function stationsOf(vertical) {
  const types = TYPES[normalizeVertical(vertical)];
  return db.prepare(`
    SELECT c.id, c.contract_no, c.project_type, c.capacity_mw, c.napaf_percent,
           c.annual_design_energy_mwh, c.annual_afc, COALESCE(e.name, c.contract_no) AS station_name
    FROM contracts c LEFT JOIN entities e ON e.id = c.seller_id
    WHERE c.contract_type = 'PPA' AND c.project_type IN (${types.map(() => '?').join(',')})
    ORDER BY c.contract_no
  `).all(...types);
}

/**
 * The bill that stands for a station's month: the final one once it is out,
 * otherwise the provisional. Revisions, arrears and claims ride on top of it.
 */
function mainBill(contractId, month) {
  return db.prepare(`
    SELECT * FROM hydro_station_bills
    WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED'
      AND bill_kind IN ('FINAL','PROVISIONAL')
    ORDER BY CASE bill_kind WHEN 'FINAL' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `).get(contractId, month);
}

// ─────────────────────────────────────────────────────────────────────────────
// Month-close board
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = {
  NOT_BILLED: { label: 'Not billed', tone: 'warning', next: 'Fetch the REA and draft the month\'s bill' },
  DRAFT: { label: 'Draft', tone: 'warning', next: 'Check the draft and send it for approval' },
  IN_APPROVAL: { label: 'In approval', tone: 'primary', next: 'Waiting on the approver' },
  REJECTED: { label: 'Rejected', tone: 'danger', next: 'Correct the bill and send it again' },
  APPROVED: { label: 'Approved', tone: 'primary', next: 'Issue the bill to the beneficiaries' },
  ISSUED: { label: 'Issued', tone: 'primary', next: 'Despatch the bill and record the courier details' },
  DESPATCHED: { label: 'Despatched', tone: 'primary', next: 'Book the month to Finance' },
  BOOKED: { label: 'Booked to Finance', tone: 'success', next: null },
};

function stageOf(bill, fiPosted) {
  if (!bill) return 'NOT_BILLED';
  if (bill.status === 'DRAFT') {
    if (bill.approval_status === 'IN_APPROVAL') return 'IN_APPROVAL';
    if (bill.approval_status === 'REJECTED') return 'REJECTED';
    if (bill.approval_status === 'APPROVED') return 'APPROVED';
    return 'DRAFT';
  }
  if (fiPosted) return 'BOOKED';
  if (bill.dispatched_at || bill.dispatch_date) return 'DESPATCHED';
  return 'ISSUED';
}

/**
 * Everything of a station's month still to be handed to Finance: issued bills
 * of every category and approved notes not on a live posting. Looking at the
 * month's main bill alone let a supplementary issued after the month was
 * booked pass the close unbooked (Thermal QA run 4).
 */
function fiPending(contractId, month) {
  const refs = [];
  for (const category of ['HYDRO', 'ADDITIONAL', 'TCS']) {
    try { refs.push(...bookableBills(contractId, month, category).map((b) => b.bill_no)); } catch { /* no such category here */ }
  }
  try { refs.push(...bookableNotes(contractId, month).map((n) => n.note_no)); } catch { /* notes not booked on this database */ }
  return refs;
}

function fiPostingFor(contractId, month, category = 'HYDRO') {
  return db.prepare(`
    SELECT posting_no, status, total_amount FROM hydro_fi_postings
    WHERE contract_id = ? AND period_month = ? AND bill_category = ? AND status <> 'REVERSED'
    ORDER BY created_at DESC LIMIT 1
  `).get(contractId, month, category);
}

export function monthCloseBoard(vertical, period) {
  const v = normalizeVertical(vertical);
  const month = period || lastClosedMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, 'period must be a month, YYYY-MM');
  const stations = stationsOf(v);
  const ids = stations.map((s) => s.id);
  const inList = ids.map(() => '?').join(',') || "''";

  const rows = stations.map((s) => {
    const bill = mainBill(s.id, month);
    const fi = fiPostingFor(s.id, month);
    const pending = fiPending(s.id, month);
    const stage = stageOf(bill, fi?.status === 'POSTED' && !pending.length);
    const others = db.prepare(`
      SELECT bill_no, bill_kind, status, approval_status, total_charges, differential_amount
      FROM hydro_station_bills
      WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED'
        AND bill_kind NOT IN ('FINAL','PROVISIONAL')
      ORDER BY created_at
    `).all(s.id, month);
    return {
      contract_id: s.id,
      contract_no: s.contract_no,
      station_name: s.station_name,
      energy: bill ? {
        in: true,
        rea_reference: bill.rea_reference,
        saleable_kwh: bill.e3_saleable_scheduled_kwh,
        pafm_pct: bill.c1_pafm_pct,
      } : { in: false },
      bill: bill ? {
        id: bill.id, bill_no: bill.bill_no, bill_kind: bill.bill_kind, status: bill.status,
        approval_status: bill.approval_status, total: bill.total_charges, due_date: bill.due_date,
        dispatched: !!(bill.dispatched_at || bill.dispatch_date),
      } : null,
      other_bills: others,
      fi: fi || null,
      fi_pending: pending,
      stage,
      stage_label: STAGES[stage].label,
      tone: STAGES[stage].tone,
      next_step: STAGES[stage].next,
    };
  });

  // What is still open for the desk before Finance books the month.
  const count = (sql, ...args) => db.prepare(sql).get(...args);
  const items = [];

  const unissued = db.prepare(`
    SELECT bill_no, bill_kind, total_charges FROM hydro_station_bills
    WHERE contract_id IN (${inList}) AND billing_month = ? AND status = 'DRAFT'
    ORDER BY bill_no
  `).all(...ids, month);
  items.push({
    key: 'unissued', label: 'Bills for the month not yet issued', count: unissued.length,
    amount: money(unissued.reduce((x, b) => x + (b.total_charges || 0), 0)),
    refs: unissued.map((b) => b.bill_no), link: 'billing',
  });

  const notDespatched = db.prepare(`
    SELECT bill_no FROM hydro_station_bills
    WHERE contract_id IN (${inList}) AND billing_month = ? AND status = 'ISSUED'
      AND dispatched_at IS NULL AND dispatch_date IS NULL
  `).all(...ids, month);
  items.push({
    key: 'despatch', label: 'Issued bills without despatch details', count: notDespatched.length,
    refs: notDespatched.map((b) => b.bill_no), link: 'billing',
    hint: 'The receipt date is what a disputed due date is argued from',
  });

  const notes = db.prepare(`
    SELECT note_no, amount FROM hydro_notes WHERE contract_id IN (${inList}) AND status = 'DRAFT'
  `).all(...ids);
  items.push({
    key: 'notes', label: 'Debit / credit notes awaiting approval', count: notes.length,
    amount: money(notes.reduce((x, n) => x + n.amount, 0)), refs: notes.map((n) => n.note_no), link: 'approvals',
  });

  const unbooked = rows.flatMap((r) => r.fi_pending);
  items.push({
    key: 'fi', label: 'Issued bills and approved notes not yet booked to Finance', count: unbooked.length,
    refs: unbooked, link: 'finance',
  });

  const disputes = db.prepare(`
    SELECT dispute_no, disputed_amount FROM hydro_disputes
    WHERE contract_id IN (${inList}) AND status NOT IN ('RESOLVED_ACCEPTED','RESOLVED_REJECTED','CLOSED')
  `).all(...ids);
  items.push({
    key: 'disputes', label: 'Disputes still open', count: disputes.length,
    amount: money(disputes.reduce((x, d) => x + (d.disputed_amount || 0), 0)),
    refs: disputes.map((d) => d.dispute_no), link: 'disputes',
    hint: 'Disclose them to Finance as contingent; they need not hold the close',
  });

  const recons = count(`
    SELECT COUNT(*) AS n FROM hydro_reconciliations
    WHERE contract_id IN (${inList}) AND status IN ('SENT','DISPUTED')
  `, ...ids).n;
  items.push({ key: 'recon', label: 'Balance confirmations awaiting the beneficiary', count: recons, refs: [], link: 'reconciliation' });

  let advance = 0; let lps = 0;
  for (const s of stations) {
    try {
      const a = receivablesAgeing(s.id);
      advance += a.totals.advance; lps += a.totals.lps_accrued_not_charged;
    } catch { /* a station with no ledger yet */ }
  }
  items.push({ key: 'advances', label: 'Receipts sitting unapplied (advances)', count: advance > 0.005 ? 1 : 0, amount: money(advance), refs: [], link: 'advances' });
  items.push({ key: 'lps', label: 'Late payment surcharge accrued, not yet charged', count: lps > 0.005 ? 1 : 0, amount: money(lps), refs: [], link: 'ledger' });

  // Disputes and confirmations are disclosed, not blockers, so they do not
  // count against a clean close.
  const blocking = ['unissued', 'despatch', 'notes', 'fi'];
  const open = items.filter((i) => blocking.includes(i.key) && i.count > 0).length;

  const tally = (st) => rows.filter((r) => r.stage === st).length;
  return {
    vertical: v,
    period: month,
    last_closed_month: lastClosedMonth(),
    month_open: month > lastClosedMonth(),
    totals: {
      stations: rows.length,
      not_billed: tally('NOT_BILLED'),
      in_progress: rows.filter((r) => ['DRAFT', 'IN_APPROVAL', 'REJECTED', 'APPROVED'].includes(r.stage)).length,
      issued: rows.filter((r) => ['ISSUED', 'DESPATCHED'].includes(r.stage)).length,
      booked: tally('BOOKED'),
      billed_amount: money(rows.reduce((x, r) => x + (r.bill?.total || 0), 0)),
    },
    rows,
    checklist: { items: items.map((i) => ({ ...i, clear: i.count === 0, blocking: blocking.includes(i.key) })), open_items: open, clear: open === 0 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Approvals queue
// ─────────────────────────────────────────────────────────────────────────────

const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(`${String(iso).replace(' ', 'T')}Z`).getTime()) / 86400000)) : null);

export function approvalsQueue(vertical, user) {
  const ids = stationsOf(vertical).map((s) => s.id);
  if (!ids.length) return { bills: [], notes: [], postings: [], invoices: [], totals: { bills: 0, mine: 0, notes: 0, postings: 0, invoices: 0 } };
  const inList = ids.map(() => '?').join(',');

  const bills = db.prepare(`
    SELECT b.id, b.bill_no, b.station_name, b.billing_month, b.bill_kind, b.total_charges,
           b.differential_amount, b.prepared_by, b.final_approver_name,
           a.level, a.is_final, a.approver_user_id, a.approver_name, a.created_at AS waiting_since
    FROM hydro_bill_approvals a
    JOIN hydro_station_bills b ON b.id = a.bill_id
    WHERE a.status = 'PENDING' AND b.status <> 'CANCELLED' AND b.contract_id IN (${inList})
    ORDER BY a.created_at
  `).all(...ids).map((b) => ({
    ...b,
    is_mine: !!user?.id && b.approver_user_id === user.id,
    age_days: daysSince(b.waiting_since),
  }));

  const notes = db.prepare(`
    SELECT n.id, n.note_no, n.note_type, n.beneficiary_name, n.amount, n.reason, n.remarks,
           n.note_date, n.created_by, n.created_by_name, n.created_at, d.doc_no AS against_doc_no,
           COALESCE(e.name, c.contract_no) AS station_name
    FROM hydro_notes n
    JOIN contracts c ON c.id = n.contract_id
    LEFT JOIN entities e ON e.id = c.seller_id
    LEFT JOIN hydro_ledger_docs d ON d.id = n.against_doc_id
    WHERE n.status = 'DRAFT' AND n.contract_id IN (${inList})
    ORDER BY n.created_at
  `).all(...ids).map((n) => ({
    ...n,
    own: !!user?.id && n.created_by === user.id,
    age_days: daysSince(n.created_at),
  }));

  const postings = db.prepare(`
    SELECT id, posting_no, station_name, period_month, bill_category, bills_count, total_amount, created_at
    FROM hydro_fi_postings WHERE status = 'PREPARED' AND contract_id IN (${inList})
    ORDER BY created_at
  `).all(...ids).map((p) => ({ ...p, age_days: daysSince(p.created_at) }));

  // The station's own invoices on the REIA approval chain — a thermal DSM pool
  // bill waited there unseen by the Thermal desk (Thermal QA run 5).
  const invoices = db.prepare(`
    SELECT i.id, i.invoice_no, i.status, i.total_amount, i.direction, i.billing_period, i.created_by, i.created_by_id, i.created_at,
           (SELECT MIN(level) FROM invoice_approvals WHERE invoice_id = i.id AND status = 'PENDING') AS next_level
    FROM invoices i
    WHERE i.contract_id IN (${inList}) AND i.status IN ('DRAFT','SUBMITTED','UNDER_APPROVAL','REJECTED')
    ORDER BY i.created_at
  `).all(...ids).map((i) => ({
    ...i,
    own: !!user?.id && i.created_by_id === user.id,
    to_submit: ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(i.status),
    age_days: daysSince(i.created_at),
  }));

  return {
    bills, notes, postings, invoices,
    totals: { bills: bills.length, mine: bills.filter((b) => b.is_mine).length, notes: notes.length, postings: postings.length, invoices: invoices.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Advances and unapplied receipts
// ─────────────────────────────────────────────────────────────────────────────

export function advancesRegister(vertical, { asOf = istToday() } = {}) {
  const today = new Date(`${asOf}T00:00:00Z`);
  const rows = [];
  for (const s of stationsOf(vertical)) {
    const names = db.prepare('SELECT DISTINCT beneficiary_name FROM hydro_ledger_docs WHERE contract_id = ?')
      .all(s.id).map((r) => r.beneficiary_name);
    for (const name of names) {
      const credits = openCredits(s.id, name);
      if (!credits.length) continue;
      const debits = openDebits(s.id, name);
      const openDebit = money(debits.reduce((x, d) => x + d.outstanding, 0));
      for (const c of credits) {
        rows.push({
          doc_id: c.id,
          doc_no: c.doc_no,
          contract_id: s.id,
          station_name: s.station_name,
          beneficiary_name: name,
          doc_date: c.doc_date,
          mode: c.mode,
          reference: c.reference,
          amount: c.amount,
          unapplied: money(c.unapplied),
          age_days: Math.max(0, Math.floor((today - new Date(c.doc_date)) / 86400000)),
          open_debits: openDebit,
          open_debit_count: debits.length,
          // Money with bills still open beside it should have been applied:
          // that is the desk's to clear, not an advance the beneficiary meant.
          can_apply: debits.length > 0,
        });
      }
    }
  }
  rows.sort((a, b) => b.age_days - a.age_days);
  const sum = (list) => money(list.reduce((x, r) => x + r.unapplied, 0));
  const applicable = rows.filter((r) => r.can_apply);
  return {
    as_of: asOf,
    rows,
    totals: {
      receipts: rows.length,
      unapplied: sum(rows),
      applicable: sum(applicable),
      applicable_count: applicable.length,
      over_30_days: sum(rows.filter((r) => r.age_days > 30)),
      beneficiaries: new Set(rows.map((r) => `${r.contract_id}|${r.beneficiary_name}`)).size,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation performance
// ─────────────────────────────────────────────────────────────────────────────

/** "2026-2027" for any month from April 2026 to March 2027. */
export function financialYearOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${start + 1}`;
}

function fyMonths(fy) {
  const m = /^(\d{4})-(\d{4})$/.exec(String(fy));
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw fail(400, 'fy must be one April-to-March year, like 2026-2027');
  const start = Number(m[1]);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(start, 3 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

/**
 * Each station's year month by month: availability against NAPAF — which is
 * what decides how much of the capacity charge it recovers — and saleable
 * energy against the design energy the energy charge rate was set on.
 */
/**
 * A thermal month off its bill: plant load factor on the energy scheduled, and
 * the norms and fuel the energy charge rate was worked on. The platform holds
 * the normative heat rate and auxiliary consumption, not the plant's actuals,
 * so gross generation is the ex-bus energy grossed up by the normative aux.
 */
function thermalMonth(b, capacityMw) {
  let inputs = {};
  try { inputs = JSON.parse(b.thermal_inputs_json || '{}'); } catch { inputs = {}; }
  const t = inputs.tariff || {};
  const f = inputs.fuel || {};
  const aux = Number(t.aux_pct ?? b.a3_aux_pct) || 0;
  const cap = Number(capacityMw || b.a7_installed_capacity_mw) || 0;
  const hours = 24 * b.a8_days_in_month;
  const grossKwh = aux < 100 ? b.e1_ex_bus_scheduled_kwh / (1 - aux / 100) : 0;
  const plf = cap > 0 ? (grossKwh / (cap * 1000 * hours)) * 100 : null;
  const sfc = Number(t.sfc_ml_per_kwh) || 0;
  const cvsf = Number(t.cv_secondary_kcal_per_ml) || 0;
  // Coal burnt per unit sent out, on the norms: (GHR − SFC × CVSF) / CVPF,
  // grossed up for auxiliary consumption.
  const coalKgPerKwh = f.cvpf_kcal_per_kg > 0 && t.gross_heat_rate
    ? ((t.gross_heat_rate - sfc * cvsf) / f.cvpf_kcal_per_kg) * (100 / (100 - aux))
    : null;
  return {
    plf_pct: plf == null ? null : money(plf),
    gross_kwh: money(grossKwh),
    norm_ghr: t.gross_heat_rate ?? null,
    norm_aux_pct: t.aux_pct ?? b.a3_aux_pct,
    norm_sfc_ml_per_kwh: t.sfc_ml_per_kwh ?? null,
    gcv_received: f.gcv_kcal_per_kg ?? null,
    cvpf: f.cvpf_kcal_per_kg ?? null,
    coal_rs_per_tonne: f.coal_rs_per_tonne ?? null,
    oil_rs_per_kl: f.oil_rs_per_kl ?? null,
    coal_kg_per_kwh: coalKgPerKwh == null ? null : Math.round(coalKgPerKwh * 10000) / 10000,
    coal_tonnes: coalKgPerKwh == null ? null : money((coalKgPerKwh * b.e1_ex_bus_scheduled_kwh) / 1000),
    tariff_order: t.order_ref || null,
  };
}

/**
 * The bill a month's performance stands on: the latest issued energy bill,
 * revisions included, else the month's main bill. A revised month showed the
 * provisional's superseded PAFM and charges (Thermal QA run 10).
 */
function standingBill(contractId, month) {
  return db.prepare(`
    SELECT * FROM hydro_station_bills
    WHERE contract_id = ? AND billing_month = ? AND status = 'ISSUED'
      AND bill_kind IN ('PROVISIONAL','FINAL','REVISION')
    ORDER BY COALESCE(issued_at, '') DESC, created_at DESC LIMIT 1
  `).get(contractId, month) || mainBill(contractId, month);
}

export function generationPerformance(vertical, fy) {
  const year = fy || financialYearOfMonth(lastClosedMonth());
  const months = fyMonths(year);
  const thermal = normalizeVertical(vertical) === 'THERMAL';
  // CERC pays a thermal station an incentive on energy scheduled beyond this
  // plant load factor (85% under the 2024-29 tariff regulations).
  const plfNorm = getParamNumber('thermal_plf_incentive_norm_pct', 85);
  const stations = stationsOf(vertical).map((s) => {
    let cumSaleable = 0; let cumDesign = 0; let dayWeightedPaf = 0; let days = 0;
    let capacityRecovered = 0; let capacityFull = 0;
    let annualSaleableDesignKwh = null;
    const rows = months.map((month) => {
      const b = standingBill(s.id, month);
      if (!b) return { month, billed: false };
      // What the month's capacity charge would have been at NAPAF. The charge
      // is recovered in proportion to PAFM/NAPAF, so a month below the norm
      // scales back up by that ratio; at or above it nothing was lost.
      const fullCapacity = b.c1_pafm_pct > 0 && b.c1_pafm_pct < b.a11_napaf_pct
        ? (b.c2_capacity_charge * b.a11_napaf_pct) / b.c1_pafm_pct
        : b.c2_capacity_charge;
      // Pro-rata on days: the station's month-wise design energy is not held,
      // so the year's saleable design energy is spread evenly.
      const designKwh = (b.a6_ex_bus_saleable_design_energy_mwh * 1000 * b.a8_days_in_month) / b.a9_days_in_year;
      annualSaleableDesignKwh = b.a6_ex_bus_saleable_design_energy_mwh * 1000;
      const saleable = b.e3_saleable_scheduled_kwh;
      cumSaleable += saleable; cumDesign += designKwh;
      dayWeightedPaf += b.c1_pafm_pct * b.a8_days_in_month; days += b.a8_days_in_month;
      capacityRecovered += b.c2_capacity_charge; capacityFull += fullCapacity;
      return {
        month,
        billed: true,
        bill_no: b.bill_no,
        bill_kind: b.bill_kind,
        pafm_pct: b.c1_pafm_pct,
        napaf_pct: b.a11_napaf_pct,
        below_napaf: b.c1_pafm_pct + 1e-9 < b.a11_napaf_pct,
        ex_bus_kwh: b.e1_ex_bus_scheduled_kwh,
        saleable_kwh: saleable,
        design_kwh: money(designKwh),
        energy_vs_design_pct: designKwh > 0 ? money((saleable / designKwh) * 100) : null,
        excess_kwh: b.e7_excess_kwh,
        capacity_charge: b.c2_capacity_charge,
        capacity_at_napaf: money(fullCapacity),
        capacity_shortfall: money(Math.max(0, fullCapacity - b.c2_capacity_charge)),
        energy_charge: money(b.ee1_energy_charge + b.ee2_excess_energy_charge),
        total_charges: b.total_charges,
        ecr: b.a12_ecr,
        ...(thermal ? thermalMonth(b, s.capacity_mw) : {}),
      };
    });
    const billed = rows.filter((r) => r.billed);
    const thermalSummary = thermal ? (() => {
      const gross = billed.reduce((x, r) => x + (r.gross_kwh || 0), 0);
      const hrs = billed.reduce((x, r) => x + (r.plf_pct != null ? 1 : 0), 0);
      const cap = Number(s.capacity_mw) || 0;
      const billedHours = months.filter((m) => rows.find((r) => r.month === m && r.billed && r.plf_pct != null))
        .reduce((x, m) => { const [yy, mm] = m.split('-').map(Number); return x + 24 * new Date(Date.UTC(yy, mm, 0)).getUTCDate(); }, 0);
      const exBus = billed.reduce((x, r) => x + (r.ex_bus_kwh || 0), 0);
      const energyCharge = billed.reduce((x, r) => x + (r.energy_charge || 0), 0);
      const withFuel = billed.filter((r) => r.gcv_received);
      return {
        plf_ytd_pct: cap > 0 && hrs ? money((gross / (cap * 1000 * billedHours)) * 100) : null,
        plf_norm_pct: plfNorm,
        months_above_plf_norm: billed.filter((r) => r.plf_pct != null && r.plf_pct > plfNorm).length,
        avg_ecr: exBus > 0 ? Math.round((energyCharge / exBus) * 10000) / 10000 : null,
        avg_gcv_received: withFuel.length ? money(withFuel.reduce((x, r) => x + r.gcv_received * r.ex_bus_kwh, 0) / withFuel.reduce((x, r) => x + r.ex_bus_kwh, 0)) : null,
        avg_coal_rs_per_tonne: withFuel.length ? money(withFuel.reduce((x, r) => x + (r.coal_rs_per_tonne || 0) * r.ex_bus_kwh, 0) / withFuel.reduce((x, r) => x + r.ex_bus_kwh, 0)) : null,
        coal_tonnes_ytd: money(billed.reduce((x, r) => x + (r.coal_tonnes || 0), 0)),
      };
    })() : null;
    return {
      thermal: thermalSummary,
      contract_id: s.id,
      contract_no: s.contract_no,
      station_name: s.station_name,
      capacity_mw: s.capacity_mw,
      // A thermal station's NAPAF is on the year's tariff, not the contract.
      napaf_pct: s.napaf_percent ?? ([...billed].reverse().find((r) => r.napaf_pct != null)?.napaf_pct ?? null),
      months: rows,
      summary: {
        months_billed: billed.length,
        months_below_napaf: billed.filter((r) => r.below_napaf).length,
        paf_ytd_pct: days ? money(dayWeightedPaf / days) : null,
        saleable_ytd_kwh: money(cumSaleable),
        design_ytd_kwh: money(cumDesign),
        energy_vs_design_ytd_pct: cumDesign > 0 ? money((cumSaleable / cumDesign) * 100) : null,
        annual_saleable_design_kwh: annualSaleableDesignKwh,
        annual_design_used_pct: annualSaleableDesignKwh ? money((cumSaleable / annualSaleableDesignKwh) * 100) : null,
        capacity_recovered: money(capacityRecovered),
        capacity_at_napaf: money(capacityFull),
        capacity_shortfall: money(Math.max(0, capacityFull - capacityRecovered)),
      },
    };
  });
  return { vertical: normalizeVertical(vertical), fy: year, months, stations, plf_norm_pct: thermal ? plfNorm : null };
}
