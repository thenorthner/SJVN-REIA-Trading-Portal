import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * HydroAdjustmentCorridor3D
 * 3D True-up & Retroactive Tariff Revision Conduit:
 * Original Billed Baseline ➔ CERC Regulatory Delta ➔ Carrying Cost / Interest Corridor ➔ Beneficiary Net Adjustment
 */

const SAMPLE_TRUEUP_CASES = [
  {
    id: 'CASE-CERC-2026',
    petition_no: 'CERC Petition No. 12/GT/2026',
    station_name: 'Nathpa Jhakri HEP (1,500 MW)',
    period_span: 'FY 2024-25 to FY 2025-26',
    baseline_billed: 18450000000, // ₹1,845 Cr
    capital_addition: 420000000,   // ₹42 Cr
    roe_rate_delta: 0.5,           // +0.5% RoE
    ferv_gain_loss: -18000000,     // -₹1.8 Cr FERV
    om_escalation: 85000000,       // ₹8.5 Cr O&M
    net_differential: 487000000,   // ₹48.7 Cr
    carrying_cost_rate: 10.75,     // MCLR + 350 bps
    carrying_cost_amount: 32800000,// ₹3.28 Cr interest
    total_adjustment: 519800000,   // ₹51.98 Cr
    beneficiaries: [
      { name: 'HPSEBL (HP)', share: 37.64, net_delta: 195652720 },
      { name: 'UPPCL (UP)', share: 14.73, net_delta: 76566540 },
      { name: 'JKPDD (J&K)', share: 11.51, net_delta: 59828980 },
      { name: 'Rajasthan Discoms', share: 10.79, net_delta: 56086420 },
      { name: 'PSPCL (Punjab)', share: 10.13, net_delta: 52655740 },
      { name: 'Delhi Discoms', share: 9.47, net_delta: 49225060 },
      { name: 'Haryana Discoms', share: 4.27, net_delta: 22195460 },
      { name: 'Chandigarh ED', share: 1.28, net_delta: 6653440 },
    ],
  },
];

