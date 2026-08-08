import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, humanizePaymentTerms, humanizeRebateRule, humanizeLpsRule } from '../util.js';
import { syncRequirementsFromContract, createInstrumentsFromRequirements } from '../paymentSecurityEngine.js';
import { allocationsInForce } from '../services/allocations.js';

const router = Router();
router.use(requireAuth);

/**
 * Normalise the structured billing rules coming from the form and (re)generate
 * the human-readable `payment_terms` / `rebate_rule` / `lps_rule` strings so the
 * calc engine and every display stay consistent. Blank numeric inputs → null.
 */
function hydroBillingFields(b) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  return {
    normative_aux: num(b.normative_aux),
    free_energy_home_state: num(b.free_energy_home_state),
    capacity_charges_total: num(b.capacity_charges_total),
    annual_afc: num(b.annual_afc),
    annual_design_energy_mwh: num(b.annual_design_energy_mwh),
    napaf_percent: num(b.napaf_percent),
    transmission_charge_per_mwh: num(b.transmission_charge_per_mwh),
    min_cuf_percent: num(b.min_cuf_percent),
  };
}

function billingRuleFields(b) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const payment_terms_days = num(b.payment_terms_days);
  const rebate_pct = num(b.rebate_pct);
  const rebate_days = num(b.rebate_days);
  const rebate_basis = b.rebate_basis === 'DUE_DATE' ? 'DUE_DATE' : 'BILL_DATE';
  const lps_annual_pct = num(b.lps_annual_pct);
  const lps_grace_days = num(b.lps_grace_days) ?? 0;
  return {
    payment_terms_days, rebate_pct, rebate_days, rebate_basis, lps_annual_pct, lps_grace_days,
    payment_terms: payment_terms_days != null ? humanizePaymentTerms(payment_terms_days) : (b.payment_terms ?? null),
    rebate_rule: rebate_pct != null ? humanizeRebateRule({ rebate_pct, rebate_days, rebate_basis }) : (b.rebate_rule ?? null),
    lps_rule: lps_annual_pct != null ? humanizeLpsRule({ lps_annual_pct, lps_grace_days }) : (b.lps_rule ?? null),
  };
}

function fetchContractRelations(contract) {
  if (!contract) return contract;
  const seller = contract.seller_id ? db.prepare('SELECT id, name FROM entities WHERE id = ?').get(contract.seller_id) : null;
  const buyer = contract.buyer_id ? db.prepare('SELECT id, name FROM entities WHERE id = ?').get(contract.buyer_id) : null;
  contract.seller_name = seller?.name ?? null;
  contract.buyer_name = buyer?.name ?? null;

  contract.projects = db.prepare(`
    SELECT p.project_entity_id, e.name, p.allocated_capacity_mw 
    FROM contract_projects p
    JOIN entities e ON e.id = p.project_entity_id
    WHERE p.contract_id = ?
  `).all(contract.id);

  if (contract.tariff_structure_json) {
    try {
      const parsed = JSON.parse(contract.tariff_structure_json);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        contract.tariff_structure = parsed;
      } else {
        contract.tariff_structure = null;
        contract.tariff_structure_json = null;
      }
    } catch(e) {
      contract.tariff_structure = null;
      contract.tariff_structure_json = null;
    }
  } else {
    contract.tariff_structure = null;
  }
  return contract;
}

