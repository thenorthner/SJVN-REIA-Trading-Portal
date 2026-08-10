import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, humanizePaymentTerms, humanizeRebateRule, humanizeLpsRule } from '../util.js';
import { syncRequirementsFromContract, createInstrumentsFromRequirements } from '../paymentSecurityEngine.js';
import { allocationsInForce } from '../services/allocations.js';
import { contractVisibleTo } from '../services/counterpartyScope.js';
import { settlementPosition, settlementActions } from '../services/contractSettlement.js';

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
  // A counterparty reads only its own contracts — tariff and tenure are the
  // commercially sensitive part of this payload.
  if (!contractVisibleTo(req.user, contract)) return res.status(404).json({ error: 'Contract not found' });
  const versions = db.prepare('SELECT id, contract_no, version, status, created_at FROM contracts WHERE id = ? OR parent_contract_id = ? ORDER BY version').all(req.params.id, req.params.id);
  const amendments = db.prepare('SELECT * FROM contract_amendments WHERE contract_id = ? ORDER BY version DESC').all(req.params.id);
  res.json({ ...fetchContractRelations(contract), versions, amendments });
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const id = newId('CON');
  const b = req.body;

  // A counterparty still going through onboarding is not one you can contract
  // with. Approval is the step that checks its licences, its registration and
  // its bank account, and a contract could be raised against an entity that had
  // passed none of them — the whole checklist reduced to paperwork nothing
  // waited on.
  for (const [role, entityId] of [['seller', b.seller_id], ['buyer', b.buyer_id]]) {
    if (!entityId) continue;
    const e = db.prepare('SELECT id, name, status FROM entities WHERE id = ?').get(entityId);
    if (!e) return res.status(404).json({ error: `${role} ${entityId} not found` });
    if (e.status !== 'APPROVED') {
      return res.status(400).json({
        error: `${e.name} is ${e.status}, not APPROVED — a contract cannot be raised against a counterparty that has not completed onboarding.`,
        entity_id: e.id,
        entity_status: e.status,
      });
    }
  }
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
  
  // Ending a contract is where the money question gets asked, so it is asked
  // here rather than left to whoever remembers. Terminating only wrote a status,
  // a reason and a date — a contract could be ended with lakhs unbilled against
  // it and live bank guarantees still open, and nothing said so.
  const ending = ['TERMINATED', 'EXPIRED', 'CLOSED'].includes(status);
  const position = ending ? settlementPosition(contract.id) : null;

  // Termination itself is never blocked: the usual reason to terminate is that
  // the counterparty has stopped paying, and refusing to end the contract until
  // they pay would be exactly backwards. CLOSED is the one that is gated, since
  // that is the state that says nothing is left to do.
  if (status === 'CLOSED' && position && !position.settled) {
    const override = (req.body?.settlement_override_reason || '').trim();
    if (!override) {
      return res.status(400).json({
        error: 'This contract cannot be closed while its settlement is open. Clear the items below, or pass settlement_override_reason to close it as it stands.',
        settlement: position,
        outstanding_actions: settlementActions(position),
      });
    }
  }

  db.prepare(`UPDATE contracts SET status = ?, remarks = ?, termination_reason = ?, termination_date = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, remarks ?? contract.remarks, termination_reason ?? null, termination_date ?? null, contract.id);
    
  if (status === 'ACTIVE') {
    syncRequirementsFromContract(contract.id);
    createInstrumentsFromRequirements(contract.id, req.user);

    // Activating an amended version is what retires the one it replaces. The
    // amend route used to do this immediately, which put the revised terms live
    // before anyone approved them and left both versions billable at once.
    if (contract.parent_contract_id && contract.version > 1) {
      const superseded = db.prepare(`
        SELECT id, status, version FROM contracts
        WHERE (id = ? OR parent_contract_id = ?) AND version = ? AND status = 'ACTIVE' AND id != ?
      `).get(contract.parent_contract_id, contract.parent_contract_id, contract.version - 1, contract.id);
      if (superseded) {
        db.prepare(`UPDATE contracts SET status = 'AMENDED', updated_at = datetime('now') WHERE id = ?`).run(superseded.id);
        logAudit({
          req, user: req.user, action: 'STATUS_AMENDED', module: 'REIA', entityType: 'contract', entityId: superseded.id,
          beforeValue: 'ACTIVE', afterValue: 'AMENDED',
          details: { superseded_by: contract.id, version: contract.version, effective_from: contract.amendment_effective_from },
        });
      }
    }
  }

  logAudit({
    req: typeof req !== "undefined" ? req : null, user: req.user, action: `STATUS_${status}`,
    module: 'REIA', entityType: 'contract', entityId: contract.id,
    beforeValue: contract.status, afterValue: status,
    reason: (req.body?.settlement_override_reason || '').trim() || undefined,
    details: { remarks, termination_reason, settlement: position ?? undefined },
  });

  // Finance has to act on what is left, so they are told rather than expected to
  // notice a status change.
  if (position && !position.settled) {
    pushNotification({
      role: 'FINANCE_USER', type: 'CONTRACT_SETTLEMENT_DUE',
      message: `${contract.contract_no} moved to ${status} with settlement open — `
        + `₹${position.receivable_from_buyer.toLocaleString('en-IN')} receivable, `
        + `₹${position.payable_to_generator.toLocaleString('en-IN')} payable, `
        + `${position.active_security.length} security instrument(s) live.`,
    });
  }

  const fresh = fetchContractRelations(db.prepare('SELECT * FROM contracts WHERE id = ?').get(contract.id));
  res.json({
    ...fresh,
    ...(position ? { settlement: position, outstanding_actions: settlementActions(position) } : {}),
  });
});

// Amendment -> creates a new version, marks old as AMENDED
router.post('/:id/amend', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const original = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Contract not found' });

  // When the revised terms start applying. An amendment is dated by the order or
  // agreement behind it, and there was nowhere to record that — a date passed in
  // was silently dropped, so a tariff revision effective from April looked
  // identical to one effective from the afternoon it was typed.
  const effectiveFrom = String(req.body.effective_from ?? req.body.amendment_effective_from ?? '').trim();
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return res.status(400).json({ error: 'effective_from (YYYY-MM-DD) is required — an amendment applies from a date' });
  }
  if (original.tenure_start && effectiveFrom < String(original.tenure_start)) {
    return res.status(400).json({
      error: `effective_from ${effectiveFrom} is before the contract began (${original.tenure_start}) — an amendment cannot reach back past the contract itself.`,
    });
  }
  if (original.tenure_end && effectiveFrom > String(original.tenure_end)) {
    return res.status(400).json({
      error: `effective_from ${effectiveFrom} is after the contract ends (${original.tenure_end}) — there would be nothing left for it to apply to.`,
    });
  }

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
        transmission_charge_per_mwh, min_cuf_percent, version, parent_contract_id, status, remarks, amendment_effective_from)
      VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
        @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type,
        @pbg_expiry, @rebate_rule, @lps_rule, @payment_security_type, @payment_terms_days, @rebate_pct, @rebate_days, @rebate_basis, @lps_annual_pct, @lps_grace_days,
        @trading_margin_per_mwh, @normative_aux, @free_energy_home_state, @capacity_charges_total, @annual_afc, @annual_design_energy_mwh, @napaf_percent,
        @transmission_charge_per_mwh, @min_cuf_percent, @version, @parent_contract_id, 'PENDING_REGULATORY_APPROVAL', @remarks, @amendment_effective_from)
    `).run({
      ...updated,
      id: newVersionId,
      tariff_structure_json: (updated.tariff_structure && typeof updated.tariff_structure === 'object' && Object.keys(updated.tariff_structure).length > 0)
        ? JSON.stringify(updated.tariff_structure)
        : (original.tariff_structure_json && original.tariff_structure_json !== '{}' ? original.tariff_structure_json : null),
      trading_margin_per_mwh: (updated.trading_margin_per_mwh === '' || updated.trading_margin_per_mwh == null) ? null : Number(updated.trading_margin_per_mwh),
      version: original.version + 1,
      parent_contract_id: original.parent_contract_id || original.id,
      amendment_effective_from: effectiveFrom,
      remarks: req.body.amendment_reason ?? null,
      ...billingRuleFields(updated),
      ...hydroBillingFields(updated),
    });
    
    // Copy projects
    const projects = db.prepare('SELECT * FROM contract_projects WHERE contract_id = ?').all(original.id);
    const insertProj = db.prepare('INSERT INTO contract_projects (contract_id, project_entity_id, allocated_capacity_mw) VALUES (?, ?, ?)');
    for (const p of projects) insertProj.run(newVersionId, p.project_entity_id, p.allocated_capacity_mw);

    // And the PSA allocations, which did not follow. They stayed on the version
    // being retired, so after a tariff revision every buyer was still drawing
    // from the superseded PPA and the new one supplied nobody.
    const allocs = db.prepare('SELECT * FROM contract_allocations WHERE ppa_id = ?').all(original.id);
    const insertAlloc = db.prepare(`
      INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const a of allocs) insertAlloc.run(newId('CAL'), newVersionId, a.psa_id, a.allocation_percent, a.effective_from, a.effective_to);

    // The original is deliberately left ACTIVE. Marking it AMENDED here retired
    // it the moment the amendment was drafted, so the revised terms took effect
    // with nobody having approved them — and left both versions billable at
    // once, since AMENDED bills too. The switch happens when the new version is
    // activated, in the status route.
    db.prepare(`
      INSERT INTO contract_amendments (id, contract_id, version, changed_fields_json, approved_by, effective_from, new_contract_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(newId('CMA'), original.id, original.version, JSON.stringify(changedFields), req.user.name, effectiveFrom, newVersionId);
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
    // Said "between 0 and 100" while refusing 0, which read as though a PSA
    // could be ended by allocating it nothing. Ending one is /allocations/revise.
    return res.status(400).json({
      error: 'allocation_percent must be greater than 0 and at most 100. To end a PSA’s share, use POST /allocations/revise.',
    });
  }

  // A PPA cannot be allocated beyond itself. Only the allocations whose validity
  // overlaps this one count towards the limit — a share released when one PSA
  // ends is available to re-allocate from that date on.
  const from = effective_from || ppa?.tenure_start || '0000-01-01';
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

  // Bound to `from`, not the raw request value: the column is NOT NULL, so
  // omitting the optional effective_from inserted a null and failed. The
  // fallback to the PPA's own tenure_start was computed for the overlap check
  // above and then not used for the row that check was guarding.
  db.prepare(`
    INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId('CAL'), ppa.id, psa_id, percent, from, effective_to ?? null);
  
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE_ALLOCATION', module: 'REIA', entityType: 'contract', entityId: ppa.id, details: { psa_id, allocation_percent } });
  res.status(201).json({ success: true });
});

/**
 * Re-split a PPA from a date: the whole new allocation, at once.
 *
 * A buyer leaving mid-term and the others taking up its share is one business
 * event, and there was no way to record it. Allocations could only be created,
 * never ended or amended, and the ones already there ran open-ended — so a new
 * row for the remaining buyers was refused for taking the PPA past 100%, and the
 * old row could not be closed to make room. A contract that ended in July went
 * on being billed its 20% indefinitely.
 *
 * Taking the complete new split rather than one row at a time is what makes it
 * safe: closing the old rows and opening the new ones happen together, so the
 * PPA is never briefly over- or under-allocated, and a PSA left out of the list
 * is one whose share ends here — which is how a departing buyer is recorded,
 * rather than by allocating it nothing.
 */
router.post('/:id/allocations/revise', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const ppa = db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PPA'`).get(req.params.id);
  if (!ppa) return res.status(404).json({ error: 'PPA not found' });

  const { effective_from, reason } = req.body || {};
  const rows = Array.isArray(req.body?.allocations) ? req.body.allocations : null;
  if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(String(effective_from))) {
    return res.status(400).json({ error: 'effective_from (YYYY-MM-DD) is required — a re-split has to take effect on a date' });
  }
  if (!rows) {
    return res.status(400).json({ error: 'allocations must be an array of { psa_id, allocation_percent } — the complete split from this date, not just what changed' });
  }

  let total = 0;
  for (const r of rows) {
    const pct = Number(r?.allocation_percent);
    if (!r?.psa_id) return res.status(400).json({ error: 'each allocation needs a psa_id' });
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return res.status(400).json({ error: `allocation_percent for ${r.psa_id} must be greater than 0 and at most 100. Leave a PSA out of the list to end its share.` });
    }
    const psa = db.prepare(`SELECT id FROM contracts WHERE id = ? AND contract_type = 'PSA'`).get(r.psa_id);
    if (!psa) return res.status(404).json({ error: `PSA ${r.psa_id} not found` });
    total += pct;
  }
  if (total > 100) {
    return res.status(400).json({ error: `The new split comes to ${total}% — a PPA cannot be allocated beyond itself.`, requested_total_percent: total });
  }

  // Everything that was still running on the day before the change closes there.
  const closesOn = db.prepare(`SELECT date(?, '-1 day') d`).get(effective_from).d;
  const open = db.prepare(`
    SELECT * FROM contract_allocations
    WHERE ppa_id = ? AND COALESCE(effective_to, '9999-12-31') >= ?
  `).all(ppa.id, effective_from);

  const before = open.map((a) => ({ psa_id: a.psa_id, allocation_percent: a.allocation_percent, effective_to: a.effective_to }));

  db.transaction(() => {
    for (const a of open) {
      if (a.effective_from && a.effective_from >= effective_from) {
        // Recorded to start on or after the change: superseded outright.
        db.prepare('DELETE FROM contract_allocations WHERE id = ?').run(a.id);
      } else {
        db.prepare('UPDATE contract_allocations SET effective_to = ? WHERE id = ?').run(closesOn, a.id);
      }
    }
    for (const r of rows) {
      db.prepare(`
        INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(newId('CAL'), ppa.id, r.psa_id, Number(r.allocation_percent), effective_from);
    }
  })();

  const ended = before.filter((b) => !rows.some((r) => r.psa_id === b.psa_id)).map((b) => b.psa_id);
  logAudit({
    req, user: req.user, action: 'REVISE_ALLOCATION', module: 'REIA', entityType: 'contract', entityId: ppa.id,
    reason: reason || undefined,
    details: { effective_from, closed_on: closesOn, before, after: rows, ended_psa_ids: ended, new_total_percent: total },
  });

  res.json({
    success: true,
    effective_from,
    previous_allocations_closed_on: closesOn,
    allocations: rows,
    ended_psa_ids: ended,
    total_percent: total,
  });
});

router.post('/bulk-upload', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const rows = req.body.rows || [];
  const results = { successful: 0, failed: 0, errors: [] };
  
  const insert = db.prepare(`
    INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
      tariff_type, tariff_per_unit, tenure_start, tenure_end, billing_cycle, emd_amount, pbg_amount, status)
    VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
      'FLAT', @tariff_per_unit, @tenure_start, @tenure_end, @billing_cycle, @emd_amount, @pbg_amount, 'DRAFT')
  `);
  // Loaded as drafts. These went in ACTIVE, so a spreadsheet put contracts
  // straight into a billable state without passing through the approvals the
  // status route exists to enforce — the one route that checks them.
  
  db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        if (!r.contract_no || !r.capacity_mw || !r.tariff_per_unit) throw new Error('Missing required fields (contract_no, capacity_mw, tariff_per_unit)');
        // A default for every named parameter, because better-sqlite3 throws on
        // any it is not given and only some had one. A PPA row omitting buyer_id
        // — the natural shape, a PPA has no buyer — failed every time with
        // "Missing named parameter buyer_id", which reads like a bug in the file
        // rather than a column the template was expected to carry.
        insert.run({
          id: newId('CON'),
          seller_id: null, buyer_id: null, project_type: null,
          tenure_start: null, tenure_end: null, cod_date: null,
          billing_cycle: 'MONTHLY', emd_amount: null, pbg_amount: null,
          commissioned_capacity_mw: r.commissioned_capacity_mw ?? r.capacity_mw,
          ...r,
        });
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
