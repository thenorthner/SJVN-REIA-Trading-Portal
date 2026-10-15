import React, { useState } from 'react';
import { fmtCurrency } from './ui.jsx';

/**
 * SecurityVaultWaterfall3D
 * 3D 3-Tier Security Waterfall & Cyber Defense Vault for Payment Security Desk.
 * Visualizes the 3 layers of defense protecting SJVN and Generators against payment default:
 * Tier 1: Revolving Letter of Credit (LC) - 105% of monthly billing
 * Tier 2: Payment Security Fund (PSF / Escrow Reserve) - Liquid buffer
 * Tier 3: Tripartite Agreement (TPA) - Sovereign State Govt & RBI Guarantee
 */

export default function SecurityVaultWaterfall3D({
  stats,
  onOpenInvoke,
  onRunAlerts,
}) {
  const [selectedTier, setSelectedTier] = useState(null);
  const [simulationActive, setSimulationActive] = useState(false);

  // Fallback defaults if stats are loading
  const totalCover = stats?.total_security_value || 485000000; // ~48.5 Cr
  const avgCoverage = stats?.avg_coverage_ratio || 1.18;
  const expiring30 = stats?.expiring?.[30] || 0;

  const tiers = [
    {
      id: 'TIER-1',
      number: 'Tier 1',
      title: 'Revolving Letter of Credit (LC)',
      subtitle: 'Primary First-Line Commercial Cover',
      coverageReq: '105% of Monthly Billing Exposure',
      amount: totalCover,
      availableAmount: totalCover,
      utilizedAmount: 0,
      banks: 'State Bank of India · Punjab National Bank · Bank of Baroda',
      status: expiring30 > 0 ? 'WARNING_EXPIRING' : 'COMPLIANT_ACTIVE',
      statusText: expiring30 > 0 ? `${expiring30} Expiring in 30 Days` : '100% Fully Backed · SFMS Verified',
      color: expiring30 > 0 ? '#f59e0b' : '#10b981',
      details: 'Discoms open an irrevocable, revolving, confirmed Letter of Credit in favour of SJVN Limited for 105% of average monthly energy bill. Operates with automatic rollover.',
    },
    {
      id: 'TIER-2',
      number: 'Tier 2',
      title: 'Payment Security Fund (PSF)',
      subtitle: 'REIA Liquid Escrow Reserve Buffer',
      coverageReq: '30-Day Emergency Liquidity Pool',
      amount: 220000000, // 22 Cr
      availableAmount: 220000000,
      utilizedAmount: 0,
      banks: 'SJVN Escrow Clearing Desk · Scheduled Commercial Banks',
      status: 'COMPLIANT_ACTIVE',
      statusText: 'Capital Adequacy 100% Intact',
      color: '#38bdf8',
      details: 'Maintained by SJVN as Renewable Energy Implementing Agency (REIA). Automatically activated if an LC drawdown is contested, delayed or exhausted, ensuring zero interruption in developer disbursements.',
    },
    {
      id: 'TIER-3',
      number: 'Tier 3',
      title: 'Tripartite Agreement (TPA)',
      subtitle: 'Sovereign State Govt & RBI Backstop',
      coverageReq: 'Irrevocable Sovereign Devolution Guarantee',
      amount: 1500000000, // 150 Cr sovereign umbrella
      availableAmount: 1500000000,
      utilizedAmount: 0,
      banks: 'Reserve Bank of India (RBI) · Ministry of Power (MoP)',
      status: 'SOVEREIGN_SECURE',
      statusText: 'Enforceable Sovereign Mandate Active',
      color: '#818cf8',
      details: 'Tripartite covenant between Ministry of Power (GoI), State Governments (Punjab/Haryana/Delhi/Rajasthan) and Reserve Bank of India. In default event, funds are directly debited from Central tax devolution to the State.',
    },
  ];

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

      {/* Top Header Bar */}
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
            background: 'linear-gradient(135deg, #10b981, #06b6d4)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 16px rgba(16, 185, 129, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                3-Tier Payment Security Waterfall & Cyber Defense Vault
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
                Zero Default Exposure
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              CERC Intermediary Trading Regulations · 3-Stage Cascading Risk Mitigation Architecture
            </div>
          </div>
        </div>

        {/* Global Cover Stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            background: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: 8,
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            <div style={{ fontSize: 13 }}>
              <span style={{ color: '#94a3b8' }}>Aggregate Coverage: </span>
              <strong style={{ color: '#10b981', fontSize: 13 }}>{avgCoverage.toFixed(2)}x</strong>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSimulationActive(!simulationActive)}
            style={{
              background: simulationActive ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(255, 255, 255, 0.05)',
              border: simulationActive ? '1px solid #f59e0b' : '1px solid #334155',
              color: simulationActive ? '#fff' : '#94a3b8',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {simulationActive ? '■ Stop Simulation' : '▶ Simulate Waterfall Flow'}
          </button>
        </div>
      </div>

      {/* 3D Tier Waterfall Stages */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        marginTop: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        {tiers.map((tier, idx) => {
          const isSelected = selectedTier === tier.id;
          const isWarning = tier.status === 'WARNING_EXPIRING';

          return (
            <div
              key={tier.id}
              onClick={() => setSelectedTier(isSelected ? null : tier.id)}
              style={{
                background: isSelected
                  ? 'linear-gradient(145deg, rgba(14, 165, 233, 0.15), rgba(15, 23, 42, 0.95))'
                  : 'linear-gradient(145deg, rgba(15, 23, 42, 0.8), rgba(9, 14, 26, 0.95))',
                border: isSelected
                  ? `2px solid ${tier.color}`
                  : (isWarning ? '1.5px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)'),
                boxShadow: isSelected
                  ? `0 0 25px ${tier.color}40, 0 10px 25px rgba(0,0,0,0.6)`
                  : '0 4px 14px rgba(0,0,0,0.4)',
                borderRadius: 12,
                padding: '16px 20px',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                position: 'relative',
              }}
            >
              {/* Cascade indicator icon on left */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: `${tier.color}20`,
                    border: `1.5px solid ${tier.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                    color: tier.color,
                    boxShadow: `0 0 12px ${tier.color}40`,
                  }}>
                    {idx + 1}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 15, color: '#f8fafc' }}>{tier.title}</strong>
                      <span style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: tier.color,
                        background: `${tier.color}15`,
                        border: `1px solid ${tier.color}35`,
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}>
                        {tier.statusText}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
                      {tier.subtitle} · {tier.coverageReq}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>Total Backing Limit</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: tier.color, marginTop: 1 }}>
                      {fmtCurrency(tier.amount)}
                    </div>
                  </div>

                  <div style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    fontSize: 13,
                    color: '#cbd5e1',
                    fontWeight: 600,
                  }}>
                    {isSelected ? '▲ Hide Details' : '▼ Inspect'}
                  </div>
                </div>
              </div>

              {/* Banks strip */}
              <div style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 13,
                color: '#64748b',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                <span>Operating Institutions: <strong style={{ color: '#94a3b8' }}>{tier.banks}</strong></span>
                <span style={{ color: tier.color }}>
                  Utilized: <strong>{fmtCurrency(tier.utilizedAmount)} (0.0%)</strong> · Available: <strong>{fmtCurrency(tier.availableAmount)}</strong>
                </span>
              </div>

              {/* Drawer Deep Dive */}
              {isSelected && (
                <div style={{
                  marginTop: 14,
                  padding: '14px',
                  background: 'rgba(0, 0, 0, 0.35)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 8,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: '#cbd5e1',
                  animation: 'tierIn 0.2s ease-out',
                }}>
                  <div style={{ marginBottom: 8, color: '#f8fafc', fontWeight: 600 }}>
                    Operational Mechanics & Invocation Protocol:
                  </div>
                  <div>{tier.details}</div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    {onOpenInvoke && idx === 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenInvoke(); }}
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
                        Invoke Waterfall Drawdown →
                      </button>
                    )}
                    {onRunAlerts && idx === 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRunAlerts(); }}
                        style={{
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#f8fafc',
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Run Expiry & SFMS Alerts
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Animation Styles */}
      <style>{`
        @keyframes tierIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
