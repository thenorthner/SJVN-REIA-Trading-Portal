import React, { useEffect, useState } from 'react';
import { 
  FileText, Activity, Users, Cpu, ShieldCheck, 
  Check, Loader2, Sparkles, AlertCircle, ArrowRight
} from 'lucide-react';

const STAGES = [
  {
    id: 1,
    title: 'Document Ingestion & Integrity Check',
    short: 'Ingestion',
    desc: 'Reading REA document stream & verifying digital seal',
    details: 'NRPC Regional Energy Account · Digital timestamp & checksum verified',
    icon: FileText,
  },
  {
    id: 2,
    title: 'Table D2 Availability & Generation Extraction',
    short: 'Table D2',
    desc: 'Parsing Station PAFM % vs Normative Target (NAPAF 85%)',
    details: 'Nathpa Jhakri HEP (1,500 MW) · Rampur HPS (412 MW) · Design Energy',
    icon: Activity,
  },
  {
    id: 3,
    title: 'Multi-State Beneficiary Apportionment',
    short: 'Apportionment',
    desc: 'Resolving statutory state entitlement percentages & schedules',
    details: 'HP, Punjab, Haryana, Rajasthan, UP, Delhi Discoms, J&K & Free Power quota',
    icon: Users,
  },
  {
    id: 4,
    title: 'CERC Two-Part Tariff Calculation Engine',
    short: 'Tariff Engine',
    desc: 'Computing Regulation 42 Capacity Charge & Regulation 43 ECR',
    details: 'Annual Fixed Cost (AFC) monthly recovery · Ex-bus scheduled energy ECR',
    icon: Cpu,
  },
  {
    id: 5,
    title: 'Settlement Inscription & Draft Bill Generation',
    short: 'Draft Bills',
    desc: 'Issuing official draft numbers, Discom ledgers & audit logs',
    details: 'Immutable draft bill serials generated · Ready for Commercial review',
    icon: ShieldCheck,
  },
];

