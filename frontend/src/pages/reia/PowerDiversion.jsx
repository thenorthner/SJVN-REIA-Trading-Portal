import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

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
  const [popup, setPopup] = useState(null); // { title, message, tone, confirm: { label, run } }
  const busy = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.powerDiversion.list(), api.powerDiversion.summary()])
      .then(([list, sum]) => { setRows(list); setSummary(sum || {}); })
      .catch((err) => setPopup({ title: 'Could not load diversions', message: err.response?.data?.error || 'The diversion register did not load.' }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => { api.contracts.list({ contract_type: 'PSA' }).then(setContracts).catch(() => api.contracts.list().then((c) => setContracts(c.filter((x) => x.contract_type === 'PSA'))).catch(() => {})); }, []);

  const salePreview = (Number(form.quantum_mwh) || 0) * (Number(form.sale_rate_per_mwh) || 0);
  const netPreview = salePreview - (Number(form.expenses) || 0);

  async function save(e) {
    e.preventDefault();
    if (busy.current) return;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const problem = !(Number(form.quantum_mwh) > 0) ? 'Quantum must be more than zero.'
      : !(Number(form.sale_rate_per_mwh) > 0) ? 'The sale rate must be a positive ₹/MWh figure.'
        : Number(form.expenses) < 0 ? 'Expenses cannot be negative.'
          : form.period_month > thisMonth ? `${form.period_month} has not started.` : '';
    if (problem) { setError(problem); return; }
    setError('');
    busy.current = true;
    try {
      await api.powerDiversion.create({ ...form, quantum_mwh: Number(form.quantum_mwh), sale_rate_per_mwh: Number(form.sale_rate_per_mwh), expenses: Number(form.expenses) || 0 });
      setShow(false); setForm(EMPTY); load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record diversion.');
    } finally {
      busy.current = false;
    }
  }

  function applyRecovery(r) {
    setPopup({
      tone: 'warning',
      title: `Recover ${r.diversion_no}`,
      message: `Set ${fmtCurrency(r.net_gain)} against ${r.buyer_name || 'the buyer'}'s dues on ${r.contract_no}, surcharge first and oldest bill first. Whatever this PSA does not owe is held as the buyer's advance, for Finance to apply to a later bill or refund. This cannot be undone.`,
      confirm: {
        label: 'Recover',
        run: async () => {
          const res = await api.powerDiversion.recover(r.id);
          load();
          setPopup({
            tone: 'success',
            title: 'Recovered',
            message: `${fmtCurrency(res.applied_amount)} set against ${res.allocations.length} bill${res.allocations.length === 1 ? '' : 's'} on ${r.contract_no}.${res.held_as_advance ? ` ${fmtCurrency(res.held_as_advance)} was more than the PSA owed and is held as the buyer's advance.` : ''}`,
          });
        },
      },
    });
  }

  // A sale below costs leaves the buyer owing the deficit (PSA Art. 6.6): it is
  // drafted as a debit note on the PSA for Finance to approve (17-Oct-2026).
  function billDeficit(r) {
    setPopup({
      tone: 'warning',
      title: `Bill the deficit on ${r.diversion_no}`,
      message: `Draft a debit note of ${fmtCurrency(Math.abs(r.net_gain))} on ${r.buyer_name || 'the buyer'}'s latest bill under ${r.contract_no}. It goes to Finance for approval before it is issued.`,
      confirm: {
        label: 'Draft debit note',
        run: async () => {
          const res = await api.powerDiversion.billDeficit(r.id);
          load();
          setPopup({ tone: 'success', title: 'Debit note drafted', message: `${res.note?.note_no || 'The debit note'} for ${fmtCurrency(Math.abs(r.net_gain))} is with Finance for approval.` });
        },
      },
    });
  }

  function doCancel(r) {
    setPopup({
      tone: 'warning',
      title: `Cancel ${r.diversion_no}`,
      message: `Cancel the diversion of ${fmtNumber(r.quantum_mwh)} MWh for ${r.period_month}? It drops out of every total.`,
      confirm: { label: 'Cancel diversion', run: async () => { await api.powerDiversion.remove(r.id); load(); setPopup(null); } },
    });
  }

  async function confirmPopup() {
    if (busy.current || !popup?.confirm) return;
    busy.current = true;
    try {
      await popup.confirm.run();
    } catch (err) {
      setPopup({ title: 'Not done', message: err.response?.data?.error || err.message });
    } finally {
      busy.current = false;
    }
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
        {r.net_gain > 0 && <button className="btn btn-xs btn-primary" onClick={() => applyRecovery(r)}>Recover against dues</button>}
        {r.net_gain < 0 && <button className="btn btn-xs btn-primary" onClick={() => billDeficit(r)}>Bill the deficit</button>}
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

      <AlertPopup
        open={!!popup}
        tone={popup?.tone || 'error'}
        title={popup?.title}
        message={popup?.message}
        okLabel={popup?.confirm ? 'Back' : undefined}
        actions={popup?.confirm ? <button type="button" className="btn btn-danger" onClick={confirmPopup}>{popup.confirm.label}</button> : undefined}
        onClose={() => setPopup(null)}
      />
      <Modal open={show} onClose={() => setShow(false)} title="Record Power Diversion" width={560}>
        <AlertPopup open={!!error} title="Not recorded" message={error} onClose={() => setError('')} />
        <form onSubmit={save}>
          <Field label="PSA Contract (defaulting buyer)">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select PSA...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Period"><input required type="month" max={new Date().toISOString().slice(0, 7)} value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} /></Field>
            <Field label="Reason">
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                <option value="PAYMENT_DEFAULT">Payment default</option>
                <option value="NON_REQUISITION">Power not requisitioned</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Quantum Diverted (MWh)"><input required type="number" min="0.001" step="0.001" value={form.quantum_mwh} onChange={(e) => setForm({ ...form, quantum_mwh: e.target.value })} /></Field>
            <Field label="Exchange">
              <select value={form.exchange_platform} onChange={(e) => setForm({ ...form, exchange_platform: e.target.value })}>
                <option value="IEX">IEX</option>
                <option value="PXIL">PXIL</option>
              </select>
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Sale Rate (₹/MWh)"><input required type="number" min="0.01" max="20000" step="0.01" value={form.sale_rate_per_mwh} onChange={(e) => setForm({ ...form, sale_rate_per_mwh: e.target.value })} /></Field>
            <Field label="Expenses (₹)"><input type="number" min="0" step="0.01" value={form.expenses} placeholder="energy + transmission + incidental" onChange={(e) => setForm({ ...form, expenses: e.target.value })} /></Field>
          </div>
          <div className="callout" style={{ margin: '8px 0', padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, fontSize: 13 }}>
            Sale: <strong>{fmtCurrency(salePreview)}</strong>{'  ·  '}Net Gain: <Signed v={netPreview} />
            <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 2 }}>Positive gain reduces the buyer's dues; a deficit is made good by the buyer.</div>
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
