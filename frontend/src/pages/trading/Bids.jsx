import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'TRADING_USER', 'TRADING_CLIENT'];
const CAN_CLEAR = ['SJVN_ADMIN', 'TRADING_USER'];

const EMPTY_FORM = {
  client_id: '', exchange: 'IEX', product: 'DAM', bid_date: '', delivery_date: '', time_block: '',
  quantum_mw: '', price_per_unit: '', carry_forward_from: '', premium_discount: '', no_bid: false,
};
const CLEAR_FORM = { cleared_quantum_mw: '', cleared_price: '' };

export default function Bids() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [filters, setFilters] = useState({ client_id: '', exchange: '', product: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState('');
  const [clearRow, setClearRow] = useState(null);
  const [clearForm, setClearForm] = useState(CLEAR_FORM);

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.bids.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.client_id, filters.exchange, filters.product, filters.status]);
  useEffect(() => { api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => {}); }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setValidation(null);
    setError('');
    setShowCreate(true);
  }

  async function handleValidate() {
    if (!form.client_id) return;
    const res = await api.bids.validate({ ...form, quantum_mw: Number(form.quantum_mw) || 0, price_per_unit: Number(form.price_per_unit) || 0 });
    setValidation(res);
  }

  async function handleCreate(e, force = false) {
    e.preventDefault();
    setError('');
    try {
      await api.bids.create({
        ...form,
        quantum_mw: Number(form.quantum_mw),
        price_per_unit: Number(form.price_per_unit),
        premium_discount: form.premium_discount ? Number(form.premium_discount) : 0,
        carry_forward_from: form.carry_forward_from || null,
        force,
      });
      setShowCreate(false);
      load();
    } catch (err) {
      if (err.response?.data?.details) {
        setError(err.response.data.details.join(' '));
      } else {
        setError(err.response?.data?.error || 'Failed to submit bid.');
      }
    }
  }

  async function handleCancel(row) {
    await api.bids.cancel(row.id);
    load();
  }

  async function handleDelete(row) {
    await api.bids.remove(row.id);
    load();
  }

  async function handleClear(e) {
    e.preventDefault();
    await api.bids.clear(clearRow.id, { cleared_quantum_mw: Number(clearForm.cleared_quantum_mw), cleared_price: Number(clearForm.cleared_price) });
    setClearRow(null);
    load();
  }

  const columns = [
    { key: 'client_name', header: 'Client' },
    { key: 'exchange', header: 'Exchange' },
    { key: 'product', header: 'Product' },
    { key: 'bid_date', header: 'Bid Date' },
    { key: 'delivery_date', header: 'Delivery Date' },
    { key: 'time_block', header: 'Block', render: (r) => r.time_block || '-' },
    { key: 'quantum_mw', header: 'Quantum (MW)', render: (r) => fmtNumber(r.quantum_mw) },
    { key: 'price_per_unit', header: 'Price (₹/unit)', render: (r) => r.price_per_unit },
    { key: 'cleared_quantum_mw', header: 'Cleared (MW)', render: (r) => fmtNumber(r.cleared_quantum_mw) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {['DRAFT', 'SUBMITTED'].includes(r.status) && <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleCancel(r); }}>Cancel</button>}
          {r.status === 'DRAFT' && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); handleDelete(r); }}>Delete</button>}
          {CAN_CLEAR.includes(user?.role) && ['SUBMITTED'].includes(r.status) && (
            <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setClearRow(r); setClearForm({ cleared_quantum_mw: r.quantum_mw, cleared_price: r.price_per_unit }); }}>Clear</button>
          )}
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Exchange Bid Management"
        subtitle="Submit and track power exchange bids across IEX, PXIL and HPX"
        actions={CAN_WRITE.includes(user?.role) && <button className="btn btn-primary" onClick={openCreate}>+ Submit Bid</button>}
      />

      <div className="filters-bar">
        <select value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.exchange} onChange={(e) => setFilters({ ...filters, exchange: e.target.value })}>
          <option value="">All exchanges</option>
          {['IEX', 'PXIL', 'HPX'].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
          <option value="">All products</option>
          {['DAM', 'HPDAM', 'TAM', 'GDAM', 'RTM', 'GTAM', 'REC', 'ESCERT', 'RPO'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'SUBMITTED', 'CLEARED', 'PARTIALLY_CLEARED', 'REJECTED', 'CANCELLED', 'NO_BID'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No bids found.'} />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Submit Exchange Bid" width={640}>
        {error && <div className="form-error">{error}</div>}
        {validation && (
          <div className={validation.valid ? 'form-error' : 'form-error'} style={validation.valid ? { background: 'var(--green-bg)', color: 'var(--green)' } : {}}>
            {validation.valid ? 'Validation passed — ready to submit.' : validation.errors.join(' ')}
          </div>
        )}
        <form onSubmit={(e) => handleCreate(e, false)}>
          <div className="form-grid">
            <Field label="Client">
              <select required value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Exchange">
              <select value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })}>
                {['IEX', 'PXIL', 'HPX'].map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
            <Field label="Product">
              <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>
                {['DAM', 'HPDAM', 'TAM', 'GDAM', 'RTM', 'GTAM', 'REC', 'ESCERT', 'RPO'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Time Block">
              <input required placeholder="Block-1" value={form.time_block} onChange={(e) => setForm({ ...form, time_block: e.target.value })} />
            </Field>
            <Field label="Bid Date">
              <input required type="date" value={form.bid_date} onChange={(e) => setForm({ ...form, bid_date: e.target.value })} />
            </Field>
            <Field label="Delivery Date">
              <input required type="date" value={form.delivery_date} onChange={(e) => setForm({ ...form, delivery_date: e.target.value })} />
            </Field>
            <Field label="Quantum (MW)">
              <input required type="number" step="0.01" value={form.quantum_mw} onChange={(e) => setForm({ ...form, quantum_mw: e.target.value })} />
            </Field>
            <Field label="Price (₹/unit)">
              <input required type="number" step="0.01" value={form.price_per_unit} onChange={(e) => setForm({ ...form, price_per_unit: e.target.value })} />
            </Field>
            <Field label="Premium/Discount">
              <input type="number" step="0.01" value={form.premium_discount} onChange={(e) => setForm({ ...form, premium_discount: e.target.value })} />
            </Field>
            <Field label="Carry-forward From">
              <input placeholder="e.g. GDAM->DAM" value={form.carry_forward_from} onChange={(e) => setForm({ ...form, carry_forward_from: e.target.value })} />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14 }}>
            <input type="checkbox" checked={form.no_bid} onChange={(e) => setForm({ ...form, no_bid: e.target.checked })} />
            Record as No-Bid for this slot
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="button" className="btn btn-secondary" onClick={handleValidate}>Validate</button>
            <button type="submit" className="btn btn-primary">Submit Bid</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!clearRow} onClose={() => setClearRow(null)} title="Record Exchange Clearing" width={420}>
        {clearRow && (
          <form onSubmit={handleClear}>
            <div className="form-grid">
              <Field label="Cleared Quantum (MW)">
                <input required type="number" step="0.01" max={clearRow.quantum_mw} value={clearForm.cleared_quantum_mw} onChange={(e) => setClearForm({ ...clearForm, cleared_quantum_mw: e.target.value })} />
              </Field>
              <Field label="Cleared Price (₹/unit)">
                <input required type="number" step="0.01" value={clearForm.cleared_price} onChange={(e) => setClearForm({ ...clearForm, cleared_price: e.target.value })} />
              </Field>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setClearRow(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Clearing</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
