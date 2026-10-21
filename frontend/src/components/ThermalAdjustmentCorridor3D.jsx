import React, { useState } from 'react';
import {
  RotateCw,
  Scale,
  Flame,
  ShieldCheck,
  TrendingUp,
  CheckCircle2,
  Calendar,
  AlertCircle,
} from 'lucide-react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * ThermalAdjustmentCorridor3D
 * 3D True-up & Retroactive Tariff Revision Conduit for Thermal Stations (STPP Buxar):
 * Original Billed Baseline -> CERC Thermal True-Up Order Delta -> Carrying Cost Corridor -> Thermal Beneficiary Net Adjustment
 */

const SAMPLE_THERMAL_TRUEUP = {
  id: 'CASE-CERC-BUXAR-2026',
  petition_no: 'CERC Petition No. 28/GT/2026 (STPP Buxar True-Up)',
  station_name: 'Buxar Supercritical Thermal Project (2 × 660 MW)',
  period_span: 'FY 2024-25 to FY 2025-26',
  baseline_billed: 14800000000, // ₹1,480 Cr
  capital_addition: 685000000,   // ₹68.5 Cr (Capital capex + Ash handling)
  coal_trueup: 184000000,        // ₹18.4 Cr (Landed fuel cost variation)
  normative_delta: -42000000,    // -₹4.2 Cr (Aux / Heat rate norm restatement)
  roe_rate_delta: 0.5,           // +0.5% RoE gross-up
  carrying_cost_rate: 10.75,     // SBI 1-yr MCLR + 350 bps
  carrying_cost_amount: 48500000,// ₹4.85 Cr
  total_adjustment: 875500000,   // ₹87.55 Cr
  beneficiaries: [
    { name: 'NBPDCL (North Bihar)', share: 50.00, net_delta: 437750000 },
    { name: 'SBPDCL (South Bihar)', share: 35.00, net_delta: 306425000 },
    { name: 'GRIDCO (Odisha)', share: 10.00, net_delta: 87550000 },
    { name: 'Unallocated Quota (MoP)', share: 5.00, net_delta: 43775000 },
  ],
};

