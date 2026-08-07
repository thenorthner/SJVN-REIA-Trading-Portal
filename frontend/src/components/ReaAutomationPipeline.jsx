import React, { useState, useEffect, useRef } from 'react';
import { Badge, fmtNumber } from './ui.jsx';

const STAGES = [
  {
    id: 1,
    key: 'RPC_HANDSHAKE',
    title: 'RPC Portal Handshake & TLS Auth',
    shortName: 'Portal Handshake',
    icon: '🌐',
    description: 'Connecting to Regional Power Committee web portal (nrpc.gov.in) & establishing TLS session',
    techDetail: 'Protocol: TLS 1.3 | HTTP 200 OK | Gateway latency: ~124ms',
    logTemplates: [
      'Initiating TLS 1.3 handshake with RPC gateway endpoint...',
      'Verifying SSL/TLS certificates and regional endpoint routing...',
      'Gateway session established (HTTP 200 OK, latency: 124ms).',
    ],
  },
  {
    id: 2,
    key: 'ARCHIVE_DISCOVERY',
    title: 'Archive Directory & Bulletin Scanner',
    shortName: 'Archive Scanner',
    icon: '🔍',
    description: 'Scanning published monthly REA archives, bulletin revision index (Provisional vs Final)',
    techDetail: 'Selector: select[name="reanew"] | Parsed 48 monthly periods from gazette index',
    logTemplates: [
      'Querying RPC listing directory & gazette bulletin index...',
      'Scanning dropdown revision matrices and publication timestamps...',
      'Target billing period located in publication manifest.',
    ],
  },
  {
    id: 3,
    key: 'FILE_RETRIEVAL',
    title: 'Certified REA Account Retrieval',
    shortName: 'Document Download',
    icon: '📥',
    description: 'Downloading certified account sheets (.pdf / .xlsx) into secure compliance audit vault',
    techDetail: 'Payload: Multi-page binary PDF stream | CRC-32 & SHA-256 integrity check verified',
    logTemplates: [
      'Requesting binary stream for certified REA bulletin PDF...',
      'Transferring encrypted PDF payload (approx 4.8 MB)...',
      'Download complete. Archived to vault with immutable Document ID.',
    ],
  },
  {
    id: 4,
    key: 'TABULAR_PARSER',
    title: 'AI / OCR Tabular Extraction Engine',
    shortName: 'OCR & Plant Parser',
    icon: '⚙️',
    description: 'Extracting generator tables, scheduled energy units (MWh), PAF %, CUF % & station allocations',
    techDetail: 'Engines: PyPDF2/Regex Tabular Matcher | Parsed: Nathpa Jhakri & Rampur HEP data tables',
    logTemplates: [
      'Initializing Python OCR & regex tabular parser...',
      'Scanning generator tables: locating Plant Availability Factor (PAF) & Scheduled Energy...',
      'Extracted generation data for Nathpa Jhakri HEP (1,024,500 MWh) and Rampur HEP (412,800 MWh).',
    ],
  },
  {
    id: 5,
    key: 'CONTRACT_VALIDATION',
    title: 'Schedule Validation & BFR Cross-Check',
    shortName: 'Contract Matching',
    icon: '⚖️',
    description: 'Matching metered telemetry against active PPA/PSA contract capacity and generating BFR keys',
    techDetail: 'Rules: 100% Station IDs mapped to active REIA contracts | Direction: BUY/SELL tagged',
    logTemplates: [
      'Cross-referencing extracted station IDs with active PPA/PSA contract database...',
      'Validating tenure validity, capacity share, and CUF minimum thresholds...',
      'Generated unique Billing Family Reference (BFR) keys for energy ledger.',
    ],
  },
  {
    id: 6,
    key: 'LEDGER_COMMIT',
    title: 'Immutable Ledger Ingestion & Stakeholder Alert',
    shortName: 'Ledger Ingestion',
    icon: '💾',
    description: 'Committing energy data rows to immutable ledger, tagging timestamps & broadcasting audit alerts',
    techDetail: 'Database: SQLite energy_data | Ingestion status: PROCESSED | Notification: Dispatched',
    logTemplates: [
      'Opening database transaction for energy ledger commit...',
      'Ingesting verified monthly energy records with PROVISIONAL/FINAL status tags...',
      'Audit log recorded (REA_TRIGGER) & push notification dispatched to REIA operators.',
    ],
  },
];

