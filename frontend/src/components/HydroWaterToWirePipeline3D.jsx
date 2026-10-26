import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * HydroWaterToWirePipeline3D
 * 3D Physical-to-Financial Ingestion & Settlement Corridor:
 * Reservoir Inflow (m & Gross MU) ➔ Auxiliary & 13% Free Power Gate ➔ CERC Two-Part Tariff Engine (PAFM vs NAPAF) ➔ Commercial Output
 */

const SAMPLE_HYDRO_STATIONS = [
  {
    id: 'NJHEP',
    name: 'Nathpa Jhakri HEP (1,500 MW)',
    dam_head_m: 1495.5,
    gross_gen_mwh: 324588,
    design_energy_mwh: 6612000,
    annual_afc: 15480000000, // ₹1,548 Cr
    pafm: 99.49,
    napaf: 90.0,
    aux_pct: 1.2,
    fehs_pct: 13.0, // 12% Free + 1% LADF
    ecr_normative: 1.65,
    ecr_excess: 1.20,
    month: '2025-11',
  },
  {
    id: 'RAMPUR',
    name: 'Rampur HEP (412 MW)',
    dam_head_m: 865.0,
    gross_gen_mwh: 89389,
    design_energy_mwh: 1878000,
    annual_afc: 5620000000, // ₹562 Cr
    pafm: 100.0,
    napaf: 85.0,
    aux_pct: 1.2,
    fehs_pct: 13.0,
    ecr_normative: 1.72,
    ecr_excess: 1.20,
    month: '2025-11',
  },
];

