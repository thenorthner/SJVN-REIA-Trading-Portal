import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../../api/client.js';
import { PageHeader, StatCard, Card, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

const COLORS = ['#0b5fff', '#12875a', '#b3760a', '#c22b3a', '#1f5cd6', '#7a5bd6'];

export default function ReiaDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    api.dashboard.reia().then(setData).catch(() => {});
  }, []);

  async function downloadDashboardPdf() {
    setPdfLoading(true);
    try {
      await api.reports.reiaDashboardPdf();
    } catch (err) {
      alert(err.message || 'Failed to download REIA dashboard PDF');
    } finally {
      setPdfLoading(false);
    }
  }

  if (!data) return <div className="page-loading">Loading REIA dashboard...</div>;
  const { kpis, byStatus, byProjectType, monthlyBilling } = data;

  return (
    <div>
      <PageHeader
        title="REIA Billing & Settlement Dashboard"
        subtitle="Contracts, energy accounting, billing and receivables overview"
        actions={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={pdfLoading} onClick={downloadDashboardPdf}>
              {pdfLoading ? 'Preparing PDF…' : 'Download PDF Snapshot'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/reia/reports')}>
              Billing Reports
            </button>
          </div>
        }
      />

      <div className="kpi-grid">
        <StatCard label="Active Contracts" value={kpis.activeContracts} tone="blue" />
        <StatCard label="Contracted Capacity" value={`${fmtNumber(kpis.contractedCapacity)} MW`} tone="green" />
        <StatCard label="Energy Supplied" value={`${fmtNumber(kpis.energySupplied)} MWh`} />
        <StatCard label="Total Invoices" value={kpis.totalInvoices} hint={fmtCurrency(kpis.totalInvoiceValue)} />
        <StatCard label="Pending Approvals" value={kpis.pendingApprovals} tone={kpis.pendingApprovals > 0 ? 'amber' : 'default'} />
        <StatCard label="Open Disputes" value={kpis.pendingDisputes} tone={kpis.pendingDisputes > 0 ? 'red' : 'default'} />
        <StatCard label="Reconciliation Exceptions" value={kpis.reconciliationExceptions} tone={kpis.reconciliationExceptions > 0 ? 'red' : 'default'} />
        <StatCard label="Securities Expiring (60d)" value={kpis.expiringSecurities} tone={kpis.expiringSecurities > 0 ? 'amber' : 'default'} />
        <StatCard label="Receivables (from Buyers)" value={fmtCurrency(kpis.receivables)} tone="amber" />
        <StatCard label="Payables (to Sellers)" value={fmtCurrency(kpis.payables)} tone="amber" />
        <StatCard label="Payments Received" value={fmtCurrency(kpis.paymentsReceived)} tone="green" />
        <StatCard label="Payments Disbursed" value={fmtCurrency(kpis.paymentsDisbursed)} tone="green" />
        <StatCard label="Overdue Invoices" value={kpis.overdue} tone={kpis.overdue > 0 ? 'red' : 'default'} />
      </div>

      <div className="grid-2">
        <Card title="Monthly Billing Trend">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyBilling}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
                <XAxis dataKey="billing_period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1e7).toFixed(1)}Cr`} />
                <Tooltip formatter={(v) => fmtCurrency(v)} />
                <Legend />
                <Line type="monotone" dataKey="total" name="Billed Amount" stroke="#0b5fff" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Contracted Capacity by Project Type">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byProjectType} dataKey="capacity" nameKey="project_type" outerRadius={95} label={(e) => `${e.project_type} (${fmtNumber(e.capacity)} MW)`}>
                  {byProjectType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => `${fmtNumber(v)} MW`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Invoices by Status">
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byStatus}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ed" />
              <XAxis dataKey="status" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="c" name="Invoice count" fill="#1f5cd6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
