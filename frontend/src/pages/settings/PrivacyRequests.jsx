import React, { useEffect, useState } from 'react';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, Tabs, Tab } from '../../components/ui.jsx';
import api from '../../api/client.js';
import { fmtDateTime } from '../../datetime.js';
import { REQUEST_TYPES } from '../../gigw/PrivacyPanel.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * The Data Protection Officer's desk: data-principal requests (DPDP Act 2023)
 * to acknowledge and close, and the register of statutory declarations made on
 * critical submissions, with who, when, from where and on what. The Web
 * Information Manager (admins) also answers feedback from the public Feedback
 * page here (GIGW 3.0 quality guideline 11).
 */
const FEEDBACK_ROLES = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_CHECKER'];
// The REIA checker comes here for the feedback alone, not the DPO's queues.
const DPO_ROLES = ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'COMPLIANCE_AUDITOR'];
const FB_CATEGORY = { content: 'Content', accessibility: 'Accessibility', technical: 'Technical', translation: 'Translation', suggestion: 'Suggestion' };
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
const TYPE_LABEL = Object.fromEntries(REQUEST_TYPES.map((t) => [t.value, t.label.split(' —')[0].split(' /')[0]]));

export default function PrivacyRequests() {
  const { user } = useAuth();
  const canDpo = DPO_ROLES.includes(user?.role);
  const canFeedback = FEEDBACK_ROLES.includes(user?.role);
  const [tab, setTab] = useState(canDpo ? 'requests' : 'feedback');
  const [rows, setRows] = useState([]);
  const [decls, setDecls] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [popup, setPopup] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [fbEditing, setFbEditing] = useState(null);

  const load = () => {
    if (canDpo) {
      api.privacy.allRequests(status ? { status } : undefined).then(setRows).catch(() => setRows([]));
      api.privacy.declarations({ limit: 500 }).then(setDecls).catch(() => setDecls([]));
    }
    if (canFeedback) api.privacy.feedback().then(setFeedback).catch(() => setFeedback([]));
  };

  async function saveFeedback() {
    if (fbEditing.status === 'REPLIED' && (fbEditing.reply || '').trim().length < 5) {
      setPopup({ tone: 'error', title: 'Reply needed', message: 'Paste or summarise the reply sent to the visitor before marking it replied.' });
      return;
    }
    try {
      await api.privacy.updateFeedback(fbEditing.id, { status: fbEditing.status, reply: fbEditing.reply });
      setFbEditing(null);
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'Could not update', message: err.response?.data?.error || err.message });
    }
  }
  useEffect(load, [status]);

  async function save() {
    if (['RESOLVED', 'REJECTED'].includes(editing.status) && !editing.response?.trim()) {
      setPopup({ tone: 'error', title: 'Response needed', message: 'Say what was done (or why the request is refused) before closing it; the requester sees this text.' });
      return;
    }
    try {
      await api.privacy.updateRequest(editing.id, { status: editing.status, response: editing.response });
      setEditing(null);
      load();
    } catch (err) {
      setPopup({ tone: 'error', title: 'Could not update', message: err.response?.data?.error || err.message });
    }
  }

  return (
    <div>
      {canDpo ? (
        <>
          <PageHeader title="Data requests & declarations" subtitle={`DPDP Act 2023 data-principal requests, the statutory declaration register${canFeedback ? ', and public feedback' : ''}`} />
          <Tabs>
            <Tab active={tab === 'requests'} onClick={() => setTab('requests')}>Data-principal requests</Tab>
            <Tab active={tab === 'declarations'} onClick={() => setTab('declarations')}>Declaration register</Tab>
            {canFeedback && <Tab active={tab === 'feedback'} onClick={() => setTab('feedback')}>Public feedback</Tab>}
          </Tabs>
        </>
      ) : (
        <PageHeader title="Public feedback" subtitle="What visitors sent from the portal's Feedback page — reply to them and close each one" />
      )}

      {tab === 'feedback' && canFeedback && (
        <Card title="Feedback from the public Feedback page">
          <Table
            caption="Public feedback"
            emptyMessage="No feedback received yet."
            onRowClick={(r) => setFbEditing({ ...r, status: r.status === 'NEW' ? 'REPLIED' : r.status })}
            columns={[
              { key: 'reference_no', header: 'Reference' },
              { key: 'created_at', header: 'Received', render: (r) => fmtDateTime(r.created_at) },
              { key: 'name', header: 'From', render: (r) => `${r.name} (${r.email})` },
              { key: 'category', header: 'About', render: (r) => FB_CATEGORY[r.category] || r.category },
              // The page it came from — a Playbook report names its step (e.g. "REIA Playbook Q24.6 · …").
              { key: 'page_url', header: 'Page', render: (r) => r.page_url || '—' },
              { key: 'message', header: 'Feedback', render: (r) => (r.message.length > 90 ? `${r.message.slice(0, 90)}…` : r.message) },
              { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            ]}
            rows={feedback}
          />
        </Card>
      )}

      {tab === 'requests' && canDpo && (
        <Card
          title="Requests"
          actions={(
            <label className="field" style={{ margin: 0 }}>
              <span className="sr-only">Filter by status</span>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
          )}
        >
          <Table
            caption="Data-principal requests"
            emptyMessage="No requests."
            onRowClick={(r) => setEditing({ ...r })}
            columns={[
              { key: 'reference', header: 'Reference' },
              { key: 'user_name', header: 'Requester', render: (r) => `${r.user_name || '—'} (${r.user_email || ''})` },
              { key: 'request_type', header: 'Type', render: (r) => TYPE_LABEL[r.request_type] || r.request_type },
              { key: 'created_at', header: 'Raised', render: (r) => fmtDateTime(r.created_at) },
              { key: 'due', header: 'Due', render: (r) => fmtDateTime(r.due_at) },
              { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
            ]}
            rows={rows}
          />
        </Card>
      )}

      {tab === 'declarations' && canDpo && (
        <Card title="Statutory declarations (latest 500)">
          <Table
            caption="Statutory declaration register"
            emptyMessage="No declarations recorded yet."
            columns={[
              { key: 'created_at', header: 'Server time', render: (r) => fmtDateTime(r.created_at) },
              { key: 'user_name', header: 'User', render: (r) => `${r.user_name || '—'} · ${String(r.user_role || '').replaceAll('_', ' ')}` },
              { key: 'action_label', header: 'Action' },
              { key: 'path', header: 'Request', render: (r) => <code>{r.method} {r.path}</code> },
              { key: 'ip_address', header: 'IP' },
              { key: 'version', header: 'Version' },
              { key: 'outcome_status', header: 'Result', render: (r) => (r.outcome_status ? (r.outcome_status < 400 ? `Done (${r.outcome_status})` : `Refused (${r.outcome_status})`) : '—') },
            ]}
            rows={decls}
          />
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `${editing.reference} — ${TYPE_LABEL[editing.request_type] || editing.request_type}` : ''} width="compact">
        {editing && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0 }}><strong>{editing.user_name}</strong> ({editing.user_email}) · raised {fmtDateTime(editing.created_at)}</p>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{editing.details}</p>
            {editing.nominee_name && <p style={{ margin: 0 }}>Nominee: {editing.nominee_name} — {editing.nominee_contact}</p>}
            <Field label="Status" htmlFor="pr-status">
              <select id="pr-status" className="select" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Response to the requester" htmlFor="pr-resp">
              <textarea id="pr-resp" rows={4} value={editing.response || ''} onChange={(e) => setEditing({ ...editing, response: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!fbEditing} onClose={() => setFbEditing(null)} title={fbEditing ? `${fbEditing.reference_no} — ${FB_CATEGORY[fbEditing.category] || fbEditing.category}` : ''} width="compact">
        {fbEditing && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0 }}><strong>{fbEditing.name}</strong> ({fbEditing.email}) · {fmtDateTime(fbEditing.created_at)}{fbEditing.page_url ? ` · page ${fbEditing.page_url}` : ''}</p>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{fbEditing.message}</p>
            <Field label="Status" htmlFor="fb-status">
              <select id="fb-status" className="select" value={fbEditing.status} onChange={(e) => setFbEditing({ ...fbEditing, status: e.target.value })}>
                <option value="REPLIED">Replied</option>
                <option value="CLOSED">Closed without reply</option>
              </select>
            </Field>
            <Field label="Reply sent to the visitor" htmlFor="fb-reply">
              <textarea id="fb-reply" rows={4} value={fbEditing.reply || ''} onChange={(e) => setFbEditing({ ...fbEditing, reply: e.target.value })} />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setFbEditing(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveFeedback}>Save</button>
            </div>
          </div>
        )}
      </Modal>
      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </div>
  );
}
