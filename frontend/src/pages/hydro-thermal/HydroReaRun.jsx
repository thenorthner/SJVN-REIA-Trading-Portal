import React, { useEffect, useState, useRef } from 'react';
import { 
  HelpCircle, UploadCloud, FileText, CheckCircle2, Trash2, 
  Link as LinkIcon, FileUp, Sparkles, AlertCircle 
} from 'lucide-react';
import api from '../../api/client.js';
import { Card, Table, Badge, Field, Modal, fmtCurrency, fmtNumber } from '../../components/ui.jsx';
import HydroBeneficiaryWaterfall3D from '../../components/HydroBeneficiaryWaterfall3D.jsx';
import ReaDraftingCorridor3D from '../../components/ReaDraftingCorridor3D.jsx';

// Draft a run of months' hydro bills straight from the Regional Energy Account.
//
// NRPC's site files each REA under an upload-timestamped name
// (…/allfile/090920261230385307REA0826_P.pdf), so the month cannot be turned
// into a link. The desk pastes the links it copied off Commercial → Regional
// Energy Accounts; the month is read off each file name (REA0826 → 2026-08) and
// the server checks it again against the month printed inside the PDF.

/** "…REA0826_P.pdf" / "…Rea0625_F.pdf" → "2026-08" / "2025-06". */
export function monthFromReaLink(link) {
  const m = /REA(\d{2})(\d{2})_[PF][A-Z0-9]*\.pdf$/i.exec(String(link).trim());
  if (!m) return null;
  const mm = Number(m[1]);
  if (mm < 1 || mm > 12) return null;
  return `20${m[2]}-${m[1]}`;
}

export function parseReaLinks(text) {
  const links = {};
  const unread = [];
  for (const raw of String(text || '').split(/\s+/)) {
    const line = raw.trim();
    if (!line) continue;
    const month = monthFromReaLink(line);
    if (month) links[month] = line; else unread.push(line);
  }
  return { links, unread };
}

/** Months from `from` to `to` inclusive, YYYY-MM, oldest first. */
export function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const STATUS_TONE = { CREATED: 'APPROVED', EXISTS: 'PENDING', SKIPPED: 'DRAFT', FAILED: 'REJECTED' };

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN') : '');

/**
 * What to tell the desk about the sweep that drafts without being asked.
 *
 * An empty bills list means two very different things depending on whether the
 * sweep ran, so this never says nothing: every state, including "it has not run
 * yet", gets a sentence.
 */
export function describeAutoDraft(status) {
  if (!status) return null;
  const { enabled, running, last } = status;
  if (running) return { tone: 'info', text: 'Drafting from the latest Regional Energy Accounts right now.' };
  if (!enabled) {
    return {
      tone: 'warn',
      text: 'Drafting by itself is switched off (hydro_rea_auto_draft) — bills are drafted only from this page.',
    };
  }
  if (!last) {
    return {
      tone: 'info',
      text: 'Drafting by itself is on. It has not run yet — the next REA scan will draft whatever the accounts allow.',
    };
  }
  const ran = `Last ran ${when(last.started_at)}`;
  const range = last.from_month ? ` for ${last.from_month}${last.to_month === last.from_month ? '' : `..${last.to_month}`}` : '';
  if (last.outcome === 'FAILED') return { tone: 'error', text: `${ran}${range} and failed: ${last.detail}` };
  if (last.outcome === 'OFF') return { tone: 'warn', text: `${ran}: drafting was switched off.` };
  if (last.outcome === 'DRAFTED') {
    return {
      tone: 'ok',
      text: `${ran}${range}: drafted ${last.bills_created} bill(s) — ${last.bill_nos.join(', ')}.`,
    };
  }
  if (last.outcome === 'BLOCKED') {
    return { tone: 'warn', text: `${ran}${range}: nothing could be drafted from the accounts on file.` };
  }
  return { tone: 'info', text: `${ran}: nothing to draft — ${last.detail || 'every landed account is already billed'}.` };
}

const TONE_CLASS = { error: 'alert alert-error', warn: 'alert alert-warning', ok: 'alert alert-success', info: 'alert alert-info' };

