import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const CAN_APPROVE = ['SJVN_ADMIN', 'REIA_USER'];
const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER', 'SELLER', 'BUYER'];

const EMPTY_FORM = {
  parent_entity_id: '', entity_type: 'SELLER', category: '', name: '', 
  pan_no: '', gst_no: '', cin: '', credit_rating: '',
  capacity_mw: '', technology: '', contracted_capacity_mw: '',
  psa_tariff: '', supply_criteria: '', organization_details: '', regulatory_approvals: '', bank_details: '',
  contacts: [{ contact_type: 'COMMERCIAL', name: '', email: '', phone: '', is_primary: true }],
  documents: [{ doc_type: 'Registration', url: '', validity_end: '' }]
};

export default function Entities() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [parents, setParents] = useState([]);
  const [filters, setFilters] = useState({ entity_type: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [remarks, setRemarks] = useState('');

  function load() {
    setLoading(true);
    api.entities.list({ entity_type: filters.entity_type || undefined, status: filters.status || undefined })
      .then(res => {
        setRows(res);
        setParents(res.filter(r => !r.parent_entity_id));
      }).finally(() => setLoading(false));
  }

  useEffect(load, [filters.entity_type, filters.status]);

  function openDetail(row) {
    api.entities.get(row.id).then(setSelected);
    setRemarks('');
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.entities.create({
        ...form,
        capacity_mw: form.capacity_mw ? Number(form.capacity_mw) : null,
        contracted_capacity_mw: form.contracted_capacity_mw ? Number(form.contracted_capacity_mw) : null,
        psa_tariff: form.psa_tariff ? Number(form.psa_tariff) : null,
        parent_entity_id: form.parent_entity_id || null
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create stakeholder.');
    }
  }

  async function handleApprove(decision) {
    await api.entities.approve(selected.id, decision, remarks);
    setSelected(null);
    load();
  }
  
  async function handlePennyDrop() {
    try {
      await api.client.post(`/reia/entities/${selected.id}/penny-drop`);
      api.entities.get(selected.id).then(setSelected);
      load();
    } catch(err) {
      alert('Penny drop failed');
    }
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => (
      <div>
        <div style={{fontWeight: 600}}>{r.name}</div>
        {r.parent_name && <div style={{fontSize: 11, color: '#666'}}>Parent: {r.parent_name}</div>}
      </div>
    )},
    { key: 'entity_type', header: 'Type', render: (r) => <Badge status={r.entity_type} /> },
    { key: 'kyc', header: 'KYC & Bank', render: (r) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {r.pan_no ? <Badge status="ACTIVE" label="PAN" /> : <Badge status="DRAFT" label="No PAN" />}
        {r.is_penny_drop_verified ? <Badge status="ACTIVE" label="Bank Verified" /> : <Badge status="PENDING" label="Bank Unverified" />}
      </div>
    )},
    { key: 'capacity', header: 'Capacity (MW)', render: (r) => fmtNumber(r.contracted_capacity_mw ?? r.capacity_mw) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'created_at', header: 'Onboarded', render: (r) => r.created_at?.slice(0, 10) },
  ];

  return (
    <div>
      <PageHeader
        title="Stakeholder Onboarding"
        subtitle="Manage RE Generators, DISCOMs, SPVs, KYC and Regulatory Approvals"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Onboard Stakeholder</button>}
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Onboard New Stakeholder" width={800}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>1. Entity Hierarchy & Type</h4>
            <div className="form-grid">
              <Field label="Parent Group (Optional)">
                <select value={form.parent_entity_id} onChange={(e) => setForm({ ...form, parent_entity_id: e.target.value })}>
                  <option value="">-- None (This is a Parent Group) --</option>
                  {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Entity Type">
                <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
                  <option value="SELLER">Seller</option>
                  <option value="BUYER">Buyer</option>
                </select>
              </Field>
              <Field label="Name">
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Category">
                <input required placeholder="RE Generator / DISCOM / C&I" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </Field>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>2. KYC & Compliance</h4>
            <div className="form-grid">
              <Field label="PAN No"><input value={form.pan_no} onChange={e => setForm({...form, pan_no: e.target.value})} /></Field>
              <Field label="GST No"><input value={form.gst_no} onChange={e => setForm({...form, gst_no: e.target.value})} /></Field>
              <Field label="CIN"><input value={form.cin} onChange={e => setForm({...form, cin: e.target.value})} /></Field>
              <Field label="Credit Rating"><input value={form.credit_rating} onChange={e => setForm({...form, credit_rating: e.target.value})} /></Field>
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 12px 0' }}>3. Technical & Banking</h4>
            <div className="form-grid">
              <Field label="Technology"><input placeholder="Solar / Wind" value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} /></Field>
              <Field label="Capacity (MW)"><input type="number" step="0.01" value={form.capacity_mw} onChange={(e) => setForm({ ...form, capacity_mw: e.target.value })} /></Field>
              <Field label="Bank Details (A/C, IFSC)"><input required value={form.bank_details} onChange={(e) => setForm({ ...form, bank_details: e.target.value })} /></Field>
              <Field label="Regulatory Approvals"><input value={form.regulatory_approvals} onChange={(e) => setForm({ ...form, regulatory_approvals: e.target.value })} /></Field>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Submit for Approval</button>
          </div>
        </form>
      </Modal>

      {selected && (
        <Modal open={true} onClose={() => setSelected(null)} title={`Stakeholder: ${selected.name}`} width={800}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Identity & KYC</h4>
              <table className="detail-table">
                <tbody>
                  <tr><td>Type</td><td><Badge status={selected.entity_type} /></td></tr>
                  <tr><td>Hierarchy</td><td>{selected.parent_name ? `SPV of ${selected.parent_name}` : 'Parent Entity'}</td></tr>
                  <tr><td>Category</td><td>{selected.category}</td></tr>
                  <tr><td>PAN</td><td>{selected.pan_no || '-'}</td></tr>
                  <tr><td>GST</td><td>{selected.gst_no || '-'}</td></tr>
                  <tr><td>CIN</td><td>{selected.cin || '-'}</td></tr>
                  <tr><td>Credit Rating</td><td>{selected.credit_rating || '-'}</td></tr>
                  <tr><td>Blacklist Status</td><td>{selected.is_blacklisted ? <Badge status="REJECTED" label="BLACKLISTED" /> : <Badge status="ACTIVE" label="Clear" />}</td></tr>
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
                      {selected.bank_details}
                      <div style={{ marginTop: 6 }}>
                        {selected.is_penny_drop_verified 
                          ? <Badge status="ACTIVE" label="Penny Drop Verified" /> 
                          : CAN_APPROVE.includes(user?.role) && <button className="btn btn-outline" style={{padding: '2px 8px', fontSize: 11}} onClick={handlePennyDrop}>Verify Penny Drop (₹1)</button>}
                      </div>
                    </td>
                  </tr>
                  <tr><td>Technology</td><td>{selected.technology || '-'}</td></tr>
                  <tr><td>Capacity</td><td>{fmtNumber(selected.capacity_mw)} MW</td></tr>
                  <tr><td>Status</td><td><Badge status={selected.status} /></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          
          <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Contacts</h4>
          {selected.contacts?.length > 0 ? (
            <Table columns={[{key:'type', header:'Role', render: r=>r.contact_type}, {key:'name', header:'Name'}, {key:'email', header:'Email'}, {key:'phone', header:'Phone'}]} rows={selected.contacts} />
          ) : <div style={{ fontSize: 13, color: '#666' }}>No contacts found.</div>}
          
          <h4 style={{ margin: '20px 0 12px 0', borderBottom: '1px solid #eee', paddingBottom: 8 }}>Documents</h4>
          {selected.documents?.length > 0 ? (
            <Table columns={[{key:'type', header:'Doc Type', render: r=>r.doc_type}, {key:'validity', header:'Validity', render: r=>r.validity_end || '-'}, {key:'link', header:'Link', render: r=> <a href={r.url} target="_blank" rel="noreferrer">View</a>}]} rows={selected.documents} />
          ) : <div style={{ fontSize: 13, color: '#666' }}>No documents found.</div>}

          {selected.status === 'PENDING' && CAN_APPROVE.includes(user?.role) && (
            <div style={{ marginTop: 20, padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 12px 0' }}>Approval Action</h4>
              <Field label="Remarks">
                <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required for rejection" />
              </Field>
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button className="btn btn-primary" onClick={() => handleApprove('APPROVED')}>Approve Stakeholder</button>
                <button className="btn btn-danger" onClick={() => handleApprove('REJECTED')}>Reject</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
