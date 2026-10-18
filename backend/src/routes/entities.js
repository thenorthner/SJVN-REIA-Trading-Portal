import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { newId, logAudit, pushNotification, invalidDecision } from '../util.js';
import {
  catalogForEntityType,
  summarizeApprovals,
  APPROVAL_STATUSES,
  getRegulatoryLabel,
} from '../regulatoryApprovals.js';
import { seedEntityAliases, resolveEntityByName, addAlias } from '../services/entityResolver.js';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { entityVisibleTo, isCounterparty } from '../services/counterpartyScope.js';
import { clearancesExpiring } from '../services/clearanceExpiry.js';
import { normaliseKycBody, validateKyc } from '../services/kycValidation.js';

// Onboarding belongs to every vertical that bills a counterparty, not to REIA
// alone: a hydro station's beneficiaries and a thermal station's are onboarded
// by the Commercial desk, on the same record and under the same checks.
const ENTITY_WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE])];

/**
 * The verticals a desk works in. A desk officer onboards and lists only its own
 * vertical's stakeholders; administrators across SJVN see all three.
 */
function deskVerticals(user) {
  const role = user?.role;
  if (['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'MANAGEMENT', 'FINANCE_USER', 'COMPLIANCE_AUDITOR'].includes(role)) return null;
  if (['THERMAL_ADMIN', 'THERMAL_USER'].includes(role)) return ['THERMAL'];
  if (['COMMERCIAL_ADMIN', 'COMMERCIAL', 'COMMERCIAL_USER'].includes(role)) return ['HYDRO'];
  if (['REIA_ADMIN', 'REIA_USER'].includes(role)) return ['REIA'];
  return null;
}
// Barring a counterparty is an administrator's decision, not a desk officer's.
const BLACKLIST_ROLES = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'];
const VERTICALS = ['REIA', 'HYDRO', 'THERMAL'];
const VERTICAL_LABELS = { REIA: 'REIA', HYDRO: 'Hydro Billing', THERMAL: 'Thermal Billing' };

const verticalsOf = (entity) => String(entity?.verticals || 'REIA').split(',').map((v) => v.trim()).filter(Boolean);

/**
 * Why this desk may not act on this stakeholder, or null. Onboarding decisions
 * belong to the stakeholder's own vertical: the Hydro desk approved a REIA-only
 * developer (17-Oct-2026 audit). Administrators across SJVN act on all.
 */
function outsideDesk(user, entity) {
  const own = deskVerticals(user);
  if (!own) return null;
  const theirs = verticalsOf(entity);
  if (theirs.some((v) => own.includes(v))) return null;
  return `${entity.name} is a ${theirs.map((v) => VERTICAL_LABELS[v] || v).join(' / ')} stakeholder; your desk acts on ${own.map((v) => VERTICAL_LABELS[v]).join(', ')} stakeholders only.`;
}

/**
 * Whether the bank proof on file proves the account being made live: it must
 * be VERIFIED, and — where a change of account is staged — verified after the
 * change was asked for, or it is the proof of the old account. A staged
 * account used to go live on the desk's click with the proof NOT_STARTED.
 */
function bankProofProblem(entity) {
  const proof = db.prepare(`SELECT * FROM entity_regulatory_approvals WHERE entity_id = ? AND approval_code = 'BANK_ACCOUNT_PROOF'`).get(entity.id);
  if (!proof || proof.status !== 'VERIFIED') {
    return 'Verify the bank proof (cancelled cheque or bank letter) on the regulatory checklist first; the account is checked against it.';
  }
  if (entity.pending_bank_json && entity.pending_bank_requested_at && String(proof.verified_at || '').replace(' ', 'T') < String(entity.pending_bank_requested_at).replace(' ', 'T')) {
    return `The bank proof was verified before the change of account was asked for (${entity.pending_bank_requested_at}), so it proves the old account. Verify the proof of the new account first.`;
  }
  return null;
}

/**
 * PAN and GSTIN each identify one legal entity, so neither may sit on two
 * records. Compared trimmed and case-insensitively; `exceptId` is the record
 * being edited.
 */
function findDuplicate(body, exceptId = null) {
  for (const [field, label] of [['pan_no', 'PAN'], ['gst_no', 'GST']]) {
    const value = body[field] && String(body[field]).trim().toUpperCase();
    if (!value) continue;
    const clash = db.prepare(`SELECT id, name, verticals FROM entities WHERE UPPER(TRIM(${field})) = ? AND id != ?`)
      .get(value, exceptId ?? '');
    if (clash) return { field, label, value, clash };
  }
  return null;
}

/**
 * The account a counterparty asked to be paid into becomes the live one only
 * here, when an officer has checked it against the bank proof on file.
 */
function promotePendingBank(entity) {
  if (!entity.pending_bank_json) return null;
  let staged = {};
  try { staged = JSON.parse(entity.pending_bank_json) || {}; } catch { staged = {}; }
  const allowed = ['bank_name', 'account_no', 'ifsc_code', 'branch_address', 'bank_details'];
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(staged)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k} = ?`);
    params.push(v);
  }
  let promoted = null;
  if (sets.length) {
    promoted = { from: Object.fromEntries(Object.keys(staged).map((k) => [k, entity[k]])), to: staged };
    db.prepare(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`).run(...params, entity.id);
  }
  db.prepare(`
    UPDATE entities SET pending_bank_json = NULL, pending_bank_requested_by = NULL, pending_bank_requested_at = NULL
    WHERE id = ?
  `).run(entity.id);
  return promoted;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

// A logo or a signature is a small image. Without a cap, one authenticated
// user can stream a file of any size into uploads/ until the disk is full,
// and a full disk stops SQLite from writing — that is, it stops the platform.
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

// Seed the ledger's known counterparty aliases (GACL's four spellings, NTPCREL)
// so name resolution works out of the box.
seedEntityAliases();

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