export default function ThermalAdjustmentCorridor3D({
  stationId,
  bills = [],
  preview = null,
  arrearForm = null,
}) {
  const [activeStep, setActiveStep] = useState(null);

  const fallback = SAMPLE_THERMAL_TRUEUP;
  const hasLivePreview = Boolean(preview && preview.total_differential !== undefined);

  const periodSpan = (preview?.from_month && preview?.to_month)
    ? `${preview.from_month} to ${preview.to_month} (${preview.months?.length || 0} mos)`
    : (arrearForm?.from_month && arrearForm?.to_month)
      ? `${arrearForm.from_month} to ${arrearForm.to_month}`
      : fallback.period_span;

  const totalAdjustment = hasLivePreview ? Number(preview.total_differential) : fallback.total_adjustment;
  const orderRef = (arrearForm?.reason && arrearForm.reason.trim()) || fallback.petition_no;

  const beneficiaries = (hasLivePreview && preview.beneficiaries?.length > 0)
    ? preview.beneficiaries.map((b) => ({
        name: b.beneficiary_name,
        share: Number(Number(b.pct_proportionate || 0).toFixed(2)),
        net_delta: Number(b.differential || 0),
      }))
    : fallback.beneficiaries;

  return (
    <div style={{
      perspective: '1200px',
      marginBottom: 20,
    }}>
      <div style={{
        background: 'linear-gradient(145deg, #0f0702 0%, #1c0f06 45%, #080301 100%)',
        borderRadius: 16,
        border: '1px solid rgba(245, 158, 11, 0.28)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        padding: '22px 24px',
        color: '#f8fafc',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Ambient Amber/Crimson Backglow */}
        <div style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 260,
          height: 260,
          background: 'radial-gradient(circle, rgba(245, 158, 11, 0.15) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          bottom: -60,
          left: -60,
          width: 220,
          height: 220,
          background: 'radial-gradient(circle, rgba(239, 68, 68, 0.12) 0%, transparent 70%)',
          borderRadius: '50%',
          pointerEvents: 'none',
        }} />

        {/* Header */}
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
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3) 0%, rgba(217, 119, 6, 0.1) 100%)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fbbf24',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.25)',
            }}>
              <RotateCw size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 16.5, fontWeight: 700, margin: 0, color: '#ffffff', letterSpacing: '-0.01em' }}>
                  Thermal True-Up &amp; Supplementary Adjustment Corridor
                </h3>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: '#fcd34d',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}>
                  CERC THERMAL TRUE-UP (REG 10 &amp; 42)
                </span>
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>
                Provisional Invoiced Baseline &rarr; Capital Cost &amp; Fuel True-up &rarr; Carrying Cost Corridor &rarr; Thermal Discom Net Adjustment
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order Reference</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fbbf24', fontFamily: 'monospace' }}>
              {orderRef}
            </div>
          </div>
        </div>

        {/* 4-Stage 3D Isometric Pipeline Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
          marginTop: 18,
          marginBottom: 18,
          position: 'relative',
          zIndex: 2,
        }}>
          {/* Stage 1: Baseline */}
          <div
            onMouseEnter={() => setActiveStep(1)}
            onMouseLeave={() => setActiveStep(null)}
            style={{
              background: activeStep === 1 ? 'rgba(30, 41, 59, 0.8)' : 'rgba(15, 23, 42, 0.65)',
              borderRadius: 12,
              border: `1px solid ${activeStep === 1 ? '#f59e0b' : 'rgba(255, 255, 255, 0.1)'}`,
              padding: '16px 18px',
              transition: 'all 0.25s ease',
              transform: activeStep === 1 ? 'translateY(-3px)' : 'none',
              boxShadow: activeStep === 1 ? '0 10px 24px rgba(245, 158, 11, 0.15)' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                STAGE 1: BASELINE
              </span>
              <span style={{ fontSize: 11, color: 'var(--slate-500)' }}>Original</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
              Provisional Thermal Billing
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              Period: {periodSpan}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>Billed AFC Aggregate:</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#ffffff', fontFamily: 'monospace' }}>
              {fmtCurrency(fallback.baseline_billed)}
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
              Provisional REA &amp; ECR Invoices
            </div>
          </div>

          {/* Stage 2: CERC Delta */}
          <div
            onMouseEnter={() => setActiveStep(2)}
            onMouseLeave={() => setActiveStep(null)}
            style={{
              background: activeStep === 2 ? 'rgba(30, 41, 59, 0.8)' : 'rgba(15, 23, 42, 0.65)',
              borderRadius: 12,
              border: `1px solid ${activeStep === 2 ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)'}`,
              padding: '16px 18px',
              transition: 'all 0.25s ease',
              transform: activeStep === 2 ? 'translateY(-3px)' : 'none',
              boxShadow: activeStep === 2 ? '0 10px 24px rgba(56, 189, 248, 0.15)' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                STAGE 2: CERC DELTA
              </span>
              <span style={{ fontSize: 11, color: '#38bdf8' }}>Approved Order</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
              Thermal Tariff True-Up
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
              Capex, Coal &amp; RoE Restatement
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Capital Capex:</span>
                <span style={{ color: '#38bdf8', fontWeight: 600 }}>+{fmtCurrency(fallback.capital_addition)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Coal Cost True-Up:</span>
                <span style={{ color: '#fbbf24', fontWeight: 600 }}>+{fmtCurrency(fallback.coal_trueup)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Aux Norms Delta:</span>
                <span style={{ color: '#f87171', fontWeight: 600 }}>{fmtCurrency(fallback.normative_delta)}</span>
              </div>
            </div>
          </div>

          {/* Stage 3: Carrying Cost */}
          <div
            onMouseEnter={() => setActiveStep(3)}
            onMouseLeave={() => setActiveStep(null)}
            style={{
              background: activeStep === 3 ? 'rgba(30, 41, 59, 0.8)' : 'rgba(15, 23, 42, 0.65)',
              borderRadius: 12,
              border: `1px solid ${activeStep === 3 ? 'var(--t-amber-100)' : 'rgba(251, 191, 36, 0.3)'}`,
              padding: '16px 18px',
              transition: 'all 0.25s ease',
              transform: activeStep === 3 ? 'translateY(-3px)' : 'none',
              boxShadow: activeStep === 3 ? '0 10px 24px rgba(251, 191, 36, 0.15)' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                STAGE 3: CARRYING COST
              </span>
              <span style={{ fontSize: 11, color: '#fbbf24' }}>MCLR + 350 bps</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
              Interest Compounding
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              Statutory Rate: {fallback.carrying_cost_rate}% p.a.
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>Carrying Interest Claim:</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#fbbf24', fontFamily: 'monospace' }}>
              +{fmtCurrency(fallback.carrying_cost_amount)}
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
              CERC Reg 10(7) compliant
            </div>
          </div>

          {/* Stage 4: Net Arrear Bill */}
          <div
            onMouseEnter={() => setActiveStep(4)}
            onMouseLeave={() => setActiveStep(null)}
            style={{
              background: activeStep === 4 ? 'rgba(6, 78, 59, 0.4)' : 'rgba(6, 78, 59, 0.25)',
              borderRadius: 12,
              border: `1px solid ${activeStep === 4 ? '#34d399' : 'rgba(52, 211, 153, 0.4)'}`,
              padding: '16px 18px',
              transition: 'all 0.25s ease',
              transform: activeStep === 4 ? 'translateY(-3px)' : 'none',
              boxShadow: activeStep === 4 ? '0 10px 24px rgba(52, 211, 153, 0.2)' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                STAGE 4: ARREAR BILL
              </span>
              <span style={{ fontSize: 11, color: '#34d399' }}>Recovery</span>
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#ffffff', marginBottom: 4 }}>
              Net Supplementary Bill
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
              Across {beneficiaries.length} Thermal Off-takers
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--slate-500)' }}>Total Arrear Payable:</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#34d399', fontFamily: 'monospace' }}>
              {fmtCurrency(totalAdjustment)}
            </div>
            <div style={{ fontSize: 11.5, color: '#34d399', marginTop: 4, fontWeight: 600 }}>
              Ready for approval dispatch
            </div>
          </div>
        </div>

        {/* Regulatory Note */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.22)',
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 12.5,
          color: '#cbd5e1',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <AlertCircle size={16} color="#f59e0b" style={{ flexShrink: 0 }} />
          <span>
            <strong style={{ color: '#fcd34d' }}>CERC Thermal Regulatory Truing:</strong> Final tariff orders determine approved capital expenditures, coal landed price reconciliations, auxiliary power consumption norms, and tax adjustments for retrospective recovery.
          </span>
        </div>

        {/* Thermal Beneficiaries Matrix */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
            Thermal Beneficiary Supplementary Arrear Apportionment (STPP Buxar 1,320 MW):
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 12,
          }}>
            {beneficiaries.map((b, idx) => (
              <div
                key={idx}
                style={{
                  background: 'rgba(15, 23, 42, 0.65)',
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>{b.name}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', fontFamily: 'monospace', marginTop: 2 }}>
                    +{fmtCurrency(b.net_delta)}
                  </div>
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: '#fbbf24',
                  background: 'rgba(245, 158, 11, 0.12)',
                  padding: '3px 8px',
                  borderRadius: 6,
                }}>
                  {b.share}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
