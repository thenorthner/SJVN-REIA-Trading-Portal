import { secureLogAudit } from '../auditEngine.js';
import jwt from 'jsonwebtoken';
import db from '../db/index.js';

const DEV_SECRET = 'sjvn-dev-secret-change-me';

/**
 * Token signing key.
 *
 * The development fallback is committed to a public repository, so anyone who
 * can read the source can mint a valid SJVN_ADMIN token. That is tolerable on a
 * laptop and not tolerable anywhere else, so a production start without a real
 * JWT_SECRET fails loudly rather than quietly accepting forged tokens.
 */
const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET;

if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEV_SECRET) {
  throw new Error(
    'JWT_SECRET is not set. The built-in development secret is public, so it '
    + 'cannot be used on a deployed server. Generate one with '
    + '`openssl rand -hex 32` and put it in backend/.env before starting.'
  );
}

/**
 * REIA desk roles before Target #2 Phase B, and what they are now. A row or a
 * token still carrying an old name is read as the new role, so nothing anyone
 * could do is lost in the rename and no code has to know both spellings.
 */
export const LEGACY_ROLES = { REIA_USER: 'REIA_MAKER', REIA_ADMIN: 'REIA_CHECKER' };
export const canonicalRole = (role) => LEGACY_ROLES[role] || role;

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: canonicalRole(user.role), linked_entity_id: user.linked_entity_id },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : (req.query?.token || null);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    req.user.role = canonicalRole(req.user.role);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // A token is good for twelve hours, and used to stay good for all of them
  // whatever happened to the account in the meantime: a team member switched off
  // at ten could go on working until evening. The account is looked up, and a
  // token issued before its sessions were ended is refused.
  const ended = sessionEnded(req.user);
  if (ended) return res.status(401).json({ error: ended });
  const acting = applyActing(req.user, req.get?.('X-Acting-As'));
  if (acting.error) return res.status(403).json({ error: acting.error, code: 'ACTING_ENDED' });
  recordActingRequest(req);
  next();
}

/**
 * Acting in someone else's role (Target #2 Phase D). The screen sends
 * `X-Acting-As: DLG:<id>` to work under an additional charge, or `BG:<id>` under
 * an approved break-glass grant. While it is valid the request carries the
 * role that was handed over, and a name that says whose it is ("Ravi for
 * Meera", "Ravi (break-glass)") — so every record, approval and audit row
 * written shows it without any route knowing. The user id stays the real
 * person's, so no one checks their own work under someone else's role.
 *
 * Returns {} when nothing applies, { error } when the asked-for charge is not
 * (or no longer) valid — the screen then drops it and reloads as the officer.
 */
const IST_TODAY = "date('now', '+330 minutes')";
export function applyActing(claims, header) {
  const h = String(header || '').trim();
  if (!h || !claims) return {};
  const [kind, id] = h.split(':');
  try {
    if (kind === 'DLG') {
      const d = db.prepare(`
        SELECT d.*, u.name AS delegator_name, u.role AS delegator_role, u.is_active AS delegator_active
        FROM role_delegations d JOIN users u ON u.id = d.delegator_id
        WHERE d.id = ? AND d.delegate_id = ? AND d.revoked_at IS NULL
          AND ${IST_TODAY} BETWEEN d.valid_from AND d.valid_to
      `).get(String(id || ''), claims.id);
      if (!d) return { error: 'That additional charge is not in force today. You are working as yourself again.' };
      if (!d.delegator_active || canonicalRole(d.delegator_role) !== d.role) {
        return { error: `${d.delegator_name}'s role has changed since the charge was given; ask the administrator to record it again.` };
      }
      claims.real = { role: claims.role, name: claims.name };
      claims.role = d.role;
      claims.name = `${claims.name} for ${d.delegator_name}`;
      claims.acting = {
        kind: 'DLG', id: d.id, for_user_id: d.delegator_id, for_name: d.delegator_name, until: d.valid_to,
        contract_ids: d.contract_ids_json ? JSON.parse(d.contract_ids_json) : null,
      };
      return claims.acting;
    }
    if (kind === 'BG') {
      const g = db.prepare(`
        SELECT * FROM break_glass_grants WHERE id = ? AND user_id = ? AND status = 'ACTIVE' AND expires_at > datetime('now')
      `).get(String(id || ''), claims.id);
      if (!g) return { error: 'That break-glass access is not open (it expired, was ended, or is still awaiting approval).' };
      claims.real = { role: claims.role, name: claims.name };
      claims.role = g.role;
      claims.name = `${claims.name} (break-glass)`;
      claims.acting = { kind: 'BG', id: g.id, until: g.expires_at, contract_ids: null };
      return claims.acting;
    }
  } catch {
    return { error: 'Acting for someone else is not available on this database yet.' };
  }
  return { error: 'Unknown acting-as value' };
}

