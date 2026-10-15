import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { writeRolesFor, pathFor, deskLabel } from '../../../lib/stationVertical.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../../../roles.js';
import { PageHeader, Card, Table, Badge, Modal, Field, StatCard, AlertPopup, fmtCurrency } from '../../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../../datetime.js';
import ModuleGuide from '../../../components/ModuleGuide.jsx';
import { useStation, errOf } from './useStation.js';

const STATUS_TONE = {
  RAISED: 'PENDING', ACKNOWLEDGED: 'PENDING', UNDER_REVIEW: 'PENDING', INFO_REQUESTED: 'PENDING', ESCALATED: 'REJECTED',
  RESOLVED_ACCEPTED: 'ACTIVE', RESOLVED_REJECTED: 'DRAFT', CLOSED: 'DRAFT',
};
const STEP_LABEL = {
  ACKNOWLEDGED: 'Acknowledge', UNDER_REVIEW: 'Take up for review', INFO_REQUESTED: 'Ask for information',
  ESCALATED: 'Escalate', RESOLVED_ACCEPTED: 'Accept', RESOLVED_REJECTED: 'Reject', CLOSED: 'Close',
};

const OPEN_STATUSES = new Set(['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ESCALATED']);

const TABS = [
  { key: 'DISPUTES', label: 'Disputes' },
  { key: 'FYI', label: 'FYI — Reference Guide' },
];

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Date raised' },
  { value: 'disputed_amount', label: 'Amount' },
  { value: 'resolve_due', label: 'SLA due' },
  { value: 'status', label: 'Status' },
];

