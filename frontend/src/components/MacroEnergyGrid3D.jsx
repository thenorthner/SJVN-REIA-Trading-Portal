import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * MacroEnergyGrid3D
 * Top-tier 3D Live Power & Trading Margin Grid for SJVN REIA Executive Dashboard.
 * Visualizes the complete macro energy throughput:
 * Active Generators (Solar/Wind/Hybrid) ➔ SJVN REIA Core Hub ➔ State DISCOM Off-Takers
 * Displays live aggregated MW, cumulative CERC Trading Margin yield, and pass-through back-to-back sync.
 */

const GENERATORS = [
  {
    id: 'GEN-ADANI-250',
    name: 'Adani Green Energy Ltd',
    tech: 'Solar PV',
    capacity_mw: 250,
    contract_no: 'PPA-SOLAR-250MW',
    tariff: 2.82,
    cod: '2025-08-15',
    status: 'ONLINE',
    color: '#10b981',
  },
  {
    id: 'GEN-SUNRISE-50',
    name: 'Sunrise Solar Power Ltd',
    tech: 'Solar PV',
    capacity_mw: 50,
    contract_no: 'PPA-SUN-50MW',
    tariff: 2.88,
    cod: '2024-11-20',
    status: 'ONLINE',
    color: '#06b6d4',
  },
  {
    id: 'GEN-RENEW-100',
    name: 'ReNew Energy Global',
    tech: 'Wind Onshore',
    capacity_mw: 100,
    contract_no: 'PPA-WIND-100MW',
    tariff: 2.95,
    cod: '2025-03-30',
    status: 'ONLINE',
    color: '#38bdf8',
  },
  {
    id: 'GEN-GREENKO-120',
    name: 'Greenko Power & Energy',
    tech: 'Hybrid (Solar + Pumped)',
    capacity_mw: 120,
    contract_no: 'PPA-RTC-120MW',
    tariff: 3.15,
    cod: '2025-06-10',
    status: 'ONLINE',
    color: '#818cf8',
  },
];

const DISCOMS = [
  {
    id: 'DIS-PSPCL',
    name: 'PSPCL (Punjab)',
    state: 'Punjab',
    capacity_mw: 200,
    share_percent: 38.5,
    psa_no: 'PSA-PB-200MW',
    landed_tariff: 2.89,
    lc_status: 'ACTIVE_COVERED',
    color: '#38bdf8',
  },
  {
    id: 'DIS-HPPC',
    name: 'HPPC (Haryana)',
    state: 'Haryana',
    capacity_mw: 150,
    share_percent: 28.8,
    psa_no: 'PSA-HR-150MW',
    landed_tariff: 2.89,
    lc_status: 'ACTIVE_COVERED',
    color: '#818cf8',
  },
  {
    id: 'DIS-NDMC',
    name: 'NDMC (Delhi)',
    state: 'Delhi',
    capacity_mw: 100,
    share_percent: 19.2,
    psa_no: 'PSA-DL-100MW',
    landed_tariff: 2.95,
    lc_status: 'ACTIVE_COVERED',
    color: 'var(--on-blue)',
  },
  {
    id: 'DIS-RUVNL',
    name: 'RUVNL (Rajasthan)',
    state: 'Rajasthan',
    capacity_mw: 70,
    share_percent: 13.5,
    psa_no: 'PSA-RJ-70MW',
    landed_tariff: 3.02,
    lc_status: 'ACTIVE_COVERED',
    color: 'var(--on-blue)',
  },
];

