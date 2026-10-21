import React, { useEffect, useState } from 'react';
import { Card, Table, Badge, Field, AlertPopup } from '../components/ui.jsx';
import api from '../api/client.js';
import { fmtDateTime } from '../datetime.js';
import { readConsent, openCookiePreferences, CONSENT_KEY } from './CookieConsent.jsx';

/**
 * A Data Principal's rights under the DPDP Act 2023, exercised from the profile:
 * see a summary of one's data, withdraw consent, and ask for correction,
 * erasure, nomination or grievance redressal. Requests are recorded with a
 * reference and routed to the Data Protection Officer's queue
 * (Settings → Data requests).
 */
export const REQUEST_TYPES = [
  { value: 'ACCESS', label: 'Access — a summary of my personal data and its processing' },
  { value: 'CORRECTION', label: 'Correction / updating of my personal data' },
  { value: 'ERASURE', label: 'Erasure of my personal data' },
  { value: 'NOMINATION', label: 'Nominate a person to exercise my rights' },
  { value: 'GRIEVANCE', label: 'Grievance about how my data is handled' },
];
const TYPE_LABEL = Object.fromEntries(REQUEST_TYPES.map((t) => [t.value, t.label.split(' —')[0].split(' /')[0]]));

export default function PrivacyPanel() {
  const [data, setData] = useState(null);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ request_type: '', details: '', nominee_name: '', nominee_contact: '' });
  const [popup, setPopup] = useState(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(readConsent);

  const load = () => {
    api.privacy.myData().then(setData).catch(() => setData(null));
    api.privacy.requests().then(setRequests).catch(() => setRequests([]));
  };
  useEffect(load, []);
  useEffect(() => {
    if (window.location.hash === '#privacy') document.getElementById('privacy')?.scrollIntoView({ block: 'start' });
    const sync = (e) => { if (!e || e.key === CONSENT_KEY) setConsent(readConsent()); };
    window.addEventListener('storage', sync);
    const timer = setInterval(() => setConsent(readConsent()), 2000);
    return () => { window.removeEventListener('storage', sync); clearInterval(timer); };
  }, []);

  function downloadSummary() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `my-data-summary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function withdraw() {
    try {
      await api.privacy.withdrawConsent('COOKIES');
      try { localStorage.removeItem(CONSENT_KEY); } catch { /* ignore */ }
      setConsent(null);
      openCookiePreferences();
      setPopup({ tone: 'success', title: 'Consent withdrawn', message: 'Optional storage is off. Only the storage the portal needs to work is used. You can choose again in the notice shown below.' });
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'Could not withdraw consent', message: err.response?.data?.error || err.message });
    }
  }

  async function submit(e) {
    e.preventDefault();
    const problems = [];
    if (!form.request_type) problems.push({ label: 'Request type', message: 'Choose what you are asking for.' });
    if (form.details.trim().length < 10) problems.push({ label: 'Details', message: 'Describe the request in at least 10 characters.' });
    if (form.request_type === 'NOMINATION') {
      if (!form.nominee_name.trim()) problems.push({ label: 'Nominee name', message: 'Name the person you nominate.' });
      if (!/^\S+@\S+\.\S+$|^[6-9]\d{9}$/.test(form.nominee_contact.trim())) problems.push({ label: 'Nominee contact', message: 'Give the nominee’s e-mail address or 10-digit mobile number.' });
    }
    if (problems.length) { setPopup({ tone: 'error', title: 'Please fix the following', items: problems }); return; }
    setBusy(true);
    try {
      const r = await api.privacy.createRequest(form);
      setForm({ request_type: '', details: '', nominee_name: '', nominee_contact: '' });
      setPopup({ tone: 'success', title: 'Request recorded', message: `Reference ${r.reference}. The Data Protection Officer will acknowledge it within 3 working days; you will be notified of each update.` });
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'Could not record the request', message: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="privacy" aria-labelledby="privacy-h" style={{ marginTop: 24, display: 'grid', gap: 16 }}>
      <h2 id="privacy-h" style={{ margin: 0, fontSize: 18 }}>Privacy &amp; data rights</h2>
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>
        Your rights as a Data Principal under the Digital Personal Data Protection Act, 2023. See the <a href="/privacy-policy">Privacy Policy</a>.
      </p>

      <Card title="Summary of my personal data" actions={data && <button type="button" className="btn btn-sm" onClick={downloadSummary}>Download (JSON)</button>}>
        {!data ? <p>Loading…</p> : (
          <dl className="gigw-dl">
            <dt>Name</dt><dd>{data.profile?.name}</dd>
            <dt>E-mail</dt><dd>{data.profile?.email}</dd>
            <dt>Mobile</dt><dd>{data.profile?.mobile || '—'}</dd>
            <dt>Role</dt><dd>{String(data.profile?.role || '').replaceAll('_', ' ')}</dd>
            {data.organisation && <><dt>Organisation</dt><dd>{data.organisation.name}</dd></>}
            <dt>Account created</dt><dd>{fmtDateTime(data.profile?.created_at)}</dd>
            <dt>Actions recorded in the audit log</dt><dd>{data.activity?.audit_entries ?? 0}</dd>
            <dt>Statutory declarations made</dt><dd>{data.activity?.declarations ?? 0}</dd>
            <dt>Purposes of processing</dt><dd>{(data.purposes || []).join('; ')}</dd>
            <dt>Retention</dt><dd>{data.retention}</dd>
          </dl>
        )}
        {data?.recent_sign_ins?.length > 0 && (
          <Table
            caption="Recent sign-ins"
            columns={[
              { key: 'created_at', header: 'When', render: (r) => fmtDateTime(r.created_at) },
              { key: 'action', header: 'Event', render: (r) => r.action.replaceAll('_', ' ') },
              { key: 'ip_address', header: 'IP address' },
            ]}
            rows={data.recent_sign_ins}
          />
        )}
      </Card>

      <Card title="Consent">
        <p style={{ marginTop: 0 }}>
          Cookie and browser storage: <strong>{consent ? (consent.choice === 'all' ? 'All (essential + performance)' : 'Essential only') : 'Not given'}</strong>
          {consent?.ts && <> — {fmtDateTime(consent.ts)}</>}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={openCookiePreferences}>Change choice</button>
          <button type="button" className="btn btn-sm" onClick={withdraw} disabled={!consent}>Withdraw consent</button>
        </div>
      </Card>

      <Card title="Make a request">
        <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
          <Field label="Request type" required htmlFor="dpr-type">
            <select id="dpr-type" className="select" value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })}>
              <option value="">Select…</option>
              {REQUEST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          {form.request_type === 'NOMINATION' && (
            <>
              <Field label="Nominee name" required htmlFor="dpr-nn">
                <input id="dpr-nn" className="input" value={form.nominee_name} onChange={(e) => setForm({ ...form, nominee_name: e.target.value })} />
              </Field>
              <Field label="Nominee e-mail or mobile" required htmlFor="dpr-nc">
                <input id="dpr-nc" className="input" value={form.nominee_contact} onChange={(e) => setForm({ ...form, nominee_contact: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Details" required htmlFor="dpr-details">
            <textarea id="dpr-details" className="input" rows={4} maxLength={2000} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
          </Field>
          <div><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button></div>
        </form>
      </Card>

      <Card title="My requests">
        <Table
          caption="My data-principal requests"
          emptyMessage="No requests yet."
          columns={[
            { key: 'reference', header: 'Reference' },
            { key: 'request_type', header: 'Type', render: (r) => TYPE_LABEL[r.request_type] || r.request_type },
            { key: 'created_at', header: 'Raised', render: (r) => fmtDateTime(r.created_at) },
            { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            { key: 'response', header: 'Response', render: (r) => r.response || '—' },
          ]}
          rows={requests}
        />
      </Card>

      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </section>
  );
}
