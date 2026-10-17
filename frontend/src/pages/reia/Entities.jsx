import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, fmtNumber } from '../../components/ui.jsx';
import { DocumentManager, PreviewModal, UploadModal } from '../../components/DocumentManager.jsx';
import { fmtDate } from '../../datetime.js';
import { catalogForEntityType, APPROVAL_STATUS_LABELS, getRegulatoryItemLabel } from '../../constants/regulatoryApprovals.js';
import { ROLE_GROUPS } from '../../roles.js';
import {
  KYC_RULES, FIELD_LABELS, normaliseKycInput, fieldError, validateStakeholderForm,
  CATEGORY_OPTIONS, CREDIT_RATING_OPTIONS, TECHNOLOGY_OPTIONS, SUPPLY_CRITERIA_OPTIONS, VERTICAL_LABELS,
} from '../../lib/kycValidation.js';

// The desks that onboard: REIA for its sellers and buyers, Commercial for a
// hydro or thermal station's beneficiaries. Mirrors ENTITY_WRITE on the server,
// which is what actually decides. A counterparty's own login edits its profile
// through the API, not on this screen.
const CAN_WRITE = [...new Set([...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.HYDRO_THERMAL_WRITE, ...ROLE_GROUPS.THERMAL_WRITE])];
const CAN_APPROVE = CAN_WRITE;
const CAN_VERIFY = CAN_WRITE;
const CAN_DIRECT_ADMIT = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'];
// Barring a counterparty is an administrator's decision.
const CAN_BLACKLIST = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'];

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