// The kinds of contact a counterparty can record. Kept here as well as on the
// table so an unknown one is refused with a message naming the choices, rather
// than reaching the CHECK constraint and coming back as a 500 that says only
// that something failed.
const CONTACT_TYPES = ['COMMERCIAL', 'TECHNICAL', 'DISPUTE', 'EMERGENCY', 'AUTHORIZED_SIGNATORY', 'FINANCE', 'GRIEVANCE'];

function invalidContact(c) {
  if (!c?.contact_type) return 'each contact needs a contact_type';
  if (!CONTACT_TYPES.includes(c.contact_type)) {
    return `"${c.contact_type}" is not a contact type. Use one of: ${CONTACT_TYPES.join(', ')}`;
  }
  const name = String(c?.name ?? '').trim();
  if (!name) return `contact ${c.contact_type} needs a name`;
  const email = String(c?.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `"${email}" is not a valid email address`;
  return null;
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

// Resolve any spelling to its canonical entity: /api/entities/resolve?name=...
// Declared before '/:id' so the literal path is not swallowed as an id.
router.get('/resolve', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const entityId = resolveEntityByName(name);
  if (!entityId) return res.json({ resolved: false, entity: null });
  const entity = db.prepare('SELECT id, name, entity_type, pan_no FROM entities WHERE id = ?').get(entityId);
  res.json({ resolved: true, entity });
});

router.get('/', (req, res) => {
  const { entity_type, status, parent_entity_id, vertical } = req.query;
  let sql = 'SELECT * FROM entities WHERE 1=1';
  const params = [];
  // The contract and invoice lists have always scoped to the caller's own
  // entity; this one did not, so any counterparty login could read the whole
  // register — every other party's PAN, GST and bank details included.
  if (isCounterparty(req.user)) {
    sql += ' AND id = ?';
    params.push(req.user.linked_entity_id ?? '');
  }
  if (entity_type) { sql += ' AND entity_type = ?'; params.push(entity_type); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  const own = deskVerticals(req.user);
  if (own && !isCounterparty(req.user)) {
    // A desk sees its own vertical's register, whatever it asks for.
    if (vertical && !own.includes(vertical)) return res.json([]);
    sql += ` AND (${own.map(() => `(',' || COALESCE(verticals, 'REIA') || ',') LIKE ?`).join(' OR ')})`;
    params.push(...own.map((v) => `%,${v},%`));
  }
  if (vertical) {
    if (!VERTICALS.includes(vertical)) return res.status(400).json({ error: `vertical must be one of: ${VERTICALS.join(', ')}` });
    sql += ` AND (',' || COALESCE(verticals, 'REIA') || ',') LIKE ?`;
    params.push(`%,${vertical},%`);
  }
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
  // A counterparty reads its own record only. This payload carries PAN, GST,
  // bank details and the regulatory file — none of it another party's business.
  if (!entityVisibleTo(req.user, entity.id)) return res.status(404).json({ error: 'Entity not found' });
  const history = db.prepare('SELECT * FROM entity_audit WHERE entity_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...fetchEntityRelations(entity), history });
});

router.post('/', requireRole(...ENTITY_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const id = newId('ENT');
  const body = normaliseKycBody(req.body || {});
  if (!body.entity_type || !body.name || !body.category) {
    return res.status(400).json({ error: 'entity_type, name and category are required' });
  }
  if (!['SELLER', 'BUYER'].includes(body.entity_type)) {
    return res.status(400).json({ error: 'entity_type must be SELLER or BUYER' });
  }
  // A seller or buyer login may put forward another company only as its own
  // group company (an SPV), recorded as an onboarding request under its own
  // record for the desk to decide (decided 17-Oct-2026). It created a company
  // no-one was linked to, of either side.
  if (isCounterparty(req.user)) {
    const mine = req.user.linked_entity_id ? db.prepare('SELECT id, entity_type, name FROM entities WHERE id = ?').get(req.user.linked_entity_id) : null;
    if (!mine) return res.status(403).json({ error: 'Your login is not linked to a company, so it cannot put forward another. Ask SJVN to onboard it.' });
    if (body.entity_type !== mine.entity_type) return res.status(403).json({ error: `${mine.name} is a ${mine.entity_type.toLowerCase()}; it can put forward only its own group companies of the same kind.` });
    if (body.parent_entity_id && body.parent_entity_id !== mine.id) return res.status(403).json({ error: 'A group company is put forward under your own company.' });
    body.parent_entity_id = mine.id;
    body.requested_by_user_id = req.user.id;
  }
  const own = deskVerticals(req.user);
  const vertical = body.vertical || (own ? own[0] : 'REIA');
  if (!VERTICALS.includes(vertical)) {
    return res.status(400).json({ error: `vertical must be one of: ${VERTICALS.join(', ')}` });
  }
  if (own && !own.includes(vertical)) {
    return res.status(403).json({ error: `Your desk onboards ${own.map((v) => VERTICAL_LABELS[v]).join(', ')} stakeholders only.` });
  }

  // What a counterparty of this kind has to bring. Only name, type and category
  // were ever required, so a generator could be onboarded with no PAN, no GST
  // and no stated capacity — and the record it left could not be invoiced,
  // reconciled against a GST return, or checked for plausible output. The two
  // sides genuinely differ: a generator is defined by what it can produce, a
  // DISCOM by what it has contracted to take.
  const REQUIRED = {
    common: [['pan_no', 'PAN'], ['gst_no', 'GST number']],
    SELLER: [['capacity_mw', 'generation capacity (MW)']],
    BUYER: [['contracted_capacity_mw', 'contracted capacity (MW)']],
  };
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  const missing = [...REQUIRED.common, ...(REQUIRED[body.entity_type] ?? [])]
    .filter(([field]) => blank(body[field]))
    .map(([field, label]) => ({ field, label }));

  // Reported together. One at a time means submitting, being told about PAN,
  // fixing it, submitting again and being told about GST.
  if (missing.length) {
    return res.status(400).json({
      error: `A ${body.entity_type} needs ${missing.map((m) => m.label).join(', ')}.`,
      missing_fields: missing.map((m) => m.field),
    });
  }

  // Format and cross-checks on every identifier, reported together.
  const invalid = validateKyc(body);
  if (invalid.length) {
    return res.status(400).json({
      error: invalid.map((e) => e.message).join(' '),
      field_errors: invalid,
    });
  }

  // A PAN or GST identifies one legal entity. Onboarding the same one twice
  // splits its contracts, exposure and payment history across two records that
  // nothing later reconciles, so it is refused rather than quietly created.
  // A clearance waived at onboarding carries its reason; the desk's own form
  // only, and a short or missing one is refused rather than dropped.
  if (Array.isArray(body.regulatory_checklist_init) && !isCounterparty(req.user)) {
    const thin = body.regulatory_checklist_init.find((i) => i?.status === 'NOT_APPLICABLE' && String(i.notes || '').trim().length < 10);
    if (thin) return res.status(400).json({ error: `Say why ${thin.approval_code.replace(/_/g, ' ').toLowerCase()} does not apply (at least 10 characters).` });
  }
  const dup = findDuplicate(body);
  if (dup) {
    const inVertical = verticalsOf(dup.clash).includes(vertical);
    return res.status(409).json({
      error: `${dup.label} ${dup.value} is already onboarded as "${dup.clash.name}".`
        + (inVertical ? '' : ` It is registered under ${verticalsOf(dup.clash).map((v) => VERTICAL_LABELS[v] || v).join(', ')} — link that record to ${VERTICAL_LABELS[vertical]} instead of creating it again.`),
      field_errors: [{ field: dup.field, message: `${dup.label} ${dup.value} is already onboarded as "${dup.clash.name}".` }],
      duplicate_of: { id: dup.clash.id, name: dup.clash.name, field: dup.field, verticals: verticalsOf(dup.clash), can_link: !inVertical },
    });
  }

  // Checked before the transaction opens: throwing inside it escapes to the
  // default error handler and returns a 500, which is the shape this was in.
  if (Array.isArray(body.contacts)) {
    for (const c of body.contacts) {
      const bad = invalidContact(c);
      if (bad) return res.status(400).json({ error: bad });
    }
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO entities (
        id, parent_entity_id, entity_type, category, name, pan_no, gst_no, cin, credit_rating,
        is_blacklisted, capacity_mw, technology, contracted_capacity_mw, psa_tariff, supply_criteria,
        organization_details, regulatory_approvals, bank_details, is_penny_drop_verified, invoice_template_json, status,
        logo_url, corporate_email, corporate_phone, corporate_website, tan_no, signatory_name, signatory_designation,
        address, bank_name, account_no, ifsc_code, branch_address, verticals, requested_by_user_id
      )
      VALUES (
        @id, @parent_entity_id, @entity_type, @category, @name, @pan_no, @gst_no, @cin, @credit_rating,
        0, @capacity_mw, @technology, @contracted_capacity_mw, @psa_tariff, @supply_criteria,
        @organization_details, @regulatory_approvals, @bank_details, 0, @invoice_template_json, 'PENDING',
        @logo_url, @corporate_email, @corporate_phone, @corporate_website, @tan_no, @signatory_name, @signatory_designation,
        @address, @bank_name, @account_no, @ifsc_code, @branch_address, @verticals, @requested_by_user_id
      )
    `).run({
      id,
      requested_by_user_id: body.requested_by_user_id ?? null,
      verticals: vertical,
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

    // Optional initial hints from the desk's create form: an item marked N/A
    // with its reason. Nothing more — this set any item to any status, so a
    // seller created a company with all eight clearances VERIFIED.
    if (Array.isArray(body.regulatory_checklist_init) && !isCounterparty(req.user)) {
      const upd = db.prepare(`
        UPDATE entity_regulatory_approvals
        SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now')
        WHERE entity_id = ? AND approval_code = ?
      `);
      for (const item of body.regulatory_checklist_init) {
        if (!item.approval_code || item.status !== 'NOT_APPLICABLE' || String(item.notes || '').trim().length < 10) continue;
        upd.run(item.status, String(item.notes).trim(), id, item.approval_code);
      }
      refreshRegulatorySummary(id);
    }
  })();

  logAudit({ req, user: req.user, action: 'CREATE', module: 'REIA', entityType: 'entity', entityId: id, details: { name: body.name } });
  pushNotification({ role: 'SJVN_ADMIN', type: 'ONBOARDING', message: `New ${body.entity_type} onboarding request: ${body.name}` });
  res.status(201).json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(id)));
});

router.put('/:id', requireRole(...ENTITY_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  req.body = normaliseKycBody(req.body || {});
  const existing = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  // A counterparty edits its own record only. This let any seller rename another
  // company, change the contacts its invoices are mailed to, or stage a change
  // to its bank account.
  if (!existing || !entityVisibleTo(req.user, existing.id)) return res.status(404).json({ error: 'Entity not found' });
  // A desk edits its own vertical's stakeholders: the Hydro desk renamed a REIA
  // developer (Hydro QA run 15).
  const outsideEdit = outsideDesk(req.user, existing);
  if (outsideEdit) return res.status(403).json({ error: outsideEdit });

  const fields = [
    'category', 'name', 'pan_no', 'gst_no', 'cin', 'credit_rating', 'capacity_mw', 'technology',
    'contracted_capacity_mw', 'psa_tariff', 'supply_criteria', 'organization_details', 'bank_details',
    'invoice_template_json', 'logo_url', 'corporate_email', 'corporate_phone', 'corporate_website',
    'tan_no', 'signatory_name', 'signatory_designation', 'address',
    'bank_name', 'account_no', 'ifsc_code', 'branch_address',
  ];

  // Where the money actually goes. These are held back rather than written, and
  // the live columns keep paying the account that was verified until the new
  // one is checked against its bank proof and the record is re-approved.
  const BANK_FIELDS = ['bank_name', 'account_no', 'ifsc_code', 'branch_address', 'bank_details'];

  // Only what is actually being changed is checked, so a record that predates
  // these rules can still have its address corrected without first being made
  // to repair an old PAN.
  const changing = {};
  for (const f of fields) {
    if (req.body[f] !== undefined && String(req.body[f]) !== String(existing[f])) changing[f] = req.body[f];
  }
  const invalid = validateKyc(changing, existing);
  if (invalid.length) {
    return res.status(400).json({ error: invalid.map((e) => e.message).join(' '), field_errors: invalid });
  }
  const dup = findDuplicate(changing, existing.id);
  if (dup) {
    return res.status(409).json({
      error: `${dup.label} ${dup.value} is already onboarded as "${dup.clash.name}".`,
      field_errors: [{ field: dup.field, message: `${dup.label} ${dup.value} is already onboarded as "${dup.clash.name}".` }],
      duplicate_of: { id: dup.clash.id, name: dup.clash.name, field: dup.field },
    });
  }

  const updates = {};
  const stagedBank = {};
  let isHighRisk = false;

  for (const f of fields) {
    if (req.body[f] !== undefined && String(req.body[f]) !== String(existing[f])) {
      if (['bank_details', 'bank_name', 'account_no', 'ifsc_code', 'pan_no', 'gst_no', 'capacity_mw', 'psa_tariff'].includes(f)) {
        isHighRisk = true;
      }
      db.prepare(`INSERT INTO entity_audit (id, entity_id, field_changed, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newId('EAU'), existing.id, f, String(existing[f] ?? ''), String(req.body[f] ?? ''), req.user.name);
      if (BANK_FIELDS.includes(f)) stagedBank[f] = req.body[f];
      else updates[f] = req.body[f];
    }
  }

  const bankChangeRequested = Object.keys(stagedBank).length > 0;
  if (bankChangeRequested) {
    db.prepare(`
      UPDATE entities SET pending_bank_json = ?, pending_bank_requested_by = ?, pending_bank_requested_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(stagedBank), req.user.name, existing.id);
  }

  // Contacts could only be set when the entity was first created, so a
  // counterparty that changed its billing desk could not be updated at all —
  // and the commercial contact is the address invoices are sent to, which made
  // it a field the platform could not correct once it was wrong.
  const contactsGiven = Array.isArray(req.body.contacts);
  let contactsChanged = false;
  if (contactsGiven) {
    const cleaned = [];
    for (const c of req.body.contacts) {
      const email = String(c?.email ?? '').trim();
      // A malformed address does not fail loudly at this point — it fails much
      // later, as a bill that was never delivered to a counterparty who is then
      // late paying it.
      const bad = invalidContact(c);
      if (bad) return res.status(400).json({ error: bad });
      const name = String(c.name).trim();
      cleaned.push({
        contact_type: c.contact_type, name, email: email || null,
        phone: c.phone ?? null, is_primary: c.is_primary ? 1 : 0,
      });
    }
    const prior = db.prepare('SELECT contact_type, name, email, phone, is_primary FROM entity_contacts WHERE entity_id = ? ORDER BY contact_type, email').all(existing.id);
    const key = (list) => JSON.stringify([...list].sort((a, b) => `${a.contact_type}${a.email}`.localeCompare(`${b.contact_type}${b.email}`)));
    contactsChanged = key(prior) !== key(cleaned);

    if (contactsChanged) {
      db.prepare(`INSERT INTO entity_audit (id, entity_id, field_changed, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newId('EAU'), existing.id, 'contacts',
          prior.map((c) => `${c.contact_type}:${c.email ?? ''}`).join(', '),
          cleaned.map((c) => `${c.contact_type}:${c.email ?? ''}`).join(', '),
          req.user.name);
      db.transaction(() => {
        db.prepare('DELETE FROM entity_contacts WHERE entity_id = ?').run(existing.id);
        const ins = db.prepare('INSERT INTO entity_contacts (id, entity_id, contact_type, name, email, phone, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const c of cleaned) ins.run(newId('CNT'), existing.id, c.contact_type, c.name, c.email, c.phone, c.is_primary);
      })();
    }
  }

  const merged = { ...existing, ...updates };
  // An approved counterparty is already trading, so a change to it does not go
  // live on the strength of one person's edit — it drops the record back to
  // PENDING and is re-approved. A record still pending stays pending.
  //
  // Redirecting where invoices are sent counts, which is why a contact change
  // is treated the same as the fields above rather than slipping through as
  // incidental detail.
  if (existing.status === 'APPROVED' && (Object.keys(updates).length || contactsChanged || bankChangeRequested)) {
    merged.status = 'PENDING';
  }

  // Deliberately not clearing is_penny_drop_verified (the "bank verified" flag)
  // here. The live account is unchanged and still verified; the unverified one
  // is the proposal sitting in pending_bank_json, and that is what has to be
  // verified before it can be paid into.

  db.prepare(`
    UPDATE entities SET category=@category, name=@name, pan_no=@pan_no, gst_no=@gst_no, cin=@cin, credit_rating=@credit_rating,
      capacity_mw=@capacity_mw, technology=@technology, contracted_capacity_mw=@contracted_capacity_mw, psa_tariff=@psa_tariff, supply_criteria=@supply_criteria,
      organization_details=@organization_details,
      bank_details=@bank_details, is_penny_drop_verified=@is_penny_drop_verified,
      invoice_template_json=@invoice_template_json,
      logo_url=@logo_url, corporate_email=@corporate_email, corporate_phone=@corporate_phone, corporate_website=@corporate_website, tan_no=@tan_no,
      signatory_name=@signatory_name, signatory_designation=@signatory_designation,
      address=@address, bank_name=@bank_name, account_no=@account_no, ifsc_code=@ifsc_code, branch_address=@branch_address,
      status=@status,
      updated_at=datetime('now')
    WHERE id=@id
  `).run(merged);

  logAudit({
    req, user: req.user, action: bankChangeRequested ? 'BANK_CHANGE_REQUESTED' : 'UPDATE',
    module: 'REIA', entityType: 'entity', entityId: existing.id,
    details: { highRisk: isHighRisk, contacts_changed: contactsChanged, pending_bank: bankChangeRequested ? stagedBank : undefined },
  });
  if (bankChangeRequested) {
    pushNotification({
      role: 'SJVN_ADMIN', type: 'BANK_CHANGE_REQUESTED',
      message: `${existing.name} has requested a change of bank account. It is held until verified against the bank proof and re-approved.`,
    });
  }
  if (isHighRisk) {
    pushNotification({ role: 'SJVN_ADMIN', type: 'RISK_UPDATE', message: `High-risk profile update by ${existing.name}. Re-approval required.` });
  }

  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id)));
});

