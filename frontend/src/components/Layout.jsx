import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';
import { ROLE_GROUPS, isSellerRole, isBuyerRole } from '../roles.js';

const NAV_INTERNAL = [
  {
    section: 'Overview',
    // Consolidated Dashboard aggregates financials across every seller, buyer
    // and trading client, so it stays limited to SJVN top management.
    roles: ROLE_GROUPS.EXECUTIVE,
    links: [{ to: '/', label: 'Consolidated Dashboard', end: true }],
  },
  {
    section: 'Alerts',
    roles: [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.TRADING_ALL])],
    links: [{ to: '/notification-board', label: 'Notification Board' }],
  },
  {
    section: 'REIA Billing & Settlement',
    roles: ROLE_GROUPS.REIA_ALL,
    links: [
      { to: '/reia', label: 'REIA Dashboard', end: true },
      { to: '/reia/entities', label: 'Stakeholders (Sellers/Buyers)' },
      { to: '/reia/contracts', label: 'Contracts (PPA/PSA)' },
      { to: '/reia/energy-data', label: 'Energy Data & Validation' },
      { to: '/reia/invoices', label: 'Billing & Invoicing' },
      { to: '/reia/reports', label: 'Reports' },
      { to: '/reia/disputes', label: 'Dispute Management' },
      { to: '/reia/payment-security', label: 'Payment Security' },
      { to: '/reia/reconciliation', label: 'Reconciliation' },
    ],
  },
  {
    section: 'Power Trading',
    roles: [...ROLE_GROUPS.TRADING_ALL, 'TRADING_CLIENT'],
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
    roles: [...new Set([...ROLE_GROUPS.AUDITOR, ...ROLE_GROUPS.MASTERS_READ])],
    links: [
      { to: '/masters', label: 'Master Data', roles: ROLE_GROUPS.MASTERS_READ },
      { to: '/audit-logs', label: 'Audit Trail', roles: ROLE_GROUPS.AUDITOR },
    ],
  },
];

const NAV_SELLER = [
  {
    section: 'Seller Portal',
    roles: null,
    links: [
      { to: '/seller', label: 'My Dashboard', end: true },
      { to: '/seller/team', label: 'My Team' },
      { to: '/seller/contracts', label: 'My Contracts (PPAs)' },
      { to: '/seller/energy-data', label: 'Energy Data' },
      { to: '/seller/invoices', label: 'My Invoices' },
      { to: '/seller/payments', label: 'Payments & Ledger' },
      { to: '/seller/disputes', label: 'My Disputes' },
      { to: '/seller/payment-security', label: 'Payment Security' },
      { to: '/seller/reconciliation', label: 'Reconciliation' },
    ],
  },
];

const NAV_BUYER = [
  {
    section: 'Buyer Portal',
    roles: null,
    links: [
      { to: '/buyer', label: 'My Dashboard', end: true },
      { to: '/buyer/team', label: 'My Team' },
      { to: '/buyer/contracts', label: 'My PSAs' },
      { to: '/buyer/energy-data', label: 'Energy Allocation' },
      { to: '/buyer/invoices', label: 'Payable Invoices' },
      { to: '/buyer/payments', label: 'Payment Ledger' },
      { to: '/buyer/disputes', label: 'My Disputes' },
      { to: '/buyer/payment-security', label: 'Payment Security' },
      { to: '/buyer/reconciliation', label: 'Reconciliation' },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [showNotif, setShowNotif] = useState(false);

  // Auto-redirect counterparties to their own portals on first load. This must
  // cover the L1/L2/L3 sub-users too, not just the company admin role.
  useEffect(() => {
    if (location.pathname !== '/') return;
    if (isSellerRole(user?.role)) navigate('/seller', { replace: true });
    else if (isBuyerRole(user?.role)) navigate('/buyer', { replace: true });
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    api.notifications.list().then(setNotifications).catch(() => {});
    const interval = setInterval(() => {
      api.notifications.list().then(setNotifications).catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  const unread = notifications.filter((n) => !n.is_read).length;

  // Select sidebar based on user role. Matching on the role *group* (not the
  // exact 'SELLER'/'BUYER' string) keeps SELLER_L1/L2/L3 and BUYER_L1/L2/L3
  // sub-users inside their company portal instead of the internal SJVN nav.
  const navSections = isSellerRole(user?.role)
    ? NAV_SELLER
    : isBuyerRole(user?.role)
      ? NAV_BUYER
      : NAV_INTERNAL;

  // White-label the shell for counterparties: show their own logo + name in
  // place of the SJVN brand. Internal SJVN staff keep the platform branding.
  const isCounterparty = isSellerRole(user?.role) || isBuyerRole(user?.role);
  const entity = user?.entity;
  const branded = isCounterparty && entity;
  const portalKind = isSellerRole(user?.role) ? 'Seller Portal' : 'Buyer Portal';
  const logoSrc = branded && entity.logo_url ? `http://localhost:4000${entity.logo_url}` : null;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        {branded ? (
          <div className="brand">
            {logoSrc ? (
              <img className="brand-logo" src={logoSrc} alt={entity.name} />
            ) : (
              <div className="brand-mark">{entity.name?.[0] ?? '?'}</div>
            )}
            <div className="brand-text">
              <strong>{entity.name}</strong>
              <span>{portalKind}</span>
            </div>
          </div>
        ) : (
          <div className="brand">
            <div className="brand-mark">SJVN</div>
            <div className="brand-text">
              <strong>RE Commercial &amp; Trading</strong>
              <span>Platform</span>
            </div>
          </div>
        )}
        <nav className="nav">
          {navSections.filter((s) => !s.roles || s.roles.includes(user?.role)).map((section) => (
            <div className="nav-section" key={section.section}>
              <div className="nav-section-title">{section.section}</div>
              {section.links
                .filter((l) => !l.roles || l.roles.includes(user?.role))
                .map((l) => (
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
        {branded && (
          <div className="brand-powered">Powered by <strong>SJVN</strong> RE Platform</div>
        )}
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-title">
            {branded
              ? `${entity.name} — ${portalKind}`
              : 'Integrated Renewable Energy Commercial, Billing, Settlement & Power Trading Management Platform'}
          </div>
          <div className="topbar-actions">
            <div className="notif-wrap">
              <button className="icon-btn" onClick={() => setShowNotif((s) => !s)} aria-label="Notifications">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unread > 0 && <span className="badge-dot">{unread}</span>}
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
