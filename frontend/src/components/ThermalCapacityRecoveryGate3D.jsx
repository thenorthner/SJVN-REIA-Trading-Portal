import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * ThermalCapacityRecoveryGate3D
 * 3D Fixed Cost Availability Recovery & Incentive Engine:
 * Annual Fixed Cost (AFC Pool) ➔ Plant Availability Gate (PAFM vs NAPAF) ➔ Incentive / Disincentive Engine ➔ Monthly Capacity Committed
 */

const SAMPLE_AFC_BREAKDOWN = {
  station_name: 'Buxar Supercritical Thermal Project (2 × 660 MW)',
  annual_afc: 18500000000, // ₹1,850 Cr / year
  depreciation: 4800000000, // 26%
  interest_on_loan: 5200000000, // 28%
  return_on_equity: 4950000000, // 27% (15.5% grossed up)
  om_expenses: 2450000000, // 13%
  interest_on_working_capital: 1100000000, // 6%
  napaf: 85.0, // Normative 85%
  pafm: 88.5,  // Actual achieved 88.5%
};

export default function ThermalCapacityRecoveryGate3D({
  bill = null,
  station = null,
  tariff = null,
}) {
  const [activeStage, setActiveStage] = useState(null);

  const fallback = SAMPLE_AFC_BREAKDOWN;

  const t = typeof bill?.thermal_inputs_json === 'string'
    ? JSON.parse(bill.thermal_inputs_json || '{}')
    : (bill?.thermal_inputs || {});

  const stationName = station?.station_name || bill?.station_name || fallback.station_name;
  const annualAfc = Number(bill?.a1_afc || t.tariff?.annual_afc || station?.annual_afc || fallback.annual_afc);
  const napaf = Number(bill?.a11_napaf_pct || t.tariff?.napaf_percent || station?.napaf_percent || fallback.napaf);
  const pafm = Number(bill?.c1_pafm_pct ?? fallback.pafm);

  // Recovery ratio
  const recoveryRatio = napaf > 0 ? pafm / napaf : 1;
  const hasIncentive = pafm >= napaf;
  const daysInMonth = Number(bill?.a8_days_in_month || 30);
  const daysInYear = Number(bill?.a9_days_in_year || 365);

  // Monthly base capacity charge = AFC * (daysInMonth / daysInYear)
  const baseMonthlyCapacity = (annualAfc * daysInMonth) / daysInYear;

  // Actual capacity charge after PAFM/NAPAF
  const actualCapacityCharge = Number(bill?.c5_total_capacity_charge || (baseMonthlyCapacity * Math.min(1.0, recoveryRatio)));

  // If PAFM > NAPAF, CERC peak/off-peak incentive applies: 50 paise/kWh or capacity bonus
  const incentiveAmount = hasIncentive && pafm > napaf
    ? Math.round(baseMonthlyCapacity * ((pafm - napaf) / 100) * 0.4)
    : 0;

  const netPayableCapacity = actualCapacityCharge;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #15102a 0%, #080512 100%)',
      borderRadius: 14,
      border: '1px solid #431407',
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
          linear-gradient(rgba(244, 63, 94, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(244, 63, 94, 0.03) 1px, transparent 1px)
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
            background: 'linear-gradient(135deg, #e11d48, #be123c)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(225, 29, 72, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Thermal Capacity Charge & PAFM vs NAPAF Recovery Gate
              </span>
              <span style={{
                background: 'rgba(225, 29, 72, 0.15)',
                color: '#fb7185',
                border: '1px solid rgba(225, 29, 72, 0.4)',
                fontSize: 13.5,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                CERC REGULATION 42
              </span>
            </div>
            <div style={{ fontSize: 14.5, color: '#94a3b8', marginTop: 2 }}>
              AFC Fixed Cost Pool ➔ Declared Availability Gate (PAFM vs NAPAF) ➔ Pro-Rata / Incentive Recovery ➔ Monthly Committed Bill
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Target Availability</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fb7185' }}>
            NAPAF {napaf}%
          </div>
        </div>
      </div>

      {/* 4-Stage 3D Recovery Gateway */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Stage 1: Annual Fixed Cost Pool */}
        <div
          onClick={() => setActiveStage(activeStage === 1 ? null : 1)}
          style={{
            background: 'linear-gradient(180deg, rgba(32, 17, 30, 0.8) 0%, rgba(18, 9, 18, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 1 ? '#f43f5e' : 'rgba(244, 63, 94, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 1 ? '0 0 20px rgba(244, 63, 94, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fb7185', letterSpacing: '0.04em' }}>
              STAGE 1: AFC POOL
            </span>
            <span style={{ fontSize: 13.5, color: '#94a3b8' }}>Annual CERC</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Approved Fixed Cost</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>5 Capital Components</div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Annual AFC Pool</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#f8fafc', fontVariantNumeric: 'tabular-nums' }}>
              {fmtCurrency(annualAfc)}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--slate-500)', marginTop: 3 }}>
              Monthly Base: {fmtCurrency(baseMonthlyCapacity)}
            </div>
          </div>
        </div>

        {/* Stage 2: Availability Gate */}
        <div
          onClick={() => setActiveStage(activeStage === 2 ? null : 2)}
          style={{
            background: 'linear-gradient(180deg, rgba(32, 17, 30, 0.8) 0%, rgba(18, 9, 18, 0.95) 100%)',
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
              STAGE 2: AVAILABILITY GATE
            </span>
            <span style={{ fontSize: 13.5, color: '#94a3b8' }}>ERPC REA</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>PAFM vs Target NAPAF</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            Plant Availability Factor
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
              <span style={{ color: '#94a3b8' }}>Achieved (PAFM):</span>
              <span style={{ fontWeight: 700, color: hasIncentive ? '#4ade80' : '#f87171' }}>{pafm}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: '#94a3b8' }}>Recovery Ratio:</span>
              <span style={{ fontWeight: 700, color: '#38bdf8' }}>{(recoveryRatio * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {/* Stage 3: Incentive / Disincentive Engine */}
        <div
          onClick={() => setActiveStage(activeStage === 3 ? null : 3)}
          style={{
            background: 'linear-gradient(180deg, rgba(32, 17, 30, 0.8) 0%, rgba(18, 9, 18, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 3 ? (hasIncentive ? 'var(--t-green-100)' : '#f87171') : 'rgba(74, 222, 128, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 3 ? '0 0 20px rgba(74, 222, 128, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: hasIncentive ? '#4ade80' : '#f87171', letterSpacing: '0.04em' }}>
              STAGE 3: INCENTIVE ENGINE
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 700,
              background: hasIncentive ? 'rgba(74, 222, 128, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: hasIncentive ? '#4ade80' : '#f87171',
              padding: '1px 6px',
              borderRadius: 4,
            }}>
              {hasIncentive ? 'FULL RECOVERY' : 'PRO-RATA PENALTY'}
            </span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Performance Multiplier</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>
            {hasIncentive ? `Surplus: +${(pafm - napaf).toFixed(2)}%` : `Shortfall: -${(napaf - pafm).toFixed(2)}%`}
          </div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Recovery Determination</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: hasIncentive ? '#4ade80' : '#f87171' }}>
              {hasIncentive ? '100% Fixed Recovery' : `${(recoveryRatio * 100).toFixed(1)}% Recovery Only`}
            </div>
            <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 3 }}>
              {hasIncentive ? 'Eligible for peak availability incentive' : 'Under-recovery deduction applied'}
            </div>
          </div>
        </div>

        {/* Stage 4: Monthly Capacity Committed */}
        <div
          onClick={() => setActiveStage(activeStage === 4 ? null : 4)}
          style={{
            background: 'linear-gradient(180deg, rgba(32, 17, 30, 0.8) 0%, rgba(18, 9, 18, 0.95) 100%)',
            border: `1.5px solid ${activeStage === 4 ? '#f59e0b' : 'rgba(245, 158, 11, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.25s ease',
            boxShadow: activeStage === 4 ? '0 0 20px rgba(245, 158, 11, 0.25)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fbbf24', letterSpacing: '0.04em' }}>
              STAGE 4: COMMITTED CHARGE
            </span>
            <span style={{ fontSize: 13.5, color: '#94a3b8' }}>Billed Discoms</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>Net Capacity Charge</div>
          <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 2 }}>Block C5 of Invoice</div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: 13.5, color: '#94a3b8' }}>Monthly Demand Payable</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' }}>
              {fmtCurrency(netPayableCapacity)}
            </div>
            <div style={{ fontSize: 13.5, color: '#4ade80', marginTop: 3 }}>
              Ready for DISCOM ledger debit
            </div>
          </div>
        </div>
      </div>

      {/* Explanatory Regulatory Drawer */}
      {activeStage && (
        <div style={{
          marginTop: 16,
          background: 'rgba(18, 9, 18, 0.95)',
          border: '1px solid rgba(225, 29, 72, 0.3)',
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
              <strong style={{ color: '#fb7185' }}>CERC Annual Fixed Cost Composition:</strong> Comprises Return on Equity (15.5% base RoE grossed up with corporate MAT rate), normative Depreciation (90% capital cost over 25 yrs), Interest on Loan (normative 70:30 debt-equity), Operation & Maintenance (O&M) expenses with annual escalation, and Interest on Working Capital (20 days coal stock + secondary fuel).
            </div>
          )}
          {activeStage === 2 && (
            <div>
              <strong style={{ color: '#38bdf8' }}>CERC Plant Availability Factor (PAFM):</strong> Certified each month by Eastern Regional Power Committee (ERPC REA). If PAFM is below NAPAF (85%), capacity charge is cut pro-rata without exception.
            </div>
          )}
          {activeStage === 3 && (
            <div>
              <strong style={{ color: '#4ade80' }}>Capacity Recovery Formula:</strong>
              <div style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.4)', padding: '6px 10px', borderRadius: 4, marginTop: 4, color: 'var(--on-red)' }}>
                Capacity Charge = AFC × (Days in Month / Days in Year) × (PAFM / NAPAF) [capped at 1.0 for base AFC]
              </div>
            </div>
          )}
          {activeStage === 4 && (
            <div>
              <strong style={{ color: '#fbbf24' }}>Discom Apportionment:</strong> The recovered Capacity Charge is shared amongst beneficiaries (Bihar NBPDCL/SBPDCL, Jharkhand, West Bengal) according to their MoP / ERPC certified capacity entitlement percentages.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
