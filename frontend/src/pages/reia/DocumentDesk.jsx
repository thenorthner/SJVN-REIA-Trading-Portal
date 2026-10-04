import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, StatCard, Badge, Modal, Field } from '../../components/ui.jsx';
import {
  ReviewModal, PreviewModal, ExpiryTag, canReviewDocuments, downloadAllDocuments,
} from '../../components/DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';

// The REIA desk's side of Documents & KYC: what is waiting to be reviewed,
// where every company stands, and what SJVN has asked companies to send.

const TABS = [
  { key: 'QUEUE', label: 'Waiting for review' },
  { key: 'REPORT', label: 'KYC status' },
  { key: 'REQUESTS', label: 'Document requests' },
];

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function exportReport(rows) {
  const head = ['Company', 'Type', 'Onboarding', 'Mandatory verified', 'Mandatory total', 'KYC %', 'Documents', 'Verified', 'Awaiting SJVN', 'Draft', 'Rejected', 'Expiring (30 days)', 'Expired', 'Next expiry'];
  const lines = rows.map((r) => [
    r.name, r.entity_type, r.onboarding_status, r.mandatory_verified, r.mandatory_total, r.progress_pct ?? '',
    r.documents, r.verified, r.pending, r.draft, r.rejected, r.expiring, r.expired, r.next_expiry || '',
  ].map(csvCell).join(','));
  const blob = new Blob([`${head.map(csvCell).join(',')}\n${lines.join('\n')}\n`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kyc-status-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Progress({ pct }) {
  if (pct === null || pct === undefined) return <span style={{ color: 'var(--slate-500)', fontSize: 12 }}>No checklist</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 130 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--slate-100, #f1f5f9)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16a34a' : '#2563eb' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, width: 34, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

function RequestModal({ companies, preset, onClose, onDone }) {
  const [form, setForm] = useState({ entity_id: preset || '', document_type: '', note: '', due_date: '' });
  const [types, setTypes] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.masters.documentTypes({ module: 'STAKEHOLDERS' })
      .then((rows) => setTypes((rows || []).filter((t) => t.category === 'VERIFY')))
      .catch(() => setTypes([]));
  }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.documents.createRequest(form);
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal open onClose={onClose} title="Ask a company for a document">
      <form onSubmit={submit}>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <Field label="Company" required>
          <select required value={form.entity_id} onChange={set('entity_id')}>
            <option value="">Choose…</option>
            {companies.map((c) => <option key={c.entity_id} value={c.entity_id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Document needed" required>
          {types.length > 0 ? (
            <select required value={form.document_type} onChange={set('document_type')}>
              <option value="">Choose…</option>
              {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
          ) : (
            <input required value={form.document_type} onChange={set('document_type')} placeholder="e.g. GST_CERTIFICATE" />
          )}
        </Field>
        <Field label="Needed by (optional)">
          <input type="date" value={form.due_date} onChange={set('due_date')} />
        </Field>
        <Field label="Note for the company (optional)">
          <textarea rows={3} value={form.note} onChange={set('note')} placeholder="e.g. The one on file expires next month — please send the renewed licence." />
        </Field>
        <p className="inline-note">
          The company sees this on its My Documents page and in its notifications. The request closes by itself when a document of this type is uploaded.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending…' : 'Send request'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function DocumentDesk() {
  const { user } = useAuth();
  const canReview = canReviewDocuments(user?.role);
  const [tab, setTab] = useState(canReview ? 'QUEUE' : 'REPORT');
  const [queue, setQueue] = useState([]);
  const [report, setReport] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [review, setReview] = useState(null);
  const [preview, setPreview] = useState(null);
  const [asking, setAsking] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      canReview ? api.documents.queue() : Promise.resolve([]),
      api.documents.kycReport(),
      api.documents.requests(),
    ])
      .then(([a, b, c]) => { setQueue(a); setReport(b); setRequests(c); setError(''); })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [canReview]);

  useEffect(() => { load(); }, [load]);

  const text = q.trim().toLowerCase();
  const shownReport = useMemo(
    () => report.filter((r) => !text || r.name.toLowerCase().includes(text)),
    [report, text],
  );
  const shownQueue = useMemo(
    () => queue.filter((d) => !text || `${d.entity_name} ${d.contract_no} ${d.title} ${d.document_type}`.toLowerCase().includes(text)),
    [queue, text],
  );
  const openRequests = requests.filter((r) => r.status === 'OPEN');
  const sum = (k) => report.reduce((s, r) => s + (r[k] || 0), 0);

  async function cancelRequest(r) {
    if (!window.confirm(`Withdraw the request to ${r.entity_name} for ${r.document_type}?`)) return;
    try {
      await api.documents.cancelRequest(r.id);
      load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Documents & KYC Desk"
        subtitle="What is waiting to be verified, where each company stands, and what SJVN has asked for"
        actions={canReview && <button className="btn btn-primary" onClick={() => setAsking('')}>+ Ask for a document</button>}
      />

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="kpi-grid">
        <StatCard label="Waiting for review" value={canReview ? queue.length : sum('pending')} tone={sum('pending') ? 'amber' : 'green'} hint={queue[0] ? `Oldest: ${queue[0].waiting_days} day(s)` : 'Nothing waiting'} />
        <StatCard label="Expired" value={sum('expired')} tone={sum('expired') ? 'red' : 'green'} hint="Verified proofs past their date" />
        <StatCard label="Expiring in 30 days" value={sum('expiring')} tone={sum('expiring') ? 'amber' : 'default'} />
        <StatCard label="Open requests" value={openRequests.length} hint={openRequests.some((r) => r.overdue) ? `${openRequests.filter((r) => r.overdue).length} overdue` : 'Asked of companies'} />
      </div>

      <div className="nb-tabs" role="tablist">
        {TABS.filter((t) => t.key !== 'QUEUE' || canReview).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'REQUESTS' && (
        <div className="nb-toolbar">
          <input type="search" placeholder={tab === 'QUEUE' ? 'Search company or document…' : 'Search company…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          {tab === 'REPORT' && (
            <button type="button" className="nb-link-btn" disabled={!shownReport.length} onClick={() => exportReport(shownReport)}>Export CSV</button>
          )}
        </div>
      )}

      {tab === 'QUEUE' && (
        <Card>
          <div className="table-wrap">
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Document</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Valid until</th>
                  <th scope="col">File check</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!shownQueue.length && (
                  <tr><td colSpan={7} className="empty-cell">{loading ? 'Loading…' : 'Nothing is waiting for review.'}</td></tr>
                )}
                {shownQueue.map((d) => {
                  const bad = (d.extracted?.checks || []).filter((c) => !c.ok).length;
                  const good = (d.extracted?.checks || []).filter((c) => c.ok).length;
                  return (
                    <tr key={d.latest_version_id}>
                      <td><strong>{d.entity_name || (d.contract_no ? `Contract ${d.contract_no}` : '—')}</strong></td>
                      <td>
                        {d.title} <span style={{ color: 'var(--slate-500)' }}>(v{d.version_number})</span>
                        <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{d.document_type}</div>
                      </td>
                      <td>
                        {fmtDateTime(d.uploaded_at)}
                        <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{d.uploaded_by_name || '—'}</div>
                      </td>
                      <td style={{ fontWeight: 600, color: d.waiting_days > 7 ? '#b91c1c' : d.waiting_days > 2 ? '#b45309' : 'inherit' }}>
                        {d.waiting_days === 0 ? 'Today' : `${d.waiting_days} day${d.waiting_days === 1 ? '' : 's'}`}
                      </td>
                      <td><ExpiryTag doc={d} /></td>
                      <td style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {bad > 0 && <span style={{ color: '#b91c1c' }}>✗ {bad} mismatch{bad === 1 ? '' : 'es'}</span>}
                        {bad === 0 && good > 0 && <span style={{ color: '#15803d' }}>✓ Matches record</span>}
                        {bad === 0 && good === 0 && <span style={{ color: 'var(--slate-500)', fontWeight: 400 }}>Not checked</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setPreview(d)}>View</button>
                          <button className="btn btn-primary btn-sm" onClick={() => setReview(d)}>Review</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'REPORT' && (
        <Card>
          <div className="table-wrap">
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Onboarding</th>
                  <th scope="col">Mandatory proofs</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Verified</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Awaiting</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Rejected</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Expiring</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Expired</th>
                  <th scope="col">Next expiry</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!shownReport.length && (
                  <tr><td colSpan={10} className="empty-cell">{loading ? 'Loading…' : 'No companies match.'}</td></tr>
                )}
                {shownReport.map((r) => {
                  const num = (v, color) => <td style={{ textAlign: 'right', fontWeight: v ? 700 : 400, color: v ? color : 'var(--slate-500)' }}>{v}</td>;
                  return (
                    <tr key={r.entity_id}>
                      <td>
                        <strong>{r.name}</strong>
                        <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.entity_type}</div>
                      </td>
                      <td><Badge status={r.onboarding_status} /></td>
                      <td>
                        <Progress pct={r.progress_pct} />
                        {r.mandatory_total > 0 && <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>{r.mandatory_verified} of {r.mandatory_total}</div>}
                      </td>
                      {num(r.verified, '#15803d')}
                      {num(r.pending, '#b45309')}
                      {num(r.rejected, '#b91c1c')}
                      {num(r.expiring, '#b45309')}
                      {num(r.expired, '#b91c1c')}
                      <td>{r.next_expiry ? fmtDate(r.next_expiry) : '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-secondary btn-sm" disabled={!r.documents} title="Latest version of every document, in one zip" onClick={() => downloadAllDocuments({ entity_id: r.entity_id })}>ZIP</button>
                          {canReview && <button className="btn btn-secondary btn-sm" onClick={() => setAsking(r.entity_id)}>Ask</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'REQUESTS' && (
        <Card>
          <div className="table-wrap">
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Document</th>
                  <th scope="col">Asked</th>
                  <th scope="col">Needed by</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!requests.length && (
                  <tr><td colSpan={6} className="empty-cell">{loading ? 'Loading…' : 'No document has been asked for yet.'}</td></tr>
                )}
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.entity_name}</strong></td>
                    <td>
                      {r.document_type}
                      {r.note && <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.note}</div>}
                    </td>
                    <td>
                      {fmtDate(r.created_at)}
                      <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>{r.requested_by_name || '—'}</div>
                    </td>
                    <td style={{ color: r.overdue ? '#b91c1c' : 'inherit', fontWeight: r.overdue ? 700 : 400 }}>
                      {r.due_date ? fmtDate(r.due_date) : '—'}{r.overdue ? ' · overdue' : ''}
                    </td>
                    <td>
                      <Badge
                        status={r.status === 'OPEN' ? 'PENDING' : r.status === 'FULFILLED' ? 'ACTIVE' : 'DRAFT'}
                        label={r.status === 'OPEN' ? 'Waiting' : r.status === 'FULFILLED' ? 'Received' : 'Withdrawn'}
                      />
                    </td>
                    <td>
                      {canReview && r.status === 'OPEN' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => cancelRequest(r)}>Withdraw</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ReviewModal open={!!review} doc={review} onClose={() => setReview(null)} onSuccess={load} />
      <PreviewModal open={!!preview} versionId={preview?.latest_version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
      {asking !== null && (
        <RequestModal companies={report} preset={asking} onClose={() => setAsking(null)} onDone={() => { setAsking(null); setTab('REQUESTS'); load(); }} />
      )}
    </div>
  );
}
