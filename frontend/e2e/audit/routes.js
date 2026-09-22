// Every screen the app can route to, read out of App.jsx, with the roles its
// guard lets in and the demo login the audit uses to open it.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ROLE_GROUPS } from '../../src/roles.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = fs.readFileSync(path.join(here, '../../src/App.jsx'), 'utf8');

// The role constants App.jsx builds from ROLE_GROUPS, mirrored here. A route
// guarded by a name missing from this map fails the inventory loudly rather
// than being audited as the wrong user.
const uniq = (...lists) => [...new Set(lists.flat())];
const GUARDS = {
  REIA_ROLES: ROLE_GROUPS.REIA_ALL,
  TRADING_INTERNAL_ROLES: ROLE_GROUPS.TRADING_ALL,
  TRADING_CLIENT_ROLES: ROLE_GROUPS.TRADING_CLIENT_ALL,
  TRADING_COMBINED_ROLES: uniq(ROLE_GROUPS.TRADING_ALL, ROLE_GROUPS.TRADING_CLIENT_ALL),
  GENERATOR_BILLING_ROLES: uniq(ROLE_GROUPS.TRADING_ALL, ROLE_GROUPS.REIA_ALL),
  SELLER_ROLES: [...ROLE_GROUPS.SELLER_ALL, 'SJVN_ADMIN'],
  BUYER_ROLES: [...ROLE_GROUPS.BUYER_ALL, 'SJVN_ADMIN'],
  AUDIT_ROLES: ROLE_GROUPS.AUDITOR,
  MASTERS_ROLES: ROLE_GROUPS.MASTERS_READ,
  BOARD_ROLES: uniq(ROLE_GROUPS.REIA_ALL, ROLE_GROUPS.TRADING_ALL, ROLE_GROUPS.TRADING_CLIENT_ALL,
    ROLE_GROUPS.SELLER_ALL, ROLE_GROUPS.BUYER_ALL),
  'ROLE_GROUPS.EXECUTIVE': ROLE_GROUPS.EXECUTIVE,
};

// The demo seed's logins (backend/src/db/seed.js), one per role. The password is
// the seed's fixture for its own throwaway database.
export const DEMO_PASSWORD = 'password123';
export const LOGINS = {
  SJVN_ADMIN: 'admin@sjvn.in',
  REIA_USER: 'reia@sjvn.in',
  TRADING_USER: 'trading@sjvn.in',
  FINANCE_USER: 'finance@sjvn.in',
  MANAGEMENT: 'management@sjvn.in',
  COMPLIANCE_AUDITOR: 'auditor@sjvn.in',
  SELLER: 'seller@sunrise-solar.in',
  BUYER: 'buyer@discom.gov.in',
  TRADING_CLIENT: 'client@abctrading.in',
};

/**
 * Who opens a screen in the audit. A portal screen is opened by its own
 * counterparty, whose data it is scoped to — the admin is let in too, but sees
 * a portal with no company behind it. Everything else is opened by the admin,
 * who can press the most buttons.
 */
function auditRole(routePath, roles) {
  if (!roles) return 'SJVN_ADMIN';
  if (routePath.startsWith('seller')) return 'SELLER';
  if (routePath.startsWith('buyer')) return 'BUYER';
  if (roles.includes('SJVN_ADMIN')) return 'SJVN_ADMIN';
  return Object.keys(LOGINS).find((r) => roles.includes(r)) || null;
}

export function readRoutes() {
  const routes = [];
  const starts = [...APP.matchAll(/<Route\s+(?:path="([^"]*)"|index)/g)];
  starts.forEach((m, i) => {
    const body = APP.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : APP.length);
    const routePath = m[0].includes('index') ? '' : m[1];
    if (routePath === '/login' || routePath === '/' || routePath === '*') return;
    const redirect = /element=\{<Navigate\b/.test(body.split('\n')[0]);
    const guard = body.match(/roles=\{([A-Za-z_.]+)\}/)?.[1] || null;
    if (guard && !GUARDS[guard]) throw new Error(`App.jsx guards "${routePath}" with ${guard}, which the audit does not know`);
    const roles = guard ? GUARDS[guard] : null;
    routes.push({
      path: `/${routePath}`,
      guard,
      roles,
      redirect,
      hasParam: routePath.includes(':'),
      role: auditRole(routePath, roles),
    });
  });
  return routes;
}
