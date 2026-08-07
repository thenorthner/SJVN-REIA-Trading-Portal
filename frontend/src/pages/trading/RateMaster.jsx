import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const CATEGORIES = ['ISTS', 'STU', 'RLDC', 'SLDC', 'NOAR_FEE', 'OPERATING'];

const EMPTY_NEW = { rate_category: 'STU', charge_name: '', region: '', rate_value: '', unit: 'Rs/MWh', effective_from: '', note: '' };
const EMPTY_REVISION = { charge_name: '', rate_value: '', effective_from: '', note: '' };

export default function RateMaster() {
  const [rates, setRates] = useState([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showNew, setShowNew] = useState(false);
  const [newRate, setNewRate] = useState(EMPTY_NEW);
  const [showRevise, setShowRevise] = useState(false);
  const [revision, setRevision] = useState(EMPTY_REVISION);

  // Ad-hoc "what rate applied on this date" lookup.
  const [lookup, setLookup] = useState({ charge: '', date: '' });
  const [lookupResult, setLookupResult] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setRates(await api.rateMaster.list(category ? { category } : undefined));
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load rates');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [category]);

  async function submitNew(e) {
    e.preventDefault();
    try {
      await api.rateMaster.create({ ...newRate, rate_value: Number(newRate.rate_value) });
      setShowNew(false); setNewRate(EMPTY_NEW); load();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to create rate');
    }
  }

  async function submitRevision(e) {
    e.preventDefault();
    try {
      await api.rateMaster.revise({ ...revision, rate_value: Number(revision.rate_value) });
      setShowRevise(false); setRevision(EMPTY_REVISION); load();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to revise rate');
    }
  }

  async function runLookup(e) {
    e.preventDefault();
    setLookupResult(null);
    try {
      setLookupResult(await api.rateMaster.effective(lookup.charge, lookup.date || undefined));
    } catch (err) {
      setLookupResult({ error: err.response?.data?.error || 'No rate in force for that charge and date' });
    }
  }

  const charges = [...new Set(rates.map(r => r.charge_name))].sort();

  const columns = [
    { key: 'rate_category', label: 'Category', render: r => <Badge type="primary">{r.rate_category}</Badge> },
    { key: 'charge_name', label: 'Charge' },
    { key: 'region', label: 'Region', render: r => r.region || '—' },
    { key: 'rate_value', label: 'Rate', render: r => `₹${fmtNumber(r.rate_value, 2)}` },
    { key: 'unit', label: 'Basis' },
    { key: 'effective_from', label: 'Effective from' },
    {
      key: 'effective_to',
      label: 'Effective to',
      // An open-ended window is the rate in force today.
      render: r => (r.effective_to ? r.effective_to : <Badge type="success">Current</Badge>),
    },
    { key: 'created_by', label: 'Source', render: r => <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.created_by || '—'}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Open Access Rate Master"
        subtitle="Effective-dated ISTS, STU, RLDC/SLDC and NOAR charges used to price open-access applications"
        actions={(
          <>
            <button className="btn btn-secondary" onClick={() => setShowRevise(true)}>Revise a rate</button>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New charge</button>
          </>
        )}
      />

      <Card title="What rate applied on a date?">
        <form onSubmit={runLookup} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Charge">
            <select className="input" value={lookup.charge} onChange={e => setLookup({ ...lookup, charge: e.target.value })} required>
              <option value="">Select charge</option>
              {charges.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="On date">
            <input type="date" className="input" value={lookup.date} onChange={e => setLookup({ ...lookup, date: e.target.value })} />
          </Field>
          <button className="btn btn-secondary" type="submit">Look up</button>
          {lookupResult && (
            <div style={{ marginLeft: 8, fontSize: 14 }}>
              {lookupResult.error
                ? <span style={{ color: 'var(--danger, #b91c1c)' }}>{lookupResult.error}</span>
                : <span><strong>₹{fmtNumber(lookupResult.rate_value, 2)}</strong> {lookupResult.unit} · in force {lookupResult.effective_from} → {lookupResult.effective_to || 'current'}</span>}
            </div>
          )}
        </form>
      </Card>

      <Card
        title="Rate register"
        actions={(
          <select className="input" value={category} onChange={e => setCategory(e.target.value)} style={{ width: 180 }}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      >
        {error && <div style={{ color: 'var(--danger, #b91c1c)', marginBottom: 10 }}>{error}</div>}
        <Table columns={columns} rows={rates} loading={loading} emptyMessage="No rates configured." />
      </Card>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="New charge">
        <form onSubmit={submitNew}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 16 }}>
            <Field label="Category" required>
              <select className="input" value={newRate.rate_category} onChange={e => setNewRate({ ...newRate, rate_category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Charge name" required>
              <input className="input" value={newRate.charge_name} onChange={e => setNewRate({ ...newRate, charge_name: e.target.value })} required placeholder="e.g. Delhi STU" />
            </Field>
            <Field label="Region">
              <input className="input" value={newRate.region} onChange={e => setNewRate({ ...newRate, region: e.target.value })} placeholder="e.g. DELHI" />
            </Field>
            <Field label="Basis" required>
              <select className="input" value={newRate.unit} onChange={e => setNewRate({ ...newRate, unit: e.target.value })}>
                <option value="Rs/MWh">Rs/MWh</option>
                <option value="Rs/day">Rs/day</option>
                <option value="Rs/application">Rs/application</option>
              </select>
            </Field>
            <Field label="Rate (₹)" required>
              <input type="number" step="0.01" className="input" value={newRate.rate_value} onChange={e => setNewRate({ ...newRate, rate_value: e.target.value })} required />
            </Field>
            <Field label="Effective from" required>
              <input type="date" className="input" value={newRate.effective_from} onChange={e => setNewRate({ ...newRate, effective_from: e.target.value })} required />
            </Field>
          </div>
          <Field label="Note">
            <input className="input" value={newRate.note} onChange={e => setNewRate({ ...newRate, note: e.target.value })} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      <Modal open={showRevise} onClose={() => setShowRevise(false)} title="Revise a rate">
        <form onSubmit={submitRevision}>
          <p style={{ fontSize: 13, color: 'var(--slate-500)', marginBottom: 14 }}>
            The current window is closed the day before the new rate starts, so the history stays intact and non-overlapping.
          </p>
          <Field label="Charge" required>
            <select className="input" value={revision.charge_name} onChange={e => setRevision({ ...revision, charge_name: e.target.value })} required>
              <option value="">Select charge</option>
              {charges.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginTop: 12 }}>
            <Field label="New rate (₹)" required>
              <input type="number" step="0.01" className="input" value={revision.rate_value} onChange={e => setRevision({ ...revision, rate_value: e.target.value })} required />
            </Field>
            <Field label="Effective from" required>
              <input type="date" className="input" value={revision.effective_from} onChange={e => setRevision({ ...revision, effective_from: e.target.value })} required />
            </Field>
          </div>
          <Field label="Note">
            <input className="input" value={revision.note} onChange={e => setRevision({ ...revision, note: e.target.value })} placeholder="e.g. CERC order reference" />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowRevise(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save revision</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
