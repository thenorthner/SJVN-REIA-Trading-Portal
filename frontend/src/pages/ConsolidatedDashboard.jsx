import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Zap, AlertCircle, FileSearch, CheckCircle, PieChart, TrendingUp, BarChart3, Clock, ShieldCheck, Activity, LineChart, FileSpreadsheet, Sparkles } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../api/client.js';
import { PageHeader, StatCard, Card, fmtCurrency, fmtNumber, Badge } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useGigw } from '../gigw/GigwContext.jsx';
import { ROLE_GROUPS } from '../roles.js';

const REPORT_ICONS = {
  billing: <FileText size={20} strokeWidth={2} />,
  energy: <Zap size={20} strokeWidth={2} />,
  dispute: <AlertCircle size={20} strokeWidth={2} />,
  recon: <FileSearch size={20} strokeWidth={2} />,
  contract: <CheckCircle size={20} strokeWidth={2} />,
  reiaSnapshot: <PieChart size={20} strokeWidth={2} />,
  tradingSnapshot: <TrendingUp size={20} strokeWidth={2} />,
  analytics: <BarChart3 size={20} strokeWidth={2} />,
  financial: <LineChart size={20} strokeWidth={2} />,
  noar: <Clock size={20} strokeWidth={2} />,
  activity: <Activity size={20} strokeWidth={2} />,
  regulatory: <ShieldCheck size={20} strokeWidth={2} />,
  audit: <ShieldCheck size={20} strokeWidth={2} />,
  mis: <FileSpreadsheet size={20} strokeWidth={2} />,
};

