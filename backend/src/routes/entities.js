import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification } from '../util.js';
import {
  catalogForEntityType,
  summarizeApprovals,
  APPROVAL_STATUSES,
} from '../regulatoryApprovals.js';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({ storage });

const router = Router();
router.use(requireAuth);

function seedRegulatoryChecklist(entityId, entityType) {
  const catalog = catalogForEntityType(entityType);
  const ins = db.prepare(`
    INSERT OR IGNORE INTO entity_regulatory_approvals (
      id, entity_id, approval_code, label, is_mandatory, applies_to, doc_type, status, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED', ?)
  `);
  for (const item of catalog) {
    ins.run(
      newId('REG'),
      entityId,
      item.code,
      item.label,
      item.is_mandatory ? 1 : 0,
      item.applies_to,
      item.doc_type,
      item.sort_order,
    );
  }
  refreshRegulatorySummary(entityId);
}

function refreshRegulatorySummary(entityId) {
  const rows = db.prepare(`
    SELECT * FROM entity_regulatory_approvals WHERE entity_id = ? ORDER BY sort_order, approval_code
  `).all(entityId);
  const summary = summarizeApprovals(rows);
  db.prepare('UPDATE entities SET regulatory_approvals = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(summary.summary_text, entityId);
  return { rows, summary };
}

function fetchEntityRelations(entity) {
  if (!entity) return entity;
  entity.contacts = db.prepare('SELECT * FROM entity_contacts WHERE entity_id = ?').all(entity.id);
  entity.documents = db.prepare('SELECT * FROM entity_documents WHERE entity_id = ?').all(entity.id);
  if (entity.parent_entity_id) {
    const parent = db.prepare('SELECT name FROM entities WHERE id = ?').get(entity.parent_entity_id);
    entity.parent_name = parent?.name;
  }
  try {
    let regs = db.prepare(`
      SELECT * FROM entity_regulatory_approvals WHERE entity_id = ? ORDER BY sort_order, approval_code
    `).all(entity.id);
    if (!regs.length) {
      seedRegulatoryChecklist(entity.id, entity.entity_type);
      regs = db.prepare(`
        SELECT * FROM entity_regulatory_approvals WHERE entity_id = ? ORDER BY sort_order, approval_code
      `).all(entity.id);
    }
    entity.regulatory_checklist = regs;
    entity.regulatory_summary = summarizeApprovals(regs);
  } catch {
    entity.regulatory_checklist = [];
    entity.regulatory_summary = summarizeApprovals([]);
  }
  return entity;
}

router.get('/regulatory-catalog', (req, res) => {
  const type = req.query.entity_type || 'SELLER';
  res.json({
    entity_type: type,
    items: catalogForEntityType(type),
    statuses: APPROVAL_STATUSES,
  });
});

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
  if (!body.entity_type || !body.name || !body.category) {
    return res.status(400).json({ error: 'entity_type, name and category are required' });
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO entities (
        id, parent_entity_id, entity_type, category, name, pan_no, gst_no, cin, credit_rating,
        is_blacklisted, capacity_mw, technology, contracted_capacity_mw, psa_tariff, supply_criteria,
        organization_details, regulatory_approvals, bank_details, is_penny_drop_verified, invoice_template_json, status,
        logo_url, corporate_email, corporate_phone, corporate_website, tan_no, signatory_name, signatory_designation,
        address, bank_name, account_no, ifsc_code, branch_address
      )
      VALUES (
        @id, @parent_entity_id, @entity_type, @category, @name, @pan_no, @gst_no, @cin, @credit_rating,
        0, @capacity_mw, @technology, @contracted_capacity_mw, @psa_tariff, @supply_criteria,
        @organization_details, @regulatory_approvals, @bank_details, 0, @invoice_template_json, 'PENDING',
        @logo_url, @corporate_email, @corporate_phone, @corporate_website, @tan_no, @signatory_name, @signatory_designation,
        @address, @bank_name, @account_no, @ifsc_code, @branch_address
      )
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
      regulatory_approvals: 'Checklist pending',
      bank_details: body.bank_details ?? null,
      invoice_template_json: body.invoice_template_json ?? null,
      logo_url: body.logo_url ?? null,
      corporate_email: body.corporate_email ?? null,
      corporate_phone: body.corporate_phone ?? null,
      corporate_website: body.corporate_website ?? null,
      tan_no: body.tan_no ?? null,
      signatory_name: body.signatory_name ?? null,
      signatory_designation: body.signatory_designation ?? null,
      address: body.address ?? null,
      bank_name: body.bank_name ?? null,
      account_no: body.account_no ?? null,
      ifsc_code: body.ifsc_code ?? null,
      branch_address: body.branch_address ?? null,
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
        if (!d.url) continue;
        insertDoc.run(newId('DOC'), id, d.doc_type, d.url, d.validity_end || null);
      }
    }

    seedRegulatoryChecklist(id, body.entity_type);

    // Optional initial status hints from create form (e.g. mark N/A)
    if (Array.isArray(body.regulatory_checklist_init)) {
      const upd = db.prepare(`
        UPDATE entity_regulatory_approvals
        SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
        WHERE entity_id = ? AND approval_code = ?
      `);
      for (const item of body.regulatory_checklist_init) {
        if (!item.approval_code || !APPROVAL_STATUSES.includes(item.status)) continue;
        upd.run(item.status, item.notes || null, id, item.approval_code);
      }
      refreshRegulatorySummary(id);
    }
  })();

  logAudit({ req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'entity', entityId: id, details: { name: body.name } });
  pushNotification({ role: 'SJVN_ADMIN', type: 'ONBOARDING', message: `New ${body.entity_type} onboarding request: ${body.name}` });
  res.status(201).json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(id)));
});

