import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const EMPTY = {
  contract_id: '', period_month: '', reason: 'PAYMENT_DEFAULT', quantum_mwh: '',
  exchange_platform: 'IEX', sale_rate_per_mwh: '', expenses: '', notes: '',
};

function Signed({ v }) {
  const n = Number(v) || 0;
  return <span style={{ color: n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-light)', fontWeight: 600 }}>{n > 0 ? '+' : ''}{fmtCurrency(n)}</span>;
}

export default function PowerDiversion() {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.REIA_WRITE.includes(user?.role);
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.powerDiversion.list(), api.powerDiversion.summary()])
      .then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { api.contracts.list({ contract_type: 'PSA' }).then(setContracts).catch(() => api.contracts.list().then((c) => setContracts(c.filter((x) => x.contract_type === 'PSA'))).catch(() => {})); }, []);

  const salePreview = (Number(form.quantum_mwh) || 0) * (Number(form.sale_rate_per_mwh) || 0);
  const netPreview = salePreview - (Number(form.expenses) || 0);

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await api.powerDiversion.create({ ...form, quantum_mwh: Number(form.quantum_mwh), sale_rate_per_mwh: Number(form.sale_rate_per_mwh), expenses: Number(form.expenses) || 0 });
      setShow(false); setForm(EMPTY); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record diversion.');
    }
  }

  async function applyRecovery(r) {
    if (r.net_gain <= 0) { alert('No positive gain to recover for this diversion.'); return; }
    if (!r.buyer_id) { alert('No buyer linked to this diversion.'); return; }
    if (!window.confirm(`Apply ₹${r.net_gain.toLocaleString('en-IN')} recovery against ${r.buyer_name}'s outstanding dues (LPS-first waterfall)?`)) return;
    try {
      await api.invoices.waterfallPayment({ buyer_id: r.buyer_id, amount: r.net_gain, payment_date: new Date().toISOString().split('T')[0], reference: `Diversion ${r.diversion_no}` });
      await api.powerDiversion.markRecovered(r.id, { applied_amount: r.net_gain });
      load();
    } catch (err) {
      alert('Recovery failed: ' + (err.response?.data?.error || err.message));
    }
  }

  async function doCancel(r) {
    if (!window.confirm(`Cancel diversion ${r.diversion_no}?`)) return;
    await api.powerDiversion.remove(r.id).catch(() => {}); load();
  }

  const columns = [
    { key: 'diversion_no', header: 'Diversion No.' },
    { key: 'contract_no', header: 'PSA' },
    { key: 'buyer_name', header: 'Buyer', render: (r) => r.buyer_name || '—' },
    { key: 'period_month', header: 'Period' },
    { key: 'reason', header: 'Reason', render: (r) => r.reason.replace(/_/g, ' ') },
    { key: 'quantum_mwh', header: 'Quantum', render: (r) => `${fmtNumber(r.quantum_mwh)} MWh` },
    { key: 'sale_amount', header: 'Sale', render: (r) => fmtCurrency(r.sale_amount) },
    { key: 'expenses', header: 'Expenses', render: (r) => fmtCurrency(r.expenses) },
    { key: 'net_gain', header: 'Net Gain', render: (r) => <Signed v={r.net_gain} /> },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'actions', header: '', render: (r) => canWrite && r.status === 'RECORDED' && (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        {r.net_gain > 0 && <button className="btn btn-xs btn-primary" onClick={() => applyRecovery(r)}>Apply Recovery</button>}
        <button className="btn btn-xs btn-ghost" onClick={() => doCancel(r)}>Cancel</button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader
        title="Power Diversion (Default Management)"
        subtitle="On buyer default / non-requisition, divert power to the exchange and recover against dues (PSA Art. 6.6)"
        actions={canWrite && <button className="btn btn-primary" onClick={() => { setForm(EMPTY); setError(''); setShow(true); }}>+ Record Diversion</button>}
      />

      <div className="kpi-grid">
        <StatCard label="Diversions" value={summary.total ?? 0} hint={`${fmtNumber(summary.total_mwh || 0)} MWh`} />
        <StatCard label="Exchange Sale" value={fmtCurrency(summary.total_sale || 0)} />
        <StatCard label="Net Gain" value={fmtCurrency(summary.total_gain || 0)} tone="green" />
        <StatCard label="Deficit (buyer owes)" value={fmtCurrency(summary.total_deficit || 0)} tone="amber" />
        <StatCard label="Recovered" value={fmtCurrency(summary.total_recovered || 0)} tone="green" />
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No diversions recorded.'} />
      </Card>

      <Modal open={show} onClose={() => setShow(false)} title="Record Power Diversion" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={save}>
          <Field label="PSA Contract (defaulting buyer)">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select PSA...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Period"><input required type="month" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} /></Field>
            <Field label="Reason">
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                <option value="PAYMENT_DEFAULT">Payment default</option>
                <option value="NON_REQUISITION">Power not requisitioned</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Quantum Diverted (MWh)"><input required type="number" step="0.001" value={form.quantum_mwh} onChange={(e) => setForm({ ...form, quantum_mwh: e.target.value })} /></Field>
            <Field label="Exchange">
              <select value={form.exchange_platform} onChange={(e) => setForm({ ...form, exchange_platform: e.target.value })}>
                <option value="IEX">IEX</option>
                <option value="PXIL">PXIL</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Sale Rate (₹/MWh)"><input required type="number" step="0.01" value={form.sale_rate_per_mwh} onChange={(e) => setForm({ ...form, sale_rate_per_mwh: e.target.value })} /></Field>
            <Field label="Expenses (₹)"><input type="number" step="0.01" value={form.expenses} placeholder="energy + transmission + incidental" onChange={(e) => setForm({ ...form, expenses: e.target.value })} /></Field>
          </div>
          <div className="callout" style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, fontSize: 13 }}>
            Sale: <strong>{fmtCurrency(salePreview)}</strong>{'  ·  '}Net Gain: <Signed v={netPreview} />
            <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 2 }}>Positive gain reduces the buyer's dues; a deficit is made good by the buyer.</div>
          </div>
          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Record</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
