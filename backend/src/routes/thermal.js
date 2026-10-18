import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { thermalReadiness, computeEcr } from '../services/thermalStationBill.js';

// The Thermal desk's stations: setting one up, and the tariff each financial
// year is billed on. Billing itself, and everything after it, runs on the
// shared station-billing routes (/api/hydro-billing, /api/hydro-desk).
const router = Router();
router.use(requireAuth);

const READ = ROLE_GROUPS.THERMAL_ALL;
const WRITE = ROLE_GROUPS.THERMAL_WRITE;
const fail = (status, message) => Object.assign(new Error(message), { status });
const handle = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
};

const isDay = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

function thermalContract(id) {
  const c = db.prepare(`SELECT * FROM contracts WHERE id = ? AND project_type = 'Thermal'`).get(id);
  if (!c) throw fail(404, 'Thermal station not found');
  return c;
}

router.get('/stations', requireRole(...READ), handle(() => db.prepare(`
    SELECT c.id, c.contract_no, c.status, c.capacity_mw, c.commissioned_capacity_mw, c.cod_date,
           c.tenure_start, c.tenure_end, c.payment_terms_days, c.rebate_pct, c.rebate_days, c.lps_annual_pct,
           c.seller_id, COALESCE(e.name, c.contract_no) AS station_name
    FROM contracts c
    LEFT JOIN entities e ON e.id = c.seller_id
    WHERE c.contract_type = 'PPA' AND c.project_type = 'Thermal'
    ORDER BY station_name
  `).all().map((c) => ({ ...c, ...thermalReadiness(c) }))));

/**
 * Set up a thermal station: the generating company (onboarded under Thermal
 * stakeholders) and the PPA terms the bills follow.
 */
router.post('/stations', requireRole(...WRITE), handle((req) => {
  const b = req.body || {};
  const seller = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(b.seller_id);
  if (!seller || seller.entity_type !== 'SELLER') throw fail(400, 'Choose the generating company — a Seller onboarded under Thermal stakeholders.');
  if (!String(seller.verticals || '').split(',').includes('THERMAL')) throw fail(400, `${seller.name} is not registered under Thermal Billing. Link it from Thermal → Stakeholders first.`);
  if (seller.status !== 'APPROVED') throw fail(400, `${seller.name} is ${seller.status}; approve its onboarding first.`);
  if (seller.is_blacklisted) throw fail(400, `${seller.name} is blacklisted.`);
  const no = String(b.contract_no || '').trim();
  if (!no) throw fail(400, 'PPA number is required');
  if (db.prepare('SELECT 1 FROM contracts WHERE contract_no = ?').get(no)) throw fail(409, `${no} is already on record`);
  const capacity = Number(b.capacity_mw);
  if (!(capacity > 0)) throw fail(400, 'Installed capacity (MW) must be greater than zero');
  if (!isDay(b.tenure_start) || !isDay(b.tenure_end) || b.tenure_end <= b.tenure_start) {
    throw fail(400, 'Give the PPA tenure — a real start date and a later end date');
  }
  if (b.cod_date && !isDay(b.cod_date)) throw fail(400, 'COD must be a real date, YYYY-MM-DD');
  if (b.cod_date && b.cod_date > b.tenure_end) throw fail(400, 'COD cannot fall after the PPA ends');
  const num = (v) => (v === '' || v == null ? null : Number(v));
  // The commercial terms each bill, rebate and surcharge follows; a negative
  // payment period or a 150% rebate was taken as given (Thermal QA run 1).
  const term = (v, label, min, max) => {
    const x = num(v);
    if (x == null) return;
    if (!Number.isFinite(x) || x < min || x > max) throw fail(400, `${label} must be between ${min} and ${max}`);
  };
  term(b.commissioned_capacity_mw, 'Commissioned capacity (MW)', 0, capacity);
  term(b.payment_terms_days, 'Payment terms (days)', 1, 365);
  term(b.rebate_pct, 'Rebate (%)', 0, 10);
  term(b.rebate_days, 'Rebate window (days)', 0, 365);
  term(b.lps_annual_pct, 'Late payment surcharge (% a year)', 0, 36);
  term(b.lps_grace_days, 'Surcharge grace (days)', 0, 365);
  const id = newId('CON');
  db.prepare(`
    INSERT INTO contracts (id, contract_no, contract_type, seller_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
      tariff_type, tariff_per_unit, tenure_start, tenure_end, billing_cycle, payment_terms_days, rebate_pct, rebate_days,
      rebate_basis, lps_annual_pct, lps_grace_days, status)
    VALUES (?, ?, 'PPA', ?, 'Thermal', ?, ?, ?, 'TWO_PART', 0, ?, ?, 'MONTHLY', ?, ?, ?, 'BILL_DATE', ?, ?, 'ACTIVE')
  `).run(id, no, seller.id, capacity, num(b.commissioned_capacity_mw) ?? capacity, b.cod_date || null,
    b.tenure_start, b.tenure_end, num(b.payment_terms_days) ?? 45, num(b.rebate_pct), num(b.rebate_days),
    num(b.lps_annual_pct), num(b.lps_grace_days) ?? 0);
  secureLogAudit(req, { action: 'THERMAL_STATION_CREATED', module: 'THERMAL', entityType: 'contract', entityId: id, afterValue: { contract_no: no, seller: seller.name, capacity_mw: capacity } });
  return db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
}));

