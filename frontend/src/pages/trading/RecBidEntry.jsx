import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { Card, Field, Badge, fmtNumber } from '../../components/ui.jsx';

const EXCHANGES = ['IEX', 'PXIL', 'HPX'];
const REC_TYPES = ['Solar REC', 'Non-Solar REC', 'Hydro REC', 'Non-Solar (Hydro)', 'Non-Solar (Non-Hydro)'];

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
 * ISET REC Order Entry + our floor/forbearance and sell-side registry checks.
 */
export default function RecBidEntry() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [clients, setClients] = useState([]);
  const [meta, setMeta] = useState({ price_band: null, registry_available: 85000 });
  const [bids, setBids] = useState([]);
  const [priceError, setPriceError] = useState('');
  const [priceNote, setPriceNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The ledger position a sell bid is actually constrained by, and the
  // execution the desk records once a session clears.
  const [inventory, setInventory] = useState(null);
  const [execRow, setExecRow] = useState(null);
  const [execForm, setExecForm] = useState({ executed_quantity: '', discovered_rate: '', trade_date: '', buyer: '' });
  const [actionBusy, setActionBusy] = useState('');
  const [actionMsg, setActionMsg] = useState(null);

  function loadBids() {
    api.recTrading.listBids().then(setBids).catch(() => setBids([]));
    api.recTrading.inventory().then(setInventory).catch(() => setInventory(null));
  }

  async function runAction(id, fn, label) {
    setActionBusy(id);
    setActionMsg(null);
    try {
      const r = await fn();
      setActionMsg({ ok: true, text: label(r) });
      loadBids();
    } catch (err) {
      setActionMsg({ ok: false, text: err.response?.data?.error || 'Action failed.' });
    } finally {
      setActionBusy('');
    }
  }

  function openExecute(bid) {
    setActionMsg(null);
    setExecRow(bid);
    setExecForm({
      executed_quantity: String(bid.quantity),
      discovered_rate: String(bid.price),
      trade_date: new Date().toISOString().slice(0, 10),
      buyer: '',
    });
  }

  async function confirmExecute(e) {
    e.preventDefault();
    const bid = execRow;
    setActionBusy(bid.id);
    setActionMsg(null);
    try {
      const r = await api.recTrading.executeBid(bid.id, {
        executed_quantity: Number(execForm.executed_quantity),
        discovered_rate: Number(execForm.discovered_rate),
        trade_date: execForm.trade_date,
        buyer: execForm.buyer || undefined,
      });
      setExecRow(null);
      setActionMsg({
        ok: true,
        text: bid.side === 'Sell'
          ? `Cleared ${r.executed_quantity} from ${r.allocations.length} lot(s) — net revenue ₹${fmtNumber(r.settlement.net_revenue, 0)}.`
          : `Bought ${r.executed_quantity} certificates into a new lot.`,
      });
      loadBids();
    } catch (err) {
      setActionMsg({ ok: false, text: err.response?.data?.error || 'Execution failed.' });
    } finally {
      setActionBusy('');
    }
  }

  useEffect(() => {
    api.tradingClients.list({ status: 'ACTIVE' }).then(setClients).catch(() => setClients([]));
    api.recTrading.bidsMeta().then(setMeta).catch(() => {});
    api.rec.reference()
      .then((r) => {
        if (r?.price_bands?.REC) setMeta((m) => ({ ...m, price_band: r.price_bands.REC }));
      })
      .catch(() => {});
    loadBids();
  }, []);

  useEffect(() => {
    setPriceError('');
    setPriceNote('');
    if (!form.price) return;
    const price = Number(form.price);
    if (!Number.isFinite(price)) return;
    const band = meta.price_band;
    if (!band || (band.floor == null && band.forbearance == null)) {
      setPriceNote('No REC price band is configured — bid is not checked against a regulatory floor/ceiling.');
      return;
    }
    const floor = Number(band.floor);
    const ceiling = band.forbearance == null ? null : Number(band.forbearance);
    if (Number.isFinite(floor) && price < floor) {
      setPriceError(`₹${price} is below the REC floor of ₹${floor} per certificate.`);
      return;
    }
    if (ceiling != null && price > ceiling) {
      setPriceError(`₹${price} exceeds the REC forbearance (ceiling) of ₹${ceiling}.`);
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
      return `Insufficient balance: selling ${form.quantity} but only ${meta.registry_available} RECs available in registry.`;
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
      const created = await api.recTrading.createBid(form);
      setSuccess(created);
      setForm(EMPTY);
      setConfirmOpen(false);
      loadBids();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit REC bid.');
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b' }}>REC Order Details</div>
          <h1 style={{ margin: 0, fontSize: 22 }}>REC Bid Entry</h1>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          {/* The ledger position is what actually binds a sell bid; the registry
              figure is the Central Agency's separate ceiling. */}
          {inventory && (
            <div>
              <span style={{ color: '#64748b' }}>Sellable · </span>
              <strong>{fmtNumber(inventory.sellable_qty, 0)}</strong> RECs
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                {' '}({fmtNumber(inventory.held_qty, 0)} held − {fmtNumber(inventory.committed_qty, 0)} committed)
              </span>
            </div>
          )}
          <div>
            <span style={{ color: '#64748b' }}>Registry available · </span>
            <strong>{fmtNumber(meta.registry_available, 0)}</strong> RECs
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
          <Link to="/trading/rec" style={{ color: '#1d4ed8' }}>REC Order →</Link>
        </div>
      </div>

      <Card>
        <div className="form-section-header" style={{ marginTop: 0 }}>REC Order Entry</div>
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
            </div>
          )}

          <p style={{ fontSize: 12, color: '#64748b', marginTop: 14 }}>
            * 1 Certificate is equivalent to 1 MWh (1000 Kwh) of Energy Injected for each type of Contract
          </p>

          {error && <div style={{ color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13, marginBottom: 10 }}>{error}</div>}
          {success && (
            <div style={{ color: '#166534', background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13, marginBottom: 10 }}>
              Bid <strong>{success.id}</strong> submitted — {success.side} {success.quantity} {success.rec_type} @ ₹{success.price} on {success.exchange}.
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
          <strong style={{ fontSize: 14 }}>Recent REC bids</strong>
          <button type="button" className="btn btn-sm btn-outline" onClick={loadBids}>Refresh</button>
        </div>
        {actionMsg && (
          <div style={{
            marginBottom: 10, padding: '8px 12px', borderRadius: 6, fontSize: 13,
            background: actionMsg.ok ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${actionMsg.ok ? '#bbf7d0' : '#fecaca'}`,
            color: actionMsg.ok ? '#166534' : '#991b1b',
          }}>{actionMsg.text}</div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {['Bid', 'Entity', 'Exchange', 'Type', 'Side', 'Qty', 'Price', 'Notional', 'Status', 'Created', 'Action'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bids.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: 16, color: '#64748b', textAlign: 'center' }}>No bids yet.</td></tr>
              ) : bids.slice(0, 15).map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{o.id}</td>
                  <td style={{ padding: '8px 10px' }}>{o.entity_name}</td>
                  <td style={{ padding: '8px 10px' }}>{o.exchange}</td>
                  <td style={{ padding: '8px 10px' }}>{o.rec_type}</td>
                  <td style={{ padding: '8px 10px' }}><Badge type={o.side === 'Buy' ? 'primary' : 'success'}>{o.side}</Badge></td>
                  <td style={{ padding: '8px 10px' }}>{o.quantity}</td>
                  <td style={{ padding: '8px 10px' }}>₹{fmtNumber(o.price, 2)}</td>
                  <td style={{ padding: '8px 10px' }}>₹{fmtNumber(o.notional, 2)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <Badge type={o.status === 'EXECUTED' ? 'success' : o.status === 'REJECTED' || o.status === 'CANCELLED' ? 'danger' : 'primary'}>
                      {o.status}
                    </Badge>
                    {o.status === 'EXECUTED' && o.executed_quantity != null && (
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        {fmtNumber(o.executed_quantity, 0)} @ ₹{fmtNumber(o.discovered_rate, 2)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{o.created_at}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {o.status === 'SUBMITTED' && (
                      <>
                        <button type="button" className="btn btn-sm btn-outline" disabled={actionBusy === o.id}
                          onClick={() => runAction(o.id, () => api.recTrading.approveBid(o.id, { status: 'APPROVED' }), () => `${o.id} approved.`)}>
                          Approve
                        </button>
                        {' '}
                        <button type="button" className="btn btn-sm btn-outline" disabled={actionBusy === o.id}
                          onClick={() => runAction(o.id, () => api.recTrading.cancelBid(o.id), () => `${o.id} cancelled.`)}>
                          Cancel
                        </button>
                      </>
                    )}
                    {o.status === 'APPROVED' && (
                      <button type="button" className="btn btn-sm btn-primary" disabled={actionBusy === o.id}
                        onClick={() => openExecute(o)}>
                        Record execution
                      </button>
                    )}
                    {!['SUBMITTED', 'APPROVED'].includes(o.status) && <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* What the session actually cleared. Recording it is what moves the
          certificates — on a sell they leave the ledger oldest vintage first. */}
      {execRow && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <form onSubmit={confirmExecute} style={{ background: '#fff', borderRadius: 8, padding: 24, maxWidth: 460, width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Record execution — {execRow.id}</h3>
            <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
              {execRow.side} {execRow.quantity} × {execRow.rec_type} bid at ₹{fmtNumber(execRow.price, 2)} on {execRow.exchange}.
              {execRow.side === 'Sell'
                ? ' Certificates leave the ledger oldest vintage first.'
                : ' Certificates bought enter the ledger as a new issued lot.'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Quantity cleared" required>
                <input type="number" min="1" step="1" className="input" required
                  value={execForm.executed_quantity}
                  onChange={(e) => setExecForm({ ...execForm, executed_quantity: e.target.value })} />
              </Field>
              <Field label="Discovered rate (Rs./REC)" required>
                <input type="number" min="0.01" step="0.01" className="input" required
                  value={execForm.discovered_rate}
                  onChange={(e) => setExecForm({ ...execForm, discovered_rate: e.target.value })} />
              </Field>
              <Field label="Trade date" required>
                <input type="date" className="input" required
                  value={execForm.trade_date}
                  onChange={(e) => setExecForm({ ...execForm, trade_date: e.target.value })} />
              </Field>
              {execRow.side === 'Sell' && (
                <Field label="Buyer">
                  <input type="text" className="input" placeholder="optional"
                    value={execForm.buyer}
                    onChange={(e) => setExecForm({ ...execForm, buyer: e.target.value })} />
                </Field>
              )}
            </div>
            {execRow.side === 'Sell' && Number(execForm.executed_quantity) > 0 && Number(execForm.discovered_rate) > 0 && (
              <p style={{ fontSize: 12, color: '#475569', marginTop: 10 }}>
                Trade obligation{' '}
                <strong>₹{fmtNumber(Number(execForm.executed_quantity) * Number(execForm.discovered_rate), 0)}</strong>
                {' '}before exchange fees.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button type="button" className="btn btn-outline" onClick={() => setExecRow(null)} disabled={actionBusy === execRow.id}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={actionBusy === execRow.id}>
                {actionBusy === execRow.id ? 'Recording…' : 'Record execution'}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, maxWidth: 420, width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Confirm REC bid</h3>
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
