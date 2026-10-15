import React, { useState } from 'react';
import { Badge, Table, fmtCurrency, fmtNumber } from './ui.jsx';

/**
 * Ultra 3D Power Routing & Carve-Out Matrix
 * Displays a PPA (e.g. 250 MW Mega Solar) splitting into glowing branching conduits:
 * ➔ 100 MW (40%) to Punjab (PSPCL)
 * ➔ 100 MW (40%) to Haryana (HPPC)
 * ➔ 50 MW (20%) to Delhi (NDMC)
 * Includes interactive hover highlights, inspector drawer, and live re-routing.
 */
export function PowerRoutingTree3D({
  contract,
  allocations = [],
  onAddAllocation,
  canMap = false,
}) {
  const [viewMode, setViewMode] = useState('3D'); // '3D' | 'TABLE'
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);

  const isPpa = contract?.contract_type === 'PPA';
  const totalCapacity = Number(contract?.capacity_mw) || 0;

  // Calculate allocated percent & capacity
  const totalAllocatedPercent = allocations.reduce((sum, a) => sum + (Number(a.allocation_percent) || 0), 0);
  const totalAllocatedMw = Math.round((totalCapacity * (totalAllocatedPercent / 100)) * 100) / 100;
  const unallocatedMw = Math.max(0, Math.round((totalCapacity - totalAllocatedMw) * 100) / 100);
  const unallocatedPercent = Math.max(0, 100 - totalAllocatedPercent);

  // Default base tariff
  const baseTariff = Number(contract?.tariff_per_unit) || 2.82;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Top Cybernetic Control Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#090e1a',
        padding: '12px 18px',
        borderRadius: '12px 12px 0 0',
        border: '1px solid #1e293b',
        borderBottom: 'none',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: 'linear-gradient(135deg, #10b981, #06b6d4)',
            padding: '6px 10px',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h4 style={{ margin: 0, color: '#f8fafc', fontSize: 14, fontWeight: 700 }}>
                {isPpa ? 'Power Routing & Carve-Out Matrix' : 'Supplying PPA Sources & Allocation Split'}
              </h4>
              <span style={{
                fontSize: 12.5,
                textTransform: 'uppercase',
                background: totalAllocatedPercent >= 100 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: totalAllocatedPercent >= 100 ? '#10b981' : '#f59e0b',
                border: totalAllocatedPercent >= 100 ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                padding: '2px 7px',
                borderRadius: 4,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>
                {totalAllocatedPercent >= 100 ? '100% Fully Subscribed' : `${totalAllocatedPercent}% Allocated (${unallocatedMw} MW Open)`}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>
              Contract: <strong style={{ color: '#38bdf8' }}>{contract?.contract_no}</strong> · Total Capacity: <strong style={{ color: '#10b981' }}>{fmtNumber(totalCapacity)} MW</strong>
            </div>
          </div>
        </div>

        {/* View Mode Toggle & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {canMap && onAddAllocation && (
            <button
              type="button"
              onClick={onAddAllocation}
              style={{
                background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                color: '#fff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: 6,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 0 10px rgba(37, 99, 235, 0.4)',
              }}
            >
              <span>+ Add / Adjust Allocation</span>
            </button>
          )}

          <div style={{
            display: 'flex',
            background: '#0f172a',
            padding: 3,
            borderRadius: 8,
            border: '1px solid #1e293b',
          }}>
            <button
              type="button"
              onClick={() => setViewMode('3D')}
              style={{
                background: viewMode === '3D' ? 'linear-gradient(135deg, #10b981, #059669)' : 'transparent',
                color: viewMode === '3D' ? '#fff' : '#94a3b8',
                border: 'none',
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.2s',
              }}
            >
              <span>Routing Tree</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('TABLE')}
              style={{
                background: viewMode === 'TABLE' ? 'linear-gradient(135deg, #334155, #1e293b)' : 'transparent',
                color: viewMode === 'TABLE' ? '#fff' : '#94a3b8',
                border: 'none',
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.2s',
              }}
            >
              <span>Table Matrix</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area: 3D Routing Tree or Table Matrix */}
      {viewMode === '3D' ? (
        <RoutingTreeCanvas
          contract={contract}
          allocations={allocations}
          totalCapacity={totalCapacity}
          totalAllocatedPercent={totalAllocatedPercent}
          totalAllocatedMw={totalAllocatedMw}
          unallocatedMw={unallocatedMw}
          unallocatedPercent={unallocatedPercent}
          baseTariff={baseTariff}
          hoveredIndex={hoveredIndex}
          setHoveredIndex={setHoveredIndex}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
        />
      ) : (
        <TableMatrixView
          isPpa={isPpa}
          allocations={allocations}
        />
      )}
    </div>
  );
}

