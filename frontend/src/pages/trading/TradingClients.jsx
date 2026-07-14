import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'TRADING_USER'];

const EMPTY_FORM = { name: '', client_type: 'C&I', noc_valid_till: '', ppa_ref: '', pre_payment_balance: '', margin_available: '' };

export default function TradingClients() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ client_type: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.tradingClients.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.client_type, filters.status]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowModal(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      name: row.name, client_type: row.client_type, noc_valid_till: row.noc_valid_till || '',
      ppa_ref: row.ppa_ref || '', pre_payment_balance: row.pre_payment_balance, margin_available: row.margin_available,
    });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const payload = { ...form, pre_payment_balance: Number(form.pre_payment_balance) || 0, margin_available: Number(form.margin_available) || 0 };
    try {
      if (editing) {
        await api.tradingClients.update(editing.id, { ...editing, ...payload });
      } else {
        await api.tradingClients.create(payload);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save client.');
    }
  }

  async function toggleStatus(row) {
    const next = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    await api.tradingClients.update(row.id, { ...row, status: next });
    load();
  }

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'client_type', header: 'Type' },
    { key: 'noc_valid_till', header: 'NOC Valid Till', render: (r) => r.noc_valid_till || '-' },
    { key: 'ppa_ref', header: 'PPA Ref', render: (r) => r.ppa_ref || '-' },
    { key: 'pre_payment_balance', header: 'Pre-payment Balance', render: (r) => fmtCurrency(r.pre_payment_balance) },
    { key: 'margin_available', header: 'Margin Available', render: (r) => fmtCurrency(r.margin_available) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</button>
          <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); toggleStatus(r); }}>{r.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Clients &amp; Counterparties"
        subtitle="Manage generators, DISCOMs, traders and C&amp;I clients for power trading"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={openCreate}>+ New Client</button>}
      />

      <div className="filters-bar">
        <select value={filters.client_type} onChange={(e) => setFilters({ ...filters, client_type: e.target.value })}>
          <option value="">All types</option>
          {['GENERATOR', 'DISCOM', 'TRADER', 'C&I', 'OTHER'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['ACTIVE', 'INACTIVE', 'SUSPENDED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No trading clients found.'} />
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? `Edit ${editing.name}` : 'New Trading Client'} width={520}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Name">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Client Type">
              <select value={form.client_type} onChange={(e) => setForm({ ...form, client_type: e.target.value })}>
                {['GENERATOR', 'DISCOM', 'TRADER', 'C&I', 'OTHER'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="NOC Valid Till">
              <input type="date" value={form.noc_valid_till} onChange={(e) => setForm({ ...form, noc_valid_till: e.target.value })} />
            </Field>
            <Field label="PPA Reference">
              <input value={form.ppa_ref} onChange={(e) => setForm({ ...form, ppa_ref: e.target.value })} />
            </Field>
            <Field label="Pre-payment Balance (₹)">
              <input type="number" value={form.pre_payment_balance} onChange={(e) => setForm({ ...form, pre_payment_balance: e.target.value })} />
            </Field>
            <Field label="Margin Available (₹)">
              <input type="number" value={form.margin_available} onChange={(e) => setForm({ ...form, margin_available: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">{editing ? 'Save Changes' : 'Create Client'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
