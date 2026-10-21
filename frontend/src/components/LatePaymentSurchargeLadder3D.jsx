import React, { useState } from 'react';
import { fmtCurrency, fmtNumber } from './ui.jsx';

/**
 * LatePaymentSurchargeLadder3D
 * 3D Statutory Payment Timeline & LPS Escalation Ladder:
 * Tier 1 (Day 1-30: 1.5% Rebate) ➔ Tier 2 (Day 31-45: Net Due Date) ➔ Tier 3 (Day 45+: LPS Trigger) ➔ Tier 4 (Day 75+: Power Regulation / LC Encashment)
 */

const LADDER_TIERS = [
  {
    tier: 1,
    name: 'TIER 1: PROMPT REBATE',
    days: 'Day 1 to 30',
    title: 'Early-Payment Rebate Window',
    rule: '1.5% Rebate within 5 days / 1.0% within 30 days',
    tone: 'safe',
    color: '#4ade80',
    accent: 'rgba(74, 222, 128, 0.2)',
    status: 'EARN REBATE',
  },
  {
    tier: 2,
    name: 'TIER 2: NET DUE DATE',
    days: 'Day 31 to 45',
    title: 'Grace Maturity Window',
    rule: 'Par value billing — 0% rebate, 0% penalty',
    tone: 'neutral',
    color: '#38bdf8',
    accent: 'rgba(56, 189, 248, 0.2)',
    status: 'PAR VALUE',
  },
  {
    tier: 3,
    name: 'TIER 3: LPS TRIGGER',
    days: 'Day 46 to 75',
    title: 'Late Payment Surcharge Accrual',
    rule: 'SBI MCLR + 350 bps (+0.5% per month escalation)',
    tone: 'warning',
    color: '#fbbf24',
    accent: 'rgba(251, 191, 36, 0.2)',
    status: 'LPS ACCRUING',
  },
  {
    tier: 4,
    name: 'TIER 4: REGULATION & LC',
    days: 'Day 75+',
    title: 'Default & Power Regulation',
    rule: 'Grid de-scheduling, exchange power diversion & LC encashment',
    tone: 'danger',
    color: '#f87171',
    accent: 'rgba(248, 113, 113, 0.2)',
    status: 'REGULATION ALARM',
  },
];

