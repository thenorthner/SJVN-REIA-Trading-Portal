import { useInRouterContext, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_GROUPS } from '../roles.js';

/**
 * Who may change things on the screen in front of them (Target #2 Phase B).
 *
 * The SJVN and IT administrators — and the compliance auditor — read every desk
 * but transact on none; the server refuses them. On a desk screen they see it
 * read-only, so they are not offered buttons that can only answer "not
 * authorised". Governance screens (masters, users, onboarding, audit, projects,
 * charges, broadcasts) stay theirs to work on.
 */
export const PLATFORM_ADMINS = ['SJVN_ADMIN', 'IT_SUPER_ADMIN'];
const READ_ONLY_ROLES = [...PLATFORM_ADMINS, 'COMPLIANCE_AUDITOR'];

// Screens where the administrators still act. Everything else on a desk is read-only for them.
const GOVERNANCE = [
  /^\/masters?\//, /^\/admin\//, /^\/settings\//, /^\/audit-logs/, /^\/notification-board/, /^\/mail/,
  /^\/reia\/(entities|document-desk|company-users)/, /^\/(hydro-thermal|thermal)\/(stakeholders|document-desk)/,
  /^\/trading\/bulk-communications/,
];

const DESKS = [
  [/^\/reia(\/|$)/, 'REIA'],
  [/^\/hydro-thermal(\/|$)/, 'HYDRO'],
  [/^\/thermal(\/|$)/, 'THERMAL'],
  [/^\/(trading|reports|cerc|cea|erp|client|invoices)(\/|$)/, 'TRADING'],
];
const WRITERS = {
  REIA: [...ROLE_GROUPS.REIA_WRITE, ...ROLE_GROUPS.REIA_APPROVE, 'FINANCE_USER'],
  HYDRO: [...ROLE_GROUPS.HYDRO_THERMAL_WRITE, 'FINANCE_USER', 'MANAGEMENT'],
  THERMAL: [...ROLE_GROUPS.THERMAL_WRITE, 'FINANCE_USER', 'MANAGEMENT'],
  TRADING: [...ROLE_GROUPS.TRADING_WRITE, 'FINANCE_USER', 'MANAGEMENT'],
};

export function deskOf(pathname) {
  if (GOVERNANCE.some((re) => re.test(pathname))) return null;
  return DESKS.find(([re]) => re.test(pathname))?.[1] || null;
}

/** { desk, readOnly } for the signed-in user on the current screen. */
export function useDeskAccess() {
  const { user } = useAuth() || {};
  // A screen rendered on its own (a unit test) has no router; the address bar
  // says the same thing there. Whether a router exists never changes for a
  // mounted component, so the hook order is stable.
  const inRouter = useInRouterContext();
  const pathname = inRouter ? useLocation().pathname : (typeof window !== 'undefined' ? window.location.pathname : '/'); // eslint-disable-line react-hooks/rules-of-hooks
  const desk = deskOf(pathname);
  const role = user?.role;
  const readOnly = !!desk && READ_ONLY_ROLES.includes(role);
  return { desk, readOnly, canWrite: !!desk && !readOnly && (WRITERS[desk] || []).includes(role) };
}

/** For screens that decide per button: may this user change data here? */
export function useCanWrite() {
  return !useDeskAccess().readOnly;
}
