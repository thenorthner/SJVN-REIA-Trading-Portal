import express from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, genInvoiceNo } from '../util.js';
import { getParamNumber } from '../mastersService.js';
import { secureLogAudit } from '../auditEngine.js';

const router = express.Router();

const BILL_STATUSES = ['DRAFT', 'FINAL', 'PAID'];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Billing month to YYYY-MM. Accepts "2026-06", "June-2026", "Jun 2026".
 * Without this the one-bill-per-month rule is defeated by spelling: "June-2026"
 * and "2026-06" are different strings for the same month.
 */
function normalizeBillingMonth(input) {
  const raw = String(input || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return `${iso[1]}-${String(m).padStart(2, '0')}`;
    return null;
  }
  const named = raw.match(/^([A-Za-z]+)[\s\-/]+(\d{4})$/);
  if (named) {
    const idx = MONTHS.findIndex((m) => m.startsWith(named[1].toLowerCase()));
    if (idx >= 0) return `${named[2]}-${String(idx + 1).padStart(2, '0')}`;
  }
  return null;
}

// These must be actual role names — REIA_WRITE/REIA_READ/FINANCE_MANAGER are
// group labels, not roles, and matched nobody, so REIA users got 403 here.
// Trading roles are included for read because the sidebar files this page under
// Power Trading; creating and settling the bill stays with REIA (see below).
router.use(requireAuth);
router.use(requireRole(...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, ...ROLE_GROUPS.TRADING_ALL])));

