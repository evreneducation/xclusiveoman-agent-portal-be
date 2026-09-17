const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');

const {
  env
} = require('../config/env.js');

// Agent/Team still sign in exclusively via email OTP (generateNumericOtp
// below) — no password anywhere for them, same as when users.password_hash
// was fully dropped (0060_drop_password.sql). The Admin Console is the one
// exception: 0084_admin_password.sql reintroduced that column, per-account
// this time (each admin/staff row has its own bcrypt hash, not one shared
// secret) — hashPassword/comparePassword below are what auth.controller.js#
// adminLogin and scripts/seedAdminPasswords.js use to write/check it.
const BCRYPT_ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

module.exports.hashPassword = hashPassword;

function comparePassword(plain, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}

module.exports.comparePassword = comparePassword;

function baseClaims(user) {
  return {
    sub: user.id,
    role: user.role,
    agencyId: user.agency_id,
  };
}

function signAccessToken(user) {
  return jwt.sign(baseClaims(user), env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn,
  });
}

module.exports.signAccessToken = signAccessToken;

function signRefreshToken(user) {
  return jwt.sign(baseClaims(user), env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
}

module.exports.signRefreshToken = signRefreshToken;

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

module.exports.verifyAccessToken = verifyAccessToken;

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

module.exports.verifyRefreshToken = verifyRefreshToken;

// Itinerary PDF rendering — a normal access token can't be used here: it's
// long-lived (15m) and grants full API access, which is far more than a
// headless-browser render of one specific itinerary needs. This is a
// separate, narrow-purpose token: very short-lived (2m — a Puppeteer render
// takes seconds, not minutes), carries the one packageRequestId it's allowed
// to read, and is marked with `purpose` so requireAuth (middleware/auth.js)
// explicitly refuses it as a normal Bearer token — a leaked pdf token can
// only ever be replayed against the one read-only itinerary-data endpoint
// that accepts it (requirePdfToken), for the one request it names, within
// its 2-minute window.
const ITINERARY_PDF_TOKEN_PURPOSE = 'itinerary_pdf';
const ITINERARY_PDF_TOKEN_EXPIRES_IN = '2m';

function signItineraryPdfToken({ userId, packageRequestId }) {
  return jwt.sign(
    { sub: userId, packageRequestId, purpose: ITINERARY_PDF_TOKEN_PURPOSE },
    env.jwtAccessSecret,
    { expiresIn: ITINERARY_PDF_TOKEN_EXPIRES_IN }
  );
}

module.exports.signItineraryPdfToken = signItineraryPdfToken;

function verifyItineraryPdfToken(token) {
  const claims = jwt.verify(token, env.jwtAccessSecret);
  if (claims.purpose !== ITINERARY_PDF_TOKEN_PURPOSE) {
    throw new Error('Not an itinerary PDF token');
  }
  return claims;
}

module.exports.verifyItineraryPdfToken = verifyItineraryPdfToken;

// Same narrow-purpose-token pattern as signItineraryPdfToken above, for FD
// departure itineraries (DepartureDetail.jsx's "Download Itinerary") instead
// of Custom FIT package_requests — a separate `purpose` string so a leaked
// FD token can't be replayed against the FIT data endpoint or vice versa,
// even though both are scoped the same way otherwise.
const FD_ITINERARY_PDF_TOKEN_PURPOSE = 'fd_itinerary_pdf';
const FD_ITINERARY_PDF_TOKEN_EXPIRES_IN = '2m';

function signFdItineraryPdfToken({ userId, departureId }) {
  return jwt.sign(
    { sub: userId, departureId, purpose: FD_ITINERARY_PDF_TOKEN_PURPOSE },
    env.jwtAccessSecret,
    { expiresIn: FD_ITINERARY_PDF_TOKEN_EXPIRES_IN }
  );
}

module.exports.signFdItineraryPdfToken = signFdItineraryPdfToken;

function verifyFdItineraryPdfToken(token) {
  const claims = jwt.verify(token, env.jwtAccessSecret);
  if (claims.purpose !== FD_ITINERARY_PDF_TOKEN_PURPOSE) {
    throw new Error('Not an FD itinerary PDF token');
  }
  return claims;
}

module.exports.verifyFdItineraryPdfToken = verifyFdItineraryPdfToken;

// Admin console 2FA — the bridge between the two login steps. When 2FA is
// on, verify-otp doesn't issue a session; it hands back one of these
// instead, and verify-mfa trades it (plus a valid authenticator code) for
// the real tokens. Same narrow-purpose-token pattern as the PDF tokens
// above: signed with the access secret but marked `purpose` so requireAuth
// (middleware/auth.js) refuses it as a normal Bearer token — all it can
// ever do is name which half-authenticated user is mid-login, for 10
// minutes, to the one endpoint that finishes the job.
const ADMIN_MFA_TOKEN_PURPOSE = 'admin_mfa';
const ADMIN_MFA_TOKEN_EXPIRES_IN = '10m';

function signAdminMfaToken({ userId }) {
  return jwt.sign({ sub: userId, purpose: ADMIN_MFA_TOKEN_PURPOSE }, env.jwtAccessSecret, {
    expiresIn: ADMIN_MFA_TOKEN_EXPIRES_IN,
  });
}

module.exports.signAdminMfaToken = signAdminMfaToken;

function verifyAdminMfaToken(token) {
  const claims = jwt.verify(token, env.jwtAccessSecret);
  if (claims.purpose !== ADMIN_MFA_TOKEN_PURPOSE) {
    throw new Error('Not an admin MFA token');
  }
  return claims;
}

module.exports.verifyAdminMfaToken = verifyAdminMfaToken;

function hashRawToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports.hashRawToken = hashRawToken;

function generateNumericOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

module.exports.generateNumericOtp = generateNumericOtp;
