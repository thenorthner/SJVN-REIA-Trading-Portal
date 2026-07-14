import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { PageHeader, Card, Table } from '../components/ui.jsx';

export default function AuditLogs() {
  const [rows, setRows] = useState([]);
  const [module, setModule] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.auditLogs.list(module ? { module } : undefined).then(setRows).finally(() => setLoading(false));
  }, [module]);

  const columns = [
    { key: 'created_at', header: 'Timestamp' },
    { key: 'user_name', header: 'User' },
    { key: 'action', header: 'Action' },
    { key: 'module', header: 'Module' },
    { key: 'entity_type', header: 'Entity', render: (r) => r.entity_type || '-' },
    { key: 'entity_id', header: 'Entity ID', render: (r) => r.entity_id || '-' },
    { key: 'details', header: 'Details', render: (r) => (r.details ? <button className="link-btn" onClick={() => setExpanded(r)}>View</button> : '-') },
  ];

  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Complete traceability of all actions performed across the platform" />

      <div className="filters-bar">
        <select value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="">All modules</option>
          <option value="AUTH">Auth</option>
          <option value="REIA">REIA Billing &amp; Settlement</option>
          <option value="TRADING">Power Trading</option>
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No audit records found.'} />
      </Card>

      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{expanded.action} — {expanded.module}</h3>
              <button className="icon-btn" onClick={() => setExpanded(null)}>✕</button>
            </div>
            <div className="modal-body">
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 8 }}>
                {JSON.stringify(JSON.parse(expanded.details || '{}'), null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
