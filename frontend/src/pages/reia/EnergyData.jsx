import React, { useEffect, useState } from 'react';
import api from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, fmtNumber } from '../../components/ui.jsx';

const CAN_WRITE = ['SJVN_ADMIN', 'REIA_USER'];

const EMPTY_FORM = { contract_id: '', period_month: '', data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: '', cuf_percent: '', availability_percent: '' };

export default function EnergyData() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const [showUploadREA, setShowUploadREA] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [reaPeriod, setReaPeriod] = useState('');

  // REA Automation state
  const [reaStatus, setReaStatus] = useState(null);
  const [reaLog, setReaLog] = useState([]);
  const [showReaPanel, setShowReaPanel] = useState(false);
  const [triggerForm, setTriggerForm] = useState({ rpc: 'NRPC', period_month: '', data_type: 'PROVISIONAL' });
  const [triggering, setTriggering] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [reaMsg, setReaMsg] = useState('');

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.energyData.list(params).then(setRows).finally(() => setLoading(false));
  }

  useEffect(load, [filters.contract_id, filters.period_month, filters.status]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  function loadReaStatus() {
    api.energyData.reaStatus().then(setReaStatus).catch(() => {});
    api.energyData.reaLog().then(setReaLog).catch(() => {});
  }
  useEffect(() => { if (CAN_WRITE.includes(user?.role)) loadReaStatus(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await api.energyData.create({
        ...form,
        energy_mwh: Number(form.energy_mwh),
        cuf_percent: form.cuf_percent ? Number(form.cuf_percent) : null,
        availability_percent: form.availability_percent ? Number(form.availability_percent) : null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record energy data.');
    }
  }

  async function handleParseREA(e) {
    e.preventDefault();
    if (!uploadFile) return setError('Please select a PDF file');
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const data = await api.energyData.parseREA(fd);
      setParsedData(data.map(d => {
        let cid = '';
        if (d.station_id === 'NATHPA_JHAKRI') {
          const c = contracts.find(c => c.contract_no.includes('NJHEP'));
          if (c) cid = c.id;
        } else if (d.station_id === 'RAMPUR') {
          const c = contracts.find(c => c.contract_no.includes('RHEP'));
          if (c) cid = c.id;
        }
        return { ...d, contract_id: cid };
      }));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to parse REA');
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveParsed() {
    if (!reaPeriod) return setError('Please select a period month');
    const invalid = parsedData.find(d => !d.contract_id);
    if (invalid) return setError('Please assign a contract for all parsed stations');
    
    setUploading(true);
    try {
      for (const row of parsedData) {
        await api.energyData.create({
          contract_id: row.contract_id,
          period_month: reaPeriod,
          data_type: 'PROVISIONAL',
          source: 'REA',
          energy_mwh: row.energy_mwh,
          availability_percent: row.availability_percent,
        });
      }
      setShowUploadREA(false);
      setParsedData(null);
      setUploadFile(null);
      setReaPeriod('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save parsed data');
    } finally {
      setUploading(false);
    }
  }

  async function handleValidate(row) {
    await api.energyData.validate(row.id);
    load();
  }

  async function handleLock(row) {
    await api.energyData.lock(row.id);
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract' },
    { key: 'period_month', header: 'Period' },
    { key: 'data_type', header: 'Type', render: (r) => <Badge status={r.data_type} /> },
    { key: 'source', header: 'Source' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'cuf_percent', header: 'CUF %', render: (r) => r.cuf_percent != null ? `${fmtNumber(r.cuf_percent)}%` : '-' },
    { key: 'availability_percent', header: 'Availability %', render: (r) => r.availability_percent != null ? `${fmtNumber(r.availability_percent)}%` : '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    { key: 'deviation_notes', header: 'Notes', render: (r) => r.deviation_notes || '-' },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {r.status === 'DRAFT' && <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); handleValidate(r); }}>Validate</button>}
          {r.status === 'VALIDATED' && <button className="btn btn-success btn-sm" onClick={(e) => { e.stopPropagation(); handleLock(r); }}>Lock</button>}
        </div>
      ),
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Energy Data Accounting &amp; Validation"
        subtitle="Record metered generation, validate against contracted parameters and lock for billing"
        actions={CAN_WRITE.includes(user?.role) && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => setShowUploadREA(true)}>Upload REA PDF</button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Record Energy Data</button>
          </div>
        )}
      />

      <div className="filters-bar">
        <select value={filters.contract_id} onChange={(e) => setFilters({ ...filters, contract_id: e.target.value })}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
        </select>
        <input type="month" value={filters.period_month} onChange={(e) => setFilters({ ...filters, period_month: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {['DRAFT', 'VALIDATED', 'LOCKED', 'DISPUTED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No energy data records found.'} />
      </Card>

      {/* REA Automation Panel */}
      {CAN_WRITE.includes(user?.role) && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0, cursor: 'pointer' }} onClick={() => { setShowReaPanel(!showReaPanel); if (!showReaPanel) loadReaStatus(); }}>
              {showReaPanel ? '▼' : '▶'} REA Automation
            </h3>
            {showReaPanel && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" disabled={scanning} onClick={async () => {
                  setScanning(true); setReaMsg('');
                  try {
                    const res = await api.energyData.reaScan({});
                    const total = res.results?.reduce((s, r) => s + (r.records || 0), 0) || 0;
                    setReaMsg(`Scan complete! ${total} new record(s) imported.`);
                    loadReaStatus(); load();
                  } catch (err) { setReaMsg(err.response?.data?.error || 'Scan failed'); }
                  finally { setScanning(false); }
                }}>{scanning ? 'Scanning...' : '🔄 Scan All RPCs Now'}</button>
              </div>
            )}
          </div>

          {showReaPanel && (
            <Card>
              {reaMsg && <div style={{ padding: '8px 16px', background: '#f0f9ff', color: '#0369a1', fontSize: 13, borderBottom: '1px solid #e0f2fe' }}>{reaMsg}</div>}

              {/* RPC Status Cards */}
              {reaStatus && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: 16 }}>
                  {Object.entries(reaStatus).map(([key, rpc]) => (
                    <div key={key} style={{ flex: '1 1 280px', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <strong>{key}</strong>
                        <Badge status={rpc.latest_fetch?.status === 'PROCESSED' ? 'ACTIVE' : rpc.latest_fetch?.status === 'FAILED' ? 'REJECTED' : 'PENDING'} label={rpc.latest_fetch?.status || 'Never Run'} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{rpc.name}</div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
                        <div>✅ Processed: <strong>{rpc.total_processed}</strong></div>
                        <div>❌ Failed: <strong>{rpc.total_failed}</strong></div>
                      </div>
                      {rpc.latest_fetch && (
                        <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 6 }}>
                          Last: {rpc.latest_fetch.period_month} — {new Date(rpc.latest_fetch.fetched_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Manual Trigger Form */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label="RPC Source">
                  <select value={triggerForm.rpc} onChange={e => setTriggerForm({...triggerForm, rpc: e.target.value})} style={{ minWidth: 120 }}>
                    <option value="NRPC">NRPC</option>
                  </select>
                </Field>
                <Field label="Period Month">
                  <input type="month" value={triggerForm.period_month} onChange={e => setTriggerForm({...triggerForm, period_month: e.target.value})} />
                </Field>
                <Field label="Type">
                  <select value={triggerForm.data_type} onChange={e => setTriggerForm({...triggerForm, data_type: e.target.value})} style={{ minWidth: 120 }}>
                    <option value="PROVISIONAL">Provisional</option>
                    <option value="FINAL">Final</option>
                  </select>
                </Field>
                <button className="btn btn-primary btn-sm" disabled={triggering || !triggerForm.period_month} onClick={async () => {
                  setTriggering(true); setReaMsg('');
                  try {
                    const res = await api.energyData.reaTrigger(triggerForm);
                    setReaMsg(`Triggered! ${res.records} record(s) imported from ${res.parsedStations} station(s).`);
                    loadReaStatus(); load();
                  } catch (err) { setReaMsg(err.response?.data?.error || 'Trigger failed'); }
                  finally { setTriggering(false); }
                }}>{triggering ? 'Fetching...' : '⚡ Trigger Fetch'}</button>
              </div>

              {/* Fetch Log Table */}
              {reaLog.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  <div style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: 'var(--text-light)' }}>Fetch Audit Log</div>
                  <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>RPC</th>
                        <th>Period</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Records</th>
                        <th>Fetched</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reaLog.map(log => (
                        <tr key={log.id}>
                          <td>{log.rpc_source}</td>
                          <td>{log.period_month}</td>
                          <td><Badge status={log.data_type} /></td>
                          <td><Badge status={log.status === 'PROCESSED' ? 'ACTIVE' : log.status === 'FAILED' ? 'REJECTED' : log.status} label={log.status} /></td>
                          <td>{log.records_created}</td>
                          <td>{new Date(log.fetched_at).toLocaleString()}</td>
                          <td style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.error_message || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Record Energy Data" width={560}>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleCreate}>
          <Field label="Contract">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type})</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Period (Month)">
              <input required type="month" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} />
            </Field>
            <Field label="Data Type">
              <select value={form.data_type} onChange={(e) => setForm({ ...form, data_type: e.target.value })}>
                <option value="PROVISIONAL">Provisional</option>
                <option value="FINAL">Final</option>
              </select>
            </Field>
            <Field label="Source">
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {['MANUAL', 'REA', 'RLDC', 'SLDC', 'JMR'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Energy (MWh)">
              <input required type="number" step="0.01" value={form.energy_mwh} onChange={(e) => setForm({ ...form, energy_mwh: e.target.value })} />
            </Field>
            <Field label="CUF (%)">
              <input type="number" step="0.01" value={form.cuf_percent} onChange={(e) => setForm({ ...form, cuf_percent: e.target.value })} />
            </Field>
            <Field label="Availability (%)">
              <input type="number" step="0.01" value={form.availability_percent} onChange={(e) => setForm({ ...form, availability_percent: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </Modal>

      <Modal open={showUploadREA} onClose={() => { setShowUploadREA(false); setParsedData(null); setUploadFile(null); setReaPeriod(''); }} title="Upload NRPC REA PDF" width={800}>
        {error && <div className="form-error">{error}</div>}
        
        {!parsedData ? (
          <form onSubmit={handleParseREA}>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <Field label="REA PDF Document">
                <input type="file" accept=".pdf" onChange={e => setUploadFile(e.target.files[0])} />
              </Field>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowUploadREA(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!uploadFile || uploading}>{uploading ? 'Parsing...' : 'Parse Data'}</button>
            </div>
          </form>
        ) : (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Field label="Apply to Period (Month)">
                <input required type="month" value={reaPeriod} onChange={e => setReaPeriod(e.target.value)} />
              </Field>
            </div>
            <Table 
              columns={[
                { key: 'station_name', header: 'Station' },
                { key: 'availability_percent', header: 'PAF (%)', render: r => fmtNumber(r.availability_percent) },
                { key: 'energy_mwh', header: 'Scheduled Energy (MWh)', render: r => fmtNumber(r.energy_mwh) },
                { key: 'contract', header: 'Assign Contract', render: (r, idx) => (
                  <select 
                    value={r.contract_id} 
                    onChange={e => {
                      const newData = [...parsedData];
                      newData[idx].contract_id = e.target.value;
                      setParsedData(newData);
                    }}
                    style={{ padding: '4px 8px', fontSize: 13 }}
                  >
                    <option value="">Select contract...</option>
                    {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
                  </select>
                )}
              ]}
              rows={parsedData}
            />
            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setParsedData(null)}>Back</button>
              <button type="button" className="btn btn-primary" onClick={handleSaveParsed} disabled={uploading}>
                {uploading ? 'Saving...' : 'Save All Records'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
