import React from 'react';
import { fmtCurrency } from './ui.jsx';

// D1: what disputes and notes do to a bill, in one figure Finance can read.
export default function DisputeImpactPanel({ invoice }) {
  const d = invoice?.dispute_impact;
  if (!d) return null;
  const line = (label, value, tone) => (
    <div className="detail-item"><span className="detail-label">{label}</span><span className="detail-value" style={{ color: tone }}>{value}</span></div>
  );
  return (
    <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Dispute impact</div>
      <div className="detail-grid mb-0">
        {line('Held out of payable', fmtCurrency(d.held), d.held > 0 ? '#b45309' : undefined)}
        {d.contested_at_forum > 0 && line('Contested at a forum', fmtCurrency(d.contested_at_forum), '#b45309')}
        {(d.pending_credit > 0 || d.pending_debit > 0) && line('Notes awaiting approval', [d.pending_credit > 0 && `credit ${fmtCurrency(d.pending_credit)}`, d.pending_debit > 0 && `debit ${fmtCurrency(d.pending_debit)}`].filter(Boolean).join(' · '))}
        {d.net_payable != null && line('Net payable now', <strong>{fmtCurrency(d.net_payable)}</strong>)}
      </div>
      {d.open_disputes.length > 0 && (
        <div style={{ fontSize: 13.5, marginTop: 8 }}>
          {d.open_disputes.map((x) => <div key={x.id}>{x.dispute_no} — {String(x.status).replace(/_/g, ' ').toLowerCase()}{x.contested ? ', contested' : ''} · {fmtCurrency(x.amount)}</div>)}
        </div>
      )}
      {(d.notes_pending.length > 0 || d.notes_issued.length > 0) && (
        <div style={{ fontSize: 13.5, marginTop: 6 }}>
          {d.notes_pending.map((n) => <div key={n.id}>{n.note_type === 'CREDIT' ? 'Credit' : 'Debit'} note (draft) {fmtCurrency(n.amount)} — {n.reason}</div>)}
          {d.notes_issued.map((n) => <div key={n.id}>{n.note_no}: {n.note_type === 'CREDIT' ? 'credit' : 'debit'} {fmtCurrency(n.amount)}{n.note_type === 'CREDIT' ? `, ${fmtCurrency(n.applied)} applied` : ''}</div>)}
        </div>
      )}
    </div>
  );
}
