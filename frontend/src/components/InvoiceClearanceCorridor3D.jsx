import React from 'react';
import { fmtCurrency } from './ui.jsx';
import { fmtDateTime } from '../datetime.js';

/**
 * InvoiceClearanceCorridor3D
 * 3D Institutional Maker-Checker Clearance Corridor for Invoice Detail modal.
 * Visualizes the 5-stage institutional sign-off pipeline:
 * Maker (Billing Staff) ➔ L1: Manager (Commercial) ➔ L2: DGM (Finance) ➔ L3: CGM (Head Commercial) ➔ Digitally Signed Dispatch
 * Renders glowing institutional authority stamps, designated approver posts, and inline action controls.
 */

export default function InvoiceClearanceCorridor3D({
  invoice,
  approvalLevels = [],
  designatedMap = {},
  canApprove = false,
  canReject = false,
  isAdmin = false,
  busy = '',
  approveComments = {},
  setApproveComments = () => {},
  onApprove = () => {},
  onReject = () => {},
}) {
  if (!invoice) return null;

  // Determine current active level index
  const l1 = approvalLevels.find((a) => a.level === 1);
  const l2 = approvalLevels.find((a) => a.level === 2);
  const l3 = approvalLevels.find((a) => a.level === 3);

  const isL1Approved = l1?.status === 'APPROVED';
  const isL2Approved = l2?.status === 'APPROVED';
  const isL3Approved = l3?.status === 'APPROVED';

  const isL1Rejected = l1?.status === 'REJECTED';
  const isL2Rejected = l2?.status === 'REJECTED';
  const isL3Rejected = l3?.status === 'REJECTED';

  const isDispatched = isL3Approved || ['SENT_TO_BUYER', 'ACCEPTED', 'PAID', 'PARTIALLY_PAID'].includes(invoice.status);

  // Stages Configuration
  const stages = [
    {
      stageNum: 0,
      title: 'Maker (Billing Officer)',
      post: 'Commercial Billing Executive',
      status: 'APPROVED',
      statusLabel: 'VERIFIED & RAISED',
      actorName: invoice.created_by || 'SJVN Billing Officer',
      timestamp: invoice.created_at,
      comments: 'Bill drafted and reconciled against REA meter figures.',
      color: '#10b981',
      isCurrent: false,
    },
    {
      stageNum: 1,
      level: 1,
      title: 'Level 1: Manager (Commercial)',
      post: designatedMap[1]?.postName || 'Manager (Commercial Operations)',
      designatedNames: (designatedMap[1]?.names || []).join(', ') || 'Designated Commercial Officer',
      status: l1?.status || 'PENDING',
      statusLabel: isL1Approved ? 'COMMERCIALLY VERIFIED' : isL1Rejected ? 'RETURNED' : 'AWAITING L1 REVIEW',
      actorName: l1?.approver_name,
      timestamp: l1?.acted_at,
      comments: l1?.comments,
      color: isL1Approved ? '#10b981' : isL1Rejected ? '#ef4444' : '#38bdf8',
      isCurrent: !isL1Approved && !isL1Rejected,
      isPending: !isL1Approved && !isL1Rejected,
    },
    {
      stageNum: 2,
      level: 2,
      title: 'Level 2: DGM (Finance)',
      post: designatedMap[2]?.postName || 'DGM (Finance & Accounts)',
      designatedNames: (designatedMap[2]?.names || []).join(', ') || 'Designated Finance Officer',
      status: l2?.status || 'PENDING',
      statusLabel: isL2Approved ? 'FINANCIAL CONCURRENCE' : isL2Rejected ? 'RETURNED' : (isL1Approved ? 'AWAITING FINANCE AUDIT' : 'LOCKED (WAITS L1)'),
      actorName: l2?.approver_name,
      timestamp: l2?.acted_at,
      comments: l2?.comments,
      color: isL2Approved ? '#10b981' : isL2Rejected ? '#ef4444' : (isL1Approved ? '#38bdf8' : '#64748b'),
      isCurrent: isL1Approved && !isL2Approved && !isL2Rejected,
      isPending: isL1Approved && !isL2Approved && !isL2Rejected,
      isLocked: !isL1Approved,
    },
    {
      stageNum: 3,
      level: 3,
      title: 'Level 3: CGM (Commercial Head)',
      post: designatedMap[3]?.postName || 'CGM / ED (Head of Commercial)',
      designatedNames: (designatedMap[3]?.names || []).join(', ') || 'Chief General Manager',
      status: l3?.status || 'PENDING',
      statusLabel: isL3Approved ? 'FINAL SANCTION APPROVED' : isL3Rejected ? 'RETURNED' : (isL2Approved ? 'AWAITING FINAL SANCTION' : 'LOCKED (WAITS L2)'),
      actorName: l3?.approver_name,
      timestamp: l3?.acted_at,
      comments: l3?.comments,
      color: isL3Approved ? '#10b981' : isL3Rejected ? '#ef4444' : (isL2Approved ? '#38bdf8' : '#64748b'),
      isCurrent: isL2Approved && !isL3Approved && !isL3Rejected,
      isPending: isL2Approved && !isL3Approved && !isL3Rejected,
      isLocked: !isL2Approved,
    },
    {
      stageNum: 4,
      title: 'Dispatch & Outward Seal',
      post: 'Digital Signature & Outward Register',
      status: isDispatched ? 'APPROVED' : 'PENDING',
      statusLabel: isDispatched ? 'SHA-256 SIGNED & DISPATCHED' : 'AWAITING EXECUTIVE SANCTION',
      actorName: isDispatched ? 'SJVN Outward Dispatch Engine' : '—',
      timestamp: isDispatched ? (l3?.acted_at || invoice.updated_at) : null,
      color: isDispatched ? '#10b981' : '#64748b',
      isCurrent: false,
      isLocked: !isL3Approved,
    },
  ];

  return (
    <div style={{
      background: 'radial-gradient(circle at 50% 30%, #0c1427 0%, #050811 100%)',
      borderRadius: 12,
      border: '1px solid #1e293b',
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      padding: '18px 20px',
      marginBottom: 20,
      color: '#f8fafc',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background Subtle Cyber Grid */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(14, 165, 233, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(14, 165, 233, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '24px 24px',
        pointerEvents: 'none',
      }} />

      {/* Top Corridor Title */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        paddingBottom: 12,
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        flexWrap: 'wrap',
        gap: 10,
        position: 'relative',
        zIndex: 2,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: 'linear-gradient(135deg, #0284c7, #2563eb)',
            padding: '6px',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 12px rgba(37, 99, 235, 0.4)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 14, color: '#f8fafc' }}>
                Executive Maker-Checker Clearance Corridor
              </strong>
              <span style={{
                fontSize: 12.5,
                textTransform: 'uppercase',
                background: isDispatched ? 'rgba(16, 185, 129, 0.15)' : 'rgba(14, 165, 233, 0.15)',
                color: isDispatched ? '#10b981' : '#38bdf8',
                border: isDispatched ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(14, 165, 233, 0.3)',
                padding: '2px 7px',
                borderRadius: 4,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}>
                {isDispatched ? 'Full Statutory Sanction Achieved' : 'In Approval Pipeline'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 1 }}>
              Invoice: <strong style={{ color: '#38bdf8' }}>{invoice.invoice_no}</strong> · Amount: <strong style={{ color: '#10b981' }}>{fmtCurrency(invoice.total_amount)}</strong>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          Sequential 3-Tier Multi-Level Commercial & Finance Verification
        </div>
      </div>

      {/* 5-Chamber 3D Horizontal Progression Corridor */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 12,
        alignItems: 'stretch',
      }}>
        {stages.map((stg) => {
          const isPassed = stg.status === 'APPROVED';
          const isCurrent = stg.isCurrent;
          const isLocked = stg.isLocked;

          return (
            <div
              key={stg.stageNum}
              style={{
                background: isPassed
                  ? 'linear-gradient(145deg, rgba(16, 185, 129, 0.12), rgba(15, 23, 42, 0.95))'
                  : isCurrent
                  ? 'linear-gradient(145deg, rgba(14, 165, 233, 0.18), rgba(15, 23, 42, 0.95))'
                  : 'linear-gradient(145deg, rgba(15, 23, 42, 0.6), rgba(9, 14, 26, 0.8))',
                border: isPassed
                  ? '1.5px solid rgba(16, 185, 129, 0.4)'
                  : isCurrent
                  ? '2px solid #38bdf8'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: isCurrent
                  ? '0 0 25px rgba(14, 165, 233, 0.35), 0 8px 20px rgba(0,0,0,0.6)'
                  : (isPassed ? '0 0 15px rgba(16, 185, 129, 0.2)' : 'none'),
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
                transition: 'all 0.25s ease',
              }}
            >
              <div>
                {/* Stage Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <span style={{
                    fontSize: 12.5,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: stg.color,
                    background: `${stg.color}15`,
                    border: `1px solid ${stg.color}35`,
                    padding: '2px 6px',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    {isCurrent && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#38bdf8', animation: 'corridorPulse 1.2s infinite' }} />}
                    Stage {stg.stageNum}
                  </span>

                  {isPassed && (
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: '#10b981',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}>
                      ✓ Sealed
                    </span>
                  )}
                </div>

                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#f8fafc', marginBottom: 2 }}>
                  {stg.title}
                </div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 10 }}>
                  {stg.post}
                </div>

                {/* Authority Stamp Seal */}
                <div style={{
                  background: isPassed ? 'rgba(16, 185, 129, 0.08)' : 'rgba(0, 0, 0, 0.3)',
                  border: isPassed ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Designated Authority:</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc', marginTop: 1 }}>
                    {stg.actorName || stg.designatedNames || '—'}
                  </div>
                  {stg.timestamp && (
                    <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 3 }}>
                      {fmtDateTime(stg.timestamp)}
                    </div>
                  )}
                </div>

                {stg.comments && (
                  <div style={{ fontSize: 12.5, color: '#cbd5e1', fontStyle: 'italic', marginBottom: 8 }}>
                    &ldquo;{stg.comments}&rdquo;
                  </div>
                )}
              </div>

              {/* Action Controls for Current Stage */}
              {isCurrent && stg.level && (canApprove || canReject) && (
                <div style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                }}>
                  <input
                    type="text"
                    placeholder="Approval comments..."
                    value={approveComments[stg.level] || ''}
                    onChange={(e) => setApproveComments({ ...approveComments, [stg.level]: e.target.value })}
                    style={{
                      width: '100%',
                      background: '#090e1a',
                      border: '1px solid #334155',
                      color: '#f8fafc',
                      padding: '5px 8px',
                      borderRadius: 4,
                      fontSize: 13,
                      marginBottom: 8,
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    {canApprove && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => onApprove(stg.level)}
                        style={{
                          flex: 1,
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          color: '#fff',
                          border: 'none',
                          padding: '6px 8px',
                          borderRadius: 4,
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {busy === `act-${stg.level}` ? 'Recording…' : '✓ Approve'}
                      </button>
                    )}
                    {canReject && (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => onReject(stg.level)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#ef4444',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '6px 8px',
                          borderRadius: 4,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Reject
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Embedded Animation Styles */}
      <style>{`
        @keyframes corridorPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
