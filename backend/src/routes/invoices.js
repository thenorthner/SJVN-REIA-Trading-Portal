import { Router } from 'express';
import { resolveTariff } from '../services/tariffStructure.js';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, SELLER_ROLES } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, genInvoiceNo, buildBillingFamilyRef, directionForContract, computeDueDate, resolvePaymentTermsDays, contractRebatePct } from '../util.js';
import { payableNow, lpsBaseAmount, accruedLps, tieredRebatePct, daysBetween } from '../disputesConstants.js';
import { payerStateForInvoice } from '../services/workingCalendar.js';
import { getParamNumber, getParam } from '../mastersService.js';
import { resolveBetaRow } from '../services/betaFactor.js';
import { sendSms } from '../services/smsService.js';
import { channelsFor, dispatch } from '../services/notificationService.js';
import { allocationsInForce } from '../services/allocations.js';
import { contractVisibleTo } from '../services/counterpartyScope.js';
import { computeCercHydroBill } from '../services/cercHydroBilling.js';
import { computeCufPenalty } from '../services/cufPenalty.js';
import {
  compareSellerToSystem,
  findSystemCounterpart,
  persistValidation,
} from '../services/sellerInvoiceMatch.js';
import {
  buildTemplate as buildVerificationTemplate,
  mergeSaved as mergeSavedVerification,
  rollupStatus as rollupVerification,
} from '../services/invoiceVerification.js';

const router = Router();
router.use(requireAuth);

/** Statuses safe to cancel (pre-settlement / pre-dispatch). */
const CANCELABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'REJECTED', 'PENDING_L2', 'UNDER_APPROVAL'];
const OPEN_DISPUTE_STATUSES = ['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED'];

function paidTotalFor(invoiceId) {
  return db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(invoiceId).s;
}

// Developer (PPA / SELLER_TO_SJVN) invoice pipeline per the REIA Dashboard doc:
// Submitted → Under Verification → Commercial Verification → Finance Approval →
// Approved → Payment Released. Derived from existing signals (verification,
// approval status, payment) so every invoice reflects a real stage.
const DEV_STAGES = ['SUBMITTED', 'UNDER_VERIFICATION', 'COMMERCIAL_VERIFICATION', 'FINANCE_APPROVAL', 'APPROVED', 'PAYMENT_RELEASED'];
function computeDevStage(inv) {
  if (inv.status === 'PAID') return 'PAYMENT_RELEASED';
  if (['APPROVED', 'SENT', 'PARTIALLY_PAID'].includes(inv.status)) return 'APPROVED';
  if (['UNDER_APPROVAL', 'PENDING_L2'].includes(inv.status)) return 'FINANCE_APPROVAL';
  if (inv.verification_status === 'VERIFIED') return 'COMMERCIAL_VERIFICATION';
  if (['IN_PROGRESS', 'FAILED'].includes(inv.verification_status)) return 'UNDER_VERIFICATION';
  return 'SUBMITTED';
}

// Pass-through "other charges" (transmission / RLDC-SLDC / CTU-STU / open access /
// scheduling). Rebate is NOT allowed on these (PSA Art. 6.4).
const OTHER_CHARGE_TYPES = {
  TRANSMISSION: 'Transmission / wheeling charges',
  RLDC_SLDC: 'RLDC / SLDC charges',
  CTU_STU: 'CTU / STU charges',
  OPEN_ACCESS: 'Open access charges',
  SCHEDULING: 'Scheduling & system operation charges',
  OTHER: 'Other pass-through charges',
};
function parseOtherCharges(inv) {
  try { return JSON.parse(inv.other_charges_json || '[]'); } catch { return []; }
}
function otherChargesSum(inv) {
  return parseOtherCharges(inv).reduce((a, c) => a + (Number(c.amount) || 0), 0);
}

