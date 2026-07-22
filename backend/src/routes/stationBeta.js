/**
 * Station Beta (β) — NRPC-certified Average Monthly Frequency Response Performance.
 * CRUD + supplementary true-up when β arrives after provisional billing.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, genInvoiceNo, buildBillingFamilyRef, directionForContract, pushNotification } from '../util.js';
import {
  resolveBetaRow,
  computeFreqResponseIncentive,
  billedIncentiveTotal,
} from '../services/betaFactor.js';

const router = Router();
router.use(requireAuth);

const READ = [...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR', 'FINANCE_USER', 'MANAGEMENT'];
const WRITE = [...ROLE_GROUPS.REIA_WRITE];

function enrich(row) {
  if (!row) return row;
  const c = db.prepare('SELECT contract_no, contract_type, project_type, capacity_charges_total FROM contracts WHERE id = ?').get(row.contract_id);
  const calc = c?.capacity_charges_total
    ? computeFreqResponseIncentive(c.capacity_charges_total, row.beta_value, c.project_type)
    : null;
  return {
    ...row,
    contract_no: c?.contract_no,
    contract_type: c?.contract_type,
    project_type: c?.project_type,
    capacity_charges_total: c?.capacity_charges_total ?? null,
    computed_incentive: calc?.incentive ?? null,
    incentive_eligible: calc?.eligible ?? false,
    incentive_reason: calc?.reason ?? null,
  };
}

router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, period_month, station_code } = req.query;
  let sql = 'SELECT * FROM station_beta WHERE 1=1';
  const params = [];
  if (contract_id) { sql += ' AND contract_id = ?'; params.push(contract_id); }
  if (period_month) { sql += ' AND period_month = ?'; params.push(period_month); }
  if (station_code) { sql += ' AND UPPER(station_code) = UPPER(?)'; params.push(station_code); }
  sql += ' ORDER BY period_month DESC, station_code ASC';
  res.json(db.prepare(sql).all(...params).map(enrich));
});

/** Preview incentive for a contract/period without creating anything. */
router.get('/preview/compute', requireRole(...READ), (req, res) => {
  const { contract_id, period_month } = req.query;
  if (!contract_id || !period_month) {
    return res.status(400).json({ error: 'contract_id and period_month required' });
  }
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const beta = resolveBetaRow(contract, period_month);
  const calc = computeFreqResponseIncentive(
    contract.capacity_charges_total,
    beta?.beta_value,
    contract.project_type,
  );
  const direction = directionForContract(contract);
  const already = billedIncentiveTotal(contract.id, period_month, direction);
  res.json({
    contract_id,
    period_month,
    ...calc,
    beta: beta ? enrich(beta) : null,
    already_billed: already,
    true_up_delta: Math.round((calc.incentive || 0) - already),
  });
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const row = db.prepare('SELECT * FROM station_beta WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beta record not found' });
  res.json(enrich(row));
});

