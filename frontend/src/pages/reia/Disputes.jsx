import React, { useEffect, useRef, useState } from 'react';
import DisputeExtrasPanel, { SlaTag } from '../../components/DisputeExtrasPanel.jsx';
import ForumTrackerPanel from '../../components/ForumTrackerPanel.jsx';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, fmtCurrency } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';
import {
  REASON_CODES, CHARGE_LINES, DISPUTE_STATUSES, OPEN_STATUSES,
  reasonLabel, chargeLabel, invoiceChargeBreakdown,
} from '../../disputesMeta.js';
import { ROLE_GROUPS } from '../../roles.js';

// The server's REIA_WRITE group; a shorter copy here hid the buttons from REIA_CHECKER.
const CAN_WRITE = ROLE_GROUPS.REIA_WRITE;
const CAN_RAISE = ['SELLER', 'BUYER', ...ROLE_GROUPS.REIA_WRITE];

const EMPTY_FORM = {
  invoice_id: '', reason_code: '', charge_line: 'energy_charges',
  issue_description: '', disputed_amount: '',
};
// A dispute is raised on a bill that has been approved, and for the party the
// bill is with — its seller or its buyer — which the bill itself decides.
const DISPUTABLE = ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED', 'PAID'];
const partyOf = (inv) => (inv?.direction === 'SELLER_TO_SJVN' ? 'SELLER' : 'BUYER');
const errOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;
const RESOLVE_FORM = { outcome: 'PARTIAL_CREDIT', accepted_amount: '', resolution_notes: '', lps_on_resolution: '' };

