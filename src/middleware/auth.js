const {
  verifyAccessToken,
  verifyItineraryPdfToken,
  verifyFdItineraryPdfToken
} = require('../services/auth.service.js');

const {
  findUserById
} = require('../models/users.model.js');

async function requireAuth(req, res, next) {
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

module.exports.requireAuth = requireAuth;

async function requirePdfToken(req, res, next) {
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

module.exports.requirePdfToken = requirePdfToken;

async function requireFdPdfToken(req, res, next) {
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

module.exports.requireFdPdfToken = requireFdPdfToken;

function requireRole(...roles) {
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

module.exports.requireRole = requireRole;

const STAFF_ROLES = [
  'ops_admin',
  'super_admin',
  'sales_marketing',
  'support',
  'finance',
  'relationship_manager',
  'sales_manager',
];

module.exports.STAFF_ROLES = STAFF_ROLES;

function requireFeature(featureKey) {
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

module.exports.requireFeature = requireFeature;
