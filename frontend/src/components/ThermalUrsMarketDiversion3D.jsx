import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * ThermalUrsMarketDiversion3D
 * 3D Un-requisitioned Surplus (URS) & Power Exchange Monetization Conduit:
 * Beneficiary Surrender Gate ➔ Real-Time Market (RTM / DAM) Routing ➔ 50:50 Shared Benefit Settlement
 */

const SAMPLE_URS_CASES = [
  {
    discom: 'North Bihar Power Distribution (NBPDCL)',
    allocated_mw: 660,
    scheduled_mw: 420,
    surrendered_urs_mw: 240, // 240 MW Surrendered
    hours: 24,
    surrendered_mwh: 5760,
    ecr_variable_cost: 3.42, // ₹/kWh
    rtm_clearing_price: 5.85, // ₹/kWh on IEX RTM
    exchange_name: 'IEX Real-Time Market (RTM)',
  },
  {
    discom: 'South Bihar Power Distribution (SBPDCL)',
    allocated_mw: 400,
    scheduled_mw: 280,
    surrendered_urs_mw: 120,
    hours: 24,
    surrendered_mwh: 2880,
    ecr_variable_cost: 3.42,
    rtm_clearing_price: 6.20,
    exchange_name: 'IEX Day-Ahead Market (DAM)',
  },
];