/** The standing answer to "did it draft anything this morning?". */
export function AutoDraftPanel({ status }) {
  const said = describeAutoDraft(status);
  if (!said) return null;
  const left = status.last?.blocked || [];
  return (
    <div className={TONE_CLASS[said.tone]} role="status" style={{ marginBottom: 12 }}>
      <div>{said.text}</div>
      {left.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {left.map((b) => (
            <li key={`${b.month}-${b.contract_no}`}>
              {b.month} {b.contract_no} — {b.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HydroReaRun({ onDone }) {
  const [activeTab, setActiveTab] = useState('UPLOAD'); // 'UPLOAD' | 'PASTE'
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [detectedMonth, setDetectedMonth] = useState('');
  const fileInputRef = useRef(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paste, setPaste] = useState('');
  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(1);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState('');
  const [auto, setAuto] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  // The sweep's own state, reloaded after a manual run because that run is what
  // the next sweep will find already billed.
  const loadAuto = () => api.hydroBilling.autoDraft().then(setAuto).catch(() => setAuto(null));
  useEffect(() => { loadAuto(); }, []);

  const { links, unread } = parseReaLinks(paste);
  const linkMonths = Object.keys(links).sort();

  function handleFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setErr('Only PDF format is supported for Regional Energy Accounts');
      return;
    }
    setSelectedFile(file);
    setErr('');
    const detected = monthFromReaLink(file.name);
    if (detected) {
      setDetectedMonth(detected);
      if (!from) setFrom(detected);
      if (!to) setTo(detected);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }

  async function runUpload(e) {
    e.preventDefault();
    if (!selectedFile) {
      setErr('Please select or drop an REA PDF file to upload.');
      return;
    }
    setErr('');
    setResult(null);
    setRunning(true);
    setStageIndex(1);
    setProgress(`Ingesting REA PDF "${selectedFile.name}"...`);

    const formData = new FormData();
    formData.append('file', selectedFile);
    if (from || detectedMonth) formData.append('from_month', from || detectedMonth);
    if (to || detectedMonth) formData.append('to_month', to || detectedMonth);
    formData.append('rpc', 'NRPC');

    try {
      setStageIndex(2);
      setProgress(`Extracting Table D2 generation & availability metrics...`);
      const res = await api.hydroBilling.uploadRea(formData);
      setStageIndex(5);
      setResult({
        months: res.months || [],
        stations_not_ready: res.stations_not_ready || [],
      });
      setProgress('');
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally {
      setRunning(false);
      loadAuto();
      onDone?.();
    }
  }

  // The server runs this in the background and the page polls. Fetching and
  // parsing a month's REA outlasts the proxies between the desk and the
  // server, which answered a plain request with 504 even though the server
  // carried on and billed the month.
  async function run(e) {
    e.preventDefault();
    setErr(''); setResult(null);
    const fromMonth = from || linkMonths[0];
    const toMonth = to || linkMonths[linkMonths.length - 1] || fromMonth;
    if (!fromMonth) { setErr('Give a month range, or paste the REA links for the months to bill.'); return; }
    if (fromMonth > toMonth) { setErr('From month is after To month.'); return; }
    const total = monthsBetween(fromMonth, toMonth).length;
    setRunning(true);
    setStageIndex(1);
    setProgress(`Starting — ${total} month(s)…`);
    try {
      const start = await api.hydroBilling.fromRea({
        from_month: fromMonth, to_month: toMonth, rea_links: links, background: true,
      });
      let currentStageStep = 1;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2500));
        let job;
        try {
          job = await api.hydroBilling.fromReaJob(start.job_id);
        } catch (pollErr) {
          // A poll that times out is not the run failing — ask again.
          if (pollErr.response?.status === 504 || !pollErr.response) continue;
          throw pollErr;
        }
        setResult({ months: job.months || [], stations_not_ready: job.result?.stations_not_ready || [] });
        if (job.status === 'RUNNING') {
          const p = job.progress;
          currentStageStep = Math.min(4, currentStageStep + 1);
          setStageIndex(currentStageStep);
          setProgress(p ? `Month ${p.done + 1} of ${p.total}: fetching ${p.month} REA and drafting…` : 'Working…');
          continue;
        }
        if (job.status === 'FAILED') setErr(job.error || 'The run failed');
        setStageIndex(5);
        break;
      }
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message);
    } finally {
      setRunning(false);
      setProgress('');
      loadAuto();
      onDone?.();
    }
  }

  const rows = (result?.months || []).flatMap((m) => m.bills.map((b, i) => ({
    key: `${m.month}-${b.contract_no}`,
    month: i === 0 ? m.month : '',
    rea: i === 0 ? (m.rea ? `${m.rea === 'FINAL' ? 'Final' : 'Provisional'}${m.rea_imported ? ' (fetched)' : ''}` : (m.error || 'not published')) : '',
    ...b,
  })));

  return (
    <Card
      title="Bills from the Regional Energy Account"
      actions={
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setShowGuide(true)}
          title="View REA Fetch & Billing Instructions"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 12px',
            fontSize: '13.5px',
            fontWeight: 500,
            borderRadius: '6px',
            color: '#475569',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            cursor: 'pointer',
          }}
        >
          <HelpCircle size={14} style={{ color: '#0284c7' }} />
          <span>Instructions</span>
        </button>
      }
    >
      <AutoDraftPanel status={auto} />

      {/* Mode Selector Tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '18px',
        borderBottom: '1px solid var(--border)',
        paddingBottom: '10px',
      }}>
        <button
          type="button"
          onClick={() => { setActiveTab('UPLOAD'); setErr(''); }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 16px',
            borderRadius: '8px',
            fontSize: '13.5px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: activeTab === 'UPLOAD' ? '#041F4B' : '#f1f5f9',
            color: activeTab === 'UPLOAD' ? '#ffffff' : '#475569',
            boxShadow: activeTab === 'UPLOAD' ? '0 2px 4px rgba(4, 31, 75, 0.2)' : 'none',
          }}
        >
          <UploadCloud size={16} />
          <span>Upload REA PDF Document</span>
        </button>

        <button
          type="button"
          onClick={() => { setActiveTab('PASTE'); setErr(''); }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '7px 16px',
            borderRadius: '8px',
            fontSize: '13.5px',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: activeTab === 'PASTE' ? '#041F4B' : '#f1f5f9',
            color: activeTab === 'PASTE' ? '#ffffff' : '#475569',
            boxShadow: activeTab === 'PASTE' ? '0 2px 4px rgba(4, 31, 75, 0.2)' : 'none',
          }}
        >
          <LinkIcon size={15} />
          <span>Paste NRPC Online Links</span>
        </button>
      </div>

      {/* Mode 1: Upload REA PDF */}
      {activeTab === 'UPLOAD' && (
        <form onSubmit={runUpload}>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !selectedFile && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#2563eb' : selectedFile ? '#10b981' : '#cbd5e1'}`,
              borderRadius: '12px',
              padding: selectedFile ? '18px 24px' : '36px 20px',
              textAlign: 'center',
              backgroundColor: dragOver ? '#eff6ff' : selectedFile ? '#f0fdf4' : '#f8fafc',
              cursor: selectedFile ? 'default' : 'pointer',
              transition: 'all 0.2s ease',
              marginBottom: '16px',
              position: 'relative',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />

            {!selectedFile ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  background: '#e0f2fe',
                  color: '#0284c7',
                  padding: '12px',
                  borderRadius: '50%',
                  display: 'flex',
                }}>
                  <FileUp size={28} />
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>
                  Click to select or drag & drop REA PDF here
                </div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>
                  Supports official NRPC Regional Energy Account PDF files (e.g., REA0826_P.pdf, REA0826_F.pdf)
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', textAlign: 'left' }}>
                  <div style={{
                    background: '#fee2e2',
                    color: '#dc2626',
                    padding: '10px',
                    borderRadius: '10px',
                    display: 'flex',
                  }}>
                    <FileText size={24} />
                  </div>
                  <div>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: '#0f172a' }}>
                      {selectedFile.name}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#64748b' }}>
                      Size: {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                      {detectedMonth && (
                        <span style={{
                          marginLeft: '10px',
                          background: '#dbeafe',
                          color: '#1d4ed8',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontWeight: 600,
                        }}>
                          Detected Month: {detectedMonth}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ fontSize: '12.5px' }}
                  >
                    Change File
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setDetectedMonth('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    style={{
                      background: '#fee2e2',
                      color: '#b91c1c',
                      border: '1px solid #fecaca',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Remove file"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Billing Month" htmlFor="upload-from">
              <input
                id="upload-from"
                type="month"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setTo(e.target.value); }}
              />
            </Field>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={running || !selectedFile}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 20px',
                fontWeight: 600,
              }}
            >
              <UploadCloud size={16} />
              <span>{running ? 'Processing REA PDF and drafting…' : 'Process REA PDF and draft bills'}</span>
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: 'var(--text-light)' }}>
            The PDF will be parsed for Table D2 Gross Scheduled Generation, normative PAFM %, and multi-state beneficiary allocations.
          </p>
        </form>
      )}

      {/* Mode 2: Paste REA Links */}
      {activeTab === 'PASTE' && (
        <form onSubmit={run}>
          <Field label="REA PDF links (nrpc.gov.in)" htmlFor="rea-links">
            <textarea
              id="rea-links" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)}
              placeholder="https://nrpc.gov.in/allfile/…REA0826_P.pdf"
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 13.5 }}
            />
          </Field>
          {linkMonths.length > 0 && (
            <p style={{ margin: '4px 0' }}>Months read from the links: {linkMonths.join(', ')}</p>
          )}
          {unread.length > 0 && (
            <p className="text-warning" style={{ margin: '4px 0' }}>
              Not an REA PDF link (ignored): {unread.join(', ')}
            </p>
          )}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="From month" htmlFor="rea-from">
              <input id="rea-from" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To month" htmlFor="rea-to">
              <input id="rea-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={running}>
              {running ? 'Fetching REA and drafting…' : 'Fetch REA and draft bills'}
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-light)' }}>
            Leave the months blank to bill exactly the months of the pasted links. Start from the first unbilled month of the financial year.
          </p>
        </form>
      )}

      {/* Live Animated Step-by-Step Execution Pipeline */}
      {(running || result) && (
        <div style={{ marginTop: '20px' }}>
          <ReaDraftingCorridor3D
            running={running}
            stageIndex={stageIndex}
            progressText={progress}
            result={result}
            error={err}
            mode={activeTab}
            fileName={selectedFile?.name || linkMonths.join(', ')}
            onReset={() => {
              setResult(null);
              setProgress('');
              setErr('');
            }}
          />
        </div>
      )}

      {err && <div className="alert alert-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}

      {result && (
        <div style={{ marginTop: 16 }}>
          <HydroBeneficiaryWaterfall3D stationName={rows[0]?.station_name || 'Nathpa Jhakri HEP (1,500 MW)'} />
          <Table
            caption="What the run did, month by month"
            rows={rows}
            columns={[
              { key: 'month', header: 'Month' },
              { key: 'rea', header: 'REA' },
              { key: 'station_name', header: 'Station', render: (r) => r.station_name || r.contract_no },
              { key: 'status', header: 'Result', render: (r) => <Badge status={STATUS_TONE[r.status]} label={r.status} /> },
              { key: 'bill_no', header: 'Bill no.', render: (r) => r.bill_no || '—' },
              { key: 'energy_mwh', header: 'Energy (MWh)', render: (r) => (r.energy_mwh != null ? fmtNumber(r.energy_mwh, 2) : '—') },
              { key: 'pafm_pct', header: 'PAFM %', render: (r) => (r.pafm_pct != null ? fmtNumber(r.pafm_pct, 3) : '—') },
              { key: 'total_charges', header: 'Total', render: (r) => (r.total_charges != null ? fmtCurrency(r.total_charges) : '—') },
              { key: 'reason', header: 'Note', render: (r) => r.reason || r.beta_note || '' },
            ]}
          />
          {result.stations_not_ready?.length > 0 && (
            <p style={{ marginTop: 8 }}>
              Not billed, not ready: {result.stations_not_ready.map((s) => `${s.station_name || s.contract_no} (${s.missing.join(', ')})`).join('; ')}
            </p>
          )}
        </div>
      )}

      {showGuide && (
        <Modal
          open={showGuide}
          onClose={() => setShowGuide(false)}
          title="Bills from Regional Energy Account — Instructions & Process Guide"
          width={600}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: '13.5px', lineHeight: 1.6, color: '#334155' }}>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '12px 14px' }}>
              <h4 style={{ margin: '0 0 6px', fontSize: '14px', color: '#0369a1', fontWeight: 600 }}>
                Purpose & Scope
              </h4>
              <p style={{ margin: 0 }}>
                Fetches each month&apos;s REA from NRPC or uploaded PDF document, records station energy, availability and free power accounts, and drafts that month&apos;s bill for every station ready to bill. Months run oldest first so each bill carries the year&apos;s cumulative energy; nothing is issued directly.
              </p>
            </div>

            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                Option 1: Upload REA PDF Directly
              </h4>
              <p style={{ margin: 0 }}>
                Drag & drop or select any official NRPC / RPC Regional Energy Account PDF directly from your computer (e.g. <code>REA0826_P.pdf</code>). The system automatically identifies the billing month, validates checksums, extracts Table D2 parameters, and drafts bills.
              </p>
            </div>

            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                Option 2: Copy REA PDF Links from NRPC
              </h4>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                <li>Open <strong>nrpc.gov.in</strong> in your browser.</li>
                <li>Navigate to <strong>Commercial → Regional Energy Accounts → Provisional REA</strong>.</li>
                <li>Copy the PDF link of each month (e.g. <code>https://nrpc.gov.in/allfile/...REA0826_P.pdf</code>).</li>
                <li>Paste the copied links into the text box above — one per line.</li>
              </ol>
            </div>

            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                Date Range & Billing Sequence
              </h4>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Leave the months blank to bill exactly the months of the pasted links or uploaded file.</li>
                <li>Or choose From/To months starting from the first month of the financial year that is not yet billed.</li>
              </ul>
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', fontSize: '13.5px', color: '#64748b' }}>
              <strong>Automatic Sweep:</strong> The same run happens automatically after each scheduled REA scan. This desk form is reserved for manual PDF uploads, or for months the automated scan could not reach.
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

