import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS, counterpartySide } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, humanizePaymentTerms, humanizeRebateRule, humanizeLpsRule } from '../util.js';
import { syncRequirementsFromContract, createInstrumentsFromRequirements } from '../paymentSecurityEngine.js';
import { allocationsInForce } from '../services/allocations.js';
import { contractVisibleTo, contractForCounterparty, changedTermsForCounterparty } from '../services/counterpartyScope.js';
import { settlementPosition, settlementActions } from '../services/contractSettlement.js';
import {
  contractFieldErrors, normalizeProjectType, normalizeContractNo, changedTerms, cleanTerms, AMENDABLE_FIELDS, TERMINATION_GROUNDS,
} from '../services/contractRules.js';

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** A refusal that lists every problem, so the form can show them all at once. */
function refuseFields(res, errors, title = 'The contract was not saved') {
  return res.status(400).json({ error: errors.length === 1 ? errors[0] : `${title}: ${errors.length} problems — ${errors.join(' ')}`, errors });
}

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
    // A peak-power or FDRE PSA's peak obligation. Null on a contract that has
    // none, which is what leaves it uncharged.
    peak_window_start: b.peak_window_start || null,
    peak_window_end: b.peak_window_end || null,
    min_peak_availability_percent: num(b.min_peak_availability_percent),
    peak_penalty_per_mwh: num(b.peak_penalty_per_mwh),
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
// Filters this list understands. Anything else in the query string is a filter
// the caller believed in and did not get: capacity_min and capacity_max were
// silently dropped, so a search narrowed to a capacity band came back with every
// contract in the system and looked like it had worked.
const CONTRACT_FILTERS = new Set([
  'contract_type', 'status', 'project_type', 'q',
  'capacity_min', 'capacity_max', 'expiring_within_days', 'seller_id', 'buyer_id',
]);

router.get('/', (req, res) => {
  const { contract_type, status, project_type, q,
          capacity_min, capacity_max, expiring_within_days, seller_id, buyer_id } = req.query;

  const unknown = Object.keys(req.query).filter((k) => !CONTRACT_FILTERS.has(k));
  if (unknown.length) {
    return res.status(400).json({
      error: `Unrecognised filter(s): ${unknown.join(', ')}. Returning everything would look like a result.`,
      supported_filters: [...CONTRACT_FILTERS],
    });
  }

  // Joined so a search can name the counterparty. `q` matched contract_no alone,
  // so searching by seller — the obvious way to look for a generator's contracts
  // — returned nothing at all.
  let sql = `
    SELECT c.* FROM contracts c
    LEFT JOIN entities es ON es.id = c.seller_id
    LEFT JOIN entities eb ON eb.id = c.buyer_id
    WHERE 1=1
  `;
  const params = [];

  const side = counterpartySide(req.user);
  if (side === 'SELLER') {
    sql += " AND c.seller_id = ? AND c.status <> 'DRAFT'";
    params.push(req.user.linked_entity_id);
  } else if (side === 'BUYER') {
    sql += " AND c.buyer_id = ? AND c.status <> 'DRAFT'";
    params.push(req.user.linked_entity_id);
  }

  if (contract_type) { sql += ' AND c.contract_type = ?'; params.push(contract_type); }
  if (status) { sql += ' AND c.status = ?'; params.push(status); }
  if (project_type) { sql += ' AND lower(c.project_type) = lower(?)'; params.push(normalizeProjectType(project_type)); }
  if (seller_id) { sql += ' AND c.seller_id = ?'; params.push(seller_id); }
  if (buyer_id) { sql += ' AND c.buyer_id = ?'; params.push(buyer_id); }
  // Escaped, so "%" or "_" typed in the box is searched for rather than matching every contract.
  const term = typeof q === 'string' ? q.trim() : '';
  if (term) {
    const like = `%${likeEscape(term)}%`;
    // A counterparty searches its own contracts by number. Matching the other
    // side's name would let it test which buyers or generators it is paired with.
    if (side) {
      sql += " AND c.contract_no LIKE ? ESCAPE '\\'";
      params.push(like);
    } else {
      sql += " AND (c.contract_no LIKE ? ESCAPE '\\' OR es.name LIKE ? ESCAPE '\\' OR eb.name LIKE ? ESCAPE '\\')";
      params.push(like, like, like);
    }
  }

  for (const [value, clause, label] of [
    [capacity_min, ' AND c.capacity_mw >= ?', 'capacity_min'],
    [capacity_max, ' AND c.capacity_mw <= ?', 'capacity_max'],
  ]) {
    if (value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n)) return res.status(400).json({ error: `${label} must be a number` });
    sql += clause;
    params.push(n);
  }

  // "Show me what runs out in the next 30 days" — asked of the dates rather than
  // of a status, which only tells you what some sweep has already relabelled.
  if (expiring_within_days !== undefined && expiring_within_days !== '') {
    const n = Number(expiring_within_days);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'expiring_within_days must be a number' });
    sql += ` AND c.tenure_end IS NOT NULL
             AND date(c.tenure_end) >= date('now')
             AND date(c.tenure_end) <= date('now', '+' || ? || ' days')
             AND c.status NOT IN ('TERMINATED','CLOSED','EXPIRED')`;
    params.push(String(Math.round(n)));
  }

  sql += ' ORDER BY c.created_at DESC';
  const rows = db.prepare(sql).all(...params).map((c) => contractForCounterparty(req.user, fetchContractRelations(c)));
  res.json(rows);
});