/**
 * 3D Isometric Energy Routing Tree Canvas
 */
function RoutingTreeCanvas({
  contract,
  allocations,
  totalCapacity,
  totalAllocatedPercent,
  totalAllocatedMw,
  unallocatedMw,
  unallocatedPercent,
  baseTariff,
  hoveredIndex,
  setHoveredIndex,
  selectedIndex,
  setSelectedIndex,
}) {
  const isPpa = contract?.contract_type === 'PPA';
  const count = allocations.length;

  return (
    <div style={{
      background: 'radial-gradient(circle at 40% 30%, #0c1427 0%, #050811 100%)',
      border: '1px solid #1e293b',
      borderRadius: '0 0 12px 12px',
      padding: '24px 20px',
      position: 'relative',
      overflow: 'hidden',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Background Cyber Grid */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: `
          linear-gradient(rgba(16, 185, 129, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(16, 185, 129, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '32px 32px',
        pointerEvents: 'none',
      }} />

      {/* Ambient Central Glow */}
      <div style={{
        position: 'absolute',
        top: '30%',
        left: '45%',
        transform: 'translate(-50%, -50%)',
        width: '400px',
        height: '250px',
        background: 'radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0) 70%)',
        filter: 'blur(50px)',
        pointerEvents: 'none',
      }} />

      {/* Top Status Bar: Generation & Allocation Metrics */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'relative',
        zIndex: 2,
        marginBottom: 20,
        paddingBottom: 12,
        borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        fontSize: 13.5,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            <span style={{ color: '#94a3b8' }}>Total Generation Pool: <strong style={{ color: '#f8fafc' }}>{fmtNumber(totalCapacity)} MW</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }} />
            <span style={{ color: '#94a3b8' }}>Carved-Out Allocated: <strong style={{ color: '#38bdf8' }}>{fmtNumber(totalAllocatedMw)} MW ({totalAllocatedPercent}%)</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 13,
            color: unallocatedMw > 0 ? '#f59e0b' : '#10b981',
            background: unallocatedMw > 0 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
            border: unallocatedMw > 0 ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)',
            padding: '3px 8px',
            borderRadius: 100,
            fontWeight: 600,
          }}>
            {unallocatedMw > 0 ? `⚠ ${fmtNumber(unallocatedMw)} MW Available for Off-Take` : '✓ 100% Back-to-Back Subscribed'}
          </span>
        </div>
      </div>

      {/* 3D Isometric Routing Stage */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        perspective: '1200px',
        padding: '10px 0',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1fr) minmax(100px, 140px) minmax(200px, 1fr) minmax(100px, 140px) minmax(260px, 1.2fr)',
          alignItems: 'center',
          gap: 0,
        }}>
          {/* NODE 1: ROOT GENERATOR / PPA SOURCE */}
          <div style={{
            background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.1), rgba(15, 23, 42, 0.85))',
            border: '1.5px solid rgba(16, 185, 129, 0.35)',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            borderRadius: 14,
            padding: 16,
            transform: 'rotateY(6deg) translateZ(8px)',
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{
                fontSize: 12.5,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '2px 7px',
                borderRadius: 4,
              }}>
                1. Power Generator (IPP)
              </span>
              <span style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: '#10b981',
                background: 'rgba(16, 185, 129, 0.15)',
                padding: '1px 5px',
                borderRadius: 3,
              }}>
                GEN
              </span>
            </div>

            <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
              {contract?.seller_name || 'Power Producer (IPP)'}
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>
              {contract?.contract_no}
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.35)',
              borderRadius: 8,
              padding: '8px 10px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>
                <span>Installed Capacity</span>
                <strong style={{ color: '#10b981', fontSize: 13 }}>{fmtNumber(totalCapacity)} MW</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}>
                <span>Base PPA Tariff</span>
                <strong style={{ color: '#f8fafc' }}>₹{baseTariff.toFixed(2)} / unit</strong>
              </div>
            </div>

            <div style={{ fontSize: 12.5, color: '#64748b' }}>
              Project: <strong>{contract?.project_type || 'Solar'}</strong> · COD: <strong>{contract?.cod_date || 'Active'}</strong>
            </div>
          </div>

          {/* TRUNK CONDUIT: PPA ➔ SJVN ALLOCATOR */}
          <div style={{ position: 'relative', height: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <svg width="100%" height="80" viewBox="0 0 100 80" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="trunkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#0ea5e9" />
                </linearGradient>
              </defs>

              <path
                d="M 0 40 L 100 40"
                stroke="rgba(16, 185, 129, 0.25)"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d="M 0 40 L 100 40"
                stroke="url(#trunkGrad)"
                strokeWidth="4"
                strokeDasharray="6 8"
                style={{ animation: 'trunkFlow 1.6s linear infinite' }}
              />
            </svg>

            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#090e1a',
              border: '1px solid #1e293b',
              padding: '2px 6px',
              borderRadius: 6,
              fontSize: 12.5,
              color: '#38bdf8',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              textAlign: 'center',
            }}>
              <div>{fmtNumber(totalCapacity)} MW</div>
              <div style={{ color: '#10b981', fontSize: 12 }}>Total Trunk</div>
            </div>
          </div>

          {/* NODE 2: SJVN REIA ALLOCATION & CARVE-OUT HUB */}
          <div style={{
            background: 'linear-gradient(145deg, rgba(14, 165, 233, 0.14), rgba(15, 23, 42, 0.95))',
            border: '2px solid rgba(56, 189, 248, 0.45)',
            boxShadow: '0 0 25px rgba(14, 165, 233, 0.3), 0 15px 30px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
            borderRadius: 16,
            padding: 16,
            transform: 'translateZ(20px) scale(1.02)',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{
                fontSize: 12.5,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                fontWeight: 800,
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.2)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                padding: '2px 7px',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', animation: 'treePulse 1.5s infinite' }} />
                2. SJVN Allocator Hub
              </span>
              <span style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.15)',
                padding: '1px 5px',
                borderRadius: 3,
              }}>
                REIA
              </span>
            </div>

            <div style={{ fontSize: 14, fontWeight: 800, color: '#f8fafc', marginBottom: 2 }}>
              SJVN Limited (REIA)
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 10 }}>
              Carve-Out & Trading Margin Engine
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              borderRadius: 8,
              padding: '8px 10px',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#94a3b8', marginBottom: 3 }}>
                <span>Trading Margin</span>
                <strong style={{ color: '#38bdf8' }}>+₹0.07 / unit</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#94a3b8' }}>
                <span>Carve-Out Branches</span>
                <strong style={{ color: '#10b981' }}>{count} DISCOMs</strong>
              </div>
            </div>

            <div style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center' }}>
              Back-to-Back Pass-Through Routing
            </div>
          </div>

          {/* BRANCHING CONDUITS: SJVN HUB ➔ MULTIPLE DISCOMs */}
          <div style={{ position: 'relative', height: Math.max(180, count * 95), display: 'flex', alignItems: 'center' }}>
            <svg width="100%" height="100%" viewBox={`0 0 100 ${Math.max(180, count * 95)}`} preserveAspectRatio="none" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="branchGradTop" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#818cf8" />
                </linearGradient>
                <linearGradient id="branchGradMid" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
                <linearGradient id="branchGradBtm" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
                  <stop offset="0%" stopColor="#0ea5e9" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>

              {allocations.map((alloc, idx) => {
                const totalH = Math.max(180, count * 95);
                const startY = totalH / 2;
                const endY = count === 1 ? totalH / 2 : 35 + (idx * (totalH - 70) / (count - 1));
                const isHovered = hoveredIndex === idx;
                const gradId = idx === 0 ? 'branchGradTop' : idx === 1 ? 'branchGradMid' : 'branchGradBtm';
                const strokeColor = idx === 0 ? '#818cf8' : idx === 1 ? '#a855f7' : '#ec4899';

                // Avoid 0-height bounding box for center horizontal line
                const isFlat = Math.abs(startY - endY) < 1;
                const cpY1 = isFlat ? startY - 2.5 : startY;
                const cpY2 = isFlat ? endY + 2.5 : endY;
                const pathData = `M 0 ${startY} C 45 ${cpY1}, 55 ${cpY2}, 100 ${endY}`;

                return (
                  <g key={alloc.id || idx}>
                    {/* Shadow backdrop pipe */}
                    <path
                      d={pathData}
                      stroke={isHovered ? strokeColor : 'rgba(129, 140, 248, 0.2)'}
                      strokeWidth={isHovered ? 8 : 5}
                      fill="none"
                      strokeLinecap="round"
                    />
                    {/* Animated flow stream */}
                    <path
                      d={pathData}
                      stroke={`url(#${gradId})`}
                      strokeWidth={isHovered ? 4.5 : 3}
                      fill="none"
                      strokeDasharray="6 8"
                      strokeLinecap="round"
                      style={{ animation: 'trunkFlow 1.8s linear infinite' }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* NODE 3: BRANCHING OFF-TAKERS (DISCOM CARDS STACK) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {allocations.map((alloc, idx) => {
              const isHovered = hoveredIndex === idx;
              const isSelected = selectedIndex === idx;
              const allocatedShareMw = Math.round((totalCapacity * (Number(alloc.allocation_percent) / 100)) * 100) / 100;
              const psaTariff = Number(alloc.psa_tariff) || (baseTariff + 0.07);

              return (
                <div
                  key={alloc.id || idx}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => setSelectedIndex(isSelected ? null : idx)}
                  style={{
                    background: isHovered || isSelected
                      ? 'linear-gradient(145deg, rgba(129, 140, 248, 0.16), rgba(15, 23, 42, 0.95))'
                      : 'linear-gradient(145deg, rgba(129, 140, 248, 0.08), rgba(15, 23, 42, 0.85))',
                    border: isHovered || isSelected ? '1.5px solid #818cf8' : '1px solid rgba(129, 140, 248, 0.3)',
                    boxShadow: isHovered || isSelected
                      ? '0 0 20px rgba(129, 140, 248, 0.4), 0 10px 25px rgba(0, 0, 0, 0.7)'
                      : '0 8px 20px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    transform: isHovered || isSelected ? 'translateX(4px) scale(1.02)' : 'none',
                    transition: 'all 0.25s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 12.5,
                        fontWeight: 800,
                        color: '#818cf8',
                        background: 'rgba(129, 140, 248, 0.15)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}>
                        Branch {idx + 1}
                      </span>
                      <strong style={{ fontSize: 13, color: '#f8fafc' }}>
                        {alloc.buyer_name || `DISCOM ${idx + 1}`}
                      </strong>
                    </div>
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: '#818cf8',
                      background: 'rgba(129, 140, 248, 0.15)',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}>
                      DISCOM
                    </span>
                  </div>

                  <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 8 }}>
                    {alloc.psa_no || 'PSA Agreement'}
                  </div>

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(0, 0, 0, 0.3)',
                    padding: '6px 8px',
                    borderRadius: 6,
                    fontSize: 13,
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: 12.5 }}>Share: </span>
                      <strong style={{ color: '#38bdf8' }}>{alloc.allocation_percent}% ({fmtNumber(allocatedShareMw)} MW)</strong>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: 12.5 }}>Tariff: </span>
                      <strong style={{ color: '#10b981' }}>₹{psaTariff.toFixed(2)}</strong>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12.5,
                    color: '#64748b',
                    marginTop: 6,
                  }}>
                    <span>Effective: {alloc.effective_from} → {alloc.effective_to || 'Active'}</span>
                    <span style={{ color: '#818cf8', fontWeight: 600 }}>{isSelected ? '▲ Hide' : '▼ Details'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* INSPECTOR DRAWER: Triggered when user selects a branch */}
      {selectedIndex != null && allocations[selectedIndex] && (() => {
        const alloc = allocations[selectedIndex];
        const allocatedShareMw = Math.round((totalCapacity * (Number(alloc.allocation_percent) / 100)) * 100) / 100;
        const psaTariff = Number(alloc.psa_tariff) || (baseTariff + 0.07);
        const marginSpread = Math.max(0, Math.round((psaTariff - baseTariff) * 1000) / 1000);

        return (
          <div style={{
            marginTop: 16,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid #334155',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            animation: 'fadeIn 0.2s ease-out',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8' }} />
                <strong style={{ color: '#f8fafc', fontSize: 14 }}>
                  Carve-Out Deep Dive: {alloc.buyer_name || 'Buyer DISCOM'} ({alloc.allocation_percent}% Allocation)
                </strong>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIndex(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 13.5 }}>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>Allocated Capacity Share</div>
                <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 15, marginTop: 2 }}>
                  {fmtNumber(allocatedShareMw)} MW
                </div>
                <div style={{ color: '#64748b', fontSize: 12.5, marginTop: 2 }}>{alloc.allocation_percent}% of {fmtNumber(totalCapacity)} MW PPA Pool</div>
              </div>

              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>Off-Take Tariff & Spread</div>
                <div style={{ fontWeight: 700, color: '#10b981', fontSize: 15, marginTop: 2 }}>
                  ₹{psaTariff.toFixed(2)} / kWh
                </div>
                <div style={{ color: '#64748b', fontSize: 12.5, marginTop: 2 }}>
                  Base ₹{baseTariff.toFixed(2)} + Margin ₹{marginSpread.toFixed(3)}
                </div>
              </div>

              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>PSA Contract Number</div>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginTop: 2 }}>{alloc.psa_no || '—'}</div>
                <div style={{ color: '#64748b', fontSize: 12.5, marginTop: 2 }}>Effective: {alloc.effective_from} → {alloc.effective_to || 'Active'}</div>
              </div>

              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 13 }}>Trading Margin Yield (Est.)</div>
                <div style={{ fontWeight: 700, color: '#f59e0b', fontSize: 15, marginTop: 2 }}>
                  ₹{(allocatedShareMw * 1000 * 0.07 * 160).toLocaleString('en-IN', { maximumFractionDigits: 0 })} / mo
                </div>
                <div style={{ color: '#64748b', fontSize: 12.5, marginTop: 2 }}>Pass-through with zero balancing risk</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Embedded Animation Styles */}
      <style>{`
        @keyframes trunkFlow {
          0% { stroke-dashoffset: 28; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes treePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}

/**
 * Classic Table Matrix View Fallback
 */
function TableMatrixView({ isPpa, allocations }) {
  if (!allocations.length) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#64748b', background: '#fff', borderRadius: '0 0 12px 12px', border: '1px solid var(--slate-200)' }}>
        {isPpa ? 'No PSAs mapped to this PPA yet.' : 'No source PPA is linked to this PSA yet.'}
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1px solid var(--slate-200)', borderRadius: '0 0 12px 12px', padding: 16 }}>
      <Table
        columns={isPpa ? [
          { key: 'psa_no', header: 'PSA Number' },
          { key: 'buyer_name', header: 'DISCOM (Buyer)' },
          { key: 'allocation_percent', header: 'Allocation %', render: (r) => `${r.allocation_percent}%` },
          { key: 'capacity', header: 'Allocated MW', render: (r) => r.psa_capacity_mw ? `${fmtNumber(r.psa_capacity_mw)} MW` : '—' },
          { key: 'tariff', header: 'Tariff', render: (r) => r.psa_tariff ? `₹${r.psa_tariff}/unit` : '—' },
          { key: 'effective', header: 'Effective Dates', render: (r) => `${r.effective_from} to ${r.effective_to || 'Active'}` },
        ] : [
          { key: 'ppa_no', header: 'PPA Number' },
          { key: 'seller_name', header: 'Generator (Seller)' },
          { key: 'ppa_capacity_mw', header: 'PPA Capacity', render: (r) => `${fmtNumber(r.ppa_capacity_mw)} MW` },
          { key: 'allocation_percent', header: 'Share of that PPA', render: (r) => `${r.allocation_percent}%` },
          { key: 'effective', header: 'Effective Dates', render: (r) => `${r.effective_from} to ${r.effective_to || 'Active'}` },
        ]}
        rows={allocations}
      />
    </div>
  );
}
