import { verifyAccessToken } from '../services/auth.service.js';
import { findUserById } from '../models/users.model.js';

/**
 * Verifies the access token and attaches the current user to req.user.
 * Re-fetches from the DB (rather than trusting stale claims) so role/status
 * changes made by an admin take effect immediately.
 */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing access token' });
  }

  try {
    const claims = verifyAccessToken(token);
    const user = await findUserById(claims.sub);

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'unauthorized', message: 'Account inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', message: 'Insufficient role' });
    }
    next();
  };
}

// Any staff role (i.e. an internal user, agency_id NULL) at ops_admin level or above.
export const STAFF_ROLES = [
  'ops_admin',
  'super_admin',
  'sales_marketing',
  'support',
  'finance',
];
