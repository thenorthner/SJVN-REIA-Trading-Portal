import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];

// Must stay in lockstep with backend CONTRACT_TRANSITIONS. A draft is not yet
// signed or regulator-cleared, so ACTIVE is not a legal next hop from DRAFT.
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

function allowedNextStatuses(current) {
  return CONTRACT_TRANSITIONS[current] || [];
}

function lifecycleHint(current) {
  if (current === 'DRAFT') {
    return 'This contract is still a draft. Mark it SIGNED first (or UNDER_NEGOTIATION), then you can move it to ACTIVE.';
  }
  if (current === 'UNDER_NEGOTIATION') {
    return 'Once terms are agreed, mark it SIGNED. ACTIVE is available after signing.';
  }
  if (current === 'SIGNED') {
    return 'Signed contracts can go ACTIVE directly, or via PENDING_REGULATORY_APPROVAL if a clearance is still outstanding.';
  }
  return '';
}

const EMPTY_FORM = {
  contract_no: '', contract_type: 'PPA', seller_id: '', buyer_id: '', project_type: 'Solar', capacity_mw: '',
  tariff_type: 'FLAT', tariff_per_unit: '', tariff_structure: null, 
  tenure_start: '', tenure_end: '', billing_cycle: 'MONTHLY',
  emd_amount: '', pbg_amount: '', pbg_type: '', pbg_expiry: '', trading_margin_per_mwh: '',
  // Structured billing rules (drive due dates, rebate & LPS calculations)
  payment_terms_days: 30, rebate_pct: '', rebate_days: '', rebate_basis: 'BILL_DATE',
  lps_annual_pct: '', lps_grace_days: 0, payment_security_type: 'LETTER_OF_CREDIT',
  min_cuf_percent: '',
  projects: []
};

