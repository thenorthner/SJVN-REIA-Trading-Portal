import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtCurrency } from '../../components/ui.jsx';
import {
  REASON_CODES, CHARGE_LINES, DISPUTE_STATUSES, OPEN_STATUSES,
  reasonLabel, chargeLabel, invoiceChargeBreakdown,
} from '../../disputesMeta.js';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];
const CAN_RAISE = ['SELLER', 'BUYER', 'SJVN_ADMIN', 'REIA_USER'];

const EMPTY_FORM = {
  invoice_id: '', raised_by_role: 'BUYER', reason_code: '', charge_line: 'energy_charges',
  issue_description: '', disputed_amount: '',
};
const RESOLVE_FORM = { outcome: 'PARTIAL_CREDIT', accepted_amount: '', resolution_notes: '', lps_on_resolution: '' };

function StatPill({ label, value, sub }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface-2, #f6f7f9)', borderRadius: 8, minWidth: 120 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Disputes() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [filters, setFilters] = useState({ status: '', reason_code: '', aging: '', sort: 'created_at', order: 'DESC' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [resolveForm, setResolveForm] = useState(RESOLVE_FORM);
  const [comment, setComment] = useState('');
  const [internalComment, setInternalComment] = useState(false);
  const [infoNote, setInfoNote] = useState('');

  const selectedInvoice = invoices.find((i) => i.id === form.invoice_id);
  const breakdown = invoiceChargeBreakdown(selectedInvoice);

  function load() {
    setLoading(true);
    const params = {};
    if (filters.status) params.status = filters.status;
    if (filters.reason_code) params.reason_code = filters.reason_code;
    if (filters.aging) params.aging = filters.aging;
    params.sort = filters.sort;
    params.order = filters.order;
    Promise.all([
      api.disputes.list(params),
      CAN_WRITE.includes(user?.role) || ['FINANCE_USER', 'MANAGEMENT'].includes(user?.role)
        ? api.disputes.stats().catch(() => null)
        : Promise.resolve(null),
    ]).then(([list, s]) => {
      setRows(list);
      if (s) setStats(s);
    }).finally(() => setLoading(false));
  }

  useEffect(load, [filters, user?.role]);
  useEffect(() => {
    api.invoices.list().then(setInvoices).catch(() => {});
  }, []);

  async function openDetail(row) {
    setSelectedId(row.id);
    setResolveForm(RESOLVE_FORM);
    setComment('');
    setInfoNote('');
    try {
      const d = await api.disputes.get(row.id);
      setDetail(d);
    } catch {
      setDetail(row);
    }
  }

  async function refreshDetail() {
    if (!selectedId) return;
    const d = await api.disputes.get(selectedId);
    setDetail(d);
    load();
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.disputes.create({
        ...form,
        disputed_amount: Number(form.disputed_amount),
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to raise dispute.');
    }
  }

  async function handleTransition(status, note) {
    await api.disputes.transition(selectedId, status, note);
    await refreshDetail();
  }

  async function handleResolve(e) {
    e.preventDefault();
    await api.disputes.resolve(selectedId, {
      outcome: resolveForm.outcome,
      accepted_amount: resolveForm.outcome === 'PARTIAL_CREDIT' ? Number(resolveForm.accepted_amount) : undefined,
      resolution_notes: resolveForm.resolution_notes,
      lps_on_resolution: resolveForm.lps_on_resolution ? Number(resolveForm.lps_on_resolution) : 0,
    });
    setSelectedId(null);
    setDetail(null);
    load();
  }

  async function handleComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    await api.disputes.comment(selectedId, comment, internalComment);
    setComment('');
    await refreshDetail();
  }

  async function handleAssign(assigned_to) {
    await api.disputes.assign(selectedId, assigned_to || null);
    await refreshDetail();
  }

  async function handleEvidence(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    await api.disputes.uploadEvidence(selectedId, file);
    e.target.value = '';
    await refreshDetail();
  }

  const columns = [
    { key: 'dispute_no', header: 'Dispute ID' },
    { key: 'invoice_no', header: 'Invoice' },
    { key: 'raised_by_role', header: 'Raised By', render: (r) => r.raised_by_role || r.raised_by },
    { key: 'reason_code', header: 'Category', render: (r) => reasonLabel(r.reason_code) },
    { key: 'charge_line', header: 'Line', render: (r) => chargeLabel(r.charge_line) },
    { key: 'disputed_amount', header: 'Amount', render: (r) => fmtCurrency(r.disputed_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'ageing_days', header: 'Age', render: (r) => `${r.ageing_days ?? 0}d` },
    { key: 'sla', header: 'SLA', render: (r) => (r.sla_breached || r.status === 'ESCALATED' ? <Badge status="ESCALATED" /> : 'OK') },
  ];

  return (
    <div>
      <PageHeader
        title="Dispute Management"
        subtitle="Financial control — partial disputes, SLA, settlement & root-cause patterns"
        actions={CAN_RAISE.includes(user?.role) && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Raise Dispute</button>
        )}
      />

      {stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <StatPill label="Open" value={stats.open_count} />
          <StatPill label="Exposure" value={fmtCurrency(stats.financial_exposure)} />
          <StatPill label="SLA Breached" value={stats.sla_breached} />
          <StatPill label="60d+ Pending" value={stats.long_pending} />
          <StatPill label="Resolved" value={stats.resolved_count} />
          <StatPill label="Aging 0–7" value={stats.aging?.['0_7'] ?? 0} />
          <StatPill label="8–15" value={stats.aging?.['8_15'] ?? 0} />
          <StatPill label="16–30" value={stats.aging?.['16_30'] ?? 0} />
          <StatPill label="30+" value={stats.aging?.['30_plus'] ?? 0} />
        </div>
      )}

      {stats?.by_reason?.length > 0 && (
        <Card title="Category patterns (root-cause)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {stats.by_reason.slice(0, 8).map((r) => (
              <button
                key={r.reason_code}
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => setFilters({ ...filters, reason_code: r.reason_code })}
              >
                {reasonLabel(r.reason_code)} · {r.count} · {fmtCurrency(r.amount)}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="filters-bar" style={{ marginTop: 12 }}>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {DISPUTE_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
        </select>
        <select value={filters.reason_code} onChange={(e) => setFilters({ ...filters, reason_code: e.target.value })}>
          <option value="">All categories</option>
          {REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={filters.aging} onChange={(e) => setFilters({ ...filters, aging: e.target.value })}>
          <option value="">All aging</option>
          <option value="0_7">0–7 days</option>
          <option value="8_15">8–15 days</option>
          <option value="16_30">16–30 days</option>
          <option value="30_plus">30+ days</option>
          <option value="60_plus">60+ days</option>
        </select>
        <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
          <option value="created_at">Sort: Date</option>
          <option value="disputed_amount">Sort: Amount</option>
          <option value="sla_resolve_due">Sort: SLA due</option>
          <option value="status">Sort: Status</option>
        </select>
        <select value={filters.order} onChange={(e) => setFilters({ ...filters, order: e.target.value })}>
          <option value="DESC">Desc</option>
          <option value="ASC">Asc</option>
        </select>
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : rows}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : 'No disputes found.'}
        />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Raise Dispute" width={620}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Invoice">
            <select required value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
              <option value="">Select invoice...</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_no} — {fmtCurrency(i.total_amount)} (Disputed {fmtCurrency(i.disputed_amount || 0)} | Payable {fmtCurrency(i.payable_now ?? i.total_amount - (i.disputed_amount || 0))})
                </option>
              ))}
            </select>
          </Field>
          {selectedInvoice && (
            <div className="inline-note" style={{ marginBottom: 12 }}>
              <strong>Charge breakdown:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {CHARGE_LINES.map((c) => (
                  <li key={c.value}>{c.label}: {fmtCurrency(breakdown[c.value] || 0)}</li>
                ))}
              </ul>
              <div style={{ marginTop: 6 }}>
                Disputed: {fmtCurrency(selectedInvoice.disputed_amount || 0)} | Payable now: {fmtCurrency(selectedInvoice.payable_now ?? (selectedInvoice.total_amount - (selectedInvoice.disputed_amount || 0)))}
              </div>
            </div>
          )}
          <div className="form-grid">
            <Field label="Raised By">
              <select value={form.raised_by_role} onChange={(e) => setForm({ ...form, raised_by_role: e.target.value })}>
                <option value="BUYER">Buyer</option>
                <option value="SELLER">Seller</option>
              </select>
            </Field>
            <Field label="Charge line">
              <select required value={form.charge_line} onChange={(e) => setForm({ ...form, charge_line: e.target.value })}>
                {CHARGE_LINES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Reason code (mandatory)">
            <select required value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })}>
              <option value="">Select category...</option>
              {REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Disputed Amount (₹)">
            <input required type="number" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
            <p className="inline-note" style={{ marginTop: 4 }}>Undisputed balance remains payable by due date.</p>
          </Field>
          <Field label="Description">
            <textarea required={form.reason_code === 'OTHER'} value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Submit Dispute</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!selectedId && !!detail} onClose={() => { setSelectedId(null); setDetail(null); }} title={`${detail?.dispute_no || 'Dispute'} — ${detail?.invoice?.invoice_no || detail?.invoice_no || ''}`} width={720}>
        {detail && (
          <div>
            <div className="detail-grid mb-0">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Category</span><span className="detail-value">{reasonLabel(detail.reason_code)}</span></div>
              <div className="detail-item"><span className="detail-label">Charge line</span><span className="detail-value">{chargeLabel(detail.charge_line)}</span></div>
              <div className="detail-item"><span className="detail-label">Disputed</span><span className="detail-value">{fmtCurrency(detail.disputed_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Invoice payable now</span><span className="detail-value">{fmtCurrency(detail.invoice?.payable_now)}</span></div>
              <div className="detail-item"><span className="detail-label">Age / SLA resolve</span><span className="detail-value">{detail.ageing_days}d / {detail.sla_resolve_due?.slice(0, 10) || '—'}</span></div>
              <div className="detail-item"><span className="detail-label">Assignee</span><span className="detail-value">{detail.assignee?.name || 'Unassigned'}</span></div>
            </div>
            <p style={{ marginTop: 12 }}>{detail.issue_description}</p>
            {detail.resolution_notes && (
              <div className="inline-note"><strong>Resolution ({detail.resolution_outcome}):</strong> {detail.resolution_notes}
                {detail.credit_amount > 0 && <> — Credit {fmtCurrency(detail.credit_amount)} (before {fmtCurrency(detail.before_total)} → after {fmtCurrency(detail.after_total)})</>}
              </div>
            )}
            {detail.supplementary_invoice && (
              <div className="inline-note">Supplementary: {detail.supplementary_invoice.invoice_no} ({fmtCurrency(detail.supplementary_invoice.total_amount)})</div>
            )}

            {CAN_WRITE.includes(user?.role) && OPEN_STATUSES.includes(detail.status) && (
              <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                {detail.status === 'ACKNOWLEDGED' && (
                  <button type="button" className="btn btn-secondary" onClick={() => handleTransition('UNDER_REVIEW')}>Start Review</button>
                )}
                {['ACKNOWLEDGED', 'UNDER_REVIEW', 'ESCALATED'].includes(detail.status) && (
                  <button type="button" className="btn btn-ghost" onClick={() => {
                    const note = infoNote || 'Please provide additional clarification / evidence.';
                    handleTransition('INFO_REQUESTED', note);
                  }}>Request Info</button>
                )}
                {detail.status === 'INFO_REQUESTED' && (
                  <button type="button" className="btn btn-secondary" onClick={() => handleTransition('UNDER_REVIEW')}>Resume Review</button>
                )}
                {['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'].includes(detail.status) === false && null}
                <input type="text" placeholder="Info request note..." value={infoNote} onChange={(e) => setInfoNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                <button type="button" className="btn btn-ghost" onClick={() => handleAssign(user.id)}>Assign to me</button>
              </div>
            )}

            {CAN_WRITE.includes(user?.role) && ['UNDER_REVIEW', 'ESCALATED', 'ACKNOWLEDGED', 'INFO_REQUESTED'].includes(detail.status) && (
              <>
                <div className="section-title" style={{ marginTop: 18 }}>Resolve</div>
                <form onSubmit={handleResolve}>
                  <Field label="Outcome">
                    <select value={resolveForm.outcome} onChange={(e) => setResolveForm({ ...resolveForm, outcome: e.target.value })}>
                      <option value="FULL_CREDIT">Resolved – Accepted (full credit)</option>
                      <option value="PARTIAL_CREDIT">Resolved – Accepted (partial credit)</option>
                      <option value="REJECTED">Resolved – Rejected</option>
                    </select>
                  </Field>
                  {resolveForm.outcome === 'PARTIAL_CREDIT' && (
                    <Field label="Accepted / credit amount (₹)">
                      <input required type="number" value={resolveForm.accepted_amount} onChange={(e) => setResolveForm({ ...resolveForm, accepted_amount: e.target.value })} />
                    </Field>
                  )}
                  <Field label="Resolution reasoning (shown to parties)">
                    <textarea required value={resolveForm.resolution_notes} onChange={(e) => setResolveForm({ ...resolveForm, resolution_notes: e.target.value })} />
                  </Field>
                  <Field label="LPS / interest on settlement (₹)">
                    <input type="number" value={resolveForm.lps_on_resolution} onChange={(e) => setResolveForm({ ...resolveForm, lps_on_resolution: e.target.value })} />
                  </Field>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">Confirm Resolution</button>
                  </div>
                </form>
              </>
            )}

            {CAN_WRITE.includes(user?.role) && ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'].includes(detail.status) && (
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => handleTransition('CLOSED')}>Close Dispute</button>
              </div>
            )}

            <div className="section-title" style={{ marginTop: 18 }}>Evidence</div>
            <ul style={{ paddingLeft: 18, margin: '6px 0' }}>
              {(detail.supporting_docs || []).map((d) => (
                <li key={d.filename}>{d.original_name || d.filename} <span style={{ opacity: 0.6 }}>({d.uploaded_by})</span></li>
              ))}
              {!(detail.supporting_docs || []).length && <li style={{ opacity: 0.6 }}>No documents uploaded</li>}
            </ul>
            <input type="file" onChange={handleEvidence} />

            <div className="section-title" style={{ marginTop: 18 }}>Communication thread</div>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
              {(detail.comments || []).map((c) => (
                <div key={c.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    {c.user_name} ({c.role}) · {c.created_at?.slice(0, 16)}
                    {c.is_internal ? ' · INTERNAL' : ''}
                  </div>
                  <div>{c.body}</div>
                </div>
              ))}
              {!(detail.comments || []).length && <div style={{ opacity: 0.6 }}>No comments yet</div>}
            </div>
            <form onSubmit={handleComment}>
              <Field label="Add comment">
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
              </Field>
              {CAN_WRITE.includes(user?.role) && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
                  <input type="checkbox" checked={internalComment} onChange={(e) => setInternalComment(e.target.checked)} />
                  Internal only (hidden from buyer/seller)
                </label>
              )}
              <button type="submit" className="btn btn-secondary">Post</button>
            </form>

            <div className="section-title" style={{ marginTop: 18 }}>Audit trail</div>
            <ul style={{ paddingLeft: 18, fontSize: 13 }}>
              {(detail.events || []).map((ev) => (
                <li key={ev.id}>
                  {ev.created_at?.slice(0, 16)} — {ev.event_type}
                  {ev.from_status ? ` (${ev.from_status} → ${ev.to_status})` : ''} by {ev.actor_name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}
