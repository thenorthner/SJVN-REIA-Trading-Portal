import React, { useState } from 'react';
import { fmtNumber, fmtCurrency } from './ui.jsx';

/**
 * HydroBeneficiaryWaterfall3D
 * 3D Regional Allocation & Delivery Waterfall:
 * SJVN Generation Hub ➔ NRPC Regional Energy Account Entitlements ➔ Multi-DISCOM Billing Stream
 */

const DEFAULT_BENEFICIARIES = [
  { name: 'HPSEBL', state: 'Himachal Pradesh', share_pct: 37.638359, allocated_mwh: 106037.4, cap_charge: 445710000, energy_charge: 174961710, bill_status: 'ISSUED', bill_no: 'SJVN/NJHPS/HP/2026/09' },
  { name: 'UPPCL', state: 'Uttar Pradesh', share_pct: 14.730000, allocated_mwh: 41497.1, cap_charge: 174432600, energy_charge: 68470215, bill_status: 'APPROVED', bill_no: 'SJVN/NJHPS/UP/2026/09' },
  { name: 'JKPDD', state: 'Jammu & Kashmir', share_pct: 11.506528, allocated_mwh: 32418.1, cap_charge: 136260200, energy_charge: 53489865, bill_status: 'ISSUED', bill_no: 'SJVN/NJHPS/JK/2026/09' },
  { name: 'Rajasthan Discoms', state: 'Rajasthan', share_pct: 10.787604, allocated_mwh: 30393.3, cap_charge: 127746800, energy_charge: 50148945, bill_status: 'IN_APPROVAL', bill_no: 'SJVN/NJHPS/RJ/2026/09' },
  { name: 'PSPCL', state: 'Punjab', share_pct: 10.130000, allocated_mwh: 28540.3, cap_charge: 119961400, energy_charge: 47091495, bill_status: 'ISSUED', bill_no: 'SJVN/NJHPS/PB/2026/09' },
  { name: 'Delhi Discoms (BRPL/BYPL/TPDDL)', state: 'Delhi', share_pct: 9.470000, allocated_mwh: 26680.7, cap_charge: 112143700, energy_charge: 44023155, bill_status: 'APPROVED', bill_no: 'SJVN/NJHPS/DL/2026/09' },
  { name: 'Haryana (UHBVN/DHBVN)', state: 'Haryana', share_pct: 4.270000, allocated_mwh: 12029.3, cap_charge: 50565300, energy_charge: 19848345, bill_status: 'ISSUED', bill_no: 'SJVN/NJHPS/HR/2026/09' },
  { name: 'Chandigarh ED', state: 'Chandigarh', share_pct: 1.281088, allocated_mwh: 3609.3, cap_charge: 15170300, energy_charge: 5955345, bill_status: 'ISSUED', bill_no: 'SJVN/NJHPS/CH/2026/09' },
];

