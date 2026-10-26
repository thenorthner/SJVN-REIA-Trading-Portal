import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * ThermalCoalBlendingInflow3D
 * 3D Fuel Blending & Merit Order Dispatch Conduit:
 * Dual Coal Inflow (Domestic Linkage vs High-GCV Imported) ➔ Bunker Blending & Moisture Loss ➔ Merit Order Dispatch (MOD) Impact
 */

const BLEND_PRESETS = [
  { label: '100% Domestic Linkage', domesticPct: 100, importedPct: 0 },
  { label: '6% Blended (CERC Advisory)', domesticPct: 94, importedPct: 6 },
  { label: '10% Blended (Peak Demand)', domesticPct: 90, importedPct: 10 },
  { label: '15% High-Import Blend', domesticPct: 85, importedPct: 15 },
];

export default function ThermalCoalBlendingInflow3D({
  station = null,
}) {
  const [selectedPresetIdx, setSelectedPresetIdx] = useState(2); // 10% Default
  const [activeStage, setActiveStage] = useState(null);

  const preset = BLEND_PRESETS[selectedPresetIdx];
  const domesticRatio = preset.domesticPct / 100;
  const importedRatio = preset.importedPct / 100;

  // Stream 1: Domestic Coal (CCL / ECL linkage)
  const domesticGcv = 3400; // kCal/kg
  const domesticPricePerTonne = 3800; // ₹/Tonne landed (with freight)

  // Stream 2: Imported Coal (Indonesian / South African high-grade)
  const importedGcv = 5800; // kCal/kg
  const importedPricePerTonne = 8500; // ₹/Tonne landed (CIF + Rail)

  // Stage 2: Blending Bunker Weighted Calculations
  const weightedGcv = Math.round((domesticRatio * domesticGcv) + (importedRatio * importedGcv));
  const weightedPricePerTonne = Math.round((domesticRatio * domesticPricePerTonne) + (importedRatio * importedPricePerTonne));
  const transitLossPct = 0.8; // 0.8% CERC normative transit loss

  // Resulting ECR Estimate for 660 MW Supercritical Unit (GHR = 2250, Aux = 5.75%)
  const ghr = 2250;
  const auxPct = 5.75;
  const landedPricePerKg = weightedPricePerTonne / 1000;
  const baseFuelCostPerKwh = (ghr * landedPricePerKg) / weightedGcv;
  const blendedEcr = (baseFuelCostPerKwh * 100) / (100 - auxPct);

  // Merit Order Rank categorization
  const isBaseLoad = blendedEcr <= 3.25;
  const isMidMerit = blendedEcr > 3.25 && blendedEcr <= 3.65;
  const modStatus = isBaseLoad ? 'TOP MERIT (MUST-RUN)' : isMidMerit ? 'MID MERIT (DISPATCH PRIORITY)' : 'HIGH VARIABLE (PEAK ONLY)';
  const modBadgeColor = isBaseLoad ? '#4ade80' : isMidMerit ? '#38bdf8' : '#f87171';

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #1c130b 0%, #080402 100%)',
      borderRadius: 14,
      border: '1px solid #78350f',
      boxShadow: '0 12px 35px rgba(0,0,0,0.6)',
      padding: '22px 24px',
      marginBottom: 22,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Background Matrix Pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(217, 119, 6, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(217, 119, 6, 0.03) 1px, transparent 1px)
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
            background: 'linear-gradient(135deg, #d97706, #b45309)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(217, 119, 6, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Coal Blending & Domestic vs Imported Fuel Inflow
              </span>
              <span style={{
                background: 'rgba(217, 119, 6, 0.15)',
                color: '#fbbf24',
                border: '1px solid rgba(217, 119, 6, 0.4)',
                fontSize: 13.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                CEA & CERC BLENDING NORMS
              </span>
            </div>
            <div style={{ fontSize: 14.5, color: '#94a3b8', marginTop: 2 }}>
              {/* Example figures, not the station's account: under the station's
                  name they read as its own coal and URS (Thermal QA run 19). */}
              <span style={{ fontWeight: 700, color: '#fbbf24' }}>Illustration — example figures, not {station?.station_name || 'this station'}'s account.</span>{' '}Coal India Linkage (CCL/ECL) vs Imported Blended Coal ➔ Weighted GCV & Price ➔ Merit Order Dispatch (MOD)
            </div>
          </div>
        </div>

        {/* Preset Selector */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {BLEND_PRESETS.map((p, idx) => (
            <button
              key={p.label}
              type="button"
              className={`btn btn-xs ${selectedPresetIdx === idx ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: 13.5,
                padding: '4px 10px',
                background: selectedPresetIdx === idx ? 'rgba(217, 119, 6, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                borderColor: selectedPresetIdx === idx ? '#d97706' : 'rgba(255, 255, 255, 0.1)',
                color: selectedPresetIdx === idx ? '#fef3c7' : '#94a3b8',
              }}
              onClick={() => setSelectedPresetIdx(idx)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Stage Blending & Dispatch Flow */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Stage 1: Dual Coal Streams */}
        <div
          onClick={() => setActiveStage(activeStage === 1 ? null : 1)}
          style={{
            background: 'linear-gradient(180deg, rgba(28, 19, 11, 0.8) 0%, rgba(18, 12, 7, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 1 ? '#f59e0b' : 'rgba(245, 158, 11, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 1 ? '0 0 20px rgba(245, 158, 11, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.04em' }}>
              STAGE 1: DUAL INFLOW
            </span>
            <span style={{ fontSize: 13.5, color: '#94a3b8' }}>Coal Streams</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Domestic vs Imported</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            Linkage Ratio: {preset.domesticPct}% / {preset.importedPct}%
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 6 }}>
              <span style={{ color: '#94a3b8' }}>Domestic (CIL {preset.domesticPct}%):</span>
              <span style={{ color: '#f8fafc', fontWeight: 600 }}>{domesticGcv} kCal | ₹{domesticPricePerTonne}/T</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: '#94a3b8' }}>Imported ({preset.importedPct}%):</span>
              <span style={{ color: '#fbbf24', fontWeight: 600 }}>{importedGcv} kCal | ₹{importedPricePerTonne}/T</span>
            </div>
          </div>
        </div>

        {/* Stage 2: Blending Bunker & Moisture Loss */}
        <div
          onClick={() => setActiveStage(activeStage === 2 ? null : 2)}
          style={{
            background: 'linear-gradient(180deg, rgba(28, 19, 11, 0.8) 0%, rgba(18, 12, 7, 0.95) 100%)',
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
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.04em' }}>
              STAGE 2: BUNKER BLEND
            </span>
            <span style={{ fontSize: 13.5, color: '#94a3b8' }}>Form 15 Pool</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Weighted GCV & Landed Cost</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            Transit & Handling: -{transitLossPct}% Normative
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Blended GCV:</span>
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>{fmtNumber(weightedGcv, 0)} kCal/kg</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: '#94a3b8' }}>Weighted Landed Price:</span>
              <span style={{ fontWeight: 700, color: '#f8fafc' }}>₹{fmtNumber(weightedPricePerTonne, 0)} / Tonne</span>
            </div>
          </div>
        </div>

        {/* Stage 3: Merit Order Dispatch (MOD) Impact */}
        <div
          onClick={() => setActiveStage(activeStage === 3 ? null : 3)}
          style={{
            background: 'linear-gradient(180deg, rgba(28, 19, 11, 0.8) 0%, rgba(18, 12, 7, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 3 ? modBadgeColor : 'rgba(74, 222, 128, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 3 ? `0 0 20px ${modBadgeColor}40` : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: modBadgeColor, letterSpacing: '0.04em' }}>
              STAGE 3: DISPATCH MERIT
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 700,
              background: `${modBadgeColor}20`,
              color: modBadgeColor,
              padding: '1px 6px',
              borderRadius: 4,
            }}>
              MOD QUEUE
            </span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Power Market Merit Order</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            Resulting ECR: ₹{blendedEcr.toFixed(3)} / kWh
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Grid Scheduling Priority</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: modBadgeColor, marginTop: 2 }}>
              {modStatus}
            </div>
            <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 3 }}>
              DISCOMs requisition lower ECR first
            </div>
          </div>
        </div>
      </div>

      {/* Explanatory Box on Click */}
      {activeStage && (
        <div style={{
          marginTop: 16,
          background: 'rgba(18, 12, 7, 0.95)',
          border: '1px solid rgba(217, 119, 6, 0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 14.5,
          color: '#cbd5e1',
          lineHeight: 1.5,
          position: 'relative',
          zIndex: 2,
        }}>
          {activeStage === 1 && (
            <div>
              <strong style={{ color: '#fbbf24' }}>Fuel Inflow Origins:</strong> Domestic linkage coal from Coal India Ltd (CCL/ECL/NCL) provides economic base fuel (~3,400 kCal/kg at ₹3,800/T). High-GCV imported coal (~5,800 kCal/kg at ₹8,500/T) is blended to sustain boiler flame stability and mitigate domestic rake shortages during monsoon.
            </div>
          )}
          {activeStage === 2 && (
            <div>
              <strong style={{ color: '#38bdf8' }}>Blending Bunker Optimization:</strong> Per CEA guidelines, blending up to 6% is permitted without prior discom consent. Blended GCV is mathematically averaged: (GCV_dom × %dom + GCV_imp × %imp) / 100.
            </div>
          )}
          {activeStage === 3 && (
            <div>
              <strong style={{ color: modBadgeColor }}>Merit Order Dispatch (MOD) Principle:</strong> State Load Despatch Centres (SLDCs) requisition thermal power strictly in order of ascending variable cost (ECR). Keeping ECR competitive ensures 100% plant scheduling and prevents forced deemed generation backing down.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
