import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field, Badge, fmtNumber } from '../../components/ui.jsx';

/**
 * Supply Bill Entry — the Bill of Supply register.
 *
 * Electricity sits outside GST, so a supply of power is billed on a Bill of
 * Supply rather than a tax invoice. The screen previously kept nothing: the
 * form had no submit handler at all.
 */

const EMPTY = {
  client_name: '',
  client_id: '',
  seller_name: '',
  buyer_name: '',
  contract_no: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  invoice_due_date: '',
  supply_from_date: '',
  supply_to_date: '',
  description: 'Supply of electrical energy',
  hsn_code: '27160000',
  quantity: '',
  unit: 'MWh',
  rate: '',
  rebate_percent: '0',
  remarks: '',
};

export default function BillOfSupplyForm() {
  const [form, setForm] = useState(EMPTY);
  const [clients, setClients] = useState([]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  function load() {
    api.billing.listBillOfSupply().then(setRows).catch(() => setRows([]));
  }

  useEffect(() => {
    api.billing.clients().then(setClients).catch(() => setClients([]));
    load();
  }, []);

  const set = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setMessage(null);
  };

  // The amount and the rebate are shown as the backend will compute them, so
  // the operator is never asked to keep two figures in step by hand.
  const computed = useMemo(() => {
    const qty = Number(form.quantity) || 0;
    const rate = Number(form.rate) || 0;
    const rebate = Number(form.rebate_percent) || 0;
    const amount = Number((qty * rate).toFixed(2));
    return { amount, after: Number((amount * (1 - rebate / 100)).toFixed(2)) };
  }, [form.quantity, form.rate, form.rebate_percent]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.billing.createBillOfSupply({
        ...form,
        client_id: form.client_id || undefined,
        quantity: Number(form.quantity),
        rate: Number(form.rate),
        rebate_percent: Number(form.rebate_percent) || 0,
      });
      setMessage({ ok: true, text: `${created.bill_no} recorded for ₹${fmtNumber(created.amount_after_rebate, 2)}.` });
      setForm({ ...EMPTY, invoice_date: form.invoice_date });
      load();
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || 'Failed to record the bill of supply.' });
    } finally {
      setBusy(false);
    }
  }

  async function onCancel(row) {
    if (!window.confirm(`Cancel ${row.bill_no}?`)) return;
    try {
      await api.billing.cancelBillOfSupply(row.id);
      setMessage({ ok: true, text: `${row.bill_no} cancelled.` });
      load();
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || 'Failed to cancel.' });
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
      <div className="form-section-header" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Bill of Supply</span>
        <Link to="/reports/supply-bill-report" className="btn btn-sm btn-primary">Report of Supply Bill →</Link>
      </div>

      <Card>
        <form onSubmit={onSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <Field label="Client Name" required>
              <input list="bos-clients" className="input" required value={form.client_name}
                onChange={(e) => {
                  const match = clients.find((c) => c.name === e.target.value);
                  setForm((f) => ({ ...f, client_name: e.target.value, client_id: match?.client_id || '' }));
                }} />
              <datalist id="bos-clients">
                {clients.map((c) => <option key={c.name} value={c.name} />)}
              </datalist>
            </Field>
            <Field label="Seller Name"><input className="input" value={form.seller_name} onChange={(e) => set('seller_name', e.target.value)} /></Field>
            <Field label="Buyer Name"><input className="input" value={form.buyer_name} onChange={(e) => set('buyer_name', e.target.value)} /></Field>

            <Field label="Contract No"><input className="input" value={form.contract_no} onChange={(e) => set('contract_no', e.target.value)} /></Field>
            <Field label="Invoice Date" required>
              <input type="date" className="input" required value={form.invoice_date} onChange={(e) => set('invoice_date', e.target.value)} />
            </Field>
            <Field label="Invoice Due Date">
              <input type="date" className="input" value={form.invoice_due_date} onChange={(e) => set('invoice_due_date', e.target.value)} />
            </Field>

            <Field label="Supply Period From" required>
              <input type="date" className="input" required value={form.supply_from_date} onChange={(e) => set('supply_from_date', e.target.value)} />
            </Field>
            <Field label="Supply Period To" required>
              <input type="date" className="input" required value={form.supply_to_date} onChange={(e) => set('supply_to_date', e.target.value)} />
            </Field>
            <Field label="HSN Code"><input className="input" value={form.hsn_code} onChange={(e) => set('hsn_code', e.target.value)} /></Field>

            <Field label="Description">
              <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label="Quantity" required>
              <input type="number" step="0.001" min="0.001" className="input" required value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
            </Field>
            <Field label="Unit">
              <select className="input" value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                <option value="MWh">MWh</option>
                <option value="kWh">kWh</option>
                <option value="MU">MU</option>
              </select>
            </Field>

            <Field label="Rate (INR)" required>
              <input type="number" step="0.01" min="0" className="input" required value={form.rate} onChange={(e) => set('rate', e.target.value)} />
            </Field>
            <Field label="Rebate (%)">
              <input type="number" step="0.01" min="0" max="100" className="input" value={form.rebate_percent} onChange={(e) => set('rebate_percent', e.target.value)} />
            </Field>
            <Field label="Remarks"><input className="input" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></Field>
          </div>

          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--slate-50)', border: '1px solid var(--slate-200)', borderRadius: 8, display: 'flex', gap: 28, fontSize: 13 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'uppercase' }}>Amount</div>
              <strong style={{ fontSize: 16 }}>₹{fmtNumber(computed.amount, 2)}</strong>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'uppercase' }}>After rebate</div>
              <strong style={{ fontSize: 16 }}>₹{fmtNumber(computed.after, 2)}</strong>
            </div>
            <div style={{ alignSelf: 'center', color: 'var(--slate-500)', fontSize: 12 }}>
              Quantity × rate, less the rebate — computed, not typed.
            </div>
          </div>

          {message && (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 6, fontSize: 13,
              background: message.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${message.ok ? '#bbf7d0' : '#fecaca'}`,
              color: message.ok ? '#166534' : '#991b1b',
            }}>{message.text}</div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-outline" onClick={() => setForm(EMPTY)}>Clear</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Submit'}</button>
          </div>
        </form>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Recent bills of supply</strong>
          <button type="button" className="btn btn-sm btn-outline" onClick={load}>Refresh</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {['Bill No', 'Client', 'Invoice Date', 'Supply Period', 'Qty', 'Rate', 'After Rebate', 'Status', ''].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: '#64748b' }}>No bills of supply yet.</td></tr>
              ) : rows.slice(0, 20).map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{r.bill_no}</td>
                  <td style={{ padding: '8px 10px' }}>{r.client_name}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.invoice_date}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{r.supply_from_date} → {r.supply_to_date}</td>
                  <td style={{ padding: '8px 10px' }}>{fmtNumber(r.quantity, 3)} {r.unit}</td>
                  <td style={{ padding: '8px 10px' }}>₹{fmtNumber(r.rate, 2)}</td>
                  <td style={{ padding: '8px 10px' }}>₹{fmtNumber(r.amount_after_rebate, 2)}</td>
                  <td style={{ padding: '8px 10px' }}><Badge type={r.status === 'ACTIVE' ? 'success' : 'danger'}>{r.status}</Badge></td>
                  <td style={{ padding: '8px 10px' }}>
                    {r.status === 'ACTIVE' && (
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => onCancel(r)}>Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
