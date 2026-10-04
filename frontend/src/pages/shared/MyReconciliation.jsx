import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, StatementViewer } from '../../components/ui.jsx';
import ReconSignoffPanel, { ReconSignModal } from '../../components/ReconSignoffPanel.jsx';
import { fmtDateTime } from '../../datetime.js';

/**
 * A counterparty's reconciliation statements with SJVN: read the statement and
 * its balance roll-forward, then agree, agree with exceptions, or disagree.
 */
export default function MyReconciliation({ subtitle, contractHeader, partyName, signatoryRole, disputesPath }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [signoff, setSignoff] = useState(null);
  const [signMode, setSignMode] = useState(null);
  const [disagree, setDisagree] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  function load() {
    setLoading(true);
    api.reconciliation.list().then(setRows).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function openDetail(row) {
    setSignoff(null);
    setFeedback(null);
    setDetail(await api.reconciliation.get(row.id));
  }
  async function refreshDetail() {
    if (!detail) return;
    setDetail(await api.reconciliation.get(detail.id));
    load();
  }

  async function submitDisagree(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.reconciliation.acknowledge(detail.id, 'DISAGREE', disagree, disagree);
      setFeedback({ type: 'danger', title: 'Disagreement recorded', message: res.message || 'The statement is marked disputed and SJVN has been told.' });
      setDisagree(null);
      await refreshDetail();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to record the disagreement');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'recon_no', header: 'Statement #' },
    { key: 'contract_no', header: contractHeader },
    { key: 'period', header: 'Period' },
    { key: 'auto_match_pct', header: 'Match %', render: (r) => `${r.auto_match_pct ?? 0}%` },
    { key: 'unreconciled_amount', header: 'Open ₹', render: (r) => fmtCurrency(r.unreconciled_amount || 0) },
    { key: 'signed', header: 'Signed', render: (r) => `${(r.sjvn_ack_at ? 1 : 0) + (r.counterparty_ack_at ? 1 : 0)} of 2` },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];
  const canAct = detail && ['PENDING_SIGN_OFF', 'AUTO_MATCHED', 'NEEDS_REVIEW'].includes(detail.status) && !detail.counterparty_ack_at;

  return (
    <div>
      <PageHeader title="Reconciliation Statements" subtitle={subtitle} />
      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No reconciliation statements yet.'} />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.recon_no || 'Statement'} width={860}>
        {detail && (
          <div>
            {feedback && (
              <div className={`alert ${feedback.type === 'success' ? 'alert-success' : 'alert-error'}`} role="status">
                <strong>{feedback.title}</strong> — {feedback.message}
              </div>
            )}

            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Period / Basis</span><span className="detail-value">{detail.period} / {detail.data_basis}</span></div>
              <div className="detail-item"><span className="detail-label">Auto-match</span><span className="detail-value">{detail.auto_match_pct}%</span></div>
              <div className="detail-item"><span className="detail-label">Exposure</span><span className="detail-value">{fmtCurrency(detail.unreconciled_amount)}</span></div>
            </div>

            <div style={{ marginTop: 14, padding: 14, background: 'var(--surface-hover, #f8fafc)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Sign-off by both parties</span>
                <Badge
                  status={detail.status === 'CLOSED' ? 'ACTIVE' : detail.status === 'DISPUTED' ? 'REJECTED' : 'PENDING'}
                  label={detail.status === 'CLOSED' ? 'Signed by both — closed' : detail.status === 'AGREED' ? 'Signed by both — exceptions open' : detail.status === 'DISPUTED' ? 'Disputed' : 'Awaiting both signatures'}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[['SJVN', detail.sjvn_ack_at, detail.sjvn_ack_by, 'Pending SJVN'], [partyName, detail.counterparty_ack_at, detail.counterparty_ack_by, 'Pending your action']].map(([label, at, by, pending]) => (
                  <div key={label} style={{ padding: 10, background: at ? '#ecfdf5' : '#fff', border: `1px solid ${at ? '#a7f3d0' : 'var(--border)'}`, borderRadius: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: at ? '#065f46' : 'var(--text-muted)' }}>{label}</div>
                    <div style={{ fontSize: 12, marginTop: 3 }}>{at ? `${by} · ${fmtDateTime(at)}` : pending}</div>
                  </div>
                ))}
              </div>
            </div>

            <ReconSignoffPanel key={`${detail.id}-${detail.updated_at}`} reconId={detail.id} onChanged={refreshDetail} onLoaded={setSignoff} disputesPath={disputesPath} />

            <div className="section-title" style={{ marginTop: 16 }}>Line checks</div>
            <ul style={{ paddingLeft: 18 }}>
              {(detail.items || []).map((it) => (
                <li key={it.id} style={{ marginBottom: 4 }}>
                  {it.match_status === 'NOT_CONNECTED' ? (
                    <span title="No connector for the system this would be checked against, so this line was not checked." style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 600 }}>Not checked</span>
                  ) : (
                    <Badge status={['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'].includes(it.match_status) ? 'AUTO_MATCHED' : 'NEEDS_REVIEW'} />
                  )}{' '}
                  <strong>{it.label}</strong> — Metered: {it.metered_value ?? '—'} | Billed: {it.billed_value ?? '—'} | Var: {it.variance}
                </li>
              ))}
            </ul>

            <div className="section-title" style={{ marginTop: 14 }}>Statement snapshot</div>
            <StatementViewer statement={detail.statement} />

            {canAct && (
              <div className="form-actions" style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-success" onClick={() => setSignMode('AGREE')}>I agree — sign off</button>
                <button type="button" className="btn btn-secondary" onClick={() => setSignMode('AGREE_WITH_EXCEPTIONS')}>Agree with exceptions</button>
                <button type="button" className="btn btn-danger" onClick={() => setDisagree('')}>Disagree with the whole statement</button>
              </div>
            )}

            {['CLOSED', 'AGREED'].includes(detail.status) && (
              <div className="form-actions" style={{ marginTop: 16 }}>
                <button
                  type="button" className="btn btn-secondary"
                  onClick={async () => {
                    const reason = prompt('Why reopen this closed period?');
                    if (!reason) return;
                    await api.reconciliation.reopenRequest(detail.id, reason);
                    setFeedback({ type: 'success', title: 'Reopen requested', message: 'The request has gone to the SJVN desk for review.' });
                    await refreshDetail();
                  }}
                >
                  Request Period Reopen
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {signMode && detail && (
        <ReconSignModal
          recon={detail} signoff={signoff} mode={signMode} signatory={`${user?.name} (${signatoryRole})`}
          onClose={() => setSignMode(null)}
          onSigned={async (res) => {
            setSignMode(null);
            setFeedback({ type: 'success', title: 'Sign-off recorded', message: res.message });
            await refreshDetail();
          }}
        />
      )}

      <Modal open={disagree !== null} onClose={() => !busy && setDisagree(null)} title="Disagree with the statement" width={540}>
        <form onSubmit={submitDisagree}>
          <div className="alert alert-error" style={{ fontSize: 13 }}>
            This marks the whole statement <strong>disputed</strong> and holds everything on it. If you accept most of it, use <strong>Agree with exceptions</strong> instead, so what is not in question can be settled.
          </div>
          <Field label="What is wrong with it" required>
            <textarea rows={3} required value={disagree || ''} onChange={(e) => setDisagree(e.target.value)} placeholder="State the discrepancy — units, tariff or deductions." style={{ width: '100%' }} />
          </Field>
          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDisagree(null)}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={busy || !(disagree || '').trim()}>{busy ? 'Submitting…' : 'Submit disagreement'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