router.put('/:id/regulatory-approvals/:approvalId', requireRole(...ENTITY_WRITE, 'SELLER', 'BUYER'), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity || !entityVisibleTo(req.user, entity.id)) return res.status(404).json({ error: 'Entity not found' });

  const row = db.prepare('SELECT * FROM entity_regulatory_approvals WHERE id = ? AND entity_id = ?')
    .get(req.params.approvalId, entity.id);
  if (!row) return res.status(404).json({ error: 'Approval item not found' });

  const b = req.body || {};
  const status = b.status || row.status;
  if (!APPROVAL_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${APPROVAL_STATUSES.join(', ')}` });
  }

  const desk = ENTITY_WRITE.includes(req.user.role) && !isCounterparty(req.user);
  if (desk) {
    const outside = outsideDesk(req.user, entity);
    if (outside) return res.status(403).json({ error: outside });
  }
  // A counterparty submits its evidence; deciding on it is SJVN's. It could set
  // anything but VERIFIED — and NOT_APPLICABLE, which counts as cleared, let it
  // waive its own mandatory items.
  if (!desk && !['SUBMITTED', row.status].includes(status)) {
    return res.status(403).json({ error: `Only SJVN can mark a clearance ${status.replace(/_/g, ' ').toLowerCase()}; submit the evidence and the desk decides.` });
  }
  if (!desk && row.status === 'VERIFIED') {
    return res.status(403).json({ error: `${row.label} has been verified by SJVN. Ask the desk to reopen it if something on it has changed.` });
  }
  const notes = b.notes !== undefined ? b.notes : row.notes;
  if (status === 'NOT_APPLICABLE' && row.is_mandatory && String(notes || '').trim().length < 10) {
    return res.status(400).json({ error: 'Say why a mandatory clearance does not apply (at least 10 characters) — it is what the audit trail shows.' });
  }
  // The evidence a verification rests on. Changing any of it on a VERIFIED item
  // used to leave it verified; now it goes back for checking unless the desk
  // verifies it again in the same step.
  const EVIDENCE = ['reference_no', 'issued_by', 'issued_on', 'valid_until', 'document_id'];
  const evidenceChanged = EVIDENCE.some((f) => b[f] !== undefined && String(b[f] ?? '') !== String(row[f] ?? ''));
  let finalStatus = status;
  if (row.status === 'VERIFIED' && status === 'VERIFIED' && evidenceChanged && b.status !== 'VERIFIED') finalStatus = 'SUBMITTED';
  if (finalStatus === 'VERIFIED') {
    const validUntil = b.valid_until !== undefined ? b.valid_until : row.valid_until;
    if (validUntil && String(validUntil) < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: `${row.label} lapsed on ${validUntil}; it cannot be verified as it stands.` });
    }
    const documentId = b.document_id !== undefined ? b.document_id : row.document_id;
    const reference = b.reference_no !== undefined ? b.reference_no : row.reference_no;
    if (!documentId && !String(reference || '').trim()) {
      return res.status(400).json({ error: `Verify ${row.label} against something: attach the scanned document or record its reference number.` });
    }
  }
  const reverify = finalStatus === 'VERIFIED' && (row.status !== 'VERIFIED' || evidenceChanged);
  const verified_by = finalStatus === 'VERIFIED' ? (reverify ? (req.user.name || req.user.id) : row.verified_by) : null;
  const verified_at = finalStatus === 'VERIFIED' ? (reverify ? new Date().toISOString() : row.verified_at) : null;

  db.prepare(`
    UPDATE entity_regulatory_approvals SET
      status = ?, reference_no = ?, issued_by = ?, issued_on = ?, valid_until = ?,
      notes = ?, document_id = ?, verified_by = ?, verified_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    finalStatus,
    b.reference_no !== undefined ? b.reference_no : row.reference_no,
    b.issued_by !== undefined ? b.issued_by : row.issued_by,
    b.issued_on !== undefined ? b.issued_on : row.issued_on,
    b.valid_until !== undefined ? b.valid_until : row.valid_until,
    notes,
    b.document_id !== undefined ? b.document_id : row.document_id,
    verified_by,
    verified_at,
    row.id,
  );

  const { rows, summary } = refreshRegulatorySummary(entity.id);
  logAudit({
    req, user: req.user, action: 'UPDATE', module: 'REIA',
    entityType: 'entity_regulatory_approval', entityId: row.id,
    details: { entity_id: entity.id, approval_code: row.approval_code, status: finalStatus, from: row.status, evidence_changed: evidenceChanged || undefined },
  });

  res.json({
    item: db.prepare('SELECT * FROM entity_regulatory_approvals WHERE id = ?').get(row.id),
    checklist: rows,
    summary,
  });
});

