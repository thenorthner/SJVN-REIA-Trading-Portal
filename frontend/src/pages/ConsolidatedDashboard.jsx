import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/client.js';
import { PageHeader, StatCard, Card, fmtCurrency, fmtNumber } from '../components/ui.jsx';

export default function ConsolidatedDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.dashboard.consolidated().then((res) => setData(res.portfolio)).catch(() => setError('Failed to load dashboard.'));
  }, []);

  if (error) return <div className="empty-state"><h3>Something went wrong</h3><p>{error}</p></div>;
  if (!data) return <div className="page-loading">Loading dashboard...</div>;

  const revenueChart = [
    { name: 'REIA Billing', Value: data.reiaBilledValue },
    { name: 'Trading Revenue', Value: data.tradingRevenue },
  ];

  return (
    <div>
      <PageHeader
        title="Consolidated Executive Dashboard"
        subtitle="Portfolio-wide view across REIA Billing &amp; Settlement and Power Trading operations"
      />

      <div className="kpi-grid">
        <StatCard label="Total Portfolio Value" value={fmtCurrency(data.totalPortfolioValue)} tone="blue" hint="REIA billed value + trading revenue" />
        <StatCard label="Contracted RE Capacity" value={`${fmtNumber(data.reiaContractedCapacity)} MW`} tone="green" />
        <StatCard label="REIA Receivables" value={fmtCurrency(data.reiaReceivables)} tone="amber" hint="From buyers, not yet paid" />
        <StatCard label="REIA Payables" value={fmtCurrency(data.reiaPayables)} tone="amber" hint="To sellers, not yet paid" />
        <StatCard label="Open Disputes" value={data.reiaOpenDisputes} tone={data.reiaOpenDisputes > 0 ? 'red' : 'default'} />
        <StatCard label="Reconciliation Exceptions" value={data.reiaReconExceptions} tone={data.reiaReconExceptions > 0 ? 'red' : 'default'} />
        <StatCard label="Trading Revenue" value={fmtCurrency(data.tradingRevenue)} tone="blue" />
        <StatCard label="Trading Margin (Profitability)" value={fmtCurrency(data.tradingMargin)} tone="green" />
        <StatCard label="Trading Outstanding" value={fmtCurrency(data.tradingOutstanding)} tone="amber" />
        <StatCard label="Trading Cleared Quantum" value={`${fmtNumber(data.tradingClearedQuantum)} MW`} />
      </div>

      <div className="grid-2">
        <Card title="Business Vertical Comparison">
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

        <Card title="Overall Business Health">
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Net Profitability (Trading Margin)</span>
              <span className="detail-value" style={{ color: 'var(--green)' }}>{fmtCurrency(data.overallProfitability)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">REIA Billed Value</span>
              <span className="detail-value">{fmtCurrency(data.reiaBilledValue)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Trading Revenue</span>
              <span className="detail-value">{fmtCurrency(data.tradingRevenue)}</span>
            </div>
            <div className="detail-item">
              <span className="detail-label">Net Receivable Position</span>
              <span className="detail-value">{fmtCurrency(data.reiaReceivables - data.reiaPayables)}</span>
            </div>
          </div>
          <p className="inline-note">
            This view consolidates the REIA Billing &amp; Settlement and Power Trading Management modules into a single
            executive snapshot. Drill into each module from the sidebar for detailed operations.
          </p>
        </Card>
      </div>
    </div>
  );
}