// Registered before '/:id', or the router reads "bulk-template" as a contract
// id and answers 404.
router.get('/bulk-template', requireRole(...ROLE_GROUPS.REIA_ALL), (_req, res) => {
  const lines = [
    BULK_COLUMNS.join(','),
    // A PPA is bought from a generator, so it carries a seller and no buyer;
    // a PSA is sold to a discom, so it carries a buyer and no seller.
    'PPA/SOLAR/001,PPA,SOLAR,SELL-0001,,100,100,2026-04-01,3.15,2026-04-01,2051-03-31,MONTHLY,5000000,20000000',
    'PSA/DISCOM/001,PSA,SOLAR,,BUY-0001,100,100,,3.45,2026-04-01,2051-03-31,MONTHLY,,',
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=contract_bulk_template.csv');
  res.send(lines.join('\n'));
});

router.get('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  // A counterparty reads only its own contracts — tariff and tenure are the
  // commercially sensitive part of this payload.
  if (!contractVisibleTo(req.user, contract)) return res.status(404).json({ error: 'Contract not found' });
  // Every version of the contract, from whichever version is opened.
  const family = contract.parent_contract_id || contract.id;
  const versions = db.prepare('SELECT id, contract_no, version, status, amendment_effective_from, created_at FROM contracts WHERE id = ? OR parent_contract_id = ? ORDER BY version').all(family, family)
    .filter((v) => !counterpartySide(req.user) || v.status !== 'DRAFT');
  const amendments = db.prepare('SELECT * FROM contract_amendments WHERE contract_id = ? OR new_contract_id = ? ORDER BY version DESC').all(req.params.id, req.params.id)
    .map((a) => {
      if (!counterpartySide(req.user)) return a;
      let changed = {};
      try { changed = JSON.parse(a.changed_fields_json); } catch { /* shown as empty */ }
      return { ...a, changed_fields_json: JSON.stringify(changedTermsForCounterparty(req.user, changed)) };
    });
  res.json({ ...contractForCounterparty(req.user, fetchContractRelations(contract)), versions, amendments });
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const id = newId('CON');
  const b = { ...req.body };
  b.contract_no = normalizeContractNo(b.contract_no);
  b.project_type = normalizeProjectType(b.project_type);

  // A counterparty still going through onboarding is not one you can contract
  // with. Approval is the step that checks its licences, its registration and
  // its bank account, and a contract could be raised against an entity that had
  // passed none of them — the whole checklist reduced to paperwork nothing
  // waited on.
  for (const [role, entityId] of [['seller', b.seller_id], ['buyer', b.buyer_id]]) {
    if (!entityId) continue;
    const e = db.prepare('SELECT id, name, status, is_blacklisted, blacklist_reason FROM entities WHERE id = ?').get(entityId);
    if (!e) return res.status(404).json({ error: `${role} ${entityId} not found` });
    if (e.is_blacklisted) {
      return res.status(400).json({
        error: `${e.name} is blacklisted${e.blacklist_reason ? ` (${e.blacklist_reason})` : ''} — a new contract cannot be raised against it.`,
        entity_id: e.id,
      });
    }
    if (e.status !== 'APPROVED') {
      return res.status(400).json({
        error: `${e.name} is ${e.status}, not APPROVED — a contract cannot be raised against a counterparty that has not completed onboarding.`,
        entity_id: e.id,
        entity_status: e.status,
      });
    }
  }
  const fieldErrors = contractFieldErrors(b);
  if (b.contract_type === 'PPA' && !b.seller_id) fieldErrors.push('Select the seller this PPA is signed with.');
  if (b.contract_type === 'PSA' && !b.buyer_id) fieldErrors.push('Select the buyer this PSA is signed with.');
  if (fieldErrors.length) return refuseFields(res, fieldErrors, 'The contract was not created');

  // "QA-1", "QA-1 " and "qa-1" are one contract number to anyone reading a register.
  const clash = db.prepare('SELECT contract_no FROM contracts WHERE lower(trim(contract_no)) = lower(?) LIMIT 1').get(b.contract_no);
  if (clash) {
    return res.status(409).json({ error: `Contract number ${clash.contract_no} is already on record. Use a different number, or amend the existing contract.` });
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
        tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type, pbg_expiry,
        rebate_rule, lps_rule, payment_security_type, payment_terms_days, rebate_pct, rebate_days, rebate_basis, lps_annual_pct, lps_grace_days, trading_margin_per_mwh,
        normative_aux, free_energy_home_state, capacity_charges_total, annual_afc, annual_design_energy_mwh, napaf_percent, transmission_charge_per_mwh, min_cuf_percent,
        peak_window_start, peak_window_end, min_peak_availability_percent, peak_penalty_per_mwh, status)
      VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
        @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry,
        @rebate_rule, @lps_rule, @payment_security_type, @payment_terms_days, @rebate_pct, @rebate_days, @rebate_basis, @lps_annual_pct, @lps_grace_days, @trading_margin_per_mwh,
        @normative_aux, @free_energy_home_state, @capacity_charges_total, @annual_afc, @annual_design_energy_mwh, @napaf_percent, @transmission_charge_per_mwh, @min_cuf_percent,
        @peak_window_start, @peak_window_end, @min_peak_availability_percent, @peak_penalty_per_mwh, @status)
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

// Discarding an empty draft. Used when the agreement upload that follows
// creation fails: the rule is no contract without its agreement, and the record
// created a moment earlier would otherwise stay behind with nothing on file.
router.delete('/:id', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Contract not found' });
  if (c.status !== 'DRAFT' || c.version > 1) return res.status(400).json({ error: `${c.contract_no} is ${c.status} — only an unsigned first draft can be discarded.` });
  const used = db.prepare(`
    SELECT (SELECT COUNT(*) FROM documents WHERE contract_id = ? AND status = 'ACTIVE')
         + (SELECT COUNT(*) FROM contract_allocations WHERE ppa_id = ? OR psa_id = ?)
         + (SELECT COUNT(*) FROM invoices WHERE contract_id = ?) AS n
  `).get(c.id, c.id, c.id, c.id).n;
  if (used) return res.status(400).json({ error: `${c.contract_no} already has documents, mappings or bills on it and cannot be discarded.` });
  db.transaction(() => {
    db.prepare('DELETE FROM contract_projects WHERE contract_id = ?').run(c.id);
    db.prepare('DELETE FROM security_requirements WHERE contract_id = ?').run(c.id);
    db.prepare('DELETE FROM contracts WHERE id = ?').run(c.id);
  })();
  logAudit({ req, user: req.user, action: 'DISCARD_DRAFT', module: 'REIA', entityType: 'contract', entityId: c.id, details: { contract_no: c.contract_no } });
  res.json({ success: true });
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
      error: `Cannot move a contract from ${contract.status} to ${status}. Allowed next stages: ${allowed.join(', ') || 'none'}.`,
      allowed_transitions: allowed,
    });
  }
  
  // A contract is "signed" because there is a signed agreement, and that
  // agreement has to be on file before the record may say so. One could be
  // created, signed and made live with no document behind it at all — a
  // billable contract whose terms nobody could check against the paper.
  if (['SIGNED', 'PENDING_REGULATORY_APPROVAL', 'ACTIVE'].includes(status)
      && ['DRAFT', 'UNDER_NEGOTIATION', 'SIGNED', 'PENDING_REGULATORY_APPROVAL'].includes(contract.status)) {
    const onFile = db.prepare(`
      SELECT COUNT(*) AS n FROM documents
      WHERE status = 'ACTIVE' AND contract_id IN (?, ?)
    `).get(contract.id, contract.parent_contract_id ?? contract.id).n;
    if (!onFile) {
      return res.status(400).json({
        error: `${contract.contract_no} has no agreement document on file. Upload the signed contract PDF (working file → Documents) before moving it to ${status}.`,
        missing_document: true,
      });
    }
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

  // A termination is dated inside the contract's own life, and says on what ground.
  let terminationReasonText = termination_reason ?? null;
  let terminationDate = termination_date ?? null;
  if (status === 'TERMINATED') {
    const problems = [];
    const reasonIsGround = TERMINATION_GROUNDS.includes(termination_reason);
    const ground = req.body.termination_ground || (reasonIsGround ? termination_reason : null);
    if (!terminationDate) terminationDate = db.prepare(`SELECT date('now') d`).get().d;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(terminationDate))) problems.push('Termination date must be YYYY-MM-DD.');
    else {
      if (contract.tenure_end && terminationDate > contract.tenure_end) problems.push(`The termination date ${terminationDate} is after the contract ends anyway (${contract.tenure_end}).`);
      if (contract.tenure_start && terminationDate < contract.tenure_start && termination_date) problems.push(`The termination date ${terminationDate} is before the contract begins (${contract.tenure_start}).`);
    }
    if (ground != null && !TERMINATION_GROUNDS.includes(ground)) problems.push(`Termination ground must be one of ${TERMINATION_GROUNDS.join(', ')}.`);
    if (!ground && !String(termination_reason || '').trim()) problems.push('Give the ground for termination.');
    if (problems.length) return refuseFields(res, problems, 'The contract was not terminated');
    if (ground) {
      const label = ground.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
      const details = reasonIsGround ? '' : String(termination_reason || '').trim();
      terminationReasonText = details ? `${label} — ${details}` : label;
    }
  }

  db.prepare(`UPDATE contracts SET status = ?, remarks = ?, termination_reason = ?, termination_date = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, remarks ?? contract.remarks, terminationReasonText, status === 'TERMINATED' ? terminationDate : (termination_date ?? contract.termination_date ?? null), contract.id);

  // A contract that has ended supplies nobody. Its PPA→PSA shares used to run
  // on open-ended, so a terminated PPA went on "feeding" its buyers.
  if (ending) {
    const endOn = (status === 'TERMINATED' && terminationDate) ? terminationDate
      : db.prepare(`SELECT date('now') d`).get().d;
    const dropped = db.prepare(`DELETE FROM contract_allocations WHERE (ppa_id = ? OR psa_id = ?) AND effective_from > ?`).run(contract.id, contract.id, endOn).changes;
    const closed = db.prepare(`
      UPDATE contract_allocations SET effective_to = ?
      WHERE (ppa_id = ? OR psa_id = ?) AND COALESCE(effective_to, '9999-12-31') > ?
    `).run(endOn, contract.id, contract.id, endOn).changes;
    if (dropped || closed) {
      logAudit({ req, user: req.user, action: 'ALLOCATIONS_ENDED', module: 'REIA', entityType: 'contract', entityId: contract.id, details: { status, end_on: endOn, closed, dropped } });
    }
  }

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

        // The two versions hand over on the amendment's effective date: the old
        // one's shares end the day before, the new one's start that day. Both
        // used to run side by side, so a PSA was shown — and billed — as drawing
        // from the PPA twice.
        const eff = contract.amendment_effective_from;
        if (eff) {
          const side = contract.contract_type === 'PSA' ? 'psa_id' : 'ppa_id';
          const dayBefore = db.prepare(`SELECT date(?, '-1 day') d`).get(eff).d;
          db.prepare(`DELETE FROM contract_allocations WHERE ${side} = ? AND effective_from >= ?`).run(superseded.id, eff);
          db.prepare(`UPDATE contract_allocations SET effective_to = ? WHERE ${side} = ? AND COALESCE(effective_to, '9999-12-31') >= ?`).run(dayBefore, superseded.id, eff);
          db.prepare(`UPDATE contract_allocations SET effective_from = ? WHERE ${side} = ? AND effective_from < ?`).run(eff, contract.id, eff);
        }
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
  if (['TERMINATED', 'CLOSED', 'EXPIRED', 'AMENDED'].includes(original.status)) {
    return res.status(400).json({ error: `${original.contract_no} is ${original.status} — it cannot be amended.` });
  }

  // A draft has not been signed, so there is nothing to amend: its terms are
  // corrected in place. Amending one created a version 2 straight into
  // PENDING_REGULATORY_APPROVAL, skipping signature altogether.
  if (['DRAFT', 'UNDER_NEGOTIATION'].includes(original.status)) {
    const body = cleanTerms(req.body);
    if ('project_type' in body) body.project_type = normalizeProjectType(body.project_type);
    const merged = { ...original, ...body };
    const errors = contractFieldErrors(merged);
    if (errors.length) return refuseFields(res, errors, 'The draft was not saved');
    const changed = changedTerms(original, body);
    if (!Object.keys(changed).length) return res.status(400).json({ error: 'Nothing was changed.' });
    const sets = Object.keys(changed);
    const rules = { ...billingRuleFields(merged), ...hydroBillingFields(merged) };
    const extra = ['payment_terms', 'rebate_rule', 'lps_rule'];
    db.prepare(`UPDATE contracts SET ${[...new Set([...sets, ...extra])].map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...Object.fromEntries(sets.map((k) => [k, merged[k]])), ...Object.fromEntries(extra.map((k) => [k, rules[k]])), id: original.id });
    logAudit({ req, user: req.user, action: 'DRAFT_EDIT', module: 'REIA', entityType: 'contract', entityId: original.id, details: { changed, reason: req.body.amendment_reason } });
    return res.json({ ...fetchContractRelations(db.prepare('SELECT * FROM contracts WHERE id = ?').get(original.id)), edited_in_place: true, changed });
  }

  // When the revised terms start applying. An amendment is dated by the order or
  // agreement behind it, and there was nowhere to record that — a date passed in
  // was silently dropped, so a tariff revision effective from April looked
  // identical to one effective from the afternoon it was typed.
  const effectiveFrom = String(req.body.effective_from ?? req.body.amendment_effective_from ?? '').trim();
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return res.status(400).json({ error: 'Give the date the amendment takes effect from — an amendment applies from a date.' });
  }
  if (original.tenure_start && effectiveFrom < String(original.tenure_start)) {
    return res.status(400).json({
      error: `The effective date ${effectiveFrom} is before the contract began (${original.tenure_start}) — an amendment cannot reach back past the contract itself.`,
    });
  }
  const tenureEnd = req.body.tenure_end || original.tenure_end;
  if (tenureEnd && effectiveFrom > String(tenureEnd)) {
    return res.status(400).json({
      error: `The effective date ${effectiveFrom} is after the contract ends (${tenureEnd}) — there would be nothing left for it to apply to.`,
    });
  }


  const newVersionId = newId('CON');
  // Only the contract's terms move into the new version. The whole detail
  // payload used to be spread in, and the history then listed seller names,
  // version lists and "[object Object]" as things that had been amended.
  const terms = cleanTerms(Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => AMENDABLE_FIELDS.includes(k))));
  const updated = { ...original, ...terms };
  const amendErrors = contractFieldErrors(updated);
  if (amendErrors.length) return refuseFields(res, amendErrors, 'The amendment was not saved');

  const changedFields = changedTerms(original, terms);
  if (!Object.keys(changedFields).length) {
    return res.status(400).json({ error: 'The amendment changes none of the contract terms — nothing to submit.' });
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
        tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type,
        pbg_expiry, rebate_rule, lps_rule, payment_security_type, payment_terms_days, rebate_pct, rebate_days, rebate_basis, lps_annual_pct, lps_grace_days,
        trading_margin_per_mwh, normative_aux, free_energy_home_state, capacity_charges_total, annual_afc, annual_design_energy_mwh, napaf_percent,
        transmission_charge_per_mwh, min_cuf_percent,
        peak_window_start, peak_window_end, min_peak_availability_percent, peak_penalty_per_mwh,
        version, parent_contract_id, status, remarks, amendment_effective_from)
      VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
        @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type,
        @pbg_expiry, @rebate_rule, @lps_rule, @payment_security_type, @payment_terms_days, @rebate_pct, @rebate_days, @rebate_basis, @lps_annual_pct, @lps_grace_days,
        @trading_margin_per_mwh, @normative_aux, @free_energy_home_state, @capacity_charges_total, @annual_afc, @annual_design_energy_mwh, @napaf_percent,
        @transmission_charge_per_mwh, @min_cuf_percent,
        @peak_window_start, @peak_window_end, @min_peak_availability_percent, @peak_penalty_per_mwh,
        @version, @parent_contract_id, 'PENDING_REGULATORY_APPROVAL', @remarks, @amendment_effective_from)
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
      remarks: req.body.amendment_reason ?? req.body.reason ?? null,
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
    // From either end: a PSA's source PPAs have to follow it too, or the new
    // version of a PSA is linked to no PPA and has nothing to bill.
    const side = original.contract_type === 'PSA' ? 'psa_id' : 'ppa_id';
    const allocs = db.prepare(`SELECT * FROM contract_allocations WHERE ${side} = ? AND COALESCE(effective_to, '9999-12-31') >= ?`).all(original.id, effectiveFrom);
    const insertAlloc = db.prepare(`
      INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const a of allocs) {
      insertAlloc.run(newId('CAL'), side === 'ppa_id' ? newVersionId : a.ppa_id, side === 'psa_id' ? newVersionId : a.psa_id,
        a.allocation_percent, a.effective_from > effectiveFrom ? a.effective_from : effectiveFrom, a.effective_to);
    }

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

  logAudit({
    req: typeof req !== "undefined" ? req : null, user: req.user, action: 'AMEND',
    module: 'REIA', entityType: 'contract', entityId: original.id,
    details: { newVersionId, changedFields, effective_from: effectiveFrom },
  });
  // And against the new version, which otherwise has no history of its own: the
  // amendment was recorded only against the contract it replaced, so opening the
  // version actually in force showed an empty audit trail and nothing to say
  // where it had come from.
  logAudit({
    req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATED_BY_AMENDMENT',
    module: 'REIA', entityType: 'contract', entityId: newVersionId,
    details: { amended_from: original.id, version: original.version + 1, changedFields, effective_from: effectiveFrom },
  });
  // Instruments are raised when the version goes ACTIVE, not when it is drafted —
  // a version awaiting approval holds no letter of credit or guarantee yet.
  syncRequirementsFromContract(newVersionId);
  res.status(201).json(fetchContractRelations(db.prepare('SELECT * FROM contracts WHERE id = ?').get(newVersionId)));
});

// PPA to PSA Allocations. Read from either end: a PPA lists the PSAs it
// supplies, a PSA lists the PPAs it draws from. The link could only be seen —
// and made — from the PPA, so opening a PSA said nothing about where its energy
// came from.
router.get('/:id/allocations', (req, res) => {
  const contract = db.prepare('SELECT id, contract_type, seller_id, buyer_id, status FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract || !contractVisibleTo(req.user, contract)) return res.status(404).json({ error: 'Contract not found' });
  // Which PSAs a PPA supplies is SJVN's own book: it names the other side and
  // puts both tariffs, and so SJVN's margin, side by side.
  if (counterpartySide(req.user)) return res.status(403).json({ error: 'The PPA–PSA allocation is kept by SJVN' });
  const side = contract.contract_type === 'PSA' ? 'a.psa_id' : 'a.ppa_id';
  const allocations = db.prepare(`
    SELECT a.*, psa.contract_no AS psa_no, eb.name AS buyer_name,
           ppa.contract_no AS ppa_no, es.name AS seller_name,
           ppa.capacity_mw AS ppa_capacity_mw, ppa.project_type AS ppa_project_type,
           psa.capacity_mw AS psa_capacity_mw, psa.tariff_per_unit AS psa_tariff,
           ppa.tariff_per_unit AS ppa_tariff
    FROM contract_allocations a
    JOIN contracts psa ON a.psa_id = psa.id
    JOIN contracts ppa ON a.ppa_id = ppa.id
    LEFT JOIN entities eb ON psa.buyer_id = eb.id
    LEFT JOIN entities es ON ppa.seller_id = es.id
    WHERE ${side} = ?
    ORDER BY a.created_at DESC
  `).all(contract.id);
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

const ENDED_STATUSES = ['TERMINATED', 'CLOSED', 'EXPIRED', 'AMENDED'];
const OVERLAPS = `COALESCE(effective_from, '0000-01-01') <= ? AND COALESCE(effective_to, '9999-12-31') >= ?`;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Can a share of this PPA go to this PSA from this date? The dates and states
 * both contracts allow. Returns a refusal { status, error } or null.
 */
function shareWindowProblem(ppa, psa, from) {
  for (const c of [ppa, psa]) {
    if (ENDED_STATUSES.includes(c.status)) {
      return { status: 400, error: `${c.contract_no} is ${c.status} — a contract that has ended or been superseded cannot be mapped.` };
    }
  }
  // A share starts inside both contracts' lives. Shares dated years before
  // either contract existed, or after both had ended, were accepted.
  const latestStart = [ppa.tenure_start, psa.tenure_start].filter(Boolean).sort().pop() || '0000-01-01';
  const earliestEnd = [ppa.tenure_end, psa.tenure_end].filter(Boolean).sort()[0] || '9999-12-31';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from))) return { status: 400, error: 'Give the date the share starts from.' };
  if (from < latestStart) {
    return { status: 400, error: `The share cannot start on ${from}: ${ppa.tenure_start > psa.tenure_start ? ppa.contract_no : psa.contract_no} only begins on ${latestStart}.` };
  }
  if (from > earliestEnd) {
    return { status: 400, error: `The share cannot start on ${from}: ${ppa.tenure_end < psa.tenure_end ? ppa.contract_no : psa.contract_no} ends on ${earliestEnd}.` };
  }
  return null;
}

/**
 * Does a share of `percent` fit the PSA it goes to? No more MW than the PSA
 * buys, counting what its other source PPAs already give it, and no selling
 * below cost without a reason.
 */
function shareFitProblem(ppa, psa, percent, from, to, reason) {
  // The buyer cannot be promised more than its PSA contracts for. A PSA may
  // draw from several PPAs at once — billing sums them — so the test is the
  // MW it receives from all of them together, at the busiest point of the
  // new share's dates. This PPA's own rows are left out: a duplicate share is
  // refused before this, and a re-split closes them from the same date.
  const shareMw = round2(percent * ppa.capacity_mw / 100);
  const others = db.prepare(`
    SELECT a.allocation_percent, a.effective_from, a.effective_to, c.contract_no, c.capacity_mw
    FROM contract_allocations a JOIN contracts c ON c.id = a.ppa_id
    WHERE a.psa_id = ? AND a.ppa_id != ? AND c.status NOT IN ('TERMINATED','CLOSED','AMENDED') AND ${OVERLAPS.replace(/effective_/g, 'a.effective_')}
  `).all(psa.id, ppa.id, to, from);
  // The total only changes where a share starts, so those days are the ones to check.
  const days = [from, ...others.map((o) => o.effective_from).filter((d) => d && d > from && d <= to)];
  let peak = { mw: 0, sources: [] };
  for (const day of days) {
    const live = others.filter((o) => (o.effective_from || '0000-01-01') <= day && (o.effective_to || '9999-12-31') >= day);
    const mw = round2(live.reduce((t, o) => t + o.allocation_percent * (Number(o.capacity_mw) || 0) / 100, 0));
    if (mw > peak.mw) peak = { mw, sources: live };
  }
  if (psa.capacity_mw && round2(peak.mw + shareMw) > psa.capacity_mw + 1e-6) {
    const room = round2(Math.max(0, psa.capacity_mw - peak.mw));
    const fromOthers = peak.mw > 0
      ? ` It already receives ${peak.mw} MW from ${[...new Set(peak.sources.map((o) => o.contract_no))].join(', ')} over these dates, so ${room} MW is left — at most ${round2(room / ppa.capacity_mw * 100)}% of ${ppa.contract_no}.`
      : ` The most it can take is ${round2(psa.capacity_mw / ppa.capacity_mw * 100)}%.`;
    return {
      status: 400,
      error: `${percent}% of ${ppa.contract_no} is ${shareMw} MW, but ${psa.contract_no} contracts for only ${psa.capacity_mw} MW.${fromOthers}`,
      psa_capacity_mw: psa.capacity_mw,
      received_from_other_sources_mw: peak.mw,
      headroom_mw: room,
    };
  }
  // Selling below the purchase price is a loss on every unit. Allowed only on
  // a recorded reason (a pooled-tariff order, a VGF scheme), never by accident.
  const spread = round2((Number(psa.tariff_per_unit) || 0) - (Number(ppa.tariff_per_unit) || 0));
  if (spread < 0 && !reason) {
    return {
      status: 409,
      code: 'NEGATIVE_SPREAD',
      spread_per_unit: spread,
      error: `${psa.contract_no} sells at ₹${psa.tariff_per_unit}/unit but ${ppa.contract_no} buys at ₹${ppa.tariff_per_unit}/unit — SJVN would lose ₹${Math.abs(spread).toFixed(2)} on every unit. Record the reason (e.g. pooled-tariff order, VGF) to map it anyway.`,
    };
  }
  return null;
}

const refuseWith = (res, p) => res.status(p.status).json(Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'status')));

router.post('/:id/allocations', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const ppa = db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PPA'`).get(req.params.id);
  if (!ppa) return res.status(404).json({ error: 'PPA not found' });

  const { psa_id, allocation_percent, effective_to } = req.body;
  const reason = String(req.body.negative_spread_reason || '').trim();

  // The other end has to be a PSA that exists. Unchecked, a mistyped id fell
  // through to the foreign key and came back a 500.
  const psa = psa_id ? db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PSA'`).get(psa_id) : null;
  if (!psa) return res.status(400).json({ error: 'Select an existing PSA to map.' });

  const percent = Number(allocation_percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return res.status(400).json({ error: 'The share must be more than 0% and at most 100% of the PPA. To end a share, record a dated re-split (revise the allocation) instead.' });
  }

  const from = req.body.effective_from || [ppa.tenure_start, psa.tenure_start].filter(Boolean).sort().pop() || '0000-01-01';
  const windowProblem = shareWindowProblem(ppa, psa, from);
  if (windowProblem) return refuseWith(res, windowProblem);
  const to = effective_to || '9999-12-31';

  if (db.prepare(`SELECT 1 FROM contract_allocations WHERE ppa_id = ? AND psa_id = ? AND ${OVERLAPS}`).get(ppa.id, psa.id, to, from)) {
    return res.status(409).json({ error: `${psa.contract_no} already holds a share of ${ppa.contract_no} over these dates.` });
  }

  const overlapping = db.prepare(`SELECT COALESCE(SUM(allocation_percent), 0) AS total FROM contract_allocations WHERE ppa_id = ? AND ${OVERLAPS}`).get(ppa.id, to, from).total;
  if (round2(overlapping + percent) > 100) {
    const left = round2(Math.max(0, 100 - overlapping));
    return res.status(400).json({
      error: `${ppa.contract_no} is already ${round2(overlapping)}% allocated from ${from}. Only ${left}% (${round2(left * ppa.capacity_mw / 100)} MW) is left — ${percent}% would take it to ${round2(overlapping + percent)}%.`,
      already_allocated_percent: round2(overlapping),
      headroom_percent: left,
    });
  }

  const fitProblem = shareFitProblem(ppa, psa, percent, from, to, reason);
  if (fitProblem) return refuseWith(res, fitProblem);
  const shareMw = round2(percent * ppa.capacity_mw / 100);
  const spread = round2((Number(psa.tariff_per_unit) || 0) - (Number(ppa.tariff_per_unit) || 0));

  const allocId = newId('CAL');
  db.prepare(`
    INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(allocId, ppa.id, psa.id, percent, from, effective_to ?? null);

  logAudit({
    req, user: req.user, action: 'CREATE_ALLOCATION', module: 'REIA', entityType: 'contract', entityId: ppa.id,
    reason: reason || undefined,
    details: { allocation_id: allocId, psa_id: psa.id, allocation_percent: percent, effective_from: from, share_mw: shareMw, spread_per_unit: spread },
  });
  res.status(201).json({ success: true, id: allocId, share_mw: shareMw, spread_per_unit: spread, effective_from: from });
});

// Removing a share is a correction of a mistaken entry, so it is refused once
// anything has been billed against it — the history a bill was built on stays.
router.delete('/:id/allocations/:allocId', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const contract = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const alloc = db.prepare(`SELECT * FROM contract_allocations WHERE id = ? AND (ppa_id = ? OR psa_id = ?)`).get(req.params.allocId, contract.id, contract.id);
  if (!alloc) return res.status(404).json({ error: 'That share is not on this contract.' });
  if (['CLOSED', 'TERMINATED'].includes(contract.status)) {
    return res.status(400).json({ error: `${contract.contract_no} is ${contract.status} — its shares are part of the record and cannot be removed.` });
  }

  const billed = db.prepare(`
    SELECT COUNT(*) n FROM invoices
    WHERE contract_id IN (?, ?) AND billing_period >= substr(?, 1, 7) AND status != 'CANCELLED'
  `).get(alloc.psa_id, alloc.ppa_id, alloc.effective_from).n;
  if (billed) {
    return res.status(409).json({
      error: `This share has been billed on (${billed} bill${billed === 1 ? '' : 's'} from ${alloc.effective_from.slice(0, 7)}). It cannot be removed — end it from a date with a re-split instead.`,
    });
  }

  db.prepare(`DELETE FROM contract_allocations WHERE id = ?`).run(alloc.id);
  logAudit({
    req, user: req.user, action: 'DELETE_ALLOCATION', module: 'REIA', entityType: 'contract', entityId: contract.id,
    details: { allocation_id: alloc.id, psa_id: alloc.psa_id, ppa_id: alloc.ppa_id, allocation_percent: alloc.allocation_percent, effective_from: alloc.effective_from },
  });
  res.json({ success: true });
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

  const { effective_from } = req.body || {};
  const reason = String(req.body?.reason || '').trim();
  const rows = Array.isArray(req.body?.allocations) ? req.body.allocations : null;
  if (!effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(String(effective_from))) {
    return res.status(400).json({ error: 'Give the date the new split takes effect from.' });
  }
  if (!rows) {
    return res.status(400).json({ error: 'Give the complete split from this date — every PSA that keeps a share, with its percentage. A PSA left out has its share ended.' });
  }

  // A re-split restates the basis of every month from its date. A month already
  // billed on the old split cannot be restated from here.
  const touched = new Set([
    ...db.prepare(`SELECT psa_id FROM contract_allocations WHERE ppa_id = ? AND COALESCE(effective_to, '9999-12-31') >= ?`).all(ppa.id, effective_from).map((a) => a.psa_id),
    ...rows.map((r) => r?.psa_id).filter(Boolean),
  ]);
  const ids = [ppa.id, ...touched];
  const billed = db.prepare(`
    SELECT c.contract_no, MAX(i.billing_period) AS period FROM invoices i JOIN contracts c ON c.id = i.contract_id
    WHERE i.contract_id IN (${ids.map(() => '?').join(',')}) AND i.billing_period >= substr(?, 1, 7) AND i.status != 'CANCELLED'
    GROUP BY c.contract_no ORDER BY period DESC LIMIT 1
  `).get(...ids, effective_from);
  if (billed) {
    const next = db.prepare(`SELECT date(? || '-01', '+1 month') d`).get(billed.period).d;
    return res.status(409).json({
      error: `${billed.contract_no} has already been billed for ${billed.period}. A new split can start from ${next} at the earliest; a billed month is corrected by a supplementary bill, not by re-splitting.`,
      earliest_effective_from: next,
    });
  }

  const seen = new Set();
  const checked = [];
  let total = 0;
  for (const r of rows) {
    const pct = Number(r?.allocation_percent);
    const psa = r?.psa_id ? db.prepare(`SELECT * FROM contracts WHERE id = ? AND contract_type = 'PSA'`).get(r.psa_id) : null;
    if (!psa) return res.status(400).json({ error: 'Every row of the new split needs an existing PSA.' });
    if (seen.has(psa.id)) return res.status(400).json({ error: `${psa.contract_no} appears twice in the new split — give it one share.` });
    seen.add(psa.id);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return res.status(400).json({ error: `The share for ${psa.contract_no} must be more than 0% and at most 100%. Leave a PSA out of the split to end its share.` });
    }
    const problem = shareWindowProblem(ppa, psa, effective_from) || shareFitProblem(ppa, psa, pct, effective_from, '9999-12-31', reason);
    if (problem) return refuseWith(res, problem);
    total = round2(total + pct);
    checked.push({ psa, pct });
  }
  if (rows.length === 0 && ENDED_STATUSES.includes(ppa.status)) {
    return res.status(400).json({ error: `${ppa.contract_no} is ${ppa.status} — its shares have already ended.` });
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
    for (const { psa, pct } of checked) {
      db.prepare(`
        INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(newId('CAL'), ppa.id, psa.id, pct, effective_from);
    }
  })();

  const after = checked.map(({ psa, pct }) => ({ psa_id: psa.id, psa_no: psa.contract_no, allocation_percent: pct, share_mw: round2(pct * ppa.capacity_mw / 100) }));
  const ended = before.filter((b) => !checked.some((c) => c.psa.id === b.psa_id)).map((b) => b.psa_id);
  logAudit({
    req, user: req.user, action: 'REVISE_ALLOCATION', module: 'REIA', entityType: 'contract', entityId: ppa.id,
    reason: reason || undefined,
    details: { effective_from, closed_on: closesOn, before, after, ended_psa_ids: ended, new_total_percent: total },
  });

  res.json({
    success: true,
    effective_from,
    previous_allocations_closed_on: closesOn,
    allocations: after,
    ended_psa_ids: ended,
    ended_psa_nos: ended.map((id) => db.prepare('SELECT contract_no FROM contracts WHERE id = ?').get(id)?.contract_no).filter(Boolean),
    total_percent: total,
  });
});