const SECTION_ICONS = {
  REIA: <FileText size={18} strokeWidth={2} color="var(--primary)" />,
  TRADING: <Zap size={18} strokeWidth={2} color="var(--primary)" />,
  GOVERNANCE: <ShieldCheck size={18} strokeWidth={2} color="var(--primary)" />,
  COMPLIANCE: <CheckCircle size={18} strokeWidth={2} color="var(--primary)" />,
  MANAGEMENT: <FileSpreadsheet size={18} strokeWidth={2} color="var(--primary)" />,
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
  const { tUI } = useGigw();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
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
    if (val > 0) return <span style={{ color: 'var(--on-green)' }}>↑ {val.toFixed(1)}%</span>;
    if (val < 0) return <span style={{ color: 'var(--on-red)' }}>↓ {Math.abs(val).toFixed(1)}%</span>;
    return <span style={{ color: 'var(--slate-500)' }}>— 0%</span>;
  };

  const capacityProgress = Math.min((data.reiaContractedCapacity / data.targetCapacity) * 100, 100);

  return (
    <div className="dashboard-container">
      <div className="no-print">
        <PageHeader
          title={tUI("Consolidated Executive Dashboard")}
          subtitle={tUI("Enterprise-wide portfolio view, risk rollup, and MIS")}
          actions={
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline" disabled={busyReport === '/reports/mis/pdf'}
                onClick={() => pullReport({ path: '/reports/mis/pdf', file: 'SJVN_Internal_MIS.pdf', title: 'Internal MIS' })}>
                {busyReport === '/reports/mis/pdf' ? tUI('Preparing…') : tUI('Internal MIS (PDF)')}
              </button>
              <button className="btn" onClick={handlePrint}>{tUI('Print View')}</button>
            </div>
          }
        />
      </div>

      <div className="print-only">
        <h1>{tUI('Executive Dashboard - SJVN RE Commercial & Trading')}</h1>
        <p>Report generated on: {new Date().toLocaleString()}</p>
        <hr style={{ margin: '20px 0' }} />
      </div>

      {/* Auto-generated Executive Summary Hero */}
      <div className="elite-hero-banner animate-fade-in-up stagger-1" style={{ marginBottom: 24 }}>
        <div className="elite-hero-header">
          <div className="elite-hero-title-group">
            <div className="elite-hero-icon-badge">
              <Sparkles size={18} strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="elite-hero-title">{tUI('Executive Summary & Strategic Brief')}</h2>
              <div className="elite-hero-subtitle">{tUI('Real-time cross-module portfolio synthesis & risk rollup')}</div>
            </div>
          </div>
          {data.totalUnresolvedExposure > 500000 ? (
            <div className="elite-hero-badge warning">
              <AlertCircle size={13} strokeWidth={2.5} /> {tUI('Attention Required: Risk Exposure')}
            </div>
          ) : (
            <div className="elite-hero-badge success">
              <CheckCircle size={13} strokeWidth={2.5} /> {tUI('Portfolio Operations Nominal')}
            </div>
          )}
        </div>

        <p className="elite-hero-text">
          {tUI(data.executiveSummary)}
        </p>

        <div className="elite-hero-metrics">
          <div className="elite-hero-metric-card">
            <div className="elite-hero-metric-label">{tUI('Contracted RE Capacity')}</div>
            <div className="elite-hero-metric-val">
              {fmtNumber(data.reiaContractedCapacity)} <span style={{ fontSize: 14.5, fontWeight: 500, color: '#94a3b8' }}>MW</span>
            </div>
            <div className="elite-hero-metric-sub">
              {capacityProgress.toFixed(1)}% {tUI('of 20 GW Target')} ({fmtNumber(data.targetCapacity)} MW)
            </div>
          </div>

          <div className="elite-hero-metric-card">
            <div className="elite-hero-metric-label">{tUI('Billing Momentum')}</div>
            <div className="elite-hero-metric-val" style={{ color: data.revenueTrend >= 0 ? '#4ade80' : '#f87171' }}>
              <TrendingUp size={16} strokeWidth={2.5} style={{ transform: data.revenueTrend < 0 ? 'rotate(180deg)' : 'none' }} />
              {data.revenueTrend >= 0 ? '+' : ''}{data.revenueTrend.toFixed(1)}%
            </div>
            <div className="elite-hero-metric-sub">{tUI('Month-on-Month Revenue Velocity')}</div>
          </div>

          <div className="elite-hero-metric-card" style={{ borderColor: data.totalUnresolvedExposure > 500000 ? 'rgba(239, 68, 68, 0.25)' : undefined }}>
            <div className="elite-hero-metric-label">{tUI('Cross-Module Exposure')}</div>
            <div className="elite-hero-metric-val" style={{ color: data.totalUnresolvedExposure > 500000 ? '#fca5a5' : '#f8fafc' }}>
              ₹{(data.totalUnresolvedExposure / 1e7).toFixed(2)} <span style={{ fontSize: 14.5, fontWeight: 500, color: '#94a3b8' }}>Cr</span>
            </div>
            <div className="elite-hero-metric-sub">
              {data.totalUnresolvedExposure > 500000 ? tUI('Disputed & overdue exposure pending resolution') : tUI('Contained within operational threshold')}
            </div>
          </div>
        </div>
      </div>

      {/* Cross-Module Risk & Target Panel */}
      <div className="grid-2 animate-fade-in-up stagger-2" style={{ marginBottom: 24 }}>
        <Card title={tUI("Enterprise Risk Rollup")}>
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">{tUI('Total Unresolved Exposure')}</span>
              <span className="detail-value" style={{ color: data.totalUnresolvedExposure > 500000 ? 'var(--on-red)' : 'var(--on-green)' }}>
                {fmtCurrency(data.totalUnresolvedExposure)}
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">{tUI('Payment Security Coverage')}</span>
              <span className="detail-value">
                <Badge type={data.coverageRatio >= 100 ? 'success' : (data.coverageRatio > 50 ? 'warning' : 'danger')}>
                  {data.coverageRatio.toFixed(1)}%
                </Badge>
              </span>
            </div>
            <div className="detail-item">
              <span className="detail-label">{tUI('Data Validation Completeness')}</span>
              <span className="detail-value">{data.dataCompleteness}%</span>
            </div>
          </div>
        </Card>

        <Card title={tUI("Capacity Growth Target (20 GW Vision)")}>
          <div style={{ padding: '20px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>{tUI('Current:')} {fmtNumber(data.reiaContractedCapacity)} MW</strong>
              <strong>{tUI('Target:')} {fmtNumber(data.targetCapacity)} MW</strong>
            </div>
            <div style={{ width: '100%', backgroundColor: 'var(--slate-200)', borderRadius: 8, height: 24, overflow: 'hidden' }}>
              <div style={{ width: `${capacityProgress}%`, backgroundColor: 'var(--primary)', height: '100%', transition: 'width 0.5s ease' }} />
            </div>
            <p style={{ textAlign: 'right', marginTop: 8, fontSize: 14.5, color: 'var(--text-muted)' }}>{capacityProgress.toFixed(1)}% {tUI('achieved')}</p>
          </div>
        </Card>
      </div>

      <h3 className="animate-fade-in-up stagger-3" style={{ margin: '30px 0 15px 0', color: 'var(--on-blue)', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>{tUI('Portfolio Overview')}</h3>
      <div className="kpi-grid animate-fade-in-up stagger-3">
        <StatCard label="Total Portfolio Billed Value" value={fmtCurrency(data.totalPortfolioValue)} tone="blue" hint={<div>MoM Trend: {getTrendIcon(data.revenueTrend)}</div>} onClick={() => navigate('/reia')} />
        <StatCard label="Overall Trading Profitability" value={fmtCurrency(data.overallProfitability)} tone="green" hint="SJVN trading margin across all trades" onClick={() => navigate('/trading')} />
      </div>

      {canViewReia && (
        <>
          <h3 className="animate-fade-in-up stagger-4" style={{ margin: '30px 0 15px 0', color: 'var(--on-blue)', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>REIA Billing & Settlement</h3>
          <div className="kpi-grid animate-fade-in-up stagger-4">
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
          <h3 className="animate-fade-in-up stagger-5" style={{ margin: '30px 0 15px 0', color: 'var(--on-blue)', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>Power Trading Operations</h3>
          <div className="kpi-grid animate-fade-in-up stagger-5">
            <StatCard label="Trading Revenue" value={fmtCurrency(data.tradingRevenue)} tone="blue" onClick={() => navigate('/trading/billing-settlement')} />
            <StatCard label="Trading Margin" value={fmtCurrency(data.tradingMargin)} tone="green" onClick={() => navigate('/trading/market-analytics')} />
            <StatCard label="Trading Outstanding" value={fmtCurrency(data.tradingOutstanding)} tone={data.tradingOutstanding > 500000 ? 'red' : 'amber'} hint="Unpaid trading invoices" onClick={() => navigate('/trading/billing-settlement')} />
            <StatCard label="Trading Cleared Quantum" value={`${fmtNumber(data.tradingClearedQuantum)} MW`} onClick={() => navigate('/trading/bids')} />
          </div>
        </>
      )}

      <div className="grid-2 animate-fade-in-up stagger-4" style={{ marginTop: 28 }}>
        <Card title="Business Vertical Revenue Comparison">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChart}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.9}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.6}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fontSize: 15 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 15 }} tickFormatter={(v) => `₹${(v / 1e7).toFixed(1)}Cr`} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => fmtCurrency(v)} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                <Legend />
                <Bar dataKey="Value" fill="url(#colorValue)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Reports & Dashboards Section */}
      <div className="no-print animate-fade-in-up stagger-5" style={{ marginTop: 32 }}>
        {/* Banner Card with Header & Decorative Graphic */}
        <div style={{
          background: 'var(--surface)',
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
            <p style={{ margin: '6px 0 0 0', fontSize: '15.5px', color: 'var(--slate-500)' }}>
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
              <circle cx="106" cy="53" r="5" fill="url(#eliteGreen)" />
              <path d="M104 53L105.5 54.5L108 52" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {reportError && (
          <div style={{ color: 'var(--red-deep)', background: 'var(--t-red-50)', border: '1px solid var(--t-red-line)', borderRadius: 8, padding: '10px 14px', fontSize: 14.5, marginBottom: 16 }}>
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
              <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--primary)', letterSpacing: '0.1px' }}>
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
                    background: 'var(--surface)',
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
                  <div style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--slate-900)', marginBottom: '6px', lineHeight: 1.3 }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: '15px', color: 'var(--slate-500)', lineHeight: '1.45', marginBottom: '16px', flex: 1 }}>
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
                      background: 'var(--surface)',
                      color: 'var(--slate-900)',
                      fontSize: '15px',
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

      <style>{`
        @media print {
          * { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important; }
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
