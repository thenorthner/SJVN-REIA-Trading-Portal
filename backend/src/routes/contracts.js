import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { syncRequirementsFromContract, createInstrumentsFromRequirements } from '../paymentSecurityEngine.js';

const router = Router();
router.use(requireAuth);

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
      contract.tariff_structure = JSON.parse(contract.tariff_structure_json);
    } catch(e) {}
  }
  return contract;
}

// B. Contract Management - search / filter / list
router.get('/', (req, res) => {
  const { contract_type, status, project_type, q } = req.query;
  let sql = 'SELECT * FROM contracts WHERE 1=1';
  const params = [];
  
  if (req.user.role === 'SELLER') {
    sql += ' AND seller_id = ?';
    params.push(req.user.linked_entity_id);
  } else if (req.user.role === 'BUYER') {
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
        tariff_type, tariff_per_unit, tariff_structure_json, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type, pbg_expiry, rebate_rule, lps_rule, payment_security_type, status)
      VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
        @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry, @rebate_rule, @lps_rule, @payment_security_type, @status)
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
      tariff_structure_json: b.tariff_structure ? JSON.stringify(b.tariff_structure) : null,
      tenure_start: b.tenure_start,
      tenure_end: b.tenure_end,
      billing_cycle: b.billing_cycle || 'MONTHLY',
      payment_terms: b.payment_terms ?? null,
      emd_amount: b.emd_amount ?? null,
      pbg_amount: b.pbg_amount ?? null,
      pbg_type: b.pbg_type ?? null,
      pbg_expiry: b.pbg_expiry ?? null,
      rebate_rule: b.rebate_rule ?? null,
      lps_rule: b.lps_rule ?? null,
      payment_security_type: b.payment_security_type ?? null,
      status: b.status || 'DRAFT'
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

router.post('/:id/status', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const { status, remarks, termination_reason, termination_date } = req.body;
  
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
        pbg_expiry, rebate_rule, lps_rule, payment_security_type, version, parent_contract_id, status, remarks)
      VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw, @commissioned_capacity_mw, @cod_date,
        @tariff_type, @tariff_per_unit, @tariff_structure_json, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type,
        @pbg_expiry, @rebate_rule, @lps_rule, @payment_security_type, @version, @parent_contract_id, 'ACTIVE', @remarks)
    `).run({
      ...updated,
      id: newVersionId,
      tariff_structure_json: updated.tariff_structure ? JSON.stringify(updated.tariff_structure) : original.tariff_structure_json,
      version: original.version + 1,
      parent_contract_id: original.parent_contract_id || original.id,
      remarks: req.body.amendment_reason ?? null,
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

router.post('/:id/allocations', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const ppa = db.prepare('SELECT * FROM contracts WHERE id = ? AND contract_type = "PPA"').get(req.params.id);
  if (!ppa) return res.status(404).json({ error: 'PPA not found' });
  
  const { psa_id, allocation_percent, effective_from, effective_to } = req.body;
  
  db.prepare(`
    INSERT INTO contract_allocations (id, ppa_id, psa_id, allocation_percent, effective_from, effective_to)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId('CAL'), ppa.id, psa_id, allocation_percent, effective_from, effective_to ?? null);
  
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
