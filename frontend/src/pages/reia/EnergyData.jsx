import React, { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import EnergyOverview from '../../components/EnergyOverview.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, Table, Badge, Modal, Field, Tabs, Tab, AlertPopup, fmtNumber } from '../../components/ui.jsx';
import ModuleGuide from '../../components/ModuleGuide.jsx';
import { getGuide } from '../../content/guides/index.js';
import { SettlementTrailPanel, BfrChip } from '../../components/SettlementTrail.jsx';
import ReaAutomationPipeline from '../../components/ReaAutomationPipeline.jsx';
import EnergyAccountUpload from '../../components/EnergyAccountUpload.jsx';
import EnergyRecordDetail, { ResponseBadge } from '../../components/EnergyRecordDetail.jsx';
import { fmtDateTime } from '../../datetime.js';
import DeskTasksPanel from '../../components/DeskTasksPanel.jsx';
import { ROLE_GROUPS } from '../../roles.js';

// The server's REIA_WRITE group; a shorter copy here hid the buttons from REIA_ADMIN.
const CAN_WRITE = ROLE_GROUPS.REIA_WRITE;

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const hoursIn = (ym) => { const [y, m] = String(ym).split('-').map(Number); return y && m ? new Date(Date.UTC(y, m, 0)).getUTCDate() * 24 : null; };
const capacityOf = (c) => (Number(c?.commissioned_capacity_mw) > 0 ? Number(c.commissioned_capacity_mw) : Number(c?.capacity_mw) || 0);
// Energy is recorded against a signed contract.
const recordable = (c) => !['DRAFT', 'UNDER_NEGOTIATION'].includes(c.status);

const EMPTY_FORM = { contract_id: '', period_month: '', data_type: 'PROVISIONAL', source: 'MANUAL', energy_mwh: '', availability_percent: '', peak_availability_percent: '' };

export default function EnergyData() {
  const [view, setView] = useState('main');
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [filters, setFilters] = useState({ contract_id: '', period_month: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  // What went wrong on the page, and what was just done — said here, not in a browser pop-up.
  // Every error on this page is a popup; an empty message clears nothing.
  const showError = (title) => (msg) => { if (msg) setPopup({ tone: 'error', title, message: msg }); };
  const setPageError = showError('Something went wrong');
  const setError = showError('Check the upload');
  const [notice, setNotice] = useState('');
  // Errors are shown as a popup, the house rule for anything that has to be read.
  const [popup, setPopup] = useState(null);
  const [reaAccountPeriod, setReaAccountPeriod] = useState(null);
  // A lock the server will only take with a recorded reason.
  const [lockAsk, setLockAsk] = useState(null);
  // G2: certified curtailment hours (they lower CUF's possible generation, not the bill).
  const [curtail, setCurtail] = useState(null);
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

  // Dedicated Ingested Records Inspector Modal State
  const [viewingLogRecords, setViewingLogRecords] = useState(null);
  const [logRecordsData, setLogRecordsData] = useState([]);
  const [logRecordsLoading, setLogRecordsLoading] = useState(false);

  function handleFilterMainTable(periodMonth) {
    const target = { contract_id: '', period_month: periodMonth || '', status: '' };
    setFilters(target);
    load(target);
    setNotice(`Showing energy ledger records for ${periodMonth || 'selected period'}`);
    
    // Collapse REA panel and pipeline monitor so main ledger table has full focus
    setShowReaPanel(false);
    setShowPipelineMonitor(false);

    // Blur any active element so focus does not pull viewport back down
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    const scrollToTarget = () => {
      const scroller = document.querySelector('.main-col') || window;
      // Target the filters bar right above the table so filters and table headers are fully visible
      const targetEl = document.querySelector('.filters-bar') || document.getElementById('energy-records-table');
      if (targetEl) {
        if (scroller !== window && scroller.getBoundingClientRect) {
          const scrollerRect = scroller.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          // 80px clearance accounts for sticky topbar (64px) + comfortable spacing
          const targetY = scroller.scrollTop + (targetRect.top - scrollerRect.top) - 80;
          scroller.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
        } else {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        const tableCard = document.getElementById('energy-records-table');
        if (tableCard) {
          tableCard.style.transition = 'box-shadow 0.4s ease, border-color 0.4s ease';
          tableCard.style.boxShadow = '0 0 0 3px rgba(11, 95, 255, 0.45)';
          setTimeout(() => {
            if (tableCard) tableCard.style.boxShadow = '';
          }, 2500);
        }
      }
    };

    setTimeout(scrollToTarget, 60);
    setTimeout(scrollToTarget, 220);
  }

  async function handleViewLogRecords(log) {
    setViewingLogRecords(log);
    setLogRecordsLoading(true);
    try {
      const data = await api.energyData.list({ period_month: log.period_month });
      setLogRecordsData(data);
    } catch (err) {
      setLogRecordsData([]);
    } finally {
      setLogRecordsLoading(false);
    }
  }

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

  function load(overrideFilters) {
    setLoading(true);
    const activeFilters = overrideFilters !== undefined ? overrideFilters : filters;
    const params = {};
    Object.entries(activeFilters).forEach(([k, v]) => { if (v) params[k] = v; });
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
      // CUF is worked out from the energy and the capacity, on the server.
      const made = await api.energyData.create({
        ...form,
        energy_mwh: Number(form.energy_mwh),
        availability_percent: form.availability_percent ? Number(form.availability_percent) : null,
        peak_availability_percent: form.peak_availability_percent ? Number(form.peak_availability_percent) : null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setPageError('');
      setNotice(made.replaced
        ? (made.changed === false
          ? `The ${made.period_month} figure is unchanged at ${fmtNumber(made.energy_mwh)} MWh and is a draft again. Validate it before it can be locked.`
          : `The ${made.period_month} figure was corrected to ${fmtNumber(made.energy_mwh)} MWh and is a draft again — any earlier answer from the counterparty no longer applies. Validate it before it can be locked.`)
        : `${fmtNumber(made.energy_mwh)} MWh recorded for ${made.period_month} as a draft. Validate it before it can be locked.`);
      load();
    } catch (err) {
      const data = err.response?.data;
      setPopup({ tone: 'error', title: 'The figure was not recorded', message: data?.errors?.length > 1 ? `${data.errors.length} things need attention.` : (data?.error || 'Failed to record energy data.'), items: data?.errors?.length > 1 ? data.errors : undefined });
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
      const res = await api.energyData.parseREA(fd);
      const data = Array.isArray(res) ? res : (res.stations || []);
      // The account says which month it is for; that is the month it is filed under.
      setReaAccountPeriod(res.period || null);
      if (res.period) setReaPeriod(res.period);
      setParsedData(data.map(d => {
        let cid = '';
        const stName = (d.station_name || '').toUpperCase();
        const stId = (d.station_id || '').toUpperCase();
        if (stId.includes('NATHPA') || stName.includes('NATHPA') || stName.includes('JHAKRI')) {
          const c = contracts.find(c => c.contract_type === 'PPA' && (c.contract_no.includes('NJHPS') || c.contract_no.includes('NJHEP') || c.contract_no.includes('NJH')));
          if (c) cid = c.id;
        } else if (stId.includes('RAMPUR') || stName.includes('RAMPUR')) {
          const c = contracts.find(c => c.contract_type === 'PPA' && (c.contract_no.includes('RHPS') || c.contract_no.includes('RHEP') || c.contract_no.includes('RAMPUR')));
          if (c) cid = c.id;
        }
        return { ...d, contract_id: cid };
      }));
    } catch (err) {
      setPopup({ tone: 'error', title: 'The REA could not be read', message: err.response?.data?.error || 'Failed to parse REA' });
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveParsed() {
    if (lock.current) return;
    const problems = [];
    if (!reaPeriod) problems.push('Choose the month the account is for.');
    parsedData.filter((d) => !d.contract_id).forEach((d) => problems.push(`${d.station_name}: assign the contract.`));
    if (problems.length) { setPopup({ tone: 'error', title: 'The REA cannot be saved yet', items: problems }); return; }

    setBusy(true);
    setUploading(true);
    // Station by station, saying which went in and which did not — a failure
    // part-way used to leave some stations saved and say only the last error.
    const saved = [];
    const failed = [];
    for (const row of parsedData) {
      try {
        await api.energyData.create({
          contract_id: row.contract_id,
          period_month: reaPeriod,
          data_type: 'PROVISIONAL',
          source: 'REA',
          energy_mwh: row.energy_mwh,
          availability_percent: row.availability_percent,
        });
        saved.push(`${row.station_name}: ${fmtNumber(row.energy_mwh)} MWh`);
      } catch (err) {
        failed.push(`${row.station_name}: ${err.response?.data?.error || 'not saved'}`);
      }
    }
    setUploading(false);
    setBusy(false);
    load();
    if (!failed.length) {
      setShowUploadREA(false);
      setParsedData(null);
      setUploadFile(null);
      setReaPeriod('');
      setPopup({ tone: 'success', title: `REA for ${reaPeriod} recorded`, message: 'Each station is a DRAFT, to validate before it can be locked.', items: saved, okLabel: 'OK' });
    } else {
      setPopup({ tone: saved.length ? 'warning' : 'error', title: saved.length ? 'Some stations were not recorded' : 'Nothing was recorded', items: [...failed, ...saved.map((x) => `Recorded — ${x}`)] });
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
      setPopup({ tone: 'error', title: 'Not validated', message: errOf(err, 'This period could not be validated.') });
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
        setPopup({ tone: 'error', title: 'Not locked', message: data.error || 'Could not lock this period' });
      }
    } finally {
      setBusy(false);
    }
    load();
  }

  const columns = [
    { key: 'contract_no', header: 'Contract & Plant', render: (r) => {
      const plant = r.contract_no?.includes('NJHPS') ? 'Nathpa Jhakri HEP' : r.contract_no?.includes('RHPS') ? 'Rampur HEP' : null;
      return (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{r.contract_no}</div>
          {plant && <div style={{ fontSize: 12, color: 'var(--slate-500)', fontWeight: 500 }}>{plant}</div>}
        </div>
      );
    }},
    { key: 'period_month', header: 'Period' },
    { key: 'billing_family_ref', header: 'BFR', render: (r) => (
      <BfrChip bfr={r.billing_family_ref} onClick={() => setTrailEnergyId(r.id)} />
    )},
    { key: 'data_type', header: 'Type', render: (r) => <Badge status={r.data_type} /> },
    { key: 'source', header: 'Source' },
    { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => (
      <span style={{ fontWeight: 700, color: '#0b5fff' }}>{fmtNumber(r.energy_mwh)}</span>
    )},
    { key: 'cuf_percent', header: 'CUF %', render: (r) => (
      <span>
        {r.cuf_percent != null ? `${fmtNumber(r.cuf_percent)}%` : '-'}
        {Number(r.curtailment_hours) > 0 && <div style={{ fontSize: 12, color: 'var(--slate-500)' }} title={r.curtailment_ref || ''}>{fmtNumber(r.curtailment_hours)} h curtailed</div>}
      </span>
    ) },
    { key: 'availability_percent', header: 'Availability %', render: (r) => r.availability_percent != null ? `${fmtNumber(r.availability_percent)}%` : '-' },
    { key: 'peak_availability_percent', header: 'Peak Avail. %', render: (r) => r.peak_availability_percent != null ? `${fmtNumber(r.peak_availability_percent)}%` : '-' },
    { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
    // What the seller or buyer has said to the figure: accepted, objected, or not yet answered.
    { key: 'response', header: 'Counterparty', render: (r) => (r.is_superseded ? <span style={{ color: 'var(--slate-500)', fontSize: 13.5 }}>Replaced by final</span> : <ResponseBadge row={r} />) },
    { key: 'deviation_notes', header: 'Notes', render: (r) => r.deviation_notes || '-' },
    ...(CAN_WRITE.includes(user?.role) ? [{
      key: 'actions', header: 'Actions', render: (r) => (
        <div className="cell-actions">
          {['DRAFT', 'DISPUTED'].includes(r.status) && !r.is_superseded && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); handleValidate(r); }}>{r.status === 'DISPUTED' ? 'Re-validate' : 'Validate'}</button>}
          {['VALIDATED', 'DISPUTED'].includes(r.status) && !r.is_superseded && <button className="btn btn-success btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); handleLock(r); }}>Lock</button>}
          <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setTrailEnergyId(r.id); }}>Trail</button>
          <button className="btn btn-outline btn-sm" title="Source document, 15-minute blocks and the counterparty's answer" onClick={(e) => { e.stopPropagation(); setRecordId(r.id); }}>Record</button>
          {!r.is_superseded && <button className="btn btn-outline btn-sm" title="SLDC/RLDC-certified curtailment hours, taken out of CUF's possible generation"
            onClick={(e) => { e.stopPropagation(); setCurtail({ row: r, hours: r.curtailment_hours ?? '', reference: r.curtailment_ref || '' }); }}>Curtailment</button>}
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
      <DeskTasksPanel desk="ENERGY_DATA" canWrite={CAN_WRITE.includes(user?.role)} />
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {accountResult && (
        <div className="alert alert-success" role="status">
          {accountResult.account_label} {accountResult.file_name ? `(${accountResult.file_name}) ` : ''}imported:
          {' '}{accountResult.created} new, {accountResult.replaced} replacing a draft, {accountResult.skipped} left alone — all as DRAFT, to validate before locking.
        </div>
      )}

      <EnergyOverview contractId={filters.contract_id} period={filters.period_month} status={filters.status} rows={rows} />

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

      <div id="energy-records-table" style={{ minHeight: 320 }}>
        <Card>
          <Table columns={columns} rows={loading ? [] : rows} emptyMessage={loading ? 'Loading...' : 'No energy data records found.'} />
        </Card>
      </div>

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
                      const stations = res.results?.reduce((s, r) => s + (r.parsedStations || r.stations || 0), 0) || 0;
                      setPipelineResult({ records: total, parsedStations: stations, success: true });
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
            <Card>
              {reaMsg && <div style={{ padding: '8px 16px', background: '#f0f9ff', color: '#0369a1', fontSize: 13, borderBottom: '1px solid #e0f2fe' }}>{reaMsg}</div>}

              <div style={{ padding: '12px 16px', fontSize: 13.5, color: 'var(--slate-600)', borderBottom: '1px solid var(--border)' }}>
                Fetches the Regional Energy Account from the RPC's website for a month, reads the stations and records them as drafts.
                "Trigger Fetch" and "Scan All RPCs Now" reach the RPC site from the server.
              </div>

              {/* Live Step-by-Step Pipeline Monitor */}
              {showPipelineMonitor && (
                <div style={{ padding: '16px 16px 0 16px', background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
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
                      const period = triggerForm.period_month;
                      setShowPipelineMonitor(false);
                      handleFilterMainTable(period);
                    }}
                    onReRun={() => {
                      setPipelineResult(null);
                      setPipelineError(null);
                      setPipelineRunning(true);
                    }}
                  />
                </div>
              )}

                {/* RPC Status Cards */}
                {reaStatus && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: 16 }}>
                    {Object.entries(reaStatus).map(([key, rpc]) => (
                      <div key={key} style={{ flex: '1 1 280px', border: '1px solid var(--border)', borderRadius: 8, padding: 16, background: '#ffffff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <strong style={{ fontSize: 15 }}>{key}</strong>
                          <Badge status={rpc.latest_fetch?.status === 'PROCESSED' ? 'ACTIVE' : rpc.latest_fetch?.status === 'FAILED' ? 'REJECTED' : 'PENDING'} label={rpc.latest_fetch?.status || 'Never Run'} />
                        </div>
                        <div style={{ fontSize: 13.5, color: 'var(--text-light)' }}>{rpc.name}</div>
                        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 13 }}>
                          <div>Processed: <strong>{rpc.total_processed}</strong></div>
                          <div>Failed: <strong>{rpc.total_failed}</strong></div>
                        </div>
                        {rpc.latest_fetch && (
                          <div style={{ fontSize: 13, color: 'var(--text-light)', marginTop: 6 }}>
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
                    <div style={{ padding: '10px 16px', fontSize: 13.5, fontWeight: 600, color: '#0f172a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Audit Trail & Downloaded Accounts</span>
                      <span style={{ fontSize: 12, color: '#64748b' }}>Latest {reaLog.length} pipeline fetch cycles</span>
                    </div>
                    <table className="data-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th scope="col">RPC</th>
                          <th scope="col">Period</th>
                          <th scope="col">Type</th>
                          <th scope="col">Status</th>
                          <th scope="col">Certified REA PDF</th>
                          <th scope="col">Ledger Records</th>
                          <th scope="col">Fetched At</th>
                          <th scope="col">Audit Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reaLog.map(log => (
                          <tr key={log.id}>
                            <td><strong>{log.rpc_source}</strong></td>
                            <td><span className="badge badge-blue">{log.period_month}</span></td>
                            <td><Badge status={log.data_type} /></td>
                            <td><Badge status={log.status === 'PROCESSED' ? 'ACTIVE' : log.status === 'FAILED' ? 'REJECTED' : log.status} label={log.status} /></td>
                            <td>
                              {log.version_id ? (
                                <a
                                  href={api.documents.downloadUrl(log.version_id)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-ghost btn-sm"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0b5fff', textDecoration: 'none', padding: '3px 8px' }}
                                  title="Download certified REA PDF document"
                                >
                                  <span>📄</span>
                                  <span style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {log.file_name || `REA_${log.rpc_source}_${log.period_month}.pdf`}
                                  </span>
                                  {log.file_size_bytes ? (
                                    <span style={{ color: '#64748b', fontSize: 11 }}>({(log.file_size_bytes / (1024 * 1024)).toFixed(1)} MB)</span>
                                  ) : null}
                                </a>
                              ) : log.local_file_path ? (
                                <a
                                  href={`/api/energy-data/rea-download/${log.id}?token=${encodeURIComponent(localStorage.getItem('sjvn_token') || localStorage.getItem('token') || '')}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-ghost btn-sm"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0b5fff', textDecoration: 'none', padding: '3px 8px' }}
                                  title="Download certified REA PDF document"
                                >
                                  <span>📄</span>
                                  <span>Download PDF</span>
                                </a>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>-</span>
                              )}
                            </td>
                            <td>
                              {log.records_created > 0 ? (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    style={{ padding: '4px 10px', fontSize: 12.5, fontWeight: 600, borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                    onClick={() => handleViewLogRecords(log)}
                                    title="Click to view station records in inspector"
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                      <circle cx="12" cy="12" r="3" />
                                    </svg>
                                    <span>View {log.records_created} Records</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    style={{ color: '#0b5fff', fontSize: 12, padding: '3px 6px' }}
                                    onClick={() => handleFilterMainTable(log.period_month)}
                                    title="Filter main ledger table above to this month"
                                  >
                                    Filter Table ↗
                                  </button>
                                </div>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>0</span>
                              )}
                            </td>
                            <td>{fmtDateTime(log.fetched_at)}</td>
                            <td style={{ fontSize: 12.5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', color: log.error_message ? '#b91c1c' : '#64748b' }}>
                              {log.error_message || `Log: ${log.id}`}
                            </td>
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

      </>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Record Energy Data" width={560}>
        <form onSubmit={handleCreate}>
          <Field label="Contract">
            <select required value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}>
              <option value="">Select contract...</option>
              {contracts.filter(recordable).map((c) => <option key={c.id} value={c.id}>{c.contract_no} ({c.project_type} · {fmtNumber(capacityOf(c))} MW)</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Period (Month)">
              <input required type="month" max={lastMonth()} value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} />
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
            {(() => {
              const c = contracts.find((x) => x.id === form.contract_id);
              const mw = capacityOf(c);
              const h = hoursIn(form.period_month);
              const e = Number(form.energy_mwh);
              const max = mw && h ? mw * h * (['HYDRO', 'PSP'].includes(String(c?.project_type).toUpperCase()) ? 1.1 : 1) : null;
              return (
                <Field label="CUF (worked out)">
                  <div style={{ padding: '8px 0', fontSize: 13.5, color: max != null && e > max ? '#b91c1c' : 'var(--slate-600)' }}>
                    {mw && h && form.energy_mwh !== '' ? `${fmtNumber(Math.round((e / (mw * h)) * 10000) / 100)}% — ${fmtNumber(e)} MWh on ${fmtNumber(mw)} MW over ${h} h` : 'Choose the contract, month and energy'}
                    {max != null && e > max ? ` · above the ${fmtNumber(max)} MWh the plant can make` : ''}
                  </div>
                </Field>
              );
            })()}
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
              <Field label="Account month">
                <input required type="month" max={lastMonth()} value={reaPeriod} readOnly={!!reaAccountPeriod} onChange={e => setReaPeriod(e.target.value)} />
              </Field>
              <p style={{ fontSize: 13.5, color: 'var(--slate-500)', margin: '4px 0 0' }}>
                {reaAccountPeriod ? `Read from the account itself ("REA for the month of …") — it is filed under ${reaAccountPeriod}.` : 'The account did not state its month — choose it.'}
              </p>
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
                    {contracts.filter((c) => c.contract_type === 'PPA' && recordable(c)).map(c => <option key={c.id} value={c.id}>{c.contract_no}</option>)}
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

      <Modal open={!!curtail} onClose={() => setCurtail(null)} title="Certified curtailment hours" width={520}>
        {curtail && (
          <form noValidate onSubmit={async (e) => {
            e.preventDefault();
            const hours = Number(curtail.hours);
            const problems = [];
            if (curtail.hours === '' || !Number.isFinite(hours) || hours < 0) problems.push('Hours must be 0 or more');
            if (hours > 0 && curtail.reference.trim().length < 5) problems.push('Give the SLDC / RLDC instruction the hours are certified by');
            if (problems.length) { setPopup({ tone: 'error', title: 'Curtailment not saved', items: problems }); return; }
            try {
              await api.energyData.curtailment(curtail.row.id, { hours, reference: curtail.reference.trim() });
              setCurtail(null);
              load();
              setPopup({ tone: 'success', title: 'Curtailment recorded', message: `${curtail.row.contract_no} ${curtail.row.period_month}: ${hours} h now come off the possible generation its CUF is judged against. The billed energy is unchanged.` });
            } catch (err) {
              setPopup({ tone: 'error', title: 'Curtailment not saved', message: errOf(err, 'Could not save the curtailment hours.') });
            }
          }}>
            <p style={{ fontSize: 13, color: 'var(--slate-600)', marginTop: 0 }}>
              {curtail.row.contract_no} · {curtail.row.period_month}. Only hours an SLDC/RLDC instruction certifies count. Where hours are entered, deemed generation is not added again for the month.
            </p>
            <Field label="Curtailed hours" required><input type="number" min="0" step="0.25" value={curtail.hours} onChange={(e) => setCurtail({ ...curtail, hours: e.target.value })} /></Field>
            <Field label="SLDC / RLDC instruction reference"><input value={curtail.reference} onChange={(e) => setCurtail({ ...curtail, reference: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={() => setCurtail(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
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
              <textarea required rows={3} minLength={15} placeholder="e.g. CERC order 14/2026 — NRLDC certified curtailment for the month" value={lockReason} onChange={(e) => setLockReason(e.target.value)} style={{ width: '100%' }} />
              <span style={{ fontSize: 13, color: 'var(--slate-500)' }}>At least 15 characters — an auditor reads this.</span>
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setLockAsk(null)}>Cancel</button>
              <button type="submit" className="btn btn-danger" disabled={busy || lockReason.trim().length < 15}>{busy ? 'Locking…' : 'Lock with this reason'}</button>
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

      {/* Dedicated Ingested Records Inspector Modal */}
      <Modal
        open={!!viewingLogRecords}
        onClose={() => setViewingLogRecords(null)}
        title={`Certified REA Ingested Records — ${viewingLogRecords?.rpc_source || 'NRPC'} (${viewingLogRecords?.period_month || ''})`}
        width={980}
      >
        <div style={{ padding: '4px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '12px 16px', borderRadius: 8, marginBottom: 16, border: '1px solid #e2e8f0', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, color: '#64748b' }}>RPC Source & Period</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                {viewingLogRecords?.rpc_source} REA — {viewingLogRecords?.period_month} ({viewingLogRecords?.data_type || 'PROVISIONAL'})
              </div>
            </div>
            {(viewingLogRecords?.version_id || viewingLogRecords?.local_file_path) && (
              <a
                href={viewingLogRecords.version_id
                  ? api.documents.downloadUrl(viewingLogRecords.version_id)
                  : `/api/energy-data/rea-download/${viewingLogRecords.id}?token=${encodeURIComponent(localStorage.getItem('sjvn_token') || localStorage.getItem('token') || '')}`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span>📄</span> Download Certified REA PDF
                {viewingLogRecords.file_size_bytes ? ` (${(viewingLogRecords.file_size_bytes / (1024 * 1024)).toFixed(1)} MB)` : ''}
              </a>
            )}
          </div>

          {logRecordsLoading ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>Loading records from ledger...</div>
          ) : logRecordsData.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 8 }}>
              No records found in energy ledger for period {viewingLogRecords?.period_month}.
            </div>
          ) : (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Plant / Station</th>
                    <th>Contract</th>
                    <th>Energy (MWh)</th>
                    <th>Availability %</th>
                    <th>Free Energy (MWh)</th>
                    <th>BFR Key</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logRecordsData.map((rec) => {
                    const plant = rec.contract_no?.includes('NJHPS') ? 'Nathpa Jhakri HEP' : rec.contract_no?.includes('RHPS') ? 'Rampur HEP' : (rec.station_name || rec.contract_no);
                    return (
                      <tr key={rec.id}>
                        <td><strong>{plant}</strong></td>
                        <td style={{ fontSize: 12.5 }}>{rec.contract_no}</td>
                        <td style={{ fontWeight: 700, color: '#0b5fff', fontSize: 14 }}>{fmtNumber(rec.energy_mwh)} MWh</td>
                        <td>{rec.availability_percent != null ? `${fmtNumber(rec.availability_percent)}%` : '-'}</td>
                        <td>{rec.free_energy_mwh != null ? fmtNumber(rec.free_energy_mwh) : '-'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: 11.5 }}>
                          <BfrChip bfr={rec.billing_family_ref} onClick={() => { setViewingLogRecords(null); setTrailEnergyId(rec.id); }} />
                        </td>
                        <td><Badge status={rec.status} /></td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {['DRAFT', 'DISPUTED'].includes(rec.status) && !rec.is_superseded && (
                              <button className="btn btn-secondary btn-sm" style={{ padding: '2px 6px', fontSize: 11.5 }} onClick={() => { handleValidate(rec); handleViewLogRecords(viewingLogRecords); }}>Validate</button>
                            )}
                            {['VALIDATED', 'DISPUTED'].includes(rec.status) && !rec.is_superseded && (
                              <button className="btn btn-success btn-sm" style={{ padding: '2px 6px', fontSize: 11.5 }} onClick={() => { handleLock(rec); handleViewLogRecords(viewingLogRecords); }}>Lock</button>
                            )}
                            <button className="btn btn-outline btn-sm" style={{ padding: '2px 6px', fontSize: 11.5 }} onClick={() => { setViewingLogRecords(null); setRecordId(rec.id); }}>Record</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                const p = viewingLogRecords?.period_month;
                setViewingLogRecords(null);
                handleFilterMainTable(p);
              }}
            >
              🔍 Manage in Main Ledger Table
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setViewingLogRecords(null)}>
              Close
            </button>
          </div>
        </div>
      </Modal>

      <AlertPopup
        open={!!popup}
        tone={popup?.tone}
        title={popup?.title}
        message={popup?.message}
        items={popup?.items}
        okLabel={popup?.okLabel}
        onClose={() => setPopup(null)}
      />
    </div>
  );
}