// B. Contract Management - search / filter / list
router.get('/', (req, res) => {
  const { contract_type, status, project_type, q } = req.query;
  let sql = 'SELECT * FROM contracts WHERE 1=1';
  const params = [];
  
  const side = counterpartySide(req.user);
  if (side === 'SELLER') {
    sql += ' AND seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (side === 'BUYER') {
    sql += ' AND buyer_id = ?';
    params.push(req.user.linked_entity_id);
  }

  if (contract_type) { sql += ' AND contract_type = ?'; params.push(contract_type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (project_type) { sql += ' AND project_type = ?'; params.push(project_type); }
  if (q) { sql += ' AND contract_no LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params).map(fetchContractRelations);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const versions = db.prepare('SELECT id, contract_no, version, status, created_at FROM contracts WHERE id = ? OR parent_contract_id = ? ORDER BY version').all(req.params.id, req.params.id);
  const amendments = db.prepare('SELECT * FROM contract_amendments WHERE contract_id = ? ORDER BY version DESC').all(req.params.id);
  res.json({ ...fetchContractRelations(contract), versions, amendments });
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const id = newId('CON');
  const b = req.body;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
        tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type, pbg_expiry,
        rebate_rule, lps_rule, payment_security_type, payment_terms_days, rebate_pct, rebate_days, rebate_basis, lps_annual_pct, lps_grace_days, trading_margin_per_mwh,
        normative_aux, free_energy_home_state, capacity_charges_total, annual_afc, annual_design_energy_mwh, napaf_percent, transmission_charge_per_mwh, min_cuf_percent, status)
      VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
        @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry,
        @rebate_rule, @lps_rule, @payment_security_type, @payment_terms_days, @rebate_pct, @rebate_days, @rebate_basis, @lps_annual_pct, @lps_grace_days, @trading_margin_per_mwh,
        @normative_aux, @free_energy_home_state, @capacity_charges_total, @annual_afc, @annual_design_energy_mwh, @napaf_percent, @transmission_charge_per_mwh, @min_cuf_percent, @status)
    `).run({
      id,
      contract_no: b.contract_no,
      contract_type: b.contract_type,
      seller_id: b.seller_id ?? null,
      buyer_id: b.buyer_id ?? null,
      project_type: b.project_type,
      capacity_mw: b.capacity_mw,
      commissioned_capacity_mw: b.commissioned_capacity_mw ?? 0,
      cod_date: b.cod_date ?? null,
      tariff_type: b.tariff_type || 'FLAT',
      tariff_per_unit: b.tariff_per_unit,
      tariff_structure_json: (b.tariff_structure && typeof b.tariff_structure === 'object' && Object.keys(b.tariff_structure).length > 0)
        ? JSON.stringify(b.tariff_structure)
        : (typeof b.tariff_structure_json === 'string' && b.tariff_structure_json.trim() && b.tariff_structure_json.trim() !== '{}' ? b.tariff_structure_json : null),
      tenure_start: b.tenure_start,
      tenure_end: b.tenure_end,
      billing_cycle: b.billing_cycle || 'MONTHLY',
      emd_amount: b.emd_amount ?? null,
      pbg_amount: b.pbg_amount ?? null,
      pbg_type: b.pbg_type ?? null,
      pbg_expiry: b.pbg_expiry ?? null,
      payment_security_type: b.payment_security_type ?? null,
      trading_margin_per_mwh: (b.trading_margin_per_mwh === '' || b.trading_margin_per_mwh == null) ? null : Number(b.trading_margin_per_mwh),
      status: b.status || 'DRAFT',
      ...billingRuleFields(b),
      ...hydroBillingFields(b),
    });

    if (b.projects && Array.isArray(b.projects)) {
      const insertProj = db.prepare('INSERT INTO contract_projects (contract_id, project_entity_id, allocated_capacity_mw) VALUES (?, ?, ?)');
      for (const p of b.projects) {
        insertProj.run(id, p.project_entity_id, p.allocated_capacity_mw);
      }
    }
  })();

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'contract', entityId: id, details: b });
  if (b.status === 'ACTIVE') {
    syncRequirementsFromContract(id);
    createInstrumentsFromRequirements(id, req.user);
  }
  res.status(201).json(fetchContractRelations(db.prepare('SELECT * FROM contracts WHERE id = ?').get(id)));
});

// The contract lifecycle, and what each state may move to. A contract has to be
// signed and cleared by the regulator before it can go live, so jumping straight
// from DRAFT to ACTIVE is not a shortcut — it skips the approvals that make the
// contract billable. Termination and closure are reachable from anywhere live.
const CONTRACT_TRANSITIONS = {
  DRAFT: ['UNDER_NEGOTIATION', 'SIGNED', 'TERMINATED'],
  UNDER_NEGOTIATION: ['SIGNED', 'DRAFT', 'TERMINATED'],
  SIGNED: ['PENDING_REGULATORY_APPROVAL', 'ACTIVE', 'TERMINATED'],
  PENDING_REGULATORY_APPROVAL: ['ACTIVE', 'SIGNED', 'TERMINATED'],
  ACTIVE: ['AMENDED', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'TERMINATED', 'CLOSED'],
  AMENDED: ['ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'TERMINATED', 'CLOSED'],
  NEARING_EXPIRY: ['EXPIRED', 'RENEWED', 'TERMINATED', 'CLOSED'],
  EXPIRED: ['RENEWED', 'CLOSED'],
  RENEWED: ['ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'CLOSED'],
  TERMINATED: ['CLOSED'],
  CLOSED: [],
};

router.post('/:id/status', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const { status, remarks, termination_reason, termination_date } = req.body;

  const allowed = CONTRACT_TRANSITIONS[contract.status];
  if (!allowed) {
    return res.status(400).json({ error: `Unknown current status ${contract.status}` });
  }
  if (status !== contract.status && !allowed.includes(status)) {
    return res.status(400).json({
      error: `Cannot move a contract from ${contract.status} to ${status}.`,
      allowed_transitions: allowed,
    });
  }
  
  db.prepare(`UPDATE contracts SET status = ?, remarks = ?, termination_reason = ?, termination_date = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, remarks ?? contract.remarks, termination_reason ?? null, termination_date ?? null, contract.id);
    
  if (status === 'ACTIVE') {
    syncRequirementsFromContract(contract.id);
    createInstrumentsFromRequirements(contract.id, req.user);
  }

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: `STATUS_${status}`, module: 'REIA', entityType: 'contract', entityId: contract.id, details: { remarks, termination_reason } });
  res.json(fetchContractRelations(db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.id)));
});