/** Every change made while acting is a row of its own in the audit trail. */
function recordActingRequest(req) {
  const a = req.user?.acting;
  if (!a || req.method === 'GET' || req._actingRecorded) return;
  req._actingRecorded = true;
  try {
    secureLogAudit(req, {
      action: a.kind === 'BG' ? 'BREAK_GLASS_ACTION' : 'ADDITIONAL_CHARGE_ACTION',
      module: 'GOVERNANCE',
      entityType: a.kind === 'BG' ? 'break_glass_grant' : 'role_delegation',
      entityId: a.id,
      details: { request: `${req.method} ${(req.originalUrl || '').split('?')[0]}`, role: req.user.role, real_role: req.user.real?.role, for: a.for_name || null },
    });
  } catch { /* the request matters more than its extra audit row */ }
}

/**
 * The signed-in user behind a request, or null — for middleware that runs ahead
 * of the routers' own requireAuth (the statutory-declaration register) and only
 * needs to know who is asking. It never answers the request itself.
 */
export function userFromToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query?.token || null);
  if (!token) return null;
  try {
    const claims = jwt.verify(token, JWT_SECRET);
    claims.role = canonicalRole(claims.role);
    if (sessionEnded(claims)) return null;
    // Middleware ahead of the routers sees the same acting role the routes will.
    if (applyActing(claims, req.get?.('X-Acting-As')).error) return null;
    return claims;
  } catch {
    return null;
  }
}

let accountLookup = null;
function sessionEnded(claims) {
  try {
    accountLookup = accountLookup || db.prepare('SELECT is_active, sessions_revoked_at FROM users WHERE id = ?');
    const row = accountLookup.get(claims.id);
    if (!row) return null; // tokens for accounts that are not rows (service callers, tests) are left as they were
    if (!row.is_active) return 'This account has been deactivated';
    if (row.sessions_revoked_at && claims.iat && claims.iat < row.sessions_revoked_at) return 'Your session has ended — please sign in again';
    return null;
  } catch {
    accountLookup = null; // a database without the column yet
    return null;
  }
}

export function requireRole(...roles) {
  const gate = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      // A refused action is recorded as well as a permitted one. A log of
      // successes alone cannot show someone repeatedly reaching for something
      // they are not entitled to, which is the pattern worth seeing.
      try {
        secureLogAudit(req, {
          action: 'ACCESS_DENIED',
          module: 'AUTH',
          entityType: 'route',
          entityId: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
          reason: `Role ${req.user.role} is not authorized`,
          details: { required_roles: roles },
        });
      } catch { /* refusing the request matters more than recording it */ }
      return res.status(403).json({ error: `Role ${req.user.role} is not authorized for this action` });
    }
    next();
  };
  // Readable by the role-matrix inventory (tests/roleMatrix.test.js), which
  // walks every route to prove each action still has someone who may take it.
  gate.roles = roles;
  return gate;
}

import { v4 as uuidv4 } from 'uuid';

