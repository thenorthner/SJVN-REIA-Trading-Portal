import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/client.js';
import { PageHeader, StatCard, Card, fmtCurrency, fmtNumber, Badge, Modal } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../roles.js';

export default function ConsolidatedDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showGlossary, setShowGlossary] = useState(false);

  useEffect(() => {
    api.dashboard.consolidated().then((res) => setData(res.portfolio)).catch(() => setError('Failed to load dashboard.'));
  }, []);

  if (error) return <div className="empty-state"><h3>Something went wrong</h3><p>{error}</p></div>;
  if (!data) return <div className="page-loading">Loading dashboard...</div>;

  const canViewReia = ROLE_GROUPS.REIA_ALL.includes(user.role);
  const canViewTrading = ROLE_GROUPS.TRADING_ALL.includes(user.role);

  const revenueChart = [
    { name: 'REIA Billing', Value: data.reiaBilledValue },
    { name: 'Trading Revenue', Value: data.tradingRevenue },
  ];

  const handlePrint = () => {
    window.print();
  };

  const getTrendIcon = (val) => {
    if (val > 0) return <span style={{ color: '#008a00' }}>↑ {val.toFixed(1)}%</span>;
    if (val < 0) return <span style={{ color: '#e53e3e' }}>↓ {Math.abs(val).toFixed(1)}%</span>;
    return <span style={{ color: '#718096' }}>— 0%</span>;
  };

  const capacityProgress = Math.min((data.reiaContractedCapacity / data.targetCapacity) * 100, 100);

  return (
    <div className="dashboard-container">
      <div className="no-print">
        <PageHeader
          title="Consolidated Executive Dashboard"
          subtitle="Enterprise-wide portfolio view, risk rollup, and MIS"
          actions={
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" onClick={() => setShowGlossary(true)}>KPI Glossary</button>
              <button className="btn" onClick={handlePrint}>Download Board Report (PDF)</button>
            </div>
          }
        />
      </div>

      <div className="print-only">
        <h1>Executive Dashboard - SJVN RE Commercial & Trading</h1>
        <p>Report generated on: {new Date().toLocaleString()}</p>
        <hr style={{ margin: '20px 0' }} />
      </div>

      {/* Auto-generated Executive Summary */}
      <Card style={{ marginBottom: 20, backgroundColor: '#f8faff', borderLeft: '4px solid #0b5fff' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#1c2536' }}>Executive Summary</h4>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: '#333' }}>
          {data.executiveSummary}
        </p>
      </Card>

      {/* Cross-Module Risk & Target Panel */}
      <div className="grid-2" style={{ marginBottom: 20 }}>
        <Card title="Enterprise Risk Rollup">
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Total Unresolved Exposure</span>
              <span className="detail-value" style={{ color: data.totalUnresolvedExposure > 500000 ? '#e53e3e' : '#008a00' }}>
                {fmtCurrency(data.totalUnresolvedExposure)}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Payment Security Coverage</span>
              <span className="detail-value">
                <Badge type={data.coverageRatio >= 100 ? 'success' : (data.coverageRatio > 50 ? 'warning' : 'danger')}>
                  {data.coverageRatio.toFixed(1)}%
                </Badge>
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Data Validation Completeness</span>
              <span className="detail-value">{data.dataCompleteness}%</span>
            </div>
          </div>
        </Card>

        <Card title="Capacity Growth Target (20 GW Vision)">
          <div style={{ padding: '20px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>Current: {fmtNumber(data.reiaContractedCapacity)} MW</strong>
              <strong>Target: {fmtNumber(data.targetCapacity)} MW</strong>
            </div>
            <div style={{ width: '100%', backgroundColor: '#e2e8f0', borderRadius: 8, height: 24, overflow: 'hidden' }}>
              <div style={{ width: `${capacityProgress}%`, backgroundColor: '#0b5fff', height: '100%', transition: 'width 0.5s ease' }} />
            </div>
            <p style={{ textAlign: 'right', marginTop: 8, fontSize: 13, color: '#667085' }}>{capacityProgress.toFixed(1)}% achieved</p>
          </div>
        </Card>
      </div>

      <h3 style={{ margin: '30px 0 15px 0', color: '#1c2536', borderBottom: '1px solid #eee', paddingBottom: 10 }}>Portfolio Overview</h3>
      <div className="kpi-grid">
        <StatCard label="Total Portfolio Billed Value" value={fmtCurrency(data.totalPortfolioValue)} tone="blue" hint={<div>MoM Trend: {getTrendIcon(data.revenueTrend)}</div>} />
        <StatCard label="Overall Trading Profitability" value={fmtCurrency(data.overallProfitability)} tone="green" hint="SJVN trading margin across all trades" />
      </div>

      {canViewReia && (
        <>
          <h3 style={{ margin: '30px 0 15px 0', color: '#1c2536', borderBottom: '1px solid #eee', paddingBottom: 10 }}>REIA Billing & Settlement</h3>
          <div className="kpi-grid">
            <StatCard label="Contracted RE Capacity" value={`${fmtNumber(data.reiaContractedCapacity)} MW`} />
            <StatCard label="REIA Receivables" value={fmtCurrency(data.reiaReceivables)} hint="Unpaid from buyers" />
            <StatCard label="REIA Overdue" value={fmtCurrency(data.reiaOverdue)} tone={data.reiaOverdue > 100000 ? 'red' : 'amber'} hint="Past due date" />
            <StatCard label="Disputed Amount" value={fmtCurrency(data.reiaDisputedAmount)} tone={data.reiaDisputedAmount > 50000 ? 'red' : 'default'} />
            <StatCard label="Open Disputes" value={data.reiaOpenDisputes} tone={data.reiaOpenDisputes > 0 ? 'red' : 'default'} />
            <StatCard label="Recon Exceptions" value={data.reiaReconExceptions} tone={data.reiaReconExceptions > 0 ? 'red' : 'default'} />
          </div>
        </>
      )}

      {canViewTrading && (
        <>
          <h3 style={{ margin: '30px 0 15px 0', color: '#1c2536', borderBottom: '1px solid #eee', paddingBottom: 10 }}>Power Trading Operations</h3>
          <div className="kpi-grid">
            <StatCard label="Trading Revenue" value={fmtCurrency(data.tradingRevenue)} tone="blue" />
            <StatCard label="Trading Margin" value={fmtCurrency(data.tradingMargin)} tone="green" />
            <StatCard label="Trading Outstanding" value={fmtCurrency(data.tradingOutstanding)} tone={data.tradingOutstanding > 500000 ? 'red' : 'amber'} hint="Unpaid trading invoices" />
            <StatCard label="Trading Cleared Quantum" value={`${fmtNumber(data.tradingClearedQuantum)} MW`} />
          </div>
        </>
      )}

      <div className="grid-2" style={{ marginTop: 24 }}>
        <Card title="Business Vertical Revenue Comparison">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1e7).toFixed(1)}Cr`} />
                <Tooltip formatter={(v) => fmtCurrency(v)} />
                <Legend />
                <Bar dataKey="Value" fill="#0b5fff" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {showGlossary && (
        <Modal open={true} onClose={() => setShowGlossary(false)} title="KPI Dictionary & Glossary" width={600}>
          <div style={{ padding: 10 }}>
            <h4 style={{ marginBottom: 5 }}>Enterprise Risk Rollup</h4>
            <ul style={{ marginBottom: 15, paddingLeft: 20 }}>
              <li><strong>Total Unresolved Exposure:</strong> Sum of (REIA Overdue Receivables + Trading Outstanding Invoices + REIA Open Disputed Amounts).</li>
              <li><strong>Payment Security Coverage:</strong> (Total Active/Renewed Payment Security Amount) / (Total Unresolved Exposure) * 100. Target is &gt;= 100%.</li>
              <li><strong>Data Validation Completeness:</strong> Percentage of Energy Data records that are in `LOCKED` (validated) status vs total records.</li>
            </ul>

            <h4 style={{ marginBottom: 5 }}>REIA Definitions</h4>
            <ul style={{ marginBottom: 15, paddingLeft: 20 }}>
              <li><strong>Receivables:</strong> Total value of invoices sent to Buyers that are not fully PAID or CANCELLED.</li>
              <li><strong>Overdue:</strong> Portion of Receivables where the current date is past the `due_date`.</li>
              <li><strong>Disputed Amount:</strong> Financial value associated with Disputes in an open state (excluding CLOSED or fully RESOLVED).</li>
            </ul>

            <h4 style={{ marginBottom: 5 }}>Trading Definitions</h4>
            <ul style={{ paddingLeft: 20 }}>
              <li><strong>Trading Revenue:</strong> Total gross amount from all trading invoices.</li>
              <li><strong>Trading Margin / Profitability:</strong> SJVN's specific cut/margin (`sjvn_margin`) applied to executed trades. Realized and Unrealized margins are combined here.</li>
              <li><strong>Outstanding:</strong> Value of trading invoices that are not PAID or SETTLED_VIA_NETTING.</li>
            </ul>
          </div>
        </Modal>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          .dashboard-container { padding: 0; background: white; }
          .card { box-shadow: none !important; border: 1px solid #ddd !important; break-inside: avoid; }
        }
        .print-only { display: none; }
      `}</style>
    </div>
  );
}