// Amendment -> creates a new version, marks old as AMENDED
router.post('/:id/amend', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const original = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Contract not found' });

  const newVersionId = newId('CON');
  const updated = { ...original, ...req.body };
  
  const changedFields = {};
  for (const k of Object.keys(req.body)) {
    if (String(req.body[k]) !== String(original[k])) changedFields[k] = { old: original[k], new: req.body[k] };
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
        tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type,
        pbg_expiry, rebate_rule, lps_rule, payment_security_type, payment_terms_days, rebate_pct, rebate_days, rebate_basis, lps_annual_pct, lps_grace_days,
        trading_margin_per_mwh, normative_aux, free_energy_home_state, capacity_charges_total, annual_afc, annual_design_energy_mwh, napaf_percent,
        transmission_charge_per_mwh, min_cuf_percent, version, parent_contract_id, status, remarks)
      VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
        @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type,
        @pbg_expiry, @rebate_rule, @lps_rule, @payment_security_type, @payment_terms_days, @rebate_pct, @rebate_days, @rebate_basis, @lps_annual_pct, @lps_grace_days,
        @trading_margin_per_mwh, @normative_aux, @free_energy_home_state, @capacity_charges_total, @annual_afc, @annual_design_energy_mwh, @napaf_percent,
        @transmission_charge_per_mwh, @min_cuf_percent, @version, @parent_contract_id, 'ACTIVE', @remarks)
    `).run({
      ...updated,
      id: newVersionId,
      tariff_structure_json: (updated.tariff_structure && typeof updated.tariff_structure === 'object' && Object.keys(updated.tariff_structure).length > 0)
        ? JSON.stringify(updated.tariff_structure)
        : (original.tariff_structure_json && original.tariff_structure_json !== '{}' ? original.tariff_structure_json : null),
      trading_margin_per_mwh: (updated.trading_margin_per_mwh === '' || updated.trading_margin_per_mwh == null) ? null : Number(updated.trading_margin_per_mwh),
      version: original.version + 1,
      parent_contract_id: original.parent_contract_id || original.id,
      remarks: req.body.amendment_reason ?? null,
      ...billingRuleFields(updated),
      ...hydroBillingFields(updated),
    });
    
    // Copy projects
    const projects = db.prepare('SELECT * FROM contract_projects WHERE contract_id = ?').all(original.id);
    const insertProj = db.prepare('INSERT INTO contract_projects (contract_id, project_entity_id, allocated_capacity_mw) VALUES (?, ?, ?)');
    for (const p of projects) insertProj.run(newVersionId, p.project_entity_id, p.allocated_capacity_mw);

    db.prepare(`UPDATE contracts SET status = 'AMENDED', updated_at = datetime('now') WHERE id = ?`).run(original.id);
    db.prepare(`INSERT INTO contract_amendments (id, contract_id, version, changed_fields_json, approved_by) VALUES (?, ?, ?, ?, ?)`).run(newId('CMA'), original.id, original.version, JSON.stringify(changedFields), req.user.name);
  })();

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'AMEND', module: 'REIA', entityType: 'contract', entityId: original.id, details: { newVersionId, changedFields } });
  syncRequirementsFromContract(newVersionId);
  createInstrumentsFromRequirements(newVersionId, req.user);
  res.status(201).json(fetchContractRelations(db.prepare('SELECT * FROM contracts WHERE id = ?').get(newVersionId)));
});

// PPA to PSA Allocations
router.get('/:id/allocations', (req, res) => {
  const allocations = db.prepare(`
    SELECT a.*, c.contract_no as psa_no, e.name as buyer_name
    FROM contract_allocations a
    JOIN contracts c ON a.psa_id = c.id
    JOIN entities e ON c.buyer_id = e.id
    WHERE a.ppa_id = ?
    ORDER BY a.created_at DESC
  `).all(req.params.id);
  res.json(allocations);
});

// Split a period's PPA energy across the PSAs it is allocated to. The
// allocations were recorded but nothing consumed them, so the split that every
// downstream bill depends on had to be done by hand.
router.post('/:id/allocate-energy', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const ppa = db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PPA'`).get(req.params.id);
  if (!ppa) return res.status(404).json({ error: 'PPA not found' });

  const { period_month } = req.body;
  if (!period_month) return res.status(400).json({ error: 'period_month is required' });

  // Take the energy given, or the period's own recorded energy when it is not.
  let energyMwh = Number(req.body.energy_mwh);
  let sourceEnergyId = null;
  if (!Number.isFinite(energyMwh)) {
    const row = db.prepare(`
      SELECT id, energy_mwh FROM energy_data WHERE contract_id = ? AND period_month = ?
      ORDER BY (data_type = 'FINAL') DESC, created_at DESC LIMIT 1
    `).get(ppa.id, period_month);
    if (!row) return res.status(400).json({ error: `No energy recorded for ${period_month}; pass energy_mwh or upload it first.` });
    energyMwh = row.energy_mwh;
    sourceEnergyId = row.id;
  }

  const allocations = allocationsInForce(ppa.id, period_month);
  if (!allocations.length) {
    return res.status(400).json({ error: `No PSA allocation is in force for ${period_month}.` });
  }

  const totalPercent = allocations.reduce((sum, a) => sum + a.allocation_percent, 0);
  const split = allocations.map((a) => ({
    psa_id: a.psa_id,
    psa_contract_no: a.psa_contract_no,
    allocation_percent: a.allocation_percent,
    energy_mwh: Number(((energyMwh * a.allocation_percent) / 100).toFixed(3)),
  }));

  // Rounding each share independently can lose or gain a little against the
  // source; the largest share carries the difference so the parts still sum to
  // the whole.
  const allocated = split.reduce((sum, x) => sum + x.energy_mwh, 0);
  const drift = Number((energyMwh * (totalPercent / 100) - allocated).toFixed(3));
  if (drift !== 0 && split.length) split[0].energy_mwh = Number((split[0].energy_mwh + drift).toFixed(3));

  logAudit({
    req, user: req.user, action: 'ALLOCATE_ENERGY', module: 'REIA',
    entityType: 'contract', entityId: ppa.id,
    details: { period_month, energy_mwh: energyMwh, allocations: split.length },
  });

  res.json({
    ppa_id: ppa.id,
    period_month,
    source_energy_mwh: energyMwh,
    source_energy_data_id: sourceEnergyId,
    allocated_percent: totalPercent,
    unallocated_percent: Number((100 - totalPercent).toFixed(3)),
    allocations: split,
  });
});

