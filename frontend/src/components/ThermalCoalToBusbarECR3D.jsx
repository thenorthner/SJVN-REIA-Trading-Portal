import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * ThermalCoalToBusbarECR3D
 * 3D Thermodynamic & Financial Energy Charge Rate Conduit:
 * Fuel Inflow (Coal & Oil) ➔ Thermodynamic Efficiency (GHR, APC, Transit) ➔ CERC ECR Formula Callout ➔ Ex-Bus Thermal Injection
 */

const SAMPLE_THERMAL_STATIONS = [
  {
    id: 'BUXAR-TPP',
    name: 'Buxar Supercritical Thermal Power Project (2 × 660 MW)',
    installed_mw: 1320,
    coal_source: 'Coal India Linkage (CCL / ECL) + Rake Transit',
    coal_rs_per_tonne: 3850,
    gcv_kcal_per_kg: 3600,
    oil_rs_per_kl: 62500,
    sfc_ml_per_kwh: 0.50,
    cv_secondary_kcal_per_ml: 10.0,
    ghr_normative: 2250, // CERC 660 MW Supercritical norm
    aux_pct: 5.75,       // CERC APC norm for cooling tower
    transit_loss_pct: 0.80,
    scheduled_mwh: 685000,
  },
  {
    id: 'GENERIC-SUBCRITICAL',
    name: 'Standard Subcritical Thermal Unit (500 MW)',
    installed_mw: 500,
    coal_source: 'Domestic Linkage Coal',
    coal_rs_per_tonne: 4100,
    gcv_kcal_per_kg: 3400,
    oil_rs_per_kl: 64000,
    sfc_ml_per_kwh: 0.50,
    cv_secondary_kcal_per_ml: 10.0,
    ghr_normative: 2425,
    aux_pct: 6.50,
    transit_loss_pct: 0.80,
    scheduled_mwh: 260000,
  },
];

