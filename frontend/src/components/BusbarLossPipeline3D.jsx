import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * BusbarLossPipeline3D
 * 3D ISTS / Grid Transmission Conduit:
 * Generator Busbar Injection (MWh) ➔ ISTS CTU Inter-State Transmission Grid (Losses deduction ~3.5%) ➔ State Periphery Delivery Point (MWh)
 * Features live Deviation / DSM Balancing Chamber showing schedule vs actual generation differences.
 */

const SAMPLE_DATASETS = [
  {
    id: 'CON-SOLAR-250MW',
    contract_name: '250 MW Mega Solar (Adani ➔ PB, HR, DL)',
    gross_busbar_mwh: 42500,
    scheduled_mwh: 42200,
    loss_percent: 3.52,
    frequency_hz: 50.02,
    dsm_rate_per_kwh: 1.62,
    deliveries: [
      { buyer: 'PSPCL (Punjab)', share_percent: 40, mwh: 16401.6 },
      { buyer: 'HPPC (Haryana)', share_percent: 40, mwh: 16401.6 },
      { buyer: 'NDMC (Delhi)', share_percent: 20, mwh: 8200.8 },
    ],
  },
  {
    id: 'CON-572a3db958704c6b',
    contract_name: '50 MW Solar PV (Sunrise Solar ➔ Punjab)',
    gross_busbar_mwh: 8500,
    scheduled_mwh: 8650,
    loss_percent: 3.48,
    frequency_hz: 49.98,
    dsm_rate_per_kwh: 2.15,
    deliveries: [
      { buyer: 'PSPCL (Punjab)', share_percent: 100, mwh: 8204.2 },
    ],
  },
];