export default function HydroBeneficiaryWaterfall3D({
  lines = null,
  bill = null,
  stationName = 'Nathpa Jhakri HEP (1,500 MW)',
}) {
  const [selectedDiscom, setSelectedDiscom] = useState(null);
  const [filterRegion, setFilterRegion] = useState('ALL');

  // Convert live lines if provided, otherwise use standard NRPC beneficiaries
  const beneficiaries = (lines && lines.length > 0)
    ? lines.map((l, idx) => ({
        name: l.beneficiary_name,
        state: l.parent_state || l.beneficiary_name,
        share_pct: Number(l.pct_proportionate) || 0,
        allocated_mwh: Math.round(((Number(l.saleable_energy_kwh || l.actual_scheduled_energy_kwh) || 0) / 1000) * 10) / 10,
        cap_charge: Number(l.capacity_charge) || 0,
        energy_charge: Number(l.energy_charge_total || l.energy_charge) || 0,
        bill_status: l.status || 'APPROVED',
        bill_no: l.bill_no || `SJVN/LINE/${idx + 1}`,
      }))
    : DEFAULT_BENEFICIARIES;

  const totalSaleableMwh = beneficiaries.reduce((sum, b) => sum + b.allocated_mwh, 0);
  const totalBilledVal = beneficiaries.reduce((sum, b) => sum + b.cap_charge + b.energy_charge, 0);

  const filteredDiscoms = filterRegion === 'ALL'
    ? beneficiaries
    : beneficiaries.filter((b) => {
        const str = `${b.name} ${b.state}`.toLowerCase();
        const r = filterRegion.toLowerCase();
        if (r === 'himachal') return str.includes('himachal') || str.includes('hp') || str.includes('hpsebl');
        if (r === 'punjab') return str.includes('punjab') || str.includes('pb') || str.includes('pspcl');
        if (r === 'up') return str.includes('uttar') || str.includes('up') || str.includes('uppcl');
        if (r === 'delhi') return str.includes('delhi') || str.includes('brpl') || str.includes('bypl') || str.includes('tpddl') || str.includes('ndmc');
        if (r === 'rajasthan') return str.includes('raj') || str.includes('jvvnl') || str.includes('avvnl') || str.includes('jdvvnl');
        return str.includes(r);
      });

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 25%, #081120 0%, #030712 100%)',
      borderRadius: 14,
      border: '1px solid #1e293b',
      boxShadow: '0 12px 35px rgba(0,0,0,0.6)',
      padding: '22px 24px',
      marginBottom: 22,
      position: 'relative',
      overflow: 'hidden',
      color: '#f8fafc',
    }}>
      {/* Subtle Matrix Background */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(56, 189, 248, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(56, 189, 248, 0.03) 1px, transparent 1px)
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
            background: 'linear-gradient(135deg, #059669, #0284c7)',
            padding: '8px',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 15px rgba(5, 150, 105, 0.4)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
              <path d="M2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
              <path d="M7 21h10" /><path d="M12 3v18" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Hydro Beneficiary Allocation & Regional Wheeling Waterfall
              </span>
              <span style={{
                background: 'rgba(5, 150, 105, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(5, 150, 105, 0.4)',
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.04em',
              }}>
                NRPC TABLE D2 CERTIFIED
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              Central Station Busbar Injection → Northern Regional Grid Wheeling → 8 State Off-Take Settlement
            </div>
          </div>
        </div>

        {/* Aggregate Stats */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Total Allocated</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#38bdf8' }}>
              {fmtNumber(totalSaleableMwh, 1)} MWh
            </div>
          </div>
          <div style={{ height: 28, width: 1, background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Billed Value</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#34d399' }}>
              {fmtCurrency(totalBilledVal)}
            </div>
          </div>
        </div>
      </div>

      {/* Regional Stream Flow Overview */}
      <div style={{
        marginTop: 18,
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 10,
        padding: '12px 16px',
        position: 'relative',
        zIndex: 2,
        flexWrap: 'wrap',
        gap: 12,
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 700,
            background: 'rgba(56, 189, 248, 0.2)',
            color: '#38bdf8',
            padding: '3px 8px',
            borderRadius: 6,
          }}>
            ORIGIN
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>
            {stationName}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
          <span>Northern Regional Load Despatch Centre (NRLDC 400 kV Grid)</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
          </svg>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {['ALL', 'Himachal', 'Punjab', 'UP', 'Delhi', 'Rajasthan'].map((r) => (
            <button
              key={r}
              type="button"
              className={`btn btn-xs ${filterRegion === r ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12, padding: '2px 8px' }}
              onClick={() => setFilterRegion(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Beneficiary Live Off-Take Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 14,
        marginTop: 16,
        position: 'relative',
        zIndex: 2,
      }}>
        {filteredDiscoms.map((b) => {
          const isSelected = selectedDiscom?.name === b.name;
          const totalDiscomBilled = b.cap_charge + b.energy_charge;

          return (
            <div
              key={b.name}
              onClick={() => setSelectedDiscom(isSelected ? null : b)}
              style={{
                background: isSelected
                  ? 'linear-gradient(180deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)'
                  : 'linear-gradient(180deg, rgba(15, 23, 42, 0.7) 0%, rgba(15, 23, 42, 0.85) 100%)',
                border: `1.5px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: 10,
                padding: '14px 16px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: isSelected ? '0 4px 20px rgba(56, 189, 248, 0.18)' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: '#f8fafc' }}>
                    {b.name}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
                    {b.state}
                  </div>
                </div>
                <span style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  padding: '2px 7px',
                  borderRadius: 6,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {b.share_pct.toFixed(2)}%
                </span>
              </div>

              {/* Volume & Financial Breakdown */}
              <div style={{
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '8px 10px',
                borderRadius: 6,
                marginTop: 10,
                fontSize: 12.5,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#94a3b8' }}>Energy Off-Take:</span>
                  <span style={{ fontWeight: 600, color: '#f8fafc' }}>{fmtNumber(b.allocated_mwh, 1)} MWh</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#94a3b8' }}>Capacity Charge:</span>
                  <span style={{ fontWeight: 600, color: '#cbd5e1' }}>{fmtCurrency(b.cap_charge)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#94a3b8' }}>Energy Charge:</span>
                  <span style={{ fontWeight: 600, color: '#cbd5e1' }}>{fmtCurrency(b.energy_charge)}</span>
                </div>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 5, marginTop: 5, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>Total Billed:</span>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{fmtCurrency(totalDiscomBilled)}</span>
                </div>
              </div>

              {/* Status Footer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
                <span style={{ color: '#64748b' }}>{b.bill_no}</span>
                <span style={{
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 11.5,
                  background: b.bill_status === 'ISSUED' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                  color: b.bill_status === 'ISSUED' ? '#4ade80' : '#facc15',
                }}>
                  {b.bill_status}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Discom Detail Modal Bar */}
      {selectedDiscom && (
        <div style={{
          marginTop: 16,
          background: 'rgba(30, 41, 59, 0.95)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          position: 'relative',
          zIndex: 2,
        }}>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>
              Selected: {selectedDiscom.name} ({selectedDiscom.state})
            </span>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              Certified Proportion: <strong>{selectedDiscom.share_pct}%</strong> | Total Amount: <strong>{fmtCurrency(selectedDiscom.cap_charge + selectedDiscom.energy_charge)}</strong>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-xs"
            onClick={() => setSelectedDiscom(null)}
            style={{ color: '#ffffff' }}
          >
            Clear Selection
          </button>
        </div>
      )}
    </div>
  );
}