export default function HydroDisputes({ vertical = 'HYDRO' }) {
  const { user } = useAuth();
  const canWrite = writeRolesFor(vertical).includes(user?.role);
  const { stations, stationId, setStationId, beneficiaries } = useStation(vertical);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('OPEN');
  const [sort, setSort] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [reasons, setReasons] = useState([]);
  const [form, setForm] = useState(null);
  const [shares, setShares] = useState([]);
  const [selected, setSelected] = useState(null);
  const [move, setMove] = useState(null);
  const [popup, setPopup] = useState(null);
  const [tab, setTab] = useState('DISPUTES');
  const [stats, setStats] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [internalComment, setInternalComment] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);

  const load = useCallback(() => {
    if (!stationId) return;
    api.hydroDesk.disputes({ contract_id: stationId, status: filter || undefined }).then(setRows).catch((e) => setPopup({ tone: 'error', title: 'Disputes could not be loaded', message: errOf(e) }));
    api.hydroDesk.disputeStats({ contract_id: stationId }).then(setStats).catch(() => setStats(null));
  }, [stationId, filter]);
  useEffect(load, [load]);
  useEffect(() => { api.hydroDesk.disputeReasons().then(setReasons).catch(() => setReasons([])); }, []);
  useEffect(() => {
    if (!form?.beneficiary || !stationId) { setShares([]); return; }
    api.hydroDesk.disputeShares({ contract_id: stationId, beneficiary: form.beneficiary }).then(setShares).catch(() => setShares([]));
  }, [form?.beneficiary, stationId]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let va = a[sort], vb = b[sort];
      if (sort === 'disputed_amount') { va = Number(va) || 0; vb = Number(vb) || 0; }
      if (va < vb) return sortOrder === 'ASC' ? -1 : 1;
      if (va > vb) return sortOrder === 'ASC' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sort, sortOrder]);

  const open = rows.filter((r) => r.is_open);
  const overdue = rows.filter((r) => r.resolve_overdue || r.ack_overdue);

  async function openDetail(row) {
    const d = await api.hydroDesk.dispute(row.id);
    setSelected(d);
    setNewComment('');
    setInternalComment(false);
    api.hydroDesk.disputeComments(row.id).then(setComments).catch(() => setComments([]));
  }

  async function raise(e) {
    e.preventDefault();
    const problems = [];
    if (!form.ledger_doc_id) problems.push({ label: 'Bill', message: 'Choose the bill share being disputed.' });
    if (!(Number(form.disputed_amount) > 0)) problems.push({ label: 'Disputed amount', message: 'Enter the amount the beneficiary disputes.' });
    if (form.description.trim().length < 10) problems.push({ label: 'What is disputed', message: 'Describe the dispute in at least 10 characters.' });
    if (problems.length) { setPopup({ tone: 'error', title: 'The dispute cannot be recorded yet', items: problems }); return; }
    try {
      const d = await api.hydroDesk.raiseDispute({ ...form, disputed_amount: Number(form.disputed_amount) });
      setForm(null);
      load();
      setPopup({ tone: 'success', title: `${d.dispute_no} recorded`, message: `Acknowledge by ${fmtDate(d.ack_due)}; resolve by ${fmtDate(d.resolve_due)}.` });
    } catch (err) {
      setPopup({ tone: 'error', title: 'The dispute was not recorded', message: errOf(err) });
    }
  }

  async function doMove(e) {
    e.preventDefault();
    try {
      const d = await api.hydroDesk.moveDispute(move.dispute.id, { to: move.to, remarks: move.remarks, accepted_amount: move.accepted_amount });
      setMove(null);
      setSelected(d);
      load();
      if (d.status === 'RESOLVED_ACCEPTED') {
        setPopup({ tone: 'success', title: `${d.dispute_no} accepted`, message: `Credit note ${d.credit_note_no} for ${fmtCurrency(d.accepted_amount)} has been raised as a draft. It reaches the beneficiary's account once a second officer approves it in Debit / Credit Notes.` });
      }
    } catch (err) {
      setPopup({ tone: 'error', title: 'The dispute was not moved on', message: errOf(err) });
    }
  }

  async function postComment() {
    if (!newComment.trim() || !selected) return;
    setCommentBusy(true);
    try {
      const c = await api.hydroDesk.addDisputeComment(selected.id, newComment.trim(), internalComment);
      setComments((prev) => [...prev, c]);
      setNewComment('');
      setInternalComment(false);
    } catch (err) {
      setPopup({ tone: 'error', title: 'Comment could not be posted', message: errOf(err) });
    } finally {
      setCommentBusy(false);
    }
  }

  const vLabel = vertical === 'THERMAL' ? 'Thermal' : 'Hydro';

  return (
    <div>
      <PageHeader
        title="Dispute Management"
        subtitle={`Beneficiaries' disputes on issued ${vLabel.toLowerCase()} station bills — acknowledged within 2 days, resolved within 15, and settled by credit note when accepted`}
        actions={canWrite && <button className="btn btn-primary" disabled={!stationId} onClick={() => setForm({ beneficiary: beneficiaries[0] || '', ledger_doc_id: '', reason_code: 'REA_ENERGY_MISMATCH', disputed_amount: '', description: '', letter_ref: '', received_on: new Date().toISOString().slice(0, 10) })}>+ Record Dispute</button>}
      />

      <div className="nb-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'FYI' && (
        <ModuleGuide sections={[
          { title: 'Dispute lifecycle', body: `When a beneficiary disputes a bill share, record it here. The desk must acknowledge within 2 business days and resolve within 15 days of receipt. Accepting a dispute automatically raises a draft credit note for the accepted amount, which a second officer approves in Debit / Credit Notes. Rejecting records the reason and closes the dispute.` },
          { title: 'SLA tracking', body: 'Each dispute tracks its acknowledge-by and resolve-by dates. Disputes past SLA are flagged in red. The aging buckets on the dashboard (0-7 days, 8-15 days, 16-30 days, 30+ days) show how long open disputes have been pending.' },
          { title: 'Status workflow', body: 'RAISED → ACKNOWLEDGED → UNDER REVIEW → (INFO REQUESTED ↔) → ESCALATED → RESOLVED (Accepted/Rejected) → CLOSED. At each step, remarks are recorded and sent to the beneficiary.' },
          { title: 'Communication thread', body: 'Use the Comments section in each dispute to maintain a communication trail. Mark comments as "Internal only" to keep them visible only to the desk — they will not be shared with the beneficiary.' },
        ]} />
      )}

      {tab === 'DISPUTES' && (
        <>
          <div className="filters-bar">
            <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.station_name || s.contract_no}</option>)}
            </select>
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="OPEN">Open</option>
              <option value="">All</option>
              <option value="RESOLVED_ACCEPTED">Accepted</option>
              <option value="RESOLVED_REJECTED">Rejected</option>
              <option value="CLOSED">Closed</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSortOrder((o) => o === 'ASC' ? 'DESC' : 'ASC')} title={sortOrder === 'ASC' ? 'Ascending' : 'Descending'}>
              {sortOrder === 'ASC' ? '↑' : '↓'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 16 }}>
            <StatCard label="Open disputes" value={stats?.open ?? open.length} />
            <StatCard label="Amount under dispute" value={fmtCurrency(stats?.exposure ?? open.reduce((a, r) => a + r.disputed_amount, 0))} />
            <StatCard label="Past SLA" value={stats?.sla_breached ?? overdue.length} tone={(stats?.sla_breached ?? overdue.length) ? 'danger' : 'default'} />
            <StatCard label="Resolved" value={stats?.resolved ?? '—'} />
          </div>

          {stats?.aging && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              <StatCard label="0 – 7 days" value={stats.aging['0_7']} hint="Early stage" />
              <StatCard label="8 – 15 days" value={stats.aging['8_15']} hint="Within SLA" tone={stats.aging['8_15'] ? 'amber' : 'default'} />
              <StatCard label="16 – 30 days" value={stats.aging['16_30']} hint="Past SLA" tone={stats.aging['16_30'] ? 'danger' : 'default'} />
              <StatCard label="30+ days" value={stats.aging['30_plus']} hint="Overdue" tone={stats.aging['30_plus'] ? 'danger' : 'default'} />
            </div>
          )}

          {stats?.by_reason?.length > 0 && (
            <Card>
              <h4 style={{ margin: '0 0 8px' }}>Open disputes by reason</h4>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {stats.by_reason.map(({ code, count }) => {
                  const label = reasons.find((r) => r.value === code)?.label || code.replaceAll('_', ' ');
                  return <div key={code} style={{ padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13.5 }}><strong>{count}</strong> {label}</div>;
                })}
              </div>
            </Card>
          )}

          <Card>
            <Table
              onRowClick={openDetail}
              columns={[
                { key: 'dispute_no', header: 'Dispute no.', render: (r) => <strong>{r.dispute_no}</strong> },
                { key: 'beneficiary_name', header: 'Beneficiary' },
                { key: 'bill_no', header: 'Bill', render: (r) => `${r.bill_no} · ${r.billing_month}` },
                { key: 'reason', header: 'Reason', render: (r) => r.reason_label },
                { key: 'disputed_amount', header: 'Disputed', render: (r) => fmtCurrency(r.disputed_amount) },
                { key: 'status', header: 'Status', render: (r) => <Badge status={STATUS_TONE[r.status]} label={r.status.replaceAll('_', ' ')} /> },
                { key: 'sla', header: 'SLA', render: (r) => (r.ack_overdue ? <span style={{ color: '#b91c1c' }}>Acknowledge was due {fmtDate(r.ack_due)}</span>
                  : r.resolve_overdue ? <span style={{ color: '#b91c1c' }}>Resolution was due {fmtDate(r.resolve_due)}</span>
                    : r.is_open ? `Resolve by ${fmtDate(r.resolve_due)}` : '—') },
                { key: 'raised', header: 'Raised', render: (r) => fmtDate(r.created_at) },
              ]}
              rows={sorted}
              emptyMessage="No dispute on this station."
            />
          </Card>
        </>
      )}

      {/* ── Record dispute ── */}
      <Modal open={!!form} onClose={() => setForm(null)} title="Record a dispute" width={720}>
        {form && (
          <form onSubmit={raise} noValidate>
            <div className="form-grid">
              <Field label="Beneficiary" required>
                <select value={form.beneficiary} onChange={(e) => setForm({ ...form, beneficiary: e.target.value, ledger_doc_id: '' })}>
                  {beneficiaries.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Bill share disputed" required>
                <select value={form.ledger_doc_id} onChange={(e) => setForm({ ...form, ledger_doc_id: e.target.value })}>
                  <option value="">Select…</option>
                  {shares.map((s) => <option key={s.ledger_doc_id} value={s.ledger_doc_id}>{s.bill_no} · {s.billing_month} · {s.bill_kind} — {fmtCurrency(s.amount)}</option>)}
                </select>
              </Field>
              <Field label="Reason" required>
                <select value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })}>
                  {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Disputed amount (₹)" required>
                <input type="number" min="0.01" step="0.01" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
              </Field>
              <Field label="Received on" required>
                <input type="date" value={form.received_on} onChange={(e) => setForm({ ...form, received_on: e.target.value })} />
              </Field>
              <Field label="Beneficiary's letter reference">
                <input value={form.letter_ref} onChange={(e) => setForm({ ...form, letter_ref: e.target.value })} />
              </Field>
            </div>
            <Field label="What is disputed" required>
              <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. PAFM taken as 95.0% but the final REA certifies 92.4% for May 2026" />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Record dispute</button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Dispute detail ── */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.dispute_no} — ${selected.beneficiary_name}` : ''} width={800}>
        {selected && (
          <div>
            <table className="detail-table"><tbody>
              <tr><td>Bill</td><td>{selected.bill_no} · {selected.billing_month} · billed {fmtCurrency(selected.billed_amount)}</td></tr>
              <tr><td>Reason</td><td>{selected.reason_label}</td></tr>
              <tr><td>What is disputed</td><td>{selected.description}</td></tr>
              <tr><td>Disputed</td><td>{fmtCurrency(selected.disputed_amount)}{selected.accepted_amount != null ? ` · accepted ${fmtCurrency(selected.accepted_amount)}` : ''}</td></tr>
              <tr><td>Received</td><td>{fmtDate(selected.received_on)}{selected.letter_ref ? ` · ${selected.letter_ref}` : ''}</td></tr>
              <tr><td>Status</td><td><Badge status={STATUS_TONE[selected.status]} label={selected.status.replaceAll('_', ' ')} /></td></tr>
              <tr><td>Acknowledge by</td><td style={{ color: selected.ack_overdue ? '#b91c1c' : undefined, fontWeight: selected.ack_overdue ? 700 : undefined }}>{fmtDate(selected.ack_due)}{selected.ack_overdue ? ' — OVERDUE' : ''}</td></tr>
              <tr><td>Resolve by</td><td style={{ color: selected.resolve_overdue ? '#b91c1c' : undefined, fontWeight: selected.resolve_overdue ? 700 : undefined }}>{fmtDate(selected.resolve_due)}{selected.resolve_overdue ? ' — OVERDUE' : ''}</td></tr>
              {selected.resolution && <tr><td>Resolution</td><td>{selected.resolution}</td></tr>}
              {selected.credit_note_no && <tr><td>Credit note</td><td><Link to={pathFor(vertical, 'notes')}>{selected.credit_note_no}</Link> ({selected.credit_note_status})</td></tr>}
            </tbody></table>

            <h4 style={{ margin: '18px 0 8px' }}>History</h4>
            <Table
              columns={[
                { key: 'created_at', header: 'When', render: (e) => fmtDate(e.created_at) },
                { key: 'to_status', header: 'Step', render: (e) => e.to_status.replaceAll('_', ' ') },
                { key: 'actor', header: 'By' },
                { key: 'remarks', header: 'Remarks' },
              ]}
              rows={selected.events || []}
            />

            <h4 style={{ margin: '18px 0 8px' }}>Communication thread</h4>
            {comments.length === 0 && <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>No comments yet.</p>}
            {comments.map((c) => (
              <div key={c.id} style={{ padding: '8px 12px', marginBottom: 6, background: c.is_internal ? 'var(--amber-50, #fffbeb)' : 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span><strong>{c.author_name}</strong></span>
                  <span>{fmtDateTime(c.created_at)}{c.is_internal ? ' · Internal' : ''}</span>
                </div>
                <div style={{ fontSize: 14 }}>{c.body}</div>
              </div>
            ))}
            {canWrite && (
              <div style={{ marginTop: 10 }}>
                <textarea rows={2} value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Add a comment…" style={{ width: '100%', resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={internalComment} onChange={(e) => setInternalComment(e.target.checked)} />
                    Internal only
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" disabled={!newComment.trim() || commentBusy} onClick={postComment}>
                    {commentBusy ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
              </div>
            )}

            {canWrite && selected.allowed_next.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                {selected.allowed_next.map((to) => (
                  <button key={to} type="button" className={to === 'RESOLVED_REJECTED' ? 'btn btn-danger' : to === 'RESOLVED_ACCEPTED' ? 'btn btn-primary' : 'btn btn-outline'}
                    onClick={() => setMove({ dispute: selected, to, remarks: '', accepted_amount: selected.disputed_amount })}>
                    {STEP_LABEL[to] || to}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Move dispute ── */}
      <Modal open={!!move} onClose={() => setMove(null)} title={move ? `${STEP_LABEL[move.to]} — ${move.dispute.dispute_no}` : ''} width={540}>
        {move && (
          <form onSubmit={doMove}>
            {move.to === 'RESOLVED_ACCEPTED' && (
              <Field label="Amount accepted (₹)" required>
                <input type="number" min="0.01" step="0.01" max={move.dispute.disputed_amount} value={move.accepted_amount} onChange={(e) => setMove({ ...move, accepted_amount: e.target.value })} />
              </Field>
            )}
            <Field label="Remarks (sent to the beneficiary)">
              <textarea rows={3} value={move.remarks} onChange={(e) => setMove({ ...move, remarks: e.target.value })} />
            </Field>
            {move.to === 'RESOLVED_ACCEPTED' && <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>A draft credit note for the accepted amount is raised against the bill.</p>}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMove(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">{STEP_LABEL[move.to]}</button>
            </div>
          </form>
        )}
      </Modal>

      <AlertPopup open={!!popup} tone={popup?.tone} title={popup?.title} message={popup?.message} items={popup?.items} onClose={() => setPopup(null)} />
    </div>
  );
}
