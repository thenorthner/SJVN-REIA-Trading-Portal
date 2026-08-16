import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field, fmtNumber } from '../../components/ui.jsx';

const EMPTY = {
  trade_date: '',
  rec_placed_for_sale: '',
  bid_rate: '',
  total_recs_sold: '',
  discovered_rate: '',
  trade_obligation: '',
  gst_on_trade_obligation: '',
  exchange_fees: '',
  gst_on_exchange_fees: '',
  net_revenue: '',
  buyer_name: '',
  invoice_no: '',
  recs_bought: '',
  base_amount: '',
  tax_amount: '',
  total_amount: '',
};

/**
 * ISET REC Order — post-trade settlement capture with auto-derived
 * obligation / GST / net revenue and buyer invoice totals.
 */
export default function RecOrder() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);

  function set(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Keep derived fields in sync when drivers change (user can still override later).
      if (['total_recs_sold', 'discovered_rate'].includes(field)) {
        const a = Number(field === 'total_recs_sold' ? value : next.total_recs_sold);
        const b = Number(field === 'discovered_rate' ? value : next.discovered_rate);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          next.trade_obligation = String(Number((a * b).toFixed(2)));
          next.recs_bought = next.recs_bought || String(a);
          next.base_amount = next.base_amount || next.trade_obligation;
        }
      }
      if (['trade_obligation', 'gst_on_trade_obligation', 'exchange_fees', 'gst_on_exchange_fees'].includes(field) ||
          ['total_recs_sold', 'discovered_rate'].includes(field)) {
        const g = Number(next.trade_obligation) || 0;
        const i = Number(next.gst_on_trade_obligation) || 0;
        const j = Number(next.exchange_fees) || 0;
        const k = Number(next.gst_on_exchange_fees) || 0;
        next.net_revenue = String(Number((g - i - j - k).toFixed(2)));
      }
      if (field === 'base_amount' || (field === 'trade_obligation' && !prev.base_amount)) {
        const base = Number(field === 'base_amount' ? value : next.base_amount) || 0;
        next.tax_amount = String(Number((base * 0.18).toFixed(2)));
        next.total_amount = String(Number((base + base * 0.18).toFixed(2)));
      }
      if (field === 'tax_amount') {
        const base = Number(next.base_amount) || 0;
        const tax = Number(value) || 0;
        next.total_amount = String(Number((base + tax).toFixed(2)));
      }
      return next;
    });
  }

  const preview = useMemo(() => {
    const sold = Number(form.total_recs_sold);
    const rate = Number(form.discovered_rate);
    if (!Number.isFinite(sold) || !Number.isFinite(rate)) return null;
    return { obligation: sold * rate };
  }, [form.total_recs_sold, form.discovered_rate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    if (!form.trade_date) { setError('Trade Date is required'); return; }
    if (!form.total_recs_sold || !form.discovered_rate) {
      setError('Total RECs Sold and Discovered Rate are required');
      return;
    }
    setBusy(true);
    try {
      const created = await api.recTrading.createOrder(form);
      setSuccess(created);
      setForm(EMPTY);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit REC order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b' }}>REC Order Details</div>
          <h1 style={{ margin: 0, fontSize: 22 }}>REC Order</h1>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 13 }}>
          <Link to="/trading/rec/order-report" style={{ color: '#1d4ed8' }}>Order Report →</Link>
          <Link to="/trading/rec/bid-entry" style={{ color: '#1d4ed8' }}>Bid Entry →</Link>
        </div>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <div className="form-section-header" style={{ marginTop: 0 }}>REC Order</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 420 }}>
            <Field label="Trade Date" required>
              <input type="date" className="input" value={form.trade_date} onChange={(e) => set('trade_date', e.target.value)} required />
            </Field>
          </div>

          <div className="form-section-header">Trade Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="REC Placed for Sale" required>
              <input type="number" step="any" min="0" className="input" value={form.rec_placed_for_sale} onChange={(e) => set('rec_placed_for_sale', e.target.value)} placeholder="REC Placed for Sale" required />
            </Field>
            <Field label="Bid Rate / REC" required>
              <input type="number" step="any" min="0" className="input" value={form.bid_rate} onChange={(e) => set('bid_rate', e.target.value)} required />
            </Field>
            <Field label="Total RECs Sold A" required>
              <input type="number" step="any" min="0" className="input" value={form.total_recs_sold} onChange={(e) => set('total_recs_sold', e.target.value)} required />
            </Field>
            <Field label="Discovered Rate / REC B" required>
              <input type="number" step="any" min="0" className="input" value={form.discovered_rate} onChange={(e) => set('discovered_rate', e.target.value)} required />
            </Field>
            <Field label="Trade Obligation (RS) A*B" required>
              <input type="number" step="any" className="input" value={form.trade_obligation} onChange={(e) => set('trade_obligation', e.target.value)} required />
            </Field>
            <Field label="GST on Trade Obligation" required>
              <input type="number" step="any" min="0" className="input" value={form.gst_on_trade_obligation} onChange={(e) => set('gst_on_trade_obligation', e.target.value)} required />
            </Field>
            <Field label="Exchange Fees" required>
              <input type="number" step="any" min="0" className="input" value={form.exchange_fees} onChange={(e) => set('exchange_fees', e.target.value)} required />
            </Field>
            <Field label="GST on Exchange Fees" required>
              <input type="number" step="any" min="0" className="input" value={form.gst_on_exchange_fees} onChange={(e) => set('gst_on_exchange_fees', e.target.value)} required />
            </Field>
            <Field label="Net revenue Earned (G-I-J)" required>
              <input type="number" step="any" className="input" value={form.net_revenue} onChange={(e) => set('net_revenue', e.target.value)} required />
            </Field>
          </div>
          {preview && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
              A×B check · ₹{fmtNumber(preview.obligation, 2)} — net = obligation − GST − fees − GST on fees
            </div>
          )}

          <div className="form-section-header">Buyer Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Buyer Name" required>
              <input className="input" value={form.buyer_name} onChange={(e) => set('buyer_name', e.target.value)} required />
            </Field>
            <Field label="Invoice No" required>
              <input className="input" value={form.invoice_no} onChange={(e) => set('invoice_no', e.target.value)} required />
            </Field>
            <Field label="RECs Bought" required>
              <input type="number" step="any" min="0" className="input" value={form.recs_bought} onChange={(e) => set('recs_bought', e.target.value)} required />
            </Field>
            <Field label="Base Amount" required>
              <input type="number" step="any" min="0" className="input" value={form.base_amount} onChange={(e) => set('base_amount', e.target.value)} required />
            </Field>
            <Field label="Tax Amount (18%)" required>
              <input type="number" step="any" min="0" className="input" value={form.tax_amount} onChange={(e) => set('tax_amount', e.target.value)} required />
            </Field>
            <Field label="Total Amount" required>
              <input type="number" step="any" min="0" className="input" value={form.total_amount} onChange={(e) => set('total_amount', e.target.value)} required />
            </Field>
          </div>

          {error && <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13, marginTop: 14 }}>{error}</div>}
          {success && (
            <div style={{ color: '#166534', background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13, marginTop: 14 }}>
              REC order <strong>{success.id}</strong> saved for trade date {success.trade_date}.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, paddingTop: 20 }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
