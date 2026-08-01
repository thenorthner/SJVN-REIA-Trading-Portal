import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/client.js';
import { PageHeader, StatCard, Card, fmtCurrency, fmtNumber, Badge, Modal } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../roles.js';

const REPORT_ICONS = {
  billing: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
  energy: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  dispute: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m14 13 5 5" />
      <path d="m3 21 5-5" />
      <path d="m10 8 3 3" />
      <path d="m6 12 3 3" />
      <path d="m11 3 3 3" />
      <path d="m15 7 3 3" />
    </svg>
  ),
  recon: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6" />
      <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
    </svg>
  ),
  contract: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  reiaSnapshot: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  ),
  tradingSnapshot: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  analytics: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  financial: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12" />
      <path d="M6 8h12" />
      <path d="M6 13h8" />
      <path d="M6 13c3.5 0 6 2.5 6 6" />
      <path d="M6 3v10" />
    </svg>
  ),
  noar: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <polyline points="9 14 11 16 15 12" />
    </svg>
  ),
  activity: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  regulatory: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  ),
  audit: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  mis: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 17V9" /><path d="M13 17V5" /><path d="M17 17v-4" />
    </svg>
  ),
};

const SECTION_ICONS = {
  REIA: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  TRADING: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  GOVERNANCE: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  COMPLIANCE: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
  MANAGEMENT: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 17V9" /><path d="M13 17V5" /><path d="M17 17v-4" />
    </svg>
  ),
};

const REPORT_GROUPS = [
  {
    vertical: 'REIA',
    label: 'REIA – Billing & Settlement',
    reports: [
      { path: '/reports/billing-summary/pdf', file: 'SJVN_Billing_Report.pdf', title: 'Billing Summary', blurb: 'Month-wise sales, purchases, margin, LPS and collections.', iconType: 'billing', iconBg: '#e0f2fe', iconColor: 'var(--sky)' },
      { path: '/reports/energy-summary/pdf', file: 'SJVN_Energy_Report.pdf', title: 'Energy Data & Validation', blurb: 'Provisional vs final energy per contract, CUF and availability.', iconType: 'energy', iconBg: '#dcfce7', iconColor: 'var(--green-strong)' },
      { path: '/reports/dispute-summary/pdf', file: 'SJVN_Dispute_Report.pdf', title: 'Dispute Summary', blurb: 'Open disputes by reason and ageing, with SLA breaches.', iconType: 'dispute', iconBg: '#fef3c7', iconColor: '#d97706' },
      { path: '/reports/recon-summary/pdf', file: 'SJVN_Reconciliation_Report.pdf', title: 'Reconciliation', blurb: 'Metered vs billed vs paid, and unresolved variances.', iconType: 'recon', iconBg: '#f3e8ff', iconColor: '#9333ea' },
      { path: '/reports/contract-summary/pdf', file: 'SJVN_Contract_Report.pdf', title: 'Contract Summary', blurb: 'PPA/PSA portfolio, capacity and tariff position.', iconType: 'contract', iconBg: '#e0f2fe', iconColor: 'var(--sky)' },
      { path: '/reports/reia-dashboard/pdf', file: 'SJVN_REIA_Dashboard_Snapshot.pdf', title: 'REIA Dashboard Snapshot', blurb: 'Point-in-time snapshot of the REIA dashboard KPIs.', iconType: 'reiaSnapshot', iconBg: '#ccfbf1', iconColor: '#0d9488' },
    ],
  },
  {
    vertical: 'TRADING',
    label: 'Power Trading',
    reports: [
      { path: '/reports/trading-dashboard/pdf', file: 'SJVN_Trading_Dashboard.pdf', title: 'Trading Dashboard Snapshot', blurb: 'Open positions, client exposure utilisation, today\'s bidding and volume trend.', iconType: 'tradingSnapshot', iconBg: '#fae8ff', iconColor: '#c026d3' },
      { path: '/reports/market-analytics/pdf', file: 'SJVN_Market_Analytics.pdf', title: 'Market Rates & Analytics', blurb: 'Exchange price comparison, forecast accuracy and our execution vs market.', iconType: 'analytics', iconBg: '#fef3c7', iconColor: '#d97706' },
      { path: '/reports/trading-profitability/pdf', file: 'SJVN_Trading_Profitability.pdf', title: 'Financial & Profitability', blurb: 'Margin by stream — REC, bilateral and exchange — net of open access charges.', iconType: 'financial', iconBg: '#dcfce7', iconColor: '#16a34a' },
      { path: '/bilateral/noar-approval-report.pdf', file: 'SJVN_NOAR_Approval_Report.pdf', title: 'NOAR Approval Tracking', blurb: 'Open-access approval SLA performance and pending applications.', iconType: 'noar', iconBg: '#e0f2fe', iconColor: '#0284c7' },
    ],
  },
  {
    vertical: 'GOVERNANCE',
    label: 'Governance & Assurance',
    reports: [
      { path: '/reports/audit/pdf', file: 'SJVN_Audit_Report.pdf', title: 'Audit Report', blurb: 'Chain integrity, segregation of duties and privileged actions.', iconType: 'audit', iconBg: '#dcfce7', iconColor: '#16a34a' },
      { path: '/reports/activity/pdf', file: 'SJVN_Activity_Report.pdf', title: 'Activity Report', blurb: 'Who did what across modules — by user, module, action and day.', iconType: 'activity', iconBg: '#f3e8ff', iconColor: '#9333ea' },
    ],
  },
  {
    vertical: 'COMPLIANCE',
    label: 'Compliance',
    reports: [
      { path: '/reports/regulatory/pdf', file: 'SJVN_Regulatory_Report.pdf', title: 'Regulatory Report', blurb: 'Counterparty approval completeness, outstanding approvals and CERC filing status.', iconType: 'regulatory', iconBg: '#ccfbf1', iconColor: '#0d9488' },
    ],
  },
  {
    // Cross-vertical management pack — executive audience only.
    vertical: 'MANAGEMENT',
    label: 'Management',
    reports: [
      { path: '/reports/mis/pdf', file: 'SJVN_Internal_MIS.pdf', title: 'Internal MIS', blurb: 'Enterprise pack: portfolio, REIA billing, trading margin and cross-module risk rollup.', iconType: 'mis', iconBg: '#e0e7ff', iconColor: '#4338ca' },
    ],
  },
];

