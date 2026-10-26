export const ROLE_GROUPS = {
  // These four mirror ROLE_GROUPS in backend/src/middleware/auth.js exactly,
  // because the API is what actually decides. A role listed here and not there
  // is shown screens whose every call answers 403; one listed there and not here
  // is allowed by the API but never offered the menu. The backend test
  // roleGroupsParity.test.js fails if the two lists drift apart again.
  // Target #2 Phase B: the SJVN / IT administrators read every desk and write on none.
  REIA_ALL: ['SJVN_ADMIN', 'REIA_CHECKER', 'IT_SUPER_ADMIN', 'REIA_MAKER', 'REIA_APPROVER', 'FINANCE_USER', 'MANAGEMENT'],
  REIA_WRITE: ['REIA_CHECKER', 'REIA_MAKER'],
  // Phase B.2: the maker prepares, the checker decides (see middleware/auth.js).
  REIA_MAKE: ['REIA_MAKER'],
  REIA_CHECK: ['REIA_CHECKER'],
  REIA_APPROVE: ['REIA_APPROVER', 'MANAGEMENT'],
  COMMERCIAL_ALL: ['SJVN_ADMIN', 'COMMERCIAL_ADMIN', 'COMMERCIAL', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  COMMERCIAL_WRITE: ['COMMERCIAL_ADMIN', 'COMMERCIAL'],
  HYDRO_THERMAL_ALL: ['SJVN_ADMIN', 'COMMERCIAL_ADMIN', 'COMMERCIAL', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  HYDRO_THERMAL_WRITE: ['COMMERCIAL_ADMIN', 'COMMERCIAL'],
  // Thermal billing's own desk and logins — mirrors THERMAL_ALL / THERMAL_WRITE in the API.
  THERMAL_ALL: ['SJVN_ADMIN', 'THERMAL_ADMIN', 'THERMAL_USER', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  THERMAL_WRITE: ['THERMAL_ADMIN', 'THERMAL_USER'],
  TRADING_ALL: ['SJVN_ADMIN', 'TRADING_USER', 'TRADING_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  TRADING_WRITE: ['TRADING_USER', 'TRADING_ADMIN'],

  // Counterparty portal roles. Company admins (SELLER / BUYER) plus the
  // maker-checker sub-users they create from Team Management. These must be
  // listed explicitly everywhere — checking `role === 'SELLER'` silently
  // excludes SELLER_L1/L2/L3 and drops them into the internal SJVN nav.
  SELLER_ALL: ['SELLER', 'SELLER_L1', 'SELLER_L2', 'SELLER_L3'],
  BUYER_ALL: ['BUYER', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3'],
  
  // Trading client external portal: the company's read-only login, plus the
  // maker who raises a request to the desk and the checker who clears it. All
  // three are in the users.role CHECK, in the backend's tradingClientScope.js
  // and here — roleGroupsParity.test.js fails if the three ever disagree.
  TRADING_CLIENT_ALL: ['TRADING_CLIENT', 'TRADING_CLIENT_MAKER', 'TRADING_CLIENT_CHECKER'],
  // Who may raise a request to the desk, and who may clear it. Never the same
  // person on the same request — that is what the two roles are for.
  TRADING_CLIENT_MAKER: ['TRADING_CLIENT_MAKER'],
  TRADING_CLIENT_CHECKER: ['TRADING_CLIENT_CHECKER'],

  // Cross-module executive view (Consolidated Dashboard). Deliberately narrow:
  // it aggregates REIA + Trading financials across every counterparty, so no
  // seller/buyer user may ever see it.
  EXECUTIVE: ['SJVN_ADMIN', 'MANAGEMENT', 'FINANCE_USER', 'IT_SUPER_ADMIN'],

  // Audit trail. Must stay in sync with ROLE_GROUPS.AUDITOR on the backend
  // (middleware/auth.js) — if the nav shows the link to a role the API
  // rejects, the user just gets a 403 on an empty page.
  AUDITOR: ['SJVN_ADMIN', 'COMPLIANCE_AUDITOR'],

  // Governance reports (Activity, Audit). Per-person activity data, so this is
  // audit plus management only — deliberately narrower than the module reports.
  // Must stay in sync with ACTIVITY_READ in backend routes/reports.js.
  GOVERNANCE_REPORTS: ['SJVN_ADMIN', 'COMPLIANCE_AUDITOR', 'MANAGEMENT'],

  // Configurable master data (SRS). Write = ops + admin; read includes finance/mgmt.
  // Masters are governance (Target #2 Phase B): the administrators write them, the desks read them.
  MASTERS_WRITE: ['SJVN_ADMIN', 'IT_SUPER_ADMIN'],
  MASTERS_READ: ['SJVN_ADMIN', 'REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  // Publishing to the public /circulars page. Must stay in sync with CIRCULAR_ADMIN_ROLES in backend routes/circulars.js.
  CIRCULARS_WRITE: ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'REIA_CHECKER', 'TRADING_ADMIN', 'COMMERCIAL_ADMIN'],
};

export const isSellerRole = (role) => ROLE_GROUPS.SELLER_ALL.includes(role);
export const isBuyerRole = (role) => ROLE_GROUPS.BUYER_ALL.includes(role);
export const isCounterpartyRole = (role) => isSellerRole(role) || isBuyerRole(role);
export const isTradingClientRole = (role) => ROLE_GROUPS.TRADING_CLIENT_ALL.includes(role);
export const isCommercialRole = (role) => ['COMMERCIAL_ADMIN', 'COMMERCIAL'].includes(role);
export const isThermalRole = (role) => ['THERMAL_ADMIN', 'THERMAL_USER'].includes(role);

// Who may open each protected area, mirroring the ProtectedRoute guards in App.jsx.
// Longest prefix wins, so /trading/rtm is checked against the trading desk.
const PATH_ROLES = [
  ['/uploader/cea-excel', ROLE_GROUPS.TRADING_ALL],
  ['/hydro-thermal', ROLE_GROUPS.HYDRO_THERMAL_ALL],
  ['/thermal', ROLE_GROUPS.THERMAL_ALL],
  ['/trading', ROLE_GROUPS.TRADING_ALL],
  ['/reia', ROLE_GROUPS.REIA_ALL],
  ['/seller', [...ROLE_GROUPS.SELLER_ALL, 'SJVN_ADMIN']],
  ['/buyer', [...ROLE_GROUPS.BUYER_ALL, 'SJVN_ADMIN']],
  ['/audit-logs', ROLE_GROUPS.AUDITOR],
].sort((a, b) => b[0].length - a[0].length);

export function canRoleOpenPath(role, path) {
  const guard = PATH_ROLES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return !guard || guard[1].includes(role);
}
