import React, { useState } from 'react';
import { fmtCurrency, fmtNumber } from './ui.jsx';

/**
 * HydroSecurityCoverageVault3D
 * 3D Payment Security Collateral Vault:
 * Monthly Billing Obligation -> Bank Guarantee & LC Vault -> 3-Tier CERC 105%/110% Coverage Gauge
 */

const SAMPLE_SECURITY_BENEFICIARIES = [
  {
    name: 'HPSEBL (Himachal)',
    avg_billing: 620670000,
    required_cover: 682737000, // 110%
    live_lc: 700000000,
    issuing_bank: 'State Bank of India (Shimla)',
    lc_no: 'LC-SBI-HP-8892',
    expires_in_days: 142,
    status: 'COVERED',
  },
  {
    name: 'UPPCL (Uttar Pradesh)',
    avg_billing: 242900000,
    required_cover: 267190000,
    live_lc: 280000000,
    issuing_bank: 'Punjab National Bank (Lucknow)',
    lc_no: 'LC-PNB-UP-4410',
    expires_in_days: 22, // Expiring soon warning!
    status: 'EXPIRING_SOON',
  },
  {
    name: 'JKPDD (Jammu & Kashmir)',
    avg_billing: 189750000,
    required_cover: 208725000,
    live_lc: 210000000,
    issuing_bank: 'J&K Bank (Srinagar)',
    lc_no: 'LC-JKB-0091',
    expires_in_days: 88,
    status: 'COVERED',
  },
  {
    name: 'PSPCL (Punjab)',
    avg_billing: 167050000,
    required_cover: 183755000,
    live_lc: 190000000,
    issuing_bank: 'Bank of Baroda (Patiala)',
    lc_no: 'LC-BOB-PB-7731',
    expires_in_days: 210,
    status: 'COVERED',
  },
  {
    name: 'Rajasthan Discoms',
    avg_billing: 177890000,
    required_cover: 195679000,
    live_lc: 160000000,
    issuing_bank: 'Canara Bank (Jaipur)',
    lc_no: 'LC-CAN-RJ-1190',
    expires_in_days: 64,
    status: 'SHORTFALL', // Shortfall!
  },
  {
    name: 'Delhi Discoms (BRPL/BYPL/TPDDL)',
    avg_billing: 156160000,
    required_cover: 171776000,
    live_lc: 180000000,
    issuing_bank: 'HDFC Bank (New Delhi)',
    lc_no: 'LC-HDFC-DL-5520',
    expires_in_days: 95,
    status: 'COVERED',
  },
];

const SAMPLE_THERMAL_SECURITY_BENEFICIARIES = [
  {
    name: 'NBPDCL (North Bihar)',
    avg_billing: 1450000000,
    required_cover: 1522500000, // 105%
    live_lc: 1600000000,
    issuing_bank: 'State Bank of India (Patna)',
    lc_no: 'LC-SBI-PAT-9012',
    expires_in_days: 120,
    status: 'COVERED',
  },
  {
    name: 'SBPDCL (South Bihar)',
    avg_billing: 1020000000,
    required_cover: 1071000000, // 105%
    live_lc: 1100000000,
    issuing_bank: 'Punjab National Bank (Patna)',
    lc_no: 'LC-PNB-PAT-4481',
    expires_in_days: 25, // Expiring soon
    status: 'EXPIRING_SOON',
  },
  {
    name: 'GRIDCO (Odisha)',
    avg_billing: 290000000,
    required_cover: 304500000,
    live_lc: 320000000,
    issuing_bank: 'UCO Bank (Bhubaneswar)',
    lc_no: 'LC-UCO-BBS-3312',
    expires_in_days: 180,
    status: 'COVERED',
  },
  {
    name: 'Unallocated Pool',
    avg_billing: 145000000,
    required_cover: 152250000,
    live_lc: 155000000,
    issuing_bank: 'Bank of India',
    lc_no: 'LC-BOI-DEL-1022',
    expires_in_days: 90,
    status: 'COVERED',
  },
];

