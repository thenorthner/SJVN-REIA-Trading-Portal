import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, StatementViewer } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';
import { fmtDateTime } from '../../datetime.js';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER', 'MANAGEMENT'];
const CAN_APPROVE_REOPEN = ['SJVN_ADMIN', 'FINANCE_USER', 'REIA_USER'];

const RUN_FORM = {
  scope: 'REIA_CONTRACT', contract_id: '', trading_client_id: '',
  period_type: 'MONTHLY', period: '2025-05',
};

function StatPill({ label, value, sub }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, minWidth: 120 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--text)' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MatchCell({ status }) {
  const ok = ['EXACT', 'AUTO_MATCHED', 'OVERRIDDEN'].includes(status);
  return <Badge status={ok ? 'AUTO_MATCHED' : status === 'CARRIED' ? 'REOPENED' : 'NEEDS_REVIEW'} />;
}

export default function Reconciliation() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [contracts, setContracts] = useState([]);
  const [tradingClients, setTradingClients] = useState([]);
  const [reopenQueue, setReopenQueue] = useState([]);
  const [filters, setFilters] = useState({ status: '', period_type: '', scope: '', aging: '' });
  const [loading, setLoading] = useState(true);
  const [showRun, setShowRun] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const [runForm, setRunForm] = useState(RUN_FORM);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  // Acknowledgement & Regeneration States
  const [ackModal, setAckModal] = useState({
    open: false,
    decision: 'AGREE', // 'AGREE' | 'DISAGREE'
    remarks: '',
    confirmed: false,
  });
  const [ackLoading, setAckLoading] = useState(false);
  const [ackFeedback, setAckFeedback] = useState(null);
  const [regenerateLoading, setRegenerateLoading] = useState(false);

  async function downloadReconPdf() {
    setPdfLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      await api.reports.reconSummaryPdf(params);
    } catch (err) {
      alert(err.message || 'Failed to download reconciliation PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    Promise.all([
      api.reconciliation.list(params),
      api.reconciliation.stats().catch(() => null),
      api.reconciliation.reopenRequests().catch(() => []),
    ]).then(([list, s, rq]) => {
      setRows(list);
      setStats(s);
      setReopenQueue((rq || []).filter((r) => r.status === 'PENDING'));
    }).finally(() => setLoading(false));
  }

  useEffect(load, [filters.status, filters.period_type, filters.scope, filters.aging]);
  useEffect(() => {
    api.contracts.list().then(setContracts).catch(() => {});
    api.tradingClients?.list?.().then(setTradingClients).catch(() => {});
  }, []);

  async function openDetail(row) {
    setDetail(await api.reconciliation.get(row.id));
    setOverrideReason('');
    setReopenReason('');
    setAckFeedback(null);
  }

  async function refreshDetail() {
    if (!detail) return;
    const fresh = await api.reconciliation.get(detail.id);
    setDetail(fresh);
    load();
    return fresh;
  }

  async function handleRun(e) {
    e.preventDefault();
    setError('');
    try {
      const body = {
        scope: runForm.scope,
        period_type: runForm.period_type,
        period: runForm.period,
        contract_id: runForm.scope === 'REIA_CONTRACT' ? runForm.contract_id : undefined,
        trading_client_id: runForm.scope === 'TRADING_CLIENT' ? runForm.trading_client_id : undefined,
      };
      await api.reconciliation.run(body);
      setShowRun(false);
      setRunForm(RUN_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run reconciliation.');
    }
  }

  async function handleOverride(itemId) {
    if (!overrideReason.trim()) return alert('Override reason required');
    try {
      await api.reconciliation.override(detail.id, itemId, overrideReason);
      setOverrideReason('');
      setAckFeedback({
        type: 'info',
        title: 'Item Variance Overridden',
        message: 'Line variance successfully overridden. Updated metrics calculated.',
      });
      await refreshDetail();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to override');
    }
  }

  async function handleRaiseDispute(itemId) {
    try {
      await api.reconciliation.raiseDispute(detail.id, {
        item_id: itemId,
        reason_code: 'ENERGY_DATA_MISMATCH',
        issue_description: `From reconciliation ${detail.recon_no}`,
      });
      setAckFeedback({
        type: 'warning',
        title: 'Dispute Case Raised',
        message: 'Dispute linked to this reconciliation item and forwarded to dispute resolution desk.',
      });
      await refreshDetail();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to raise dispute');
    }
  }

  async function handleSignoffRequest() {
    try {
      await api.reconciliation.requestSignoff(detail.id);
      setAckFeedback({
        type: 'success',
        title: 'Sign-off Requested',
        message: 'Reconciliation is now marked PENDING SIGN-OFF. Notification sent to counterparty.',
      });
      await refreshDetail();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to request sign-off';
      alert(msg);
    }
  }

  // Open Acknowledgement Modal
  function triggerAckModal(decision) {
    setAckModal({
      open: true,
      decision,
      remarks: decision === 'AGREE' ? 'Verified against REA & billing ledger.' : '',
      confirmed: false,
    });
  }

  // Submit Acknowledgement
  async function submitAcknowledgement() {
    if (ackModal.decision === 'DISAGREE' && !ackModal.remarks.trim()) {
      alert('Please provide the reason / discrepancy notes for disagreement.');
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
        title: isAgree ? '✅ Sign-off Acknowledged Successfully' : '⚠️ Disagreement Recorded & Disputed',
        message: res.message || (isAgree ? 'SJVN Digital Sign-off successfully logged with timestamp and audit entry.' : 'Disagreement recorded.'),
      });

      setAckModal({ open: false, decision: 'AGREE', remarks: '', confirmed: false });
      await refreshDetail();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to process acknowledgement';
      alert(msg);
    } finally {
      setAckLoading(false);
    }
  }

  // Handle Regenerate Statement
  async function handleRegenerate() {
    setRegenerateLoading(true);
    setAckFeedback(null);
    try {
      const res = await api.reconciliation.regenerateStatement(detail.id);
      await refreshDetail();
      setAckFeedback({
        type: 'success',
        title: '🔄 Statement Successfully Regenerated!',
        message: res.message || `Recalculated fresh energy/billing lines and created Version v${res.version || (detail.version + 1)}.`,
      });
    } catch (err) {
      setAckFeedback({
        type: 'danger',
        title: 'Regeneration Failed',
        message: err.response?.data?.error || err.message || 'Failed to regenerate statement.',
      });
    } finally {
      setRegenerateLoading(false);
    }
  }

  async function handleReopenRequest() {
    if (!reopenReason.trim()) return alert('Reason required');
    try {
      await api.reconciliation.reopenRequest(detail.id, reopenReason);
      setReopenReason('');
      setAckFeedback({
        type: 'info',
        title: 'Reopen Request Submitted',
        message: 'Reopen request has been submitted for finance and management approval.',
      });
      await refreshDetail();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit reopen request');
    }
  }

  async function actReopen(id, decision) {
    await api.reconciliation.actReopen(id, decision);
    load();
  }

  const columns = [
    { key: 'recon_no', header: 'Recon #' },
    { key: 'contract_no', header: 'Entity', render: (r) => r.contract_no || r.trading_client_name || '-' },
    { key: 'period', header: 'Period', render: (r) => `${r.period} (${r.period_type})` },
    { key: 'data_basis', header: 'Basis' },
    { key: 'auto_match_pct', header: 'Auto-match', render: (r) => `${r.auto_match_pct ?? 0}%` },
    { key: 'unreconciled_amount', header: 'Exposure', render: (r) => fmtCurrency(r.unreconciled_amount || 0) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'ageing_days', header: 'Age', render: (r) => `${r.ageing_days ?? 0}d` },
  ];

  return (
    <div>
      <PageHeader
        title="Reconciliation"
        subtitle="Three-way trust: Metered ↔ Billed ↔ Paid — with joint digital sign-off and dispute linkage"
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={pdfLoading} onClick={downloadReconPdf}>
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
            </button>
            {CAN_WRITE.includes(user?.role) && (
              <button className="btn btn-secondary" onClick={() => setShowRun(true)}>+ Run Reconciliation</button>
            )}
          </div>
        }
      />

      {stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <StatPill label="Auto-match avg" value={`${stats.avg_auto_match_pct}%`} />
          <StatPill label="Needs review" value={stats.needs_review} />
          <StatPill label="Pending sign-off" value={stats.pending_signoff} />
          <StatPill label="Disputed" value={stats.disputed} />
          <StatPill label="Unreconciled ₹" value={fmtCurrency(stats.financial_exposure)} />
          <StatPill label="Aging 0–7" value={stats.aging?.['0_7'] ?? 0} />
          <StatPill label="30+" value={stats.aging?.['30_plus'] ?? 0} />
        </div>
      )}

      {stats?.trend?.length > 0 && (
        <Card title="Auto-match trend (monthly)">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
            {stats.trend.map((t) => (
              <span key={t.period} style={{ padding: '6px 10px', background: 'var(--bg-main, #f3f4f6)', borderRadius: 6 }}>
                {t.period}: <strong>{Number(t.auto_match_pct || 0).toFixed(0)}%</strong>
              </span>
            ))}
          </div>
        </Card>
      )}

      {reopenQueue.length > 0 && (
        <Card title="Reopen requests (approval required)">
          {reopenQueue.map((rq) => (
            <div key={rq.id} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span>{rq.recon_no} / {rq.period}</span>
              <span style={{ opacity: 0.7 }}>{rq.reason}</span>
              <span style={{ fontSize: 12 }}>by {rq.requested_by_name}</span>
              {CAN_APPROVE_REOPEN.includes(user?.role) && (
                <>
                  <button className="btn btn-success btn-sm" type="button" onClick={() => actReopen(rq.id, 'APPROVED')}>Approve</button>
                  <button className="btn btn-danger btn-sm" type="button" onClick={() => actReopen(rq.id, 'REJECTED')}>Reject</button>
                </>
              )}
            </div>
          ))}
        </Card>
      )}

      <div className="filters-bar" style={{ marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['NEEDS_REVIEW', 'PENDING_SIGN_OFF', 'AUTO_MATCHED', 'AGREED', 'CLOSED', 'DISPUTED', 'REOPENED'].map((s) => (
            <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>
          ))}
        </select>
        <select value={filters.period_type} onChange={(e) => setFilters({ ...filters, period_type: e.target.value })}>
          <option value="">All period types</option>
          {['MONTHLY', 'QUARTERLY', 'ANNUAL'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.scope} onChange={(e) => setFilters({ ...filters, scope: e.target.value })}>
          <option value="">All scopes</option>
          <option value="REIA_CONTRACT">REIA Contract</option>
          <option value="TRADING_CLIENT">Trading</option>
        </select>
        <select value={filters.aging} onChange={(e) => setFilters({ ...filters, aging: e.target.value })}>
          <option value="">All aging</option>
          <option value="0_7">0–7 days</option>
          <option value="8_15">8–15 days</option>
          <option value="16_30">16–30 days</option>
          <option value="30_plus">30+</option>
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : 'No reconciliations.'} />
      </Card>

      {/* Modal: Run Reconciliation */}
      <Modal open={showRun} onClose={() => setShowRun(false)} title="Run Reconciliation" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleRun}>
          <Field label="Scope">
            <select value={runForm.scope} onChange={(e) => setRunForm({ ...runForm, scope: e.target.value })}>
              <option value="REIA_CONTRACT">REIA Contract (PPA/PSA)</option>
              <option value="TRADING_CLIENT">Trading Client</option>
            </select>
          </Field>
          {runForm.scope === 'REIA_CONTRACT' ? (
            <Field label="Contract">
              <select required value={runForm.contract_id} onChange={(e) => setRunForm({ ...runForm, contract_id: e.target.value })}>
                <option value="">Select...</option>
                {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Trading client">
              <select required value={runForm.trading_client_id} onChange={(e) => setRunForm({ ...runForm, trading_client_id: e.target.value })}>
                <option value="">Select...</option>
                {tradingClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          <div className="form-grid">
            <Field label="Period type">
              <select value={runForm.period_type} onChange={(e) => setRunForm({ ...runForm, period_type: e.target.value })}>
                {['MONTHLY', 'QUARTERLY', 'ANNUAL'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Period">
              <input required placeholder="YYYY-MM" value={runForm.period} onChange={(e) => setRunForm({ ...runForm, period: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowRun(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Run</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Reconciliation Statement Details & Actions */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`${detail?.recon_no || ''} — ${detail?.period || ''}`} width={860}>
        {detail && (
          <div>
            {/* Feedback Alert Banner */}
            {ackFeedback && (
              <div style={{
                padding: '12px 16px',
                borderRadius: 8,
                marginBottom: 16,
                background: ackFeedback.type === 'success' ? '#ecfdf5' : ackFeedback.type === 'danger' ? '#fef2f2' : '#eff6ff',
                border: `1px solid ${ackFeedback.type === 'success' ? '#10b981' : ackFeedback.type === 'danger' ? '#ef4444' : '#3b82f6'}`,
                color: ackFeedback.type === 'success' ? '#065f46' : ackFeedback.type === 'danger' ? '#991b1b' : '#1e40af',
                fontSize: 13,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{ackFeedback.title}</div>
                <div>{ackFeedback.message}</div>
              </div>
            )}

            {/* Quick Metrics Grid */}
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Basis</span><span className="detail-value">{detail.data_basis}</span></div>
              <div className="detail-item"><span className="detail-label">Auto-match</span><span className="detail-value">{detail.auto_match_pct}%</span></div>
              <div className="detail-item"><span className="detail-label">Exposure</span><span className="detail-value">{fmtCurrency(detail.unreconciled_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Statement Version</span><span className="detail-value">v{detail.version || 1}</span></div>
              <div className="detail-item"><span className="detail-label">Contract / Client</span><span className="detail-value">{detail.contract_no || detail.trading_client_name || '—'}</span></div>
            </div>

            {/* Dual Joint Sign-off Status Card */}
            <div style={{
              marginTop: 16,
              padding: 16,
              background: 'var(--surface-hover, #f8fafc)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>🤝 Dual Digital Sign-off & Acknowledgment Status</span>
                {detail.sjvn_ack_at && detail.counterparty_ack_at ? (
                  <span style={{ fontSize: 12, background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                    ✓ 2/2 Complete (Closed & Legally Agreed)
                  </span>
                ) : (detail.sjvn_ack_at || detail.counterparty_ack_at) ? (
                  <span style={{ fontSize: 12, background: '#f59e0b', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                    ⏳ 1/2 Acknowledged (Awaiting Dual Signature)
                  </span>
                ) : (
                  <span style={{ fontSize: 12, background: 'var(--text-muted)', color: '#fff', padding: '2px 8px', borderRadius: 12 }}>
                    0/2 Signed Off
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                {/* SJVN Desk Card */}
                <div style={{
                  padding: 12,
                  background: detail.sjvn_ack_at ? '#ecfdf5' : '#ffffff',
                  border: `1px solid ${detail.sjvn_ack_at ? '#a7f3d0' : 'var(--border)'}`,
                  borderRadius: 6,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: detail.sjvn_ack_at ? '#065f46' : 'var(--text-muted)' }}>
                    🏛️ SJVN REIA Desk Sign-Off
                  </div>
                  {detail.sjvn_ack_at ? (
                    <div style={{ marginTop: 4, fontSize: 13, color: '#065f46' }}>
                      <div style={{ fontWeight: 600 }}>✅ Acknowledged by {detail.sjvn_ack_by}</div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>on {fmtDateTime(detail.sjvn_ack_at)}</div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-muted)' }}>
                      ⏳ Pending SJVN verification & sign-off
                    </div>
                  )}
                </div>

                {/* Counterparty Card */}
                <div style={{
                  padding: 12,
                  background: detail.counterparty_ack_at ? '#ecfdf5' : '#ffffff',
                  border: `1px solid ${detail.counterparty_ack_at ? '#a7f3d0' : 'var(--border)'}`,
                  borderRadius: 6,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: detail.counterparty_ack_at ? '#065f46' : 'var(--text-muted)' }}>
                    🏢 Counterparty (Buyer/Seller) Sign-Off
                  </div>
                  {detail.counterparty_ack_at ? (
                    <div style={{ marginTop: 4, fontSize: 13, color: '#065f46' }}>
                      <div style={{ fontWeight: 600 }}>✅ Acknowledged by {detail.counterparty_ack_by}</div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>on {fmtDateTime(detail.counterparty_ack_at)}</div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-muted)' }}>
                      ⏳ Pending Discom / Generator digital sign-off
                    </div>
                  )}
                </div>
              </div>

              {detail.discrepancy_notes && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', background: '#ffffff', padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border)' }}>
                  <strong>Notes / Remarks:</strong> {detail.discrepancy_notes}
                </div>
              )}
            </div>

            <div className="section-title" style={{ marginTop: 16 }}>Three-way / check items</div>
            <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th scope="col">Type</th><th scope="col">Metered</th><th scope="col">Billed</th><th scope="col">Paid/SAP</th><th scope="col">Var</th><th scope="col">Match</th><th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {(detail.items || []).map((it) => (
                  <tr key={it.id}>
                    <td>
                      {it.label}
                      {!!it.pattern_flag && <div style={{ color: 'var(--error)', fontSize: 11 }}>Pattern flag — systemic?</div>}
                      {it.notes && <div style={{ opacity: 0.6, fontSize: 11 }}>{it.notes}</div>}
                    </td>
                    <td>{it.metered_value ?? '—'}</td>
                    <td>{it.billed_value ?? '—'}</td>
                    <td>{it.paid_value ?? it.sap_reference_amount ?? '—'}</td>
                    <td>{it.variance}</td>
                    <td><MatchCell status={it.match_status} /></td>
                    <td>
                      {CAN_WRITE.includes(user?.role) && ['EXCEPTION', 'CARRIED'].includes(it.match_status) && (
                        <div className="cell-actions">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleOverride(it.id)}>Override</button>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => handleRaiseDispute(it.id)}>→ Dispute</button>
                        </div>
                      )}
                      {it.dispute_id && <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Linked dispute</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {CAN_WRITE.includes(user?.role) && (
              <Field label="Override reason (required before Override)">
                <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why accepting variance..." />
              </Field>
            )}

            {detail.dispute_ref?.disputed_count > 0 && (
              <div className="inline-note" style={{ marginTop: 10 }}>
                Period disputes: {detail.dispute_ref.disputed_count} (pending {detail.dispute_ref.pending_count}, ₹{Number(detail.dispute_ref.pending_amount || 0).toLocaleString('en-IN')})
              </div>
            )}

            <div className="section-title" style={{ marginTop: 16 }}>Reconciliation statement</div>
            <StatementViewer statement={detail.statement} />

            {/* Action Bar */}
            <div className="form-actions" style={{ flexWrap: 'wrap', gap: 10, marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              {CAN_WRITE.includes(user?.role) && detail.items_exception === 0 && detail.status === 'NEEDS_REVIEW' && (
                <button type="button" className="btn btn-secondary" onClick={handleSignoffRequest}>
                  Request Sign-off
                </button>
              )}

              {CAN_WRITE.includes(user?.role) && ['PENDING_SIGN_OFF', 'AUTO_MATCHED', 'NEEDS_REVIEW'].includes(detail.status) && (
                <>
                  <button type="button" className="btn btn-success" onClick={() => triggerAckModal('AGREE')}>
                    ✓ SJVN Agree & Sign-Off
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => triggerAckModal('DISAGREE')}>
                    ✗ Disagree & Flag Dispute
                  </button>
                </>
              )}

              {CAN_WRITE.includes(user?.role) && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={regenerateLoading}
                  onClick={handleRegenerate}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  {regenerateLoading ? '⏳ Recalculating & Regenerating…' : '🔄 Regenerate statement (Re-sync)'}
                </button>
              )}

              {['CLOSED', 'AGREED'].includes(detail.status) && (
                <div style={{ display: 'flex', gap: 8, flex: 1, minWidth: 280 }}>
                  <input placeholder="Reopen reason..." value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} style={{ flex: 1 }} />
                  <button type="button" className="btn btn-secondary" onClick={handleReopenRequest}>Request Reopen</button>
                </div>
              )}
            </div>

            <div style={{ marginTop: 24, marginBottom: 24 }}>
              <DocumentManager 
                moduleName="RECONCILIATION"
                title="Reconciliation Evidence & Approvals" 
              />
            </div>

            <div className="section-title" style={{ marginTop: 14 }}>Audit trail</div>
            <ul style={{ paddingLeft: 18, fontSize: 13 }}>
              {(detail.events || []).map((ev) => (
                <li key={ev.id}>{fmtDateTime(ev.created_at)} — {ev.event_type} by {ev.actor_name}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      {/* Modal: Interactive Digital Sign-off & Acknowledgment / Disagreement */}
      <Modal
        open={ackModal.open}
        onClose={() => !ackLoading && setAckModal({ ...ackModal, open: false })}
        title={ackModal.decision === 'AGREE' ? '✍️ Digital Sign-off & Acknowledgment' : '⚠️ Record Disagreement & Dispute Notice'}
        width={560}
      >
        <div>
          {ackModal.decision === 'AGREE' ? (
            <div>
              <div style={{
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 8,
                padding: 14,
                marginBottom: 16,
                color: '#065f46',
                fontSize: 13,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  Reconciliation Statement Confirmation
                </div>
                <div><strong>Recon #:</strong> {detail?.recon_no}</div>
                <div><strong>Period:</strong> {detail?.period} ({detail?.data_basis})</div>
                <div><strong>Entity:</strong> {detail?.contract_no || detail?.trading_client_name}</div>
                <div><strong>Auto-Match Accuracy:</strong> {detail?.auto_match_pct}%</div>
                <div><strong>Signatory:</strong> {user?.name} ({user?.role})</div>
              </div>

              <Field label="Sign-off Remarks / Notes (optional)">
                <input
                  value={ackModal.remarks}
                  onChange={(e) => setAckModal({ ...ackModal, remarks: e.target.value })}
                  placeholder="e.g. Verified against REA and billing schedules"
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
                  <strong>I confirm digital sign-off</strong>: I have reviewed the energy metered volumes, billing lines, and payment records for period <strong>{detail?.period}</strong> and formally agree with this reconciliation statement.
                </span>
              </label>

              <div className="form-actions" style={{ marginTop: 18 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={ackLoading}
                  onClick={() => setAckModal({ ...ackModal, open: false })}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  disabled={!ackModal.confirmed || ackLoading}
                  onClick={submitAcknowledgement}
                >
                  {ackLoading ? 'Recording Sign-off…' : '✓ Confirm & Digitally Sign Off'}
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: 14,
                marginBottom: 16,
                color: '#991b1b',
                fontSize: 13,
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  Disagreement & Dispute Escalation
                </div>
                <div>
                  Disagreeing will mark this reconciliation as <strong>DISPUTED</strong> and flag the discrepancy to all parties for formal dispute resolution.
                </div>
              </div>

              <Field label="Discrepancy / Disagreement Reason *">
                <textarea
                  rows={3}
                  required
                  value={ackModal.remarks}
                  onChange={(e) => setAckModal({ ...ackModal, remarks: e.target.value })}
                  placeholder="Describe the discrepancy in meter units, tariff rate, or billing amount..."
                  style={{ width: '100%' }}
                />
              </Field>

              <div className="form-actions" style={{ marginTop: 18 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={ackLoading}
                  onClick={() => setAckModal({ ...ackModal, open: false })}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={!ackModal.remarks.trim() || ackLoading}
                  onClick={submitAcknowledgement}
                >
                  {ackLoading ? 'Submitting Disagreement…' : '⚠️ Submit Disagreement & Flag Dispute'}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
