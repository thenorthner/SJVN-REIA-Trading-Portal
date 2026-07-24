import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const EMPTY = {
  period_type: 'MONTHLY', period: '', total_volume_mu: '', total_revenue: '',
  trading_margin: '', status: 'DRAFT', submission_date: '', reference_no: '', notes: '',
};
const STATUSES = ['DRAFT', 'PREPARED', 'SUBMITTED'];

export default function CERCFormIV() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.formIv.list(), api.formIv.summary()])
      .then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  function openAdd() { setForm(EMPTY); setEditId(null); setError(''); setShow(true); }
  function openEdit(r) {
    setForm({
      period_type: r.period_type, period: r.period, total_volume_mu: r.total_volume_mu,
      total_revenue: r.total_revenue, trading_margin: r.trading_margin, status: r.status,
      submission_date: r.submission_date || '', reference_no: r.reference_no || '', notes: r.notes || '',
    });
    setEditId(r.id); setError(''); setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      const body = {
        ...form,
        total_volume_mu: Number(form.total_volume_mu) || 0,
        total_revenue: Number(form.total_revenue) || 0,
        trading_margin: Number(form.trading_margin) || 0,
      };
      if (editId) await api.formIv.update(editId, body);
      else await api.formIv.create(body);
      setShow(false); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save Form-IV.');
    }
  }

  const columns = [
    { key: 'form_no', header: 'Form No.' },
    { key: 'period_type', header: 'Type' },
    { key: 'period', header: 'Period' },
    { key: 'total_volume_mu', header: 'Volume (MU)', render: (r) => fmtNumber(r.total_volume_mu) },
    { key: 'total_revenue', header: 'Revenue', render: (r) => fmtCurrency(r.total_revenue) },
    { key: 'trading_margin', header: 'Trading Margin', render: (r) => fmtCurrency(r.trading_margin) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status === 'SUBMITTED' ? 'ACTIVE' : r.status === 'PREPARED' ? 'PENDING' : 'DRAFT'} label={r.status} /> },
    { key: 'submission_date', header: 'Submitted', render: (r) => r.submission_date || '—' },
    { key: 'actions', header: '', render: (r) => canWrite && (
      <button className="btn btn-xs btn-outline" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</button>
    ) },
  ];

  return (
    <div>
      <PageHeader
        title="CERC Form-IV Compliance"
        subtitle="Monthly & annual inter-state trading transaction reports filed with CERC"
        actions={canWrite && <button className="btn btn-primary" onClick={openAdd}>+ Add Form-IV</button>}
      />

      <div className="kpi-grid">
        <StatCard label="Total Filings" value={summary.total ?? 0} />
        <StatCard label="Submitted" value={summary.submitted ?? 0} tone="green" />
        <StatCard label="Pending" value={summary.pending ?? 0} tone="amber" />
        <StatCard label="Latest Month" value={summary.latest_status || 'Pending'} hint={summary.latest_period || '—'} tone={summary.latest_status === 'SUBMITTED' ? 'green' : 'amber'} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No Form-IV filings yet.'} />
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title={editId ? 'Edit Form-IV' : 'Add Form-IV'} width={520}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={save}>
          <div className="form-grid">
            <Field label="Period Type">
              <select disabled={!!editId} value={form.period_type} onChange={(e) => setForm({ ...form, period_type: e.target.value })}>
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual (FY)</option>
              </select>
            </Field>
            <Field label={form.period_type === 'ANNUAL' ? 'Financial Year' : 'Month'}>
              {form.period_type === 'ANNUAL'
                ? <input required disabled={!!editId} value={form.period} placeholder="e.g. 2026-27" onChange={(e) => setForm({ ...form, period: e.target.value })} />
                : <input required type="month" disabled={!!editId} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />}
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Energy Traded (MU)"><input type="number" step="0.01" value={form.total_volume_mu} onChange={(e) => setForm({ ...form, total_volume_mu: e.target.value })} /></Field>
            <Field label="Total Revenue (₹)"><input type="number" step="0.01" value={form.total_revenue} onChange={(e) => setForm({ ...form, total_revenue: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Trading Margin (₹)"><input type="number" step="0.01" value={form.trading_margin} onChange={(e) => setForm({ ...form, trading_margin: e.target.value })} /></Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Submission Date"><input type="date" value={form.submission_date} onChange={(e) => setForm({ ...form, submission_date: e.target.value })} /></Field>
            <Field label="CERC Reference No."><input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">{editId ? 'Save' : 'Add Form-IV'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