function withContract(inv) {
  if (!inv) return inv;
  const contract = db.prepare('SELECT contract_no, contract_type, project_type, lps_annual_pct, lps_grace_days FROM contracts WHERE id = ?').get(inv.contract_id);
  const paid = paidTotalFor(inv.id);
  const settled = ['PAID', 'CANCELLED', 'DRAFT'].includes(inv.status);
  const accrued = settled
    ? { days_overdue: 0, lps: 0, base: 0 }
    : accruedLps(inv, {
        annualPct: contract?.lps_annual_pct ?? getParamNumber('lps_annual_pct', 15),
        graceDays: contract?.lps_grace_days ?? 0,
        monthlyStepPct: getParamNumber('lps_monthly_step_pct', 0.5),
        stepCapPct: getParamNumber('lps_step_cap_pct', 3),
        asOf: new Date(), paid,
        state: payerStateForInvoice(inv),
      });
  return {
    ...inv,
    contract_no: contract?.contract_no,
    project_type: contract?.project_type,
    ...payableNow(inv),
    paid_total: paid,
    accrued_lps: accrued.lps,
    days_overdue: accrued.days_overdue,
    dev_stage: inv.direction === 'SELLER_TO_SJVN' ? computeDevStage(inv) : null,
    dev_stages: inv.direction === 'SELLER_TO_SJVN' ? DEV_STAGES : null,
    other_charges: parseOtherCharges(inv),
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

import { generateInvoicePdf, generateInvoicePdfBuffer } from '../scripts/invoicePdf.js';
import { sendMail, formatInvoiceEmail } from '../services/mailService.js';

router.get('/:id/pdf', async (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
  const seller = db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.seller_id);
  const buyer = db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.buyer_id);

  // Counterparties may only download their own invoices (same scoping as the list).
  if (req.user.role.startsWith('SELLER') && contract.seller_id !== req.user.linked_entity_id) {
    return res.status(403).json({ error: 'You can only download your own invoices' });
  }
  if (req.user.role.startsWith('BUYER') && contract.buyer_id !== req.user.linked_entity_id) {
    return res.status(403).json({ error: 'You can only download your own invoices' });
  }

  // Hydro/PSP PPA bills carry a beneficiary-allocation page — how the plant's
  // charges split across the DISCOMs allocated to it (per REA / NRPC order),
  // using the allocation effective for the billing month.
  let beneficiaries = [];
  if (['Hydro', 'PSP'].includes(contract?.project_type) && contract.contract_type === 'PPA') {
    const pStart = `${inv.billing_period}-01`;
    const pEnd = `${inv.billing_period}-31`;
    const rows = db.prepare(`
      SELECT b.name AS name, ca.allocation_percent AS allocation_percent
      FROM contract_allocations ca
      JOIN contracts s ON s.id = ca.psa_id
      LEFT JOIN entities b ON b.id = s.buyer_id
      WHERE ca.ppa_id = ?
        AND ca.effective_from <= ?
        AND (ca.effective_to IS NULL OR ca.effective_to >= ?)
      ORDER BY ca.allocation_percent DESC
    `).all(contract.id, pEnd, pStart);
    const total = Number(inv.total_amount) || 0;
    beneficiaries = rows.map((x) => ({ ...x, share: Math.round(total * (Number(x.allocation_percent) || 0) / 100) }));
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Invoice_${inv.invoice_no}.pdf`);

  try {
    await generateInvoicePdf(inv, contract, seller, buyer, res, beneficiaries);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate PDF', details: err.message });
    }
  }
});

// Preview a buyer's outstanding position (for the waterfall payment modal).
// Must be declared before '/:id' so it isn't captured as an invoice id.
router.get('/buyer-outstanding', requireRole(...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE), (req, res) => {
  const { buyer_id } = req.query;
  if (!buyer_id) return res.status(400).json({ error: 'buyer_id is required' });
  const items = buyerOutstanding(buyer_id).map((x) => ({
    invoice_no: x.inv.invoice_no, billing_period: x.inv.billing_period, lps: x.lps, principal: x.principal, due: x.lps + x.principal,
  }));
  res.json({
    items,
    total_lps: items.reduce((a, i) => a + i.lps, 0),
    total_principal: items.reduce((a, i) => a + i.principal, 0),
    total_due: items.reduce((a, i) => a + i.due, 0),
  });
});

router.get('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  // Same scoping the list has always applied. Without it the id in the URL was
  // the only thing keeping a counterparty out of someone else's bill — and the
  // payload carries the totals, payments and open disputes with it.
  const contract = db.prepare('SELECT seller_id, buyer_id FROM contracts WHERE id = ?').get(inv.contract_id);
  if (!contractVisibleTo(req.user, contract)) return res.status(404).json({ error: 'Invoice not found' });

  const approvals = db.prepare('SELECT * FROM invoice_approvals WHERE invoice_id = ? ORDER BY level').all(req.params.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date').all(req.params.id);
  const disputes = db.prepare('SELECT * FROM disputes WHERE invoice_id = ? ORDER BY created_at DESC').all(req.params.id);

  // For developer (PPA) invoices, expose how much DISCOM realization is available
  // to fund a pay-when-paid release, net of what's already been released from it.
  let generator_realization = null;
  if (inv.direction === 'SELLER_TO_SJVN') {
    const { realized, linked_psa } = generatorRealization(inv.id);
    const fromRealization = db.prepare(
      "SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id = ? AND release_source = 'DISCOM_REALIZATION'"
    ).get(inv.id).s;
    generator_realization = { linked_psa, realized, released_from_realization: Math.round(fromRealization), available: Math.max(0, realized - Math.round(fromRealization)) };
  }
  res.json({ ...withContract(inv), approvals, payments, disputes, generator_realization });
});

// Automated invoice generation based on contract + locked energy data
// Supports two billing modes:
//   1. CERC Hydro (Capacity + Energy + Incentive - Free Power + NRLDC)
//   2. Simple RE (Energy * Tariff) for Solar/Wind/Hybrid
// A refusal that carries the status the route should answer with.
function refuse(status, payload) {
  const err = new Error(payload.error || 'Request refused');
  err.status = status;
  err.payload = payload;
  return err;
}

// Build and persist one invoice for a contract and period. Extracted from the
// route so a PPA can fan out into one invoice per PSA without duplicating any
// of the pricing. Refusals throw with a status the caller turns into a response.
function generateInvoiceFor({ contract_id, period_month, invoice_type, seller_invoice_ids }, req) {

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) throw refuse(404, { error: 'Contract not found' });

  // A contract is only billable once it is live. Billing one still in
  // negotiation or awaiting regulatory approval raises a demand the counterparty
  // has no obligation to meet.
  const BILLABLE_STATUSES = ['ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'AMENDED'];
  if (!BILLABLE_STATUSES.includes(contract.status)) {
    throw refuse(400, {
      error: `Cannot bill a contract in status ${contract.status} — it must be ACTIVE first.`,
    });
  }

  // Nothing is billable before commercial operation, whatever energy was
  // recorded during testing and commissioning.
  if (contract.cod_date && period_month) {
    const periodEnd = `${period_month}-31`;
    if (String(contract.cod_date) > periodEnd) {
      throw refuse(400, {
        error: `Cannot bill ${period_month}: it ends before the commercial operation date (${contract.cod_date}).`,
      });
    }
  }

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
  
  if (!energy) throw refuse(400, { error: 'No energy data found for this contract (or parent PPA)/period. Upload energy data first.' });

  const resolvedType = invoice_type || (energy.data_type === 'FINAL' ? 'FINAL' : 'PROVISIONAL');

  if (resolvedType === 'FINAL' && energy.status !== 'LOCKED') {
    throw refuse(400, { error: 'Cannot generate FINAL invoice because energy data is not LOCKED.' });
  }
  if (resolvedType === 'FINAL' && energy.data_type !== 'FINAL') {
    throw refuse(400, { error: 'Cannot generate FINAL invoice: no FINAL energy row for this period (provisional must remain separate).' });
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
  let appliedTariff = contract.tariff_per_unit;
  let transmissionCharges = 0;
  let deemedEnergyMwh = 0;
  let deemedCharges = 0;

  if (isHydro && (contract.annual_afc || contract.capacity_charges_total || contract.annual_design_energy_mwh)) {
    // ──── CERC Hydro Billing (NJHPS-style) ────
    const betaRow = resolveBetaRow(contract, period_month);
    const hydro = computeCercHydroBill({
      contract,
      periodMonth: period_month,
      exBusEnergyMwh: allocated_energy_mwh,
      pafmPercent: energy.availability_percent,
      betaValue: betaRow?.beta_value,
    });

    capacityCharges = hydro.capacityCharges;
    energyCharges = hydro.energyCharges;
    incentiveCharges = hydro.incentiveCharges;
    freePowerDeduction = 0; // saleable already excludes free power
    appliedTariff = hydro.ecr;

    breakdown.push({ code: 'A1', label: 'Annual Fixed Charges (AFC)', value: hydro.afc, format: 'currency' });
    if (hydro.de) breakdown.push({ code: 'A2', label: 'Annual Design Energy (DE) MWh', value: hydro.de, format: 'mwh' });
    breakdown.push({ code: 'A3', label: `Normative Auxiliary (AUX)`, value: hydro.aux, format: 'pct' });
    breakdown.push({ code: 'A4', label: `Free Energy Home State (FEHS)`, value: hydro.fehs, format: 'pct' });
    breakdown.push({ code: 'A11', label: 'NAPAF %', value: hydro.napaf, format: 'pct' });
    breakdown.push({ code: 'A12', label: `Energy Charge Rate (ECR) ₹/kWh`, value: hydro.ecr, format: 'ecr' });

    breakdown.push({ code: 'C2', label: hydro.capacityLabel, value: capacityCharges });
    breakdown.push({
      code: 'C3',
      label: betaRow
        ? `Beta Factor β ${Number(betaRow.beta_value).toFixed(2)}${betaRow.station_code ? ` (${betaRow.station_code})` : ''}${betaRow.certified_on ? ` · certified ${betaRow.certified_on}` : ''}`
        : 'Beta Factor β — pending NRPC certificate',
      value: betaRow ? Number(betaRow.beta_value) : 0,
      format: 'beta',
    });
    breakdown.push({
      code: 'C4',
      label: `Incentive on account of Beta — ${hydro.beta.reason}`,
      value: incentiveCharges,
    });
    breakdown.push({
      code: 'C5',
      label: 'Total Capacity Charges (incl. Beta Incentive)',
      value: capacityCharges + incentiveCharges,
    });

    breakdown.push({ code: 'E1', label: 'Ex-bus Scheduled Energy (MWh)', value: hydro.e1 });
    breakdown.push({ code: 'E2', label: `Free Power Home State (${hydro.fehs}%)`, value: hydro.freeMwh });
    breakdown.push({ code: 'E3', label: 'Ex-bus Saleable Scheduled Energy (MWh)', value: hydro.saleableMwh });
    breakdown.push({
      code: 'EE1',
      label: `Energy Charges (${hydro.saleableMwh} MWh × ₹${hydro.ecr}/kWh)`,
      value: energyCharges,
    });

    const nrldcPerMw = getParamNumber('nrldc_fee_per_mw', 100);
    nrldcFees = Math.round((contract.capacity_mw || 0) * nrldcPerMw);
    if (nrldcFees) breakdown.push({ code: 'NR', label: 'NRLDC/SLDC Fees', value: nrldcFees });

  } else {
    // ──── Simple RE Billing (Solar/Wind/Hybrid) ────
    // The rate comes from the contract's tariff structure, so an escalating or
    // two-part contract is billed on its actual terms rather than its base rate.
    const tariff = resolveTariff(contract, period_month);
    appliedTariff = tariff.rate;
    energyCharges = Math.round(allocated_units_kwh * tariff.rate);
    breakdown.push({ code: 'E1', label: 'Total Energy (MWh)', value: allocated_energy_mwh });
    if (tariff.type !== 'FLAT') breakdown.push({ code: 'TS', label: tariff.label, value: tariff.rate, format: 'ecr' });
    breakdown.push({ code: 'EE1', label: `Energy Charges (${allocated_energy_mwh} MWh × ₹${tariff.rate}/unit)`, value: energyCharges });
    // Deemed generation: energy the seller stood ready to deliver but the buyer
    // or grid could not take. It is paid for at the same rate, on its own line,
    // so it is never mistaken for energy that actually flowed.
    const deemedMwh = Number(energy.deemed_generation_mwh) || 0;
    if (deemedMwh > 0) {
      deemedEnergyMwh = Number(((deemedMwh * alloc_percent) / 100).toFixed(3));
      deemedCharges = Math.round(deemedEnergyMwh * UNITS_PER_MWH * tariff.rate);
      breakdown.push({
        code: 'DG',
        label: `Deemed Generation (${deemedEnergyMwh} MWh × ₹${tariff.rate}/unit) — not delivered, payable under PPA`,
        value: deemedCharges,
      });
    }
    if (tariff.fixed_charge > 0) {
      // The fixed leg of a two-part tariff is a capacity charge, shown separately
      // from the energy it is billed alongside.
      capacityCharges = tariff.fixed_charge;
      breakdown.push({ code: 'C1', label: `Fixed / Capacity Charge (${tariff.label})`, value: capacityCharges });
    }
  }

  // Transmission / wheeling: contract override → master default (₹/MWh)
  const txPerMwh = (contract.transmission_charge_per_mwh != null && contract.transmission_charge_per_mwh !== '')
    ? Number(contract.transmission_charge_per_mwh)
    : getParamNumber('transmission_charge_per_mwh', 0);
  transmissionCharges = txPerMwh > 0 ? Math.round(allocated_energy_mwh * txPerMwh) : 0;
  if (transmissionCharges) {
    breakdown.push({ code: 'TX', label: `Transmission / Wheeling (₹${txPerMwh}/MWh)`, value: transmissionCharges });
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

  // GST on the taxable service component (trading margin). Sale of electricity
  // itself is GST-exempt (HSN 2716), so energy & capacity charges are never
  // taxed. Default rate is 0 → no GST line, matching real energy bills.
  const gstRate = getParamNumber('gst_rate_percent', 0);
  const gstAmount = gstRate > 0 ? Math.round(tradingMargin * gstRate / 100) : 0;
  if (gstAmount) {
    breakdown.push({ code: 'GST', label: `GST @ ${gstRate}% (on trading margin; energy is exempt)`, value: gstAmount });
  }

  // CUF shortfall penalty (Solar/Wind/Hybrid only — Hydro capacity already uses PAFM/NAPAF).
  const cufPen = computeCufPenalty({
    contract,
    periodMonth: period_month,
    energyMwh: allocated_energy_mwh,
    capacityMw: contract.capacity_mw,
    cufPercent: energy.cuf_percent,
    tariffPerUnit: appliedTariff || contract.tariff_per_unit,
  });
  const penalty = cufPen.penalty || 0;
  if (cufPen.applicable && cufPen.breakdown && penalty > 0) {
    breakdown.push(cufPen.breakdown);
  } else if (cufPen.applicable && cufPen.label && penalty === 0 && cufPen.actualCuf != null) {
    breakdown.push({
      code: 'PEN',
      label: cufPen.label,
      value: 0,
    });
  }

  const grossTotal = capacityCharges + energyCharges + deemedCharges + incentiveCharges + tradingMargin + nrldcFees + transmissionCharges + gstAmount - freePowerDeduction - penalty;
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
    tariff_per_unit: appliedTariff,
    energy_charges: energyCharges,
    capacity_charges: capacityCharges,
    incentive_charges: incentiveCharges,
    free_power_deduction: freePowerDeduction,
    nrldc_fees: nrldcFees,
    transmission_charges: transmissionCharges,
    deemed_energy_mwh: deemedEnergyMwh,
    deemed_charges: deemedCharges,
    lps: 0,
    penalty,
    trading_margin: tradingMargin,
    taxes: gstAmount,
    other_adjustments: otherAdjustments,
    total_amount: total,
    invoice_breakdown_json: JSON.stringify(breakdown),
    disputed_amount: 0,
    // Due date = bill date (today) + the contract's payment terms. Falls back to
    // the global master default when the contract carries no structured terms.
    due_date: computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30)),
    status: 'DRAFT',
    parent_invoice_id: parentInvoiceId,
    billing_family_ref: billingFamilyRef,
    energy_data_id: energy.id,
  };
  
  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, deemed_energy_mwh, deemed_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by)
    VALUES (@id, @invoice_no, @contract_id, @invoice_type, @direction, @billing_period, @energy_mwh,
      @tariff_per_unit, @energy_charges, @capacity_charges, @incentive_charges, @free_power_deduction, @nrldc_fees,
      @transmission_charges, @deemed_energy_mwh, @deemed_charges, @lps, @penalty, @trading_margin, @taxes,
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
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
}

// Arrear bill — a manual recovery bill for a past period (charges missed / under-billed
// earlier, e.g. retrospective tariff order, delayed adjustment). Mirrors SAP bill type 'A'.

router.post('/generate', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { contract_id, period_month, split_by_allocation } = req.body;

  try {
    // A PPA can be billed out to each PSA it feeds rather than as one invoice.
    // Every invoice raised this way carries the same billing family reference, so
    // the set is traceable back to the one PPA period it came from.
    if (split_by_allocation) {
      const ppa = db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PPA'`).get(contract_id);
      if (!ppa) return res.status(404).json({ error: 'PPA not found — split_by_allocation applies to a PPA' });

      const allocations = allocationsInForce(ppa.id, period_month);
      if (!allocations.length) {
        return res.status(400).json({ error: `No PSA allocation is in force for ${period_month}.` });
      }

      const familyRef = buildBillingFamilyRef(ppa.contract_no, period_month, 'SJVN_TO_BUYER');
      const raised = [];
      const failed = [];
      db.transaction(() => {
        for (const alloc of allocations) {
          try {
            const inv = generateInvoiceFor({ ...req.body, contract_id: alloc.psa_id }, req);
            // Tie every invoice in the set to the source PPA period.
            db.prepare('UPDATE invoices SET billing_family_ref = ? WHERE id = ?').run(familyRef, inv.id);
            raised.push({ ...inv, billing_family_ref: familyRef, allocation_percent: alloc.allocation_percent });
          } catch (err) {
            if (!err.status) throw err;
            failed.push({ psa_id: alloc.psa_id, error: err.payload?.error || err.message });
          }
        }
        // All or nothing: a partial fan-out would bill some buyers for a period
        // and silently leave others unbilled.
        if (failed.length) throw refuse(400, { error: 'Could not bill every PSA for this period', failed });
      })();

      return res.status(201).json({ billing_family_ref: familyRef, invoices: raised, count: raised.length });
    }

    res.status(201).json(generateInvoiceFor(req.body, req));
  } catch (err) {
    if (err.status) return res.status(err.status).json(err.payload);
    throw err;
  }
});

