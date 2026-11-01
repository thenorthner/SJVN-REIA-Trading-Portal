import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import DocumentDesk from './DocumentDesk.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager, PreviewModal, UploadModal } from '../../components/DocumentManager.jsx';
import { fmtDate } from '../../datetime.js';
import { catalogForEntityType, APPROVAL_STATUS_LABELS, getRegulatoryItemLabel } from '../../constants/regulatoryApprovals.js';
import { ROLE_GROUPS, isCounterpartyRole } from '../../roles.js';
import {
  KYC_RULES, FIELD_LABELS, normaliseKycInput, fieldError, validateStakeholderForm,
  CATEGORY_OPTIONS, CREDIT_RATING_OPTIONS, TECHNOLOGY_OPTIONS, SUPPLY_CRITERIA_OPTIONS, VERTICAL_LABELS,
} from '../../lib/kycValidation.js';
import { showAlert } from '../../lib/dialogs.js';
import { actsAs } from '../../lib/rolePages.js';

// The desks that onboard: REIA for its sellers and buyers, Commercial for a
// hydro or thermal station's beneficiaries. Mirrors ENTITY_WRITE on the server,
// which is what actually decides. A counterparty's own login edits its profile
// through the API, not on this screen.
const ADMINS = ['SJVN_ADMIN', 'IT_SUPER_ADMIN'];
const CAN_WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE, ...ADMINS])];
// Phase B.2: on the REIA desk the maker onboards, edits and records a clearance's
// details; the checker approves the company, verifies its bank account and
// marks a clearance verified, rejected or not applicable. The station desks have
// no split yet, and the administrators keep onboarding (governance).
const STATIONS = [...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE];
const CAN_MAKE = [...new Set([...ROLE_GROUPS.REIA_MAKE, ...STATIONS, ...ADMINS])];
const CAN_APPROVE = [...new Set([...ROLE_GROUPS.REIA_CHECK, ...STATIONS, ...ADMINS])];
const CAN_VERIFY = CAN_APPROVE;
const CAN_RECORD = CAN_MAKE;
const DECIDING = ['VERIFIED', 'REJECTED', 'NOT_APPLICABLE'];
const CAN_DIRECT_ADMIT = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_CHECKER', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'];
// Barring a counterparty is an administrator's decision.
const CAN_BLACKLIST = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_CHECKER', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'];
// Mirrors INTAKE_ROLES in backend routes/documents.js.
const DOC_INTAKE_ROLES = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE, 'SJVN_ADMIN', 'IT_SUPER_ADMIN'])];

const emptyForm = (vertical) => ({
  // A station's stakeholders are the beneficiaries it bills; REIA onboards both sides.
  parent_entity_id: '', entity_type: vertical === 'REIA' ? 'SELLER' : 'BUYER', category: '', name: '',
  pan_no: '', gst_no: '', cin: '', credit_rating: '',
  capacity_mw: '', technology: '', contracted_capacity_mw: '',
  psa_tariff: '', supply_criteria: '', organization_details: '',
  address: '', bank_name: '', account_no: '', ifsc_code: '', branch_address: '',
  corporate_email: '', corporate_phone: '', corporate_website: '', tan_no: '',
  signatory_name: '', signatory_designation: '',
  contacts: [{ contact_type: 'COMMERCIAL', name: '', email: '', phone: '', is_primary: true }],
  documents: [],
  regulatory_na: {}, // approval_code -> notes when marked N/A at create
});

/** A form field that can show what is wrong with it, under the control. */
// The four categories seeded before categories were kept per side (masters
// lookup ENTITY_CATEGORY), and the side each belongs to.
const LEGACY_CATEGORY_SIDE = { 'RE Generator': 'SELLER', SPV: 'SELLER', DISCOM: 'BUYER', 'C&I': 'BUYER' };