export default function ReaDraftingCorridor3D({
  running,
  stageIndex = 1,
  progressText = '',
  result = null,
  error = null,
  mode = 'FETCH',
  fileName = '',
  onReset = null,
}) {
  const [animatedStage, setAnimatedStage] = useState(stageIndex);
  const [logs, setLogs] = useState([]);

  // Auto-advance simulated stage animation when running to create an engaging visual flow
  useEffect(() => {
    if (!running) {
      if (result) {
        setAnimatedStage(5);
      }
      return;
    }

    setAnimatedStage(1);
    const startTs = new Date().toLocaleTimeString('en-IN', { hour12: false });
    setLogs([
      `[${startTs}] Initializing REA processing corridor in ${mode === 'UPLOAD' ? 'Document Upload' : 'Online RPC Link'} mode...`,
      `[${startTs}] Ingesting document: ${fileName || 'NRPC Regional Energy Account'}...`,
    ]);

    const timer1 = setTimeout(() => {
      setAnimatedStage(2);
      const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
      setLogs((prev) => [
        `[${ts}] Reading Table D2: Parsing gross scheduled generation, PAFM and free power...`,
        ...prev,
      ]);
    }, 1200);

    const timer2 = setTimeout(() => {
      setAnimatedStage(3);
      const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
      setLogs((prev) => [
        `[${ts}] Calculating multi-beneficiary entitlement matrix across 9 Northern Region Discoms...`,
        ...prev,
      ]);
    }, 2500);

    const timer3 = setTimeout(() => {
      setAnimatedStage(4);
      const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
      setLogs((prev) => [
        `[${ts}] Executing CERC Tariff Engine: Capacity Charge (Reg 42) & ECR (Reg 43)...`,
        ...prev,
      ]);
    }, 4000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [running, mode, fileName]);

  // When result arrives or stageIndex updates from real job
  useEffect(() => {
    if (result) {
      setAnimatedStage(5);
      const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
      const billsCount = (result.months || []).flatMap((m) => m.bills || []).length + (result.bills || []).length;
      setLogs((prev) => [
        `[${ts}] Settlement complete: ${billsCount} draft bill(s) successfully inscribed.`,
        ...prev,
      ]);
    } else if (error) {
      const ts = new Date().toLocaleTimeString('en-IN', { hour12: false });
      setLogs((prev) => [
        `[${ts}] ERROR: ${error}`,
        ...prev,
      ]);
    }
  }, [result, error]);

  const currentStage = result ? 5 : running ? Math.max(animatedStage, stageIndex) : stageIndex;
  const progressPercent = result ? 100 : Math.min(100, Math.round((currentStage / 5) * 100));
  const billsCreated = (result?.months || []).flatMap((m) => m.bills || []).concat(result?.bills || []);

  return (
    <div style={{
      background: 'linear-gradient(135deg, #091326 0%, #0d1e3d 60%, #061021 100%)',
      borderRadius: '16px',
      padding: '24px',
      color: '#ffffff',
      border: '1px solid rgba(59, 130, 246, 0.3)',
      boxShadow: '0 12px 32px rgba(2, 6, 23, 0.45)',
      marginBottom: '20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background cyber lighting flare */}
      <div style={{
        position: 'absolute',
        top: -60,
        right: -40,
        width: '260px',
        height: '260px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.18) 0%, rgba(2, 6, 23, 0) 70%)',
        pointerEvents: 'none',
      }} />

      {/* Header bar with live status badge */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '16px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        paddingBottom: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #2563eb, #0284c7)',
            padding: '8px',
            borderRadius: '10px',
            display: 'flex',
            boxShadow: '0 0 16px rgba(37, 99, 235, 0.5)',
          }}>
            <Sparkles size={20} color="#ffffff" />
          </div>
          <div>
            <div style={{ fontSize: '12.5px', fontWeight: 700, letterSpacing: '0.08em', color: '#93c5fd', textTransform: 'uppercase' }}>
              CERC Hydro Settlement Pipeline
            </div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>REA Document-to-Draft-Bill Corridor</span>
              {mode === 'UPLOAD' && (
                <span style={{
                  fontSize: '12.5px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: 'rgba(14, 165, 233, 0.2)',
                  color: '#38bdf8',
                  border: '1px solid rgba(14, 165, 233, 0.4)',
                }}>
                  REA PDF Upload Corridor
                </span>
              )}
            </div>
            {fileName && (
              <div style={{ fontSize: '13.5px', color: '#94a3b8', marginTop: '2px' }}>
                File: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{fileName}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            borderRadius: '20px',
            fontSize: '13.5px',
            fontWeight: 700,
            background: running ? 'rgba(59, 130, 246, 0.2)' : result ? 'rgba(34, 197, 94, 0.2)' : error ? 'rgba(239, 68, 68, 0.2)' : 'rgba(148, 163, 184, 0.2)',
            color: running ? '#60a5fa' : result ? '#4ade80' : error ? '#fca5a5' : '#cbd5e1',
            border: `1px solid ${running ? 'rgba(59, 130, 246, 0.5)' : result ? 'rgba(34, 197, 94, 0.5)' : error ? 'rgba(239, 68, 68, 0.5)' : 'rgba(148, 163, 184, 0.3)'}`,
          }}>
            {running && <Loader2 size={13} className="animate-spin" style={{ animation: 'spin 1.5s linear infinite' }} />}
            {result && <Check size={13} strokeWidth={3} />}
            {error && <AlertCircle size={13} strokeWidth={3} />}
            <span>{running ? 'Processing REA Pipeline...' : result ? 'Drafting Complete' : error ? 'Processing Error' : 'Corridor Ready'}</span>
          </div>

          {onReset && !running && (
            <button
              type="button"
              onClick={onReset}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#e2e8f0',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reset View
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#fca5a5',
        }}>
          <AlertCircle size={20} color="#ef4444" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: '14.5px' }}>
            <div style={{ fontWeight: 700, color: '#f87171' }}>Processing Interrupted</div>
            <div>{error}</div>
          </div>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              style={{
                background: 'rgba(239, 68, 68, 0.25)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: '#ffffff',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Dismiss & Try Again
            </button>
          )}
        </div>
      )}

      {/* Completion Summary Card */}
      {result && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          borderRadius: '10px',
          padding: '14px 16px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ background: '#059669', padding: '6px', borderRadius: '50%', display: 'flex' }}>
              <Check size={16} color="#ffffff" strokeWidth={3} />
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#34d399', fontSize: '14.5px' }}>
                REA Ingestion & Draft Generation Complete
              </div>
              <div style={{ fontSize: '13.5px', color: '#cbd5e1' }}>
                {billsCreated.length} Draft Bills Generated
                {billsCreated.length > 0 && ` (${billsCreated.map(b => b.bill_no || b).join(', ')})`}
              </div>
            </div>
          </div>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              style={{
                background: 'rgba(16, 185, 129, 0.25)',
                border: '1px solid rgba(16, 185, 129, 0.5)',
                color: '#ffffff',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13.5px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Process Another REA Document
            </button>
          )}
        </div>
      )}

      {/* Dynamic Progress Indicator Bar */}
      <div style={{ marginBottom: '22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px', color: '#cbd5e1', marginBottom: '8px', fontWeight: 600 }}>
          <span>Execution Progress ({progressPercent}%)</span>
          <span style={{ color: '#93c5fd' }}>
            {progressText || (result ? 'All 5 calculation and billing stages finalized' : `Stage ${currentStage} of 5 Active`)}
          </span>
        </div>
        <div style={{
          height: '6px',
          width: '100%',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: 'linear-gradient(90deg, #3b82f6, #06b6d4, #10b981)',
            borderRadius: '4px',
            transition: 'width 0.4s ease-out',
            boxShadow: '0 0 12px rgba(6, 182, 212, 0.8)',
          }} />
        </div>
      </div>

      {/* 5-Stage Visual Stepper Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
        marginBottom: '20px',
      }}>
        {STAGES.map((st) => {
          const Icon = st.icon;
          const isDone = st.id < currentStage || (st.id === 5 && result);
          const isActive = st.id === currentStage && running && !result;
          const isPending = st.id > currentStage && !result;

          return (
            <div
              key={st.id}
              style={{
                background: isActive 
                  ? 'linear-gradient(180deg, rgba(37, 99, 235, 0.25) 0%, rgba(15, 23, 42, 0.6) 100%)' 
                  : isDone 
                    ? 'rgba(16, 185, 129, 0.08)' 
                    : 'rgba(15, 23, 42, 0.45)',
                border: isActive 
                  ? '1px solid #38bdf8' 
                  : isDone 
                    ? '1px solid rgba(16, 185, 129, 0.4)' 
                    : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '14px',
                position: 'relative',
                transition: 'all 0.3s ease',
                boxShadow: isActive ? '0 0 16px rgba(56, 189, 248, 0.25)' : 'none',
              }}
            >
              {/* Top Node Indicator */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isActive 
                    ? '#0284c7' 
                    : isDone 
                      ? '#059669' 
                      : 'rgba(255, 255, 255, 0.08)',
                  boxShadow: isActive ? '0 0 10px #38bdf8' : 'none',
                  transition: 'all 0.3s ease',
                }}>
                  {isActive ? (
                    <Loader2 size={16} color="#ffffff" style={{ animation: 'spin 1.5s linear infinite' }} />
                  ) : isDone ? (
                    <Check size={16} color="#ffffff" strokeWidth={2.5} />
                  ) : (
                    <Icon size={16} color="#94a3b8" />
                  )}
                </div>

                <span style={{
                  fontSize: '12.5px',
                  fontWeight: 700,
                  color: isActive ? '#38bdf8' : isDone ? '#34d399' : 'var(--slate-500)',
                }}>
                  Stage {st.id}
                </span>
              </div>

              {/* Title & Desc */}
              <div style={{
                fontSize: '14.5px',
                fontWeight: 700,
                color: isActive ? '#ffffff' : isDone ? '#e2e8f0' : '#94a3b8',
                marginBottom: '4px',
                lineHeight: 1.25,
              }}>
                {st.title}
              </div>

              <div style={{
                fontSize: '13px',
                color: isActive ? '#cbd5e1' : 'var(--slate-500)',
                lineHeight: 1.35,
                marginBottom: '8px',
              }}>
                {st.desc}
              </div>

              {/* Small Detail Tag */}
              <div style={{
                fontSize: '12px',
                color: isDone ? '#6ee7b7' : isActive ? '#93c5fd' : 'var(--slate-600)',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                paddingTop: '6px',
              }}>
                {st.details}
              </div>
            </div>
          );
        })}
      </div>

      {/* Real-time Diagnostics Log Box */}
      <div style={{
        background: 'rgba(2, 6, 23, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '10px',
        padding: '12px 14px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: '13.5px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', color: '#94a3b8', fontSize: '12.5px', fontWeight: 600, letterSpacing: '0.05em' }}>
          <span>LIVE EXECUTION TELEMETRY LOG</span>
          <span>{running ? 'STREAMING ACTIVE' : result ? 'EXECUTION COMPLETED' : 'IDLE'}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '110px', overflowY: 'auto' }}>
          {logs.length > 0 ? (
            logs.map((log, i) => (
              <div key={i} style={{ color: i === 0 && running ? '#38bdf8' : i === 0 && result ? '#34d399' : '#94a3b8', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{ color: '#38bdf8', fontSize: '11.5px' }}>&gt;</span>
                <span>{log}</span>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--slate-500)' }}>Ready to run. Select REA PDF or paste links to trigger the drafting pipeline.</div>
          )}
        </div>
      </div>
    </div>
  );
}