// Confirms the bank account on record against the proof on file (the cancelled
// cheque). No money is sent: there is no penny-drop integration, and the screen
// used to offer a "₹1 penny drop" button that only set a flag. '/penny-drop' is
// kept as an alias for callers that still use the old path.
router.post(['/:id/verify-bank', '/:id/penny-drop'], requireRole(...ENTITY_WRITE), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const outside = outsideDesk(req.user, entity);
  if (outside) return res.status(403).json({ error: outside });
  const problem = bankProofProblem(entity);
  if (problem) return res.status(400).json({ error: problem });
  // The person who asked for the change of account does not also make it live.
  if (entity.pending_bank_json && entity.pending_bank_requested_by && entity.pending_bank_requested_by === (req.user.name || req.user.id)) {
    return res.status(403).json({ error: 'You asked for this change of account, so someone else has to verify it.' });
  }

  // K3: a change of account is verified only after a call-back to a known
  // company contact confirmed it, recorded after the change was asked for.
  if (entity.pending_bank_json) {
    const cb = db.prepare(`SELECT * FROM bank_change_callbacks WHERE entity_id = ? AND confirmed = 1 AND COALESCE(change_requested_at, '') = COALESCE(?, '') ORDER BY created_at DESC LIMIT 1`)
      .get(entity.id, entity.pending_bank_requested_at || null);
    if (!cb) {
      return res.status(400).json({ error: 'Record the call-back first: phone a contact already on record for the company, confirm the change of account with them, and record who was called, on which number and when.', needs_callback: true });
    }
  }

  // A requested change of account becomes the live one at this point — not at
  // the edit that requested it. Without this the new details would sit staged
  // forever.
  const promoted = promotePendingBank(entity);

  db.prepare(`UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?`).run(entity.id);
  logAudit({
    req, user: req.user, action: promoted ? 'BANK_CHANGE_VERIFIED' : 'BANK_VERIFIED',
    module: 'REIA', entityType: 'entity', entityId: entity.id,
    beforeValue: promoted ? JSON.stringify(promoted.from) : undefined,
    afterValue: promoted ? JSON.stringify(promoted.to) : undefined,
  });
  res.json({
    success: true,
    message: promoted
      ? 'Bank account verified. The requested account is now the live one.'
      : 'Bank account verified against the proof on file',
    ...(promoted ? { applied_bank_change: promoted } : {}),
  });
});

