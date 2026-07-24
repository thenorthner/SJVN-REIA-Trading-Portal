import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const EMPTY = {
  source: 'CSPP', vintage_month: '', quantity: '', status: 'APPLIED',
  application_date: '', issuance_date: '', issue_cost_per_rec: '',
  sale_rate_per_rec: '', trade_platform: 'IEX', trade_date: '', buyer: '', notes: '',
};

const STATUSES = ['APPLIED', 'ISSUED', 'LISTED', 'SOLD', 'REDEEMED', 'CANCELLED'];

export default function RECManagement() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ status: '', vintage_month: '' });
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.vintage_month) params.vintage_month = filters.vintage_month;
    Promise.all([api.rec.list(params), api.rec.summary()])
      .then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters.status, filters.vintage_month]);

  useEffect(load, [load]);

  const qty = Number(form.quantity) || 0;
  const salePreview = qty * (Number(form.sale_rate_per_rec) || 0);
  const profitPreview = salePreview - qty * (Number(form.issue_cost_per_rec) || 0);

  function openAdd() { setForm(EMPTY); setEditId(null); setError(''); setShow(true); }
  function openEdit(r) {
    setForm({
      source: r.source || '', vintage_month: r.vintage_month, quantity: r.quantity, status: r.status,
      application_date: r.application_date || '', issuance_date: r.issuance_date || '',
      issue_cost_per_rec: r.issue_cost_per_rec, sale_rate_per_rec: r.sale_rate_per_rec,
      trade_platform: r.trade_platform || 'IEX', trade_date: r.trade_date || '', buyer: r.buyer || '', notes: r.notes || '',
    });
    setEditId(r.id); setError(''); setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      if (editId) await api.rec.update(editId, form);
      else await api.rec.create(form);
      setShow(false); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save REC lot.');
    }
  }

  async function doCancel(r) {
    if (!window.confirm(`Cancel REC lot ${r.rec_no}?`)) return;
    await api.rec.remove(r.id).catch(() => {}); load();
  }

  const columns = [
    { key: 'rec_no', header: 'REC No.' },
    { key: 'source', header: 'Source', render: (r) => r.source || '—' },
    { key: 'vintage_month', header: 'Vintage' },
    { key: 'quantity', header: 'RECs', render: (r) => fmtNumber(r.quantity, 0) },
    { key: 'issue_cost_per_rec', header: 'Cost/REC', render: (r) => r.issue_cost_per_rec ? fmtCurrency(r.issue_cost_per_rec) : '—' },
    { key: 'sale_rate_per_rec', header: 'Sale/REC', render: (r) => r.sale_rate_per_rec ? fmtCurrency(r.sale_rate_per_rec) : '—' },
    { key: 'sale_amount', header: 'Sale Amount', render: (r) => r.sale_amount ? fmtCurrency(r.sale_amount) : '—' },
    { key: 'profit', header: 'Profit', render: (r) => (
      <span style={{ color: r.profit > 0 ? 'var(--green)' : r.profit < 0 ? 'var(--red)' : 'var(--text-light)', fontWeight: 600 }}>
        {r.profit ? fmtCurrency(r.profit) : '—'}
      </span>
    ) },
    { key: 'trade_platform', header: 'Platform', render: (r) => r.trade_platform || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', render: (r) => canWrite && r.status !== 'CANCELLED' && (
      <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-xs btn-outline" onClick={() => openEdit(r)}>Edit</button>
        <button className="btn btn-xs btn-ghost" onClick={() => doCancel(r)}>Cancel</button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader
        title="REC Management"
        subtitle="Renewable Energy Certificates — CSPP issuance, trading on IEX/PXIL & ledger"
        actions={canWrite && <button className="btn btn-primary" onClick={openAdd}>+ Add REC Lot</button>}
      />

      <div className="kpi-grid">
        <StatCard label="Total RECs" value={fmtNumber(summary.total_recs || 0, 0)} hint={`${summary.total_lots || 0} lots`} />
        <StatCard label="Issued" value={fmtNumber(summary.issued_recs || 0, 0)} tone="green" />
        <StatCard label="Sold / Traded" value={fmtNumber(summary.sold_recs || 0, 0)} tone="green" />
        <StatCard label="REC Revenue" value={fmtCurrency(summary.rec_revenue || 0)} />
        <StatCard label="Profit from REC" value={fmtCurrency(summary.profit_from_rec || 0)} tone={(summary.profit_from_rec || 0) >= 0 ? 'green' : 'red'} />
      </div>

      <div className="filters-bar">
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="month" value={filters.vintage_month} onChange={(e) => setFilters({ ...filters, vintage_month: e.target.value })} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No REC lots yet.'} />
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title={editId ? 'Edit REC Lot' : 'Add REC Lot'} width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Source (Station)"><input value={form.source} placeholder="e.g. CSPP (Charanka)" onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
            <Field label="Vintage Month"><input required type="month" value={form.vintage_month} onChange={(e) => setForm({ ...form, vintage_month: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Quantity (no. of RECs)"><input required type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Application Date"><input type="date" value={form.application_date} onChange={(e) => setForm({ ...form, application_date: e.target.value })} /></Field>
            <Field label="Issuance Date"><input type="date" value={form.issuance_date} onChange={(e) => setForm({ ...form, issuance_date: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Issue Cost / REC (₹)"><input type="number" step="0.01" value={form.issue_cost_per_rec} placeholder="registry/issuance cost" onChange={(e) => setForm({ ...form, issue_cost_per_rec: e.target.value })} /></Field>
            <Field label="Sale Rate / REC (₹)"><input type="number" step="0.01" value={form.sale_rate_per_rec} placeholder="realised sale price" onChange={(e) => setForm({ ...form, sale_rate_per_rec: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Trade Platform">
              <select value={form.trade_platform} onChange={(e) => setForm({ ...form, trade_platform: e.target.value })}>
                <option value="IEX">IEX</option>
                <option value="PXIL">PXIL</option>
              </select>
            </Field>
            <Field label="Trade Date"><input type="date" value={form.trade_date} onChange={(e) => setForm({ ...form, trade_date: e.target.value })} /></Field>
          </div>
          <Field label="Buyer"><input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} /></Field>

          <div className="callout" style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, fontSize: 13 }}>
            Sale Amount: <strong>{fmtCurrency(salePreview)}</strong>{'  ·  '}
            Profit: <strong style={{ color: profitPreview >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtCurrency(profitPreview)}</strong>
            <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>Profit = (Sale − Issue cost) × quantity, realised when SOLD</div>
          </div>

          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">{editId ? 'Save' : 'Add REC Lot'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
