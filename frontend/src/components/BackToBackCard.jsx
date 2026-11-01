import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { fmtCurrency, fmtNumber } from './ui.jsx';

// B1: a PSA bill against the PPA bills it passes through — MWh, rate, and the
// spread against SJVN's margin, flagged red where they part.
// Tokens, not hex: the panel sits on the page in the dark theme too.
const TONE = { OK: { bg: 'var(--t-green-50)', border: 'var(--t-green-100)', text: 'var(--on-green-2)', label: 'Back-to-back matches' },
  MISMATCH: { bg: 'var(--t-red-50)', border: 'var(--t-red-line)', text: 'var(--on-red)', label: 'Back-to-back does not match' },
  INCOMPLETE: { bg: 'var(--t-amber-50)', border: 'var(--t-amber-line)', text: 'var(--on-amber)', label: 'Back-to-back waits for the PPA bill' } };

export default function BackToBackCard({ invoice }) {
  const [b, setB] = useState(null);
  const psa = invoice?.direction === 'SJVN_TO_BUYER' && !String(invoice?.invoice_no || '').startsWith('DSM-');
  useEffect(() => {
    setB(null);
    if (psa) api.invoices.backToBack(invoice.id).then(setB).catch(() => setB(null));
  }, [invoice?.id, invoice?.total_amount, psa]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!psa || !b?.applicable) return null;
  const t = TONE[b.state] || TONE.INCOMPLETE;
  const ok = (v) => (v == null ? '—' : v ? '✓' : '✗');
  return (
    <div style={{ marginTop: 16, border: `1px solid ${t.border}`, background: t.bg, borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 700, color: t.text, marginBottom: 8 }}>{t.label}</div>
      <table style={{ width: '100%', fontSize: 15, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-light)' }}>
            <th>Source PPA</th><th>PPA bill</th><th style={{ textAlign: 'right' }}>PPA MWh × share</th><th style={{ textAlign: 'right' }}>Billed here</th><th>MWh</th><th style={{ textAlign: 'right' }}>PPA rate</th>
          </tr>
        </thead>
        <tbody>
          {b.sources.map((s) => (
            <tr key={s.ppa_id}>
              <td>{s.ppa_contract_no} ({s.allocation_percent}%)</td>
              <td>{s.ppa_bill ? `${s.ppa_bill.invoice_no}${s.ppa_bill.own ? ' (developer)' : ' (SJVN)'}` : 'not in yet'}</td>
              <td style={{ textAlign: 'right' }}>{s.expected_mwh != null ? fmtNumber(s.expected_mwh) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{s.psa_mwh != null ? fmtNumber(s.psa_mwh) : '—'}</td>
              <td style={{ color: s.mwh_ok === false ? 'var(--red-deep)' : undefined, fontWeight: 600 }}>{ok(s.mwh_ok)}</td>
              <td style={{ textAlign: 'right' }}>{s.ppa_rate_per_mwh != null ? `₹${fmtNumber(s.ppa_rate_per_mwh)}/MWh` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 15, marginTop: 8 }}>
        <span>Pass-through: <strong>{b.pass_through_per_mwh != null ? `₹${fmtNumber(b.pass_through_per_mwh)}/MWh` : '—'}</strong> {b.rate_ok === false && <span style={{ color: 'var(--red-deep)' }}>✗</span>}</span>
        <span>Spread: <strong style={{ color: b.spread_ok === false ? 'var(--red-deep)' : undefined }}>{b.spread_per_mwh != null ? `₹${fmtNumber(b.spread_per_mwh)}/MWh` : '—'}</strong> vs margin ₹{b.margin_per_mwh}/MWh</span>
        {b.spread_amount != null && <span>Spread on the bill: {fmtCurrency(b.spread_amount)} (margin {fmtCurrency(b.margin_amount)})</span>}
      </div>
      {b.flags.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: t.text, fontSize: 15 }}>
          {b.flags.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}