// Bar a counterparty, or lift the bar. A blacklisted counterparty cannot be
// approved and cannot be given a new contract; what it already holds is left
// alone, because money owed under a live contract is still owed.
// SJVN's own station (NJHPS, RHPS): sells through the platform but is not a
// developer, so developer KYC does not apply. An administrator's call, with
// the reason on record.
router.post('/:id/own-station', requireRole('SJVN_ADMIN', 'IT_SUPER_ADMIN'), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const on = req.body?.is_sjvn_own ? 1 : 0;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 10) return res.status(400).json({ error: 'Say why (at least 10 characters) — it is what the audit trail shows.' });
  if (on && entity.entity_type !== 'SELLER') return res.status(400).json({ error: 'Only a seller can be one of SJVN\'s own stations.' });
  if ((entity.is_sjvn_own ? 1 : 0) === on) return res.status(400).json({ error: `${entity.name} is ${on ? 'already' : 'not'} marked as SJVN's own station.` });
  db.prepare(`UPDATE entities SET is_sjvn_own = ?, updated_at = datetime('now') WHERE id = ?`).run(on, entity.id);
  logAudit({ req, user: req.user, action: on ? 'ENTITY_MARKED_OWN_STATION' : 'ENTITY_UNMARKED_OWN_STATION', module: 'REIA', entityType: 'entity', entityId: entity.id, beforeValue: { is_sjvn_own: entity.is_sjvn_own ? 1 : 0 }, afterValue: { is_sjvn_own: on }, reason });
  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(entity.id)));
});

