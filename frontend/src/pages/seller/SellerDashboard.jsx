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

export default function SellerDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.sellerDashboard()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading dashboard...</div>;
  if (!stats) return <div className="empty-state"><h3>Unable to load dashboard</h3><p>Your account may not be linked to a seller entity. Contact SJVN admin.</p></div>;

  return (
    <div>
      <PageHeader
        title="Seller Dashboard"
        subtitle="Welcome back — here's your billing, invoice and payment summary"
      />

      {/* Row 1: Contracts & Generation */}
      <div className="stat-grid">
        <StatCard label="ACTIVE CONTRACTS (PPAs)" value={stats.active_contracts} onClick={() => navigate('/seller/contracts')} />
        <StatCard label="CONTRACTED CAPACITY" value={`${fmtNumber(stats.total_capacity_mw)} MW`} />
        <StatCard label="TOTAL INVOICES RAISED" value={stats.total_invoices} onClick={() => navigate('/seller/invoices')} />
        <StatCard label="PENDING APPROVAL" value={stats.pending_approval} color={stats.pending_approval > 0 ? '#e67e22' : undefined} onClick={() => navigate('/seller/invoices')} />
      </div>

      {/* Row 2: Payment & Financial */}
      <div className="stat-grid">
        <StatCard label="TOTAL BILLED" value={fmtCurrency(stats.total_billed)} color="var(--success)" />
        <StatCard label="TOTAL RECEIVED" value={fmtCurrency(stats.total_received)} color="var(--success)" onClick={() => navigate('/seller/payments')} />
        <StatCard label="PENDING AMOUNT" value={fmtCurrency(stats.pending_amount)} color={stats.pending_amount > 0 ? '#e67e22' : 'var(--success)'} />
        <StatCard label="PAID INVOICES" value={stats.paid_invoices} color="var(--success)" />
      </div>

      {/* Row 3: Alerts */}
      <div className="stat-grid">
        <StatCard label="OVERDUE INVOICES" value={stats.overdue_invoices} color={stats.overdue_invoices > 0 ? 'var(--danger)' : undefined} />
        <StatCard label="OPEN DISPUTES" value={stats.open_disputes} color={stats.open_disputes > 0 ? 'var(--danger)' : undefined} onClick={() => navigate('/seller/disputes')} />
        {stats.last_payment && (
          <StatCard
            label="LAST PAYMENT RECEIVED"
            value={fmtCurrency(stats.last_payment.amount)}
            sub={`${stats.last_payment.payment_date} via ${stats.last_payment.mode || 'N/A'}`}
          />
        )}
      </div>

      {/* Quick Actions */}
      <Card>
        <div className="section-title" style={{ marginBottom: 12 }}>Quick Actions</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/seller/invoices')}>
            Create New Invoice
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/seller/contracts')}>
            View My Contracts
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/seller/energy-data')}>
            Check Energy Data
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/seller/payments')}>
            Payment Ledger
          </button>
        </div>
      </Card>
    </div>
  );
}
