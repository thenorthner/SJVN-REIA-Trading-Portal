import React, { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';
import { TRADING_MENU, FINANCE_SAP_MENU } from '../config/tradingMenu.js';
import { ROLE_GROUPS, isSellerRole, isBuyerRole, isTradingClientRole } from '../roles.js';
import { PortfolioSelect } from '../context/PortfolioContext.jsx';
import { RouteSkeleton } from './ui.jsx';
import ChangePasswordModal from './ChangePasswordModal.jsx';
import { Lock } from 'lucide-react';
import { getNotificationAction, formatTimeAgo } from '../lib/notificationRouting.js';

/**
 * Keeps the shell up if a screen's module fails to load or throws while
 * rendering.
 *
 * The common cause is not a broken screen at all: the server has been
 * redeployed, every code-split chunk has a new content hash, and a tab that has
 * been open across the deploy asks for a file that no longer exists. Re-mounting
 * that screen fails the same way for ever, so a stale bundle reloads the page
 * once (guarded, so a genuinely missing chunk cannot loop) and only a second
 * failure is shown to the user.
 */
const RELOAD_GUARD = 'sjvn:chunk-reload-at';

function isStaleBundleError(error) {
  const msg = String(error?.message || '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(msg);
}

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error('Screen failed to render:', error);
    if (!isStaleBundleError(error)) return;
    // One reload per minute at most: if the chunk is genuinely gone, the second
    // failure lands on the message below instead of reloading for ever.
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_GUARD)) || 0; } catch { /* private mode */ }
    if (Date.now() - last < 60_000) return;
    try { sessionStorage.setItem(RELOAD_GUARD, String(Date.now())); } catch { /* private mode */ }
    this.setState({ reloading: true });
    window.location.reload();
  }
  render() {
    if (this.state.reloading) {
      return <div className="page-loading" style={{ padding: 28 }}>Loading the latest version…</div>;
    }
    if (this.state.error) {
      const stale = isStaleBundleError(this.state.error);
      return (
        <div style={{ padding: 28, maxWidth: 640 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>This screen failed to load</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
            {stale
              ? 'The application was updated while this tab was open, so this screen’s code is no longer on the server. Reloading picks up the new version.'
              : this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            {!stale && (
              <button
                type="button"
                className="btn"
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </button>
            )}
          </div>
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
      { to: '/hydro-thermal', label: 'Hydro Dashboard', end: true },
      { to: '/thermal', label: 'Thermal Dashboard', end: true },
    ],
  },
  {
    section: 'Alerts',
    roles: [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.HYDRO_THERMAL_ALL, ...ROLE_GROUPS.THERMAL_ALL, ...ROLE_GROUPS.TRADING_ALL])],
    links: [
      { to: '/mail', label: 'Quick Connect', badge: 'Informal Desk', tooltip: 'Quick Connect — Operational desk facilitation only. Not an official legal / contractual mode of communication under PPA/PSA/CERC rules.' },
      { to: '/notification-board', label: 'Notification Board' },
    ],
  },
  {
    section: 'REIA Billing & Settlement',
    roles: ROLE_GROUPS.REIA_ALL,
    links: [
      { to: '/reia', label: 'REIA Dashboard', end: true },
      { to: '/reia/entities', label: 'Stakeholders (Sellers/Buyers)' },
      // Each company's portal users; only SJVN's administrators manage them.
      { to: '/reia/company-users', label: 'Company Users', roles: ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN'] },
      // What is waiting to be verified, and where each company's KYC stands.
      { to: '/reia/document-desk', label: 'Documents & KYC Desk' },
      { to: '/reia/contracts', label: 'Contracts (PPA/PSA)' },
      // Tenure, commissioning, security and approvals, contract by contract.
      { to: '/reia/contract-compliance', label: 'Contract Compliance' },
      { to: '/reia/cerc-compliance', label: 'CERC Compliance' },
      { to: '/reia/energy-data', label: 'Energy Data & Validation' },
      { to: '/reia/invoices', label: 'Billing & Invoicing' },
      { to: '/reia/billing-readiness', label: 'Month-Close Board' },
      { to: '/reia/release-planner', label: 'Developer Release Planner' },
      { to: '/reia/note-approvals', label: 'Notes for Approval' },
      // Outstanding, delay days and surcharge, on both sides of the desk.
      // The technical and commercial checks on developer bills, across the desk.
      { to: '/reia/verification', label: 'Invoice Verification' },
      { to: '/reia/payment-monitoring', label: 'Payment Monitoring' },
      // Energy against what each project's capacity could make.
      { to: '/reia/generation-performance', label: 'Generation Performance' },
      { to: '/reia/disputes', label: 'Dispute Management' },
      // A seller's statement of account, and where Finance files its Form 16A.
      { to: '/reia/seller-ledgers', label: 'Counterparty Ledgers & TDS' },
      { to: '/reia/payment-security', label: 'Payment Security' },
      { to: '/reia/power-diversion', label: 'Power Diversion' },
      { to: '/reia/advances', label: 'Advances & Unapplied Receipts' },
      { to: '/reia/energy-banking', label: 'Energy Banking' },
      // Raising a CERC two-part tariff bill is a REIA job, but the page lives in
      // the Power Trading section — without this entry the only roles allowed to
      // create these bills had no way to reach it. Scoped to the REIA-only roles
      // so nobody sees the same link twice.
      { to: '/trading/generator-billing', label: 'Generator Billing & Settlement', roles: ['REIA_USER', 'REIA_ADMIN'] },
      { to: '/reia/reconciliation', label: 'Reconciliation' },
      { to: '/reia/deviation', label: 'Deviation Settlement (DSM)' },
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
    section: 'Hydro Billing',
    roles: ROLE_GROUPS.HYDRO_THERMAL_ALL,
    links: [
      { to: '/hydro-thermal', label: 'Hydro Dashboard', end: true },
      // The beneficiaries a station bills. Onboarded here, not borrowed from REIA.
      { to: '/hydro-thermal/stakeholders', label: 'Stakeholders (Beneficiaries)' },
      { to: '/hydro-thermal/document-desk', label: 'Documents & KYC Desk' },
      { to: '/hydro-thermal/stations', label: 'Stations & Tariff' },
      { to: '/hydro-thermal/ppas', label: 'Beneficiary PPAs & Allocation' },
      { to: '/hydro-thermal/regulatory', label: 'Regulatory Desk' },
      { to: '/hydro-thermal/rea-register', label: 'REA Register & Validation' },
      { to: '/hydro-thermal/hydro-billing', label: 'Monthly Bills & Approval' },
      // Months already billed: a revised tariff's arrear, or a one-off item.
      { to: '/hydro-thermal/arrear-supplementary', label: 'Arrear & Supplementary Bills' },
      // One month across every station, and everything waiting on a second person.
      { to: '/hydro-thermal/month-close', label: 'Month-Close Board' },
      { to: '/hydro-thermal/approvals', label: 'Approvals Inbox' },
      // LPS, early-payment rebate and payments live on each beneficiary's account.
      { to: '/hydro-thermal/hydro-ledger', label: 'Account Display (Payments, LPS & Rebate)' },
      { to: '/hydro-thermal/notes', label: 'Debit / Credit Notes' },
      { to: '/hydro-thermal/receivables', label: 'Payment Monitoring (Ageing)' },
      { to: '/hydro-thermal/advances', label: 'Advances & Unapplied Receipts' },
      { to: '/hydro-thermal/generation-performance', label: 'Generation Performance' },
      { to: '/hydro-thermal/disputes', label: 'Dispute Management' },
      { to: '/hydro-thermal/payment-security', label: 'Payment Security (LC / BG)' },
      { to: '/hydro-thermal/power-regulation', label: 'Regulation of Power Supply' },
      { to: '/hydro-thermal/reconciliation', label: 'Reconciliation' },
      { to: '/hydro-thermal/tds', label: 'TDS by Beneficiaries' },
      { to: '/hydro-thermal/dsm', label: 'Deviation Settlement (DSM)' },
      { to: '/hydro-thermal/hydro-claims', label: 'Additional Charges & TCS' },
      // Sale bills the station raises on PTC India, the trader it sells through —
      // station revenue on the station's ledger, not SJVN's own trading desk.
      { to: '/hydro-thermal/hydro-ptc', label: 'PTC Sale Bills' },
      { to: '/hydro-thermal/hydro-finance', label: 'Finance Posting (FI)' },
    ],
  },
  {
    // Its own section, as the Commercial department asked: thermal is billed on
    // a different tariff (fixed + energy charge on fuel) from a hydro station.
    section: 'Thermal Billing',
    // Its own logins: the hydro desk does not see this section, and a thermal
    // officer sees nothing else.
    roles: ROLE_GROUPS.THERMAL_ALL,
    links: [
      { to: '/thermal', label: 'Thermal Dashboard', end: true },
      { to: '/thermal/stakeholders', label: 'Stakeholders (Beneficiaries)' },
      { to: '/thermal/document-desk', label: 'Documents & KYC Desk' },
      { to: '/thermal/ppas', label: 'Beneficiary PPAs & Allocation' },
      { to: '/thermal/regulatory', label: 'Regulatory Desk' },
      { to: '/thermal/rea-register', label: 'REA Register & Validation' },
      { to: '/thermal/stations', label: 'Stations & Tariff' },
      { to: '/thermal/billing', label: 'Monthly Bills & Approval' },
      { to: '/thermal/arrear-supplementary', label: 'Arrear & Supplementary Bills' },
      { to: '/thermal/month-close', label: 'Month-Close Board' },
      { to: '/thermal/approvals', label: 'Approvals Inbox' },
      { to: '/thermal/ledger', label: 'Account Display (Payments, LPS & Rebate)' },
      { to: '/thermal/notes', label: 'Debit / Credit Notes' },
      { to: '/thermal/receivables', label: 'Payment Monitoring (Ageing)' },
      { to: '/thermal/advances', label: 'Advances & Unapplied Receipts' },
      { to: '/thermal/generation-performance', label: 'Generation Performance' },
      { to: '/thermal/disputes', label: 'Dispute Management' },
      { to: '/thermal/payment-security', label: 'Payment Security (LC / BG)' },
      { to: '/thermal/power-regulation', label: 'Regulation of Power Supply' },
      { to: '/thermal/reconciliation', label: 'Reconciliation' },
      { to: '/thermal/tds', label: 'TDS by Beneficiaries' },
      { to: '/thermal/dsm', label: 'Deviation Settlement (DSM)' },
      { to: '/thermal/claims', label: 'Additional Charges & TCS' },
      { to: '/thermal/finance', label: 'Finance Posting (FI)' },
    ],
  },
  {
    // What goes to SAP, from all three verticals — see FINANCE_SAP_MENU.
    section: 'Finance & SAP Integration',
    roles: [...new Set([...ROLE_GROUPS.REIA_ALL, ...ROLE_GROUPS.HYDRO_THERMAL_ALL, ...ROLE_GROUPS.TRADING_ALL])],
    groups: FINANCE_SAP_MENU(ROLE_GROUPS),
  },
  {
    section: 'Platform',
    roles: [...new Set([...ROLE_GROUPS.AUDITOR, ...ROLE_GROUPS.MASTERS_READ, ...ROLE_GROUPS.TRADING_ALL, 'REIA_ADMIN', 'TRADING_ADMIN', 'THERMAL_ADMIN', 'IT_SUPER_ADMIN'])],
    links: [
      // SJVN's own officers on the platform; an administrator's page.
      { to: '/admin/users', label: 'SJVN Users', roles: ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_ADMIN', 'TRADING_ADMIN', 'THERMAL_ADMIN'] },
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
      { to: '/mail', label: 'Quick Connect', badge: 'Informal Desk', tooltip: 'Quick Connect — Operational desk facilitation only. Not an official legal / contractual mode of communication under PPA/PSA/CERC rules.' },
      { to: '/notification-board', label: 'Notification Board' },
      { to: '/seller/team', label: 'My Team' },
      { to: '/seller/contracts', label: 'My Contracts (PPAs)', requiresKyc: true },
      { to: '/seller/energy-data', label: 'Energy Data', requiresKyc: true },
      { to: '/seller/invoices', label: 'My Invoices', requiresKyc: true },
      { to: '/seller/payments', label: 'Payments & Ledger', requiresKyc: true },
      { to: '/seller/disputes', label: 'My Disputes', requiresKyc: true },
      { to: '/seller/payment-security', label: 'Payment Security', requiresKyc: true },
      { to: '/seller/reconciliation', label: 'Reconciliation', requiresKyc: true },
    ],
  },
];

const NAV_BUYER = [
  {
    section: 'Buyer Portal',
    roles: null,
    links: [
      { to: '/buyer', label: 'My Dashboard', end: true },
      { to: '/mail', label: 'Quick Connect', badge: 'Informal Desk', tooltip: 'Quick Connect — Operational desk facilitation only. Not an official legal / contractual mode of communication under PPA/PSA/CERC rules.' },
      { to: '/notification-board', label: 'Notification Board' },
      { to: '/buyer/team', label: 'My Team' },
      { to: '/buyer/contracts', label: 'My PSAs', requiresKyc: true },
      { to: '/buyer/energy-data', label: 'Energy Allocation', requiresKyc: true },
      { to: '/buyer/invoices', label: 'Billing & Payments', requiresKyc: true },
      { to: '/buyer/disputes', label: 'My Disputes', requiresKyc: true },
      { to: '/buyer/payment-security', label: 'Payment Security', requiresKyc: true },
      { to: '/buyer/reconciliation', label: 'Reconciliation', requiresKyc: true },
    ],
  },
];

const NAV_TRADING_CLIENT = [
  {
    section: 'Trading Client Portal',
    roles: null,
    links: [
      // The client's own screens. This menu used to list the desk's consoles —
      // the bidding engine, the bilateral desk, Billing & Settlement — which a
      // client can open but whose every call the API refuses.
      { to: '/trading/home', label: 'Home Dashboard', end: true },
      { to: '/mail', label: 'Quick Connect', badge: 'Informal Desk', tooltip: 'Quick Connect — Operational desk facilitation only. Not an official legal / contractual mode of communication under PPA/PSA/CERC rules.' },
      { to: '/trading/my-profile', label: 'My Profile & Portfolio' },
      { to: '/trading/my-bids', label: 'My Bids' },
      { to: '/trading/my-deals', label: 'My Deals' },
      { to: '/trading/my-bills', label: 'My Bills & Ledger' },
      { to: '/trading/my-requests', label: 'My Bid Requests' },
      { to: '/trading/market-analytics', label: 'Market Rates & Analytics' },
    ],
  },
];

/** Does this link own the current URL? */
const linkIsActive = (l, pathname) => {
  if (l.to === '/buyer/invoices') {
    return pathname === '/buyer/invoices' || pathname === '/buyer/payments';
  }
  return (l.end
    ? pathname === l.to
    : pathname === l.to || (l.to !== '/' && pathname.startsWith(l.to)));
};

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
    <div className="nav-subgroup">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="nav-subgroup-title"
        title={pending ? `${pending} of ${links.length} not built yet` : undefined}
      >
        <span>{group.group}</span>
        <span className="nav-caret">{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && (
        <div className="nav-section-links" style={{ margin: 0 }}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
            >
              <span style={{ opacity: l.pending ? 0.55 : 1 }}>{l.label}</span>
              {/* A screen that is only planned says so in the menu, so nobody
                  opens it expecting data and files a bug when there is none. */}
              {l.pending && (
                <span style={{ marginLeft: 6, fontSize: 12.5, opacity: 0.5, fontStyle: 'italic' }}>soon</span>
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
        title={isOpen ? 'Collapse section' : 'Expand section'}
      >
        <span>{section.section}</span>
        <span className="nav-caret">{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && (
        <div className="nav-section-links">
          {subGroups.map((g) => <NavSubGroup key={g.group} group={g} user={user} />)}
          {links.map((l) => {
            const isKycLocked = l.requiresKyc && user?.entity && user.entity.status !== 'APPROVED';
            return (
              <NavLink
                key={l.to}
                to={isKycLocked ? '#' : l.to}
                end={l.end}
                className={({ isActive }) => 'nav-link' + (isActive && !isKycLocked ? ' active' : '') + (isKycLocked ? ' locked' : '')}
                title={l.tooltip || (l.to === '/mail' ? 'Quick Connect — Operational query desk only. Not an official legal / contractual mode of communication.' : undefined)}
                onClick={(e) => {
                  if (isKycLocked) {
                    e.preventDefault();
                  }
                }}
              >
                <span>{l.label}</span>
                {l.badge && <span className="nav-badge">{l.badge}</span>}
                {isKycLocked && <Lock size={13} style={{ marginLeft: 'auto', opacity: 0.5 }} />}
              </NavLink>
            );
          })}
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
  const [showChangePassword, setShowChangePassword] = useState(false);
  // On a phone the menu would take two thirds of the screen, so it starts
  // closed there and closes again once a page has been picked from it.
  const isNarrow = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(isNarrow);
  useEffect(() => { if (isNarrow()) setIsSidebarCollapsed(true); }, [location.pathname]);
  // And when a wide window is made narrow: the menu stayed open and took the
  // whole width, leaving the page a sliver beside it.
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 760px)');
    if (!mq) return undefined;
    const onChange = (e) => { if (e.matches) setIsSidebarCollapsed(true); };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  // A dropdown closes when the user clicks anywhere outside it or presses
  // Escape. Each menu's wrapper holds both its toggle and its panel, so a click
  // on the toggle is "inside" and keeps working as the open/close switch.
  useEffect(() => {
    if (!showNotif && !showProfile) return undefined;
    function onPointerDown(e) {
      if (showNotif && notifRef.current && !notifRef.current.contains(e.target)) setShowNotif(false);
      if (showProfile && profileRef.current && !profileRef.current.contains(e.target)) setShowProfile(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') { setShowNotif(false); setShowProfile(false); }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showNotif, showProfile]);

  // Moving to another screen closes whichever menu took the user there, and
  // starts the new screen at its top rather than wherever the last one was left.
  const mainRef = useRef(null);
  useEffect(() => {
    setShowNotif(false);
    setShowProfile(false);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  // Auto-redirect counterparties to their own portals on first load. This must
  // cover the L1/L2/L3 sub-users too, not just the company admin role.
  useEffect(() => {
    if (location.pathname !== '/') return;
    if (isSellerRole(user?.role)) navigate('/seller', { replace: true });
    else if (isBuyerRole(user?.role)) navigate('/buyer', { replace: true });
    else if (isTradingClientRole(user?.role)) navigate('/trading/my-profile', { replace: true });
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    api.notifications.list(user?.role).then(setNotifications).catch(() => {});
    const interval = setInterval(() => {
      api.notifications.list(user?.role).then(setNotifications).catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [user?.role]);

  const unread = (Array.isArray(notifications) ? notifications : []).filter((n) => !n.is_read).length;

  // Unread mail, beside the bell. The Mail page announces reads and deletes
  // with a 'mail:changed' event so the count does not wait for the next poll.
  const [unreadMail, setUnreadMail] = useState(0);
  useEffect(() => {
    if (!user) return undefined;
    const refresh = () => api.mail.unreadCount().then((r) => setUnreadMail(r?.unread || 0)).catch(() => {});
    refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener('mail:changed', refresh);
    return () => { clearInterval(interval); window.removeEventListener('mail:changed', refresh); };
  }, [user?.id]);

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
  // "Manage Portfolio" went to the trading desk's client list for everyone, and
  // for a REIA user, a seller or a buyer that screen answers "Access restricted".
  // It now leads where the role's portfolio actually lives, or is not offered.
  const portfolioPath = ROLE_GROUPS.TRADING_ALL.includes(user?.role)
    ? '/trading/clients'
    : isTradingClientRole(user?.role) ? '/trading/my-profile' : null;
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
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
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
      {!isSidebarCollapsed && (
        <div
          className="sidebar-backdrop"
          onClick={() => setIsSidebarCollapsed(true)}
          aria-hidden="true"
        />
      )}
      <div className="main-col" ref={mainRef}>
        <header className="topbar">
          <div className="topbar-left">
            <button 
              className="icon-btn" 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              aria-label="Toggle Sidebar"
              style={{ marginRight: 12, padding: 4 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            {!branded && (
              <img className="topbar-logo" src="/sjvn-logo.png" alt="SJVN" />
            )}
            <div
              className="topbar-title"
              title={branded ? `${entity.name} — ${portalKind}` : 'Integrated Renewable Energy Commercial, Billing, Settlement & Power Trading Management Platform'}
            >
              {branded
                ? `${entity.name} — ${portalKind}`
                : 'Integrated Renewable Energy Commercial, Billing, Settlement & Power Trading Management Platform'}
            </div>
          </div>
          <div className="topbar-actions">

            <button
              className="icon-btn"
              onClick={() => navigate('/mail')}
              aria-label={unreadMail ? `Quick Connect (Operational Desk), ${unreadMail} unread` : 'Quick Connect (Operational Desk)'}
              title="Quick Connect — Operational desk coordination facility (Not an official legal or contractual mode of communication)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              {unreadMail > 0 && <span className="badge-dot">{unreadMail > 99 ? '99+' : unreadMail}</span>}
            </button>

            <div className="notif-wrap" ref={notifRef}>
              <button className="icon-btn" onClick={() => { setShowNotif((s) => !s); setShowProfile(false); }} aria-label="Notifications" aria-expanded={showNotif}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {unread > 0 && <span className="badge-dot">{unread}</span>}
              </button>
              {showNotif && (
                <div className="notif-dropdown">
                  <div className="notif-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>System Alerts</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="button"
                        className="link-btn"
                        style={{ cursor: unread > 0 ? 'pointer' : 'default', opacity: unread > 0 ? 1 : 0.6 }}
                        disabled={unread === 0}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setNotifications((prev) => prev.map((item) => ({ ...item, is_read: 1 })));
                          try {
                            await api.notifications.markAllRead(notifications);
                          } catch (err) {
                            console.error('Failed to mark all read on server:', err);
                          }
                          try {
                            const fresh = await api.notifications.list(user?.role);
                            setNotifications(fresh || []);
                          } catch (err) {
                            console.error('Failed to reload notifications:', err);
                          }
                        }}
                      >
                        Mark all read
                      </button>
                    </div>
                  </div>
                  {notifications.length === 0 && <div className="notif-empty">No unread alerts. All clear.</div>}
                  {notifications.slice(0, 10).map((n) => {
                    const action = getNotificationAction(n, user);
                    const isAlert = n.type === 'COMPLIANCE_ALERT';
                    return (
                      <div
                        key={n.id}
                        className={'notif-item' + (n.is_read ? '' : ' unread')}
                        style={{
                          cursor: 'pointer',
                          borderLeft: isAlert ? '3px solid #ef4444' : (n.is_read ? '3px solid transparent' : '3px solid #2563eb'),
                          position: 'relative',
                        }}
                        onClick={() => {
                          if (!n.is_read) {
                            api.notifications.markRead(n.id).catch(() => {});
                            setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: 1 } : item)));
                          }
                          setShowNotif(false);
                          if (action.isMail) {
                            navigate('/mail');
                          } else if (action.url) {
                            navigate(action.url);
                          }
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                          <span
                            className="notif-type"
                            style={{
                              color: isAlert ? '#ef4444' : 'var(--primary, #003366)',
                              fontWeight: 700,
                              fontSize: 13,
                              letterSpacing: '.02em',
                            }}
                          >
                            {n.type?.replace(/_/g, ' ')}
                          </span>
                          {n.created_at && (
                            <span style={{ fontSize: 12.5, color: 'var(--slate-400)', whiteSpace: 'nowrap' }}>
                              {formatTimeAgo(n.created_at)}
                            </span>
                          )}
                        </div>
                        <div style={{ color: 'var(--slate-700)', fontSize: 13.5, lineHeight: 1.45, marginBottom: 5 }}>
                          {n.message}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          {!n.is_read ? (
                            <button
                              type="button"
                              className="link-btn"
                              style={{ fontSize: 12, color: 'var(--slate-500)', padding: 0 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                api.notifications.markRead(n.id).catch(() => {});
                                setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: 1 } : item)));
                              }}
                            >
                              Mark as read
                            </button>
                          ) : <span />}
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: '#2563eb',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              background: 'rgba(37, 99, 235, 0.08)',
                              padding: '2px 8px',
                              borderRadius: 12,
                            }}
                          >
                            {action.label || 'Take Action →'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ padding: '8px 14px', background: 'var(--slate-50, #f8fafc)', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                    <button
                      type="button"
                      className="link-btn"
                      style={{ fontSize: 13, color: 'var(--slate-600)', fontWeight: 600 }}
                      onClick={() => { setShowNotif(false); navigate('/notification-board'); }}
                    >
                      Open Notification Board →
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="notif-wrap" style={{ position: 'relative' }} ref={profileRef}>
              <div 
                className="user-chip" 
                style={{ cursor: 'pointer' }}
                onClick={() => { setShowProfile((s) => !s); setShowNotif(false); }}
                aria-expanded={showProfile}
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
                  {portfolioPath && (
                    <div className="notif-item" style={{ cursor: 'pointer' }} onClick={() => { navigate(portfolioPath); setShowProfile(false); }}>
                      Manage Portfolio
                    </div>
                  )}
                  <div className="notif-item" style={{ cursor: 'pointer' }} onClick={() => { setShowChangePassword(true); setShowProfile(false); }}>
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
            {/* The boundary nearest a suspending child wins, so putting one
                here keeps the sidebar and top bar mounted while the next
                screen's chunk loads — only the content column redraws. */}
            <Suspense fallback={<RouteSkeleton />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>
      </div>
      <ChangePasswordModal open={showChangePassword || !!user?.must_change_password} forced={!!user?.must_change_password && !showChangePassword} onClose={() => setShowChangePassword(false)} />
    </div>
  );
}
