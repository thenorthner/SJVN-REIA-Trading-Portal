import React, { useEffect, useState } from 'react';
import { PageHeader, Card, Table, Badge, Modal, Field, AlertPopup, Tabs, Tab } from '../../components/ui.jsx';
import api from '../../api/client.js';
import { fmtDateTime } from '../../datetime.js';
import { REQUEST_TYPES } from '../../gigw/PrivacyPanel.jsx';

/**
 * The Data Protection Officer's desk: data-principal requests (DPDP Act 2023)
 * to acknowledge and close, and the register of statutory declarations made on
 * critical submissions, with who, when, from where and on what.
 */
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'];
const TYPE_LABEL = Object.fromEntries(REQUEST_TYPES.map((t) => [t.value, t.label.split(' —')[0].split(' /')[0]]));

export default function PrivacyRequests() {
  const [tab, setTab] = useState('requests');
  const [rows, setRows] = useState([]);
  const [decls, setDecls] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [popup, setPopup] = useState(null);

  const load = () => {
    api.privacy.allRequests(status ? { status } : undefined).then(setRows).catch(() => setRows([]));
    api.privacy.declarations({ limit: 500 }).then(setDecls).catch(() => setDecls([]));
  };
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
      <PageHeader title="Data requests & declarations" subtitle="DPDP Act 2023 data-principal requests, and the statutory declaration register" />
      <Tabs>
        <Tab active={tab === 'requests'} onClick={() => setTab('requests')}>Data-principal requests</Tab>
        <Tab active={tab === 'declarations'} onClick={() => setTab('declarations')}>Declaration register</Tab>
      </Tabs>

      {tab === 'requests' && (
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

      {tab === 'declarations' && (
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
      <AlertPopup open={!!popup} {...(popup || {})} onClose={() => setPopup(null)} />
    </div>
  );
}