export default function HydroSecurityCoverageVault3D({
  vertical = 'HYDRO',
  rows = null,
  instruments = null,
  coverPct = 105,
}) {
  const [selectedDiscom, setSelectedDiscom] = useState(null);

  const fallback = vertical === 'THERMAL' ? SAMPLE_THERMAL_SECURITY_BENEFICIARIES : SAMPLE_SECURITY_BENEFICIARIES;

  // If live rows passed, map them; otherwise use sample
  const discoms = (rows && rows.length > 0)
    ? rows.map((r, idx) => {
        const matchingInst = (instruments || []).find((i) => i.beneficiary_name === r.beneficiary_name);
        return {
          name: r.beneficiary_name,
          avg_billing: r.average_monthly_billing || 0,
          required_cover: r.required || 0,
          live_lc: r.live_cover || 0,
          issuing_bank: matchingInst?.issuing_bank || 'Nationalized Bank',
          lc_no: matchingInst?.instrument_no || `LC-${idx + 100}`,
          expires_in_days: matchingInst?.days_to_expiry ?? 90,
          status: (Number(r.shortfall) > 0 || r.status === 'SHORT' || r.status === 'NONE')
            ? 'SHORTFALL'
            : (matchingInst?.expiring_soon || (matchingInst?.days_to_expiry != null && matchingInst.days_to_expiry <= 30) || (r.expiring_soon && r.expiring_soon.length > 0))
              ? 'EXPIRING_SOON'
              : 'COVERED',
        };
      })
    : fallback;

  const totalRequired = discoms.reduce((sum, d) => sum + d.required_cover, 0);
  const totalLiveCover = discoms.reduce((sum, d) => sum + d.live_lc, 0);
  const totalShortfall = discoms.reduce((sum, d) => sum + Math.max(0, d.required_cover - d.live_lc), 0);
  const totalExpiringSoon = discoms.filter((d) => d.status === 'EXPIRING_SOON' || (d.expires_in_days != null && d.expires_in_days <= 30)).length;

  const overallCoverageRatio = totalRequired > 0 ? (totalLiveCover / totalRequired) * 100 : 100;

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 25%, #0d1b1e 0%, #04090b 100%)',
      borderRadius: 14,
      border: '1px solid #134e4a',
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
            background: 'linear-gradient(135deg, #0d9488, #059669)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(13, 148, 136, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                {vertical === 'THERMAL' ? 'Thermal Payment Security & LC Coverage Vault' : 'Hydro Payment Security & LC Coverage Vault'}
              </span>
              <span style={{
                background: 'rgba(13, 148, 136, 0.2)',
                color: '#2dd4bf',
                border: '1px solid rgba(13, 148, 136, 0.4)',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                CERC {coverPct}% MANDATORY COLLATERAL
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              {vertical === 'THERMAL'
                ? 'Thermal Monthly Billing Obligation &rarr; Nationalized Bank LC Vault &rarr; 3-Tier Default & Power Regulation Risk Monitor'
                : 'Monthly Billing Obligation &rarr; Nationalized Bank LC Vault &rarr; 3-Tier Default & Power Regulation Risk Monitor'}
            </div>
          </div>
        </div>

        {/* Global Cover Ratio Badge */}
        <div style={{
          background: overallCoverageRatio >= 100 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          border: `1px solid ${overallCoverageRatio >= 100 ? '#22c55e' : '#ef4444'}`,
          borderRadius: 8,
          padding: '6px 14px',
          textAlign: 'right',
        }}>
          <div style={{ fontSize: 11.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Portfolio Live Cover
          </div>
          <div style={{
            fontSize: 18,
            fontWeight: 800,
            color: overallCoverageRatio >= 100 ? '#4ade80' : '#f87171',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {overallCoverageRatio.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 3 Vault Metrics Pillars */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 14,
        marginTop: 18,
        position: 'relative',
        zIndex: 2,
      }}>
        <div style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 10,
          padding: '12px 14px',
        }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Total Required Collateral</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc', marginTop: 2 }}>
            {fmtCurrency(totalRequired)}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Based on {coverPct}% monthly billing</div>
        </div>

        <div style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 10,
          padding: '12px 14px',
        }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Live LC Vault Strength</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#2dd4bf', marginTop: 2 }}>
            {fmtCurrency(totalLiveCover)}
          </div>
          <div style={{ fontSize: 12, color: '#4ade80', marginTop: 2 }}>Held across nationalized banks</div>
        </div>

        <div style={{
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 10,
          padding: '12px 14px',
        }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Portfolio Shortfall</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: totalShortfall > 0 ? '#f87171' : '#4ade80', marginTop: 2 }}>
            {totalShortfall > 0 ? fmtCurrency(totalShortfall) : 'NIL (Fully Secured)'}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {totalExpiringSoon > 0 ? `${totalExpiringSoon} LC expiring within 30 days` : 'All LCs healthy'}
          </div>
        </div>
      </div>

      {/* Beneficiary Security Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 14,
        marginTop: 18,
        position: 'relative',
        zIndex: 2,
      }}>
        {discoms.map((d) => {
          const isSelected = selectedDiscom?.name === d.name;
          const ratio = d.required_cover > 0 ? (d.live_lc / d.required_cover) * 100 : 100;
          const isWarning = d.status === 'SHORTFALL' || ratio < 100;
          const isExpiring = d.expires_in_days <= 30;

          return (
            <div
              key={d.name}
              onClick={() => setSelectedDiscom(isSelected ? null : d)}
              style={{
                background: isSelected
                  ? 'linear-gradient(180deg, rgba(19, 78, 74, 0.4) 0%, rgba(15, 23, 42, 0.95) 100%)'
                  : 'linear-gradient(180deg, rgba(15, 23, 42, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                border: `1.5px solid ${isSelected ? '#2dd4bf' : isWarning ? 'rgba(239, 68, 68, 0.4)' : isExpiring ? 'rgba(234, 179, 8, 0.4)' : 'rgba(20, 184, 166, 0.25)'}`,
                borderRadius: 10,
                padding: '14px 16px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                    {d.name}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {d.issuing_bank}
                  </div>
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 6,
                  background: isWarning ? 'rgba(239, 68, 68, 0.2)' : isExpiring ? 'rgba(234, 179, 8, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                  color: isWarning ? '#f87171' : isExpiring ? '#facc15' : '#4ade80',
                }}>
                  {ratio.toFixed(0)}% Cover
                </span>
              </div>

              {/* LC Card Details */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '8px 10px',
                borderRadius: 6,
                marginTop: 8,
                fontSize: 12.5,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: '#94a3b8' }}>Required ({coverPct}%):</span>
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>{fmtCurrency(d.required_cover)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: '#94a3b8' }}>Live LC Vault:</span>
                  <span style={{ color: '#2dd4bf', fontWeight: 700 }}>{fmtCurrency(d.live_lc)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>LC Expiry:</span>
                  <span style={{ color: isExpiring ? '#f87171' : '#cbd5e1', fontWeight: 600 }}>
                    {d.expires_in_days} days left {isExpiring ? '(Renew Warning)' : ''}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
                <span style={{ color: '#64748b' }}>{d.lc_no}</span>
                <span style={{ color: isWarning ? '#f87171' : '#2dd4bf', fontWeight: 600 }}>
                  {isWarning ? 'SHORTFALL' : isExpiring ? 'EXPIRING SOON' : 'VALID & ACTIVE'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Bar when selected */}
      {selectedDiscom && (
        <div style={{
          marginTop: 16,
          background: 'rgba(19, 78, 74, 0.3)',
          border: '1px solid rgba(45, 212, 191, 0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: 13,
          color: '#cbd5e1',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          position: 'relative',
          zIndex: 2,
        }}>
          <div>
            <strong style={{ color: '#2dd4bf' }}>Payment Security Protocol:</strong> If overdue bills exceed 45 days, SJVN Commercial Department is empowered under CERC Regulations to invoke {selectedDiscom.lc_no} up to {fmtCurrency(selectedDiscom.live_lc)} for immediate debt realization.
          </div>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() => setSelectedDiscom(null)}
            style={{ color: '#ffffff' }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
