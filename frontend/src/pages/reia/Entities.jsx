import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const CAN_APPROVE = ['SJVN_ADMIN', 'REIA_USER'];
const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER', 'SELLER', 'BUYER'];

const EMPTY_FORM = {
  entity_type: 'SELLER', category: '', name: '', capacity_mw: '', technology: '', contracted_capacity_mw: '',
  psa_tariff: '', supply_criteria: '', organization_details: '', regulatory_approvals: '', bank_details: '', contact_details: '',
};

export default function Entities() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
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
      .then(setRows).finally(() => setLoading(false));
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

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'entity_type', header: 'Type', render: (r) => <Badge status={r.entity_type} /> },
    { key: 'category', header: 'Category' },
    { key: 'technology', header: 'Technology', render: (r) => r.technology || '-' },
    { key: 'capacity', header: 'Capacity (MW)', render: (r) => fmtNumber(r.contracted_capacity_mw ?? r.capacity_mw) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'created_at', header: 'Onboarded', render: (r) => r.created_at?.slice(0, 10) },
  ];

  return (
    <div>
      <PageHeader
        title="Stakeholder Onboarding (Sellers / Buyers)"
        subtitle="Register, review and manage RE generators, DISCOMs and other commercial counterparties"
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Onboard New Stakeholder" width={640}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <Field label="Entity Type">
              <select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
                <option value="SELLER">Seller</option>
                <option value="BUYER">Buyer</option>
              </select>
            </Field>
            <Field label="Category">
              <input required placeholder="RE Generator / DISCOM / C&I" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
            <Field label="Name">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Technology">
              <input placeholder="Solar / Wind / Hybrid / FDRE" value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} />
            </Field>
            <Field label="Capacity (MW)">
              <input type="number" step="0.01" value={form.capacity_mw} onChange={(e) => setForm({ ...form, capacity_mw: e.target.value })} />
            </Field>
            <Field label="Contracted Capacity (MW)">
              <input type="number" step="0.01" value={form.contracted_capacity_mw} onChange={(e) => setForm({ ...form, contracted_capacity_mw: e.target.value })} />
            </Field>
            <Field label="PSA Tariff (₹/unit)">
              <input type="number" step="0.01" value={form.psa_tariff} onChange={(e) => setForm({ ...form, psa_tariff: e.target.value })} />
            </Field>
            <Field label="Supply Criteria">
              <input value={form.supply_criteria} onChange={(e) => setForm({ ...form, supply_criteria: e.target.value })} />
            </Field>
          </div>
          <Field label="Organization Details">
            <textarea value={form.organization_details} onChange={(e) => setForm({ ...form, organization_details: e.target.value })} />
          </Field>
          <div className="form-grid">
            <Field label="Regulatory Approvals">
              <input value={form.regulatory_approvals} onChange={(e) => setForm({ ...form, regulatory_approvals: e.target.value })} />
            </Field>
            <Field label="Bank Details">
              <input value={form.bank_details} onChange={(e) => setForm({ ...form, bank_details: e.target.value })} />
            </Field>
          </div>
          <Field label="Contact Details">
            <input value={form.contact_details} onChange={(e) => setForm({ ...form, contact_details: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Submit for Approval</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name} width={640}>
        {selected && (
          <div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Type</span><span className="detail-value"><Badge status={selected.entity_type} /></span></div>
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={selected.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Category</span><span className="detail-value">{selected.category}</span></div>
              <div className="detail-item"><span className="detail-label">Technology</span><span className="detail-value">{selected.technology || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Capacity</span><span className="detail-value">{fmtNumber(selected.capacity_mw)} MW</span></div>
              <div className="detail-item"><span className="detail-label">Contracted Capacity</span><span className="detail-value">{fmtNumber(selected.contracted_capacity_mw)} MW</span></div>
              <div className="detail-item"><span className="detail-label">PSA Tariff</span><span className="detail-value">{selected.psa_tariff ?? '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Supply Criteria</span><span className="detail-value">{selected.supply_criteria || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Organization</span><span className="detail-value">{selected.organization_details || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Regulatory Approvals</span><span className="detail-value">{selected.regulatory_approvals || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Bank Details</span><span className="detail-value">{selected.bank_details || '-'}</span></div>
              <div className="detail-item"><span className="detail-label">Contact</span><span className="detail-value">{selected.contact_details || '-'}</span></div>
            </div>

            {selected.history?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Change History</div>
                <div className="timeline">
                  {selected.history.map((h) => (
                    <div className="timeline-item" key={h.id}>
                      <strong>{h.field_changed}</strong>: {h.old_value || '(empty)'} → {h.new_value}
                      <div className="t-meta">by {h.changed_by} · {h.created_at}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {selected.status === 'PENDING' && CAN_APPROVE.includes(user?.role) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Review Decision</div>
                <Field label="Remarks">
                  <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional remarks" />
                </Field>
                <div className="form-actions">
                  <button className="btn btn-danger" onClick={() => handleApprove('REJECTED')}>Reject</button>
                  <button className="btn btn-success" onClick={() => handleApprove('APPROVED')}>Approve</button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
