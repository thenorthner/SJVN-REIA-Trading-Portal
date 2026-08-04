import React from 'react';
import { SampleDataNotice, PageHeader, Card, Badge } from '../../components/ui.jsx';
import BidVsClearedAnalytics from '../../components/analytics/BidVsClearedAnalytics.jsx';
import ACPTrendWidget from '../../components/analytics/ACPTrendWidget.jsx';

const mockSummaryData = [
  { date: '09-07-2026', portfolio: 'SJVN Limited-Naitwar Mori HPS', type: 'Sell', bidPlaced: 0.00, bidCleared: 64.80, exchangeObligation: 26661.09, grandTotal: 26363.01 },
  { date: '07-07-2026', portfolio: 'SJVN Limited-Naitwar Mori HPS', type: 'Sell', bidPlaced: 0.00, bidCleared: 75.40, exchangeObligation: 59727.02, grandTotal: 59380.18 },
  { date: '06-07-2026', portfolio: 'SJVN Limited-Naitwar Mori HPS', type: 'Sell', bidPlaced: 0.00, bidCleared: 108.60, exchangeObligation: 70187.18, grandTotal: 69687.62 },
  { date: '02-07-2026', portfolio: 'SJVN Limited-Naitwar Mori HPS', type: 'Sell', bidPlaced: 0.00, bidCleared: 180.25, exchangeObligation: 172615.38, grandTotal: 171786.23 },
  { date: '01-07-2026', portfolio: 'SJVN Limited-Naitwar Mori HPS', type: 'Sell', bidPlaced: 0.00, bidCleared: 23.75, exchangeObligation: 18009.01, grandTotal: 17899.76 },
  { date: '07-06-2026', portfolio: 'SJVN Limited-Naitwar Mori HPS', type: 'Sell', bidPlaced: 0.00, bidCleared: 2.35, exchangeObligation: 0.00, grandTotal: 0.00 },
  { date: '01-06-2026', portfolio: 'SJVN Limited-Naitwar Mori HPS', type: 'Sell', bidPlaced: 0.00, bidCleared: 24.20, exchangeObligation: 23431.08, grandTotal: 23319.76 },
];

export default function HomeDashboard() {
  const handleExportCSV = () => {
    // In a real application, we would generate a CSV blob and download it.
    alert('Not available yet — the bid summary export is not built, and this dashboard is running on placeholder figures.');
  };

  return (
    <div style={{ padding: '0 20px 20px', maxWidth: 1600, margin: '0 auto' }}>
      <SampleDataNotice detail="Portfolio figures on this dashboard are placeholders, not the platform's own trade and settlement data." />

      <PageHeader 
        title="Home (Portal Landing Dashboard)" 
        description="Master dashboard view for SJVN Limited-Naitwar Mori HPS."
      />

      {/* Top Analytics Grid: 2-column flex/grid container */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <BidVsClearedAnalytics />
        <ACPTrendWidget />
      </div>

      {/* Bottom Full-Width Data Table: Last 10 days bid summary */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--slate-200)', background: 'var(--slate-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--slate-800)' }}>Last 10 days bid summary</h3>
            <div style={{ display: 'flex', gap: 12 }}>
              <Badge type="info" style={{ fontSize: 13, padding: '4px 8px', background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>
                <strong>Total Cleared Volume (7 Days):</strong> 479.35 MWh
              </Badge>
              <Badge type="success" style={{ fontSize: 13, padding: '4px 8px', background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }}>
                <strong>Total Net Realization:</strong> ₹3,68,436.56
              </Badge>
            </div>
          </div>
          <button 
            className="btn btn-sm btn-outline" 
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={handleExportCSV}
          >
            Export CSV
          </button>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--slate-100)', borderBottom: '2px solid var(--slate-300)', textAlign: 'left' }}>
                <th scope="col" style={{ padding: '12px 20px', color: 'var(--slate-600)', fontWeight: 600 }}>Delivery Date</th>
                <th scope="col" style={{ padding: '12px 20px', color: 'var(--slate-600)', fontWeight: 600 }}>Portfolio Name</th>
                <th scope="col" style={{ padding: '12px 20px', color: 'var(--slate-600)', fontWeight: 600 }}>Bid Type</th>
                <th scope="col" style={{ padding: '12px 20px', color: 'var(--slate-600)', fontWeight: 600, textAlign: 'right' }}>Bid Placed (MWH)</th>
                <th scope="col" style={{ padding: '12px 20px', color: 'var(--slate-600)', fontWeight: 600, textAlign: 'right' }}>Bid Cleared (MWH)</th>
                <th scope="col" style={{ padding: '12px 20px', color: 'var(--slate-600)', fontWeight: 600, textAlign: 'right' }}>Exchange Oblig(Rs)</th>
                <th scope="col" style={{ padding: '12px 20px', color: 'var(--slate-600)', fontWeight: 600, textAlign: 'right' }}>Grand Total (Rs)</th>
              </tr>
            </thead>
            <tbody>
              {mockSummaryData.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--slate-200)', background: idx % 2 === 0 ? '#fff' : 'var(--slate-50)' }}>
                  <td style={{ padding: '12px 20px', fontWeight: 500, color: 'var(--slate-700)' }}>{row.date}</td>
                  <td style={{ padding: '12px 20px', color: 'var(--slate-600)' }}>{row.portfolio}</td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{ color: 'var(--red-strong)', fontWeight: 600 }}>{row.type}</span>
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--slate-600)' }}>{row.bidPlaced.toFixed(2)}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: 'var(--slate-900)' }}>{row.bidCleared.toFixed(2)}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: 'var(--slate-600)' }}>
                    {row.exchangeObligation.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: 'var(--green-strong)' }}>
                    {row.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
