import { verifyAccessToken, verifyItineraryPdfToken, verifyFdItineraryPdfToken } from '../services/auth.service.js';
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
    // Narrow-purpose tokens (e.g. signItineraryPdfToken — see auth.service.js)
    // are signed with this same secret but must never work as a normal,
    // full-access Bearer token: a real login-issued access token never
    // carries a `purpose` claim (see baseClaims), so any token that does is
    // rejected here regardless of whether its signature verifies.
    if (claims.purpose) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }
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

/**
 * Itinerary PDF rendering — verifies the short-lived, single-request-scoped
 * token minted by downloadItineraryPdf (packageRequests.controller.js) and
 * attaches its claims to req.pdfClaims. Deliberately not requireAuth: this
 * runs in a Puppeteer-navigated page with no login session/cookies, and the
 * token itself is already scoped to exactly one packageRequestId — the
 * controller using this still re-checks that against req.params.id and
 * re-verifies agency ownership before returning any data (see
 * itineraryPdfData.controller.js), the same "don't trust the token's claims
 * alone" posture requireAuth takes by re-fetching the user from the DB.
 */
export async function requirePdfToken(req, res, next) {
  const token = typeof req.query.pdfToken === 'string' ? req.query.pdfToken : null;
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing pdfToken' });
  }
  try {
    req.pdfClaims = verifyItineraryPdfToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired pdfToken' });
  }
}

// Same shape as requirePdfToken above, for FD departure itineraries (see
// signFdItineraryPdfToken/verifyFdItineraryPdfToken — auth.service.js) —
// attaches req.fdPdfClaims instead of req.pdfClaims so the two token kinds
// can never be confused for one another even though both flow through this
// same file.
export async function requireFdPdfToken(req, res, next) {
  const token = typeof req.query.pdfToken === 'string' ? req.query.pdfToken : null;
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Missing pdfToken' });
  }
  try {
    req.fdPdfClaims = verifyFdItineraryPdfToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired pdfToken' });
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
  'relationship_manager',
  'sales_manager',
];

// Access Features (config/accessFeatures.js) — the real, server-side half of
// the /team Access Feature checkboxes an admin sets on an LM/RM when
// creating or editing one (Employees.jsx). requireRole(...STAFF_ROLES)
// alone would let *every* LM/RM through every admin.* route; this narrows
// that further, per-route, to only the feature that route belongs to.
//
// Only ever narrows sales_manager/relationship_manager — every other STAFF_
// ROLE (ops_admin, super_admin, sales_marketing, support, finance) has no
// Access Features concept at all and passes straight through, same
// unrestricted access requireRole(...STAFF_ROLES) already gave them. Must
// run after requireAuth (needs req.user) — same convention as requireRole.
export function requireFeature(featureKey) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (role !== 'sales_manager' && role !== 'relationship_manager') {
      return next();
    }
    if (req.user.permissions?.[featureKey] === true) {
      return next();
    }
    return res.status(403).json({
      error: 'forbidden',
      message: 'This feature is not enabled on your account. Contact an admin to request access.',
    });
  };
}
