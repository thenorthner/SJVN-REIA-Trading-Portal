import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';

const NAV_INTERNAL = [
  {
    section: 'Overview',
    roles: null,
    links: [{ to: '/', label: 'Consolidated Dashboard', end: true }],
  },
  {
    section: 'REIA Billing & Settlement',
    roles: ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER', 'MANAGEMENT', 'BUYER'],
    links: [
      { to: '/reia', label: 'REIA Dashboard', end: true },
      { to: '/reia/entities', label: 'Stakeholders (Sellers/Buyers)' },
      { to: '/reia/contracts', label: 'Contracts (PPA/PSA)' },
      { to: '/reia/energy-data', label: 'Energy Data & Validation' },
      { to: '/reia/invoices', label: 'Billing & Invoicing' },
      { to: '/reia/disputes', label: 'Dispute Management' },
      { to: '/reia/payment-security', label: 'Payment Security' },
      { to: '/reia/reconciliation', label: 'Reconciliation' },
    ],
  },
  {
    section: 'Power Trading',
    roles: ['SJVN_ADMIN', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT', 'TRADING_CLIENT'],
    links: [
      { to: '/trading', label: 'Trading Dashboard', end: true },
      { to: '/trading/clients', label: 'Clients & Counterparties' },
      { to: '/trading/bids', label: 'Exchange Bid Management' },
      { to: '/trading/bilateral', label: 'Bilateral Transactions' },
      { to: '/trading/billing-settlement', label: 'Trading Billing & Settlement' },
      { to: '/trading/market-analytics', label: 'Market Rates & Analytics' },
    ],
  },
  {
    section: 'Platform',
    roles: ['SJVN_ADMIN', 'REIA_USER', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT'],
    links: [{ to: '/audit-logs', label: 'Audit Trail' }],
  },
];

const NAV_SELLER = [
  {
    section: 'Seller Portal',
    roles: null,
    links: [
      { to: '/seller', label: '🏠 My Dashboard', end: true },
      { to: '/seller/team', label: '👥 My Team' },
      { to: '/seller/contracts', label: '📄 My Contracts (PPAs)' },
      { to: '/seller/energy-data', label: '⚡ Energy Data' },
      { to: '/seller/invoices', label: '🧾 My Invoices' },
      { to: '/seller/payments', label: '💰 Payments & Ledger' },
      { to: '/seller/disputes', label: '⚠️ My Disputes' },
      { to: '/seller/payment-security', label: '🛡️ Payment Security' },
      { to: '/seller/reconciliation', label: '🔄 Reconciliation' },
    ],
  },
];

const NAV_BUYER = [
  {
    section: 'Buyer Portal',
    roles: null,
    links: [
      { to: '/buyer', label: '🏠 My Dashboard', end: true },
      { to: '/buyer/team', label: '👥 My Team' },
      { to: '/buyer/contracts', label: '📄 My PSAs' },
      { to: '/buyer/energy-data', label: '⚡ Energy Allocation' },
      { to: '/buyer/invoices', label: '🧾 Payable Invoices' },
      { to: '/buyer/payments', label: '💰 Payment Ledger' },
      { to: '/buyer/disputes', label: '⚠️ My Disputes' },
      { to: '/buyer/payment-security', label: '🛡️ Payment Security' },
      { to: '/buyer/reconciliation', label: '🔄 Reconciliation' },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [showNotif, setShowNotif] = useState(false);

  // Auto-redirect Seller/Buyer to their portals on first load
  useEffect(() => {
    if (user?.role === 'SELLER' && location.pathname === '/') {
      navigate('/seller', { replace: true });
    } else if (user?.role === 'BUYER' && location.pathname === '/') {
      navigate('/buyer', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    api.notifications.list().then(setNotifications).catch(() => {});
    const interval = setInterval(() => {
      api.notifications.list().then(setNotifications).catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  const unread = notifications.filter((n) => !n.is_read).length;

  // Select sidebar based on user role
  const navSections = user?.role === 'SELLER' ? NAV_SELLER : user?.role === 'BUYER' ? NAV_BUYER : NAV_INTERNAL;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">SJVN</div>
          <div className="brand-text">
            <strong>RE Commercial &amp; Trading</strong>
            <span>Platform</span>
          </div>
        </div>
        <nav className="nav">
          {navSections.filter((s) => !s.roles || s.roles.includes(user?.role)).map((section) => (
            <div className="nav-section" key={section.section}>
              <div className="nav-section-title">{section.section}</div>
              {section.links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
                >
                  {l.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-title">Integrated Renewable Energy Commercial, Billing, Settlement &amp; Power Trading Management Platform</div>
          <div className="topbar-actions">
            <div className="notif-wrap">
              <button className="icon-btn" onClick={() => setShowNotif((s) => !s)}>
                🔔 {unread > 0 && <span className="badge-dot">{unread}</span>}
              </button>
              {showNotif && (
                <div className="notif-dropdown">
                  <div className="notif-header">
                    <span>Notifications</span>
                    <button className="link-btn" onClick={() => api.notifications.markAllRead().then(() => api.notifications.list().then(setNotifications))}>Mark all read</button>
                  </div>
                  {notifications.length === 0 && <div className="notif-empty">No notifications</div>}
                  {notifications.slice(0, 10).map((n) => (
                    <div key={n.id} className={'notif-item' + (n.is_read ? '' : ' unread')}>
                      <div className="notif-type">{n.type}</div>
                      <div>{n.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="user-chip">
              <div className="user-avatar">{user?.name?.[0] ?? '?'}</div>
              <div className="user-meta">
                <strong>{user?.name}</strong>
                <span>{user?.role?.replaceAll('_', ' ')}</span>
              </div>
            </div>
            <button className="btn btn-ghost" onClick={handleLogout}>Log out</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
