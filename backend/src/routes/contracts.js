import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit } from '../util.js';
import { syncRequirementsFromContract, createInstrumentsFromRequirements } from '../paymentSecurityEngine.js';

const router = Router();
router.use(requireAuth);

function withParties(contract) {
  if (!contract) return contract;
  const seller = contract.seller_id ? db.prepare('SELECT id, name FROM entities WHERE id = ?').get(contract.seller_id) : null;
  const buyer = contract.buyer_id ? db.prepare('SELECT id, name FROM entities WHERE id = ?').get(contract.buyer_id) : null;
  return { ...contract, seller_name: seller?.name ?? null, buyer_name: buyer?.name ?? null };
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
  const rows = db.prepare(sql).all(...params).map(withParties);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });
  const versions = db.prepare('SELECT id, contract_no, version, status, created_at FROM contracts WHERE id = ? OR parent_contract_id = ? ORDER BY version').all(req.params.id, req.params.id);
  res.json({ ...withParties(contract), versions });
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const id = newId('CON');
  const b = req.body;
  db.prepare(`
    INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw,
      tariff_per_unit, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type, pbg_expiry, status)
    VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw,
      @tariff_per_unit, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type, @pbg_expiry, 'ACTIVE')
  `).run({
    id,
    contract_no: b.contract_no,
    contract_type: b.contract_type,
    seller_id: b.seller_id ?? null,
    buyer_id: b.buyer_id ?? null,
    project_type: b.project_type,
    capacity_mw: b.capacity_mw,
    tariff_per_unit: b.tariff_per_unit,
    tenure_start: b.tenure_start,
    tenure_end: b.tenure_end,
    billing_cycle: b.billing_cycle || 'MONTHLY',
    payment_terms: b.payment_terms ?? null,
    emd_amount: b.emd_amount ?? null,
    pbg_amount: b.pbg_amount ?? null,
    pbg_type: b.pbg_type ?? null,
    pbg_expiry: b.pbg_expiry ?? null,
  });
  logAudit({ user: req.user, action: 'CREATE', module: 'REIA', entityType: 'contract', entityId: id, details: b });
  syncRequirementsFromContract(id);
  createInstrumentsFromRequirements(id, req.user);
  res.status(201).json(db.prepare('SELECT * FROM contracts WHERE id = ?').get(id));
});

// Amendment -> creates a new version, marks old as AMENDED
router.post('/:id/amend', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const original = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Contract not found' });

  const newVersionId = newId('CON');
  const updated = { ...original, ...req.body };
  db.prepare(`
    INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw,
      tariff_per_unit, tenure_start, tenure_end, billing_cycle, payment_terms, emd_amount, pbg_amount, pbg_type,
      pbg_expiry, version, parent_contract_id, status, remarks)
    VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw,
      @tariff_per_unit, @tenure_start, @tenure_end, @billing_cycle, @payment_terms, @emd_amount, @pbg_amount, @pbg_type,
      @pbg_expiry, @version, @parent_contract_id, 'ACTIVE', @remarks)
  `).run({
    ...updated,
    id: newVersionId,
    version: original.version + 1,
    parent_contract_id: original.parent_contract_id || original.id,
    remarks: req.body.amendment_reason ?? null,
  });
  db.prepare(`UPDATE contracts SET status = 'AMENDED', updated_at = datetime('now') WHERE id = ?`).run(original.id);
  logAudit({ user: req.user, action: 'AMEND', module: 'REIA', entityType: 'contract', entityId: original.id, details: { newVersionId } });
  syncRequirementsFromContract(newVersionId);
  createInstrumentsFromRequirements(newVersionId, req.user);
  res.status(201).json(db.prepare('SELECT * FROM contracts WHERE id = ?').get(newVersionId));
});

router.post('/bulk-upload', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const rows = req.body.rows || [];
  const inserted = [];
  const insert = db.prepare(`
    INSERT INTO contracts (id, contract_no, contract_type, seller_id, buyer_id, project_type, capacity_mw,
      tariff_per_unit, tenure_start, tenure_end, billing_cycle, emd_amount, pbg_amount, status)
    VALUES (@id, @contract_no, @contract_type, @seller_id, @buyer_id, @project_type, @capacity_mw,
      @tariff_per_unit, @tenure_start, @tenure_end, @billing_cycle, @emd_amount, @pbg_amount, 'ACTIVE')
  `);
  const tx = db.transaction((items) => {
    for (const r of items) {
      const id = newId('CON');
      insert.run({ id, billing_cycle: 'MONTHLY', emd_amount: null, pbg_amount: null, ...r });
      inserted.push(id);
    }
  });
  tx(rows);
  logAudit({ user: req.user, action: 'BULK_UPLOAD', module: 'REIA', entityType: 'contract', details: { count: inserted.length } });
  res.status(201).json({ inserted: inserted.length });
});

export default router;
