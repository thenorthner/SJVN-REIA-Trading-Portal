import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'sjvn-dev-secret-change-me';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, linked_entity_id: user.linked_entity_id },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Role ${req.user.role} is not authorized for this action` });
    }
    next();
  };
}

import { v4 as uuidv4 } from 'uuid';

export function assignTraceId(req, res, next) {
  req.traceId = req.headers['x-trace-id'] || `TRC-${uuidv4().slice(0, 8)}`;
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

export const ROLE_GROUPS = {
  REIA_ALL: ['SJVN_ADMIN', 'REIA_ADMIN', 'IT_SUPER_ADMIN', 'REIA_USER', 'FINANCE_USER', 'MANAGEMENT'],
  REIA_WRITE: ['SJVN_ADMIN', 'REIA_ADMIN', 'IT_SUPER_ADMIN', 'REIA_USER'],
  FINANCE: ['SJVN_ADMIN', 'IT_SUPER_ADMIN', 'FINANCE_USER', 'REIA_USER'],
  TRADING_ALL: ['SJVN_ADMIN', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT'],
  TRADING_WRITE: ['SJVN_ADMIN', 'TRADING_USER'],
  SELLER_ACCESS: ['SELLER', 'SELLER_L1', 'SELLER_L2', 'SELLER_L3', 'SJVN_ADMIN', 'REIA_ADMIN', 'IT_SUPER_ADMIN'],
  BUYER_ACCESS: ['BUYER', 'BUYER_L1', 'BUYER_L2', 'BUYER_L3', 'SJVN_ADMIN', 'REIA_ADMIN', 'IT_SUPER_ADMIN'],
  ANY_AUTH: ['SJVN_ADMIN', 'REIA_USER', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT', 'SELLER', 'BUYER', 'TRADING_CLIENT', 'COMPLIANCE_AUDITOR'],
  AUDITOR: ['SJVN_ADMIN', 'COMPLIANCE_AUDITOR'],
};