export default function HydroWaterToWirePipeline3D({
  bill = null,
  station = null,
}) {
  const [activeStationIdx, setActiveStationIdx] = useState(0);
  const [activeStage, setActiveStage] = useState(null);

  const isRampur = station?.station_name?.toLowerCase().includes('rampur');
  const fallback = SAMPLE_HYDRO_STATIONS[isRampur ? 1 : activeStationIdx];

  const stationDisplayName = bill?.station_name || station?.station_name || fallback.name;
  const annualAfc = Number(bill?.a1_afc || station?.annual_afc || fallback.annual_afc);
  const annualDesignEnergy = Number(bill?.a2_design_energy_mwh || station?.annual_design_energy_mwh || fallback.design_energy_mwh);

  // Derive parameters from live bill or fallback
  const auxPct = Number(bill?.a3_aux_pct ?? station?.normative_aux ?? fallback.aux_pct);
  const exBusMwh = bill?.e1_ex_bus_scheduled_kwh
    ? Math.round((Number(bill.e1_ex_bus_scheduled_kwh) / 1000) * 10) / 10
    : Math.round(fallback.gross_gen_mwh * (1 - fallback.aux_pct / 100) * 10) / 10;

  const grossMwh = bill?.e1_ex_bus_scheduled_kwh
    ? Math.round((exBusMwh / (1 - (auxPct / 100))) * 10) / 10
    : fallback.gross_gen_mwh;
  const auxMwh = Math.round((grossMwh - exBusMwh) * 10) / 10;

  const fehsPct = Number(bill?.a4_fehs_pct ?? station?.free_energy_home_state ?? fallback.fehs_pct);
  const freePowerMwh = bill?.e2_free_power_kwh
    ? Math.round((Number(bill.e2_free_power_kwh) / 1000) * 10) / 10
    : Math.round(exBusMwh * (fehsPct / 100) * 10) / 10;

  const saleableMwh = bill?.e3_saleable_scheduled_kwh
    ? Math.round((Number(bill.e3_saleable_scheduled_kwh) / 1000) * 10) / 10
    : Math.round((exBusMwh - freePowerMwh) * 10) / 10;

  const pafm = Number(bill?.c1_pafm_pct ?? fallback.pafm);
  const napaf = Number(bill?.a11_napaf_pct ?? station?.napaf_percent ?? fallback.napaf);
  const hasIncentive = pafm > napaf;

  const ecrNormative = Number(bill?.a12_ecr ?? fallback.ecr_normative);
  const capCharge = Number(bill?.c5_total_capacity_charge ?? (annualAfc / 12));
  const energyCharge = Number(bill?.ee1_energy_charge ?? (saleableMwh * 1000 * ecrNormative));
  const excessEnergyCharge = Number(bill?.ee2_excess_energy_charge ?? 0);
  const totalBilled = Number(bill?.total_charges ?? (capCharge + energyCharge + excessEnergyCharge));

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #0c172e 0%, #050b18 100%)',
      borderRadius: 14,
      border: '1px solid #1e293b',
      boxShadow: '0 12px 35px rgba(0,0,0,0.6)',
      padding: '22px 24px',
      marginBottom: 22,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Background Subtle Grid Pattern */}
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
            background: 'linear-gradient(135deg, #0284c7, #2563eb)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(2, 132, 199, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.01em' }}>
                Hydro Water-to-Wire Two-Part Tariff Settlement Pipeline
              </span>
              <span style={{
                background: 'rgba(2, 132, 199, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(2, 132, 199, 0.4)',
                fontSize: 13.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                CERC HYDRO TARIFF REGULATION
              </span>
            </div>
            <div style={{ fontSize: 14.5, color: '#94a3b8', marginTop: 2 }}>
              Physical Hydrology Inflow → Auxiliary & 13% Free Power Gate → CERC Two-Part Settlement (AFC & ECR)
            </div>
          </div>
        </div>

        {/* Station Stream Switcher */}
        {!bill && (
          <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
            {SAMPLE_HYDRO_STATIONS.map((st, idx) => (
              <button
                key={st.id}
                type="button"
                className={`btn btn-xs ${activeStationIdx === idx ? 'btn-primary' : 'btn-ghost'}`}
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: activeStationIdx === idx ? '#ffffff' : '#94a3b8',
                }}
                onClick={() => setActiveStationIdx(idx)}
              >
                {st.name.split(' ')[0]} {st.name.split(' ')[1]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main 4-Stage 3D Pipeline Flex Flow */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Stage 1: Reservoir Inflow & Gross Generation */}
        <div
          onClick={() => setActiveStage(activeStage === 1 ? null : 1)}
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 1 ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 1 ? '0 0 20px rgba(56, 189, 248, 0.2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.04em' }}>
              STAGE 1: HYDROLOGY
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>{stationDisplayName.split(' ')[0]} {stationDisplayName.split(' ')[1] || 'Intake'}</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
            Dam Inflow & Head
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            Head: ~{fallback.dam_head_m} m | Gross MWh
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Gross Generation</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
              {fmtNumber(grossMwh, 1)} <span style={{ fontSize: 14.5, fontWeight: 500 }}>MWh</span>
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 3 }}>
              Annual DE: {fmtNumber(annualDesignEnergy / 1000, 0)} MU
            </div>
          </div>
        </div>

        {/* Stage 2: Auxiliary & Free Power Gate */}
        <div
          onClick={() => setActiveStage(activeStage === 2 ? null : 2)}
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 2 ? '#a855f7' : 'rgba(168, 85, 247, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 2 ? '0 0 20px rgba(168, 85, 247, 0.2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#c084fc', letterSpacing: '0.04em' }}>
              STAGE 2: AUX & FREE POWER
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>HP Home State</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
            Normative Deductions
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            Aux: -{auxPct}% ({fmtNumber(auxMwh, 1)} MWh)
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13.5, color: '#94a3b8' }}>Free Power (13% HP):</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>-{fmtNumber(freePowerMwh, 1)} MWh</span>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Net Saleable Ex-Bus (E3)</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: '#c084fc', fontVariantNumeric: 'tabular-nums' }}>
                {fmtNumber(saleableMwh, 1)} <span style={{ fontSize: 14.5, fontWeight: 500 }}>MWh</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stage 3: CERC Two-Part Tariff Engine */}
        <div
          onClick={() => setActiveStage(activeStage === 3 ? null : 3)}
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 3 ? '#22c55e' : 'rgba(34, 197, 94, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 3 ? '0 0 20px rgba(34, 197, 94, 0.2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#4ade80', letterSpacing: '0.04em' }}>
              STAGE 3: TWO-PART TARIFF
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 700,
              background: hasIncentive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
              color: hasIncentive ? '#4ade80' : '#facc15',
              padding: '1px 6px',
              borderRadius: 4,
            }}>
              PAFM {pafm}% ≥ {napaf}%
            </span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
            Capacity & Energy Split
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            100% AFC Recovery Achieved
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Capacity (AFC/12):</span>
              <span style={{ fontWeight: 600, color: '#f8fafc' }}>{fmtCurrency(capCharge)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: '#94a3b8' }}>Energy Charge:</span>
              <span style={{ fontWeight: 600, color: '#f8fafc' }}>{fmtCurrency(energyCharge + excessEnergyCharge)}</span>
            </div>
          </div>
        </div>

        {/* Stage 4: Commercial Output */}
        <div
          onClick={() => setActiveStage(activeStage === 4 ? null : 4)}
          style={{
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 4 ? '#f59e0b' : 'rgba(245, 158, 11, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 4 ? '0 0 20px rgba(245, 158, 11, 0.2)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.04em' }}>
              STAGE 4: COMMITTED BILL
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--slate-500)' }}>NRPC Certified</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
            Net Month Invoice
          </div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            Ready for Discom Allocation
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Total Monthly Demand</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
              {fmtCurrency(totalBilled)}
            </div>
            <div style={{ fontSize: 13.5, color: '#4ade80', marginTop: 3 }}>
              Effective: ₹{((totalBilled / (saleableMwh * 1000 || 1))).toFixed(3)} / kWh
            </div>
          </div>
        </div>
      </div>

      {/* Explanatory Regulatory Drawer on Stage Selection */}
      {activeStage && (
        <div style={{
          marginTop: 16,
          background: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
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
              <strong style={{ color: '#38bdf8' }}>Hydrology & Intake Protocol:</strong> Dam reservoir elevation directly dictates hydrostatic head and generation potential. Generation above Design Energy (DE) triggers secondary excess energy tariffs under CERC norms.
            </div>
          )}
          {activeStage === 2 && (
            <div>
              <strong style={{ color: '#c084fc' }}>Auxiliary & Free Power Gate:</strong> Normative auxiliary consumption (1.2% for underground hydro stations with static excitation) is deducted at busbar. 12% Free Power + 1% LADF is allotted to Himachal Pradesh as Home State before calculating saleable shares.
            </div>
          )}
          {activeStage === 3 && (
            <div>
              <strong style={{ color: '#4ade80' }}>CERC Two-Part Tariff Mechanism:</strong> When Plant Availability Factor achieved (PAFM) equals or exceeds Normative Availability (NAPAF = 90%), SJVN recovers 100% of approved Annual Fixed Charges (AFC) pro-rated monthly.
            </div>
          )}
          {activeStage === 4 && (
            <div>
              <strong style={{ color: '#fbbf24' }}>Commercial Ledger Commitment:</strong> The computed net demand of {fmtCurrency(totalBilled)} is apportioned strictly according to NRPC Regional Energy Account (Table D2) entitlement ratios among the 8 northern beneficiary utilities.
            </div>
          )}
        </div>
      )}

      {/* Bottom Summary Corridor */}
      <div style={{
        marginTop: 16,
        paddingTop: 12,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        fontSize: 14.5,
        color: '#94a3b8',
        position: 'relative',
        zIndex: 2,
      }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>Annual AFC: <strong style={{ color: '#f8fafc' }}>{fmtCurrency(annualAfc)}</strong></span>
          <span>NAPAF Target: <strong style={{ color: '#f8fafc' }}>{napaf}%</strong></span>
          <span>Free Power to Home State: <strong style={{ color: '#f8fafc' }}>{fehsPct}%</strong></span>
        </div>
        <div>
          <span>Status: <strong style={{ color: '#4ade80' }}>READY FOR COMMERCIAL SETTLEMENT</strong></span>
        </div>
      </div>
    </div>
  );
}
