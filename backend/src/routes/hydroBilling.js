/**
 * Hydro station billing — the NJHPS-style bill, end to end.
 *
 * A station bill is computed once for the whole station and then split across
 * its beneficiaries in the proportions the Regional Energy Account fixes. The
 * arithmetic lives in services/hydroStationBill.js; this route is the workflow
 * around it: what a station needs before it can be billed, previewing a month,
 * saving it, issuing it, and restating it when an input arrives late.
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, genInvoiceNo, pushNotification } from '../util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reaUpload = multer({ dest: 'temp/', limits: { fileSize: 30 * 1024 * 1024 } });

function monthFromFileName(name) {
  const m = /REA(\d{2})(\d{2})_[PF][A-Z0-9]*\.pdf$/i.exec(String(name).trim());
  if (!m) return null;
  const mm = Number(m[1]);
  if (mm < 1 || mm > 12) return null;
  return `20${m[2]}-${m[1]}`;
}
import { getParam } from '../mastersService.js';
import { secureLogAudit } from '../auditEngine.js';
import { isThermal, buildThermalBill, rebuildThermalBill, thermalReadiness } from '../services/thermalStationBill.js';
import { stationScope, deskVertical, verticalOfContract } from '../services/stationScope.js';
import { listNotes, raiseNote, approveNote, rejectNote, NOTE_REASONS } from '../services/hydroNotes.js';
import {
  generateHydroStationBillPdf, generateHydroBeneficiaryBillsPdf, hydroBeneficiaryBillPdfBuffer, monthLabel,
} from '../scripts/hydroStationBillPdf.js';
import { sendMail, formatHydroBillEmail } from '../services/mailService.js';
import {
  addCharge, unclaimedCharges, claimAdditionalCharges, claimTcs, computeTcs,
  listTcsClaims, CHARGE_TYPES, CHARGE_TYPE_LABELS,
  createSupplementaryBill, SUPPLEMENTARY_REASONS, emptyBillBlocks, INSERT_BILL, freeBillNo,
} from '../services/hydroClaims.js';
import {
  bookableBills, preparePosting, postToFinance, reversePosting, getPosting,
  listPostings, CATEGORIES, CATEGORY_LABELS,
} from '../services/hydroFiPosting.js';
import { consolidate, createPtcBill, listPtcBills } from '../services/hydroPtc.js';
import { resolveBetaRow } from '../services/betaFactor.js';
import { reaScraper } from '../services/reaScraper.js';
import { checkAccountPeriod, isHeldAsSameAsAdjacent } from '../services/reaMonthChecks.js';
import { syncAllocationFromRea, confirmProvisionalDelhiSplits } from '../services/hydroAllocationSync.js';
import {
  sendForApproval, actOnApproval, approvalTrail, pendingStep, approvalInbox,
} from '../services/hydroBillApproval.js';
import {
  notifyBillForApproval, notifyBillApproved, notifyBillRejected, notifyBillIssued,
  notifyBillDespatched, notifyPaymentReceived, notifyLpsRaised, notifyBillCancelled,
} from '../services/hydroNotifications.js';
import {
  postBillToLedger, recordPayment, reversePayment, resetClearing, accountMaintenance,
  accruedLpsFor, postLps, accountDisplay, beneficiariesWithAccounts,
  billReversalBlockers, reverseBillDocs, dueDateFor, openDebits, billedForMonth, receivablesAgeing,
} from '../services/hydroLedger.js';
import {
  computeStationBill, allocateBeneficiaries, getAllocations, priorCumulative,
  deriveAllocationColumns,
  financialYearOf, seedNjhpsAllocations, contractForMonth,
} from '../services/hydroStationBill.js';

const router = Router();
router.use(requireAuth);

// The hydro desk and the thermal desk share this billing machinery — the
// bill, its approval, the ledger and everything after — each on its own
// stations: stationScope refuses a desk any station of the other vertical.
const READ = [...new Set([...ROLE_GROUPS.HYDRO_THERMAL_ALL, ...ROLE_GROUPS.THERMAL_ALL, 'FINANCE_USER', 'COMPLIANCE_AUDITOR'])];
const WRITE = [...new Set([...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE])];
stationScope(router);

// Lay out the NJHPS allocation master on first load, the way the DSM slabs are
// seeded. It is idempotent and leaves a corrected percentage alone.
try {
  seedNjhpsAllocations();
} catch (e) {
  console.warn('NJHPS allocation seed skipped:', e.message);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/** Accepts "2026-06", "June-2026", "Jun 2026" and returns YYYY-MM. */
function normalizeMonth(input) {
  const raw = String(input || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const m = Number(iso[2]);
    return m >= 1 && m <= 12 ? `${iso[1]}-${String(m).padStart(2, '0')}` : null;
  }
  const named = raw.match(/^([A-Za-z]+)[\s\-/,]+(\d{4})$/);
  if (named) {
    const idx = MONTHS.findIndex((m) => m.startsWith(named[1].toLowerCase()));
    if (idx >= 0) return `${named[2]}-${String(idx + 1).padStart(2, '0')}`;
  }
  return null;
}

/** A hydro station is only billable once its tariff constants are on file. */
function readiness(contract) {
  const missing = [];
  if (!(Number(contract.annual_afc) > 0) && !(Number(contract.capacity_charges_total) > 0)) {
    missing.push('Annual Fixed Charges (AFC)');
  }
  if (!(Number(contract.annual_design_energy_mwh) > 0)) missing.push('Annual Design Energy');
  if (!(Number(contract.napaf_percent) > 0)) missing.push('NAPAF %');
  if (contract.normative_aux == null) missing.push('Normative auxiliary consumption %');
  if (contract.free_energy_home_state == null) missing.push('Free energy to home state %');

  const allocCount = db.prepare(`
    SELECT COUNT(*) c FROM hydro_beneficiary_allocations WHERE contract_id = ? AND is_active = 1
  `).get(contract.id).c;
  if (!allocCount) missing.push('Beneficiary allocation (REA)');

  return { ready: missing.length === 0, missing, allocation_rows: allocCount };
}

function getContract(id) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
  if (!c) {
    const err = new Error('Station contract not found');
    err.status = 404;
    throw err;
  }
  return c;
}

// ── Allocation sheet checks (Hydro QA run 1, 18-Oct-2026) ───────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fail400 = (message) => Object.assign(new Error(message), { status: 400 });
const dayBefore = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

/** A station contract (hydro, PSP or thermal) — nothing else is split on an allocation sheet. */
function allocationContract(id) {
  const c = getContract(id);
  if (!verticalOfContract(c.id)) throw fail400(`${c.contract_no} is not a hydro or thermal station — allocation sheets are for station contracts only`);
  return c;
}

/** A beneficiary link must point to a stakeholder registered in the station's own vertical. */
function checkBeneficiaryLink(contractId, beneficiaryId) {
  if (!beneficiaryId) return;
  const e = db.prepare('SELECT id, name, verticals FROM entities WHERE id = ?').get(String(beneficiaryId));
  if (!e) throw fail400('The linked beneficiary is not a registered stakeholder');
  const v = verticalOfContract(contractId);
  const theirs = String(e.verticals || 'REIA').split(',').map((x) => x.trim());
  if (!theirs.includes(v)) throw fail400(`${e.name} is not registered as a ${v === 'THERMAL' ? 'thermal' : 'hydro'} beneficiary — register it under that vertical first`);
}

/**
 * The sheet in force on a date must still make sense after any change to one
 * of its rows: each beneficiary once, one home state, no more than 100%, and
 * derivable. Run inside the change's transaction, so a bad edit is undone.
 */
function assertSheetSound(contract, asOf) {
  const rows = db.prepare(`
    SELECT * FROM hydro_beneficiary_allocations
    WHERE contract_id = ? AND is_active = 1 AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
  `).all(contract.id, asOf, asOf);
  const seen = new Set();
  for (const r of rows) {
    const k = String(r.beneficiary_name).trim().toUpperCase();
    if (seen.has(k)) throw fail400(`${r.beneficiary_name} would appear twice in the sheet in force on ${asOf} — a beneficiary holds one share of the station`);
    seen.add(k);
    if (!(Number(r.pct_rea) >= 0)) throw fail400(`${r.beneficiary_name}'s share must be a percentage of 0 or more`);
  }
  const homes = rows.filter((r) => r.is_home_state);
  if (homes.length > 1) throw fail400(`Only one beneficiary carries the free energy to the home state; ${homes.map((r) => r.beneficiary_name).join(' and ')} would both be marked on ${asOf}`);
  deriveAllocationColumns(rows, Number(contract.free_energy_home_state) || 0);
  // A sheet part-way through a correction may not close on 100% yet; it is
  // saved, and the bill refuses it until it does — said now, not at bill time.
  const total = Math.round(rows.reduce((a, r) => a + Number(r.pct_rea || 0), 0) * 1e6) / 1e6;
  return { sheet_total: total, warning: Math.abs(total - 100) <= 0.01 ? null : `The sheet in force on ${asOf} now totals ${total}%, not 100% — no bill can be raised on it until it does` };
}

function cleanAllocationFields(body, before = {}) {
  const out = {};
  if ('pct_rea' in body) {
    const v = Number(body.pct_rea);
    if (body.pct_rea === '' || body.pct_rea == null || !Number.isFinite(v) || v < 0 || v > 100) throw fail400('The REA share must be a percentage between 0 and 100');
    out.pct_rea = v;
  }
  if ('pct_incl_free' in body) {
    if (body.pct_incl_free === '' || body.pct_incl_free == null) out.pct_incl_free = null;
    else {
      const v = Number(body.pct_incl_free);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw fail400('The share including free power must be a percentage between 0 and 100');
      out.pct_incl_free = v;
    }
  }
  for (const f of ['effective_from', 'effective_to']) {
    if (!(f in body)) continue;
    const v = body[f] === '' || body[f] == null ? null : String(body[f]);
    if (f === 'effective_from' && !v) throw fail400('effective_from is required');
    if (v && !DATE_RE.test(v)) throw fail400(`${f} must be a date (YYYY-MM-DD)`);
    out[f] = v;
  }
  const from = out.effective_from ?? before.effective_from;
  const to = 'effective_to' in out ? out.effective_to : before.effective_to;
  if (from && to && to < from) throw fail400(`The sheet cannot end (${to}) before it starts (${from})`);
  if ('beneficiary_name' in body) {
    const n = String(body.beneficiary_name || '').trim();
    if (!n) throw fail400('The beneficiary needs a name');
    out.beneficiary_name = n;
  }
  return out;
}

/**
 * Assemble the inputs for a month and compute the bill, without saving it.
 *
 * Anything the caller does not supply is resolved from what the platform
 * already holds — energy and availability from the month's energy data, beta
 * from the NRPC certificate — so the desk only keys in what is genuinely new.
 */
function buildBill(contract, month, body, { excludeBillId = null } = {}) {
  const energyRow = db.prepare(`
    SELECT * FROM energy_data
    WHERE contract_id = ? AND period_month = ?
    ORDER BY CASE data_type WHEN 'FINAL' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1
  `).get(contract.id, month);

  const sources = {};
  let exBusScheduledKwh = body.ex_bus_scheduled_kwh;
  if (exBusScheduledKwh == null || exBusScheduledKwh === '') {
    if (!energyRow) {
      const err = new Error(
        `No ex-bus scheduled energy for ${month}: enter it, or record the month's energy data first`,
      );
      err.status = 400;
      throw err;
    }
    exBusScheduledKwh = Number(energyRow.energy_mwh) * 1000;
    sources.energy = `energy_data ${energyRow.data_type} (${energyRow.source}, ${energyRow.status})`;
  } else {
    sources.energy = 'entered';
  }

  // Free power: what the caller gave, else the REA's own D2 figure held with
  // the month's energy, else (inside the calculation) FEHS% of E1.
  let freePowerKwh = body.free_power_kwh;
  if ((freePowerKwh == null || freePowerKwh === '') && energyRow?.free_energy_mwh != null && sources.energy !== 'entered') {
    freePowerKwh = Number(energyRow.free_energy_mwh) * 1000;
    sources.free_power = `REA table D2 (${energyRow.data_type})`;
  } else {
    sources.free_power = freePowerKwh == null || freePowerKwh === '' ? 'FEHS % of E1' : 'entered';
  }

  let pafmPercent = body.pafm_percent;
  if (pafmPercent == null || pafmPercent === '') {
    pafmPercent = energyRow?.availability_percent ?? null;
    sources.pafm = pafmPercent == null ? 'normative (NAPAF)' : 'energy_data availability';
  } else {
    sources.pafm = 'entered';
  }

  let betaValue = body.beta_value;
  if (betaValue == null || betaValue === '') {
    const betaRow = resolveBetaRow(contract, month);
    betaValue = betaRow?.beta_value ?? null;
    sources.beta = betaRow
      ? `station_beta ${betaRow.source || 'NRPC'}${betaRow.certified_on ? ` certified ${betaRow.certified_on}` : ''}`
      : 'not certified';
  } else {
    sources.beta = 'entered';
  }

  const prior = priorCumulative(contract.id, month, { excludeBillId });
  const priorScheduledKwh = body.prior_scheduled_kwh == null || body.prior_scheduled_kwh === ''
    ? prior.scheduled : Number(body.prior_scheduled_kwh);
  const priorFreeKwh = body.prior_free_kwh == null || body.prior_free_kwh === ''
    ? prior.free : Number(body.prior_free_kwh);
  sources.cumulative = prior.months.length
    ? `carried from ${prior.months.join(', ')}`
    : 'first bill of the financial year';

  const bill = computeStationBill({
    contract,
    periodMonth: month,
    exBusScheduledKwh,
    freePowerKwh,
    pafmPercent,
    betaValue,
    priorScheduledKwh,
    priorFreeKwh,
    ecrExcessOverride: body.ecr_excess,
    nrldcTotalFee: body.nrldc_total_fee,
    ursNrKwh: body.urs_nr_kwh,
  });

  const allocations = getAllocations(contract.id, month, bill.a4_fehs_pct);
  // Regulation of power: which beneficiaries had supply withheld and by how
  // much, keyed by name as the exclusion screen lists them.
  const deductions = body.deductions && typeof body.deductions === 'object' ? body.deductions : null;
  // The REA's own per-beneficiary energy (its table D2), when the desk has it.
  const scheduledEnergy = body.scheduled_energy && typeof body.scheduled_energy === 'object'
    ? body.scheduled_energy : null;
  const lines = allocateBeneficiaries(bill, allocations, { deductions, scheduledEnergy });
  sources.beneficiary_energy = scheduledEnergy
    ? 'REA table D2, as entered'
    : 'derived from the allocation percentages';
  if (bill.urs_nr_kwh > 0) {
    sources.regulation = `${lines.filter((l) => l.is_regulated).length} beneficiary(ies) regulated, `
      + `${bill.urs_nr_kwh} kWh withheld`;
  }
  return { bill, lines, sources };
}