router.post('/arrear', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { contract_id, arrear_period, amount, taxes, reason } = req.body;
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const amt = Number(amount);
  if (!arrear_period) return res.status(400).json({ error: 'arrear_period (YYYY-MM being recovered) is required' });
  if (!Number.isFinite(amt) || amt === 0) return res.status(400).json({ error: 'A non-zero arrear amount is required' });
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'A reason for the arrear is required' });

  const taxAmt = Number(taxes) || 0;
  const total = Math.round(amt + taxAmt);
  const direction = directionForContract(contract);
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, arrear_period, direction);
  const id = newId('INV');
  const breakdown = [
    { code: 'ARR', label: `Arrear recovery for ${arrear_period} — ${reason.trim()}`, value: Math.round(amt) },
  ];
  if (taxAmt) breakdown.push({ code: 'TAX', label: 'Taxes / GST on arrear', value: Math.round(taxAmt) });
  breakdown.push({ code: 'GROSS', label: 'Arrear Bill Total', value: total });

  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by)
    VALUES (@id, @invoice_no, @contract_id, 'ARREAR', @direction, @billing_period, 0,
      0, @energy_charges, 0, 0, 0, 0,
      0, 0, 0, 0, @taxes,
      0, @total_amount, @invoice_breakdown_json, 0, @due_date, 'DRAFT',
      NULL, @billing_family_ref, NULL, @created_by)
  `).run({
    id,
    invoice_no: genInvoiceNo(contract.contract_type === 'PPA' ? 'ARR-PPA' : 'ARR-PSA'),
    contract_id,
    direction,
    billing_period: arrear_period,
    energy_charges: Math.round(amt),
    taxes: taxAmt,
    total_amount: total,
    invoice_breakdown_json: JSON.stringify(breakdown),
    due_date: computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30)),
    billing_family_ref: billingFamilyRef,
    created_by: req.user.name,
  });
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');
  logAudit({ req, user: req.user, action: 'GENERATE_ARREAR', module: 'REIA', entityType: 'invoice', entityId: id, details: { contract_id, arrear_period, amount: amt, taxes: taxAmt, reason } });
  pushNotification({ role: 'REIA_USER', type: 'ARREAR_RAISED', message: `Arrear bill raised for ${contract.contract_no} (${arrear_period}): ₹${total.toLocaleString('en-IN')}` });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// Explicit supplementary-bill triggers per the REIA workflow (Supplementary
// Billing): Change in Law / Revised REA / Transmission Charges / LPS. Legacy
// codes are kept so older supplementary invoices still validate.
const SUPP_REASONS = [
  'REVISED_REA',
  'CHANGE_IN_LAW',
  'TRANSMISSION_CHARGES',
  'LPS',
  'BETA_TRUE_UP',
  'OTHER',
  // legacy aliases
  'TARIFF_REVISION',
  'ENERGY_REVISION',
  'LPS_ADJUSTMENT',
];

/**
 * Manual Supplementary invoice — tariff revision / change-in-law / energy revision / etc.
 * Distinct from dispute auto-credit supplementary (which still uses its own path).
 */
router.post('/supplementary', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const {
    contract_id,
    billing_period,
    amount,
    taxes,
    reason_code,
    reason,
    parent_invoice_id,
    transmission_charges,
  } = req.body;

  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract_id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  if (!billing_period || !/^\d{4}-\d{2}$/.test(billing_period)) {
    return res.status(400).json({ error: 'billing_period (YYYY-MM) is required' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    return res.status(400).json({ error: 'A non-zero adjustment amount is required' });
  }
  const code = reason_code || 'OTHER';
  if (!SUPP_REASONS.includes(code)) {
    return res.status(400).json({ error: `reason_code must be one of: ${SUPP_REASONS.join(', ')}` });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason description is required' });
  }
  if (code === 'OTHER' && String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'Please provide a clearer reason for OTHER' });
  }

  let parentId = parent_invoice_id || null;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM invoices WHERE id = ? AND contract_id = ?').get(parentId, contract_id);
    if (!parent) return res.status(400).json({ error: 'parent_invoice_id not found for this contract' });
  }

  const taxAmt = Number(taxes) || 0;
  const txAmt = Number(transmission_charges) || 0;
  const total = Math.round(amt + taxAmt + txAmt);
  const direction = directionForContract(contract);
  const billingFamilyRef = buildBillingFamilyRef(contract.contract_no, billing_period, direction);
  const id = newId('INV');
  const reasonLabel = {
    REVISED_REA: 'Revised / amended REA true-up',
    CHANGE_IN_LAW: 'Change in Law',
    TRANSMISSION_CHARGES: 'Transmission / wheeling charges',
    LPS: 'Late Payment Surcharge',
    BETA_TRUE_UP: 'Frequency response β true-up',
    OTHER: 'Other adjustment',
    // legacy aliases
    TARIFF_REVISION: 'Tariff revision',
    ENERGY_REVISION: 'Energy revision / true-up',
    LPS_ADJUSTMENT: 'LPS adjustment',
  }[code] || 'Adjustment';

  const breakdown = [
    { code: 'SUPP', label: `${reasonLabel} — ${String(reason).trim()}`, value: Math.round(amt) },
  ];
  if (txAmt) breakdown.push({ code: 'TX', label: 'Transmission / wheeling on adjustment', value: Math.round(txAmt) });
  if (taxAmt) breakdown.push({ code: 'TAX', label: 'Taxes / GST on adjustment', value: Math.round(taxAmt) });
  breakdown.push({ code: 'TOTAL', label: 'Supplementary Bill Total', value: total });

  db.prepare(`
    INSERT INTO invoices (id, invoice_no, contract_id, invoice_type, direction, billing_period, energy_mwh,
      tariff_per_unit, energy_charges, capacity_charges, incentive_charges, free_power_deduction, nrldc_fees,
      transmission_charges, lps, penalty, trading_margin, taxes,
      other_adjustments, total_amount, invoice_breakdown_json, disputed_amount, due_date, status,
      parent_invoice_id, billing_family_ref, energy_data_id, created_by)
    VALUES (@id, @invoice_no, @contract_id, 'SUPPLEMENTARY', @direction, @billing_period, 0,
      0, @energy_charges, 0, 0, 0, 0,
      @transmission_charges, 0, 0, 0, @taxes,
      0, @total_amount, @invoice_breakdown_json, 0, @due_date, 'DRAFT',
      @parent_invoice_id, @billing_family_ref, NULL, @created_by)
  `).run({
    id,
    invoice_no: genInvoiceNo(contract.contract_type === 'PPA' ? 'SUPP-PPA' : 'SUPP-PSA'),
    contract_id,
    direction,
    billing_period,
    energy_charges: Math.round(amt),
    transmission_charges: Math.round(txAmt),
    taxes: taxAmt,
    total_amount: total,
    invoice_breakdown_json: JSON.stringify(breakdown),
    due_date: computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30)),
    parent_invoice_id: parentId,
    billing_family_ref: billingFamilyRef,
    created_by: req.user.name,
  });
  db.prepare('INSERT INTO invoice_approvals (id, invoice_id, level, status) VALUES (?, ?, 1, ?)').run(newId('APR'), id, 'PENDING');
  logAudit({
    req, user: req.user, action: 'GENERATE_SUPPLEMENTARY', module: 'REIA', entityType: 'invoice', entityId: id,
    details: { contract_id, billing_period, amount: amt, taxes: taxAmt, reason_code: code, reason },
  });
  pushNotification({
    role: 'REIA_USER',
    type: 'SUPPLEMENTARY_RAISED',
    message: `Supplementary bill for ${contract.contract_no} (${billing_period}): ₹${total.toLocaleString('en-IN')} — ${reasonLabel}`,
  });
  res.status(201).json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
});

// Seller invoice submission (manual upload)
router.post('/', requireRole('SELLER', ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const b = req.body;
  const id = newId('INV');
  const total = (b.energy_charges || 0) + (b.transmission_charges || 0) + (b.trading_margin || 0) + (b.taxes || 0) - (b.rebate || 0) + (b.lps || 0) + (b.penalty || 0) + (b.other_adjustments || 0);
  
  // Due date = bill date + the contract's structured payment terms (fallback 30d).
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(b.contract_id);
  const dueDateStr = computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30));
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

  // Auto-validate against system counterpart when one exists for this period.
  let created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  const systemCounterpart = findSystemCounterpart(created);
  if (systemCounterpart) {
    const match = compareSellerToSystem(created, systemCounterpart);
    created = persistValidation(id, match, { userName: req.user.name || 'auto' });
  } else {
    db.prepare(`
      UPDATE invoices SET validation_status = 'PENDING', updated_at = datetime('now') WHERE id = ?
    `).run(id);
    created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  }

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'SUBMIT', module: 'REIA', entityType: 'invoice', entityId: id, details: { ...b, validation_status: created.validation_status } });
  pushNotification({ role: 'REIA_USER', type: 'INVOICE_SUBMITTED', message: `Seller invoice ${b.invoice_no || id} submitted for review` });
  res.status(201).json(created);
});

// Cancel / reverse — REIA only; safe pre-settlement statuses
router.post('/:id/cancel', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Invoice is already cancelled' });
  }
  if (!CANCELABLE_STATUSES.includes(inv.status)) {
    return res.status(400).json({
      error: `Cannot cancel invoice in status ${inv.status}. Allowed: ${CANCELABLE_STATUSES.join(', ')}`,
    });
  }

  const paid = paidTotalFor(inv.id);
  if (paid > 0) {
    return res.status(400).json({ error: 'Cannot cancel invoice with recorded payments' });
  }

  const openDisputes = db.prepare(`
    SELECT COUNT(*) c FROM disputes
    WHERE invoice_id = ? AND status IN (${OPEN_DISPUTE_STATUSES.map(() => '?').join(',')})
  `).get(inv.id, ...OPEN_DISPUTE_STATUSES).c;
  if (openDisputes > 0) {
    return res.status(400).json({ error: 'Cannot cancel invoice with open disputes — resolve or close them first' });
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Cancel reason is required' });

  db.prepare(`
    UPDATE invoices SET
      status = 'CANCELLED',
      cancel_reason = ?,
      cancelled_at = datetime('now'),
      cancelled_by = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(reason, req.user.name || req.user.email || null, inv.id);

  // Block further approval progress on cancelled bills
  db.prepare(`
    UPDATE invoice_approvals SET status = 'REJECTED', comments = ?, acted_at = datetime('now'), approver_name = ?
    WHERE invoice_id = ? AND status = 'PENDING'
  `).run(`Cancelled: ${reason}`, req.user.name || 'system', inv.id);

  logAudit({
    req, user: req.user, action: 'CANCEL', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    beforeValue: { status: inv.status },
    afterValue: { status: 'CANCELLED' },
    reason,
  });
  pushNotification({
    role: 'REIA_USER',
    type: 'INVOICE_CANCELLED',
    message: `Invoice ${inv.invoice_no} cancelled by ${req.user.name || 'REIA'}: ${reason}`,
  });

  res.json(withContract(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id)));
});