router.post('/:id/allocations', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const ppa = db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PPA'`).get(req.params.id);
  if (!ppa) return res.status(404).json({ error: 'PPA not found' });
  
  const { psa_id, allocation_percent, effective_from, effective_to } = req.body;

  const percent = Number(allocation_percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return res.status(400).json({ error: 'allocation_percent must be between 0 and 100' });
  }

  // A PPA cannot be allocated beyond itself. Only the allocations whose validity
  // overlaps this one count towards the limit — a share released when one PSA
  // ends is available to re-allocate from that date on.
  const from = effective_from || contract?.tenure_start || '0000-01-01';
  const to = effective_to || '9999-12-31';
  const overlapping = db.prepare(`
    SELECT COALESCE(SUM(allocation_percent), 0) AS total FROM contract_allocations
    WHERE ppa_id = ?
      AND COALESCE(effective_from, '0000-01-01') <= ?
      AND COALESCE(effective_to, '9999-12-31') >= ?
  `).get(ppa.id, to, from).total;

  if (overlapping + percent > 100) {
    return res.status(400).json({
      error: `Allocating ${percent}% would take this PPA to ${overlapping + percent}% over ${from} to ${to === '9999-12-31' ? 'open' : to}.`,
      already_allocated_percent: overlapping,
    });
  }

  db.prepare(`
    INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId('CAL'), ppa.id, psa_id, percent, effective_from, effective_to ?? null);
  
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE_ALLOCATION', module: 'REIA', entityType: 'contract', entityId: ppa.id, details: { psa_id, allocation_percent } });
  res.status(201).json({ success: true });
});

router.post('/bulk-upload', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const rows = req.body.rows || [];
  const results = { successful: 0, failed: 0, errors: [] };
  
  const insert = db.prepare(`
    INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
      tariff_type, tariff_per_unit, tenure_start, tenure_end, billing_cycle, emd_amount, pbg_amount, status)
    VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
      'FLAT', @tariff_per_unit, @tenure_start, @tenure_end, @billing_cycle, @emd_amount, @pbg_amount, 'ACTIVE')
  `);
  
  db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r.contract_no || !r.capacity_mw || !r.tariff_per_unit) throw new Error('Missing required fields (contract_no, capacity_mw, tariff_per_unit)');
        insert.run({ id: newId('CON'), billing_cycle: 'MONTHLY', emd_amount: null, pbg_amount: null, commissioned_capacity_mw: r.capacity_mw, cod_date: null, ...r });
        results.successful++;
      } catch (err) {
        results.failed++;
        results.errors.push({ row: i+1, contract_no: r.contract_no, error: err.message });
      }
    }
  })();
  
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'BULK_UPLOAD', module: 'REIA', entityType: 'contract', details: results });
  res.status(201).json(results);
});

export default router;
