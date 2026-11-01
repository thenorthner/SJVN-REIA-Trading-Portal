import db from '../db/index.js';
import { secureLogAudit } from '../auditEngine.js';
import { counterpartySide } from './auth.js';

/**
 * A seller's or buyer's company has to pass KYC before its people work with
 * contracts, bills, payments and the rest. The screen has always said so
 * (ProtectedRoute `requiresKyc`: the linked company's status is not APPROVED),
 * but the API answered anyway, so the same token read everything the locked
 * pages would have shown. The rule is the screen's, held on the server.
 *
 * Only a seller or buyer login linked to a company record is affected. A login
 * with no company, or one whose company row is gone, is not stopped here, as it
 * is not on screen; the data routes already scope it to nothing. Made roles
 * cannot work like a seller or buyer (rolePowers ROLE_BASES), so the role on
 * the token is the side.
 *
 * Returns the company's status when it is not approved (PENDING, REJECTED),
 * or null when nothing is held back.
 */
let statusOf = null;
export function kycPending(user) {
  if (!user?.linked_entity_id || !counterpartySide(user)) return null;
  try {
    statusOf = statusOf || db.prepare('SELECT status FROM entities WHERE id = ?');
    const row = statusOf.get(user.linked_entity_id);
    if (!row || row.status === 'APPROVED') return null;
    return row.status || 'PENDING';
  } catch {
    statusOf = null;
    return null;
  }
}

/**
 * What a company waiting on KYC may still reach, under /api. Each is a path
 * prefix taken whole (`/auth` is `/auth` and `/auth/...`), for any method
 * unless one is named. Everything else is a data route and is refused.
 */
export const KYC_OPEN_ROUTES = [
  { path: '/health', why: 'service check' },
  { path: '/auth', why: 'sign in and out, own account, password' },
  { path: '/public', why: 'public pages, no sign-in' },
  { path: '/circulars', why: 'public circulars, no sign-in' },
  { path: '/privacy', why: "the person's own data rights, which do not wait on the company's KYC" },
  { path: '/entities', why: "the company's own profile and KYC submission (already limited to its own record)" },
  { path: '/documents', why: 'KYC documents and SJVN\'s requests for them (contract documents are held back, routes/documents.js)' },
  { path: '/masters/document-types', methods: ['GET'], why: 'the document types the documents page lists' },
  { path: '/team', why: "the company's own users, set up while KYC is reviewed" },
  { path: '/notifications', why: 'notifications' },
  { path: '/alerts', why: 'the notification board' },
  { path: '/mail', why: 'messages to and from SJVN, how a pending company follows up its KYC' },
  { path: '/home', exact: true, methods: ['GET'], why: 'the landing page and its KYC notice (figures held back, routes/counterpartyHome.js)' },
];

export function kycOpen(method, path) {
  const p = String(path || '').replace(/\/+$/, '') || '/';
  return KYC_OPEN_ROUTES.some((r) => {
    if (r.methods && !r.methods.includes(method)) return false;
    return r.exact ? p === r.path : (p === r.path || p.startsWith(`${r.path}/`));
  });
}

export const kycRefusal = (status) =>
  `Your company's KYC is ${String(status).replace(/_/g, ' ').toLowerCase()}. This opens once SJVN has approved it.`;

/**
 * Mounted on /api ahead of the routers, as the role-power guard is, so one
 * rule covers every data route, including ones added later. `resolveUser`
 * reads the token.
 */
export function counterpartyKycGuard(resolveUser) {
  return (req, res, next) => {
    if (kycOpen(req.method, req.path)) return next();
    const user = resolveUser(req);
    const status = kycPending(user);
    if (!status) return next();
    try {
      secureLogAudit({ user, traceId: req.traceId, ip: req.ip }, {
        action: 'ACCESS_DENIED',
        module: 'AUTH',
        entityType: 'route',
        entityId: `${req.method} ${(req.originalUrl || '').split('?')[0]}`,
        reason: `Company KYC is ${status}`,
        details: { entity_id: user.linked_entity_id, kyc_status: status },
      });
    } catch { /* refusing the request matters more than recording it */ }
    return res.status(403).json({ error: kycRefusal(status), code: 'KYC_PENDING', kyc_status: status });
  };
}
