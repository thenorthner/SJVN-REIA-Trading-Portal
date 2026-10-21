import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * SjvnMacroEnergyCorridor3D
 * 3D Executive Fleet-Wide Energy & Billing Stream:
 * Operating Fleet Units (Nathpa Jhakri, Rampur, Luhri-I, Buxar) ➔ Generation (MW & MU) ➔ Two-Part Monthly Billing ➔ Realized Collections vs Overdue Dues (>45 days)
 */

// The fleet as the dashboard reports it: the stations on record, each with its
// latest billed month. The strip used to be a typed-in fleet (Luhri, Buxar)
// with invented figures (Hydro QA run 16).
const fleetFrom = (stations) => (stations || []).map((s) => ({
  id: s.id,
  name: s.station_name,
  vertical: s.project_type === 'Thermal' ? 'THERMAL' : 'HYDRO',
  capacity_mw: Number(s.capacity_mw) || 0,
  status: s.status,
  latest_month: s.latest_month,
  monthly_gen_mu: Number(s.latest_scheduled_mu) || 0,
  monthly_billing_cr: Number(s.latest_billed_cr) || 0,
  realized_cr: Number(s.latest_collected_cr) || 0,
  overdue_dues_cr: Number(s.overdue_cr) || 0,
}));

export default function SjvnMacroEnergyCorridor3D({
  data = null,
  kpis = null,
  stations = null,
}) {
  const [filterVertical, setFilterVertical] = useState('ALL'); // 'ALL' | 'HYDRO' | 'THERMAL'
  const [activeStage, setActiveStage] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);

  const fleet = fleetFrom(stations);
  const filteredStations = filterVertical === 'ALL'
    ? fleet
    : fleet.filter((s) => s.vertical === filterVertical);
  const mwOf = (v) => fleet.filter((s) => !v || s.vertical === v).reduce((sum, s) => sum + s.capacity_mw, 0);
  const muOf = (v) => filteredStations.filter((s) => s.vertical === v).reduce((sum, s) => sum + s.monthly_gen_mu, 0);

  // Fleet Totals
  const totalCapacityMw = filteredStations.reduce((sum, s) => sum + s.capacity_mw, 0);
  const totalGenMu = filteredStations.reduce((sum, s) => sum + s.monthly_gen_mu, 0);
  const totalBillingCr = filteredStations.reduce((sum, s) => sum + s.monthly_billing_cr, 0);
  const totalRealizedCr = filteredStations.reduce((sum, s) => sum + s.realized_cr, 0);
  const totalOverdueCr = filteredStations.reduce((sum, s) => sum + s.overdue_dues_cr, 0);

  const avgCollectionEff = totalBillingCr > 0 ? (totalRealizedCr / totalBillingCr) * 100 : null;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #0c1d2e 0%, #040810 100%)',
      borderRadius: 14,
      border: '1px solid #1e3a8a',
      boxShadow: '0 12px 35px rgba(0,0,0,0.6)',
      padding: '22px 24px',
      marginBottom: 24,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Background Subtle Grid Pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(59, 130, 246, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59, 130, 246, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '28px 28px',
        pointerEvents: 'none',
      }} />

      {/* Header Bar */}
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
            background: 'linear-gradient(135deg, #1d4ed8, #0284c7)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(29, 78, 216, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                SJVN Fleet-Wide Hydro-Thermal Macro Energy Corridor
              </span>
              <span style={{
                background: 'rgba(29, 78, 216, 0.2)',
                color: '#60a5fa',
                border: '1px solid rgba(29, 78, 216, 0.4)',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                EXECUTIVE FLEET STREAM
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              {fleet.map((s) => `${s.name} (${s.capacity_mw} MW)`).join(' + ') || 'No stations on record'} ➔ Grid Injection ➔ Revenue Realization
            </div>
          </div>
        </div>

        {/* Fleet Filter Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'ALL', label: `All Fleet (${fmtNumber(mwOf(), 0)} MW)` },
            { id: 'HYDRO', label: `Hydro Fleet (${fmtNumber(mwOf('HYDRO'), 0)} MW)` },
            { id: 'THERMAL', label: `Thermal Fleet (${fmtNumber(mwOf('THERMAL'), 0)} MW)` },
          ].filter((tab) => tab.id === 'ALL' || mwOf(tab.id) > 0).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`btn btn-xs ${filterVertical === tab.id ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: filterVertical === tab.id ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                borderColor: filterVertical === tab.id ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
                color: filterVertical === tab.id ? '#dbeafe' : '#94a3b8',
              }}
              onClick={() => setFilterVertical(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4-Stage Macro Stream */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Stage 1: Installed & Real-Time Capacity */}
        <div
          onClick={() => setActiveStage(activeStage === 1 ? null : 1)}
          style={{
            background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.8) 0%, rgba(10, 15, 26, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 1 ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 1 ? '0 0 20px rgba(56, 189, 248, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.04em' }}>
              STAGE 1: GENERATION FLEET
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{filteredStations.length} Units</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Live Installed Capacity</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
            Average PAFM: {kpis?.avgPafmPct != null ? `${kpis.avgPafmPct}%` : '—'}
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Installed Capacity</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
              {fmtNumber(totalCapacityMw, 0)} <span style={{ fontSize: 13, fontWeight: 500 }}>MW</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 3 }}>
              {filteredStations.length} station{filteredStations.length === 1 ? '' : 's'} on record
            </div>
          </div>
        </div>

        {/* Stage 2: Net Ex-Bus Generation */}
        <div
          onClick={() => setActiveStage(activeStage === 2 ? null : 2)}
          style={{
            background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.8) 0%, rgba(10, 15, 26, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 2 ? '#a855f7' : 'rgba(168, 85, 247, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 2 ? '0 0 20px rgba(168, 85, 247, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#c084fc', letterSpacing: '0.04em' }}>
              STAGE 2: GRID INJECTION
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Monthly Scheduled</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Ex-Bus Energy Supply</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
            NRPC & ERPC Certified REA
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Gross Energy Scheduled</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#c084fc', fontVariantNumeric: 'tabular-nums' }}>
              {fmtNumber(totalGenMu, 1)} <span style={{ fontSize: 13, fontWeight: 500 }}>MU</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 3 }}>
              Latest billed month · Hydro: {fmtNumber(muOf('HYDRO'), 1)} MU{mwOf('THERMAL') > 0 ? ` | Thermal: ${fmtNumber(muOf('THERMAL'), 1)} MU` : ''}
            </div>
          </div>
        </div>

        {/* Stage 3: Two-Part Monthly Billing */}
        <div
          onClick={() => setActiveStage(activeStage === 3 ? null : 3)}
          style={{
            background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.8) 0%, rgba(10, 15, 26, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 3 ? 'var(--t-amber-100)' : 'rgba(251, 191, 36, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 3 ? '0 0 20px rgba(251, 191, 36, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.04em' }}>
              STAGE 3: COMMERCIAL DEMAND
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>Monthly Billed</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Two-Part Tariff Revenue</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
            Capacity + Energy Charges
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Total Monthly Demand</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
              ₹{fmtNumber(totalBillingCr, 1)} <span style={{ fontSize: 13, fontWeight: 500 }}>Cr</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 3 }}>
              Latest billed month · {kpis?.beneficiariesCount ?? 0} beneficiaries
            </div>
          </div>
        </div>

        {/* Stage 4: Realized vs Overdue Dues */}
        <div
          onClick={() => setActiveStage(activeStage === 4 ? null : 4)}
          style={{
            background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.8) 0%, rgba(10, 15, 26, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 4 ? 'var(--t-green-100)' : 'rgba(74, 222, 128, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 4 ? '0 0 20px rgba(74, 222, 128, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', letterSpacing: '0.04em' }}>
              STAGE 4: CASH REALIZATION
            </span>
            <span style={{
              fontSize: 11.5,
              fontWeight: 700,
              background: 'rgba(74, 222, 128, 0.2)',
              color: '#4ade80',
              padding: '1px 6px',
              borderRadius: 4,
            }}>
              {avgCollectionEff != null ? `${avgCollectionEff.toFixed(1)}% RECOVERY` : 'NOT BILLED'}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Collections & Aging</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
            Realized: ₹{fmtNumber(totalRealizedCr, 1)} Cr
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Realized Collections:</span>
              <span style={{ fontWeight: 700, color: '#4ade80' }}>₹{fmtNumber(totalRealizedCr, 1)} Cr</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: '#94a3b8' }}>Overdue (past due date):</span>
              <span style={{ fontWeight: 700, color: totalOverdueCr > 0 ? '#f87171' : '#4ade80' }}>
                ₹{fmtNumber(totalOverdueCr, 1)} Cr
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Fleet Operating Units Quick Strip */}
      <div style={{
        marginTop: 18,
        paddingTop: 14,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        position: 'relative',
        zIndex: 2,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
          SJVN Operating Units Breakdown:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          {filteredStations.map((st) => (
            <div
              key={st.id}
              onClick={() => setSelectedStation(selectedStation?.id === st.id ? null : st)}
              style={{
                background: selectedStation?.id === st.id ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${selectedStation?.id === st.id ? '#3b82f6' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: 8,
                padding: '10px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: '#f8fafc' }}>{st.name}</span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: st.vertical === 'HYDRO' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(249, 115, 22, 0.2)',
                  color: st.vertical === 'HYDRO' ? '#38bdf8' : '#fb923c',
                }}>
                  {st.capacity_mw} MW
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                <span>{st.latest_month ? `Billed ${st.latest_month}: ₹${fmtNumber(st.monthly_billing_cr, 1)} Cr` : 'Not billed yet'}</span>
                <span style={{ color: st.overdue_dues_cr > 0 ? '#f87171' : '#4ade80' }}>
                  {st.overdue_dues_cr > 0 ? `Overdue: ₹${fmtNumber(st.overdue_dues_cr, 1)} Cr` : 'Nothing overdue'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Drawer */}
      {activeStage && (
        <div style={{
          marginTop: 16,
          background: 'rgba(10, 15, 26, 0.95)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 13,
          color: '#cbd5e1',
          lineHeight: 1.5,
          position: 'relative',
          zIndex: 2,
        }}>
          {activeStage === 1 && (
            <div>
              <strong style={{ color: '#38bdf8' }}>Fleet Generation Capacity:</strong> SJVN operates 2,122 MW of central hydro capacity in Himachal Pradesh (Nathpa Jhakri 1500 MW + Rampur 412 MW + Luhri Stage-I 210 MW) and 1,320 MW supercritical thermal capacity in Buxar, Bihar.
            </div>
          )}
          {activeStage === 2 && (
            <div>
              <strong style={{ color: '#c084fc' }}>Ex-Bus Dispatch:</strong> Regional Energy Accounts (NRPC REA for Hydro & ERPC REA for Thermal) certify ex-bus generation schedules, reflecting Northern and Eastern grid off-take shares.
            </div>
          )}
          {activeStage === 3 && (
            <div>
              <strong style={{ color: '#fbbf24' }}>Commercial Revenue Stream:</strong> Comprises CERC two-part tariff billing: Annual Fixed Capacity Charges recovered against plant availability factor (PAFM), and Energy Charges based on design hydrology / variable fuel costs.
            </div>
          )}
          {activeStage === 4 && (
            <div>
              <strong style={{ color: '#4ade80' }}>Collections & Aging Security:</strong> Billed DISCOMs settle within the 45-day net due date window. Overdue dues exceeding 45 days attract Late Payment Surcharge (LPS) and are eligible for LC encashment and power regulation.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
