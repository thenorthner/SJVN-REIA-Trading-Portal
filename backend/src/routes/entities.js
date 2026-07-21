import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Use a diskStorage config that preserves the original file extension.
// multer's plain `{ dest: 'uploads/' }` shorthand generates filenames with NO
// extension (a random hex string), which means express.static('/uploads')
// can't determine the correct Content-Type when serving the file back —
// browsers then either misrender it or fail to preview it at all.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ storage });

const router = Router();
router.use(requireAuth);

function fetchEntityRelations(entity) {
  if (!entity) return entity;
  entity.contacts = db.prepare('SELECT * FROM entity_contacts WHERE entity_id = ?').all(entity.id);
  entity.documents = db.prepare('SELECT * FROM entity_documents WHERE entity_id = ?').all(entity.id);
  if (entity.parent_entity_id) {
    const parent = db.prepare('SELECT name FROM entities WHERE id = ?').get(entity.parent_entity_id);
    entity.parent_name = parent?.name;
  }
  return entity;
}

// A. Stakeholder Onboarding and Registration + C. Profile Management
router.get('/', (req, res) => {
  const { entity_type, status, parent_entity_id } = req.query;
  let sql = 'SELECT * FROM entities WHERE 1=1';
  const params = [];
  if (entity_type) { sql += ' AND entity_type = ?'; params.push(entity_type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (parent_entity_id !== undefined) {
    if (parent_entity_id === 'null') sql += ' AND parent_entity_id IS NULL';
    else { sql += ' AND parent_entity_id = ?'; params.push(parent_entity_id); }
  }
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params).map(fetchEntityRelations);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const history = db.prepare('SELECT * FROM entity_audit WHERE entity_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...fetchEntityRelations(entity), history });
});

router.post('/', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const id = newId('ENT');
  const body = req.body;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO entities (id, parent_entity_id, entity_type, category, name, pan_no, gst_no, cin, credit_rating,
        is_blacklisted, capacity_mw, technology, contracted_capacity_mw, psa_tariff, supply_criteria,
        organization_details, regulatory_approvals, bank_details, is_penny_drop_verified, invoice_template_json, status,
        logo_url, corporate_email, corporate_phone, corporate_website, tan_no, signatory_name, signatory_designation)
      VALUES (@id, @parent_entity_id, @entity_type, @category, @name, @pan_no, @gst_no, @cin, @credit_rating,
        0, @capacity_mw, @technology, @contracted_capacity_mw, @psa_tariff, @supply_criteria,
        @organization_details, @regulatory_approvals, @bank_details, 0, @invoice_template_json, 'PENDING',
        @logo_url, @corporate_email, @corporate_phone, @corporate_website, @tan_no, @signatory_name, @signatory_designation)
    `).run({
      id,
      parent_entity_id: body.parent_entity_id ?? null,
      entity_type: body.entity_type,
      category: body.category,
      name: body.name,
      pan_no: body.pan_no ?? null,
      gst_no: body.gst_no ?? null,
      cin: body.cin ?? null,
      credit_rating: body.credit_rating ?? null,
      capacity_mw: body.capacity_mw ?? null,
      technology: body.technology ?? null,
      contracted_capacity_mw: body.contracted_capacity_mw ?? null,
      psa_tariff: body.psa_tariff ?? null,
      supply_criteria: body.supply_criteria ?? null,
      organization_details: body.organization_details ?? null,
      regulatory_approvals: body.regulatory_approvals ?? null,
      bank_details: body.bank_details ?? null,
      invoice_template_json: body.invoice_template_json ?? null,
      logo_url: body.logo_url ?? null,
      corporate_email: body.corporate_email ?? null,
      corporate_phone: body.corporate_phone ?? null,
      corporate_website: body.corporate_website ?? null,
      tan_no: body.tan_no ?? null,
      signatory_name: body.signatory_name ?? null,
      signatory_designation: body.signatory_designation ?? null,
    });

    if (body.contacts && Array.isArray(body.contacts)) {
      const insertContact = db.prepare('INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const c of body.contacts) {
        insertContact.run(newId('CNT'), id, c.contact_type, c.name, c.email, c.phone, c.is_primary ? 1 : 0);
      }
    }

    if (body.documents && Array.isArray(body.documents)) {
      const insertDoc = db.prepare('INSERT INTO entity_documents (id, entity_id, doc_type, url, validity_end, alert_sent) VALUES (?, ?, ?, ?, ?, 0)');
      for (const d of body.documents) {
        insertDoc.run(newId('DOC'), id, d.doc_type, d.url, d.validity_end || null);
      }
    }
  })();

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'entity', entityId: id, details: { name: body.name } });
  pushNotification({ role: 'SJVN_ADMIN', type: 'ONBOARDING', message: `New ${body.entity_type} onboarding request: ${body.name}` });
  res.status(201).json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(id)));
});

router.put('/:id', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const existing = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entity not found' });

  const fields = ['category', 'name', 'pan_no', 'gst_no', 'cin', 'credit_rating', 'capacity_mw', 'technology', 'contracted_capacity_mw', 'psa_tariff',
    'supply_criteria', 'organization_details', 'regulatory_approvals', 'bank_details', 'invoice_template_json',
    'logo_url', 'corporate_email', 'corporate_phone', 'corporate_website', 'tan_no',
    'signatory_name', 'signatory_designation'];
  
  const updates = {};
  let isHighRisk = false;

  for (const f of fields) {
    if (req.body[f] !== undefined && String(req.body[f]) !== String(existing[f])) {
      if (['bank_details', 'pan_no', 'gst_no', 'capacity_mw', 'psa_tariff'].includes(f)) {
        isHighRisk = true;
      }
      db.prepare(`INSERT INTO entity_audit (id, entity_id, field_changed, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newId('EAU'), existing.id, f, String(existing[f] ?? ''), String(req.body[f] ?? ''), req.user.name);
      updates[f] = req.body[f];
    }
  }

  const merged = { ...existing, ...updates };
  // If high risk change (like bank), we strip penny drop verification and might pend approval
  if (isHighRisk && updates.bank_details) {
    merged.is_penny_drop_verified = 0;
  }

  db.prepare(`
    UPDATE entities SET category=@category, name=@name, pan_no=@pan_no, gst_no=@gst_no, cin=@cin, credit_rating=@credit_rating,
      capacity_mw=@capacity_mw, technology=@technology, contracted_capacity_mw=@contracted_capacity_mw, psa_tariff=@psa_tariff, supply_criteria=@supply_criteria,
      organization_details=@organization_details, regulatory_approvals=@regulatory_approvals,
      bank_details=@bank_details, is_penny_drop_verified=@is_penny_drop_verified, 
      invoice_template_json=@invoice_template_json,
      logo_url=@logo_url, corporate_email=@corporate_email, corporate_phone=@corporate_phone, corporate_website=@corporate_website, tan_no=@tan_no,
      signatory_name=@signatory_name, signatory_designation=@signatory_designation,
      updated_at=datetime('now')
    WHERE id=@id
  `).run(merged);

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'entity', entityId: existing.id, details: { highRisk: isHighRisk } });
  if (isHighRisk) {
    pushNotification({ role: 'SJVN_ADMIN', type: 'RISK_UPDATE', message: `High-risk profile update by ${existing.name}. Penny-drop reset.` });
  }

  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id)));
});

