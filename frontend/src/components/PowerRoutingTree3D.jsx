import React, { useState } from 'react';
import { Badge, Table, fmtCurrency, fmtNumber } from './ui.jsx';
import { reiaTerm } from '../reiaBeta.js';

/**
 * Ultra 3D Power Routing & Carve-Out Matrix
 * Displays a PPA (e.g. 250 MW Mega Solar) splitting into glowing branching conduits:
 * ➔ 100 MW (40%) to Punjab (PSPCL)
 * ➔ 100 MW (40%) to Haryana (HPPC)
 * ➔ 50 MW (20%) to Delhi (NDMC)
 * Includes interactive hover highlights, inspector drawer, and live re-routing.
 */
const round2 = (n) => Math.round(n * 100) / 100;

/** MW a share carries: a percentage of the PPA's capacity, whichever end it is read from. */
export function shareMwOf(alloc, isPpa, ownCapacity) {
  const ppaCapacity = isPpa ? ownCapacity : Number(alloc.ppa_capacity_mw) || 0;
  return round2(ppaCapacity * (Number(alloc.allocation_percent) || 0) / 100);
}

/** Selling price minus buying price, per unit, for one share. Null when either tariff is missing. */
export function spreadOf(alloc) {
  const psa = Number(alloc.psa_tariff);
  const ppa = Number(alloc.ppa_tariff);
  return Number.isFinite(psa) && Number.isFinite(ppa) && alloc.psa_tariff != null && alloc.ppa_tariff != null ? Math.round((psa - ppa) * 1000) / 1000 : null;
}

/**
 * Where a contract stands on its back-to-back cover, counting only shares still running.
 * A PPA is measured in % of itself; a PSA in MW received against the MW it contracts for —
 * adding up percentages of different PPAs, as this did, measures nothing.
 */
export function routingPosition(contract, allocations, today = new Date().toISOString().slice(0, 10)) {
  const isPpa = contract?.contract_type === 'PPA';
  const cap = Number(contract?.capacity_mw) || 0;
  // Shares in force on one day: today, or — when nothing has started yet — the
  // day the first one starts. Counting every share not yet ended added a
  // version's old split to the new one that replaces it.
  const notEnded = allocations.filter((a) => !a.effective_to || a.effective_to >= today);
  const firstStart = notEnded.map((a) => a.effective_from).filter(Boolean).sort()[0];
  const asOf = firstStart && firstStart > today ? firstStart : today;
  const live = notEnded.filter((a) => (!a.effective_from || a.effective_from <= asOf) && (!a.effective_to || a.effective_to >= asOf));
  const coveredMw = round2(live.reduce((s, a) => s + shareMwOf(a, isPpa, cap), 0));
  const coveredPct = isPpa
    ? round2(live.reduce((s, a) => s + (Number(a.allocation_percent) || 0), 0))
    : (cap ? round2(coveredMw / cap * 100) : 0);
  const openMw = round2(cap - coveredMw);
  const state = Math.abs(openMw) < 0.005 ? 'FULL' : openMw < 0 ? 'OVER' : 'OPEN';
  const label = isPpa
    ? (state === 'FULL' ? '100% allocated' : state === 'OVER' ? `Over-allocated: ${coveredPct}%` : `${coveredPct}% allocated · ${fmtNumber(openMw)} MW open`)
    : (state === 'FULL' ? `Fully supplied · ${fmtNumber(cap)} MW` : state === 'OVER' ? `Over-supplied by ${fmtNumber(-openMw)} MW` : `${fmtNumber(coveredMw)} of ${fmtNumber(cap)} MW supplied · ${fmtNumber(openMw)} MW short`);
  return { isPpa, live, asOf, coveredMw, coveredPct, openMw, state, label: asOf > today ? `${label} (from ${asOf})` : label };
}