function StatPill({ label, value, sub }) {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, minWidth: 120 }}>
      <div style={{ fontSize: 13, textTransform: 'none', letterSpacing: 0.4, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--text)' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
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
  const [pdfLoading, setPdfLoading] = useState(false);

  async function downloadDisputePdf() {
    setPdfLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      await api.reports.disputeSummaryPdf(params);
    } catch (err) {
      setActionError(err.message || 'The dispute report could not be downloaded.');
    } finally {
      setPdfLoading(false);
    }
  }
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [resolveForm, setResolveForm] = useState(RESOLVE_FORM);
  const [comment, setComment] = useState('');
  const [internalComment, setInternalComment] = useState(false);
  const [infoNote, setInfoNote] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  // What the server said when it refused something on the open dispute, and
  // which request is in flight so a second click cannot repeat it.
  const [actionError, setActionError] = useState('');
  const [busy, setBusyState] = useState('');
  // The lock stops a second click that lands before the next render; state alone does not.
  const lock = useRef('');
  const setBusy = (what) => { lock.current = what; setBusyState(what); };

  const selectedInvoice = invoices.find((i) => i.id === form.invoice_id);
  const breakdown = invoiceChargeBreakdown(selectedInvoice);

  const [clock, setClock] = useState({});
  const [desk, setDesk] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);

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
      // Each dispute's clock, whose move it is and the surcharge running on it.
      Promise.resolve(api.disputeExtras?.overview?.()).then((o) => {
        if (!o) return;
        setClock(Object.fromEntries(o.disputes.map((d) => [d.id, d])));
        setDesk(o.totals);
      }).catch(() => {});
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
    setActionError('');
    setEvidenceError('');
    setInternalComment(false);
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

  function openCreate() {
    setForm(EMPTY_FORM);
    setError('');
    setShowCreate(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy('create');
    try {
      await api.disputes.create({
        ...form,
        raised_by_role: partyOf(selectedInvoice),
        disputed_amount: Number(form.disputed_amount),
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(errOf(err, 'Failed to raise dispute.'));
    } finally {
      setBusy('');
    }
  }

  // Everything done to the open dispute goes through here, so a refusal is
  // shown in the dispute. These awaited their calls bare: the server refused,
  // the promise rejected unhandled and the screen sat as it was.
  async function onDispute(key, call, fallback) {
    if (lock.current) return false;
    setActionError('');
    setBusy(key);
    try {
      await call();
      return true;
    } catch (err) {
      setActionError(errOf(err, fallback));
      return false;
    } finally {
      setBusy('');
    }
  }

  async function handleTransition(status, note) {
    if (await onDispute(`to-${status}`, () => api.disputes.transition(selectedId, status, note), 'The dispute could not be moved on.')) await refreshDetail();
  }

  async function handleResolve(e) {
    e.preventDefault();
    const ok = await onDispute('resolve', () => api.disputes.resolve(selectedId, {
      outcome: resolveForm.outcome,
      accepted_amount: resolveForm.outcome === 'PARTIAL_CREDIT' ? Number(resolveForm.accepted_amount) : undefined,
      resolution_notes: resolveForm.resolution_notes,
      lps_on_resolution: resolveForm.lps_on_resolution ? Number(resolveForm.lps_on_resolution) : 0,
    }), 'The resolution could not be recorded.');
    if (!ok) return;
    setResolveForm(RESOLVE_FORM);
    // The dispute stays open on screen: what was decided, and what the
    // submitter now has to answer, are the next things to read.
    await refreshDetail();
  }

  async function handleComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    if (await onDispute('comment', () => api.disputes.comment(selectedId, comment, internalComment), 'The comment could not be posted.')) {
      setComment('');
      await refreshDetail();
    }
  }

  async function handleAssign(assigned_to) {
    if (await onDispute('assign', () => api.disputes.assign(selectedId, assigned_to || null), 'The dispute could not be assigned.')) await refreshDetail();
  }

  async function handleEvidence(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEvidenceBusy(true);
    setEvidenceError('');
    try {
      await api.disputes.uploadEvidence(selectedId, file);
      await refreshDetail();
    } catch (err) {
      setEvidenceError(err.response?.data?.error || 'Could not upload the document.');
    } finally {
      e.target.value = '';
      setEvidenceBusy(false);
    }
  }

  async function viewEvidence(doc) {
    setEvidenceError('');
    try {
      const blob = await api.disputes.downloadEvidence(selectedId, doc.filename);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setEvidenceError(err.response?.status === 404 ? 'That file is no longer on the server.' : 'Could not open the document.');
    }
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
    { key: 'sla', header: 'Clock', render: (r) => (clock[r.id] ? <SlaTag sla={clock[r.id].sla} sjvn /> : (r.sla_breached || r.status === 'ESCALATED' ? <Badge status="ESCALATED" /> : 'OK')) },
    { key: 'lps', header: 'LPS at stake', render: (r) => (clock[r.id]?.lps_estimate?.amount > 0 ? <span style={{ color: clock[r.id].lps_estimate.running ? 'var(--amber-strong)' : 'inherit' }}>{fmtCurrency(clock[r.id].lps_estimate.amount)}</span> : '—') },
    { key: 'group', header: 'Linked', render: (r) => { const g = clock[r.id]?.group || (r.group_ref ? { ref: r.group_ref, title: r.group_title } : null); return g?.ref ? <span title={g.title || ''} style={{ fontSize: 13.5 }}>{g.ref}</span> : '—'; } },
  ];

  return (
    <div>
      <PageHeader
        title="Dispute Management"
        subtitle="Financial control — partial disputes, SLA, settlement & root-cause patterns"
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={pdfLoading} onClick={downloadDisputePdf}>
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
            </button>
            {CAN_RAISE.includes(user?.role) && (
              <button className="btn btn-secondary" onClick={openCreate}>+ Raise Dispute</button>
            )}
          </div>
        }
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

      {desk && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <button type="button" onClick={() => setMineOnly((v) => !v)} style={{ border: mineOnly ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: 10, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} aria-pressed={mineOnly}>
            <StatPill label="Waiting on SJVN" value={desk.awaiting_me} sub={mineOnly ? 'Showing only these' : 'Click to show only these'} />
          </button>
          <StatPill label="Past the time limit" value={desk.breached} sub="The counterparty sees the overrun" />
          <StatPill label="Escalated by the counterparty" value={desk.contested} sub="Outcome to be recorded" />
          <StatPill label="LPS running on open amounts" value={fmtCurrency(desk.lps_running)} sub={desk.lps_per_day > 0 ? `Growing ${fmtCurrency(desk.lps_per_day)} a day` : undefined} />
        </div>
      )}

      <ForumTrackerPanel canWrite={ROLE_GROUPS.REIA_WRITE.includes(user?.role)} />

      {stats?.by_reason?.length > 0 && (
        <Card title="Category patterns (root-cause)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {stats.by_reason.slice(0, 8).map((r) => (
              <button
                key={r.reason_code}
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 13.5 }}
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
        <select value={filters.order} onChange={(e) => setFilters({ ...filters, order: e.target.value })} aria-label="Order">
          <option value="DESC">Desc</option>
          <option value="ASC">Asc</option>
        </select>
        {(filters.status || filters.reason_code || filters.aging || mineOnly) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFilters({ ...filters, status: '', reason_code: '', aging: '' }); setMineOnly(false); }}>Clear filters</button>
        )}
      </div>

      <Card>
        <Table
          columns={columns}
          rows={loading ? [] : rows.filter((r) => !mineOnly || clock[r.id]?.awaiting_me)}
          onRowClick={openDetail}
          emptyMessage={loading ? 'Loading...' : mineOnly ? 'Nothing is waiting on SJVN.' : 'No disputes found.'}
        />
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Raise Dispute" width={620}>
        <form onSubmit={handleCreate}>
          <Field label="Invoice">
            <select required value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
              <option value="">Select invoice...</option>
              {invoices.filter((i) => DISPUTABLE.includes(i.status) && !i.is_dispute_credit && Number(i.total_amount) > 0).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_no} — {i.direction === 'SELLER_TO_SJVN' ? 'seller’s bill' : 'bill on the buyer'} — {fmtCurrency(i.total_amount)} (in dispute {fmtCurrency(i.disputed_amount || 0)} | left to pay {fmtCurrency(i.balance_due ?? i.payable_now ?? i.total_amount - (i.disputed_amount || 0))})
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
                In dispute: {fmtCurrency(selectedInvoice.disputed_amount || 0)} | Left to pay: {fmtCurrency(selectedInvoice.balance_due ?? selectedInvoice.payable_now ?? (selectedInvoice.total_amount - (selectedInvoice.disputed_amount || 0)))}
              </div>
            </div>
          )}
          <div className="form-grid">
            <Field label="Raised for">
              {/* Not a choice: the dispute on a seller's invoice is the seller's, on a bill to a buyer the buyer's. */}
              <input disabled value={selectedInvoice ? (partyOf(selectedInvoice) === 'SELLER' ? 'Seller (its invoice to SJVN)' : 'Buyer (SJVN’s bill on it)') : 'Follows the bill chosen'} />
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
            <input required type="number" min="0.01" step="any" value={form.disputed_amount} onChange={(e) => setForm({ ...form, disputed_amount: e.target.value })} />
            <p className="inline-note" style={{ marginTop: 4 }}>Undisputed balance remains payable by due date.</p>
          </Field>
          <Field label="Description">
            <textarea required={form.reason_code === 'OTHER'} value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy === 'create'}>{busy === 'create' ? 'Raising…' : 'Submit Dispute'}</button>
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
              <div className="detail-item"><span className="detail-label">Left to pay on the bill</span><span className="detail-value">{fmtCurrency(detail.invoice?.balance_due ?? detail.invoice?.payable_now)}</span></div>
              <div className="detail-item"><span className="detail-label">Raised by</span><span className="detail-value">{detail.raised_by_role === 'SELLER' ? detail.invoice?.seller_name : detail.invoice?.buyer_name} ({String(detail.raised_by_role || '').toLowerCase()})</span></div>
              <div className="detail-item"><span className="detail-label">Age / SLA resolve</span><span className="detail-value">{detail.ageing_days}d / {detail.sla_resolve_due?.slice(0, 10) || '—'}</span></div>
              <div className="detail-item"><span className="detail-label">Assignee</span><span className="detail-value">{detail.assignee?.name || 'Unassigned'}</span></div>
            </div>
            <p style={{ marginTop: 12 }}>{detail.issue_description}</p>
            {/* The clock, the surcharge at stake, the submitter's answer to the resolution, linked disputes and the dossier. */}
            <DisputeExtrasPanel key={`${detail.id}-${detail.updated_at}`} disputeId={detail.id} onChanged={refreshDetail} />

            {detail.resolution_notes && (
              <div className="inline-note"><strong>Resolution ({String(detail.resolution_outcome || '').replace(/_/g, ' ').toLowerCase()}):</strong> {detail.resolution_notes}
                {detail.credit_amount > 0 && (detail.invoice?.direction === 'SELLER_TO_SJVN'
                  ? <> — SJVN pays the seller {fmtCurrency(detail.credit_amount)} more ({fmtCurrency(detail.before_total)} → {fmtCurrency(detail.after_total)})</>
                  : <> — {fmtCurrency(detail.credit_amount)} off what the buyer owes ({fmtCurrency(detail.before_total)} → {fmtCurrency(detail.after_total)})</>)}
              </div>
            )}
            {detail.resolution_note && (
              <div className="inline-note">
                {detail.resolution_note.note_type === 'DEBIT' ? 'Debit' : 'Credit'} note {detail.resolution_note.status === 'DRAFT' ? '(draft)' : detail.resolution_note.note_no} for {fmtCurrency(detail.resolution_note.amount)} —{' '}
                {detail.resolution_note.status === 'DRAFT'
                  ? 'awaiting approval by someone other than the resolver (Notes desk). The bill as issued is unchanged.'
                  : `${detail.resolution_note.status.toLowerCase()}${detail.resolution_note.approved_by ? ` by ${detail.resolution_note.approved_by}` : ''}.`}
              </div>
            )}
            {detail.supplementary_invoice && (
              <div className="inline-note">Supplementary: {detail.supplementary_invoice.invoice_no} ({fmtCurrency(detail.supplementary_invoice.total_amount)})</div>
            )}


            {CAN_WRITE.includes(user?.role) && OPEN_STATUSES.includes(detail.status) && (
              <div className="form-actions" style={{ flexWrap: 'wrap' }}>
                {/* Acknowledging is the desk's act, so the 2-day SLA runs on a person (17-Oct-2026). */}
                {detail.status === 'RAISED' && (
                  <button type="button" className="btn btn-primary" onClick={() => handleTransition('ACKNOWLEDGED')}>Acknowledge</button>
                )}
                {['RAISED', 'ACKNOWLEDGED'].includes(detail.status) && (
                  <button type="button" className="btn btn-secondary" onClick={() => handleTransition('UNDER_REVIEW')}>Start Review</button>
                )}
                {['RAISED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'ESCALATED'].includes(detail.status) && (
                  // What is wanted, in the officer's own words — a blank request used
                  // to go out as a stock line in their name.
                  <button type="button" className="btn btn-ghost" disabled={infoNote.trim().length < 10} title={infoNote.trim().length < 10 ? 'Write what information is needed first' : undefined} onClick={() => handleTransition('INFO_REQUESTED', infoNote.trim())}>Request Info</button>
                )}
                {detail.status === 'INFO_REQUESTED' && (
                  <button type="button" className="btn btn-secondary" onClick={() => handleTransition('UNDER_REVIEW')}>Resume Review</button>
                )}
                <input type="text" placeholder="What information is needed (needed to request it)" value={infoNote} onChange={(e) => setInfoNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                {detail.assigned_to !== user?.id && <button type="button" className="btn btn-ghost" onClick={() => handleAssign(user.id)}>Assign to me</button>}
              </div>
            )}

            {CAN_WRITE.includes(user?.role) && ['RAISED', 'UNDER_REVIEW', 'ESCALATED', 'ACKNOWLEDGED', 'INFO_REQUESTED'].includes(detail.status) && (
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
                    <Field label={`Amount accepted (₹) — up to ${fmtCurrency(detail.disputed_amount)}`}>
                      <input required type="number" min="0.01" step="any" max={detail.disputed_amount} value={resolveForm.accepted_amount} onChange={(e) => setResolveForm({ ...resolveForm, accepted_amount: e.target.value })} />
                    </Field>
                  )}
                  <Field label="Resolution reasoning (shown to parties)">
                    <textarea required value={resolveForm.resolution_notes} onChange={(e) => setResolveForm({ ...resolveForm, resolution_notes: e.target.value })} />
                  </Field>
                  <Field label="LPS / interest on settlement (₹)">
                    <input type="number" min="0" step="any" value={resolveForm.lps_on_resolution} onChange={(e) => setResolveForm({ ...resolveForm, lps_on_resolution: e.target.value })} />
                    {detail.refund_interest_guidance?.amount > 0 && resolveForm.outcome !== 'REJECTED' && (
                      <div className="inline-note" style={{ marginTop: 4 }}>
                        Art. 6.7.3 — refund interest at LPS rate ({detail.refund_interest_guidance.lps_annual_pct}% p.a. × {detail.refund_interest_guidance.days}d): <strong>₹{detail.refund_interest_guidance.amount.toLocaleString('en-IN')}</strong>
                        {' '}<button type="button" className="link-btn" onClick={() => setResolveForm((f) => ({ ...f, lps_on_resolution: String(detail.refund_interest_guidance.amount) }))}>use this</button>
                      </div>
                    )}
                  </Field>
                  {resolveForm.outcome !== 'REJECTED' && (
                    <p className="inline-note">
                      An accepted amount becomes a {detail.invoice?.direction === 'SELLER_TO_SJVN' ? 'debit note (SJVN pays the seller more)' : 'credit note against the bill'}, raised as a draft for someone else to approve. The bill as issued is not changed.
                    </p>
                  )}
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={!!busy}>{busy === 'resolve' ? 'Recording…' : 'Confirm Resolution'}</button>
                  </div>
                </form>
              </>
            )}

            {CAN_WRITE.includes(user?.role) && ['RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'].includes(detail.status) && detail.resolution_response !== 'CONTESTED' && (() => {
              // The party answers a resolution first; the desk closes it after
              // that, or once the answer window has run out.
              const windowDays = detail.response_window_days ?? 15;
              const waited = detail.resolved_at ? Math.floor((Date.now() - new Date(`${String(detail.resolved_at).replace(' ', 'T')}Z`).getTime()) / 86400000) : 0;
              const noteWaiting = detail.resolution_note?.status === 'DRAFT';
              const canClose = !noteWaiting && (detail.resolution_response || waited >= windowDays);
              return canClose ? (
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => handleTransition('CLOSED')}>Close Dispute</button>
                </div>
              ) : (
                <p className="inline-note">
                  {noteWaiting ? 'Closes once its note is approved. ' : ''}
                  {!detail.resolution_response ? `The ${String(detail.raised_by_role || '').toLowerCase()} has ${Math.max(0, windowDays - waited)} more day(s) to accept or contest this resolution; it can be closed after that.` : ''}
                </p>
              );
            })()}

            {/* This dispute's own evidence, not the platform document store: the
                generic manager listed every document on the platform here, and
                what was uploaded through it was never tied to the dispute. */}
            <div className="card" style={{ marginTop: 24, marginBottom: 24 }}>
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <h3 style={{ margin: 0 }}>Dispute Evidence &amp; Resolution Notes</h3>
                <label className="btn btn-primary btn-sm" style={{ margin: 0, cursor: evidenceBusy ? 'wait' : 'pointer', flexShrink: 0 }}>
                  {evidenceBusy ? 'Uploading…' : 'Upload Document'}
                  <input type="file" onChange={handleEvidence} disabled={evidenceBusy} hidden />
                </label>
              </div>
              <div className="table-wrap">
                <table className="data-table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th scope="col">Document</th>
                      <th scope="col">Uploaded by</th>
                      <th scope="col">Uploaded</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {!(detail.supporting_docs || []).length && (
                      <tr><td colSpan={4} className="empty-cell">No documents uploaded for this dispute yet.</td></tr>
                    )}
                    {(detail.supporting_docs || []).map((d) => (
                      <tr key={d.filename}>
                        <td style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          <strong>{d.original_name || d.filename}</strong>
                          {d.note && <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 2 }}>{d.note}</div>}
                        </td>
                        <td>{d.uploaded_by || '—'}</td>
                        <td>{fmtDate(d.uploaded_at)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewEvidence(d)}>View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="section-title" style={{ marginTop: 18 }}>Communication thread</div>
            <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border, var(--border))', borderRadius: 8, padding: 10, marginBottom: 10 }}>
              {(detail.comments || []).map((c) => (
                <div key={c.id} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 13.5, opacity: 0.7 }}>
                    {c.user_name} ({c.role}) · {fmtDateTime(c.created_at)}
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
              {/* Disabled until there is something to post: pressed with an empty
                  comment it used to do nothing and say nothing. */}
              <button type="submit" className="btn btn-secondary" disabled={!comment.trim() || busy === 'comment'}>Post</button>
            </form>

            <div className="section-title" style={{ marginTop: 18 }}>Audit trail</div>
            <ul style={{ paddingLeft: 18, fontSize: 13 }}>
              {(detail.events || []).map((ev) => (
                <li key={ev.id}>
                  {fmtDateTime(ev.created_at)} — {String(ev.event_type || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}
                  {ev.from_status && ev.from_status !== ev.to_status ? ` (${ev.from_status.replace(/_/g, ' ').toLowerCase()} → ${String(ev.to_status).replace(/_/g, ' ').toLowerCase()})` : ''} by {ev.actor_name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
      {/* Refusals as a popup (house rule). */}
      <AlertPopup
        open={!!(error || actionError || evidenceError)}
        title={error ? 'Dispute not raised' : evidenceError ? 'Evidence not filed' : 'Not done'}
        message={error || actionError || evidenceError}
        onClose={() => { setError(''); setActionError(''); setEvidenceError(''); }}
      />
    </div>
  );
}