router.post('/', requireRole(...WRITE), (req, res) => {
  const b = req.body || {};
  const contract_id = b.contract_id;
  const period_month = b.period_month;
  const beta_value = Number(b.beta_value);

  if (!contract_id || !period_month) {
    return res.status(400).json({ error: 'contract_id and period_month (YYYY-MM) are required' });
  }
  if (!/^\d{4}-\d{2}$/.test(period_month)) {
    return res.status(400).json({ error: 'period_month must be YYYY-MM' });
  }
  if (!Number.isFinite(beta_value) || beta_value < 0 || beta_value > 1) {
    return res.status(400).json({ error: 'beta_value must be a number between 0 and 1' });
  }

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const existing = db.prepare(`
    SELECT id FROM station_beta WHERE contract_id = ? AND period_month = ?
  `).get(contract_id, period_month);

  if (existing) {
    return res.status(409).json({
      error: `Beta already exists for this contract/period (${existing.id}). Use PUT to update.`,
      id: existing.id,
    });
  }

  const id = newId('BETA');
  db.prepare(`
    INSERT INTO station_beta (
      id, contract_id, period_month, beta_value, station_code, station_name,
      source, certified_on, document_id, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    contract_id,
    period_month,
    beta_value,
    b.station_code || null,
    b.station_name || null,
    b.source || 'NRPC',
    b.certified_on || null,
    b.document_id || null,
    b.notes || null,
    req.user?.name || req.user?.id || null,
  );

  logAudit({
    req, user: req.user, action: 'CREATE', module: 'REIA',
    entityType: 'station_beta', entityId: id,
    details: { contract_id, period_month, beta_value, station_code: b.station_code },
  });

  res.status(201).json(enrich(db.prepare('SELECT * FROM station_beta WHERE id = ?').get(id)));
});

router.put('/:id', requireRole(...WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM station_beta WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Beta record not found' });

  const b = { ...existing, ...req.body };
  const beta_value = Number(b.beta_value);
  if (!Number.isFinite(beta_value) || beta_value < 0 || beta_value > 1) {
    return res.status(400).json({ error: 'beta_value must be a number between 0 and 1' });
  }

  db.prepare(`
    UPDATE station_beta SET
      beta_value = ?, station_code = ?, station_name = ?, source = ?,
      certified_on = ?, document_id = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    beta_value,
    b.station_code || null,
    b.station_name || null,
    b.source || 'NRPC',
    b.certified_on || null,
    b.document_id || null,
    b.notes || null,
    req.params.id,
  );

  logAudit({
    req, user: req.user, action: 'UPDATE', module: 'REIA',
    entityType: 'station_beta', entityId: req.params.id,
    beforeValue: existing, afterValue: req.body,
  });

  res.json(enrich(db.prepare('SELECT * FROM station_beta WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireRole(...WRITE), (req, res) => {
  const existing = db.prepare('SELECT * FROM station_beta WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Beta record not found' });
  db.prepare('DELETE FROM station_beta WHERE id = ?').run(req.params.id);
  logAudit({
    req, user: req.user, action: 'DELETE', module: 'REIA',
    entityType: 'station_beta', entityId: req.params.id, details: existing,
  });
  res.json({ ok: true });
});

/**
 * Generate SUPPLEMENTARY invoice for frequency-response incentive delta
 * when β arrives after provisional/final bills that had ₹0 incentive.
 */
router.post('/:id/true-up', requireRole(...WRITE), (req, res) => {
  const betaRow = db.prepare('SELECT * FROM station_beta WHERE id = ?').get(req.params.id);
  if (!betaRow) return res.status(404).json({ error: 'Beta record not found' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(betaRow.contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  const isHydro = ['Hydro', 'PSP'].includes(contract.project_type);
  if (!isHydro || !contract.capacity_charges_total) {
    return res.status(400).json({
      error: 'Frequency-response true-up applies to Hydro/PSP contracts with monthly capacity charges (AFC/12).',
    });
  }

  const direction = directionForContract(contract);
  const monthlyCap = Number(contract.capacity_charges_total);
  const calc = computeFreqResponseIncentive(monthlyCap, betaRow.beta_value, contract.project_type);
  const already = billedIncentiveTotal(contract.id, betaRow.period_month, direction);
  const delta = Math.round(calc.incentive - already);

  if (!calc.eligible) {
    return res.status(400).json({ error: calc.reason, beta: calc.beta, already_billed: already });
  }
  if (Math.abs(delta) < 1) {
    return res.json({
      ok: true,
      message: 'Incentive already fully billed for this period — no true-up needed.',
      expected: calc.incentive,
      already_billed: already,
      delta: 0,
    });
  }

  const parent = db.prepare(`
    SELECT * FROM invoices
    WHERE contract_id = ? AND billing_period = ? AND direction = ?
      AND status != 'CANCELLED'
    ORDER BY
      CASE invoice_type WHEN 'FINAL' THEN 0 WHEN 'PROVISIONAL' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT 1
  `).get(contract.id, betaRow.period_month, direction);

  const bfr = parent?.billing_family_ref
    || buildBillingFamilyRef(contract.contract_no, betaRow.period_month, direction);

  const breakdown = [
    { code: 'BETA', label: `NRPC β ${Number(betaRow.beta_value).toFixed(2)} (${betaRow.station_code || betaRow.station_name || 'station'})`, value: betaRow.beta_value },
    { code: 'INC', label: calc.reason, value: calc.incentive },
    { code: 'PREV', label: 'Less: incentive already billed', value: -already },
    { code: 'TOTAL', label: 'Net Frequency Response Incentive True-up', value: delta },
  ];

  const id = newId('INV');
  const invoice_no = genInvoiceNo('INV-BETA');
  db.prepare(`
    INSERT INTO invoices (
      id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by
    ) VALUES (
      @id, @invoice_no, @contract_id, 'SUPPLEMENTARY', @direction, @billing_period, 0,
      @tariff_per_unit, 0, 0, @incentive_charges, 0, 0,
      0, 0, 0, 0, 0,
      0, @total_amount, @invoice_breakdown_json, 0, date('now'), 'DRAFT',
      @parent_invoice_id, @billing_family_ref, NULL, @created_by
    )
  `).run({
    id,
    invoice_no,
    contract_id: contract.id,
    direction,
    billing_period: betaRow.period_month,
    tariff_per_unit: contract.tariff_per_unit || 0,
    incentive_charges: delta,
    total_amount: delta,
    invoice_breakdown_json: JSON.stringify(breakdown),
    parent_invoice_id: parent?.id || null,
    billing_family_ref: bfr,
    created_by: req.user?.name || req.user?.id || null,
  });

  logAudit({
    req, user: req.user, action: 'CREATE', module: 'REIA',
    entityType: 'invoice', entityId: id,
    details: { type: 'BETA_TRUE_UP', beta_id: betaRow.id, delta, expected: calc.incentive, already },
  });

  pushNotification({
    role: 'REIA_USER',
    type: 'BETA_TRUE_UP',
    message: `β true-up ${invoice_no}: ₹${delta.toLocaleString('en-IN')} for ${contract.contract_no} / ${betaRow.period_month}`,
  });

  res.status(201).json({
    ok: true,
    invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(id),
    expected_incentive: calc.incentive,
    already_billed: already,
    delta,
    beta: enrich(betaRow),
  });
});

export default router;
