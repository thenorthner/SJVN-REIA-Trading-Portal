import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field } from '../../components/ui.jsx';

const EMPTY = {
  buyer_contract: '',
  seller_contract: '',
  delivery_from: '',
  delivery_to: '',
  seller_availability: '',
  buyer_request: '',
  remarks: '',
};

/** ISET Daily Schedule Entry — persists to daily_schedule_entries. */
export default function DailyScheduleEntry() {
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
    if (!form.buyer_contract || !form.seller_contract || !form.delivery_from) {
      setError('Buyer Contract, Seller Contract and Delivery From are required');
      return;
    }
    setBusy(true);
    try {
      const created = await api.isetReports.createDailySchedule(form);
      setSuccess(created);
      setForm(EMPTY);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save schedule entry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 820, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Daily Schedule Entry</h1>
        <Link to="/reports/daily-schedule" style={{ color: '#1d4ed8', fontSize: 13 }}>Daily Schedule Report →</Link>
      </div>
      <Card>
        <form onSubmit={handleSubmit}>
          <div className="form-section-header" style={{ marginTop: 0 }}>Schedule Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Buyer Contract" required>
              <input className="input" value={form.buyer_contract} onChange={(e) => set('buyer_contract', e.target.value)} required />
            </Field>
            <Field label="Seller Contract" required>
              <input className="input" value={form.seller_contract} onChange={(e) => set('seller_contract', e.target.value)} required />
            </Field>
            <Field label="Delivery From" required>
              <input type="date" className="input" value={form.delivery_from} onChange={(e) => set('delivery_from', e.target.value)} required />
            </Field>
            <Field label="Delivery To">
              <input type="date" className="input" value={form.delivery_to} onChange={(e) => set('delivery_to', e.target.value)} />
            </Field>
            <Field label="Seller Availability">
              <input type="number" step="any" className="input" value={form.seller_availability} onChange={(e) => set('seller_availability', e.target.value)} />
            </Field>
            <Field label="Buyer Request">
              <input type="number" step="any" className="input" value={form.buyer_request} onChange={(e) => set('buyer_request', e.target.value)} />
            </Field>
          </div>
          <Field label="Remarks">
            <input className="input" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>
          {error && <div role="alert" style={{ color: '#b91c1c', marginTop: 12 }}>{error}</div>}
          {success && (
            <div role="status" style={{ color: '#15803d', marginTop: 12 }}>
              Saved ({success.id}). <Link to="/reports/daily-schedule">View report</Link>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate(-1)} disabled={busy}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Submit'}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
