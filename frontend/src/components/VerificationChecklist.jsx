import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, Field, fmtCurrency } from './ui.jsx';

const STATUS_OPTS = ['VERIFIED', 'PENDING', 'FAILED', 'NA'];
const STATUS_TONE = { VERIFIED: 'ACTIVE', PENDING: 'PENDING', FAILED: 'REJECTED', NA: 'DRAFT' };
const COMMERCIAL_FIELDS = [
  { key: 'energy_charges', label: 'Energy Charges', readOnly: true },
  { key: 'change_in_law', label: 'Change in Law' },
  { key: 'compensation_event', label: 'Compensation Event' },
  { key: 'liquidated_damages', label: 'Liquidated Damages (−)' },
  { key: 'previous_adjustment', label: 'Previous Adjustment' },
];

// Structured technical + commercial verification for developer (PPA) invoices.
export default function VerificationChecklist({ invoiceId, canWrite = false, onSaved }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!invoiceId) return;
    api.invoices.getVerification(invoiceId).then(setData).catch(() => setData(null));
  }, [invoiceId]);

  if (!data) return <div style={{ fontSize: 13, color: 'var(--text-light)' }}>Loading verification…</div>;

  const setTech = (key, patch) => setData((d) => ({
    ...d, technical: d.technical.map((t) => t.key === key ? { ...t, ...patch } : t),
  }));
  const setComm = (key, val) => setData((d) => {
    const commercial = { ...d.commercial, [key]: Number(val) || 0 };
    commercial.net_invoice = (Number(commercial.energy_charges) || 0) + (Number(commercial.change_in_law) || 0)
      + (Number(commercial.compensation_event) || 0) - (Number(commercial.liquidated_damages) || 0)
      + (Number(commercial.previous_adjustment) || 0);
    return { ...d, commercial };
  });

  async function save() {
    setSaving(true); setMsg('');
    try {
      const res = await api.invoices.saveVerification(invoiceId, { technical: data.technical, commercial: data.commercial });
      setData(res); setMsg('Verification saved.');
      onSaved && onSaved(res);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to save.');
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <strong>Verification Status:</strong>
        <Badge status={STATUS_TONE[data.verification_status] || 'PENDING'} label={data.verification_status} />
        {data.verified_by && <span style={{ fontSize: 12, color: 'var(--text-light)' }}>by {data.verified_by}</span>}
      </div>

      <div className="section-title" style={{ marginTop: 8 }}>Technical Verification</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.technical.map((t) => (
          <div key={t.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--border, #eee)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
              {t.hint && <div style={{ fontSize: 11, color: 'var(--text-light)' }}>{t.hint}</div>}
              {canWrite && (
                <input
                  placeholder="Note (optional)" value={t.note || ''}
                  onChange={(e) => setTech(t.key, { note: e.target.value })}
                  style={{ marginTop: 4, width: '100%', fontSize: 12, padding: '2px 6px' }}
                />
              )}
            </div>
            {canWrite ? (
              <select value={t.status} onChange={(e) => setTech(t.key, { status: e.target.value })} style={{ minWidth: 110 }}>
                {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : <Badge status={STATUS_TONE[t.status] || 'PENDING'} label={t.status} />}
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 16 }}>Commercial Verification</div>
      <table className="data-table" style={{ width: '100%' }}>
        <tbody>
          {COMMERCIAL_FIELDS.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td className="text-right" style={{ width: 180 }}>
                {canWrite && !f.readOnly ? (
                  <input type="number" step="0.01" value={data.commercial[f.key] ?? 0}
                    onChange={(e) => setComm(f.key, e.target.value)}
                    style={{ width: 160, textAlign: 'right' }} />
                ) : <span className="mono">{fmtCurrency(data.commercial[f.key] || 0)}</span>}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border, #ddd)' }}>
            <td>Net Invoice Amount</td>
            <td className="text-right mono">{fmtCurrency(data.commercial.net_invoice || 0)}</td>
          </tr>
        </tbody>
      </table>

      {canWrite && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Verification'}
          </button>
          {msg && <span style={{ fontSize: 13, color: msg.includes('saved') ? 'var(--green)' : 'var(--red)' }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}
