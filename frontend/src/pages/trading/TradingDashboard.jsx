import React, { useEffect, useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../../api/client.js';
import { PageHeader, StatCard, Card, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const COLORS = ['#0b5fff', '#12875a', '#b3760a', '#c22b3a', '#1f5cd6', '#7a5bd6'];

export default function TradingDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.dashboard.trading().then(setData).catch(() => {});
  }, []);

  if (!data) return <div className="page-loading">Loading trading dashboard...</div>;
  const { kpis, byExchange, byProduct, byClient } = data;
  const clearanceRate = kpis.totalQuantumBid > 0 ? (kpis.totalQuantumCleared / kpis.totalQuantumBid) * 100 : 0;

  return (
    <div>
      <PageHeader title="Power Trading Dashboard" subtitle="Exchange bidding, bilateral transactions and trading revenue overview" />

      <div className="kpi-grid">
        <StatCard label="Total Bids" value={kpis.totalBids} tone="blue" />
        <StatCard label="Cleared Bids" value={kpis.clearedBids} tone="green" />
        <StatCard label="Quantum Bid" value={`${fmtNumber(kpis.totalQuantumBid)} MW`} />
        <StatCard label="Quantum Cleared" value={`${fmtNumber(kpis.totalQuantumCleared)} MW`} hint={`${fmtNumber(clearanceRate)}% clearance rate`} tone="green" />
        <StatCard label="Active Clients" value={kpis.activeClients} />
        <StatCard label="Active Bilateral Deals" value={kpis.activeBilateral} />
        <StatCard label="Pending Open Access" value={kpis.pendingOpenAccess} tone={kpis.pendingOpenAccess > 0 ? 'amber' : 'default'} />
        <StatCard label="Trading Revenue" value={fmtCurrency(kpis.totalTradingRevenue)} tone="blue" />
        <StatCard label="Trading Margin" value={fmtCurrency(kpis.tradingMarginTotal)} tone="green" />
        <StatCard label="Amount Received" value={fmtCurrency(kpis.totalTradingReceived)} tone="green" />
      </div>

      <div className="grid-2">
        <Card title="Bid vs Cleared Quantum by Exchange">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byExchange}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                <XAxis dataKey="exchange" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="quantum" name="Bid (MW)" fill="#0b5fff" radius={[6, 6, 0, 0]} />
                <Bar dataKey="cleared" name="Cleared (MW)" fill="#12875a" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Bids by Product">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byProduct} dataKey="bids" nameKey="product" outerRadius={95} label={(e) => `${e.product} (${e.bids})`}>
                  {byProduct.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Cleared Quantum by Client">
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byClient}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
              <XAxis dataKey="client_name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="cleared" name="Cleared (MW)" fill="#1f5cd6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
