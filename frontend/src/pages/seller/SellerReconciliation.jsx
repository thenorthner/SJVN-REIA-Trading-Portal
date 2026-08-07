import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, StatementViewer } from '../../components/ui.jsx';
import { fmtDateTime } from '../../datetime.js';

export default function SellerReconciliation() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  // Acknowledgement modal & feedback states
  const [ackModal, setAckModal] = useState({ open: false, decision: 'AGREE', remarks: '', confirmed: false });
  const [ackLoading, setAckLoading] = useState(false);
  const [ackFeedback, setAckFeedback] = useState(null);

  function load() {
    setLoading(true);
    api.reconciliation.list().then(setRows).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function openDetail(row) {
    const res = await api.reconciliation.get(row.id);
    setDetail(res);
    setAckFeedback(null);
  }

  async function refreshDetail() {
    if (!detail) return;
    const res = await api.reconciliation.get(detail.id);
    setDetail(res);
    load();
  }

  function triggerAck(decision) {
    setAckModal({
      open: true,
      decision,
      remarks: decision === 'AGREE' ? 'Verified with generator JMR, invoices, and plant energy injection logs.' : '',
      confirmed: false,
    });
  }

  async function submitAck() {
    if (ackModal.decision === 'DISAGREE' && !ackModal.remarks.trim()) {
      alert('Please provide your reason / notes for disagreement.');
      return;
    }
    if (ackModal.decision === 'AGREE' && !ackModal.confirmed) {
      alert('Please check the confirmation box before signing off.');
      return;
    }

    setAckLoading(true);
    try {
      const res = await api.reconciliation.acknowledge(
        detail.id,
        ackModal.decision,
        ackModal.decision === 'DISAGREE' ? ackModal.remarks : undefined,
        ackModal.remarks
      );

      const isAgree = ackModal.decision === 'AGREE';
      setAckFeedback({
        type: isAgree ? 'success' : 'danger',
        title: isAgree ? '✅ Power Producer Sign-off Recorded!' : '⚠️ Disagreement Recorded & Disputed',
        message: res.message || (isAgree ? 'Generator joint sign-off successfully logged with timestamp.' : 'Disagreement recorded.'),
      });

      setAckModal({ open: false, decision: 'AGREE', remarks: '', confirmed: false });
      await refreshDetail();
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to acknowledge');
    } finally {
      setAckLoading(false);
    }
  }

  const columns = [
    { key: 'recon_no', header: 'Statement #' },
    { key: 'contract_no', header: 'PPA' },
    { key: 'period', header: 'Period' },
    { key: 'auto_match_pct', header: 'Match %', render: (r) => `${r.auto_match_pct ?? 0}%` },
    { key: 'unreconciled_amount', header: 'Open ₹', render: (r) => fmtCurrency(r.unreconciled_amount || 0) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
  ];

  return (
    <div>
      <PageHeader
        title="Reconciliation Statements"
        subtitle="Joint validation — meter vs bill vs payment, then digital acknowledgment with SJVN"
      />
      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No statements yet.'} />
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.recon_no || 'Statement'} width={780}>
        {detail && (
          <div>
            {/* Feedback Alert Banner */}
            {ackFeedback && (
              <div style={{
                padding: '12px 16px',
                borderRadius: 8,
                marginBottom: 16,
                background: ackFeedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${ackFeedback.type === 'success' ? '#10b981' : '#ef4444'}`,
                color: ackFeedback.type === 'success' ? '#065f46' : '#991b1b',
                fontSize: 13,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{ackFeedback.title}</div>
                <div>{ackFeedback.message}</div>
              </div>
            )}

            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Period / Basis</span><span className="detail-value">{detail.period} / {detail.data_basis}</span></div>
              <div className="detail-item"><span className="detail-label">Auto-match</span><span className="detail-value">{detail.auto_match_pct}%</span></div>
              <div className="detail-item"><span className="detail-label">Exposure</span><span className="detail-value">{fmtCurrency(detail.unreconciled_amount)}</span></div>
            </div>

            {/* Dual Joint Sign-off Status Card */}
            <div style={{
              marginTop: 14,
              padding: 14,
              background: 'var(--surface-hover, #f8fafc)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>🤝 Dual Digital Sign-off Status</span>
                {detail.sjvn_ack_at && detail.counterparty_ack_at ? (
                  <span style={{ fontSize: 12, background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                    ✓ 2/2 Dual Signed-Off (Closed)
                  </span>
                ) : (
                  <span style={{ fontSize: 12, background: '#f59e0b', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                    ⏳ Awaiting Dual Confirmation
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ padding: 10, background: detail.sjvn_ack_at ? '#ecfdf5' : '#ffffff', border: `1px solid ${detail.sjvn_ack_at ? '#a7f3d0' : 'var(--border)'}`, borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: detail.sjvn_ack_at ? '#065f46' : 'var(--text-muted)' }}>🏛️ SJVN Sign-off</div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>
                    {detail.sjvn_ack_at ? `✅ ${detail.sjvn_ack_by} (${fmtDateTime(detail.sjvn_ack_at)})` : '⏳ Pending SJVN'}
                  </div>
                </div>

                <div style={{ padding: 10, background: detail.counterparty_ack_at ? '#ecfdf5' : '#ffffff', border: `1px solid ${detail.counterparty_ack_at ? '#a7f3d0' : 'var(--border)'}`, borderRadius: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: detail.counterparty_ack_at ? '#065f46' : 'var(--text-muted)' }}>☀️ Generator Sign-off</div>
                  <div style={{ fontSize: 12, marginTop: 3 }}>
                    {detail.counterparty_ack_at ? `✅ ${detail.counterparty_ack_by} (${fmtDateTime(detail.counterparty_ack_at)})` : '⏳ Pending Your Action'}
                  </div>
                </div>
              </div>
            </div>

            <div className="section-title" style={{ marginTop: 14 }}>Line checks</div>
            <ul style={{ paddingLeft: 18 }}>
              {(detail.items || []).map((it) => (
                <li key={it.id} style={{ marginBottom: 4 }}>
                  <Badge status={['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'].includes(it.match_status) ? 'AUTO_MATCHED' : 'NEEDS_REVIEW'} />{' '}
                  <strong>{it.label}</strong> — Metered: {it.metered_value ?? '—'} | Billed: {it.billed_value ?? '—'} | Var: {it.variance}
                </li>
              ))}
            </ul>

            <div className="section-title" style={{ marginTop: 14 }}>Statement snapshot</div>
            <StatementViewer statement={detail.statement} />

            {['PENDING_SIGN_OFF', 'AUTO_MATCHED', 'NEEDS_REVIEW'].includes(detail.status) && (
              <div className="form-actions" style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <button type="button" className="btn btn-success" onClick={() => triggerAck('AGREE')}>
                  ✓ I Agree & Digitally Sign Off
                </button>
                <button type="button" className="btn btn-danger" onClick={() => triggerAck('DISAGREE')}>
                  ✗ Disagree (Flag Dispute Path)
                </button>
              </div>
            )}

            {['CLOSED', 'AGREED'].includes(detail.status) && (
              <div className="form-actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    const reason = prompt('Why reopen this closed period?');
                    if (!reason) return;
                    await api.reconciliation.reopenRequest(detail.id, reason);
                    setAckFeedback({
                      type: 'info',
                      title: 'Reopen Requested',
                      message: 'Reopen request has been forwarded to SJVN desk for review.',
                    });
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

      {/* Modal: Interactive Generator Acknowledgment / Disagreement */}
      <Modal
        open={ackModal.open}
        onClose={() => !ackLoading && setAckModal({ ...ackModal, open: false })}
        title={ackModal.decision === 'AGREE' ? '✍️ Generator Digital Sign-off & Acknowledgment' : '⚠️ Disagreement & Dispute Notice'}
        width={540}
      >
        <div>
          {ackModal.decision === 'AGREE' ? (
            <div>
              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 14, marginBottom: 14, color: '#065f46', fontSize: 13 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Joint Reconciliation Sign-off Confirmation</div>
                <div><strong>Statement #:</strong> {detail?.recon_no}</div>
                <div><strong>Period:</strong> {detail?.period} ({detail?.data_basis})</div>
                <div><strong>PPA Contract:</strong> {detail?.contract_no}</div>
                <div><strong>Signatory:</strong> {user?.name} (Renewable Power Producer)</div>
              </div>

              <Field label="Sign-off Remarks (optional)">
                <input
                  value={ackModal.remarks}
                  onChange={(e) => setAckModal({ ...ackModal, remarks: e.target.value })}
                  placeholder="e.g. Verified against JMR energy records and tax invoice."
                />
              </Field>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, fontSize: 13, cursor: 'pointer', background: 'var(--surface)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                <input
                  type="checkbox"
                  checked={ackModal.confirmed}
                  onChange={(e) => setAckModal({ ...ackModal, confirmed: e.target.checked })}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>I confirm Generator sign-off</strong>: I have reviewed the energy billing statement for period <strong>{detail?.period}</strong> and formally agree with this reconciliation.
                </span>
              </label>

              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn btn-ghost" disabled={ackLoading} onClick={() => setAckModal({ ...ackModal, open: false })}>
                  Cancel
                </button>
                <button type="button" className="btn btn-success" disabled={!ackModal.confirmed || ackLoading} onClick={submitAck}>
                  {ackLoading ? 'Recording Sign-off…' : '✓ Confirm & Digitally Sign Off'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 14, marginBottom: 14, color: '#991b1b', fontSize: 13 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Disagreement & Dispute Escalation</div>
                <div>This will mark the statement as <strong>DISPUTED</strong> and alert the SJVN REIA commercial team to open a formal dispute process.</div>
              </div>

              <Field label="Disagreement Reason / Discrepancy Details *">
                <textarea
                  rows={3}
                  required
                  value={ackModal.remarks}
                  onChange={(e) => setAckModal({ ...ackModal, remarks: e.target.value })}
                  placeholder="State the discrepancy in injection units (MWh), peak tariff, or deductions..."
                  style={{ width: '100%' }}
                />
              </Field>

              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn btn-ghost" disabled={ackLoading} onClick={() => setAckModal({ ...ackModal, open: false })}>
                  Cancel
                </button>
                <button type="button" className="btn btn-danger" disabled={!ackModal.remarks.trim() || ackLoading} onClick={submitAck}>
                  {ackLoading ? 'Submitting…' : '⚠️ Submit Disagreement & Flag Dispute'}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
