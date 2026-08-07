import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, StatCard, Field, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const EMPTY = {
  quantum_mwh: '', days: '1', on_date: '', injection_state: '', drawal_state: '',
  ists_rate: '', include_ists: true, bilateral_id: '',
};

export default function OAChargeCalculator() {
  const [form, setForm] = useState(EMPTY);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bilaterals, setBilaterals] = useState([]);
  const [states, setStates] = useState([]);
  const [saved, setSaved] = useState([]);

  useEffect(() => {
    api.bilateral.list().then(setBilaterals).catch(() => {});
    // State options come from the STU charges actually configured in the master,
    // so the calculator can only be pointed at a state it can price.
    api.rateMaster.list({ category: 'STU' })
      .then(rows => setStates([...new Set(rows.map(r => r.charge_name.replace(/ STU$/, '')))].sort()))
      .catch(() => {});
  }, []);

  function payload() {
    const b = {
      quantum_mwh: Number(form.quantum_mwh),
      days: Number(form.days) || 1,
      include_ists: form.include_ists,
    };
    if (form.on_date) b.on_date = form.on_date;
    if (form.injection_state) b.injection_state = `${form.injection_state}`;
    if (form.drawal_state) b.drawal_state = `${form.drawal_state}`;
    if (form.ists_rate !== '') b.ists_rate = Number(form.ists_rate);
    return b;
  }

  async function calculate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      setResult(await api.oaCharges.estimate(payload()));
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to calculate');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form.bilateral_id) return alert('Pick the deal to save this estimate against.');
    setBusy(true);
    try {
      await api.oaCharges.save({ ...payload(), bilateral_id: form.bilateral_id });
      await loadSaved(form.bilateral_id);
      alert('Estimate saved against the deal.');
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to save estimate');
    } finally {
      setBusy(false);
    }
  }

  async function loadSaved(id) {
    if (!id) return setSaved([]);
    try { setSaved(await api.oaCharges.forBilateral(id)); } catch { setSaved([]); }
  }

  const lineColumns = [
    { key: 'charge', label: 'Charge' },
    { key: 'category', label: 'Category', render: r => <Badge type="primary">{r.category}</Badge> },
    { key: 'rate', label: 'Rate', render: r => `₹${fmtNumber(r.rate, 2)}` },
    { key: 'basis', label: 'Basis' },
    {
      key: 'qty',
      label: 'Quantity',
      render: r => (r.basis === 'Rs/MWh' ? `${fmtNumber(r.quantum_mwh, 3)} MWh` : r.basis === 'Rs/day' ? `${r.days} day(s)` : 'flat'),
    },
    { key: 'amount', label: 'Amount', render: r => <strong>{fmtCurrency(r.amount)}</strong> },
    {
      key: 'bearer',
      label: 'Borne by',
      render: r => <Badge type={r.bearer === 'SELLER' ? 'warning' : 'success'}>{r.bearer}</Badge>,
    },
    {
      key: 'rate_source',
      label: 'Rate from',
      render: r => <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.rate_source === 'OVERRIDE' ? 'Manual override' : 'Rate master'}</span>,
    },
  ];

  const savedColumns = [
    { key: 'created_at', label: 'Saved' },
    { key: 'on_date', label: 'Priced on' },
    { key: 'quantum_mwh', label: 'MWh', render: r => fmtNumber(r.quantum_mwh, 3) },
    { key: 'seller_total', label: 'Seller', render: r => fmtCurrency(r.seller_total) },
    { key: 'buyer_total', label: 'Buyer', render: r => fmtCurrency(r.buyer_total) },
    { key: 'total', label: 'Total', render: r => <strong>{fmtCurrency(r.total)}</strong> },
  ];

  return (
    <div>
      <PageHeader
        title="Open Access Charge Calculator"
        subtitle="Prices ISTS, STU, RLDC/SLDC and NOAR charges from the effective-dated rate master, split by who bears them"
      />

      <Card title="Application details">
        <form onSubmit={calculate}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 15 }}>
            <Field label="Quantum (MWh)" required>
              <input type="number" step="0.001" className="input" value={form.quantum_mwh} onChange={e => setForm({ ...form, quantum_mwh: e.target.value })} required />
            </Field>
            <Field label="Days">
              <input type="number" min="1" className="input" value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} />
            </Field>
            <Field label="Priced on">
              <input type="date" className="input" value={form.on_date} onChange={e => setForm({ ...form, on_date: e.target.value })} />
            </Field>
            <Field label="Injection state (seller side)">
              <select className="input" value={form.injection_state} onChange={e => setForm({ ...form, injection_state: e.target.value })}>
                <option value="">None</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Drawal state (buyer side)">
              <select className="input" value={form.drawal_state} onChange={e => setForm({ ...form, drawal_state: e.target.value })}>
                <option value="">None</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="ISTS rate override (₹/MWh)">
              <input type="number" step="0.01" className="input" value={form.ists_rate} onChange={e => setForm({ ...form, ists_rate: e.target.value })} placeholder="blank = rate master" />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 14 }}>
            <input type="checkbox" checked={form.include_ists} onChange={e => setForm({ ...form, include_ists: e.target.checked })} />
            Include ISTS charge
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Calculating…' : 'Calculate'}</button>
          </div>
        </form>
      </Card>

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, marginBottom: 20 }}>
            <StatCard label="Total OA charges" value={fmtCurrency(result.total)} />
            <StatCard label="Borne by seller" value={fmtCurrency(result.by_bearer.SELLER)} tone="warning" />
            <StatCard label="Borne by buyer" value={fmtCurrency(result.by_bearer.BUYER)} tone="success" />
            <StatCard label="Priced on" value={result.on_date} hint={`${fmtNumber(result.quantum_mwh, 3)} MWh over ${result.days} day(s)`} />
          </div>

          {result.warnings?.length > 0 && (
            <Card title="Warnings">
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--danger, #b91c1c)', fontSize: 14 }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </Card>
          )}

          <Card
            title="Charge breakdown"
            actions={(
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select
                  className="input"
                  value={form.bilateral_id}
                  onChange={e => { setForm({ ...form, bilateral_id: e.target.value }); loadSaved(e.target.value); }}
                  style={{ width: 260 }}
                >
                  <option value="">Save against deal…</option>
                  {bilaterals.map(b => <option key={b.id} value={b.id}>{b.client_name || b.counterparty} — {b.id}</option>)}
                </select>
                <button className="btn btn-secondary" onClick={save} disabled={busy || !form.bilateral_id}>Save estimate</button>
              </div>
            )}
          >
            <Table columns={lineColumns} rows={result.line_items} emptyMessage="Nothing priced — check the inputs." />
          </Card>
        </>
      )}

      {form.bilateral_id && (
        <Card title="Saved estimates for this deal">
          <Table columns={savedColumns} rows={saved} emptyMessage="No estimates saved against this deal yet." />
        </Card>
      )}
    </div>
  );
}
