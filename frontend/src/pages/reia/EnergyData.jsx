import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import EnergyOverview from '../../components/EnergyOverview.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, Tabs, Tab, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';
import { SettlementTrailPanel, BfrChip } from '../../components/SettlementTrail.jsx';
import ReaAutomationPipeline from '../../components/ReaAutomationPipeline.jsx';
import EnergyAccountUpload from '../../components/EnergyAccountUpload.jsx';
import BusbarLossPipeline3D from '../../components/BusbarLossPipeline3D.jsx';
import EnergyRecordDetail, { ResponseBadge } from '../../components/EnergyRecordDetail.jsx';
import { fmtDateTime } from '../../datetime.js';
import { ROLE_GROUPS } from '../../roles.js';

// The server's REIA_WRITE group; a shorter copy here hid the buttons from REIA_ADMIN.
const CAN_WRITE = ROLE_GROUPS.REIA_WRITE;

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

const EMPTY_FORM = { contract_id: '', period_month: '', data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: '', cuf_percent: '', availability_percent: '', peak_availability_percent: '' };

export default function EnergyData() {
  const [view, setView] = useState('main');
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  // What went wrong on the page, and what was just done — said here, not in a browser pop-up.
  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');
  // A lock the server will only take with a recorded reason.
  const [lockAsk, setLockAsk] = useState(null);
  const [lockReason, setLockReason] = useState('');
  const [lockError, setLockError] = useState('');
  const [busy, setBusyState] = useState(false);
  const lock = useRef(false);
  const setBusy = (on) => { lock.current = on; setBusyState(on); };
  const errOf = (err, fallback) => err?.response?.data?.error || err?.message || fallback;

  const [showUploadREA, setShowUploadREA] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [reaPeriod, setReaPeriod] = useState('');
  const [showAccountUpload, setShowAccountUpload] = useState(false);
  const [accountResult, setAccountResult] = useState(null);

  // REA Automation state
  const [reaStatus, setReaStatus] = useState(null);
  const [reaLog, setReaLog] = useState([]);
  const [showReaPanel, setShowReaPanel] = useState(true);
  const [triggerForm, setTriggerForm] = useState({ rpc: 'NRPC', period_month: lastMonth(), data_type: 'PROVISIONAL' });
  const [triggering, setTriggering] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [reaMsg, setReaMsg] = useState('');
  const [trailEnergyId, setTrailEnergyId] = useState(null);
  // The record whose source document, blocks and counterparty answer are open.
  const [recordId, setRecordId] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Live Step-by-Step Pipeline Monitor State
  const [showPipelineMonitor, setShowPipelineMonitor] = useState(false);
  const [pipelineMode, setPipelineMode] = useState('TRIGGER');
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [pipelineError, setPipelineError] = useState(null);

  async function downloadEnergyPdf() {
    setPdfLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.period_month) {
        params.from = filters.period_month;
        params.to = filters.period_month;
      }
      if (filters.contract_id) params.contract_id = filters.contract_id;
      await api.reports.energySummaryPdf(params);
    } catch (err) {
      setPageError(errOf(err, 'Failed to download energy PDF report'));
    } finally {
      setPdfLoading(false);
    }
  }

  function load() {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    return api.energyData.list(params).then(setRows).catch((err) => setPageError(errOf(err, 'The energy records could not be loaded.'))).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.contract_id, filters.period_month, filters.status]);
  useEffect(() => { api.contracts.list().then(setContracts).catch(() => {}); }, []);

  function loadReaStatus() {
    api.energyData.reaStatus().then(setReaStatus).catch(() => {});
    api.energyData.reaLog().then(setReaLog).catch(() => {});
  }
  useEffect(() => { if (CAN_WRITE.includes(user?.role)) loadReaStatus(); }, []);

  function openCreate() { setForm(EMPTY_FORM); setError(''); setShowCreate(true); }
  function openUploadRea() { setError(''); setParsedData(null); setUploadFile(null); setReaPeriod(''); setShowUploadREA(true); }

  async function handleCreate(e) {
    e.preventDefault();
    if (lock.current) return;
    setError('');
    setBusy(true);
    try {
      const made = await api.energyData.create({
        ...form,
        energy_mwh: Number(form.energy_mwh),
        cuf_percent: form.cuf_percent ? Number(form.cuf_percent) : null,
        availability_percent: form.availability_percent ? Number(form.availability_percent) : null,
        peak_availability_percent: form.peak_availability_percent ? Number(form.peak_availability_percent) : null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setPageError('');
      setNotice(made.replaced
        ? `The ${made.period_month} figure was corrected to ${fmtNumber(made.energy_mwh)} MWh and is a draft again. Validate it before it can be locked.`
        : `${fmtNumber(made.energy_mwh)} MWh recorded for ${made.period_month} as a draft. Validate it before it can be locked.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record energy data.');
    } finally {
      setBusy(false);
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
        const stName = (d.station_name || '').toUpperCase();
        const stId = (d.station_id || '').toUpperCase();
        if (stId.includes('NATHPA') || stName.includes('NATHPA') || stName.includes('JHAKRI')) {
          const c = contracts.find(c => c.contract_no.includes('NJHPS') || c.contract_no.includes('NJHEP') || c.contract_no.includes('NJH'));
          if (c) cid = c.id;
        } else if (stId.includes('RAMPUR') || stName.includes('RAMPUR')) {
          const c = contracts.find(c => c.contract_no.includes('RHPS') || c.contract_no.includes('RHEP') || c.contract_no.includes('RAMPUR'));
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
    if (lock.current) return;
    setBusy(true);
    setPageError('');
    try {
      const done = await api.energyData.validate(row.id);
      setNotice(done.status === 'VALIDATED'
        ? `${row.contract_no} ${row.period_month} validated. It has gone to the counterparty to confirm, and can now be locked.`
        : `${row.contract_no} ${row.period_month} failed validation and is marked DISPUTED — ${done.deviation_notes || 'see the Notes column'}.`);
    } catch (err) {
      setNotice('');
      setPageError(errOf(err, 'This period could not be validated.'));
    } finally {
      setBusy(false);
    }
    load();
  }

  // Locking can be refused — an unvalidated period, or one the counterparty has
  // objected to. The refusal is shown; where a recorded reason lets the lock go
  // ahead anyway, the reason is asked for in the page.
  async function handleLock(row, reason) {
    if (lock.current) return;
    setBusy(true);
    setPageError('');
    setLockError('');
    try {
      await api.energyData.lock(row.id, reason ? { override_reason: reason } : undefined);
      setLockAsk(null);
      setLockReason('');
      setNotice(`${row.contract_no} ${row.period_month} locked for billing${reason ? ', with the reason on record' : ''}.${row.response_status === 'ACCEPTED' ? '' : ' The counterparty had not accepted this figure; it has been told it is locked.'}`);
    } catch (err) {
      const data = err.response?.data || {};
      if (data.hint && !reason) {
        setLockAsk({ row, error: data.error, objection: data.objection, validation: data.validation_note });
        setLockReason('');
      } else if (reason) {
        setLockError(data.error || 'Could not lock this period');
      } else {
        setNotice('');
        setPageError(data.error || 'Could not lock this period');
      }
    } finally {
      setBusy(false);
    }
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract' },
    { key: 'period_month', header: 'Period' },
    { key: 'billing_family_ref', header: 'BFR', render: (r) => (
      <BfrChip bfr={r.billing_family_ref} onClick={() => setTrailEnergyId(r.id)} />
    )},
    { key: 'data_type', header: 'Type', render: (r) => <Badge status={r.data_type} /> },
    { key: 'source', header: 'Source' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => fmtNumber(r.energy_mwh) },
    { key: 'cuf_percent', header: 'CUF %', render: (r) => r.cuf_percent != null ? `${fmtNumber(r.cuf_percent)}%` : '-' },
    { key: 'availability_percent', header: 'Availability %', render: (r) => r.availability_percent != null ? `${fmtNumber(r.availability_percent)}%` : '-' },
    { key: 'peak_availability_percent', header: 'Peak Avail. %', render: (r) => r.peak_availability_percent != null ? `${fmtNumber(r.peak_availability_percent)}%` : '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    // What the seller or buyer has said to the figure: accepted, objected, or not yet answered.
    { key: 'response', header: 'Counterparty', render: (r) => (r.is_superseded ? <span style={{ color: 'var(--slate-500)', fontSize: 12 }}>Replaced by final</span> : <ResponseBadge row={r} />) },
    { key: 'deviation_notes', header: 'Notes', render: (r) => r.deviation_notes || '-' },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {['DRAFT', 'DISPUTED'].includes(r.status) && !r.is_superseded && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); handleValidate(r); }}>{r.status === 'DISPUTED' ? 'Re-validate' : 'Validate'}</button>}
          {['VALIDATED', 'DISPUTED'].includes(r.status) && !r.is_superseded && <button className="btn btn-success btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); handleLock(r); }}>Lock</button>}
          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setTrailEnergyId(r.id); }}>Trail</button>
          <button className="btn btn-outline btn-sm" title="Source document, 15-minute blocks and the counterparty's answer" onClick={(e) => { e.stopPropagation(); setRecordId(r.id); }}>Record</button>
        </div>
      ),
    }] : [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setTrailEnergyId(r.id); }}>Trail</button>
          <button className="btn btn-outline btn-sm" title="Source document, 15-minute blocks and the counterparty's answer" onClick={(e) => { e.stopPropagation(); setRecordId(r.id); }}>Record</button>
        </div>
      ),
    }]),
  ];

  return (
    <div>
      <PageHeader
        title="Energy Data Accounting & Validation"
        subtitle="Record metered generation, validate against contracted parameters and lock for billing"
        actions={view === 'main' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pdfLoading}
              onClick={downloadEnergyPdf}
            >
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Report'}
            </button>
            {CAN_WRITE.includes(user?.role) && (
              <>
                <button className="btn btn-secondary" onClick={openUploadRea}>Upload REA PDF</button>
                <button className="btn btn-secondary" onClick={() => { setAccountResult(null); setShowAccountUpload(true); }}>Upload JMR / SEA</button>
                <button className="btn btn-secondary" onClick={openCreate}>+ Record Energy Data</button>
              </>
            )}
          </div>
        )}
      />

      <Tabs style={{ marginBottom: 18 }}>
        <Tab active={view === 'main'} onClick={() => setView('main')}>Periods</Tab>
        <Tab active={view === 'fyi'} onClick={() => setView('fyi')}>FYI</Tab>
      </Tabs>

      {view === 'fyi' && <ModuleGuide guide={getGuide('energy')} />}

      {view === 'main' && (
      <>
      {pageError && <div className="form-error" role="alert">{pageError}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {accountResult && (
        <div className="alert alert-success" role="status">
          {accountResult.account_label} {accountResult.file_name ? `(${accountResult.file_name}) ` : ''}imported:
          {' '}{accountResult.created} new, {accountResult.replaced} replacing a draft, {accountResult.skipped} left alone — all as DRAFT, to validate before locking.
        </div>
      )}

      <BusbarLossPipeline3D
        selectedContractId={filters.contract_id}
        contracts={contracts}
      />

      <EnergyOverview contractId={filters.contract_id} rows={rows} />

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
        {(filters.contract_id || filters.period_month || filters.status) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ contract_id: '', period_month: '', status: '' })}>Clear filters</button>
        )}
      </div>

      <Card>
        <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No energy data records found.'} />
      </Card>

      {/* REA Automation Panel */}
      {CAN_WRITE.includes(user?.role) && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setShowReaPanel(!showReaPanel); if (!showReaPanel) loadReaStatus(); }}>
              <span>{showReaPanel ? '▼' : '▶'}</span> REA Automation & Regional Power Committee Pipeline
            </h3>
            {showReaPanel && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #cbd5e1' }}
                  onClick={() => {
                    setPipelineMode('DEMO');
                    setPipelineResult(null);
                    setPipelineError(null);
                    setShowPipelineMonitor(true);
                    setPipelineRunning(true);
                  }}
                  title="Simulate and visualize each step of the automated REA pipeline"
                >
                  <span>👁️</span> Explore Step-by-Step Flow
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={scanning || pipelineRunning}
                  onClick={async () => {
                    setScanning(true);
                    setPipelineRunning(true);
                    setPipelineMode('SCAN');
                    setPipelineResult(null);
                    setPipelineError(null);
                    setShowPipelineMonitor(true);
                    setReaMsg('');
                    try {
                      const res = await api.energyData.reaScan({});
                      const total = res.results?.reduce((s, r) => s + (r.records || 0), 0) || 0;
                      setPipelineResult({ records: total, parsedStations: 2, success: true });
                      setReaMsg(`Scan complete! ${total} new record(s) imported.`);
                      loadReaStatus();
                      load();
                    } catch (err) {
                      const errMsg = err.response?.data?.error || 'Scan failed';
                      setPipelineError(errMsg);
                      setReaMsg(errMsg);
                    } finally {
                      setScanning(false);
                      setPipelineRunning(false);
                    }
                  }}
                >
                  {scanning ? 'Scanning All RPCs...' : 'Scan All RPCs Now'}
                </button>
              </div>
            )}
          </div>

          {showReaPanel && (
            <>
              {/* Live Step-by-Step Pipeline Monitor */}
              {showPipelineMonitor && (
                <ReaAutomationPipeline
                  isRunning={pipelineRunning}
                  mode={pipelineMode}
                  rpcSource={triggerForm.rpc || 'NRPC'}
                  periodMonth={triggerForm.period_month || lastMonth()}
                  dataType={triggerForm.data_type || 'PROVISIONAL'}
                  result={pipelineResult}
                  error={pipelineError}
                  onClose={() => setShowPipelineMonitor(false)}
                  onViewRecords={() => {
                    if (triggerForm.period_month) {
                      setFilters(prev => ({ ...prev, period_month: triggerForm.period_month }));
                    }
                    setShowPipelineMonitor(false);
                  }}
                  onReRun={() => {
                    setPipelineResult(null);
                    setPipelineError(null);
                    setPipelineRunning(true);
                  }}
                />
              )}

              <Card>
                {reaMsg && <div style={{ padding: '8px 16px', background: '#f0f9ff', color: '#0369a1', fontSize: 13, borderBottom: '1px solid #e0f2fe' }}>{reaMsg}</div>}

                {/* Embedded Visual Interactive Pipeline Banner */}
                <div style={{ padding: '16px', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg> Regional REA Automated Ingestion Pipeline
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        Fully automated 6-stage ingestion engine: Discovery → Retrieval → Extraction → Validation → Settlement Commit
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 4px rgba(37,99,235,0.2)' }}
                        onClick={() => {
                          setPipelineMode('DEMO');
                          setPipelineResult(null);
                          setPipelineError(null);
                          setShowPipelineMonitor(true);
                          setPipelineRunning(true);
                        }}
                      >
                        <span>▶</span> Watch Live Step-by-Step Animation
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        style={{ background: '#ffffff' }}
                        onClick={() => setShowPipelineMonitor(!showPipelineMonitor)}
                      >
                        {showPipelineMonitor ? 'Hide Pipeline Monitor ▲' : 'Open Pipeline Monitor ▼'}
                      </button>
                    </div>
                  </div>

                  {/* 6 Stage Interactive Pills */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 10 }}>
                    {[
                      { num: '1', title: 'TLS Handshake', sub: 'nrpc.gov.in', icon: '🌐' },
                      { num: '2', title: 'Bulletin Scan', sub: 'REA Gazette', icon: '🔍' },
                      { num: '3', title: 'PDF Ingest', sub: 'Audit Vault', icon: '📥' },
                      { num: '4', title: 'OCR & Parser', sub: 'Scheduled MWh', icon: '⚙️' },
                      { num: '5', title: 'BFR Match', sub: 'PPA Contracts', icon: '⚖️' },
                      { num: '6', title: 'Ledger Commit', sub: 'Immutable Sync', icon: '💾' },
                    ].map((st) => (
                      <div
                        key={st.num}
                        onClick={() => {
                          setPipelineMode('DEMO');
                          setPipelineResult(null);
                          setPipelineError(null);
                          setShowPipelineMonitor(true);
                          setPipelineRunning(true);
                        }}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          padding: '8px 10px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                        }}
                        title="Click to view full animated pipeline"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 14 }}>{st.icon}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, background: '#e0f2fe', color: '#0284c7', padding: '1px 5px', borderRadius: 10 }}>Step {st.num}</span>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{st.title}</div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>{st.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* RPC Status Cards */}
                {reaStatus && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: 16 }}>
                    {Object.entries(reaStatus).map(([key, rpc]) => (
                      <div key={key} style={{ flex: '1 1 280px', border: '1px solid var(--border)', borderRadius: 8, padding: 16, background: '#ffffff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <strong style={{ fontSize: 15 }}>{key}</strong>
                          <Badge status={rpc.latest_fetch?.status === 'PROCESSED' ? 'ACTIVE' : rpc.latest_fetch?.status === 'FAILED' ? 'REJECTED' : 'PENDING'} label={rpc.latest_fetch?.status || 'Never Run'} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-light)' }}>{rpc.name}</div>
                        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
                          <div>Processed: <strong>{rpc.total_processed}</strong></div>
                          <div>Failed: <strong>{rpc.total_failed}</strong></div>
                        </div>
                        {rpc.latest_fetch && (
                          <div style={{ fontSize: 11, color: 'var(--text-light)', marginTop: 6 }}>
                            Last: {rpc.latest_fetch.period_month} — {fmtDateTime(rpc.latest_fetch.fetched_at)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Manual Trigger Form */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', background: '#fafbfc' }}>
                  <Field label="RPC Source">
                    <select value={triggerForm.rpc} onChange={e => setTriggerForm({...triggerForm, rpc: e.target.value})} style={{ minWidth: 120 }}>
                      <option value="NRPC">NRPC (Northern Regional)</option>
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
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={triggering || pipelineRunning || !triggerForm.period_month}
                    onClick={async () => {
                      setTriggering(true);
                      setPipelineRunning(true);
                      setPipelineMode('TRIGGER');
                      setPipelineResult(null);
                      setPipelineError(null);
                      setShowPipelineMonitor(true);
                      setReaMsg('');
                      try {
                        const res = await api.energyData.reaTrigger(triggerForm);
                        setPipelineResult(res);
                        setReaMsg(`Triggered! ${res.records} record(s) imported from ${res.parsedStations} station(s).`);
                        loadReaStatus();
                        load();
                      } catch (err) {
                        const errMsg = err.response?.data?.error || 'Trigger failed';
                        setPipelineError(errMsg);
                        setReaMsg(errMsg);
                      } finally {
                        setTriggering(false);
                        setPipelineRunning(false);
                      }
                    }}
                  >
                    {triggering ? 'Fetching & Processing...' : 'Trigger Fetch'}
                  </button>
                </div>

                {/* Fetch Log Table */}
                {reaLog.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    <div style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, color: 'var(--text-light)' }}>Fetch Audit Log</div>
                    <table className="data-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th scope="col">RPC</th>
                          <th scope="col">Period</th>
                          <th scope="col">Type</th>
                          <th scope="col">Status</th>
                          <th scope="col">Records</th>
                          <th scope="col">Fetched</th>
                          <th scope="col">Error</th>
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
                          <td>{fmtDateTime(log.fetched_at)}</td>
                          <td style={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.error_message || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    )}

      </>
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
            {/* Only a contract with a peak obligation is billed on this, but the
                account reports it either way, so it is recorded either way. */}
            <Field label="Peak-window Availability (%)">
              <input
                type="number" step="0.01" min="0" max="100"
                placeholder="As the energy account reports the peak window"
                value={form.peak_availability_percent}
                onChange={(e) => setForm({ ...form, peak_availability_percent: e.target.value })}
              />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
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

      <Modal open={showAccountUpload} onClose={() => setShowAccountUpload(false)} title="Upload JMR / State Energy Account" width={960}>
        {showAccountUpload && (
          <EnergyAccountUpload
            onCancel={() => setShowAccountUpload(false)}
            onDone={(result) => { setShowAccountUpload(false); setAccountResult(result); load(); }}
          />
        )}
      </Modal>

      <Modal open={!!lockAsk} onClose={() => setLockAsk(null)} title="Lock this period as it stands?" width={560}>
        {lockAsk && (
          <form onSubmit={(e) => { e.preventDefault(); handleLock(lockAsk.row, lockReason.trim()); }}>
            <div className="alert alert-error" style={{ fontSize: 13.5 }}>
              <strong>{lockAsk.row.contract_no} · {lockAsk.row.period_month}</strong> — {lockAsk.error}
              {lockAsk.objection && <div style={{ marginTop: 6 }}>Their objection: {lockAsk.objection}</div>}
              {lockAsk.validation && <div style={{ marginTop: 6 }}>Validation: {lockAsk.validation}</div>}
            </div>
            {lockError && <div className="form-error" role="alert">{lockError}</div>}
            <Field label="Reason for locking it anyway (kept on record, and the desk is told)" required>
              <textarea required rows={3} value={lockReason} onChange={(e) => setLockReason(e.target.value)} style={{ width: '100%' }} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setLockAsk(null)}>Cancel</button>
              <button type="submit" className="btn btn-danger" disabled={busy || !lockReason.trim()}>{busy ? 'Locking…' : 'Lock with this reason'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!trailEnergyId} onClose={() => setTrailEnergyId(null)} title="Settlement Trail & Pipeline" width="90vw">
        {trailEnergyId && <SettlementTrailPanel energyId={trailEnergyId} />}
      </Modal>

      <Modal open={!!recordId} onClose={() => setRecordId(null)} title="Energy record" width={940}>
        {recordId && <EnergyRecordDetail key={recordId} id={recordId} onChanged={load} />}
      </Modal>
    </div>
  );
}