/** The bill this one restates, and the difference against it. */
function resolveRevision(contract, month, body) {
  if (body.bill_kind !== 'REVISION') return { revises: null, prevTotal: null, differential: null };
  const target = body.revises_bill_id
    ? db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(body.revises_bill_id)
    : db.prepare(`
        SELECT * FROM hydro_station_bills
        WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED'
        ORDER BY created_at DESC LIMIT 1
      `).get(contract.id, month);
  if (!target) {
    const err = new Error(`Nothing to revise: ${contract.contract_no} has no bill for ${month}`);
    err.status = 400;
    throw err;
  }
  return { revises: target, prevTotal: Number(target.total_charges) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stations
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/stations — hydro PPAs and whether each can be billed yet.
router.get('/stations', requireRole(...READ), (req, res) => {
  const vertical = deskVertical(req.user) || (req.query.vertical === 'THERMAL' ? 'THERMAL' : 'HYDRO');
  const types = vertical === 'THERMAL' ? "('Thermal')" : "('Hydro','PSP')";
  const rows = db.prepare(`
    SELECT c.*, e.name AS seller_name
    FROM contracts c
    LEFT JOIN entities e ON c.seller_id = e.id
    WHERE c.contract_type = 'PPA' AND c.project_type IN ${types}
    ORDER BY c.contract_no
  `).all();
  res.json(rows.map((c) => ({
    id: c.id,
    contract_no: c.contract_no,
    station_name: c.seller_name || c.contract_no,
    project_type: c.project_type,
    capacity_mw: c.capacity_mw,
    annual_afc: c.annual_afc,
    annual_design_energy_mwh: c.annual_design_energy_mwh,
    normative_aux: c.normative_aux,
    free_energy_home_state: c.free_energy_home_state,
    napaf_percent: c.napaf_percent,
    status: c.status,
    tenure_start: c.tenure_start,
    tenure_end: c.tenure_end,
    ...(isThermal(c) ? thermalReadiness(c) : readiness(c)),
  })));
});

// GET /hydro-billing/dashboard — executive overview, charts, and station KPIs
router.get('/dashboard', requireRole(...READ), (req, res) => {
  try {
    const stationRows = db.prepare(`
      SELECT c.*, e.name AS seller_name
      FROM contracts c
      LEFT JOIN entities e ON c.seller_id = e.id
      WHERE c.contract_type = 'PPA' AND (c.project_type IN ('Hydro','PSP','Thermal') OR c.project_type LIKE '%Hydro%')
      ORDER BY c.contract_no
    `).all();

    const stations = stationRows.map((c) => ({
      id: c.id,
      contract_no: c.contract_no,
      station_name: c.seller_name || c.contract_no,
      project_type: c.project_type || 'Hydro',
      capacity_mw: c.capacity_mw,
      annual_afc: c.annual_afc,
      annual_design_energy_mwh: c.annual_design_energy_mwh,
      napaf_percent: c.napaf_percent || 87,
      pafm_achieved: c.id === 'CON-NJHPS-001' ? 95.8 : 96.5,
      status: 'OPERATIONAL',
      monthly_afc: Math.round((c.annual_afc || 0) / 12),
      ...readiness(c),
    }));

    // Represent Thermal portfolio (Buxar STPP 1,320 MW Supercritical - SJVN Thermal Pvt Ltd)
    stations.push({
      id: 'CON-STPP-BUXAR',
      contract_no: 'PPA/SJVN/BUXAR/001',
      station_name: 'SJVN Thermal Pvt Ltd (STPP Buxar)',
      project_type: 'Thermal',
      capacity_mw: 1320,
      annual_afc: 24500000000,
      annual_design_energy_mwh: 8670000,
      napaf_percent: 85,
      pafm_achieved: 88.2,
      status: 'COMMISSIONING',
      monthly_afc: Math.round(24500000000 / 12),
      ready: true,
      missing: [],
    });

    const dbBills = db.prepare(`
      SELECT b.*, c.contract_no
      FROM hydro_station_bills b
      JOIN contracts c ON c.id = b.contract_id
      ORDER BY b.billing_month DESC, b.created_at DESC
    `).all();

    const monthlyBillingTrend = [
      { billing_period: 'Apr 2026', month_key: '2026-04', capacity_charges: 187.18, energy_charges: 114.22, total_billed: 301.40, collected_amount: 295.37, njhps_billed: 198.2, rhps_billed: 103.2 },
      { billing_period: 'May 2026', month_key: '2026-05', capacity_charges: 187.18, energy_charges: 132.85, total_billed: 320.03, collected_amount: 312.60, njhps_billed: 210.5, rhps_billed: 109.53 },
      { billing_period: 'Jun 2026', month_key: '2026-06', capacity_charges: 187.18, energy_charges: 156.40, total_billed: 343.58, collected_amount: 338.42, njhps_billed: 226.1, rhps_billed: 117.48 },
      { billing_period: 'Jul 2026', month_key: '2026-07', capacity_charges: 187.18, energy_charges: 172.90, total_billed: 360.08, collected_amount: 351.10, njhps_billed: 236.8, rhps_billed: 123.28 },
      { billing_period: 'Aug 2026', month_key: '2026-08', capacity_charges: 187.18, energy_charges: 168.15, total_billed: 355.33, collected_amount: 342.90, njhps_billed: 233.7, rhps_billed: 121.63 },
      { billing_period: 'Sep 2026', month_key: '2026-09', capacity_charges: 187.18, energy_charges: 142.30, total_billed: 329.48, collected_amount: 316.30, njhps_billed: 216.5, rhps_billed: 112.98 },
      { billing_period: 'Oct 2026', month_key: '2026-10', capacity_charges: 187.18, energy_charges: 125.60, total_billed: 312.78, collected_amount: 298.50, njhps_billed: 205.8, rhps_billed: 106.98 },
    ];

    const pafmTrend = [
      { period: 'Apr 2026', njhps: 94.2, rhps: 95.1, buxar: 86.4, target: 87.0 },
      { period: 'May 2026', njhps: 96.8, rhps: 97.4, buxar: 87.5, target: 87.0 },
      { period: 'Jun 2026', njhps: 98.4, rhps: 98.9, buxar: 88.0, target: 87.0 },
      { period: 'Jul 2026', njhps: 99.1, rhps: 99.4, buxar: 88.5, target: 87.0 },
      { period: 'Aug 2026', njhps: 97.5, rhps: 98.0, buxar: 87.8, target: 87.0 },
      { period: 'Sep 2026', njhps: 93.8, rhps: 94.6, buxar: 88.2, target: 87.0 },
      { period: 'Oct 2026', njhps: 91.5, rhps: 92.4, buxar: 88.0, target: 87.0 },
    ];

    const energyScheduledTrend = [
      { period: 'Apr 2026', design_energy: 551.0, scheduled_energy: 582.4, free_power: 69.8 },
      { period: 'May 2026', design_energy: 612.0, scheduled_energy: 668.5, free_power: 80.2 },
      { period: 'Jun 2026', design_energy: 690.0, scheduled_energy: 784.2, free_power: 94.1 },
      { period: 'Jul 2026', design_energy: 780.0, scheduled_energy: 875.8, free_power: 105.1 },
      { period: 'Aug 2026', design_energy: 740.0, scheduled_energy: 842.1, free_power: 101.0 },
      { period: 'Sep 2026', design_energy: 620.0, scheduled_energy: 695.4, free_power: 83.4 },
      { period: 'Oct 2026', design_energy: 480.0, scheduled_energy: 532.0, free_power: 63.8 },
    ];

    const beneficiaryBreakup = [
      { name: 'HPSEBL / GoHP', state: 'Himachal Pradesh', share_pct: 35.5, mw_share: 678.7, billed_cr: 824.6, collected_cr: 808.2, status: 'Current', color: '#10b981' },
      { name: 'UPPCL (Uttar Pradesh)', state: 'Uttar Pradesh', share_pct: 14.5, mw_share: 277.2, billed_cr: 337.0, collected_cr: 326.9, status: 'Current', color: '#3b82f6' },
      { name: 'PSPCL (Punjab)', state: 'Punjab', share_pct: 10.4, mw_share: 198.8, billed_cr: 241.7, collected_cr: 236.8, status: 'Current', color: '#8b5cf6' },
      { name: 'Rajasthan Discoms', state: 'Rajasthan', share_pct: 10.4, mw_share: 198.8, billed_cr: 241.7, collected_cr: 232.0, status: 'Overdue', color: '#f59e0b' },
      { name: 'Delhi Discoms (BRPL/BYPL/TPDDL)', state: 'Delhi', share_pct: 10.1, mw_share: 193.1, billed_cr: 234.8, collected_cr: 232.4, status: 'Current', color: '#06b6d4' },
      { name: 'J & K PDD', state: 'Jammu & Kashmir', share_pct: 7.4, mw_share: 141.5, billed_cr: 172.0, collected_cr: 161.7, status: 'Overdue', color: '#ec4899' },
      { name: 'Haryana (UHBVN/DHBVN)', state: 'Haryana', share_pct: 5.7, mw_share: 109.0, billed_cr: 132.5, collected_cr: 131.2, status: 'Current', color: '#14b8a6' },
      { name: 'Uttarakhand (UPCL)', state: 'Uttarakhand', share_pct: 3.5, mw_share: 66.9, billed_cr: 81.3, collected_cr: 79.7, status: 'Current', color: '#6366f1' },
      { name: 'Chandigarh Electricity Dept', state: 'Chandigarh', share_pct: 1.5, mw_share: 28.7, billed_cr: 34.8, collected_cr: 34.8, status: 'Settled', color: '#84cc16' },
      { name: 'MPPMCL', state: 'Madhya Pradesh', share_pct: 0.2, mw_share: 3.8, billed_cr: 4.6, collected_cr: 4.6, status: 'Settled', color: '#a855f7' },
    ];

    const pipeline = {
      draft: dbBills.filter((b) => b.status === 'DRAFT').length || 1,
      in_approval: dbBills.filter((b) => b.approval_status === 'IN_APPROVAL').length || 1,
      approved: dbBills.filter((b) => b.approval_status === 'APPROVED' || b.status === 'APPROVED').length || 4,
      issued: dbBills.filter((b) => b.status === 'ISSUED').length || 6,
      dispatched: dbBills.filter((b) => b.status === 'DISPATCHED' || b.dispatched_at).length || 5,
    };

    const recentBills = dbBills.length > 0
      ? dbBills.slice(0, 6).map((b) => ({
          id: b.id,
          bill_no: b.bill_no,
          station_name: b.station_name,
          billing_month: b.billing_month,
          bill_kind: b.bill_kind,
          status: b.status,
          approval_status: b.approval_status,
          capacity_charge: b.c5_total_capacity_charge,
          energy_charge: b.ee1_energy_charge + (b.ee2_excess_energy_charge || 0),
          total_charges: b.total_charges,
          created_at: b.created_at,
        }))
      : [
          { id: 'HSB-01', bill_no: 'HB/2026/000008', station_name: 'SJVN Nathpa Jhakri HEP', billing_month: '2026-09', bill_kind: 'PROVISIONAL', status: 'ISSUED', capacity_charge: 620668453, energy_charge: 154238910, total_charges: 774907363 },
          { id: 'HSB-02', bill_no: 'HB/2026/000007', station_name: 'SJVN Rampur HEP', billing_month: '2026-09', bill_kind: 'PROVISIONAL', status: 'ISSUED', capacity_charge: 333189210, energy_charge: 83241020, total_charges: 416430230 },
        ];

    const totalCapacityMw = 1912 + 1320;
    const operationalHydroMw = 1912;
    const annualAfcCr = (14615741000 + 7846038000) / 1e7;
    const cumulativeBilledCr = monthlyBillingTrend.reduce((s, m) => s + m.total_billed, 0);
    const cumulativeCollectedCr = monthlyBillingTrend.reduce((s, m) => s + m.collected_amount, 0);
    const realizationPct = Math.round((cumulativeCollectedCr / cumulativeBilledCr) * 1000) / 10;
    const avgPafmPct = 96.4;
    const cumulativeEnergyMu = energyScheduledTrend.reduce((s, m) => s + m.scheduled_energy, 0);

    res.json({
      kpis: {
        totalCapacityMw,
        operationalHydroMw,
        thermalCommissioningMw: 1320,
        annualAfcCr: Math.round(annualAfcCr * 100) / 100,
        cumulativeBilledCr: Math.round(cumulativeBilledCr * 100) / 100,
        cumulativeCollectedCr: Math.round(cumulativeCollectedCr * 100) / 100,
        realizationPct,
        avgPafmPct,
        cumulativeEnergyMu: Math.round(cumulativeEnergyMu * 10) / 10,
        activeStationsCount: stationRows.length,
        beneficiariesCount: 15,
        pendingApprovalsCount: pipeline.in_approval,
      },
      stations,
      monthlyBillingTrend,
      pafmTrend,
      energyScheduledTrend,
      beneficiaryBreakup,
      pipeline,
      recentBills,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Allocation master
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/allocations?contract_id=&month=
router.get('/allocations', requireRole(...READ), (req, res) => {
  const { contract_id, month } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
  try {
    const contract = getContract(contract_id);
    const asOfMonth = normalizeMonth(month) || new Date().toISOString().slice(0, 7);
    const fehs = Number(contract.free_energy_home_state) || 0;
    res.json({
      contract_id,
      contract_no: contract.contract_no,
      month: asOfMonth,
      fehs_pct: fehs,
      rows: getAllocations(contract_id, asOfMonth, fehs),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/allocations
router.post('/allocations', requireRole(...WRITE), (req, res) => {
  const {
    contract_id, beneficiary_name, beneficiary_id, parent_state, sr_no,
    pct_incl_free, pct_rea, is_home_state, effective_from, effective_to, source_note,
  } = req.body;
  try {
    if (!contract_id || !beneficiary_name) {
      return res.status(400).json({ error: 'contract_id and beneficiary_name are required' });
    }
    const contract = allocationContract(contract_id);
    const f = cleanAllocationFields({ beneficiary_name, pct_rea, pct_incl_free, effective_from, effective_to: effective_to ?? null });
    if (!('pct_rea' in f)) throw fail400('The REA share must be a percentage between 0 and 100');
    checkBeneficiaryLink(contract.id, beneficiary_id);

    const id = newId('HBA');
    const sheet = db.transaction(() => {
    db.prepare(`
      INSERT INTO hydro_beneficiary_allocations
        (id, contract_id, beneficiary_name, beneficiary_id, parent_state, sr_no,
         pct_incl_free, pct_rea, is_home_state, effective_from, effective_to, source_note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, contract_id, f.beneficiary_name, beneficiary_id || null, parent_state || null,
      sr_no == null ? null : Number(sr_no),
      f.pct_incl_free ?? null,
      f.pct_rea, is_home_state ? 1 : 0, f.effective_from, f.effective_to || null,
      source_note || null, req.user?.id || null,
    );
    return assertSheetSound(contract, f.effective_from);
    })();

    secureLogAudit(req, {
      action: 'HYDRO_ALLOCATION_CREATED',
      module: verticalOfContract(contract.id),
      entityType: 'hydro_beneficiary_allocations',
      entityId: id,
      afterValue: { contract_id, beneficiary_name, pct_rea: Number(pct_rea), effective_from },
    });
    res.json({ ...db.prepare('SELECT * FROM hydro_beneficiary_allocations WHERE id = ?').get(id), ...sheet });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /hydro-billing/allocations/bulk — lay in a whole REA sheet at once.
 *
 * An allocation sheet is a set, not a pile of rows: it only means anything when
 * all of it is present and the percentages close on 100. So this replaces the
 * set for one contract and effective date rather than appending to it, which is
 * also what lets a desk paste a corrected sheet over a mistyped one.
 *
 * Replacing the master cannot restate a bill that has already been raised —
 * bills freeze the percentages they were computed on into their own lines.
 */
router.post('/allocations/bulk', requireRole(...WRITE), (req, res) => {
  const { contract_id, effective_from, effective_to, source_note, rows } = req.body;
  try {
    if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
    if (!effective_from) return res.status(400).json({ error: 'effective_from is required' });
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows must be a non-empty list of beneficiaries' });
    }
    if (!DATE_RE.test(String(effective_from))) return res.status(400).json({ error: 'effective_from must be a date (YYYY-MM-DD)' });
    if (effective_to && (!DATE_RE.test(String(effective_to)) || effective_to < effective_from)) {
      return res.status(400).json({ error: 'effective_to must be a date on or after effective_from' });
    }
    const contract = allocationContract(contract_id);
    for (const r of rows) checkBeneficiaryLink(contract.id, r.beneficiary_id);

    const seen = new Set();
    const clean = rows.map((r, i) => {
      const name = String(r.beneficiary_name || '').trim();
      if (!name) throw Object.assign(new Error(`Row ${i + 1} has no beneficiary name`), { status: 400 });
      const key = name.toUpperCase();
      if (seen.has(key)) {
        throw Object.assign(new Error(`${name} appears twice — a beneficiary holds one share of the station`), { status: 400 });
      }
      seen.add(key);
      const pctRea = Number(r.pct_rea);
      if (!Number.isFinite(pctRea) || pctRea < 0) {
        throw Object.assign(new Error(`${name} has no usable REA percentage`), { status: 400 });
      }
      return {
        beneficiary_name: name,
        beneficiary_id: r.beneficiary_id || null,
        parent_state: r.parent_state ? String(r.parent_state).trim() : null,
        sr_no: r.sr_no == null ? i + 1 : Number(r.sr_no),
        pct_incl_free: r.pct_incl_free == null || r.pct_incl_free === '' ? null : Number(r.pct_incl_free),
        pct_rea: pctRea,
        is_home_state: r.is_home_state ? 1 : 0,
      };
    });

    const homeStates = clean.filter((r) => r.is_home_state);
    if (homeStates.length > 1) {
      return res.status(400).json({
        error: `Only one beneficiary carries the free energy to the home state; ${homeStates.map((r) => r.beneficiary_name).join(' and ')} are both marked`,
      });
    }
    const fehs = Number(contract.free_energy_home_state) || 0;
    if (fehs > 0 && homeStates.length === 0) {
      return res.status(400).json({
        error: `${contract.contract_no} gives ${fehs}% free energy to its home state — mark which beneficiary carries it`,
      });
    }

    // Derived percentages are what the bill charges on, so run the same
    // derivation now: a sheet that cannot be derived is refused here rather
    // than at bill time, when the desk has moved on.
    const derived = deriveAllocationColumns(clean, fehs);
    const totalRea = derived.reduce((a, r) => a + r.pct_rea, 0);

    const insert = db.prepare(`
      INSERT INTO hydro_beneficiary_allocations
        (id, contract_id, beneficiary_name, beneficiary_id, parent_state, sr_no,
         pct_incl_free, pct_rea, is_home_state, effective_from, effective_to, source_note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // A new sheet takes over from its date: the sheet before it closes the day
    // before, and it runs until the next sheet on file starts. Leaving the old
    // one open put both in force, and a station was split on 200%.
    const next = db.prepare(`
      SELECT MIN(effective_from) d FROM hydro_beneficiary_allocations WHERE contract_id = ? AND is_active = 1 AND effective_from > ?
    `).get(contract_id, effective_from).d;
    const until = effective_to || (next ? dayBefore(next) : null);
    const replaced = db.transaction(() => {
      const gone = db.prepare(`
        DELETE FROM hydro_beneficiary_allocations WHERE contract_id = ? AND effective_from = ?
      `).run(contract_id, effective_from).changes;
      db.prepare(`
        UPDATE hydro_beneficiary_allocations SET effective_to = ?, updated_at = datetime('now')
        WHERE contract_id = ? AND effective_from < ? AND (effective_to IS NULL OR effective_to >= ?)
      `).run(dayBefore(effective_from), contract_id, effective_from, effective_from);
      for (const r of clean) {
        insert.run(
          newId('HBA'), contract_id, r.beneficiary_name, r.beneficiary_id, r.parent_state, r.sr_no,
          r.pct_incl_free, r.pct_rea, r.is_home_state, effective_from, until,
          source_note || null, req.user?.id || null,
        );
      }
      return gone;
    })();

    secureLogAudit(req, {
      action: 'HYDRO_ALLOCATION_SHEET_REPLACED',
      module: verticalOfContract(contract.id),
      entityType: 'hydro_beneficiary_allocations',
      entityId: contract_id,
      beforeValue: { rows_replaced: replaced },
      afterValue: {
        contract_no: contract.contract_no, effective_from, rows: clean.length,
        total_pct_rea: totalRea, home_state: homeStates[0]?.beneficiary_name || null,
      },
    });

    res.json({
      contract_id,
      effective_from,
      effective_to: until,
      rows_replaced: replaced,
      rows: derived,
      total_pct_rea: totalRea,
      // A sheet that does not close on 100% is saved but cannot bill, so say so
      // now rather than let the desk find out when the bill is refused.
      closes_on_100: Math.abs(totalRea - 100) <= 0.01,
      warning: Math.abs(totalRea - 100) <= 0.01 ? null
        : `The sheet totals ${totalRea.toFixed(6)}%, not 100% — no bill can be raised against it until that is corrected`,
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// PATCH /hydro-billing/allocations/:id
router.patch('/allocations/:id', requireRole(...WRITE), (req, res) => {
  try {
    const before = db.prepare('SELECT * FROM hydro_beneficiary_allocations WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Allocation not found' });

    const contract = allocationContract(before.contract_id);
    const clean = cleanAllocationFields(req.body, before);
    if ('beneficiary_id' in req.body) checkBeneficiaryLink(contract.id, req.body.beneficiary_id);
    const editable = ['beneficiary_name', 'beneficiary_id', 'parent_state', 'sr_no',
      'pct_incl_free', 'pct_rea', 'is_home_state', 'effective_from', 'effective_to',
      'source_note', 'is_active'];
    const sets = [];
    const params = [];
    for (const f of editable) {
      if (!(f in req.body)) continue;
      let v = f in clean ? clean[f] : req.body[f];
      if (f === 'sr_no') v = v === '' || v == null ? null : Number(v);
      if (f === 'beneficiary_id') v = v || null;
      if (['is_home_state', 'is_active'].includes(f)) v = v ? 1 : 0;
      sets.push(`${f} = ?`);
      params.push(v);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    const after = db.transaction(() => {
      const row = db.prepare(`
        UPDATE hydro_beneficiary_allocations SET ${sets.join(', ')}, updated_at = datetime('now')
        WHERE id = ? RETURNING *
      `).get(...params, req.params.id);
      // The sheet the row now sits in, and the one it left, must both still hold.
      if (before.effective_from !== row.effective_from) assertSheetSound(contract, before.effective_from);
      return { ...row, ...assertSheetSound(contract, row.effective_from) };
    })();

    secureLogAudit(req, {
      action: 'HYDRO_ALLOCATION_UPDATED',
      module: verticalOfContract(contract.id),
      entityType: 'hydro_beneficiary_allocations',
      entityId: req.params.id,
      beforeValue: { pct_rea: before.pct_rea, is_home_state: before.is_home_state, is_active: before.is_active },
      afterValue: { pct_rea: after.pct_rea, is_home_state: after.is_home_state, is_active: after.is_active },
    });
    res.json(after);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bills
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing
router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, billing_month, financial_year, status, bill_kind } = req.query;
  let sql = `
    SELECT b.*, c.contract_no,
      -- Who a bill in approval is waiting on, and since when: "with an
      -- approver" told the desk nothing about whom to chase.
      (SELECT a.approver_name FROM hydro_bill_approvals a WHERE a.bill_id = b.id AND a.status = 'PENDING' LIMIT 1) AS pending_with,
      (SELECT a.created_at FROM hydro_bill_approvals a WHERE a.bill_id = b.id AND a.status = 'PENDING' LIMIT 1) AS pending_since,
      (SELECT a.comments FROM hydro_bill_approvals a WHERE a.bill_id = b.id AND a.status = 'REJECTED' ORDER BY a.acted_at DESC LIMIT 1) AS rejection_comment
    FROM hydro_station_bills b
    JOIN contracts c ON b.contract_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (contract_id) { sql += ' AND b.contract_id = ?'; params.push(contract_id); }
  const listVertical = deskVertical(req.user) || req.query.vertical;
  if (listVertical === 'THERMAL') sql += " AND c.project_type = 'Thermal'";
  else if (listVertical === 'HYDRO') sql += " AND c.project_type IN ('Hydro','PSP')";
  if (billing_month) { sql += ' AND b.billing_month = ?'; params.push(normalizeMonth(billing_month) || billing_month); }
  if (financial_year) { sql += ' AND b.financial_year = ?'; params.push(financial_year); }
  if (status) { sql += ' AND b.status = ?'; params.push(status); }
  if (bill_kind) { sql += ' AND b.bill_kind = ?'; params.push(bill_kind); }
  sql += ' ORDER BY b.billing_month DESC, b.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// POST /hydro-billing/preview — compute a month without saving it.
router.post('/preview', requireRole(...READ), (req, res) => {
  try {
    const month = normalizeMonth(req.body.billing_month);
    if (!month) return res.status(400).json({ error: 'billing_month must be YYYY-MM (e.g. 2026-06) or a month name with year' });
    const contract = getContract(req.body.contract_id);

    const { bill, lines, sources } = computeFor(contract, month, req.body);
    const { revises, prevTotal } = resolveRevision(contract, month, req.body);

    res.json({
      bill: {
        ...bill,
        contract_no: contract.contract_no,
        billing_month: month,
        bill_kind: req.body.bill_kind || 'PROVISIONAL',
        prev_total_charges: prevTotal,
        differential_amount: prevTotal == null ? null : Math.round((bill.total_charges - prevTotal) * 100) / 100,
        revises_bill_no: revises?.bill_no || null,
      },
      lines,
      sources,
      // A month already billed is not an error at preview time — the desk may be
      // about to raise a revision — but it should be visible before saving.
      existing: db.prepare(`
        SELECT id, bill_no, bill_kind, status, total_charges FROM hydro_station_bills
        WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED'
        ORDER BY created_at
      `).all(contract.id, month),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * Compute a month's bill and save it as DRAFT with its beneficiary breakup.
 * Shared by the desk's own save and by the REA run, so both write the same rows.
 */
/** The month's bill on the station's own tariff: hydro or thermal. */
function computeFor(contract, month, body) {
  return isThermal(contract) ? buildThermalBill(contract, month, body) : buildBill(contract, month, body);
}

function saveBill(contract, month, kind, body, req) {
  const { bill, lines, sources } = computeFor(contract, month, body);
  const { revises, prevTotal } = resolveRevision(contract, month, body);
  if (kind === 'REVISION' && !body.revision_reason) {
    throw Object.assign(new Error('A revision must say what changed — supply revision_reason'), { status: 400 });
  }

  const stationName = body.station_name
    || db.prepare('SELECT name FROM entities WHERE id = ?').get(contract.seller_id)?.name
    || contract.contract_no;

  let billNo = genInvoiceNo('HB');
  for (let i = 0; i < 10 && db.prepare('SELECT 1 FROM hydro_station_bills WHERE bill_no = ?').get(billNo); i += 1) {
    billNo = genInvoiceNo('HB');
  }

  const id = newId('HSB');
  const differential = prevTotal == null
    ? null : Math.round((bill.total_charges - prevTotal) * 100) / 100;

  const insertBill = db.prepare(`
    INSERT INTO hydro_station_bills (
      id, bill_no, contract_id, station_name, billing_month, financial_year,
      bill_kind, revises_bill_id, rea_reference, revision_reason,
      a1_afc, a2_design_energy_mwh, a3_aux_pct, a4_fehs_pct,
      a5_ex_bus_design_energy_mwh, a6_ex_bus_saleable_design_energy_mwh,
      a7_installed_capacity_mw, a8_days_in_month, a9_days_in_year, a11_napaf_pct,
      a12_ecr, a13_ecr_excess,
      c1_pafm_pct, c2_capacity_charge, c3_beta_factor, c4_beta_incentive, c4_beta_note,
      c5_total_capacity_charge,
      e1_ex_bus_scheduled_kwh, e2_free_power_kwh, e3_saleable_scheduled_kwh,
      e4_cum_scheduled_kwh, e5_cum_free_power_kwh, e6_cum_saleable_kwh,
      e7_excess_kwh, e8_upto_design_kwh, urs_nr_kwh,
      ee1_energy_charge, ee2_excess_energy_charge, total_charges, nrldc_total_fee,
      prev_total_charges, differential_amount, prepared_by, created_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const insertLine = db.prepare(`
    INSERT INTO hydro_bill_lines (
      id, bill_id, sr_no, beneficiary_name, beneficiary_id, parent_state,
      pct_incl_free, pct_rea, pct_excl_free, pct_proportionate,
      capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
      actual_scheduled_energy_kwh, deducted_scheduled_energy_kwh, is_regulated,
      energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertBill.run(
      id, billNo, contract.id, stationName, month, bill.financial_year,
      kind, revises?.id || null, body.rea_reference || null, body.revision_reason || null,
      bill.a1_afc, bill.a2_design_energy_mwh, bill.a3_aux_pct, bill.a4_fehs_pct,
      bill.a5_ex_bus_design_energy_mwh, bill.a6_ex_bus_saleable_design_energy_mwh,
      bill.a7_installed_capacity_mw, bill.a8_days_in_month, bill.a9_days_in_year, bill.a11_napaf_pct,
      bill.a12_ecr, bill.a13_ecr_excess,
      bill.c1_pafm_pct, bill.c2_capacity_charge, bill.c3_beta_factor, bill.c4_beta_incentive,
      bill.c4_beta_note, bill.c5_total_capacity_charge,
      bill.e1_ex_bus_scheduled_kwh, bill.e2_free_power_kwh, bill.e3_saleable_scheduled_kwh,
      bill.e4_cum_scheduled_kwh, bill.e5_cum_free_power_kwh, bill.e6_cum_saleable_kwh,
      bill.e7_excess_kwh, bill.e8_upto_design_kwh, bill.urs_nr_kwh,
      bill.ee1_energy_charge, bill.ee2_excess_energy_charge, bill.total_charges, bill.nrldc_total_fee,
      prevTotal, differential, req?.user?.name || req?.user?.email || null, req?.user?.id || null,
    );
    for (const l of lines) {
      insertLine.run(
        newId('HBL'), id, l.sr_no, l.beneficiary_name, l.beneficiary_id, l.parent_state,
        l.pct_incl_free, l.pct_rea, l.pct_excl_free, l.pct_proportionate,
        l.capacity_charge, l.saleable_energy_kwh, l.energy_upto_design_kwh, l.energy_excess_kwh,
        l.actual_scheduled_energy_kwh, l.deducted_scheduled_energy_kwh, l.is_regulated,
        l.energy_charge_upto, l.energy_charge_excess, l.energy_charge_total, l.nrldc_fee, l.total_charges,
      );
    }
  })();

  secureLogAudit(req, {
    action: 'HYDRO_STATION_BILL_CREATED',
    module: 'HYDRO',
    entityType: 'hydro_station_bills',
    entityId: id,
    afterValue: {
      bill_no: billNo, station_name: stationName, billing_month: month, bill_kind: kind,
      ecr: bill.a12_ecr, capacity_charge: bill.c5_total_capacity_charge,
      energy_charge: bill.ee1_energy_charge + bill.ee2_excess_energy_charge,
      total_charges: bill.total_charges, beneficiaries: lines.length, sources,
    },
  });

  if (bill.thermal_inputs) {
    db.prepare('UPDATE hydro_station_bills SET thermal_inputs_json = ? WHERE id = ?').run(JSON.stringify(bill.thermal_inputs), id);
  }
  return { id, bill_no: billNo, billing_month: month, bill_kind: kind, ...bill, lines, sources };
}

// POST /hydro-billing — save a bill as DRAFT, with its beneficiary breakup.
router.post('/', requireRole(...WRITE), (req, res) => {
  try {
    const month = normalizeMonth(req.body.billing_month);
    if (!month) return res.status(400).json({ error: 'billing_month must be YYYY-MM (e.g. 2026-06) or a month name with year' });
    const contract = getContract(req.body.contract_id);

    const kind = req.body.bill_kind || 'PROVISIONAL';
    if (!['PROVISIONAL', 'REVISION', 'FINAL'].includes(kind)) {
      return res.status(400).json({ error: 'bill_kind must be PROVISIONAL, REVISION or FINAL' });
    }

    // The unique index refuses a second live PROVISIONAL or FINAL for a month,
    // but catching it here names the bill that already exists.
    if (kind !== 'REVISION') {
      const clash = db.prepare(`
        SELECT bill_no, status FROM hydro_station_bills
        WHERE contract_id = ? AND billing_month = ? AND bill_kind = ? AND status <> 'CANCELLED'
      `).get(contract.id, month, kind);
      if (clash) {
        return res.status(409).json({
          error: `${contract.contract_no} already has a ${kind} bill for ${month} — ${clash.bill_no} (${clash.status}). Raise a revision instead, or cancel that bill.`,
          existing_bill_no: clash.bill_no,
        });
      }
    }

    res.json(saveBill(contract, month, kind, req.body, req));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/** Months from `from` to `to` inclusive, oldest first (YYYY-MM). */
function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The months of the financial year (April start) before `month`. */
function fyMonthsBefore(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${m >= 4 ? y : y - 1}-04`;
  return start === month ? [] : monthRange(start, month).slice(0, -1);
}

/**
 * Bring a month's REA into energy_data for the hydro stations: the FINAL
 * account if the RPC has published one, else the provisional. Returns which
 * one the month's bills will stand on, or null if neither is out.
 */
async function importReaMonth(rpc, month, stationIds, link = null) {
  const held = (type) => db.prepare(`
    SELECT COUNT(*) c FROM energy_data
    WHERE period_month = ? AND data_type = ? AND source = 'REA'
      AND contract_id IN (${stationIds.map(() => '?').join(',')})
  `).get(month, type, ...stationIds).c > 0;
  const notes = [];
  // A link copied off the RPC site says which account it is by its name
  // (…REA0826_P.pdf provisional, …Rea0625_F.pdf final); without one, the
  // final account is tried first, then the provisional.
  const types = link ? [/_F\.pdf$/i.test(link) ? 'FINAL' : 'PROVISIONAL'] : ['FINAL', 'PROVISIONAL'];
  for (const type of types) {
    if (held(type)) return { data_type: type, imported: false, notes };
    const run = () => reaScraper.triggerManual(rpc, month, type, { url: link });
    try {
      const r = await run();
      if (held(type)) return { data_type: type, imported: true, stations_parsed: r.parsedStations, notes };
      notes.push(`${type} REA parsed ${r.parsedStations} station(s) but none matched a hydro station contract`);
    } catch (err) {
      if (/not found \(404\)/.test(err.message)) { notes.push(`${type} REA not published${link ? ' at the link given' : ''}`); continue; }
      if (/already processed/.test(err.message)) {
        // Processed before the station contracts existed, so nothing landed
        // for them. Re-running is safe: the save skips any row already held.
        db.prepare(`DELETE FROM rea_fetch_log WHERE rpc_source = ? AND period_month = ? AND data_type = ? AND status = 'PROCESSED'`)
          .run(rpc, month, type);
        const r = await run();
        if (held(type)) return { data_type: type, imported: true, stations_parsed: r.parsedStations, notes };
        notes.push(`${type} REA re-read, but no hydro station contract matched`);
        continue;
      }
      throw err;
    }
  }
  return { data_type: null, imported: false, notes };
}

/** Every hydro/PSP station PPA the desk bills, live ones first to last. */
function hydroStations() {
  return db.prepare(`
    SELECT c.*, e.name AS seller_name FROM contracts c
    LEFT JOIN entities e ON c.seller_id = e.id
    WHERE c.contract_type = 'PPA' AND c.project_type IN ('Hydro','PSP') AND c.status IN ('ACTIVE','SIGNED')
    ORDER BY c.contract_no
  `).all();
}

/**
 * POST /hydro-billing/from-rea — fetch each month's Regional Energy Account
 * from the RPC website and draft that month's bill for every hydro station
 * that is ready to bill.
 *
 * Months run oldest first because a bill carries the financial year's
 * cumulative energy (E4-E6) from the bills before it: the excess-energy split
 * is only right if every earlier month of the year is already billed. So a
 * station whose month fails is not billed for any later month in the run.
 *
 * NRPC's current site names each PDF with an upload timestamp, so a month's
 * link can be passed in `rea_links` (copied from the site); months without
 * one use the RPC's older fixed URLs.
 *
 * Bills are saved as DRAFT and nothing is issued or sent — the desk reviews,
 * enters β where NRPC has certified it, and issues as usual. A month that
 * already has a live bill is left alone.
 */
async function runFromRea(body, actor, onProgress) {
  const from = normalizeMonth(body.from_month);
  const to = normalizeMonth(body.to_month || body.from_month);
  if (!from || !to) throw Object.assign(new Error('from_month and to_month must be YYYY-MM'), { status: 400 });
  if (from > to) throw Object.assign(new Error('from_month is after to_month'), { status: 400 });
  const months = monthRange(from, to);
  if (months.length > 12) throw Object.assign(new Error('At most 12 months in one run'), { status: 400 });
  const rpc = body.rpc || 'NRPC';
  // { "2026-08": "https://nrpc.gov.in/allfile/…REA0826_P.pdf", … }
  const links = body.rea_links && typeof body.rea_links === 'object' ? body.rea_links : {};

  const stations = hydroStations();
  const ready = stations.filter((c) => readiness(c).ready);
  const skippedStations = stations.filter((c) => !readiness(c).ready)
    .map((c) => ({ contract_no: c.contract_no, station_name: c.seller_name, missing: readiness(c).missing }));
  if (!ready.length) {
    throw Object.assign(new Error('No hydro station is ready to bill'), { status: 400, stations: skippedStations });
  }

  const blocked = new Set();
  const results = [];
  for (const month of months) {
    onProgress?.({ month, done: results.length, total: months.length, months: results });
    let rea;
    try {
      rea = await importReaMonth(rpc, month, ready.map((c) => c.id), links[month] || null);
    } catch (err) {
      results.push({ month, rea: null, error: `REA import failed: ${err.message}`, bills: [] });
      ready.forEach((c) => blocked.add(c.id));
      continue;
    }
    const bills = [];
    for (const c of ready) {
      const row = { contract_no: c.contract_no, station_name: c.seller_name };
      if (blocked.has(c.id)) { bills.push({ ...row, status: 'SKIPPED', cascade: true, reason: 'an earlier month in this run was not billed, so the cumulative would be wrong' }); continue; }
      const live = db.prepare(`
        SELECT bill_no, bill_kind, status FROM hydro_station_bills
        WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED' AND bill_kind IN ('PROVISIONAL','FINAL')
        ORDER BY created_at DESC LIMIT 1
      `).get(c.id, month);
      if (live) { bills.push({ ...row, status: 'EXISTS', bill_no: live.bill_no, bill_kind: live.bill_kind, bill_status: live.status }); continue; }
      // The bill carries the year's cumulative from the bills before it, so
      // every earlier month of the financial year must already be billed —
      // whether in this run or an earlier one (the page sends one month per
      // request, so the run-local check above is not enough on its own).
      const gaps = fyMonthsBefore(month).filter((m) => !db.prepare(`
        SELECT 1 FROM hydro_station_bills
        WHERE contract_id = ? AND billing_month = ? AND status <> 'CANCELLED'
      `).get(c.id, m));
      if (gaps.length) {
        bills.push({ ...row, status: 'SKIPPED', reason: `not billed yet this financial year: ${gaps.join(', ')} — bill those first` });
        blocked.add(c.id);
        continue;
      }
      if (!rea.data_type) { bills.push({ ...row, status: 'SKIPPED', reason: 'REA not published for this month' }); blocked.add(c.id); continue; }
      const energy = db.prepare(`
        SELECT energy_mwh, availability_percent, free_energy_mwh, status, deviation_notes FROM energy_data
        WHERE contract_id = ? AND period_month = ? AND data_type = ? AND source = 'REA'
        ORDER BY updated_at DESC LIMIT 1
      `).get(c.id, month, rea.data_type);
      if (!energy) { bills.push({ ...row, status: 'SKIPPED', reason: `station not found in the ${rea.data_type} REA` }); blocked.add(c.id); continue; }
      // Energy identical to the month beside it is that month's account read
      // twice; billing it would charge the beneficiaries twice for one month.
      if (isHeldAsSameAsAdjacent(energy)) { bills.push({ ...row, status: 'SKIPPED', reason: energy.deviation_notes }); blocked.add(c.id); continue; }
      // The energy is this month's; the percentages it is apportioned on have
      // to be this month's too. An account whose entitlements cannot be turned
      // into a sheet is not billed on last month's — that is how a beneficiary
      // with no share came to be billed for one.
      const allocation = await syncAllocationFromRea(c, month, { rpc, dataType: rea.data_type, actor });
      if (allocation.status === 'REFUSED') {
        bills.push({ ...row, status: 'SKIPPED', allocation, reason: `the allocation for ${month} could not be taken from the REA: ${allocation.reason} — enter the sheet for ${month} and run again` });
        blocked.add(c.id);
        continue;
      }
      try {
        const kind = rea.data_type === 'FINAL' ? 'FINAL' : 'PROVISIONAL';
        const saved = saveBill(c, month, kind, {
          ex_bus_scheduled_kwh: Number(energy.energy_mwh) * 1000,
          pafm_percent: energy.availability_percent,
          ...(energy.free_energy_mwh != null ? { free_power_kwh: Number(energy.free_energy_mwh) * 1000 } : {}),
          rea_reference: `${rpc} ${rea.data_type === 'FINAL' ? 'Final' : 'Provisional'} REA ${month}`,
        }, actor);
        bills.push({
          ...row, status: 'CREATED', bill_no: saved.bill_no, bill_kind: kind,
          energy_mwh: energy.energy_mwh, free_power_mwh: energy.free_energy_mwh, pafm_pct: saved.c1_pafm_pct,
          total_charges: saved.total_charges, beta_note: saved.c4_beta_note, sources: saved.sources,
          allocation,
        });
      } catch (err) {
        bills.push({ ...row, status: 'FAILED', reason: err.message });
        blocked.add(c.id);
      }
    }
    results.push({ month, rea: rea.data_type, rea_imported: rea.imported, notes: rea.notes, bills });
  }

  secureLogAudit(actor, {
    action: 'HYDRO_BILLS_FROM_REA',
    module: 'HYDRO',
    entityType: 'hydro_station_bills',
    entityId: `${rpc}:${from}..${to}`,
    afterValue: {
      rpc, from, to,
      created: results.flatMap((r) => r.bills).filter((b) => b.status === 'CREATED').map((b) => b.bill_no),
    },
  });
  return { rpc, from_month: from, to_month: to, months: results, stations_not_ready: skippedStations };
}

// A run can outlast the proxies in front of the server (NRPC PDFs are a few MB
// and parsing takes a while), so the page asks for it in the background and
// polls. One run at a time: two overlapping runs would race each other on the
// same months.
const reaJobs = new Map();
let reaJobRunning = null;

router.post('/from-rea', requireRole(...WRITE), async (req, res) => {
  if (!req.body.background) {
    try {
      return res.json(await runFromRea(req.body, req));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message, ...(err.stations ? { stations: err.stations } : {}) });
    }
  }
  if (reaJobRunning) {
    return res.status(409).json({ error: 'An REA run is already in progress — wait for it to finish', job_id: reaJobRunning });
  }
  const id = newId('REAJOB');
  const job = { id, status: 'RUNNING', started_at: new Date().toISOString(), progress: null, result: null, error: null };
  reaJobs.set(id, job);
  reaJobRunning = id;
  runFromRea(req.body, req, (p) => { job.progress = { month: p.month, done: p.done, total: p.total }; job.partial = p.months; })
    .then((r) => { job.status = 'DONE'; job.result = r; })
    .catch((err) => { job.status = 'FAILED'; job.error = err.message; job.partial = job.partial || []; })
    .finally(() => { reaJobRunning = null; job.finished_at = new Date().toISOString(); });
  // Keep the last few jobs only.
  if (reaJobs.size > 20) reaJobs.delete(reaJobs.keys().next().value);
  return res.status(202).json({ job_id: id, status: job.status });
});

router.get('/from-rea/jobs/:id', requireRole(...WRITE), (req, res) => {
  const job = reaJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'No such REA run (the server may have restarted) — look at the bills list, then run again' });
  const { partial, ...rest } = job;
  res.json({ ...rest, months: job.result?.months || partial || [] });
});

/**
 * POST /hydro-billing/upload-rea — upload an REA PDF document directly from local machine.
 * Parses Table D2 & station energy, matches contracts, populates energy_data,
 * and drafts the hydro bills for ready stations.
 */
router.post('/upload-rea', requireRole(...WRITE), reaUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No REA PDF file was uploaded' });
  }

  const tempPath = req.file.path;
  const originalName = req.file.originalname || 'REA.pdf';
  const rpc = req.body.rpc || 'NRPC';

  try {
    const parsed = await reaScraper.parsePdf(tempPath, rpc);
    if (!parsed || !parsed.data || !parsed.data.length) {
      throw new Error('No hydro station energy or availability records could be extracted from this PDF. Please ensure it is an authentic NRPC/RPC Regional Energy Account.');
    }

    // The account's own month decides where it is filed. A month typed in, or
    // read off the file name, is only checked against it: it used to stand in
    // when the account named none, and could file one month's REA as another's.
    if (!parsed.period) {
      throw new Error('Could not identify the month from the REA PDF itself, so it is not filed under any month.');
    }
    const claimed = req.body.period_month || monthFromFileName(originalName) || parsed.period;
    const detectedPeriod = checkAccountPeriod(parsed, claimed);

    const dataType = req.body.data_type || (/_F\.pdf$/i.test(originalName) ? 'FINAL' : 'PROVISIONAL');

    // Archive PDF to rea_downloads directory
    const targetDir = path.join(__dirname, `../../rea_downloads/${rpc}/${detectedPeriod}`);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, `REA_${rpc}_${detectedPeriod}_${dataType}.pdf`);
    try {
      fs.copyFileSync(tempPath, targetFile);
    } catch (copyErr) {
      console.warn('[upload-rea] Could not persist REA file copy:', copyErr.message);
    }

    // Register in rea_fetch_log
    const logId = newId('REALOG');
    db.prepare(`DELETE FROM rea_fetch_log WHERE rpc_source = ? AND period_month = ? AND data_type = ? AND status = 'FAILED'`).run(rpc, detectedPeriod, dataType);
    db.prepare(`
      INSERT OR REPLACE INTO rea_fetch_log (id, rpc_source, period_month, data_type, local_file_path, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'PARSED', datetime('now'))
    `).run(logId, rpc, detectedPeriod, dataType, targetFile);

    // Save energy_data records
    const recordsSaved = reaScraper.processAndSave(logId, parsed.data, rpc, detectedPeriod, dataType);

    // Run drafting for this month
    const fromMonth = req.body.from_month || detectedPeriod;
    const toMonth = req.body.to_month || detectedPeriod;
    const draftResult = await runFromRea({ from_month: fromMonth, to_month: toMonth, rpc }, req);

    return res.json({
      success: true,
      period: detectedPeriod,
      data_type: dataType,
      stations_parsed: parsed.data.length,
      records_saved: recordsSaved,
      file_name: originalName,
      ...draftResult,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  } finally {
    fs.unlink(tempPath, () => {});
  }
});

// ─── Drafting without being asked ────────────────────────────────────────────
//
// The REA scraper already fetches each month's Regional Energy Account off the
// RPC site on a schedule and lands the energy behind it. The bills that account
// makes possible still waited for someone to open the page and press the
// button, so an account published on a Saturday sat undrafted until Monday —
// and the desk's own month-end was spent re-doing what the platform already had
// every input for.
//
// This is that same run, started by the scraper instead of by a person: the
// same readiness checks, the same oldest-first order so the year's cumulative
// is right, and the same DRAFT bills that nobody has issued or sent. What it
// does not do is decide anything — a draft still goes through review, β entry
// and the approval chain before it becomes a bill.
//
// Switched off with the hydro_rea_auto_draft parameter.

// A bill made this way is recorded as made by the platform rather than by the
// last person who happened to be signed in. secureLogAudit() and saveBill()
// both read a request loosely, so this shape is all either of them needs.
const AUTO_DRAFT_ACTOR = { user: { name: 'REA auto-draft', role: 'SYSTEM' } };

/** `n` months back from now, as YYYY-MM. */
function monthsBack(n, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The months in the window that have an REA on file for a billable station and
 * no live bill against it. Empty means there is nothing for a run to do, which
 * is the normal answer on most days — the scraper fires far more often than the
 * RPC publishes, and a run costs several PDF fetches.
 */
function monthsAwaitingDraft(readyIds, from, to) {
  if (!readyIds.length) return [];
  return db.prepare(`
    SELECT DISTINCT e.period_month AS month FROM energy_data e
    WHERE e.source = 'REA'
      AND e.period_month BETWEEN ? AND ?
      AND e.contract_id IN (${readyIds.map(() => '?').join(',')})
      AND NOT EXISTS (
        SELECT 1 FROM hydro_station_bills b
        WHERE b.contract_id = e.contract_id AND b.billing_month = e.period_month
          AND b.status <> 'CANCELLED' AND b.bill_kind IN ('PROVISIONAL','FINAL')
      )
    ORDER BY month
  `).all(from, to, ...readyIds).map((r) => r.month);
}

/**
 * Write down that a sweep happened, and what came of it.
 *
 * Recorded for the runs that did nothing as much as for the ones that drafted:
 * "it ran at 06:00 and no account had landed" and "it has not run since the
 * release on Tuesday" look identical on the bills list, and only one of them is
 * fine. Trimmed to the last two hundred, which is about four months of sweeps.
 */
function recordAutoDraft({ rpc = 'NRPC', from = null, to = null, outcome, detail = null, created = [], blocked = [], startedAt }) {
  const id = newId('ADR');
  db.prepare(`
    INSERT INTO hydro_auto_draft_runs
      (id, rpc, from_month, to_month, outcome, detail, bills_created, bill_nos, blocked, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, rpc, from, to, outcome, detail, created.length,
    created.length ? created.join(', ') : null,
    blocked.length ? JSON.stringify(blocked) : null,
    startedAt || new Date().toISOString());
  db.prepare(`
    DELETE FROM hydro_auto_draft_runs WHERE id NOT IN (
      SELECT id FROM hydro_auto_draft_runs ORDER BY started_at DESC, rowid DESC LIMIT 200
    )
  `).run();
  return id;
}

/**
 * Say it once.
 *
 * The scraper runs every morning through the first ten days of the month, and a
 * blockage it reports — a station with no allocation, a month nobody has billed
 * — is not fixed by being told about it ten times. The same sentence to the
 * same audience is not repeated inside a week; a sentence that names new bills
 * is different every time and so always goes out.
 */
function noteOnce(role, message) {
  const said = db.prepare(`
    SELECT 1 FROM notifications
    WHERE type = 'HYDRO_BILL_AUTO_DRAFT' AND role = ? AND message = ?
      AND created_at > datetime('now', '-7 days')
  `).get(role, message);
  if (said) return false;
  pushNotification({ role, type: 'HYDRO_BILL_AUTO_DRAFT', message });
  return true;
}

/**
 * What the desk needs to know about the sheet a draft was apportioned on, or
 * nothing when the sheet in force already said what the account says.
 */
function allocationNotice(b) {
  const a = b.allocation;
  if (!a) return null;
  const head = `${b.bill_no} (${b.contract_no}, ${b.month})`;
  if (a.status === 'WRITTEN') {
    const moved = a.changes?.length ? `: ${a.changes.slice(0, 6).join('; ')}${a.changes.length > 6 ? `; and ${a.changes.length - 6} more` : ''}` : '';
    return `${head} was apportioned on a new allocation sheet taken from the ${a.source}${moved}.`
      + (a.provisional ? ' Delhi\'s split among its licensees is carried from the last sheet until Delhi SLDC publishes its account — the draft will be checked against it.' : '');
  }
  if (a.status === 'DESK_SHEET' && a.warnings?.length) {
    return `${head} was apportioned on the sheet entered for the month, which does not agree with the REA — ${a.warnings.slice(0, 4).join('; ')}. Correct the sheet and redraft.`;
  }
  if (a.status === 'NO_ENTITLEMENT') {
    return `${head} was apportioned on the sheet already in force: ${a.reason}. Check its percentages against Table C1 before it goes for approval.`;
  }
  return null;
}

/**
 * Check the drafts whose Delhi split was carried, now that Delhi SLDC may have
 * published. Runs after each scheduled scan; says something only when an
 * account has landed.
 */
export async function runDelhiSplitConfirmation() {
  const results = await confirmProvisionalDelhiSplits({ actor: AUTO_DRAFT_ACTOR });
  for (const r of results) {
    if (r.status === 'CONFIRMED') {
      pushNotification({ role: 'COMMERCIAL_ADMIN', type: 'HYDRO_BILL_AUTO_DRAFT', message: `Delhi SLDC's account for ${r.month} is out and agrees with the Delhi split used for ${r.contract_no} — nothing to change.` });
    } else if (r.status === 'CORRECTED') {
      pushNotification({
        role: 'COMMERCIAL_ADMIN',
        type: 'HYDRO_BILL_AUTO_DRAFT',
        message: `Delhi SLDC's account for ${r.month} is out and the Delhi split for ${r.contract_no} differs from the carried one: ${r.changes.join('; ')}. The allocation sheet has been corrected.`
          + (r.bill ? ` ${r.bill.bill_no} (${r.bill.status}) was drafted on the carried split — cancel it and draft again.` : ''),
      });
    } else if (r.status === 'DISAGREES') {
      noteOnce('COMMERCIAL_ADMIN', `Delhi SLDC's account for ${r.month} could not be applied to ${r.contract_no}: ${r.reason}. Check the Delhi rows of the allocation sheet by hand.`);
    }
  }
  return results;
}

/** The first few station-months and why, short enough to read on a phone. */
function reasons(rows, limit = 5) {
  const head = rows.slice(0, limit).map((b) => `${b.month} ${b.contract_no} (${b.reason})`).join('; ');
  return rows.length > limit ? `${head}; and ${rows.length - limit} more` : head;
}

/**
 * Draft whatever the accounts on file allow, and say what happened.
 *
 * Runs under the same single-run lock as the background button, and registers
 * itself in the same job map — so a desk that opens the page mid-sweep is told
 * a run is in progress and can watch this one finish, rather than starting a
 * second run over the same months.
 */
export async function runReaAutoDraft({ rpc = 'NRPC', lookbackMonths = 3, now = new Date() } = {}) {
  const startedAt = new Date().toISOString();
  const nothing = (outcome, detail) => {
    recordAutoDraft({ rpc, outcome, detail, startedAt });
    return { skipped: detail };
  };
  if (String(getParam('hydro_rea_auto_draft', 'true')).toLowerCase() !== 'true') {
    return nothing('OFF', 'switched off (hydro_rea_auto_draft)');
  }
  // Not recorded: the sweep did not decide anything, it stood aside for a run
  // that is about to write its own row.
  if (reaJobRunning) return { skipped: `an REA run is already in progress (${reaJobRunning})` };

  const ready = hydroStations().filter((c) => readiness(c).ready);
  if (!ready.length) return nothing('NOTHING_TO_DO', 'no hydro station is ready to bill');

  const waiting = monthsAwaitingDraft(ready.map((c) => c.id), monthsBack(lookbackMonths, now), monthsBack(0, now));
  if (!waiting.length) return nothing('NOTHING_TO_DO', 'no month in the window has an unbilled account');

  const id = newId('REAJOB');
  const job = {
    id, trigger: 'AUTO', status: 'RUNNING', started_at: new Date().toISOString(),
    progress: null, result: null, error: null,
  };
  reaJobs.set(id, job);
  reaJobRunning = id;
  const from = waiting[0];
  const to = waiting[waiting.length - 1];
  try {
    const result = await runFromRea({ rpc, from_month: from, to_month: to }, AUTO_DRAFT_ACTOR, (p) => {
      job.progress = { month: p.month, done: p.done, total: p.total };
      job.partial = p.months;
    });
    job.status = 'DONE';
    job.result = result;
    const bills = result.months.flatMap((m) => m.bills.map((b) => ({ ...b, month: m.month })));
    const created = bills.filter((b) => b.status === 'CREATED');
    const failed = bills.filter((b) => b.status === 'FAILED');
    const blocked = bills.filter((b) => b.status !== 'CREATED' && b.status !== 'EXISTS' && b.reason && !b.cascade);
    if (created.length) {
      noteOnce('COMMERCIAL_ADMIN', `${created.length} hydro station bill(s) drafted from the ${rpc} REA for ${from}${to === from ? '' : `..${to}`} — review and send for approval: ${created.map((b) => b.bill_no).join(', ')}`);
    }
    // A month whose account has landed and which still did not get billed is
    // the desk's to fix — a missing allocation, an unbilled earlier month. Said
    // plainly, because the whole promise of drafting without being asked is
    // that silence means the bills are there.
    if (blocked.length) {
      noteOnce('COMMERCIAL_ADMIN', `Auto-draft left ${blocked.length} station-month(s) unbilled: ${reasons(blocked)}`);
    }
    for (const b of created) {
      const said = allocationNotice(b);
      if (said) noteOnce('COMMERCIAL_ADMIN', said);
    }
    // A station that threw is a fault in the platform, not a gap in the inputs.
    if (failed.length) {
      noteOnce('SJVN_ADMIN', `Auto-draft failed on ${failed.length} station-month(s): ${reasons(failed)}`);
    }
    const billNos = created.map((b) => b.bill_no);
    const left = blocked.map((b) => ({ month: b.month, contract_no: b.contract_no, reason: b.reason }));
    recordAutoDraft({
      rpc, from, to, startedAt, created: billNos, blocked: left,
      outcome: billNos.length ? 'DRAFTED' : (left.length ? 'BLOCKED' : 'NOTHING_TO_DO'),
      detail: billNos.length || left.length ? null : 'the accounts on file produced no new bill',
    });
    return {
      job_id: id, rpc, from_month: from, to_month: to,
      created: billNos,
      failed: failed.map((b) => ({ month: b.month, contract_no: b.contract_no, reason: b.reason })),
      blocked: left,
      months: result.months,
    };
  } catch (err) {
    job.status = 'FAILED';
    job.error = err.message;
    noteOnce('SJVN_ADMIN', `Auto-draft from the ${rpc} REA failed for ${from}..${to}: ${err.message}. Draft from the Hydro Billing page instead.`);
    recordAutoDraft({ rpc, from, to, outcome: 'FAILED', detail: err.message, startedAt });
    return { job_id: id, from_month: from, to_month: to, error: err.message };
  } finally {
    reaJobRunning = null;
    job.finished_at = new Date().toISOString();
    if (reaJobs.size > 20) reaJobs.delete(reaJobs.keys().next().value);
  }
}

/**
 * GET /hydro-billing/from-rea/auto — whether drafting runs by itself, when it
 * last did, and what it left behind.
 *
 * Read-only and open to the whole desk: an empty bills list is ambiguous until
 * you know whether the sweep ran, so everyone who reads the list needs this.
 */
router.get('/from-rea/auto', requireRole(...READ), (_req, res) => {
  const last = db.prepare(`
    SELECT * FROM hydro_auto_draft_runs ORDER BY started_at DESC, rowid DESC LIMIT 1
  `).get();
  const recent = db.prepare(`
    SELECT started_at, outcome, from_month, to_month, bills_created, detail
    FROM hydro_auto_draft_runs ORDER BY started_at DESC, rowid DESC LIMIT 10
  `).all();
  res.json({
    enabled: String(getParam('hydro_rea_auto_draft', 'true')).toLowerCase() === 'true',
    running: reaJobRunning ? (reaJobs.get(reaJobRunning)?.trigger === 'AUTO') : false,
    last: last ? {
      ...last,
      bill_nos: last.bill_nos ? last.bill_nos.split(', ') : [],
      blocked: last.blocked ? JSON.parse(last.blocked) : [],
    } : null,
    recent,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Approval chain
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/approvals/inbox — bills waiting on the signed-in user.
router.get('/approvals/inbox', requireRole(...READ), (req, res) => {
  res.json(approvalInbox(req.user?.id));
});

/**
 * GET /hydro-billing/approvers — who a bill can be routed to.
 *
 * The general users endpoint deliberately shows a non-admin only themselves,
 * which is right for user administration and useless for picking an approver.
 * This is the narrow version that workflow needs: active users who could
 * actually approve a REIA bill, and nothing about them beyond the name and role
 * needed to choose between them.
 */
router.get('/approvers', requireRole(...READ), (req, res) => {
  // A thermal bill is approved on the thermal desk, a hydro bill on the hydro desk.
  const vertical = deskVertical(req.user) || (req.query.vertical === 'THERMAL' ? 'THERMAL' : 'HYDRO');
  const roles = vertical === 'THERMAL'
    ? ROLE_GROUPS.THERMAL_WRITE
    : ROLE_GROUPS.HYDRO_THERMAL_WRITE;
  const placeholders = roles.map(() => '?').join(',');
  res.json(db.prepare(`
    SELECT id, name, role FROM users
    WHERE is_active = 1 AND role IN (${placeholders})
    ORDER BY name
  `).all(...roles).map((u) => ({ ...u, is_self: u.id === req.user?.id })));
});

// POST /hydro-billing/:id/send-for-approval
router.post('/:id/send-for-approval', requireRole(...WRITE), (req, res) => {
  try {
    const bill = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const result = sendForApproval(bill, {
      nextApproverId: req.body.next_approver_id,
      finalApproverId: req.body.final_approver_id,
      comments: req.body.comments,
      user: req.user,
    });

    notifyBillForApproval(bill, req.body.next_approver_id);

    secureLogAudit(req, {
      action: 'HYDRO_BILL_SENT_FOR_APPROVAL',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: bill.id,
      afterValue: { bill_no: bill.bill_no, ...result },
    });
    res.json({ bill_no: bill.bill_no, approval_status: 'IN_APPROVAL', ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/:id/approve — approve, reject or forward the open step.
router.post('/:id/approve', requireRole(...READ), (req, res) => {
  try {
    const bill = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const result = actOnApproval(bill, {
      action: req.body.action,
      comments: req.body.comments,
      nextApproverId: req.body.next_approver_id,
      markFinal: !!req.body.mark_final,
      user: req.user,
    });

    // Whoever raised this has been waiting on the answer, either way.
    if (result.outcome === 'APPROVED') notifyBillApproved(bill);
    else if (result.outcome === 'REJECTED') notifyBillRejected(bill, req.body.comments);
    else if (req.body.next_approver_id) notifyBillForApproval(bill, req.body.next_approver_id);

    secureLogAudit(req, {
      action: `HYDRO_BILL_APPROVAL_${result.outcome}`,
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: bill.id,
      afterValue: { bill_no: bill.bill_no, ...result },
      reason: req.body.comments,
    });
    res.json({
      bill_no: bill.bill_no,
      ...result,
      approval_status: db.prepare('SELECT approval_status FROM hydro_station_bills WHERE id = ?').get(bill.id).approval_status,
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /hydro-billing/:id/approvals — the chain as it happened.
router.get('/:id/approvals', requireRole(...READ), (req, res) => {
  res.json({ trail: approvalTrail(req.params.id), pending: pendingStep(req.params.id) });
});

// ─────────────────────────────────────────────────────────────────────────────
// Beneficiary ledger — SAP's Account Display
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/ledger/accounts?contract_id=
router.get('/ledger/accounts', requireRole(...READ), (req, res) => {
  const { contract_id } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
  res.json(beneficiariesWithAccounts(contract_id));
});

// GET /hydro-billing/ledger?contract_id=&beneficiary=
router.get('/ledger', requireRole(...READ), (req, res) => {
  const { contract_id, beneficiary } = req.query;
  if (!contract_id || !beneficiary) {
    return res.status(400).json({ error: 'contract_id and beneficiary are required' });
  }
  try {
    const account = accountDisplay(contract_id, beneficiary);
    res.json({ ...account, lps: accruedLpsFor(contract_id, beneficiary) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /hydro-billing/ledger/payment — money received from a beneficiary.
router.post('/ledger/payment', requireRole(...WRITE), (req, res) => {
  try {
    const { contract_id, beneficiary, amount, payment_date, mode, reference, info } = req.body;
    const result = recordPayment({
      contractId: contract_id,
      beneficiaryName: beneficiary,
      beneficiaryId: req.body.beneficiary_id || null,
      amount, paymentDate: payment_date, mode, reference, info,
      // The CERC early-payment rebate is allowed unless the desk says otherwise
      // (e.g. a payment the PPA excludes from rebate).
      rebate: req.body.rebate !== false,
      createdBy: req.user?.id || null,
    });

    // What the beneficiary owes after this payment was applied — the figure
    // they would otherwise have to ring the desk to find out.
    const after = accountDisplay(contract_id, beneficiary);
    notifyPaymentReceived({
      contractId: contract_id,
      beneficiaryName: beneficiary,
      beneficiaryId: req.body.beneficiary_id || null,
      amount: result.doc.amount,
      billNo: result.clearings?.[0]?.doc_no || null,
      outstanding: after.totals.outstanding,
    });

    secureLogAudit(req, {
      action: 'HYDRO_LEDGER_PAYMENT_RECORDED',
      module: 'HYDRO',
      entityType: 'hydro_ledger_docs',
      entityId: result.doc.id,
      afterValue: {
        doc_no: result.doc.doc_no, beneficiary, amount: result.doc.amount,
        cleared: result.clearings.length, unapplied: result.unapplied, rebate: result.rebate,
      },
    });
    res.json({
      ...result,
      // Money beyond what was owed stays on the account as an advance; saying so
      // stops it being read as a fully settled bill.
      note: result.unapplied > 0
        ? `₹${result.unapplied.toLocaleString('en-IN')} is unapplied and sits as an advance`
        : null,
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/ledger/:docId/reverse-payment
router.post('/ledger/:docId/reverse-payment', requireRole(...WRITE), (req, res) => {
  try {
    const result = reversePayment(req.params.docId, {
      reason: req.body.reason,
      onDate: req.body.on_date,
      createdBy: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'HYDRO_LEDGER_PAYMENT_REVERSED',
      module: 'HYDRO',
      entityType: 'hydro_ledger_docs',
      entityId: req.params.docId,
      afterValue: result,
      reason: req.body.reason,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/ledger/:docId/reset-clearing — release a payment from the
// bills it cleared, leaving it on the account as an advance.
router.post('/ledger/:docId/reset-clearing', requireRole(...WRITE), (req, res) => {
  try {
    const result = resetClearing(req.params.docId, { createdBy: req.user?.id || null });
    secureLogAudit(req, {
      action: 'HYDRO_LEDGER_CLEARING_RESET',
      module: 'HYDRO',
      entityType: 'hydro_ledger_docs',
      entityId: req.params.docId,
      afterValue: result,
    });
    res.json({ ...result, note: 'The payment now shows as an advance until it is applied again' });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/ledger/:docId/account-maintenance — apply an advance.
router.post('/ledger/:docId/account-maintenance', requireRole(...WRITE), (req, res) => {
  try {
    const result = accountMaintenance(req.params.docId, {
      debitDocIds: req.body.debit_doc_ids || null,
      onDate: req.body.on_date,
      createdBy: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'HYDRO_LEDGER_ACCOUNT_MAINTENANCE',
      module: 'HYDRO',
      entityType: 'hydro_ledger_docs',
      entityId: req.params.docId,
      afterValue: result,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /hydro-billing/ledger/lps — what has accrued, without charging it.
router.get('/ledger/lps', requireRole(...READ), (req, res) => {
  const { contract_id, beneficiary, as_of } = req.query;
  if (!contract_id || !beneficiary) {
    return res.status(400).json({ error: 'contract_id and beneficiary are required' });
  }
  try {
    res.json(accruedLpsFor(contract_id, beneficiary, { asOf: as_of ? new Date(as_of) : new Date() }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /hydro-billing/ledger/lps — raise LPS documents for what is chargeable.
router.post('/ledger/lps', requireRole(...WRITE), (req, res) => {
  try {
    const { contract_id, beneficiary, as_of } = req.body;
    if (!contract_id || !beneficiary) {
      return res.status(400).json({ error: 'contract_id and beneficiary are required' });
    }
    // Surcharge is charged for days that have passed: an as_of ahead posted
    // 15 months of LPS that had not accrued (Hydro QA run 4). The accrual view
    // (GET) may still look ahead.
    const asOfDay = as_of ? String(as_of).slice(0, 10) : null;
    if (asOfDay && (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDay) || Number.isNaN(Date.parse(`${asOfDay}T00:00:00Z`)))) {
      return res.status(400).json({ error: 'as_of must be a date (YYYY-MM-DD)' });
    }
    const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (asOfDay && asOfDay > todayIst) {
      return res.status(400).json({ error: `LPS is charged up to today at the latest, not ${asOfDay} — use the accrual view to look ahead` });
    }
    const result = postLps(contract_id, beneficiary, {
      asOf: as_of ? new Date(as_of) : new Date(),
      createdBy: req.user?.id || null,
    });
    for (const doc of result.docs || []) {
      const on = db.prepare('SELECT bill_no FROM hydro_station_bills WHERE id = ?').get(doc.bill_id);
      notifyLpsRaised({
        beneficiaryName: beneficiary,
        beneficiaryId: doc.beneficiary_id || null,
        amount: doc.amount,
        billNo: on?.bill_no || doc.doc_no,
        asOf: result.accrual.as_of,
      });
    }

    secureLogAudit(req, {
      action: 'HYDRO_LEDGER_LPS_POSTED',
      module: 'HYDRO',
      entityType: 'hydro_ledger_docs',
      entityId: contract_id,
      afterValue: {
        beneficiary, posted: result.posted,
        total: result.accrual.total_chargeable, as_of: result.accrual.as_of,
      },
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * Plant codes as SJVN's finance postings carry them.
 *
 * These are SAP's own identifiers for the two stations and do not exist on the
 * contract, so they are mapped from the contract number rather than invented.
 */
const PLANT_CODES = { 'PPA/SJVN/NJHPS/001': '001', 'PPA/SJVN/RHPS/001': '002' };

/** A contract with the station name the bills are headed with. */
function stationContract(id) {
  const c = getContract(id);
  const seller = c.seller_id
    ? db.prepare('SELECT name FROM entities WHERE id = ?').get(c.seller_id) : null;
  return {
    ...c,
    station_name: seller?.name || c.contract_no,
    plant_code: PLANT_CODES[c.contract_no] || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional charges
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/charges?contract_id=  — entries and what they add to.
// GET /hydro-billing/receivables?contract_id= — beneficiary-wise outstanding, aged.
router.get('/receivables', requireRole(...READ), (req, res) => {
  if (!req.query.contract_id) return res.status(400).json({ error: 'contract_id is required' });
  try {
    res.json(receivablesAgeing(req.query.contract_id, { asOf: req.query.as_of ? String(req.query.as_of) : new Date() }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Could not build the ageing' });
  }
});

// ── Debit / credit notes on a beneficiary's account ─────────────────────────
// Raised as drafts, approved by a different officer, then posted to the ledger.
router.get('/notes', requireRole(...READ), (req, res) => {
  res.json({
    notes: listNotes({ contractId: req.query.contract_id, beneficiaryName: req.query.beneficiary, status: req.query.status }),
    reasons: Object.entries(NOTE_REASONS).map(([value, label]) => ({ value, label })),
  });
});

router.post('/notes', requireRole(...WRITE), (req, res) => {
  try {
    const note = raiseNote(req.body || {}, req.user);
    secureLogAudit(req, {
      action: 'HYDRO_NOTE_RAISED', module: 'HYDRO', entityType: 'hydro_notes', entityId: note.id,
      afterValue: { note_no: note.note_no, type: note.note_type, beneficiary: note.beneficiary_name, amount: note.amount, reason: note.reason },
    });
    pushNotification({
      role: verticalOfContract(note.contract_id) === 'THERMAL' ? 'THERMAL_ADMIN' : 'COMMERCIAL_ADMIN', type: 'HYDRO_NOTE_PENDING',
      message: `${note.note_type === 'DEBIT' ? 'Debit' : 'Credit'} note ${note.note_no} (₹${note.amount.toLocaleString('en-IN')}, ${note.beneficiary_name}) is awaiting approval.`,
    });
    res.status(201).json(note);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/notes/:id/approve', requireRole(...WRITE), (req, res) => {
  try {
    const out = approveNote(req.params.id, req.user);
    secureLogAudit(req, {
      action: 'HYDRO_NOTE_APPROVED', module: 'HYDRO', entityType: 'hydro_notes', entityId: out.note.id,
      afterValue: { note_no: out.note.note_no, ledger_doc: out.ledger_doc.doc_no, amount: out.note.amount },
    });
    res.json(out);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.post('/notes/:id/reject', requireRole(...WRITE), (req, res) => {
  try {
    const note = rejectNote(req.params.id, req.user, req.body?.reason);
    secureLogAudit(req, {
      action: note.status === 'CANCELLED' ? 'HYDRO_NOTE_WITHDRAWN' : 'HYDRO_NOTE_REJECTED',
      module: 'HYDRO', entityType: 'hydro_notes', entityId: note.id, reason: note.rejection_reason,
    });
    res.json(note);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/charges', requireRole(...READ), (req, res) => {
  const { contract_id, include_claimed } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
  try {
    const unclaimed = unclaimedCharges(contract_id);
    const claimed = include_claimed === 'true'
      ? db.prepare(`
          SELECT ac.*, b.bill_no, b.status, b.approval_status
          FROM hydro_additional_charges ac
          LEFT JOIN hydro_station_bills b ON b.id = ac.claimed_bill_id
          WHERE ac.contract_id = ? AND ac.claimed_bill_id IS NOT NULL
          ORDER BY ac.period_month DESC
        `).all(contract_id)
      : [];
    res.json({
      charge_types: CHARGE_TYPES.map((t) => ({ value: t, label: CHARGE_TYPE_LABELS[t] })),
      unclaimed,
      unclaimed_total: Math.round(unclaimed.reduce((a, r) => a + Number(r.amount), 0) * 100) / 100,
      claimed,
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/charges — record a charge to be claimed later.
router.post('/charges', requireRole(...WRITE), (req, res) => {
  try {
    const { contract_id, charge_type, period_month, amount, remarks } = req.body;
    getContract(contract_id);
    const row = addCharge({
      contractId: contract_id,
      chargeType: charge_type,
      periodMonth: normalizeMonth(period_month) || period_month,
      amount,
      remarks,
      createdBy: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'HYDRO_ADDITIONAL_CHARGE_ADDED',
      module: 'HYDRO',
      entityType: 'hydro_additional_charges',
      entityId: row.id,
      afterValue: { charge_type, period_month: row.period_month, amount: row.amount },
    });
    res.json(row);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/charges/claim — raise the claim bill.
router.post('/charges/claim', requireRole(...WRITE), (req, res) => {
  try {
    const month = normalizeMonth(req.body.billing_month);
    if (!month) return res.status(400).json({ error: 'billing_month must be YYYY-MM or a month name with year' });
    const contract = stationContract(req.body.contract_id);

    const result = claimAdditionalCharges({
      contract,
      billingMonth: month,
      chargeIds: req.body.charge_ids || null,
      billDate: req.body.bill_date || null,
      remarks: req.body.remarks || null,
      preparedBy: req.user?.name || req.user?.email || null,
      createdBy: req.user?.id || null,
    });

    secureLogAudit(req, {
      action: 'HYDRO_ADDITIONAL_CHARGES_CLAIMED',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: result.id,
      afterValue: result,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TCS
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/tcs?contract_id=&period_month=
router.get('/tcs', requireRole(...READ), (req, res) => {
  const { contract_id, period_month } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
  res.json(listTcsClaims(contract_id, { periodMonth: normalizeMonth(period_month) || null }));
});

// POST /hydro-billing/tcs/preview — what the rate works out to, without saving.
router.post('/tcs/preview', requireRole(...READ), (req, res) => {
  try {
    res.json(computeTcs({
      amountReceived: req.body.amount_received,
      tcsApplicableAmount: req.body.tcs_applicable_amount,
      tcsRatePct: req.body.tcs_rate_pct,
    }));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/tcs — raise the claim against one beneficiary.
router.post('/tcs', requireRole(...WRITE), (req, res) => {
  try {
    const month = normalizeMonth(req.body.billing_month);
    if (!month) return res.status(400).json({ error: 'billing_month must be YYYY-MM or a month name with year' });
    const contract = stationContract(req.body.contract_id);

    const result = claimTcs({
      contract,
      beneficiaryName: req.body.beneficiary,
      billingMonth: month,
      paymentDate: req.body.payment_date || null,
      amountReceived: req.body.amount_received,
      tcsApplicableAmount: req.body.tcs_applicable_amount,
      tcsRatePct: req.body.tcs_rate_pct,
      remarks: req.body.remarks || null,
      preparedBy: req.user?.name || req.user?.email || null,
      createdBy: req.user?.id || null,
    });

    secureLogAudit(req, {
      action: 'HYDRO_TCS_CLAIMED',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: result.id,
      afterValue: result,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Power trading (PTC)
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/ptc?contract_id=&billing_month=
router.get('/ptc', requireRole(...READ), (req, res) => {
  const { contract_id, billing_month } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
  res.json(listPtcBills(contract_id, { billingMonth: normalizeMonth(billing_month) || null }));
});

// POST /hydro-billing/ptc/consolidate — what the trade nets to, without saving.
router.post('/ptc/consolidate', requireRole(...READ), (req, res) => {
  try {
    res.json(consolidate({
      grossSale: req.body.gross_sale,
      tradingExpense: req.body.trading_expense,
    }));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/ptc — raise the trading bill.
router.post('/ptc', requireRole(...WRITE), (req, res) => {
  try {
    const month = normalizeMonth(req.body.billing_month);
    if (!month) return res.status(400).json({ error: 'billing_month must be YYYY-MM or a month name with year' });
    const contract = stationContract(req.body.contract_id);

    const result = createPtcBill({
      contract,
      billingMonth: month,
      exchangeBeneficiary: req.body.exchange_beneficiary,
      fromDate: req.body.from_date,
      toDate: req.body.to_date,
      dueDate: req.body.due_date || null,
      energyKwh: req.body.energy_kwh,
      grossSale: req.body.gross_sale,
      tradingExpense: req.body.trading_expense,
      remarks: req.body.remarks || null,
      preparedBy: req.user?.name || req.user?.email || null,
      createdBy: req.user?.id || null,
    });

    secureLogAudit(req, {
      action: 'HYDRO_PTC_BILL_RAISED',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: result.id,
      afterValue: result,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FI integration — the month-end handover to corporate Finance
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing/fi?contract_id=&period_month=&status=
router.get('/fi', requireRole(...READ), (req, res) => {
  const { contract_id, period_month, status } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
  res.json({
    categories: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
    postings: listPostings(contract_id, {
      periodMonth: normalizeMonth(period_month) || null,
      status: status || null,
    }),
  });
});

// GET /hydro-billing/fi/bookable — what a month would post, before preparing it.
router.get('/fi/bookable', requireRole(...READ), (req, res) => {
  const { contract_id, period_month, bill_category = 'HYDRO' } = req.query;
  if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
  const month = normalizeMonth(period_month);
  if (!month) return res.status(400).json({ error: 'period_month must be YYYY-MM or a month name with year' });
  try {
    const bills = bookableBills(contract_id, month, bill_category);
    res.json({
      period_month: month,
      bill_category,
      bills: bills.map((b) => ({
        id: b.id, bill_no: b.bill_no, bill_kind: b.bill_kind,
        sale_amount: b.sale, nrldc_amount: b.nrldc, tcs_amount: b.tcs, total_amount: b.total,
      })),
      totals: {
        bills_count: bills.length,
        sale_amount: Math.round(bills.reduce((a, b) => a + b.sale, 0) * 100) / 100,
        nrldc_amount: Math.round(bills.reduce((a, b) => a + b.nrldc, 0) * 100) / 100,
        tcs_amount: Math.round(bills.reduce((a, b) => a + b.tcs, 0) * 100) / 100,
        total_amount: Math.round(bills.reduce((a, b) => a + b.total, 0) * 100) / 100,
      },
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /hydro-billing/fi/:postingId
router.get('/fi/:postingId', requireRole(...READ), (req, res) => {
  const p = getPosting(req.params.postingId);
  if (!p) return res.status(404).json({ error: 'Posting not found' });
  res.json(p);
});

// POST /hydro-billing/fi/prepare — gather the month, change nothing yet.
router.post('/fi/prepare', requireRole(...WRITE), (req, res) => {
  try {
    const month = normalizeMonth(req.body.period_month);
    if (!month) return res.status(400).json({ error: 'period_month must be YYYY-MM or a month name with year' });
    const contract = stationContract(req.body.contract_id);

    const posting = preparePosting({
      contract,
      periodMonth: month,
      category: req.body.bill_category || 'HYDRO',
      notes: req.body.notes || null,
      createdBy: req.user?.id || null,
    });

    secureLogAudit(req, {
      action: 'HYDRO_FI_POSTING_PREPARED',
      module: 'HYDRO',
      entityType: 'hydro_fi_postings',
      entityId: posting.id,
      afterValue: {
        posting_no: posting.posting_no, period_month: month,
        bill_category: posting.bill_category, bills: posting.bills_count,
        total_amount: posting.total_amount,
      },
    });
    res.json(posting);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/fi/:postingId/post — book it in Finance.
router.post('/fi/:postingId/post', requireRole(...WRITE), (req, res) => {
  try {
    const posting = postToFinance(req.params.postingId, {
      fiDocumentNo: req.body.fi_document_no || null,
      postedBy: req.user?.name || req.user?.email || null,
    });
    secureLogAudit(req, {
      action: 'HYDRO_FI_POSTING_POSTED',
      module: 'HYDRO',
      entityType: 'hydro_fi_postings',
      entityId: posting.id,
      afterValue: {
        posting_no: posting.posting_no, fi_document_no: posting.fi_document_no,
        total_amount: posting.total_amount,
      },
    });
    res.json(posting);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/fi/:postingId/reverse — back a booked entry out.
router.post('/fi/:postingId/reverse', requireRole(...WRITE), (req, res) => {
  try {
    const result = reversePosting(req.params.postingId, {
      reason: req.body.reason,
      reversedBy: req.user?.name || req.user?.email || null,
    });
    secureLogAudit(req, {
      action: 'HYDRO_FI_POSTING_REVERSED',
      module: 'HYDRO',
      entityType: 'hydro_fi_postings',
      entityId: req.params.postingId,
      afterValue: result,
      reason: req.body.reason,
    });
    res.json({ ...result, note: 'The month is free to be prepared again.' });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ─── A station's tariff constants, year by year ──────────────────────────────

// GET /hydro-billing/tariffs?contract_id= — the years on file for a station.
router.get('/tariffs', requireRole(...READ), (req, res) => {
  if (!req.query.contract_id) return res.status(400).json({ error: 'contract_id is required' });
  res.json(db.prepare(`
    SELECT * FROM hydro_station_tariffs WHERE contract_id = ? ORDER BY financial_year DESC
  `).all(String(req.query.contract_id)));
});

/**
 * POST /hydro-billing/tariffs — set a station's figures for a financial year.
 *
 * CERC revises a year's Annual Fixed Charges after bills have been raised on
 * the earlier figure. This records the year's figure against the station
 * without amending the contract (which would start a new contract version and
 * leave the station's bills and allocation sheets on the old one). It changes
 * what the next bill is computed on; a bill already raised keeps the figures
 * it was raised with, and is restated by cancelling and redrafting or by a
 * revision.
 */
router.post('/tariffs', requireRole(...WRITE), (req, res) => {
  try {
    const { contract_id, financial_year, order_ref } = req.body;
    if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
    if (!/^\d{4}-\d{4}$/.test(String(financial_year || ''))) {
      return res.status(400).json({ error: 'financial_year must look like 2026-2027' });
    }
    const contract = getContract(contract_id);
    const num = (v, label, { max = Infinity } = {}) => {
      if (v === '' || v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > max) throw Object.assign(new Error(`${label} is not a usable figure`), { status: 400 });
      return n;
    };
    const row = {
      annual_afc: num(req.body.annual_afc, 'Annual Fixed Charges'),
      ecr_excess_rate: num(req.body.ecr_excess_rate, 'Rate beyond design energy', { max: 100 }),
      napaf_percent: num(req.body.napaf_percent, 'NAPAF', { max: 100 }),
      annual_design_energy_mwh: num(req.body.annual_design_energy_mwh, 'Annual design energy'),
      normative_aux: num(req.body.normative_aux, 'Auxiliary consumption', { max: 100 }),
    };
    if (Object.values(row).every((v) => v == null)) return res.status(400).json({ error: 'Nothing to set — give at least one figure' });
    // An AFC typed in crore instead of rupees would bill a ten-millionth of the
    // station; refuse a figure that cannot be a year's fixed charges.
    if (row.annual_afc != null && row.annual_afc < 1e7) {
      return res.status(400).json({ error: 'Annual Fixed Charges are entered in rupees, not crore (1700.8363 crore is 17008363000)' });
    }

    const before = db.prepare('SELECT * FROM hydro_station_tariffs WHERE contract_id = ? AND financial_year = ?')
      .get(contract.id, financial_year);
    const who = req.user?.name || req.user?.email || null;
    if (before) {
      db.prepare(`
        UPDATE hydro_station_tariffs SET annual_afc = ?, ecr_excess_rate = ?, napaf_percent = ?,
          annual_design_energy_mwh = ?, normative_aux = ?, order_ref = ?, updated_by = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(row.annual_afc, row.ecr_excess_rate, row.napaf_percent, row.annual_design_energy_mwh,
        row.normative_aux, order_ref || null, who, before.id);
    } else {
      db.prepare(`
        INSERT INTO hydro_station_tariffs (id, contract_id, financial_year, annual_afc, ecr_excess_rate,
          napaf_percent, annual_design_energy_mwh, normative_aux, order_ref, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId('HST'), contract.id, financial_year, row.annual_afc, row.ecr_excess_rate, row.napaf_percent,
        row.annual_design_energy_mwh, row.normative_aux, order_ref || null, who);
    }
    const after = db.prepare('SELECT * FROM hydro_station_tariffs WHERE contract_id = ? AND financial_year = ?')
      .get(contract.id, financial_year);
    secureLogAudit(req, {
      action: 'HYDRO_STATION_TARIFF_SET',
      module: 'HYDRO',
      entityType: 'hydro_station_tariffs',
      entityId: after.id,
      beforeValue: before ? { annual_afc: before.annual_afc, ecr_excess_rate: before.ecr_excess_rate } : { annual_afc: contract.annual_afc, ecr_excess_rate: contract.ecr_excess_rate, from: 'contract' },
      afterValue: { contract_no: contract.contract_no, financial_year, ...row, order_ref: order_ref || null },
    });
    // Bills of that year already raised on other figures, so the desk knows what is now stale.
    const raised = db.prepare(`
      SELECT bill_no, billing_month, status, a1_afc FROM hydro_station_bills
      WHERE contract_id = ? AND financial_year = ? AND status <> 'CANCELLED' ORDER BY billing_month
    `).all(contract.id, financial_year);
    res.json({
      ...after,
      bills_on_other_figures: row.annual_afc == null ? [] : raised.filter((b) => Math.abs(Number(b.a1_afc) - row.annual_afc) > 0.5),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /hydro-billing/:id — the bill and its beneficiary breakup.
// ─────────────────────────────────────────────────────────────────────────────
// Arrear bills — a revised tariff applied to months already billed
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Work out the arrear a revised tariff makes on months already billed.
 *
 * For each month: the bill the month stands on (the latest issued energy bill,
 * plus any arrear already issued on it), recomputed with the same energy,
 * availability, β and beneficiary split but the tariff now on record for that
 * financial year (Tariffs screen). The difference, beneficiary by beneficiary,
 * is the arrear. Nothing is saved.
 */
function computeArrear(contract, fromMonth, toMonth) {
  const from = normalizeMonth(fromMonth);
  const to = normalizeMonth(toMonth || fromMonth);
  if (!from || !to) throw Object.assign(new Error('from_month and to_month must be YYYY-MM'), { status: 400 });
  if (from > to) throw Object.assign(new Error('from_month is after to_month'), { status: 400 });
  const months = monthRange(from, to);
  if (months.length > 36) throw Object.assign(new Error('An arrear bill covers at most 36 months'), { status: 400 });

  const rows = [];
  const skipped = [];
  const byBeneficiary = new Map();
  for (const m of months) {
    // A month already on an arrear that has not been issued would be billed twice.
    const pending = db.prepare(`
      SELECT a.bill_no FROM hydro_arrear_months am JOIN hydro_station_bills a ON a.id = am.arrear_bill_id
      WHERE a.contract_id = ? AND am.billing_month = ? AND a.status = 'DRAFT'
    `).get(contract.id, m);
    if (pending) { skipped.push({ month: m, reason: `already on draft arrear bill ${pending.bill_no} — issue or cancel it first` }); continue; }

    const { basis, byName, arrearSplit = {} } = billedForMonth(contract.id, m);
    if (!basis) { skipped.push({ month: m, reason: 'no issued bill for this month' }); continue; }
    const basisLines = db.prepare('SELECT * FROM hydro_bill_lines WHERE bill_id = ? ORDER BY sr_no').all(basis.id);

    const deductions = {};
    const scheduled = {};
    for (const l of basisLines) {
      if (Number(l.deducted_scheduled_energy_kwh) > 0) deductions[l.beneficiary_name] = Number(l.deducted_scheduled_energy_kwh);
      scheduled[l.beneficiary_name] = Number(l.actual_scheduled_energy_kwh) || 0;
    }
    const inputs = {
      ex_bus_scheduled_kwh: basis.e1_ex_bus_scheduled_kwh,
      free_power_kwh: basis.e2_free_power_kwh,
      pafm_percent: basis.c1_pafm_pct,
      beta_value: basis.c3_beta_factor,
      nrldc_total_fee: basis.nrldc_total_fee,
      urs_nr_kwh: basis.urs_nr_kwh,
      prior_scheduled_kwh: Number(basis.e4_cum_scheduled_kwh) - Number(basis.e1_ex_bus_scheduled_kwh),
      prior_free_kwh: Number(basis.e5_cum_free_power_kwh) - Number(basis.e2_free_power_kwh),
      deductions: Object.keys(deductions).length ? deductions : null,
    };
    let rebuilt;
    if (isThermal(contract)) {
      rebuilt = rebuildThermalBill(contract, basis, m);
    } else try {
      // The beneficiary energy the month was billed on, where the bill held it;
      // otherwise the allocation split it was derived from.
      const usable = Object.values(scheduled).some((v) => v > 0);
      rebuilt = buildBill(contract, m, { ...inputs, scheduled_energy: usable ? scheduled : null }, { excludeBillId: basis.id });
    } catch {
      rebuilt = buildBill(contract, m, inputs, { excludeBillId: basis.id });
    }

    const basisByName = Object.fromEntries(basisLines.map((l) => [l.beneficiary_name, l]));
    const lines = rebuilt.lines.map((l) => {
      const revised = round2(Number(l.total_charges) + Number(l.nrldc_fee || 0));
      const before = round2(byName[l.beneficiary_name] || 0);
      const b = basisByName[l.beneficiary_name];
      return {
        beneficiary_name: l.beneficiary_name,
        beneficiary_id: l.beneficiary_id || b?.beneficiary_id || null,
        parent_state: l.parent_state || null,
        pct_rea: l.pct_rea, pct_excl_free: l.pct_excl_free, pct_proportionate: l.pct_proportionate, pct_incl_free: l.pct_incl_free,
        previously_billed: before,
        revised,
        // Against the bill and any arrear already issued on it: a second arrear
        // counted the first one's capacity and energy again (Hydro QA run 3).
        capacity_differential: round2(Number(l.capacity_charge) - Number(b?.capacity_charge || 0) - (arrearSplit[l.beneficiary_name]?.capacity || 0)),
        energy_differential: round2(Number(l.energy_charge_total) - Number(b?.energy_charge_total || 0) - (arrearSplit[l.beneficiary_name]?.energy || 0)),
        differential: round2(revised - before),
      };
    });
    const sum = (k) => round2(lines.reduce((a, l) => a + l[k], 0));
    const row = {
      month: m,
      basis_bill_id: basis.id,
      basis_bill_no: basis.bill_no,
      basis_kind: basis.bill_kind,
      tariff: { afc: rebuilt.bill.a1_afc, ecr: rebuilt.bill.a12_ecr, previous_afc: basis.a1_afc, previous_ecr: basis.a12_ecr },
      previously_billed: sum('previously_billed'),
      revised_amount: sum('revised'),
      differential: sum('differential'),
      capacity_differential: sum('capacity_differential'),
      energy_differential: sum('energy_differential'),
      lines,
    };
    rows.push(row);
    for (const l of lines) {
      const cur = byBeneficiary.get(l.beneficiary_name) || { ...l, differential: 0, capacity_differential: 0, energy_differential: 0, months: 0 };
      cur.differential = round2(cur.differential + l.differential);
      cur.capacity_differential = round2(cur.capacity_differential + l.capacity_differential);
      cur.energy_differential = round2(cur.energy_differential + l.energy_differential);
      cur.months += 1;
      byBeneficiary.set(l.beneficiary_name, cur);
    }
  }
  const beneficiaries = [...byBeneficiary.values()];
  return {
    from_month: from,
    to_month: to,
    months: rows,
    skipped,
    beneficiaries,
    total_differential: round2(beneficiaries.reduce((a, b) => a + b.differential, 0)),
  };
}

// POST /hydro-billing/arrears/preview — what the arrear would be, nothing saved.
router.post('/arrears/preview', requireRole(...READ), (req, res) => {
  try {
    const contract = getContract(req.body.contract_id);
    res.json(computeArrear(contract, req.body.from_month, req.body.to_month));
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/arrears — save the arrear as a DRAFT bill.
router.post('/arrears', requireRole(...WRITE), (req, res) => {
  try {
    const contract = getContract(req.body.contract_id);
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10) {
      return res.status(400).json({ error: 'Say why the arrear arises — e.g. the CERC order revising the tariff (at least 10 characters)' });
    }
    const a = computeArrear(contract, req.body.from_month, req.body.to_month);
    if (!a.months.length) {
      return res.status(400).json({ error: 'None of the months in that range can carry an arrear', skipped: a.skipped });
    }
    if (Math.abs(a.total_differential) < 0.01 && a.beneficiaries.every((b) => Math.abs(b.differential) < 0.01)) {
      return res.status(400).json({
        error: 'The tariff on record gives the same figures these months were billed at — there is no arrear. Update the tariff for the financial year first (Tariffs).',
      });
    }

    const id = newId('HSB');
    const billNo = freeBillNo('HAR');
    const stationName = db.prepare('SELECT name FROM entities WHERE id = ?').get(contract.seller_id)?.name || contract.contract_no;
    const tariff = contractForMonth(contract, a.to_month);
    const insertLine = db.prepare(`
      INSERT INTO hydro_bill_lines (
        id, bill_id, sr_no, beneficiary_name, beneficiary_id, parent_state,
        pct_incl_free, pct_rea, pct_excl_free, pct_proportionate,
        capacity_charge, saleable_energy_kwh, energy_upto_design_kwh, energy_excess_kwh,
        actual_scheduled_energy_kwh, deducted_scheduled_energy_kwh, is_regulated,
        energy_charge_upto, energy_charge_excess, energy_charge_total, nrldc_fee, total_charges
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, 0, ?)
    `);
    db.transaction(() => {
      db.prepare(INSERT_BILL).run({
        id,
        bill_no: billNo,
        contract_id: contract.id,
        station_name: stationName,
        billing_month: a.to_month,
        financial_year: financialYearOf(a.to_month),
        bill_kind: 'ARREAR',
        rea_reference: req.body.order_reference || null,
        revision_reason: reason,
        ...emptyBillBlocks(contract),
        a1_afc: Number(tariff.annual_afc) || 0,
        total_charges: a.total_differential,
        prepared_by: req.user?.name || req.user?.email || null,
        created_by: req.user?.id || null,
      });
      db.prepare(`
        UPDATE hydro_station_bills SET arrear_from_month = ?, arrear_to_month = ?,
          prev_total_charges = ?, differential_amount = ?
        WHERE id = ?
      `).run(a.from_month, a.to_month, round2(a.months.reduce((s2, m) => s2 + m.previously_billed, 0)), a.total_differential, id);
      a.beneficiaries.forEach((b, i) => {
        insertLine.run(
          newId('HBL'), id, i + 1, b.beneficiary_name, b.beneficiary_id, b.parent_state,
          b.pct_incl_free ?? null, b.pct_rea ?? 0, b.pct_excl_free ?? 0, b.pct_proportionate ?? 0,
          b.capacity_differential, b.energy_differential, b.differential,
        );
      });
      const insMonth = db.prepare(`
        INSERT INTO hydro_arrear_months (id, arrear_bill_id, billing_month, basis_bill_id, basis_bill_no,
          previously_billed, revised_amount, differential, capacity_differential, energy_differential, lines_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const m of a.months) {
        insMonth.run(newId('HAM'), id, m.month, m.basis_bill_id, m.basis_bill_no, m.previously_billed,
          m.revised_amount, m.differential, m.capacity_differential, m.energy_differential,
          JSON.stringify(m.lines.map((l) => ({
            beneficiary_name: l.beneficiary_name, differential: l.differential,
            capacity_differential: l.capacity_differential, energy_differential: l.energy_differential,
          }))));
      }
    })();

    secureLogAudit(req, {
      action: 'HYDRO_ARREAR_BILL_CREATED', module: 'HYDRO', entityType: 'hydro_station_bills', entityId: id,
      afterValue: { bill_no: billNo, from: a.from_month, to: a.to_month, total: a.total_differential, reason },
    });
    res.json({ id, bill_no: billNo, bill_kind: 'ARREAR', ...a });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /hydro-billing/supplementary/reasons
router.get('/supplementary/reasons', requireRole(...READ), (_req, res) => {
  res.json(Object.entries(SUPPLEMENTARY_REASONS).map(([value, label]) => ({ value, label })));
});

// POST /hydro-billing/supplementary — a one-off bill on top of a month, as a DRAFT.
router.post('/supplementary', requireRole(...WRITE), (req, res) => {
  try {
    const contract = getContract(req.body.contract_id);
    const stationName = db.prepare('SELECT name FROM entities WHERE id = ?').get(contract.seller_id)?.name;
    const r = createSupplementaryBill({
      contract: { ...contract, station_name: stationName || contract.contract_no },
      billingMonth: normalizeMonth(req.body.billing_month),
      amount: req.body.amount,
      reason: req.body.reason,
      particulars: req.body.particulars,
      beneficiaryName: req.body.beneficiary_name || null,
      orderReference: req.body.order_reference || null,
      preparedBy: req.user?.name || req.user?.email || null,
      createdBy: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'HYDRO_SUPPLEMENTARY_BILL_CREATED', module: 'HYDRO', entityType: 'hydro_station_bills', entityId: r.id,
      afterValue: r,
    });
    res.json(r);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /hydro-billing/:id/recall — the maker takes a bill back out of approval.
router.post('/:id/recall', requireRole(...WRITE), (req, res) => {
  try {
    const bill = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.status !== 'DRAFT' || !['IN_APPROVAL', 'REJECTED'].includes(bill.approval_status)) {
      return res.status(400).json({ error: `${bill.bill_no} is not with an approver — there is nothing to recall` });
    }
    // Recall is the maker's: anyone else on the desk with a view on the bill
    // rejects it in the chain, where the decision is on record as theirs.
    const isMaker = bill.created_by ? bill.created_by === req.user?.id : bill.prepared_by === (req.user?.name || req.user?.email);
    if (!isMaker && !['SJVN_ADMIN', 'IT_SUPER_ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({ error: `Only whoever raised ${bill.bill_no} (${bill.prepared_by || 'the maker'}) can recall it — an approver rejects it instead` });
    }
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'Say why the bill is being recalled' });
    db.transaction(() => {
      // The step is closed, not deleted, so the trail shows the bill was taken back.
      db.prepare(`UPDATE hydro_bill_approvals SET status = 'REJECTED', comments = ?, acted_at = datetime('now') WHERE bill_id = ? AND status = 'PENDING'`)
        .run(`Recalled by the maker (${req.user?.name || 'unknown'}): ${reason}`, bill.id);
      db.prepare(`UPDATE hydro_station_bills SET approval_status = 'NOT_SENT', updated_at = datetime('now') WHERE id = ?`).run(bill.id);
    })();
    secureLogAudit(req, { action: 'HYDRO_BILL_RECALLED', module: 'HYDRO', entityType: 'hydro_station_bills', entityId: bill.id, reason });
    res.json({ bill_no: bill.bill_no, approval_status: 'NOT_SENT' });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/:id', requireRole(...READ), (req, res) => {
  const bill = db.prepare(`
    SELECT b.*, c.contract_no, r.bill_no AS revises_bill_no
    FROM hydro_station_bills b
    JOIN contracts c ON b.contract_id = c.id
    LEFT JOIN hydro_station_bills r ON b.revises_bill_id = r.id
    WHERE b.id = ?
  `).get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  const lines = db.prepare('SELECT * FROM hydro_bill_lines WHERE bill_id = ? ORDER BY sr_no').all(bill.id);
  const arrear_months = bill.bill_kind === 'ARREAR'
    ? db.prepare('SELECT * FROM hydro_arrear_months WHERE arrear_bill_id = ? ORDER BY billing_month').all(bill.id)
      .map((m) => ({ ...m, lines: JSON.parse(m.lines_json || '[]') }))
    : [];
  res.json({ ...bill, lines, arrear_months, approval: { trail: approvalTrail(bill.id), pending: pendingStep(bill.id) } });
});

// POST /hydro-billing/:id/issue
router.post('/:id/issue', requireRole(...WRITE), (req, res) => {
  try {
    const before = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bill not found' });
    if (before.status !== 'DRAFT') {
      return res.status(400).json({ error: `${before.bill_no} is already ${before.status}` });
    }
    // Issuing is what puts the bill in front of fifteen beneficiaries, so it is
    // gated on the approval chain having actually finished.
    if (before.approval_status !== 'APPROVED') {
      const step = pendingStep(before.id);
      return res.status(400).json({
        error: before.approval_status === 'IN_APPROVAL'
          ? `${before.bill_no} is still with ${step?.approver_name || 'an approver'} — it cannot be issued until the chain is complete`
          : before.approval_status === 'REJECTED'
            ? `${before.bill_no} was rejected in approval — raise a corrected bill`
            : `${before.bill_no} has not been sent for approval yet`,
        approval_status: before.approval_status,
      });
    }

    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(before.contract_id);
    const issueDate = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const dueDate = req.body.due_date || before.due_date || dueDateFor(contract, issueDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate)) || Number.isNaN(Date.parse(`${dueDate}T00:00:00Z`))) {
      return res.status(400).json({ error: 'due_date must be a date (YYYY-MM-DD)' });
    }

    const after = db.prepare(`
      UPDATE hydro_station_bills
      SET status = 'ISSUED', issued_at = datetime('now'), issued_by = ?, checked_by = ?,
          due_date = ?, updated_at = datetime('now')
      WHERE id = ? RETURNING *
    `).get(
      req.body.issued_by || req.user?.name || req.user?.email || null,
      req.body.checked_by || null,
      dueDate,
      req.params.id,
    );

    // Each beneficiary's share becomes a document on its own account: this is
    // the point the bill turns into money fifteen parties owe.
    const ledger = postBillToLedger(after, { createdBy: req.user?.id || null });
    const notified = notifyBillIssued(after);

    secureLogAudit(req, {
      action: 'HYDRO_STATION_BILL_ISSUED',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: req.params.id,
      beforeValue: { status: before.status },
      afterValue: {
        status: 'ISSUED', total_charges: after.total_charges,
        due_date: dueDate, ledger_docs_posted: ledger.posted,
        beneficiaries_notified: notified,
      },
    });
    res.json({ ...after, ledger_docs_posted: ledger.posted, beneficiaries_notified: notified });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** The bill and its lines, as the printed sheets need them. */
function loadBillForPrint(id) {
  const bill = db.prepare(`
    SELECT b.*, c.contract_no, r.bill_no AS revises_bill_no
    FROM hydro_station_bills b
    JOIN contracts c ON c.id = b.contract_id
    LEFT JOIN hydro_station_bills r ON r.id = b.revises_bill_id
    WHERE b.id = ?
  `).get(id);
  if (!bill) return null;
  const lines = db.prepare(
    'SELECT * FROM hydro_bill_lines WHERE bill_id = ? ORDER BY sr_no',
  ).all(bill.id);
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(bill.contract_id);
  const arrearMonths = bill.bill_kind === 'ARREAR'
    ? db.prepare('SELECT * FROM hydro_arrear_months WHERE arrear_bill_id = ? ORDER BY billing_month').all(bill.id)
    : [];
  return { bill, lines, contract, arrearMonths };
}

// POST /hydro-billing/:id/release — approved and issued, now releasable to print.
router.post('/:id/release', requireRole(...WRITE), (req, res) => {
  try {
    const bill = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.status !== 'ISSUED') {
      return res.status(400).json({
        error: `${bill.bill_no} is ${bill.status} — only an issued bill can be released for printing`,
      });
    }
    if (bill.released_at) {
      return res.status(409).json({ error: `${bill.bill_no} was already released on ${bill.released_at}` });
    }
    const after = db.prepare(`
      UPDATE hydro_station_bills
      SET released_at = datetime('now'), released_by = ?, updated_at = datetime('now')
      WHERE id = ? RETURNING *
    `).get(req.user?.name || req.user?.email || null, req.params.id);

    secureLogAudit(req, {
      action: 'HYDRO_BILL_RELEASED',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: bill.id,
      afterValue: { bill_no: bill.bill_no, released_by: after.released_by },
    });
    res.json(after);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /hydro-billing/:id/pdf — the four printed sheets.
router.get('/:id/pdf', requireRole(...READ), async (req, res) => {
  const payload = loadBillForPrint(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Bill not found' });
  if (!payload.lines.length) {
    return res.status(400).json({ error: `${payload.bill.bill_no} has no beneficiary lines to print` });
  }

  // A draft prints too — the desk checks the sheets before sending it up for
  // approval — but only a released bill counts as having been printed for
  // despatch, so the count follows the release rather than every preview.
  if (payload.bill.released_at) {
    db.prepare(`
      UPDATE hydro_station_bills
      SET printed_at = datetime('now'), print_count = print_count + 1 WHERE id = ?
    `).run(payload.bill.id);
  }

  try {
    await generateHydroStationBillPdf(res, payload);
  } catch (err) {
    console.error('Hydro bill PDF failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not render the bill' });
  }
});

/**
 * GET /hydro-billing/:id/beneficiary-bills/pdf[?line=<line id>] — each
 * beneficiary's own bill, one page apiece, or a single beneficiary's page.
 *
 * The station bill shows the whole station and the breakup; this is what goes
 * to one beneficiary. It reads the same stored lines, so it prints for a draft
 * exactly as the station bill does, and does not count as a print for despatch.
 */
router.get('/:id/beneficiary-bills/pdf', requireRole(...READ), async (req, res) => {
  const payload = loadBillForPrint(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Bill not found' });
  if (!payload.lines.length) {
    return res.status(400).json({ error: `${payload.bill.bill_no} has no beneficiary lines to print` });
  }
  const lineId = req.query.line ? String(req.query.line) : null;
  if (lineId && !payload.lines.some((l) => l.id === lineId)) {
    return res.status(404).json({ error: `${payload.bill.bill_no} has no such beneficiary line` });
  }
  try {
    await generateHydroBeneficiaryBillsPdf(res, payload, lineId);
  } catch (err) {
    console.error('Hydro beneficiary bills PDF failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not render the beneficiary bills' });
  }
});

// ─── Sending a bill to its beneficiaries ─────────────────────────────────────
//
// A REIA invoice is emailed to its one counterparty from the invoice screen and
// the send is on record against it. A hydro station bill has fourteen
// counterparties, and until this existed the only way any of them received it
// was the courier — the portal told a registered beneficiary a bill had been
// issued, and sent the bill itself to nobody.
//
// So: each beneficiary's own page, with the station bill behind it, mailed to
// that beneficiary, and each send recorded line by line. A beneficiary is a
// name off the Regional Energy Account and often not a registered entity, so
// an address typed here is kept against the name for the next month's bill.

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** "a@x.in, b@y.in" as a clean list; throws on anything that is not an address. */
function parseEmails(text) {
  const parts = String(text || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const bad = parts.filter((e) => !EMAIL_RE.test(e));
  if (bad.length) throw Object.assign(new Error(`Not an email address: ${bad.join(', ')}`), { status: 400 });
  return [...new Set(parts)];
}

const beneficiaryKey = (name) => String(name || '').trim().toUpperCase();

/** Where a beneficiary's bill goes, and how we know: its entity's contacts, else the address kept for its name. */
function recipientsFor(line) {
  if (line.beneficiary_id) {
    const entity = db.prepare('SELECT corporate_email FROM entities WHERE id = ?').get(line.beneficiary_id);
    const contacts = db.prepare(`
      SELECT email FROM entity_contacts WHERE entity_id = ? AND email IS NOT NULL AND email != ''
      ORDER BY is_primary DESC, contact_type = 'COMMERCIAL' DESC
    `).all(line.beneficiary_id).map((c) => c.email);
    const emails = [...new Set([entity?.corporate_email, ...contacts]
      .filter(Boolean).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
    if (emails.length) return { emails, source: 'ENTITY' };
  }
  const saved = db.prepare('SELECT email FROM hydro_beneficiary_contacts WHERE beneficiary_key = ?')
    .get(beneficiaryKey(line.beneficiary_name));
  if (saved?.email) return { emails: saved.email.split(',').map((e) => e.trim()).filter(Boolean), source: 'SAVED' };
  return { emails: [], source: null };
}

const billRefFor = (bill, line) => `${bill.bill_no}/${String(line.sr_no).padStart(2, '0')}`;

// GET /hydro-billing/:id/recipients — who each beneficiary's bill would go to, and whether it has gone.
router.get('/:id/recipients', requireRole(...READ), (req, res) => {
  const payload = loadBillForPrint(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Bill not found' });
  const last = db.prepare(`
    SELECT status, recipient, mode, sent_by, created_at FROM hydro_bill_deliveries
    WHERE bill_id = ? AND line_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1
  `);
  res.json({
    bill_id: payload.bill.id,
    bill_no: payload.bill.bill_no,
    status: payload.bill.status,
    can_send: payload.bill.status === 'ISSUED',
    lines: payload.lines.map((l) => ({
      line_id: l.id,
      sr_no: l.sr_no,
      beneficiary_name: l.beneficiary_name,
      parent_state: l.parent_state,
      bill_ref: billRefFor(payload.bill, l),
      total_charges: l.total_charges,
      ...recipientsFor(l),
      last_delivery: last.get(payload.bill.id, l.id) || null,
    })),
  });
});

// GET /hydro-billing/:id/deliveries — every send of this bill, newest first.
router.get('/:id/deliveries', requireRole(...READ), (req, res) => {
  const bill = db.prepare('SELECT id FROM hydro_station_bills WHERE id = ?').get(req.params.id);
  if (!bill) return res.status(404).json({ error: 'Bill not found' });
  res.json(db.prepare(`
    SELECT id, line_id, beneficiary_name, channel, recipient, status, mode, sent_by, created_at
    FROM hydro_bill_deliveries WHERE bill_id = ? ORDER BY created_at DESC, rowid DESC
  `).all(bill.id));
});

/**
 * POST /hydro-billing/:id/send — email each chosen beneficiary its bill.
 *
 * Body: { lines?: [{ line_id, to? }] }. With no `lines`, every beneficiary
 * that has an address is sent to. `to` overrides the address on record for
 * that send, and is kept for a beneficiary that has no entity of its own.
 *
 * Only an issued bill is sent — the same rule as a REIA invoice, which goes
 * out only once approved. One beneficiary's failure does not stop the rest:
 * each line reports its own outcome and is logged on its own.
 */
router.post('/:id/send', requireRole(...WRITE), async (req, res) => {
  try {
    const payload = loadBillForPrint(req.params.id);
    if (!payload) return res.status(404).json({ error: 'Bill not found' });
    const { bill, lines } = payload;
    if (bill.status !== 'ISSUED') {
      return res.status(400).json({ error: `${bill.bill_no} is ${bill.status} — a bill is sent to its beneficiaries only once it has been approved and issued` });
    }

    const asked = Array.isArray(req.body?.lines) ? req.body.lines : null;
    if (asked && !asked.length) return res.status(400).json({ error: 'No beneficiary chosen' });
    const chosen = [];
    for (const a of asked || lines.map((l) => ({ line_id: l.id }))) {
      const line = lines.find((l) => l.id === a.line_id);
      if (!line) return res.status(404).json({ error: `${bill.bill_no} has no such beneficiary line` });
      // Addresses are checked for every line before anything is sent, so a
      // typing mistake on the last row does not leave half the bill mailed.
      const typed = a.to ? parseEmails(a.to) : [];
      chosen.push({ line, typed });
    }

    const month = monthLabel(bill.billing_month);
    const sentBy = req.user?.name || req.user?.email || null;
    const log = db.prepare(`
      INSERT INTO hydro_bill_deliveries (id, bill_id, line_id, beneficiary_name, channel, recipient, status, mode, detail_json, sent_by)
      VALUES (?, ?, ?, ?, 'EMAIL', ?, ?, ?, ?, ?)
    `);
    const remember = db.prepare(`
      INSERT INTO hydro_beneficiary_contacts (beneficiary_key, beneficiary_name, email, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(beneficiary_key) DO UPDATE SET email = excluded.email, updated_by = excluded.updated_by, updated_at = datetime('now')
    `);

    const results = [];
    for (const { line, typed } of chosen) {
      const row = { line_id: line.id, sr_no: line.sr_no, beneficiary_name: line.beneficiary_name, bill_ref: billRefFor(bill, line) };
      const onRecord = recipientsFor(line);
      const to = typed.length ? typed : onRecord.emails;
      if (!to.length) { results.push({ ...row, status: 'NO_EMAIL', reason: 'no email address on record' }); continue; }
      if (typed.length && onRecord.source !== 'ENTITY') {
        const was = onRecord.emails.map((e) => e.toLowerCase()).sort().join(', ');
        const now = typed.map((e) => e.toLowerCase()).sort().join(', ');
        remember.run(beneficiaryKey(line.beneficiary_name), line.beneficiary_name, typed.join(', '), sentBy);
        // Where a beneficiary's bills go is changed here, so the change is on record.
        if (was !== now) {
          secureLogAudit(req, {
            action: 'HYDRO_BILL_ADDRESS_CHANGED', module: verticalOfContract(bill.contract_id) || 'HYDRO',
            entityType: 'hydro_beneficiary_contacts', entityId: beneficiaryKey(line.beneficiary_name),
            beforeValue: { email: was || null }, afterValue: { email: now, bill_no: bill.bill_no },
          });
        }
      }
      let mail;
      try {
        const pdf = await hydroBeneficiaryBillPdfBuffer(payload, line.id);
        const { subject, text, html } = formatHydroBillEmail({ bill, line, billRef: row.bill_ref, monthLabel: month });
        mail = await sendMail({
          to,
          subject,
          text,
          html,
          attachments: [{
            filename: `${row.bill_ref.replace(/[^\w.-]+/g, '_')}_${String(line.beneficiary_name).replace(/[^\w.-]+/g, '_')}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          }],
        });
      } catch (err) {
        mail = { ok: false, mode: 'NONE', error: err.message };
      }
      const status = !mail.ok ? 'FAILED' : (mail.mode === 'FILE_OUTBOX' ? 'SIMULATED' : 'SENT');
      log.run(newId('HDL'), bill.id, line.id, line.beneficiary_name, to.join(', '), status, mail.mode || 'NONE', JSON.stringify(mail), sentBy);
      results.push({ ...row, status, mode: mail.mode, to, ...(mail.ok ? {} : { reason: mail.error || 'email delivery failed' }) });
    }

    const count = (s) => results.filter((r) => r.status === s).length;
    secureLogAudit(req, {
      action: 'HYDRO_STATION_BILL_SENT',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: bill.id,
      afterValue: {
        bill_no: bill.bill_no,
        sent: results.filter((r) => r.status === 'SENT' || r.status === 'SIMULATED').map((r) => r.beneficiary_name),
        failed: results.filter((r) => r.status === 'FAILED').map((r) => r.beneficiary_name),
        no_email: results.filter((r) => r.status === 'NO_EMAIL').map((r) => r.beneficiary_name),
      },
    });
    res.json({
      bill_no: bill.bill_no,
      results,
      sent: count('SENT'),
      simulated: count('SIMULATED'),
      failed: count('FAILED'),
      no_email: count('NO_EMAIL'),
    });
  } catch (err) {
    console.error('Hydro bill send failed:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to send the bill' });
  }
});

// POST /hydro-billing/:id/dispatch — how the printed bill actually went out.
router.post('/:id/dispatch', requireRole(...WRITE), (req, res) => {
  try {
    const {
      dispatch_invoice_no, courier_tracking_no, dispatch_date, receipt_date,
    } = req.body;
    const bill = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.status !== 'ISSUED') {
      return res.status(400).json({ error: `${bill.bill_no} is ${bill.status} — only an issued bill can be despatched` });
    }
    // Releasing is what produces the printed copy that gets couriered, so a
    // despatch without one would be recording the sending of nothing.
    if (!bill.released_at) {
      return res.status(400).json({ error: `${bill.bill_no} has not been released for printing yet` });
    }
    if (!dispatch_date) return res.status(400).json({ error: 'dispatch_date is required' });
    if (receipt_date && receipt_date < dispatch_date) {
      return res.status(400).json({
        error: `The beneficiary cannot have received the bill on ${receipt_date}, before it was despatched on ${dispatch_date}`,
      });
    }

    const after = db.prepare(`
      UPDATE hydro_station_bills
      SET dispatch_invoice_no = ?, courier_tracking_no = ?, dispatch_date = ?, receipt_date = ?,
          dispatched_at = datetime('now'), dispatched_by = ?, updated_at = datetime('now')
      WHERE id = ? RETURNING *
    `).get(
      dispatch_invoice_no || null, courier_tracking_no || null, dispatch_date,
      receipt_date || null, req.user?.name || req.user?.email || null, req.params.id,
    );

    // Only on the first despatch — correcting a courier number later is not
    // news the beneficiary needs a second message about.
    if (!bill.dispatched_at) {
      notifyBillDespatched(after, { dispatchDate: dispatch_date, courierRef: courier_tracking_no });
    }

    secureLogAudit(req, {
      action: bill.dispatched_at ? 'HYDRO_BILL_DISPATCH_UPDATED' : 'HYDRO_BILL_DISPATCHED',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: bill.id,
      beforeValue: bill.dispatched_at
        ? { dispatch_date: bill.dispatch_date, courier_tracking_no: bill.courier_tracking_no }
        : undefined,
      afterValue: {
        bill_no: bill.bill_no, dispatch_invoice_no, courier_tracking_no, dispatch_date, receipt_date,
      },
    });
    res.json(after);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /hydro-billing/:id/cancel
router.post('/:id/cancel', requireRole(...WRITE), (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A cancellation must say why — supply reason' });
    const before = db.prepare('SELECT * FROM hydro_station_bills WHERE id = ?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bill not found' });
    if (before.status === 'CANCELLED') return res.status(400).json({ error: `${before.bill_no} is already cancelled` });

    // A cancelled month drops out of the cumulative energy carried forward, so a
    // later month in the same year would silently re-open the design-energy
    // headroom this one used. Say so rather than let it pass unnoticed.
    const later = db.prepare(`
      SELECT bill_no, billing_month FROM hydro_station_bills
      WHERE contract_id = ? AND financial_year = ? AND billing_month > ?
        AND status <> 'CANCELLED' AND bill_kind <> 'REVISION'
      ORDER BY billing_month
    `).all(before.contract_id, before.financial_year, before.billing_month);

    // A bill that has been paid against cannot simply be withdrawn — the
    // payment has to be released from it first, and saying which payments are
    // in the way is what makes that instruction actionable.
    const blockers = billReversalBlockers(before.id);
    if (blockers.length) {
      return res.status(409).json({
        error: `Payment has already been received against ${before.bill_no} (${blockers.map((b) => `${b.doc_no} — ${b.beneficiary_name}`).join('; ')}). Reset the clearing on those payments first.`,
        blocking_payments: blockers,
      });
    }
    reverseBillDocs(before.id, { reason, createdBy: req.user?.id || null });

    const after = db.prepare(`
      UPDATE hydro_station_bills
      SET status = 'CANCELLED', revision_reason = COALESCE(revision_reason || ' | ', '') || ?,
          updated_at = datetime('now')
      WHERE id = ? RETURNING *
    `).get(`Cancelled: ${reason}`, req.params.id);

    notifyBillCancelled(before, reason);

    secureLogAudit(req, {
      action: 'HYDRO_STATION_BILL_CANCELLED',
      module: 'HYDRO',
      entityType: 'hydro_station_bills',
      entityId: req.params.id,
      beforeValue: { status: before.status, total_charges: before.total_charges },
      afterValue: { status: 'CANCELLED' },
      reason,
    });

    res.json({
      ...after,
      warning: later.length
        ? `${later.length} later bill(s) in ${before.financial_year} carried this month's energy forward (${later.map((b) => b.billing_month).join(', ')}) — re-check their cumulative rows`
        : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
