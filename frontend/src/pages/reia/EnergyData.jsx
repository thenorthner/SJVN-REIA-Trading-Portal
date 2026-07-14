import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];

const EMPTY_FORM = { contract_id: '', period_month: '', data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: '', cuf_percent: '', availability_percent: '' };

export default function EnergyData() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.energyData.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_id, filters.period_month, filters.status]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.energyData.create({
        ...form,
        energy_mwh: Number(form.energy_mwh),
        cuf_percent: form.cuf_percent ? Number(form.cuf_percent) : null,
        availability_percent: form.availability_percent ? Number(form.availability_percent) : null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record energy data.');
    }
  }

  async function handleValidate(row) {
    await api.energyData.validate(row.id);
    load();
  }

  async function handleLock(row) {
    await api.energyData.lock(row.id);
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract' },
    { key: 'period_month', header: 'Period' },
    { key: 'data_type', header: 'Type', render: (r) => <Badge status={r.data_type} /> },
    { key: 'source', header: 'Source' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'cuf_percent', header: 'CUF %', render: (r) => r.cuf_percent != null ? `${fmtNumber(r.cuf_percent)}%` : '-' },
    { key: 'availability_percent', header: 'Availability %', render: (r) => r.availability_percent != null ? `${fmtNumber(r.availability_percent)}%` : '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'deviation_notes', header: 'Notes', render: (r) => r.deviation_notes || '-' },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {r.status === 'DRAFT' && <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); handleValidate(r); }}>Validate</button>}
          {r.status === 'VALIDATED' && <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); handleLock(r); }}>Lock</button>}
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Energy Data Accounting &amp; Validation"
        subtitle="Record metered generation, validate against contracted parameters and lock for billing"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Record Energy Data</button>}
      />

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'VALIDATED', 'LOCKED', 'DISPUTED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No energy data records found.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Record Energy Data" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Contract">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Period (Month)">
              <input required type="month" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} />
            </Field>
            <Field label="Data Type">
              <select value={form.data_type} onChange={(e) => setForm({ ...form, data_type: e.target.value })}>
                <option value="PROVISIONAL">Provisional</option>
                <option value="FINAL">Final</option>
              </select>
            </Field>
            <Field label="Source">
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {['MANUAL', 'REA', 'RLDC', 'SLDC', 'JMR'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Energy (MWh)">
              <input required type="number" step="0.01" value={form.energy_mwh} onChange={(e) => setForm({ ...form, energy_mwh: e.target.value })} />
            </Field>
            <Field label="CUF (%)">
              <input type="number" step="0.01" value={form.cuf_percent} onChange={(e) => setForm({ ...form, cuf_percent: e.target.value })} />
            </Field>
            <Field label="Availability (%)">
              <input type="number" step="0.01" value={form.availability_percent} onChange={(e) => setForm({ ...form, availability_percent: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
