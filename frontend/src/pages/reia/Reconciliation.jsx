import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency, StatementViewer } from '../../components/ui.jsx';
import { DocumentManager } from '../../components/DocumentManager.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];
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
  const [runForm, setRunForm] = useState(RUN_FORM);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [reopenReason, setReopenReason] = useState('');

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
  }

  async function refreshDetail() {
    if (!detail) return;
    setDetail(await api.reconciliation.get(detail.id));
    load();
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
    await api.reconciliation.override(detail.id, itemId, overrideReason);
    setOverrideReason('');
    await refreshDetail();
  }

  async function handleRaiseDispute(itemId) {
    await api.reconciliation.raiseDispute(detail.id, {
      item_id: itemId,
      reason_code: 'ENERGY_DATA_MISMATCH',
      issue_description: `From reconciliation ${detail.recon_no}`,
    });
    await refreshDetail();
  }

  async function handleSignoffRequest() {
    await api.reconciliation.requestSignoff(detail.id);
    await refreshDetail();
  }

  async function handleAck(decision) {
    await api.reconciliation.acknowledge(detail.id, decision, decision === 'DISAGREE' ? 'Disagreed from REIA desk' : undefined);
    await refreshDetail();
  }

  async function handleReopenRequest() {
    if (!reopenReason.trim()) return alert('Reason required');
    await api.reconciliation.reopenRequest(detail.id, reopenReason);
    setReopenReason('');
    await refreshDetail();
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
        subtitle="Three-way trust: Metered ↔ Billed ↔ Paid — with joint sign-off and dispute linkage"
        actions={CAN_WRITE.includes(user?.role) && (
          <button className="btn btn-primary" onClick={() => setShowRun(true)}>+ Run Reconciliation</button>
        )}
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

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`${detail?.recon_no || ''} — ${detail?.period || ''}`} width={780}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Basis</span><span className="detail-value">{detail.data_basis}</span></div>
              <div className="detail-item"><span className="detail-label">Auto-match</span><span className="detail-value">{detail.auto_match_pct}%</span></div>
              <div className="detail-item"><span className="detail-label">Exposure</span><span className="detail-value">{fmtCurrency(detail.unreconciled_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Energy / Pay / Perf</span><span className="detail-value">{detail.energy_match ? '✓' : '✗'} / {detail.payment_match ? '✓' : '✗'} / {detail.performance_match ? '✓' : '✗'}</span></div>
              <div className="detail-item"><span className="detail-label">Sign-off</span><span className="detail-value">SJVN: {detail.sjvn_ack_by || '—'} | CP: {detail.counterparty_ack_by || '—'}</span></div>
            </div>

            <div className="section-title" style={{ marginTop: 14 }}>Three-way / check items</div>
            <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Type</th><th>Metered</th><th>Billed</th><th>Paid/SAP</th><th>Var</th><th>Match</th><th></th>
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
                      {it.dispute_id && <div style={{ fontSize: 11 }}>Linked dispute</div>}
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
            <div className="form-actions" style={{ flexWrap: 'wrap' }}>
              {CAN_WRITE.includes(user?.role) && detail.items_exception === 0 && detail.status === 'NEEDS_REVIEW' && (
                <button type="button" className="btn btn-secondary" onClick={handleSignoffRequest}>Request Sign-off</button>
              )}
              {CAN_WRITE.includes(user?.role) && ['PENDING_SIGN_OFF', 'AUTO_MATCHED'].includes(detail.status) && (
                <>
                  <button type="button" className="btn btn-success" onClick={() => handleAck('AGREE')}>SJVN Agree</button>
                  <button type="button" className="btn btn-danger" onClick={() => handleAck('DISAGREE')}>Disagree</button>
                </>
              )}
              {CAN_WRITE.includes(user?.role) && (
                <button type="button" className="btn btn-ghost" onClick={() => api.reconciliation.regenerateStatement(detail.id).then(refreshDetail)}>Regenerate statement</button>
              )}
              {['CLOSED', 'AGREED'].includes(detail.status) && (
                <>
                  <input placeholder="Reopen reason..." value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                  <button type="button" className="btn btn-secondary" onClick={handleReopenRequest}>Request Reopen</button>
                </>
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
                <li key={ev.id}>{ev.created_at?.slice(0, 16)} — {ev.event_type} by {ev.actor_name}</li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