router.put('/:id', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const existing = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entity not found' });

  const fields = [
    'category', 'name', 'pan_no', 'gst_no', 'cin', 'credit_rating', 'capacity_mw', 'technology',
    'contracted_capacity_mw', 'psa_tariff', 'supply_criteria', 'organization_details', 'bank_details',
    'invoice_template_json', 'logo_url', 'corporate_email', 'corporate_phone', 'corporate_website',
    'tan_no', 'signatory_name', 'signatory_designation', 'address',
    'bank_name', 'account_no', 'ifsc_code', 'branch_address',
  ];

  const updates = {};
  let isHighRisk = false;

  for (const f of fields) {
    if (req.body[f] !== undefined && String(req.body[f]) !== String(existing[f])) {
      if (['bank_details', 'bank_name', 'account_no', 'ifsc_code', 'pan_no', 'gst_no', 'capacity_mw', 'psa_tariff'].includes(f)) {
        isHighRisk = true;
      }
      db.prepare(`INSERT INTO entity_audit (id, entity_id, field_changed, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newId('EAU'), existing.id, f, String(existing[f] ?? ''), String(req.body[f] ?? ''), req.user.name);
      updates[f] = req.body[f];
    }
  }

  const merged = { ...existing, ...updates };
  if (isHighRisk && (updates.bank_details || updates.account_no || updates.ifsc_code)) {
    merged.is_penny_drop_verified = 0;
  }

  db.prepare(`
    UPDATE entities SET category=@category, name=@name, pan_no=@pan_no, gst_no=@gst_no, cin=@cin, credit_rating=@credit_rating,
      capacity_mw=@capacity_mw, technology=@technology, contracted_capacity_mw=@contracted_capacity_mw, psa_tariff=@psa_tariff, supply_criteria=@supply_criteria,
      organization_details=@organization_details,
      bank_details=@bank_details, is_penny_drop_verified=@is_penny_drop_verified,
      invoice_template_json=@invoice_template_json,
      logo_url=@logo_url, corporate_email=@corporate_email, corporate_phone=@corporate_phone, corporate_website=@corporate_website, tan_no=@tan_no,
      signatory_name=@signatory_name, signatory_designation=@signatory_designation,
      address=@address, bank_name=@bank_name, account_no=@account_no, ifsc_code=@ifsc_code, branch_address=@branch_address,
      updated_at=datetime('now')
    WHERE id=@id
  `).run(merged);

  logAudit({ req, user: req.user, action: 'UPDATE', module: 'REIA', entityType: 'entity', entityId: existing.id, details: { highRisk: isHighRisk } });
  if (isHighRisk) {
    pushNotification({ role: 'SJVN_ADMIN', type: 'RISK_UPDATE', message: `High-risk profile update by ${existing.name}. Penny-drop reset.` });
  }

  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id)));
});

router.put('/:id/regulatory-approvals/:approvalId', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  const row = db.prepare('SELECT * FROM entity_regulatory_approvals WHERE id = ? AND entity_id = ?')
    .get(req.params.approvalId, entity.id);
  if (!row) return res.status(404).json({ error: 'Approval item not found' });

  const b = req.body || {};
  const status = b.status || row.status;
  if (!APPROVAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${APPROVAL_STATUSES.join(', ')}` });
  }

  const canVerify = ROLE_GROUPS.REIA_WRITE.includes(req.user.role);
  if (status === 'VERIFIED' && !canVerify) {
    return res.status(403).json({ error: 'Only SJVN/REIA roles can mark an approval as VERIFIED' });
  }
  if (status === 'NOT_APPLICABLE' && row.is_mandatory && !(b.notes || row.notes)) {
    return res.status(400).json({ error: 'Notes required when marking a mandatory item as Not Applicable' });
  }

  const verified_by = status === 'VERIFIED' ? (req.user.name || req.user.id) : (status === row.status ? row.verified_by : null);
  const verified_at = status === 'VERIFIED'
    ? (row.status === 'VERIFIED' ? row.verified_at : new Date().toISOString())
    : null;

  db.prepare(`
    UPDATE entity_regulatory_approvals SET
      status = ?, reference_no = ?, issued_by = ?, issued_on = ?, valid_until = ?,
      notes = ?, document_id = ?, verified_by = ?, verified_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status,
    b.reference_no !== undefined ? b.reference_no : row.reference_no,
    b.issued_by !== undefined ? b.issued_by : row.issued_by,
    b.issued_on !== undefined ? b.issued_on : row.issued_on,
    b.valid_until !== undefined ? b.valid_until : row.valid_until,
    b.notes !== undefined ? b.notes : row.notes,
    b.document_id !== undefined ? b.document_id : row.document_id,
    verified_by,
    verified_at,
    row.id,
  );

  const { rows, summary } = refreshRegulatorySummary(entity.id);
  logAudit({
    req, user: req.user, action: 'UPDATE', module: 'REIA',
    entityType: 'entity_regulatory_approval', entityId: row.id,
    details: { entity_id: entity.id, approval_code: row.approval_code, status },
  });

  res.json({
    item: db.prepare('SELECT * FROM entity_regulatory_approvals WHERE id = ?').get(row.id),
    checklist: rows,
    summary,
  });
});

router.post('/:id/penny-drop', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  db.prepare(`UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?`).run(entity.id);
  logAudit({ req, user: req.user, action: 'PENNY_DROP_VERIFIED', module: 'REIA', entityType: 'entity', entityId: entity.id });
  res.json({ success: true, message: 'Bank account verified via penny drop' });
});

router.post('/:id/approve', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const { decision, remarks } = req.body;
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });

  if (decision === 'APPROVED') {
    seedRegulatoryChecklist(entity.id, entity.entity_type);
    const { summary } = refreshRegulatorySummary(entity.id);
    if (!summary.ready_for_approval) {
      return res.status(400).json({
        error: `Cannot approve: mandatory regulatory items pending — ${summary.blocking.join(', ')}`,
        regulatory_summary: summary,
      });
    }
    if (!entity.is_penny_drop_verified) {
      return res.status(400).json({ error: 'Cannot approve: bank penny-drop verification is required' });
    }
  }

  if (decision === 'REJECTED' && !(remarks || '').trim()) {
    return res.status(400).json({ error: 'Remarks are required for rejection' });
  }

  db.prepare(`UPDATE entities SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(decision, req.params.id);
  logAudit({ req, user: req.user, action: `ENTITY_${decision}`, module: 'REIA', entityType: 'entity', entityId: entity.id, details: { remarks } });
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

  res.json({ success: true, signature_url: signatureUrl });
});

export default router;
