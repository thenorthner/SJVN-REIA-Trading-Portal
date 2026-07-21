import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo, buildBillingFamilyRef, directionForContract } from '../util.js';
import { payableNow, lpsBaseAmount, accruedLps, tieredRebatePct, daysBetween } from '../disputesConstants.js';
import { getParamNumber, getParam } from '../mastersService.js';

const router = Router();
router.use(requireAuth);

function paidTotalFor(invoiceId) {
  return db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(invoiceId).s;
}

function withContract(inv) {
  if (!inv) return inv;
  const contract = db.prepare('SELECT contract_no, contract_type, project_type FROM contracts WHERE id = ?').get(inv.contract_id);
  const paid = paidTotalFor(inv.id);
  const settled = ['PAID', 'CANCELLED', 'DRAFT'].includes(inv.status);
  const accrued = settled
    ? { days_overdue: 0, lps: 0, base: 0 }
    : accruedLps(inv, { annualPct: getParamNumber('lps_annual_pct', 15), asOf: new Date(), paid });
  return {
    ...inv,
    contract_no: contract?.contract_no,
    project_type: contract?.project_type,
    ...payableNow(inv),
    paid_total: paid,
    accrued_lps: accrued.lps,
    days_overdue: accrued.days_overdue,
  };
}

// E/F. Billing & Invoicing + Seller Invoice Management - list
router.get('/', (req, res) => {
  const { status, contract_id, direction, billing_period } = req.query;
  let sql, params = [];
  
  if (req.user.role.startsWith('SELLER')) {
    sql = 'SELECT i.* FROM invoices i JOIN contracts c ON i.contract_id = c.id WHERE c.seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role.startsWith('BUYER')) {
    sql = 'SELECT i.* FROM invoices i JOIN contracts c ON i.contract_id = c.id WHERE c.buyer_id = ?';
    params.push(req.user.linked_entity_id);
  } else {
    sql = 'SELECT i.* FROM invoices i WHERE 1=1';
  }
  
  if (status) { sql += ' AND i.status = ?'; params.push(status); }
  if (contract_id) { sql += ' AND i.contract_id = ?'; params.push(contract_id); }
  if (direction) { sql += ' AND i.direction = ?'; params.push(direction); }
  if (billing_period) { sql += ' AND i.billing_period = ?'; params.push(billing_period); }
  sql += ' ORDER BY i.created_at DESC';
  res.json(db.prepare(sql).all(...params).map(withContract));
});

import { generateInvoicePdf } from '../scripts/invoicePdf.js';

