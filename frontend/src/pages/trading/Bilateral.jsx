import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'TRADING_USER'];

const EMPTY_FORM = {
  client_id: '', counterparty: '', loi_contract_ref: '', quantum_mw: '', tariff_per_unit: '',
  wheeling_charges: '', transmission_charges: '', losses_percent: '', start_date: '', end_date: '',
};

export default function Bilateral() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState({ status: '', open_access_status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.bilateral.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.open_access_status]);
  useEffect(() => { api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {}); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.bilateral.create({
        ...form,
        quantum_mw: Number(form.quantum_mw),
        tariff_per_unit: Number(form.tariff_per_unit),
        wheeling_charges: form.wheeling_charges ? Number(form.wheeling_charges) : 0,
        transmission_charges: form.transmission_charges ? Number(form.transmission_charges) : 0,
        losses_percent: form.losses_percent ? Number(form.losses_percent) : 0,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create bilateral transaction.');
    }
  }

  async function handleOpenAccess(row, decision) {
    await api.bilateral.openAccess(row.id, decision);
    load();
  }

  async function handleSchedule(row, schedule_status) {
    await api.bilateral.schedule(row.id, schedule_status);
    load();
  }

  const columns = [
    { key: 'client_name', header: 'Client' },
    { key: 'counterparty', header: 'Counterparty' },
    { key: 'loi_contract_ref', header: 'LOI/Contract Ref', render: (r) => r.loi_contract_ref || '-' },
    { key: 'quantum_mw', header: 'Quantum (MW)', render: (r) => fmtNumber(r.quantum_mw) },
    { key: 'tariff_per_unit', header: 'Tariff (₹/unit)', render: (r) => r.tariff_per_unit },
    { key: 'open_access_status', header: 'Open Access', render: (r) => <Badge status={r.open_access_status} /> },
    { key: 'schedule_status', header: 'Schedule', render: (r) => <Badge status={r.schedule_status} /> },
    { key: 'period', header: 'Period', render: (r) => `${r.start_date} → ${r.end_date}` },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {r.open_access_status === 'PENDING' && (
            <>
              <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); handleOpenAccess(r, 'APPROVED'); }}>Approve OA</button>
              <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleOpenAccess(r, 'REJECTED'); }}>Reject OA</button>
            </>
          )}
          {r.open_access_status === 'APPROVED' && r.schedule_status === 'DRAFT' && (
            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); handleSchedule(r, 'SUBMITTED'); }}>Submit Schedule</button>
          )}
          {r.schedule_status === 'SUBMITTED' && (
            <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); handleSchedule(r, 'APPROVED'); }}>Approve Schedule</button>
          )}
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Bilateral Transaction Management"
        subtitle="Direct bilateral power sale/purchase deals with open access and scheduling workflow"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Bilateral Deal</button>}
      />

      <div className="filters-bar">
        <select value={filters.open_access_status} onChange={(e) => setFilters({ ...filters, open_access_status: e.target.value })}>
          <option value="">All open access statuses</option>
          {['PENDING', 'APPROVED', 'REJECTED', 'PARTIAL'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['ACTIVE', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No bilateral transactions found.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Bilateral Transaction" width={640}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <Field label="Client">
              <select required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Counterparty">
              <input required value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} />
            </Field>
            <Field label="LOI/Contract Ref">
              <input value={form.loi_contract_ref} onChange={(e) => setForm({ ...form, loi_contract_ref: e.target.value })} />
            </Field>
            <Field label="Quantum (MW)">
              <input required type="number" step="0.01" value={form.quantum_mw} onChange={(e) => setForm({ ...form, quantum_mw: e.target.value })} />
            </Field>
            <Field label="Tariff (₹/unit)">
              <input required type="number" step="0.01" value={form.tariff_per_unit} onChange={(e) => setForm({ ...form, tariff_per_unit: e.target.value })} />
            </Field>
            <Field label="Wheeling Charges (₹/unit)">
              <input type="number" step="0.01" value={form.wheeling_charges} onChange={(e) => setForm({ ...form, wheeling_charges: e.target.value })} />
            </Field>
            <Field label="Transmission Charges (₹/unit)">
              <input type="number" step="0.01" value={form.transmission_charges} onChange={(e) => setForm({ ...form, transmission_charges: e.target.value })} />
            </Field>
            <Field label="Losses (%)">
              <input type="number" step="0.01" value={form.losses_percent} onChange={(e) => setForm({ ...form, losses_percent: e.target.value })} />
            </Field>
            <Field label="Start Date">
              <input required type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </Field>
            <Field label="End Date">
              <input required type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
