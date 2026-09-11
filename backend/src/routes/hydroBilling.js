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
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, genInvoiceNo } from '../util.js';
import { secureLogAudit } from '../auditEngine.js';
import { resolveBetaRow } from '../services/betaFactor.js';
import {
  sendForApproval, actOnApproval, approvalTrail, pendingStep, approvalInbox,
} from '../services/hydroBillApproval.js';
import {
  postBillToLedger, recordPayment, reversePayment, resetClearing, accountMaintenance,
  accruedLpsFor, postLps, accountDisplay, beneficiariesWithAccounts,
  billReversalBlockers, reverseBillDocs, dueDateFor, openDebits,
} from '../services/hydroLedger.js';
import {
  computeStationBill, allocateBeneficiaries, getAllocations, priorCumulative,
  deriveAllocationColumns,
  financialYearOf, seedNjhpsAllocations,
} from '../services/hydroStationBill.js';

const router = Router();
router.use(requireAuth);

const READ = [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.FINANCE, 'COMPLIANCE_AUDITOR'])];
const WRITE = [...ROLE_GROUPS.REIA_WRITE];

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
    freePowerKwh: body.free_power_kwh,
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
  const rows = db.prepare(`
    SELECT c.*, e.name AS seller_name
    FROM contracts c
    LEFT JOIN entities e ON c.seller_id = e.id
    WHERE c.contract_type = 'PPA' AND c.project_type IN ('Hydro','PSP')
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
    ...readiness(c),
  })));
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
    if (!(Number(pct_rea) >= 0)) return res.status(400).json({ error: 'pct_rea must be a percentage' });
    if (!effective_from) return res.status(400).json({ error: 'effective_from is required' });
    getContract(contract_id);

    const id = newId('HBA');
    db.prepare(`
      INSERT INTO hydro_beneficiary_allocations
        (id, contract_id, beneficiary_name, beneficiary_id, parent_state, sr_no,
         pct_incl_free, pct_rea, is_home_state, effective_from, effective_to, source_note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, contract_id, beneficiary_name, beneficiary_id || null, parent_state || null,
      sr_no == null ? null : Number(sr_no),
      pct_incl_free == null || pct_incl_free === '' ? null : Number(pct_incl_free),
      Number(pct_rea), is_home_state ? 1 : 0, effective_from, effective_to || null,
      source_note || null, req.user?.id || null,
    );

    secureLogAudit(req, {
      action: 'HYDRO_ALLOCATION_CREATED',
      module: 'REIA',
      entityType: 'hydro_beneficiary_allocations',
      entityId: id,
      afterValue: { contract_id, beneficiary_name, pct_rea: Number(pct_rea), effective_from },
    });
    res.json(db.prepare('SELECT * FROM hydro_beneficiary_allocations WHERE id = ?').get(id));
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
    const contract = getContract(contract_id);

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
    const replaced = db.transaction(() => {
      const gone = db.prepare(`
        DELETE FROM hydro_beneficiary_allocations WHERE contract_id = ? AND effective_from = ?
      `).run(contract_id, effective_from).changes;
      for (const r of clean) {
        insert.run(
          newId('HBA'), contract_id, r.beneficiary_name, r.beneficiary_id, r.parent_state, r.sr_no,
          r.pct_incl_free, r.pct_rea, r.is_home_state, effective_from, effective_to || null,
          source_note || null, req.user?.id || null,
        );
      }
      return gone;
    })();

    secureLogAudit(req, {
      action: 'HYDRO_ALLOCATION_SHEET_REPLACED',
      module: 'REIA',
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

    const editable = ['beneficiary_name', 'beneficiary_id', 'parent_state', 'sr_no',
      'pct_incl_free', 'pct_rea', 'is_home_state', 'effective_from', 'effective_to',
      'source_note', 'is_active'];
    const sets = [];
    const params = [];
    for (const f of editable) {
      if (!(f in req.body)) continue;
      let v = req.body[f];
      if (['sr_no', 'pct_incl_free', 'pct_rea'].includes(f)) v = v === '' || v == null ? null : Number(v);
      if (['is_home_state', 'is_active'].includes(f)) v = v ? 1 : 0;
      sets.push(`${f} = ?`);
      params.push(v);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    const after = db.prepare(`
      UPDATE hydro_beneficiary_allocations SET ${sets.join(', ')}, updated_at = datetime('now')
      WHERE id = ? RETURNING *
    `).get(...params, req.params.id);

    secureLogAudit(req, {
      action: 'HYDRO_ALLOCATION_UPDATED',
      module: 'REIA',
      entityType: 'hydro_beneficiary_allocations',
      entityId: req.params.id,
      beforeValue: { pct_rea: before.pct_rea, is_home_state: before.is_home_state, is_active: before.is_active },
      afterValue: { pct_rea: after.pct_rea, is_home_state: after.is_home_state, is_active: after.is_active },
    });
    res.json(after);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bills
// ─────────────────────────────────────────────────────────────────────────────

// GET /hydro-billing
router.get('/', requireRole(...READ), (req, res) => {
  const { contract_id, billing_month, financial_year, status, bill_kind } = req.query;
  let sql = `
    SELECT b.*, c.contract_no
    FROM hydro_station_bills b
    JOIN contracts c ON b.contract_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (contract_id) { sql += ' AND b.contract_id = ?'; params.push(contract_id); }
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

    const { bill, lines, sources } = buildBill(contract, month, req.body);
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

    const { bill, lines, sources } = buildBill(contract, month, req.body);
    const { revises, prevTotal } = resolveRevision(contract, month, req.body);
    if (kind === 'REVISION' && !req.body.revision_reason) {
      return res.status(400).json({ error: 'A revision must say what changed — supply revision_reason' });
    }

    const stationName = req.body.station_name
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
        kind, revises?.id || null, req.body.rea_reference || null, req.body.revision_reason || null,
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
        prevTotal, differential, req.user?.name || req.user?.email || null, req.user?.id || null,
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
      module: 'REIA',
      entityType: 'hydro_station_bills',
      entityId: id,
      afterValue: {
        bill_no: billNo, station_name: stationName, billing_month: month, bill_kind: kind,
        ecr: bill.a12_ecr, capacity_charge: bill.c5_total_capacity_charge,
        energy_charge: bill.ee1_energy_charge + bill.ee2_excess_energy_charge,
        total_charges: bill.total_charges, beneficiaries: lines.length, sources,
      },
    });

    res.json({ id, bill_no: billNo, billing_month: month, bill_kind: kind, ...bill, lines, sources });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
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
  const roles = ROLE_GROUPS.REIA_WRITE;
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

    secureLogAudit(req, {
      action: 'HYDRO_BILL_SENT_FOR_APPROVAL',
      module: 'REIA',
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

    secureLogAudit(req, {
      action: `HYDRO_BILL_APPROVAL_${result.outcome}`,
      module: 'REIA',
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
      createdBy: req.user?.id || null,
    });

    secureLogAudit(req, {
      action: 'HYDRO_LEDGER_PAYMENT_RECORDED',
      module: 'REIA',
      entityType: 'hydro_ledger_docs',
      entityId: result.doc.id,
      afterValue: {
        doc_no: result.doc.doc_no, beneficiary, amount: result.doc.amount,
        cleared: result.clearings.length, unapplied: result.unapplied,
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
      module: 'REIA',
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
      module: 'REIA',
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
      module: 'REIA',
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
    const result = postLps(contract_id, beneficiary, {
      asOf: as_of ? new Date(as_of) : new Date(),
      createdBy: req.user?.id || null,
    });
    secureLogAudit(req, {
      action: 'HYDRO_LEDGER_LPS_POSTED',
      module: 'REIA',
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

// GET /hydro-billing/:id — the bill and its beneficiary breakup.
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
  res.json({ ...bill, lines });
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
    const issueDate = new Date().toISOString().slice(0, 10);
    const dueDate = req.body.due_date || before.due_date || dueDateFor(contract, issueDate);

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

    secureLogAudit(req, {
      action: 'HYDRO_STATION_BILL_ISSUED',
      module: 'REIA',
      entityType: 'hydro_station_bills',
      entityId: req.params.id,
      beforeValue: { status: before.status },
      afterValue: {
        status: 'ISSUED', total_charges: after.total_charges,
        due_date: dueDate, ledger_docs_posted: ledger.posted,
      },
    });
    res.json({ ...after, ledger_docs_posted: ledger.posted });
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

    secureLogAudit(req, {
      action: 'HYDRO_STATION_BILL_CANCELLED',
      module: 'REIA',
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