router.get('/:id/pdf', async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
  const seller = db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.seller_id);
  const buyer = db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.buyer_id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Invoice_${inv.invoice_no}.pdf`);

  try {
    await generateInvoicePdf(inv, contract, seller, buyer, res);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
    }
  }
});

router.get('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const approvals = db.prepare('SELECT * FROM invoice_approvals WHERE invoice_id = ? ORDER BY level').all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(req.params.id);
  const disputes = db.prepare('SELECT * FROM disputes WHERE invoice_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...withContract(inv), approvals, payments, disputes });
});

// Automated invoice generation based on contract + locked energy data
// Supports two billing modes:
//   1. CERC Hydro (Capacity + Energy + Incentive - Free Power + NRLDC)
//   2. Simple RE (Energy * Tariff) for Solar/Wind/Hybrid
router.post('/generate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { contract_id, period_month, invoice_type, seller_invoice_ids } = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  // If PSA, resolve parent PPA via allocations
  let ppa_id = contract_id;
  let alloc_percent = 100;
  if (contract.contract_type === 'PSA') {
    const alloc = db.prepare('SELECT ppa_id, allocation_percent FROM contract_allocations WHERE psa_id = ?').get(contract_id);
    if (alloc) {
      ppa_id = alloc.ppa_id;
      alloc_percent = alloc.allocation_percent;
    }
  }

  const energy = db.prepare(`
    SELECT * FROM energy_data WHERE contract_id = ? AND period_month = ?
    ORDER BY
      CASE WHEN ? = 'FINAL' THEN (data_type = 'FINAL') ELSE (data_type = 'PROVISIONAL') END DESC,
      (data_type = 'FINAL') DESC,
      created_at DESC
    LIMIT 1
  `).get(ppa_id, period_month, invoice_type || 'PROVISIONAL');
  
  if (!energy) return res.status(400).json({ error: 'No energy data found for this contract (or parent PPA)/period. Upload energy data first.' });

  const resolvedType = invoice_type || (energy.data_type === 'FINAL' ? 'FINAL' : 'PROVISIONAL');

  if (resolvedType === 'FINAL' && energy.status !== 'LOCKED') {
    return res.status(400).json({ error: 'Cannot generate FINAL invoice because energy data is not LOCKED.' });
  }
  if (resolvedType === 'FINAL' && energy.data_type !== 'FINAL') {
    return res.status(400).json({ error: 'Cannot generate FINAL invoice: no FINAL energy row for this period (provisional must remain separate).' });
  }

  // ──── Billing Calculation Engine ────
  // tariff_per_unit is ₹/kWh (per "unit"); energy is in MWh → convert MWh→kWh (×1000).
  const UNITS_PER_MWH = 1000;
  const allocated_energy_mwh = (energy.energy_mwh * alloc_percent) / 100;
  const allocated_units_kwh = allocated_energy_mwh * UNITS_PER_MWH;
  const breakdown = [];
  let capacityCharges = 0;
  let incentiveCharges = 0;
  let freePowerDeduction = 0;
  let nrldcFees = 0;
  let energyCharges = 0;

  // PSA bills draw energy from the parent PPA — surface that linkage explicitly.
  if (contract.contract_type === 'PSA' && alloc_percent !== 100) {
    breakdown.push({ code: 'SRC', label: `Source PPA Energy (${period_month})`, value: energy.energy_mwh });
    breakdown.push({ code: 'ALLOC', label: `Allocation to this PSA (${alloc_percent}%)`, value: allocated_energy_mwh });
  }

  const isHydro = ['Hydro', 'PSP'].includes(contract.project_type);

  if (isHydro && contract.capacity_charges_total) {
    // ──── CERC Hydro Billing (NJHPS-style) ────
    const normAux = contract.normative_aux || 0; // % e.g. 1.2
    const freePowerPct = contract.free_energy_home_state || 0; // % e.g. 12
    const monthlyCapacity = contract.capacity_charges_total; // AFC/12 in ₹

    // C1: Monthly Capacity Charge (from AFC divided across 12 months)
    capacityCharges = Math.round(monthlyCapacity);
    breakdown.push({ code: 'C1', label: 'Monthly Capacity Charge (AFC/12)', value: capacityCharges });

    // E1: Gross Energy Generation (MWh)
    const grossEnergy = allocated_energy_mwh;
    breakdown.push({ code: 'E1', label: 'Gross Energy Generated (MWh)', value: grossEnergy });

    // E2: Normative Auxiliary Consumption
    const auxEnergy = Math.round(grossEnergy * normAux / 100 * 100) / 100;
    breakdown.push({ code: 'E2', label: `Auxiliary Consumption (${normAux}%)`, value: auxEnergy });

    // E3: Net Energy (ex-bus)
    const netEnergy = Math.round((grossEnergy - auxEnergy) * 100) / 100;
    breakdown.push({ code: 'E3', label: 'Net Energy (Ex-Bus) (MWh)', value: netEnergy });

    // E4: Free Power to Home State
    const freeEnergy = Math.round(netEnergy * freePowerPct / 100 * 100) / 100;
    breakdown.push({ code: 'E4', label: `Free Power Home State (${freePowerPct}%)`, value: freeEnergy });

    // E5: Saleable Energy
    const saleableEnergy = Math.round((netEnergy - freeEnergy) * 100) / 100;
    breakdown.push({ code: 'E5', label: 'Saleable Energy (MWh)', value: saleableEnergy });

    // EE1: Energy Charges = Saleable Energy (kWh) * Tariff (₹/kWh)
    energyCharges = Math.round(saleableEnergy * UNITS_PER_MWH * contract.tariff_per_unit);
    breakdown.push({ code: 'EE1', label: `Energy Charges (${saleableEnergy} MWh × ₹${contract.tariff_per_unit}/unit)`, value: energyCharges });

    // Free Power deduction in ₹ terms (kWh × tariff)
    freePowerDeduction = Math.round(freeEnergy * UNITS_PER_MWH * contract.tariff_per_unit);
    breakdown.push({ code: 'FP', label: 'Free Power Deduction (₹)', value: freePowerDeduction });

    // NRLDC fees from billing master
    const nrldcPerMw = getParamNumber('nrldc_fee_per_mw', 100);
    nrldcFees = Math.round(contract.capacity_mw * nrldcPerMw);
    breakdown.push({ code: 'NR', label: 'NRLDC/SLDC Fees', value: nrldcFees });

  } else {
    // ──── Simple RE Billing (Solar/Wind/Hybrid) ────
    // Charges = energy (kWh) × tariff (₹/kWh)
    energyCharges = Math.round(allocated_units_kwh * contract.tariff_per_unit);
    breakdown.push({ code: 'E1', label: 'Total Energy (MWh)', value: allocated_energy_mwh });
    breakdown.push({ code: 'EE1', label: `Energy Charges (${allocated_energy_mwh} MWh × ₹${contract.tariff_per_unit}/unit)`, value: energyCharges });
  }

  // Trading Margin: per-contract override (contracts.trading_margin_per_mwh) else global billing master default (₹70/MWh).
  const marginPerMwh = (contract.trading_margin_per_mwh != null && contract.trading_margin_per_mwh !== '')
    ? Number(contract.trading_margin_per_mwh)
    : getParamNumber('trading_margin_per_mwh', 70);
  const tradingMargin = contract.contract_type === 'PSA' ? Math.round(allocated_energy_mwh * marginPerMwh) : 0;
  if (tradingMargin) {
    const isOverride = contract.trading_margin_per_mwh != null && contract.trading_margin_per_mwh !== '';
    breakdown.push({ code: 'TM', label: `Trading Margin (₹${marginPerMwh}/MWh${isOverride ? ', contract-specific' : ''})`, value: tradingMargin });
  }

  const penalty = 0;
  const grossTotal = capacityCharges + energyCharges + incentiveCharges + tradingMargin + nrldcFees - freePowerDeduction - penalty;
  breakdown.push({ code: 'GROSS', label: 'Gross Amount (before provisional true-up)', value: grossTotal });

  const direction = directionForContract(contract);
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, period_month, direction);

  let otherAdjustments = 0;
  let parentInvoiceId = null;
  let alreadyPaid = 0;

  if (resolvedType === 'FINAL') {
    const provInvoices = db.prepare(`
      SELECT * FROM invoices
      WHERE contract_id = ? AND billing_period = ? AND direction = ?
        AND invoice_type = 'PROVISIONAL' AND status != 'CANCELLED'
      ORDER BY created_at ASC
    `).all(contract_id, period_month, direction);

    if (provInvoices.length) {
      parentInvoiceId = provInvoices[0].id;
      const ids = provInvoices.map((i) => i.id);
      const placeholders = ids.map(() => '?').join(',');
      alreadyPaid = db.prepare(`
        SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)), 0) AS paid
        FROM payments WHERE invoice_id IN (${placeholders})
      `).get(...ids).paid || 0;
      otherAdjustments = -Math.round(alreadyPaid);
      breakdown.push({
        code: 'ADJ',
        label: `Less: already paid on provisional (${provInvoices.map((i) => i.invoice_no).join(', ')})`,
        value: otherAdjustments,
      });
    }
  }

  const total = grossTotal + otherAdjustments;
  breakdown.push({ code: 'TOTAL', label: 'Net Payable Amount', value: total });

  const id = newId('INV');
  const invoice = {
    id,
    invoice_no: genInvoiceNo(contract.contract_type === 'PPA' ? 'INV-PPA' : 'INV-PSA'),
    contract_id,
    invoice_type: resolvedType,
    direction,
    billing_period: period_month,
    energy_mwh: allocated_energy_mwh,
    tariff_per_unit: contract.tariff_per_unit,
    energy_charges: energyCharges,
    capacity_charges: capacityCharges,
    incentive_charges: incentiveCharges,
    free_power_deduction: freePowerDeduction,
    nrldc_fees: nrldcFees,
    transmission_charges: 0,
    lps: 0,
    penalty,
    trading_margin: tradingMargin,
    taxes: 0,
    other_adjustments: otherAdjustments,
    total_amount: total,
    invoice_breakdown_json: JSON.stringify(breakdown),
    disputed_amount: 0,
    due_date: null,
    status: 'DRAFT',
    parent_invoice_id: parentInvoiceId,
    billing_family_ref: billingFamilyRef,
    energy_data_id: energy.id,
  };
  
  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by)
    VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
      @tariff_per_unit, @energy_charges, @capacity_charges, @incentive_charges, @free_power_deduction, @nrldc_fees,
      @transmission_charges, @lps, @penalty, @trading_margin, @taxes,
      @other_adjustments, @total_amount, @invoice_breakdown_json, @disputed_amount, @due_date, @status,
      @parent_invoice_id, @billing_family_ref, @energy_data_id, @created_by)
  `).run({ ...invoice, created_by: req.user.name });

  // Map to seller invoices (Many-to-Many)
  if (seller_invoice_ids && Array.isArray(seller_invoice_ids)) {
    const insertMapping = db.prepare('INSERT INTO invoice_mapping (buyer_invoice_id, seller_invoice_id) VALUES (?, ?)');
    for (const sid of seller_invoice_ids) {
      insertMapping.run(id, sid);
    }
  }

  logAudit({
    req: typeof req !== "undefined" ? req : null,
    user: req.user,
    action: 'GENERATE',
    module: 'REIA',
    entityType: 'invoice',
    entityId: id,
    details: { ...invoice, already_paid: alreadyPaid },
  });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// Seller invoice submission (manual upload)