function renderTariffStructure(selected) {
  if (!selected) return null;
  let ts = selected.tariff_structure;
  if (!ts && selected.tariff_structure_json) {
    try {
      ts = typeof selected.tariff_structure_json === 'string' ? JSON.parse(selected.tariff_structure_json) : selected.tariff_structure_json;
    } catch (e) {
      ts = null;
    }
  }
  if (!ts || typeof ts !== 'object' || Object.keys(ts).length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
      {Object.entries(ts).map(([k, v]) => {
        let display;
        try {
          display = v != null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        } catch {
          display = '';
        }
        return (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--slate-100, #f1f5f9)', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
            <span style={{ color: 'var(--slate-600, #475569)', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}:</span>
            <span style={{ fontWeight: 600 }}>{display}</span>
          </div>
        );
      })}
    </div>
  );
}

const SECURITY_TYPES = [
  { value: 'LETTER_OF_CREDIT', label: 'Letter of Credit (LC)' },
  { value: 'BANK_GUARANTEE', label: 'Bank Guarantee (BG)' },
  { value: 'CORPUS_FUND', label: 'Corpus Fund' },
  { value: 'PAYMENT_SECURITY_FUND', label: 'Payment Security Fund' },
  { value: 'ESCROW', label: 'Escrow Account' },
  { value: 'NONE', label: 'None' },
];

// Live human-readable preview so the user sees exactly what the rule will do.
function previewRebate(f) {
  if (!f.rebate_pct) return 'No early-payment rebate';
  const ref = f.rebate_basis === 'DUE_DATE' ? 'due date' : 'bill date';
  return `${f.rebate_pct}% rebate if paid within ${f.rebate_days || 0} days from ${ref}`;
}
function previewLps(f) {
  if (!f.lps_annual_pct) return 'No late-payment surcharge';
  const grace = f.lps_grace_days ? ` after a ${f.lps_grace_days}-day grace period` : '';
  return `${f.lps_annual_pct}% per annum on the overdue amount${grace}`;
}

export default function Contracts() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [filters, setFilters] = useState({ contract_type: '', status: '', project_type: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [uploadFile, setUploadFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [amendError, setAmendError] = useState('');
  const [selected, setSelected] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [amendForm, setAmendForm] = useState(null);
  const [requirements, setRequirements] = useState([]);
  const [syncMsg, setSyncMsg] = useState('');
  const [statusForm, setStatusForm] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [allocationForm, setAllocationForm] = useState(null);

  async function downloadContractPdf() {
    setPdfLoading(true);
    try {
      const params = {};
      if (filters.contract_type) params.contract_type = filters.contract_type;
      if (filters.status) params.status = filters.status;
      if (filters.project_type) params.project_type = filters.project_type;
      if (filters.q) params.q = filters.q;
      await api.reports.contractSummaryPdf(params);
    } catch (err) {
      alert(err.message || 'Failed to download contract PDF');
    } finally {
      setPdfLoading(false);
    }
  }
  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.contracts.list(params)
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_type, filters.status, filters.project_type, filters.q]);

  useEffect(() => {
    // Only approved entities
    api.entities.list({ entity_type: 'SELLER', status: 'APPROVED' }).then((d) => setSellers(Array.isArray(d) ? d : [])).catch(() => setSellers([]));
    api.entities.list({ entity_type: 'BUYER', status: 'APPROVED' }).then((d) => setBuyers(Array.isArray(d) ? d : [])).catch(() => setBuyers([]));
  }, []);

  function openDetail(row) {
    api.contracts.get(row.id).then(setSelected).catch(() => setSelected(row));
    api.paymentSecurity.requirements(row.id).then((d) => setRequirements(Array.isArray(d) ? d : [])).catch(() => setRequirements([]));
    if (row.contract_type === 'PPA') {
      api.contracts.allocations(row.id).then((d) => setAllocations(Array.isArray(d) ? d : [])).catch(() => setAllocations([]));
    } else {
      setAllocations([]);
    }
    setAmendForm(null);
    setStatusForm(null);
    setSyncMsg('');
    setStatusError('');
    setAmendError('');
  }

  async function syncSecurity() {
    if (!selected) return;
    try {
      const res = await api.paymentSecurity.fromContract(selected.id);
      setRequirements(res.requirements || []);
      setSyncMsg(`Synced — ${res.created?.length || 0} new instrument(s)`);
    } catch (err) {
      setSyncMsg(err.response?.data?.error || 'Sync failed');
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const created = await api.contracts.create({
        ...form,
        seller_id: form.contract_type === 'PPA' ? form.seller_id : null,
        buyer_id: form.contract_type === 'PSA' ? form.buyer_id : null,
        capacity_mw: Number(form.capacity_mw),
        tariff_per_unit: Number(form.tariff_per_unit),
        emd_amount: form.emd_amount ? Number(form.emd_amount) : null,
        pbg_amount: form.pbg_amount ? Number(form.pbg_amount) : null,
      });

      if (uploadFile && created?.id) {
        try {
          const fd = new FormData();
          fd.append('file', uploadFile);
          fd.append('contract_id', created.id);
          fd.append('document_type', 'CONTRACT');
          fd.append('category', 'RECORD');
          fd.append('title', `${form.contract_no} Agreement`);
          await api.documents.upload(fd);
        } catch (uploadErr) {
          console.warn('Document upload warning:', uploadErr);
        }
      }

      setShowCreate(false);
      setForm(EMPTY_FORM);
      setUploadFile(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create contract.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAmend(e) {
    e.preventDefault();
    setAmendError('');
    setSubmitting(true);
    try {
      const updated = await api.contracts.amend(selected.id, amendForm);
      setSelected(updated);
      setAmendForm(null);
      load();
    } catch (err) {
      setAmendError(err.response?.data?.error || 'Failed to amend contract.');
    } finally {
      setSubmitting(false);
    }
  }
  
  async function handleStatusChange(e) {
    e.preventDefault();
    setStatusError('');
    setSubmitting(true);
    try {
      const updated = await api.contracts.updateStatus(selected.id, statusForm);
      setSelected(updated);
      setStatusForm(null);
      load();
    } catch (err) {
      const data = err.response?.data;
      const allowed = data?.allowed_transitions?.length
        ? ` Allowed next: ${data.allowed_transitions.join(', ')}.`
        : '';
      setStatusError((data?.error || 'Failed to update contract status.') + allowed);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddAllocation(e) {
    e.preventDefault();
    try {
      await api.contracts.addAllocation(selected.id, allocationForm);
      setAllocationForm(null);
      api.contracts.allocations(selected.id).then(setAllocations);
    } catch(err) {
      alert(err.response?.data?.error || 'Failed to map allocation');
    }
  }

  const columns = [
    { key: 'contract_no', header: 'Contract No.' },
    { key: 'contract_type', header: 'Type', render: (r) => <Badge status={r.contract_type} /> },
    { key: 'party', header: 'Counterparty', render: (r) => r.seller_name || r.buyer_name || '-' },
    { key: 'capacity_mw', header: 'Capacity', render: (r) => (
      <div>
        <div style={{fontWeight: 600}}>{fmtNumber(r.capacity_mw)} MW</div>
        {r.commissioned_capacity_mw > 0 && <div style={{fontSize: 11, color:'#22c55e'}}>{fmtNumber(r.commissioned_capacity_mw)} MW COD</div>}
      </div>
    )},
    { key: 'tariff', header: 'Tariff', render: (r) => (
      <div>
        <div>₹{r.tariff_per_unit}/u</div>
        <div style={{fontSize: 11, color:'#666'}}>{r.tariff_type}</div>
      </div>
    )},
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Contract Management (PPA / PSA)"
        subtitle="Create, amend and track Contract Lifecycle, COD and Complex Tariffs"
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={pdfLoading} onClick={downloadContractPdf}>
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
            </button>
            {CAN_WRITE.includes(user?.role) && (
              <button className="btn btn-secondary" onClick={() => setShowCreate(true)}>+ New Contract</button>
            )}
          </div>
        }
      />

      <div className="filters-bar">
        <input type="search" placeholder="Search contract no..." value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.contract_type} onChange={(e) => setFilters({ ...filters, contract_type: e.target.value })}>
          <option value="">All types</option>
          <option value="PPA">PPA</option>
          <option value="PSA">PSA</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'UNDER_NEGOTIATION', 'SIGNED', 'PENDING_REGULATORY_APPROVAL', 'ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'TERMINATED', 'CLOSED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No contracts found.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Contract" width={800}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>1. Basic Details</h4>
            <div className="form-grid">
              <Field label="Contract No."><input required value={form.contract_no} onChange={(e) => setForm({ ...form, contract_no: e.target.value })} /></Field>
              <Field label="Contract Type">
                <select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
                  <option value="PPA">PPA (Seller → SJVN)</option>
                  <option value="PSA">PSA (SJVN → Buyer)</option>
                </select>
              </Field>
              {form.contract_type === 'PPA' ? (
                <Field label="Seller">
                  <select required value={form.seller_id} onChange={(e) => setForm({ ...form, seller_id: e.target.value })}>
                    <option value="">Select seller...</option>
                    {sellers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.parent_name ? 'SPV' : 'Parent'})</option>)}
                  </select>
                </Field>
              ) : (
                <Field label="Buyer">
                  <select required value={form.buyer_id} onChange={(e) => setForm({ ...form, buyer_id: e.target.value })}>
                    <option value="">Select buyer...</option>
                    {buyers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Project Type">
                <select value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })}>
                  <option value="Solar">Solar</option>
                  <option value="Wind">Wind</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="FDRE">FDRE</option>
                  <option value="PeakPower">Peak Power</option>
                  <option value="PSP">Pumped Storage (PSP)</option>
                  <option value="Storage">BESS / Storage</option>
                </select>
              </Field>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>2. Capacity & Tariff Structure</h4>
            <div className="form-grid">
              <Field label="Total Capacity (MW)"><input required type="number" step="0.01" value={form.capacity_mw} onChange={(e) => setForm({ ...form, capacity_mw: e.target.value })} /></Field>
              <Field label="Tariff Type">
                <select value={form.tariff_type} onChange={(e) => setForm({ ...form, tariff_type: e.target.value })}>
                  <option value="FLAT">Flat / Fixed</option>
                  <option value="TWO_PART">Two-Part (Fixed + Variable)</option>
                  <option value="ESCALATING">Escalating / Indexed</option>
                  <option value="SLAB">Time of Day / Slab</option>
                </select>
              </Field>
              <Field label="Base Tariff (₹/unit)"><input required type="number" step="0.01" value={form.tariff_per_unit} onChange={(e) => setForm({ ...form, tariff_per_unit: e.target.value })} /></Field>
              {form.contract_type === 'PSA' && (
                <Field label="Trading Margin (₹/MWh) — optional">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Blank = global default (₹70/MWh)"
                    value={form.trading_margin_per_mwh}
                    onChange={(e) => setForm({ ...form, trading_margin_per_mwh: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Billing Cycle">
                <select value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="DAILY">Daily</option>
                </select>
              </Field>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>3. Tenure & Payment Security</h4>
            <div className="form-grid">
              <Field label="Tenure Start"><input required type="date" value={form.tenure_start} onChange={(e) => setForm({ ...form, tenure_start: e.target.value })} /></Field>
              <Field label="Tenure End"><input required type="date" value={form.tenure_end} onChange={(e) => setForm({ ...form, tenure_end: e.target.value })} /></Field>
              <Field label="PBG / Security Amount (₹)"><input type="number" value={form.pbg_amount} onChange={(e) => setForm({ ...form, pbg_amount: e.target.value })} /></Field>
              <Field label="Security Type"><input placeholder="BG / LC / ISB" value={form.pbg_type} onChange={(e) => setForm({ ...form, pbg_type: e.target.value })} /></Field>
            </div>
          </div>
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>4. Billing &amp; Regulatory Rules (CERC)</h4>

            {/* Payment terms → drives the invoice due date */}
            <div className="rule-block">
              <div className="rule-block-label">Payment Terms</div>
              <div className="rule-inline">
                <span>Payment is due</span>
                <input type="number" min="0" className="rule-num" required value={form.payment_terms_days}
                  onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
                <span>days from the bill date.</span>
              </div>
              <div className="rule-preview">Due date auto-calculates as <strong>bill date + {form.payment_terms_days || 0} days</strong>.</div>
            </div>

            {/* Early-payment rebate */}
            <div className="rule-block">
              <div className="rule-block-label">Early-Payment Rebate</div>
              <div className="rule-inline">
                <input type="number" step="0.01" min="0" className="rule-num" placeholder="2" value={form.rebate_pct}
                  onChange={(e) => setForm({ ...form, rebate_pct: e.target.value })} />
                <span>% rebate if paid within</span>
                <input type="number" min="0" className="rule-num" placeholder="5" value={form.rebate_days}
                  onChange={(e) => setForm({ ...form, rebate_days: e.target.value })} />
                <span>days from</span>
                <select className="rule-select" value={form.rebate_basis}
                  onChange={(e) => setForm({ ...form, rebate_basis: e.target.value })}>
                  <option value="BILL_DATE">bill date</option>
                  <option value="DUE_DATE">due date</option>
                </select>
              </div>
              <div className="rule-preview">{previewRebate(form)}</div>
            </div>

            {/* Late-payment surcharge */}
            <div className="rule-block">
              <div className="rule-block-label">Late-Payment Surcharge (LPS)</div>
              <div className="rule-inline">
                <input type="number" step="0.01" min="0" className="rule-num" placeholder="15" value={form.lps_annual_pct}
                  onChange={(e) => setForm({ ...form, lps_annual_pct: e.target.value })} />
                <span>% per annum, charged after a grace of</span>
                <input type="number" min="0" className="rule-num" placeholder="0" value={form.lps_grace_days}
                  onChange={(e) => setForm({ ...form, lps_grace_days: e.target.value })} />
                <span>days past due.</span>
              </div>
              <div className="rule-preview">{previewLps(form)}</div>
            </div>

            {/* Payment security mechanism */}
            <div className="rule-block" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
              <div className="rule-block-label">Payment Security Mechanism</div>
              <select className="rule-select" style={{ minWidth: 260 }} value={form.payment_security_type}
                onChange={(e) => setForm({ ...form, payment_security_type: e.target.value })}>
                {SECURITY_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {['Hydro', 'PSP'].includes(form.project_type) && (
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#0369a1' }}>4b. Hydro-Specific Parameters (CERC)</h4>
            <div className="form-grid">
              <Field label="Annual Fixed Charges AFC (₹)">
                <input type="number" step="1" placeholder="e.g. 14615741000" value={form.annual_afc || ''} onChange={(e) => setForm({ ...form, annual_afc: e.target.value })} />
              </Field>
              <Field label="Annual Design Energy DE (MWh)">
                <input type="number" step="0.001" placeholder="e.g. 6612000" value={form.annual_design_energy_mwh || ''} onChange={(e) => setForm({ ...form, annual_design_energy_mwh: e.target.value })} />
              </Field>
              <Field label="NAPAF (%)">
                <input type="number" step="0.01" placeholder="e.g. 87" value={form.napaf_percent || ''} onChange={(e) => setForm({ ...form, napaf_percent: e.target.value })} />
              </Field>
              <Field label="Normative Auxiliary Consumption (%)"><input type="number" step="0.01" placeholder="e.g. 1.2" value={form.normative_aux || ''} onChange={(e) => setForm({ ...form, normative_aux: e.target.value })} /></Field>
              <Field label="Free Energy to Home State (%)"><input type="number" step="0.01" placeholder="e.g. 12" value={form.free_energy_home_state || ''} onChange={(e) => setForm({ ...form, free_energy_home_state: e.target.value })} /></Field>
              <Field label="Legacy Monthly Capacity (₹ AFC/12) — optional fallback">
                <input type="number" step="1" placeholder="only if AFC blank" value={form.capacity_charges_total || ''} onChange={(e) => setForm({ ...form, capacity_charges_total: e.target.value })} />
              </Field>
              <Field label="Transmission / Wheeling (₹/MWh)">
                <input type="number" step="0.01" placeholder="Blank = master default" value={form.transmission_charge_per_mwh || ''} onChange={(e) => setForm({ ...form, transmission_charge_per_mwh: e.target.value })} />
              </Field>
            </div>
            <p style={{ fontSize: 12, color: 'var(--slate-500)', margin: '8px 0 0' }}>
              Capacity = AFC × 0.5 × days/year × (PAFM/NAPAF). ECR from AFC &amp; DE. PAFM comes from energy data availability %. β incentive = (3% × β × 0.5 × AFC)/12.
            </p>
          </div>
          )}

          {['Solar', 'Wind', 'Hybrid', 'FDRE'].includes(form.project_type) && (
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#0369a1' }}>4b. CUF Performance Threshold</h4>
            <div className="form-grid">
              <Field label="Min / Guaranteed CUF (%)">
                <input type="number" step="0.01" min="0" max="100" placeholder="Blank = master default (Solar 22 / Wind 30 / Hybrid 25)" value={form.min_cuf_percent || ''} onChange={(e) => setForm({ ...form, min_cuf_percent: e.target.value })} />
              </Field>
            </div>
            <p style={{ fontSize: 12, color: 'var(--slate-500)', margin: '8px 0 0' }}>
              If actual CUF (from energy data) is below this threshold, invoice generate applies a shortfall penalty = shortfall MWh × tariff (or master ₹/MWh rate).
            </p>
          </div>
          )}

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>5. Supporting Document</h4>
            <div className="form-grid">
              <Field label="Contract Document (PDF/Word)">
                <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setUploadFile(e.target.files[0])} />
              </Field>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Draft Contract</button>
          </div>
        </form>
      </Modal>

      {selected && !amendForm && !statusForm && (
        <Modal open={true} onClose={() => setSelected(null)} title={`Contract: ${selected.contract_no}`} width={800}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Contract Info</h4>
              <table className="detail-table">
                <tbody>
                  <tr><td>Type</td><td><Badge status={selected.contract_type} /></td></tr>
                  <tr><td>Status</td><td><Badge status={selected.status} /></td></tr>
                  <tr><td>Counterparty</td><td>{selected.seller_name || selected.buyer_name || '-'}</td></tr>
                  <tr><td>Project</td><td>{selected.project_type}</td></tr>
                  <tr><td>Total Capacity</td><td>{fmtNumber(selected.capacity_mw)} MW</td></tr>
                  <tr><td>Commissioned / COD</td><td>
                    {selected.commissioned_capacity_mw > 0 ? (
                      <span style={{color: '#22c55e', fontWeight: 600}}>{fmtNumber(selected.commissioned_capacity_mw)} MW (COD: {selected.cod_date})</span>
                    ) : (
                      <Badge status="PENDING" label="Not Commissioned" />
                    )}
                  </td></tr>
                  {selected.status === 'TERMINATED' && (
                    <>
                      <tr><td>Termination Date</td><td>{selected.termination_date}</td></tr>
                      <tr><td>Termination Reason</td><td>{selected.termination_reason}</td></tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
            
            <div style={{ flex: 1, minWidth: 300 }}>
              <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Commercials</h4>
              <table className="detail-table">
                <tbody>
                  <tr><td>Tariff Type</td><td>{selected.tariff_type}</td></tr>
                  <tr><td>Tariff / Unit</td><td>₹{selected.tariff_per_unit}</td></tr>
                  {['Solar', 'Wind', 'Hybrid', 'FDRE'].includes(selected.project_type) && (
                    <tr><td>Min CUF %</td><td>{selected.min_cuf_percent != null ? `${selected.min_cuf_percent}%` : 'Master default'}</td></tr>
                  )}
                  {selected.contract_type === 'PSA' && (
                    <tr><td>Trading Margin</td><td>{selected.trading_margin_per_mwh != null
                      ? `₹${selected.trading_margin_per_mwh}/MWh (contract-specific)`
                      : 'Global default (₹70/MWh)'}</td></tr>
                  )}
                  {renderTariffStructure(selected) && (
                    <tr><td>Tariff Structure</td><td>{renderTariffStructure(selected)}</td></tr>
                  )}
                  <tr><td>Tenure</td><td>{selected.tenure_start} to {selected.tenure_end}</td></tr>
                  <tr><td>PBG / EMD</td><td>{fmtCurrency(selected.pbg_amount)} {selected.pbg_type && `(${selected.pbg_type})`}</td></tr>
                  <tr><td>Payment Terms</td><td>{selected.payment_terms_days != null ? `Net ${selected.payment_terms_days} days from bill date` : (selected.payment_terms || '-')}</td></tr>
                  <tr><td>Rebate Rule</td><td>{selected.rebate_rule || '-'}</td></tr>
                  <tr><td>LPS Rule</td><td>{selected.lps_rule || '-'}</td></tr>
                  <tr><td>Payment Security</td><td>{(SECURITY_TYPES.find((s) => s.value === selected.payment_security_type) || {}).label || selected.payment_security_type || '-'}</td></tr>
                  <tr><td>Remarks</td><td>{selected.remarks || '-'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Projects Mapped</h4>
          {selected.projects?.length > 0 ? (
            <Table columns={[{key:'name', header:'Project SPV'}, {key:'capacity', header:'Allocated (MW)', render: r=>r.allocated_capacity_mw}]} rows={selected.projects} />
          ) : <div style={{ fontSize: 13, color: '#666' }}>No projects mapped.</div>}

          {selected.contract_type === 'PPA' && (
            <>
              <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>PSA Allocations (Energy Split)</h4>
              {allocations.length > 0 ? (
                <Table 
                  columns={[
                    {key:'psa_no', header:'PSA Number'}, 
                    {key:'buyer_name', header:'DISCOM (Buyer)'}, 
                    {key:'allocation_percent', header:'Allocation %', render: r => `${r.allocation_percent}%`},
                    {key:'effective', header:'Effective Dates', render: r => `${r.effective_from} to ${r.effective_to || 'Active'}`}
                  ]} 
                  rows={allocations} 
                />
              ) : <div style={{ fontSize: 13, color: '#666' }}>No PSAs mapped to this PPA yet.</div>}

              {allocationForm ? (
                <form onSubmit={handleAddAllocation} style={{ marginTop: 16, padding: 16, border: '1px solid var(--slate-200)', borderRadius: 8 }}>
                  <h5 style={{ margin: '0 0 12px 0' }}>Map new PSA to this PPA</h5>
                  <div className="form-grid">
                    <Field label="Select PSA">
                      <select required value={allocationForm.psa_id} onChange={e => setAllocationForm({...allocationForm, psa_id: e.target.value})}>
                        <option value="">Select PSA...</option>
                        {rows.filter(r => r && r.contract_type === 'PSA').map(psa => (
                          <option key={psa.id} value={psa.id}>{psa.contract_no} - {psa.buyer_name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Allocation %"><input required type="number" step="0.01" min="0.01" max="100" value={allocationForm.allocation_percent} onChange={e => setAllocationForm({...allocationForm, allocation_percent: e.target.value})} /></Field>
                    <Field label="Effective From"><input required type="date" value={allocationForm.effective_from} onChange={e => setAllocationForm({...allocationForm, effective_from: e.target.value})} /></Field>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="submit" className="btn btn-primary btn-sm">Save Map</button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setAllocationForm(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setAllocationForm({ psa_id: '', allocation_percent: '', effective_from: new Date().toISOString().split('T')[0] })}>
                    + Map PSA to PPA
                  </button>
                </div>
              )}
            </>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            {CAN_WRITE.includes(user?.role) && selected.status !== 'CLOSED' && selected.status !== 'TERMINATED' && (
              <>
                <button className="btn btn-outline" onClick={() => {
                  const next = allowedNextStatuses(selected.status);
                  setStatusError('');
                  setStatusForm({
                    status: next[0] || selected.status,
                    remarks: '',
                    termination_date: '',
                    termination_reason: '',
                  });
                }}>Update Lifecycle Stage</button>
                <button className="btn btn-outline" onClick={() => setAmendForm(selected)}>Amend Contract</button>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Lifecycle Modal */}
      {statusForm && (
        <Modal open={true} onClose={() => { setStatusForm(null); setStatusError(''); }} title="Update Contract Lifecycle Stage">
          <form onSubmit={handleStatusChange}>
            {statusError && (
              <div className="alert alert-danger" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #f87171', color: '#b91c1c', fontSize: 13 }}>
                {statusError}
              </div>
            )}
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#475569' }}>
              Current stage: <strong>{selected?.status}</strong>
            </p>
            {lifecycleHint(selected?.status) && (
              <p style={{ margin: '0 0 14px', fontSize: 12, lineHeight: 1.45, color: '#64748b' }}>
                {lifecycleHint(selected?.status)}
              </p>
            )}
            <Field label="New Status">
              <select
                value={allowedNextStatuses(selected?.status).includes(statusForm.status) ? statusForm.status : (allowedNextStatuses(selected?.status)[0] || '')}
                onChange={e => setStatusForm({...statusForm, status: e.target.value})}
                disabled={!allowedNextStatuses(selected?.status).length}
              >
                {allowedNextStatuses(selected?.status).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            {statusForm.status === 'TERMINATED' && (
              <div className="form-grid" style={{marginTop: 12}}>
                <Field label="Termination Date"><input type="date" required value={statusForm.termination_date} onChange={e => setStatusForm({...statusForm, termination_date: e.target.value})} /></Field>
                <Field label="Reason (For Cause / For Convenience)"><input required value={statusForm.termination_reason} onChange={e => setStatusForm({...statusForm, termination_reason: e.target.value})} /></Field>
              </div>
            )}
            <Field label="Remarks">
              <input value={statusForm.remarks || ''} onChange={e => setStatusForm({...statusForm, remarks: e.target.value})} placeholder="e.g. Approved by board / commissioning phase" />
            </Field>
            <div className="form-actions" style={{marginTop: 20}}>
              <button type="button" className="btn btn-ghost" onClick={() => { setStatusForm(null); setStatusError(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || !allowedNextStatuses(selected?.status).length}>
                {submitting ? 'Updating...' : 'Update Status'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Amendment Modal */}
      {amendForm && (
        <Modal open={true} onClose={() => { setAmendForm(null); setAmendError(''); }} title={`Amend Contract: ${amendForm.contract_no}`}>
          <form onSubmit={handleAmend}>
            {amendError && (
              <div className="alert alert-danger" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#fef2f2', border: '1px solid #f87171', color: '#b91c1c', fontSize: 13 }}>
                {amendError}
              </div>
            )}
            <div className="form-grid">
              <Field label="Capacity (MW)"><input type="number" step="0.01" value={amendForm.capacity_mw} onChange={(e) => setAmendForm({ ...amendForm, capacity_mw: e.target.value })} /></Field>
              <Field label="Commissioned (MW)"><input type="number" step="0.01" value={amendForm.commissioned_capacity_mw} onChange={(e) => setAmendForm({ ...amendForm, commissioned_capacity_mw: e.target.value })} /></Field>
              <Field label="COD Date"><input type="date" value={amendForm.cod_date || ''} onChange={(e) => setAmendForm({ ...amendForm, cod_date: e.target.value })} /></Field>
              <Field label="Tariff (₹/unit)"><input type="number" step="0.01" value={amendForm.tariff_per_unit} onChange={(e) => setAmendForm({ ...amendForm, tariff_per_unit: e.target.value })} /></Field>
              {['Solar', 'Wind', 'Hybrid', 'FDRE'].includes(amendForm.project_type) && (
                <Field label="Min / Guaranteed CUF (%)">
                  <input type="number" step="0.01" min="0" max="100" value={amendForm.min_cuf_percent ?? ''} onChange={(e) => setAmendForm({ ...amendForm, min_cuf_percent: e.target.value })} />
                </Field>
              )}
            </div>
            <Field label="Amendment Reason">
              <input required value={amendForm.amendment_reason || ''} onChange={(e) => setAmendForm({ ...amendForm, amendment_reason: e.target.value })} placeholder="Why is this being amended?" />
            </Field>
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setAmendForm(null); setAmendError(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Submitting...' : `Submit Amendment (Creates v${(amendForm.version || 1) + 1})`}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
