import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field } from '../../components/ui.jsx';

const EMPTY = {
  transaction_code: '',
  user_id: '',
  password: '',
  nor: '',
  tm_id: '',
  reference_no: '',
  tac_id: '',
  order_type: '',
  product_code: '',
  quantity: '',
  price: '',
  delivery_date_from: '',
  delivery_date_to: '',
  from_time: '',
  to_time: '',
  side: 'Seller',
};

/**
 * ISET Pxil Order Creation — all fields mandatory; credentials used for
 * session auth only (password is not persisted).
 */
export default function PxilOrderCreation() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);

    for (const [key, label] of [
      ['transaction_code', 'Transaction Code'],
      ['user_id', 'User ID'],
      ['password', 'Password'],
      ['nor', 'NOR'],
      ['tm_id', 'TM ID'],
      ['reference_no', 'Reference No'],
      ['tac_id', 'Tac Id'],
      ['order_type', 'Order Type'],
      ['product_code', 'Product Code'],
      ['quantity', 'Quantity'],
      ['price', 'Price'],
      ['delivery_date_from', 'Delivery Date From'],
      ['delivery_date_to', 'Delivery Date To'],
      ['from_time', 'From Time'],
      ['to_time', 'To Time'],
      ['side', 'Side'],
    ]) {
      if (!String(form[key] ?? '').trim()) {
        setError(`${label} is required`);
        return;
      }
    }

    if (form.delivery_date_from > form.delivery_date_to) {
      setError('Delivery Date From must be on or before Delivery Date To');
      return;
    }

    setBusy(true);
    try {
      const created = await api.pxilOrders.create(form);
      setSuccess(created);
      setForm(EMPTY);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create PXIL order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b' }}>PXIL</div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Pxil Order Creation</h1>
        </div>
        <Link to="/trading/pxil/summary" style={{ color: '#1d4ed8', fontSize: 13 }}>Order Summary →</Link>
      </div>

      <p style={{ color: '#dc2626', fontSize: 13, margin: '0 0 12px' }}>
        Note* : All fields are mandatory to be filled.
      </p>

      <Card>
        <form onSubmit={handleSubmit}>
          <div className="form-section-header" style={{ marginTop: 0 }}>Pxil Order Creation</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Transaction Code" required>
              <input className="input" value={form.transaction_code} onChange={(e) => set('transaction_code', e.target.value)} required />
            </Field>
            <Field label="User ID" required>
              <input className="input" value={form.user_id} onChange={(e) => set('user_id', e.target.value)} required />
            </Field>
            <Field label="Password" required>
              <input type="password" className="input" value={form.password} onChange={(e) => set('password', e.target.value)} required autoComplete="current-password" />
            </Field>
            <Field label="NOR" required>
              <input className="input" value={form.nor} onChange={(e) => set('nor', e.target.value)} required />
            </Field>
            <Field label="TM ID" required>
              <input className="input" value={form.tm_id} onChange={(e) => set('tm_id', e.target.value)} required />
            </Field>
          </div>

          <div className="form-section-header">Order Details :</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Reference No" required>
              <input className="input" value={form.reference_no} onChange={(e) => set('reference_no', e.target.value)} required />
            </Field>
            <Field label="Tac Id" required>
              <input className="input" value={form.tac_id} onChange={(e) => set('tac_id', e.target.value)} required />
            </Field>
            <Field label="Order Type" required>
              <input className="input" value={form.order_type} onChange={(e) => set('order_type', e.target.value)} required placeholder="e.g. NORMAL" />
            </Field>
            <Field label="Product Code" required>
              <input className="input" value={form.product_code} onChange={(e) => set('product_code', e.target.value)} required placeholder="e.g. RTM" />
            </Field>
            <Field label="Quantity" required>
              <input type="number" min="0" step="any" className="input" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} required />
            </Field>
            <Field label="Price" required>
              <input type="number" min="0" step="any" className="input" value={form.price} onChange={(e) => set('price', e.target.value)} required />
            </Field>
            <Field label="Delivery Date From" required>
              <input type="date" className="input" value={form.delivery_date_from} onChange={(e) => set('delivery_date_from', e.target.value)} required />
            </Field>
            <Field label="Delivery Date To" required>
              <input type="date" className="input" value={form.delivery_date_to} onChange={(e) => set('delivery_date_to', e.target.value)} required />
            </Field>
            <Field label="From Time" required>
              <input type="time" className="input" value={form.from_time} onChange={(e) => set('from_time', e.target.value)} required />
            </Field>
            <Field label="To Time" required>
              <input type="time" className="input" value={form.to_time} onChange={(e) => set('to_time', e.target.value)} required />
            </Field>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Side *</div>
            <label style={{ marginRight: 20, fontSize: 14 }}>
              <input
                type="radio"
                name="pxil-side"
                checked={form.side === 'Seller'}
                onChange={() => set('side', 'Seller')}
              />{' '}
              Seller
            </label>
            <label style={{ fontSize: 14 }}>
              <input
                type="radio"
                name="pxil-side"
                checked={form.side === 'Buyer'}
                onChange={() => set('side', 'Buyer')}
              />{' '}
              Buyer
            </label>
          </div>

          {error && (
            <div role="alert" style={{ marginTop: 16, color: '#b91c1c', fontSize: 13 }}>{error}</div>
          )}
          {success && (
            <div role="status" style={{ marginTop: 16, color: '#15803d', fontSize: 13 }}>
              Order created: <strong>{success.reference_no}</strong> ({success.id}).{' '}
              <Link to="/trading/pxil/summary">View summary</Link>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate('/trading/pxil/summary')} disabled={busy}>
              Close
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
