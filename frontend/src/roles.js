export const ROLE_GROUPS = {
  REIA_ALL: ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER', 'MANAGEMENT', 'IT_SUPER_ADMIN'],
  REIA_WRITE: ['SJVN_ADMIN', 'REIA_USER', 'IT_SUPER_ADMIN'],
  TRADING_ALL: ['SJVN_ADMIN', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT', 'IT_SUPER_ADMIN'],
  TRADING_WRITE: ['SJVN_ADMIN', 'TRADING_USER', 'IT_SUPER_ADMIN'],

  // Counterparty portal roles. Company admins (SELLER / BUYER) plus the
  // maker-checker sub-users they create from Team Management. These must be
  // listed explicitly everywhere — checking `role === 'SELLER'` silently
  // excludes SELLER_L1/L2/L3 and drops them into the internal SJVN nav.
  SELLER_ALL: ['SELLER', 'SELLER_L1', 'SELLER_L2', 'SELLER_L3'],
  BUYER_ALL: ['BUYER', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3'],

  // Cross-module executive view (Consolidated Dashboard). Deliberately narrow:
  // it aggregates REIA + Trading financials across every counterparty, so no
  // seller/buyer user may ever see it.
  EXECUTIVE: ['SJVN_ADMIN', 'MANAGEMENT', 'FINANCE_USER', 'IT_SUPER_ADMIN'],

  // Audit trail. Must stay in sync with ROLE_GROUPS.AUDITOR on the backend
  // (middleware/auth.js) — if the nav shows the link to a role the API
  // rejects, the user just gets a 403 on an empty page.
  AUDITOR: ['SJVN_ADMIN', 'COMPLIANCE_AUDITOR'],

  // Configurable master data (SRS). Write = ops + admin; read includes finance/mgmt.
  MASTERS_WRITE: ['SJVN_ADMIN', 'REIA_USER', 'IT_SUPER_ADMIN'],
  MASTERS_READ: ['SJVN_ADMIN', 'REIA_USER', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
};

export const isSellerRole = (role) => ROLE_GROUPS.SELLER_ALL.includes(role);
export const isBuyerRole = (role) => ROLE_GROUPS.BUYER_ALL.includes(role);
export const isCounterpartyRole = (role) => isSellerRole(role) || isBuyerRole(role);
