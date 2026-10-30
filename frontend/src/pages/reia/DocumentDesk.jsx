import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, StatCard, Badge, Modal, Field, AlertPopup } from '../../components/ui.jsx';
import {
  ReviewModal, PreviewModal, ExpiryTag, canReviewDocuments, downloadAllDocuments,
} from '../../components/DocumentManager.jsx';
import { fmtDate, fmtDateTime } from '../../datetime.js';
import { actsAs } from '../../lib/rolePages.js';

// The REIA desk's side of Documents & KYC: what is waiting to be reviewed,
// where every company stands, and what SJVN has asked companies to send.

const TABS = [
  { key: 'QUEUE', label: 'Waiting for review' },
  { key: 'REPORT', label: 'KYC status' },
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
  if (pct === null || pct === undefined) return <span style={{ color: 'var(--slate-500)', fontSize: 15 }}>No checklist</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 130 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--slate-100, var(--slate-100))', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#16a34a' : '#2563eb' }} />
      </div>
      <span style={{ fontSize: 15, fontWeight: 600, width: 34, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

const FALLBACK_KYC_DOC_TYPES = [
  { value: 'PAN_CARD', label: 'PAN Card' },
  { value: 'GST_CERTIFICATE', label: 'GST Certificate' },
  { value: 'BANK_MANDATE', label: 'Bank Mandate / Cancelled Cheque' },
  { value: 'BOARD_RESOLUTION', label: 'Board Resolution / Power of Attorney' },
  { value: 'AUDITED_FINANCIALS', label: 'Audited Financial Statements' },
  { value: 'GRID_CONNECTIVITY_APPROVAL', label: 'Grid Connectivity Approval' },
  { value: 'PPA_PSA_CONTRACT', label: 'PPA / PSA Agreement' },
  { value: 'RLDC_REGISTRATION', label: 'RLDC / SLDC Registration' },
  { value: 'POWER_SALE_LICENSE', label: 'Trading / Generation License' },
  { value: 'OTHER', label: 'Other Regulatory Document' },
];

function AdminDirectUploadModal({ open, companies, presetEntityId, onClose, onDone }) {
  const [entityId, setEntityId] = useState(presetEntityId || '');
  const [types, setTypes] = useState(FALLBACK_KYC_DOC_TYPES);
  const [docType, setDocType] = useState('PAN_CARD');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [expiry, setExpiry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (presetEntityId) setEntityId(presetEntityId);
    else if (!entityId && companies.length > 0) setEntityId(companies[0].entity_id);
  }, [presetEntityId, companies]);

  useEffect(() => {
    api.masters.documentTypes({ module: 'STAKEHOLDERS' })
      .then((rows) => {
        if (Array.isArray(rows) && rows.length > 0) {
          const verifyTypes = rows.filter((r) => r.category === 'VERIFY' || !r.category);
          if (verifyTypes.length > 0) {
            setTypes(verifyTypes.map((r) => ({ value: r.code, label: r.label })));
            if (!docType || !verifyTypes.some((t) => t.code === docType)) {
              setDocType(verifyTypes[0].code);
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const comp = companies.find((c) => String(c.entity_id) === String(entityId));
    const dt = types.find((t) => t.value === docType) || { label: docType };
    if (comp && dt) {
      setTitle(`${dt.label} - ${comp.name}`);
    } else if (dt) {
      setTitle(dt.label);
    }
  }, [entityId, docType, companies, types]);

  async function submit(e) {
    e.preventDefault();
    if (!file) {
      setError('Please choose a document file to upload.');
      return;
    }
    if (!entityId) {
      setError('Please select a stakeholder company.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('The selected document exceeds 10MB limit. Please compress and try again.');
      return;
    }

    setSaving(true);
    setError('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_id', entityId);
    formData.append('document_type', docType);
    formData.append('category', 'VERIFY');
    formData.append('title', title || 'Regulatory Document');
    if (expiry) formData.append('expiry_date', expiry);
    formData.append('auto_verify', 'true');

    try {
      const res = await api.documents.upload(formData);
      const wrong = (res.extracted?.checks || []).filter((c) => !c.ok);
      onDone({ findings: wrong.map((c) => c.text) });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Direct upload & verify compliance document" width={720}>
      <form onSubmit={submit}>
        <AlertPopup open={!!error} title="Not uploaded" message={error} onClose={() => setError('')} />

        <div style={{ background: 'var(--slate-50, var(--slate-50))', border: '1px solid var(--slate-200, var(--slate-200))', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--on-blue)', fontWeight: 600, fontSize: 15 }}>
            <span>SJVN Admin direct stakeholder onboarding</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 15, color: 'var(--slate-600)' }}>
            Directly upload regulatory and compliance proofs on behalf of stakeholders to instantly complete KYC verification requirements without counterparty maker-checker delays.
          </p>
        </div>

        <Field label="Stakeholder company" required>
          <select required value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Choose company…</option>
            {companies.map((c) => (
              <option key={c.entity_id} value={c.entity_id}>
                {c.name} ({c.entity_type || 'Stakeholder'}) {c.onboarding_status === 'PENDING' ? '· [Pending]' : ''}
              </option>
            ))}
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="Document type" required>
            <select required value={docType} onChange={(e) => setDocType(e.target.value)}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Valid until (optional)">
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </div>

        <Field label="Document title" required>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PAN Card - SunSource Energy" />
        </Field>

        <Field label="Document file (PDF, PNG, JPG, Excel · Max 10MB)" required>
          <input
            type="file"
            required
            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files[0])}
          />
        </Field>

        <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)' }}
            disabled={saving || !file || !entityId}
          >
            {saving ? 'Uploading & verifying…' : 'Upload & verify'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const VERTICAL_LABELS = { REIA: 'REIA', HYDRO: 'Hydro', THERMAL: 'Thermal' };
// Taking papers in (routes/documents.js canTakeIn): the REIA maker, the station desks and the administrators.
const ADMIN_ROLES = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_MAKER', 'COMMERCIAL_ADMIN', 'COMMERCIAL', 'THERMAL_ADMIN', 'THERMAL_USER'];
// Direct admission, and admitting a scanned paper as verified, are administrators' (as on the server).
const DIRECT_ADMIT_ROLES = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_CHECKER', 'COMMERCIAL_ADMIN', 'THERMAL_ADMIN'];

export default function DocumentDesk({ vertical = 'REIA', embedded = false }) {
  const { user } = useAuth();
  const canReview = canReviewDocuments(user?.role);
  const canDirectAdmit = actsAs(user, DIRECT_ADMIT_ROLES);
  const [popup, setPopup] = useState(null);
  const canAdminUpload = actsAs(user, ADMIN_ROLES);

  const [tab, setTab] = useState(canReview ? 'QUEUE' : 'REPORT');
  const [queue, setQueue] = useState([]);
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [review, setReview] = useState(null);
  const [preview, setPreview] = useState(null);
  const [directUploadEntityId, setDirectUploadEntityId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = vertical !== 'REIA' ? { vertical } : undefined;
    Promise.all([
      canReview ? api.documents.queue(params) : Promise.resolve([]),
      api.documents.kycReport(params),
    ])
      .then(([a, b]) => { setQueue(a); setReport(b); setError(''); })
      .catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [canReview, vertical]);

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
  const sum = (k) => report.reduce((s, r) => s + (r[k] || 0), 0);
  const activeCount = report.filter((r) => r.onboarding_status === 'APPROVED' || r.onboarding_status === 'ACTIVE').length;
  const pendingCount = report.filter((r) => r.onboarding_status === 'PENDING').length;

  function handleQuickVerify(d) {
    const bad = (d.extracted?.checks || []).filter((c) => !c.ok).length;
    setPopup({
      tone: bad ? 'warning' : 'info',
      title: `Verify "${d.title}"`,
      message: bad
        ? `This document has ${bad} file check mismatch${bad === 1 ? '' : 'es'}. Verify it for ${d.entity_name || 'this stakeholder'} anyway?`
        : `Verify "${d.title}" for ${d.entity_name || 'this stakeholder'}?`,
      confirm: { label: 'Verify', run: () => doVerify(d) },
    });
  }

  async function doVerify(d) {
    setActionLoading(true);
    try {
      await api.documents.verify(d.latest_version_id);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Verification failed');
    } finally {
      setActionLoading(false);
    }
  }

  function handleDirectAdmit(r) {
    setPopup({
      tone: 'warning',
      title: `Directly admit ${r.name}`,
      message: 'Its pending mandatory clearances are marked verified by you and the stakeholder is activated. The bank account is not thereby verified: confirm it against the bank proof before any payment.',
      confirm: { label: 'Admit', run: () => doDirectAdmit(r) },
    });
  }

  async function doDirectAdmit(r) {
    setActionLoading(true);
    try {
      await api.entities.approve(r.entity_id, 'APPROVED', 'Admitted directly from KYC Desk by SJVN Admin', { admin_direct_admit: true });
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Direct admission failed');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={vertical === 'REIA' ? 'Documents & KYC Desk' : `Documents & KYC Desk — ${VERTICAL_LABELS[vertical]} Stations`}
          subtitle="Verification queue, company compliance status, and direct SJVN stakeholder onboarding & admission"
          actions={
            canAdminUpload && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDirectUploadEntityId('')}
              >
                + Direct Upload Document
              </button>
            )
          }
        />
      )}
      {embedded && canAdminUpload && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setDirectUploadEntityId('')}
          >
            + Direct Upload Document
          </button>
        </div>
      )}

      <AlertPopup open={!!error} title="Not done" message={error} onClose={() => setError('')} />
      <AlertPopup
        open={!!popup}
        tone={popup?.tone || 'info'}
        title={popup?.title}
        message={popup?.message}
        items={popup?.items}
        okLabel={popup?.confirm ? 'Back' : undefined}
        actions={popup?.confirm ? <button type="button" className="btn btn-primary" onClick={() => { const run = popup.confirm.run; setPopup(null); run(); }}>{popup.confirm.label}</button> : undefined}
        onClose={() => setPopup(null)}
      />

      <div className="kpi-grid">
        <StatCard label="Waiting for review" value={canReview ? queue.length : sum('pending')} tone={sum('pending') ? 'amber' : 'green'} hint={queue[0] ? `Oldest: ${queue[0].waiting_days} day(s)` : 'Nothing waiting'} />
        <StatCard label="Expired" value={sum('expired')} tone={sum('expired') ? 'red' : 'green'} hint="Verified proofs past their date" />
        <StatCard label="Expiring in 30 days" value={sum('expiring')} tone={sum('expiring') ? 'amber' : 'default'} />
        <StatCard label="Active stakeholders" value={activeCount} hint={pendingCount ? `${pendingCount} pending admission` : 'All stakeholders verified'} />
      </div>

      <div className="nb-tabs" role="tablist">
        {TABS.filter((t) => t.key !== 'QUEUE' || canReview).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`nb-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="nb-toolbar">
        <input type="search" placeholder={tab === 'QUEUE' ? 'Search company or document…' : 'Search company…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {tab === 'REPORT' && (
          <button type="button" className="nb-link-btn" disabled={!shownReport.length} onClick={() => exportReport(shownReport)}>Export CSV</button>
        )}
      </div>

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
                        <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>{d.document_type}</div>
                      </td>
                      <td>
                        {fmtDateTime(d.uploaded_at)}
                        <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>{d.uploaded_by_name || '—'}</div>
                      </td>
                      <td style={{ fontWeight: 600, color: d.waiting_days > 7 ? 'var(--red-deep)' : d.waiting_days > 2 ? 'var(--amber-strong)' : 'inherit' }}>
                        {d.waiting_days === 0 ? 'Today' : `${d.waiting_days} day${d.waiting_days === 1 ? '' : 's'}`}
                      </td>
                      <td><ExpiryTag doc={d} /></td>
                      <td style={{ fontSize: 15, fontWeight: 600 }}>
                        {bad > 0 && <span style={{ color: 'var(--red-deep)' }}>✗ {bad} mismatch{bad === 1 ? '' : 'es'}</span>}
                        {bad === 0 && good > 0 && <span style={{ color: 'var(--on-green-2)' }}>✓ Matches record</span>}
                        {bad === 0 && good === 0 && <span style={{ color: 'var(--slate-500)', fontWeight: 400 }}>Not checked</span>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview(d)}>View</button>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setReview(d)}>Review</button>
                          {canReview && (
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: '#fff' }}
                              title="Quick 1-click verify this document"
                              disabled={actionLoading}
                              onClick={() => handleQuickVerify(d)}
                            >
                              Verify
                            </button>
                          )}
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
                        <div style={{ fontSize: 15, color: 'var(--slate-500)' }}>{r.entity_type}</div>
                      </td>
                      <td><Badge status={r.onboarding_status} /></td>
                      <td>
                        <Progress pct={r.progress_pct} />
                        {r.mandatory_total > 0 && <div style={{ fontSize: 14.5, color: 'var(--slate-500)' }}>{r.mandatory_verified} of {r.mandatory_total}</div>}
                      </td>
                      {num(r.verified, '#15803d')}
                      {num(r.pending, '#b45309')}
                      {num(r.rejected, '#b91c1c')}
                      {num(r.expiring, '#b45309')}
                      {num(r.expired, '#b91c1c')}
                      <td>{r.next_expiry ? fmtDate(r.next_expiry) : '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          {canAdminUpload && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              title="Directly upload compliance proof for this company"
                              onClick={() => setDirectUploadEntityId(r.entity_id)}
                            >
                              Upload Proof
                            </button>
                          )}
                          {canDirectAdmit && r.onboarding_status === 'PENDING' && (
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', color: '#fff' }}
                              title="Directly admit & activate this stakeholder"
                              disabled={actionLoading}
                              onClick={() => handleDirectAdmit(r)}
                            >
                              Direct Admit
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={!r.documents}
                            title="Latest version of every document, in one zip"
                            onClick={() => downloadAllDocuments({ entity_id: r.entity_id })}
                          >
                            ZIP
                          </button>
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

      <ReviewModal open={!!review} doc={review} onClose={() => setReview(null)} onSuccess={load} />
      <PreviewModal open={!!preview} versionId={preview?.latest_version_id} fileName={preview?.file_name} onClose={() => setPreview(null)} />
      {directUploadEntityId !== null && (
        <AdminDirectUploadModal
          open
          companies={report}
          presetEntityId={directUploadEntityId}
          onClose={() => setDirectUploadEntityId(null)}
          onDone={({ findings = [] } = {}) => {
            setDirectUploadEntityId(null);
            load();
            setPopup({
              tone: findings.length ? 'warning' : 'success',
              title: 'Scanned in',
              message: canDirectAdmit
                ? 'The document is on file and, as an administrator\'s intake, verified unless it has expired.'
                : 'The document is on file and waiting in the queue: another officer verifies it.',
              items: findings.length ? findings.map((f) => ({ label: 'File check', message: f })) : undefined,
            });
          }}
        />
      )}
    </div>
  );
}