export default function MacroEnergyGrid3D({
  activeContractsCount = 8,
  contractedCapacity = 520,
  tradingMarginPerUnit = 0.07,
  onOpenSettlementTrail,
}) {
  const [metricMode, setMetricMode] = useState('CAPACITY'); // 'CAPACITY' | 'REVENUE'
  const [hoveredGenId, setHoveredGenId] = useState(null);
  const [hoveredDiscomId, setHoveredDiscomId] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState(null);

  const totalCapacityMw = GENERATORS.reduce((s, g) => s + g.capacity_mw, 0);
  const monthlyScheduledMwh = totalCapacityMw * 1000 * 0.235 * 720 / 1000; // approx 23.5% CUF
  const monthlyMarginYield = (monthlyScheduledMwh * 1000 * tradingMarginPerUnit); // in Rupees

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 30%, #0c1427 0%, #050811 100%)',
      borderRadius: 14,
      border: '1px solid #1e293b',
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      padding: '20px 22px',
      marginBottom: 20,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Background Cybernetic Matrix Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(14, 165, 233, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(14, 165, 233, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '28px 28px',
        pointerEvents: 'none',
      }} />

      {/* Top Header & Executive Control Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        paddingBottom: 16,
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        position: 'relative',
        zIndex: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            background: 'linear-gradient(135deg, #0284c7, #2563eb)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(37, 99, 235, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                Macro Energy & Trading Margin Grid
              </h3>
              <span style={{
                fontSize: 12.5,
                textTransform: 'uppercase',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>
                Live Pass-Through Synced
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              SJVN Limited (REIA Intermediary Desk) · CERC Section 63 Regulated Portfolio
            </div>
          </div>
        </div>

        {/* View Toggle & KPI Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex',
            background: '#090e1a',
            padding: 3,
            borderRadius: 8,
            border: '1px solid #1e293b',
          }}>
            <button
              type="button"
              onClick={() => setMetricMode('CAPACITY')}
              style={{
                background: metricMode === 'CAPACITY' ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'transparent',
                color: metricMode === 'CAPACITY' ? '#fff' : '#94a3b8',
                border: 'none',
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Capacity Flow (MW)
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('REVENUE')}
              style={{
                background: metricMode === 'REVENUE' ? 'linear-gradient(135deg, #059669, #10b981)' : 'transparent',
                color: metricMode === 'REVENUE' ? '#fff' : '#94a3b8',
                border: 'none',
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Revenue & Margin (₹)
            </button>
          </div>

          <div style={{
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            padding: '5px 10px',
            borderRadius: 6,
            fontSize: 13,
            color: '#38bdf8',
            fontWeight: 600,
          }}>
            Trading Margin: <strong>+₹0.07 / kWh</strong>
          </div>
        </div>
      </div>

      {/* 3D Multi-Stage Isometric Energy Pipeline */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        marginTop: 20,
        perspective: '1200px',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(230px, 1.1fr) minmax(80px, 110px) minmax(260px, 1.2fr) minmax(80px, 110px) minmax(230px, 1.1fr)',
          alignItems: 'center',
          gap: 0,
        }}>
          {/* COLUMN 1: GENERATION SOURCE POOL (IPPs) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: '#10b981',
              letterSpacing: 0.6,
              marginBottom: 2,
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>1. Active Generators ({GENERATORS.length})</span>
              <span>{fmtNumber(totalCapacityMw)} MW Pool</span>
            </div>

            {GENERATORS.map((gen, idx) => {
              const isHovered = hoveredGenId === gen.id;
              const isSelected = selectedEntity?.id === gen.id;

              return (
                <div
                  key={gen.id}
                  onMouseEnter={() => setHoveredGenId(gen.id)}
                  onMouseLeave={() => setHoveredGenId(null)}
                  onClick={() => setSelectedEntity(isSelected ? null : gen)}
                  style={{
                    background: isHovered || isSelected
                      ? 'linear-gradient(145deg, rgba(16, 185, 129, 0.2), rgba(15, 23, 42, 0.95))'
                      : 'linear-gradient(145deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.85))',
                    border: isHovered || isSelected ? '1.5px solid #10b981' : '1px solid rgba(16, 185, 129, 0.25)',
                    boxShadow: isHovered || isSelected
                      ? '0 0 16px rgba(16, 185, 129, 0.35), 0 8px 16px rgba(0,0,0,0.6)'
                      : '0 4px 12px rgba(0,0,0,0.4)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    transform: isHovered || isSelected ? 'translateX(4px) scale(1.02)' : 'none',
                    transition: 'all 0.25s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <strong style={{ fontSize: 13.5, color: '#f8fafc' }}>{gen.name}</strong>
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: gen.color,
                      background: 'rgba(255,255,255,0.06)',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}>
                      {gen.tech}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}>
                    <span>{gen.contract_no}</span>
                    <strong style={{ color: '#10b981' }}>
                      {metricMode === 'CAPACITY' ? `${fmtNumber(gen.capacity_mw)} MW` : `₹${gen.tariff.toFixed(2)}/u`}
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>

          {/* CONVERGING CONDUITS: GENERATORS ➔ SJVN CORE */}
          <div style={{ position: 'relative', height: 260, display: 'flex', alignItems: 'center' }}>
            <svg width="100%" height="100%" viewBox="0 0 100 260" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="macroInflowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>
              {GENERATORS.map((gen, idx) => {
                const startY = 30 + (idx * (260 - 60) / (GENERATORS.length - 1));
                const endY = 130;
                const isHovered = hoveredGenId === gen.id;

                return (
                  <g key={gen.id}>
                    <path
                      d={`M 0 ${startY} C 50 ${startY}, 50 ${endY}, 100 ${endY}`}
                      stroke={isHovered ? '#10b981' : 'rgba(16, 185, 129, 0.2)'}
                      strokeWidth={isHovered ? 5 : 3}
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d={`M 0 ${startY} C 50 ${startY}, 50 ${endY}, 100 ${endY}`}
                      stroke="url(#macroInflowGrad)"
                      strokeWidth={isHovered ? 3.5 : 2}
                      fill="none"
                      strokeDasharray="5 7"
                      style={{ animation: 'macroConduitFlow 1.8s linear infinite' }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* COLUMN 2: SJVN REIA CORE TRADING & MARGIN ENGINE */}
          <div style={{
            background: 'linear-gradient(145deg, rgba(14, 165, 233, 0.16), rgba(15, 23, 42, 0.95))',
            border: '2px solid rgba(56, 189, 248, 0.45)',
            boxShadow: '0 0 30px rgba(14, 165, 233, 0.35), 0 15px 35px rgba(0, 0, 0, 0.7)',
            borderRadius: 14,
            padding: 18,
            transform: 'translateZ(15px) scale(1.02)',
            textAlign: 'center',
            position: 'relative',
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(56, 189, 248, 0.2)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              padding: '3px 10px',
              borderRadius: 20,
              fontSize: 12.5,
              fontWeight: 800,
              color: '#38bdf8',
              letterSpacing: 0.6,
              marginBottom: 10,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'macroPulse 1.4s infinite' }} />
              SJVN REIA CORE HUB
            </div>

            <div style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', marginBottom: 2 }}>
              Central Intermediary Engine
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>
              Zero-Balancing Pass-Through Synchronization
            </div>

            {/* Core Metrics Box */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>Aggregated Throughput</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8', marginTop: 2 }}>
                {fmtNumber(totalCapacityMw)} MW
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--slate-500)', marginTop: 3 }}>
                Est. {fmtNumber(Math.round(monthlyScheduledMwh))} MWh / month
              </div>
            </div>

            <div style={{
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 13,
            }}>
              <span style={{ color: '#94a3b8' }}>Trading Margin Yield:</span>
              <strong style={{ color: '#10b981', fontSize: 13 }}>
                ₹{(monthlyMarginYield / 100000).toFixed(2)} Lakh / mo
              </strong>
            </div>
          </div>

          {/* BRANCHING CONDUITS: SJVN CORE ➔ DISCOMs */}
          <div style={{ position: 'relative', height: 260, display: 'flex', alignItems: 'center' }}>
            <svg width="100%" height="100%" viewBox="0 0 100 260" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="macroOutflowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
              </defs>
              {DISCOMS.map((dis, idx) => {
                const startY = 130;
                const endY = 30 + (idx * (260 - 60) / (DISCOMS.length - 1));
                const isHovered = hoveredDiscomId === dis.id;

                return (
                  <g key={dis.id}>
                    <path
                      d={`M 0 ${startY} C 50 ${startY}, 50 ${endY}, 100 ${endY}`}
                      stroke={isHovered ? '#818cf8' : 'rgba(129, 140, 248, 0.2)'}
                      strokeWidth={isHovered ? 5 : 3}
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d={`M 0 ${startY} C 50 ${startY}, 50 ${endY}, 100 ${endY}`}
                      stroke="url(#macroOutflowGrad)"
                      strokeWidth={isHovered ? 3.5 : 2}
                      fill="none"
                      strokeDasharray="5 7"
                      style={{ animation: 'macroConduitFlow 1.8s linear infinite' }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* COLUMN 3: STATE DISCOM OFF-TAKERS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: '#818cf8',
              letterSpacing: 0.6,
              marginBottom: 2,
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span>3. State DISCOMs ({DISCOMS.length})</span>
              <span>100% Allocated</span>
            </div>

            {DISCOMS.map((dis, idx) => {
              const isHovered = hoveredDiscomId === dis.id;
              const isSelected = selectedEntity?.id === dis.id;

              return (
                <div
                  key={dis.id}
                  onMouseEnter={() => setHoveredDiscomId(dis.id)}
                  onMouseLeave={() => setHoveredDiscomId(null)}
                  onClick={() => setSelectedEntity(isSelected ? null : dis)}
                  style={{
                    background: isHovered || isSelected
                      ? 'linear-gradient(145deg, rgba(129, 140, 248, 0.2), rgba(15, 23, 42, 0.95))'
                      : 'linear-gradient(145deg, rgba(129, 140, 248, 0.08), rgba(15, 23, 42, 0.85))',
                    border: isHovered || isSelected ? '1.5px solid #818cf8' : '1px solid rgba(129, 140, 248, 0.25)',
                    boxShadow: isHovered || isSelected
                      ? '0 0 16px rgba(129, 140, 248, 0.35), 0 8px 16px rgba(0,0,0,0.6)'
                      : '0 4px 12px rgba(0,0,0,0.4)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    transform: isHovered || isSelected ? 'translateX(-4px) scale(1.02)' : 'none',
                    transition: 'all 0.25s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <strong style={{ fontSize: 13.5, color: '#f8fafc' }}>{dis.name}</strong>
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: '#10b981',
                      background: 'rgba(16, 185, 129, 0.12)',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}>
                      LC COVERED
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}>
                    <span>{dis.psa_no}</span>
                    <strong style={{ color: '#38bdf8' }}>
                      {metricMode === 'CAPACITY' ? `${fmtNumber(dis.capacity_mw)} MW (${dis.share_percent}%)` : `₹${dis.landed_tariff.toFixed(2)}/u`}
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* INSPECTOR DRAWER: Opens when a Generator or DISCOM is clicked */}
      {selectedEntity && (
        <div style={{
          marginTop: 18,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid #334155',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          position: 'relative',
          zIndex: 3,
          animation: 'macroFadeIn 0.2s ease-out',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: selectedEntity.color || '#38bdf8' }} />
              <strong style={{ color: '#f8fafc', fontSize: 14 }}>{selectedEntity.name}</strong>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>
                ({selectedEntity.tech || selectedEntity.state || 'REIA Portfolio'})
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>
              Contract: <strong>{selectedEntity.contract_no || selectedEntity.psa_no}</strong> · Allocated Capacity: <strong style={{ color: '#38bdf8' }}>{selectedEntity.capacity_mw} MW</strong> · Base Tariff: <strong>₹{Number(selectedEntity.tariff || selectedEntity.landed_tariff).toFixed(2)} / unit</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {onOpenSettlementTrail && (
              <button
                type="button"
                onClick={() => onOpenSettlementTrail(selectedEntity)}
                style={{
                  background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                View Settlement Trail →
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedEntity(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 13.5,
              }}
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}

      {/* Embedded CSS Keyframes */}
      <style>{`
        @keyframes macroConduitFlow {
          0% { stroke-dashoffset: 24; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes macroPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.85); }
        }
        @keyframes macroFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
