import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client.js';
import { PageHeader, Card, fmtCurrency, fmtNumber } from '../../components/ui.jsx';

function StatCard({ label, value, sub, color, onClick }) {
  return (
    <div className="stat-card" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function BuyerDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.buyerDashboard()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading dashboard...</div>;
  if (!stats) return <div className="empty-state"><h3>Unable to load dashboard</h3><p>Your account may not be linked to a buyer entity. Contact SJVN admin.</p></div>;

  return (
    <div>
      <PageHeader
        title="Buyer Dashboard"
        subtitle="Welcome back — here is the summary of your Power Sale Agreements (PSAs) and payables"
      />

      {/* Row 1: Contracts & Invoices */}
      <div className="stat-grid">
        <StatCard label="ACTIVE PSAs" value={stats.active_contracts} onClick={() => navigate('/buyer/contracts')} />
        <StatCard label="ALLOCATED CAPACITY" value={`${fmtNumber(stats.total_capacity_mw)} MW`} />
        <StatCard label="TOTAL INVOICES RECEIVED" value={stats.total_invoices} onClick={() => navigate('/buyer/invoices')} />
        <StatCard label="PENDING INVOICES" value={stats.pending_invoices} color={stats.pending_invoices > 0 ? '#e67e22' : undefined} onClick={() => navigate('/buyer/invoices')} />
      </div>

      {/* Row 2: Financials */}
      <div className="stat-grid">
        <StatCard label="TOTAL PAYABLE (LIFETIME)" value={fmtCurrency(stats.total_payable)} />
        <StatCard label="TOTAL PAID TO SJVN" value={fmtCurrency(stats.total_paid)} color="var(--success)" onClick={() => navigate('/buyer/payments')} />
        <StatCard label="PENDING AMOUNT" value={fmtCurrency(stats.pending_amount)} color={stats.pending_amount > 0 ? '#e67e22' : 'var(--success)'} />
        <StatCard label="OVERDUE INVOICES" value={stats.overdue_invoices} color={stats.overdue_invoices > 0 ? 'var(--danger)' : undefined} />
      </div>

      {/* Row 3: Alerts */}
      <div className="stat-grid">
        <StatCard label="OPEN DISPUTES" value={stats.open_disputes} color={stats.open_disputes > 0 ? 'var(--danger)' : undefined} onClick={() => navigate('/buyer/disputes')} />
        {stats.last_payment && (
          <StatCard
            label="LAST PAYMENT MADE"
            value={fmtCurrency(stats.last_payment.amount)}
            sub={`${stats.last_payment.payment_date} via ${stats.last_payment.mode || 'N/A'}`}
          />
        )}
      </div>

      {/* Quick Actions */}
      <Card>
        <div className="section-title" style={{ marginBottom: 12 }}>Quick Actions</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/buyer/invoices')}>
            Pay Pending Invoices
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/buyer/contracts')}>
            View My PSAs
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/buyer/energy-data')}>
            View Energy Allocation
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/buyer/payments')}>
            Payment Ledger
          </button>
        </div>
      </Card>
    </div>
  );
}
