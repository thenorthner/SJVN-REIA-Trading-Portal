/**
 * The station desks' registers: each beneficiary's PPA beside the share it is
 * billed on, the regulatory desk (petitions, true-ups, fees, orders), and the
 * REA register — which REA each month was billed on, and whether the bill
 * still agrees with it.
 */
import db from '../db/index.js';
import { newId } from '../util.js';
import { openDebits, isStationBeneficiary, receivablesAgeing } from './hydroLedger.js';
import { getParamNumber } from '../mastersService.js';
import { stationsOf, normalizeVertical, financialYearOfMonth, lastClosedMonth, monthCloseBoard, approvalsQueue } from './stationDesk.js';
import { verticalOfContract } from './stationScope.js';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const fail = (status, message) => Object.assign(new Error(message), { status });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
const norm = (s) => String(s || '').trim().toUpperCase();

function dateOrNull(v, label) {
  if (v == null || v === '') return null;
  if (!ISO.test(String(v))) throw fail(400, `${label} must be a date (YYYY-MM-DD)`);
  return String(v);
}

function stationOfVertical(contractId, vertical) {
  const c = db.prepare('SELECT id, contract_no FROM contracts WHERE id = ?').get(contractId);
  if (!c) throw fail(404, 'Station not found');
  if (verticalOfContract(contractId) !== normalizeVertical(vertical)) {
    throw fail(400, `${c.contract_no} is not a ${normalizeVertical(vertical).toLowerCase()} station`);
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// Beneficiary PPAs & allocation
// ─────────────────────────────────────────────────────────────────────────────

/** A PPA running out within this many days is flagged for renewal. */
export const PPA_EXPIRY_WARNING_DAYS = 180;

function ppaStanding(ppa, today) {
  if (!ppa) return 'MISSING';
  if (ppa.status === 'TERMINATED') return 'TERMINATED';
  if (ppa.valid_to && ppa.valid_to < today) return 'EXPIRED';
  if (ppa.valid_from > today) return 'NOT_STARTED';
  if (ppa.valid_to && daysBetween(today, ppa.valid_to) <= PPA_EXPIRY_WARNING_DAYS) return 'EXPIRING';
  return 'ON_FILE';
}

export function ppaRegister(vertical, { asOf = istToday() } = {}) {
  const today = asOf;
  const stations = stationsOf(vertical).map((s) => {
    // The share each beneficiary is billed on now: the latest allocation row in force.
    const allocs = db.prepare(`
      SELECT beneficiary_name, beneficiary_id, parent_state, pct_rea, effective_from
      FROM hydro_beneficiary_allocations
      WHERE contract_id = ? AND is_active = 1 AND effective_from <= ?
      ORDER BY effective_from
    `).all(s.id, today);
    const yearAgo = new Date(`${today}T00:00:00Z`);
    yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
    const fromYearAgo = yearAgo.toISOString().slice(0, 10);

    const byName = new Map();
    for (const a of allocs) {
      const k = norm(a.beneficiary_name);
      const cur = byName.get(k) || { beneficiary_name: a.beneficiary_name, beneficiary_id: null, history: [] };
      cur.beneficiary_id = cur.beneficiary_id || a.beneficiary_id;
      cur.parent_state = a.parent_state;
      cur.latest = a;
      if (a.effective_from >= fromYearAgo) cur.history.push(a.pct_rea);
      byName.set(k, cur);
    }
    const ppas = db.prepare(`
      SELECT * FROM station_beneficiary_ppas WHERE contract_id = ?
      ORDER BY (status = 'ACTIVE') DESC, COALESCE(valid_to, '9999-12-31') DESC
    `).all(s.id);
    for (const p of ppas) {
      const k = norm(p.beneficiary_name);
      if (!byName.has(k)) byName.set(k, { beneficiary_name: p.beneficiary_name, beneficiary_id: p.beneficiary_id, history: [] });
    }
    const latestMonth = allocs.length ? allocs[allocs.length - 1].effective_from.slice(0, 7) : null;

    const rows = [...byName.values()].map((b) => {
      const own = ppas.filter((p) => norm(p.beneficiary_name) === norm(b.beneficiary_name));
      const current = own.find((p) => ['ON_FILE', 'EXPIRING'].includes(ppaStanding(p, today))) || own[0] || null;
      const standing = ppaStanding(current, today);
      const entityId = b.beneficiary_id || current?.beneficiary_id || null;
      // The REA names beneficiaries its own way, so an onboarded stakeholder
      // not yet linked on the allocation is found by its name or short code.
      const entity = entityId
        ? db.prepare('SELECT id, name, status FROM entities WHERE id = ?').get(entityId)
        : db.prepare(`
          SELECT id, name, status FROM entities
          WHERE (UPPER(TRIM(name)) = ? OR UPPER(TRIM(COALESCE(short_code, ''))) = ?) AND verticals LIKE ?
          LIMIT 1
        `).get(norm(b.beneficiary_name), norm(b.beneficiary_name), `%${normalizeVertical(vertical)}%`);

      const security = db.prepare(`
        SELECT COALESCE(SUM(amount - invoked_amount), 0) AS held, MIN(valid_to) AS soonest
        FROM hydro_security_instruments
        WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND status = 'ACTIVE' AND valid_to >= ?
      `).get(s.id, norm(b.beneficiary_name), today);
      const avgBilling = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) / 12.0 AS avg FROM hydro_ledger_docs
        WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND doc_type = 'PB' AND status = 'OPEN' AND doc_date >= ?
      `).get(s.id, norm(b.beneficiary_name), fromYearAgo).avg;
      const required = current?.lc_months_required ? money(current.lc_months_required * avgBilling) : null;
      let outstanding = 0;
      try { outstanding = money(openDebits(s.id, b.beneficiary_name).reduce((x, d) => x + d.outstanding, 0)); } catch { outstanding = 0; }

      const inForce = b.latest && b.latest.effective_from.slice(0, 7) === latestMonth;
      return {
        beneficiary_name: b.beneficiary_name,
        parent_state: b.parent_state || null,
        allocation_pct: inForce ? b.latest.pct_rea : null,
        allocation_month: inForce ? latestMonth : (b.latest?.effective_from?.slice(0, 7) || null),
        allocation_min_12m: b.history.length ? Math.min(...b.history) : null,
        allocation_max_12m: b.history.length ? Math.max(...b.history) : null,
        billed_now: !!inForce,
        ppa: current ? {
          id: current.id, ppa_ref: current.ppa_ref, signed_on: current.signed_on, valid_from: current.valid_from,
          valid_to: current.valid_to, contracted_share_pct: current.contracted_share_pct,
          lc_months_required: current.lc_months_required, tariff_basis: current.tariff_basis,
          status: current.status, remarks: current.remarks,
          days_to_expiry: current.valid_to ? daysBetween(today, current.valid_to) : null,
        } : null,
        ppa_count: own.length,
        ppa_standing: standing,
        entity: entity ? { id: entity.id, name: entity.name, status: entity.status } : null,
        security_held: money(security.held),
        security_soonest_expiry: security.soonest,
        security_required: required,
        security_short: required != null ? money(Math.max(0, required - security.held)) : null,
        outstanding,
      };
    }).sort((x, y) => (y.allocation_pct || 0) - (x.allocation_pct || 0));

    return { contract_id: s.id, contract_no: s.contract_no, station_name: s.station_name, allocation_month: latestMonth, rows };
  });

  const all = stations.flatMap((s) => s.rows);
  const billed = all.filter((r) => r.billed_now);
  return {
    as_of: today,
    expiry_warning_days: PPA_EXPIRY_WARNING_DAYS,
    stations,
    totals: {
      beneficiaries: billed.length,
      missing: billed.filter((r) => ['MISSING', 'EXPIRED', 'TERMINATED', 'NOT_STARTED'].includes(r.ppa_standing)).length,
      expiring: all.filter((r) => r.ppa_standing === 'EXPIRING').length,
      not_onboarded: billed.filter((r) => !r.entity).length,
      security_short: all.filter((r) => r.security_short > 0).length,
    },
  };
}

function ppaFields(body) {
  const out = {
    ppa_ref: String(body.ppa_ref || '').trim(),
    signed_on: dateOrNull(body.signed_on, 'Signed on'),
    valid_from: dateOrNull(body.valid_from, 'Valid from'),
    valid_to: dateOrNull(body.valid_to, 'Valid to'),
    contracted_share_pct: body.contracted_share_pct === '' || body.contracted_share_pct == null ? null : Number(body.contracted_share_pct),
    lc_months_required: body.lc_months_required === '' || body.lc_months_required == null ? null : Number(body.lc_months_required),
    tariff_basis: body.tariff_basis ? String(body.tariff_basis).trim() : null,
    remarks: body.remarks ? String(body.remarks).trim() : null,
  };
  if (!out.ppa_ref) throw fail(400, 'PPA reference is required');
  if (!out.valid_from) throw fail(400, 'Valid from is required');
  if (out.valid_to && out.valid_to < out.valid_from) throw fail(400, 'Valid to cannot be before valid from');
  if (out.signed_on && out.signed_on > istToday()) throw fail(400, 'Signed on cannot be in the future');
  if (out.contracted_share_pct != null && !(out.contracted_share_pct > 0 && out.contracted_share_pct <= 100)) {
    throw fail(400, 'Contracted share must be between 0 and 100%');
  }
  if (out.lc_months_required != null && !(out.lc_months_required >= 0 && out.lc_months_required <= 12)) {
    throw fail(400, 'LC cover must be between 0 and 12 months of billing');
  }
  return out;
}

export function addPpa(vertical, body, user) {
  const station = stationOfVertical(body.contract_id, vertical);
  const name = String(body.beneficiary_name || '').trim();
  if (!name) throw fail(400, 'Beneficiary is required');
  if (!isStationBeneficiary(station.id, name)) {
    throw fail(400, `${name} is not on ${station.contract_no}'s allocation or bills — a PPA is recorded for a beneficiary the station supplies`);
  }
  const f = ppaFields(body);
  const dup = db.prepare(`
    SELECT ppa_ref FROM station_beneficiary_ppas
    WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND status = 'ACTIVE'
      AND valid_from <= COALESCE(?, '9999-12-31') AND COALESCE(valid_to, '9999-12-31') >= ?
  `).get(station.id, norm(name), f.valid_to, f.valid_from);
  if (dup) throw fail(409, `${name} already has PPA ${dup.ppa_ref} in force over these dates — amend or terminate it first`);
  const beneficiaryId = db.prepare(`
    SELECT beneficiary_id FROM hydro_beneficiary_allocations
    WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND beneficiary_id IS NOT NULL LIMIT 1
  `).get(station.id, norm(name))?.beneficiary_id || null;
  const id = newId('SPPA');
  db.prepare(`
    INSERT INTO station_beneficiary_ppas (id, contract_id, beneficiary_name, beneficiary_id, ppa_ref, signed_on,
      valid_from, valid_to, contracted_share_pct, lc_months_required, tariff_basis, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, station.id, name, beneficiaryId, f.ppa_ref, f.signed_on, f.valid_from, f.valid_to,
    f.contracted_share_pct, f.lc_months_required, f.tariff_basis, f.remarks, user?.id || null);
  return db.prepare('SELECT * FROM station_beneficiary_ppas WHERE id = ?').get(id);
}

export function updatePpa(vertical, id, body) {
  const cur = db.prepare('SELECT * FROM station_beneficiary_ppas WHERE id = ?').get(id);
  if (!cur) throw fail(404, 'PPA not found');
  stationOfVertical(cur.contract_id, vertical);
  if (body.status === 'TERMINATED') {
    if (!body.remarks) throw fail(400, 'Say why the PPA is terminated');
    db.prepare(`UPDATE station_beneficiary_ppas SET status = 'TERMINATED', remarks = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(String(body.remarks).trim(), id);
  } else {
    const f = ppaFields({ ...cur, ...body });
    db.prepare(`
      UPDATE station_beneficiary_ppas SET ppa_ref = ?, signed_on = ?, valid_from = ?, valid_to = ?,
        contracted_share_pct = ?, lc_months_required = ?, tariff_basis = ?, remarks = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(f.ppa_ref, f.signed_on, f.valid_from, f.valid_to, f.contracted_share_pct, f.lc_months_required, f.tariff_basis, f.remarks, id);
  }
  return db.prepare('SELECT * FROM station_beneficiary_ppas WHERE id = ?').get(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Regulatory desk
// ─────────────────────────────────────────────────────────────────────────────

export const REG_TYPES = {
  TARIFF_PETITION: 'Tariff petition',
  TRUE_UP: 'True-up petition',
  REVIEW_PETITION: 'Review petition',
  APPEAL: 'Appeal (APTEL / Supreme Court)',
  CERC_FEE: 'CERC fee',
  FILING: 'Regulatory filing / return',
  OTHER: 'Other',
};
export const REG_STATUSES = ['OPEN', 'FILED', 'UNDER_HEARING', 'ORDER_RESERVED', 'ORDER_ISSUED', 'PAID', 'CLOSED'];
const PETITIONS = ['TARIFF_PETITION', 'TRUE_UP', 'REVIEW_PETITION', 'APPEAL'];

/** How soon a due date or hearing counts as coming up. */
const SOON_DAYS = 30;

function decorateItem(i, today) {
  const open = !['ORDER_ISSUED', 'PAID', 'CLOSED'].includes(i.status);
  const overdue = open && i.due_date && i.due_date < today && !i.filed_on;
  const dueSoon = open && !overdue && i.due_date && !i.filed_on && daysBetween(today, i.due_date) <= SOON_DAYS;
  const hearingSoon = i.next_hearing && i.next_hearing >= today && daysBetween(today, i.next_hearing) <= SOON_DAYS;
  const toImplement = i.status === 'ORDER_ISSUED' && i.tariff_impact && !i.implemented_on;
  return {
    ...i,
    type_label: REG_TYPES[i.item_type] || i.item_type,
    overdue: !!overdue,
    due_soon: !!dueSoon,
    hearing_soon: !!hearingSoon,
    to_implement: !!toImplement,
    days_to_due: i.due_date ? daysBetween(today, i.due_date) : null,
  };
}

export function regulatoryRegister(vertical, { asOf = istToday() } = {}) {
  const v = normalizeVertical(vertical);
  const items = db.prepare(`
    SELECT r.*, c.contract_no, COALESCE(e.name, c.contract_no) AS station_name
    FROM station_regulatory_items r
    LEFT JOIN contracts c ON c.id = r.contract_id
    LEFT JOIN entities e ON e.id = c.seller_id
    WHERE r.vertical = ?
    ORDER BY CASE WHEN r.status IN ('ORDER_ISSUED','PAID','CLOSED') THEN 1 ELSE 0 END,
             COALESCE(r.next_hearing, r.due_date, '9999-12-31'), r.created_at DESC
  `).all(v).map((i) => decorateItem(i, asOf));
  const open = items.filter((i) => !['ORDER_ISSUED', 'PAID', 'CLOSED'].includes(i.status));
  return {
    vertical: v,
    as_of: asOf,
    types: Object.entries(REG_TYPES).map(([value, label]) => ({ value, label })),
    statuses: REG_STATUSES,
    items,
    totals: {
      open: open.length,
      overdue: items.filter((i) => i.overdue).length,
      due_soon: items.filter((i) => i.due_soon).length,
      hearings_soon: items.filter((i) => i.hearing_soon).length,
      to_implement: items.filter((i) => i.to_implement).length,
      fees_due: money(open.filter((i) => i.item_type === 'CERC_FEE').reduce((x, i) => x + (i.amount || 0), 0)),
    },
  };
}

function regFields(body, cur = {}) {
  const m = { ...cur, ...body };
  const out = {
    item_type: m.item_type,
    title: String(m.title || '').trim(),
    petition_no: m.petition_no ? String(m.petition_no).trim() : null,
    control_period: m.control_period ? String(m.control_period).trim() : null,
    due_date: dateOrNull(m.due_date, 'Due date'),
    filed_on: dateOrNull(m.filed_on, 'Filed on'),
    next_hearing: dateOrNull(m.next_hearing, 'Next hearing'),
    order_date: dateOrNull(m.order_date, 'Order date'),
    order_ref: m.order_ref ? String(m.order_ref).trim() : null,
    amount: m.amount === '' || m.amount == null ? null : Number(m.amount),
    status: m.status || 'OPEN',
    tariff_impact: m.tariff_impact ? 1 : 0,
    implemented_on: dateOrNull(m.implemented_on, 'Implemented on'),
    remarks: m.remarks ? String(m.remarks).trim() : null,
  };
  if (!REG_TYPES[out.item_type]) throw fail(400, 'Choose what kind of item this is');
  if (!out.title) throw fail(400, 'A title is required');
  if (!REG_STATUSES.includes(out.status)) throw fail(400, 'Unknown status');
  if (out.amount != null && !(out.amount >= 0)) throw fail(400, 'Amount must be a positive number');
  const today = istToday();
  if (out.filed_on && out.filed_on > today) throw fail(400, 'Filed on cannot be in the future');
  if (out.order_date && out.order_date > today) throw fail(400, 'Order date cannot be in the future');
  if (out.order_date && out.filed_on && out.order_date < out.filed_on) throw fail(400, 'The order cannot predate the filing');
  if (['FILED', 'UNDER_HEARING', 'ORDER_RESERVED', 'ORDER_ISSUED'].includes(out.status) && !out.filed_on) {
    throw fail(400, 'Give the date it was filed');
  }
  if (out.status === 'ORDER_ISSUED' && (!out.order_date || !out.order_ref)) {
    throw fail(400, 'An issued order needs its date and reference');
  }
  if (out.status === 'PAID' && out.item_type !== 'CERC_FEE') throw fail(400, 'Only a fee is paid; close other items instead');
  if (out.status === 'PAID' && !(out.amount > 0)) throw fail(400, 'Give the amount paid');
  if (out.implemented_on && out.status !== 'ORDER_ISSUED' && out.status !== 'CLOSED') {
    throw fail(400, 'Only an issued order is implemented');
  }
  if (out.tariff_impact && !PETITIONS.includes(out.item_type)) out.tariff_impact = 0;
  return out;
}

export function addRegulatoryItem(vertical, body, user) {
  const v = normalizeVertical(vertical);
  if (body.contract_id) stationOfVertical(body.contract_id, v);
  const f = regFields(body);
  const id = newId('SREG');
  db.prepare(`
    INSERT INTO station_regulatory_items (id, vertical, contract_id, item_type, title, petition_no, control_period,
      due_date, filed_on, next_hearing, order_date, order_ref, amount, status, tariff_impact, implemented_on, remarks, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, v, body.contract_id || null, f.item_type, f.title, f.petition_no, f.control_period, f.due_date, f.filed_on,
    f.next_hearing, f.order_date, f.order_ref, f.amount, f.status, f.tariff_impact, f.implemented_on, f.remarks, user?.id || null);
  return decorateItem(db.prepare('SELECT * FROM station_regulatory_items WHERE id = ?').get(id), istToday());
}

export function updateRegulatoryItem(vertical, id, body) {
  const cur = db.prepare('SELECT * FROM station_regulatory_items WHERE id = ?').get(id);
  if (!cur || cur.vertical !== normalizeVertical(vertical)) throw fail(404, 'Item not found');
  const f = regFields(body, cur);
  db.prepare(`
    UPDATE station_regulatory_items SET item_type = ?, title = ?, petition_no = ?, control_period = ?, due_date = ?,
      filed_on = ?, next_hearing = ?, order_date = ?, order_ref = ?, amount = ?, status = ?, tariff_impact = ?,
      implemented_on = ?, remarks = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(f.item_type, f.title, f.petition_no, f.control_period, f.due_date, f.filed_on, f.next_hearing, f.order_date,
    f.order_ref, f.amount, f.status, f.tariff_impact, f.implemented_on, f.remarks, id);
  return decorateItem(db.prepare('SELECT * FROM station_regulatory_items WHERE id = ?').get(id), istToday());
}

// ─────────────────────────────────────────────────────────────────────────────
// REA register
// ─────────────────────────────────────────────────────────────────────────────

/** A provisional month still without its final REA this long after it ended is flagged. */
export const FINAL_REA_EXPECTED_DAYS = 90;

function fyMonthsOf(fy) {
  const start = Number(String(fy).slice(0, 4));
  if (!start) throw fail(400, 'fy must look like 2026-2027');
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(start, 3 + i, 1)).toISOString().slice(0, 7));
}

function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function reaRegister(vertical, fy, { asOf = istToday() } = {}) {
  const year = fy || financialYearOfMonth(lastClosedMonth());
  const months = fyMonthsOf(year).filter((m) => m <= lastClosedMonth(asOf));
  const fetched = (month, type) => db.prepare(`
    SELECT status, fetched_at, processed_at FROM rea_fetch_log
    WHERE period_month = ? AND data_type = ? ORDER BY (status = 'PROCESSED') DESC, created_at DESC LIMIT 1
  `).get(month, type);
  const reaRow = (cid, month, type) => db.prepare(`
    SELECT energy_mwh, free_energy_mwh, availability_percent, status FROM energy_data
    WHERE contract_id = ? AND period_month = ? AND data_type = ? AND source = 'REA'
    ORDER BY created_at DESC LIMIT 1
  `).get(cid, month, type);
  const billOf = (cid, month, kind) => db.prepare(`
    SELECT id, bill_no, status, approval_status, rea_reference, e1_ex_bus_scheduled_kwh, e3_saleable_scheduled_kwh,
           c1_pafm_pct, total_charges
    FROM hydro_station_bills
    WHERE contract_id = ? AND billing_month = ? AND bill_kind = ? AND status <> 'CANCELLED'
    ORDER BY created_at DESC LIMIT 1
  `).get(cid, month, kind);

  const stations = stationsOf(vertical).map((s) => {
    const rows = months.map((month) => {
      const provRea = reaRow(s.id, month, 'PROVISIONAL');
      const finalRea = reaRow(s.id, month, 'FINAL');
      const prov = billOf(s.id, month, 'PROVISIONAL');
      const fin = billOf(s.id, month, 'FINAL');
      const revisions = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(differential_amount), 0) AS amt FROM hydro_station_bills
        WHERE contract_id = ? AND billing_month = ? AND bill_kind = 'REVISION' AND status <> 'CANCELLED'
      `).get(s.id, month);
      const flags = [];
      // The bill's ex-bus energy is the REA's scheduled energy in kWh; a gap
      // of more than one MWh means the REA moved after the bill was drawn.
      const check = (bill, rea, label) => {
        if (bill && rea && Math.abs(bill.e1_ex_bus_scheduled_kwh / 1000 - rea.energy_mwh) > 1) {
          flags.push({ code: 'MISMATCH', text: `${label} bill energy ${(bill.e1_ex_bus_scheduled_kwh / 1000).toFixed(0)} MWh vs REA ${Number(rea.energy_mwh).toFixed(0)} MWh` });
        }
      };
      check(prov, provRea, 'Provisional');
      check(fin, finalRea, 'Final');
      if (provRea && !prov && !fin) flags.push({ code: 'NOT_BILLED', text: 'Provisional REA in, month not billed' });
      if (finalRea && !fin) flags.push({ code: 'FINAL_NOT_BILLED', text: 'Final REA in, final bill not raised' });
      const age = daysBetween(monthEnd(month), asOf);
      if (!finalRea && !fin && age > FINAL_REA_EXPECTED_DAYS) flags.push({ code: 'FINAL_AWAITED', text: `Final REA awaited ${age} days after month end` });
      if (!provRea && !prov && !fin) flags.push({ code: 'NO_REA', text: 'No REA for this month' });

      const pk = prov?.e3_saleable_scheduled_kwh; const fk = fin?.e3_saleable_scheduled_kwh;
      return {
        month,
        provisional_rea: provRea ? { energy_mwh: provRea.energy_mwh, free_mwh: provRea.free_energy_mwh, paf: provRea.availability_percent } : null,
        final_rea: finalRea ? { energy_mwh: finalRea.energy_mwh, free_mwh: finalRea.free_energy_mwh, paf: finalRea.availability_percent } : null,
        provisional_fetch: fetched(month, 'PROVISIONAL')?.status || null,
        final_fetch: fetched(month, 'FINAL')?.status || null,
        provisional_bill: prov ? { id: prov.id, bill_no: prov.bill_no, status: prov.status, saleable_kwh: pk, total: prov.total_charges, rea_reference: prov.rea_reference } : null,
        final_bill: fin ? { id: fin.id, bill_no: fin.bill_no, status: fin.status, saleable_kwh: fk, total: fin.total_charges, rea_reference: fin.rea_reference } : null,
        revisions: revisions.n,
        revision_amount: money(revisions.amt),
        final_vs_provisional_kwh: pk != null && fk != null ? money(fk - pk) : null,
        final_vs_provisional_amount: prov && fin ? money(fin.total_charges - prov.total_charges) : null,
        flags,
      };
    });
    return { contract_id: s.id, contract_no: s.contract_no, station_name: s.station_name, rows };
  });
  const all = stations.flatMap((s) => s.rows);
  const has = (code) => all.filter((r) => r.flags.some((f) => f.code === code)).length;
  return {
    vertical: normalizeVertical(vertical),
    fy: year,
    final_rea_expected_days: FINAL_REA_EXPECTED_DAYS,
    stations,
    totals: {
      months: all.length,
      final_in: all.filter((r) => r.final_rea || r.final_bill).length,
      mismatches: has('MISMATCH'),
      not_billed: has('NOT_BILLED') + has('FINAL_NOT_BILLED'),
      final_awaited: has('FINAL_AWAITED'),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Regulation of power supply
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a beneficiary may be regulated, and how much notice it gets. Both are
 * masters so Commercial can set them to the PPA or the regulation in force;
 * the defaults follow CERC (Regulation of Power Supply) Regulations, 2010
 * practice — dues beyond 60 days of the due date, 15 days' notice.
 */
export function regulationNorms() {
  return {
    trigger_days: getParamNumber('power_regulation_trigger_days', 60),
    notice_days: getParamNumber('power_regulation_notice_days', 15),
  };
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function nextCaseNo(onDate) {
  const year = onDate.slice(0, 4);
  const n = db.prepare("SELECT COUNT(*) AS n FROM station_power_regulations WHERE case_no LIKE ?").get(`ROP/${year}/%`).n;
  return `ROP/${year}/${String(n + 1).padStart(4, '0')}`;
}

/** What was withheld from the beneficiary on the bills, month by month. */
function withheldOnBills(contractId, beneficiaryName, from, to) {
  return db.prepare(`
    SELECT b.billing_month, b.bill_no, b.bill_kind, l.actual_scheduled_energy_kwh AS entitled_kwh,
           l.deducted_scheduled_energy_kwh AS withheld_kwh
    FROM hydro_bill_lines l JOIN hydro_station_bills b ON b.id = l.bill_id
    WHERE b.contract_id = ? AND UPPER(TRIM(l.beneficiary_name)) = ? AND l.is_regulated = 1
      AND b.status <> 'CANCELLED' AND b.billing_month >= ? AND b.billing_month <= ?
    ORDER BY b.billing_month
  `).all(contractId, norm(beneficiaryName), from.slice(0, 7), (to || '9999-12').slice(0, 7));
}

function securityShort(contractId, beneficiaryName, today) {
  const ppa = db.prepare(`
    SELECT lc_months_required FROM station_beneficiary_ppas
    WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND status = 'ACTIVE' AND lc_months_required > 0
      AND valid_from <= ? AND COALESCE(valid_to, '9999-12-31') >= ?
    LIMIT 1
  `).get(contractId, norm(beneficiaryName), today, today);
  if (!ppa) return null;
  const yearAgo = addDays(today, -365);
  const avg = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) / 12.0 AS avg FROM hydro_ledger_docs
    WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND doc_type = 'PB' AND status = 'OPEN' AND doc_date >= ?
  `).get(contractId, norm(beneficiaryName), yearAgo).avg;
  const held = db.prepare(`
    SELECT COALESCE(SUM(amount - invoked_amount), 0) AS held FROM hydro_security_instruments
    WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND status = 'ACTIVE' AND valid_to >= ?
  `).get(contractId, norm(beneficiaryName), today).held;
  return money(Math.max(0, ppa.lc_months_required * avg - held));
}

function decorateCase(c, today) {
  const ageing = (() => {
    try { return receivablesAgeing(c.contract_id, { asOf: today }).rows.find((r) => norm(r.beneficiary_name) === norm(c.beneficiary_name)); } catch { return null; }
  })();
  const withheld = c.regulate_from ? withheldOnBills(c.contract_id, c.beneficiary_name, c.regulate_from, c.restored_on) : [];
  return {
    ...c,
    can_regulate_from: c.earliest_regulation_date,
    notice_matured: today >= c.earliest_regulation_date,
    outstanding_now: ageing?.outstanding ?? 0,
    overdue_now: ageing?.overdue ?? 0,
    days_overdue_now: ageing?.days_overdue ?? 0,
    // Restoring while the default it was started for still stands is allowed —
    // a payment plan, an order — but it is shown, not hidden.
    default_cleared: (ageing?.overdue ?? 0) <= 0.005,
    withheld,
    withheld_kwh: money(withheld.reduce((x, w) => x + w.withheld_kwh, 0)),
  };
}

export function regulationRegister(vertical, { asOf = istToday() } = {}) {
  const norms = regulationNorms();
  const stations = stationsOf(vertical);
  const ids = stations.map((s) => s.id);
  const cases = ids.length ? db.prepare(`
    SELECT r.*, COALESCE(e.name, c.contract_no) AS station_name
    FROM station_power_regulations r
    JOIN contracts c ON c.id = r.contract_id LEFT JOIN entities e ON e.id = c.seller_id
    WHERE r.contract_id IN (${ids.map(() => '?').join(',')})
    ORDER BY CASE r.status WHEN 'REGULATING' THEN 0 WHEN 'NOTICE_ISSUED' THEN 1 ELSE 2 END, r.notice_date DESC
  `).all(...ids).map((c) => decorateCase(c, asOf)) : [];

  // Beneficiaries in default with no open case: the desk's to decide on.
  const openKey = new Set(cases.filter((c) => ['NOTICE_ISSUED', 'REGULATING'].includes(c.status)).map((c) => `${c.contract_id}|${norm(c.beneficiary_name)}`));
  const candidates = [];
  for (const s of stations) {
    let ageing = [];
    try { ageing = receivablesAgeing(s.id, { asOf }).rows; } catch { ageing = []; }
    for (const r of ageing) {
      if (openKey.has(`${s.id}|${norm(r.beneficiary_name)}`)) continue;
      const overdue = r.days_overdue > norms.trigger_days && r.overdue > 0.005;
      const short = securityShort(s.id, r.beneficiary_name, asOf);
      if (!overdue && !(short > 0)) continue;
      candidates.push({
        contract_id: s.id,
        station_name: s.station_name,
        beneficiary_name: r.beneficiary_name,
        ground: overdue && short > 0 ? 'BOTH' : (overdue ? 'OVERDUE' : 'SECURITY_NOT_MAINTAINED'),
        outstanding: r.outstanding,
        overdue: r.overdue,
        days_overdue: r.days_overdue,
        d90_plus: r.d90_plus,
        security_short: short,
      });
    }
  }
  candidates.sort((a, b) => b.days_overdue - a.days_overdue);
  const live = (st) => cases.filter((c) => c.status === st);
  return {
    as_of: asOf,
    norms,
    candidates,
    cases,
    totals: {
      candidates: candidates.length,
      notices: live('NOTICE_ISSUED').length,
      notices_matured: live('NOTICE_ISSUED').filter((c) => c.notice_matured).length,
      regulating: live('REGULATING').length,
      regulating_cleared: live('REGULATING').filter((c) => c.default_cleared).length,
      withheld_kwh: money(cases.reduce((x, c) => x + c.withheld_kwh, 0)),
    },
  };
}

function caseOf(vertical, id) {
  const c = db.prepare('SELECT * FROM station_power_regulations WHERE id = ?').get(id);
  if (!c) throw fail(404, 'Regulation case not found');
  stationOfVertical(c.contract_id, vertical);
  return c;
}

export function issueRegulationNotice(vertical, body, user) {
  const station = stationOfVertical(body.contract_id, vertical);
  const name = String(body.beneficiary_name || '').trim();
  if (!name || !isStationBeneficiary(station.id, name)) throw fail(400, 'Choose a beneficiary the station supplies');
  const noticeRef = String(body.notice_ref || '').trim();
  const noticeDate = dateOrNull(body.notice_date, 'Notice date');
  if (!noticeRef) throw fail(400, 'Give the notice reference');
  if (!noticeDate) throw fail(400, 'Give the notice date');
  if (noticeDate > istToday()) throw fail(400, 'The notice date cannot be in the future');
  const open = db.prepare(`
    SELECT case_no FROM station_power_regulations
    WHERE contract_id = ? AND UPPER(TRIM(beneficiary_name)) = ? AND status IN ('NOTICE_ISSUED','REGULATING')
  `).get(station.id, norm(name));
  if (open) throw fail(409, `${name} already has an open regulation case, ${open.case_no}`);

  const norms = regulationNorms();
  const row = receivablesAgeing(station.id, { asOf: noticeDate }).rows.find((r) => norm(r.beneficiary_name) === norm(name));
  const overdue = !!row && row.days_overdue > norms.trigger_days && row.overdue > 0.005;
  const short = securityShort(station.id, name, noticeDate);
  if (!overdue && !(short > 0)) {
    throw fail(400, `${name} is not in default on ${noticeDate}: nothing is overdue beyond ${norms.trigger_days} days and its payment security is not short of its PPA`);
  }
  const id = newId('ROP');
  const caseNo = nextCaseNo(noticeDate);
  db.prepare(`
    INSERT INTO station_power_regulations (id, case_no, contract_id, beneficiary_name, status, ground,
      outstanding_at_notice, overdue_days_at_notice, notice_ref, notice_date, earliest_regulation_date, remarks, created_by)
    VALUES (?, ?, ?, ?, 'NOTICE_ISSUED', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, caseNo, station.id, name, overdue && short > 0 ? 'BOTH' : (overdue ? 'OVERDUE' : 'SECURITY_NOT_MAINTAINED'),
    row?.outstanding || 0, row?.days_overdue || 0, noticeRef, noticeDate, addDays(noticeDate, norms.notice_days),
    body.remarks ? String(body.remarks).trim() : null, user?.id || null);
  return decorateCase(db.prepare('SELECT * FROM station_power_regulations WHERE id = ?').get(id), istToday());
}

export function moveRegulationCase(vertical, id, body) {
  const c = caseOf(vertical, id);
  const action = body.action;
  if (action === 'REGULATE') {
    if (c.status !== 'NOTICE_ISSUED') throw fail(400, `${c.case_no} is ${c.status.toLowerCase().replace('_', ' ')}, not on notice`);
    const from = dateOrNull(body.regulate_from, 'Regulate from');
    if (!from) throw fail(400, 'Give the date regulation starts');
    if (from < c.earliest_regulation_date) {
      throw fail(400, `The notice runs until ${c.earliest_regulation_date}; supply cannot be regulated before then`);
    }
    const pctW = Number(body.regulation_pct);
    if (!(pctW > 0 && pctW <= 100)) throw fail(400, 'Share withheld must be more than 0 and at most 100%');
    const rldc = String(body.rldc_intimation_ref || '').trim();
    if (!rldc) throw fail(400, 'Give the RLDC / SLDC intimation reference — regulation is scheduled through them');
    db.prepare(`
      UPDATE station_power_regulations SET status = 'REGULATING', regulate_from = ?, regulation_pct = ?,
        rldc_intimation_ref = ?, updated_at = datetime('now') WHERE id = ?
    `).run(from, pctW, rldc, id);
  } else if (action === 'RESTORE' || action === 'WITHDRAW') {
    const want = action === 'RESTORE' ? 'REGULATING' : 'NOTICE_ISSUED';
    if (c.status !== want) throw fail(400, action === 'RESTORE' ? 'Only supply being regulated is restored' : 'Only a notice not yet acted on is withdrawn');
    const on = dateOrNull(body.on_date, 'Date') || istToday();
    if (action === 'RESTORE' && on < c.regulate_from) throw fail(400, 'Supply cannot be restored before it was regulated');
    const reason = String(body.reason || '').trim();
    if (!reason) throw fail(400, 'Say why');
    db.prepare(`
      UPDATE station_power_regulations SET status = ?, restored_on = ?, close_reason = ?, updated_at = datetime('now') WHERE id = ?
    `).run(action === 'RESTORE' ? 'RESTORED' : 'WITHDRAWN', on, reason, id);
  } else {
    throw fail(400, 'action must be REGULATE, RESTORE or WITHDRAW');
  }
  return decorateCase(db.prepare('SELECT * FROM station_power_regulations WHERE id = ?').get(id), istToday());
}

/** Who the register says was under regulation in a month, for the bill's regulation panel. */
export function regulatedInMonth(contractId, month) {
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return db.prepare(`
    SELECT case_no, beneficiary_name, regulate_from, restored_on, regulation_pct, rldc_intimation_ref
    FROM station_power_regulations
    WHERE contract_id = ? AND regulate_from IS NOT NULL AND regulate_from <= ?
      AND (restored_on IS NULL OR restored_on >= ?) AND status IN ('REGULATING','RESTORED')
    ORDER BY beneficiary_name
  `).all(contractId, end, start);
}

// ─────────────────────────────────────────────────────────────────────────────
// The desk at a glance, for the dashboard
// ─────────────────────────────────────────────────────────────────────────────

/** Each count is read from the same register its own screen shows. */
export function deskStatus(vertical, user) {
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const close = safe(() => monthCloseBoard(vertical), null);
  const approvals = safe(() => approvalsQueue(vertical, user), null);
  const regulation = safe(() => regulationRegister(vertical), null);
  const regulatory = safe(() => regulatoryRegister(vertical), null);
  const ppas = safe(() => ppaRegister(vertical), null);
  const ageing = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, advance: 0 };
  for (const s of stationsOf(vertical)) {
    const a = safe(() => receivablesAgeing(s.id).totals, null);
    if (a) for (const k of Object.keys(ageing)) ageing[k] = money(ageing[k] + (a[k] || 0));
  }
  return {
    month_close: close ? {
      period: close.period, ...close.totals, open_items: close.checklist.open_items, clear: close.checklist.clear,
    } : null,
    approvals: approvals?.totals || null,
    regulation: regulation?.totals || null,
    regulatory: regulatory?.totals || null,
    ppas: ppas?.totals || null,
    ageing,
  };
}
