import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];

const EMPTY_FORM = {
  contract_no: '', contract_type: 'PPA', seller_id: '', buyer_id: '', project_type: 'Solar', capacity_mw: '',
  tariff_per_unit: '', tenure_start: '', tenure_end: '', billing_cycle: 'MONTHLY', payment_terms: '',
  emd_amount: '', pbg_amount: '', pbg_type: '', pbg_expiry: '',
};

export default function Contracts() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [filters, setFilters] = useState({ contract_type: '', status: '', project_type: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [amendForm, setAmendForm] = useState(null);

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.contracts.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_type, filters.status, filters.project_type, filters.q]);

  useEffect(() => {
    api.entities.list({ entity_type: 'SELLER', status: 'APPROVED' }).then(setSellers).catch(() => {});
    api.entities.list({ entity_type: 'BUYER', status: 'APPROVED' }).then(setBuyers).catch(() => {});
  }, []);

  function openDetail(row) {
    api.contracts.get(row.id).then(setSelected);
    setAmendForm(null);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.contracts.create({
        ...form,
        seller_id: form.contract_type === 'PPA' ? form.seller_id : null,
        buyer_id: form.contract_type === 'PSA' ? form.buyer_id : null,
        capacity_mw: Number(form.capacity_mw),
        tariff_per_unit: Number(form.tariff_per_unit),
        emd_amount: form.emd_amount ? Number(form.emd_amount) : null,
        pbg_amount: form.pbg_amount ? Number(form.pbg_amount) : null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create contract.');
    }
  }

  async function handleAmend(e) {
    e.preventDefault();
    const updated = await api.contracts.amend(selected.id, amendForm);
    setSelected(null);
    setAmendForm(null);
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract No.' },
    { key: 'contract_type', header: 'Type', render: (r) => <Badge status={r.contract_type} /> },
    { key: 'party', header: 'Counterparty', render: (r) => r.seller_name || r.buyer_name || '-' },
    { key: 'project_type', header: 'Project' },
    { key: 'capacity_mw', header: 'Capacity (MW)', render: (r) => fmtNumber(r.capacity_mw) },
    { key: 'tariff_per_unit', header: 'Tariff (₹/unit)', render: (r) => r.tariff_per_unit },
    { key: 'tenure', header: 'Tenure', render: (r) => `${r.tenure_start} → ${r.tenure_end}` },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Contract Management (PPA / PSA)"
        subtitle="Create, amend and track Power Purchase and Power Sale Agreements"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Contract</button>}
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
          {['DRAFT', 'ACTIVE', 'AMENDED', 'EXPIRED', 'TERMINATED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.project_type} onChange={(e) => setFilters({ ...filters, project_type: e.target.value })}>
          <option value="">All project types</option>
          {['Solar', 'Wind', 'Hybrid', 'FDRE', 'PeakPower', 'PSP', 'Storage'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No contracts found.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New Contract" width={680}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <Field label="Contract No.">
              <input required value={form.contract_no} onChange={(e) => setForm({ ...form, contract_no: e.target.value })} />
            </Field>
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
                  {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Buyer">
                <select required value={form.buyer_id} onChange={(e) => setForm({ ...form, buyer_id: e.target.value })}>
                  <option value="">Select buyer...</option>
                  {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Project Type">
              <select value={form.project_type} onChange={(e) => setForm({ ...form, project_type: e.target.value })}>
                {['Solar', 'Wind', 'Hybrid', 'FDRE', 'PeakPower', 'PSP', 'Storage'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Capacity (MW)">
              <input required type="number" step="0.01" value={form.capacity_mw} onChange={(e) => setForm({ ...form, capacity_mw: e.target.value })} />
            </Field>
            <Field label="Tariff (₹/unit)">
              <input required type="number" step="0.01" value={form.tariff_per_unit} onChange={(e) => setForm({ ...form, tariff_per_unit: e.target.value })} />
            </Field>
            <Field label="Tenure Start">
              <input required type="date" value={form.tenure_start} onChange={(e) => setForm({ ...form, tenure_start: e.target.value })} />
            </Field>
            <Field label="Tenure End">
              <input required type="date" value={form.tenure_end} onChange={(e) => setForm({ ...form, tenure_end: e.target.value })} />
            </Field>
            <Field label="Billing Cycle">
              <select value={form.billing_cycle} onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}>
                {['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Payment Terms">
              <input placeholder="Net 30 days" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} />
            </Field>
            <Field label="EMD Amount (₹)">
              <input type="number" value={form.emd_amount} onChange={(e) => setForm({ ...form, emd_amount: e.target.value })} />
            </Field>
            <Field label="PBG Amount (₹)">
              <input type="number" value={form.pbg_amount} onChange={(e) => setForm({ ...form, pbg_amount: e.target.value })} />
            </Field>
            <Field label="PBG Type">
              <select value={form.pbg_type} onChange={(e) => setForm({ ...form, pbg_type: e.target.value })}>
                <option value="">None</option>
                <option value="BG">Bank Guarantee</option>
                <option value="ISB">ISB</option>
                <option value="POI">POI</option>
              </select>
            </Field>
            <Field label="PBG Expiry">
              <input type="date" value={form.pbg_expiry} onChange={(e) => setForm({ ...form, pbg_expiry: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Contract</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.contract_no} width={680}>
        {selected && (
          <div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value"><Badge status={selected.contract_type} /></span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Counterparty</span><span className="detail-value">{selected.seller_name || selected.buyer_name}</span></div>
              <div className="detail-item"><span className="detail-label">Project Type</span><span className="detail-value">{selected.project_type}</span></div>
              <div className="detail-item"><span className="detail-label">Capacity</span><span className="detail-value">{fmtNumber(selected.capacity_mw)} MW</span></div>
              <div className="detail-item"><span className="detail-label">Tariff</span><span className="detail-value">₹{selected.tariff_per_unit}/unit</span></div>
              <div className="detail-item"><span className="detail-label">Tenure</span><span className="detail-value">{selected.tenure_start} → {selected.tenure_end}</span></div>
              <div className="detail-item"><span className="detail-label">Billing Cycle</span><span className="detail-value">{selected.billing_cycle}</span></div>
              <div className="detail-item"><span className="detail-label">Payment Terms</span><span className="detail-value">{selected.payment_terms || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">EMD</span><span className="detail-value">{fmtCurrency(selected.emd_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">PBG</span><span className="detail-value">{fmtCurrency(selected.pbg_amount)} {selected.pbg_type ? `(${selected.pbg_type})` : ''}</span></div>
              <div className="detail-item"><span className="detail-label">Version</span><span className="detail-value">v{selected.version}</span></div>
            </div>

            {selected.versions?.length > 1 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Version History</div>
                <div className="timeline">
                  {selected.versions.map((v) => (
                    <div className="timeline-item" key={v.id}>
                      {v.contract_no} — v{v.version} <Badge status={v.status} />
                      <div className="t-meta">{v.created_at}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {CAN_WRITE.includes(user?.role) && selected.status === 'ACTIVE' && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Amend Contract</div>
                {!amendForm ? (
                  <button className="btn btn-secondary" onClick={() => setAmendForm({ tariff_per_unit: selected.tariff_per_unit, capacity_mw: selected.capacity_mw, amendment_reason: '' })}>
                    Start Amendment
                  </button>
                ) : (
                  <form onSubmit={handleAmend}>
                    <div className="form-grid">
                      <Field label="Revised Tariff (₹/unit)">
                        <input type="number" step="0.01" value={amendForm.tariff_per_unit} onChange={(e) => setAmendForm({ ...amendForm, tariff_per_unit: Number(e.target.value) })} />
                      </Field>
                      <Field label="Revised Capacity (MW)">
                        <input type="number" step="0.01" value={amendForm.capacity_mw} onChange={(e) => setAmendForm({ ...amendForm, capacity_mw: Number(e.target.value) })} />
                      </Field>
                    </div>
                    <Field label="Amendment Reason">
                      <textarea required value={amendForm.amendment_reason} onChange={(e) => setAmendForm({ ...amendForm, amendment_reason: e.target.value })} />
                    </Field>
                    <div className="form-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => setAmendForm(null)}>Cancel</button>
                      <button type="submit" className="btn btn-primary">Submit Amendment (creates v{selected.version + 1})</button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