export default function LatePaymentSurchargeLadder3D({
  stationId = null,
  stationName = 'Nathpa Jhakri HPS / Buxar STPP',
  beneficiary = null,
  account = null,
  invoiceAmount = 1000000000, // ₹100 Cr sample default
}) {
  const [activeDay, setActiveDay] = useState(15); // Default day 15 (Rebate zone)
  const [activeTierIdx, setActiveTierIdx] = useState(null);

  // If live account passed, use outstanding
  const principal = Number(account?.balance_outstanding || invoiceAmount);

  // Calculations based on activeDay per MoP LPS Rules 2022
  let rebatePct = 0;
  let lpsAnnualRatePct = 0;
  let surchargeAmount = 0;
  let currentTier = 1;

  if (activeDay <= 30) {
    currentTier = 1;
    rebatePct = activeDay <= 5 ? 1.5 : 1.0;
  } else if (activeDay <= 45) {
    currentTier = 2;
    rebatePct = 0;
  } else if (activeDay <= 75) {
    currentTier = 3;
    // Base rate: 12.0% p.a.
    lpsAnnualRatePct = 12.0;
    const overdueDays = activeDay - 45;
    surchargeAmount = Math.round(principal * (lpsAnnualRatePct / 100) * (overdueDays / 365));
  } else {
    currentTier = 4;
    // Escalated rate: 12.0% + 0.5% = 12.5% up to 15.0%
    const monthsOverdue = Math.floor((activeDay - 45) / 30);
    lpsAnnualRatePct = Math.min(15.0, 12.0 + (monthsOverdue * 0.5));
    const overdueDays = activeDay - 45;
    surchargeAmount = Math.round(principal * (lpsAnnualRatePct / 100) * (overdueDays / 365));
  }

  const rebateAmount = Math.round(principal * (rebatePct / 100));
  const netPayable = principal - rebateAmount + surchargeAmount;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 20%, #1e1124 0%, #08030b 100%)',
      borderRadius: 14,
      border: '1px solid #581c87',
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
          linear-gradient(rgba(192, 132, 252, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(192, 132, 252, 0.03) 1px, transparent 1px)
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
            background: 'linear-gradient(135deg, #7e22ce, #9333ea)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(147, 51, 234, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Late Payment Surcharge (LPS) & Escalation Ladder
              </span>
              <span style={{
                background: 'rgba(147, 51, 234, 0.2)',
                color: '#c084fc',
                border: '1px solid rgba(147, 51, 234, 0.4)',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                MoP LPS RULES 2022
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              {beneficiary ? `${beneficiary} — ` : ''}Prompt Rebate Window (1-30d) ➔ Due Date Grace (45d) ➔ LPS Trigger (MCLR+350bps) ➔ Grid Power Regulation (75d+)
            </div>
          </div>
        </div>

        {/* Day Quick Presets */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { day: 5, label: 'Day 5 (1.5% Rebate)' },
            { day: 25, label: 'Day 25 (1.0% Rebate)' },
            { day: 40, label: 'Day 40 (Net Due)' },
            { day: 60, label: 'Day 60 (LPS Accrual)' },
            { day: 80, label: 'Day 80 (Power Regulation)' },
          ].map((btn) => (
            <button
              key={btn.day}
              type="button"
              className={`btn btn-xs ${activeDay === btn.day ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                background: activeDay === btn.day ? 'rgba(147, 51, 234, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                borderColor: activeDay === btn.day ? '#a855f7' : 'rgba(255, 255, 255, 0.1)',
                color: activeDay === btn.day ? '#f3e8ff' : '#94a3b8',
              }}
              onClick={() => setActiveDay(btn.day)}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4-Tier Interactive 3D Ladder */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
        gap: 16,
        marginTop: 20,
        position: 'relative',
        zIndex: 2,
      }}>
        {LADDER_TIERS.map((tier) => {
          const isCurrentActive = currentTier === tier.tier;
          const isInspected = activeTierIdx === tier.tier;

          return (
            <div
              key={tier.tier}
              onClick={() => setActiveTierIdx(isInspected ? null : tier.tier)}
              style={{
                background: isCurrentActive
                  ? `linear-gradient(180deg, ${tier.accent} 0%, rgba(18, 9, 24, 0.95) 100%)`
                  : 'linear-gradient(180deg, rgba(24, 15, 33, 0.7) 0%, rgba(13, 7, 18, 0.95) 100%)',
                border: `1.5px solid ${isCurrentActive ? tier.color : isInspected ? '#c084fc' : 'rgba(255, 255, 255, 0.1)'}`,
                borderRadius: 12,
                padding: '16px 18px',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                boxShadow: isCurrentActive ? `0 0 20px ${tier.color}35` : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: tier.color, letterSpacing: '0.04em' }}>
                  {tier.name}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: isCurrentActive ? `${tier.color}30` : 'rgba(255, 255, 255, 0.05)',
                  color: isCurrentActive ? tier.color : '#94a3b8',
                }}>
                  {tier.days}
                </span>
              </div>

              <div style={{ fontSize: 15, fontWeight: 700, color: '#ffffff' }}>
                {tier.title}
              </div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
                {tier.rule}
              </div>

              <div style={{ marginTop: 14, background: 'rgba(0,0,0,0.35)', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Status at Day {activeDay}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: isCurrentActive ? tier.color: 'var(--slate-500)', marginTop: 2 }}>
                  {isCurrentActive ? tier.status : 'INACTIVE'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Financial Impact Console */}
      <div style={{
        marginTop: 20,
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 10,
        padding: '16px 20px',
        position: 'relative',
        zIndex: 2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Invoice Principal Sum</div>
          <div style={{ fontSize: 19, fontWeight: 700, color: '#f8fafc' }}>
            {fmtCurrency(principal)}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Settlement At Day {activeDay}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: currentTier === 1 ? '#4ade80' : currentTier === 2 ? '#38bdf8' : '#f87171' }}>
            {currentTier === 1 ? `Rebate Earned: -${fmtCurrency(rebateAmount)} (${rebatePct}%)` : currentTier === 2 ? 'Par Value (No Rebate / No Surcharge)' : `LPS Surcharge: +${fmtCurrency(surchargeAmount)} (${lpsAnnualRatePct}% p.a.)`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Net Payable Amount</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: currentTier === 1 ? '#4ade80' : currentTier === 2 ? '#f8fafc' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>
            {fmtCurrency(netPayable)}
          </div>
        </div>
      </div>

      {/* Explanatory Regulatory Drawer */}
      {activeTierIdx && (
        <div style={{
          marginTop: 16,
          background: 'rgba(13, 7, 18, 0.95)',
          border: '1px solid rgba(147, 51, 234, 0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 13,
          color: '#cbd5e1',
          lineHeight: 1.5,
          position: 'relative',
          zIndex: 2,
        }}>
          {activeTierIdx === 1 && (
            <div>
              <strong style={{ color: '#4ade80' }}>MoP Prompt Payment Rebate:</strong> Under MoP Electricity (Late Payment Surcharge and Related Matters) Rules 2022, if a distribution licensee pays a bill within 5 days of presentation, it receives a rebate of 1.5%. If paid beyond 5 days but within 30 days, a rebate of 1.0% is credited.
            </div>
          )}
          {activeTierIdx === 2 && (
            <div>
              <strong style={{ color: '#38bdf8' }}>Grace & Net Due Date:</strong> Payment made between 31 to 45 days is accepted at par value without any rebate deduction or penal surcharge. Day 45 represents the statutory maturity date.
            </div>
          )}
          {activeTierIdx === 3 && (
            <div>
              <strong style={{ color: '#fbbf24' }}>LPS Base Accrual:</strong> If payment is delayed beyond 45 days, Late Payment Surcharge is payable on the outstanding amount for the period of delay at the base rate of SBI 1-Year Marginal Cost of Funds Based Lending Rate (MCLR) + 350 basis points. Rate escalates by 0.5% for each successive month of default, capped at base rate + 300 bps.
            </div>
          )}
          {activeTierIdx === 4 && (
            <div>
              <strong style={{ color: '#f87171' }}>Regulation 6 Power De-Scheduling Trigger:</strong> If default continues past 75 days, the generating company (SJVN) informs National / Regional Load Despatch Centre (NLDC/RLDC). Power supply is regulated and diverted to the Power Exchange (TAM/DAM/RTM) to recover fuel costs, while Letter of Credit (LC) is invoked.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