router.post('/:id/penny-drop', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  db.prepare(`UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?`).run(entity.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'PENNY_DROP_VERIFIED', module: 'REIA', entityType: 'entity', entityId: entity.id });
  res.json({ success: true, message: 'Bank account verified via penny drop' });
});

router.post('/:id/approve', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { decision, remarks } = req.body; // APPROVED | REJECTED
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  db.prepare(`UPDATE entities SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(decision, req.params.id);
  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: `ENTITY_${decision}`, module: 'REIA', entityType: 'entity', entityId: entity.id, details: { remarks } });
  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id)));
});

router.post('/:id/logo', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No logo file provided' });
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  
  const logoUrl = `/uploads/${req.file.filename}`;
  db.prepare(`UPDATE entities SET logo_url = ?, updated_at = datetime('now') WHERE id = ?`).run(logoUrl, entity.id);

  res.json({ success: true, logo_url: logoUrl });
});

router.post('/:id/signature', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), upload.single('signature'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No signature file provided' });
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  const signatureUrl = `/uploads/${req.file.filename}`;
  db.prepare(`UPDATE entities SET signature_url = ?, updated_at = datetime('now') WHERE id = ?`).run(signatureUrl, entity.id);

  logAudit({ req: typeof req !== "undefined" ? req : null, user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'entity', entityId: entity.id, details: { signature: 'uploaded' } });
  res.json({ success: true, signature_url: signatureUrl });
});


export default router;
