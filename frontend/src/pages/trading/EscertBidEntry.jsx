import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field, Badge, fmtNumber } from '../../components/ui.jsx';

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const REC_TYPES = ['PAT Cycle 1', 'PAT Cycle 2', 'PAT Cycle 3', 'PAT Cycle 4', 'ESCERT'];

const EMPTY = {
  client_id: '',
  entity_name: '',
  entity_id: '',
  exchange: '',
  portfolio_code: '',
  rec_type: '',
  price: '',
  quantity: '',
  side: 'Buy',
};

/**
 * ECERTS Bid Entry — ISET Order Entry layout + our regulatory checks
 * (floor/forbearance bands, sell-side registry balance) and persisted orders.
 */
export default function EscertBidEntry() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [clients, setClients] = useState([]);
  const [meta, setMeta] = useState({ price_band: null, registry_available: 4250 });
  const [orders, setOrders] = useState([]);
  const [priceError, setPriceError] = useState('');
  const [priceNote, setPriceNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function loadOrders() {
    api.escertOrders.list().then(setOrders).catch(() => setOrders([]));
  }

  useEffect(() => {
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => setClients([]));
    api.escertOrders.meta().then(setMeta).catch(() => {});
    // Prefer live bands from REC reference if configured there.
    api.rec.reference()
      .then((r) => {
        if (r?.price_bands?.ESCERT) {
          setMeta((m) => ({ ...m, price_band: r.price_bands.ESCERT }));
        }
      })
      .catch(() => {});
    loadOrders();
  }, []);

  useEffect(() => {
    setPriceError('');
    setPriceNote('');
    if (!form.price) return;
    const price = Number(form.price);
    if (!Number.isFinite(price)) return;

    const band = meta.price_band;
    if (!band || (band.floor == null && band.forbearance == null)) {
      setPriceNote('No ESCert price band is configured — bid is not checked against a regulatory floor/ceiling.');
      return;
    }
    const floor = Number(band.floor);
    const ceiling = band.forbearance == null ? null : Number(band.forbearance);
    if (Number.isFinite(floor) && price < floor) {
      setPriceError(`₹${price} is below the ESCert floor of ₹${floor} per certificate.`);
      return;
    }
    if (ceiling != null && price > ceiling) {
      setPriceError(`₹${price} exceeds the ESCert forbearance (ceiling) of ₹${ceiling}.`);
      return;
    }
    if (ceiling == null && Number.isFinite(floor)) {
      setPriceNote(`Only the floor of ₹${floor} is configured; no forbearance ceiling on record.`);
    }
  }, [form.price, meta.price_band]);

  const notional = useMemo(() => {
    const p = Number(form.price);
    const q = Number(form.quantity);
    if (!Number.isFinite(p) || !Number.isFinite(q)) return null;
    return p * q;
  }, [form.price, form.quantity]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function onEntityChange(clientId) {
    const c = clients.find((x) => x.id === clientId);
    setForm((prev) => ({
      ...prev,
      client_id: clientId,
      entity_name: c?.name || '',
      entity_id: c?.id || '',
    }));
  }

  function validateClientSide() {
    if (!form.client_id && !form.entity_name) return 'Entity Name is required';
    if (!form.exchange) return 'Exchange is required';
    if (!form.portfolio_code.trim()) return 'Portfolio Code is required';
    if (!form.rec_type) return 'REC TYPE is required';
    if (!form.price || !form.quantity) return 'Price and Quantity are required';
    if (priceError) return priceError;
    if (form.side === 'Sell' && Number(form.quantity) > Number(meta.registry_available || 0)) {
      return `Insufficient balance: selling ${form.quantity} but only ${meta.registry_available} ESCerts available in registry.`;
    }
    return '';
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);
    const err = validateClientSide();
    if (err) { setError(err); return; }
    setConfirmOpen(true);
  }

  async function confirmSubmit() {
    setBusy(true);
    setError('');
    try {
      const created = await api.escertOrders.create(form);
      setSuccess(created);
      setForm(EMPTY);
      setConfirmOpen(false);
      loadOrders();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit ESCert order.');
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Exchange · Certificates</div>
          <h1 style={{ margin: 0, fontSize: 22 }}>ECERTS Bid Entry</h1>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <div>
            <span style={{ color: '#64748b' }}>Registry available · </span>
            <strong>{fmtNumber(meta.registry_available, 0)}</strong> ESCerts
          </div>
          {meta.price_band?.floor != null && (
            <div>
              <span style={{ color: '#64748b' }}>Floor · </span>
              <strong>₹{meta.price_band.floor}</strong>
              {meta.price_band.forbearance != null && (
                <> · Ceiling <strong>₹{meta.price_band.forbearance}</strong></>
              )}
            </div>
          )}
          <Link to="/trading/rec/hub" style={{ color: '#1d4ed8' }}>Certificate hub →</Link>
        </div>
      </div>

      <Card>
        <div className="form-section-header" style={{ marginTop: 0 }}>ECERTS Order Entry</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Entity Name" required>
              <select className="input" value={form.client_id} onChange={(e) => onEntityChange(e.target.value)} required>
                <option value="">Select entity</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Entity Id" required>
              <input className="input" value={form.entity_id} disabled placeholder="client id" style={{ background: '#f1f5f9' }} />
            </Field>
            <Field label="Exchange" required>
              <select className="input" value={form.exchange} onChange={(e) => set('exchange', e.target.value)} required>
                <option value="">Select</option>
                {EXCHANGES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="Portfolio Code" required>
              <input className="input" value={form.portfolio_code} onChange={(e) => set('portfolio_code', e.target.value)} required />
            </Field>
            <Field label="REC TYPE" required>
              <select className="input" value={form.rec_type} onChange={(e) => set('rec_type', e.target.value)} required>
                <option value="">-- select an option --</option>
                {REC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Price (Rs./Certificate)" required>
              <input type="number" step="any" min="0" className="input" value={form.price} onChange={(e) => set('price', e.target.value)} required />
              {priceError && <div style={{ marginTop: 4, fontSize: 12, color: '#991b1b', fontWeight: 600 }}>{priceError}</div>}
              {!priceError && priceNote && <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>{priceNote}</div>}
            </Field>
            <Field label="Quantity (Nos.)" required>
              <input type="number" min="1" step="1" className="input" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} required />
            </Field>
            <Field label="BUY OR SELL?" required>
              <div style={{ display: 'flex', gap: 18, height: 36, alignItems: 'center' }}>
                {['Buy', 'Sell'].map((opt) => (
                  <label key={opt} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                    <input type="radio" name="side" checked={form.side === opt} onChange={() => set('side', opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          {notional != null && !priceError && (
            <div style={{ marginTop: 14, padding: '10px 12px', background: '#f8fafc', borderRadius: 6, fontSize: 13 }}>
              Estimated notional · <strong>₹{fmtNumber(notional, 2)}</strong>
              {form.side === 'Sell' && (
                <span style={{ color: '#64748b' }}> · after trade registry ≈ {Math.max(0, Number(meta.registry_available) - Number(form.quantity || 0))} left</span>
              )}
            </div>
          )}

          <p style={{ fontSize: 12, color: '#64748b', marginTop: 14 }}>
            * 1 Certificate is equivalent to 1 Metric Ton of Oil Equivalent (MToE)
          </p>

          {error && <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13, marginBottom: 10 }}>{error}</div>}
          {success && (
            <div style={{ color: '#166534', background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13, marginBottom: 10 }}>
              Order <strong>{success.id}</strong> submitted — {success.side} {success.quantity} @ ₹{success.price} on {success.exchange}.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, paddingTop: 8 }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !!priceError}>Submit</button>
          </div>
        </form>
      </Card>

      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>Recent ESCert orders</strong>
          <button type="button" className="btn btn-sm btn-outline" onClick={loadOrders}>Refresh</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {['Order', 'Entity', 'Exchange', 'Type', 'Side', 'Qty', 'Price', 'Notional', 'Status', 'Created'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: 16, color: '#64748b', textAlign: 'center' }}>No orders yet.</td></tr>
              ) : orders.slice(0, 15).map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{o.id}</td>
                  <td style={{ padding: '8px 10px' }}>{o.entity_name}</td>
                  <td style={{ padding: '8px 10px' }}>{o.exchange}</td>
                  <td style={{ padding: '8px 10px' }}>{o.rec_type}</td>
                  <td style={{ padding: '8px 10px' }}><Badge type={o.side === 'Buy' ? 'primary' : 'success'}>{o.side}</Badge></td>
                  <td style={{ padding: '8px 10px' }}>{o.quantity}</td>
                  <td style={{ padding: '8px 10px' }}>₹{fmtNumber(o.price, 2)}</td>
                  <td style={{ padding: '8px 10px' }}>₹{fmtNumber(o.notional, 2)}</td>
                  <td style={{ padding: '8px 10px' }}><Badge type="primary">{o.status}</Badge></td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{o.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {confirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, maxWidth: 420, width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Confirm ESCert bid</h3>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              {form.side} <strong>{form.quantity}</strong> × {form.rec_type} @ <strong>₹{form.price}</strong> on {form.exchange}
              {notional != null && <> (₹{fmtNumber(notional, 2)})</>}.
            </p>
            <p style={{ fontSize: 12, color: '#64748b' }}>{form.entity_name} · {form.portfolio_code}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={confirmSubmit} disabled={busy}>
                {busy ? 'Submitting…' : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