export function assignTraceId(req, res, next) {
  // A trace id is how one reported error is found among the day's requests, so
  // it wants to be unique across the log rather than merely across a moment.
  req.traceId = req.headers['x-trace-id'] || `TRC-${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  next();
}

export const SELLER_ROLES = ['SELLER', 'SELLER_L1', 'SELLER_L2', 'SELLER_L3'];
export const BUYER_ROLES = ['BUYER', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3'];

/**
 * Normalise a counterparty user to the side they belong to.
 *
 * Company sub-users created from Team Management get roles like SELLER_L1 /
 * BUYER_L2. Row-level scoping must treat those exactly like the parent
 * SELLER / BUYER role — an `=== 'SELLER'` check silently fails for them, and
 * because these filters are "add a WHERE clause if counterparty", failing the
 * check means NO filter is applied and the user sees every company's data.
 *
 * Returns 'SELLER', 'BUYER', or null for internal SJVN users.
 */
export function counterpartySide(user) {
  if (!user) return null;
  if (SELLER_ROLES.includes(user.role)) return 'SELLER';
  if (BUYER_ROLES.includes(user.role)) return 'BUYER';
  return null;
}

/**
 * Target #2 Phase B (20-Oct-2026): the SJVN and IT administrators govern and
 * oversee — masters, users, onboarding, audit — and see every desk (the *_ALL
 * read groups), but they are in no *_WRITE / checker group: they do not draft,
 * submit, verify, approve or release a transaction. Every power that moved
 * left an owner behind; tests/roleMatrix.test.js fails if one does not.
 */
export const PLATFORM_ADMINS = ['SJVN_ADMIN', 'IT_SUPER_ADMIN'];

export const ROLE_GROUPS = {
  // REIA desk: the maker drafts, the checker scrutinises, the approver (HOD) sanctions.
  REIA_ALL: ['SJVN_ADMIN', 'REIA_CHECKER', 'IT_SUPER_ADMIN', 'REIA_MAKER', 'REIA_APPROVER', 'FINANCE_USER', 'MANAGEMENT'],
  REIA_WRITE: ['REIA_CHECKER', 'REIA_MAKER'],
  // Target #2 Phase B.2 (22-Oct-2026): the maker prepares — creates, edits,
  // uploads, records, verifies a bill's checklist and submits; the checker
  // decides — validates, locks, approves, sends back, waives, posts. REIA_WRITE
  // is left for the few acts that are either's (tests/roleMatrix.test.js names
  // them). A checker does not create: when the maker is away an administrator
  // records an additional charge (Phase D) and the work is done "X for Y".
  REIA_MAKE: ['REIA_MAKER'],
  REIA_CHECK: ['REIA_CHECKER'],
  // Final sanction on the REIA desk: its HOD, or SJVN management.
  REIA_APPROVE: ['REIA_APPROVER', 'MANAGEMENT'],
  COMMERCIAL_ALL: ['SJVN_ADMIN', 'COMMERCIAL_ADMIN', 'COMMERCIAL', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  COMMERCIAL_WRITE: ['COMMERCIAL_ADMIN', 'COMMERCIAL'],
  HYDRO_THERMAL_ALL: ['SJVN_ADMIN', 'COMMERCIAL_ADMIN', 'COMMERCIAL', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  HYDRO_THERMAL_WRITE: ['COMMERCIAL_ADMIN', 'COMMERCIAL'],
  // Thermal billing is its own desk with its own logins. A thermal officer sees
  // the Thermal section only; the Commercial (hydro) desk does not see thermal.
  THERMAL_ALL: ['SJVN_ADMIN', 'THERMAL_ADMIN', 'THERMAL_USER', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  THERMAL_WRITE: ['THERMAL_ADMIN', 'THERMAL_USER'],
  FINANCE: ['FINANCE_USER', 'REIA_MAKER'],
  // Who may say money has arrived in SJVN's bank, or apply or refund an
  // advance: Finance alone (decided 17-Oct-2026). The desk that raises and
  // chases a bill is not the one that confirms it was paid.
  FINANCE_CONFIRM: ['FINANCE_USER'],
  TRADING_ALL: ['SJVN_ADMIN', 'TRADING_USER', 'TRADING_ADMIN', 'FINANCE_USER', 'MANAGEMENT'],
  TRADING_WRITE: ['TRADING_USER', 'TRADING_ADMIN'],
  // Who may act as the checker on a bid. Separate from TRADING_WRITE so the
  // approving role can be narrowed without also removing the ability to bid.
  TRADING_CHECKER: ['TRADING_USER', 'TRADING_ADMIN', 'MANAGEMENT'],
  SELLER_ACCESS: ['SELLER', 'SELLER_L1', 'SELLER_L2', 'SELLER_L3', 'SJVN_ADMIN', 'REIA_CHECKER', 'IT_SUPER_ADMIN'],
  BUYER_ACCESS: ['BUYER', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3', 'SJVN_ADMIN', 'REIA_CHECKER', 'IT_SUPER_ADMIN'],
  ANY_AUTH: [
    'SJVN_ADMIN', 'REIA_MAKER', 'REIA_CHECKER', 'REIA_APPROVER', 'TRADING_USER', 'TRADING_ADMIN',
    'COMMERCIAL_ADMIN', 'COMMERCIAL', 'THERMAL_ADMIN', 'THERMAL_USER',
    'FINANCE_USER', 'MANAGEMENT', 'SELLER', 'BUYER',
    'TRADING_CLIENT', 'TRADING_CLIENT_MAKER', 'TRADING_CLIENT_CHECKER', 'COMPLIANCE_AUDITOR',
  ],
  AUDITOR: ['SJVN_ADMIN', 'COMPLIANCE_AUDITOR'],
  // Cross-vertical executive view — the Consolidated Dashboard and the MIS pack.
  EXECUTIVE: ['SJVN_ADMIN', 'MANAGEMENT', 'FINANCE_USER', 'IT_SUPER_ADMIN'],
};
