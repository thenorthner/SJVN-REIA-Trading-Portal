import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client.js';
import { PageHeader, Card, StatCard, Table, Badge, Modal, Field, AlertPopup, fmtCurrency } from '../../components/ui.jsx';
import DisputeExtrasPanel, { SlaTag } from '../../components/DisputeExtrasPanel.jsx';
import { REASON_CODES, CHARGE_LINES, OPEN_STATUSES, reasonLabel, chargeLabel, invoiceChargeBreakdown } from '../../disputesMeta.js';
import { fmtDate, fmtDateTime } from '../../datetime.js';

const EMPTY = { reason_code: '', charge_line: 'energy_charges', issue_description: '', group_title: '' };
const VIEWS = [['ALL', 'All'], ['MINE', 'Waiting on you'], ['OPEN', 'Open'], ['RESOLVED', 'Resolved'], ['CLOSED', 'Closed']];
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportCsv(rows) {
  const head = ['Dispute', 'Group', 'Invoice', 'Period', 'Contract', 'Category', 'Charge line', 'Amount', 'Accepted', 'Status', 'Raised', 'Clock', 'LPS estimate'];
  const lines = rows.map((r) => [r.dispute_no, r.group?.ref || '', r.invoice_no, r.billing_period, r.contract_no, reasonLabel(r.reason_code), chargeLabel(r.charge_line),
    r.disputed_amount, r.accepted_amount || 0, r.status, r.created_at, r.sla.label, r.lps_estimate.amount].map(csvCell).join(','));
  const url = URL.createObjectURL(new Blob([`${head.map(csvCell).join(',')}\n${lines.join('\n')}\n`], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `disputes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A counterparty's disputes: raise one on a bill — or on several bills for the
 * same cause — follow SJVN's clock on it, answer the resolution, and take the
 * whole file away as a dossier.
 */
export default function MyDisputes({ role, direction }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState([]);
  const [view, setView] = useState('ALL');
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [picked, setPicked] = useState({});   // invoice id → amount
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusyState] = useState(false);
  // A second click on Submit before the first has gone raised the dispute twice.
  const lock = useRef(false);
  const setBusy = (on) => { lock.current = on; setBusyState(on); };
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');
  const [detailError, setDetailError] = useState('');
  const [pageError, setPageError] = useState('');
  const errOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

  function load() {
    setLoading(true);
    api.disputeExtras.overview().then((r) => { setRows(r.disputes); setTotals(r.totals); }).finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    // Bills SJVN has approved: there is nothing of SJVN's to dispute on a bill before that.
    api.invoices.list({ direction }).then((list) => setInvoices(list.filter((i) => ['APPROVED', 'SENT', 'PARTIALLY_PAID', 'DISPUTED', 'PAID'].includes(i.status) && !i.is_dispute_credit && Number(i.total_amount) > 0))).catch(() => {});
  }, [direction]);

  // Arriving with ?invoice=… from another screen: open the form on that bill, filled in.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const invoiceId = p.get('invoice');
    if (!invoiceId || !invoices.some((i) => i.id === invoiceId)) return;
    setForm({ ...EMPTY, reason_code: p.get('reason') || '', issue_description: p.get('note') || '' });
    setPicked({ [invoiceId]: p.get('amount') || '' });
    setError('');
    setShowCreate(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, [invoices]);

  const chosen = invoices.filter((i) => picked[i.id] !== undefined);
  const total = chosen.reduce((s, i) => s + (Number(picked[i.id]) || 0), 0);

  async function handleCreate(e) {
    e.preventDefault();
    if (lock.current) return;
    setError('');
    if (!chosen.length) { setError('Choose at least one invoice.'); return; }
    if (chosen.some((i) => !(Number(picked[i.id]) > 0))) { setError('Give the amount disputed on each invoice chosen.'); return; }
    if (form.reason_code === 'OTHER' && !form.issue_description.trim()) { setError('Description is mandatory for Other'); return; }
    if (chosen.length > 1 && !form.group_title.trim()) { setError('Give the linked disputes a title — what they have in common.'); return; }
    setBusy(true);
    // One dispute per bill, each holding its own amount on that bill, linked
    // under one reference — all of them or none. Raised one after another, a
    // refusal on one bill left the others raised and holding money, unlinked.
    const common = { raised_by_role: role, reason_code: form.reason_code, charge_line: form.charge_line, issue_description: form.issue_description };
    let made;
    try {
      made = chosen.length > 1
        ? (await api.disputes.raiseBatch({ ...common, group_title: form.group_title.trim(), items: chosen.map((i) => ({ invoice_id: i.id, disputed_amount: Number(picked[i.id]) })) })).disputes
        : [await api.disputes.create({ ...common, invoice_id: chosen[0].id, disputed_amount: Number(picked[chosen[0].id]) })];
    } catch (err) {
      setBusy(false);
      setError(errOf(err, 'The dispute could not be raised.'));
      return;
    }
    const unfiled = [];
    if (evidenceFile) {
      for (const d of made) {
        try { await api.disputes.uploadEvidence(d.id, evidenceFile); } catch (err) { unfiled.push(`${d.dispute_no}: ${errOf(err, 'not filed')}`); }
      }
    }
    setBusy(false);
    load();
    setNotice(made.length > 1 ? `${made.length} disputes raised and linked.` : `Dispute ${made[0].dispute_no} raised.`);
    if (unfiled.length) setPageError(`Raised, but the evidence was not filed — ${unfiled.join('; ')}. Add it from the dispute.`);
    setShowCreate(false);
    setForm(EMPTY);
    setPicked({});
    setEvidenceFile(null);
  }

  // A refusal is shown in the dispute it was about. A file SJVN could not
  // read, or a message that did not go, used to fail without a word.
  async function openDetail(row) {
    setDetailError('');
    setPageError('');
    setComment('');
    try {
      setDetail(await api.disputes.get(row.id));
    } catch (err) {
      setPageError(errOf(err, 'The dispute could not be opened.'));
    }
  }
  async function refreshDetail() {
    if (detail) setDetail(await api.disputes.get(detail.id));
    load();
  }
  async function postComment(e) {
    e.preventDefault();
    if (!comment.trim()) return;
    setDetailError('');
    try {
      await api.disputes.comment(detail.id, comment, false);
      setComment('');
      refreshDetail();
    } catch (err) {
      setDetailError(errOf(err, 'The message could not be sent.'));
    }
  }
  async function uploadEvidence(e) {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    setDetailError('');
    try {
      await api.disputes.uploadEvidence(detail.id, file);
      refreshDetail();
    } catch (err) {
      setDetailError(errOf(err, 'The file could not be added.'));
    } finally {
      e.target.value = '';
    }
  }
  async function downloadEvidence(d) {
    setDetailError('');
    try {
      const blob = await api.disputes.downloadEvidence(detail.id, d.filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.original_name || d.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setDetailError(err?.response?.status === 404 ? 'That file is no longer on the server.' : 'The file could not be downloaded.');
    }
  }

  const text = q.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((r) => {
    if (view === 'MINE' && !r.awaiting_me) return false;
    if (view === 'OPEN' && !OPEN_STATUSES.includes(r.status)) return false;
    if (view === 'RESOLVED' && !r.status.startsWith('RESOLVED')) return false;
    if (view === 'CLOSED' && r.status !== 'CLOSED') return false;
    return !text || `${r.dispute_no} ${r.invoice_no} ${r.contract_no} ${r.group?.ref || ''} ${r.group?.title || ''} ${reasonLabel(r.reason_code)}`.toLowerCase().includes(text);
  }), [rows, view, text]);

  const columns = [
    { key: 'dispute_no', header: 'Dispute ID', render: (r) => <span>{r.dispute_no}{r.group && <div style={{ fontSize: 14.5, color: 'var(--slate-500)' }} title={r.group.title}>{r.group.ref} · {r.group.disputes.length} bills</div>}</span> },
    { key: 'invoice_no', header: 'Invoice' },
    { key: 'reason_code', header: 'Category', render: (r) => reasonLabel(r.reason_code) },
    { key: 'disputed_amount', header: 'Amount', render: (r) => fmtCurrency(r.disputed_amount) },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'sla', header: 'Clock', render: (r) => <SlaTag sla={r.sla} /> },
    { key: 'lps', header: 'LPS at stake', render: (r) => (r.lps_estimate.amount > 0 ? <span style={{ color: r.lps_estimate.running ? 'var(--amber-strong)' : 'inherit', fontWeight: 600 }}>{fmtCurrency(r.lps_estimate.amount)}</span> : '—') },
    { key: 'created_at', header: 'Raised', render: (r) => fmtDate(r.created_at) },
  ];
  const breakdownOf = (inv) => invoiceChargeBreakdown(inv);

  return (
    <div>
      <PageHeader
        title="My Disputes"
        subtitle="Disputes on your bills — SJVN's time to answer, the surcharge at stake, your answer to the resolution, and the file as a dossier"
        actions={(
          <>
            <button className="btn btn-secondary" disabled={!shown.length} onClick={() => exportCsv(shown)}>Export CSV</button>
            <button className="btn btn-danger" onClick={() => { setForm(EMPTY); setPicked({}); setError(''); setShowCreate(true); }}>+ Raise Dispute</button>
          </>
        )}
      />

      {notice && <div className="alert alert-success" role="status">{notice}</div>}


      {totals && (
        <div className="kpi-grid">
          <StatCard label="Open disputes" value={totals.open} hint={fmtCurrency(totals.open_amount)} tone={totals.open ? 'amber' : 'green'} />
          <StatCard label="Waiting on you" value={totals.awaiting_me} tone={totals.awaiting_me ? 'red' : 'green'} hint="A reply or an answer to a resolution" onClick={totals.awaiting_me ? () => setView('MINE') : undefined} />
          <StatCard label="Past SJVN's time limit" value={totals.breached} tone={totals.breached ? 'red' : 'green'} hint="Escalated within SJVN" />
          <StatCard label="Escalated by you" value={totals.contested} />
          <StatCard label="LPS at stake" value={fmtCurrency(totals.lps_running)} hint={totals.lps_per_day > 0 ? `Growing ${fmtCurrency(totals.lps_per_day)} a day` : 'On amounts still in question'} />
        </div>
      )}

      <div className="nb-toolbar">
        <input type="search" placeholder="Search dispute, invoice or group…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search disputes" />
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" className={`nb-chip ${view === k ? 'active' : ''}`} aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : shown} onRowClick={openDetail} emptyMessage={loading ? 'Loading...' : rows.length ? 'No disputes match.' : 'No disputes raised.'} />
      </Card>

      <Modal open={showCreate} onClose={() => !busy && setShowCreate(false)} title="Raise a Dispute" width={720}>

        <form onSubmit={handleCreate}>
          <div className="field">
            <span className="field-label">Invoices — tick every bill this dispute is about</span>
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              {!invoices.length && <div style={{ padding: 12, fontSize: 14.5, color: 'var(--slate-500)' }}>No bills to dispute.</div>}
              {invoices.map((i) => {
                const on = picked[i.id] !== undefined;
                return (
                  <label key={i.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr minmax(190px, 230px)', gap: 10, alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid var(--slate-100)', fontSize: 14.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={on} onChange={() => { setError(''); setPicked((p) => { const n = { ...p }; if (on) delete n[i.id]; else n[i.id] = ''; return n; }); }} />
                    <span>
                      <strong>{i.invoice_no}</strong> · {i.billing_period} · {fmtCurrency(i.total_amount)}
                      {on && <div style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>{chargeLabel(form.charge_line)} on this bill: {fmtCurrency(breakdownOf(i)[form.charge_line] || 0)}</div>}
                    </span>
                    {on && <input type="number" min="0.01" step="any" required placeholder="₹ in dispute" value={picked[i.id]} onClick={(e) => e.preventDefault()} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.value })} aria-label={`Amount disputed on ${i.invoice_no}`} />}
                  </label>
                );
              })}
            </div>
            {chosen.length > 0 && <div style={{ fontSize: 15, marginTop: 6 }}>{chosen.length} bill{chosen.length === 1 ? '' : 's'} · <strong>{fmtCurrency(total)}</strong> in dispute</div>}
          </div>
          {chosen.length > 1 && (
            <Field label="Title for the linked disputes" required>
              <input required value={form.group_title} onChange={(e) => setForm({ ...form, group_title: e.target.value })} placeholder="e.g. Tariff applied at the old rate, April to August" />
            </Field>
          )}
          <div className="form-grid">
            <Field label="Charge line">
              <select required value={form.charge_line} onChange={(e) => setForm({ ...form, charge_line: e.target.value })}>
                {CHARGE_LINES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Reason code">
              <select required value={form.reason_code} onChange={(e) => setForm({ ...form, reason_code: e.target.value })}>
                <option value="">Select...</option>
                {REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Issue Description">
            <textarea required={form.reason_code === 'OTHER'} rows={3} value={form.issue_description} onChange={(e) => setForm({ ...form, issue_description: e.target.value })} />
          </Field>
          <Field label={chosen.length > 1 ? 'Evidence (filed on each of the linked disputes)' : 'Evidence'}>
            <input type="file" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} />
          </Field>
          {chosen.length > 1 && <p className="inline-note">One dispute is raised on each bill, so the amount is held on that bill; the {chosen.length} are linked under one reference and can be followed together.</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={busy}>{busy ? 'Raising…' : chosen.length > 1 ? `Raise ${chosen.length} linked disputes` : 'Submit Dispute'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.dispute_no || 'Dispute'} width={760}>
        {detail && (
          <div>
            <div className="detail-grid">
              <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value"><Badge status={detail.status} /></span></div>
              <div className="detail-item"><span className="detail-label">Invoice</span><span className="detail-value">{detail.invoice?.invoice_no} ({detail.invoice?.billing_period})</span></div>
              <div className="detail-item"><span className="detail-label">Category</span><span className="detail-value">{reasonLabel(detail.reason_code)}</span></div>
              <div className="detail-item"><span className="detail-label">Charge line</span><span className="detail-value">{chargeLabel(detail.charge_line)}</span></div>
              <div className="detail-item"><span className="detail-label">Disputed</span><span className="detail-value">{fmtCurrency(detail.disputed_amount)}</span></div>
              <div className="detail-item"><span className="detail-label">Left to pay on the bill</span><span className="detail-value">{fmtCurrency(detail.invoice?.balance_due ?? detail.invoice?.payable_now)}</span></div>
            </div>
            {detail.issue_description && <p style={{ whiteSpace: 'pre-wrap' }}>{detail.issue_description}</p>}


            <DisputeExtrasPanel key={`${detail.id}-${detail.updated_at}`} disputeId={detail.id} onChanged={refreshDetail} />

            {detail.status === 'INFO_REQUESTED' && <div className="alert alert-error" style={{ fontSize: 14.5 }}>SJVN has asked for more information — reply in the thread below to send it back for review.</div>}

            <div className="section-title" style={{ marginTop: 14 }}>Evidence</div>
            {!(detail.supporting_docs || []).length && <div style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>No evidence filed yet.</div>}
            <ul style={{ paddingLeft: 18, margin: '4px 0 8px' }}>
              {(detail.supporting_docs || []).map((d) => (
                <li key={d.filename} style={{ fontSize: 14.5 }}>
                  <button type="button" className="btn-link" onClick={() => downloadEvidence(d)}>{d.original_name || d.filename}</button>
                  <span style={{ color: 'var(--slate-500)' }}> · {d.uploaded_by}{d.uploaded_at ? ` · ${fmtDate(d.uploaded_at)}` : ''}</span>
                </li>
              ))}
            </ul>
            {detail.status !== 'CLOSED' && <input type="file" onChange={uploadEvidence} aria-label="Add evidence" />}

            <div className="section-title" style={{ marginTop: 14 }}>Thread</div>
            {!(detail.comments || []).length && <div style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>No messages yet.</div>}
            {(detail.comments || []).map((c) => (
              <div key={c.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 15, opacity: 0.65 }}>{c.user_name} · {fmtDateTime(c.created_at)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            ))}
            {detail.status !== 'CLOSED' && (
              <form onSubmit={postComment}>
                <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Message to SJVN" />
                <div className="form-actions"><button type="submit" className="btn btn-secondary" disabled={!comment.trim()}>Send</button></div>
              </form>
            )}

            {(detail.events || []).length > 0 && (
              <details style={{ marginTop: 12, fontSize: 14.5 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--primary)' }}>Timeline ({detail.events.filter((e) => e.event_type !== 'INTERNAL_COMMENT').length} events)</summary>
                <ul style={{ paddingLeft: 18, marginTop: 6 }}>
                  {detail.events.filter((e) => e.event_type !== 'INTERNAL_COMMENT').map((e) => (
                    <li key={e.id}>{fmtDateTime(e.created_at)} · {e.actor_name} · {e.event_type.replace(/_/g, ' ').toLowerCase()}{e.to_status && e.from_status && e.from_status !== e.to_status ? ` → ${e.to_status.replace(/_/g, ' ').toLowerCase()}` : ''}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Modal>
      {/* Refusals as a popup (house rule), whichever part of the page they came from. */}
      <AlertPopup
        open={!!(error || pageError || detailError)}
        title={error ? 'Dispute not raised' : detailError ? 'Not done' : 'Something needs attention'}
        message={error || detailError || pageError}
        onClose={() => { setError(''); setPageError(''); setDetailError(''); }}
      />
    </div>
  );
}
