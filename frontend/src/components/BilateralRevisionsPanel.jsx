import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../roles.js';
import { Field } from './ui.jsx';

// What a bilateral deal became partway through its term: a rate revised from a
// date, and its power split between buyers. The settlement beside this panel
// reads both, so a change here shows in the figures as soon as it is saved.
//
// Neither can be changed for a period already billed FINAL; the server says
// which bill stands in the way.

const emptyRevision = { effective_from: '', sale_rate_per_unit: '', purchase_rate_per_unit: '', reason: '', reference: '' };
const emptyBuyer = () => ({ buyer_name: '', share_percent: '', drawal_state: '' });

const box = { padding: '10px 12px', border: '1px solid var(--slate-200, #e2e8f0)', borderRadius: 8, background: 'var(--slate-50, #f8fafc)' };
const small = { fontSize: 12, color: 'var(--slate-600, #475569)' };

export default function BilateralRevisionsPanel({ transaction, onChanged }) {
  const { user } = useAuth();
  const canWrite = ROLE_GROUPS.TRADING_WRITE.includes(user?.role);
  const [revisions, setRevisions] = useState([]);
  const [sets, setSets] = useState([]);
  const [revForm, setRevForm] = useState(null);
  const [splitForm, setSplitForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api.bilateral.rateRevisions(transaction.id), api.bilateral.buyerSplits(transaction.id)])
    .then(([r, s]) => { setRevisions(r); setSets(s); })
    .catch(() => {});

  useEffect(() => { load(); setRevForm(null); setSplitForm(null); setError(''); }, [transaction.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChanged?.();
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'That change could not be saved.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const saveRevision = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(revForm).filter(([, v]) => v !== ''));
    if (await run(() => api.bilateral.addRateRevision(transaction.id, body))) setRevForm(null);
  };

  const saveSplit = async (e) => {
    e.preventDefault();
    const body = {
      effective_from: splitForm.effective_from || undefined,
      buyers: splitForm.buyers.map((b) => ({ ...b, share_percent: Number(b.share_percent), drawal_state: b.drawal_state || undefined })),
    };
    if (await run(() => api.bilateral.setBuyerSplit(transaction.id, body))) setSplitForm(null);
  };

  const shareTotal = splitForm ? splitForm.buyers.reduce((a, b) => a + (Number(b.share_percent) || 0), 0) : 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 14 }}>
      {error && <div role="alert" style={{ gridColumn: '1 / -1', padding: '8px 12px', borderRadius: 6, fontSize: 13, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>{error}</div>}

      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>Rate revisions</strong>
          {canWrite && !revForm && <button type="button" className="btn btn-xs btn-outline" onClick={() => setRevForm({ ...emptyRevision })}>Revise rate</button>}
        </div>
        <div style={small}>
          From {transaction.start_date}: ₹{transaction.sale_rate_per_unit ?? transaction.tariff_per_unit} sale,
          {' '}₹{transaction.purchase_rate_per_unit ?? '—'} purchase, ₹{transaction.trading_margin_per_unit} margin (contract)
        </div>
        {revisions.map((r) => (
          <div key={r.id} style={{ ...small, marginTop: 6, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <span>
              From {r.effective_from}: ₹{r.sale_rate_per_unit} sale, ₹{r.purchase_rate_per_unit} purchase, ₹{r.trading_margin_per_unit} margin
              <br /><em>{r.reason}{r.reference ? ` · ${r.reference}` : ''}</em>
            </span>
            {canWrite && (
              <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => run(() => api.bilateral.removeRateRevision(transaction.id, r.id))}>Remove</button>
            )}
          </div>
        ))}
        {revForm && (
          <form onSubmit={saveRevision} style={{ marginTop: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Field label="From"><input required type="date" className="input" min={transaction.start_date} max={transaction.end_date} value={revForm.effective_from} onChange={(e) => setRevForm({ ...revForm, effective_from: e.target.value })} /></Field>
              <Field label="Sale ₹/kWh"><input required type="number" step="0.0001" min="0" className="input" value={revForm.sale_rate_per_unit} onChange={(e) => setRevForm({ ...revForm, sale_rate_per_unit: e.target.value })} /></Field>
              <Field label="Purchase ₹/kWh"><input type="number" step="0.0001" min="0" className="input" placeholder="sale − margin" value={revForm.purchase_rate_per_unit} onChange={(e) => setRevForm({ ...revForm, purchase_rate_per_unit: e.target.value })} /></Field>
            </div>
            <Field label="Why (amendment, letter or order)"><input required className="input" value={revForm.reason} onChange={(e) => setRevForm({ ...revForm, reason: e.target.value })} /></Field>
            <Field label="Reference"><input className="input" value={revForm.reference} onChange={(e) => setRevForm({ ...revForm, reference: e.target.value })} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy}>Save revision</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRevForm(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>Buyers</strong>
          {canWrite && !splitForm && (
            <button type="button" className="btn btn-xs btn-outline" onClick={() => setSplitForm({ effective_from: '', buyers: [emptyBuyer(), emptyBuyer()] })}>
              {sets.length ? 'Change split' : 'Split between buyers'}
            </button>
          )}
        </div>
        {!sets.length && (
          <div style={small}>All power to {transaction.procurer_name || transaction.counterparty} — not split.</div>
        )}
        {sets.map((set) => (
          <div key={set.effective_from} style={{ ...small, marginTop: 6, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <span>
              From {set.effective_from}: {set.buyers.map((b) => `${b.buyer_name} ${b.share_percent}%${b.drawal_state ? ` (${b.drawal_state})` : ''}`).join(', ')}
            </span>
            {canWrite && (
              <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => run(() => api.bilateral.removeBuyerSplit(transaction.id, set.effective_from))}>Remove</button>
            )}
          </div>
        ))}
        {sets.length > 0 && sets[0].effective_from > transaction.start_date && (
          <div style={{ ...small, marginTop: 6 }}>Before {sets[0].effective_from}, all power to {transaction.procurer_name || transaction.counterparty}.</div>
        )}
        {splitForm && (
          <form onSubmit={saveSplit} style={{ marginTop: 8 }}>
            <Field label="From (blank for the start of the term)">
              <input type="date" className="input" min={transaction.start_date} max={transaction.end_date} value={splitForm.effective_from} onChange={(e) => setSplitForm({ ...splitForm, effective_from: e.target.value })} />
            </Field>
            {splitForm.buyers.map((b, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, alignItems: 'end' }}>
                <Field label={i === 0 ? 'Buyer' : ''}><input required aria-label={`Buyer ${i + 1}`} className="input" value={b.buyer_name} onChange={(e) => { const buyers = [...splitForm.buyers]; buyers[i] = { ...b, buyer_name: e.target.value }; setSplitForm({ ...splitForm, buyers }); }} /></Field>
                <Field label={i === 0 ? 'Share %' : ''}><input required aria-label={`Share ${i + 1}`} type="number" step="0.01" min="0.01" max="100" className="input" value={b.share_percent} onChange={(e) => { const buyers = [...splitForm.buyers]; buyers[i] = { ...b, share_percent: e.target.value }; setSplitForm({ ...splitForm, buyers }); }} /></Field>
                <Field label={i === 0 ? 'Drawal state' : ''}><input aria-label={`Drawal state ${i + 1}`} className="input" value={b.drawal_state} onChange={(e) => { const buyers = [...splitForm.buyers]; buyers[i] = { ...b, drawal_state: e.target.value }; setSplitForm({ ...splitForm, buyers }); }} /></Field>
                <button type="button" className="btn btn-xs btn-ghost" style={{ marginBottom: 4 }} disabled={splitForm.buyers.length <= 2}
                  onClick={() => setSplitForm({ ...splitForm, buyers: splitForm.buyers.filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <div style={{ ...small, margin: '4px 0 8px', color: Math.abs(shareTotal - 100) > 0.01 ? '#b45309' : 'var(--slate-600, #475569)' }}>
              Shares total {Number(shareTotal.toFixed(2))}%{Math.abs(shareTotal - 100) > 0.01 ? ' — they must total 100%' : ''}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setSplitForm({ ...splitForm, buyers: [...splitForm.buyers, emptyBuyer()] })}>Add buyer</button>
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy || Math.abs(shareTotal - 100) > 0.01}>Save split</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSplitForm(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