// K3: record the call-back that confirms (or does not) a change of bank account.
router.post('/:id/bank-callback', requireRole(...ENTITY_WRITE), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  if (!entity.pending_bank_json) return res.status(400).json({ error: `${entity.name} has no change of bank account waiting.` });
  const b = req.body || {};
  const name = String(b.contact_name || '').trim();
  const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
  const phone = digits(b.phone);
  if (!name) return res.status(400).json({ error: 'Name the person called.' });
  if (phone.length < 10) return res.status(400).json({ error: 'Give the number called (10 digits).' });
  const known = [entity.corporate_phone, ...db.prepare('SELECT phone FROM entity_contacts WHERE entity_id = ?').all(entity.id).map((c) => c.phone)].map(digits).filter((p) => p.length === 10);
  if (!known.includes(phone)) {
    return res.status(400).json({ error: 'Call a number already on record for the company (its corporate phone or a listed contact) — not one given with the change of account.', known_numbers: known.length });
  }
  const calledAt = String(b.called_at || '').trim() || new Date().toISOString().slice(0, 16).replace('T', ' ');
  if (b.confirmed === undefined) return res.status(400).json({ error: 'Say whether the contact confirmed the change.' });
  const id = newId('BCB');
  db.prepare(`INSERT INTO bank_change_callbacks (id, entity_id, change_requested_at, contact_name, phone, called_at, confirmed, notes, officer_name, officer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, entity.id, entity.pending_bank_requested_at || null, name, phone, calledAt, b.confirmed ? 1 : 0, String(b.notes || '').slice(0, 500) || null, req.user.name, req.user.id || null);
  logAudit({ req, user: req.user, action: b.confirmed ? 'BANK_CALLBACK_CONFIRMED' : 'BANK_CALLBACK_NOT_CONFIRMED', module: 'REIA', entityType: 'entity', entityId: entity.id, details: { contact_name: name, phone_last4: phone.slice(-4), called_at: calledAt } });
  if (!b.confirmed) {
    for (const role of ['REIA_ADMIN', 'SJVN_ADMIN', 'FINANCE_USER']) pushNotification({ role, type: 'BANK_CHANGE', message: `${entity.name}: the company contact called (${name}) did NOT confirm the requested change of bank account. Do not verify it; treat it as possible fraud.` });
  }
  res.status(201).json(db.prepare('SELECT * FROM bank_change_callbacks WHERE id = ?').get(id));
});
router.get('/:id/bank-callbacks', requireRole(...ENTITY_WRITE), (req, res) => {
  res.json(db.prepare('SELECT * FROM bank_change_callbacks WHERE entity_id = ? ORDER BY created_at DESC').all(req.params.id));
});
// K2: clearances lapsing soon, across counterparties.
router.get('/clearances/expiring', requireRole(...ENTITY_WRITE, ...ROLE_GROUPS.REIA_ALL), (req, res) => {
  res.json(clearancesExpiring(Math.min(365, Math.max(1, Number(req.query.days) || 60))));
});

router.post('/:id/blacklist', requireRole(...BLACKLIST_ROLES), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const outside = outsideDesk(req.user, entity);
  if (outside) return res.status(403).json({ error: outside });
  const blacklisted = req.body?.blacklisted !== false;
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 10) {
    return res.status(400).json({
      error: `A reason of at least 10 characters is required to ${blacklisted ? 'blacklist' : 'clear'} a stakeholder — it is what the audit trail shows.`,
    });
  }
  if (!!entity.is_blacklisted === blacklisted) {
    return res.status(400).json({ error: blacklisted ? `${entity.name} is already blacklisted.` : `${entity.name} is not blacklisted.` });
  }

  db.prepare(`
    UPDATE entities SET is_blacklisted = ?, blacklist_reason = ?, blacklisted_by = ?, blacklisted_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(blacklisted ? 1 : 0, reason, req.user.name || req.user.id, entity.id);
  db.prepare(`INSERT INTO entity_audit (id, entity_id, field_changed, old_value, new_value, changed_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(newId('EAU'), entity.id, 'is_blacklisted', entity.is_blacklisted ? 'BLACKLISTED' : 'CLEAR',
      `${blacklisted ? 'BLACKLISTED' : 'CLEAR'} — ${reason}`, req.user.name || req.user.id);
  logAudit({
    req, user: req.user, action: blacklisted ? 'ENTITY_BLACKLISTED' : 'ENTITY_BLACKLIST_CLEARED',
    module: 'REIA', entityType: 'entity', entityId: entity.id, reason,
    beforeValue: entity.is_blacklisted ? 'BLACKLISTED' : 'CLEAR', afterValue: blacklisted ? 'BLACKLISTED' : 'CLEAR',
  });
  pushNotification({
    role: 'SJVN_ADMIN', type: 'COMPLIANCE_ALERT',
    message: blacklisted
      ? `${entity.name} has been blacklisted by ${req.user.name}: ${reason}`
      : `Blacklist on ${entity.name} cleared by ${req.user.name}: ${reason}`,
  });
  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(entity.id)));
});

// Register an existing counterparty under another vertical. The same DISCOM
// buys under a REIA PSA and draws from a hydro station; it is one legal entity
// with one PAN, so it is linked, not onboarded a second time.
router.post('/:id/verticals', requireRole(...ENTITY_WRITE), (req, res) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const vertical = req.body?.vertical;
  if (!VERTICALS.includes(vertical)) return res.status(400).json({ error: `vertical must be one of: ${VERTICALS.join(', ')}` });
  const own = deskVerticals(req.user);
  if (own && !own.includes(vertical)) {
    return res.status(403).json({ error: `Your desk links stakeholders to ${own.map((v) => VERTICAL_LABELS[v]).join(', ')} only.` });
  }
  const current = verticalsOf(entity);
  if (!current.includes(vertical)) {
    db.prepare(`UPDATE entities SET verticals = ?, updated_at = datetime('now') WHERE id = ?`)
      .run([...current, vertical].join(','), entity.id);
    logAudit({ req, user: req.user, action: 'ENTITY_VERTICAL_LINKED', module: 'REIA', entityType: 'entity', entityId: entity.id, details: { vertical } });
  }
  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(entity.id)));
});

router.post('/:id/approve', requireRole(...ENTITY_WRITE), (req, res) => {
  const { decision, remarks, admin_direct_admit } = req.body;
  // Unvalidated, this wrote `status = decision` — an omitted field tripped the
  // NOT NULL constraint and came back a 500 rather than saying what was wrong.
  const badDecision = invalidDecision(decision);
  if (badDecision) return res.status(400).json({ error: badDecision });
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const outside = outsideDesk(req.user, entity);
  if (outside) return res.status(403).json({ error: outside });
  const directAdmit = !!admin_direct_admit;
  if (directAdmit && !['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Direct admission is for administrators; verify the checklist instead.' });
  }

  if (decision === 'APPROVED') {
    if (entity.is_blacklisted) {
      return res.status(400).json({
        error: `Cannot approve: ${entity.name} is blacklisted${entity.blacklist_reason ? ` (${entity.blacklist_reason})` : ''}. Clear the blacklist first.`,
      });
    }
    seedRegulatoryChecklist(entity.id, entity.entity_type);

    if (directAdmit) {
      // Direct admission clears the rest of the checklist, but not who the
      // company is or where its money goes (decided 17-Oct-2026): the
      // company's registration and its bank proof are verified on their own
      // documents first.
      const core = db.prepare(`
        SELECT approval_code, status FROM entity_regulatory_approvals
        WHERE entity_id = ? AND approval_code IN ('COMPANY_REGISTRATION', 'BANK_ACCOUNT_PROOF')
      `).all(entity.id);
      const unverified = ['COMPANY_REGISTRATION', 'BANK_ACCOUNT_PROOF'].filter((code) => !core.some((c) => c.approval_code === code && c.status === 'VERIFIED'));
      if (unverified.length) {
        return res.status(400).json({
          error: `Direct admission still needs ${unverified.map(getRegulatoryLabel).join(' and ')} verified on the document itself. Verify ${unverified.length === 1 ? 'it' : 'them'} first, then admit.`,
          blocking_items: unverified.map(getRegulatoryLabel),
        });
      }
      db.prepare(`
        UPDATE entity_regulatory_approvals
        SET status = 'VERIFIED', verified_by = ?, verified_at = datetime('now'), notes = COALESCE(notes, 'Admitted & cleared directly by SJVN Admin')
        WHERE entity_id = ? AND is_mandatory = 1 AND status != 'VERIFIED'
      `).run(req.user.name || req.user.username || 'SJVN Admin', entity.id);
    }

    const { summary } = refreshRegulatorySummary(entity.id);
    if (!summary.ready_for_approval) {
      const pendingNames = summary.blocking.map(getRegulatoryLabel);
      return res.status(400).json({
        error: `Cannot approve: mandatory regulatory items pending verification (${pendingNames.join(', ')}). Please verify them or mark N/A.`,
        regulatory_summary: summary,
        blocking_items: pendingNames,
      });
    }
  }

  if (decision === 'REJECTED' && !(remarks || '').trim()) {
    return res.status(400).json({ error: 'Remarks are required for rejection' });
  }

  // Approval is where the bank account is accepted: the bank proof is a
  // mandatory item on the checklist that has just been confirmed verified, so
  // the account it proves becomes the one that may be paid, and a requested
  // change of account goes live with it.
  // An admitted stakeholder's account is not thereby checked: a direct admission
  // marks the clearances, not the bank proof against the account, so it neither
  // makes a staged account live nor calls the account verified. Nor does an
  // approval whose bank proof predates a staged change of account.
  let promotedBank = null;
  const bankOk = decision === 'APPROVED' && !directAdmit
    && !bankProofProblem(db.prepare('SELECT * FROM entities WHERE id = ?').get(entity.id));
  if (bankOk) {
    promotedBank = promotePendingBank(entity);
    db.prepare(`UPDATE entities SET is_penny_drop_verified = 1 WHERE id = ?`).run(entity.id);
    if (promotedBank) {
      logAudit({
        req, user: req.user, action: 'BANK_CHANGE_VERIFIED', module: 'REIA', entityType: 'entity', entityId: entity.id,
        beforeValue: JSON.stringify(promotedBank.from), afterValue: JSON.stringify(promotedBank.to),
      });
    }
  }

  db.prepare(`UPDATE entities SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(decision, req.params.id);
  logAudit({ req, user: req.user, action: `ENTITY_${decision}`, module: 'REIA', entityType: 'entity', entityId: entity.id, details: { remarks, admin_direct_admit: !!admin_direct_admit } });
  res.json(fetchEntityRelations(db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id)));
});