export default function ConsolidatedDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showGlossary, setShowGlossary] = useState(false);
  const [busyReport, setBusyReport] = useState(null);
  const [reportError, setReportError] = useState('');

  async function pullReport(r) {
    setBusyReport(r.path);
    setReportError('');
    try {
      await api.reports.downloadPdf(r.path, r.file);
    } catch (err) {
      setReportError(`${r.title}: ${err.message || 'could not be generated.'}`);
    } finally {
      setBusyReport(null);
    }
  }

  useEffect(() => {
    api.dashboard.consolidated().then((res) => setData(res.portfolio)).catch(() => setError('Failed to load dashboard.'));
  }, []);

  if (error) return <div className="empty-state"><h3>Something went wrong</h3><p>{error}</p></div>;
  if (!data) return <div className="page-loading">Loading dashboard...</div>;

  const canViewReia = ROLE_GROUPS.REIA_ALL.includes(user.role);
  const canViewTrading = ROLE_GROUPS.TRADING_ALL.includes(user.role);
  // Governance reports carry per-person activity, so they are gated separately
  // from the module reports rather than riding on either vertical.
  const visibleVerticals = {
    REIA: canViewReia,
    TRADING: canViewTrading,
    GOVERNANCE: ROLE_GROUPS.GOVERNANCE_REPORTS.includes(user.role),
    COMPLIANCE: canViewReia || canViewTrading,
    MANAGEMENT: ROLE_GROUPS.EXECUTIVE.includes(user.role),
  };

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
              <button className="btn btn-outline" disabled={busyReport === '/reports/mis/pdf'}
                onClick={() => pullReport({ path: '/reports/mis/pdf', file: 'SJVN_Internal_MIS.pdf', title: 'Internal MIS' })}>
                {busyReport === '/reports/mis/pdf' ? 'Preparing…' : 'Internal MIS (PDF)'}
              </button>
              <button className="btn" onClick={handlePrint}>Print View</button>
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
      <Card style={{ marginBottom: 20, backgroundColor: '#f8faff', borderLeft: '4px solid var(--primary)' }}>
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
            <div style={{ width: '100%', backgroundColor: 'var(--slate-200)', borderRadius: 8, height: 24, overflow: 'hidden' }}>
              <div style={{ width: `${capacityProgress}%`, backgroundColor: 'var(--primary)', height: '100%', transition: 'width 0.5s ease' }} />
            </div>
            <p style={{ textAlign: 'right', marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>{capacityProgress.toFixed(1)}% achieved</p>
          </div>
        </Card>
      </div>

      <h3 style={{ margin: '30px 0 15px 0', color: '#1c2536', borderBottom: '1px solid #eee', paddingBottom: 10 }}>Portfolio Overview</h3>
      <div className="kpi-grid">
        <StatCard label="Total Portfolio Billed Value" value={fmtCurrency(data.totalPortfolioValue)} tone="blue" hint={<div>MoM Trend: {getTrendIcon(data.revenueTrend)}</div>} onClick={() => navigate('/reia')} />
        <StatCard label="Overall Trading Profitability" value={fmtCurrency(data.overallProfitability)} tone="green" hint="SJVN trading margin across all trades" onClick={() => navigate('/trading')} />
      </div>

      {canViewReia && (
        <>
          <h3 style={{ margin: '30px 0 15px 0', color: '#1c2536', borderBottom: '1px solid #eee', paddingBottom: 10 }}>REIA Billing & Settlement</h3>
          <div className="kpi-grid">
            <StatCard label="Contracted RE Capacity" value={`${fmtNumber(data.reiaContractedCapacity)} MW`} onClick={() => navigate('/reia/contracts')} />
            <StatCard label="REIA Receivables" value={fmtCurrency(data.reiaReceivables)} hint="Unpaid from buyers" onClick={() => navigate('/reia/invoices')} />
            <StatCard label="REIA Overdue" value={fmtCurrency(data.reiaOverdue)} tone={data.reiaOverdue > 100000 ? 'red' : 'amber'} hint="Past due date" onClick={() => navigate('/reia/invoices')} />
            <StatCard label="Disputed Amount" value={fmtCurrency(data.reiaDisputedAmount)} tone={data.reiaDisputedAmount > 50000 ? 'red' : 'default'} onClick={() => navigate('/reia/disputes')} />
            <StatCard label="Open Disputes" value={data.reiaOpenDisputes} tone={data.reiaOpenDisputes > 0 ? 'red' : 'default'} onClick={() => navigate('/reia/disputes')} />
            <StatCard label="Recon Exceptions" value={data.reiaReconExceptions} tone={data.reiaReconExceptions > 0 ? 'red' : 'default'} onClick={() => navigate('/reia/reconciliation')} />
          </div>
        </>
      )}

      {canViewTrading && (
        <>
          <h3 style={{ margin: '30px 0 15px 0', color: '#1c2536', borderBottom: '1px solid #eee', paddingBottom: 10 }}>Power Trading Operations</h3>
          <div className="kpi-grid">
            <StatCard label="Trading Revenue" value={fmtCurrency(data.tradingRevenue)} tone="blue" onClick={() => navigate('/trading/billing-settlement')} />
            <StatCard label="Trading Margin" value={fmtCurrency(data.tradingMargin)} tone="green" onClick={() => navigate('/trading/market-analytics')} />
            <StatCard label="Trading Outstanding" value={fmtCurrency(data.tradingOutstanding)} tone={data.tradingOutstanding > 500000 ? 'red' : 'amber'} hint="Unpaid trading invoices" onClick={() => navigate('/trading/billing-settlement')} />
            <StatCard label="Trading Cleared Quantum" value={`${fmtNumber(data.tradingClearedQuantum)} MW`} onClick={() => navigate('/trading/bids')} />
          </div>
        </>
      )}

      <div className="grid-2" style={{ marginTop: 24 }}>
        <Card title="Business Vertical Revenue Comparison">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1e7).toFixed(1)}Cr`} />
                <Tooltip formatter={(v) => fmtCurrency(v)} />
                <Legend />
                <Bar dataKey="Value" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Reports & Dashboards Section */}
      <div className="no-print" style={{ marginTop: 32 }}>
        {/* Banner Card with Header & Decorative Graphic */}
        <div style={{
          background: '#ffffff',
          border: '1px solid var(--slate-200)',
          borderRadius: '16px',
          padding: '24px 32px',
          marginBottom: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--slate-900)', letterSpacing: '-0.02em' }}>
              Reports &amp; Dashboards
            </h2>
            <p style={{ margin: '6px 0 0 0', fontSize: '14px', color: 'var(--slate-500)' }}>
              Access and download key operational reports across all modules.
            </p>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <svg width="140" height="76" viewBox="0 0 140 76" fill="none">
              <rect x="15" y="8" width="85" height="60" rx="8" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="1.5" />
              <rect x="25" y="20" width="42" height="5" rx="2.5" fill="var(--primary)" />
              <rect x="25" y="30" width="60" height="4" rx="2" fill="#93c5fd" />
              <rect x="25" y="38" width="50" height="4" rx="2" fill="var(--slate-300)" />
              <rect x="25" y="46" width="35" height="4" rx="2" fill="var(--slate-300)" />
              <circle cx="82" cy="46" r="13" fill="var(--primary)" opacity="0.1" />
              <path d="M75 50L80 43L84 46L89 40" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="80" y="14" width="45" height="52" rx="7" fill="#ffffff" stroke="#93c5fd" strokeWidth="1.5" />
              <rect x="87" y="22" width="28" height="4" rx="2" fill="var(--primary)" />
              <rect x="87" y="30" width="22" height="3" rx="1.5" fill="var(--slate-400)" />
              <rect x="87" y="36" width="24" height="3" rx="1.5" fill="var(--slate-300)" />
              <rect x="87" y="42" width="16" height="3" rx="1.5" fill="#60a5fa" />
              <circle cx="106" cy="53" r="5" fill="#10b981" />
              <path d="M104 53L105.5 54.5L108 52" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {reportError && (
          <div style={{ color: 'var(--red-deep)', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
            {reportError}
          </div>
        )}

        {REPORT_GROUPS.filter((grp) => visibleVerticals[grp.vertical]).map((grp) => (
          <div key={grp.vertical} style={{ marginBottom: 28 }}>
            {/* Section Header with Icon */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {SECTION_ICONS[grp.vertical]}
              </div>
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--primary)', letterSpacing: '0.1px' }}>
                {grp.label}
              </span>
            </div>

            {/* Grid of Report Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
              {grp.reports.map((r) => (
                <div
                  key={r.path}
                  className="report-card-item"
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--slate-200)',
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.2s ease',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                  }}
                >
                  {/* Round Icon Badge */}
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '50%',
                      background: r.iconBg,
                      color: r.iconColor,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '14px',
                      flexShrink: 0,
                    }}
                  >
                    {REPORT_ICONS[r.iconType]}
                  </div>

                  {/* Title & Blurb */}
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--slate-900)', marginBottom: '6px', lineHeight: 1.3 }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate-500)', lineHeight: '1.45', marginBottom: '16px', flex: 1 }}>
                    {r.blurb}
                  </div>

                  {/* Download PDF Button */}
                  <button
                    type="button"
                    className="report-download-btn"
                    disabled={busyReport === r.path}
                    onClick={() => pullReport(r)}
                    style={{
                      alignSelf: 'flex-start',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: '1px solid var(--slate-300)',
                      background: '#ffffff',
                      color: 'var(--slate-900)',
                      fontSize: '12px',
                      fontWeight: 500,
                      cursor: busyReport === r.path ? 'not-allowed' : 'pointer',
                      opacity: busyReport === r.path ? 0.6 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>{busyReport === r.path ? 'Preparing…' : 'Download PDF'}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
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