router.get('/tariffs', requireRole(...READ), handle((req) => {
  thermalContract(req.query.contract_id);
  return db.prepare('SELECT * FROM thermal_station_tariffs WHERE contract_id = ? ORDER BY financial_year DESC').all(req.query.contract_id);
}));

/** Set a financial year's tariff — the CERC order's AFC and the norms. */
router.post('/tariffs', requireRole(...WRITE), handle((req) => {
  const b = req.body || {};
  const c = thermalContract(b.contract_id);
  const fy = /^(\d{4})-(\d{4})$/.exec(String(b.financial_year || ''));
  if (!fy || Number(fy[2]) !== Number(fy[1]) + 1) throw fail(400, 'financial_year must be one April-to-March year, like 2026-2027');
  const n = (v, label, { min = 0, max = Infinity, required = true } = {}) => {
    if (v === '' || v == null) { if (required) throw fail(400, `${label} is required`); return null; }
    const x = Number(v);
    if (!Number.isFinite(x) || x < min || x > max) throw fail(400, `${label} is not a usable figure`);
    return x;
  };
  const row = {
    annual_afc: n(b.annual_afc, 'Annual Fixed Charges', { min: 1e7 }),
    napaf_percent: n(b.napaf_percent, 'NAPAF', { min: 1, max: 100 }),
    gross_heat_rate: n(b.gross_heat_rate, 'Gross station heat rate', { min: 1500, max: 4000 }),
    aux_pct: n(b.aux_pct, 'Auxiliary consumption', { max: 20 }),
    sfc_ml_per_kwh: n(b.sfc_ml_per_kwh, 'Secondary fuel consumption', { max: 10, required: false }) ?? 0,
    cv_secondary_kcal_per_ml: n(b.cv_secondary_kcal_per_ml, 'Calorific value of secondary fuel', { min: 1, max: 20, required: false }) ?? 10,
    // CERC: the coal's GCV as received less this, for variation in storage.
    gcv_storage_loss_kcal: n(b.gcv_storage_loss_kcal, 'GCV storage loss (kCal/kg)', { max: 300, required: false }) ?? 85,
  };
  const before = db.prepare('SELECT * FROM thermal_station_tariffs WHERE contract_id = ? AND financial_year = ?').get(c.id, b.financial_year);
  const who = req.user?.name || null;
  if (before) {
    db.prepare(`
      UPDATE thermal_station_tariffs SET annual_afc = ?, napaf_percent = ?, gross_heat_rate = ?, aux_pct = ?, sfc_ml_per_kwh = ?,
        cv_secondary_kcal_per_ml = ?, gcv_storage_loss_kcal = ?, order_ref = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?
    `).run(row.annual_afc, row.napaf_percent, row.gross_heat_rate, row.aux_pct, row.sfc_ml_per_kwh, row.cv_secondary_kcal_per_ml, row.gcv_storage_loss_kcal, b.order_ref || null, who, before.id);
  } else {
    db.prepare(`
      INSERT INTO thermal_station_tariffs (id, contract_id, financial_year, annual_afc, napaf_percent, gross_heat_rate, aux_pct,
        sfc_ml_per_kwh, cv_secondary_kcal_per_ml, gcv_storage_loss_kcal, order_ref, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId('TST'), c.id, b.financial_year, row.annual_afc, row.napaf_percent, row.gross_heat_rate, row.aux_pct,
      row.sfc_ml_per_kwh, row.cv_secondary_kcal_per_ml, row.gcv_storage_loss_kcal, b.order_ref || null, who);
  }
  // A revised tariff is a CERC order changing what the year is billed on: keep
  // what it replaced, and say which issued bills now need an arrear.
  const billed = db.prepare(`
    SELECT bill_no FROM hydro_station_bills WHERE contract_id = ? AND financial_year = ? AND status = 'ISSUED'
      AND bill_kind IN ('PROVISIONAL','FINAL','REVISION') ORDER BY billing_month
  `).all(c.id, b.financial_year).map((r) => r.bill_no);
  secureLogAudit(req, {
    action: 'THERMAL_TARIFF_SET', module: 'THERMAL', entityType: 'thermal_station_tariffs', entityId: c.id,
    beforeValue: before ? { financial_year: before.financial_year, annual_afc: before.annual_afc, napaf_percent: before.napaf_percent, gross_heat_rate: before.gross_heat_rate, aux_pct: before.aux_pct, sfc_ml_per_kwh: before.sfc_ml_per_kwh, cv_secondary_kcal_per_ml: before.cv_secondary_kcal_per_ml, gcv_storage_loss_kcal: before.gcv_storage_loss_kcal, order_ref: before.order_ref } : null,
    afterValue: { financial_year: b.financial_year, ...row, order_ref: b.order_ref || null },
  });
  const saved = db.prepare('SELECT * FROM thermal_station_tariffs WHERE contract_id = ? AND financial_year = ?').get(c.id, b.financial_year);
  return before && billed.length
    ? { ...saved, billed_on_previous: billed, note: `${billed.length} issued bill(s) of ${b.financial_year} were worked on the previous tariff (${billed.join(', ')}). Raise an arrear for the difference.` }
    : saved;
}));

// What the energy charge rate comes to for a month's fuel, before billing.
router.post('/ecr-preview', requireRole(...READ), handle((req) => {
  const b = req.body || {};
  const loss = b.gcv_storage_loss_kcal === '' || b.gcv_storage_loss_kcal == null ? 85 : Number(b.gcv_storage_loss_kcal);
  const cvpf = Number(b.gcv_kcal_per_kg) - loss;
  return {
    ecr: computeEcr({
      ghr: Number(b.gross_heat_rate), auxPct: Number(b.aux_pct), sfc: Number(b.sfc_ml_per_kwh) || 0,
      cvsf: Number(b.cv_secondary_kcal_per_ml) || 10, gcvKcalPerKg: cvpf,
      coalRsPerTonne: Number(b.coal_rs_per_tonne), oilRsPerKl: Number(b.oil_rs_per_kl) || 0,
    }),
    cvpf_kcal_per_kg: cvpf,
    gcv_storage_loss_kcal: loss,
  };
}));

export default router;