export default function BusbarLossPipeline3D({
  selectedContractId,
  contracts = [],
}) {
  const [activeContractIndex, setActiveContractIndex] = useState(0);
  const [selectedStage, setSelectedStage] = useState(null);

  const dataset = SAMPLE_DATASETS[activeContractIndex] || SAMPLE_DATASETS[0];

  const grossMwh = dataset.gross_busbar_mwh;
  const lossMwh = Math.round((grossMwh * (dataset.loss_percent / 100)) * 100) / 100;
  const netDeliveredMwh = Math.round((grossMwh - lossMwh) * 100) / 100;

  // DSM deviation calculation
  const deviationMwh = Math.round((grossMwh - dataset.scheduled_mwh) * 100) / 100;
  const isOverInjection = deviationMwh >= 0;
  const dsmFinancialAmount = Math.abs(deviationMwh) * 1000 * dataset.dsm_rate_per_kwh;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 25%, #0c1427 0%, #050811 100%)',
      borderRadius: 14,
      border: '1px solid #1e293b',
      boxShadow: '0 12px 35px rgba(0,0,0,0.6)',
      padding: '20px 22px',
      marginBottom: 20,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Background Matrix Grid */}
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

      {/* Top Header & Portfolio Controls */}
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
            background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 16px rgba(14, 165, 233, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14.5L12 3l8 11.5h-5v6.5h-6v-6.5H4z" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                Busbar to Periphery 3D Transmission & Loss Pipeline
              </h3>
              <span style={{
                fontSize: 10,
                textTransform: 'uppercase',
                background: 'rgba(14, 165, 233, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(14, 165, 233, 0.3)',
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>
                ISTS CTU Certified
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
              Central Transmission Utility (PGCIL) 400 kV Grid Losses & CERC DSM Balancing Slab
            </div>
          </div>
        </div>

        {/* Contract Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>PPA Stream:</span>
          <div style={{
            display: 'flex',
            background: '#090e1a',
            padding: 3,
            borderRadius: 8,
            border: '1px solid #1e293b',
          }}>
            {SAMPLE_DATASETS.map((ds, idx) => (
              <button
                key={ds.id}
                type="button"
                onClick={() => setActiveContractIndex(idx)}
                style={{
                  background: activeContractIndex === idx ? 'linear-gradient(135deg, #0284c7, #2563eb)' : 'transparent',
                  color: activeContractIndex === idx ? '#fff' : '#94a3b8',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {ds.id === 'CON-SOLAR-250MW' ? '250 MW Solar' : '50 MW Solar'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3D Energy Transmission Corridor */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        marginTop: 20,
        perspective: '1200px',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1.1fr) minmax(80px, 120px) minmax(260px, 1.3fr) minmax(80px, 120px) minmax(240px, 1.2fr)',
          alignItems: 'center',
          gap: 0,
        }}>
          {/* STAGE 1: GENERATOR BUSBAR INJECTION */}
          <div
            onClick={() => setSelectedStage(selectedStage === 'BUSBAR' ? null : 'BUSBAR')}
            style={{
              background: selectedStage === 'BUSBAR'
                ? 'linear-gradient(145deg, rgba(16, 185, 129, 0.2), rgba(15, 23, 42, 0.95))'
                : 'linear-gradient(145deg, rgba(16, 185, 129, 0.08), rgba(15, 23, 42, 0.85))',
              border: selectedStage === 'BUSBAR' ? '2px solid #10b981' : '1px solid rgba(16, 185, 129, 0.3)',
              boxShadow: selectedStage === 'BUSBAR'
                ? '0 0 25px rgba(16, 185, 129, 0.4), 0 10px 25px rgba(0,0,0,0.6)'
                : '0 4px 15px rgba(0,0,0,0.4)',
              borderRadius: 12,
              padding: '16px',
              cursor: 'pointer',
              transform: selectedStage === 'BUSBAR' ? 'scale(1.02)' : 'rotateY(6deg)',
              transition: 'all 0.25s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '2px 6px',
                borderRadius: 4,
              }}>
                Stage 1: Injection
              </span>
              <span style={{ fontSize: 10, color: '#64748b' }}>400 kV Pooling</span>
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
              Generator Busbar (Gross)
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
              Special Energy Meters (SEM)
            </div>

            <div style={{
              background: 'rgba(0,0,0,0.4)',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Gross Metered Energy</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981', marginTop: 2 }}>
                {fmtNumber(grossMwh)} MWh
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
                15-Min Block Time-of-Day (ToD)
              </div>
            </div>
          </div>

          {/* HIGH-VOLTAGE CONDUIT 1: BUSBAR ➔ ISTS LOSS CHAMBER */}
          <div style={{ position: 'relative', height: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="istsLossGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>
              <path
                d="M 0 40 L 100 40"
                stroke="rgba(16, 185, 129, 0.25)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M 0 40 L 100 40"
                stroke="url(#istsLossGrad)"
                strokeWidth="3.5"
                strokeDasharray="6 8"
                style={{ animation: 'lossCorridorFlow 1.6s linear infinite' }}
              />
            </svg>

            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#090e1a',
              border: '1px solid #1e293b',
              padding: '3px 6px',
              borderRadius: 6,
              fontSize: 9,
              color: '#38bdf8',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              textAlign: 'center',
            }}>
              <div>-{dataset.loss_percent}%</div>
              <div style={{ color: '#f59e0b', fontSize: 8 }}>-{fmtNumber(lossMwh)} MWh</div>
            </div>
          </div>

          {/* STAGE 2: ISTS TRANSMISSION & DSM BALANCING CHAMBER */}
          <div
            onClick={() => setSelectedStage(selectedStage === 'DSM' ? null : 'DSM')}
            style={{
              background: selectedStage === 'DSM'
                ? 'linear-gradient(145deg, rgba(14, 165, 233, 0.22), rgba(15, 23, 42, 0.95))'
                : 'linear-gradient(145deg, rgba(14, 165, 233, 0.12), rgba(15, 23, 42, 0.9))',
              border: selectedStage === 'DSM' ? '2px solid #38bdf8' : '1.5px solid rgba(56, 189, 248, 0.4)',
              boxShadow: selectedStage === 'DSM'
                ? '0 0 30px rgba(56, 189, 248, 0.4), 0 12px 30px rgba(0,0,0,0.7)'
                : '0 6px 20px rgba(0,0,0,0.5)',
              borderRadius: 14,
              padding: '16px',
              cursor: 'pointer',
              transform: selectedStage === 'DSM' ? 'scale(1.03)' : 'translateZ(10px)',
              transition: 'all 0.25s ease',
              textAlign: 'center',
            }}
          >
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: 'rgba(56, 189, 248, 0.18)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              padding: '2px 8px',
              borderRadius: 20,
              fontSize: 10,
              fontWeight: 800,
              color: '#38bdf8',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'lossPulse 1.5s infinite' }} />
              Stage 2: ISTS CTU Grid
            </div>

            <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc', marginBottom: 2 }}>
              Central Transmission & Loss Pool
            </div>
            <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 10 }}>
              Regional PoC Loss Deduction: <strong>{dataset.loss_percent}%</strong>
            </div>

            <div style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              padding: '8px 10px',
              marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>
                <span>Scheduled Energy:</span>
                <strong style={{ color: '#f8fafc' }}>{fmtNumber(dataset.scheduled_mwh)} MWh</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                <span>Deviation (DSM):</span>
                <strong style={{ color: isOverInjection ? '#10b981' : '#ef4444' }}>
                  {isOverInjection ? `+${fmtNumber(deviationMwh)} MWh (Over)` : `${fmtNumber(deviationMwh)} MWh (Under)`}
                </strong>
              </div>
            </div>

            <div style={{
              fontSize: 10.5,
              color: '#10b981',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '4px 6px',
              borderRadius: 6,
              border: '1px solid rgba(16, 185, 129, 0.25)',
            }}>
              Freq: {dataset.frequency_hz} Hz · DSM Yield: <strong>₹{(dsmFinancialAmount / 100000).toFixed(2)} L</strong>
            </div>
          </div>

          {/* HIGH-VOLTAGE CONDUIT 2: ISTS ➔ STATE PERIPHERY */}
          <div style={{ position: 'relative', height: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="peripheryGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
              </defs>
              <path
                d="M 0 40 L 100 40"
                stroke="rgba(14, 165, 233, 0.25)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <path
                d="M 0 40 L 100 40"
                stroke="url(#peripheryGrad)"
                strokeWidth="3.5"
                strokeDasharray="6 8"
                style={{ animation: 'lossCorridorFlow 1.6s linear infinite' }}
              />
            </svg>

            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#090e1a',
              border: '1px solid #1e293b',
              padding: '3px 6px',
              borderRadius: 6,
              fontSize: 9,
              color: '#818cf8',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              textAlign: 'center',
            }}>
              <div>Ex-Periphery</div>
              <div style={{ color: '#10b981', fontSize: 8 }}>{fmtNumber(netDeliveredMwh)} MWh</div>
            </div>
          </div>

          {/* STAGE 3: STATE PERIPHERY DELIVERY POINT */}
          <div
            onClick={() => setSelectedStage(selectedStage === 'PERIPHERY' ? null : 'PERIPHERY')}
            style={{
              background: selectedStage === 'PERIPHERY'
                ? 'linear-gradient(145deg, rgba(129, 140, 248, 0.22), rgba(15, 23, 42, 0.95))'
                : 'linear-gradient(145deg, rgba(129, 140, 248, 0.1), rgba(15, 23, 42, 0.85))',
              border: selectedStage === 'PERIPHERY' ? '2px solid #818cf8' : '1px solid rgba(129, 140, 248, 0.3)',
              boxShadow: selectedStage === 'PERIPHERY'
                ? '0 0 25px rgba(129, 140, 248, 0.4), 0 10px 25px rgba(0,0,0,0.6)'
                : '0 4px 15px rgba(0,0,0,0.4)',
              borderRadius: 12,
              padding: '16px',
              cursor: 'pointer',
              transform: selectedStage === 'PERIPHERY' ? 'scale(1.02)' : 'rotateY(-6deg)',
              transition: 'all 0.25s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#818cf8',
                background: 'rgba(129, 140, 248, 0.15)',
                padding: '2px 6px',
                borderRadius: 4,
              }}>
                Stage 3: Off-Take
              </span>
              <span style={{ fontSize: 10, color: '#64748b' }}>NRPC Certified</span>
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
              State Periphery (Net)
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
              Regional Delivery Point Off-Take
            </div>

            <div style={{
              background: 'rgba(0,0,0,0.4)',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Net Billed Energy</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#818cf8', marginTop: 2 }}>
                {fmtNumber(netDeliveredMwh)} MWh
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
                After 3.52% ISTS deduction
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DISCOM Off-Take Breakdown Strip */}
      <div style={{
        marginTop: 18,
        paddingTop: 14,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        position: 'relative',
        zIndex: 2,
      }}>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
          Certified Ex-Periphery Off-Take Allocation to Buyers:
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {dataset.deliveries.map((del) => (
            <div
              key={del.buyer}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11,
              }}
            >
              <strong style={{ color: '#f8fafc' }}>{del.buyer}</strong>: <span style={{ color: '#38bdf8' }}>{fmtNumber(del.mwh)} MWh</span> ({del.share_percent}%)
            </div>
          ))}
        </div>
      </div>

      {/* Embedded Animation Styles */}
      <style>{`
        @keyframes lossCorridorFlow {
          0% { stroke-dashoffset: 28; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes lossPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