export default function ThermalUrsMarketDiversion3D({
  station = null,
}) {
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0);
  const [activeStage, setActiveStage] = useState(null);

  const uCase = SAMPLE_URS_CASES[selectedCaseIdx];

  // Mathematical Settlements
  const energyKwh = uCase.surrendered_mwh * 1000;
  const grossMarketRevenue = (energyKwh * uCase.rtm_clearing_price);
  const fuelCostRecovered = (energyKwh * uCase.ecr_variable_cost);
  const netSurplusGain = Math.max(0, grossMarketRevenue - fuelCostRecovered);

  // CERC 50:50 Split Rule:
  const beneficiaryShareCredit = netSurplusGain * 0.50;
  const sjvnRetainedMargin = netSurplusGain * 0.50;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #0d1e1f 0%, #030a0a 100%)',
      borderRadius: 14,
      border: '1px solid #115e59',
      boxShadow: '0 12px 35px rgba(0,0,0,0.6)',
      padding: '22px 24px',
      marginBottom: 22,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Background Matrix Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(20, 184, 166, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(20, 184, 166, 0.03) 1px, transparent 1px)
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
            background: 'linear-gradient(135deg, #0d9488, #14b8a6)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(20, 184, 166, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Thermal Beneficiary Dispatch & URS Power Market Diversion
              </span>
              <span style={{
                background: 'rgba(20, 184, 166, 0.15)',
                color: '#2dd4bf',
                border: '1px solid rgba(20, 184, 166, 0.4)',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                CERC URS SHARING RULE
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              {station?.station_name ? `${station.station_name} — ` : ''}Surrendered Discom Capacity (URS) ➔ Power Exchange (IEX RTM) Dispatch ➔ 50:50 Shared Benefit Gain
            </div>
          </div>
        </div>

        {/* Case Toggle Buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          {SAMPLE_URS_CASES.map((c, idx) => (
            <button
              key={c.discom}
              type="button"
              className={`btn btn-xs ${selectedCaseIdx === idx ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: selectedCaseIdx === idx ? 'rgba(20, 184, 166, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                borderColor: selectedCaseIdx === idx ? '#14b8a6' : 'rgba(255, 255, 255, 0.1)',
                color: selectedCaseIdx === idx ? '#ccfbf1' : '#94a3b8',
              }}
              onClick={() => setSelectedCaseIdx(idx)}
            >
              {idx === 0 ? 'NBPDCL (240 MW URS)' : 'SBPDCL (120 MW URS)'}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Stage URS Diversion & Monetization Corridor */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Stage 1: Beneficiary Requisition Gate */}
        <div
          onClick={() => setActiveStage(activeStage === 1 ? null : 1)}
          style={{
            background: 'linear-gradient(180deg, rgba(13, 30, 31, 0.8) 0%, rgba(5, 15, 16, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 1 ? '#2dd4bf' : 'rgba(45, 212, 191, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 1 ? '0 0 20px rgba(45, 212, 191, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2dd4bf', letterSpacing: '0.04em' }}>
              STAGE 1: SURRENDER GATE
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>ERPC SLDC</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Un-requisitioned Surplus</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{uCase.discom.split(' ')[0]} Off-Take Delta</div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Allocated / Scheduled:</span>
              <span style={{ color: '#f8fafc', fontWeight: 600 }}>{uCase.allocated_mw} MW / {uCase.scheduled_mw} MW</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: '#94a3b8' }}>Surrendered Power:</span>
              <span style={{ fontWeight: 700, color: '#f87171' }}>{uCase.surrendered_urs_mw} MW ({fmtNumber(uCase.surrendered_mwh, 0)} MWh)</span>
            </div>
          </div>
        </div>

        {/* Stage 2: Real-Time Market Routing */}
        <div
          onClick={() => setActiveStage(activeStage === 2 ? null : 2)}
          style={{
            background: 'linear-gradient(180deg, rgba(13, 30, 31, 0.8) 0%, rgba(5, 15, 16, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 2 ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 2 ? '0 0 20px rgba(56, 189, 248, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.04em' }}>
              STAGE 2: EXCHANGE DISPATCH
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>IEX RTM</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Power Exchange Clearing</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
            Station ECR: ₹{uCase.ecr_variable_cost}/kWh
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>RTM Clearing Price:</span>
              <span style={{ fontWeight: 700, color: '#4ade80' }}>₹{uCase.rtm_clearing_price} / kWh</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: '#94a3b8' }}>Gross Realized:</span>
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>{fmtCurrency(grossMarketRevenue)}</span>
            </div>
          </div>
        </div>

        {/* Stage 3: 50:50 Shared Benefit Split */}
        <div
          onClick={() => setActiveStage(activeStage === 3 ? null : 3)}
          style={{
            background: 'linear-gradient(180deg, rgba(13, 30, 31, 0.8) 0%, rgba(5, 15, 16, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 3 ? '#eab308' : 'rgba(234, 179, 8, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 3 ? '0 0 20px rgba(234, 179, 8, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#facc15', letterSpacing: '0.04em' }}>
              STAGE 3: 50:50 SHARING
            </span>
            <span style={{
              fontSize: 11.5,
              fontWeight: 700,
              background: 'rgba(234, 179, 8, 0.2)',
              color: '#facc15',
              padding: '1px 6px',
              borderRadius: 4,
            }}>
              NET SURPLUS
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Gain Sharing Settlement</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
            Net Profit: {fmtCurrency(netSurplusGain)}
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Discom 50% Bill Rebate:</span>
              <span style={{ fontWeight: 700, color: '#4ade80' }}>+{fmtCurrency(beneficiaryShareCredit)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: '#94a3b8' }}>SJVN 50% Margin Gain:</span>
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>+{fmtCurrency(sjvnRetainedMargin)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Explanatory Box on Click */}
      {activeStage && (
        <div style={{
          marginTop: 16,
          background: 'rgba(5, 15, 16, 0.95)',
          border: '1px solid rgba(20, 184, 166, 0.3)',
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
              <strong style={{ color: '#2dd4bf' }}>URS Declaration Protocol:</strong> Discoms submit their schedule before gate closure. Any capacity declared by the station but un-requisitioned by beneficiaries becomes Un-requisitioned Surplus (URS), enabling SJVN to dispatch it on exchanges without hurting plant heat rate.
            </div>
          )}
          {activeStage === 2 && (
            <div>
              <strong style={{ color: '#38bdf8' }}>Exchange Monetization:</strong> URS power is bid into IEX/PXIL Real-Time Market (RTM) or Day-Ahead Market (DAM). Generating variable cost (ECR ₹{uCase.ecr_variable_cost}/kWh) is reimbursed in full to the generating station fuel pool.
            </div>
          )}
          {activeStage === 3 && (
            <div>
              <strong style={{ color: '#facc15' }}>MoP & CERC 50:50 Gain Sharing Rule:</strong> All revenue realized over and above the station's Energy Charge Rate (ECR) is split 50:50. The original Discom receives 50% as a direct credit adjustment on their monthly fixed bill, reducing their overall power purchase cost, while SJVN earns commercial trading margin.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