// Validate seller invoice vs system-generated counterpart
router.post('/:id/validate', requireRole(...ROLE_GROUPS.REIA_WRITE, ...SELLER_ROLES), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot validate a cancelled invoice' });
  }
  if (inv.direction !== 'SELLER_TO_SJVN') {
    return res.status(400).json({ error: 'Validation applies to seller invoices (SELLER_TO_SJVN) only' });
  }

  const result = compareSellerToSystem(inv);
  if (result.status === 'NO_COUNTERPART') {
    const updated = persistValidation(inv.id, result, { userName: req.user.name });
    return res.status(400).json({
      error: 'No system counterpart invoice found for this contract and billing period',
      validation: result,
      invoice: withContract(updated),
    });
  }

  const updated = persistValidation(inv.id, result, { userName: req.user.name });
  logAudit({
    req, user: req.user, action: 'VALIDATE', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    details: { status: result.status, system_invoice_id: result.system_invoice_id },
  });
  res.json({ ...withContract(updated), validation: result });
});

// Waive a mismatch / partial validation (REIA only)
router.post('/:id/validation/waive', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot waive validation on a cancelled invoice' });
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Waive reason is required' });

  let prior = null;
  try { prior = inv.validation_json ? JSON.parse(inv.validation_json) : null; } catch { /* ignore */ }
  const base = prior && prior.lines
    ? { ...prior, status: 'WAIVED' }
    : { ...compareSellerToSystem(inv), status: 'WAIVED' };

  const updated = persistValidation(inv.id, { ...base, status: 'WAIVED' }, {
    userName: req.user.name,
    waiveReason: reason,
  });

  logAudit({
    req, user: req.user, action: 'VALIDATION_WAIVE', module: 'REIA', entityType: 'invoice', entityId: inv.id,
    reason,
    details: { prior_status: inv.validation_status },
  });
  pushNotification({
    role: 'REIA_USER',
    type: 'INVOICE_VALIDATION_WAIVED',
    message: `Validation waived for ${inv.invoice_no}: ${reason}`,
  });

  let validation = null;
  try { validation = updated.validation_json ? JSON.parse(updated.validation_json) : null; } catch { /* ignore */ }
  res.json({ ...withContract(updated), validation });
});