export default function Entities({ vertical = 'REIA' }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [parents, setParents] = useState([]);
  const [filters, setFilters] = useState({ entity_type: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(() => emptyForm(vertical));
  const [fieldErrors, setFieldErrors] = useState({});
  // The one message on screen that has to be read: { tone, title, message, items, actions }.
  const [popup, setPopup] = useState(null);
  // The last value each field was flagged for, so leaving a field that is still
  // wrong does not raise the same popup a second time.
  const alerted = useRef({});
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [editApproval, setEditApproval] = useState(null);
  const [approvalForm, setApprovalForm] = useState({});
  const [blacklistForm, setBlacklistForm] = useState(null); // { blacklisted, reason }
  const [ownReason, setOwnReason] = useState('');
  const [editModal, setEditModal] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [editSubmitting, setEditSubmitting] = useState(false);
  // Proof documents linked to each regulatory approval (matched by shared code).
  const [entityDocs, setEntityDocs] = useState([]);
  const [docPreview, setDocPreview] = useState(null);   // { versionId, fileName }
  const [uploadFor, setUploadFor] = useState(null);      // { code, label }

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

  const kSelect = (field, label, options, { required, placeholder = 'Select…' } = {}) => (
    <KField id={`sk-${field}`} label={label} required={required} error={fieldErrors[field]}>
      <select id={`sk-${field}`} value={form[field] ?? ''} onChange={(e) => setField(field, e.target.value)}>
        <option value="">{placeholder}</option>
        {/* A value already on record that is not in today's list is still shown. */}
        {form[field] && !options.includes(form[field]) && <option value={form[field]}>{form[field]}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </KField>
  );

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
        const item = catalogForEntityType(form.entity_type).find((c) => c.code === code);
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
        {r.parent_name && <div style={{fontSize: 13, color: '#666'}}>Parent: {r.parent_name}</div>}
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
        {CAN_WRITE.includes(user?.role) && (
          <button type="button" className="btn btn-xs btn-outline" onClick={() => startEdit(r)}>Edit</button>
        )}
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader
        title={vertical === 'REIA' ? 'Stakeholder Onboarding' : `Stakeholder Onboarding — ${VERTICAL_LABELS[vertical]}`}
        subtitle={vertical === 'REIA'
          ? 'Manage RE Generators, DISCOMs, SPVs, KYC and Regulatory Approvals'
          : `Beneficiaries and generating companies billed under ${VERTICAL_LABELS[vertical]} — KYC, bank and regulatory approvals`}
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={openCreate}>+ Onboard Stakeholder</button>}
      />

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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={`Onboard New Stakeholder — ${VERTICAL_LABELS[vertical]}`} width={900}>
        {/* noValidate: the checks below run in one pass and report in a popup,
            instead of the browser stopping at the first empty box. */}
        <form onSubmit={handleCreate} noValidate>
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
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
              {kSelect('category', 'Category', CATEGORY_OPTIONS[form.entity_type] || [], { required: true, placeholder: 'Select category…' })}
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
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

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>3. Technical & Banking</h4>
            <div className="form-grid">
              {form.entity_type === 'SELLER' && (
                <>
                  {kSelect('technology', 'Technology', TECHNOLOGY_OPTIONS, { placeholder: 'Select technology…' })}
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

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>4. Regulatory Approvals Checklist</h4>
            <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 0 }}>
              Specific clearances required for {form.entity_type === 'SELLER' ? 'sellers' : 'buyers'}.
              After create, upload supporting docs and mark each item Submitted / Verified.
              Mark <strong>N/A</strong> only where genuinely not applicable (with a note).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {catalogForEntityType(form.entity_type).map((item) => {
                const na = Object.prototype.hasOwnProperty.call(form.regulatory_na, item.code);
                return (
                  <div
                    key={item.code}
                    style={{
                      border: '1px solid var(--slate-200)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      background: na ? 'var(--slate-50)' : '#fff',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {item.label}
                          {item.is_mandatory ? (
                            <span style={{ color: 'var(--red-deep)', marginLeft: 6, fontSize: 13 }}>Required</span>
                          ) : (
                            <span style={{ color: 'var(--slate-500)', marginLeft: 6, fontSize: 13 }}>Optional</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>{item.help}</div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, whiteSpace: 'nowrap' }}>
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

          <div style={{ padding: '12px 16px', background: '#eef2ff', borderRadius: 6, color: '#4f46e5', fontSize: 13, marginBottom: 20 }}>
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
            <span style={{ fontSize: 13, color: 'var(--slate-500)' }}>
              {selected.parent_name ? `SPV of ${selected.parent_name}` : 'Parent Entity'} · {selected.category || 'General'}
            </span>
            {CAN_WRITE.includes(user?.role) && (
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
                        <div style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 4 }}>
                          {selected.is_blacklisted ? 'Blacklisted' : 'Cleared'}
                          {selected.blacklisted_by ? ` by ${selected.blacklisted_by}` : ''}
                          {selected.blacklisted_at ? ` on ${fmtDate(selected.blacklisted_at)}` : ''}
                          {selected.blacklist_reason ? ` — ${selected.blacklist_reason}` : ''}
                        </div>
                      )}
                      {CAN_BLACKLIST.includes(user?.role) && (
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
                  {selected.entity_type === 'SELLER' && (
                    <tr>
                      <td>SJVN own station</td>
                      <td>
                        {selected.is_sjvn_own ? <Badge status="ACTIVE" label="SJVN's own — developer KYC does not apply" /> : <span>No — a developer</span>}
                        {['SJVN_ADMIN', 'IT_SUPER_ADMIN'].includes(user?.role) && (
                          <form style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }} onSubmit={async (e) => {
                            e.preventDefault();
                            try {
                              const updated = await api.entities.setOwnStation(selected.id, { is_sjvn_own: !selected.is_sjvn_own, reason: ownReason });
                              setSelected({ ...selected, ...updated });
                              setOwnReason('');
                              load();
                              notify('success', 'Saved', updated.is_sjvn_own ? `${updated.name} is marked as SJVN's own station.` : `${updated.name} is treated as a developer again.`);
                            } catch (err) {
                              fail('Not changed', err, 'Could not change the own-station flag');
                            }
                          }}>
                            <input value={ownReason} onChange={(e) => setOwnReason(e.target.value)} placeholder="Why (at least 10 characters)" style={{ minWidth: 220 }} aria-label="Reason for own-station change" />
                            <button type="submit" className="btn btn-sm btn-outline" disabled={ownReason.trim().length < 10}>{selected.is_sjvn_own ? 'Treat as a developer' : "Mark as SJVN's own station"}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ flex: 1, minWidth: 300 }}>
              <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Bank & Technical</h4>
              <table className="detail-table">
                <tbody>
                  <tr>
                    <td>Bank Details</td>
                    <td>
                      <div>{selected.account_no || '-'}, {selected.bank_name || '-'}</div>
                      <div style={{fontSize: 13, color: '#666'}}>IFSC: {selected.ifsc_code || '-'} | Branch: {selected.branch_address || '-'}</div>
                      <div style={{ marginTop: 6 }}>
                        {selected.is_penny_drop_verified
                          ? <Badge status="ACTIVE" label="Bank verified" />
                          : <Badge status="PENDING" label={selected.status === 'APPROVED' ? 'Bank not verified' : 'Verified on approval'} />}
                        {/* A record approved before approval started confirming the account
                            has no other way to be cleared for payment. */}
                        {!selected.is_penny_drop_verified && selected.status === 'APPROVED' && CAN_WRITE.includes(user?.role) && (
                          <button type="button" className="btn btn-sm btn-outline" style={{ marginLeft: 8 }} onClick={confirmBank}>
                            Confirm against bank proof
                          </button>
                        )}
                      </div>
                      {selected.pending_bank_json && (
                        <div style={{ fontSize: 13, color: 'var(--amber-strong)', marginTop: 4 }}>
                          A change of bank account is waiting. It becomes the live account when this record is re-approved.
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
          
          <h4 style={{ margin: '20px 0 8px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Regulatory Approvals</h4>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginTop: 0 }}>
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
                  background: '#fff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{item.label}</strong>
                    <Badge status={item.status === 'VERIFIED' ? 'ACTIVE' : item.status === 'NOT_APPLICABLE' ? 'DRAFT' : 'PENDING'} label={APPROVAL_STATUS_LABELS[item.status] || item.status} />
                    {item.is_mandatory ? <span style={{ fontSize: 13, color: 'var(--red-deep)' }}>Required</span> : <span style={{ fontSize: 13, color: 'var(--slate-500)' }}>Optional</span>}
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 4 }}>
                    {item.reference_no ? `Ref: ${item.reference_no} · ` : ''}
                    {item.issued_by ? `Issuer: ${item.issued_by} · ` : ''}
                    {item.issued_on ? `Issued: ${item.issued_on} · ` : ''}
                    {item.valid_until ? `Valid till: ${item.valid_until}` : ''}
                    {!item.reference_no && !item.issued_by && !item.issued_on && !item.valid_until ? 'No details yet' : ''}
                  </div>
                  {item.notes && <div style={{ fontSize: 13.5, color: 'var(--slate-600)', marginTop: 2 }}>{item.notes}</div>}
                  {item.verified_by && (
                    <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 2 }}>
                      Verified by {item.verified_by}{item.verified_at ? ` · ${fmtDate(item.verified_at)}` : ''}
                    </div>
                  )}
                  {(() => {
                    const proof = docForCode(item.approval_code);
                    const vs = proof?.verification_status;
                    // SJVN Admin and REIA users can directly upload and verify proofs; stakeholders can also upload from portal.
                    const canUpload = ['SJVN_ADMIN', 'REIA_USER', 'REIA_ADMIN', 'IT_SUPER_ADMIN'].includes(user?.role) || !['FINANCE_USER', 'TRADING_USER'].includes(user?.role);
                    return (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {proof ? (
                          <>
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: vs === 'VERIFIED' ? '#15803d' : vs === 'REJECTED' ? '#b91c1c' : '#b45309' }}>
                               {vs === 'VERIFIED' ? 'Proof verified' : vs === 'REJECTED' ? 'Proof rejected' : 'Proof uploaded — pending review'}
                            </span>
                            <button type="button" className="link-btn" style={{ fontSize: 13.5 }} onClick={() => setDocPreview({ versionId: proof.latest_version_id, fileName: proof.file_name })}>
                               View proof
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: 13.5, color: 'var(--text-subtle)' }}>
                            No proof uploaded
                            {canUpload ? (
                              <button type="button" className="link-btn" style={{ fontSize: 13.5, marginLeft: 6 }} onClick={() => setUploadFor({ code: item.approval_code, label: item.label })}>
                                Upload
                              </button>
                            ) : ' · awaiting stakeholder upload'}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {CAN_WRITE.includes(user?.role) && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => openApprovalEditor(item)}>Update</button>
                )}
              </div>
            ))}
          </div>

          <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Contacts</h4>
          {selected.contacts?.length > 0 ? (
            <Table columns={[{key:'type', header:'Role', render: r=>r.contact_type}, {key:'name', header:'Name'}, {key:'email', header:'Email'}, {key:'phone', header:'Phone'}]} rows={selected.contacts} />
          ) : <div style={{ fontSize: 13, color: '#666' }}>No contacts found.</div>}

          {selected.entity_type === 'SELLER' && CAN_WRITE.includes(user?.role) && (
            <div style={{ marginTop: 24, padding: 16, background: 'var(--slate-50)', border: '1px dashed var(--slate-300)', borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ margin: '0 0 8px 0', color: 'var(--slate-700)' }}>Invoice Letterhead / Template</h4>
                  <p style={{ fontSize: 13, color: 'var(--slate-500)', margin: 0 }}>
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
                  <img src={`http://localhost:4000${selected.logo_url}`} alt="Logo" style={{ maxHeight: 60, objectFit: 'contain' }} />
                </div>
              )}

              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--slate-200)' }}>
                <h4 style={{ margin: '0 0 8px 0', color: 'var(--slate-700)' }}>Invoice Authentication</h4>
                <p style={{ fontSize: 13, color: 'var(--slate-500)', margin: 0 }}>
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

          {selected.status === 'PENDING' && CAN_APPROVE.includes(user?.role) && (
            <div style={{ marginTop: 20, padding: 16, background: 'var(--slate-50)', borderRadius: 8, border: '1px solid var(--slate-200)' }}>
              <h4 style={{ margin: '0 0 8px 0' }}>Approval Action</h4>
              {!selected.regulatory_summary?.ready_for_approval && (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    padding: '12px 14px',
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>⚠️</span>
                      <strong style={{ fontSize: 13, color: '#92400e' }}>
                        Mandatory Regulatory Clearances Pending
                      </strong>
                    </div>
                    {selected.regulatory_summary?.blocking?.length > 0 && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#b45309',
                          background: '#fef3c7',
                          padding: '2px 8px',
                          borderRadius: 12,
                          border: '1px solid #fcd34d',
                        }}
                      >
                        {selected.regulatory_summary.blocking.length} pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13.5, color: '#78350f', lineHeight: 1.45 }}>
                    Standard approval will remain on hold until mandatory regulatory clearances are verified or marked N/A in the checklist above.
                  </div>
                  {selected.regulatory_summary?.blocking?.length > 0 && (
                    <ul
                      style={{
                        margin: '10px 0 2px 0',
                        paddingLeft: 22,
                        listStyleType: 'disc',
                        color: '#92400e',
                        fontSize: 13,
                        lineHeight: 1.6,
                      }}
                    >
                      {selected.regulatory_summary.blocking.map((code) => (
                        <li key={code}>
                          <span style={{ color: '#78350f', fontWeight: 500 }}>{getRegulatoryItemLabel(code)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {!!selected.is_blacklisted && (
                <div style={{ fontSize: 13, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>
                  This stakeholder is blacklisted and cannot be approved until the blacklist is cleared.
                </div>
              )}
              <Field label="Remarks">
                <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required for rejection" />
              </Field>
              <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {CAN_DIRECT_ADMIT.includes(user?.role) && (
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

      <Modal open={!!editApproval} onClose={() => setEditApproval(null)} title={editApproval ? `Update: ${editApproval.label}` : 'Update approval'} width={560}>
        {editApproval && (
          <form onSubmit={saveApproval}>
            <Field label="Status">
              <select
                value={approvalForm.status}
                onChange={(e) => setApprovalForm({ ...approvalForm, status: e.target.value })}
              >
                {Object.entries(APPROVAL_STATUS_LABELS)
                  .filter(([code]) => CAN_VERIFY.includes(user?.role) || code !== 'VERIFIED' || editApproval.status === 'VERIFIED')
                  .map(([code, label]) => (
                    <option key={code} value={code} disabled={code === 'VERIFIED' && !CAN_VERIFY.includes(user?.role)}>
                      {label}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Reference / Approval No.">
                <input value={approvalForm.reference_no} onChange={(e) => setApprovalForm({ ...approvalForm, reference_no: e.target.value })} placeholder="e.g. CEA/REG/2024/…" />
              </Field>
              <Field label="Issued By">
                <input value={approvalForm.issued_by} onChange={(e) => setApprovalForm({ ...approvalForm, issued_by: e.target.value })} placeholder="CEA / MoEF / SERC / CTU…" />
              </Field>
              <Field label="Issued On">
                <input type="date" value={approvalForm.issued_on} onChange={(e) => setApprovalForm({ ...approvalForm, issued_on: e.target.value })} />
              </Field>
              <Field label="Valid Until">
                <input type="date" value={approvalForm.valid_until} onChange={(e) => setApprovalForm({ ...approvalForm, valid_until: e.target.value })} />
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
                background: 'linear-gradient(135deg, #fff5f5 0%, #fef2f2 100%)',
                border: '1px solid #fecaca',
                marginBottom: 16,
              }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: '#fee2e2',
                  color: '#dc2626',
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
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Regulatory Debarment Action</span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: '#fecaca', color: '#991b1b', padding: '1px 6px', borderRadius: 4 }}>RESTRICTED</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.45 }}>
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
                background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
                border: '1px solid #bbf7d0',
                marginBottom: 16,
              }}>
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: '#dcfce7',
                  color: '#16a34a',
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
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Restore Stakeholder</span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: '#bbf7d0', color: '#166534', padding: '1px 6px', borderRadius: 4 }}>RE-ADMISSION</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#14532d', lineHeight: 1.45 }}>
                    Clearing the debarment will restore normal standing, permitting fresh regulatory approvals and PPA/PSA allocations.
                  </div>
                </div>
              </div>
            )}

            {/* Entity Target Snapshot */}
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
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
                <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Target Stakeholder</span>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a' }}>{selected?.name}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {selected?.entity_type && <Badge status={selected.entity_type} />}
                {selected?.pan_no && (
                  <span style={{ fontSize: 12, background: '#fff', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: 6, color: '#334155', fontFamily: 'monospace' }}>
                    PAN: {selected.pan_no}
                  </span>
                )}
              </div>
            </div>

            {/* Regulatory Guidance Box */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              fontSize: 12.5,
              color: '#475569',
            }}>
              <div style={{ fontWeight: 600, color: '#1e293b', marginBottom: 5 }}>Legal & Operational Notes:</div>
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
                  border: '1.5px solid #cbd5e1',
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  boxSizing: 'border-box',
                }}
                value={blacklistForm.reason}
                onChange={(e) => setBlacklistForm({ ...blacklistForm, reason: e.target.value })}
                placeholder={blacklistForm.blacklisted ? 'e.g. Debarred by MNRE Office Memorandum No. 283/54/2026 dated 14-Oct-2026' : 'e.g. Debarment revoked as per MNRE compliance order dated …'}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 12, color: '#64748b' }}>
                <span>Recorded in the immutable compliance audit ledger</span>
                <span style={{ color: (blacklistForm.reason?.trim().length || 0) < 10 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                  {blacklistForm.reason?.trim().length || 0} / 10 min chars
                </span>
              </div>
            </Field>

            <div className="form-actions" style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
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
            <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
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
                <Field label="Category" required>
                  <select value={editFormData.category} onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}>
                    <option value="">Select category…</option>
                    {(CATEGORY_OPTIONS[editFormData.entity_type] || []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
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

            <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 12px 0' }}>3. Technical & Banking</h4>
              <div className="form-grid">
                {editFormData.entity_type === 'SELLER' && (
                  <>
                    <Field label="Technology">
                      <select value={editFormData.technology} onChange={(e) => setEditFormData({ ...editFormData, technology: e.target.value })}>
                        <option value="">Select technology…</option>
                        {TECHNOLOGY_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
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