function KField({ id, label, required, error, hint, children }) {
  return (
    <label className={'field' + (error ? ' has-error' : '')} htmlFor={id}>
      <span className="field-label">
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>}
      </span>
      {children}
      {error
        ? <span className="field-error" role="alert">{error}</span>
        : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export default function Entities({ vertical = 'REIA', initialTab = null }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(() => (tabParam === 'kyc' || initialTab === 'kyc' ? 'KYC' : 'DIRECTORY'));

  useEffect(() => {
    if (tabParam === 'kyc' || initialTab === 'kyc') setActiveTab('KYC');
    else if (tabParam === 'directory' || tabParam === 'stakeholders') setActiveTab('DIRECTORY');
  }, [tabParam, initialTab]);

  const handleTabChange = (key) => {
    setActiveTab(key);
    setSearchParams(key === 'KYC' ? { tab: 'kyc' } : {}, { replace: true });
  };

  const [rows, setRows] = useState([]);
  const [parents, setParents] = useState([]);
  const [filters, setFilters] = useState({ entity_type: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(() => emptyForm(vertical));
  const [fieldErrors, setFieldErrors] = useState({});
  // The one message on screen that has to be read: { tone, title, message, items, actions }.
  const [popup, setPopup] = useState(null);
  // K3: the call-back to a known company contact before a change of account is verified.
  const [callback, setCallback] = useState(null);
  const [callbacks, setCallbacks] = useState([]);
  // K2: clearances lapsing within 60 days, or lapsed.
  const [expiring, setExpiring] = useState([]);
  useEffect(() => {
    if (!actsAs(user, CAN_WRITE)) return;
    api.client.get('/entities/clearances/expiring', { params: { days: 60 } }).then((r) => setExpiring(r.data || [])).catch(() => setExpiring([]));
  }, [user?.role]);
  // The last value each field was flagged for, so leaving a field that is still
  // wrong does not raise the same popup a second time.
  const alerted = useRef({});
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [editApproval, setEditApproval] = useState(null);
  const [approvalForm, setApprovalForm] = useState({});
  const [blacklistForm, setBlacklistForm] = useState(null); // { blacklisted, reason }
  const [editModal, setEditModal] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Proof documents linked to each regulatory approval (matched by shared code).
  const [entityDocs, setEntityDocs] = useState([]);
  const [docPreview, setDocPreview] = useState(null);   // { versionId, fileName }
  const [uploadFor, setUploadFor] = useState(null);      // { code, label }
  // The checklist as the server holds it: the built-in clearances plus any an
  // administrator has added. The static list is only the fallback.
  const [catalogs, setCatalogs] = useState({});
  const [customTypes, setCustomTypes] = useState([]);
  const [typesModal, setTypesModal] = useState(null);    // null | { label, applies_to, is_mandatory, help }
  const catalogFor = (t) => catalogs[t] || catalogForEntityType(t);
  const loadCatalogs = () => Promise.all(['SELLER', 'BUYER'].map((t) => api.entities.regulatoryCatalog(t)))
    .then(([seller, buyer]) => {
      setCatalogs({ SELLER: seller.items, BUYER: buyer.items });
      setCustomTypes(seller.custom || []);
    })
    .catch(() => {});
  useEffect(() => { loadCatalogs(); }, []);

  const [categories, setCategories] = useState(CATEGORY_OPTIONS);
  const [technologies, setTechnologies] = useState(TECHNOLOGY_OPTIONS);
  const [quickAddLookup, setQuickAddLookup] = useState(null); // { field, label, category, value, isEdit }
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.masters.lookups({ category: 'ENTITY_CATEGORY' }).catch(() => []),
      api.masters.lookups({ category: 'ENTITY_CATEGORY_SELLER' }).catch(() => []),
      api.masters.lookups({ category: 'ENTITY_CATEGORY_BUYER' }).catch(() => []),
      api.masters.lookups({ category: 'TECHNOLOGY' }).catch(() => []),
    ]).then(([legacyRows, sellerRows, buyerRows, techRows]) => {
      setCategories((prev) => {
        const next = { SELLER: [...prev.SELLER], BUYER: [...prev.BUYER] };
        const add = (side, r) => {
          // A lookup whose code is already a listed category is that category,
          // under a longer label ("C&I" / "C&I Consumer"); it is not offered twice.
          const value = next[side].includes(r.code) ? r.code : (r.label || r.code);
          if (!next[side].includes(value)) next[side].push(value);
        };
        (Array.isArray(sellerRows) ? sellerRows : []).forEach((r) => add('SELLER', r));
        (Array.isArray(buyerRows) ? buyerRows : []).forEach((r) => add('BUYER', r));
        // Categories added before they were kept per side: the known ones go to
        // their side, anything else stays on both rather than disappear.
        (Array.isArray(legacyRows) ? legacyRows : []).forEach((r) => {
          const side = LEGACY_CATEGORY_SIDE[r.code];
          if (side) add(side, r); else { add('SELLER', r); add('BUYER', r); }
        });
        return next;
      });
      if (Array.isArray(techRows) && techRows.length > 0) {
        const techLabels = techRows.map((r) => r.label || r.code);
        setTechnologies((prev) => Array.from(new Set([...prev, ...techLabels])));
      }
    });
  }, []);

  async function handleCreateLookup(lookupCategory, labelVal, targetField, isEditMode = false) {
    const clean = String(labelVal || '').trim();
    if (!clean) return;
    setQuickAddSaving(true);
    try {
      const code = clean.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
      // A new category belongs to the kind of company it was added for.
      const side = (isEditMode ? editFormData.entity_type : form.entity_type) === 'BUYER' ? 'BUYER' : 'SELLER';
      await api.masters.createLookup({
        category: lookupCategory === 'ENTITY_CATEGORY' ? `ENTITY_CATEGORY_${side}` : lookupCategory,
        code,
        label: clean,
        sort_order: 10,
      });
      if (lookupCategory === 'ENTITY_CATEGORY') {
        setCategories((prev) => ({ ...prev, [side]: Array.from(new Set([...prev[side], clean])) }));
      } else if (lookupCategory === 'TECHNOLOGY') {
        setTechnologies((prev) => Array.from(new Set([...prev, clean])));
      }
      if (isEditMode) {
        setEditFormData((prev) => ({ ...prev, [targetField]: clean }));
      } else {
        setForm((prev) => ({ ...prev, [targetField]: clean }));
      }
      setQuickAddLookup(null);
    } catch (err) {
      showAlert(err.response?.data?.error || err.message || 'Failed to save lookup');
    } finally {
      setQuickAddSaving(false);
    }
  }

  const notify = (tone, title, message, items = null) => setPopup({ tone, title, message, items });
  const fail = (title, err, fallback) => {
    const data = err?.response?.data;
    let message = data?.error || fallback;
    let items = null;

    if (data?.blocking_items?.length) {
      message = 'Cannot approve stakeholder. The following mandatory regulatory items are pending verification:';
      items = data.blocking_items;
    } else if (data?.regulatory_summary?.blocking?.length) {
      message = 'Cannot approve stakeholder. The following mandatory regulatory items are pending verification:';
      items = data.regulatory_summary.blocking.map(getRegulatoryItemLabel);
    } else if (typeof message === 'string' && (message.includes('mandatory regulatory items pending') || message.includes('Cannot approve: mandatory'))) {
      const match = message.match(/\(([^)]+)\)/);
      if (match) {
        items = match[1].split(',').map((s) => s.trim()).filter(Boolean);
        message = 'Cannot approve stakeholder. The following mandatory regulatory items are pending verification:';
      }
    }

    notify('error', title, message, items);
  };

  function startEdit(entity) {
    setEditFormData({
      name: entity.name || '',
      category: entity.category || '',
      parent_entity_id: entity.parent_entity_id || '',
      entity_type: entity.entity_type || 'SELLER',
      pan_no: entity.pan_no || '',
      gst_no: entity.gst_no || '',
      tan_no: entity.tan_no || '',
      cin: entity.cin || '',
      corporate_email: entity.corporate_email || '',
      corporate_phone: entity.corporate_phone || '',
      corporate_website: entity.corporate_website || '',
      address: entity.address || '',
      credit_rating: entity.credit_rating || '',
      signatory_name: entity.signatory_name || '',
      signatory_designation: entity.signatory_designation || '',
      technology: entity.technology || '',
      capacity_mw: entity.capacity_mw != null ? String(entity.capacity_mw) : '',
      contracted_capacity_mw: entity.contracted_capacity_mw != null ? String(entity.contracted_capacity_mw) : '',
      psa_tariff: entity.psa_tariff != null ? String(entity.psa_tariff) : '',
      supply_criteria: entity.supply_criteria || '',
      bank_name: entity.bank_name || '',
      account_no: entity.account_no || '',
      ifsc_code: entity.ifsc_code || '',
      branch_address: entity.branch_address || '',
    });
    setEditModal(entity);
  }

  async function handleUpdate(e) {
    e.preventDefault();
    setEditSubmitting(true);
    try {
      const payload = {
        name: editFormData.name,
        category: editFormData.category,
        parent_entity_id: editFormData.parent_entity_id || null,
        pan_no: editFormData.pan_no ? editFormData.pan_no.trim().toUpperCase() : null,
        gst_no: editFormData.gst_no ? editFormData.gst_no.trim().toUpperCase() : null,
        tan_no: editFormData.tan_no ? editFormData.tan_no.trim().toUpperCase() : null,
        cin: editFormData.cin ? editFormData.cin.trim().toUpperCase() : null,
        corporate_email: editFormData.corporate_email?.trim() || null,
        corporate_phone: editFormData.corporate_phone?.trim() || null,
        corporate_website: editFormData.corporate_website?.trim() || null,
        address: editFormData.address?.trim() || null,
        credit_rating: editFormData.credit_rating || null,
        signatory_name: editFormData.signatory_name?.trim() || null,
        signatory_designation: editFormData.signatory_designation?.trim() || null,
        bank_name: editFormData.bank_name?.trim() || null,
        account_no: editFormData.account_no?.trim() || null,
        ifsc_code: editFormData.ifsc_code ? editFormData.ifsc_code.trim().toUpperCase() : null,
        branch_address: editFormData.branch_address?.trim() || null,
        technology: editFormData.technology || null,
        capacity_mw: editFormData.capacity_mw ? Number(editFormData.capacity_mw) : null,
        contracted_capacity_mw: editFormData.contracted_capacity_mw ? Number(editFormData.contracted_capacity_mw) : null,
        psa_tariff: editFormData.psa_tariff ? Number(editFormData.psa_tariff) : null,
        supply_criteria: editFormData.supply_criteria || null,
      };
      await api.entities.update(editModal.id, payload);
      const updated = await api.entities.get(editModal.id);
      if (selected && selected.id === editModal.id) {
        setSelected(updated);
      }
      setEditModal(null);
      load();
      notify('success', 'Stakeholder updated', `${updated.name} details have been saved.`);
    } catch (err) {
      fail('Could not update stakeholder', err, 'Failed to update details');
    } finally {
      setEditSubmitting(false);
    }
  }

  function load() {
    setLoading(true);
    api.entities.list({ vertical, entity_type: filters.entity_type || undefined, status: filters.status || undefined })
      .then(res => {
        setRows(res);
        setParents(res.filter(r => !r.parent_entity_id));
      }).finally(() => setLoading(false));
  }

  useEffect(load, [vertical, filters.entity_type, filters.status]);

  // Pull this entity's proof documents so each regulatory approval row can show
  // its linked file (document_type === approval_code) inline.
  function loadEntityDocs(entityId) {
    if (!entityId) { setEntityDocs([]); return; }
    api.documents.list({ entity_id: entityId }).then(setEntityDocs).catch(() => setEntityDocs([]));
  }
  useEffect(() => { loadEntityDocs(selected?.id); }, [selected?.id]);

  // Latest document whose type matches an approval code (verified wins over pending).
  function docForCode(code) {
    const matches = entityDocs.filter((d) => d.document_type === code);
    if (matches.length === 0) return null;
    const rank = { VERIFIED: 3, PENDING: 2, REJECTED: 1 };
    return matches.slice().sort((a, b) => (rank[b.verification_status] || 0) - (rank[a.verification_status] || 0))[0];
  }

  function openDetail(row) {
    api.entities.get(row.id).then(setSelected);
    setRemarks('');
    setEditApproval(null);
  }

  function openCreate() {
    setForm(emptyForm(vertical));
    setFieldErrors({});
    alerted.current = {};
    setShowCreate(true);
  }

  // ── Onboarding form: fields, and what is wrong with them ──────────────────

  function focusField(field) {
    setPopup(null);
    // After the popup has gone, or the focus lands back on its button.
    setTimeout(() => {
      const el = document.getElementById(`sk-${field}`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    }, 60);
  }

  function setField(field, raw) {
    const value = normaliseKycInput(field, raw);
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: null }));
  }

  // Leaving a field checks it there and then. A wrong PAN is said as the user
  // moves on to the GSTIN, not after the whole form has been filled.
  function checkField(field) {
    const message = fieldError(field, form);
    setFieldErrors((prev) => ({
      ...prev,
      [field]: message,
      // The GSTIN is judged against the PAN, so correcting the PAN re-judges it.
      ...(field === 'pan_no' && form.gst_no ? { gst_no: fieldError('gst_no', form) } : {}),
    }));
    if (message && alerted.current[field] !== form[field]) {
      alerted.current[field] = form[field];
      setPopup({
        tone: 'error',
        title: `${FIELD_LABELS[field] || field} is not valid`,
        items: [{ label: FIELD_LABELS[field] || field, message, onClick: () => focusField(field) }],
      });
    }
  }

  const kInput = (field, label, { required, hint, ...inputProps } = {}) => (
    <KField
      id={`sk-${field}`}
      label={label}
      required={required}
      error={fieldErrors[field]}
      hint={hint ?? (KYC_RULES[field] ? `Format: ${KYC_RULES[field].example}` : undefined)}
    >
      <input
        id={`sk-${field}`}
        value={form[field] ?? ''}
        maxLength={KYC_RULES[field]?.maxLength}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!!fieldErrors[field]}
        onChange={(e) => setField(field, e.target.value)}
        onBlur={() => checkField(field)}
        {...inputProps}
      />
    </KField>
  );

  const kSelect = (field, label, options, { required, placeholder = 'Select…' } = {}) => {
    const isCustomizable = ['category', 'technology'].includes(field);
    const lookupCat = field === 'category' ? 'ENTITY_CATEGORY' : 'TECHNOLOGY';
    return (
      <KField
        id={`sk-${field}`}
        label={
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{label}</span>
            {isCustomizable && (
              <button
                type="button"
                className="btn btn-xs btn-outline"
                style={{ padding: '1px 8px', fontSize: 12.5, fontWeight: 600 }}
                onClick={() => setQuickAddLookup({ field, label, category: lookupCat, value: '', isEdit: false })}
              >
                + Add New
              </button>
            )}
          </span>
        }
        required={required}
        error={fieldErrors[field]}
      >
        <select
          id={`sk-${field}`}
          value={form[field] ?? ''}
          onChange={(e) => {
            if (e.target.value === '__NEW__') {
              setQuickAddLookup({ field, label, category: lookupCat, value: '', isEdit: false });
            } else {
              setField(field, e.target.value);
            }
          }}
        >
          <option value="">{placeholder}</option>
          {form[field] && !options.includes(form[field]) && <option value={form[field]}>{form[field]}</option>}
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          {isCustomizable && <option value="__NEW__">+ Add New {label}...</option>}
        </select>
      </KField>
    );
  };

  const setContact = (key, value) => {
    setForm((prev) => ({ ...prev, contacts: [{ ...prev.contacts[0], [key]: value }] }));
    if (fieldErrors[`contact_${key}`]) setFieldErrors((prev) => ({ ...prev, [`contact_${key}`]: null }));
  };

  /** Show every problem at once, each one a link to its field. */
  function showFormErrors(title, errors, extra = {}) {
    setFieldErrors(Object.fromEntries(errors.map((e) => [e.field, e.message])));
    setPopup({
      tone: 'error',
      title,
      message: errors.length > 1
        ? `${errors.length} fields need attention. Click one to go to it.`
        : 'Click it to go to the field.',
      items: errors.map((e) => ({
        label: e.label || FIELD_LABELS[e.field] || e.field,
        message: e.message,
        onClick: () => focusField(e.field),
      })),
      ...extra,
    });
  }

  async function handleCreate(e) {
    e.preventDefault();

    const errors = validateStakeholderForm(form);
    for (const [code, notes] of Object.entries(form.regulatory_na || {})) {
      if (String(notes || '').trim().length < 10) {
        const item = catalogFor(form.entity_type).find((c) => c.code === code);
        errors.push({ field: `na-${code}`, label: item?.label || code, message: 'Say why this approval is not applicable (at least 10 characters).' });
      }
    }
    if (errors.length) {
      showFormErrors('The stakeholder cannot be saved yet', errors);
      return;
    }

    setSubmitting(true);
    try {
      const regulatory_checklist_init = Object.entries(form.regulatory_na || {})
        .filter(([, notes]) => notes != null)
        .map(([approval_code, notes]) => ({
          approval_code,
          status: 'NOT_APPLICABLE',
          notes: String(notes).trim(),
        }));

      const createdEntity = await api.entities.create({
        ...form,
        vertical,
        capacity_mw: form.capacity_mw ? Number(form.capacity_mw) : null,
        contracted_capacity_mw: form.contracted_capacity_mw ? Number(form.contracted_capacity_mw) : null,
        psa_tariff: form.psa_tariff ? Number(form.psa_tariff) : null,
        parent_entity_id: form.parent_entity_id || null,
        regulatory_checklist_init,
      });
      setShowCreate(false);
      load();
      openDetail(createdEntity);
      notify('success', 'Stakeholder saved', `${createdEntity.name} is onboarded as PENDING. Upload its KYC documents next.`);
    } catch (err) {
      const data = err.response?.data || {};
      const dup = data.duplicate_of;
      const serverErrors = (data.field_errors || []).map((fe) => ({ ...fe, label: FIELD_LABELS[fe.field] }));
      const actions = dup?.can_link ? (
        <button type="button" className="btn btn-secondary" onClick={() => linkExisting(dup)}>
          Link “{dup.name}” to {VERTICAL_LABELS[vertical]}
        </button>
      ) : undefined;
      if (serverErrors.length) {
        showFormErrors(dup ? 'This stakeholder is already onboarded' : 'The server refused these details', serverErrors, {
          message: data.error, actions,
        });
      } else {
        setPopup({ tone: 'error', title: 'Could not save the stakeholder', message: data.error || 'Failed to create stakeholder.', actions });
      }
    } finally {
      setSubmitting(false);
    }
  }

  // The same legal entity, already on record under another vertical: register
  // that record here rather than onboarding its PAN a second time.
  async function linkExisting(dup) {
    try {
      const linked = await api.entities.linkVertical(dup.id, vertical);
      setShowCreate(false);
      load();
      openDetail(linked);
      notify('success', 'Stakeholder linked', `${linked.name} is now registered under ${VERTICAL_LABELS[vertical]}. Its KYC and approval carry over.`);
    } catch (err) {
      fail('Could not link the stakeholder', err, 'Linking failed.');
    }
  }

  async function handleApprove(decision, directAdmit = false) {
    try {
      await api.entities.approve(selected.id, decision, remarks, directAdmit ? { admin_direct_admit: true } : {});
      setSelected(null);
      load();
    } catch (err) {
      fail(decision === 'APPROVED' ? 'Approval was refused' : 'Rejection was refused', err, 'Approval failed');
    }
  }

  // The checker decides on the maker's evidence; the API refuses any change to it.
  const evidenceLocked = actsAs(user, ROLE_GROUPS.REIA_CHECK);

  function openApprovalEditor(item) {
    setEditApproval(item);
    setApprovalForm({
      status: item.status,
      reference_no: item.reference_no || '',
      issued_by: item.issued_by || '',
      issued_on: item.issued_on || '',
      valid_until: item.valid_until || '',
      notes: item.notes || '',
    });
  }

  async function saveApproval(e) {
    e.preventDefault();
    try {
      const res = await api.entities.updateRegulatoryApproval(selected.id, editApproval.id, approvalForm);
      setSelected({
        ...selected,
        regulatory_checklist: res.checklist,
        regulatory_summary: res.summary,
        regulatory_approvals: res.summary?.summary_text,
      });
      setEditApproval(null);
      load();
    } catch (err) {
      fail('Could not update the approval', err, 'Failed to update approval');
    }
  }

  function toggleNa(code, checked) {
    setForm((prev) => {
      const next = { ...prev.regulatory_na };
      if (checked) next[code] = next[code] || '';
      else delete next[code];
      return { ...prev, regulatory_na: next };
    });
  }

  async function handleLogoUpload(e) {
    if (!e.target.files[0]) return;
    try {
      await api.entities.uploadLogo(selected.id, e.target.files[0]);
      api.entities.get(selected.id).then(setSelected);
      load();
      notify('success', 'Logo uploaded', 'It will appear at the top left of this seller’s invoices.');
    } catch (err) {
      fail('Logo upload failed', err, 'Failed to upload logo');
    }
  }

  useEffect(() => {
    if (!selected?.id || !selected.pending_bank_json || !actsAs(user, CAN_WRITE)) { setCallbacks([]); return; }
    api.client.get(`/entities/${selected.id}/bank-callbacks`).then((r) => setCallbacks(r.data || [])).catch(() => setCallbacks([]));
  }, [selected?.id, selected?.pending_bank_json]);

  async function saveCallback(e) {
    e.preventDefault();
    const missing = [];
    if (!callback.contact_name.trim()) missing.push('Name of the person called');
    if (callback.phone.replace(/\D/g, '').length < 10) missing.push('Number called (10 digits)');
    if (callback.confirmed === '') missing.push('Whether the contact confirmed the change');
    if (missing.length) return notify('warning', 'Call-back is incomplete', 'Fill these before saving:', missing);
    try {
      await api.client.post(`/entities/${selected.id}/bank-callback`, { ...callback, confirmed: callback.confirmed === 'YES' });
      const r = await api.client.get(`/entities/${selected.id}/bank-callbacks`);
      setCallbacks(r.data || []);
      setCallback(null);
      notify(callback.confirmed === 'YES' ? 'success' : 'error', 'Call-back recorded',
        callback.confirmed === 'YES' ? 'The change of account can now be verified by an officer other than the one who asked for it.' : 'The contact did not confirm the change. Admins have been alerted; do not verify this account.');
    } catch (err) {
      fail('Call-back was not recorded', err, 'Could not save the call-back');
    }
  }

  // An officer's confirmation that the account matches the cancelled cheque on
  // file. No money is sent — there is no penny-drop integration behind this.
  function confirmBank() {
    setPopup({
      tone: 'warning',
      title: 'Confirm the bank account',
      message: `Confirm that ${selected.name}'s bank account matches the verified bank proof on file? Payments can be released to it after this.${selected.pending_bank_json ? ' The requested change of account becomes the live one.' : ''}`,
      okLabel: 'Back',
      actions: (
        <button type="button" className="btn btn-primary" onClick={async () => {
          setPopup(null);
          try {
            await api.client.post(`/entities/${selected.id}/verify-bank`);
            api.entities.get(selected.id).then(setSelected);
            load();
          } catch (err) {
            fail('Bank account was not verified', err, 'Verification failed');
          }
        }}>Confirm account</button>
      ),
    });
  }

  async function saveBlacklist(e) {
    e.preventDefault();
    try {
      const updated = await api.entities.setBlacklist(selected.id, blacklistForm.blacklisted, blacklistForm.reason);
      setSelected({ ...selected, ...updated });
      setBlacklistForm(null);
      load();
      notify(
        blacklistForm.blacklisted ? 'warning' : 'success',
        blacklistForm.blacklisted ? 'Stakeholder blacklisted' : 'Blacklist cleared',
        blacklistForm.blacklisted
          ? `${updated.name} can no longer be approved or given a new contract. Contracts already running are not affected.`
          : `${updated.name} can be approved and contracted with again.`,
      );
    } catch (err) {
      fail('Blacklist status was not changed', err, 'Failed to update blacklist status');
    }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => (
      <div>
        <div style={{fontWeight: 600}}>{r.name}</div>
        {r.parent_name && <div style={{fontSize: 14.5, color: 'var(--slate-500)'}}>Parent: {r.parent_name}</div>}
      </div>
    )},
    { key: 'entity_type', header: 'Type', render: (r) => <Badge status={r.entity_type} /> },
    { key: 'kyc', header: 'KYC & Bank', render: (r) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {r.pan_no ? <Badge status="ACTIVE" label="PAN" /> : <Badge status="DRAFT" label="No PAN" />}
        {r.is_penny_drop_verified ? <Badge status="ACTIVE" label="Bank Verified" /> : <Badge status="PENDING" label="Bank Unverified" />}
      </div>
    )},
    { key: 'regulatory', header: 'Regulatory', render: (r) => {
      const s = r.regulatory_summary;
      if (!s) return <span style={{ color: 'var(--text-subtle)' }}>{r.regulatory_approvals || '—'}</span>;
      return (
        <Badge
          status={s.ready_for_approval ? 'ACTIVE' : 'PENDING'}
          label={s.summary_text}
        />
      );
    }},
    { key: 'capacity', header: 'Capacity (MW)', render: (r) => fmtNumber(r.contracted_capacity_mw ?? r.capacity_mw) },
    { key: 'status', header: 'Status', render: (r) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Badge status={r.status} />
        {!!r.is_blacklisted && <Badge status="REJECTED" label="BLACKLISTED" />}
      </div>
    )},
    { key: 'created_at', header: 'Onboarded', render: (r) => fmtDate(r.created_at) },
    { key: 'actions', header: 'Actions', render: (r) => (
      <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-xs btn-outline" onClick={() => openDetail(r)}>View</button>
        {actsAs(user, CAN_MAKE) && (
          <button type="button" className="btn btn-xs btn-outline" onClick={() => startEdit(r)}>Edit</button>
        )}
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader
        title={vertical === 'REIA' ? 'Stakeholders & KYC Desk' : `Stakeholders & KYC Desk — ${VERTICAL_LABELS[vertical]}`}
        subtitle={vertical === 'REIA'
          ? 'Manage RE Generators, DISCOMs, SPVs, Verification Queue, KYC & Compliance Status'
          : `Beneficiaries and generating companies billed under ${VERTICAL_LABELS[vertical]} — KYC, bank and regulatory approvals`}
        actions={activeTab === 'DIRECTORY' && actsAs(user, CAN_WRITE) && (
          <>
            {actsAs(user, CAN_BLACKLIST) && (
              <button className="btn btn-outline" style={{ marginRight: 8 }} onClick={() => setTypesModal({ label: '', applies_to: 'BOTH', is_mandatory: '0', help: '' })}>
                Compliance documents
              </button>
            )}
            {actsAs(user, CAN_MAKE) && <button className="btn btn-primary" onClick={openCreate}>+ Onboard Stakeholder</button>}
          </>
        )}
      />

      <div className="nb-tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'DIRECTORY'}
          className={`nb-tab ${activeTab === 'DIRECTORY' ? 'active' : ''}`}
          onClick={() => handleTabChange('DIRECTORY')}
        >
          Stakeholder Directory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'KYC'}
          className={`nb-tab ${activeTab === 'KYC' ? 'active' : ''}`}
          onClick={() => handleTabChange('KYC')}
        >
          Documents & KYC Desk
        </button>
      </div>

      {activeTab === 'KYC' ? (
        <DocumentDesk vertical={vertical} embedded={true} />
      ) : (
        <>
          {expiring.length > 0 && (
            <Card title={`Clearances lapsing within 60 days or lapsed — ${expiring.length}`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 15 }}>
                {expiring.slice(0, 12).map((a) => (
                  <div key={a.id}>
                    <Badge status={a.days_left < 0 || a.status === 'EXPIRED' ? 'REJECTED' : a.days_left <= 7 ? 'PENDING' : 'DRAFT'}
                      label={a.days_left < 0 || a.status === 'EXPIRED' ? 'Expired' : `${a.days_left} day(s)`} />
                    {' '}<strong>{a.entity_name}</strong> — {getRegulatoryItemLabel(a.approval_code) || a.label || a.approval_code}, valid until {fmtDate(a.valid_until)}
                  </div>
                ))}
                {expiring.length > 12 && <div style={{ color: 'var(--slate-500)' }}>…and {expiring.length - 12} more</div>}
              </div>
            </Card>
          )}

          <div className="filters-bar">
            <select value={filters.entity_type} onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}>
              <option value="">All types</option>
              <option value="SELLER">Seller</option>
              <option value="BUYER">Buyer</option>
            </select>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          <Card>
            <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No stakeholders found.'} />
          </Card>
        </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={`Onboard New Stakeholder — ${VERTICAL_LABELS[vertical]}`} width={900}>
        {/* noValidate: the checks below run in one pass and report in a popup,
            instead of the browser stopping at the first empty box. */}
        <form onSubmit={handleCreate} noValidate>
          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>1. Entity Hierarchy & Type</h4>
            <div className="form-grid">
              <Field label="Parent Group (Optional)">
                <select value={form.parent_entity_id} onChange={(e) => setForm({ ...form, parent_entity_id: e.target.value })}>
                  <option value="">-- None (This is a Parent Group) --</option>
                  {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Entity Type" required>
                <select
                  value={form.entity_type}
                  // The categories and the checklist both follow the type, so they reset with it.
                  onChange={(e) => setForm({ ...form, entity_type: e.target.value, category: '', regulatory_na: {} })}
                >
                  <option value="SELLER">Seller (Generator)</option>
                  <option value="BUYER">Buyer (Beneficiary / DISCOM)</option>
                </select>
              </Field>
              {kInput('name', 'Name', { required: true, placeholder: 'Registered name of the company' })}
              {kSelect('category', 'Category', categories[form.entity_type] || [], { required: true, placeholder: 'Select category…' })}
            </div>
          </div>

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>2. Corporate & KYC</h4>
            <div className="form-grid">
              {kInput('pan_no', 'PAN No', { required: true, placeholder: 'ABCDE1234F' })}
              {kInput('gst_no', 'GST No', {
                required: true,
                placeholder: '08ABCDE1234F1Z5',
                hint: form.pan_no && KYC_RULES.pan_no.pattern.test(form.pan_no)
                  ? `Characters 3–12 must be ${form.pan_no}`
                  : 'State code + PAN + entity code + Z + check character',
              })}
              {kInput('tan_no', 'TAN No (Optional)', { placeholder: 'DELA12345B' })}
              {kInput('cin', 'CIN (Optional)', { placeholder: 'U40106RJ2016PTC012345' })}
              {kInput('corporate_email', 'Corporate Email', { type: 'email', hint: null })}
              {kInput('corporate_phone', 'Corporate Phone', { inputMode: 'tel', hint: null })}
              {kInput('corporate_website', 'Corporate Website', { placeholder: 'www.company.in', hint: null })}
              <Field label="Address"><input value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></Field>
              {kSelect('credit_rating', 'Credit Rating', CREDIT_RATING_OPTIONS, { placeholder: 'Select rating…' })}
              <Field label="Authorised Signatory Name"><input placeholder="Named in the invoice authentication seal" value={form.signatory_name} onChange={e => setForm({...form, signatory_name: e.target.value})} /></Field>
              <Field label="Signatory Designation"><input placeholder="e.g. DGM (Finance)" value={form.signatory_designation} onChange={e => setForm({...form, signatory_designation: e.target.value})} /></Field>
              {/* The server needs a named commercial contact; without these the form could never be saved. */}
              <KField id="sk-contact_name" label="Commercial Contact Name" required error={fieldErrors.contact_name}>
                <input id="sk-contact_name" placeholder="Person SJVN writes to about bills" value={form.contacts[0].name} onChange={e => setContact('name', e.target.value)} />
              </KField>
              <KField id="sk-contact_email" label="Commercial Contact Email" error={fieldErrors.contact_email}>
                <input id="sk-contact_email" type="email" value={form.contacts[0].email} onChange={e => setContact('email', e.target.value)} />
              </KField>
              <KField id="sk-contact_phone" label="Commercial Contact Phone" error={fieldErrors.contact_phone}>
                <input id="sk-contact_phone" inputMode="tel" value={form.contacts[0].phone} onChange={e => setContact('phone', e.target.value)} />
              </KField>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>3. Technical & Banking</h4>
            <div className="form-grid">
              {form.entity_type === 'SELLER' && (
                <>
                  {kSelect('technology', 'Technology', technologies, { placeholder: 'Select technology…' })}
                  {kInput('capacity_mw', 'Capacity (MW)', { required: true, type: 'number', step: '0.01', min: '0' })}
                </>
              )}
              {form.entity_type === 'BUYER' && (
                <>
                  {kInput('contracted_capacity_mw', 'Contracted Capacity (MW)', { required: true, type: 'number', step: '0.01', min: '0' })}
                  {kInput('psa_tariff', 'PSA Tariff (₹/kWh)', { type: 'number', step: '0.01', min: '0' })}
                  {kSelect('supply_criteria', 'Criteria for Supply of Power', SUPPLY_CRITERIA_OPTIONS, { placeholder: 'Select criteria…' })}
                </>
              )}
              {kInput('bank_name', 'Bank Name', { required: true })}
              {kInput('account_no', 'Account No', { required: true, inputMode: 'numeric', placeholder: '9 to 18 digits', hint: 'Digits only, 9 to 18' })}
              {kInput('ifsc_code', 'IFSC Code', { required: true, placeholder: 'SBIN0001234', hint: '11 characters — the 5th is always 0' })}
              {kInput('branch_address', 'Branch Address', { required: true })}
            </div>
          </div>

          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h4 style={{ margin: '0 0 8px 0' }}>4. Regulatory Approvals Checklist</h4>
              {actsAs(user, CAN_BLACKLIST) && (
                <button type="button" className="btn btn-xs btn-outline" onClick={() => setTypesModal({ label: '', applies_to: form.entity_type, is_mandatory: '0', help: '' })}>
                  + Add a compliance document
                </button>
              )}
            </div>
            <p style={{ fontSize: 14.5, color: 'var(--slate-500)', marginTop: 0 }}>
              Specific clearances required for {form.entity_type === 'SELLER' ? 'sellers' : 'buyers'}.
              After create, upload supporting docs and mark each item Submitted / Verified.
              Mark <strong>N/A</strong> only where genuinely not applicable (with a note).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {catalogFor(form.entity_type).map((item) => {
                const na = Object.prototype.hasOwnProperty.call(form.regulatory_na, item.code);
                return (
                  <div
                    key={item.code}
                    style={{
                      border: '1px solid var(--slate-200)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      background: na ? 'var(--slate-50)' : 'var(--surface)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                          {item.label}
                          {item.is_mandatory ? (
                            <span style={{ color: 'var(--red-deep)', marginLeft: 6, fontSize: 14.5 }}>Required</span>
                          ) : (
                            <span style={{ color: 'var(--slate-500)', marginLeft: 6, fontSize: 14.5 }}>Optional</span>
                          )}
                        </div>
                        <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>{item.help}</div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={na}
                          onChange={(e) => toggleNa(item.code, e.target.checked)}
                        />
                        N/A
                      </label>
                    </div>
                    {na && (
                      <Field label="Why not applicable?">
                        <input
                          id={`sk-na-${item.code}`}
                          placeholder="e.g. COD not yet — plant under construction"
                          value={form.regulatory_na[item.code] || ''}
                          onChange={(e) => setForm({
                            ...form,
                            regulatory_na: { ...form.regulatory_na, [item.code]: e.target.value },
                          })}
                        />
                      </Field>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: '12px 16px', background: 'var(--t-blue-50)', borderRadius: 6, color: 'var(--on-blue)', fontSize: 14.5, marginBottom: 20 }}>
            <strong>Next:</strong> After save, upload KYC / licence PDFs under Documents, then each checklist item is marked Verified. Approval is blocked until all mandatory items are Verified (or properly N/A). The bank account is verified against the cancelled cheque and becomes payable on approval.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : 'Save & Proceed to Documents'}</button>
          </div>
        </form>
      </Modal>

      {selected && (
        <Modal open={true} onClose={() => setSelected(null)} title={`Stakeholder: ${selected.name}`} width={800}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>
              {selected.parent_name ? `SPV of ${selected.parent_name}` : 'Parent Entity'} · {selected.category || 'General'}
            </span>
            {actsAs(user, CAN_MAKE) && (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={() => startEdit(selected)}
              >
                Edit Stakeholder Details
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <table className="detail-table">
                <tbody>
                  <tr><td>Type</td><td><Badge status={selected.entity_type} /></td></tr>
                  <tr><td>Hierarchy</td><td>{selected.parent_name ? `SPV of ${selected.parent_name}` : 'Parent Entity'}</td></tr>
                  <tr><td>Category</td><td>{selected.category}</td></tr>
                  <tr><td>PAN</td><td>{selected.pan_no || '-'}</td></tr>
                  <tr><td>TAN</td><td>{selected.tan_no || '-'}</td></tr>
                  <tr><td>GST</td><td>{selected.gst_no || '-'}</td></tr>
                  <tr><td>CIN</td><td>{selected.cin || '-'}</td></tr>
                  <tr><td>Address</td><td>{selected.address || '-'}</td></tr>
                  <tr><td>Email</td><td>{selected.corporate_email || '-'}</td></tr>
                  <tr><td>Phone</td><td>{selected.corporate_phone || '-'}</td></tr>
                  <tr><td>Website</td><td>{selected.corporate_website || '-'}</td></tr>
                  <tr><td>Credit Rating</td><td>{selected.credit_rating || '-'}</td></tr>
                  <tr><td>Registered Under</td><td>{String(selected.verticals || 'REIA').split(',').map((v) => VERTICAL_LABELS[v] || v).join(', ')}</td></tr>
                  <tr>
                    <td>Blacklist Status</td>
                    <td>
                      {selected.is_blacklisted ? <Badge status="REJECTED" label="BLACKLISTED" /> : <Badge status="ACTIVE" label="Clear" />}
                      {(selected.blacklist_reason || selected.blacklisted_by) && (
                        <div style={{ fontSize: 14.5, color: 'var(--slate-500)', marginTop: 4 }}>
                          {selected.is_blacklisted ? 'Blacklisted' : 'Cleared'}
                          {selected.blacklisted_by ? ` by ${selected.blacklisted_by}` : ''}
                          {selected.blacklisted_at ? ` on ${fmtDate(selected.blacklisted_at)}` : ''}
                          {selected.blacklist_reason ? ` — ${selected.blacklist_reason}` : ''}
                        </div>
                      )}
                      {actsAs(user, CAN_BLACKLIST) && (
                        <div style={{ marginTop: 6 }}>
                          <button
                            type="button"
                            className={selected.is_blacklisted ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-danger'}
                            onClick={() => setBlacklistForm({ blacklisted: !selected.is_blacklisted, reason: '' })}
                          >
                            {selected.is_blacklisted ? 'Clear blacklist' : 'Blacklist stakeholder'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 300 }}>
              <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Bank & Technical</h4>
              <table className="detail-table">
                <tbody>
                  <tr>
                    <td>Bank Details</td>
                    <td>
                      <div>{selected.account_no || '-'}, {selected.bank_name || '-'}</div>
                      <div style={{fontSize: 14.5, color: 'var(--slate-500)'}}>IFSC: {selected.ifsc_code || '-'} | Branch: {selected.branch_address || '-'}</div>
                      <div style={{ marginTop: 6 }}>
                        {selected.is_penny_drop_verified
                          ? <Badge status="ACTIVE" label="Bank verified" />
                          : <Badge status="PENDING" label={selected.status === 'APPROVED' ? 'Bank not verified' : 'Verified on approval'} />}
                        {/* A record approved before approval started confirming the account
                            has no other way to be cleared for payment. */}
                        {!selected.is_penny_drop_verified && selected.status === 'APPROVED' && actsAs(user, CAN_VERIFY) && (
                          <button type="button" className="btn btn-sm btn-outline" style={{ marginLeft: 8 }} onClick={confirmBank}>
                            Confirm against bank proof
                          </button>
                        )}
                      </div>
                      {selected.pending_bank_json && (
                        <div style={{ fontSize: 14.5, color: 'var(--amber-strong)', marginTop: 4 }}>
                          A change of bank account is waiting. It becomes the live account when this record is re-approved.
                          {actsAs(user, CAN_VERIFY) && (
                            <div style={{ marginTop: 6, color: 'var(--slate-600)' }}>
                              {callbacks[0]
                                ? <span>Call-back: {callbacks[0].contact_name} on …{String(callbacks[0].phone).slice(-4)}, {callbacks[0].called_at} — <strong>{callbacks[0].confirmed ? 'confirmed' : 'NOT confirmed'}</strong></span>
                                : <span>No call-back recorded yet — required before the change is verified.</span>}
                              <button type="button" className="btn btn-sm btn-outline" style={{ marginLeft: 8 }}
                                onClick={() => setCallback({ contact_name: '', phone: '', called_at: '', confirmed: '', notes: '' })}>
                                Record call-back
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {selected.entity_type === 'SELLER' && (
                    <>
                      <tr><td>Technology</td><td>{selected.technology || '-'}</td></tr>
                      <tr><td>Capacity</td><td>{fmtNumber(selected.capacity_mw)} MW</td></tr>
                    </>
                  )}
                  {selected.entity_type === 'BUYER' && (
                    <>
                      <tr><td>Contracted Capacity</td><td>{fmtNumber(selected.contracted_capacity_mw)} MW</td></tr>
                      <tr><td>PSA Tariff</td><td>{selected.psa_tariff != null ? `₹${selected.psa_tariff}/kWh` : '-'}</td></tr>
                      <tr><td>Criteria for Supply of Power</td><td>{selected.supply_criteria || '-'}</td></tr>
                    </>
                  )}
                  <tr><td>Status</td><td><Badge status={selected.status} /></td></tr>
                  <tr>
                    <td>Regulatory</td>
                    <td>
                      {selected.regulatory_summary ? (
                        <Badge
                          status={selected.regulatory_summary.ready_for_approval ? 'ACTIVE' : 'PENDING'}
                          label={selected.regulatory_summary.summary_text}
                        />
                      ) : (selected.regulatory_approvals || '—')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <h4 style={{ margin: '20px 0 8px 0', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Regulatory Approvals</h4>
          <p style={{ fontSize: 14.5, color: 'var(--slate-500)', marginTop: 0 }}>
            Track each clearance with status, reference no., issuer and validity. Upload proof under Documents below (same doc types).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
            {(selected.regulatory_checklist || []).map((item) => (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--slate-200)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  background: 'var(--surface)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14.5 }}>{item.label}</strong>
                    <Badge status={item.status === 'VERIFIED' ? 'ACTIVE' : item.status === 'NOT_APPLICABLE' ? 'DRAFT' : 'PENDING'} label={APPROVAL_STATUS_LABELS[item.status] || item.status} />
                    {item.is_mandatory ? <span style={{ fontSize: 14.5, color: 'var(--red-deep)' }}>Required</span> : <span style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>Optional</span>}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--slate-500)', marginTop: 4 }}>
                    {item.reference_no ? `Ref: ${item.reference_no} · ` : ''}
                    {item.issued_by ? `Issuer: ${item.issued_by} · ` : ''}
                    {item.issued_on ? `Issued: ${item.issued_on} · ` : ''}
                    {item.valid_until ? `Valid till: ${item.valid_until}` : ''}
                    {!item.reference_no && !item.issued_by && !item.issued_on && !item.valid_until ? 'No details yet' : ''}
                  </div>
                  {item.notes && <div style={{ fontSize: 15, color: 'var(--slate-600)', marginTop: 2 }}>{item.notes}</div>}
                  {item.verified_by && (
                    <div style={{ fontSize: 14.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                      Verified by {item.verified_by}{item.verified_at ? ` · ${fmtDate(item.verified_at)}` : ''}
                    </div>
                  )}
                  {(() => {
                    const proof = docForCode(item.approval_code);
                    const vs = proof?.verification_status;
                    // On SJVN's side the desks' officers and the administrators take documents in
                    // (INTAKE_ROLES in routes/documents.js); stakeholders upload from their portal.
                    const canUpload = actsAs(user, DOC_INTAKE_ROLES) || isCounterpartyRole(user?.role);
                    return (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {proof ? (
                          <>
                            <span style={{ fontSize: 15, fontWeight: 600, color: vs === 'VERIFIED' ? 'var(--on-green-2)' : vs === 'REJECTED' ? 'var(--red-deep)' : 'var(--amber-strong)' }}>
                               {vs === 'VERIFIED' ? 'Proof verified' : vs === 'REJECTED' ? 'Proof rejected' : 'Proof uploaded — pending review'}
                            </span>
                            <button type="button" className="link-btn" style={{ fontSize: 15 }} onClick={() => setDocPreview({ versionId: proof.latest_version_id, fileName: proof.file_name })}>
                               View proof
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: 15, color: 'var(--text-subtle)' }}>
                            No proof uploaded
                            {canUpload ? (
                              <button type="button" className="link-btn" style={{ fontSize: 15, marginLeft: 6 }} onClick={() => setUploadFor({ code: item.approval_code, label: item.label })}>
                                Upload
                              </button>
                            ) : ' · awaiting stakeholder upload'}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {actsAs(user, CAN_WRITE) && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => openApprovalEditor(item)}>Update</button>
                )}
              </div>
            ))}
          </div>

          <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Contacts</h4>
          {selected.contacts?.length > 0 ? (
            <div className="compact-table">
              <Table columns={[{key:'type', header:'Role', render: r=>r.contact_type}, {key:'name', header:'Name'}, {key:'email', header:'Email'}, {key:'phone', header:'Phone'}]} rows={selected.contacts} />
            </div>
          ) :<div style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>No contacts found.</div>}

          {selected.entity_type === 'SELLER' && actsAs(user, CAN_MAKE) && (
            <div style={{ marginTop: 24, padding: 16, background: 'var(--slate-50)', border: '1px dashed var(--slate-300)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ margin: '0 0 8px 0', color: 'var(--slate-700)' }}>Invoice Letterhead / Template</h4>
                  <p style={{ fontSize: 14.5, color: 'var(--slate-500)', margin: 0 }}>
                    Please upload the Seller's invoice logo below. This logo will be displayed on the top left of the generated PDF.
                  </p>
                </div>
                <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                  Upload Logo
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
                </label>
              </div>
              {selected.logo_url && (
                <div style={{ marginTop: 16 }}>
                  <img src={selected.logo_url} alt="Logo" style={{ maxHeight: 60, objectFit: 'contain' }} />
                </div>
              )}

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--slate-200)' }}>
                <h4 style={{ margin: '0 0 8px 0', color: 'var(--slate-700)' }}>Invoice Authentication</h4>
                <p style={{ fontSize: 14.5, color: 'var(--slate-500)', margin: 0 }}>
                  No signature image is stored or printed. An approved invoice carries a system authentication seal in the
                  “For &amp; on behalf of” box instead: the authorised signatory named below, the date and time of approval (IST),
                  a SHA-256 hash of the invoice figures and an audit reference — so a copy that has been altered no longer matches,
                  and nobody’s handwritten signature can be lifted off a PDF and reused.
                </p>
                <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'flex-end' }}>
                  <Field label="Signatory Name">
                    <input
                      value={selected.signatory_name || ''}
                      onChange={e => setSelected({ ...selected, signatory_name: e.target.value })}
                    />
                  </Field>
                  <Field label="Designation">
                    <input
                      value={selected.signatory_designation || ''}
                      onChange={e => setSelected({ ...selected, signatory_designation: e.target.value })}
                    />
                  </Field>
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      try {
                        await api.entities.update(selected.id, {
                          signatory_name: selected.signatory_name || '',
                          signatory_designation: selected.signatory_designation || '',
                        });
                        notify('success', 'Signatory details saved', 'They appear in the authentication seal on this seller’s invoices.');
                        api.entities.get(selected.id).then(setSelected);
                        load();
                      } catch (err) {
                        fail('Signatory details were not saved', err, 'Failed to save signatory details');
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
          
          <div style={{ marginTop: 24 }}>
            <DocumentManager 
              moduleName="STAKEHOLDERS"
              entityId={selected.id} 
              title="Stakeholder Documents (KYC, Registration, etc.)" 
            />
          </div>

          {selected.status === 'PENDING' && actsAs(user, CAN_APPROVE) && (
            <div style={{ marginTop: 20, padding: 16, background: 'var(--slate-50)', borderRadius: 8, border: '1px solid var(--slate-200)' }}>
              <h4 style={{ margin: '0 0 8px 0' }}>Approval Action</h4>
              {!selected.regulatory_summary?.ready_for_approval && (
                <div
                  style={{
                    background: 'var(--t-amber-50)',
                    border: '1px solid var(--t-amber-line)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>⚠️</span>
                      <strong style={{ fontSize: 14.5, color: 'var(--on-amber)' }}>
                        Mandatory Regulatory Clearances Pending
                      </strong>
                    </div>
                    {selected.regulatory_summary?.blocking?.length > 0 && (
                      <span
                        style={{
                          fontSize: 14.5,
                          fontWeight: 600,
                          color: 'var(--amber-strong)',
                          background: 'var(--t-amber-100)',
                          padding: '2px 8px',
                          borderRadius: 12,
                          border: '1px solid var(--t-amber-100)',
                        }}
                      >
                        {selected.regulatory_summary.blocking.length} pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 15, color: 'var(--on-amber)', lineHeight: 1.45 }}>
                    Standard approval will remain on hold until mandatory regulatory clearances are verified or marked N/A in the checklist above.
                  </div>
                  {selected.regulatory_summary?.blocking?.length > 0 && (
                    <ul
                      style={{
                        margin: '10px 0 2px 0',
                        paddingLeft: 22,
                        listStyleType: 'disc',
                        color: 'var(--on-amber)',
                        fontSize: 14.5,
                        lineHeight: 1.6,
                      }}
                    >
                      {selected.regulatory_summary.blocking.map((code) => (
                        <li key={code}>
                          <span style={{ color: 'var(--on-amber)', fontWeight: 500 }}>{getRegulatoryItemLabel(code)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {!!selected.is_blacklisted && (
                <div style={{ fontSize: 14.5, color: 'var(--red-deep)', background: 'var(--t-red-50)', border: '1px solid var(--t-red-line)', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>
                  This stakeholder is blacklisted and cannot be approved until the blacklist is cleared.
                </div>
              )}
              <Field label="Remarks">
                <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required for rejection" />
              </Field>
              <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {actsAs(user, CAN_DIRECT_ADMIT) && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', boxShadow: '0 2px 6px rgba(5, 150, 105, 0.35)' }}
                    onClick={() => setPopup({
                      tone: 'warning',
                      title: 'Direct admission',
                      message: 'Directly admit and activate this stakeholder? Its mandatory clearances are marked verified by you. The bank account is not thereby verified: confirm it against the bank proof separately before any payment.',
                      okLabel: 'Back',
                      actions: <button type="button" className="btn btn-primary" onClick={() => { setPopup(null); handleApprove('APPROVED', true); }}>Admit</button>,
                    })}
                  >
                    Direct Admit & Activate Stakeholder
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => handleApprove('APPROVED')}>Standard Approval</button>
                <button className="btn btn-danger" onClick={() => handleApprove('REJECTED')}>Reject</button>
              </div>
            </div>
          )}
        </Modal>
      )}


      <Modal open={!!typesModal} onClose={() => setTypesModal(null)} title="Compliance documents" width={720}>
        {typesModal && (
          <div>
            <p style={{ fontSize: 15, color: 'var(--slate-600)', marginTop: 0 }}>
              The eight standard clearances are fixed. Add any other document SJVN wants on file. It joins every
              stakeholder's checklist and the Document Desk's upload list straight away.
            </p>
            <form
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                const name = typesModal.label.trim();
                if (name.length < 3) {
                  setPopup({ tone: 'warning', title: 'Name the document', message: 'Give the document a name of at least 3 characters, for example "Fire NOC" or "Forest Clearance".' });
                  return;
                }
                try {
                  const r = await api.entities.addClearanceType({ ...typesModal, is_mandatory: typesModal.is_mandatory === '1' });
                  await loadCatalogs();
                  setTypesModal({ label: '', applies_to: typesModal.applies_to, is_mandatory: '0', help: '' });
                  notify('success', 'Compliance document added', `"${r.label}" is now on the checklist of ${r.added_to_stakeholders} stakeholder(s) and in the Document Desk's upload list.`);
                } catch (err) {
                  fail('Could not add the document', err, 'The compliance document could not be added.');
                }
              }}
            >
              <div className="form-grid">
                <Field label="Document name" required>
                  <input value={typesModal.label} placeholder="e.g. Fire Safety NOC" onChange={(e) => setTypesModal({ ...typesModal, label: e.target.value })} />
                </Field>
                <Field label="Applies to">
                  <select value={typesModal.applies_to} onChange={(e) => setTypesModal({ ...typesModal, applies_to: e.target.value })}>
                    <option value="BOTH">Sellers and buyers</option>
                    <option value="SELLER">Sellers only</option>
                    <option value="BUYER">Buyers only</option>
                  </select>
                </Field>
                <Field label="Required for approval?">
                  <select value={typesModal.is_mandatory} onChange={(e) => setTypesModal({ ...typesModal, is_mandatory: e.target.value })}>
                    <option value="0">Optional — recorded, does not hold approval</option>
                    <option value="1">Mandatory — approval waits until verified</option>
                  </select>
                </Field>
                <Field label="Note for the team (optional)">
                  <input value={typesModal.help} placeholder="Why SJVN wants it" onChange={(e) => setTypesModal({ ...typesModal, help: e.target.value })} />
                </Field>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="submit" className="btn btn-primary">Add to checklist</button>
              </div>
            </form>
            <h4 style={{ margin: '20px 0 8px 0', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>Added so far</h4>
            {customTypes.length === 0 ? (
              <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>Nothing added yet.</div>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead><tr><th>Document</th><th>Applies to</th><th>Required</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {customTypes.map((t) => (
                    <tr key={t.code}>
                      <td>{t.label}</td>
                      <td>{t.applies_to === 'BOTH' ? 'Sellers and buyers' : t.applies_to === 'SELLER' ? 'Sellers' : 'Buyers'}</td>
                      <td>{t.is_mandatory ? 'Mandatory' : 'Optional'}</td>
                      <td><Badge status={t.is_active ? 'ACTIVE' : 'DRAFT'} label={t.is_active ? 'In use' : 'Retired'} /></td>
                      <td>
                        <button type="button" className="btn btn-xs btn-outline" onClick={async () => {
                          try {
                            await api.entities.setClearanceTypeActive(t.code, !t.is_active);
                            await loadCatalogs();
                          } catch (err) { fail('Could not change it', err, 'The change could not be saved.'); }
                        }}>{t.is_active ? 'Retire' : 'Bring back'}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ fontSize: 14.5, color: 'var(--slate-500)', marginBottom: 0 }}>
              Retiring keeps whatever is already filed against it. It only drops off stakeholders who have not started it, and off new ones.
            </p>
          </div>
        )}
      </Modal>

      <Modal open={!!callback} onClose={() => setCallback(null)} title="Bank change call-back" width={520}>
        {callback && (
          <form onSubmit={saveCallback} noValidate>
            <p style={{ fontSize: 14.5, color: 'var(--slate-600)', marginTop: 0 }}>
              Phone a number already on record for {selected?.name} (its corporate phone or a listed contact) — never one given with the change request — and ask them to confirm the new account.
            </p>
            <Field label="Person called" required><input value={callback.contact_name} onChange={(e) => setCallback({ ...callback, contact_name: e.target.value })} /></Field>
            <Field label="Number called" required><input value={callback.phone} inputMode="tel" onChange={(e) => setCallback({ ...callback, phone: e.target.value })} /></Field>
            <Field label="Called at"><input type="datetime-local" value={callback.called_at} onChange={(e) => setCallback({ ...callback, called_at: e.target.value })} /></Field>
            <Field label="Did they confirm the change?" required>
              <select value={callback.confirmed} onChange={(e) => setCallback({ ...callback, confirmed: e.target.value })}>
                <option value="">Select…</option>
                <option value="YES">Yes — confirmed the new account</option>
                <option value="NO">No — did not confirm</option>
              </select>
            </Field>
            <Field label="Notes"><textarea rows={2} value={callback.notes} onChange={(e) => setCallback({ ...callback, notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setCallback(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save call-back</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!editApproval} onClose={() => setEditApproval(null)} title={editApproval ? `Update: ${editApproval.label}` : 'Update approval'} width={560}>
        {editApproval && (
          <form onSubmit={saveApproval}>
            <Field label="Status">
              <select
                value={approvalForm.status}
                onChange={(e) => setApprovalForm({ ...approvalForm, status: e.target.value })}
              >
                {Object.entries(APPROVAL_STATUS_LABELS)
                  .filter(([code]) => code === editApproval.status || actsAs(user, DECIDING.includes(code) ? CAN_VERIFY : CAN_RECORD))
                  .map(([code, label]) => (
                    <option key={code} value={code} disabled={code !== editApproval.status && !actsAs(user, DECIDING.includes(code) ? CAN_VERIFY : CAN_RECORD)}>
                      {label}
                    </option>
                  ))}
              </select>
            </Field>
            {evidenceLocked && (
              <p style={{ fontSize: 14.5, color: 'var(--slate-500)', margin: '0 0 8px 0' }}>
                The REIA maker records these details. If they are wrong or missing, choose Rejected and say why in the note.
              </p>
            )}
            <div className="form-grid">
              <Field label="Reference / Approval No.">
                <input value={approvalForm.reference_no} readOnly={evidenceLocked} onChange={(e) => setApprovalForm({ ...approvalForm, reference_no: e.target.value })} placeholder="e.g. CEA/REG/2024/…" />
              </Field>
              <Field label="Issued By">
                <input value={approvalForm.issued_by} readOnly={evidenceLocked} onChange={(e) => setApprovalForm({ ...approvalForm, issued_by: e.target.value })} placeholder="CEA / MoEF / SERC / CTU…" />
              </Field>
              <Field label="Issued On">
                <input type="date" value={approvalForm.issued_on} readOnly={evidenceLocked} onChange={(e) => setApprovalForm({ ...approvalForm, issued_on: e.target.value })} />
              </Field>
              <Field label="Valid Until">
                <input type="date" value={approvalForm.valid_until} readOnly={evidenceLocked} onChange={(e) => setApprovalForm({ ...approvalForm, valid_until: e.target.value })} />
              </Field>
            </div>
            <Field label={approvalForm.status === 'NOT_APPLICABLE' ? 'Why N/A? (required for mandatory)' : 'Notes'}>
              <input
                value={approvalForm.notes}
                onChange={(e) => setApprovalForm({ ...approvalForm, notes: e.target.value })}
                placeholder="Optional context"
              />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditApproval(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!blacklistForm}
        onClose={() => setBlacklistForm(null)}
        title={blacklistForm?.blacklisted ? `Debarment & Blacklist Action` : `Clear Blacklist Restriction`}
        width="compact"
      >
        {blacklistForm && (
          <form onSubmit={saveBlacklist} style={{ margin: 0 }}>
            {blacklistForm.blacklisted ? (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '14px 16px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, var(--t-red-50) 0%, var(--t-red-50) 100%)',
                border: '1px solid var(--t-red-line)',
                marginBottom: 16,
              }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: 'var(--t-red-100)',
                  color: 'var(--red-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 2px 6px rgba(220, 38, 38, 0.15)',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--on-red)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Regulatory Debarment Action</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, background: 'var(--t-red-line)', color: 'var(--on-red)', padding: '1px 6px', borderRadius: 4 }}>RESTRICTED</span>
                  </div>
                  <div style={{ fontSize: 14.5, color: 'var(--on-red)', lineHeight: 1.45 }}>
                    Blacklisting prevents this stakeholder from receiving approvals or participating in new power contracts across SJVN platforms.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '14px 16px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, var(--t-green-50) 0%, var(--t-green-50) 100%)',
                border: '1px solid var(--t-green-line)',
                marginBottom: 16,
              }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: 'var(--t-green-100)',
                  color: 'var(--green-strong)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 2px 6px rgba(22, 163, 74, 0.15)',
                }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--on-green)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Restore Stakeholder</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, background: 'var(--t-green-line)', color: 'var(--on-green)', padding: '1px 6px', borderRadius: 4 }}>RE-ADMISSION</span>
                  </div>
                  <div style={{ fontSize: 14.5, color: 'var(--on-green)', lineHeight: 1.45 }}>
                    Clearing the debarment will restore normal standing, permitting fresh regulatory approvals and PPA/PSA allocations.
                  </div>
                </div>
              </div>
            )}

            {/* Entity Target Snapshot */}
            <div style={{
              background: 'var(--slate-50)',
              border: '1px solid var(--slate-200)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Target Stakeholder</span>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--slate-900)' }}>{selected?.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {selected?.entity_type && <Badge status={selected.entity_type} />}
                {selected?.pan_no && (
                  <span style={{ fontSize: 13.5, background: 'var(--surface)', border: '1px solid var(--slate-300)', padding: '2px 8px', borderRadius: 6, color: 'var(--slate-700)', fontFamily: 'monospace' }}>
                    PAN: {selected.pan_no}
                  </span>
                )}
              </div>
            </div>

            {/* Regulatory Guidance Box */}
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--slate-200)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 14,
              color: 'var(--slate-600)',
            }}>
              <div style={{ fontWeight: 600, color: 'var(--slate-800)', marginBottom: 5 }}>Legal & Operational Notes:</div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                <li><strong>New Allocations Barred:</strong> Cannot be approved or awarded new PPA / PSA contracts.</li>
                <li><strong>Existing Contracts Protected:</strong> Contracts already running, and payment dues owed, remain active.</li>
                <li><strong>Audit Trail:</strong> The justification and operating officer are permanently logged for CERC review.</li>
              </ul>
            </div>

            <Field label="Official Reason / Regulatory Authority Order Reference" required>
              <textarea
                required
                minLength={10}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1.5px solid var(--slate-300)',
                  fontSize: 15,
                  lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
                value={blacklistForm.reason}
                onChange={(e) => setBlacklistForm({ ...blacklistForm, reason: e.target.value })}
                placeholder={blacklistForm.blacklisted ? 'e.g. Debarred by MNRE Office Memorandum No. 283/54/2026 dated 14-Oct-2026' : 'e.g. Debarment revoked as per MNRE compliance order dated …'}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 13.5, color: 'var(--slate-500)' }}>
                <span>Recorded in the immutable compliance audit ledger</span>
                <span style={{ color: (blacklistForm.reason?.trim().length || 0) < 10 ? 'var(--red-strong)' : 'var(--green-strong)', fontWeight: 600 }}>
                  {blacklistForm.reason?.trim().length || 0} / 10 min chars
                </span>
              </div>
            </Field>

            <div className="form-actions" style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--slate-200)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setBlacklistForm(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className={blacklistForm.blacklisted ? 'btn btn-danger' : 'btn btn-success'}
                disabled={(blacklistForm.reason?.trim().length || 0) < 10}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                {blacklistForm.blacklisted ? (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                    <span>Confirm & Blacklist Stakeholder</span>
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Confirm & Restore Stakeholder</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Inline proof: preview a linked approval document */}
      <PreviewModal
        open={!!docPreview}
        versionId={docPreview?.versionId}
        fileName={docPreview?.fileName}
        onClose={() => setDocPreview(null)}
      />

      {/* Inline proof: upload against a specific regulatory approval (type locked) */}
      <UploadModal
        open={!!uploadFor}
        onClose={() => setUploadFor(null)}
        onSuccess={() => loadEntityDocs(selected?.id)}
        moduleName="STAKEHOLDERS"
        entityId={selected?.id}
        presetDocType={uploadFor?.code}
        presetTitle={uploadFor?.label}
      />

      {editModal && (
        <Modal open={true} onClose={() => setEditModal(null)} title={`Edit Stakeholder — ${editModal.name}`} width={900}>
          <form onSubmit={handleUpdate} noValidate>
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0' }}>1. Entity Hierarchy & Type</h4>
              <div className="form-grid">
                <Field label="Parent Group (Optional)">
                  <select value={editFormData.parent_entity_id} onChange={(e) => setEditFormData({ ...editFormData, parent_entity_id: e.target.value })}>
                    <option value="">-- None (This is a Parent Group) --</option>
                    {parents.filter(p => p.id !== editModal.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Entity Type">
                  <input value={editFormData.entity_type === 'SELLER' ? 'Seller (Generator)' : 'Buyer (Beneficiary / DISCOM)'} disabled style={{ background: 'var(--slate-100)', color: 'var(--slate-600)' }} />
                </Field>
                <Field label="Name" required>
                  <input value={editFormData.name} onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })} required />
                </Field>
                <Field
                  label={
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <span>Category</span>
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        style={{ padding: '1px 8px', fontSize: 12.5, fontWeight: 600 }}
                        onClick={() => setQuickAddLookup({ field: 'category', label: 'Category', category: 'ENTITY_CATEGORY', value: '', isEdit: true })}
                      >
                        + Add New
                      </button>
                    </span>
                  }
                  required
                >
                  <select
                    value={editFormData.category}
                    onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        setQuickAddLookup({ field: 'category', label: 'Category', category: 'ENTITY_CATEGORY', value: '', isEdit: true });
                      } else {
                        setEditFormData({ ...editFormData, category: e.target.value });
                      }
                    }}
                  >
                    <option value="">Select category…</option>
                    {(categories[editFormData.entity_type] || []).map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__NEW__">+ Add New Category...</option>
                  </select>
                </Field>
              </div>
            </div>

            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0' }}>2. Corporate & KYC</h4>
              <div className="form-grid">
                <Field label="PAN No">
                  <input value={editFormData.pan_no} onChange={(e) => setEditFormData({ ...editFormData, pan_no: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" />
                </Field>
                <Field label="GST No">
                  <input value={editFormData.gst_no} onChange={(e) => setEditFormData({ ...editFormData, gst_no: e.target.value.toUpperCase() })} placeholder="08ABCDE1234F1Z5" />
                </Field>
                <Field label="TAN No (Optional)">
                  <input value={editFormData.tan_no} onChange={(e) => setEditFormData({ ...editFormData, tan_no: e.target.value.toUpperCase() })} placeholder="DELA12345B" />
                </Field>
                <Field label="CIN (Optional)">
                  <input value={editFormData.cin} onChange={(e) => setEditFormData({ ...editFormData, cin: e.target.value.toUpperCase() })} placeholder="U40106RJ2016PTC012345" />
                </Field>
                <Field label="Corporate Email">
                  <input type="email" value={editFormData.corporate_email} onChange={(e) => setEditFormData({ ...editFormData, corporate_email: e.target.value })} />
                </Field>
                <Field label="Corporate Phone">
                  <input inputMode="tel" value={editFormData.corporate_phone} onChange={(e) => setEditFormData({ ...editFormData, corporate_phone: e.target.value })} />
                </Field>
                <Field label="Corporate Website">
                  <input value={editFormData.corporate_website} onChange={(e) => setEditFormData({ ...editFormData, corporate_website: e.target.value })} placeholder="www.company.in" />
                </Field>
                <Field label="Address">
                  <input value={editFormData.address} onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })} />
                </Field>
                <Field label="Credit Rating">
                  <select value={editFormData.credit_rating} onChange={(e) => setEditFormData({ ...editFormData, credit_rating: e.target.value })}>
                    <option value="">Select rating…</option>
                    {CREDIT_RATING_OPTIONS.map(cr => <option key={cr} value={cr}>{cr}</option>)}
                  </select>
                </Field>
                <Field label="Authorised Signatory Name">
                  <input value={editFormData.signatory_name} onChange={(e) => setEditFormData({ ...editFormData, signatory_name: e.target.value })} placeholder="Named in the invoice authentication seal" />
                </Field>
                <Field label="Signatory Designation">
                  <input value={editFormData.signatory_designation} onChange={(e) => setEditFormData({ ...editFormData, signatory_designation: e.target.value })} placeholder="e.g. DGM (Finance)" />
                </Field>
              </div>
            </div>

            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0' }}>3. Technical & Banking</h4>
              <div className="form-grid">
                {editFormData.entity_type === 'SELLER' && (
                  <>
                    <Field
                      label={
                        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                          <span>Technology</span>
                          <button
                            type="button"
                            className="btn btn-xs btn-outline"
                            style={{ padding: '1px 8px', fontSize: 12.5, fontWeight: 600 }}
                            onClick={() => setQuickAddLookup({ field: 'technology', label: 'Technology', category: 'TECHNOLOGY', value: '', isEdit: true })}
                          >
                            + Add New
                          </button>
                        </span>
                      }
                    >
                      <select
                        value={editFormData.technology}
                        onChange={(e) => {
                          if (e.target.value === '__NEW__') {
                            setQuickAddLookup({ field: 'technology', label: 'Technology', category: 'TECHNOLOGY', value: '', isEdit: true });
                          } else {
                            setEditFormData({ ...editFormData, technology: e.target.value });
                          }
                        }}
                      >
                        <option value="">Select technology…</option>
                        {technologies.map(t => <option key={t} value={t}>{t}</option>)}
                        <option value="__NEW__">+ Add New Technology...</option>
                      </select>
                    </Field>
                    <Field label="Capacity (MW)">
                      <input type="number" step="0.01" min="0" value={editFormData.capacity_mw} onChange={(e) => setEditFormData({ ...editFormData, capacity_mw: e.target.value })} />
                    </Field>
                  </>
                )}
                {editFormData.entity_type === 'BUYER' && (
                  <>
                    <Field label="Contracted Capacity (MW)">
                      <input type="number" step="0.01" min="0" value={editFormData.contracted_capacity_mw} onChange={(e) => setEditFormData({ ...editFormData, contracted_capacity_mw: e.target.value })} />
                    </Field>
                    <Field label="PSA Tariff (₹/kWh)">
                      <input type="number" step="0.01" min="0" value={editFormData.psa_tariff} onChange={(e) => setEditFormData({ ...editFormData, psa_tariff: e.target.value })} />
                    </Field>
                    <Field label="Criteria for Supply of Power">
                      <select value={editFormData.supply_criteria} onChange={(e) => setEditFormData({ ...editFormData, supply_criteria: e.target.value })}>
                        <option value="">Select criteria…</option>
                        {SUPPLY_CRITERIA_OPTIONS.map(sc => <option key={sc} value={sc}>{sc}</option>)}
                      </select>
                    </Field>
                  </>
                )}
                <Field label="Bank Name">
                  <input value={editFormData.bank_name} onChange={(e) => setEditFormData({ ...editFormData, bank_name: e.target.value })} />
                </Field>
                <Field label="Account No">
                  <input inputMode="numeric" value={editFormData.account_no} onChange={(e) => setEditFormData({ ...editFormData, account_no: e.target.value })} placeholder="9 to 18 digits" />
                </Field>
                <Field label="IFSC Code">
                  <input value={editFormData.ifsc_code} onChange={(e) => setEditFormData({ ...editFormData, ifsc_code: e.target.value.toUpperCase() })} placeholder="SBIN0001234" />
                </Field>
                <Field label="Branch Address">
                  <input value={editFormData.branch_address} onChange={(e) => setEditFormData({ ...editFormData, branch_address: e.target.value })} />
                </Field>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn btn-outline" onClick={() => setEditModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={editSubmitting}>
                {editSubmitting ? 'Saving Changes…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {quickAddLookup && (
        <Modal open={true} onClose={() => setQuickAddLookup(null)} title={`Add New ${quickAddLookup.label}`}>
          <form onSubmit={(e) => { e.preventDefault(); handleCreateLookup(quickAddLookup.category, quickAddLookup.value, quickAddLookup.field, quickAddLookup.isEdit); }}>
            <Field label={`${quickAddLookup.label} Name`}>
              <input
                required
                autoFocus
                placeholder={`e.g. New ${quickAddLookup.label}`}
                value={quickAddLookup.value || ''}
                onChange={(e) => setQuickAddLookup({ ...quickAddLookup, value: e.target.value })}
              />
            </Field>
            <p className="inline-note" style={{ marginTop: 4 }}>
              This will be saved to Master Data (<code>{quickAddLookup.category}</code>) and immediately available for selection.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setQuickAddLookup(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={quickAddSaving || !quickAddLookup?.value?.trim()}>
                {quickAddSaving ? 'Saving...' : 'Save & Select'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <AlertPopup
        open={!!popup}
        tone={popup?.tone}
        title={popup?.title}
        message={popup?.message}
        items={popup?.items}
        actions={popup?.actions}
        okLabel={popup?.okLabel}
        onClose={() => setPopup(null)}
      />
    </div>
  );
}
