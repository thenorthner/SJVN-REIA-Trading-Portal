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
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#1e293b' }}>Last 10 days bid summary</h3>
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
            📊 Export CSV
          </button>
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #cbd5e1', textAlign: 'left' }}>
                <th scope="col" style={{ padding: '12px 20px', color: '#475569', fontWeight: 600 }}>Delivery Date</th>
                <th scope="col" style={{ padding: '12px 20px', color: '#475569', fontWeight: 600 }}>Portfolio Name</th>
                <th scope="col" style={{ padding: '12px 20px', color: '#475569', fontWeight: 600 }}>Bid Type</th>
                <th scope="col" style={{ padding: '12px 20px', color: '#475569', fontWeight: 600, textAlign: 'right' }}>Bid Placed (MWH)</th>
                <th scope="col" style={{ padding: '12px 20px', color: '#475569', fontWeight: 600, textAlign: 'right' }}>Bid Cleared (MWH)</th>
                <th scope="col" style={{ padding: '12px 20px', color: '#475569', fontWeight: 600, textAlign: 'right' }}>Exchange Oblig(Rs)</th>
                <th scope="col" style={{ padding: '12px 20px', color: '#475569', fontWeight: 600, textAlign: 'right' }}>Grand Total (Rs)</th>
              </tr>
            </thead>
            <tbody>
              {mockSummaryData.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ padding: '12px 20px', fontWeight: 500, color: '#334155' }}>{row.date}</td>
                  <td style={{ padding: '12px 20px', color: '#475569' }}>{row.portfolio}</td>
                  <td style={{ padding: '12px 20px' }}>
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>{row.type}</span>
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: '#475569' }}>{row.bidPlaced.toFixed(2)}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{row.bidCleared.toFixed(2)}</td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', color: '#475569' }}>
                    {row.exchangeObligation.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>
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
