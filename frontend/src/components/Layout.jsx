import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';
import { TRADING_MENU } from '../config/tradingMenu.js';
import { ROLE_GROUPS, isSellerRole, isBuyerRole, isTradingClientRole } from '../roles.js';
import { PortfolioSelect } from '../context/PortfolioContext.jsx';

/** Keeps the shell up if a screen's module fails to load or throws while rendering. */
class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error('Screen failed to render:', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 28, maxWidth: 640 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>This screen failed to load</h2>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5 }}>
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const NAV_INTERNAL = [
  {
    section: 'Overview',
    // Consolidated Dashboard aggregates financials across every seller, buyer
    // and trading client, so it stays limited to SJVN top management.
    roles: ROLE_GROUPS.EXECUTIVE,
    links: [
      { to: '/', label: 'Consolidated Dashboard', end: true },
      { to: '/dashboard', label: 'Main Dashboard' },
      { to: '/trading/power-market', label: 'Power Market Dashboard' },
      { to: '/trading/mmr-dashboard', label: 'MMR Dashboard' },
      { to: '/trading/cea-reports', label: 'CEA Reports Dashboard' },
      { to: '/trading', label: 'Trading Dashboard', end: true },
      { to: '/reia', label: 'REIA Dashboard', end: true },
    ],
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
      { to: '/reia/disputes', label: 'Dispute Management' },
      { to: '/reia/payment-security', label: 'Payment Security' },
      { to: '/reia/power-diversion', label: 'Power Diversion' },
      { to: '/reia/energy-banking', label: 'Energy Banking' },
      // Raising a CERC two-part tariff bill is a REIA job, but the page lives in
      // the Power Trading section — without this entry the only roles allowed to
      // create these bills had no way to reach it. Scoped to the REIA-only roles
      // so nobody sees the same link twice.
      { to: '/trading/generator-billing', label: 'Generator Billing & Settlement', roles: ['REIA_USER', 'REIA_ADMIN'] },
      { to: '/reia/reconciliation', label: 'Reconciliation' },
      // Hidden for solar-focused scope (DSM is hydro/scheduling). Route still
      // exists in App.jsx — uncomment to restore for hydro/thermal.
      // { to: '/reia/deviation', label: 'Deviation Settlement (DSM)' },
    ],
  },
    {
    // Grouped the way ISET groups it. The flat list of thirty-four worked while
    // there were thirty-four; the menu it mirrors has close to a hundred, so the
    // second level comes from src/config/tradingMenu.js — one place that says what
    // exists, what is planned, and where each screen lives.
    section: 'Power Trading',
    roles: ROLE_GROUPS.TRADING_ALL,
    groups: TRADING_MENU,
  },
  {
    section: 'Platform',
    roles: [...new Set([...ROLE_GROUPS.AUDITOR, ...ROLE_GROUPS.MASTERS_READ, ...ROLE_GROUPS.TRADING_ALL])],
    links: [
      { to: '/master/portfolio-registry', label: 'Portfolio Registry', roles: ROLE_GROUPS.TRADING_ALL },
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
      { to: '/notification-board', label: 'Notification Board' },
      { to: '/seller/team', label: 'My Team' },
      { to: '/seller/documents', label: 'My Documents & KYC' },
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
      { to: '/notification-board', label: 'Notification Board' },
      { to: '/buyer/team', label: 'My Team' },
      { to: '/buyer/documents', label: 'My Documents & KYC' },
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

const NAV_TRADING_CLIENT = [
  {
    section: 'Trading Client Portal',
    roles: null,
    links: [
      { to: '/trading/home', label: 'Home Dashboard' },
      { to: '/master/portfolio-registry', label: 'Portfolio Registry' },
      { to: '/trading/my-profile', label: 'My Profile & Portfolio' },
      { to: '/trading/pre-trade', label: 'Pre-Trade Board' },
      { to: '/trading/dam', label: 'My DAM Bids' },
      { to: '/trading/gdam', label: 'My GDAM Bids' },
      { to: '/trading/rtm', label: 'My RTM Bids' },
      { to: '/trading/bilateral', label: 'Bilateral Contracts' },
      { to: '/trading/bilateral/desk', label: 'My Bilateral Deals' },
      { to: '/trading/billing-settlement', label: 'My Billing & Settlement' },
      { to: '/trading/market-analytics', label: 'Market Rates & Analytics' },
    ],
  },
];

/** Does this link own the current URL? */
const linkIsActive = (l, pathname) => (l.end
  ? pathname === l.to
  : pathname === l.to || (l.to !== '/' && pathname.startsWith(l.to)));

/**
 * A named run of links inside a section — ISET's second level, so "Exchange" can
 * hold its thirteen screens without the section becoming a wall of forty.
 * Collapsed unless it contains the page you are on.
 */
const NavSubGroup = ({ group, user }) => {
  const location = useLocation();
  const links = group.items.filter((l) => !l.roles || l.roles.includes(user?.role));
  const [isOpen, setIsOpen] = useState(links.some((l) => linkIsActive(l, location.pathname)));
  if (!links.length) return null;

  const pending = links.filter((l) => l.pending).length;

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="nav-subgroup-title"
        style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center',
                 justifyContent: 'space-between', padding: '5px 12px 5px 14px',
                 fontSize: 11, fontWeight: 600, letterSpacing: '.02em', opacity: 0.75 }}
        title={pending ? `${pending} of ${links.length} not built yet` : undefined}
      >
        <span>{group.group}</span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
              style={{ paddingLeft: 26 }}
            >
              <span style={{ opacity: l.pending ? 0.55 : 1 }}>{l.label}</span>
              {/* A screen that is only planned says so in the menu, so nobody
                  opens it expecting data and files a bug when there is none. */}
              {l.pending && (
                <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.5, fontStyle: 'italic' }}>soon</span>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
};