// ── Bulk load ────────────────────────────────────────────────────────────────
//
// A desk with fifty signed PPAs to enter should not type them one form at a
// time. What was missing around the loader was everything that makes a bulk load
// safe to run: the template that says which columns it reads, a dry run that
// says what would happen before anything is written, and the checks the single
// create route applies — a spreadsheet could name a counterparty that does not
// exist, or one still in onboarding, and the row would load anyway.

/** The columns the loader reads. Anything else in a row is named back to the user. */
const BULK_COLUMNS = [
  'contract_no', 'contract_type', 'project_type', 'seller_id', 'buyer_id',
  'capacity_mw', 'commissioned_capacity_mw', 'cod_date',
  'tariff_per_unit', 'tenure_start', 'tenure_end', 'billing_cycle',
  'emd_amount', 'pbg_amount',
];

const BILLING_CYCLES = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One row, validated the way the single create route validates a form. */
function checkBulkRow(raw, entityCache, seenNumbers) {
  const errors = [];
  const unknown = Object.keys(raw || {}).filter((k) => !BULK_COLUMNS.includes(k));
  if (unknown.length) errors.push(`unknown column(s): ${unknown.join(', ')} — see /api/contracts/bulk-template`);

  const num = (v) => (v === '' || v == null ? null : Number(v));
  const str = (v) => (v == null ? '' : String(v).trim());

  const row = {
    contract_no: str(raw.contract_no),
    contract_type: str(raw.contract_type).toUpperCase(),
    project_type: normalizeProjectType(str(raw.project_type)),
    seller_id: str(raw.seller_id) || null,
    buyer_id: str(raw.buyer_id) || null,
    capacity_mw: num(raw.capacity_mw),
    commissioned_capacity_mw: num(raw.commissioned_capacity_mw),
    cod_date: str(raw.cod_date) || null,
    tariff_per_unit: num(raw.tariff_per_unit),
    tenure_start: str(raw.tenure_start) || null,
    tenure_end: str(raw.tenure_end) || null,
    billing_cycle: (str(raw.billing_cycle) || 'MONTHLY').toUpperCase(),
    emd_amount: num(raw.emd_amount),
    pbg_amount: num(raw.pbg_amount),
  };

  if (!row.contract_no) errors.push('contract_no is required');
  else if (seenNumbers.has(row.contract_no)) errors.push(`contract_no ${row.contract_no} appears twice in this file`);
  else if (db.prepare('SELECT id FROM contracts WHERE lower(trim(contract_no)) = lower(?)').get(row.contract_no)) {
    errors.push(`contract_no ${row.contract_no} is already on record`);
  }

  if (!['PPA', 'PSA'].includes(row.contract_type)) errors.push('contract_type must be PPA or PSA');
  if (!row.project_type) errors.push('project_type is required');
  if (!Number.isFinite(row.capacity_mw) || row.capacity_mw <= 0) errors.push('capacity_mw must be a positive number');
  if (!Number.isFinite(row.tariff_per_unit) || row.tariff_per_unit < 0) errors.push('tariff_per_unit must be a non-negative number');
  if (row.commissioned_capacity_mw != null
      && (!Number.isFinite(row.commissioned_capacity_mw) || row.commissioned_capacity_mw < 0)) {
    errors.push('commissioned_capacity_mw must be a number');
  }
  if (!BILLING_CYCLES.includes(row.billing_cycle)) errors.push(`billing_cycle must be one of ${BILLING_CYCLES.join('/')}`);

  for (const field of ['tenure_start', 'tenure_end', 'cod_date']) {
    if (row[field] && !ISO_DATE.test(row[field])) errors.push(`${field} must be YYYY-MM-DD`);
  }
  if (!row.tenure_start) errors.push('tenure_start is required');
  if (!row.tenure_end) errors.push('tenure_end is required');
  if (row.tenure_start && row.tenure_end && row.tenure_end <= row.tenure_start) {
    errors.push('tenure_end must be after tenure_start');
  }

  // A PPA is bought from a generator and a PSA is sold to a discom, so each
  // needs its own side named. Both were optional, which let a contract load with
  // no counterparty at all.
  if (row.contract_type === 'PPA' && !row.seller_id) errors.push('a PPA needs seller_id');
  if (row.contract_type === 'PSA' && !row.buyer_id) errors.push('a PSA needs buyer_id');

  // The same rule the form route applies: onboarding is what checks a
  // counterparty's licences, registration and bank account, and a contract
  // against one that has not finished it is not a contract.
  for (const [side, entityId] of [['seller', row.seller_id], ['buyer', row.buyer_id]]) {
    if (!entityId) continue;
    if (!entityCache.has(entityId)) {
      entityCache.set(entityId, db.prepare('SELECT id, name, entity_type, status, is_blacklisted FROM entities WHERE id = ?').get(entityId));
    }
    const entity = entityCache.get(entityId);
    if (!entity) { errors.push(`${side} ${entityId} not found`); continue; }
    if (entity.is_blacklisted) errors.push(`${side} ${entity.name} is blacklisted`);
    if (entity.status !== 'APPROVED') {
      errors.push(`${side} ${entity.name} is ${entity.status}, not APPROVED — onboarding is not complete`);
    }
    const expected = side === 'seller' ? 'SELLER' : 'BUYER';
    if (entity.entity_type !== expected) errors.push(`${entityId} is a ${entity.entity_type}, not a ${expected}`);
  }

  for (const field of ['emd_amount', 'pbg_amount']) {
    if (row[field] != null && (!Number.isFinite(row[field]) || row[field] < 0)) {
      errors.push(`${field} must be a non-negative number`);
    }
  }

  // Blank means commissioned in full only for a PPA whose COD is given (a plant
  // already running); otherwise 0. Defaulting to the full capacity marked every
  // bulk-loaded draft — and every PSA, which has no plant — as 100% at COD.
  if (row.commissioned_capacity_mw == null) {
    row.commissioned_capacity_mw = row.contract_type === 'PPA' && row.cod_date ? row.capacity_mw : 0;
  }
  if (row.contract_type === 'PSA' && row.commissioned_capacity_mw > 0) errors.push('a PSA has no plant of its own — leave commissioned_capacity_mw blank');
  if (row.commissioned_capacity_mw > 0 && !row.cod_date) errors.push('commissioned_capacity_mw needs its cod_date');
  if (Number.isFinite(row.capacity_mw) && row.commissioned_capacity_mw > row.capacity_mw) errors.push('commissioned_capacity_mw cannot exceed capacity_mw');
  return { row, errors };
}