// The desk check runs before the file is saved, so a refused logo leaves nothing behind.
const ownDeskOnly = (req, res, next) => {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  const outside = entity && outsideDesk(req.user, entity);
  if (outside) return res.status(403).json({ error: outside });
  return next();
};
router.post('/:id/logo', requireRole(...ENTITY_WRITE, 'SELLER', 'BUYER'), ownDeskOnly, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No logo file provided' });
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity || !entityVisibleTo(req.user, entity.id)) return res.status(404).json({ error: 'Entity not found' });

  const logoUrl = `/uploads/${req.file.filename}`;
  db.prepare(`UPDATE entities SET logo_url = ?, updated_at = datetime('now') WHERE id = ?`).run(logoUrl, entity.id);

  res.json({ success: true, logo_url: logoUrl });
});

router.post('/:id/signature', requireRole(...ROLE_GROUPS.REIA_WRITE, 'SELLER', 'BUYER'), upload.single('signature'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No signature file provided' });
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(req.params.id);
  if (!entity || !entityVisibleTo(req.user, entity.id)) return res.status(404).json({ error: 'Entity not found' });

  const signatureUrl = `/uploads/${req.file.filename}`;
  db.prepare(`UPDATE entities SET signature_url = ?, updated_at = datetime('now') WHERE id = ?`).run(signatureUrl, entity.id);

  res.json({ success: true, signature_url: signatureUrl });
});

// ── Entity aliases (name unification) ──────────────────────────────
// All spellings registered for one entity.
router.get('/:id/aliases', (req, res) => {
  const entity = db.prepare('SELECT id FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  res.json(db.prepare('SELECT * FROM entity_aliases WHERE entity_id = ? ORDER BY created_at').all(req.params.id));
});

// Register a new spelling for an entity.
router.post('/:id/aliases', requireRole(...ROLE_GROUPS.REIA_WRITE), (req, res) => {
  const entity = db.prepare('SELECT id FROM entities WHERE id = ?').get(req.params.id);
  if (!entity) return res.status(404).json({ error: 'Entity not found' });
  const { alias_name } = req.body;
  if (!String(alias_name || '').trim()) return res.status(400).json({ error: 'alias_name is required' });
  const id = addAlias(req.params.id, alias_name, 'MANUAL');
  logAudit({ req, user: req.user, action: 'ADD_ALIAS', module: 'MASTERS', entityType: 'entity_alias', entityId: id, details: { entity_id: req.params.id, alias_name } });
  res.status(201).json(db.prepare('SELECT * FROM entity_aliases WHERE id = ?').get(id));
});

export default router;