const NavGroup = ({ section, user }) => {
  const links = (section.links || []).filter((l) => !l.roles || l.roles.includes(user?.role));
  const subGroups = section.groups || [];
  const location = useLocation();
  const isAnyActive = links.some((l) => linkIsActive(l, location.pathname))
    || subGroups.some((g) => g.items.some((l) => linkIsActive(l, location.pathname)));
  const [isOpen, setIsOpen] = useState(isAnyActive || section.section === 'Overview');

  if (links.length === 0 && subGroups.length === 0) return null;

  return (
    <div className="nav-section">
      <div 
        className="nav-section-title" 
        onClick={() => setIsOpen(!isOpen)} 
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}
        title={isOpen ? "Collapse section" : "Expand section"}
      >
        <span>{section.section}</span>
        <span style={{ fontSize: '10px', opacity: 0.6 }}>{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && (
        <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {subGroups.map((g) => <NavSubGroup key={g.group} group={g} user={user} />)}
          {links.map((l) => (
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
      )}
    </div>
  );
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // Auto-redirect counterparties to their own portals on first load. This must
  // cover the L1/L2/L3 sub-users too, not just the company admin role.
  useEffect(() => {
    if (location.pathname !== '/') return;
    if (isSellerRole(user?.role)) navigate('/seller', { replace: true });
    else if (isBuyerRole(user?.role)) navigate('/buyer', { replace: true });
    else if (isTradingClientRole(user?.role)) navigate('/trading/my-profile', { replace: true });
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    api.notifications.list().then(setNotifications).catch(() => {});
    const interval = setInterval(() => {
      api.notifications.list().then(setNotifications).catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  const unread = (Array.isArray(notifications) ? notifications : []).filter((n) => !n.is_read).length;

  // Select sidebar based on user role. Matching on the role *group* (not the
  // exact 'SELLER'/'BUYER' string) keeps SELLER_L1/L2/L3 and BUYER_L1/L2/L3
  // sub-users inside their company portal instead of the internal SJVN nav.
  const navSections = isSellerRole(user?.role)
    ? NAV_SELLER
    : isBuyerRole(user?.role)
      ? NAV_BUYER
      : isTradingClientRole(user?.role)
        ? NAV_TRADING_CLIENT
        : NAV_INTERNAL;

  // White-label the shell for counterparties: show their own logo + name in
  // place of the SJVN brand. Internal SJVN staff keep the platform branding.
  const isCounterparty = isSellerRole(user?.role) || isBuyerRole(user?.role) || isTradingClientRole(user?.role);
  const entity = user?.entity;
  const branded = isCounterparty && entity;
  const portalKind = isSellerRole(user?.role) 
    ? 'Seller Portal' 
    : isBuyerRole(user?.role)
      ? 'Buyer Portal'
      : 'Trading Portal';
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
          <div className="brand brand-sjvn">
            <img className="brand-logo brand-logo-sjvn" src="/sjvn-logo.png" alt="SJVN" />
            <div className="brand-text">
              <strong>RE Commercial &amp; Trading</strong>
              <span>Platform</span>
            </div>
          </div>
        )}
        <nav className="nav">
          {navSections.filter((s) => !s.roles || s.roles.includes(user?.role)).map((section) => (
            <NavGroup key={section.section} section={section} user={user} />
          ))}
        </nav>
        {branded && (
          <div className="brand-powered">Powered by <strong>SJVN</strong> RE Platform</div>
        )}
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-left">
            {!branded && (
              <img className="topbar-logo" src="/sjvn-logo.png" alt="SJVN" />
            )}
            <div className="topbar-title">
              {branded
                ? `${entity.name} — ${portalKind}`
                : 'Integrated Renewable Energy Commercial, Billing, Settlement & Power Trading Management Platform'}
            </div>
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
                  <div className="notif-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>Inbox & System Alerts</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button className="link-btn" onClick={() => alert('Compose Mail modal opened!')} style={{ color: '#0052cc', fontWeight: 600 }}>+ Compose Mail</button>
                      <button className="link-btn" onClick={() => api.notifications.markAllRead().then(() => api.notifications.list().then(setNotifications))}>Mark all read</button>
                    </div>
                  </div>
                  {notifications.length === 0 && <div className="notif-empty">No unread alerts. All clear.</div>}
                  {notifications.slice(0, 10).map((n) => (
                    <div key={n.id} className={'notif-item' + (n.is_read ? '' : ' unread')} style={{ borderLeft: n.type === 'COMPLIANCE_ALERT' ? '3px solid #ef4444' : '3px solid transparent' }}>
                      <div className="notif-type" style={{ color: n.type === 'COMPLIANCE_ALERT' ? '#ef4444' : 'var(--slate-500)', fontWeight: 600 }}>{n.type}</div>
                      <div>{n.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="notif-wrap" style={{ position: 'relative' }}>
              <div 
                className="user-chip" 
                style={{ cursor: 'pointer' }}
                onClick={() => setShowProfile((s) => !s)}
              >
                <div className="user-avatar">{user?.name?.[0] ?? '?'}</div>
                <div className="user-meta">
                  <strong>Welcome, {user?.name}</strong>
                  <span style={{ color: '#0056b3' }}>
                    {user?.linked_entity_id ? `Asset: ${user.linked_entity_id}` : user?.role?.replaceAll('_', ' ')}
                  </span>
                </div>
              </div>
              {showProfile && (
                <div className="notif-dropdown" style={{ right: 0, width: 200, padding: 0 }}>
                  <div className="notif-item" style={{ cursor: 'pointer' }} onClick={() => { navigate('/settings/user-profile'); setShowProfile(false); }}>
                    My Account
                  </div>
                  <div className="notif-item" style={{ cursor: 'pointer' }} onClick={() => { navigate('/trading/clients'); setShowProfile(false); }}>
                    Manage Portfolio
                  </div>
                  <div className="notif-item" style={{ cursor: 'pointer' }} onClick={() => setShowProfile(false)}>
                    Change Password
                  </div>
                  <div className="notif-item" style={{ cursor: 'pointer', borderTop: '1px solid var(--border)', color: 'var(--red)' }} onClick={handleLogout}>
                    Log out
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">
          <RouteErrorBoundary key={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