// ── Structured Verification Checklist (Technical + Commercial) ──────────────
// GET returns the saved checklist overlaid on a fresh auto-derived template so
// the auto-hints (REA/energy/tariff/CUF/COD) stay current.
router.get('/:id/verification', requireRole(...ROLE_GROUPS.REIA_ALL, ...SELLER_ROLES), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const template = buildVerificationTemplate(inv);
  let saved = null;
  try { saved = inv.verification_json ? JSON.parse(inv.verification_json) : null; } catch { /* ignore */ }
  const merged = mergeSavedVerification(template, saved);
  res.json({
    ...merged,
    verification_status: inv.verification_status || rollupVerification(merged.technical),
    verified_at: inv.verified_at, verified_by: inv.verified_by,
  });
});

router.post('/:id/verification', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const template = buildVerificationTemplate(inv);
  // Only accept known technical keys / commercial fields — recompute net server-side.
  const merged = mergeSavedVerification(template, {
    technical: Array.isArray(req.body.technical) ? req.body.technical : [],
    commercial: req.body.commercial || {},
  });
  const status = rollupVerification(merged.technical);
  db.prepare(`UPDATE invoices SET verification_status=?, verification_json=?, verified_at=datetime('now'), verified_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, JSON.stringify(merged), req.user.name, inv.id);
  logAudit({ req, user: req.user, action: 'INVOICE_VERIFICATION', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: { status } });
  res.json({ ...merged, verification_status: status, verified_at: new Date().toISOString(), verified_by: req.user.name });
});

// G. Invoice Approval Workflow
router.post('/:id/submit-for-approval', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot submit a cancelled invoice for approval' });
  }
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
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot act on approvals for a cancelled invoice' });
  }
  const { decision, comments } = req.body; // APPROVED | REJECTED

  // Maker-checker: whoever raised the invoice cannot also clear it. Without this
  // one person can move money end to end, which is the control every audit of a
  // billing system looks for first.
  if (inv.created_by && req.user?.id && inv.created_by === req.user.id) {
    return res.status(403).json({
      error: 'Segregation of duties: the person who created an invoice cannot approve it. It needs a different approver.',
    });
  }

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

// Distribution — email PDF to counterparty + mark SENT
router.post('/:id/send', requireRole(...ROLE_GROUPS.REIA_WRITE), async (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cannot send a cancelled invoice' });
    }
    if (!['APPROVED', 'SENT'].includes(inv.status)) {
      return res.status(400).json({ error: 'Invoice must be APPROVED (or already SENT for resend) before distribution' });
    }

    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(inv.contract_id);
    if (!contract) return res.status(404).json({ error: 'Contract not found' });
    const seller = contract.seller_id ? db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.seller_id) : null;
    const buyer = contract.buyer_id ? db.prepare('SELECT * FROM entities WHERE id = ?').get(contract.buyer_id) : null;

    // Counterparty for this bill direction
    const recipientEntity = inv.direction === 'SJVN_TO_BUYER' ? buyer : seller;
    const contacts = recipientEntity
      ? db.prepare(`
          SELECT email, name, phone FROM entity_contacts
          WHERE entity_id = ? AND email IS NOT NULL AND email != ''
          ORDER BY is_primary DESC, contact_type = 'COMMERCIAL' DESC
        `).all(recipientEntity.id)
      : [];

    const overrideTo = (req.body?.to || '').trim();
    const emails = [];
    if (overrideTo) emails.push(overrideTo);
    if (recipientEntity?.corporate_email) emails.push(recipientEntity.corporate_email);
    for (const c of contacts) {
      if (c.email && !emails.includes(c.email)) emails.push(c.email);
    }
    const uniqueEmails = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

    if (!uniqueEmails.length) {
      return res.status(400).json({
        error: 'No recipient email found. Set corporate email / commercial contact on the counterparty, or pass body.to',
      });
    }

    // Due date at presentation
    let dueDate = inv.due_date;
    if (!dueDate) {
      dueDate = computeDueDate(new Date(), contract, getParamNumber('default_payment_terms_days', 30));
    }

    let beneficiaries = [];
    if (['Hydro', 'PSP'].includes(contract.project_type) && contract.contract_type === 'PPA') {
      const pStart = `${inv.billing_period}-01`;
      const pEnd = `${inv.billing_period}-31`;
      const rows = db.prepare(`
        SELECT b.name AS name, ca.allocation_percent AS allocation_percent
        FROM contract_allocations ca
        JOIN contracts s ON s.id = ca.psa_id
        LEFT JOIN entities b ON b.id = s.buyer_id
        WHERE ca.ppa_id = ?
          AND ca.effective_from <= ?
          AND (ca.effective_to IS NULL OR ca.effective_to >= ?)
        ORDER BY ca.allocation_percent DESC
      `).all(contract.id, pEnd, pStart);
      const total = Number(inv.total_amount) || 0;
      beneficiaries = rows.map((x) => ({ ...x, share: Math.round(total * (Number(x.allocation_percent) || 0) / 100) }));
    }

    const pdfBuffer = await generateInvoicePdfBuffer(inv, contract, seller, buyer, beneficiaries);
    const { subject, text, html } = formatInvoiceEmail({
      invoice: { ...inv, due_date: dueDate },
      contract,
      recipientName: recipientEntity?.name,
    });

    const mailResult = await sendMail({
      to: uniqueEmails,
      subject,
      text,
      html,
      attachments: [{
        filename: `Invoice_${String(inv.invoice_no).replace(/[^\w.-]+/g, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    if (!mailResult.ok) {
      db.prepare(`
        INSERT INTO invoice_deliveries (id, invoice_id, channel, recipient, status, mode, detail_json, sent_by)
        VALUES (?, ?, 'EMAIL', ?, 'FAILED', ?, ?, ?)
      `).run(
        newId('DLV'), inv.id, uniqueEmails.join(', '), mailResult.mode || 'NONE',
        JSON.stringify(mailResult), req.user?.name || null,
      );
      return res.status(502).json({ error: mailResult.error || 'Email delivery failed', delivery: mailResult });
    }

    const deliveryStatus = mailResult.mode === 'FILE_OUTBOX' ? 'SIMULATED' : 'SENT';
    db.prepare(`
      INSERT INTO invoice_deliveries (id, invoice_id, channel, recipient, status, mode, detail_json, sent_by)
      VALUES (?, ?, 'EMAIL', ?, ?, ?, ?, ?)
    `).run(
      newId('DLV'), inv.id, uniqueEmails.join(', '), deliveryStatus, mailResult.mode,
      JSON.stringify(mailResult), req.user?.name || null,
    );

    // SMS notice via the shared gateway, but only when the channel policy for
    // INVOICE_SENT actually lists SMS — so it can be silenced from master data.
    // No rupee amount in the text: a notice + portal, not sensitive detail.
    const phone = recipientEntity?.corporate_phone || contacts.find((c) => c.phone)?.phone;
    if (phone && channelsFor('INVOICE_SENT').includes('SMS')) {
      const smsText = `SJVN: Invoice ${inv.invoice_no} is available for payment (due ${dueDate}). View on the portal.`;
      const smsRes = await sendSms({ to: phone, text: smsText });
      db.prepare(`
        INSERT INTO invoice_deliveries (id, invoice_id, channel, recipient, status, mode, detail_json, sent_by)
        VALUES (?, ?, 'SMS', ?, ?, ?, ?, ?)
      `).run(
        newId('DLV'), inv.id, phone, smsRes.ok ? 'SENT' : 'FAILED', smsRes.mode,
        JSON.stringify(smsRes), req.user?.name || null,
      );
    }

    db.prepare(`UPDATE invoices SET status = 'SENT', due_date = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(dueDate, inv.id);

    logAudit({
      req, user: req.user, action: 'SEND', module: 'REIA', entityType: 'invoice', entityId: inv.id,
      details: { to: uniqueEmails, mode: mailResult.mode, delivery_status: deliveryStatus },
    });

    const notifyRole = inv.direction === 'SJVN_TO_BUYER' ? 'BUYER' : 'SELLER';
    pushNotification({
      role: notifyRole,
      type: 'INVOICE_SENT',
      message: `Invoice ${inv.invoice_no} has been emailed (${mailResult.mode}) for payment`,
    });

    const deliveries = db.prepare(`
      SELECT * FROM invoice_deliveries WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(inv.id);

    res.json({
      ...withContract(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id)),
      delivery: mailResult,
      deliveries,
    });
  } catch (err) {
    console.error('Invoice send failed:', err);
    res.status(500).json({ error: err.message || 'Failed to send invoice' });
  }
});

router.get('/:id/deliveries', requireRole(...ROLE_GROUPS.REIA_ALL, 'COMPLIANCE_AUDITOR'), (req, res) => {
  const inv = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.json(db.prepare(`
    SELECT * FROM invoice_deliveries WHERE invoice_id = ? ORDER BY created_at DESC
  `).all(req.params.id));
});

// Record payment against invoice (H. Payment Tracking)
// DISCOM realization available to fund a generator (developer) pay-out — the
// amount the DISCOM(s) have actually paid on the PSA invoices linked to this
// developer invoice (via invoice_mapping). This is what "pay-when-paid" draws on.
function generatorRealization(devInvoiceId) {
  const psa = db.prepare('SELECT buyer_invoice_id FROM invoice_mapping WHERE seller_invoice_id = ?')
    .all(devInvoiceId).map((r) => r.buyer_invoice_id);
  if (!psa.length) return { linked_psa: 0, realized: 0 };
  const ph = psa.map(() => '?').join(',');
  const realized = db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id IN (${ph})`).get(...psa).s;
  return { linked_psa: psa.length, realized: Math.round(realized) };
}

// Record a payment against an invoice and roll up rebate / LPS / status. Shared
// by buyer payment recording and generator pay-out release.
function applyInvoicePayment(inv, { amount, payment_date, mode, reference, deduction, release_source }, req) {
  const id = newId('PAY');
  db.prepare(`INSERT INTO payments (id, invoice_id, amount, payment_date, mode, reference, deduction, release_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, inv.id, amount, payment_date, mode ?? null, reference ?? null, deduction || 0, release_source ?? null);

  // Advanced Logic: Rebate and LPS
  let newRebate = inv.rebate;
  let newLps = inv.lps;
  const payDate = payment_date ? new Date(payment_date) : new Date();

  // ── Tiered early-payment rebate (PPA / SELLER_TO_SJVN only, computed once) ──
  // Buyers (DISCOMs) do NOT get early-payment rebate on PSA invoices.
  if (inv.direction === 'SELLER_TO_SJVN' && (inv.rebate || 0) === 0) {
    // 1st priority: the contract's own structured rebate rule (what the user set).
    const contract = db.prepare('SELECT rebate_pct, rebate_days, rebate_basis FROM contracts WHERE id = ?').get(inv.contract_id);
    let pct = contractRebatePct(contract, { billDate: inv.created_at, dueDate: inv.due_date, payDate });
    // 2nd: global tiered rebate. 3rd: flat % if paid on/before due date.
    if (pct === null) {
      pct = tieredRebatePct(Math.max(0, daysBetween(new Date(inv.created_at), payDate)), getParam('early_payment_rebate_tiers', null));
    }
    if (pct === null) {
      pct = (inv.due_date && payDate <= new Date(inv.due_date)) ? getParamNumber('early_payment_rebate_pct', 2) : 0;
    }
    if (pct > 0) {
      // Rebate-eligible base excludes pass-through charges, taxes and LPS (PSA Art. 6.4).
      const base = Math.max(0, (inv.total_amount || 0) - otherChargesSum(inv) - (Number(inv.taxes) || 0) - (Number(inv.lps) || 0));
      newRebate = Math.round(base * pct / 100);
    }
  }

  // ── LPS accrued on OUTSTANDING undisputed amount as of payment date ──
  if (inv.due_date) {
    const paidBefore = db.prepare(
      'SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ? AND id != ?'
    ).get(inv.id, id).s;
    const lpsContract = db.prepare('SELECT lps_annual_pct, lps_grace_days FROM contracts WHERE id = ?').get(inv.contract_id);
    const accrued = accruedLps(inv, {
      annualPct: lpsContract?.lps_annual_pct ?? getParamNumber('lps_annual_pct', 15),
      graceDays: lpsContract?.lps_grace_days ?? 0,
      monthlyStepPct: getParamNumber('lps_monthly_step_pct', 0.5),
      stepCapPct: getParamNumber('lps_step_cap_pct', 3),
      asOf: payDate, paid: paidBefore,
      state: payerStateForInvoice(inv),
    });
    if (accrued.lps > 0) newLps = accrued.lps;
  }

  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount + COALESCE(deduction, 0)),0) s FROM payments WHERE invoice_id = ?').get(inv.id).s;
  
  // Effective payable = original total - rebate + lps - disputed (undisputed always due)
  const effectivePayable = payableNow({ ...inv, rebate: newRebate, lps: newLps }).payable_now;
  
  const newStatus = totalPaid >= effectivePayable ? 'PAID' : 'PARTIALLY_PAID';
  
  db.prepare(`UPDATE invoices SET status = ?, rebate = ?, lps = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newStatus, newRebate, newLps, inv.id);

  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
}

// Outstanding position of a buyer's bills, oldest first — LPS accrued + principal.
function buyerOutstanding(buyerId) {
  const invs = db.prepare(`
    SELECT i.* FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE c.buyer_id = ? AND i.direction = 'SJVN_TO_BUYER'
      AND i.status IN ('SENT','PARTIALLY_PAID','APPROVED','DISPUTED')
    ORDER BY i.billing_period ASC, i.created_at ASC
  `).all(buyerId);
  return invs.map((inv) => {
    const contract = db.prepare('SELECT lps_annual_pct, lps_grace_days FROM contracts WHERE id = ?').get(inv.contract_id);
    const paid = paidTotalFor(inv.id);
    const lps = accruedLps(inv, {
      annualPct: contract?.lps_annual_pct ?? getParamNumber('lps_annual_pct', 15),
      graceDays: contract?.lps_grace_days ?? 0,
      monthlyStepPct: getParamNumber('lps_monthly_step_pct', 0.5),
      stepCapPct: getParamNumber('lps_step_cap_pct', 3),
      asOf: new Date(), paid,
      state: payerStateForInvoice(inv),
    }).lps;
    const principal = Math.max(0, (inv.total_amount || 0) - (inv.disputed_amount || 0) - paid);
    return { inv, lps: Math.round(lps), principal: Math.round(principal) };
  }).filter((x) => x.lps > 0 || x.principal > 0);
}

// Waterfall payment (PSA Art. 6.3): a buyer's lump payment is applied first to
// Late Payment Surcharge (oldest bill first), then to the oldest bill's
// principal and so on.
router.post('/waterfall-payment', requireRole(...ROLE_GROUPS.FINANCE, ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { buyer_id, amount, payment_date, reference } = req.body;
  if (!buyer_id) return res.status(400).json({ error: 'buyer_id is required' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A positive payment amount is required' });

  const items = buyerOutstanding(buyer_id);
  if (!items.length) return res.status(400).json({ error: 'No outstanding bills for this buyer' });

  const alloc = new Map();
  let remaining = amt;
  // Pass 1: LPS, oldest first.
  for (const it of items) { if (remaining <= 0) break; const a = Math.min(remaining, it.lps); if (a > 0) { alloc.set(it.inv.id, (alloc.get(it.inv.id) || 0) + a); remaining -= a; } }
  // Pass 2: principal, oldest first.
  for (const it of items) { if (remaining <= 0) break; const a = Math.min(remaining, it.principal); if (a > 0) { alloc.set(it.inv.id, (alloc.get(it.inv.id) || 0) + a); remaining -= a; } }

  const payDate = payment_date || new Date().toISOString().split('T')[0];
  const allocations = [];
  const run = db.transaction(() => {
    for (const it of items) {
      const a = alloc.get(it.inv.id);
      if (!a) continue;
      const updated = applyInvoicePayment(it.inv, { amount: Math.round(a), payment_date: payDate, mode: 'WATERFALL', reference: reference || null, deduction: 0 }, req);
      allocations.push({ invoice_no: it.inv.invoice_no, billing_period: it.inv.billing_period, lps_due: it.lps, principal_due: it.principal, allocated: Math.round(a), status: updated.status });
    }
  });
  run();
  logAudit({ req, user: req.user, action: 'WATERFALL_PAYMENT', module: 'REIA', entityType: 'entity', entityId: buyer_id, details: { amount: amt, allocations } });
  res.status(201).json({ received: Math.round(amt), allocated: Math.round(amt - remaining), unallocated: Math.round(remaining), allocations });
});

router.post('/:id/payments', requireRole(...ROLE_GROUPS.FINANCE, 'BUYER'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Cannot record payment against a cancelled invoice' });
  }
  const updated = applyInvoicePayment(inv, req.body, req);
  logAudit({ req, user: req.user, action: 'PAYMENT_RECORDED', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: req.body });

  const paid = Number(req.body.amount) || 0;
  dispatch({
    event: 'PAYMENT_RECEIVED', role: 'FINANCE_USER',
    subject: `Payment recorded — ${inv.invoice_no}`,
    message: `SJVN: Payment of Rs ${paid.toLocaleString('en-IN')} recorded against ${inv.invoice_no}. Status now ${updated.status}.`,
  }).catch((err) => console.error('[NOTIFY] PAYMENT_RECEIVED failed', err.message));

  res.status(201).json(updated);
});

// Pay-when-paid: SJVN releases a payment to the generator (developer) against
// their PPA invoice, funded from DISCOM realization / own fund / payment security
// fund. DISCOM_REALIZATION can only draw what the buyer has actually paid.
const RELEASE_SOURCES = ['DISCOM_REALIZATION', 'OWN_FUND', 'PAYMENT_SECURITY_FUND'];
router.post('/:id/release-to-generator', requireRole(...ROLE_GROUPS.FINANCE, ...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.direction !== 'SELLER_TO_SJVN') {
    return res.status(400).json({ error: 'Payment release applies only to developer (PPA) invoices' });
  }
  if (inv.status === 'CANCELLED') return res.status(400).json({ error: 'Invoice is cancelled' });
  if (!['APPROVED', 'SENT', 'PARTIALLY_PAID'].includes(inv.status)) {
    return res.status(400).json({ error: 'Invoice must be APPROVED before releasing payment to the generator' });
  }
  const { amount, source, payment_date, reference } = req.body;
  if (!RELEASE_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of ${RELEASE_SOURCES.join(', ')}` });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'A positive release amount is required' });

  // Enforce pay-when-paid for the DISCOM-realization source: can only release
  // what the DISCOM(s) have actually paid, net of what was already released from
  // realization.
  if (source === 'DISCOM_REALIZATION') {
    const { realized, linked_psa } = generatorRealization(inv.id);
    if (!linked_psa) return res.status(400).json({ error: 'No PSA (buyer) invoices are mapped to this developer invoice — nothing realized. Use Own Fund or Payment Security Fund.' });
    const alreadyFromRealization = db.prepare(
      "SELECT COALESCE(SUM(amount + COALESCE(deduction,0)),0) s FROM payments WHERE invoice_id = ? AND release_source = 'DISCOM_REALIZATION'"
    ).get(inv.id).s;
    const headroom = realized - alreadyFromRealization;
    if (amt > headroom) {
      return res.status(400).json({ error: `Only ${Math.round(headroom).toLocaleString('en-IN')} realized from the DISCOM so far. Release the balance from Own Fund or Payment Security Fund.` });
    }
  }

  const updated = applyInvoicePayment(inv, {
    amount: amt,
    payment_date: payment_date || new Date().toISOString().split('T')[0],
    mode: `RELEASE:${source}`,
    reference: reference || null,
    deduction: 0,
    release_source: source,
  }, req);
  logAudit({ req, user: req.user, action: 'RELEASE_TO_GENERATOR', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: { amount: amt, source, reference } });
  pushNotification({ role: 'SELLER', type: 'PAYMENT_RELEASED', message: `Payment of Rs.${amt.toLocaleString('en-IN')} released for ${inv.invoice_no} (${source.replace(/_/g, ' ').toLowerCase()})` });
  res.status(201).json(updated);
});

