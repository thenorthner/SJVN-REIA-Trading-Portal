import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { PageHeader, Card, Table, Badge } from '../components/ui.jsx';

const PayloadViewer = ({ data }) => {
  if (!data) return null;
  const entries = Object.entries(data);
  if (entries.length === 0) return <span style={{ color: '#888' }}>Empty</span>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
      {entries.map(([k, v]) => {
        let displayValue = String(v);
        if (v === null || v === undefined) displayValue = '-';
        else if (typeof v === 'boolean') displayValue = v ? 'Yes' : 'No';
        else if (typeof v === 'object') displayValue = JSON.stringify(v);

        return (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: 12, color: '#64748b', textTransform: 'capitalize', fontWeight: 600 }}>{k.replace(/_/g, ' ')}</span>
            <span style={{ fontSize: 14, color: '#0f172a', wordBreak: 'break-word', background: '#fff', padding: '6px 10px', borderRadius: 4, border: '1px solid #e2e8f0' }}>{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
};

export default function AuditLogs() {
  const [rows, setRows] = useState([]);
  const [module, setModule] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  
  const [sodViolations, setSodViolations] = useState([]);
  const [integrityStatus, setIntegrityStatus] = useState(null); // null, { isValid, message, brokenAtIndex }
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [module]);

  useEffect(() => {
    // Fetch SoD violations on mount
    api.auditLogs.violationsSod().then(setSodViolations).catch(console.error);
  }, []);

  const fetchLogs = () => {
    setLoading(true);
    api.auditLogs.list(module ? { module } : undefined).then(setRows).finally(() => setLoading(false));
  };

  const handleVerifyIntegrity = async () => {
    setVerifying(true);
    try {
      const res = await api.auditLogs.verifyIntegrity();
      setIntegrityStatus(res);
      fetchLogs(); // Reload logs to show the verification log entry
    } catch (e) {
      setIntegrityStatus({ isValid: false, message: 'Server error during verification.' });
    }
    setVerifying(false);
  };

  const handleExport = () => {
    // In a real app, we'd trigger a CSV download.
    // Here we just log it and show an alert.
    api.auditLogs.logExport({ module: module || 'ALL', count: rows.length }).then(() => {
      alert(`Exported ${rows.length} logs successfully.`);
      fetchLogs();
    });
  };

  const columns = [
    { key: 'created_at', header: 'Timestamp', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'trace_id', header: 'Trace ID', render: (r) => <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.trace_id}</span> },
    { key: 'user_name', header: 'User', render: (r) => <div>{r.user_name}<div style={{ fontSize: 10, color: '#666' }}>{r.user_role}</div></div> },
    { key: 'action', header: 'Action', render: (r) => <Badge status={r.action} /> },
    { key: 'module', header: 'Module' },
    { key: 'entity_id', header: 'Entity Ref', render: (r) => r.entity_id || '-' },
    { key: 'ip_address', header: 'IP Address', render: (r) => r.ip_address || 'system' },
    { key: 'details', header: 'Diff / Details', render: (r) => (
      <button className="link-btn" onClick={() => setExpanded(r)}>Inspect</button>
    ) },
  ];

  return (
    <div>
      <PageHeader 
        title="Audit Trail & Compliance" 
        subtitle="Cryptographically secured, append-only traceability of all platform activities." 
      />

      {/* Integrity & SoD Alerts */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <Card style={{ flex: 1, borderLeft: integrityStatus && !integrityStatus.isValid ? '4px solid #ef4444' : '4px solid #10b981' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ margin: '0 0 5px 0' }}>Cryptographic Hash Chain</h3>
              <div style={{ color: '#666', fontSize: 14 }}>
                {integrityStatus ? (
                  integrityStatus.isValid ? <span style={{ color: '#10b981', fontWeight: 600 }}>{integrityStatus.message}</span> : <span style={{ color: '#ef4444', fontWeight: 600 }}>{integrityStatus.message}</span>
                ) : 'Chain integrity not verified yet.'}
              </div>
            </div>
            <button className="btn btn-ghost" onClick={handleVerifyIntegrity} disabled={verifying}>
              {verifying ? 'Verifying...' : 'Verify DB Integrity'}
            </button>
          </div>
        </Card>

        <Card style={{ flex: 1, borderLeft: sodViolations.length > 0 ? '4px solid #ef4444' : '4px solid #10b981' }}>
          <h3 style={{ margin: '0 0 5px 0' }}>Segregation of Duties (SoD)</h3>
          <div style={{ color: '#666', fontSize: 14 }}>
            {sodViolations.length > 0 ? (
              <span style={{ color: '#ef4444', fontWeight: 600 }}>{sodViolations.length} SoD Violations Detected! (Maker = Checker)</span>
            ) : (
              <span style={{ color: '#10b981', fontWeight: 600 }}>0 Violations Detected. Complete adherence to Maker/Checker rules.</span>
            )}
          </div>
        </Card>
      </div>

      <div className="filters-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={module} onChange={(e) => setModule(e.target.value)} className="input-field" style={{ width: 250 }}>
            <option value="">All modules</option>
            <option value="AUTH">Auth</option>
            <option value="REIA">REIA Billing &amp; Settlement</option>
            <option value="TRADING">Power Trading</option>
            <option value="SYSTEM">System / Infrastructure</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={handleExport}>Export Evidence (PDF/CSV)</button>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No audit records found.'} />
      </Card>

      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(null)}>
          <div className="modal" style={{ maxWidth: 800, width: '90%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Audit Detail: {expanded.id}</h3>
              <button className="icon-btn" onClick={() => setExpanded(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200, padding: 12, background: '#f8fafc', borderRadius: 6 }}>
                  <strong>Action:</strong> <Badge status={expanded.action} /><br/><br/>
                  <strong>Module:</strong> {expanded.module}<br/><br/>
                  <strong>Entity ID:</strong> {expanded.entity_id || '-'}<br/><br/>
                  <strong>Reason/Comment:</strong> {expanded.reason || 'N/A'}
                </div>
                <div style={{ flex: 1, minWidth: 200, padding: 12, background: '#f8fafc', borderRadius: 6 }}>
                  <strong>User:</strong> {expanded.user_name} ({expanded.user_id})<br/><br/>
                  <strong>Role:</strong> {expanded.user_role}<br/><br/>
                  <strong>IP / Session:</strong> {expanded.ip_address || 'system'} / {expanded.session_id || '-'}<br/><br/>
                  <strong>Timestamp:</strong> {new Date(expanded.created_at).toLocaleString()}
                </div>
              </div>

              {(expanded.before_value || expanded.after_value) && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ borderBottom: '1px solid #eee', paddingBottom: 8, marginBottom: 12 }}>Data Diff</h4>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {expanded.before_value && (
                      <div style={{ flex: 1 }}>
                        <div style={{ background: '#fef2f2', color: '#991b1b', padding: '4px 8px', fontSize: 12, fontWeight: 600, borderTopLeftRadius: 6, borderTopRightRadius: 6 }}>Before</div>
                        <pre style={{ margin: 0, padding: 12, background: '#f8fafc', border: '1px solid #eee', borderBottomLeftRadius: 6, borderBottomRightRadius: 6, fontSize: 11, overflowX: 'auto' }}>
                          {JSON.stringify(JSON.parse(expanded.before_value), null, 2)}
                        </pre>
                      </div>
                    )}
                    {expanded.after_value && (
                      <div style={{ flex: 1 }}>
                        <div style={{ background: '#f0fdf4', color: '#166534', padding: '4px 8px', fontSize: 12, fontWeight: 600, borderTopLeftRadius: 6, borderTopRightRadius: 6 }}>After</div>
                        <pre style={{ margin: 0, padding: 12, background: '#f8fafc', border: '1px solid #eee', borderBottomLeftRadius: 6, borderBottomRightRadius: 6, fontSize: 11, overflowX: 'auto' }}>
                          {JSON.stringify(JSON.parse(expanded.after_value), null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {expanded.details && (
                <div style={{ marginBottom: 20 }}>
                  <h4 style={{ borderBottom: '1px solid #eee', paddingBottom: 8, marginBottom: 12 }}>Payload / Details</h4>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 16 }}>
                    <PayloadViewer data={JSON.parse(expanded.details)} />
                  </div>
                </div>
              )}

              <div style={{ padding: 12, background: '#f1f5f9', borderRadius: 6 }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: 12, textTransform: 'uppercase', color: '#64748b' }}>Cryptographic Proof</h4>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', wordBreak: 'break-all' }}>
                  <strong>Previous Hash:</strong> {expanded.prev_hash}<br/>
                  <strong>Current Hash:</strong> {expanded.curr_hash}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