// GET /generator-billing
// List all generator bills
router.get('/', (req, res) => {
  const { status, beneficiary_id } = req.query;
  let sql = `
    SELECT b.*, e.name as beneficiary_name 
    FROM generator_bills b 
    JOIN entities e ON b.beneficiary_id = e.id
    WHERE 1=1
  `;
  const params = [];
  
  if (status) { sql += ' AND b.status = ?'; params.push(status); }
  if (beneficiary_id) { sql += ' AND b.beneficiary_id = ?'; params.push(beneficiary_id); }
  
  sql += ' ORDER BY b.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /generator-billing/generate
// Generate a new CERC-compliant two-part tariff bill
// Phase B.2: the maker generates the bill; the checker moves its status on.

/** A number from the form, or NaN when the field holds anything else. */
const numberOf = (v) => (v === '' || v == null ? NaN : Number(v));

/** Days in the month, and in the financial year (April-March) it falls in. */
function monthAndYearDays(month) {
  const [y, m] = month.split('-').map(Number);
  const ndm = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fyStart = m >= 4 ? y : y - 1;
  const ndy = (Date.UTC(fyStart + 1, 3, 1) - Date.UTC(fyStart, 3, 1)) / 86400000;
  return { ndm, ndy };
}

router.post('/generate', requireRole(...ROLE_GROUPS.REIA_MAKE), (req, res) => {
  const b = req.body || {};
  // One station, however it is typed: "NJHPS " and "njhps" are the same plant,
  // and billing it twice for a month was only stopped for an exact match.
  const station_name = String(b.station_name || '').trim().replace(/\s+/g, ' ');
  const { beneficiary_id, billing_month } = b;

  try {
    if (!station_name || !beneficiary_id || !billing_month) {
      return res.status(400).json({ error: 'station_name, beneficiary_id and billing_month are required' });
    }
    const beneficiary = db.prepare('SELECT id, name, entity_type FROM entities WHERE id = ?').get(beneficiary_id);
    if (!beneficiary) return res.status(404).json({ error: 'Beneficiary not found' });
    // A generator bills the utilities that draw its power, not another seller.
    if (beneficiary.entity_type !== 'BUYER') {
      return res.status(400).json({ error: `${beneficiary.name} is not a buyer; a generator bill goes to a beneficiary that draws the station's power` });
    }

    const month = normalizeBillingMonth(billing_month);
    if (!month) {
      return res.status(400).json({ error: `Could not read "${billing_month}" as a billing month — use YYYY-MM (e.g. 2026-06) or a month name with year (e.g. June-2026)` });
    }
    // A month not yet over has no availability or energy to bill.
    const thisMonth = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    if (month > thisMonth) {
      return res.status(400).json({ error: `${month} has not begun; a month is billed once its availability and energy are known` });
    }
    const existing = db.prepare(`
      SELECT bill_no, status FROM generator_bills
      WHERE LOWER(TRIM(station_name)) = LOWER(?) AND beneficiary_id = ? AND billing_month = ?
    `).get(station_name, beneficiary_id, month);
    if (existing) {
      return res.status(409).json({
        error: `${station_name} has already been billed to this beneficiary for ${month} — bill ${existing.bill_no} (${existing.status})`,
        existing_bill_no: existing.bill_no,
      });
    }

    // Every input is checked rather than read with `Number(x) || 0`, which
    // turned a mistyped energy into a bill with no energy charge, and let a
    // negative AFC through as a negative bill.
    const num_afc = numberOf(b.afc);
    const num_napaf = numberOf(b.napaf);
    const num_actual_paf = numberOf(b.actual_paf);
    const num_ex_bus_energy = numberOf(b.ex_bus_energy);
    const num_design_energy = b.design_energy_mu === '' || b.design_energy_mu == null ? 0 : numberOf(b.design_energy_mu);
    const num_aux = b.aux_consumption_pct === '' || b.aux_consumption_pct == null ? 0 : numberOf(b.aux_consumption_pct);
    const num_fehs = b.free_energy_pct === '' || b.free_energy_pct == null ? 0 : numberOf(b.free_energy_pct);
    const num_alloc = numberOf(b.allocation_pct);
    const problems = [
      !(num_afc > 0) && 'afc (annual fixed charges, ₹) must be greater than zero',
      !(num_napaf > 0 && num_napaf <= 100) && 'napaf must be a percentage above 0 and at most 100',
      !(num_actual_paf >= 0 && num_actual_paf <= 100) && 'actual_paf must be a percentage from 0 to 100',
      !(num_ex_bus_energy >= 0) && 'ex_bus_energy must be a number of MWh, zero or more',
      !(num_design_energy >= 0) && 'design_energy_mu must be a number of MU',
      !(num_aux >= 0 && num_aux < 100) && 'aux_consumption_pct must be a percentage from 0 to below 100',
      !(num_fehs >= 0 && num_fehs < 100) && 'free_energy_pct must be a percentage from 0 to below 100',
      !(num_alloc > 0 && num_alloc <= 100) && "allocation_pct (the beneficiary's share of the station, %) must be above 0 and at most 100",
    ].filter(Boolean);
    if (problems.length) return res.status(400).json({ error: problems[0], errors: problems });

    // CERC two-part tariff. AFC is split: energyShare of it is recovered through
    // the energy charge, the remainder through the capacity charge. Deriving ECR
    // from the same AFC is what keeps the two halves adding back to one AFC — a
    // hand-typed ECR has no such tie and can over- or under-recover silently.
    const energyShare = getParamNumber('cerc_afc_energy_share', 0.5);
    if (!(energyShare >= 0 && energyShare < 1)) {
      return res.status(500).json({ error: `Master parameter cerc_afc_energy_share must be between 0 and 1; it is ${energyShare}` });
    }

    let num_ecr;
    let ecr_source;
    if (num_design_energy > 0) {
      // ECR = AFC x share / {DE x (1 - AUX) x (1 - FEHS)}: the energy half of
      // AFC spread over the energy the beneficiaries can actually be sold —
      // design energy less the station's own consumption and the free power
      // to the home state. Without the two deductions the rate came out about
      // a seventh low on a station like NJHPS. Design energy is in MU (million
      // kWh), so the rate lands in Rs/kWh, the platform's price unit.
      const saleableKwh = num_design_energy * 1e6 * (1 - num_aux / 100) * (1 - num_fehs / 100);
      num_ecr = (num_afc * energyShare) / saleableKwh;
      ecr_source = 'DERIVED_FROM_AFC';
    } else if (Number(b.ecr) > 0) {
      num_ecr = Number(b.ecr);
      ecr_source = 'MANUAL';
    } else {
      return res.status(400).json({ error: 'Provide design_energy_mu so the ECR can be derived from AFC, or an explicit ecr in Rs/kWh' });
    }

    // 1. Capacity Charge — the non-energy share of AFC for the days of this
    //    month out of the days of the year (NDM / NDY, not a flat twelfth),
    //    reduced pro-rata when actual PAF falls short of the normative PAF, and
    //    borne by this beneficiary in its allocated share of the station. The
    //    whole station's charge used to land on whichever beneficiary was billed.
    const { ndm, ndy } = monthAndYearDays(month);
    let capacity_charge = num_afc * (1 - energyShare) * (ndm / ndy);
    if (num_actual_paf < num_napaf) {
      capacity_charge = capacity_charge * (num_actual_paf / num_napaf);
    }
    capacity_charge *= num_alloc / 100;

    // 2. Energy Charge, on the energy scheduled to this beneficiary in the month
    //    (ex-bus, from the REA) — already its own, so the share is not applied
    //    again. ECR is Rs/kWh and the energy is MWh, so x 1000.
    const energy_charge = num_ex_bus_energy * num_ecr * 1000;

    const total_amount = capacity_charge + energy_charge;

    const gbId = newId('GB');
    // bill_no is UNIQUE; a 4-digit random collides in practice, so use the house
    // generator and confirm the number is free before inserting.
    let billNo = genInvoiceNo('GB');
    for (let i = 0; i < 10 && db.prepare('SELECT 1 FROM generator_bills WHERE bill_no = ?').get(billNo); i += 1) {
      billNo = genInvoiceNo('GB');
    }

    const stmt = db.prepare(`
      INSERT INTO generator_bills (
        id, bill_no, station_name, beneficiary_id, billing_month,
        afc, napaf, actual_paf, ex_bus_energy, design_energy_mu, ecr, ecr_source,
        aux_consumption_pct, free_energy_pct, allocation_pct, created_by_id,
        capacity_charge, energy_charge, total_amount, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
    `);

    stmt.run(
      gbId, billNo, station_name, beneficiary_id, month,
      num_afc, num_napaf, num_actual_paf, num_ex_bus_energy,
      num_design_energy || null, num_ecr, ecr_source,
      num_aux, num_fehs, num_alloc, req.user?.id || null,
      capacity_charge, energy_charge, total_amount
    );

    secureLogAudit(req, {
      action: 'GENERATOR_BILL_GENERATED',
      module: 'REIA',
      entityType: 'generator_bills',
      entityId: gbId,
      afterValue: {
        bill_no: billNo, station_name, billing_month: month, allocation_pct: num_alloc,
        ecr: num_ecr, ecr_source, capacity_charge, energy_charge, total_amount,
      },
    });

    res.json({
      id: gbId, bill_no: billNo, billing_month: month, ndm, ndy, allocation_pct: num_alloc,
      ecr: num_ecr, ecr_source, capacity_charge, energy_charge, total_amount,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DRAFT -> FINAL -> PAID, one step at a time. Any status used to be accepted
// from any other, so a paid bill could be put back to draft and a draft marked
// paid without ever being issued.
const NEXT_STATUS = { DRAFT: 'FINAL', FINAL: 'PAID' };

// POST /generator-billing/:id/status
// Update status (e.g., DRAFT -> FINAL -> PAID)
router.post('/:id/status', requireRole(...ROLE_GROUPS.REIA_CHECK), (req, res) => {
  const { status } = req.body;
  try {
    if (!BILL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${BILL_STATUSES.join(', ')}` });
    }
    const before = db.prepare('SELECT * FROM generator_bills WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bill not found' });
    if (NEXT_STATUS[before.status] !== status) {
      return res.status(409).json({
        error: NEXT_STATUS[before.status]
          ? `${before.bill_no} is ${before.status}; it can only move to ${NEXT_STATUS[before.status]}`
          : `${before.bill_no} is ${before.status}; nothing follows it`,
      });
    }

    const updated = db.prepare(`
      UPDATE generator_bills SET status = ?, status_changed_by_id = ?, status_changed_at = datetime('now')
      WHERE id = ? RETURNING *
    `).get(status, req.user?.id || null, req.params.id);

    secureLogAudit(req, {
      action: 'GENERATOR_BILL_STATUS_UPDATED',
      module: 'REIA',
      entityType: 'generator_bills',
      entityId: req.params.id,
      beforeValue: { status: before.status },
      afterValue: { status },
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