export default function HydroAdjustmentCorridor3D({
  stationId,
  bills = [],
  preview = null,
  arrearForm = null,
}) {
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0);
  const [activeStep, setActiveStep] = useState(null);

  const fallback = SAMPLE_TRUEUP_CASES[selectedCaseIdx] || SAMPLE_TRUEUP_CASES[0];
  const currentCase = fallback;

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

  const existingBillsCount = bills.length;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #16112a 0%, #080512 100%)',
      borderRadius: 14,
      border: '1px solid #2e1065',
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
          linear-gradient(rgba(192, 132, 252, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(192, 132, 252, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '28px 28px',
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
            background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(124, 58, 237, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Hydro True-Up & Supplementary Adjustment Corridor
              </span>
              <span style={{
                background: 'rgba(124, 58, 237, 0.2)',
                color: '#c084fc',
                border: '1px solid rgba(124, 58, 237, 0.4)',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                CERC TRUE-UP ORDER
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              Original Billed Baseline ➔ Capital True-up / FERV Delta ➔ Carrying Cost Corridor ➔ Multi-Discom Net Settlement
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Order Reference</div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#c084fc', maxWidth: 260, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {orderRef}
          </div>
        </div>
      </div>

      {/* 4-Stage Adjustment Flow */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Stage 1: Baseline Billed */}
        <div
          onClick={() => setActiveStep(activeStep === 1 ? null : 1)}
          style={{
            background: 'linear-gradient(180deg, rgba(24, 18, 43, 0.8) 0%, rgba(15, 11, 28, 0.95) 100%)',
            border: `1.5px solid ${activeStep === 1 ? '#a855f7' : 'rgba(168, 85, 247, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#c084fc' }}>STAGE 1: BASELINE</span>
            <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>Original</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Provisional Billing</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>Period: {periodSpan}</div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Billed AFC Aggregate</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#f8fafc' }}>
              {fmtCurrency(currentCase.baseline_billed)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 2 }}>Provisional REA invoices</div>
          </div>
        </div>

        {/* Stage 2: CERC Parameter Delta */}
        <div
          onClick={() => setActiveStep(activeStep === 2 ? null : 2)}
          style={{
            background: 'linear-gradient(180deg, rgba(24, 18, 43, 0.8) 0%, rgba(15, 11, 28, 0.95) 100%)',
            border: `1.5px solid ${activeStep === 2 ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8' }}>STAGE 2: CERC DELTA</span>
            <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>Approved Order</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Tariff True-Up Order</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>Cap Cost & RoE Restatement</div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#94a3b8' }}>Capital Additions:</span>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>+{fmtCurrency(currentCase.capital_addition)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#94a3b8' }}>FERV Impact:</span>
              <span style={{ color: '#f87171', fontWeight: 600 }}>{fmtCurrency(currentCase.ferv_gain_loss)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>O&M Indexation:</span>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>+{fmtCurrency(currentCase.om_escalation)}</span>
            </div>
          </div>
        </div>

        {/* Stage 3: Carrying Cost Corridor */}
        <div
          onClick={() => setActiveStep(activeStep === 3 ? null : 3)}
          style={{
            background: 'linear-gradient(180deg, rgba(24, 18, 43, 0.8) 0%, rgba(15, 11, 28, 0.95) 100%)',
            border: `1.5px solid ${activeStep === 3 ? '#f59e0b' : 'rgba(245, 158, 11, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>STAGE 3: CARRYING COST</span>
            <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>MCLR + 350 bps</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Interest Compounding</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>Rate: {currentCase.carrying_cost_rate}% p.a.</div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Carrying Interest Claim</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#fbbf24' }}>
              +{fmtCurrency(currentCase.carrying_cost_amount)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--slate-500)', marginTop: 2 }}>CERC Reg 10(7) compliant</div>
          </div>
        </div>

        {/* Stage 4: Net Settlement */}
        <div
          onClick={() => setActiveStep(activeStep === 4 ? null : 4)}
          style={{
            background: 'linear-gradient(180deg, rgba(24, 18, 43, 0.8) 0%, rgba(15, 11, 28, 0.95) 100%)',
            border: `1.5px solid ${activeStep === 4 ? '#22c55e' : 'rgba(34, 197, 94, 0.3)'}`,
            borderRadius: 12,
            padding: '16px 18px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80' }}>STAGE 4: ARREAR BILL</span>
            <span style={{ fontSize: 12, color: 'var(--slate-500)' }}>Recovery</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>Net Supplementary Bill</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>Across {beneficiaries.length} Beneficiaries</div>

          <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Total Arrear Payable</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#4ade80' }}>
              {fmtCurrency(totalAdjustment)}
            </div>
            <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 2 }}>Ready for approval dispatch</div>
          </div>
        </div>
      </div>

      {/* Explanatory Box on Click */}
      {activeStep && (
        <div style={{
          marginTop: 16,
          background: 'rgba(24, 18, 43, 0.95)',
          border: '1px solid rgba(168, 85, 247, 0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 13,
          color: '#cbd5e1',
          position: 'relative',
          zIndex: 2,
        }}>
          {activeStep === 1 && (
            <div>
              <strong style={{ color: '#c084fc' }}>Provisional Billed Anchor:</strong> The monthly invoices previously settled on provisional REAs and pre-trued tariffs serve as the baseline audit trail.
            </div>
          )}
          {activeStep === 2 && (
            <div>
              <strong style={{ color: '#38bdf8' }}>CERC Regulatory Truing:</strong> Final tariff orders determine approved capital expenditures, foreign exchange variation (FERV), and tax rate reconciliations for retrospective adjustment.
            </div>
          )}
          {activeStep === 3 && (
            <div>
              <strong style={{ color: '#fbbf24' }}>Carrying Cost Compounding:</strong> Per CERC Tariff Regulations, utilities are entitled to carrying cost on under-recovered capital costs calculated at SBI 1-Year MCLR + 350 basis points.
            </div>
          )}
          {activeStep === 4 && (
            <div>
              <strong style={{ color: '#4ade80' }}>Supplementary Allocation:</strong> The net arrear amount is shared proportionately based on each beneficiary&apos;s allocated energy over the trued-up financial months.
            </div>
          )}
        </div>
      )}

      {/* Beneficiary Arrear Breakdown Strip */}
      <div style={{
        marginTop: 18,
        paddingTop: 14,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        position: 'relative',
        zIndex: 2,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 10 }}>
          Beneficiary Supplementary Arrear Apportionment:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {beneficiaries.map((b) => (
            <div
              key={b.name}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 12.5,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#f8fafc', fontWeight: 600 }}>
                <span>{b.name}</span>
                <span style={{ color: '#c084fc' }}>{b.share}%</span>
              </div>
              <div style={{ color: '#4ade80', fontWeight: 700, marginTop: 3 }}>
                +{fmtCurrency(b.net_delta)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