export default function ThermalCoalToBusbarECR3D({
  station = null,
  tariff = null,
  fuel = null,
  bill = null,
}) {
  const [activeStationIdx, setActiveStationIdx] = useState(0);
  const [activeStage, setActiveStage] = useState(null);

  const fallback = SAMPLE_THERMAL_STATIONS[activeStationIdx];

  const thermalInputs = typeof bill?.thermal_inputs_json === 'string'
    ? JSON.parse(bill.thermal_inputs_json || '{}')
    : (bill?.thermal_inputs || {});

  // Derive parameters from live props or fallback
  const stationName = station?.station_name || bill?.station_name || fallback.name;
  const coalPrice = Number(fuel?.coal_rs_per_tonne || thermalInputs?.fuel?.coal_rs_per_tonne || fallback.coal_rs_per_tonne);
  const coalGcv = Number(fuel?.gcv_kcal_per_kg || thermalInputs?.fuel?.gcv_kcal_per_kg || fallback.gcv_kcal_per_kg);
  const oilPrice = Number(fuel?.oil_rs_per_kl || thermalInputs?.fuel?.oil_rs_per_kl || fallback.oil_rs_per_kl);
  const sfc = Number(tariff?.sfc_ml_per_kwh || thermalInputs?.tariff?.sfc_ml_per_kwh || fallback.sfc_ml_per_kwh);
  const cvSecondary = Number(tariff?.cv_secondary_kcal_per_ml || fallback.cv_secondary_kcal_per_ml);

  const ghr = Number(tariff?.gross_heat_rate || thermalInputs?.tariff?.gross_heat_rate || fallback.ghr_normative);
  const auxPct = Number(tariff?.aux_pct || thermalInputs?.tariff?.aux_pct || fallback.aux_pct);
  const transitLossPct = fallback.transit_loss_pct;

  // CERC Exact Energy Charge Rate Formulation:
  // ECR = [ ((GHR - SFC * CVSF) * LPPF / CVPF) + (SFC * LPSFi) ] * 100 / (100 - AUX)
  // LPPF = Price of coal in Rs/kg = coalPrice / 1000
  // CVPF = GCV of coal in kCal/kg
  // LPSFi = Secondary fuel price in Rs/ml = oilPrice / 1000000
  const lppf = coalPrice / 1000;
  const lpsfi = oilPrice / 1000000;
  const netCoalHeatRate = Math.max(0, ghr - (sfc * cvSecondary));
  const coalEnergyComponent = coalGcv > 0 ? (netCoalHeatRate * lppf) / coalGcv : 0;
  const oilEnergyComponent = sfc * lpsfi;
  const rawFuelCostPerKwh = coalEnergyComponent + oilEnergyComponent;
  const computedEcr = auxPct < 100 ? (rawFuelCostPerKwh * 100) / (100 - auxPct) : 0;

  const displayEcr = Number(bill?.a12_ecr || computedEcr.toFixed(4));

  const scheduledKwh = Number(bill?.e1_ex_bus_scheduled_kwh || (fallback.scheduled_mwh * 1000));
  const scheduledMwh = Math.round(scheduledKwh / 1000);
  const energyBilledCr = (scheduledKwh * displayEcr) / 10000000;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #1e130c 0%, #0a0604 100%)',
      borderRadius: 14,
      border: '1px solid #7c2d12',
      boxShadow: '0 12px 35px rgba(0,0,0,0.6)',
      padding: '22px 24px',
      marginBottom: 22,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Background Combustion Grid Pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(249, 115, 22, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(249, 115, 22, 0.03) 1px, transparent 1px)
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
            background: 'linear-gradient(135deg, #c2410c, #ea580c)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(234, 88, 12, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em' }}>
                Thermal Coal-to-Busbar ECR & Heat-Rate Corridor
              </span>
              <span style={{
                background: 'rgba(234, 88, 12, 0.15)',
                color: '#fb923c',
                border: '1px solid rgba(234, 88, 12, 0.4)',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                CERC TARIFF FORM 15
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              Landed Coal Price & GCV ➔ Supercritical Boiler GHR ➔ CERC ECR Engine ➔ Ex-Bus Net Scheduled Settlement
            </div>
          </div>
        </div>

        {/* Station Selector Pill */}
        <div style={{ display: 'flex', gap: 6 }}>
          {SAMPLE_THERMAL_STATIONS.map((st, idx) => (
            <button
              key={st.id}
              type="button"
              className={`btn btn-xs ${activeStationIdx === idx ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: activeStationIdx === idx ? 'rgba(234, 88, 12, 0.3)' : 'rgba(255, 255, 255, 0.04)',
                borderColor: activeStationIdx === idx ? '#ea580c' : 'rgba(255, 255, 255, 0.1)',
                color: activeStationIdx === idx ? '#ffedd5' : '#94a3b8',
              }}
              onClick={() => setActiveStationIdx(idx)}
            >
              {st.id === 'BUXAR-TPP' ? 'Buxar 1320 MW' : 'Subcritical 500 MW'}
            </button>
          ))}
        </div>
      </div>

      {/* 4-Stage 3D Thermodynamic Pipeline */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Stage 1: Fuel Input */}
        <div
          onClick={() => setActiveStage(activeStage === 1 ? null : 1)}
          style={{
            background: 'linear-gradient(180deg, rgba(30, 20, 15, 0.8) 0%, rgba(20, 12, 8, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 1 ? '#fb923c' : 'rgba(251, 146, 60, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 1 ? '0 0 20px rgba(251, 146, 60, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fb923c', letterSpacing: '0.04em' }}>
              STAGE 1: FUEL INPUT
            </span>
            <span style={{ fontSize: 12, color: '#a8a29e' }}>Coal & Oil</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
            Landed Coal & GCV
          </div>
          <div style={{ fontSize: 12.5, color: '#a8a29e', marginTop: 2 }}>
            GCV: {fmtNumber(coalGcv, 0)} kCal/kg
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Landed Coal Price</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#fdba74', fontVariantNumeric: 'tabular-nums' }}>
              ₹{fmtNumber(coalPrice, 0)} <span style={{ fontSize: 13, fontWeight: 500 }}>/ tonne</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 3 }}>
              Secondary Oil: ₹{fmtNumber(oilPrice, 0)} / kL
            </div>
          </div>
        </div>

        {/* Stage 2: Thermodynamic Efficiency Engine */}
        <div
          onClick={() => setActiveStage(activeStage === 2 ? null : 2)}
          style={{
            background: 'linear-gradient(180deg, rgba(30, 20, 15, 0.8) 0%, rgba(20, 12, 8, 0.95) 100%)',
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
              STAGE 2: THERMODYNAMICS
            </span>
            <span style={{ fontSize: 12, color: '#a8a29e' }}>Efficiency</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
            Station Heat Rate (GHR)
          </div>
          <div style={{ fontSize: 12.5, color: '#a8a29e', marginTop: 2 }}>
            Supercritical Boiler: {fmtNumber(ghr, 0)} kCal/kWh
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Aux Power (APC):</span>
              <span style={{ fontWeight: 600, color: '#f87171' }}>-{auxPct}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
              <span style={{ color: '#94a3b8' }}>Transit Loss:</span>
              <span style={{ fontWeight: 600, color: '#fbbf24' }}>-{transitLossPct}%</span>
            </div>
          </div>
        </div>

        {/* Stage 3: CERC ECR Formula Callout */}
        <div
          onClick={() => setActiveStage(activeStage === 3 ? null : 3)}
          style={{
            background: 'linear-gradient(180deg, rgba(30, 20, 15, 0.8) 0%, rgba(20, 12, 8, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 3 ? 'var(--t-green-100)' : 'rgba(74, 222, 128, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 3 ? '0 0 20px rgba(74, 222, 128, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', letterSpacing: '0.04em' }}>
              STAGE 3: CERC ECR ENGINE
            </span>
            <span style={{
              fontSize: 11.5,
              fontWeight: 700,
              background: 'rgba(74, 222, 128, 0.2)',
              color: '#4ade80',
              padding: '1px 6px',
              borderRadius: 4,
            }}>
              REG 43 FORMULA
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
            Energy Charge Rate
          </div>
          <div style={{ fontSize: 12.5, color: '#a8a29e', marginTop: 2 }}>
            Per kWh Ex-Bus Busbar
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Certified Variable Cost</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#4ade80', fontVariantNumeric: 'tabular-nums' }}>
              ₹{Number(displayEcr).toFixed(3)} <span style={{ fontSize: 13, fontWeight: 500 }}>/ kWh</span>
            </div>
            <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 3 }}>
              Coal: ₹{((rawFuelCostPerKwh * 100) / (100 - auxPct)).toFixed(3)} | Oil: ₹{(oilEnergyComponent * 100 / (100 - auxPct)).toFixed(4)}
            </div>
          </div>
        </div>

        {/* Stage 4: Ex-Bus Thermal Injection */}
        <div
          onClick={() => setActiveStage(activeStage === 4 ? null : 4)}
          style={{
            background: 'linear-gradient(180deg, rgba(30, 20, 15, 0.8) 0%, rgba(20, 12, 8, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 4 ? '#eab308' : 'rgba(234, 179, 8, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 4 ? '0 0 20px rgba(234, 179, 8, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#facc15', letterSpacing: '0.04em' }}>
              STAGE 4: COMMITTED ENERGY
            </span>
            <span style={{ fontSize: 12, color: '#a8a29e' }}>ERPC Scheduled</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
            Month Fuel Billing
          </div>
          <div style={{ fontSize: 12.5, color: '#a8a29e', marginTop: 2 }}>
            Ex-Bus: {fmtNumber(scheduledMwh, 0)} MU
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Total Energy Bill</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#facc15', fontVariantNumeric: 'tabular-nums' }}>
              ₹{fmtNumber(energyBilledCr, 2)} <span style={{ fontSize: 13, fontWeight: 500 }}>Cr</span>
            </div>
            <div style={{ fontSize: 12, color: '#4ade80', marginTop: 3 }}>
              Full variable fuel recovery
            </div>
          </div>
        </div>
      </div>

      {/* Explanatory Regulatory Drawer on Stage Selection */}
      {activeStage && (
        <div style={{
          marginTop: 16,
          background: 'rgba(20, 12, 8, 0.95)',
          border: '1px solid rgba(249, 115, 22, 0.3)',
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
              <strong style={{ color: '#fb923c' }}>Fuel Inventory & Form 15 Protocol:</strong> Landed cost of coal comprises Pithead base price (CIL Notification) + Railway Rake Freight (Indian Railways) + GST & Compensation Cess + Royalty, less 0.8% normative transit loss. Secondary Fuel Oil (LDO/HFO) is audited monthly via Form 15.
            </div>
          )}
          {activeStage === 2 && (
            <div>
              <strong style={{ color: '#38bdf8' }}>Thermodynamic Station Efficiency:</strong> Under CERC Tariff Regulations 2024-2029, Gross Station Heat Rate for 660 MW supercritical units is normative at 2,250 kCal/kWh. Auxiliary Power Consumption (APC) is normative at 5.75% for natural draft cooling towers.
            </div>
          )}
          {activeStage === 3 && (
            <div>
              <strong style={{ color: '#4ade80' }}>CERC Regulation 43 Formula:</strong>
              <div style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.4)', padding: '6px 10px', borderRadius: 4, marginTop: 4, color: '#86efac' }}>
                ECR = [ ((GHR - SFC × CVSF) × LPPF / CVPF) + (SFC × LPSFi) ] × 100 / (100 - AUX)
              </div>
              Where LPPF = ₹{lppf.toFixed(3)}/kg, CVPF = {coalGcv} kCal/kg, GHR = {ghr} kCal/kWh, and AUX = {auxPct}%.
            </div>
          )}
          {activeStage === 4 && (
            <div>
              <strong style={{ color: '#facc15' }}>Commercial Energy Settlement:</strong> Discoms are billed on Regional Energy Account (ERPC REA) scheduled ex-bus energy multiplied by the certified monthly ECR, settled through the two-part tariff ledger.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
