import React, { useState } from 'react';
import { useCanWrite } from '../lib/deskAccess.js';
import { useNavigate } from 'react-router-dom';
import {
  Calculator,
  ShieldCheck,
  Zap,
  Flame,
  Scale,
  Calendar,
  Layers,
  FileText,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Sparkles,
  Info,
} from 'lucide-react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * ThermalTariffArchitectureDoc3D
 * Professional presentation of CERC Two-Part Tariff Settlement Framework (Regulations 42 & 43)
 * Decoupled fixed capacity charge vs variable fuel energy charge with data origin breakdown.
 */
export default function ThermalTariffArchitectureDoc3D({
  station = null,
  compact = false,
}) {
  const navigate = useNavigate();
  // Read-only for the administrators and the auditor (Target #2 Phase B).
  const canWrite = useCanWrite();
  const [activeTab, setActiveTab] = useState('mechanics'); // 'mechanics' | 'lifecycle' | 'simulator'

  // Simulator state
  const [simPafm, setSimPafm] = useState(88.5);
  const [simCoalCost, setSimCoalCost] = useState(3850);
  const [simCoalGcv, setSimCoalGcv] = useState(3450);
  const [simScheduledMu, setSimScheduledMu] = useState(578.4);

  // Constants
  const napaf = 85.0;
  const annualAfcCr = 1850; // ₹1,850 Cr / year
  const baseMonthlyAfcCr = (annualAfcCr * 30) / 365; // ~₹152.05 Cr
  const grossHeatRate = 2250; // kCal/kWh
  const auxConsumption = 5.75; // %
  const specificOilMl = 0.50; // ml/kWh
  const oilPriceRsPerKl = 62000; // ₹/kL
  const oilGcv = 9200; // kCal/L

  // Simulated ECR calculation (CERC Reg 43)
  // ECR = [ (GHR - SFC * CVSF) * LPPF / CVPF + SFC * LPSFi ] * 100 / (100 - AUX)
  const heatFromCoal = Math.max(0, grossHeatRate - (specificOilMl * oilGcv) / 1000);
  const coalComponent = (heatFromCoal * (simCoalCost / 1000)) / simCoalGcv; // ₹/kWh
  const oilComponent = (specificOilMl * oilPriceRsPerKl) / 1000000; // ₹/kWh
  const grossFuelCost = coalComponent + oilComponent;
  const simEcr = Number(((grossFuelCost * 100) / (100 - auxConsumption)).toFixed(3)); // ₹/kWh

  // Simulated Capacity Charge calculation (CERC Reg 42)
  const recoveryRatio = simPafm / napaf;
  const isTargetAchieved = simPafm >= napaf;
  const capacityRecoveryPct = Math.min(100, Number((recoveryRatio * 100).toFixed(2)));
  const simCapacityCr = isTargetAchieved
    ? baseMonthlyAfcCr
    : Number((baseMonthlyAfcCr * (simPafm / napaf)).toFixed(2));
  const simIncentiveCr = isTargetAchieved && simPafm > napaf
    ? Number((baseMonthlyAfcCr * ((simPafm - napaf) / 100) * 0.35).toFixed(2))
    : 0;
  const totalCapacityChargeCr = Number((simCapacityCr + simIncentiveCr).toFixed(2));

  // Simulated Energy Charge amount
  const simEnergyCr = Number(((simScheduledMu * 1000000 * simEcr) / 10000000).toFixed(2)); // in ₹ Cr
  const simTotalBillCr = Number((totalCapacityChargeCr + simEnergyCr).toFixed(2));
  const levelizedTariff = simScheduledMu > 0
    ? Number(((simTotalBillCr * 10) / simScheduledMu).toFixed(2)) // ₹/kWh
    : 0;

  return (
    <div style={{
      background: 'linear-gradient(145deg, #030712 0%, #0b1528 50%, #030712 100%)',
      borderRadius: 16,
      border: '1px solid rgba(59, 130, 246, 0.22)',
      padding: '22px 24px',
      color: '#f8fafc',
      marginBottom: 20,
      boxShadow: '0 12px 36px -10px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background ambient lighting */}
      <div style={{
        position: 'absolute',
        top: -60,
        right: -60,
        width: 240,
        height: 240,
        background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: -60,
        left: -60,
        width: 220,
        height: 220,
        background: 'radial-gradient(circle, rgba(245, 158, 11, 0.12) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14,
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        paddingBottom: 16,
        marginBottom: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.1) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#60a5fa',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
          }}>
            <Scale size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '-0.01em' }}>
                CERC Two-Part Tariff Settlement Architecture
              </h3>
              <span style={{
                fontSize: 12.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#93c5fd',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                CERC Tariff Reg 2024–2029 (Reg 42 &amp; 43)
              </span>
            </div>
            <p style={{ fontSize: 14.5, color: '#94a3b8', margin: '3px 0 0' }}>
              Statutory decoupling of fixed capital cost recovery from variable fuel dispatch for thermal generating stations
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(15, 23, 42, 0.7)',
          padding: 4,
          borderRadius: 10,
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}>
          {[
            { id: 'mechanics', label: 'Formula & Mechanics', icon: Calculator },
            { id: 'lifecycle', label: 'Annual vs Monthly Setup', icon: Calendar },
            { id: 'simulator', label: 'Live Tariff Simulator', icon: Sliders },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 7,
                  fontSize: 14,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(37, 99, 235, 0.2) 100%)'
                    : 'transparent',
                  color: isActive ? '#60a5fa' : '#94a3b8',
                  boxShadow: isActive ? 'inset 0 0 0 1px rgba(59, 130, 246, 0.4)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: FORMULA & MECHANICS */}
      {activeTab === 'mechanics' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 16,
            marginBottom: 16,
          }}>
            {/* Pillar 1: Capacity Charge */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: 12,
              border: '1px solid rgba(59, 130, 246, 0.25)',
              padding: '18px 20px',
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ShieldCheck size={18} color="#60a5fa" />
                  <span style={{ fontSize: 15.5, fontWeight: 700, color: '#ffffff' }}>
                    1. Fixed Capacity Charge (AFC Recovery)
                  </span>
                </div>
                <span style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}>
                  CERC Reg 42
                </span>
              </div>

              {/* Mathematical Formula Box */}
              <div style={{
                background: '#020617',
                borderRadius: 8,
                border: '1px solid rgba(59, 130, 246, 0.2)',
                padding: '12px 14px',
                marginBottom: 14,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 14.5,
                color: '#e2e8f0',
                lineHeight: 1.6,
              }}>
                <div style={{ color: '#93c5fd', fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                  Monthly Capacity Charge =
                </div>
                <div style={{ paddingLeft: 12 }}>
                  <span style={{ color: '#fbbf24', fontWeight: 600 }}>AFC</span>
                  <span style={{ color: '#94a3b8' }}> × </span>
                  <span style={{ color: '#38bdf8' }}>(Days in Month / Days in Year)</span>
                  <span style={{ color: '#94a3b8' }}> × </span>
                  <span style={{ color: '#4ade80', fontWeight: 600 }}>(PAFM / NAPAF)</span>
                </div>
              </div>

              {/* Parameter explanation list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: '#cbd5e1' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ minWidth: 62, fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace' }}>AFC:</span>
                  <span>Approved Annual Fixed Cost pool (Depreciation + Loan Interest + RoE @ 15.5% + O&amp;M + Working Capital).</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ minWidth: 62, fontWeight: 700, color: '#4ade80', fontFamily: 'monospace' }}>PAFM:</span>
                  <span>Plant Availability Factor achieved in month (certified by ERPC REA).</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ minWidth: 62, fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>NAPAF:</span>
                  <span>Target Normative Availability (<strong style={{ color: '#ffffff' }}>85.0%</strong>).</span>
                </div>
              </div>

              <div style={{
                marginTop: 14,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                fontSize: 13.5,
                color: '#93c5fd',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <CheckCircle2 size={16} color="#60a5fa" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Full Recovery:</strong> Paid in full if PAFM ≥ 85%. If PAFM &lt; 85%, capacity charge is pro-rata penalized.
                </span>
              </div>
            </div>

            {/* Pillar 2: Energy Charge */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: 12,
              border: '1px solid rgba(245, 158, 11, 0.25)',
              padding: '18px 20px',
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Flame size={18} color="#f59e0b" />
                  <span style={{ fontSize: 15.5, fontWeight: 700, color: '#ffffff' }}>
                    2. Variable Energy Charge (Fuel Cost Pass-Through)
                  </span>
                </div>
                <span style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: '#fcd34d',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                }}>
                  CERC Reg 43
                </span>
              </div>

              {/* Mathematical Formula Box */}
              <div style={{
                background: '#020617',
                borderRadius: 8,
                border: '1px solid rgba(245, 158, 11, 0.2)',
                padding: '12px 14px',
                marginBottom: 14,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 14.5,
                color: '#e2e8f0',
                lineHeight: 1.6,
              }}>
                <div style={{ color: '#fcd34d', fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
                  Energy Charge = ECR × Ex-Bus Scheduled Generation (kWh)
                </div>
                <div style={{ paddingLeft: 12, fontSize: 14 }}>
                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>ECR</span>
                  <span style={{ color: '#94a3b8' }}> = [ </span>
                  <span style={{ color: '#38bdf8' }}>(GHR − SFC × CVSF) × LPPF / CVPF</span>
                  <span style={{ color: '#94a3b8' }}> + </span>
                  <span style={{ color: '#fbbf24' }}>SFC × LPSFi</span>
                  <span style={{ color: '#94a3b8' }}> ] × </span>
                  <span style={{ color: '#4ade80' }}>100 / (100 − AUX)</span>
                </div>
              </div>

              {/* Parameter explanation list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: '#cbd5e1' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ minWidth: 62, fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>GHR:</span>
                  <span>Gross Station Heat Rate (<strong style={{ color: '#ffffff' }}>2,250 kCal/kWh</strong> for Supercritical Buxar).</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ minWidth: 62, fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>LPPF/CVPF:</span>
                  <span>Landed Price of Coal (₹/Tonne) and Gross Calorific Value as received (kCal/kg).</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ minWidth: 62, fontWeight: 700, color: '#4ade80', fontFamily: 'monospace' }}>AUX:</span>
                  <span>Normative Auxiliary Power Consumption (<strong style={{ color: '#ffffff' }}>5.75%</strong>).</span>
                </div>
              </div>

              <div style={{
                marginTop: 14,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                fontSize: 13.5,
                color: '#fcd34d',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <Zap size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
                <span>
                  <strong>Fuel Pass-Through:</strong> ECR recovers fuel burnt based on monthly Form 15 certified coal consumption.
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Integration banner */}
          <div style={{
            background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, rgba(245, 158, 11, 0.1) 100%)',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}>
                <Layers size={18} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                  Total Monthly Thermal Bill = Capacity Charge + Energy Charge
                </div>
                <div style={{ fontSize: 14, color: '#94a3b8' }}>
                  Decoupled settlement ensures SJVN fixed capital recovery is guaranteed by plant availability, independent of grid dispatch.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => navigate('/thermal/stations')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'rgba(59, 130, 246, 0.2)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  color: '#93c5fd',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Stations &amp; Tariff Setup
                <ArrowRight size={13} />
              </button>
              {canWrite && (
              <button
                type="button"
                onClick={() => navigate('/thermal/billing')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 6,
                  background: 'rgba(16, 185, 129, 0.2)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#6ee7b7',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Raise Monthly Bill
                <ChevronRight size={13} />
              </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ANNUAL VS MONTHLY SETUP LIFECYCLE */}
      {activeTab === 'lifecycle' && (
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 16,
          }}>
            {/* Stream A: Annual Norms */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: 12,
              border: '1px solid rgba(59, 130, 246, 0.25)',
              padding: '18px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Calendar size={18} color="#60a5fa" />
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 700, color: '#ffffff' }}>
                      Step 1: Annual Baseline Norms
                    </div>
                    <div style={{ fontSize: 13.5, color: '#94a3b8' }}>
                      Configured once per Financial Year in <strong style={{ color: '#60a5fa' }}>Stations &amp; Tariff</strong>
                    </div>
                  </div>
                </div>
                <span style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}>
                  Year-Ahead Master
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  {
                    param: 'Annual Fixed Charges (AFC)',
                    value: '₹1,850.00 Cr / FY',
                    source: 'CERC Section 62 Tariff Order for STPP Buxar',
                  },
                  {
                    param: 'Target Normative Availability (NAPAF)',
                    value: '85.00%',
                    source: 'CERC Tariff Regulations (2024–2029)',
                  },
                  {
                    param: 'Gross Station Heat Rate (GHR)',
                    value: '2,250 kCal/kWh',
                    source: 'Operating norms order for supercritical 660 MW units',
                  },
                  {
                    param: 'Auxiliary Power Consumption (AUX)',
                    value: '5.75%',
                    source: 'Station design norm with natural draft cooling tower',
                  },
                  {
                    param: 'Specific Fuel Oil Consumption (SFC)',
                    value: '0.50 ml/kWh',
                    source: 'Normative secondary fuel consumption ceiling',
                  },
                  {
                    param: 'Coal Transit & Handling Loss Allowance',
                    value: '0.80%',
                    source: 'Standard normative allowance for pithead rail transit',
                  },
                ].map((row, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'rgba(2, 6, 23, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: '#f1f5f9' }}>{row.param}</div>
                      <div style={{ fontSize: 13, color: '#94a3b8' }}>{row.source}</div>
                    </div>
                    <span style={{
                      fontSize: 14,
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: '#60a5fa',
                      background: 'rgba(59, 130, 246, 0.1)',
                      padding: '3px 8px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                    }}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stream B: Monthly Operational Inputs */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.65)',
              borderRadius: 12,
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '18px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#34d399" />
                  <div>
                    <div style={{ fontSize: 15.5, fontWeight: 700, color: '#ffffff' }}>
                      Step 2: Monthly Operational Inflow
                    </div>
                    <div style={{ fontSize: 13.5, color: '#94a3b8' }}>
                      Entered with each monthly billing cycle in <strong style={{ color: '#34d399' }}>Monthly Bills</strong>
                    </div>
                  </div>
                </div>
                <span style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#6ee7b7',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                }}>
                  Monthly Live Billing
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  {
                    param: 'Plant Availability Achieved (PAFM)',
                    value: 'e.g., 88.50%',
                    source: 'ERPC Certified Regional Energy Account (Table D)',
                  },
                  {
                    param: 'Ex-Bus Scheduled Generation',
                    value: 'e.g., 578.40 MU',
                    source: 'ERPC Certified Regional Energy Account (Table A)',
                  },
                  {
                    param: 'Landed Price of Coal (LPPF)',
                    value: 'e.g., ₹3,850 / Tonne',
                    source: 'Station Fuel Audit Statement (CERC Form 15)',
                  },
                  {
                    param: 'Gross Calorific Value of Coal (CVPF)',
                    value: 'e.g., 3,450 kCal/kg',
                    source: 'Third-party joint sampling & lab test report as received',
                  },
                  {
                    param: 'Landed Price of Secondary Oil (LPSFi)',
                    value: 'e.g., ₹62,000 / kL',
                    source: 'Monthly oil supplier invoices & freight statements',
                  },
                  {
                    param: 'Beneficiary Entitlement Allocation',
                    value: 'e.g., NBPDCL (50%)',
                    source: 'Ministry of Power allocation order & ERPC matrix',
                  },
                ].map((row, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'rgba(2, 6, 23, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: '#f1f5f9' }}>{row.param}</div>
                      <div style={{ fontSize: 13, color: '#94a3b8' }}>{row.source}</div>
                    </div>
                    <span style={{
                      fontSize: 14,
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      color: '#34d399',
                      background: 'rgba(16, 185, 129, 0.1)',
                      padding: '3px 8px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                    }}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LIVE TARIFF SIMULATOR */}
      {activeTab === 'simulator' && (
        <div style={{
          background: 'rgba(15, 23, 42, 0.65)',
          borderRadius: 12,
          border: '1px solid rgba(59, 130, 246, 0.25)',
          padding: '20px 22px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sliders size={18} color="#38bdf8" />
              <div>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: '#ffffff' }}>
                  Interactive Thermal Tariff &amp; Recovery Simulator
                </div>
                <div style={{ fontSize: 14, color: '#94a3b8' }}>
                  Adjust operating parameters below to see how PAFM and landed fuel price govern two-part bill outputs in real time
                </div>
              </div>
            </div>
            <span style={{
              fontSize: 12.5,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 999,
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}>
              Dynamic Calculator
            </span>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            marginBottom: 20,
          }}>
            {/* Control 1: PAFM */}
            <div style={{ background: '#020617', padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>Achieved PAFM (%):</span>
                <span style={{
                  fontSize: 15.5,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: isTargetAchieved ? '#4ade80' : '#f87171',
                }}>
                  {simPafm}% {isTargetAchieved ? '(≥ NAPAF 85%)' : '(< NAPAF Penalty)'}
                </span>
              </div>
              <input
                type="range"
                min="65"
                max="100"
                step="0.5"
                value={simPafm}
                onChange={(e) => setSimPafm(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: '#3b82f6' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--slate-500)', marginTop: 4 }}>
                <span>65% (Penalty)</span>
                <span>85% (Normative)</span>
                <span>100% (Max Incentive)</span>
              </div>
            </div>

            {/* Control 2: Landed Coal Price */}
            <div style={{ background: '#020617', padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>Landed Coal Price:</span>
                <span style={{ fontSize: 15.5, fontWeight: 700, fontFamily: 'monospace', color: '#fbbf24' }}>
                  ₹{fmtNumber(simCoalCost)} / Tonne
                </span>
              </div>
              <input
                type="range"
                min="2500"
                max="5500"
                step="50"
                value={simCoalCost}
                onChange={(e) => setSimCoalCost(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: '#f59e0b' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--slate-500)', marginTop: 4 }}>
                <span>₹2,500/T (Low Cost)</span>
                <span>₹3,850/T (Base)</span>
                <span>₹5,500/T (High Imported Blend)</span>
              </div>
            </div>

            {/* Control 3: Coal GCV */}
            <div style={{ background: '#020617', padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#94a3b8' }}>Coal GCV (as received):</span>
                <span style={{ fontSize: 15.5, fontWeight: 700, fontFamily: 'monospace', color: '#38bdf8' }}>
                  {fmtNumber(simCoalGcv)} kCal/kg
                </span>
              </div>
              <input
                type="range"
                min="2800"
                max="4800"
                step="50"
                value={simCoalGcv}
                onChange={(e) => setSimCoalGcv(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer', accentColor: '#0ea5e9' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--slate-500)', marginTop: 4 }}>
                <span>2,800 kCal (Low G13)</span>
                <span>3,450 kCal (G10 CCL)</span>
                <span>4,800 kCal (Blended)</span>
              </div>
            </div>
          </div>

          {/* Real-time Calculation Outcome Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 14,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            paddingTop: 16,
          }}>
            {/* Metric 1: Capacity Recovery */}
            <div style={{
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: 10,
              border: '1px solid rgba(59, 130, 246, 0.25)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 13.5, color: '#93c5fd', fontWeight: 600 }}>Capacity Recovery Ratio</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', fontFamily: 'monospace', marginTop: 4 }}>
                {capacityRecoveryPct}%
              </div>
              <div style={{ fontSize: 13, color: isTargetAchieved ? '#4ade80' : '#f87171', marginTop: 2 }}>
                Fixed Charge: ₹{totalCapacityChargeCr} Cr {simIncentiveCr > 0 ? `(+₹${simIncentiveCr} Cr Inc)` : ''}
              </div>
            </div>

            {/* Metric 2: Net ECR */}
            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              borderRadius: 10,
              border: '1px solid rgba(245, 158, 11, 0.25)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 13.5, color: '#fcd34d', fontWeight: 600 }}>Energy Charge Rate (ECR)</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b', fontFamily: 'monospace', marginTop: 4 }}>
                ₹{simEcr} <span style={{ fontSize: 14.5, fontWeight: 600, color: '#94a3b8' }}>/ kWh</span>
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>
                Ex-Bus Scheduled Fuel Cost
              </div>
            </div>

            {/* Metric 3: Total Monthly Bill */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.1)',
              borderRadius: 10,
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 13.5, color: '#6ee7b7', fontWeight: 600 }}>Total Monthly Discom Bill</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#10b981', fontFamily: 'monospace', marginTop: 4 }}>
                ₹{simTotalBillCr} <span style={{ fontSize: 14.5, fontWeight: 600, color: '#94a3b8' }}>Cr</span>
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>
                Capacity (₹{totalCapacityChargeCr} Cr) + Energy (₹{simEnergyCr} Cr)
              </div>
            </div>

            {/* Metric 4: Levelized Rate */}
            <div style={{
              background: 'rgba(147, 51, 234, 0.1)',
              borderRadius: 10,
              border: '1px solid rgba(147, 51, 234, 0.25)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 13.5, color: '#c084fc', fontWeight: 600 }}>Effective Average Tariff</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#c084fc', fontFamily: 'monospace', marginTop: 4 }}>
                ₹{levelizedTariff} <span style={{ fontSize: 14.5, fontWeight: 600, color: '#94a3b8' }}>/ kWh</span>
              </div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>
                Levelized at {simScheduledMu} MU generation
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
