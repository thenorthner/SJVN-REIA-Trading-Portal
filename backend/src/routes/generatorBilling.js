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
router.post('/generate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const {
    station_name, beneficiary_id, billing_month,
    afc, napaf, actual_paf, ex_bus_energy, ecr, design_energy_mu
  } = req.body;

  try {
    if (!station_name || !beneficiary_id || !billing_month) {
      return res.status(400).json({ error: 'station_name, beneficiary_id and billing_month are required' });
    }
    const beneficiary = db.prepare('SELECT id FROM entities WHERE id = ?').get(beneficiary_id);
    if (!beneficiary) return res.status(404).json({ error: 'Beneficiary not found' });

    const month = normalizeBillingMonth(billing_month);
    if (!month) {
      return res.status(400).json({ error: `Could not read "${billing_month}" as a billing month — use YYYY-MM (e.g. 2026-06) or a month name with year (e.g. June-2026)` });
    }
    const existing = db.prepare(
      'SELECT bill_no, status FROM generator_bills WHERE station_name = ? AND beneficiary_id = ? AND billing_month = ?'
    ).get(station_name, beneficiary_id, month);
    if (existing) {
      return res.status(409).json({
        error: `${station_name} has already been billed to this beneficiary for ${month} — bill ${existing.bill_no} (${existing.status})`,
        existing_bill_no: existing.bill_no,
      });
    }

    const num_afc = Number(afc) || 0;
    const num_napaf = Number(napaf) || 0;
    const num_actual_paf = Number(actual_paf) || 0;
    const num_ex_bus_energy = Number(ex_bus_energy) || 0;
    const num_design_energy = Number(design_energy_mu) || 0;

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
      // Design energy is in MU (million units = million kWh), so AFC / (MU x 1e6)
      // lands in Rs/kWh — the platform's price unit everywhere.
      num_ecr = (num_afc * energyShare) / (num_design_energy * 1e6);
      ecr_source = 'DERIVED_FROM_AFC';
    } else if (Number(ecr) > 0) {
      num_ecr = Number(ecr);
      ecr_source = 'MANUAL';
    } else {
      return res.status(400).json({ error: 'Provide design_energy_mu so the ECR can be derived from AFC, or an explicit ecr in Rs/kWh' });
    }

    // 1. Capacity Charge — the non-energy share of AFC, apportioned monthly and
    //    reduced pro-rata when actual PAF falls short of the normative PAF.
    let capacity_charge = (num_afc * (1 - energyShare)) / 12;
    if (num_actual_paf < num_napaf && num_napaf > 0) {
      capacity_charge = capacity_charge * (num_actual_paf / num_napaf);
    }

    // 2. Energy Charge. ECR is Rs/kWh and ex-bus energy is MWh, so x 1000.
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
        capacity_charge, energy_charge, total_amount, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT')
    `);

    stmt.run(
      gbId, billNo, station_name, beneficiary_id, month,
      num_afc, num_napaf, num_actual_paf, num_ex_bus_energy,
      num_design_energy || null, num_ecr, ecr_source,
      capacity_charge, energy_charge, total_amount
    );

    secureLogAudit(req, {
      action: 'GENERATOR_BILL_GENERATED',
      module: 'REIA',
      entityType: 'generator_bills',
      entityId: gbId,
      afterValue: {
        bill_no: billNo, station_name, billing_month: month,
        ecr: num_ecr, ecr_source, capacity_charge, energy_charge, total_amount,
      },
    });

    res.json({
      id: gbId, bill_no: billNo, billing_month: month,
      ecr: num_ecr, ecr_source, capacity_charge, energy_charge, total_amount,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /generator-billing/:id/status
// Update status (e.g., DRAFT -> FINAL -> PAID)
router.post('/:id/status', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { status } = req.body;
  try {
    if (!BILL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${BILL_STATUSES.join(', ')}` });
    }
    const before = db.prepare('SELECT * FROM generator_bills WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bill not found' });

    const updated = db.prepare(`UPDATE generator_bills SET status = ? WHERE id = ? RETURNING *`).get(status, req.params.id);

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
