import React, { useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { Card, Field } from '../../components/ui.jsx';

const CHARGE_HEADS = [
  'ISTS Transmission Charges',
  'State Transmission Charges',
  'Distribution Wheeling Charges',
  'RLDC Operating Charges',
  'State Operating Charges',
  'DIS Operating Charges',
  'NOAR Application Fees',
  'SLDC Application Fees',
  'SLDC Consent Fees',
];

function emptyRow(head) {
  return {
    charge_head: head,
    seller_qty: 0,
    seller_rate: 0,
    seller_amount: 0,
    buyer_qty: 0,
    buyer_rate: 0,
    buyer_amount: 0,
    applicable_date: '',
    trader: 0,
  };
}

const EMPTY_META = {
  application_id: '',
  noar_approval_id: '',
  sldc_approval_id: '',
  application_date: '',
  applicant_name: '',
  seller_name: '',
  sell_side_contract: '',
  buyer_name: '',
  purchase_side_contract: '',
  from_date: '',
  to_date: '',
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function withAmounts(row) {
  return {
    ...row,
    seller_amount: Number((num(row.seller_qty) * num(row.seller_rate)).toFixed(2)),
    buyer_amount: Number((num(row.buyer_qty) * num(row.buyer_rate)).toFixed(2)),
  };
}

export default function UpdateCharges() {
  const [meta, setMeta] = useState(EMPTY_META);
  const [charges, setCharges] = useState(() => CHARGE_HEADS.map(emptyRow));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const totals = useMemo(() => charges.reduce((acc, r) => ({
    seller: acc.seller + num(r.seller_amount),
    buyer: acc.buyer + num(r.buyer_amount),
    trader: acc.trader + num(r.trader),
  }), { seller: 0, buyer: 0, trader: 0 }), [charges]);

  function setMetaField(field, value) {
    setMeta((prev) => ({ ...prev, [field]: value }));
  }

  function updateCharge(index, field, value) {
    setCharges((prev) => {
      const next = [...prev];
      next[index] = withAmounts({ ...next[index], [field]: value });
      return next;
    });
  }

  async function lookupApplication() {
    const id = meta.application_id.trim();
    if (!id) {
      setError('Enter Application Id first.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await api.exchangeUpdateCharges.lookup(id);
      setMeta((prev) => ({
        ...prev,
        application_id: data.application_id || id,
        noar_approval_id: data.noar_approval_id || prev.noar_approval_id,
        sldc_approval_id: data.sldc_approval_id || prev.sldc_approval_id,
        application_date: (data.application_date || '').slice(0, 16).replace('T', ' '),
        applicant_name: data.applicant_name || '',
        seller_name: data.seller_name || '',
        sell_side_contract: data.sell_side_contract || '',
        buyer_name: data.buyer_name || '',
        purchase_side_contract: data.purchase_side_contract || '',
        from_date: data.from_date || '',
        to_date: data.to_date || '',
      }));
      if (Array.isArray(data.charges) && data.charges.length) {
        setCharges(data.charges.map(withAmounts));
      }
      setMessage(data.found ? 'Application details loaded.' : 'No matching application — enter details manually.');
    } catch (err) {
      setError(err.response?.data?.error || 'Lookup failed.');
    } finally {
      setBusy(false);
    }
  }

  async function loadCharges(source) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const data = await api.exchangeUpdateCharges.load(source);
      setCharges((data.charges || []).map(withAmounts));
      setMessage(source === 'NOAR' ? 'Charges loaded from NOAR defaults.' : 'Charges loaded.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load charges.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.exchangeUpdateCharges.save({ ...meta, charges });
      setMessage('NOAR charge details saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  const th = {
    background: '#33598d',
    color: '#fff',
    padding: '8px 6px',
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'center',
    border: '1px solid #2a4a75',
  };
  const td = { padding: '4px', border: '1px solid #e2e8f0', fontSize: 12 };
  const inputStyle = { width: '100%', padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' };

  function MetaLabel({ label, value }) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, padding: '4px 0', fontSize: 13 }}>
        <span style={{ color: '#475569', fontWeight: 600 }}>{label}</span>
        <span>{value || '—'}</span>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <div className="form-section-header" style={{ marginTop: 0 }}>Update NOAR Details</div>

      <Card>
        <form onSubmit={handleSave}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginBottom: 20 }}>
            <div>
              <Field label="Application Id">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" value={meta.application_id} onChange={(e) => setMetaField('application_id', e.target.value)} placeholder="e.g. PX20250527A1018" />
                  <button type="button" className="btn btn-outline" onClick={lookupApplication} disabled={busy}>Load</button>
                </div>
              </Field>
              <Field label="NOAR Approval Id">
                <input className="input" value={meta.noar_approval_id} onChange={(e) => setMetaField('noar_approval_id', e.target.value)} />
              </Field>
              <Field label="SLDC Approval Id">
                <input className="input" value={meta.sldc_approval_id} onChange={(e) => setMetaField('sldc_approval_id', e.target.value)} />
              </Field>
            </div>
            <div>
              <MetaLabel label="Application Date" value={meta.application_date} />
              <MetaLabel label="Applicant Name" value={meta.applicant_name} />
              <MetaLabel label="Seller Name" value={meta.seller_name} />
              <MetaLabel label="Sell Side Contract" value={meta.sell_side_contract} />
              <MetaLabel label="Buyer Name" value={meta.buyer_name} />
              <MetaLabel label="Purchase Side Contract" value={meta.purchase_side_contract} />
              <MetaLabel label="From Date" value={meta.from_date} />
              <MetaLabel label="To Date" value={meta.to_date} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <div className="form-section-header" style={{ margin: 0, flex: 1 }}>Application Charges</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none' }} onClick={() => loadCharges('NOAR')} disabled={busy}>
                Load Charges from NOAR
              </button>
              <button type="button" className="btn btn-sm" style={{ background: '#16a34a', color: '#fff', border: 'none' }} onClick={() => loadCharges('DEFAULT')} disabled={busy}>
                Load Charges
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={th}>Charge Head</th>
                  <th colSpan={3} style={th}>Seller</th>
                  <th colSpan={3} style={th}>Buyer</th>
                  <th rowSpan={2} style={th}>Charges Applicable Date</th>
                  <th rowSpan={2} style={th}>Trader</th>
                </tr>
                <tr>
                  <th style={th}>Quantity</th>
                  <th style={th}>Rate (Rs)</th>
                  <th style={th}>Amount (Rs)</th>
                  <th style={th}>Quantity</th>
                  <th style={th}>Rate (Rs)</th>
                  <th style={th}>Amount (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((row, idx) => (
                  <tr key={row.charge_head}>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{row.charge_head}</td>
                    <td style={td}><input type="number" step="any" style={inputStyle} value={row.seller_qty} onChange={(e) => updateCharge(idx, 'seller_qty', e.target.value)} /></td>
                    <td style={td}><input type="number" step="any" style={inputStyle} value={row.seller_rate} onChange={(e) => updateCharge(idx, 'seller_rate', e.target.value)} /></td>
                    <td style={td}><input type="number" step="any" style={inputStyle} value={row.seller_amount} readOnly /></td>
                    <td style={td}><input type="number" step="any" style={inputStyle} value={row.buyer_qty} onChange={(e) => updateCharge(idx, 'buyer_qty', e.target.value)} /></td>
                    <td style={td}><input type="number" step="any" style={inputStyle} value={row.buyer_rate} onChange={(e) => updateCharge(idx, 'buyer_rate', e.target.value)} /></td>
                    <td style={td}><input type="number" step="any" style={inputStyle} value={row.buyer_amount} readOnly /></td>
                    <td style={td}><input type="date" style={inputStyle} value={row.applicable_date || ''} onChange={(e) => updateCharge(idx, 'applicable_date', e.target.value)} /></td>
                    <td style={td}><input type="number" step="any" style={inputStyle} value={row.trader} onChange={(e) => updateCharge(idx, 'trader', e.target.value)} /></td>
                  </tr>
                ))}
                <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                  <td style={td}>Total</td>
                  <td style={td} colSpan={2} />
                  <td style={td}>{totals.seller.toFixed(2)}</td>
                  <td style={td} colSpan={2} />
                  <td style={td}>{totals.buyer.toFixed(2)}</td>
                  <td style={td} />
                  <td style={td}>{totals.trader.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {error && <div style={{ marginTop: 12, color: '#991b1b', background: '#fee2e2', padding: 10, borderRadius: 4, fontSize: 13 }}>{error}</div>}
          {message && <div style={{ marginTop: 12, color: '#166534', background: '#dcfce7', padding: 10, borderRadius: 4, fontSize: 13 }}>{message}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Charges'}</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
