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

export const ROLE_GROUPS = {
  REIA_ALL: ['SJVN_ADMIN', 'REIA_USER', 'FINANCE_USER', 'MANAGEMENT'],
  REIA_WRITE: ['SJVN_ADMIN', 'REIA_USER'],
  FINANCE: ['SJVN_ADMIN', 'FINANCE_USER', 'REIA_USER'],
  TRADING_ALL: ['SJVN_ADMIN', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT'],
  TRADING_WRITE: ['SJVN_ADMIN', 'TRADING_USER'],
  SELLER_ACCESS: ['SELLER', 'SJVN_ADMIN'],
  BUYER_ACCESS: ['BUYER', 'SJVN_ADMIN'],
  ANY_AUTH: ['SJVN_ADMIN', 'REIA_USER', 'TRADING_USER', 'FINANCE_USER', 'MANAGEMENT', 'SELLER', 'BUYER', 'TRADING_CLIENT', 'COMPLIANCE_AUDITOR'],
  AUDITOR: ['SJVN_ADMIN', 'COMPLIANCE_AUDITOR'],
};
