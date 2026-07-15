import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];

const EMPTY_FORM = {
  contract_no: '', contract_type: 'PPA', seller_id: '', buyer_id: '', project_type: 'Solar', capacity_mw: '',
  tariff_type: 'FLAT', tariff_per_unit: '', tariff_structure: {}, 
  tenure_start: '', tenure_end: '', billing_cycle: 'MONTHLY', payment_terms: '',
  emd_amount: '', pbg_amount: '', pbg_type: '', pbg_expiry: '', projects: []
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
  const [requirements, setRequirements] = useState([]);
  const [syncMsg, setSyncMsg] = useState('');
  const [statusForm, setStatusForm] = useState(null);

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.contracts.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_type, filters.status, filters.project_type, filters.q]);

  useEffect(() => {
    // Only approved entities
    api.entities.list({ entity_type: 'SELLER', status: 'APPROVED' }).then(setSellers).catch(() => {});
    api.entities.list({ entity_type: 'BUYER', status: 'APPROVED' }).then(setBuyers).catch(() => {});
  }, []);

  function openDetail(row) {
    api.contracts.get(row.id).then(setSelected);
    api.paymentSecurity.requirements(row.id).then(setRequirements).catch(() => setRequirements([]));
    setAmendForm(null);
    setStatusForm(null);
    setSyncMsg('');
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
    const updated = await api.client.post(`/reia/contracts/${selected.id}/amend`, amendForm).then(r=>r.data);
    setSelected(updated);
    setAmendForm(null);
    load();
  }
  
  async function handleStatusChange(e) {
    e.preventDefault();
    const updated = await api.client.post(`/reia/contracts/${selected.id}/status`, statusForm).then(r=>r.data);
    setSelected(updated);
    setStatusForm(null);
    load();
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

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Draft Contract</button>
          </div>
        </form>
      </Modal>

      {selected && !amendForm && !statusForm && (
        <Modal open={true} onClose={() => setSelected(null)} title={\`Contract: \${selected.contract_no}\`} width={800}>
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
                  {selected.tariff_structure_json && <tr><td>Structure JSON</td><td><pre style={{fontSize: 10}}>{selected.tariff_structure_json}</pre></td></tr>}
                  <tr><td>Tenure</td><td>{selected.tenure_start} to {selected.tenure_end}</td></tr>
                  <tr><td>PBG / EMD</td><td>{fmtCurrency(selected.pbg_amount)} {selected.pbg_type && \`(\${selected.pbg_type})\`}</td></tr>
                  <tr><td>Remarks</td><td>{selected.remarks || '-'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Projects Mapped</h4>
          {selected.projects?.length > 0 ? (
            <Table columns={[{key:'name', header:'Project SPV'}, {key:'capacity', header:'Allocated (MW)', render: r=>r.allocated_capacity_mw}]} rows={selected.projects} />
          ) : <div style={{ fontSize: 13, color: '#666' }}>No projects mapped.</div>}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            {CAN_WRITE.includes(user?.role) && selected.status !== 'CLOSED' && selected.status !== 'TERMINATED' && (
              <>
                <button className="btn btn-outline" onClick={() => setStatusForm({ status: selected.status, remarks: '', termination_date: '', termination_reason: '' })}>Update Lifecycle Stage</button>
                <button className="btn btn-outline" onClick={() => setAmendForm(selected)}>Amend Contract</button>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Lifecycle Modal */}
      {statusForm && (
        <Modal open={true} onClose={() => setStatusForm(null)} title="Update Contract Lifecycle Stage">
          <form onSubmit={handleStatusChange}>
            <Field label="New Status">
              <select value={statusForm.status} onChange={e => setStatusForm({...statusForm, status: e.target.value})}>
                {['DRAFT', 'UNDER_NEGOTIATION', 'SIGNED', 'PENDING_REGULATORY_APPROVAL', 'ACTIVE', 'NEARING_EXPIRY', 'EXPIRED', 'RENEWED', 'TERMINATED', 'CLOSED'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            {statusForm.status === 'TERMINATED' && (
              <div className="form-grid" style={{marginTop: 12}}>
                <Field label="Termination Date"><input type="date" required value={statusForm.termination_date} onChange={e => setStatusForm({...statusForm, termination_date: e.target.value})} /></Field>
                <Field label="Reason (For Cause / For Convenience)"><input required value={statusForm.termination_reason} onChange={e => setStatusForm({...statusForm, termination_reason: e.target.value})} /></Field>
              </div>
            )}
            <Field label="Remarks">
              <input value={statusForm.remarks} onChange={e => setStatusForm({...statusForm, remarks: e.target.value})} />
            </Field>
            <div className="form-actions" style={{marginTop: 20}}>
              <button type="button" className="btn btn-ghost" onClick={() => setStatusForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Update Status</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Amendment Modal */}
      {amendForm && (
        <Modal open={true} onClose={() => setAmendForm(null)} title="Amend Contract">
          <form onSubmit={handleAmend}>
            <div className="form-grid">
              <Field label="Capacity (MW)"><input type="number" step="0.01" value={amendForm.capacity_mw} onChange={(e) => setAmendForm({ ...amendForm, capacity_mw: e.target.value })} /></Field>
              <Field label="Commissioned (MW)"><input type="number" step="0.01" value={amendForm.commissioned_capacity_mw} onChange={(e) => setAmendForm({ ...amendForm, commissioned_capacity_mw: e.target.value })} /></Field>
              <Field label="COD Date"><input type="date" value={amendForm.cod_date || ''} onChange={(e) => setAmendForm({ ...amendForm, cod_date: e.target.value })} /></Field>
              <Field label="Tariff (₹/unit)"><input type="number" step="0.01" value={amendForm.tariff_per_unit} onChange={(e) => setAmendForm({ ...amendForm, tariff_per_unit: e.target.value })} /></Field>
            </div>
            <Field label="Amendment Reason">
              <input required value={amendForm.amendment_reason || ''} onChange={(e) => setAmendForm({ ...amendForm, amendment_reason: e.target.value })} placeholder="Why is this being amended?" />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAmendForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Submit Amendment (Creates v{amendForm.version + 1})</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