// Set the pass-through "other charges" on an invoice (transmission / RLDC-SLDC /
// CTU-STU / open access / scheduling). Replaces the full set; adjusts the invoice
// total by the delta. These are rebate-excluded.
router.post('/:id/other-charges', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (['PAID', 'CANCELLED'].includes(inv.status)) return res.status(400).json({ error: `Cannot edit charges on a ${inv.status} invoice` });
  const input = Array.isArray(req.body.charges) ? req.body.charges : [];
  const charges = [];
  for (const c of input) {
    const type = OTHER_CHARGE_TYPES[c.type] ? c.type : null;
    const amount = Math.round(Number(c.amount) || 0);
    if (!type) return res.status(400).json({ error: `Invalid charge type. Allowed: ${Object.keys(OTHER_CHARGE_TYPES).join(', ')}` });
    if (amount === 0) continue;
    charges.push({ code: type, label: c.label || OTHER_CHARGE_TYPES[type], amount });
  }
  const oldSum = otherChargesSum(inv);
  const newSum = charges.reduce((a, c) => a + c.amount, 0);
  const delta = newSum - oldSum;
  db.prepare(`UPDATE invoices SET other_charges_json = ?, total_amount = COALESCE(total_amount,0) + ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(charges), delta, inv.id);
  logAudit({ req, user: req.user, action: 'SET_OTHER_CHARGES', module: 'REIA', entityType: 'invoice', entityId: inv.id, details: { charges, delta } });
  res.json(withContract(db.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id)));
});

export default router;
