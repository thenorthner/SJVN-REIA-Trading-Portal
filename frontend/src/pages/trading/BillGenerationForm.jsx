import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field, Badge, fmtNumber } from '../../components/ui.jsx';

/**
 * Generate Bill — the client-first way in to all six bills.
 *
 * Pick a counterparty and what to bill them for; the platform finds the
 * contracts of the register that bill type settles against, prices the period
 * off the settlement engine behind it, and raises it into the View Bills
 * register. The screen previously listed hardcoded clients and logged the form
 * to the console.
 */

const EMPTY = {
  bill_type: '',
  client_name: '',
  contract_id: '',
  from: '',
  to: '',
  lps: 'No',
  gst_applicable: false,
  invoice_date: '',
  remarks: '',
};

export default function BillGenerationForm() {
  const [meta, setMeta] = useState({ bill_types: [] });
  const [clients, setClients] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [raised, setRaised] = useState(null);

  useEffect(() => {
    api.billing.meta().then(setMeta).catch(() => {});
    api.billing.clients().then(setClients).catch(() => setClients([]));
  }, []);

  // The bill type decides which register is searched, so the contract list is
  // reloaded whenever either it or the client changes.
  useEffect(() => {
    setContracts([]);
    setForm((f) => ({ ...f, contract_id: '' }));
    setPreview(null);
    if (!form.bill_type || !form.client_name) return;
    api.billing.contracts({ bill_type: form.bill_type, client_name: form.client_name })
      .then(setContracts)
      .catch(() => setContracts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.bill_type, form.client_name]);

  const selected = useMemo(
    () => contracts.find((c) => c.contract_id === form.contract_id) || null,
    [contracts, form.contract_id],
  );

  const set = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
    setRaised(null);
    if (['from', 'to', 'lps', 'gst_applicable', 'contract_id'].includes(field)) setPreview(null);
  };

  function body() {
    const b = {
      bill_type: form.bill_type,
      contract_id: form.contract_id,
      lps: form.lps,
      gst_applicable: form.gst_applicable,
    };
    if (form.from) b.from = form.from;
    if (form.to) b.to = form.to;
    if (form.invoice_date) b.invoice_date = form.invoice_date;
    if (form.remarks) b.remarks = form.remarks;
    return b;
  }

  async function runPreview() {
    setBusy('preview');
    setError('');
    setRaised(null);
    try {
      setPreview(await api.billing.preview(body()));
    } catch (err) {
      setPreview(null);
      setError(err.response?.data?.error || 'Could not price this bill.');
    } finally {
      setBusy('');
    }
  }

  async function onGenerate(e) {
    e.preventDefault();
    setBusy('generate');
    setError('');
    try {
      const inv = await api.billing.generate(body());
      setRaised(inv);
      setPreview(null);
      setForm((f) => ({ ...f, contract_id: '', from: '', to: '' }));
    } catch (err) {
      const d = err.response?.data || {};
      setError(d.error || 'Failed to generate the bill.');
    } finally {
      setBusy('');
    }
  }

  const ready = form.bill_type && form.client_name && form.contract_id;
  const blocked = preview?.objection || null;

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <div className="form-section-header" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Bill Generation</span>
        <Link to="/billing/view-bills" className="btn btn-sm btn-primary">View Bills →</Link>
      </div>

      <Card>
        <form onSubmit={onGenerate}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Bill Type" required>
              <select className="input" required value={form.bill_type} onChange={(e) => set('bill_type', e.target.value)}>
                <option value="">— select an option —</option>
                {meta.bill_types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </Field>

            <Field label="Client" required>
              <select className="input" required value={form.client_name} onChange={(e) => set('client_name', e.target.value)}>
                <option value="">— select an option —</option>
                {clients.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </Field>

            <Field label="Contract" required>
              <select className="input" required value={form.contract_id}
                disabled={!form.bill_type || !form.client_name}
                onChange={(e) => set('contract_id', e.target.value)}>
                <option value="">
                  {!form.bill_type || !form.client_name ? 'select a bill type and client first'
                    : contracts.length ? '— select an option —' : 'no contracts of this kind for this client'}
                </option>
                {contracts.map((c) => (
                  <option key={c.contract_id} value={c.contract_id} disabled={!c.billable}>
                    {c.label} · {c.start_date} to {c.end_date}{c.billable ? '' : ' (not billable yet)'}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Invoice date">
              <input type="date" className="input" value={form.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} />
            </Field>

            <Field label="Supply from">
              <input type="date" className="input" value={form.from} onChange={(e) => set('from', e.target.value)} />
            </Field>

            <Field label="Supply to">
              <input type="date" className="input" value={form.to} onChange={(e) => set('to', e.target.value)} />
            </Field>

            <Field label="Whether LPS" required>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', height: 36 }}>
                {['Yes', 'No'].map((v) => (
                  <label key={v} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input type="radio" name="lps" checked={form.lps === v} onChange={() => set('lps', v)} /> {v}
                  </label>
                ))}
              </div>
            </Field>

            <Field label="GST">
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', height: 36, fontSize: 13 }}>
                <input type="checkbox" checked={form.gst_applicable} onChange={(e) => set('gst_applicable', e.target.checked)} />
                Charge GST at 18%
              </label>
            </Field>
          </div>

          {selected && (
            <p style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
              {selected.kind} contract · {selected.state}
              {!selected.billable && ' — this one cannot be billed yet.'}
              {!form.from && !form.to && ' · leaving the period blank bills the whole contract.'}
            </p>
          )}

          {error && (
            <div style={{ marginTop: 14, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-outline" disabled={!ready || busy === 'preview'} onClick={runPreview}>
              {busy === 'preview' ? 'Pricing…' : 'Preview'}
            </button>
            <button type="submit" className="btn btn-primary" disabled={!ready || busy === 'generate'}>
              {busy === 'generate' ? 'Generating…' : 'Generate Bill'}
            </button>
          </div>
        </form>
      </Card>

      {preview && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>Preview — nothing is raised yet</strong>
            <Badge type={blocked ? 'danger' : 'success'}>
              {blocked ? 'cannot raise' : `₹${fmtNumber(preview.invoice_amount, 0)}`}
            </Badge>
          </div>

          {blocked && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, fontSize: 13, color: '#9a3412' }}>
              {blocked.error}
              {blocked.would_bill != null && <> (would bill ₹{fmtNumber(blocked.would_bill, 0)})</>}
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {['Description', 'Basis', 'Quantity', 'Rate', 'Amount (₹)'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Amount (₹)' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.line_items.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '8px 10px' }}>{l.description}</td>
                  <td style={{ padding: '8px 10px', color: '#64748b' }}>{l.basis}</td>
                  <td style={{ padding: '8px 10px' }}>{l.quantity == null ? '—' : fmtNumber(l.quantity, 3)}</td>
                  <td style={{ padding: '8px 10px' }}>{l.rate == null ? '—' : fmtNumber(l.rate, 2)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtNumber(l.amount, 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {preview.gst_amount > 0 && (
                <tr><td colSpan={4} style={{ padding: '8px 10px', textAlign: 'right' }}>GST</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtNumber(preview.gst_amount, 0)}</td></tr>
              )}
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={4} style={{ padding: '8px 10px', textAlign: 'right' }}>Invoice amount</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtNumber(preview.invoice_amount, 0)}</td>
              </tr>
              <tr style={{ color: '#64748b' }}>
                <td colSpan={4} style={{ padding: '8px 10px', textAlign: 'right' }}>Less TDS @ {preview.tds_rate}%</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtNumber(preview.tds_deducted, 0)}</td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={4} style={{ padding: '8px 10px', textAlign: 'right' }}>Net receivable</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtNumber(preview.net_receivable, 0)}</td>
              </tr>
            </tfoot>
          </table>

          {preview.warnings?.length > 0 && (
            <ul style={{ margin: '10px 0 0 18px', fontSize: 12, color: '#9a3412' }}>
              {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </Card>
      )}

      {raised && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, color: '#166534', fontSize: 13 }}>
            <strong>{raised.invoice_no}</strong> raised for ₹{fmtNumber(raised.invoice_amount, 0)} ({raised.settlement_basis}).{' '}
            <Link to="/billing/view-bills" style={{ color: '#166534', textDecoration: 'underline' }}>Open View Bills</Link>
          </div>
        </Card>
      )}
    </div>
  );
}