router.post('/', requireRole('SELLER', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('INV');
  const total = (b.energy_charges || 0) + (b.transmission_charges || 0) + (b.trading_margin || 0) + (b.taxes || 0) - (b.rebate || 0) + (b.lps || 0) + (b.penalty || 0) + (b.other_adjustments || 0);
  
  // Calculate due date (Net 30 days default)
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  const termsStr = contract ? contract.payment_terms : '';
  const match = (termsStr || '').match(/\d+/);
  const days = match ? parseInt(match[0], 10) : 30;
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);
  const dueDateStr = dueDate.toISOString().split('T')[0];
  const direction = 'SELLER_TO_SJVN';
  const billingFamilyRef = contract
    ? buildBillingFamilyRef(contract.contract_no, b.billing_period, direction)
    : null;

  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, transmission_charges, rebate, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, due_date, status, billing_family_ref, energy_data_id, parent_invoice_id, created_by)
    VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
      @tariff_per_unit, @energy_charges, @transmission_charges, @rebate, @lps, @penalty, @trading_margin, @taxes,
      @other_adjustments, @total_amount, @due_date, 'SUBMITTED', @billing_family_ref, @energy_data_id, @parent_invoice_id, @created_by)
  `).run({
    id,
    invoice_no: b.invoice_no || genInvoiceNo('SELLER-INV'),
    contract_id: b.contract_id,
    invoice_type: b.invoice_type || 'FINAL',
    direction,
    billing_period: b.billing_period,
    energy_mwh: b.energy_mwh,
    tariff_per_unit: b.tariff_per_unit || 0,
    energy_charges: b.energy_charges || 0,
    transmission_charges: b.transmission_charges || 0,
    rebate: b.rebate || 0,
    lps: b.lps || 0,
    penalty: b.penalty || 0,
    trading_margin: b.trading_margin || 0,
    taxes: b.taxes || 0,
    other_adjustments: b.other_adjustments || 0,
    total_amount: total,
    due_date: dueDateStr,
    billing_family_ref: billingFamilyRef,
    energy_data_id: b.energy_data_id || null,
    parent_invoice_id: b.parent_invoice_id || null,
    created_by: req.user.name,
  });
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SUBMIT', module: 'REIA', entityType: 'invoice', entityId: id, details: b });
  pushNotification({ role: 'REIA_USER', type: 'INVOICE_SUBMITTED', message: `Seller invoice ${b.invoice_no || id} submitted for review` });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// G. Invoice Approval Workflow
router.post('/:id/submit-for-approval', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const allowed = ['DRAFT', 'SUBMITTED', 'REJECTED'];
  if (!allowed.includes(inv.status)) {
    return res.status(400).json({
      error: `Cannot submit invoice in status ${inv.status}. Allowed: ${allowed.join(', ')}`,
    });
  }
  db.prepare(`UPDATE invoices SET status = 'UNDER_APPROVAL', updated_at = datetime('now') WHERE id = ?`).run(inv.id);
  const existingLevels = db.prepare('SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ?').get(inv.id).c;
  if (existingLevels === 0) {
    db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), inv.id, 'PENDING');
    db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 2, ?)').run(newId('APR'), inv.id, 'PENDING');
  } else {
    // Reset existing approvals back to PENDING for resubmission
    db.prepare(`UPDATE invoice_approvals SET status = 'PENDING', comments = NULL, acted_at = NULL, approver_name = NULL WHERE invoice_id = ?`).run(inv.id);
  }
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SUBMIT_FOR_APPROVAL', module: 'REIA', entityType: 'invoice', entityId: inv.id });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id));
});

router.post('/:id/approvals/:level/act', requireRole(...ROLE_GROUPS.REIA_WRITE, 'FINANCE_USER'), (req, res) => {
  const { decision, comments } = req.body; // APPROVED | REJECTED
  const approval = db.prepare('SELECT * FROM invoice_approvals WHERE invoice_id = ? AND level = ?').get(req.params.id, req.params.level);
  if (!approval) return res.status(404).json({ error: 'Approval step not found' });
  db.prepare(`UPDATE invoice_approvals SET status = ?, approver_name = ?, comments = ?, acted_at = datetime('now') WHERE id = ?`)
    .run(decision, req.user.name, comments ?? null, approval.id);

  if (decision === 'REJECTED') {
    db.prepare(`UPDATE invoices SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  } else {
    const pending = db.prepare(`SELECT COUNT(*) c FROM invoice_approvals WHERE invoice_id = ? AND status = 'PENDING'`).get(req.params.id).c;
    if (pending === 0) {
      db.prepare(`UPDATE invoices SET status = 'APPROVED', updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
      pushNotification({ role: 'BUYER', type: 'INVOICE_APPROVED', message: `Invoice ${req.params.id} approved and ready for dispatch` });
    }
  }
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: `APPROVAL_${decision}`, module: 'REIA', entityType: 'invoice', entityId: req.params.id, details: { level: req.params.level, comments } });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id));
});

// Submit invoice to L2 (Maker)
router.post('/:id/submit-l2', requireRole('SELLER_L1', 'BUYER_L1', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT status FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'DRAFT') return res.status(400).json({ error: 'Only DRAFT invoices can be submitted to L2' });

  db.prepare("UPDATE invoices SET status = 'PENDING_L2', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req.traceId, 'SUBMIT_L2', 'INVOICES', req.params.id, 'DRAFT', 'PENDING_L2', req.user);
  res.json({ success: true });
});

// Approve invoice from L2 to SJVN (Checker)
router.post('/:id/approve-l2', requireRole('SELLER_L2', 'SELLER_L3', 'BUYER_L2', 'BUYER_L3', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { comments } = req.body;
  const inv = db.prepare('SELECT status FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'PENDING_L2') return res.status(400).json({ error: 'Only PENDING_L2 invoices can be approved by L2' });

  db.prepare("UPDATE invoices SET status = 'SUBMITTED', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req.traceId, 'APPROVE_L2', 'INVOICES', req.params.id, 'PENDING_L2', 'SUBMITTED', req.user);
  res.json({ success: true });
});

// Distribution - mark invoice as sent to buyer
router.post('/:id/send', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status !== 'APPROVED') return res.status(400).json({ error: 'Invoice must be APPROVED before it can be sent' });
  db.prepare(`UPDATE invoices SET status = 'SENT', updated_at = datetime('now') WHERE id = ?`).run(inv.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SEND', module: 'REIA', entityType: 'invoice', entityId: inv.id });
  pushNotification({ role: 'BUYER', type: 'INVOICE_SENT', message: `Invoice ${inv.invoice_no} has been sent for payment` });
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id));
});

// Record payment against invoice (H. Payment Tracking)
router.post('/:id/payments', requireRole(...ROLE_GROUPS.FINANCE, 'BUYER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const { amount, payment_date, mode, reference, deduction } = req.body;
  const id = newId('PAY');
  db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, inv.id, amount, payment_date, mode ?? null, reference ?? null, deduction || 0);

  // Advanced Logic: Rebate and LPS
  let newRebate = inv.rebate;
  let newLps = inv.lps;
  const payDate = payment_date ? new Date(payment_date) : new Date();

  // ── Tiered early-payment rebate (PPA / SELLER_TO_SJVN only, computed once) ──
  // Buyers (DISCOMs) do NOT get early-payment rebate on PSA invoices.
  if (inv.direction === 'SELLER_TO_SJVN' && (inv.rebate || 0) === 0) {
    const daysFromBill = Math.max(0, daysBetween(new Date(inv.created_at), payDate));
    let pct = tieredRebatePct(daysFromBill, getParam('early_payment_rebate_tiers', null));
    if (pct === null) {
      // No tiers configured → fall back to flat % if paid on/before due date
      pct = (inv.due_date && payDate <= new Date(inv.due_date)) ? getParamNumber('early_payment_rebate_pct', 2) : 0;
    }
    if (pct > 0) {
      const base = Math.max(0, inv.total_amount || 0); // full billed amount, not just energy
      newRebate = Math.round(base * pct / 100);
    }
  }

  // ── LPS accrued on OUTSTANDING undisputed amount as of payment date ──
  if (inv.due_date) {
    const paidBefore = db.prepare(
      'SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ? AND id != ?'
    ).get(inv.id, id).s;
    const accrued = accruedLps(inv, { annualPct: getParamNumber('lps_annual_pct', 15), asOf: payDate, paid: paidBefore });
    if (accrued.lps > 0) newLps = accrued.lps;
  }

  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
  
  // Effective payable = original total - rebate + lps - disputed (undisputed always due)
  const effectivePayable = payableNow({ ...inv, rebate: newRebate, lps: newLps }).payable_now;
  
  const newStatus = totalPaid >= effectivePayable ? 'PAID' : 'PARTIALLY_PAID';
  
  db.prepare(`UPDATE invoices SET status = ?, rebate = ?, lps = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newStatus, newRebate, newLps, inv.id);

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'PAYMENT_RECORDED', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: req.body });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id));
});

export default router;
