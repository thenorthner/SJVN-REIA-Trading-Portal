import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Badge, Field, AlertPopup, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate } from '../../datetime.js';

// D3: Finance's queue of draft debit / credit notes. A note a dispute asked
// for shows the dispute, its evidence and the resolver's reasoning beside the
// Approve button.
const SOURCE = { DISPUTE: 'Dispute resolution', RECONCILIATION: 'Reconciliation exception', CUF_TRUE_UP: 'CUF true-up', DIVERSION: 'Power diversion', DESK: 'Raised on the desk' };

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function NoteApprovals() {
  const { user } = useAuth();
  // Phase B.2: approving or rejecting a note is the checker's or Finance's (routes/notes.js).
  const canAct = ['FINANCE_USER', 'REIA_CHECKER'].includes(user?.role);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [popup, setPopup] = useState(null);
  const busy = useRef(false);
  const load = useCallback(() => {
    setLoading(true);
    api.notes.approvalQueue().then(setRows).catch((e) => setPopup({ title: 'Could not load', message: e.response?.data?.error || e.message })).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function run(fn, done) {
    if (busy.current) return;
    busy.current = true;
    try { await fn(); setPopup({ tone: 'success', title: done, message: '' }); setRejecting(null); load(); }
    catch (e) { setPopup({ title: 'Not done', message: e.response?.data?.error || e.message }); }
    finally { busy.current = false; }
  }

  return (
    <div>
      <PageHeader title="Notes for Approval" subtitle="Draft debit and credit notes waiting for someone other than their maker — with the dispute record where a dispute asked for them" />
      {loading && <Card><p className="inline-note">Loading…</p></Card>}
      {!loading && !rows.length && <Card><p className="inline-note">No note is waiting for approval.</p></Card>}
      {rows.map((n) => (
        <Card key={n.id} title={`${n.note_type === 'CREDIT' ? 'Credit' : 'Debit'} note ${fmtCurrency(n.amount)} on ${n.invoice_no}`}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 15, marginBottom: 8 }}>
            <Badge type="primary">{SOURCE[n.source] || n.source}</Badge>
            <span>{n.contract_no} · {n.counterparty} · {n.billing_period}</span>
            <span style={{ color: 'var(--text-light)' }}>Raised by {n.created_by}, {n.age_days} day{n.age_days === 1 ? '' : 's'} ago</span>
          </div>
          <p style={{ margin: '0 0 8px' }}>{n.reason}</p>
          {n.dispute && (
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 10, fontSize: 15, marginBottom: 8 }}>
              <div><strong>{n.dispute.dispute_no}</strong> — raised by the {String(n.dispute.raised_by_role).toLowerCase()} on {String(n.dispute.charge_line).replace(/_/g, ' ')} for {fmtCurrency(n.dispute.disputed_amount)} ({String(n.dispute.reason_code).replace(/_/g, ' ').toLowerCase()})</div>
              {n.dispute.issue_description && <div style={{ marginTop: 4 }}>Their case: {n.dispute.issue_description}</div>}
              <div style={{ marginTop: 4 }}>Resolution: {String(n.dispute.outcome || '').replace(/_/g, ' ').toLowerCase()}, {fmtCurrency(n.dispute.accepted_amount)} accepted — <em>{n.dispute.resolution_notes}</em>{n.dispute.resolved_by ? ` (${n.dispute.resolved_by}${n.dispute.resolved_at ? `, ${fmtDate(n.dispute.resolved_at)}` : ''})` : ''}</div>
              {n.dispute.evidence.length > 0 && (
                <div style={{ marginTop: 4 }}>Evidence: {n.dispute.evidence.map((f) => (
                  <button key={f.url} type="button" className="btn-link" style={{ marginRight: 8 }} onClick={() => api.disputes.downloadEvidence(n.dispute.id, decodeURIComponent(f.url.split('/').pop())).then((b) => saveBlob(b, f.name)).catch(() => setPopup({ title: 'Not downloaded', message: 'The file could not be fetched.' }))}>{f.name}</button>
                ))}</div>
              )}
            </div>
          )}
          {canAct && (
            n.can_approve ? (
              rejecting === n.id ? (
                <form className="cw-form" onSubmit={(e) => { e.preventDefault(); run(() => api.notes.reject(n.id, reason.trim()), 'Rejected'); }}>
                  <Field label="Why it is not approved" required><input required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                  <div className="form-actions"><button type="button" className="btn btn-ghost" onClick={() => setRejecting(null)}>Back</button><button type="submit" className="btn btn-danger">Reject</button></div>
                </form>
              ) : (
                <div className="cell-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => run(() => api.notes.approve(n.id), 'Issued')}>Approve &amp; issue</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRejecting(n.id); setReason(''); }}>Reject</button>
                </div>
              )
            ) : <p className="inline-note">You raised this note, so someone else approves it.</p>
          )}
        </Card>
      ))}
      <AlertPopup open={!!popup} tone={popup?.tone || 'error'} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />
    </div>
  );
}
