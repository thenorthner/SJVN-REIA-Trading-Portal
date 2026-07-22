import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const EMPTY = {
  contract_id: '', plant_code: '', plant_name: '', period_month: '', week_no: '', week_date: '',
  entry_type: 'PRIMARY', scheduled_mwh: '', actual_mwh: '', deviation_rate: '', notes: '',
};

// ₹-signed formatter: +recoverable (green) / −payable (red)
function SignedAmount({ v }) {
  const n = Number(v) || 0;
  const color = n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-light)';
  return <span style={{ color, fontWeight: 600 }}>{n > 0 ? '+' : ''}{fmtCurrency(n)}</span>;
}

export default function DeviationSettlements() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ contract_id: '', period_month: '' });
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');
  const [dispatchRow, setDispatchRow] = useState(null);
  const [dispatchForm, setDispatchForm] = useState({ invoice_no: '', dispatch_date: '' });

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filters.contract_id) params.contract_id = filters.contract_id;
    if (filters.period_month) params.period_month = filters.period_month;
    Promise.all([
      api.deviation.list(params),
      api.deviation.summary(params),
    ]).then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filters.contract_id, filters.period_month]);

  useEffect(load, [load]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  const devPreview = (Number(form.actual_mwh) || 0) - (Number(form.scheduled_mwh) || 0);
  const amtPreview = Math.round(devPreview * (Number(form.deviation_rate) || 0));

  function openAdd() { setForm(EMPTY); setEditId(null); setError(''); setShow(true); }
  function openEdit(r) {
    setForm({
      contract_id: r.contract_id, plant_code: r.plant_code || '', plant_name: r.plant_name || '',
      period_month: r.period_month, week_no: r.week_no, week_date: r.week_date || '',
      entry_type: r.entry_type, scheduled_mwh: r.scheduled_mwh, actual_mwh: r.actual_mwh,
      deviation_rate: r.deviation_rate, notes: r.notes || '',
    });
    setEditId(r.id); setError(''); setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      if (editId) await api.deviation.update(editId, form);
      else await api.deviation.create(form);
      setShow(false); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save deviation entry.');
    }
  }

  async function doSubmit(r) { await api.deviation.submit(r.id).catch(() => {}); load(); }
  async function doCancel(r) {
    if (!window.confirm(`Cancel deviation ${r.dsm_no}?`)) return;
    await api.deviation.remove(r.id).catch(() => {}); load();
  }
  function openDispatch(r) {
    setDispatchRow(r);
    setDispatchForm({ invoice_no: '', dispatch_date: new Date().toISOString().split('T')[0] });
  }
  async function doDispatch(e) {
    e.preventDefault();
    await api.deviation.dispatch(dispatchRow.id, dispatchForm).catch(() => {});
    setDispatchRow(null); load();
  }

  const columns = [
    { key: 'dsm_no', header: 'DSM No.' },
    { key: 'contract_no', header: 'Contract' },
    { key: 'period_month', header: 'Period' },
    { key: 'week_no', header: 'Week', render: (r) => `W${r.week_no}${r.entry_type === 'REVISED' ? ' (R)' : ''}` },
    { key: 'scheduled_mwh', header: 'Scheduled', render: (r) => `${fmtNumber(r.scheduled_mwh)} MWh` },
    { key: 'actual_mwh', header: 'Actual', render: (r) => `${fmtNumber(r.actual_mwh)} MWh` },
    { key: 'deviation_mwh', header: 'Deviation', render: (r) => `${r.deviation_mwh > 0 ? '+' : ''}${fmtNumber(r.deviation_mwh)} MWh` },
    { key: 'deviation_amount', header: 'Net Amount', render: (r) => <SignedAmount v={r.deviation_amount} /> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', render: (r) => canWrite && r.status !== 'CANCELLED' && (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        {r.status !== 'DISPATCHED' && <button className="btn btn-xs btn-outline" onClick={() => openEdit(r)}>Edit</button>}
        {r.status === 'CALCULATED' && <button className="btn btn-xs btn-outline" onClick={() => doSubmit(r)}>Submit</button>}
        {r.status === 'SUBMITTED' && <button className="btn btn-xs btn-primary" onClick={() => openDispatch(r)}>Dispatch</button>}
        {r.status !== 'DISPATCHED' && <button className="btn btn-xs btn-ghost" onClick={() => doCancel(r)}>Cancel</button>}
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader
        title="Deviation Settlement (DSM)"
        subtitle="Weekly grid deviation charges/credits per NRPC — schedule vs actual, plant-wise"
        actions={canWrite && <button className="btn btn-primary" onClick={openAdd}>+ Add Week</button>}
      />

      <div className="kpi-grid">
        <StatCard label="Weeks recorded" value={summary.weeks ?? 0} />
        <StatCard label="Net settlement" value={fmtCurrency(summary.net_amount || 0)} tone={(summary.net_amount || 0) >= 0 ? 'green' : 'red'} hint="+recoverable / −payable" />
        <StatCard label="Recoverable" value={fmtCurrency(summary.recoverable || 0)} tone="green" />
        <StatCard label="Payable by SJVN" value={fmtCurrency(Math.abs(summary.payable || 0))} tone="amber" />
      </div>

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No deviation entries yet.'} />
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title={editId ? 'Edit Deviation Week' : 'Add Deviation Week'} width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={save}>
          <Field label="Contract">
            <select required disabled={!!editId} value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Plant Code"><input value={form.plant_code} placeholder="NJHPS=001 / RHPS=002" onChange={(e) => setForm({ ...form, plant_code: e.target.value })} /></Field>
            <Field label="Plant Name"><input value={form.plant_name} placeholder="e.g. NATHPA JHAKRI" onChange={(e) => setForm({ ...form, plant_name: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Period"><input required type="month" disabled={!!editId} value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} /></Field>
            <Field label="Week No."><input required type="number" min="1" disabled={!!editId} value={form.week_no} onChange={(e) => setForm({ ...form, week_no: e.target.value })} /></Field>
          </div>
          <div className="form-grid">
            <Field label="Week Date"><input type="date" value={form.week_date} onChange={(e) => setForm({ ...form, week_date: e.target.value })} /></Field>
            <Field label="Entry Type">
              <select disabled={!!editId} value={form.entry_type} onChange={(e) => setForm({ ...form, entry_type: e.target.value })}>
                <option value="PRIMARY">Primary</option>
                <option value="REVISED">Revised</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Scheduled (MWh)"><input required type="number" step="0.001" value={form.scheduled_mwh} onChange={(e) => setForm({ ...form, scheduled_mwh: e.target.value })} /></Field>
            <Field label="Actual (MWh)"><input required type="number" step="0.001" value={form.actual_mwh} onChange={(e) => setForm({ ...form, actual_mwh: e.target.value })} /></Field>
          </div>
          <Field label="Deviation Rate (₹/MWh)"><input required type="number" step="0.01" value={form.deviation_rate} placeholder="DSM rate per NRPC" onChange={(e) => setForm({ ...form, deviation_rate: e.target.value })} /></Field>

          <div className="callout" style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, fontSize: 13 }}>
            Deviation: <strong>{devPreview > 0 ? '+' : ''}{fmtNumber(devPreview)} MWh</strong>
            {'  ·  '}Net: <SignedAmount v={amtPreview} />
            <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>+ recoverable from beneficiary · − payable by SJVN</div>
          </div>

          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">{editId ? 'Save' : 'Add Week'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!dispatchRow} onClose={() => setDispatchRow(null)} title="Dispatch DSM Bill" width={420}>
        {dispatchRow && (
          <form onSubmit={doDispatch}>
            <p className="inline-note">{dispatchRow.dsm_no} · Net <SignedAmount v={dispatchRow.deviation_amount} /></p>
            <Field label="Bill / Invoice No. (optional)">
              <input value={dispatchForm.invoice_no} placeholder="auto-generated if blank" onChange={(e) => setDispatchForm({ ...dispatchForm, invoice_no: e.target.value })} />
            </Field>
            <Field label="Dispatch Date">
              <input type="date" required value={dispatchForm.dispatch_date} onChange={(e) => setDispatchForm({ ...dispatchForm, dispatch_date: e.target.value })} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDispatchRow(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Dispatch</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
