import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';

const router = Router();
router.use(requireAuth);

// A. Stakeholder Onboarding and Registration + C. Profile Management
router.get('/', (req, res) => {
  const { entity_type, status } = req.query;
  let sql = 'SELECT * FROM entities WHERE 1=1';
  const params = [];
  if (entity_type) { sql += ' AND entity_type = ?'; params.push(entity_type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const history = db.prepare('SELECT * FROM entity_audit WHERE entity_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...entity, history });
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const id = newId('ENT');
  const body = req.body;
  db.prepare(`
    INSERT INTO entities (id, entity_type, category, name, capacity_mw, technology, contracted_capacity_mw,
      psa_tariff, supply_criteria, organization_details, regulatory_approvals, bank_details, contact_details, documents, status)
    VALUES (@id, @entity_type, @category, @name, @capacity_mw, @technology, @contracted_capacity_mw,
      @psa_tariff, @supply_criteria, @organization_details, @regulatory_approvals, @bank_details, @contact_details, @documents, 'PENDING')
  `).run({
    id,
    entity_type: body.entity_type,
    category: body.category,
    name: body.name,
    capacity_mw: body.capacity_mw ?? null,
    technology: body.technology ?? null,
    contracted_capacity_mw: body.contracted_capacity_mw ?? null,
    psa_tariff: body.psa_tariff ?? null,
    supply_criteria: body.supply_criteria ?? null,
    organization_details: body.organization_details ?? null,
    regulatory_approvals: body.regulatory_approvals ?? null,
    bank_details: body.bank_details ?? null,
    contact_details: body.contact_details ?? null,
    documents: body.documents ? JSON.stringify(body.documents) : null,
  });
  logAudit({ user: req.user, action: 'CREATE', module: 'REIA', entityType: 'entity', entityId: id, details: body });
  pushNotification({ role: 'SJVN_ADMIN', type: 'ONBOARDING', message: `New ${body.entity_type} onboarding request: ${body.name}` });
  res.status(201).json(db.prepare('SELECT * FROM entities WHERE id = ?').get(id));
});

router.put('/:id', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const existing = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entity not found' });

  const fields = ['category', 'name', 'capacity_mw', 'technology', 'contracted_capacity_mw', 'psa_tariff',
    'supply_criteria', 'organization_details', 'regulatory_approvals', 'bank_details', 'contact_details'];
  const updates = {};
  for (const f of fields) {
    if (req.body[f] !== undefined && String(req.body[f]) !== String(existing[f])) {
      db.prepare(`INSERT INTO entity_audit (id, entity_id, field_changed, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newId('EAU'), existing.id, f, String(existing[f] ?? ''), String(req.body[f] ?? ''), req.user.name);
      updates[f] = req.body[f];
    }
  }
  const merged = { ...existing, ...updates };
  db.prepare(`
    UPDATE entities SET category=@category, name=@name, capacity_mw=@capacity_mw, technology=@technology,
      contracted_capacity_mw=@contracted_capacity_mw, psa_tariff=@psa_tariff, supply_criteria=@supply_criteria,
      organization_details=@organization_details, regulatory_approvals=@regulatory_approvals,
      bank_details=@bank_details, contact_details=@contact_details, updated_at=datetime('now')
    WHERE id=@id
  `).run(merged);
  logAudit({ user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'entity', entityId: existing.id, details: updates });
  res.json(db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id));
});

router.post('/:id/approve', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { decision, remarks } = req.body; // APPROVED | REJECTED
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  db.prepare(`UPDATE entities SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(decision, req.params.id);
  logAudit({ user: req.user, action: `ENTITY_${decision}`, module: 'REIA', entityType: 'entity', entityId: entity.id, details: { remarks } });
  res.json(db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id));
});

export default router;
