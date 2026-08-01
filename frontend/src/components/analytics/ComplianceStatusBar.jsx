import React from 'react';

export default function ComplianceStatusBar() {
  return (
    <div style={{ 
      display: 'flex', 
      gap: 12, 
      marginBottom: 20, 
      alignItems: 'stretch',
      flexWrap: 'wrap'
    }}>
      {/* Entity Pill */}
      <div style={{ 
        background: '#1e293b', 
        color: '#f8fafc', 
        padding: '10px 16px', 
        borderRadius: 4, 
        fontSize: 14, 
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <span>🏢</span> SJVN Limited-Naitwar Mori HPS
      </div>

      {/* REC Countdown */}
      <div style={{ 
        background: '#fff', 
        border: '1px solid #e2e8f0',
        color: '#475569', 
        padding: '10px 16px', 
        borderRadius: 4, 
        fontSize: 14, 
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        <span style={{ color: '#0284c7' }}>⏱️</span> Remaining <span style={{ color: '#0284c7' }}>20 Days</span> for REC bid
      </div>

      {/* ESCERT Countdown */}
      <div style={{ 
        background: '#fff', 
        border: '1px solid #e2e8f0',
        color: '#475569', 
        padding: '10px 16px', 
        borderRadius: 4, 
        fontSize: 14, 
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        <span style={{ color: '#16a34a' }}>⏱️</span> Remaining <span style={{ color: '#16a34a' }}>5 Days</span> for ESCERT bid
      </div>

      {/* NOC Alert */}
      <div style={{ 
        background: '#fef2f2', 
        border: '1px solid #fecaca',
        color: '#dc2626', 
        padding: '10px 16px', 
        borderRadius: 4, 
        fontSize: 14, 
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        marginLeft: 'auto'
      }}>
        <span>⚠️</span> NOC Expired
      </div>
    </div>
  );
}