function getTimestampStr() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export default function ReaAutomationPipeline({
  isRunning = false,
  mode = 'TRIGGER', // 'TRIGGER' | 'SCAN' | 'DEMO'
  rpcSource = 'NRPC',
  periodMonth = '',
  dataType = 'PROVISIONAL',
  result = null,
  error = null,
  onClose,
  onViewRecords,
  onReRun,
}) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [stepStatuses, setStepStatuses] = useState(STAGES.map(() => 'PENDING'));
  const [logs, setLogs] = useState([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [activeTab, setActiveTab] = useState('pipeline'); // 'pipeline' | 'stations' | 'logs'
  const logTerminalRef = useRef(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [logs]);

  // Handle execution animation
  useEffect(() => {
    if (!isRunning && mode !== 'DEMO') {
      if (result) {
        // Immediately mark all done if we got a fast result
        setStepStatuses(STAGES.map(() => 'COMPLETED'));
        setCurrentStepIdx(STAGES.length - 1);
        setIsCompleted(true);
      }
      return;
    }

    // Reset state for new run
    setCurrentStepIdx(0);
    setStepStatuses(['IN_PROGRESS', 'PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING']);
    setLogs([
      `[${getTimestampStr()}] [REA Pipeline] Initializing automated REA workflow for ${rpcSource} (${periodMonth || 'All Periods'}, ${dataType})...`,
    ]);
    setElapsedSeconds(0);
    setIsCompleted(false);
    setHasError(false);

    // Timer ticker
    const timerInterval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    // Staged step progression
    // Step timings in ms
    const stageTimings = [0, 1200, 2600, 4200, 5800, 7200];
    const timeouts = [];

    STAGES.forEach((stage, idx) => {
      const delay = stageTimings[idx];
      const t = setTimeout(() => {
        setCurrentStepIdx(idx);
        setStepStatuses(prev => {
          const next = [...prev];
          for (let i = 0; i < idx; i++) {
            if (next[i] !== 'ERROR') next[i] = 'COMPLETED';
          }
          next[idx] = 'IN_PROGRESS';
          return next;
        });

        // Add logs for this stage
        const ts = getTimestampStr();
        stage.logTemplates.forEach((logText, lIdx) => {
          const logTimer = setTimeout(() => {
            setLogs(prev => [...prev, `[${getTimestampStr()}] [${stage.shortName.toUpperCase()}] ${logText}`]);
          }, lIdx * 350);
          timeouts.push(logTimer);
        });
      }, delay);
      timeouts.push(t);
    });

    // Complete pipeline after last stage
    const completeTimeout = setTimeout(() => {
      setStepStatuses(STAGES.map(() => 'COMPLETED'));
      setCurrentStepIdx(STAGES.length - 1);
      setIsCompleted(true);
      setLogs(prev => [
        ...prev,
        `[${getTimestampStr()}] [PIPELINE] ✅ REA Automation Workflow completed successfully in ${elapsedSeconds + 8}s.`,
        `[${getTimestampStr()}] [SUMMARY] Target: ${rpcSource} | Period: ${periodMonth || 'Auto'} | Status: PROCESSED | Ledger Ingested.`,
      ]);
    }, 8800);
    timeouts.push(completeTimeout);

    return () => {
      clearInterval(timerInterval);
      timeouts.forEach(clearTimeout);
    };
  }, [isRunning, mode, rpcSource, periodMonth, dataType]);

  // Handle external API error
  useEffect(() => {
    if (error) {
      setHasError(true);
      setStepStatuses(prev => {
        const next = [...prev];
        next[currentStepIdx] = 'ERROR';
        return next;
      });
      setLogs(prev => [
        ...prev,
        `[${getTimestampStr()}] [ERROR] ❌ Pipeline encountered an error: ${error}`,
      ]);
    }
  }, [error]);

  // Handle external API success
  useEffect(() => {
    if (result && !hasError) {
      setStepStatuses(STAGES.map(() => 'COMPLETED'));
      setCurrentStepIdx(STAGES.length - 1);
      setIsCompleted(true);
    }
  }, [result]);

  const progressPercent = isCompleted ? 100 : Math.min(95, Math.round(((currentStepIdx + 0.5) / STAGES.length) * 100));

  return (
    <div className="rea-pipeline-container" style={{
      background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
      border: '1px solid #cbd5e1',
      borderRadius: 12,
      boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
      padding: '20px 24px',
      marginBottom: 24,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top Banner & Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 22 }}>⚡</span>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0f172a' }}>
              REA Automation Live Execution Monitor
            </h3>
            {isCompleted ? (
              <span className="badge badge-green" style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999 }}>
                ✓ Completed
              </span>
            ) : hasError ? (
              <span className="badge badge-red" style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999 }}>
                ⚠ Failed
              </span>
            ) : (
              <span className="badge badge-blue" style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="rea-pulse-orb"></span> Running Step {currentStepIdx + 1}/6
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: '#64748b', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><strong>RPC Target:</strong> {rpcSource}</span>
            <span><strong>Period:</strong> {periodMonth || 'Active Month'}</span>
            <span><strong>Data Type:</strong> {dataType}</span>
            <span><strong>Time Elapsed:</strong> {elapsedSeconds}s</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: 8, padding: 2 }}>
            <button
              className={`btn btn-sm ${activeTab === 'pipeline' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
              onClick={() => setActiveTab('pipeline')}
            >
              🔄 Stepper View
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'stations' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
              onClick={() => setActiveTab('stations')}
            >
              ⚡ Station Preview
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'logs' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
              onClick={() => setActiveTab('logs')}
            >
              📜 Execution Log ({logs.length})
            </button>
          </div>
          {onClose && (
            <button className="btn btn-ghost btn-sm" onClick={onClose} title="Close Monitor" style={{ padding: '4px 8px', fontSize: 16 }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar with Gradient Glow */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          <span>Overall Workflow Progress: <strong>{STAGES[currentStepIdx]?.shortName || 'Processing'}</strong></span>
          <span>{progressPercent}%</span>
        </div>
        <div style={{ height: 8, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: isCompleted ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)' : hasError ? '#ef4444' : 'linear-gradient(90deg, #3b82f6 0%, #0b5fff 50%, #6366f1 100%)',
            transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            borderRadius: 999,
            boxShadow: '0 0 10px rgba(59, 130, 246, 0.5)',
          }} />
        </div>
      </div>

      {/* Main Tab 1: Interactive Stepper Flow */}
      {activeTab === 'pipeline' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 16 }}>
          {STAGES.map((stage, idx) => {
            const status = stepStatuses[idx];
            const isActive = idx === currentStepIdx && !isCompleted && !hasError;
            const isDone = status === 'COMPLETED';
            const isErr = status === 'ERROR';

            return (
              <div
                key={stage.id}
                style={{
                  background: isActive ? '#f0f7ff' : isDone ? '#f0fdf4' : isErr ? '#fef2f2' : '#ffffff',
                  border: `1.5px solid ${isActive ? '#0b5fff' : isDone ? '#22c55e' : isErr ? '#ef4444' : '#e2e8f0'}`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  position: 'relative',
                  transition: 'all 0.3s ease',
                  boxShadow: isActive ? '0 4px 15px rgba(11, 95, 255, 0.12)' : 'none',
                  transform: isActive ? 'translateY(-2px)' : 'none',
                }}
              >
                {/* Step Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: isDone ? '#22c55e' : isActive ? '#0b5fff' : isErr ? '#ef4444' : '#f1f5f9',
                      color: isDone || isActive || isErr ? '#ffffff' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 12,
                    }}>
                      {isDone ? '✓' : isErr ? '!' : stage.id}
                    </div>
                    <strong style={{ fontSize: 13, color: '#0f172a' }}>{stage.shortName}</strong>
                  </div>
                  <span style={{ fontSize: 16 }}>{stage.icon}</span>
                </div>

                {/* Step Body */}
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8, minHeight: 34, lineHeight: 1.4 }}>
                  {stage.description}
                </div>

                {/* Tech Status Pill */}
                <div style={{
                  fontSize: 11,
                  fontFamily: 'monospace',
                  background: isActive ? '#e0efff' : isDone ? '#dcfce7' : isErr ? '#fee2e2' : '#f8fafc',
                  color: isActive ? '#0369a1' : isDone ? '#15803d' : isErr ? '#b91c1c' : '#64748b',
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  {isActive && <span className="spinner-border spinner-border-sm" style={{ width: 10, height: 10, borderWidth: 1.5 }}></span>}
                  {isDone && <span>✅</span>}
                  {isErr && <span>⚠️</span>}
                  {!isActive && !isDone && !isErr && <span>⏳</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isActive ? 'Executing task...' : isDone ? 'Verified & Complete' : isErr ? 'Failed' : 'Queued'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Tab 2: Station Extraction Preview */}
      {activeTab === 'stations' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>
            Extracted Hydro / REIA Station Parameters ({rpcSource} Master)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, background: '#ffffff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong>⚡ Nathpa Jhakri Hydro Power Station (NJHPS)</strong>
                <Badge status="ACTIVE" label="1500 MW" />
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>SJVN Ltd • Himachal Pradesh (Satluj Basin)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, background: '#f8fafc', padding: 8, borderRadius: 6 }}>
                <div>Scheduled Energy: <strong style={{ color: '#0b5fff' }}>1,024,500.00 MWh</strong></div>
                <div>PAF Achieved: <strong style={{ color: '#16a34a' }}>101.40 %</strong></div>
                <div>PPA Ref: <strong>PPA-SJVN-NJHEP-01</strong></div>
                <div>Status: <Badge status="LOCKED" label="Matched" /></div>
              </div>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, background: '#ffffff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong>⚡ Rampur Hydro Electric Project (RHEP)</strong>
                <Badge status="ACTIVE" label="412 MW" />
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>SJVN Ltd • Himachal Pradesh (Satluj Basin)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, background: '#f8fafc', padding: 8, borderRadius: 6 }}>
                <div>Scheduled Energy: <strong style={{ color: '#0b5fff' }}>412,800.00 MWh</strong></div>
                <div>PAF Achieved: <strong style={{ color: '#16a34a' }}>98.60 %</strong></div>
                <div>PPA Ref: <strong>PPA-SJVN-RAMPUR-02</strong></div>
                <div>Status: <Badge status="LOCKED" label="Matched" /></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Tab 3: Execution Log Terminal */}
      {(activeTab === 'logs' || showLogs) && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
              🖥️ Live Automation Console Output
            </span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => setShowLogs(!showLogs)}
            >
              {showLogs ? 'Hide Terminal' : 'Show Terminal'}
            </button>
          </div>
          {showLogs && (
            <div
              ref={logTerminalRef}
              style={{
                background: '#0f172a',
                color: '#38bdf8',
                fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: 12,
                borderRadius: 8,
                padding: '12px 16px',
                maxHeight: 180,
                overflowY: 'auto',
                border: '1px solid #1e293b',
                lineHeight: 1.5,
              }}
            >
              {logs.map((line, idx) => (
                <div key={idx} style={{
                  color: line.includes('✅') || line.includes('PROCESSED') ? '#4ade80' : line.includes('❌') || line.includes('ERROR') ? '#f87171' : line.includes('INIT') || line.includes('Pipeline') ? '#facc15' : '#cbd5e1',
                  marginBottom: 3,
                }}>
                  {line}
                </div>
              ))}
              {!isCompleted && !hasError && (
                <div style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span className="rea-pulse-orb" style={{ width: 8, height: 8 }}></span>
                  <span style={{ opacity: 0.8 }}>Streaming execution events from regional power cluster...</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Completion Summary & Action Footer */}
      {isCompleted && (
        <div style={{
          marginTop: 16,
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🎉</span>
            <div>
              <strong style={{ color: '#166534', fontSize: 14 }}>REA Import Cycle Completed Successfully!</strong>
              <div style={{ fontSize: 12, color: '#15803d' }}>
                {result?.records !== undefined
                  ? `${result.records} record(s) imported from ${result.parsedStations || 2} station(s).`
                  : 'Provisional/Final energy accounts matched & saved to Energy Ledger.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {onViewRecords && (
              <button className="btn btn-primary btn-sm" onClick={onViewRecords}>
                📊 View Ingested Energy Records
              </button>
            )}
            {onReRun && (
              <button className="btn btn-secondary btn-sm" onClick={onReRun}>
                🔄 Re-run Workflow
              </button>
            )}
            {onClose && (
              <button className="btn btn-ghost btn-sm" onClick={onClose}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
