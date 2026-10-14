import React, { useEffect, useState } from 'react';
import api from '../api/client.js';
import { Badge, fmtCurrency, fmtNumber } from './ui.jsx';

/**
 * Ultra 3D Visual Pipeline & Period Settlement Trail
 * Displays end-to-end PPA (Seller IPP) ↔ SJVN REIA Clearing Hub (+Trading Margin Spread) ↔ PSA (Buyer DISCOM)
 * with interactive 3D perspective cards, glowing SVG conduits, and lifecycle True-Up rail.
 */
export function SettlementTrailPanel({
  bfr,
  invoiceId,
  energyId,
  contractId,
  periodMonth,
  direction,
  compact = false,
}) {
  const [trail, setTrail] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('3D'); // '3D' | 'LEDGER'
  const [selectedNode, setSelectedNode] = useState(null); // 'PPA' | 'HUB' | 'PSA' | null
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = {};
    if (bfr) params.bfr = bfr;
    else if (invoiceId) params.invoice_id = invoiceId;
    else if (energyId) params.energy_id = energyId;
    else if (contractId && periodMonth) {
      params.contract_id = contractId;
      params.period_month = periodMonth;
      if (direction) params.direction = direction;
    } else {
      setLoading(false);
      setError('No lookup key');
      return;
    }

    api.billingTrail.get(params)
      .then((data) => { if (!cancelled) setTrail(data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'Failed to load settlement trail'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [bfr, invoiceId, energyId, contractId, periodMonth, direction]);

  if (loading) {
    return (
      <div style={{
        padding: 32,
        background: '#0a0f1d',
        borderRadius: 12,
        border: '1px solid #1e293b',
        color: '#94a3b8',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}>
        <div style={{
          width: 32,
          height: 32,
          border: '3px solid rgba(56, 189, 248, 0.2)',
          borderTopColor: '#38bdf8',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <span style={{ fontSize: 13, letterSpacing: 0.5 }}>Synthesizing 3D Settlement Pipeline & Linked Contracts…</span>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: 20,
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 8,
        color: '#991b1b',
        fontSize: 13,
      }}>
        {error}
      </div>
    );
  }

  if (!trail) return null;

  const copyBfr = () => {
    if (trail.billing_family_ref) {
      navigator.clipboard?.writeText(trail.billing_family_ref);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const topo = trail.linked_topology || {};
  const hasTopology = topo.has_link || topo.ppa || topo.psa;

  return (
    <div style={{ marginTop: compact ? 0 : 16 }}>
      {/* Top Cybernetic Control Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#0b1120',
        padding: '12px 16px',
        borderRadius: '12px 12px 0 0',
        border: '1px solid #1e293b',
        borderBottom: 'none',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
            padding: '6px 10px',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(56, 189, 248, 0.4)',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h4 style={{ margin: 0, color: '#f8fafc', fontSize: 15, fontWeight: 700, letterSpacing: 0.3 }}>
                Billing Settlement Trail & Linked Pipeline
              </h4>
              <span style={{
                fontSize: 10,
                textTransform: 'uppercase',
                background: '#0f172a',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 600,
                letterSpacing: 0.6,
              }}>
                Period: {trail.billing_period}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <code style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
                BFR: {trail.billing_family_ref}
              </code>
              <button
                type="button"
                onClick={copyBfr}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: copied ? '#4ade80' : '#64748b',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: 0,
                }}
                title="Copy Billing Family Reference"
              >
                {copied ? '✓ Copied' : '⧉ Copy'}
              </button>
            </div>
          </div>
        </div>

        {/* View Mode Toggle Pill */}
        <div style={{
          display: 'flex',
          background: '#0f172a',
          padding: 3,
          borderRadius: 8,
          border: '1px solid #1e293b',
        }}>
          <button
            type="button"
            onClick={() => setViewMode('3D')}
            style={{
              background: viewMode === '3D' ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'transparent',
              color: viewMode === '3D' ? '#fff' : '#94a3b8',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: viewMode === '3D' ? '0 0 12px rgba(37, 99, 235, 0.5)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            <span>3D Pipeline Flow</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('LEDGER')}
            style={{
              background: viewMode === 'LEDGER' ? 'linear-gradient(135deg, #334155, #1e293b)' : 'transparent',
              color: viewMode === 'LEDGER' ? '#fff' : '#94a3b8',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s',
            }}
          >
            <span>📋 Audit Ledger</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: 3D Canvas or Audit Ledger */}
      {viewMode === '3D' ? (
        <VisualPipeline3D
          trail={trail}
          topo={topo}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
        />
      ) : (
        <AuditLedgerView trail={trail} />
      )}
    </div>
  );
}

/**
 * 3D Isometric Cybernetic Visual Pipeline Canvas
 */
function VisualPipeline3D({ trail, topo, selectedNode, setSelectedNode }) {
  const ppa = topo.ppa;
  const hub = topo.hub || {};
  const psa = topo.psa;
  const effectiveMwh = hub.energy_mwh || trail.final_energy?.energy_mwh || trail.provisional_energy?.energy_mwh || 0;
  const tradingMargin = hub.trading_margin_per_unit != null ? hub.trading_margin_per_unit : 0.07;
  const totalSpread = hub.spread_amount != null ? hub.spread_amount : Math.round(effectiveMwh * 1000 * tradingMargin);

  // Invoices
  const ppaInvoices = ppa?.invoices?.length ? ppa.invoices : (trail.direction === 'SELLER_TO_SJVN' ? [...(trail.provisional_invoices || []), ...(trail.final_invoices || [])] : []);
  const psaInvoices = psa?.invoices?.length ? psa.invoices : (trail.direction === 'SJVN_TO_BUYER' ? [...(trail.provisional_invoices || []), ...(trail.final_invoices || [])] : []);

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 30%, #0d172a 0%, #060911 100%)',
      border: '1px solid #1e293b',
      borderRadius: '0 0 12px 12px',
      padding: '24px 20px',
      position: 'relative',
      overflow: 'hidden',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Ambient Cyber Grid & Glow Effects */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: `
          linear-gradient(rgba(56, 189, 248, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(56, 189, 248, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '36px 36px',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '450px',
        height: '220px',
        background: 'radial-gradient(circle, rgba(14, 165, 233, 0.12) 0%, rgba(14, 165, 233, 0) 70%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Top Flow Legend & Real-Time Sync Pill */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
        flexWrap: 'wrap',
        gap: 12,
        borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        paddingBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            <span style={{ color: '#94a3b8' }}>Green Energy MWh Stream (Left ➔ Right)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 8px #f59e0b' }} />
            <span style={{ color: '#94a3b8' }}>Commercial Settlement Flow (Right ➔ Left)</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11,
            color: '#10b981',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            padding: '3px 8px',
            borderRadius: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', animation: 'pulse 2s infinite' }} />
            BACK-TO-BACK LINKED & BALANCED
          </span>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Allocation: <strong style={{ color: '#38bdf8' }}>{topo.allocation_percent || 100}%</strong>
          </span>
        </div>
      </div>

      {/* 3D Isometric Pipeline Stage */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        perspective: '1400px',
        padding: '10px 0 20px 0',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr minmax(70px, 110px) 1.2fr minmax(70px, 110px) 1fr',
          alignItems: 'center',
          gap: 0,
        }}>
          {/* NODE 1: PPA SELLER / GENERATOR */}
          <div
            onClick={() => setSelectedNode(selectedNode === 'PPA' ? null : 'PPA')}
            style={{
              transform: selectedNode === 'PPA' ? 'translateZ(25px) scale(1.02)' : 'rotateY(6deg) translateZ(8px)',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.85))',
              border: selectedNode === 'PPA' ? '1.5px solid #10b981' : '1px solid rgba(16, 185, 129, 0.3)',
              boxShadow: selectedNode === 'PPA'
                ? '0 0 25px rgba(16, 185, 129, 0.35), 0 20px 30px rgba(0, 0, 0, 0.7)'
                : '0 10px 25px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(16px)',
              borderRadius: 14,
              padding: 16,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '2px 7px',
                borderRadius: 4,
              }}>
                1. Power Generator (IPP)
              </span>
              <span style={{ fontSize: 16 }}>☀️</span>
            </div>

            <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
              {ppa?.seller_name || 'Power Producer (IPP)'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
              {ppa?.contract_no || trail.contract_no || 'PPA Agreement'} · {ppa?.capacity_mw || 50} MW
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: 8,
              padding: '8px 10px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                <span>PPA Base Tariff</span>
                <strong style={{ color: '#f8fafc', fontSize: 12 }}>₹{ppa?.tariff_per_unit ?? '2.88'} / kWh</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                <span>Metered Generation</span>
                <strong style={{ color: '#10b981' }}>{fmtNumber(effectiveMwh)} MWh</strong>
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Invoices on SJVN: <strong>{ppaInvoices.length}</strong></span>
              <span style={{ color: '#10b981', fontWeight: 600 }}>{selectedNode === 'PPA' ? '▲ Hide' : '▼ Inspect'}</span>
            </div>
          </div>

          {/* CONDUIT 1: PPA ➔ SJVN HUB */}
          <div style={{ position: 'relative', height: 140, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="energyGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#0ea5e9" />
                </linearGradient>
                <linearGradient id="cashGrad1" x1="100%" y1="0%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#eab308" />
                </linearGradient>
              </defs>

              {/* Energy Pipe (Top) */}
              <path
                d="M 0 25 L 100 25"
                stroke="rgba(16, 185, 129, 0.25)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M 0 25 L 100 25"
                stroke="url(#energyGrad1)"
                strokeWidth="3"
                strokeDasharray="6 8"
                style={{ animation: 'flowRight 1.5s linear infinite' }}
              />

              {/* Cashflow Pipe (Bottom) */}
              <path
                d="M 0 55 L 100 55"
                stroke="rgba(245, 158, 11, 0.25)"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M 0 55 L 100 55"
                stroke="url(#cashGrad1)"
                strokeWidth="2.5"
                strokeDasharray="5 7"
                style={{ animation: 'flowLeft 1.8s linear infinite' }}
              />
            </svg>

            {/* Throughput Tag */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#090e1a',
              border: '1px solid #1e293b',
              padding: '2px 6px',
              borderRadius: 6,
              fontSize: 9,
              color: '#38bdf8',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              textAlign: 'center',
            }}>
              <div>{fmtNumber(effectiveMwh)} MWh</div>
              <div style={{ color: '#f59e0b', fontSize: 8.5 }}>₹{ppa?.tariff_per_unit ?? '2.88'}</div>
            </div>
          </div>

          {/* NODE 2: SJVN REIA CLEARING & TRADING HUB */}
          <div
            onClick={() => setSelectedNode(selectedNode === 'HUB' ? null : 'HUB')}
            style={{
              transform: selectedNode === 'HUB' ? 'translateZ(35px) scale(1.04)' : 'translateZ(20px) scale(1.02)',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              background: 'linear-gradient(145deg, rgba(14, 165, 233, 0.14), rgba(15, 23, 42, 0.95))',
              border: selectedNode === 'HUB' ? '2px solid #38bdf8' : '1.5px solid rgba(56, 189, 248, 0.45)',
              boxShadow: selectedNode === 'HUB'
                ? '0 0 35px rgba(56, 189, 248, 0.5), 0 25px 40px rgba(0, 0, 0, 0.8)'
                : '0 0 25px rgba(14, 165, 233, 0.25), 0 15px 30px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(20px)',
              borderRadius: 16,
              padding: 18,
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            {/* Pulsing REIA Hub Badge */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <span style={{
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                fontWeight: 800,
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.2)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '3px 8px',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'pulse 1.5s infinite' }} />
                2. SJVN REIA Clearing Hub
              </span>
              <span style={{
                background: 'rgba(56, 189, 248, 0.2)',
                borderRadius: '50%',
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
              }}>
                🏛️
              </span>
            </div>

            <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginBottom: 3 }}>
              SJVN Limited (REIA)
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
              Intermediary Trading & Allocation Hub
            </div>

            {/* Core Commercial Spread Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              background: 'rgba(0, 0, 0, 0.4)',
              borderRadius: 10,
              padding: '10px 12px',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              marginBottom: 10,
            }}>
              <div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Trading Margin</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8', marginTop: 2 }}>
                  +₹{tradingMargin.toFixed(3)} <span style={{ fontSize: 10, fontWeight: 400, color: '#64748b' }}>/ kWh</span>
                </div>
                <div style={{ fontSize: 9.5, color: '#64748b' }}>
                  ({(tradingMargin * 100).toFixed(1)} paise spread)
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Total Trading Spread</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', marginTop: 2 }}>
                  {fmtCurrency(totalSpread)}
                </div>
                <div style={{ fontSize: 9.5, color: '#64748b' }}>
                  Throughput: {fmtNumber(effectiveMwh)} MWh
                </div>
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#38bdf8', fontSize: 11 }}>
                Risk: <strong>Zero Open Exposure</strong>
              </span>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{selectedNode === 'HUB' ? '▲ Hide' : '▼ Inspect'}</span>
            </div>
          </div>

          {/* CONDUIT 2: SJVN HUB ➔ PSA BUYER */}
          <div style={{ position: 'relative', height: 140, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="energyGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
                <linearGradient id="cashGrad2" x1="100%" y1="0%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#eab308" />
                </linearGradient>
              </defs>

              {/* Energy Pipe (Top) */}
              <path
                d="M 0 25 L 100 25"
                stroke="rgba(14, 165, 233, 0.25)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M 0 25 L 100 25"
                stroke="url(#energyGrad2)"
                strokeWidth="3"
                strokeDasharray="6 8"
                style={{ animation: 'flowRight 1.5s linear infinite' }}
              />

              {/* Cashflow Pipe (Bottom) */}
              <path
                d="M 0 55 L 100 55"
                stroke="rgba(245, 158, 11, 0.25)"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M 0 55 L 100 55"
                stroke="url(#cashGrad2)"
                strokeWidth="2.5"
                strokeDasharray="5 7"
                style={{ animation: 'flowLeft 1.8s linear infinite' }}
              />
            </svg>

            {/* Throughput Tag */}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#090e1a',
              border: '1px solid #1e293b',
              padding: '2px 6px',
              borderRadius: 6,
              fontSize: 9,
              color: '#818cf8',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              textAlign: 'center',
            }}>
              <div>Allocated {topo.allocation_percent || 100}%</div>
              <div style={{ color: '#f59e0b', fontSize: 8.5 }}>₹{psa?.tariff_per_unit ?? (Number(ppa?.tariff_per_unit || 2.88) + tradingMargin).toFixed(2)}</div>
            </div>
          </div>

          {/* NODE 3: PSA BUYER / OFF-TAKER */}
          <div
            onClick={() => setSelectedNode(selectedNode === 'PSA' ? null : 'PSA')}
            style={{
              transform: selectedNode === 'PSA' ? 'translateZ(25px) scale(1.02)' : 'rotateY(-6deg) translateZ(8px)',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              background: 'linear-gradient(145deg, rgba(129, 140, 248, 0.08), rgba(15, 23, 42, 0.85))',
              border: selectedNode === 'PSA' ? '1.5px solid #818cf8' : '1px solid rgba(129, 140, 248, 0.3)',
              boxShadow: selectedNode === 'PSA'
                ? '0 0 25px rgba(129, 140, 248, 0.35), 0 20px 30px rgba(0, 0, 0, 0.7)'
                : '0 10px 25px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(16px)',
              borderRadius: 14,
              padding: 16,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{
                fontSize: 10,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                color: '#818cf8',
                background: 'rgba(129, 140, 248, 0.15)',
                padding: '2px 7px',
                borderRadius: 4,
              }}>
                3. Buyer Off-Taker (DISCOM)
              </span>
              <span style={{ fontSize: 16 }}>🏢</span>
            </div>

            <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
              {psa?.buyer_name || 'Buyer Off-Taker (DISCOM)'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
              {psa?.contract_no || 'PSA Agreement'} · {psa?.capacity_mw || ppa?.capacity_mw || 50} MW
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              borderRadius: 8,
              padding: '8px 10px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              marginBottom: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                <span>Off-Take Tariff</span>
                <strong style={{ color: '#f8fafc', fontSize: 12 }}>
                  ₹{psa?.tariff_per_unit ?? (Number(ppa?.tariff_per_unit || 2.88) + tradingMargin).toFixed(2)} / kWh
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                <span>Allocated Energy</span>
                <strong style={{ color: '#818cf8' }}>{fmtNumber(effectiveMwh)} MWh</strong>
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Bills to Buyer: <strong>{psaInvoices.length}</strong></span>
              <span style={{ color: '#818cf8', fontWeight: 600 }}>{selectedNode === 'PSA' ? '▲ Hide' : '▼ Inspect'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* INSPECTOR DRAWER: Triggered when user clicks a node */}
      {selectedNode && (
        <div style={{
          marginTop: 16,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #334155',
          borderRadius: 12,
          padding: 16,
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.2s ease-out',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>
                {selectedNode === 'PPA' ? '☀️' : selectedNode === 'HUB' ? '🏛️' : '🏢'}
              </span>
              <strong style={{ color: '#f8fafc', fontSize: 14 }}>
                {selectedNode === 'PPA' && `PPA Source Details: ${ppa?.seller_name || 'Power Producer'}`}
                {selectedNode === 'HUB' && 'SJVN REIA Clearing & Back-to-Back Matching Engine'}
                {selectedNode === 'PSA' && `PSA Off-Taker Details: ${psa?.buyer_name || 'Buyer DISCOM'}`}
              </strong>
            </div>
            <button
              type="button"
              onClick={() => setSelectedNode(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ✕ Close
            </button>
          </div>

          {selectedNode === 'PPA' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 12 }}>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>PPA Contract Number</div>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginTop: 2 }}>{ppa?.contract_no || '—'}</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Capacity: {ppa?.capacity_mw || 50} MW ({ppa?.project_type || 'RE'})</div>
              </div>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Base Tariff Rate</div>
                <div style={{ fontWeight: 600, color: '#10b981', marginTop: 2 }}>₹{ppa?.tariff_per_unit || '2.88'} / unit</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>CERC / State Regulated</div>
              </div>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Invoices Raised by Seller</div>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginTop: 2 }}>
                  {ppaInvoices.length > 0 ? (
                    ppaInvoices.map((inv) => `${inv.invoice_no} (${fmtCurrency(inv.total_amount)})`).join(', ')
                  ) : 'No invoices on period'}
                </div>
              </div>
            </div>
          )}

          {selectedNode === 'HUB' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 12 }}>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Role & Intermediary Position</div>
                <div style={{ fontWeight: 600, color: '#38bdf8', marginTop: 2 }}>Renewable Energy Implementing Agency</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Designated under Ministry of Power Guidelines</div>
              </div>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Trading Margin Spread</div>
                <div style={{ fontWeight: 600, color: '#10b981', marginTop: 2 }}>₹{tradingMargin.toFixed(3)} / unit (7.00p)</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Period Spread Yield: {fmtCurrency(totalSpread)}</div>
              </div>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Back-to-Back Balancing</div>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginTop: 2 }}>Zero Open Position</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>PPA purchase 100% matched to PSA sale</div>
              </div>
            </div>
          )}

          {selectedNode === 'PSA' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 12 }}>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>PSA Contract Number</div>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginTop: 2 }}>{psa?.contract_no || '—'}</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Off-Taker: {psa?.buyer_name || 'Buyer'}</div>
              </div>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>Off-Take Tariff (Pass-Through)</div>
                <div style={{ fontWeight: 600, color: '#818cf8', marginTop: 2 }}>
                  ₹{psa?.tariff_per_unit || (Number(ppa?.tariff_per_unit || 2.88) + tradingMargin).toFixed(2)} / unit
                </div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Base ₹{ppa?.tariff_per_unit || '2.88'} + Margin ₹{tradingMargin.toFixed(3)}</div>
              </div>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>SJVN Invoices to Buyer</div>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginTop: 2 }}>
                  {psaInvoices.length > 0 ? (
                    psaInvoices.map((inv) => `${inv.invoice_no} (${fmtCurrency(inv.total_amount)})`).join(', ')
                  ) : 'No invoices on period'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* HORIZONTAL LIFECYCLE RAIL: Provisional REA ➔ Final REA ➔ True-Up Delta ➔ Cash Settlement */}
      <div style={{
        marginTop: 24,
        background: 'rgba(15, 23, 42, 0.75)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
        padding: '16px 18px',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', letterSpacing: 0.3 }}>
              Settlement Lifecycle &amp; True-Up Rail
            </span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              (Provisional Baseline vs Final REA True-Up Progression)
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Period Energy Delta: <strong style={{ color: trail.delta_mwh > 0 ? '#10b981' : trail.delta_mwh < 0 ? '#ef4444' : '#38bdf8' }}>
                {trail.delta_mwh != null ? `${fmtNumber(trail.delta_mwh)} MWh` : '0.00 MWh'}
              </strong>
            </span>
          </div>
        </div>

        {/* 4-Stage Progress Track */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}>
          {/* STAGE 1: PROVISIONAL BASELINE */}
          <div style={{
            background: '#090e1a',
            border: trail.provisional_energy ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid #1e293b',
            borderRadius: 10,
            padding: 12,
            position: 'relative',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', textTransform: 'uppercase' }}>
                Stage 1: Provisional REA
              </span>
              <span style={{ fontSize: 10, color: '#10b981' }}>● Locked</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
              {trail.provisional_energy ? `${fmtNumber(trail.provisional_energy.energy_mwh)} MWh` : 'No Record'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
              Billed: {fmtCurrency(trail.provisional_billed || 0)}
            </div>
          </div>

          {/* STAGE 2: FINAL REA AUDIT */}
          <div style={{
            background: '#090e1a',
            border: trail.final_energy ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid #1e293b',
            borderRadius: 10,
            padding: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase' }}>
                Stage 2: Final REA Audit
              </span>
              <span style={{ fontSize: 10, color: trail.final_energy ? '#38bdf8' : '#64748b' }}>
                {trail.final_energy ? '● Verified' : '○ Awaiting Final'}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
              {trail.final_energy ? `${fmtNumber(trail.final_energy.energy_mwh)} MWh` : 'Pending CERC / RPC'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
              Δ Energy: {trail.delta_mwh != null ? `${fmtNumber(trail.delta_mwh)} MWh` : '—'}
            </div>
          </div>

          {/* STAGE 3: TRUE-UP & DELTA BILL */}
          <div style={{
            background: '#090e1a',
            border: trail.final_invoices?.length ? '1px solid rgba(129, 140, 248, 0.4)' : '1px solid #1e293b',
            borderRadius: 10,
            padding: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', textTransform: 'uppercase' }}>
                Stage 3: True-Up Adjustment
              </span>
              <span style={{ fontSize: 10, color: trail.final_invoices?.length ? '#818cf8' : '#64748b' }}>
                {trail.final_invoices?.length ? '● Generated' : '○ Not Required'}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
              {trail.final_invoices?.length ? `${trail.final_invoices.length} Bills Raised` : 'No Adjustments'}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
              Net Due: {trail.net_due != null ? fmtCurrency(trail.net_due) : '₹0'}
            </div>
          </div>

          {/* STAGE 4: CASH REALIZATION */}
          <div style={{
            background: '#090e1a',
            border: (trail.paid_on_period || trail.already_paid) ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid #1e293b',
            borderRadius: 10,
            padding: 12,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' }}>
                Stage 4: Settlement Realization
              </span>
              <span style={{ fontSize: 10, color: '#f59e0b' }}>● Clearing</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
              {fmtCurrency(trail.paid_on_period ?? trail.already_paid ?? 0)}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
              Realized on Period
            </div>
          </div>
        </div>

        {/* Hydro Frequency Beta Response Strip (If Hydro / Certified) */}
        {trail.frequency_beta && (
          <div style={{
            marginTop: 12,
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
            fontSize: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🌊</span>
              <span>
                Hydro Frequency Response Performance: <strong>β = {Number(trail.frequency_beta.beta_value).toFixed(2)}</strong>
                {trail.frequency_beta.station_name ? ` (${trail.frequency_beta.station_name})` : ''} ·
                Incentive: <strong style={{ color: '#10b981' }}>{fmtCurrency(trail.frequency_beta.computed_incentive || 0)}</strong>
              </span>
            </div>
            <div style={{ color: '#38bdf8', fontSize: 11 }}>
              True-Up Δ: {fmtCurrency(trail.frequency_beta.true_up_delta || 0)} · Source: {trail.frequency_beta.source || 'NRPC'}
            </div>
          </div>
        )}
      </div>

      {/* Embedded Animation Styles */}
      <style>{`
        @keyframes flowRight {
          0% { stroke-dashoffset: 28; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes flowLeft {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: 28; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * Classic Audit Ledger View (Tabular Records & Family Audit)
 */
function AuditLedgerView({ trail }) {
  const s = trail.summary || {};

  return (
    <div style={{
      background: 'var(--slate-50)',
      border: '1px solid var(--slate-200)',
      borderRadius: '0 0 12px 12px',
      padding: 16,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Stat label="Period" value={trail.billing_period} />
        <Stat label="Paid on the period" value={fmtCurrency(trail.paid_on_period ?? trail.already_paid)} />
        <Stat label="Δ Energy" value={trail.delta_mwh != null ? `${fmtNumber(trail.delta_mwh)} MWh` : '—'} />
        <Stat label="Net due (final)" value={trail.net_due != null ? fmtCurrency(trail.net_due) : '—'} hint={trail.net_due_invoice_no || undefined} />
        {trail.frequency_beta && (
          <Stat
            label="Freq. β"
            value={trail.frequency_beta.status === 'CERTIFIED'
              ? Number(trail.frequency_beta.beta_value).toFixed(2)
              : 'Pending'}
          />
        )}
      </div>

      {trail.frequency_beta && (
        <TrailBlock title="Frequency Response Performance (β)" style={{ marginBottom: 12 }}>
          {trail.frequency_beta.status === 'CERTIFIED' ? (
            <>
              <div>
                β = <strong>{Number(trail.frequency_beta.beta_value).toFixed(2)}</strong>
                {trail.frequency_beta.station_code ? ` · ${trail.frequency_beta.station_code}` : ''}
                {trail.frequency_beta.station_name ? ` (${trail.frequency_beta.station_name})` : ''}
                {' · '}<Badge status="ACTIVE" label={trail.frequency_beta.source || 'NRPC'} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 4 }}>
                {trail.frequency_beta.certified_on ? `Certified ${trail.frequency_beta.certified_on} · ` : ''}
                Incentive {fmtCurrency(trail.frequency_beta.computed_incentive || 0)}
                {trail.frequency_beta.already_billed_incentive
                  ? ` · billed ${fmtCurrency(trail.frequency_beta.already_billed_incentive)}`
                  : ''}
                {trail.frequency_beta.true_up_delta
                  ? ` · true-up Δ ${fmtCurrency(trail.frequency_beta.true_up_delta)}`
                  : ''}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{trail.frequency_beta.incentive_reason}</div>
            </>
          ) : (
            <span style={{ color: 'var(--text-subtle)' }}>Awaiting NRPC β certificate — provisional bills exclude incentive; true-up when certified</span>
          )}
        </TrailBlock>
      )}

      {trail.direction === 'SJVN_TO_BUYER' && !trail.psa_unallocated && (
        <div style={{ fontSize: 12, color: 'var(--slate-500)', marginBottom: 10, padding: '6px 10px', background: '#eef2ff', borderRadius: 6 }}>
          Energy shown below is the <strong>source PPA</strong> generation for this period. The PSA bill uses the allocated share (see invoice breakdown: Source PPA Energy × Allocation %).
        </div>
      )}
      {trail.psa_unallocated && (
        <div style={{ fontSize: 12, color: '#92400e', marginBottom: 10, padding: '6px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6 }}>
          This PSA holds no allocation from a PPA, so there is no source energy to show for it — and no energy bill can be generated on it until the PPA allocates it a share (Contracts → the source PPA).
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <TrailBlock title="Provisional Energy">
          {trail.provisional_energy ? (
            <>
              <div>{fmtNumber(trail.provisional_energy.energy_mwh)} MWh · {trail.provisional_energy.source}</div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}><Badge status={trail.provisional_energy.status} /> · {trail.provisional_energy.id}</div>
            </>
          ) : <span style={{ color: 'var(--text-subtle)' }}>{trail.psa_unallocated ? 'No source PPA' : 'None'}</span>}
        </TrailBlock>
        <TrailBlock title="Final Energy">
          {trail.final_energy ? (
            <>
              <div>{fmtNumber(trail.final_energy.energy_mwh)} MWh · {trail.final_energy.source}</div>
              <div style={{ fontSize: 12, color: 'var(--slate-500)' }}>
                <Badge status={trail.final_energy.status} />
                {trail.final_energy.supersedes_energy_id && ' · replaces the provisional figure'}
              </div>
            </>
          ) : <span style={{ color: 'var(--text-subtle)' }}>{trail.psa_unallocated ? 'No source PPA' : 'Awaiting CERC final'}</span>}
        </TrailBlock>
      </div>

      <TrailBlock title="Provisional Invoices" style={{ marginTop: 12 }}>
        {trail.provisional_invoices?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {trail.provisional_invoices.map((inv) => (
              <li key={inv.id}>
                {inv.invoice_no}{whose(inv, trail)} · {fmtCurrency(inv.total_amount)} · <Badge status={inv.status} />
              </li>
            ))}
          </ul>
        ) : <span style={{ color: 'var(--text-subtle)' }}>None</span>}
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--slate-500)' }}>
          Billed {fmtCurrency(trail.provisional_billed)} · Paid on provisional {fmtCurrency(trail.already_paid)}
        </div>
      </TrailBlock>

      <TrailBlock title="Final, Supplementary and Arrear Bills" style={{ marginTop: 12 }}>
        {trail.final_invoices?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {trail.final_invoices.map((inv) => (
              <li key={inv.id}>
                {inv.invoice_no} ({inv.invoice_type}){whose(inv, trail)} · Net {fmtCurrency(inv.total_amount)}
                {inv.other_adjustments ? ` · adj ${fmtCurrency(inv.other_adjustments)}` : ''}
                {inv.paid_total > 0 ? ` · paid ${fmtCurrency(inv.paid_total)}` : ''}
                {' · '}<Badge status={inv.status} />
              </li>
            ))}
          </ul>
        ) : <span style={{ color: 'var(--text-subtle)' }}>Not generated yet</span>}
      </TrailBlock>
    </div>
  );
}

// On a PPA month the family holds SJVN's own computation and the invoice the
// seller raised; say which is which, since they can differ.
function whose(inv, trail) {
  if (trail.direction !== 'SELLER_TO_SJVN' || inv.raised_by_seller == null) return '';
  return inv.raised_by_seller ? ' — seller\u2019s invoice' : ' — SJVN\u2019s computation';
}

function Stat({ label, value, hint }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--slate-200)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 11, color: 'var(--slate-500)', textTransform: 'none', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate-900)', marginTop: 2 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--slate-500)', marginTop: 1, wordBreak: 'break-all' }}>{hint}</div>}
    </div>
  );
}

function TrailBlock({ title, children, style }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--slate-200)', borderRadius: 6, padding: 12, ...style }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--slate-600)', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

/** Clickable BFR chip that opens the trail via onOpen(bfr). */
export function BfrChip({ bfr, onClick }) {
  if (!bfr) return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(bfr); }}
      title={bfr}
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 4,
        border: '1px solid #c7d2fe',
        background: '#eef2ff',
        color: '#4338ca',
        cursor: onClick ? 'pointer' : 'default',
        maxWidth: 220,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {bfr}
    </button>
  );
}