const STATE_TONE = {
  FULL: { c: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', b: 'rgba(16, 185, 129, 0.3)' },
  OPEN: { c: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', b: 'rgba(245, 158, 11, 0.3)' },
  OVER: { c: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)', b: 'rgba(239, 68, 68, 0.4)' },
};

export function PowerRoutingTree3D({
  contract,
  allocations = [],
  onAddAllocation,
  onRemoveAllocation,
  canMap = false,
}) {
  const [viewMode, setViewMode] = useState('3D'); // '3D' | 'TABLE'
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(null);

  const isPpa = contract?.contract_type === 'PPA';
  const totalCapacity = Number(contract?.capacity_mw) || 0;

  const pos = routingPosition(contract, allocations);
  const totalAllocatedPercent = pos.coveredPct;
  const totalAllocatedMw = pos.coveredMw;
  const unallocatedMw = pos.openMw;
  const unallocatedPercent = Math.max(0, 100 - totalAllocatedPercent);
  const tone = STATE_TONE[pos.state];

  const baseTariff = Number(contract?.tariff_per_unit) || 0;

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
              <h4 style={{ margin: 0, color: '#f8fafc', fontSize: 15.5, fontWeight: 700 }}>
                {isPpa ? 'Power Routing & Carve-Out Matrix' : 'Supplying PPA Sources & Allocation Split'}
              </h4>
              <span style={{
                fontSize: 14,
                textTransform: 'uppercase',
                background: tone.bg,
                color: tone.c,
                border: `1px solid ${tone.b}`,
                padding: '2px 7px',
                borderRadius: 4,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>
                {pos.label}
              </span>
            </div>
            <div style={{ fontSize: 14.5, color: '#94a3b8', marginTop: 2 }}>
              Contract: <strong style={{ color: '#38bdf8' }}>{contract?.contract_no}</strong> · Total Capacity: <strong style={{ color: '#10b981' }}>{fmtNumber(totalCapacity)} MW</strong>
            </div>
          </div>
        </div>

        {/* View Mode Toggle & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

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
                fontSize: 14.5,
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
                fontSize: 14.5,
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
          pos={pos}
          unallocatedPercent={unallocatedPercent}
          baseTariff={baseTariff}
          hoveredIndex={hoveredIndex}
          setHoveredIndex={setHoveredIndex}
          selectedIndex={selectedIndex}
          setSelectedIndex={setSelectedIndex}
          canMap={canMap}
          onRemoveAllocation={onRemoveAllocation}
        />
      ) : (
        <TableMatrixView
          isPpa={isPpa}
          allocations={allocations}
          canMap={canMap}
          onRemoveAllocation={onRemoveAllocation}
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
  pos,
  baseTariff,
  hoveredIndex,
  setHoveredIndex,
  selectedIndex,
  setSelectedIndex,
  canMap,
  onRemoveAllocation,
}) {
  const isPpa = contract?.contract_type === 'PPA';
  const count = allocations.length;
  // Counterparties in force, each once: an ended row and the re-split that
  // replaced it are one PPA (or PSA), not two.
  const liveCounterparties = new Set(pos.live.map((a) => (isPpa ? a.psa_id : a.ppa_id))).size;
  // The margin actually earned: each live share's PSA tariff less its PPA tariff, weighted by MW.
  const weighted = pos.live.map((a) => [shareMwOf(a, isPpa, totalCapacity), spreadOf(a)]).filter(([, sp]) => sp != null);
  const weightMw = weighted.reduce((s, [mw]) => s + mw, 0);
  const avgSpread = weightMw ? Math.round(weighted.reduce((s, [mw, sp]) => s + mw * sp, 0) / weightMw * 1000) / 1000 : null;
  const tone = STATE_TONE[pos.state];
  // Power always reads left to right, generator → SJVN → DISCOM. A PSA's own
  // card is the DISCOM, so on a PSA the five columns are laid out in reverse.
  const at = (n) => (isPpa ? {} : { order: 6 - n });

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
        fontSize: 15,
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
            <span style={{ color: '#94a3b8' }}>{isPpa ? 'Total PPA Generation:' : 'Total PSA Off-Take Demand:'} <strong style={{ color: '#f8fafc' }}>{fmtNumber(totalCapacity)} MW</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }} />
            <span style={{ color: '#94a3b8' }}>{isPpa ? 'Carved-Out Allocated:' : 'Supplying PPAs Allocated:'} <strong style={{ color: '#38bdf8' }}>{fmtNumber(totalAllocatedMw)} MW ({totalAllocatedPercent}%)</strong></span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 14.5,
            color: tone.c,
            background: tone.bg,
            border: `1px solid ${tone.b}`,
            padding: '3px 8px',
            borderRadius: 100,
            fontWeight: 600,
          }}>
            {pos.state === 'FULL' ? `✓ ${isPpa ? 'Fully back-to-back' : 'Fully supplied'}` : pos.state === 'OVER' ? `⚠ ${pos.label}` : `⚠ ${fmtNumber(unallocatedMw)} MW ${isPpa ? 'not yet sold on' : 'not yet sourced'}`}
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
          gridTemplateColumns: isPpa
            ? 'minmax(220px, 1fr) minmax(100px, 140px) minmax(200px, 1fr) minmax(100px, 140px) minmax(260px, 1.2fr)'
            : 'minmax(260px, 1.2fr) minmax(100px, 140px) minmax(200px, 1fr) minmax(100px, 140px) minmax(220px, 1fr)',
          alignItems: 'center',
          gap: 0,
        }}>
          {/* NODE 1: ROOT GENERATOR / PPA SOURCE */}
          <div style={{
            ...at(1),
            background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.1), rgba(15, 23, 42, 0.85))',
            border: '1.5px solid rgba(16, 185, 129, 0.35)',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            borderRadius: 14,
            padding: 16,
            transform: `rotateY(${isPpa ? 6 : -6}deg) translateZ(8px)`,
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{
                fontSize: 14,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                color: isPpa ? '#10b981' : '#38bdf8',
                background: isPpa ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                padding: '2px 7px',
                borderRadius: 4,
              }}>
                {isPpa ? '1. Power Generator (IPP)' : '3. Buying Utility (State DISCOM)'}
              </span>
              <span style={{
                fontSize: 14,
                fontWeight: 700,
                color: isPpa ? '#10b981' : '#38bdf8',
                background: isPpa ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                padding: '1px 5px',
                borderRadius: 3,
              }}>
                {isPpa ? 'GEN' : 'BUYER'}
              </span>
            </div>

            <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
              {isPpa ? (contract?.seller_name || 'Power Producer (IPP)') : (contract?.buyer_name || 'State Buying Utility')}
            </div>
            <div style={{ fontSize: 14.5, color: '#94a3b8', marginBottom: 12 }}>
              {contract?.contract_no}
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.35)',
              borderRadius: 8,
              padding: '8px 10px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5, color: '#94a3b8', marginBottom: 4 }}>
                <span>{isPpa ? 'Contracted Capacity' : 'Contracted Demand'}</span>
                <strong style={{ color: '#10b981', fontSize: 14.5 }}>{fmtNumber(totalCapacity)} MW</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5, color: '#94a3b8' }}>
                <span>{isPpa ? 'Base PPA Tariff' : 'Off-Take PSA Tariff'}</span>
                <strong style={{ color: '#f8fafc' }}>₹{baseTariff.toFixed(2)} / unit</strong>
              </div>
            </div>

            <div style={{ fontSize: 14, color: 'var(--slate-500)' }}>
              Project: <strong>{contract?.project_type || 'Solar'}</strong> · {isPpa ? 'COD: ' : 'Tenure: '}<strong>{isPpa ? (contract?.cod_date || 'Not commissioned') : `${contract?.tenure_start || '—'} to ${contract?.tenure_end || '—'}`}</strong>
            </div>
          </div>

          {/* TRUNK CONDUIT: PPA ➔ SJVN ALLOCATOR */}
          <div style={{ ...at(2), position: 'relative', height: 160, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
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
              fontSize: 14,
              color: '#38bdf8',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              textAlign: 'center',
            }}>
              <div>{fmtNumber(totalCapacity)} MW</div>
              <div style={{ color: '#10b981', fontSize: 13.5 }}>{isPpa ? 'PPA Pool' : 'PSA Demand'}</div>
            </div>
          </div>

          {/* NODE 2: SJVN REIA ALLOCATION & CARVE-OUT HUB */}
          <div style={{
            ...at(3),
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
                fontSize: 14,
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
                {isPpa ? '2. SJVN Allocator Hub' : '2. SJVN Pooling Hub'}
              </span>
              <span style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.15)',
                padding: '1px 5px',
                borderRadius: 3,
              }}>
                REIA
              </span>
            </div>

            <div style={{ fontSize: 15.5, fontWeight: 800, color: '#f8fafc', marginBottom: 2 }}>
              SJVN Limited (REIA)
            </div>
            <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 10 }}>
              {reiaTerm('Carve-Out & Trading Margin Engine')}
            </div>

            <div style={{
              background: 'rgba(0, 0, 0, 0.4)',
              borderRadius: 8,
              padding: '8px 10px',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              marginBottom: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#94a3b8', marginBottom: 3 }}>
                <span>Avg spread (PSA − PPA)</span>
                <strong style={{ color: avgSpread != null && avgSpread < 0 ? 'var(--on-red)' : '#38bdf8' }}>{avgSpread == null ? '—' : `${avgSpread < 0 ? '−' : '+'}₹${Math.abs(avgSpread).toFixed(3)} / unit`}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#94a3b8' }}>
                <span>{isPpa ? 'Carve-Out Branches' : 'Source PPAs'}</span>
                <strong style={{ color: '#10b981' }}>{liveCounterparties} {isPpa ? 'DISCOMs' : 'Generators'}</strong>
              </div>
            </div>

            <div style={{ fontSize: 14, color: 'var(--slate-500)', textAlign: 'center' }}>
              Back-to-Back Pass-Through Routing
            </div>
          </div>

          {/* BRANCHING CONDUITS: SJVN HUB ➔ MULTIPLE DISCOMs */}
          <div style={{ ...at(4), position: 'relative', height: Math.max(180, count * 95), display: 'flex', alignItems: 'center' }}>
            {/* Drawn hub → cards; mirrored on a PSA, where the cards are the source PPAs on the left. */}
            <svg width="100%" height="100%" viewBox={`0 0 100 ${Math.max(180, count * 95)}`} preserveAspectRatio="none" style={{ overflow: 'visible', transform: isPpa ? 'none' : 'scaleX(-1)' }}>
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
                      style={{ animation: `trunkFlow 1.8s linear infinite${isPpa ? '' : ' reverse'}` }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* NODE 3: BRANCHING OFF-TAKERS (DISCOM CARDS STACK) */}
          <div style={{ ...at(5), display: 'flex', flexDirection: 'column', gap: 12 }}>
            {allocations.map((alloc, idx) => {
              const isHovered = hoveredIndex === idx;
              const isSelected = selectedIndex === idx;
              const allocatedShareMw = shareMwOf(alloc, isPpa, totalCapacity);

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
                    transform: isHovered || isSelected ? `translateX(${isPpa ? 4 : -4}px) scale(1.02)` : 'none',
                    transition: 'all 0.25s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 14,
                      fontWeight: 800,
                      letterSpacing: 0.8,
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      color: '#818cf8',
                      background: 'rgba(129, 140, 248, 0.15)',
                      padding: '2px 7px',
                      borderRadius: 4,
                    }}>
                      {isPpa ? `Branch ${idx + 1}` : (count > 1 ? `1. Generator ${idx + 1}` : '1. Power Generator (IPP)')}
                    </span>
                    <span style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: isPpa ? '#818cf8' : '#10b981',
                      background: isPpa ? 'rgba(129, 140, 248, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}>
                      {isPpa ? 'DISCOM' : 'PPA'}
                    </span>
                  </div>

                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
                    {isPpa ? (alloc.buyer_name || `DISCOM ${idx + 1}`) : (alloc.seller_name || `Generator ${idx + 1}`)}
                  </div>

                  <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 8 }}>
                    {isPpa ? (alloc.psa_no || 'PSA Agreement') : (alloc.ppa_no || 'PPA Agreement')}
                  </div>

                  {(() => {
                    const nodeTariff = Number(isPpa ? alloc.psa_tariff : alloc.ppa_tariff);
                    const sp = spreadOf(alloc);
                    return (
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'rgba(0, 0, 0, 0.3)',
                        padding: '6px 8px',
                        borderRadius: 6,
                        fontSize: 14.5,
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}>
                        <div>
                          <span style={{ color: '#94a3b8', fontSize: 14 }}>Share: </span>
                          <strong style={{ color: '#38bdf8' }}>{alloc.allocation_percent}% ({fmtNumber(allocatedShareMw)} MW)</strong>
                        </div>
                        <div>
                          <span style={{ color: '#94a3b8', fontSize: 14 }}>Tariff: </span>
                          <strong style={{ color: sp != null && sp < 0 ? 'var(--on-red)' : '#10b981' }}>{Number.isFinite(nodeTariff) ? `₹${nodeTariff.toFixed(2)}` : '—'}{sp != null && sp < 0 ? ' · loss' : ''}</strong>
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 14,
                    color: 'var(--slate-500)',
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
        const allocatedShareMw = shareMwOf(alloc, isPpa, totalCapacity);
        const psaTariff = Number(alloc.psa_tariff) || 0;
        const ppaTariff = Number(alloc.ppa_tariff) || 0;
        const marginSpread = spreadOf(alloc) ?? 0;
        const isLoss = marginSpread < 0;

        return (
          <div style={{
            marginTop: 16,
            background: 'rgba(15, 23, 42, 0.95)',
            border: isLoss ? '1.5px solid #ef4444' : '1px solid #334155',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            animation: 'fadeIn 0.2s ease-out',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #1e293b', paddingBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isLoss ? '#ef4444' : '#38bdf8' }} />
                <strong style={{ color: '#f8fafc', fontSize: 15.5 }}>
                  {isPpa ? `Carve-Out Deep Dive: ${alloc.buyer_name || 'Buyer DISCOM'}` : `Source Supply: ${alloc.seller_name || 'Generator IPP'}`} ({alloc.allocation_percent}% Allocation)
                </strong>
                {isLoss && (
                  <span style={{ fontSize: 13.5, color: 'var(--on-red)', background: 'rgba(239, 68, 68, 0.15)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                    Negative Spread Alert (PSA &lt; PPA Tariff)
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {canMap && onRemoveAllocation && (
                  <button
                    type="button"
                    onClick={() => onRemoveAllocation(alloc.id)}
                    style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Unlink Allocation
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedIndex(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 14.5,
                    fontWeight: 600,
                  }}
                >
                  ✕ Close
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: 15 }}>
              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 14.5 }}>Allocated Capacity Share</div>
                <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 16, marginTop: 2 }}>
                  {fmtNumber(allocatedShareMw)} MW
                </div>
                <div style={{ color: 'var(--slate-500)', fontSize: 14, marginTop: 2 }}>{alloc.allocation_percent}% of {fmtNumber(totalCapacity)} MW {isPpa ? 'PPA Pool' : 'PSA Requirement'}</div>
              </div>

              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 14.5 }}>Off-Take Tariff & Spread</div>
                <div style={{ fontWeight: 700, color: isLoss ? 'var(--on-red)' : '#10b981', fontSize: 16, marginTop: 2 }}>
                  ₹{psaTariff.toFixed(2)} / kWh
                </div>
                <div style={{ color: isLoss ? '#f87171' : 'var(--slate-500)', fontSize: 14, marginTop: 2 }}>
                  {isLoss ? `Deficit: -₹${Math.abs(marginSpread).toFixed(3)}/unit` : `Base ₹${ppaTariff.toFixed(2)} + Margin ₹${marginSpread.toFixed(3)}`}
                </div>
              </div>

              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 14.5 }}>{isPpa ? 'PSA Contract Number' : 'Source PPA Number'}</div>
                <div style={{ fontWeight: 600, color: '#f8fafc', marginTop: 2 }}>{(isPpa ? alloc.psa_no : alloc.ppa_no) || '—'}</div>
                <div style={{ color: 'var(--slate-500)', fontSize: 14, marginTop: 2 }}>Effective: {alloc.effective_from} → {alloc.effective_to || 'Active'}</div>
              </div>

              <div style={{ background: '#0b1120', padding: 10, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div style={{ color: '#94a3b8', fontSize: 14.5 }}>{isLoss ? 'Monthly loss (est.)' : 'Monthly margin (est.)'}</div>
                <div style={{ fontWeight: 700, color: isLoss ? 'var(--on-red)' : '#f59e0b', fontSize: 16, marginTop: 2 }}>
                  {isLoss ? '−' : ''}₹{Math.abs(allocatedShareMw * 1000 * marginSpread * 160).toLocaleString('en-IN', { maximumFractionDigits: 0 })} / mo
                </div>
                <div style={{ color: 'var(--slate-500)', fontSize: 14, marginTop: 2 }}>{fmtNumber(allocatedShareMw)} MW × 160 h/month (≈22% CUF) × spread</div>
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
function TableMatrixView({ isPpa, allocations, canMap, onRemoveAllocation }) {
  if (!allocations.length) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--slate-500)', background: 'var(--surface)', borderRadius: '0 0 12px 12px', border: '1px solid var(--slate-200)' }}>
        {isPpa ? 'No PSAs mapped to this PPA yet.' : 'No source PPA is linked to this PSA yet.'}
      </div>
    );
  }

  const baseColumns = isPpa ? [
    { key: 'psa_no', header: 'PSA Number' },
    { key: 'buyer_name', header: 'DISCOM (Buyer)' },
    { key: 'allocation_percent', header: 'Allocation %', render: (r) => `${r.allocation_percent}%` },
    { key: 'capacity', header: 'Allocated MW', render: (r) => `${fmtNumber(shareMwOf(r, true, Number(r.ppa_capacity_mw) || 0))} MW of ${fmtNumber(r.psa_capacity_mw)} MW PSA` },
    { key: 'tariff', header: 'Tariff', render: (r) => r.psa_tariff ? `₹${r.psa_tariff}/unit` : '—' },
    { key: 'effective', header: 'Effective Dates', render: (r) => `${r.effective_from} to ${r.effective_to || 'Active'}` },
  ] : [
    { key: 'ppa_no', header: 'PPA Number' },
    { key: 'seller_name', header: 'Generator (Seller)' },
    { key: 'ppa_capacity_mw', header: 'PPA Capacity', render: (r) => `${fmtNumber(r.ppa_capacity_mw)} MW` },
    { key: 'allocation_percent', header: 'Share of that PPA', render: (r) => `${r.allocation_percent}%` },
    { key: 'mw', header: 'MW received', render: (r) => `${fmtNumber(shareMwOf(r, false, 0))} MW` },
    { key: 'ppa_tariff', header: 'PPA tariff', render: (r) => (r.ppa_tariff != null ? `₹${r.ppa_tariff}/unit` : '—') },
    { key: 'effective', header: 'Effective Dates', render: (r) => `${r.effective_from} to ${r.effective_to || 'Active'}` },
  ];

  if (canMap && onRemoveAllocation) {
    baseColumns.push({
      key: 'action',
      header: 'Action',
      render: (r) => (
        <button
          type="button"
          onClick={() => onRemoveAllocation(r.id)}
          className="btn btn-outline btn-sm"
          style={{ color: 'var(--red-strong)', borderColor: '#fca5a5' }}
        >
          Unlink
        </button>
      ),
    });
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--slate-200)', borderRadius: '0 0 12px 12px', padding: 16 }}>
      <Table
        columns={baseColumns}
        rows={allocations}
      />
    </div>
  );
}