/**
 * Load signed contracts from a spreadsheet.
 *
 * `dry_run: true` validates and reports without writing. Rows are loaded as
 * DRAFT — going live is the status route's job, which is where the approvals a
 * contract needs are enforced — and the good rows of a mixed file still load,
 * with every rejected row named by its spreadsheet line.
 */
router.post('/bulk-upload', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const dryRun = !!req.body?.dry_run;
  if (rows.length === 0) return res.status(400).json({ error: 'No rows supplied' });

  const insert = db.prepare(`
    INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw, commissioned_capacity_mw, cod_date,
      tariff_type, tariff_per_unit, tenure_start, tenure_end, billing_cycle, emd_amount, pbg_amount, status)
    VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
      'FLAT', @tariff_per_unit, @tenure_start, @tenure_end, @billing_cycle, @emd_amount, @pbg_amount, 'DRAFT')
  `);

  const results = { dry_run: dryRun, rows_received: rows.length, successful: 0, failed: 0, errors: [], preview: [] };
  const entityCache = new Map();
  const seenNumbers = new Set();
  const accepted = [];

  rows.forEach((raw, idx) => {
    const line = idx + 1; // 1-based, matching the row the user sees in the file
    const { row, errors } = checkBulkRow(raw, entityCache, seenNumbers);
    if (errors.length) {
      results.failed += 1;
      results.errors.push({ row: line, contract_no: row.contract_no || null, error: errors.join('; '), errors });
      return;
    }
    seenNumbers.add(row.contract_no);
    accepted.push({ line, row });
    results.preview.push({
      row: line,
      contract_no: row.contract_no,
      contract_type: row.contract_type,
      counterparty: entityCache.get(row.seller_id || row.buyer_id)?.name || null,
      capacity_mw: row.capacity_mw,
      tariff_per_unit: row.tariff_per_unit,
      tenure: `${row.tenure_start} → ${row.tenure_end}`,
      status: 'DRAFT',
    });
  });

  if (!dryRun && accepted.length) {
    db.transaction(() => {
      for (const { line, row } of accepted) {
        try {
          insert.run({ id: newId('CON'), ...row });
          results.successful += 1;
        } catch (err) {
          // A row that passes every check and still will not insert is a
          // constraint nobody wrote down; it is reported, not swallowed.
          results.failed += 1;
          results.successful = Math.max(0, results.successful);
          results.errors.push({ row: line, contract_no: row.contract_no, error: err.message, errors: [err.message] });
        }
      }
    })();
  } else if (dryRun) {
    results.would_load = accepted.length;
  }

  logAudit({
    req: typeof req !== 'undefined' ? req : null,
    user: req.user,
    action: dryRun ? 'BULK_UPLOAD_DRY_RUN' : 'BULK_UPLOAD',
    module: 'REIA',
    entityType: 'contract',
    details: { rows_received: rows.length, successful: results.successful, failed: results.failed, errors: results.errors },
  });

  res.status(dryRun ? 200 : 201).json(results);
});

export default router;
